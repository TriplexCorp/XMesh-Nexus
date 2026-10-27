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

# Keep this a schema/transaction stress test with DUMMY signatures. The full
# Rust dual-signature verifier is NOT invoked by psql.
statement_count=$(printf '%s\n' "$commit_sql" | grep -cE ';[[:space:]]*
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

# Two connections race on the SAME authenticated ACK identity. Session 1
# inserts the nonce, advertises readiness with an advisory transaction lock,
# then pauses before its remaining writes. Session 2 must never commit a
# second epoch transition; it waits on the conflicting unique nonce.
first_step=$(printf '%s\n' "$commit_sql" | awk '
  { print; if ($0 ~ /;[[:space:]]*$/) exit }')
remaining_steps=$(printf '%s\n' "$commit_sql" | awk '
  { if (count >= 1) print; if ($0 ~ /;[[:space:]]*$/) count++ }')
race_log=$(mktemp)
trap 'rm -f "$race_log"; cleanup' EXIT
"${psql_cmd[@]}" -c "BEGIN; SET LOCAL statement_timeout = '20s';
$first_step
SELECT pg_advisory_xact_lock(912345678);
SELECT pg_sleep(3);
$remaining_steps
COMMIT;" >"$race_log" 2>&1 &
first_pid=$!
ready=0
for _ in $(seq 1 60); do
  held=$("${psql_cmd[@]}" -At -c "SELECT count(*) FROM pg_locks
    WHERE locktype='advisory' AND objid=912345678 AND granted;")
  if [[ "$held" == "1" ]]; then ready=1; break; fi
  if ! kill -0 "$first_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$ready" != "1" ]]; then
  wait "$first_pid" || true
  cat "$race_log" >&2
  echo 'FAIL: first transaction never acquired its ready advisory lock' >&2
  exit 1
fi
assert_rejected 'concurrent duplicate ACK commit' \
  "SET statement_timeout = '20s'; BEGIN; $commit_sql COMMIT;"
if ! wait "$first_pid"; then
  cat "$race_log" >&2
  echo 'FAIL: first ACK transaction did not commit' >&2
  exit 1
fi
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
echo 'PASS: disposable PostgreSQL four fault boundaries, parallel duplicate ACK, atomic nonce/epoch commit, old-key retention'
)
[[ "$statement_count" == "4" ]] || {
  echo "FAIL: ACK commit SQL changed: expected four statements, found $statement_count" >&2
  exit 1
}
assert_precommit_clean() {
  local actual
  actual=$("${psql_cmd[@]}" -At -c "
    SELECT s.key_epoch||':'||l.state||':'||
      (SELECT count(*) FROM node_xsp_public_keysets WHERE node_id=$node_id AND key_epoch=2)||':'||
      (SELECT count(*) FROM node_xsp_replay_nonces WHERE node_id=$node_id)
    FROM node_xsp_suite_state s
    JOIN node_xsp_cutover_permit_ledger l USING(node_id)
    WHERE s.node_id=$node_id;")
  [[ "$actual" == "1:issued:0:0" ]] || {
    echo "FAIL: partially applied ACK/epoch/nonce survived: $actual" >&2
    exit 1
  }
}
# Exercise a transaction abort at EACH SQL boundary. With ON_ERROR_STOP, the
# connection exits in an aborted transaction; Postgres must roll it all back.
# This does not simulate SIGKILL/power loss or run the Rust helper.
for fail_after in 1 2 3 4; do
  prefix=$(printf '%s\n' "$commit_sql" | awk -v wanted="$fail_after" '
    { print; if ($0 ~ /;[[:space:]]*$/) { count++; if (count == wanted) exit } }')
  assert_rejected "forced SQL fault after statement $fail_after" \
    "BEGIN; $prefix SELECT 1 / (SELECT 0); COMMIT;"
  assert_precommit_clean
done

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
