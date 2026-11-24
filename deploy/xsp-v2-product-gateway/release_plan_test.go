package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/mldsa"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
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
	for _, prefix := range []string{"0001", "0012", "0019", "0020", "0023", "0024", "0099", "0107", "0108", "0109", "0110", "0163"} {
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
	exec("INSERT INTO panel_records(collection,data) VALUES('nodes','{}')")
	exec("INSERT INTO node_metric_keys(node_id,public_key) VALUES(1,$1)", strings.Repeat("e", 64))
	exec(`INSERT INTO node_xsp_public_keysets
		(node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public)
		VALUES(1,'node_request',1,'ed-test','pq-test',$1,$2)`, []byte(pub), pq.PublicKey().Bytes())
	exec(`INSERT INTO node_xsp_product_nodes (node_id,state,key_epoch,ed25519_key_id,mldsa65_key_id,
		tls_spki_sha256,release_version,release_source_revision,release_artifact_sha256,
		receipt_sha256,receipt_envelope,activated_at)
		VALUES(1,'active',1,'ed-test','pq-test',$1,$2,$3,$4,$5,$6,now())`,
		make([]byte, 32), current.Version, current.SourceRevision, current.ArtifactSHA256, digest[:], receipt)
	exec(`INSERT INTO node_xsp_agent_release_manifests(version,source_revision,artifact_sha256,created_by)
		VALUES($1,$2,$3,'test-owner')`, target.Version, target.SourceRevision, target.ArtifactSHA256)
	exec("SELECT * FROM stage_node_xsp_agent_migration(1,$1,'test-owner')", target.Version)
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
}
