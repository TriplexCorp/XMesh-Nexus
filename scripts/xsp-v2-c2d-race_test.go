//go:build linux

package cutover

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type c2dRaceResult struct {
	status int
	body   []byte
	err    error
}

func c2dStrictClientMaterial(t *testing.T) (*x509.CertPool, tls.Certificate) {
	t.Helper()
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
	return roots, clientCertificate
}

func TestC2DExactDuplicateNetworkRace(t *testing.T) {
	bundle, signedPermit, signedACK, panel, next, want := c2dLoadBundle(t)
	journal := c2dRequired(t, "XSP_C2D_JOURNAL_DIR")
	now := time.Now().UnixMilli()
	_, _, err := c2dRecoverHistoricalPermitForDurableReceipt(
		journal, signedPermit, panel, next, want, bundle.Expected.ToEpoch, now,
	)
	if err != nil {
		t.Fatalf("durable chain unavailable before duplicate race: %v", err)
	}
	parsedACK, err := Decode(signedACK)
	if err != nil {
		t.Fatal(err)
	}
	if now > parsedACK.Message.ExpiresAtMS {
		t.Fatalf("duplicate race requires fresh ACK: now=%d expires=%d", now, parsedACK.Message.ExpiresAtMS)
	}
	receiptRow, err := readCommitReceiptRecord(filepath.Join(journal, commitReceiptJournalName))
	if err != nil {
		t.Fatal(err)
	}
	roots, clientCertificate := c2dStrictClientMaterial(t)
	address := c2dRequired(t, "XSP_C2D_ADDRESS")
	serverName := c2dRequired(t, "XSP_C2D_SERVER_NAME")

	const workers = 8
	results := make(chan c2dRaceResult, workers)
	var group sync.WaitGroup
	group.Add(workers)
	for range workers {
		go func() {
			defer group.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			status, body, requestErr := c2dStrictPost(
				ctx, address, serverName, roots, clientCertificate, signedACKEndpoint, signedACK,
			)
			results <- c2dRaceResult{status: status, body: body, err: requestErr}
		}()
	}
	group.Wait()
	close(results)
	for result := range results {
		if result.err != nil {
			t.Fatalf("exact duplicate race request failed: %v", result.err)
		}
		if result.status != http.StatusOK {
			t.Fatalf("exact duplicate race did not converge: HTTP %d body=%q", result.status, result.body)
		}
		if !bytes.Equal(result.body, receiptRow.SignedReceipt) {
			t.Fatal("exact duplicate race returned non-authoritative receipt bytes")
		}
	}
}

func TestC2DFreshMismatchedRetryRejected(t *testing.T) {
	_, _, signedACK, _, _, _ := c2dLoadBundle(t)
	parsedACK, err := Decode(signedACK)
	if err != nil {
		t.Fatal(err)
	}
	if time.Now().UnixMilli() > parsedACK.Message.ExpiresAtMS {
		t.Fatal("fresh mismatch negative requires unexpired ACK")
	}
	var tampered map[string]any
	if err := json.Unmarshal(signedACK, &tampered); err != nil {
		t.Fatal(err)
	}
	message, ok := tampered["message"].(map[string]any)
	if !ok {
		t.Fatal("signed ACK message shape changed")
	}
	message["candidateSha256Hex"] = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	tamperedACK, err := json.Marshal(tampered)
	if err != nil {
		t.Fatal(err)
	}
	roots, clientCertificate := c2dStrictClientMaterial(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	status, _, err := c2dStrictPost(
		ctx,
		c2dRequired(t, "XSP_C2D_ADDRESS"),
		c2dRequired(t, "XSP_C2D_SERVER_NAME"),
		roots,
		clientCertificate,
		signedACKEndpoint,
		tamperedACK,
	)
	if err != nil {
		t.Fatalf("fresh mismatched retry transport failed unexpectedly: %v", err)
	}
	if status == http.StatusOK {
		t.Fatal("fresh mismatched retry converged to policy success")
	}
}
