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
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")},
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
		panelURL: os.Getenv("XMESH_TEST_URL"), serverName: "127.0.0.1",
		internalToken: os.Getenv("XSP_V2_PRODUCT_INTERNAL_TOKEN"),
		httpClient:    &http.Client{Timeout: 20 * time.Second},
	}
	if g.panelURL != "http://127.0.0.1:38081" || len(g.internalToken) != 64 {
		t.Fatal("disposable Nexus and internal gateway token required")
	}
	strict := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || len(r.TLS.PeerCertificates) == 0 {
			http.Error(w, "mTLS required", http.StatusForbidden)
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
	strict.StartTLS()
	defer strict.Close()

	g.publicAddress = strings.TrimPrefix(strict.URL, "https://")
	enrollment := http.NewServeMux()
	enrollment.HandleFunc("/api/v2/product/enroll", g.enroll)
	bootstrap := httptest.NewUnstartedServer(enrollment)
	bootstrap.TLS = &tls.Config{Certificates: []tls.Certificate{tlsIdentity}, MinVersion: tls.VersionTLS13}
	bootstrap.StartTLS()
	defer bootstrap.Close()
	info, err := json.Marshal(map[string]string{"enrollment": bootstrap.URL, "strict": strict.URL})
	requireFixture(t, err)
	requireFixture(t, os.WriteFile(filepath.Join(dir, "ready.tmp"), info, 0o600))
	requireFixture(t, os.Rename(filepath.Join(dir, "ready.tmp"), filepath.Join(dir, "ready.json")))

	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(filepath.Join(dir, "done")); err == nil {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("fixture timed out")
}

func requireFixture(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
