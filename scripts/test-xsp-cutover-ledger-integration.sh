#!/usr/bin/env bash
set -euo pipefail
# Disposable CI database only. All signatures and hashes below are deliberately
# FAKE test bytes: these tests cover SQL state invariants, not cryptography.
node_id=912345678910
psql_cmd=(docker compose exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d xmesh)
cleanup(){ "${psql_cmd[@]}" -q -c "DELETE FROM node_metric_keys WHERE node_id=$node_id" >/dev/null 2>&1 || true; }
trap cleanup EXIT
assert_rejected(){
  local label="$1" statement="$2"
  if "${psql_cmd[@]}" -q -c "$statement" >/dev/null 2>&1; then
    printf 'FAIL: %s was accepted\n' "$label" >&2
    exit 1
  fi
}
"${psql_cmd[@]}" -q <<SQL
INSERT INTO node_metric_keys(node_id,public_key) VALUES($node_id,repeat('ab',32));
INSERT INTO node_xsp_cutover_permit_ledger
(node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,
 permit_input_sha256,signed_permit,issued_at,expires_at,issued_by)
VALUES
($node_id,'request-1',1,2,decode(repeat('11',32),'hex'),
 decode(repeat('22',16),'hex'),decode(repeat('33',32),'hex'),
 decode(repeat('44',50),'hex'),NOW(),NOW()+INTERVAL '40 seconds','ci-owner');
SQL
assert_rejected 'duplicate request' "INSERT INTO node_xsp_cutover_permit_ledger (node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,permit_input_sha256,signed_permit,issued_at,expires_at,issued_by) SELECT node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,permit_input_sha256,signed_permit,issued_at,expires_at,issued_by FROM node_xsp_cutover_permit_ledger WHERE node_id=$node_id;"
assert_rejected 'concurrent active permit' "INSERT INTO node_xsp_cutover_permit_ledger (node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,permit_input_sha256,signed_permit,issued_at,expires_at,issued_by) VALUES($node_id,'request-2',1,2,decode(repeat('55',32),'hex'),decode(repeat('66',16),'hex'),decode(repeat('77',32),'hex'),decode(repeat('88',50),'hex'),NOW(),NOW()+INTERVAL '40 seconds','ci-owner');"
assert_rejected 'modify signed permit' "UPDATE node_xsp_cutover_permit_ledger SET signed_permit=decode('aa','hex') WHERE node_id=$node_id;"
assert_rejected 'modify candidate digest' "UPDATE node_xsp_cutover_permit_ledger SET candidate_sha256=decode(repeat('aa',32),'hex') WHERE node_id=$node_id;"
assert_rejected 'modify permit expiry' "UPDATE node_xsp_cutover_permit_ledger SET expires_at=expires_at-INTERVAL '1 second' WHERE node_id=$node_id;"
assert_rejected 'ack before verified transition' "UPDATE node_xsp_cutover_permit_ledger SET signed_applied_ack=decode('aa','hex') WHERE node_id=$node_id;"
assert_rejected 'invalid direct receipt' "UPDATE node_xsp_cutover_permit_ledger SET state='receipt_sent' WHERE node_id=$node_id;"
"${psql_cmd[@]}" -q -c "UPDATE node_xsp_cutover_permit_ledger SET state='ack_verified',applied_ack_sha256=decode(repeat('99',32),'hex'),signed_applied_ack=decode(repeat('aa',50),'hex'),ack_verified_at=NOW() WHERE node_id=$node_id;"
assert_rejected 'replace committed ack bytes' "UPDATE node_xsp_cutover_permit_ledger SET signed_applied_ack=decode(repeat('bb',50),'hex') WHERE node_id=$node_id;"
assert_rejected 'replace committed ack hash' "UPDATE node_xsp_cutover_permit_ledger SET applied_ack_sha256=decode(repeat('bb',32),'hex') WHERE node_id=$node_id;"
assert_rejected 'rollback committed ack' "UPDATE node_xsp_cutover_permit_ledger SET state='issued' WHERE node_id=$node_id;"
"${psql_cmd[@]}" -q -c "UPDATE node_xsp_cutover_permit_ledger SET state='receipt_sent' WHERE node_id=$node_id;"
assert_rejected 'receipt rollback' "UPDATE node_xsp_cutover_permit_ledger SET state='ack_verified' WHERE node_id=$node_id;"
state=$("${psql_cmd[@]}" -Atq -c "SELECT state FROM node_xsp_cutover_permit_ledger WHERE node_id=$node_id AND request_id='request-1'")
[[ "$state" == 'receipt_sent' ]] || { echo "FAIL: unexpected final state $state" >&2; exit 1; }
# Cleanup via FK cascade is intentionally permitted for administrative deletion.
# This is not append-only/replay-safe; restrict DB delete privileges separately.
echo 'PASS staging permit ledger: exact bytes, ACK immutability and monotonic transitions'
