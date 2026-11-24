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
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestReleasePlanPostgres(t *testing.T) {
	dsn := os.Getenv("QUOTA_TEST_DSN")
	if dsn == "" {
		t.Skip("requires disposable PostgreSQL")
	}
	address, err := url.Parse(dsn)
	requireFixture(t, err)
	if os.Getenv("XMESH_AUDIT_DISPOSABLE") != "1" || address.Scheme != "postgresql" ||
		address.Hostname() != "127.0.0.1" || address.User.Username() != "quota_test" ||
		address.Path != "/quota_test" || address.RawQuery != "" {
		t.Fatal("requires the disposable quota_test database on loopback")
	}
	t.Setenv("XSP_V2_PRODUCT_RELEASE_PLANNING", "1")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	config, err := pgxpool.ParseConfig(dsn)
	requireFixture(t, err)
	admin, err := pgxpool.NewWithConfig(ctx, config.Copy())
	requireFixture(t, err)
	defer admin.Close()
	// The timestamp suffix permits parallel test processes sharing this disposable DB.
	schema := "release_plan_" + strings.ReplaceAll(time.Now().UTC().Format("20060102150405.000000000"), ".", "_")
	_, err = admin.Exec(ctx, "CREATE SCHEMA "+schema)
	requireFixture(t, err)
	defer func() {
		_, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		if err != nil {
			t.Error(err)
		}
	}()
	config.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, config)
	requireFixture(t, err)
	defer db.Close()
	exec := func(sql string, args ...any) {
		t.Helper()
		_, err := db.Exec(ctx, sql, args...)
		requireFixture(t, err)
	}
	for _, prefix := range []string{"0001", "0012", "0015", "0019", "0020", "0023", "0024", "0099", "0107", "0108", "0109", "0110", "0163", "0164", "0165", "0166"} {
		paths, err := filepath.Glob("../../backend/migrations/" + prefix + "_*.sql")
		requireFixture(t, err)
		if len(paths) != 1 {
			t.Fatalf("cannot locate migration %s", prefix)
		}
		raw, err := os.ReadFile(paths[0])
		requireFixture(t, err)
		exec(string(raw))
	}
	pub, ed, err := ed25519.GenerateKey(rand.Reader)
	requireFixture(t, err)
	pq, err := mldsa.GenerateKey(mldsa.MLDSA65())
	requireFixture(t, err)
	g := &gateway{db: db, panelEd: ed, panelPQ: pq,
		panelEdID: fingerprint("ed-", pub), panelPQID: fingerprint("pq-", pq.PublicKey().Bytes())}
	current := releaseIdentity{"control-v6.0.24", strings.Repeat("a", 40), strings.Repeat("b", 64)}
	artifact := bytes.Repeat([]byte("a"), releaseChunkBytes+17)
	artifactDigest := sha256.Sum256(artifact)
	target := releaseIdentity{"control-v6.0.27", strings.Repeat("c", 40), fmt.Sprintf("%x", artifactDigest)}
	artifactDir := t.TempDir()
	t.Setenv("XSP_V2_PRODUCT_RELEASE_ARTIFACT_DIR", artifactDir)
	requireFixture(t, os.WriteFile(filepath.Join(artifactDir, target.ArtifactSHA256+".bin"), artifact, 0600))
	receipt := []byte("existing activation envelope")
	digest := sha256.Sum256(receipt)
	identityCertificate := &x509.Certificate{SerialNumber: big.NewInt(1),
		Subject:   pkix.Name{CommonName: "xmesh-node-1"},
		NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Minute)}
	certDER, err := x509.CreateCertificate(rand.Reader, identityCertificate, identityCertificate, pq.PublicKey(), pq)
	requireFixture(t, err)
	cert, err := x509.ParseCertificate(certDER)
	requireFixture(t, err)
	spki := sha256.Sum256(cert.RawSubjectPublicKeyInfo)
	exec("INSERT INTO panel_records(collection,data) VALUES('nodes','{}')")
	exec("INSERT INTO node_metric_keys(node_id,public_key) VALUES(1,$1)", strings.Repeat("e", 64))
	exec(`INSERT INTO node_xsp_public_keysets
		(node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public)
		VALUES(1,'node_request',1,'ed-test','pq-test',$1,$2)`, []byte(pub), pq.PublicKey().Bytes())
	exec(`INSERT INTO node_xsp_product_nodes (node_id,state,key_epoch,ed25519_key_id,mldsa65_key_id,
		tls_spki_sha256,release_version,release_source_revision,release_artifact_sha256,
		receipt_sha256,receipt_envelope,activated_at)
		VALUES(1,'active',1,'ed-test','pq-test',$1,$2,$3,$4,$5,$6,now())`,
		spki[:], current.Version, current.SourceRevision, current.ArtifactSHA256, digest[:], receipt)
	exec(`INSERT INTO node_xsp_agent_release_manifests(version,source_revision,artifact_sha256,created_by)
		VALUES($1,$2,$3,'test-owner')`, target.Version, target.SourceRevision, target.ArtifactSHA256)
	var command int64
	if err := db.QueryRow(ctx, "SELECT command_id FROM queue_node_xsp_product_upgrade(1,'test-owner')").Scan(&command); err == nil {
		t.Fatal("bridge command queued without a live 6.0.24 heartbeat")
	}
	exec("INSERT INTO node_runtime_heartbeats(node_id,version,router_running,xray_running,received_at) VALUES(1,'control-v6.0.24',true,true,now())")
	requireFixture(t, db.QueryRow(ctx, "SELECT command_id FROM queue_node_xsp_product_upgrade(1,'test-owner')").Scan(&command))
	if command != 1 {
		t.Fatalf("unexpected first product command %d", command)
	}
	exec("UPDATE node_restart_commands SET state='claimed',claimed_at=now() WHERE id=1")

	body, err := json.Marshal(releasePlanRequest{CommandID: 1, Current: current})
	requireFixture(t, err)
	request := parsedEnvelope{Env: envelope{NodeID: 1, Revision: current.SourceRevision}}
	node := nodeIdentity{KeyEpoch: 1, Release: current, Receipt: receipt}
	download := func(planSHA string, offset int64) (int, []byte) {
		raw, err := json.Marshal(releaseArtifactRequest{CommandID: 1, Current: current, PlanSHA256: planSHA, Offset: offset})
		requireFixture(t, err)
		return g.releaseArtifact(ctx, request, node, raw)
	}
	if status, _ := download(strings.Repeat("0", 64), 0); status != http.StatusConflict {
		t.Fatalf("download without issued plan returned %d", status)
	}
	var wg sync.WaitGroup
	results := make([][]byte, 8)
	for i := range results {
		wg.Go(func() {
			status, result := g.planRelease(ctx, request, node, body)
			if status != http.StatusOK {
				t.Errorf("plan request %d returned %d", i, status)
			}
			results[i] = result
		})
	}
	wg.Wait()
	if t.Failed() {
		t.FailNow()
	}
	for _, result := range results[1:] {
		if !bytes.Equal(result, results[0]) {
			t.Fatal("a retry returned different signed bytes")
		}
	}
	signed, err := parseEnvelope(results[0], "panel.product.release-plan", releasePlanPath, 2)
	requireFixture(t, err)
	if !ed25519.Verify(pub, signed.SigningInput, signed.EdSig) {
		t.Fatal("invalid Ed25519 signature")
	}
	requireFixture(t, mldsa.Verify(pq.PublicKey(), signed.SigningInput, signed.PQSig, nil))
	var plan releasePlan
	requireFixture(t, json.Unmarshal(signed.Payload, &plan))
	if plan.NodeID != 1 || plan.CommandID != 1 || plan.Current != current || plan.Target != target {
		t.Fatalf("unexpected persisted plan: %+v", plan)
	}
	for _, statement := range []string{
		"UPDATE node_xsp_product_release_plans SET signed_envelope=signed_envelope",
		"DELETE FROM node_xsp_product_release_plans",
		"TRUNCATE node_xsp_product_release_plans",
	} {
		if _, err := db.Exec(ctx, statement); err == nil {
			t.Fatalf("outbox permitted mutation: %s", statement)
		}
	}
	planHash := sha256.Sum256(results[0])
	planSHA := fmt.Sprintf("%x", planHash)
	var assembled []byte
	for _, offset := range []int64{0, releaseChunkBytes} {
		status, raw := download(planSHA, offset)
		if status != http.StatusOK {
			t.Fatalf("artifact chunk returned %d", status)
		}
		var chunk releaseArtifactChunk
		requireFixture(t, json.Unmarshal(raw, &chunk))
		if chunk.Offset != offset || chunk.TotalBytes != int64(len(artifact)) || chunk.PlanSHA256 != planSHA || chunk.ArtifactSHA256 != target.ArtifactSHA256 {
			t.Fatal("wrong chunk binding")
		}
		data, err := b64.DecodeString(chunk.DataB64)
		requireFixture(t, err)
		assembled = append(assembled, data...)
	}
	if !bytes.Equal(assembled, artifact) {
		t.Fatal("downloaded artifact differs")
	}
	// The immutable outbox must NOT make a previously signed plan usable
	// after the active command expires, is cancelled, or the Node is disabled.
	// Both plan replay and EACH subsequent chunk must recheck live SQL state.
	assertReleaseRevoked := func(reason string) {
		t.Helper()
		if status, _ := g.planRelease(ctx, request, node, body); status != http.StatusConflict {
			t.Fatalf("%s: old signed plan replay returned %d", reason, status)
		}
		if status, _ := download(planSHA, 0); status != http.StatusConflict {
			t.Fatalf("%s: old signed artifact chunk returned %d", reason, status)
		}
	}
	exec("UPDATE node_restart_commands SET claimed_at=now() - interval '16 minutes' WHERE id=1")
	assertReleaseRevoked("expired update claim")
	exec("UPDATE node_restart_commands SET claimed_at=now(),requested_at=now() - interval '16 minutes' WHERE id=1")
	assertReleaseRevoked("expired owner request with a fresh claim")
	exec("UPDATE node_restart_commands SET requested_at=now() WHERE id=1")
	exec("UPDATE panel_records SET data=jsonb_set(data, '{disabled}', 'true'::jsonb, true) WHERE id=1")
	assertReleaseRevoked("disabled Node")
	exec("UPDATE panel_records SET data='{}'::jsonb WHERE id=1")
	// Recovery of the unchanged original receipt, not a newly signed plan.
	if status, same := g.planRelease(ctx, request, node, body); status != http.StatusOK ||
		!bytes.Equal(same, results[0]) {
		t.Fatal("safe release replay changed after transient command guard")
	}
	if status, _ := download(strings.Repeat("0", 64), 0); status != http.StatusConflict {
		t.Fatal("wrong plan digest accepted")
	}
	if status, _ := download(planSHA, 1); status != http.StatusBadRequest {
		t.Fatal("unaligned offset accepted")
	}
	if status, _ := download(planSHA, 2*releaseChunkBytes); status != http.StatusConflict {
		t.Fatal("out-of-range offset accepted")
	}
	newReceipt := []byte("another activation envelope")
	newDigest := sha256.Sum256(newReceipt)
	exec("UPDATE node_xsp_product_nodes SET receipt_sha256=$1,receipt_envelope=$2", newDigest[:], newReceipt)
	if status, _ := download(planSHA, 0); status != http.StatusConflict {
		t.Fatal("stale activation still permits artifact delivery")
	}
	for _, candidate := range []nodeIdentity{node, {KeyEpoch: 1, Release: current, Receipt: newReceipt}} {
		if status, _ := g.planRelease(ctx, request, candidate, body); status != http.StatusConflict {
			t.Fatalf("changed activation returned %d", status)
		}
	}
	// Even the exact earlier dual-signed response cannot be re-delivered
	// through a revoked enrolled key epoch. No stale chunk bypasses this.
	exec("UPDATE node_xsp_product_nodes SET receipt_sha256=$1,receipt_envelope=$2", digest[:], receipt)
	exec("UPDATE node_xsp_public_keysets SET revoked_at=now() WHERE node_id=1 AND purpose='node_request'")
	assertReleaseRevoked("revoked enrolled Node keys")
	exec("UPDATE node_xsp_public_keysets SET revoked_at=NULL WHERE node_id=1")
	aborted, err := json.Marshal(releaseCommitRequest{CommandID: 1, PlanSHA256: planSHA, Installed: target})
	requireFixture(t, err)
	abortStatus, rawAbort := g.finishRelease(ctx, request, node, aborted, true)
	if abortStatus != http.StatusOK {
		t.Fatalf("abort returned %d", abortStatus)
	}
	abortReceipt, err := parseEnvelope(rawAbort, "panel.product.release-abort", releaseAbortPath, 2)
	requireFixture(t, err)
	if !ed25519.Verify(pub, abortReceipt.SigningInput, abortReceipt.EdSig) {
		t.Fatal("invalid abort Ed25519 signature")
	}
	requireFixture(t, mldsa.Verify(pq.PublicKey(), abortReceipt.SigningInput, abortReceipt.PQSig, nil))
	assertReleaseRevoked("terminal aborted command")
	if _, err := db.Exec(ctx, "UPDATE node_restart_commands SET state='claimed' WHERE id=1"); err == nil {
		t.Fatal("an aborted command was reopened")
	}
	targetRequest := request
	targetRequest.Env.Revision = target.SourceRevision
	t.Setenv("XSP_V2_PRODUCT_RELEASE_COMMIT", "1")
	if status, _ := g.commitRelease(ctx, targetRequest, node, aborted); status != http.StatusConflict {
		t.Fatal("aborted command acquired the new revision")
	}
	if status, _ := g.finishRelease(ctx, request, node, aborted, true); status != http.StatusOK {
		t.Fatal("aborted command did not recover its rollback decision")
	}
	exec("SELECT * FROM stage_node_xsp_agent_migration(1,$1,'test-owner')", target.Version)
	exec("UPDATE node_restart_commands SET state='claimed',claimed_at=now() WHERE id=2")
	body, err = json.Marshal(releasePlanRequest{CommandID: 2, Current: current})
	requireFixture(t, err)
	planStatus, nextPlan := g.authorizeReleaseInstall(ctx, request, node, body)
	if planStatus != http.StatusConflict {
		t.Fatal("install authorization created a missing plan")
	}
	planStatus, nextPlan = g.planRelease(ctx, request, node, body)
	if planStatus != http.StatusOK {
		t.Fatal("cannot plan a new owner command after abort")
	}
	planHash = sha256.Sum256(nextPlan)
	planSHA = fmt.Sprintf("%x", planHash)
	if status, approved := g.authorizeReleaseInstall(ctx, request, node, body); status != http.StatusOK ||
		!bytes.Equal(approved, nextPlan) {
		t.Fatal("installation did not receive the exact live authorized plan")
	}
	t.Setenv("XSP_V2_PRODUCT_RELEASE_COMMIT", "0")
	commitBody, err := json.Marshal(releaseCommitRequest{CommandID: 2, PlanSHA256: planSHA, Installed: target})
	requireFixture(t, err)
	commitRequest := request
	commitRequest.Env.Revision = target.SourceRevision
	status, _ := g.commitRelease(ctx, commitRequest, node, commitBody)
	if status != http.StatusConflict {
		t.Fatalf("disabled release commit returned %d", status)
	}
	t.Setenv("XSP_V2_PRODUCT_RELEASE_COMMIT", "1")
	if _, err := db.Exec(ctx, `UPDATE node_restart_commands SET state='succeeded',finished_at=now(),
        release_ack_version=$1,release_ack_source_revision=$2,release_ack_artifact_sha256=$3,
        release_ack_success=true,release_ack_received_at=now() WHERE id=2`,
		target.Version, target.SourceRevision, target.ArtifactSHA256); err == nil ||
		!strings.Contains(err.Error(), "strict-PQ release commit required") {
		t.Fatalf("legacy ACK crossed the authenticated commit boundary: %v", err)
	}
	wrong, err := json.Marshal(releaseCommitRequest{CommandID: 2, PlanSHA256: strings.Repeat("0", 64), Installed: target})
	requireFixture(t, err)
	for _, bad := range []struct {
		request parsedEnvelope
		body    []byte
	}{{request, commitBody}, {commitRequest, wrong}} {
		if got, _ := g.commitRelease(ctx, bad.request, node, bad.body); got != http.StatusConflict {
			t.Fatalf("unapproved commit returned %d", got)
		}
	}
	exec("UPDATE node_restart_commands SET requested_at=now() - interval '16 minutes' WHERE id=2")
	if status, _ := g.commitRelease(ctx, commitRequest, node, commitBody); status != http.StatusConflict {
		t.Fatalf("expired update committed: %d", status)
	}
	exec("UPDATE node_restart_commands SET requested_at=now() WHERE id=2")
	for i := range results {
		wg.Go(func() {
			code, raw := g.commitRelease(ctx, commitRequest, node, commitBody)
			if code != http.StatusOK {
				t.Errorf("commit request %d: HTTP %d", i, code)
			}
			results[i] = raw
		})
	}
	wg.Wait()
	if t.Failed() {
		t.FailNow()
	}
	for _, actual := range results[1:] {
		if !bytes.Equal(actual, results[0]) {
			t.Fatal("concurrent commit returned different signed bytes")
		}
	}
	applied, err := parseEnvelope(results[0], "panel.product.release-commit", releaseCommitPath, 2)
	requireFixture(t, err)
	if !ed25519.Verify(pub, applied.SigningInput, applied.EdSig) {
		t.Fatal("invalid commit Ed25519 signature")
	}
	requireFixture(t, mldsa.Verify(pq.PublicKey(), applied.SigningInput, applied.PQSig, nil))
	var commit releaseCommitReceipt
	requireFixture(t, json.Unmarshal(applied.Payload, &commit))
	if commit.Installed != target || commit.CommandID != 2 || commit.PlanSHA256 != planSHA ||
		commit.ActivationSHA256 != fmt.Sprintf("%x", digest) {
		t.Fatalf("wrong signed commit: %+v", commit)
	}
	t.Setenv("XSP_V2_PRODUCT_RELEASE_COMMIT", "0")
	if status, again := g.commitRelease(ctx, commitRequest, node, commitBody); status != http.StatusOK ||
		!bytes.Equal(again, results[0]) {
		t.Fatal("post-commit retry did not recover the original response")
	}
	revision, err := g.effectiveReleaseRevision(ctx, node, 1)
	requireFixture(t, err)
	if revision != target.SourceRevision {
		t.Fatal("normal control does not use the committed target revision")
	}
	tunnelEnvelope := func(path, revision string, body []byte) []byte {
		t.Helper()
		inner, err := json.Marshal(tunnelPayload{Path: path, BodyB64: b64.EncodeToString(body)})
		requireFixture(t, err)
		nonce := make([]byte, 16)
		_, err = rand.Read(nonce)
		requireFixture(t, err)
		now := time.Now().UnixMilli()
		env := envelope{
			Protocol: "XSP/2", Suite: suite, Direction: 1, MessageType: "node.product.tunnel",
			IssuerID: "xmesh-node-1", NodeID: 1, Method: http.MethodPost, Path: "/api/v2/product/tunnel",
			Ed25519KeyID: "ed-test", MLDSA65KeyID: "pq-test", KeyEpoch: 1, IssuedAtMS: now,
			ExpiresAtMS: now + 120000, NonceHex: fmt.Sprintf("%x", nonce), RequestID: "tunnel-test",
			Revision: revision, PayloadB64: b64.EncodeToString(inner),
		}
		signing, err := signingInput(env, inner)
		requireFixture(t, err)
		pqSignature, err := pq.Sign(nil, signing, nil)
		requireFixture(t, err)
		env.Signatures = signatures{Ed25519: b64.EncodeToString(ed25519.Sign(ed, signing)),
			MLDSA65: b64.EncodeToString(pqSignature)}
		raw, err := json.Marshal(env)
		requireFixture(t, err)
		return raw
	}
	invokeTunnel := func(raw []byte) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v2/product/tunnel", bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-XSP-V2-Client-Verify", "SUCCESS")
		req.Header.Set("X-XSP-V2-Client-Cert", url.QueryEscape(string(pem.EncodeToMemory(
			&pem.Block{Type: "CERTIFICATE", Bytes: certDER}))))
		res := httptest.NewRecorder()
		g.tunnel(res, req)
		return res
	}
	if res := invokeTunnel(tunnelEnvelope(releasePlanPath, current.SourceRevision, body)); res.Code != http.StatusConflict {
		t.Fatalf("superseded revision reached the tunnel: HTTP %d", res.Code)
	}
	packet := tunnelEnvelope(releaseCommitPath, target.SourceRevision, commitBody)
	res := invokeTunnel(packet)
	if res.Code != http.StatusOK {
		t.Fatalf("signed commit retry over the tunnel: HTTP %d %s", res.Code, res.Body)
	}
	wrapped, err := parseEnvelope(res.Body.Bytes(), "panel.product.tunnel-response", "/api/v2/product/tunnel", 2)
	requireFixture(t, err)
	var reply struct {
		Status  int    `json:"status"`
		BodyB64 string `json:"bodyB64"`
	}
	requireFixture(t, json.Unmarshal(wrapped.Payload, &reply))
	if wrapped.Env.Revision != target.SourceRevision || reply.Status != http.StatusOK ||
		reply.BodyB64 != b64.EncodeToString(results[0]) {
		t.Fatal("authenticated tunnel did not replay the same receipt")
	}
	if replay := invokeTunnel(packet); replay.Code != http.StatusConflict {
		t.Fatalf("byte-identical outer envelope passed the nonce gate: HTTP %d", replay.Code)
	}
	panel := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/node/heartbeat" {
			t.Errorf("unexpected forwarded path: %s", r.URL.Path)
		}
		var report struct {
			NodeID  int64  `json:"node_id"`
			Version string `json:"version"`
		}
		if err := json.NewDecoder(r.Body).Decode(&report); err != nil || report.NodeID != 1 ||
			report.Version != target.Version {
			t.Errorf("heartbeat disagrees with the committed image: %+v, %v", report, err)
		}
		_, _ = w.Write([]byte(`{"accepted":true}`))
	}))
	defer panel.Close()
	g.panelURL, g.httpClient = panel.URL, panel.Client()
	heartbeat := []byte(`{"node_id":1,"version":"control-v6.0.24"}`)
	hb := invokeTunnel(tunnelEnvelope("/api/v1/node/heartbeat", target.SourceRevision, heartbeat))
	if hb.Code != http.StatusOK {
		t.Fatalf("committed heartbeat refused: HTTP %d", hb.Code)
	}
	if status, _ := g.finishRelease(ctx, request, node, commitBody, true); status != http.StatusConflict {
		t.Fatal("an already committed release could be aborted")
	}
	var original, state, artifactSHA string
	requireFixture(t, db.QueryRow(ctx, `SELECT p.release_source_revision,c.state,c.release_ack_artifact_sha256
        FROM node_restart_commands c JOIN node_xsp_product_nodes p USING (node_id) WHERE c.id=2`).
		Scan(&original, &state, &artifactSHA))
	if original != current.SourceRevision || state != "succeeded" || artifactSHA != target.ArtifactSHA256 {
		t.Fatal("commit did not preserve enrollment and publish the matching ACK atomically")
	}
	exec("UPDATE node_xsp_public_keysets SET revoked_at=now() WHERE node_id=1 AND purpose='node_request'")
	if status, _ := g.commitRelease(ctx, commitRequest, node, commitBody); status != http.StatusConflict {
		t.Fatal("revoked enrollment recovered the receipt")
	}

	// The fresh release queue uses an exact approved newer manifest and
	// the original activation, not the legacy 6.0.24 bridge eligibility.
	var freshID int64
	requireFixture(t, db.QueryRow(ctx, "INSERT INTO panel_records(collection,data) VALUES('nodes','{}') RETURNING id").Scan(&freshID))
	exec("INSERT INTO node_metric_keys(node_id,public_key) VALUES($1,$2)", freshID, strings.Repeat("f", 64))
	freshPub, _, err := ed25519.GenerateKey(rand.Reader)
	requireFixture(t, err)
	freshPQ, err := mldsa.GenerateKey(mldsa.MLDSA65())
	requireFixture(t, err)
	exec(`INSERT INTO node_xsp_public_keysets
		(node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public)
		VALUES($1,'node_request',1,'ed-fresh','pq-fresh',$2,$3)`, freshID, []byte(freshPub), freshPQ.PublicKey().Bytes())
	freshReceipt := []byte("fresh activation envelope")
	freshDigest := sha256.Sum256(freshReceipt)
	freshSPKI := sha256.Sum256([]byte("fresh test TLS SPKI"))
	exec(`INSERT INTO node_xsp_product_nodes
		(node_id,state,key_epoch,ed25519_key_id,mldsa65_key_id,tls_spki_sha256,
		 release_version,release_source_revision,release_artifact_sha256,
		 receipt_sha256,receipt_envelope,activated_at)
		VALUES($1,'active',1,'ed-fresh','pq-fresh',$2,$3,$4,$5,$6,$7,now())`,
		freshID, freshSPKI[:], target.Version, target.SourceRevision, target.ArtifactSHA256, freshDigest[:], freshReceipt)
	successor := releaseIdentity{"control-v6.0.28", strings.Repeat("8", 40), strings.Repeat("9", 64)}
	exec(`INSERT INTO node_xsp_agent_release_manifests(version,source_revision,artifact_sha256,created_by)
		VALUES($1,$2,$3,'test-owner')`, successor.Version, successor.SourceRevision, successor.ArtifactSHA256)
	queue := func(version string) error {
		return db.QueryRow(ctx, "SELECT command_id FROM queue_node_xsp_product_first_successor($1,$2,'test-owner')",
			freshID, version).Scan(&command)
	}
	if err := queue(successor.Version); err == nil {
		t.Fatal("fresh successor queued without an authenticated heartbeat")
	}
	exec("INSERT INTO node_runtime_heartbeats(node_id,version,router_running,xray_running,received_at) VALUES($1,$2,true,true,now())",
		freshID, target.Version)
	for _, version := range []string{target.Version, "control-v6.0.26", "control-v6.0.29", "control-v6.0.028"} {
		if err := queue(version); err == nil {
			t.Fatalf("unapproved, identical or backward release queued: %s", version)
		}
	}
	exec("UPDATE panel_records SET data='{\"disabled\":true}' WHERE id=$1", freshID)
	if err := queue(successor.Version); err == nil {
		t.Fatal("disabled node received an update command")
	}
	exec("UPDATE panel_records SET data='{}' WHERE id=$1", freshID)
	exec("UPDATE node_runtime_heartbeats SET received_at=now()-interval '66 seconds' WHERE node_id=$1", freshID)
	if err := queue(successor.Version); err == nil {
		t.Fatal("stale heartbeat authorized an update")
	}
	exec("UPDATE node_runtime_heartbeats SET received_at=now(),version=$2 WHERE node_id=$1", freshID, "control-v6.0.26")
	if err := queue(successor.Version); err == nil {
		t.Fatal("mismatched heartbeat authorized an update")
	}
	exec("UPDATE node_runtime_heartbeats SET version=$2 WHERE node_id=$1", freshID, target.Version)
	requireFixture(t, queue(successor.Version))
	var queuedVersion, queuedRevision, queuedSHA string
	requireFixture(t, db.QueryRow(ctx, `SELECT c.target_version,m.source_revision,m.artifact_sha256
		FROM node_restart_commands c JOIN node_xsp_agent_release_manifests m ON m.id=c.release_manifest_id
		WHERE c.id=$1 AND c.node_id=$2 AND c.state='pending'`, command, freshID).
		Scan(&queuedVersion, &queuedRevision, &queuedSHA))
	if queuedVersion != successor.Version || queuedRevision != successor.SourceRevision || queuedSHA != successor.ArtifactSHA256 {
		t.Fatal("successor queue did not bind the immutable approved manifest")
	}
	if err := queue(successor.Version); err == nil {
		t.Fatal("duplicate active successor command accepted")
	}

}
