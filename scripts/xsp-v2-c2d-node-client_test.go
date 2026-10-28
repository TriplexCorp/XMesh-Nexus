//go:build linux

package cutover

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/TriplexCorp/XMesh-Node/security/xspv2/poc-go/tlsprobe"
)

type c2dPin struct {
	IssuerID    string `json:"issuerId"`
	NodeID      uint64 `json:"nodeId"`
	Purpose     string `json:"purpose"`
	EdKeyID     string `json:"edKeyId"`
	PQKeyID     string `json:"pqKeyId"`
	EdPublicB64 string `json:"edPublicB64"`
	PQPublicB64 string `json:"pqPublicB64"`
}

type c2dExpected struct {
	NodeID             uint64 `json:"nodeId"`
	FromEpoch          uint64 `json:"fromEpoch"`
	ToEpoch            uint64 `json:"toEpoch"`
	RequestID          string `json:"requestId"`
	FromEdKeyID        string `json:"fromEdKeyId"`
	FromPQKeyID        string `json:"fromPQKeyId"`
	ToEdKeyID          string `json:"toEdKeyId"`
	ToPQKeyID          string `json:"toPQKeyId"`
	CandidateSHA256Hex string `json:"candidateSha256Hex"`
}

type c2dBundle struct {
	SignedPermitB64 string      `json:"signedPermitB64"`
	SignedACKB64    string      `json:"signedAckB64"`
	Panel           c2dPin      `json:"panel"`
	Next            c2dPin      `json:"next"`
	Expected        c2dExpected `json:"expected"`
}

func c2dRequired(t *testing.T, name string) string {
	t.Helper()
	value := os.Getenv(name)
	if value == "" {
		t.Fatalf("%s is required", name)
	}
	return value
}

func c2dPinValue(t *testing.T, raw c2dPin) PinnedPublic {
	t.Helper()
	ed, err := base64.StdEncoding.Strict().DecodeString(raw.EdPublicB64)
	if err != nil {
		t.Fatal(err)
	}
	pq, err := base64.StdEncoding.Strict().DecodeString(raw.PQPublicB64)
	if err != nil {
		t.Fatal(err)
	}
	return PinnedPublic{
		IssuerID: raw.IssuerID,
		Purpose: raw.Purpose,
		NodeID: raw.NodeID,
		EdKeyID: raw.EdKeyID,
		PQKeyID: raw.PQKeyID,
		EdPublic: ed,
		PQPublic: pq,
	}
}

func c2dLoadBundle(t *testing.T) (c2dBundle, []byte, []byte, PinnedPublic, PinnedPublic, ExpectedPermit) {
	t.Helper()
	bundleRaw, err := os.ReadFile(c2dRequired(t, "XSP_C2D_BUNDLE"))
	if err != nil {
		t.Fatal(err)
	}
	var bundle c2dBundle
	if err := json.Unmarshal(bundleRaw, &bundle); err != nil {
		t.Fatal(err)
	}
	signedPermit, err := base64.StdEncoding.Strict().DecodeString(bundle.SignedPermitB64)
	if err != nil {
		t.Fatal(err)
	}
	signedACK, err := base64.StdEncoding.Strict().DecodeString(bundle.SignedACKB64)
	if err != nil {
		t.Fatal(err)
	}
	panel := c2dPinValue(t, bundle.Panel)
	next := c2dPinValue(t, bundle.Next)
	want := ExpectedPermit{
		NodeID: bundle.Expected.NodeID,
		FromEpoch: bundle.Expected.FromEpoch,
		ToEpoch: bundle.Expected.ToEpoch,
		RequestID: bundle.Expected.RequestID,
		FromEdKeyID: bundle.Expected.FromEdKeyID,
		FromPQKeyID: bundle.Expected.FromPQKeyID,
		ToEdKeyID: bundle.Expected.ToEdKeyID,
		ToPQKeyID: bundle.Expected.ToPQKeyID,
		CandidateSHA256Hex: bundle.Expected.CandidateSHA256Hex,
	}
	return bundle, signedPermit, signedACK, panel, next, want
}

func c2dStrictPost(ctx context.Context, address, serverName string, roots *x509.CertPool,
	clientCertificate tls.Certificate, path string, body []byte) (int, []byte, error) {
	if ctx == nil || address == "" || serverName == "" || path == "" {
		return 0, nil, errors.New("missing strict PQ request context")
	}
	host, port, err := net.SplitHostPort(address)
	if err != nil || host == "" || port == "" || strings.ContainsAny(address, "/@?#") {
		return 0, nil, errors.New("PQ endpoint must be a direct host:port")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+address+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Accept-Encoding", "identity")
	transport := &http.Transport{
		Proxy: nil,
		DisableKeepAlives: true,
		DisableCompression: true,
		ForceAttemptHTTP2: false,
		DialTLSContext: func(dialCtx context.Context, network, target string) (net.Conn, error) {
			if network != "tcp" || target != address {
				return nil, errors.New("unexpected PQ endpoint / redirect")
			}
			return tlsprobe.DialStrictMutual(dialCtx, address, serverName, roots, clientCertificate)
		},
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport,
		Timeout: 15 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("XSP-v2 historical recovery redirection forbidden")
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	mediaType, _, mediaErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if response.StatusCode == http.StatusOK && (mediaErr != nil || mediaType != "application/json" || response.Header.Get("Content-Encoding") != "") {
		return response.StatusCode, nil, errors.New("unsigned or transformed recovery media type")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 16*1024+1))
	if err != nil {
		return response.StatusCode, nil, err
	}
	if len(raw) > 16*1024 {
		return response.StatusCode, nil, errors.New("recovery response oversized")
	}
	return response.StatusCode, raw, nil
}

func TestC2DFullExchange(t *testing.T) {
	bundle, signedPermit, signedACK, panel, next, want := c2dLoadBundle(t)
	journal := c2dRequired(t, "XSP_C2D_JOURNAL_DIR")
	if err := os.MkdirAll(journal, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(journal, 0o700); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	permit, err := PersistVerifiedPermit(journal, signedPermit, panel, want, now)
	if err != nil {
		recoveredPermit, recoverErr := reloadVerifiedPermitForReceiptRetry(journal, panel, want, next)
		if recoverErr != nil {
			t.Fatalf("permit verification/journal failed: %v", recoverErr)
		}
		recovered, recoverErr := ReloadVerifiedCommitReceiptForJournal(
			journal, panel, recoveredPermit, next, bundle.Expected.ToEpoch, now,
		)
		if recoverErr != nil {
			t.Fatalf("historical durable receipt reload failed: %v", recoverErr)
		}
		if recovered.NodeID != bundle.Expected.NodeID || recovered.ToEpoch != bundle.Expected.ToEpoch || recovered.RequestID != bundle.Expected.RequestID {
			t.Fatalf("historical durable receipt correlation mismatch: %+v", recovered)
		}
		return
	}

	if _, statErr := os.Stat(filepath.Join(journal, commitReceiptJournalName)); errors.Is(statErr, os.ErrNotExist) {
		if _, err := persistVerifiedAppliedACK(journal, signedACK, permit, next, now); err != nil {
			t.Fatalf("ACK verification/journal failed: %v", err)
		}
	} else if statErr != nil {
		t.Fatalf("receipt journal state unavailable: %v", statErr)
	}

	caPEM, err := os.ReadFile(c2dRequired(t, "XSP_C2D_CA_FILE"))
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(caPEM) {
		t.Fatal("invalid Nexus CA")
	}
	clientCertificate, err := tls.LoadX509KeyPair(
		c2dRequired(t, "XSP_C2D_CLIENT_CERT"),
		c2dRequired(t, "XSP_C2D_CLIENT_KEY"),
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	result, err := ExchangeSignedACKForReceipt(
		ctx,
		c2dRequired(t, "XSP_C2D_ADDRESS"),
		c2dRequired(t, "XSP_C2D_SERVER_NAME"),
		roots,
		clientCertificate,
		journal,
		panel,
		permit,
		next,
		bundle.Expected.ToEpoch,
		time.Now().UnixMilli(),
	)
	if err != nil {
		t.Fatalf("strict mutual-PQ ACK/receipt exchange failed: %v", err)
	}
	if result.NodeID != bundle.Expected.NodeID || result.ToEpoch != bundle.Expected.ToEpoch || result.RequestID != bundle.Expected.RequestID {
		t.Fatalf("receipt correlation mismatch: %+v", result)
	}
	reloaded, err := ReloadVerifiedCommitReceiptForJournal(
		journal,
		panel,
		permit,
		next,
		bundle.Expected.ToEpoch,
		time.Now().UnixMilli(),
	)
	if err != nil {
		t.Fatalf("durable receipt reload failed: %v", err)
	}
	if reloaded.NodeID != result.NodeID || reloaded.ToEpoch != result.ToEpoch || reloaded.RequestID != result.RequestID {
		t.Fatal("reloaded receipt differs from verified network receipt")
	}
}

func TestC2DExpiredNetworkRecovery(t *testing.T) {
	bundle, _, signedACK, panel, next, want := c2dLoadBundle(t)
	journal := c2dRequired(t, "XSP_C2D_JOURNAL_DIR")
	now := time.Now().UnixMilli()
	permit, err := reloadVerifiedPermitForReceiptRetry(journal, panel, want, next)
	if err != nil {
		t.Fatalf("historical permit/ACK chain unavailable: %v", err)
	}
	recovered, err := ReloadVerifiedCommitReceiptForJournal(
		journal, panel, permit, next, bundle.Expected.ToEpoch, now,
	)
	if err != nil {
		t.Fatalf("historical durable receipt unavailable: %v", err)
	}
	parsedACK, err := Decode(signedACK)
	if err != nil {
		t.Fatal(err)
	}
	if now <= parsedACK.Message.ExpiresAtMS {
		t.Fatalf("D2 recovery test requires expired ACK: now=%d expires=%d", now, parsedACK.Message.ExpiresAtMS)
	}
	if _, err = VerifyAppliedACK(signedACK, permit, next, parsedACK.Message.IssuedAtMS); err != nil {
		t.Fatalf("historical ACK failed signature/binding re-verification: %v", err)
	}
	receiptRow, err := readCommitReceiptRecord(filepath.Join(journal, commitReceiptJournalName))
	if err != nil {
		t.Fatal(err)
	}
	if recovered.RequestID != receiptRow.RequestID || recovered.ToEpoch != receiptRow.ToEpoch {
		t.Fatal("verified historical receipt differs from durable row")
	}

	caPEM, err := os.ReadFile(c2dRequired(t, "XSP_C2D_CA_FILE"))
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(caPEM) {
		t.Fatal("invalid Nexus CA")
	}
	clientCertificate, err := tls.LoadX509KeyPair(
		c2dRequired(t, "XSP_C2D_CLIENT_CERT"),
		c2dRequired(t, "XSP_C2D_CLIENT_KEY"),
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()
	address := c2dRequired(t, "XSP_C2D_ADDRESS")
	serverName := c2dRequired(t, "XSP_C2D_SERVER_NAME")

	status, _, err := c2dStrictPost(ctx, address, serverName, roots, clientCertificate, signedACKEndpoint, signedACK)
	if err != nil {
		t.Fatalf("strict stale ACK negative request failed unexpectedly: %v", err)
	}
	if status == http.StatusOK {
		t.Fatal("expired ACK was incorrectly accepted as a fresh state-changing command")
	}

	var tampered map[string]any
	if err := json.Unmarshal(signedACK, &tampered); err != nil {
		t.Fatal(err)
	}
	message := tampered["message"].(map[string]any)
	message["requestId"] = fmt.Sprintf("%s-x", bundle.Expected.RequestID)
	tamperedACK, err := json.Marshal(tampered)
	if err != nil {
		t.Fatal(err)
	}
	status, _, err = c2dStrictPost(ctx, address, serverName, roots, clientCertificate, signedACKRecoveryEndpoint, tamperedACK)
	if err != nil {
		t.Fatalf("strict mismatched recovery request failed unexpectedly: %v", err)
	}
	if status == http.StatusOK {
		t.Fatal("mismatched historical ACK recovered a receipt")
	}

	result, err := RecoverSignedACKReceipt(
		ctx,
		address,
		serverName,
		roots,
		clientCertificate,
		journal,
		panel,
		permit,
		next,
		bundle.Expected.ToEpoch,
		time.Now().UnixMilli(),
	)
	if err != nil {
		t.Fatalf("native strict historical receipt recovery failed: %v", err)
	}
	if result.NodeID != recovered.NodeID || result.ToEpoch != recovered.ToEpoch || result.RequestID != recovered.RequestID {
		t.Fatalf("native historical recovery correlation mismatch: %+v", result)
	}
	persistedAfter, err := readCommitReceiptRecord(filepath.Join(journal, commitReceiptJournalName))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(persistedAfter.SignedReceipt, receiptRow.SignedReceipt) {
		t.Fatal("native historical recovery changed authoritative durable receipt bytes")
	}
}
