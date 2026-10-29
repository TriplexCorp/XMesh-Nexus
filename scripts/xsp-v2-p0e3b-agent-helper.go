//go:build linux

package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/TriplexCorp/XMesh-Node/agent/xspv2/state"
	"github.com/TriplexCorp/XMesh-Node/security/xspv2/poc-go/cutover"
	"github.com/TriplexCorp/XMesh-Node/security/xspv2/poc-go/keyring"
)

const maxJournalBytes = 32 * 1024

type panelPinJSON struct {
	Purpose             string `json:"purpose"`
	IssuerID            string `json:"issuerId"`
	NodeID              uint64 `json:"nodeId"`
	EdKeyID             string `json:"edKeyId"`
	PQKeyID             string `json:"pqKeyId"`
	Ed25519PublicBase64 string `json:"ed25519PublicBase64"`
	MLDSA65PublicBase64 string `json:"mldsa65PublicBase64"`
}

type permitJournal struct {
	Schema         string `json:"schema"`
	SignedPermit   []byte `json:"signedPermit"`
	EnvelopeSHA256 string `json:"envelopeSha256"`
	PermitDigest   string `json:"permitDigest"`
}

type ackJournal struct {
	Schema         string `json:"schema"`
	SignedACK      []byte `json:"signedAck"`
	EnvelopeSHA256 string `json:"envelopeSha256"`
	PermitDigest   string `json:"permitDigest"`
	NodeID         uint64 `json:"nodeId"`
	ToEpoch        uint64 `json:"toEpoch"`
	RequestID      string `json:"requestId"`
}

type receiptJournal struct {
	Schema                  string `json:"schema"`
	SignedReceipt           []byte `json:"signedReceipt"`
	ReceiptEnvelopeSHA256   string `json:"receiptEnvelopeSha256"`
	SignedACKEnvelopeSHA256 string `json:"signedACKEnvelopeSha256"`
	PermitDigest            string `json:"permitDigest"`
	NodeID                  uint64 `json:"nodeId"`
	ToEpoch                 uint64 `json:"toEpoch"`
	RequestID               string `json:"requestId"`
}

type keyView struct {
	NodeID         uint64 `json:"nodeId"`
	Purpose        string `json:"purpose"`
	KeyEpoch       uint64 `json:"keyEpoch"`
	EdKeyID        string `json:"edKeyId"`
	PQKeyID        string `json:"pqKeyId"`
	EdPublicBase64 string `json:"edPublicBase64"`
	PQPublicBase64 string `json:"pqPublicBase64"`
}

type localState struct {
	NodeID                  uint64  `json:"nodeId"`
	KeyEpoch                uint64  `json:"keyEpoch"`
	CurrentReceiptSHA256Hex *string `json:"currentReceiptSha256Hex"`
	EdKeyID                 string  `json:"edKeyId"`
	PQKeyID                 string  `json:"pqKeyId"`
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

func layoutFor(root string) (state.Layout, error) {
	clean := filepath.Clean(root)
	if root == "" || clean != root || !filepath.IsAbs(root) {
		return state.Layout{}, errors.New("Agent root must be a canonical absolute path")
	}
	keys := filepath.Join(root, "keys")
	return state.Layout{
		Root:      root,
		Journal:   filepath.Join(root, "cutover"),
		Keys:      keys,
		Vault:     filepath.Join(keys, "node-request.vault"),
		MasterKey: filepath.Join(keys, "node-request.master"),
	}, nil
}

func readBounded(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > limit {
		return nil, fmt.Errorf("unsafe input file: %s", path)
	}
	return os.ReadFile(path)
}

func decodeStrictBase64(value string, size int, label string) ([]byte, error) {
	raw, err := base64.StdEncoding.Strict().DecodeString(value)
	if err != nil || len(raw) != size || base64.StdEncoding.EncodeToString(raw) != value {
		return nil, fmt.Errorf("invalid canonical %s", label)
	}
	return raw, nil
}

func loadPanelPin(path string) (cutover.PinnedPublic, error) {
	raw, err := readBounded(path, 16*1024)
	if err != nil {
		return cutover.PinnedPublic{}, err
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	var value panelPinJSON
	if err = decoder.Decode(&value); err != nil {
		return cutover.PinnedPublic{}, err
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		return cutover.PinnedPublic{}, errors.New("trailing panel pin JSON")
	}
	ed, err := decodeStrictBase64(value.Ed25519PublicBase64, 32, "Ed25519 public key")
	if err != nil {
		return cutover.PinnedPublic{}, err
	}
	pq, err := decodeStrictBase64(value.MLDSA65PublicBase64, 1952, "ML-DSA-65 public key")
	if err != nil {
		return cutover.PinnedPublic{}, err
	}
	return cutover.PinnedPublic{
		IssuerID: value.IssuerID,
		Purpose:  value.Purpose,
		NodeID:   value.NodeID,
		EdKeyID:  value.EdKeyID,
		PQKeyID:  value.PQKeyID,
		EdPublic: ed,
		PQPublic: pq,
	}, nil
}

func keyViewOf(pub keyring.PublicBundle) (keyView, error) {
	if pub.NodeID <= 0 {
		return keyView{}, errors.New("invalid Node identity")
	}
	return keyView{
		NodeID:         uint64(pub.NodeID),
		Purpose:        pub.Purpose,
		KeyEpoch:       pub.KeyEpoch,
		EdKeyID:        pub.EdKeyID,
		PQKeyID:        pub.PQKeyID,
		EdPublicBase64: base64.StdEncoding.EncodeToString(pub.EdPublic),
		PQPublicBase64: base64.StdEncoding.EncodeToString(pub.PQPublic),
	}, nil
}

func nodePin(pub keyring.PublicBundle) (cutover.PinnedPublic, error) {
	view, err := keyViewOf(pub)
	if err != nil {
		return cutover.PinnedPublic{}, err
	}
	return cutover.PinnedPublic{
		IssuerID: fmt.Sprintf("node-%d", view.NodeID),
		Purpose:  pub.Purpose,
		NodeID:   view.NodeID,
		EdKeyID:  pub.EdKeyID,
		PQKeyID:  pub.PQKeyID,
		EdPublic: append([]byte(nil), pub.EdPublic...),
		PQPublic: append([]byte(nil), pub.PQPublic...),
	}, nil
}

func candidateDigest(prior, next keyring.PublicBundle) (string, error) {
	if prior.NodeID <= 0 || prior.NodeID != next.NodeID {
		return "", errors.New("candidate Node identity mismatch")
	}
	return cutover.CandidateDigest(cutover.CandidateSource{
		NodeID:       uint64(prior.NodeID),
		FromEpoch:    prior.KeyEpoch,
		ToEpoch:      next.KeyEpoch,
		Purpose:      "node_request",
		FromEdKeyID:  prior.EdKeyID,
		FromPQKeyID:  prior.PQKeyID,
		ToEdKeyID:    next.EdKeyID,
		ToPQKeyID:    next.PQKeyID,
		FromEdPublic: prior.EdPublic,
		FromPQPublic: prior.PQPublic,
		ToEdPublic:   next.EdPublic,
		ToPQPublic:   next.PQPublic,
	})
}

func randomHex(size int) (string, error) {
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func shaHex(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func writeJSON(path string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if path == "-" {
		_, err = os.Stdout.Write(append(raw, '\n'))
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o600)
}

func readJSONFile(path string, value any) error {
	raw, err := readBounded(path, maxJournalBytes)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(value); err != nil {
		return err
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		return errors.New("trailing JSON bytes")
	}
	return nil
}

func expectedPermit(prior, next keyring.PublicBundle, message cutover.Message) (cutover.ExpectedPermit, error) {
	digest, err := candidateDigest(prior, next)
	if err != nil {
		return cutover.ExpectedPermit{}, err
	}
	return cutover.ExpectedPermit{
		NodeID:             uint64(prior.NodeID),
		FromEpoch:          prior.KeyEpoch,
		ToEpoch:            next.KeyEpoch,
		RequestID:          message.RequestID,
		FromEdKeyID:        prior.EdKeyID,
		FromPQKeyID:        prior.PQKeyID,
		ToEdKeyID:          next.EdKeyID,
		ToPQKeyID:          next.PQKeyID,
		CandidateSHA256Hex: digest,
	}, nil
}

func commandInit(args []string) error {
	if len(args) != 2 || args[0] != "--root" || args[1] == "" {
		return errors.New("usage: init --root ABSOLUTE_ROOT")
	}
	layout, err := state.Prepare(args[1])
	if err != nil {
		return err
	}
	if err = keyring.CreateMasterKey(layout.MasterKey); err != nil {
		return err
	}
	pub, err := keyring.Initialize(layout.Vault, layout.MasterKey, 812_345_678_901, "node_request")
	if err != nil {
		return err
	}
	view, err := keyViewOf(pub)
	if err != nil {
		return err
	}
	return writeJSON("-", view)
}

func commandPrepare(args []string) error {
	if len(args) != 2 || args[0] != "--root" {
		return errors.New("usage: prepare --root ABSOLUTE_ROOT")
	}
	layout, err := layoutFor(args[1])
	if err != nil {
		return err
	}
	prior, err := keyring.Description(layout.Vault, layout.MasterKey)
	if err != nil {
		return err
	}
	next, err := keyring.PrepareRotation(layout.Vault, layout.MasterKey, prior.KeyEpoch)
	if err != nil {
		return err
	}
	priorView, _ := keyViewOf(prior)
	nextView, _ := keyViewOf(next)
	digest, err := candidateDigest(prior, next)
	if err != nil {
		return err
	}
	return writeJSON("-", map[string]any{"prior": priorView, "next": nextView, "candidateSha256Hex": digest})
}

func commandPermitTemplate(args []string) error {
	if len(args) != 8 || args[0] != "--root" || args[2] != "--pin" || args[4] != "--request-id" || args[6] != "--issued-ms" {
		return errors.New("usage: permit-template --root ROOT --pin PIN --request-id ID --issued-ms MS")
	}
	layout, err := layoutFor(args[1])
	if err != nil {
		return err
	}
	pin, err := loadPanelPin(args[3])
	if err != nil {
		return err
	}
	prior, err := keyring.Description(layout.Vault, layout.MasterKey)
	if err != nil {
		return err
	}
	next, err := keyring.Description(layout.Vault+".next", layout.MasterKey)
	if err != nil {
		return err
	}
	if pin.NodeID != uint64(prior.NodeID) || pin.Purpose != "panel_response" {
		return errors.New("panel pin is not bound to this Node")
	}
	var issued int64
	if _, err = fmt.Sscan(args[7], &issued); err != nil || issued <= 0 {
		return errors.New("invalid issued-ms")
	}
	digest, err := candidateDigest(prior, next)
	if err != nil {
		return err
	}
	nonce, err := randomHex(16)
	if err != nil {
		return err
	}
	message := cutover.Message{
		Kind:                  "permit",
		IssuerID:              pin.IssuerID,
		SignerEdKeyID:         pin.EdKeyID,
		SignerPQKeyID:         pin.PQKeyID,
		NodeID:                uint64(prior.NodeID),
		FromEpoch:             prior.KeyEpoch,
		ToEpoch:               next.KeyEpoch,
		RequestID:             args[5],
		FromEdKeyID:           prior.EdKeyID,
		FromPQKeyID:           prior.PQKeyID,
		ToEdKeyID:             next.EdKeyID,
		ToPQKeyID:             next.PQKeyID,
		Method:                "POST",
		Path:                  "/api/v2/node/keys/rotation/permit",
		IssuedAtMS:            issued,
		ExpiresAtMS:           issued + 60_000,
		PermitNonceHex:        nonce,
		NonceHex:              nonce,
		CandidateSHA256Hex:    digest,
		PermitSHA256Hex:       strings.Repeat("0", 64),
		AppliedStateSHA256Hex: strings.Repeat("0", 64),
	}
	canonical, err := cutover.Canonical(message)
	if err != nil {
		return err
	}
	return writeJSON("-", map[string]any{"message": message, "canonicalBase64": base64.StdEncoding.EncodeToString(canonical)})
}

func signedMessage(raw []byte) (cutover.SignedMessage, error) {
	return cutover.Decode(raw)
}

func commandApply(args []string) error {
	if len(args) != 6 || args[0] != "--root" || args[2] != "--pin" || args[4] != "--permit" {
		return errors.New("usage: apply --root ROOT --pin PIN --permit SIGNED_PERMIT")
	}
	layout, err := layoutFor(args[1])
	if err != nil {
		return err
	}
	pin, err := loadPanelPin(args[3])
	if err != nil {
		return err
	}
	permitRaw, err := readBounded(args[5], 16*1024)
	if err != nil {
		return err
	}
	decoded, err := signedMessage(permitRaw)
	if err != nil {
		return err
	}
	prior, err := keyring.Description(layout.Vault, layout.MasterKey)
	if err != nil {
		return err
	}
	next, err := keyring.Description(layout.Vault+".next", layout.MasterKey)
	if err != nil {
		return err
	}
	want, err := expectedPermit(prior, next, decoded.Message)
	if err != nil {
		return err
	}
	permit, err := cutover.PersistVerifiedPermit(layout.Journal, permitRaw, pin, want, decoded.Message.IssuedAtMS+1)
	if err != nil {
		return err
	}
	active, err := keyring.ActivatePreparedRotation(layout.Vault, layout.MasterKey, prior.KeyEpoch, next.EdKeyID, next.PQKeyID)
	if err != nil {
		return err
	}
	keys, opened, err := keyring.Open(layout.Vault, layout.MasterKey)
	if err != nil {
		return err
	}
	if opened.KeyEpoch != active.KeyEpoch || opened.EdKeyID != active.EdKeyID || opened.PQKeyID != active.PQKeyID {
		return errors.New("activated keyring identity changed before ACK")
	}
	nextPin, err := nodePin(opened)
	if err != nil {
		return err
	}
	ackNonce, err := randomHex(16)
	if err != nil {
		return err
	}
	p := permit.Message()
	ack := cutover.Message{
		Kind:                  "ack",
		IssuerID:              nextPin.IssuerID,
		SignerEdKeyID:         opened.EdKeyID,
		SignerPQKeyID:         opened.PQKeyID,
		NodeID:                p.NodeID,
		FromEpoch:             p.FromEpoch,
		ToEpoch:               p.ToEpoch,
		RequestID:             p.RequestID,
		FromEdKeyID:           p.FromEdKeyID,
		FromPQKeyID:           p.FromPQKeyID,
		ToEdKeyID:             p.ToEdKeyID,
		ToPQKeyID:             p.ToPQKeyID,
		Method:                "POST",
		Path:                  "/api/v2/node/keys/rotation/ack",
		IssuedAtMS:            p.IssuedAtMS + 2_000,
		ExpiresAtMS:           p.IssuedAtMS + 55_000,
		PermitNonceHex:        p.PermitNonceHex,
		NonceHex:              ackNonce,
		CandidateSHA256Hex:    p.CandidateSHA256Hex,
		PermitSHA256Hex:       permit.PermitDigest(),
		AppliedStateSHA256Hex: strings.Repeat("0", 64),
	}
	ack.AppliedStateSHA256Hex, err = cutover.StateDigest(ack)
	if err != nil {
		return err
	}
	canonical, err := cutover.Canonical(ack)
	if err != nil {
		return err
	}
	edSig, pqSig, err := keys.Sign(canonical)
	if err != nil {
		return err
	}
	envelope := cutover.SignedMessage{Message: ack, Signatures: cutover.Signatures{
		Ed25519: base64.StdEncoding.EncodeToString(edSig),
		MLDSA65: base64.StdEncoding.EncodeToString(pqSig),
	}}
	ackRaw, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	if _, err = cutover.PersistACKForCommittedVault(layout.Journal, layout.Vault, layout.MasterKey, ackRaw, permit, nextPin, ack.IssuedAtMS+1); err != nil {
		return err
	}
	view, _ := keyViewOf(opened)
	return writeJSON("-", map[string]any{
		"current":            view,
		"permitDigest":       permit.PermitDigest(),
		"signedAckBase64":    base64.StdEncoding.EncodeToString(ackRaw),
		"signedAckSha256Hex": shaHex(ackRaw),
		"ackNonceHex":        ack.NonceHex,
	})
}

func currentAndPrior(layout state.Layout) (keyring.PublicBundle, keyring.PublicBundle, error) {
	current, err := keyring.Description(layout.Vault, layout.MasterKey)
	if err != nil {
		return keyring.PublicBundle{}, keyring.PublicBundle{}, err
	}
	prior, err := keyring.Description(layout.Vault+".previous", layout.MasterKey)
	if err != nil {
		return keyring.PublicBundle{}, keyring.PublicBundle{}, err
	}
	return current, prior, nil
}

func verifyLocalPermit(layout state.Layout, pin cutover.PinnedPublic, permitRaw []byte) (cutover.VerifiedPermit, keyring.PublicBundle, keyring.PublicBundle, error) {
	current, prior, err := currentAndPrior(layout)
	if err != nil {
		return cutover.VerifiedPermit{}, keyring.PublicBundle{}, keyring.PublicBundle{}, err
	}
	decoded, err := cutover.Decode(permitRaw)
	if err != nil {
		return cutover.VerifiedPermit{}, keyring.PublicBundle{}, keyring.PublicBundle{}, err
	}
	want, err := expectedPermit(prior, current, decoded.Message)
	if err != nil {
		return cutover.VerifiedPermit{}, keyring.PublicBundle{}, keyring.PublicBundle{}, err
	}
	permit, err := cutover.VerifyPermit(permitRaw, pin, want, decoded.Message.IssuedAtMS+1)
	return permit, current, prior, err
}

func commandReceiptTemplate(args []string) error {
	if len(args) != 8 || args[0] != "--root" || args[2] != "--pin" || args[4] != "--permit" || args[6] != "--ack" {
		return errors.New("usage: receipt-template --root ROOT --pin PIN --permit SIGNED_PERMIT --ack SIGNED_ACK")
	}
	layout, err := layoutFor(args[1])
	if err != nil {
		return err
	}
	pin, err := loadPanelPin(args[3])
	if err != nil {
		return err
	}
	permitRaw, err := readBounded(args[5], 16*1024)
	if err != nil {
		return err
	}
	ackRaw, err := readBounded(args[7], 16*1024)
	if err != nil {
		return err
	}
	permit, current, _, err := verifyLocalPermit(layout, pin, permitRaw)
	if err != nil {
		return err
	}
	nextPin, err := nodePin(current)
	if err != nil {
		return err
	}
	ackSigned, err := cutover.Decode(ackRaw)
	if err != nil {
		return err
	}
	ack, err := cutover.VerifyAppliedACK(ackRaw, permit, nextPin, ackSigned.Message.IssuedAtMS+1)
	if err != nil {
		return err
	}
	message := cutover.CommitReceipt{
		Protocol:           "XSP/2",
		Kind:               "commit_receipt",
		IssuerID:           pin.IssuerID,
		SignerEdKeyID:      pin.EdKeyID,
		SignerPQKeyID:      pin.PQKeyID,
		NodeID:             ack.NodeID,
		FromEpoch:          ack.FromEpoch,
		ToEpoch:            ack.ToEpoch,
		RequestID:          ack.RequestID,
		CommittedAtMS:      ack.IssuedAtMS + 500,
		AckNonceHex:        ack.NonceHex,
		CandidateSHA256Hex: ack.CandidateSHA256Hex,
		PermitSHA256Hex:    permit.PermitDigest(),
		SignedACKSHA256Hex: shaHex(ackRaw),
	}
	canonical, err := cutover.CommitReceiptCanonical(message)
	if err != nil {
		return err
	}
	return writeJSON("-", map[string]any{"message": message, "canonicalBase64": base64.StdEncoding.EncodeToString(canonical)})
}

func commandPersistReceipt(args []string) error {
	if len(args) != 10 || args[0] != "--root" || args[2] != "--pin" || args[4] != "--permit" || args[6] != "--ack" || args[8] != "--receipt" {
		return errors.New("usage: persist-receipt --root ROOT --pin PIN --permit P --ack A --receipt R")
	}
	layout, err := layoutFor(args[1])
	if err != nil {
		return err
	}
	pin, err := loadPanelPin(args[3])
	if err != nil {
		return err
	}
	permitRaw, err := readBounded(args[5], 16*1024)
	if err != nil {
		return err
	}
	ackRaw, err := readBounded(args[7], 16*1024)
	if err != nil {
		return err
	}
	receiptRaw, err := readBounded(args[9], 16*1024)
	if err != nil {
		return err
	}
	permit, current, _, err := verifyLocalPermit(layout, pin, permitRaw)
	if err != nil {
		return err
	}
	nextPin, err := nodePin(current)
	if err != nil {
		return err
	}
	ackSigned, err := cutover.Decode(ackRaw)
	if err != nil {
		return err
	}
	if _, err = cutover.VerifyAppliedACK(ackRaw, permit, nextPin, ackSigned.Message.IssuedAtMS+1); err != nil {
		return err
	}
	receiptSigned, err := cutover.DecodeSignedCommitReceipt(receiptRaw)
	if err != nil {
		return err
	}
	verified, err := cutover.PersistVerifiedCommitReceiptForJournal(
		layout.Journal, receiptRaw, pin, permit, nextPin, current.KeyEpoch, receiptSigned.Message.CommittedAtMS+1,
	)
	if err != nil {
		return err
	}
	return writeJSON("-", map[string]any{
		"nodeId":                 verified.NodeID,
		"toEpoch":                verified.ToEpoch,
		"requestId":              verified.RequestID,
		"signedReceiptSha256Hex": shaHex(receiptRaw),
	})
}

func readPermitJournal(layout state.Layout) (permitJournal, error) {
	var row permitJournal
	err := readJSONFile(filepath.Join(layout.Journal, "xsp2-verified-permit.json"), &row)
	if err == nil && row.Schema != "xsp2-verified-permit-journal-1" {
		err = errors.New("wrong permit journal schema")
	}
	return row, err
}

func readACKJournal(layout state.Layout) (ackJournal, error) {
	var row ackJournal
	err := readJSONFile(filepath.Join(layout.Journal, "xsp2-applied-ack.json"), &row)
	if err == nil && row.Schema != "xsp2-applied-ack-journal-1" {
		err = errors.New("wrong ACK journal schema")
	}
	return row, err
}

func readReceiptJournal(layout state.Layout) (receiptJournal, error) {
	var row receiptJournal
	err := readJSONFile(filepath.Join(layout.Journal, "xsp2-verified-commit-receipt.json"), &row)
	if err == nil && row.Schema != "xsp2-verified-commit-receipt-journal-1" {
		err = errors.New("wrong receipt journal schema")
	}
	return row, err
}

func commandDescribe(args []string) error {
	if len(args) != 2 || args[0] != "--root" {
		return errors.New("usage: describe --root ROOT")
	}
	layout, err := layoutFor(args[1])
	if err != nil {
		return err
	}
	snapshot, err := state.DescribeCurrent(layout)
	if err != nil {
		return err
	}
	var receiptDigest *string
	row, err := readReceiptJournal(layout)
	if err == nil {
		digest := shaHex(row.SignedReceipt)
		if digest != row.ReceiptEnvelopeSHA256 {
			return errors.New("receipt journal digest mismatch")
		}
		receiptDigest = &digest
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return writeJSON("-", localState{
		NodeID:                  uint64(snapshot.NodeID),
		KeyEpoch:                snapshot.KeyEpoch,
		CurrentReceiptSHA256Hex: receiptDigest,
		EdKeyID:                 snapshot.EdKeyID,
		PQKeyID:                 snapshot.PQKeyID,
	})
}

func commandValidate(args []string) error {
	if len(args) != 4 || args[0] != "--root" || args[2] != "--pin" {
		return errors.New("usage: validate --root ROOT --pin PIN")
	}
	layout, err := layoutFor(args[1])
	if err != nil {
		return err
	}
	pin, err := loadPanelPin(args[3])
	if err != nil {
		return err
	}
	snapshot, err := state.DescribeCurrent(layout)
	if err != nil {
		return err
	}
	if !snapshot.PreviousRetained || !snapshot.CandidateRetained {
		return errors.New("current recovery state is missing retained old/new Agent identities")
	}
	permitRow, err := readPermitJournal(layout)
	if err != nil {
		return err
	}
	permit, current, _, err := verifyLocalPermit(layout, pin, permitRow.SignedPermit)
	if err != nil {
		return err
	}
	if permit.PermitDigest() != permitRow.PermitDigest || shaHex(permitRow.SignedPermit) != permitRow.EnvelopeSHA256 {
		return errors.New("permit journal cryptographic binding mismatch")
	}
	nextPin, err := nodePin(current)
	if err != nil {
		return err
	}
	ackRow, err := readACKJournal(layout)
	if err != nil {
		return err
	}
	ackSigned, err := cutover.Decode(ackRow.SignedACK)
	if err != nil {
		return err
	}
	ack, err := cutover.VerifyAppliedACK(ackRow.SignedACK, permit, nextPin, ackSigned.Message.IssuedAtMS+1)
	if err != nil {
		return err
	}
	if shaHex(ackRow.SignedACK) != ackRow.EnvelopeSHA256 || ackRow.PermitDigest != permit.PermitDigest() ||
		ackRow.NodeID != ack.NodeID || ackRow.ToEpoch != ack.ToEpoch || ackRow.RequestID != ack.RequestID {
		return errors.New("ACK journal binding mismatch")
	}
	receiptRow, err := readReceiptJournal(layout)
	if err != nil {
		return err
	}
	receiptSigned, err := cutover.DecodeSignedCommitReceipt(receiptRow.SignedReceipt)
	if err != nil {
		return err
	}
	verified, err := cutover.VerifyCommitReceipt(
		receiptRow.SignedReceipt, pin, permit, ackRow.SignedACK, nextPin,
		current.KeyEpoch, receiptSigned.Message.CommittedAtMS+1,
	)
	if err != nil {
		return err
	}
	receiptDigest := shaHex(receiptRow.SignedReceipt)
	if receiptDigest != receiptRow.ReceiptEnvelopeSHA256 ||
		receiptRow.SignedACKEnvelopeSHA256 != ackRow.EnvelopeSHA256 ||
		receiptRow.PermitDigest != permit.PermitDigest() ||
		receiptRow.NodeID != verified.NodeID || receiptRow.ToEpoch != verified.ToEpoch ||
		receiptRow.RequestID != verified.RequestID {
		return errors.New("commit receipt journal binding mismatch")
	}
	return writeJSON("-", localState{
		NodeID:                  uint64(snapshot.NodeID),
		KeyEpoch:                snapshot.KeyEpoch,
		CurrentReceiptSHA256Hex: &receiptDigest,
		EdKeyID:                 snapshot.EdKeyID,
		PQKeyID:                 snapshot.PQKeyID,
	})
}

func main() {
	if len(os.Args) < 2 {
		fail(errors.New("one helper command is required"))
	}
	var err error
	switch os.Args[1] {
	case "init":
		err = commandInit(os.Args[2:])
	case "prepare":
		err = commandPrepare(os.Args[2:])
	case "permit-template":
		err = commandPermitTemplate(os.Args[2:])
	case "apply":
		err = commandApply(os.Args[2:])
	case "receipt-template":
		err = commandReceiptTemplate(os.Args[2:])
	case "persist-receipt":
		err = commandPersistReceipt(os.Args[2:])
	case "describe":
		err = commandDescribe(os.Args[2:])
	case "validate":
		err = commandValidate(os.Args[2:])
	default:
		err = fmt.Errorf("unknown helper command: %s", os.Args[1])
	}
	if err != nil {
		fail(err)
	}
}
