//go:build linux

package recovery

import (
	"context"
	"crypto/ed25519"
	"crypto/mldsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"testing"
	"time"

	"github.com/TriplexCorp/XMesh-Node/agent/xspv2/state"
	cutover "github.com/TriplexCorp/XMesh-Node/security/xspv2/poc-go/cutover"
	"github.com/TriplexCorp/XMesh-Node/security/xspv2/poc-go/keyring"
)

const p0e3aNodeID = int64(812345678901)

type p0e3aPin struct {
	IssuerID    string `json:"issuerId"`
	NodeID      uint64 `json:"nodeId"`
	Purpose     string `json:"purpose"`
	EdKeyID     string `json:"edKeyId"`
	PQKeyID     string `json:"pqKeyId"`
	EdPublicB64 string `json:"edPublicB64"`
	PQPublicB64 string `json:"pqPublicB64"`
}

type p0e3aExpected struct {
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

type p0e3aBundle struct {
	SignedPermitB64 string         `json:"signedPermitB64"`
	Panel           p0e3aPin       `json:"panel"`
	Next            p0e3aPin       `json:"next"`
	Expected        p0e3aExpected  `json:"expected"`
}

type agentPublic struct {
	KeyEpoch   uint64 `json:"keyEpoch"`
	EdKeyID    string `json:"edKeyId"`
	PQKeyID    string `json:"pqKeyId"`
	EdPublicB64 string `json:"edPublicB64"`
	PQPublicB64 string `json:"pqPublicB64"`
}

type agentPublicFile struct {
	NodeID uint64      `json:"nodeId"`
	Old    agentPublic `json:"old"`
	Next   agentPublic `json:"next"`
}

type ownerPinFile struct {
	OwnerID  string `json:"ownerId"`
	Purpose  string `json:"purpose"`
	EdKeyID  string `json:"edKeyId"`
	PQKeyID  string `json:"pqKeyId"`
	EdPublic string `json:"edPublicB64"`
	PQPublic string `json:"pqPublicB64"`
}

func envRequired(t *testing.T, name string) string {
	t.Helper()
	value := os.Getenv(name)
	if value == "" {
		t.Fatalf("%s is required", name)
	}
	return value
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func pinValue(t *testing.T, raw p0e3aPin) cutover.PinnedPublic {
	t.Helper()
	ed, err := base64.StdEncoding.Strict().DecodeString(raw.EdPublicB64)
	if err != nil {
		t.Fatal(err)
	}
	pq, err := base64.StdEncoding.Strict().DecodeString(raw.PQPublicB64)
	if err != nil {
		t.Fatal(err)
	}
	return cutover.PinnedPublic{
		IssuerID: raw.IssuerID,
		Purpose: raw.Purpose,
		NodeID: raw.NodeID,
		EdKeyID: raw.EdKeyID,
		PQKeyID: raw.PQKeyID,
		EdPublic: ed,
		PQPublic: pq,
	}
}

func loadBundle(t *testing.T) (p0e3aBundle, []byte, cutover.PinnedPublic, cutover.PinnedPublic, cutover.ExpectedPermit) {
	t.Helper()
	raw, err := os.ReadFile(envRequired(t, "XSP_P0E3A_BUNDLE"))
	if err != nil {
		t.Fatal(err)
	}
	var bundle p0e3aBundle
	if err = json.Unmarshal(raw, &bundle); err != nil {
		t.Fatal(err)
	}
	permitRaw, err := base64.StdEncoding.Strict().DecodeString(bundle.SignedPermitB64)
	if err != nil {
		t.Fatal(err)
	}
	want := cutover.ExpectedPermit{
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
	return bundle, permitRaw, pinValue(t, bundle.Panel), pinValue(t, bundle.Next), want
}

func layoutFor(t *testing.T) state.Layout {
	t.Helper()
	layout, err := state.Prepare(envRequired(t, "XSP_P0E3A_AGENT_ROOT"))
	if err != nil {
		t.Fatal(err)
	}
	return layout
}

func publicJSON(pub keyring.PublicBundle) agentPublic {
	return agentPublic{
		KeyEpoch: pub.KeyEpoch,
		EdKeyID: pub.EdKeyID,
		PQKeyID: pub.PQKeyID,
		EdPublicB64: base64.StdEncoding.EncodeToString(pub.EdPublic),
		PQPublicB64: base64.StdEncoding.EncodeToString(pub.PQPublic),
	}
}

func copyTree(t *testing.T, src, dst string) {
	t.Helper()
	if _, err := os.Stat(dst); err == nil {
		t.Fatalf("snapshot destination already exists: %s", dst)
	} else if !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	if err := filepath.WalkDir(src, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("security-state snapshot contains symlink")
		}
		if entry.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm())
		}
		if !info.Mode().IsRegular() {
			return errors.New("security-state snapshot contains non-regular file")
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, raw, info.Mode().Perm())
	}); err != nil {
		t.Fatal(err)
	}
}

func treeDigest(t *testing.T, root string) string {
	t.Helper()
	var paths []string
	if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("security state contains symlink")
		}
		paths = append(paths, path)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	sort.Strings(paths)
	h := sha256.New()
	for _, path := range paths {
		rel, _ := filepath.Rel(root, path)
		info, err := os.Lstat(path)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(h, "%s\x00%o\x00", rel, info.Mode().Perm())
		h.Write(raw)
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func phasePrepare(t *testing.T) {
	layout := layoutFor(t)
	if err := keyring.CreateMasterKey(layout.MasterKey); err != nil {
		t.Fatal(err)
	}
	old, err := keyring.Initialize(layout.Vault, layout.MasterKey, p0e3aNodeID, "node_request")
	if err != nil {
		t.Fatal(err)
	}
	next, err := keyring.PrepareRotation(layout.Vault, layout.MasterKey, old.KeyEpoch)
	if err != nil {
		t.Fatal(err)
	}
	writeJSON(t, envRequired(t, "XSP_P0E3A_AGENT_PUBLIC"), agentPublicFile{
		NodeID: uint64(old.NodeID), Old: publicJSON(old), Next: publicJSON(next),
	})
}

func phaseJournalAndSnapshot(t *testing.T) {
	_, permitRaw, panel, _, want := loadBundle(t)
	layout := layoutFor(t)
	if _, err := cutover.PersistVerifiedPermit(layout.Journal, permitRaw, panel, want, time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	before, err := state.DescribeCurrent(layout)
	if err != nil {
		t.Fatal(err)
	}
	if before.KeyEpoch != want.FromEpoch || before.PreviousRetained {
		t.Fatalf("pre-ACK Agent state is not the expected old active epoch: %+v", before)
	}
	copyTree(t, layout.Root, envRequired(t, "XSP_P0E3A_AGENT_SNAPSHOT"))
}

func signedACKFromVault(t *testing.T, layout state.Layout, permit cutover.VerifiedPermit, next cutover.PinnedPublic) []byte {
	t.Helper()
	p := permit.Message()
	now := time.Now().UnixMilli()
	ack := cutover.Message{
		Kind: "ack",
		IssuerID: fmt.Sprintf("node-%d", p.NodeID),
		SignerEdKeyID: p.ToEdKeyID,
		SignerPQKeyID: p.ToPQKeyID,
		NodeID: p.NodeID,
		FromEpoch: p.FromEpoch,
		ToEpoch: p.ToEpoch,
		RequestID: p.RequestID,
		FromEdKeyID: p.FromEdKeyID,
		FromPQKeyID: p.FromPQKeyID,
		ToEdKeyID: p.ToEdKeyID,
		ToPQKeyID: p.ToPQKeyID,
		Method: "POST",
		Path: "/api/v2/node/keys/rotation/ack",
		IssuedAtMS: now,
		ExpiresAtMS: now + 50_000,
		PermitNonceHex: p.PermitNonceHex,
		NonceHex: "82" + p.PermitNonceHex[2:],
		CandidateSHA256Hex: p.CandidateSHA256Hex,
		PermitSHA256Hex: permit.PermitDigest(),
	}
	var err error
	ack.AppliedStateSHA256Hex, err = cutover.StateDigest(ack)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := cutover.Canonical(ack)
	if err != nil {
		t.Fatal(err)
	}
	keys, active, err := keyring.Open(layout.Vault, layout.MasterKey)
	if err != nil {
		t.Fatal(err)
	}
	if active.EdKeyID != next.EdKeyID || active.PQKeyID != next.PQKeyID {
		t.Fatal("active durable vault differs from approved ACK signer")
	}
	edSig, pqSig, err := keys.Sign(canonical)
	if err != nil {
		t.Fatal(err)
	}
	signed := cutover.SignedMessage{
		Message: ack,
		Signatures: cutover.Signatures{
			Ed25519: base64.StdEncoding.EncodeToString(edSig),
			MLDSA65: base64.StdEncoding.EncodeToString(pqSig),
		},
	}
	raw, err := json.Marshal(signed)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func ownerPin(t *testing.T) (ed25519.PrivateKey, *mldsa.PrivateKey, OwnerPublic, ownerPinFile) {
	t.Helper()
	edPublic, edPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pqPrivate, err := mldsa.GenerateKey(mldsa.MLDSA65())
	if err != nil {
		t.Fatal(err)
	}
	pqPublic := pqPrivate.PublicKey().Bytes()
	pin := OwnerPublic{
		OwnerID: "p0e3a-offhost-owner",
		Purpose: "owner_recovery",
		EdKeyID: keyID("ed-", edPublic),
		PQKeyID: keyID("pq-", pqPublic),
		EdPublic: edPublic,
		PQPublic: pqPublic,
	}
	file := ownerPinFile{
		OwnerID: pin.OwnerID,
		Purpose: pin.Purpose,
		EdKeyID: pin.EdKeyID,
		PQKeyID: pin.PQKeyID,
		EdPublic: base64.StdEncoding.EncodeToString(pin.EdPublic),
		PQPublic: base64.StdEncoding.EncodeToString(pin.PQPublic),
	}
	return edPrivate, pqPrivate, pin, file
}

func phaseCommitAndCheckpoint(t *testing.T) {
	bundle, permitRaw, panel, next, want := loadBundle(t)
	layout := layoutFor(t)
	permit, err := cutover.PersistVerifiedPermit(layout.Journal, permitRaw, panel, want, time.Now().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = keyring.ActivatePreparedRotation(
		layout.Vault, layout.MasterKey, want.FromEpoch, want.ToEdKeyID, want.ToPQKeyID,
	); err != nil {
		t.Fatal(err)
	}
	signedACK := signedACKFromVault(t, layout, permit, next)
	if _, err = cutover.PersistACKForCommittedVault(
		layout.Journal, layout.Vault, layout.MasterKey, signedACK, permit, next, time.Now().UnixMilli(),
	); err != nil {
		t.Fatal(err)
	}
	caPEM, err := os.ReadFile(envRequired(t, "XSP_P0E3A_CA_FILE"))
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(caPEM) {
		t.Fatal("invalid Nexus CA")
	}
	clientCert, err := tls.LoadX509KeyPair(
		envRequired(t, "XSP_P0E3A_CLIENT_CERT"), envRequired(t, "XSP_P0E3A_CLIENT_KEY"),
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if _, err = cutover.ExchangeSignedACKForReceipt(
		ctx,
		envRequired(t, "XSP_P0E3A_ADDRESS"),
		envRequired(t, "XSP_P0E3A_SERVER_NAME"),
		roots,
		clientCert,
		layout.Journal,
		panel,
		permit,
		next,
		want.ToEpoch,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("strict mutual-PQ Agent ACK/receipt exchange failed: %v", err)
	}
	envelope, err := cutover.ReloadVerifiedCommitReceiptEnvelopeForJournal(
		layout.Journal, panel, permit, next, want.ToEpoch, time.Now().UnixMilli(),
	)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := state.DescribeCurrent(layout)
	if err != nil {
		t.Fatal(err)
	}
	receiptDigest := shaHex(envelope.Bytes())
	nexus := NexusState{
		NodeID: uint64(snapshot.NodeID),
		KeyEpoch: snapshot.KeyEpoch,
		RequestID: bundle.Expected.RequestID,
		PermitState: "ack_verified",
		ReceiptSHA256Hex: receiptDigest,
		OutboxCount: 1,
		ReplayNonceCount: 1,
	}
	local, err := EvidenceFromDurableAgent(layout, envRequired(t, "XSP_P0E3A_SERVER_NAME"), envelope, nexus)
	if err != nil {
		t.Fatal(err)
	}
	nexusDigest, err := NexusStateDigest(nexus)
	if err != nil {
		t.Fatal(err)
	}
	edPrivate, pqPrivate, pin, pinFile := ownerPin(t)
	genesis := Checkpoint{
		Generation: 1,
		PreviousCheckpointSHA256Hex: string(make([]byte, 0)),
		NodeID: uint64(snapshot.NodeID),
		ServerAuthority: envRequired(t, "XSP_P0E3A_SERVER_NAME"),
		KeyEpoch: snapshot.KeyEpoch,
		NodeEdKeyID: snapshot.EdKeyID,
		NodePQKeyID: snapshot.PQKeyID,
		CommitRequestID: bundle.Expected.RequestID,
		CommitReceiptSHA256Hex: receiptDigest,
		NexusStateSHA256Hex: nexusDigest,
		IssuedAtMS: time.Now().UnixMilli(),
		OwnerID: pin.OwnerID,
		OwnerEdKeyID: pin.EdKeyID,
		OwnerPQKeyID: pin.PQKeyID,
	}
	genesis.PreviousCheckpointSHA256Hex = fmt.Sprintf("%064x", 0)
	signedGenesis, err := Sign(genesis, edPrivate, pqPrivate)
	if err != nil {
		t.Fatal(err)
	}
	previous, err := CheckpointDigest(genesis)
	if err != nil {
		t.Fatal(err)
	}
	current := genesis
	current.Generation = 2
	current.PreviousCheckpointSHA256Hex = previous
	current.IssuedAtMS++
	signedCurrent, err := Sign(current, edPrivate, pqPrivate)
	if err != nil {
		t.Fatal(err)
	}
	if err = VerifySuccessor(signedGenesis, signedCurrent, pin); err != nil {
		t.Fatal(err)
	}
	if err = VerifyDurableAgentPreflight(signedCurrent, pin, layout, current.ServerAuthority, 2); err != nil {
		t.Fatalf("current Agent failed owner checkpoint preflight: %v", err)
	}
	if err = VerifyLocal(signedCurrent, pin, local, 2); err != nil {
		t.Fatalf("current Agent/Nexus state failed owner checkpoint validation: %v", err)
	}
	if err = VerifyLocal(signedGenesis, pin, local, 2); err == nil {
		t.Fatal("stale off-host checkpoint passed current independent generation floor")
	}
	offhost := envRequired(t, "XSP_P0E3A_OFFHOST_DIR")
	if err = os.MkdirAll(offhost, 0o700); err != nil {
		t.Fatal(err)
	}
	writeJSON(t, filepath.Join(offhost, "owner-pin.json"), pinFile)
	writeJSON(t, filepath.Join(offhost, "checkpoint-gen1.json"), signedGenesis)
	writeJSON(t, filepath.Join(offhost, "checkpoint-current.json"), signedCurrent)
	if err = os.WriteFile(filepath.Join(offhost, "generation-floor"), []byte("2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func loadOwnerPin(t *testing.T, path string) OwnerPublic {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var file ownerPinFile
	if err = json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	ed, err := base64.StdEncoding.Strict().DecodeString(file.EdPublic)
	if err != nil {
		t.Fatal(err)
	}
	pq, err := base64.StdEncoding.Strict().DecodeString(file.PQPublic)
	if err != nil {
		t.Fatal(err)
	}
	return OwnerPublic{
		OwnerID: file.OwnerID, Purpose: file.Purpose,
		EdKeyID: file.EdKeyID, PQKeyID: file.PQKeyID,
		EdPublic: ed, PQPublic: pq,
	}
}

func phaseVerifyRollback(t *testing.T) {
	offhost := envRequired(t, "XSP_P0E3A_OFFHOST_DIR")
	checkpointRaw, err := os.ReadFile(filepath.Join(offhost, "checkpoint-current.json"))
	if err != nil {
		t.Fatal(err)
	}
	signed, err := Decode(checkpointRaw)
	if err != nil {
		t.Fatal(err)
	}
	pin := loadOwnerPin(t, filepath.Join(offhost, "owner-pin.json"))
	floorRaw, err := os.ReadFile(filepath.Join(offhost, "generation-floor"))
	if err != nil {
		t.Fatal(err)
	}
	floor, err := strconv.ParseUint(string([]byte{floorRaw[0]}), 10, 64)
	if err != nil || floor != 2 {
		t.Fatalf("invalid independent off-host floor: %q", floorRaw)
	}
	if err = VerifySignature(signed, pin); err != nil {
		t.Fatalf("current off-host checkpoint no longer authenticates: %v", err)
	}
	layout := layoutFor(t)
	before := treeDigest(t, layout.Root)
	if err = VerifyDurableAgentPreflight(
		signed, pin, layout, envRequired(t, "XSP_P0E3A_SERVER_NAME"), floor,
	); err == nil {
		t.Fatal("coordinated restored Agent passed newer owner/off-host checkpoint preflight")
	}
	after := treeDigest(t, layout.Root)
	if before != after {
		t.Fatal("failed owner checkpoint preflight mutated restored Agent security state")
	}
	snapshot, describeErr := state.DescribeCurrent(layout)
	if describeErr != nil {
		t.Fatal(describeErr)
	}
	if snapshot.KeyEpoch >= signed.Checkpoint.KeyEpoch {
		t.Fatalf("restored Agent was not actually older: restored=%d checkpoint=%d", snapshot.KeyEpoch, signed.Checkpoint.KeyEpoch)
	}
}

func TestP0E3ACoordinatedRollbackPhases(t *testing.T) {
	switch envRequired(t, "XSP_P0E3A_PHASE") {
	case "prepare-agent":
		phasePrepare(t)
	case "journal-and-snapshot":
		phaseJournalAndSnapshot(t)
	case "commit-and-checkpoint":
		phaseCommitAndCheckpoint(t)
	case "verify-rollback":
		phaseVerifyRollback(t)
	default:
		t.Fatal("unknown P0-E3a phase")
	}
}
