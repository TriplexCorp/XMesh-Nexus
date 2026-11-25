package main

import (
	"context"
	"crypto/ed25519"
	"crypto/mldsa"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// This loopback fixture supplies disposable PKI and the TLS-to-gateway
// hand-off. Enrollment, activation and both XSP/2 signatures use the real
// product gateway handlers, with Nexus and PostgreSQL in separate processes.
func TestServeWALTunnelFixture(t *testing.T) {
	dir := os.Getenv("XMESH_WAL_TUNNEL_FIXTURE_DIR")
	if dir == "" {
		t.Skip("requires the disposable WAL workflow")
	}
	dsn, err := url.Parse(os.Getenv("QUOTA_TEST_DSN"))
	if err != nil || dsn.Scheme != "postgresql" || dsn.Hostname() != "127.0.0.1" ||
		dsn.User.Username() != "quota_test" || os.Getenv("XMESH_AUDIT_DISPOSABLE") != "1" {
		t.Fatal("disposable loopback database required")
	}
	address := "127.0.0.1"
	if bridge := os.Getenv("XMESH_WAL_TEST_BRIDGE"); bridge != "" {
		ip := net.ParseIP(bridge)
		if ip == nil || ip.To4() == nil || !ip.IsPrivate() ||
			os.Getenv("GITHUB_ACTIONS") != "true" || os.Getenv("RUNNER_ENVIRONMENT") != "github-hosted" {
			t.Fatal("a private bridge is allowed only in the hosted lab")
		}
		address = bridge
	}
	db, err := pgxpool.New(context.Background(), dsn.String())
	requireFixture(t, err)
	defer db.Close()

	edPub, ed, err := ed25519.GenerateKey(rand.Reader)
	requireFixture(t, err)
	pq, err := mldsa.GenerateKey(mldsa.MLDSA65())
	requireFixture(t, err)
	clientCAKey, err := mldsa.GenerateKey(mldsa.MLDSA65())
	requireFixture(t, err)
	now := time.Now()
	ca := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "WAL test client CA"},
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
		NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour),
	}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, clientCAKey.PublicKey(), clientCAKey)
	requireFixture(t, err)
	cert, err := x509.ParseCertificate(caDER)
	requireFixture(t, err)
	clientRoots := x509.NewCertPool()
	clientRoots.AddCert(cert)

	serverPub, serverKey, err := ed25519.GenerateKey(rand.Reader)
	requireFixture(t, err)
	serverCert := &x509.Certificate{
		SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "WAL loopback server"},
		IPAddresses: []net.IP{net.ParseIP(address)},
		KeyUsage:    x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour),
	}
	serverDER, err := x509.CreateCertificate(rand.Reader, serverCert, serverCert, serverPub, serverKey)
	requireFixture(t, err)
	serverPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: serverDER})
	requireFixture(t, os.WriteFile(filepath.Join(dir, "tls-root.pem"), serverPEM, 0o600))
	tlsIdentity := tls.Certificate{Certificate: [][]byte{serverDER}, PrivateKey: serverKey}

	pqPub := pq.PublicKey().Bytes()
	g := &gateway{
		db: db, panelEd: ed, panelPQ: pq,
		panelEdID: fingerprint("ed-", edPub), panelPQID: fingerprint("pq-", pqPub),
		panelPin: map[string]any{
			"issuerId": issuerID, "ed25519KeyId": fingerprint("ed-", edPub),
			"mldsa65KeyId": fingerprint("pq-", pqPub), "ed25519PublicB64": b64.EncodeToString(edPub),
			"mldsa65PublicB64": b64.EncodeToString(pqPub),
		},
		clientCA: cert, clientCAKey: clientCAKey, serverCAPEM: string(serverPEM),
		panelURL: os.Getenv("XMESH_TEST_URL"), serverName: address,
		internalToken: os.Getenv("XSP_V2_PRODUCT_INTERNAL_TOKEN"),
		httpClient:    &http.Client{Timeout: 20 * time.Second},
	}
	if g.panelURL != "http://127.0.0.1:38081" || len(g.internalToken) != 64 {
		t.Fatal("disposable Nexus and internal gateway token required")
	}
	if os.Getenv("XMESH_TEST_INSTALLED_FIRST_SUCCESSOR") == "1" {
		if address == "127.0.0.1" || dsn.Path != "/quota_wal_installed" ||
			os.Getenv("GITHUB_ACTIONS") != "true" || os.Getenv("RUNNER_ENVIRONMENT") != "github-hosted" {
			t.Fatal("first-successor rehearsal requires the private hosted lab")
		}
		// The test binary alone supplies a synthetic successor. Enrollment
		// still uses the real initial release and its production pin.
		g.releaseTargetVersion = "control-v6.0.34"
		t.Setenv("XSP_V2_PRODUCT_RELEASE_PLANNING", "1")
		t.Setenv("XSP_V2_PRODUCT_RELEASE_COMMIT", "1")
		t.Setenv("XSP_V2_PRODUCT_RELEASE_ARTIFACT_DIR", filepath.Join(dir, "successor-artifacts"))
	}
	if os.Getenv("XMESH_TEST_INSTALLED_CRASHES") == "1" &&
		address != "127.0.0.1" && dsn.Path == "/quota_wal_installed" {
		g.httpClient.Transport = loseCommittedWALReply{dir: dir}
	}
	strict := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || len(r.TLS.PeerCertificates) == 0 {
			http.Error(w, "mTLS required", http.StatusForbidden)
			return
		}
		if r.TLS.Version != tls.VersionTLS13 || r.TLS.CurveID != tls.X25519MLKEM768 {
			http.Error(w, "TLS 1.3 hybrid key exchange required", http.StatusForbidden)
			return
		}
		r.Header.Set("X-XSP-V2-Client-Verify", "SUCCESS")
		r.Header.Set("X-XSP-V2-Client-Cert", url.QueryEscape(string(pem.EncodeToMemory(
			&pem.Block{Type: "CERTIFICATE", Bytes: r.TLS.PeerCertificates[0].Raw}))))
		switch r.URL.Path {
		case "/api/v2/product/activate":
			g.activate(w, r)
		case "/api/v2/product/tunnel":
			g.tunnel(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	strict.TLS = &tls.Config{
		Certificates: []tls.Certificate{tlsIdentity}, ClientCAs: clientRoots,
		ClientAuth: tls.RequireAndVerifyClientCert, CurvePreferences: []tls.CurveID{tls.X25519MLKEM768},
		MinVersion: tls.VersionTLS13, MaxVersion: tls.VersionTLS13,
	}
	if address != "127.0.0.1" {
		requireFixture(t, strict.Listener.Close())
		strict.Listener, err = net.Listen("tcp4", net.JoinHostPort(address, "0"))
		requireFixture(t, err)
	}
	strict.StartTLS()
	defer strict.Close()

	g.publicAddress = strings.TrimPrefix(strict.URL, "https://")
	enrollment := http.NewServeMux()
	enrollment.HandleFunc("/api/v2/product/enroll", g.enroll)
	bootstrap := httptest.NewUnstartedServer(enrollment)
	bootstrap.TLS = &tls.Config{Certificates: []tls.Certificate{tlsIdentity}, MinVersion: tls.VersionTLS13}
	if address != "127.0.0.1" {
		requireFixture(t, bootstrap.Listener.Close())
		bootstrap.Listener, err = net.Listen("tcp4", net.JoinHostPort(address, "0"))
		requireFixture(t, err)
	}
	bootstrap.StartTLS()
	defer bootstrap.Close()
	info, err := json.Marshal(map[string]string{"enrollment": bootstrap.URL, "strict": strict.URL})
	requireFixture(t, err)
	requireFixture(t, os.WriteFile(filepath.Join(dir, "ready.tmp"), info, 0o600))
	requireFixture(t, os.Rename(filepath.Join(dir, "ready.tmp"), filepath.Join(dir, "ready.json")))

	deadline := time.Now().Add(3 * time.Minute)
	if address != "127.0.0.1" {
		deadline = time.Now().Add(20 * time.Minute)
	}
	for time.Now().Before(deadline) {
		if _, err := os.Stat(filepath.Join(dir, "done")); err == nil {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("fixture timed out")
}

// Hold a real successful Nexus response after commit, then abort the
// authenticated stream without sending any response to the Node.
type loseCommittedWALReply struct{ dir string }

func (f loseCommittedWALReply) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil || resp.StatusCode != http.StatusOK || req.GetBody == nil ||
		req.URL.Path != "/api/v1/node/quota-v2/wal" {
		return resp, err
	}
	first, err := os.ReadFile(filepath.Join(f.dir, "drop-wal-response-armed"))
	if err != nil {
		return resp, nil
	}
	body, err := req.GetBody()
	if err != nil {
		return resp, nil
	}
	defer body.Close()
	var request struct {
		Operation     string `json:"operation"`
		ReservationID string `json:"reservationId"`
	}
	if json.NewDecoder(body).Decode(&request) != nil || request.Operation != "charge" ||
		request.ReservationID != strings.TrimSpace(string(first)) {
		return resp, nil
	}
	marker, err := os.OpenFile(filepath.Join(f.dir, "wal-response-held"),
		os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return resp, nil
	}
	marker.Close()
	defer resp.Body.Close()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) && req.Context().Err() == nil {
		if _, err := os.Stat(filepath.Join(f.dir, "drop-wal-response")); err == nil {
			_ = os.WriteFile(filepath.Join(f.dir, "wal-response-dropped"), nil, 0o600)
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	panic(http.ErrAbortHandler)
}

func requireFixture(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
