//go:build linux

package cutover

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestP0E2BPostgresSnapshotRollbackCurrentAgentWitness is executed only by the
// disposable P0-E2b harness. The Agent journal is deliberately NOT rolled back
// while PostgreSQL is restored to the exact pre-ACK snapshot. A current Agent
// must never silently replace its first verified authoritative receipt with a
// second valid-but-different receipt emitted by the restored control plane.
func TestP0E2BPostgresSnapshotRollbackCurrentAgentWitness(t *testing.T) {
	bundle, _, signedACK, panel, next, want := c2dLoadBundle(t)
	journal := c2dRequired(t, "XSP_C2D_JOURNAL_DIR")
	permit, err := reloadVerifiedPermitForReceiptRetry(journal, panel, want, next)
	if err != nil {
		t.Fatalf("current Agent permit/ACK chain unavailable after DB rollback: %v", err)
	}
	beforePath := filepath.Join(journal, commitReceiptJournalName)
	before, err := readCommitReceiptRecord(beforePath)
	if err != nil {
		t.Fatalf("current Agent authoritative receipt unavailable: %v", err)
	}
	if _, err := ReloadVerifiedCommitReceiptForJournal(
		journal, panel, permit, next, bundle.Expected.ToEpoch, time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("current Agent authoritative receipt failed pre-request verification: %v", err)
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
	status, body, err := c2dStrictPost(
		ctx,
		c2dRequired(t, "XSP_C2D_ADDRESS"),
		c2dRequired(t, "XSP_C2D_SERVER_NAME"),
		roots,
		clientCertificate,
		signedACKEndpoint,
		signedACK,
	)
	if err != nil {
		t.Fatalf("strict ACK retry after real PostgreSQL restore failed at transport: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("restored PostgreSQL did not exercise the receipt-recreation boundary: status=%d body=%s", status, string(body))
	}

	_, persistErr := PersistVerifiedCommitReceiptForJournal(
		journal, body, panel, permit, next, bundle.Expected.ToEpoch, time.Now().UnixMilli(),
	)
	if bytes.Equal(body, before.SignedReceipt) {
		if persistErr != nil {
			t.Fatalf("byte-identical restored receipt was not idempotently accepted: %v", persistErr)
		}
	} else if persistErr == nil {
		t.Fatal("current Agent silently replaced its authoritative receipt with a different valid restored-DB receipt")
	}

	after, err := readCommitReceiptRecord(beforePath)
	if err != nil {
		t.Fatalf("authoritative receipt journal unavailable after restored-DB retry: %v", err)
	}
	if !bytes.Equal(after.SignedReceipt, before.SignedReceipt) {
		t.Fatal("PostgreSQL rollback changed current Agent authoritative receipt bytes")
	}
	if after.RequestID != before.RequestID || after.ToEpoch != before.ToEpoch || after.SignedACKEnvelopeSHA256 != before.SignedACKEnvelopeSHA256 {
		t.Fatal("PostgreSQL rollback changed current Agent receipt correlation evidence")
	}
	if _, err := ReloadVerifiedCommitReceiptForJournal(
		journal, panel, permit, next, bundle.Expected.ToEpoch, time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("original authoritative receipt no longer verifies after restored-DB retry: %v", err)
	}

	if bytes.Equal(body, before.SignedReceipt) {
		t.Log("restored control plane reproduced byte-identical authoritative receipt; Agent converged idempotently")
	} else {
		t.Log("restored control plane produced a different valid receipt; current Agent rejected replacement and retained the first authoritative receipt")
	}
}
