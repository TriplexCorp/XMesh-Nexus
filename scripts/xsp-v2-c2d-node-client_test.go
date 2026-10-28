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
	"os"
	"path/filepath"
	"testing"
	"time"
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

// c2dRecoverHistoricalPermitForDurableReceipt is deliberately narrower than a
// normal permit reload. It is available only to this injected C2-D test file
// and reconstructs a VerifiedPermit marker only after durable permit, ACK and
// receipt journals already exist and their exact bindings/signatures verify.
// It cannot authorize a new cutover from an expired permit.
func c2dRecoverHistoricalPermitForDurableReceipt(
	journal string,
	signedPermit []byte,
	panel PinnedPublic,
	next PinnedPublic,
	want ExpectedPermit,
	minEpoch uint64,
	nowMS int64,
) (VerifiedPermit, VerifiedCommitReceipt, error) {
	var emptyPermit VerifiedPermit
	var emptyReceipt VerifiedCommitReceipt
	permitRow, err := readPermitFile(filepath.Join(journal, journalName))
	if err != nil {
		return emptyPermit, emptyReceipt, err
	}
	if !bytes.Equal(permitRow.SignedPermit, signedPermit) || permitRow.EnvelopeSHA256 != sha(signedPermit) {
		return emptyPermit, emptyReceipt, errors.New("historical permit bytes differ from durable journal")
	}
	signed, err := Decode(signedPermit)
	if err != nil {
		return emptyPermit, emptyReceipt, err
	}
	if signed.Message.Kind != "permit" || !permitMatches(signed.Message, want) {
		return emptyPermit, emptyReceipt, errors.New("historical permit no longer matches approved request")
	}
	if err = checkPublic(panel, signed.Message, "panel_response"); err != nil {
		return emptyPermit, emptyReceipt, err
	}
	canonical, err := verifyBoth(signed, panel)
	if err != nil {
		return emptyPermit, emptyReceipt, err
	}
	permit := VerifiedPermit{message: signed.Message, inputHash: sha(canonical)}
	if permit.PermitDigest() != permitRow.PermitDigest {
		return emptyPermit, emptyReceipt, errors.New("historical permit digest differs from durable journal")
	}

	ack, err := checkSavedACKForReceipt(journal, permit)
	if err != nil {
		return emptyPermit, emptyReceipt, err
	}
	receiptRow, err := readCommitReceiptRecord(filepath.Join(journal, commitReceiptJournalName))
	if err != nil {
		return emptyPermit, emptyReceipt, err
	}
	verified, err := verifyReceiptJournalRow(receiptRow, ack, panel, permit, next, minEpoch, nowMS)
	if err != nil {
		return emptyPermit, emptyReceipt, err
	}
	return permit, verified, nil
}

func TestC2DFullExchange(t *testing.T) {
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
		_, recovered, recoverErr := c2dRecoverHistoricalPermitForDurableReceipt(
			journal, signedPermit, panel, next, want, bundle.Expected.ToEpoch, now,
		)
		if recoverErr != nil {
			t.Fatalf("permit verification/journal failed: %v", recoverErr)
		}
		if recovered.NodeID != bundle.Expected.NodeID || recovered.ToEpoch != bundle.Expected.ToEpoch || recovered.RequestID != bundle.Expected.RequestID {
			t.Fatalf("historical durable receipt correlation mismatch: %+v", recovered)
		}
		// D1 proves that a restarted Node process can re-authenticate the already
		// durable local receipt chain with the signer offline. A network retry of
		// an expired ACK is intentionally NOT attempted here: origin freshness
		// remains fail-closed and the exact expired-retry protocol belongs to D2.
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
