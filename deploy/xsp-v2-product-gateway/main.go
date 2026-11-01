package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/mldsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maxEnvelopeBytes       = 1024 * 1024
	maxPayloadBytes        = 768 * 1024
	suite                  = "Ed25519+ML-DSA-65"
	issuerID               = "xmesh-nexus-panel"
	targetAgentVersion     = "control-v6.0.4"
	previousAgentVersion   = "control-v6.0.3"
	repairAgentVersion     = "control-v6.0.0"
)

var b64 = base64.StdEncoding

type releaseIdentity struct {
	Version        string `json:"version"`
	SourceRevision string `json:"sourceRevision"`
	ArtifactSHA256 string `json:"artifactSha256"`
}

type enrollRequest struct {
	Token               string          `json:"token"`
	NodeID              int64           `json:"nodeId"`
	Purpose             string          `json:"purpose"`
	KeyEpoch            int64           `json:"keyEpoch"`
	ChallengeHex        string          `json:"challengeHex"`
	Ed25519KeyID        string          `json:"ed25519KeyId"`
	MLDSA65KeyID        string          `json:"mldsa65KeyId"`
	Ed25519PublicB64    string          `json:"ed25519PublicB64"`
	MLDSA65PublicB64    string          `json:"mldsa65PublicB64"`
	Ed25519SignatureB64 string          `json:"ed25519SignatureB64"`
	MLDSA65SignatureB64 string          `json:"mldsa65SignatureB64"`
	TLSPublicKeyB64     string          `json:"tlsPublicKeyB64"`
	ReleaseIdentity     releaseIdentity `json:"releaseIdentity"`
}

type signatures struct {
	Ed25519 string `json:"ed25519"`
	MLDSA65 string `json:"mldsa65"`
}

type envelope struct {
	Protocol     string     `json:"protocol"`
	Suite        string     `json:"suite"`
	Direction    uint8      `json:"direction"`
	MessageType  string     `json:"messageType"`
	IssuerID     string     `json:"issuerId"`
	NodeID       int64      `json:"nodeId"`
	Method       string     `json:"method"`
	Path         string     `json:"path"`
	Ed25519KeyID string     `json:"ed25519KeyId"`
	MLDSA65KeyID string     `json:"mldsa65KeyId"`
	KeyEpoch     int64      `json:"keyEpoch"`
	IssuedAtMS   int64      `json:"issuedAtMs"`
	ExpiresAtMS  int64      `json:"expiresAtMs"`
	NonceHex     string     `json:"nonceHex"`
	RequestID    string     `json:"requestId"`
	Revision     string     `json:"revision"`
	PayloadB64   string     `json:"payloadB64"`
	Signatures   signatures `json:"signatures"`
}

type parsedEnvelope struct {
	Env          envelope
	Payload      []byte
	SigningInput []byte
	EdSig        []byte
	PQSig        []byte
	Raw          []byte
}

type tunnelPayload struct {
	Path    string `json:"path"`
	BodyB64 string `json:"bodyB64"`
}

type nodeIdentity struct {
	State               string
	KeyEpoch            int64
	EdKeyID             string
	PQKeyID             string
	EdPublic            []byte
	PQPublic            []byte
	TLSSPKI             []byte
	ReleaseRev          string
	Receipt             []byte
	ActivationRequestID string
}

type gateway struct {
	db            *pgxpool.Pool
	panelEd       ed25519.PrivateKey
	panelPQ       *mldsa.PrivateKey
	panelEdID     string
	panelPQID     string
	panelPin      map[string]any
	clientCA      *x509.Certificate
	clientCAKey   *mldsa.PrivateKey
	serverCAPEM   string
	publicAddress string
	serverName    string
	panelURL      string
	internalToken string
	httpClient    *http.Client
}

func fail(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func readStrictJSON(r *http.Request, dst any, limit int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil || len(body) == 0 || int64(len(body)) > limit {
		return nil, errors.New("invalid request size")
	}
	if err := checkUniqueJSONKeys(body); err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return nil, err
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return nil, errors.New("trailing JSON data")
	}
	return body, nil
}

func checkUniqueJSONKeys(raw []byte) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	nodes := 0
	var walk func(int) error
	walk = func(depth int) error {
		nodes++
		if nodes > 512 || depth > 16 {
			return errors.New("JSON complexity limit")
		}
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		delim, ok := tok.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for dec.More() {
				keyTok, err := dec.Token()
				if err != nil {
					return err
				}
				key, ok := keyTok.(string)
				if !ok || seen[key] {
					return errors.New("duplicate or invalid JSON key")
				}
				seen[key] = true
				if err := walk(depth + 1); err != nil {
					return err
				}
			}
			end, err := dec.Token()
			if err != nil || end != json.Delim('}') {
				return errors.New("unbalanced JSON object")
			}
		case '[':
			for dec.More() {
				if err := walk(depth + 1); err != nil {
					return err
				}
			}
			end, err := dec.Token()
			if err != nil || end != json.Delim(']') {
				return errors.New("unbalanced JSON array")
			}
		default:
			return errors.New("unexpected JSON delimiter")
		}
		return nil
	}
	if err := walk(0); err != nil {
		return err
	}
	if _, err := dec.Token(); err != io.EOF {
		return errors.New("trailing JSON data")
	}
	return nil
}

func decodeCanonicalB64(value string, exact, max int) ([]byte, error) {
	decoded, err := b64.Strict().DecodeString(value)
	if err != nil || b64.EncodeToString(decoded) != value || len(decoded) > max {
		return nil, errors.New("noncanonical base64")
	}
	if exact >= 0 && len(decoded) != exact {
		return nil, errors.New("bad base64 length")
	}
	return decoded, nil
}

func fingerprint(prefix string, raw []byte) string {
	sum := sha256.Sum256(raw)
	return prefix + hex.EncodeToString(sum[:12])
}

func ascii(out *bytes.Buffer, value string, max int, optional bool) error {
	if len(value) > max || (!optional && value == "") {
		return errors.New("metadata length")
	}
	for i := range len(value) {
		if value[i] < 0x21 || value[i] > 0x7e {
			return errors.New("non-ASCII metadata")
		}
	}
	var n [4]byte
	binary.BigEndian.PutUint32(n[:], uint32(len(value)))
	out.Write(n[:])
	out.WriteString(value)
	return nil
}

func putU64(out *bytes.Buffer, value uint64) {
	var n [8]byte
	binary.BigEndian.PutUint64(n[:], value)
	out.Write(n[:])
}

func signingInput(env envelope, payload []byte) ([]byte, error) {
	if env.Protocol != "XSP/2" || env.Suite != suite || env.NodeID <= 0 || env.KeyEpoch <= 0 ||
		env.Method != "POST" || env.IssuedAtMS <= 0 || env.ExpiresAtMS <= env.IssuedAtMS ||
		env.ExpiresAtMS-env.IssuedAtMS > 300000 {
		return nil, errors.New("invalid envelope metadata")
	}
	if len(env.NonceHex) != 32 || strings.ToLower(env.NonceHex) != env.NonceHex {
		return nil, errors.New("invalid envelope nonce")
	}
	nonce, err := hex.DecodeString(env.NonceHex)
	if err != nil || len(nonce) != 16 {
		return nil, errors.New("invalid envelope nonce")
	}
	out := bytes.NewBuffer(make([]byte, 0, 384))
	out.WriteString("XSP2-SIGNED-MESSAGE")
	out.WriteByte(0)
	out.Write([]byte{2, 1, env.Direction})
	for _, field := range []struct {
		value    string
		max      int
		optional bool
	}{{env.MessageType, 64, false}, {env.IssuerID, 64, false}} {
		if err := ascii(out, field.value, field.max, field.optional); err != nil {
			return nil, err
		}
	}
	putU64(out, uint64(env.NodeID))
	for _, field := range []struct {
		value    string
		max      int
		optional bool
	}{{env.Method, 8, false}, {env.Path, 256, false}, {env.Ed25519KeyID, 64, false}, {env.MLDSA65KeyID, 64, false}} {
		if err := ascii(out, field.value, field.max, field.optional); err != nil {
			return nil, err
		}
	}
	putU64(out, uint64(env.KeyEpoch))
	putU64(out, uint64(env.IssuedAtMS))
	putU64(out, uint64(env.ExpiresAtMS))
	out.Write(nonce)
	if err := ascii(out, env.RequestID, 64, false); err != nil {
		return nil, err
	}
	if err := ascii(out, env.Revision, 128, true); err != nil {
		return nil, err
	}
	digest := sha256.Sum256(payload)
	out.Write(digest[:])
	return out.Bytes(), nil
}

func parseEnvelope(raw []byte, messageType, path string, direction uint8) (parsedEnvelope, error) {
	var zero parsedEnvelope
	if len(raw) == 0 || len(raw) > maxEnvelopeBytes {
		return zero, errors.New("envelope size")
	}
	if err := checkUniqueJSONKeys(raw); err != nil {
		return zero, err
	}
	var env envelope
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&env); err != nil {
		return zero, err
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return zero, errors.New("trailing envelope data")
	}
	if env.MessageType != messageType || env.Path != path || env.Direction != direction || env.Method != "POST" {
		return zero, errors.New("envelope endpoint binding")
	}
	payload, err := decodeCanonicalB64(env.PayloadB64, -1, maxPayloadBytes)
	if err != nil {
		return zero, err
	}
	edSig, err := decodeCanonicalB64(env.Signatures.Ed25519, ed25519.SignatureSize, ed25519.SignatureSize)
	if err != nil {
		return zero, err
	}
	pqSig, err := decodeCanonicalB64(env.Signatures.MLDSA65, mldsa.MLDSA65SignatureSize, mldsa.MLDSA65SignatureSize)
	if err != nil {
		return zero, err
	}
	input, err := signingInput(env, payload)
	if err != nil {
		return zero, err
	}
	return parsedEnvelope{Env: env, Payload: payload, SigningInput: input, EdSig: edSig, PQSig: pqSig, Raw: append([]byte(nil), raw...)}, nil
}

func enrollmentChallenge(token string, nodeID int64) ([]byte, error) {
	if len(token) != 64 || strings.ToLower(token) != token {
		return nil, errors.New("invalid enrollment token")
	}
	tokenBytes, err := hex.DecodeString(token)
	if err != nil || len(tokenBytes) != 32 {
		return nil, errors.New("invalid enrollment token")
	}
	h := sha256.New()
	h.Write([]byte("XSP2-PRODUCT-ENROLL-V1"))
	h.Write([]byte{0})
	h.Write(tokenBytes)
	var id [8]byte
	binary.BigEndian.PutUint64(id[:], uint64(nodeID))
	h.Write(id[:])
	return h.Sum(nil), nil
}

func proofInput(req enrollRequest, edPub, pqPub, challenge []byte) ([]byte, error) {
	if req.NodeID <= 0 || req.Purpose != "node_request" || req.KeyEpoch != 1 || len(challenge) != 32 ||
		len(edPub) != ed25519.PublicKeySize || len(pqPub) != mldsa.MLDSA65PublicKeySize ||
		req.Ed25519KeyID != fingerprint("ed-", edPub) || req.MLDSA65KeyID != fingerprint("pq-", pqPub) {
		return nil, errors.New("invalid enrollment subject")
	}
	out := bytes.NewBuffer(make([]byte, 0, 2200))
	out.WriteString("XSP2-KEY-ENROLL-V1")
	out.WriteByte(0)
	putU64(out, uint64(req.NodeID))
	putU64(out, uint64(req.KeyEpoch))
	if err := ascii(out, req.Purpose, 32, false); err != nil {
		return nil, err
	}
	out.Write(challenge)
	out.Write(edPub)
	out.Write(pqPub)
	if err := ascii(out, req.Ed25519KeyID, 64, false); err != nil {
		return nil, err
	}
	if err := ascii(out, req.MLDSA65KeyID, 64, false); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func parsePrivateKey(path string) (any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, rest := pem.Decode(raw)
	if block == nil || len(bytes.TrimSpace(rest)) != 0 {
		return nil, errors.New("invalid private-key PEM")
	}
	return x509.ParsePKCS8PrivateKey(block.Bytes)
}

func parseCertificate(path string) (*x509.Certificate, string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, "", err
	}
	block, rest := pem.Decode(raw)
	if block == nil || block.Type != "CERTIFICATE" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, "", errors.New("invalid certificate PEM")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	return cert, string(raw), err
}

func newGateway(ctx context.Context) (*gateway, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil, errors.New("DATABASE_URL required")
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}
	edAny, err := parsePrivateKey("/run/xmesh-signer-keys/panel-ed25519.pem")
	if err != nil {
		return nil, err
	}
	ed, ok := edAny.(ed25519.PrivateKey)
	if !ok || len(ed) != ed25519.PrivateKeySize {
		return nil, errors.New("panel Ed25519 key type")
	}
	pqAny, err := parsePrivateKey("/run/xmesh-signer-keys/panel-mldsa65.pem")
	if err != nil {
		return nil, err
	}
	pq, ok := pqAny.(*mldsa.PrivateKey)
	if !ok {
		return nil, errors.New("panel ML-DSA-65 key type")
	}
	caAny, err := parsePrivateKey("/run/xmesh-ingress-certs/client-ca-key.pem")
	if err != nil {
		return nil, err
	}
	caKey, ok := caAny.(*mldsa.PrivateKey)
	if !ok {
		return nil, errors.New("client CA ML-DSA-65 key type")
	}
	caCert, _, err := parseCertificate("/run/xmesh-ingress-certs/client-ca.pem")
	if err != nil {
		return nil, err
	}
	_, serverCAPEM, err := parseCertificate("/run/xmesh-ingress-certs/server-ca.pem")
	if err != nil {
		return nil, err
	}
	edPub := ed.Public().(ed25519.PublicKey)
	pqPub := pq.PublicKey().Bytes()
	pin := map[string]any{
		"issuerId":         issuerID,
		"ed25519KeyId":     fingerprint("ed-", edPub),
		"mldsa65KeyId":     fingerprint("pq-", pqPub),
		"ed25519PublicB64": b64.EncodeToString(edPub),
		"mldsa65PublicB64": b64.EncodeToString(pqPub),
	}
	address := os.Getenv("XSP_V2_PRODUCT_PUBLIC_ADDRESS")
	if address == "" || strings.ContainsAny(address, "/@?#") {
		return nil, errors.New("XSP_V2_PRODUCT_PUBLIC_ADDRESS required")
	}
	serverName := os.Getenv("XSP_V2_PRODUCT_SERVER_NAME")
	if serverName == "" {
		serverName = "node-ingress.xsp.invalid"
	}
	panelURL := os.Getenv("XSP_V2_PRODUCT_PANEL_URL")
	if panelURL == "" {
		panelURL = "http://panel:8080"
	}
	internalToken := os.Getenv("XSP_V2_PRODUCT_INTERNAL_TOKEN")
	if len(internalToken) != 64 || strings.ToLower(internalToken) != internalToken {
		return nil, errors.New("XSP_V2_PRODUCT_INTERNAL_TOKEN must be 64 lowercase hex characters")
	}
	if _, err := hex.DecodeString(internalToken); err != nil {
		return nil, errors.New("XSP_V2_PRODUCT_INTERNAL_TOKEN is not hexadecimal")
	}
	return &gateway{
		db: pool, panelEd: ed, panelPQ: pq,
		panelEdID: fingerprint("ed-", edPub), panelPQID: fingerprint("pq-", pqPub), panelPin: pin,
		clientCA: caCert, clientCAKey: caKey, serverCAPEM: serverCAPEM,
		publicAddress: address, serverName: serverName, panelURL: strings.TrimRight(panelURL, "/"),
		internalToken: internalToken,
		httpClient:    &http.Client{Timeout: 20 * time.Second},
	}, nil
}

func (g *gateway) issueClientCertificate(nodeID int64, publicDER []byte) (string, []byte, error) {
	pubAny, err := x509.ParsePKIXPublicKey(publicDER)
	if err != nil {
		return "", nil, err
	}
	pub, ok := pubAny.(*mldsa.PublicKey)
	if !ok || len(pub.Bytes()) != mldsa.MLDSA65PublicKeySize {
		return "", nil, errors.New("TLS identity must be ML-DSA-65")
	}
	serialBytes := make([]byte, 16)
	if _, err := rand.Read(serialBytes); err != nil {
		return "", nil, err
	}
	serial := new(big.Int).SetBytes(serialBytes)
	if serial.Sign() == 0 {
		serial.SetInt64(1)
	}
	now := time.Now().UTC()
	tpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: fmt.Sprintf("xmesh-node-%d", nodeID)},
		NotBefore:             now.Add(-5 * time.Minute),
		NotAfter:              now.Add(397 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, g.clientCA, pub, g.clientCAKey)
	if err != nil {
		return "", nil, err
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return "", nil, err
	}
	spki := sha256.Sum256(cert.RawSubjectPublicKeyInfo)
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})), spki[:], nil
}

func (g *gateway) enroll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
		fail(w, http.StatusUnsupportedMediaType, "POST application/json required")
		return
	}
	var req enrollRequest
	if _, err := readStrictJSON(r, &req, 128*1024); err != nil {
		fail(w, http.StatusBadRequest, "invalid strict-PQ enrollment request")
		return
	}
	versionOK := req.ReleaseIdentity.Version == targetAgentVersion || req.ReleaseIdentity.Version == previousAgentVersion || req.ReleaseIdentity.Version == repairAgentVersion
	if req.NodeID <= 0 || req.Purpose != "node_request" || req.KeyEpoch != 1 || !versionOK ||
		len(req.ReleaseIdentity.SourceRevision) != 40 || len(req.ReleaseIdentity.ArtifactSHA256) != 64 {
		fail(w, http.StatusBadRequest, "invalid XMesh v6 release identity")
		return
	}
	challenge, err := enrollmentChallenge(req.Token, req.NodeID)
	if err != nil || req.ChallengeHex != hex.EncodeToString(challenge) {
		fail(w, http.StatusUnauthorized, "invalid enrollment challenge")
		return
	}
	edPub, err := decodeCanonicalB64(req.Ed25519PublicB64, ed25519.PublicKeySize, ed25519.PublicKeySize)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid Ed25519 public key")
		return
	}
	pqPub, err := decodeCanonicalB64(req.MLDSA65PublicB64, mldsa.MLDSA65PublicKeySize, mldsa.MLDSA65PublicKeySize)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid ML-DSA-65 public key")
		return
	}
	if req.Ed25519KeyID != fingerprint("ed-", edPub) || req.MLDSA65KeyID != fingerprint("pq-", pqPub) {
		fail(w, http.StatusBadRequest, "public key identifier mismatch")
		return
	}
	input, err := proofInput(req, edPub, pqPub, challenge)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid enrollment proof subject")
		return
	}
	edSig, err := decodeCanonicalB64(req.Ed25519SignatureB64, ed25519.SignatureSize, ed25519.SignatureSize)
	if err != nil || !ed25519.Verify(edPub, input, edSig) {
		fail(w, http.StatusUnauthorized, "Ed25519 enrollment proof rejected")
		return
	}
	pqKey, err := mldsa.NewPublicKey(mldsa.MLDSA65(), pqPub)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid ML-DSA-65 public key")
		return
	}
	pqSig, err := decodeCanonicalB64(req.MLDSA65SignatureB64, mldsa.MLDSA65SignatureSize, mldsa.MLDSA65SignatureSize)
	if err != nil || mldsa.Verify(pqKey, input, pqSig, nil) != nil {
		fail(w, http.StatusUnauthorized, "ML-DSA-65 enrollment proof rejected")
		return
	}
	tlsPubDER, err := decodeCanonicalB64(req.TLSPublicKeyB64, -1, 8192)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid TLS public key")
		return
	}
	clientCertPEM, tlsSPKI, err := g.issueClientCertificate(req.NodeID, tlsPubDER)
	if err != nil {
		log.Printf("client certificate issue failed for node %d: %v", req.NodeID, err)
		fail(w, http.StatusBadRequest, "ML-DSA-65 TLS identity rejected")
		return
	}

	tokenHash := sha256.Sum256([]byte(req.Token))
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tx, err := g.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var tokenNode int64
	if err := tx.QueryRow(ctx,
		"SELECT node_id FROM node_enrollment_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW() FOR UPDATE",
		hex.EncodeToString(tokenHash[:])).Scan(&tokenNode); err != nil || tokenNode != req.NodeID {
		fail(w, http.StatusUnauthorized, "enrollment token is invalid or expired")
		return
	}
	var exists bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM panel_records WHERE collection='nodes' AND id=$1)", req.NodeID).Scan(&exists); err != nil || !exists {
		fail(w, http.StatusNotFound, "node not found")
		return
	}
	var existingState string
	err = tx.QueryRow(ctx, "SELECT state FROM node_xsp_product_nodes WHERE node_id=$1 FOR UPDATE", req.NodeID).Scan(&existingState)
	if err == nil && existingState == "active" {
		fail(w, http.StatusConflict, "strict-PQ node already active; explicit revocation required")
		return
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusServiceUnavailable, "database enrollment lookup failed")
		return
	}
	if _, err = tx.Exec(ctx,
		"INSERT INTO node_metric_keys(node_id,public_key,enrolled_at,last_seen_at) VALUES($1,$2,NOW(),NULL) ON CONFLICT(node_id) DO UPDATE SET public_key=EXCLUDED.public_key,enrolled_at=NOW(),last_seen_at=NULL",
		req.NodeID, hex.EncodeToString(edPub)); err != nil {
		fail(w, http.StatusServiceUnavailable, "cannot persist node bootstrap identity")
		return
	}
	_, _ = tx.Exec(ctx, "DELETE FROM node_metric_nonces WHERE node_id=$1", req.NodeID)
	_, _ = tx.Exec(ctx, "DELETE FROM node_xsp_product_nonces WHERE node_id=$1", req.NodeID)
	_, _ = tx.Exec(ctx, "DELETE FROM node_xsp_product_nodes WHERE node_id=$1", req.NodeID)
	_, _ = tx.Exec(ctx, "DELETE FROM node_xsp_public_keysets WHERE node_id=$1", req.NodeID)
	_, _ = tx.Exec(ctx, "DELETE FROM node_xsp_suite_state WHERE node_id=$1", req.NodeID)
	if _, err = tx.Exec(ctx,
		"INSERT INTO node_xsp_public_keysets(node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public) VALUES($1,'node_request',1,$2,$3,$4,$5)",
		req.NodeID, req.Ed25519KeyID, req.MLDSA65KeyID, edPub, pqPub); err != nil {
		fail(w, http.StatusServiceUnavailable, "cannot persist strict-PQ public keys")
		return
	}
	if _, err = tx.Exec(ctx,
		"INSERT INTO node_xsp_suite_state(node_id,minimum_suite,activation_phase,key_epoch) VALUES($1,1,'dual_enrolled',1)", req.NodeID); err != nil {
		fail(w, http.StatusServiceUnavailable, "cannot persist strict-PQ suite state")
		return
	}
	if _, err = tx.Exec(ctx,
		"INSERT INTO node_xsp_product_nodes(node_id,state,key_epoch,ed25519_key_id,mldsa65_key_id,tls_spki_sha256,release_version,release_source_revision,release_artifact_sha256) VALUES($1,'enrolled',1,$2,$3,$4,$5,$6,$7)",
		req.NodeID, req.Ed25519KeyID, req.MLDSA65KeyID, tlsSPKI, req.ReleaseIdentity.Version, req.ReleaseIdentity.SourceRevision, req.ReleaseIdentity.ArtifactSHA256); err != nil {
		fail(w, http.StatusServiceUnavailable, "cannot persist strict-PQ product enrollment")
		return
	}
	if _, err = tx.Exec(ctx, "UPDATE node_enrollment_tokens SET consumed_at=NOW() WHERE token_hash=$1", hex.EncodeToString(tokenHash[:])); err != nil {
		fail(w, http.StatusServiceUnavailable, "cannot consume enrollment token")
		return
	}
	if err = tx.Commit(ctx); err != nil {
		fail(w, http.StatusServiceUnavailable, "cannot commit strict-PQ enrollment")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"nodeId": req.NodeID, "state": "enrolled", "strictPQEnabled": false,
		"tlsSpkiSha256": hex.EncodeToString(tlsSPKI), "clientCertificatePem": clientCertPEM,
		"serverCaPem": g.serverCAPEM, "endpointAddress": g.publicAddress,
		"serverName": g.serverName, "panelPin": g.panelPin,
	})
}

func (g *gateway) loadNode(ctx context.Context, nodeID int64) (nodeIdentity, error) {
	var n nodeIdentity
	err := g.db.QueryRow(ctx,
		`SELECT p.state,p.key_epoch,p.ed25519_key_id,p.mldsa65_key_id,p.tls_spki_sha256,p.release_source_revision,
		        COALESCE(p.receipt_envelope,''::bytea),COALESCE(p.activation_request_id,''),k.ed25519_public,k.mldsa65_public
		   FROM node_xsp_product_nodes p JOIN node_xsp_public_keysets k
		     ON k.node_id=p.node_id AND k.purpose='node_request' AND k.key_epoch=p.key_epoch
		  WHERE p.node_id=$1`, nodeID).
		Scan(&n.State, &n.KeyEpoch, &n.EdKeyID, &n.PQKeyID, &n.TLSSPKI, &n.ReleaseRev, &n.Receipt, &n.ActivationRequestID, &n.EdPublic, &n.PQPublic)
	return n, err
}

func clientCertificateFromHeaders(r *http.Request) (*x509.Certificate, error) {
	if r.Header.Get("X-XSP-V2-Client-Verify") != "SUCCESS" {
		return nil, errors.New("verified client certificate required")
	}
	escaped := r.Header.Get("X-XSP-V2-Client-Cert")
	if escaped == "" {
		return nil, errors.New("client certificate missing")
	}
	decoded, err := url.QueryUnescape(escaped)
	if err != nil {
		return nil, err
	}
	block, rest := pem.Decode([]byte(decoded))
	if block == nil || block.Type != "CERTIFICATE" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, errors.New("client certificate encoding")
	}
	return x509.ParseCertificate(block.Bytes)
}

func verifyFresh(env envelope, nowMS int64) error {
	if nowMS > env.ExpiresAtMS || env.IssuedAtMS > nowMS+120000 || nowMS > env.IssuedAtMS+120000 {
		return errors.New("stale or future XSP/2 message")
	}
	return nil
}

func verifyNodeEnvelope(parsed parsedEnvelope, n nodeIdentity, cert *x509.Certificate) error {
	if parsed.Env.NodeID <= 0 || parsed.Env.KeyEpoch != n.KeyEpoch || parsed.Env.Ed25519KeyID != n.EdKeyID || parsed.Env.MLDSA65KeyID != n.PQKeyID ||
		len(n.EdPublic) != ed25519.PublicKeySize || len(n.PQPublic) != mldsa.MLDSA65PublicKeySize {
		return errors.New("XSP/2 node key binding mismatch")
	}
	if cert.Subject.CommonName != fmt.Sprintf("xmesh-node-%d", parsed.Env.NodeID) {
		return errors.New("TLS node certificate CN mismatch")
	}
	spki := sha256.Sum256(cert.RawSubjectPublicKeyInfo)
	if !bytes.Equal(spki[:], n.TLSSPKI) {
		return errors.New("TLS SPKI does not match enrolled node")
	}
	if err := verifyFresh(parsed.Env, time.Now().UnixMilli()); err != nil {
		return err
	}
	if !ed25519.Verify(n.EdPublic, parsed.SigningInput, parsed.EdSig) {
		return errors.New("invalid Ed25519 XSP/2 signature")
	}
	pqKey, err := mldsa.NewPublicKey(mldsa.MLDSA65(), n.PQPublic)
	if err != nil {
		return err
	}
	if err := mldsa.Verify(pqKey, parsed.SigningInput, parsed.PQSig, nil); err != nil {
		return errors.New("invalid ML-DSA-65 XSP/2 signature")
	}
	return nil
}

func (g *gateway) signResponse(nodeID, epoch int64, messageType, path, requestID, revision string, payload []byte) ([]byte, error) {
	nonceBytes := make([]byte, 16)
	if _, err := rand.Read(nonceBytes); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	env := envelope{
		Protocol: "XSP/2", Suite: suite, Direction: 2, MessageType: messageType,
		IssuerID: issuerID, NodeID: nodeID, Method: "POST", Path: path,
		Ed25519KeyID: g.panelEdID, MLDSA65KeyID: g.panelPQID, KeyEpoch: epoch,
		IssuedAtMS: now, ExpiresAtMS: now + 120000, NonceHex: hex.EncodeToString(nonceBytes),
		RequestID: requestID, Revision: revision, PayloadB64: b64.EncodeToString(payload),
	}
	input, err := signingInput(env, payload)
	if err != nil {
		return nil, err
	}
	edSig := ed25519.Sign(g.panelEd, input)
	pqSig, err := g.panelPQ.Sign(nil, input, nil)
	if err != nil {
		return nil, err
	}
	env.Signatures = signatures{Ed25519: b64.EncodeToString(edSig), MLDSA65: b64.EncodeToString(pqSig)}
	return json.Marshal(env)
}

func (g *gateway) activate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
		fail(w, http.StatusUnsupportedMediaType, "POST application/json required")
		return
	}
	cert, err := clientCertificateFromHeaders(r)
	if err != nil {
		fail(w, http.StatusForbidden, "verified ML-DSA client certificate required")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxEnvelopeBytes+1))
	if err != nil || len(raw) > maxEnvelopeBytes {
		fail(w, http.StatusBadRequest, "invalid activation envelope")
		return
	}
	parsed, err := parseEnvelope(raw, "node.product.activate", "/api/v2/product/activate", 1)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid activation envelope")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	n, err := g.loadNode(ctx, parsed.Env.NodeID)
	if err != nil {
		fail(w, http.StatusForbidden, "strict-PQ node not enrolled")
		return
	}
	if err := verifyNodeEnvelope(parsed, n, cert); err != nil {
		fail(w, http.StatusUnauthorized, "strict-PQ activation authentication failed")
		return
	}
	requestHash := sha256.Sum256(raw)
	if n.State == "active" {
		if n.ActivationRequestID == parsed.Env.RequestID && len(n.Receipt) > 0 {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(n.Receipt)
			return
		}
		fail(w, http.StatusConflict, "node already active under another durable activation receipt")
		return
	}
	if n.State != "enrolled" {
		fail(w, http.StatusForbidden, "node is not eligible for activation")
		return
	}
	receiptPayload, err := json.Marshal(map[string]any{
		"schema": "xmesh-v6-strict-pq-activation-receipt-1", "nodeId": parsed.Env.NodeID,
		"keyEpoch": parsed.Env.KeyEpoch, "requestBindingSha256": hex.EncodeToString(requestHash[:]),
		"productionActivation": true, "strictPQEnabled": true, "automaticClassicalFallback": false,
		"activatedAt": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		fail(w, http.StatusInternalServerError, "cannot encode strict-PQ activation receipt")
		return
	}
	receipt, err := g.signResponse(parsed.Env.NodeID, parsed.Env.KeyEpoch, "panel.product.activation-receipt", "/api/v2/product/activate", parsed.Env.RequestID, n.ReleaseRev, receiptPayload)
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "cannot sign strict-PQ activation receipt")
		return
	}
	receiptHash := sha256.Sum256(receipt)
	tx, err := g.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var state string
	var requestID string
	var existingReceipt []byte
	if err := tx.QueryRow(ctx, "SELECT state,COALESCE(activation_request_id,''),COALESCE(receipt_envelope,''::bytea) FROM node_xsp_product_nodes WHERE node_id=$1 FOR UPDATE", parsed.Env.NodeID).
		Scan(&state, &requestID, &existingReceipt); err != nil {
		fail(w, http.StatusServiceUnavailable, "activation state unavailable")
		return
	}
	if state == "active" {
		if requestID == parsed.Env.RequestID && len(existingReceipt) > 0 {
			_ = tx.Commit(ctx)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(existingReceipt)
			return
		}
		fail(w, http.StatusConflict, "durable activation already differs")
		return
	}
	nonce, _ := hex.DecodeString(parsed.Env.NonceHex)
	if _, err = tx.Exec(ctx, "INSERT INTO node_xsp_product_nonces(node_id,key_epoch,direction,nonce,request_id) VALUES($1,$2,1,$3,$4)", parsed.Env.NodeID, parsed.Env.KeyEpoch, nonce, parsed.Env.RequestID); err != nil {
		fail(w, http.StatusConflict, "strict-PQ activation replay rejected")
		return
	}
	result, err := tx.Exec(ctx,
		"UPDATE node_xsp_product_nodes SET state='active',activation_request_id=$2,activation_request_sha256=$3,receipt_sha256=$4,receipt_envelope=$5,activated_at=NOW() WHERE node_id=$1 AND state='enrolled'",
		parsed.Env.NodeID, parsed.Env.RequestID, requestHash[:], receiptHash[:], receipt)
	if err != nil || result.RowsAffected() != 1 {
		fail(w, http.StatusConflict, "strict-PQ activation state changed concurrently")
		return
	}
	if _, err = tx.Exec(ctx, "UPDATE node_xsp_suite_state SET minimum_suite=2,activation_phase='strict',key_epoch=$2 WHERE node_id=$1", parsed.Env.NodeID, parsed.Env.KeyEpoch); err != nil {
		fail(w, http.StatusServiceUnavailable, "cannot enforce strict-PQ suite floor")
		return
	}
	if err = tx.Commit(ctx); err != nil {
		fail(w, http.StatusServiceUnavailable, "cannot commit strict-PQ activation")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(receipt)
}

var allowedTunnelPaths = map[string]bool{
	"/api/v1/metrics/ingest":      true,
	"/api/v1/node/heartbeat":      true,
	"/api/v1/node/restart/poll":   true,
	"/api/v1/node/restart/ack":    true,
	"/api/v1/node/desired-config": true,
}

func (g *gateway) tunnel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
		fail(w, http.StatusUnsupportedMediaType, "POST application/json required")
		return
	}
	cert, err := clientCertificateFromHeaders(r)
	if err != nil {
		fail(w, http.StatusForbidden, "verified ML-DSA client certificate required")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxEnvelopeBytes+1))
	if err != nil || len(raw) > maxEnvelopeBytes {
		fail(w, http.StatusBadRequest, "invalid tunnel envelope")
		return
	}
	parsed, err := parseEnvelope(raw, "node.product.tunnel", "/api/v2/product/tunnel", 1)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid tunnel envelope")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	n, err := g.loadNode(ctx, parsed.Env.NodeID)
	if err != nil || n.State != "active" {
		fail(w, http.StatusForbidden, "strict-PQ node is not active")
		return
	}
	if err := verifyNodeEnvelope(parsed, n, cert); err != nil {
		fail(w, http.StatusUnauthorized, "strict-PQ tunnel authentication failed")
		return
	}
	if err := checkUniqueJSONKeys(parsed.Payload); err != nil {
		fail(w, http.StatusBadRequest, "invalid strict-PQ tunnel payload")
		return
	}
	var inner tunnelPayload
	decoder := json.NewDecoder(bytes.NewReader(parsed.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&inner); err != nil || !allowedTunnelPaths[inner.Path] {
		fail(w, http.StatusBadRequest, "unregistered strict-PQ tunnel operation")
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		fail(w, http.StatusBadRequest, "trailing strict-PQ tunnel payload")
		return
	}
	body, err := decodeCanonicalB64(inner.BodyB64, -1, maxPayloadBytes)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid tunneled request body")
		return
	}

	tx, err := g.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	nonce, err := hex.DecodeString(parsed.Env.NonceHex)
	if err != nil || len(nonce) != 16 {
		_ = tx.Rollback(ctx)
		fail(w, http.StatusBadRequest, "invalid strict-PQ replay nonce")
		return
	}
	if _, err = tx.Exec(ctx, "INSERT INTO node_xsp_product_nonces(node_id,key_epoch,direction,nonce,request_id) VALUES($1,$2,1,$3,$4)", parsed.Env.NodeID, parsed.Env.KeyEpoch, nonce, parsed.Env.RequestID); err != nil {
		_ = tx.Rollback(ctx)
		fail(w, http.StatusConflict, "strict-PQ tunnel replay rejected")
		return
	}
	if err = tx.Commit(ctx); err != nil {
		fail(w, http.StatusServiceUnavailable, "cannot persist strict-PQ replay state")
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.panelURL+inner.Path, bytes.NewReader(body))
	if err != nil {
		fail(w, http.StatusInternalServerError, "cannot build internal request")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", g.panelURL)
	req.Header.Set("X-XSP-Product-Internal", g.internalToken)
	req.Header.Set("X-XSP-Product-Node-Id", strconv.FormatInt(parsed.Env.NodeID, 10))
	req.Header.Set("X-XSP-Product-Path", inner.Path)
	resp, err := g.httpClient.Do(req)
	if err != nil {
		fail(w, http.StatusBadGateway, "internal panel operation unavailable")
		return
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024+1))
	if err != nil || len(responseBody) > 2*1024*1024 {
		fail(w, http.StatusBadGateway, "internal panel response invalid")
		return
	}
	wrappedPayload, err := json.Marshal(map[string]any{"status": resp.StatusCode, "bodyB64": b64.EncodeToString(responseBody)})
	if err != nil {
		fail(w, http.StatusInternalServerError, "cannot encode strict-PQ panel response")
		return
	}
	wrapped, err := g.signResponse(parsed.Env.NodeID, parsed.Env.KeyEpoch, "panel.product.tunnel-response", "/api/v2/product/tunnel", parsed.Env.RequestID, n.ReleaseRev, wrappedPayload)
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "cannot dual-sign strict-PQ response")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(wrapped)
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	g, err := newGateway(ctx)
	cancel()
	if err != nil {
		log.Fatalf("strict-PQ product gateway initialization failed: %v", err)
	}
	defer g.db.Close()
	mux := http.NewServeMux()
	mux.HandleFunc("/enroll", g.enroll)
	mux.HandleFunc("/activate", g.activate)
	mux.HandleFunc("/tunnel", g.tunnel)
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "strict-pq-ready"})
	})
	server := &http.Server{
		Addr:              ":8081",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    32 * 1024,
	}
	log.Printf("XMesh v6 strict-PQ product gateway ready")
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}