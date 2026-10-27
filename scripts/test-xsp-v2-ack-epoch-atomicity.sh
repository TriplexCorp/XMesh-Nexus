#!/usr/bin/env bash
set -euo pipefail
# Disposable CI PostgreSQL ONLY. Public keys and signed permit/ACK are DUMMY
# bytes; these SQL tests do NOT authenticate Ed25519 or ML-DSA. The Rust
# verifier does that before invoking any atomic transaction.
node_id=912345678956
psql_cmd=(docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d xmesh)
cleanup() { "${psql_cmd[@]}" -c "DELETE FROM node_metric_keys WHERE node_id=$node_id" >/dev/null 2>&1 || true; }
trap cleanup EXIT
assert_rejected() {
  local name="$1" sql="$2"
  if "${psql_cmd[@]}" -c "$sql" >/dev/null 2>&1; then
    printf 'FAIL: %s unexpectedly accepted\n' "$name" >&2
    exit 1
  fi
}
"${psql_cmd[@]}" <<SQL
INSERT INTO node_metric_keys(node_id,public_key)
VALUES($node_id,repeat('ab',32));
INSERT INTO node_xsp_suite_state(node_id,minimum_suite,activation_phase,key_epoch)
VALUES($node_id,1,'dual_enrolled',1);
INSERT INTO node_xsp_public_keysets
(node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public)
VALUES($node_id,'node_request',1,'ed-old-sql','pq-old-sql',
 decode(repeat('11',32),'hex'),decode(repeat('22',1952),'hex'));
INSERT INTO node_xsp_rotation_preparations
(node_id,from_epoch,to_epoch,ed25519_key_id,mldsa65_key_id,
 ed25519_public,mldsa65_public,challenge_sha256,approved_by,expires_at,proved_at)
VALUES($node_id,1,2,'ed-new-sql','pq-new-sql',
 decode(repeat('33',32),'hex'),decode(repeat('44',1952),'hex'),
 decode(repeat('55',32),'hex'),'ci-owner',NOW()+INTERVAL '5 minutes',NOW());
INSERT INTO node_xsp_cutover_permit_ledger
(node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,
 permit_input_sha256,signed_permit,issued_at,expires_at,issued_by)
VALUES($node_id,'ack-cas-test',1,2,decode(repeat('66',32),'hex'),
 decode(repeat('77',16),'hex'),decode(repeat('88',32),'hex'),
 convert_to('dummy-signed-permit','UTF8'),NOW(),NOW()+INTERVAL '30 seconds','ci-owner');
SQL

commit_sql=$(cat <<SQL
INSERT INTO node_xsp_replay_nonces(node_id,key_epoch,direction,nonce,request_id)
VALUES($node_id,2,1,decode(repeat('99',16),'hex'),'ack-cas-test');
INSERT INTO node_xsp_public_keysets
(node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public)
SELECT node_id,purpose,to_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public
FROM node_xsp_rotation_preparations
WHERE node_id=$node_id AND purpose='node_request'
  AND from_epoch=1 AND to_epoch=2 AND proved_at IS NOT NULL AND expires_at>NOW();
UPDATE node_xsp_suite_state SET key_epoch=2
WHERE node_id=$node_id AND key_epoch=1 AND minimum_suite=1
 AND activation_phase IN ('dual_enrolled','shadow');
UPDATE node_xsp_cutover_permit_ledger
SET state='ack_verified',applied_ack_sha256=decode(repeat('aa',32),'hex'),
 signed_applied_ack=convert_to('dummy-dual-signed-ack','UTF8'),
 ack_verified_at=GREATEST(NOW(),issued_at)
WHERE node_id=$node_id AND request_id='ack-cas-test' AND state='issued'
 AND from_epoch=1 AND to_epoch=2 AND issued_at<=NOW();
SQL
)

# Simulates fault just before transaction commit: NO partial public keyset,
# suite epoch, ACK bytes or nonce must survive the rollback.
"${psql_cmd[@]}" <<SQL
BEGIN;
$commit_sql
ROLLBACK;
SQL
uncommitted=$("${psql_cmd[@]}" -At -c "
SELECT s.key_epoch||':'||l.state||':'||
 (SELECT count(*) FROM node_xsp_public_keysets WHERE node_id=$node_id AND key_epoch=2)||':'||
 (SELECT count(*) FROM node_xsp_replay_nonces WHERE node_id=$node_id)
FROM node_xsp_suite_state s
JOIN node_xsp_cutover_permit_ledger l USING(node_id)
WHERE s.node_id=$node_id;")
[[ "$uncommitted" == "1:issued:0:0" ]] || {
  echo "FAIL rollback leaked partial ACK/epoch effects: $uncommitted" >&2; exit 1;
}

"${psql_cmd[@]}" <<SQL
BEGIN;
$commit_sql
COMMIT;
SQL
committed=$("${psql_cmd[@]}" -At -c "
SELECT s.key_epoch||':'||l.state||':'||
 (SELECT count(*) FROM node_xsp_public_keysets WHERE node_id=$node_id AND revoked_at IS NULL)||':'||
 (SELECT count(*) FROM node_xsp_replay_nonces WHERE node_id=$node_id)
FROM node_xsp_suite_state s
JOIN node_xsp_cutover_permit_ledger l USING(node_id)
WHERE s.node_id=$node_id;")
[[ "$committed" == "2:ack_verified:2:1" ]] || {
  echo "FAIL atomic commit missing epoch/ACK/replay/old key: $committed" >&2; exit 1;
}
assert_rejected 'replayed ACK nonce after commit' "INSERT INTO node_xsp_replay_nonces(node_id,key_epoch,direction,nonce,request_id) VALUES($node_id,2,1,decode(repeat('99',16),'hex'),'other-request');"
assert_rejected 'ACK replacement after commit' "UPDATE node_xsp_cutover_permit_ledger SET signed_applied_ack=convert_to('replacement','UTF8') WHERE node_id=$node_id;"
assert_rejected 'epoch rollback after commit' "UPDATE node_xsp_suite_state SET key_epoch=1 WHERE node_id=$node_id;"
echo 'PASS: disposable PostgreSQL rollback, atomic ACK/epoch/nonce commit, old public-key retention'
