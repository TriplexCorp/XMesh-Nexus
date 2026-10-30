#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${NODE_REPO:?NODE_REPO is required}"

node_id=4242
sentinel='CANARY_SECRET_MUST_NOT_APPEAR'

# Node-local observability: use the exact current reviewed Node source and prove
# both the default-off gate and the real read-only/redaction tests.
pushd "$NODE_REPO/agent/xspv2" >/dev/null
go test ./observability -count=1
go build -trimpath -o /tmp/xmesh-agent-xspv2-observe ./cmd/xmesh-agent-xspv2-observe
if /tmp/xmesh-agent-xspv2-observe --state-root /tmp/nonexistent >/tmp/node-observe-off.out 2>/tmp/node-observe-off.err; then
  echo 'Node observability unexpectedly ran without exact staging-only gate' >&2
  exit 1
fi
grep -Fxq 'XSP_V2_OBSERVABILITY must equal staging-only' /tmp/node-observe-off.err
test ! -s /tmp/node-observe-off.out
popd >/dev/null

# Nexus durable-state observability: build the real feature-gated binary, seed a
# disposable schema with replayable/secret sentinels, prove output redaction and
# prove that the read leaves the durable tuple byte-for-byte/logically unchanged.
cargo build --manifest-path backend/Cargo.toml --features xsp-v2-observability --bin xsp-v2-observability

if backend/target/debug/xsp-v2-observability --node-id "$node_id" >/tmp/nexus-observe-off.out 2>/tmp/nexus-observe-off.err; then
  echo 'Nexus observability unexpectedly ran without exact staging-only gate' >&2
  exit 1
fi
grep -Fxq 'XSP_V2_OBSERVABILITY must equal staging-only' /tmp/nexus-observe-off.err
test ! -s /tmp/nexus-observe-off.out

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
CREATE TABLE node_xsp_suite_state (
  node_id BIGINT PRIMARY KEY, minimum_suite SMALLINT NOT NULL,
  activation_phase TEXT NOT NULL, key_epoch BIGINT NOT NULL,
  last_verified_revision TEXT, updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE node_xsp_rotation_preparations (
  node_id BIGINT NOT NULL, purpose TEXT NOT NULL, from_epoch BIGINT NOT NULL,
  to_epoch BIGINT NOT NULL, ed25519_key_id TEXT NOT NULL, mldsa65_key_id TEXT NOT NULL,
  ed25519_public TEXT NOT NULL, mldsa65_public TEXT NOT NULL,
  challenge_sha256 TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL, proved_at TIMESTAMPTZ,
  PRIMARY KEY(node_id,purpose)
);
CREATE TABLE node_xsp_cutover_permit_ledger (
  node_id BIGINT NOT NULL, request_id TEXT NOT NULL, state TEXT NOT NULL,
  permit_nonce TEXT NOT NULL, permit_input_sha256 TEXT NOT NULL,
  signed_permit TEXT NOT NULL, applied_ack_sha256 TEXT,
  signed_applied_ack TEXT, ack_verified_at TIMESTAMPTZ,
  PRIMARY KEY(node_id,request_id)
);
CREATE TABLE node_xsp_signed_commit_receipt_outbox (
  node_id BIGINT NOT NULL, request_id TEXT NOT NULL, signed_receipt_sha256 TEXT NOT NULL,
  signed_receipt TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(node_id,request_id)
);
CREATE TABLE node_xsp_replay_nonces (
  node_id BIGINT NOT NULL, nonce TEXT NOT NULL, request_id TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE node_restart_commands (
  node_id BIGINT NOT NULL, action TEXT NOT NULL, state TEXT NOT NULL,
  release_manifest_id BIGINT, release_ack_received_at TIMESTAMPTZ,
  release_ack_version TEXT, release_ack_source_revision TEXT,
  release_ack_artifact_sha256 TEXT, result TEXT NOT NULL
);

INSERT INTO node_xsp_suite_state VALUES
  ($node_id,2,'strict',7,'$sentinel',to_timestamp(1700000000));
INSERT INTO node_xsp_rotation_preparations VALUES
  ($node_id,'node_request',7,8,'ed-next','pq-next','$sentinel','$sentinel',
   '$sentinel',to_timestamp(1700000000),to_timestamp(1700000300),to_timestamp(1700000010));
INSERT INTO node_xsp_cutover_permit_ledger VALUES
  ($node_id,'$sentinel-req1','issued','$sentinel-nonce1','$sentinel-hash1','$sentinel-permit1',NULL,NULL,NULL),
  ($node_id,'$sentinel-req2','ack_verified','$sentinel-nonce2','$sentinel-hash2','$sentinel-permit2','$sentinel-ackhash2','$sentinel-ack2',to_timestamp(1700000020)),
  ($node_id,'$sentinel-req3','receipt_sent','$sentinel-nonce3','$sentinel-hash3','$sentinel-permit3','$sentinel-ackhash3','$sentinel-ack3',to_timestamp(1700000030)),
  ($node_id,'$sentinel-req4','aborted','$sentinel-nonce4','$sentinel-hash4','$sentinel-permit4',NULL,NULL,NULL);
INSERT INTO node_xsp_signed_commit_receipt_outbox VALUES
  ($node_id,'$sentinel-req3','$sentinel-receipt-hash','$sentinel-receipt',to_timestamp(1700000040));
INSERT INTO node_xsp_replay_nonces VALUES
  ($node_id,'$sentinel-replay1','$sentinel-replay-req1',to_timestamp(1700000050)),
  ($node_id,'$sentinel-replay2','$sentinel-replay-req2',to_timestamp(1700000060));
INSERT INTO node_restart_commands VALUES
  ($node_id,'update_agent','pending',1,NULL,NULL,NULL,NULL,'$sentinel-result1'),
  ($node_id,'update_agent','succeeded',1,to_timestamp(1700000070),'$sentinel-version','$sentinel-source','$sentinel-artifact','$sentinel-result2'),
  ($node_id,'restart_xray','failed',NULL,NULL,NULL,NULL,NULL,'$sentinel-result3');
SQL

snapshot_sql="SELECT string_agg(v,'|' ORDER BY v) FROM (
  SELECT 'suite:'||node_id||':'||key_epoch||':'||COALESCE(last_verified_revision,'') v FROM node_xsp_suite_state
  UNION ALL SELECT 'permit:'||node_id||':'||state||':'||request_id FROM node_xsp_cutover_permit_ledger
  UNION ALL SELECT 'receipt:'||node_id||':'||request_id||':'||signed_receipt FROM node_xsp_signed_commit_receipt_outbox
  UNION ALL SELECT 'replay:'||node_id||':'||nonce||':'||request_id FROM node_xsp_replay_nonces
  UNION ALL SELECT 'cmd:'||node_id||':'||action||':'||state||':'||result FROM node_restart_commands
) s"
before="$(psql "$DATABASE_URL" -Atc "$snapshot_sql")"
XSP_V2_OBSERVABILITY=staging-only backend/target/debug/xsp-v2-observability --node-id "$node_id" > /tmp/nexus-observe.json
after="$(psql "$DATABASE_URL" -Atc "$snapshot_sql")"
test "$before" = "$after"
! grep -Fq "$sentinel" /tmp/nexus-observe.json

python3 - <<'PY'
import json
x=json.load(open('/tmp/nexus-observe.json', encoding='utf-8'))
assert x['schema']=='xsp2-nexus-observability-1'
assert x['nodeId']==4242
assert x['suite']=={'minimumSuite':2,'activationPhase':'strict','keyEpoch':7,'updatedAtMs':1700000000000}
assert x['preparation']=={'fromEpoch':7,'toEpoch':8,'ed25519KeyId':'ed-next','mldsa65KeyId':'pq-next','proved':True,'expiresAtMs':1700000300000}
assert x['permits']=={'total':4,'issued':1,'ackVerified':1,'receiptSent':1,'aborted':1,'latestAckVerifiedAtMs':1700000030000}
assert x['durable']=={'receiptOutbox':1,'replayNonces':2,'latestReceiptAtMs':1700000040000}
assert x['agentUpdates']=={'total':2,'pending':1,'claimed':0,'succeeded':1,'failed':0,'exactAckEvidence':1}
assert x['readOnly'] is True
assert x['productionActivated'] is False
assert x['strictPqEnabled'] is False
assert set(x)=={'schema','nodeId','suite','preparation','permits','durable','agentUpdates','readOnly','productionActivated','strictPqEnabled'}
PY

echo 'PASS: disposable canary observability is default-off, read-only and redacted on both Node-local and Nexus durable-state surfaces.'
