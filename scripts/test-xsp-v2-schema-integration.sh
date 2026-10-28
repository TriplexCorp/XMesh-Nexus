#!/usr/bin/env bash
set -euo pipefail
# Only run inside disposable CI Compose. Public dummy key bytes only.
node_id=912345678909
psql_cmd=(docker compose exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d xmesh)
cleanup(){ "${psql_cmd[@]}" -q -c "DELETE FROM node_metric_keys WHERE node_id = $node_id" >/dev/null 2>&1 || true; }
trap cleanup EXIT
"${psql_cmd[@]}" -q <<SQL
INSERT INTO node_metric_keys(node_id,public_key) VALUES ($node_id,repeat('ab',32));
INSERT INTO node_xsp_suite_state(node_id,minimum_suite,activation_phase,key_epoch)
 VALUES($node_id,1,'legacy',0);
INSERT INTO node_xsp_public_keysets(node_id,purpose,key_epoch,ed25519_key_id,
 mldsa65_key_id,ed25519_public,mldsa65_public)
 VALUES($node_id,'node_request',1,'ed-test','pq-test',
 decode(repeat('aa',32),'hex'),decode(repeat('bb',1952),'hex'));
INSERT INTO node_xsp_replay_nonces(node_id,key_epoch,direction,nonce,request_id)
 VALUES($node_id,1,1,decode(repeat('cc',16),'hex'),'test-1');
INSERT INTO node_xsp_key_enrollment_approvals
 (node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,
  ed25519_public,mldsa65_public,challenge_sha256,approved_by,expires_at)
 VALUES ($node_id,'node_request',2,'ed-new','pq-new',
 decode(repeat('ab',32),'hex'),decode(repeat('cd',1952),'hex'),
 decode(repeat('ef',32),'hex'),'owner-test',NOW()+INTERVAL '9 minutes');
INSERT INTO node_xsp_rotation_preparations
 (node_id,from_epoch,to_epoch,ed25519_key_id,mldsa65_key_id,
  ed25519_public,mldsa65_public,challenge_sha256,approved_by,expires_at)
 VALUES($node_id,1,2,'ed-prepared','pq-prepared',
 decode(repeat('a1',32),'hex'),decode(repeat('b2',1952),'hex'),
 decode(repeat('c3',32),'hex'),'owner-test',NOW()+INTERVAL '9 minutes');
UPDATE node_xsp_suite_state SET minimum_suite=2,activation_phase='strict',
 key_epoch=1 WHERE node_id=$node_id;
SQL
assert_rejected(){
 local description="$1" sql="$2"
 if "${psql_cmd[@]}" -q -c "$sql" >/dev/null 2>&1; then
   printf 'FAIL: %s unexpectedly succeeded\n' "$description" >&2
   exit 1
 fi
}
assert_rejected "suite downgrade" "UPDATE node_xsp_suite_state SET minimum_suite=1,activation_phase='legacy' WHERE node_id=$node_id;"
assert_rejected "epoch rollback" "UPDATE node_xsp_suite_state SET key_epoch=0 WHERE node_id=$node_id;"
assert_rejected "strict rollback" "UPDATE node_xsp_suite_state SET activation_phase='shadow' WHERE node_id=$node_id;"
assert_rejected "duplicate nonce" "INSERT INTO node_xsp_replay_nonces(node_id,key_epoch,direction,nonce,request_id) VALUES($node_id,1,1,decode(repeat('cc',16),'hex'),'duplicate');"
assert_rejected "expired or overlong approval" "INSERT INTO node_xsp_key_enrollment_approvals(node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public,challenge_sha256,approved_by,expires_at) VALUES($node_id,'panel_response',1,'expired-ed','expired-pq',decode(repeat('aa',32),'hex'),decode(repeat('bb',1952),'hex'),decode(repeat('cc',32),'hex'),'owner-test',NOW()+INTERVAL '11 minutes');"
assert_rejected "wrong challenge digest size" "INSERT INTO node_xsp_key_enrollment_approvals(node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public,challenge_sha256,approved_by,expires_at) VALUES($node_id,'panel_response',1,'short-ed','short-pq',decode(repeat('aa',32),'hex'),decode(repeat('bb',1952),'hex'),decode('cc','hex'),'owner-test',NOW()+INTERVAL '9 minutes');"
assert_rejected "duplicate owner approval" "INSERT INTO node_xsp_key_enrollment_approvals(node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public,challenge_sha256,approved_by,expires_at) VALUES($node_id,'node_request',2,'replay-ed','replay-pq',decode(repeat('aa',32),'hex'),decode(repeat('bb',1952),'hex'),decode(repeat('cc',32),'hex'),'owner-test',NOW()+INTERVAL '9 minutes');"
assert_rejected "rotation proposal duplicate" "INSERT INTO node_xsp_rotation_preparations(node_id,from_epoch,to_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public,challenge_sha256,approved_by,expires_at) VALUES($node_id,1,2,'ed-double','pq-double',decode(repeat('a1',32),'hex'),decode(repeat('b2',1952),'hex'),decode(repeat('c3',32),'hex'),'owner-test',NOW()+INTERVAL '9 minutes');"
assert_rejected "rotation epoch skip" "INSERT INTO node_xsp_rotation_preparations(node_id,purpose,from_epoch,to_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public,challenge_sha256,approved_by,expires_at) VALUES($node_id,'panel_response',1,3,'ed-skip','pq-skip',decode(repeat('a1',32),'hex'),decode(repeat('b2',1952),'hex'),decode(repeat('c3',32),'hex'),'owner-test',NOW()+INTERVAL '9 minutes');"
assert_rejected "rotation overlong challenge" "UPDATE node_xsp_rotation_preparations SET expires_at=created_at+INTERVAL '11 minutes' WHERE node_id=$node_id;"
assert_rejected "rotation raw challenge size" "UPDATE node_xsp_rotation_preparations SET challenge_sha256=decode('aa','hex') WHERE node_id=$node_id;"
assert_rejected "invalid public key size" "INSERT INTO node_xsp_public_keysets(node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public) VALUES($node_id,'panel_response',1,'bad-ed','bad-pq',decode('ab','hex'),decode(repeat('bb',1952),'hex'));"
state="$("${psql_cmd[@]}" -Atq -c "SELECT minimum_suite || ':' || activation_phase || ':' || key_epoch FROM node_xsp_suite_state WHERE node_id=$node_id;")"
if [[ "$state" != "2:strict:1" ]]; then echo "FAILED unexpected floor: $state" >&2; exit 1; fi

echo 'XSP-v2 schema: downgrade, replay, public key length constraints passed.'

# P0-D release identity is a separate inert append-only foundation, but run it
# in this same disposable PostgreSQL checkpoint so migration invariants are real.
bash -n scripts/test-xsp-agent-release-manifest-integration.sh
bash scripts/test-xsp-agent-release-manifest-integration.sh
