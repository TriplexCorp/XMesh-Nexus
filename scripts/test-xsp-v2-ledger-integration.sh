#!/usr/bin/env bash
set -euo pipefail
# Run ONLY against disposable CI PostgreSQL. Keys and signatures below are
# dummy bytes: this exercises SQL invariants, not cryptographic authorization.
node_id=912345678910
psql_cmd=(docker compose exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d xmesh)
cleanup(){
  "${psql_cmd[@]}" -q -c "DELETE FROM node_metric_keys WHERE node_id=$node_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT
assert_rejected(){
  local description="$1" sql="$2"
  if "${psql_cmd[@]}" -q -c "$sql" >/dev/null 2>&1; then
    printf 'FAIL: %s unexpectedly succeeded\n' "$description" >&2
    exit 1
  fi
}
"${psql_cmd[@]}" -q <<SQL
INSERT INTO node_metric_keys(node_id,public_key) VALUES ($node_id,repeat('ab',32));
INSERT INTO node_xsp_cutover_permit_ledger
 (node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,
  permit_input_sha256,signed_permit,issued_at,expires_at,issued_by)
 VALUES
 ($node_id,'cutover-one',1,2,decode(repeat('11',32),'hex'),
  decode(repeat('22',16),'hex'),decode(repeat('33',32),'hex'),
  convert_to('signed-permit-v1','UTF8'),NOW(),NOW()+INTERVAL '45 seconds',
  'owner-staging');
SQL
assert_rejected "concurrent outstanding permit" "
INSERT INTO node_xsp_cutover_permit_ledger
 (node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,
  permit_input_sha256,signed_permit,issued_at,expires_at,issued_by)
 VALUES
 ($node_id,'cutover-two',1,2,decode(repeat('44',32),'hex'),
  decode(repeat('55',16),'hex'),decode(repeat('66',32),'hex'),
  convert_to('signed-permit-v2','UTF8'),NOW(),NOW()+INTERVAL '45 seconds','owner-staging');"
assert_rejected "request replay" "
INSERT INTO node_xsp_cutover_permit_ledger
 (node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,
  permit_input_sha256,signed_permit,issued_at,expires_at,issued_by)
 VALUES
 ($node_id,'cutover-one',1,2,decode(repeat('44',32),'hex'),
  decode(repeat('55',16),'hex'),decode(repeat('66',32),'hex'),
  convert_to('signed-permit-v2','UTF8'),NOW(),NOW()+INTERVAL '45 seconds','owner-staging');"
assert_rejected "nonce replay" "
INSERT INTO node_xsp_cutover_permit_ledger
 (node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,
  permit_input_sha256,signed_permit,issued_at,expires_at,issued_by,state)
 VALUES
 ($node_id,'nonce-replay',1,2,decode(repeat('44',32),'hex'),
  decode(repeat('22',16),'hex'),decode(repeat('66',32),'hex'),
  convert_to('signed-permit-v2','UTF8'),NOW(),NOW()+INTERVAL '45 seconds','owner-staging','aborted');"
assert_rejected "permit digest replay" "
INSERT INTO node_xsp_cutover_permit_ledger
 (node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,
  permit_input_sha256,signed_permit,issued_at,expires_at,issued_by,state)
 VALUES
 ($node_id,'digest-replay',1,2,decode(repeat('44',32),'hex'),
  decode(repeat('55',16),'hex'),decode(repeat('33',32),'hex'),
  convert_to('signed-permit-v2','UTF8'),NOW(),NOW()+INTERVAL '45 seconds','owner-staging','aborted');"
assert_rejected "permit envelope rewrite" "
UPDATE node_xsp_cutover_permit_ledger SET signed_permit=convert_to('changed','UTF8')
 WHERE node_id=$node_id AND request_id='cutover-one';"
assert_rejected "nonce rewrite" "
UPDATE node_xsp_cutover_permit_ledger SET permit_nonce=decode(repeat('88',16),'hex')
 WHERE node_id=$node_id AND request_id='cutover-one';"
assert_rejected "ack without state transition" "
UPDATE node_xsp_cutover_permit_ledger SET signed_applied_ack=convert_to('pre-verified','UTF8')
 WHERE node_id=$node_id AND request_id='cutover-one';"
assert_rejected "receipt skips ACK" "
UPDATE node_xsp_cutover_permit_ledger SET state='receipt_sent',
  applied_ack_sha256=decode(repeat('e1',32),'hex'),
  signed_applied_ack=convert_to('signed-ack','UTF8'),
  ack_verified_at=NOW()
 WHERE node_id=$node_id AND request_id='cutover-one';"
"${psql_cmd[@]}" -q -c "
UPDATE node_xsp_cutover_permit_ledger
 SET state='ack_verified',
     applied_ack_sha256=decode(repeat('e1',32),'hex'),
     signed_applied_ack=convert_to('signed-ack','UTF8'),
     ack_verified_at=NOW()
 WHERE node_id=$node_id AND request_id='cutover-one';"
assert_rejected "ACK replacement" "
UPDATE node_xsp_cutover_permit_ledger
 SET signed_applied_ack=convert_to('replaced-ack','UTF8')
 WHERE node_id=$node_id AND request_id='cutover-one';"
assert_rejected "ACK hash replacement" "
UPDATE node_xsp_cutover_permit_ledger
 SET applied_ack_sha256=decode(repeat('e2',32),'hex')
 WHERE node_id=$node_id AND request_id='cutover-one';"
assert_rejected "epoch rollback after ACK" "
UPDATE node_xsp_cutover_permit_ledger SET from_epoch=0
 WHERE node_id=$node_id AND request_id='cutover-one';"
assert_rejected "state rollback after ACK" "
UPDATE node_xsp_cutover_permit_ledger SET state='issued',
  applied_ack_sha256=NULL,signed_applied_ack=NULL,ack_verified_at=NULL
 WHERE node_id=$node_id AND request_id='cutover-one';"
"${psql_cmd[@]}" -q -c "
UPDATE node_xsp_cutover_permit_ledger SET state='receipt_sent'
 WHERE node_id=$node_id AND request_id='cutover-one';"
assert_rejected "receipt rollback" "
UPDATE node_xsp_cutover_permit_ledger SET state='ack_verified'
 WHERE node_id=$node_id AND request_id='cutover-one';"
"${psql_cmd[@]}" -q -c "
INSERT INTO node_xsp_cutover_permit_ledger
 (node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,
  permit_input_sha256,signed_permit,issued_at,expires_at,issued_by)
 VALUES
 ($node_id,'cutover-abort',2,3,decode(repeat('a1',32),'hex'),
  decode(repeat('a2',16),'hex'),decode(repeat('a3',32),'hex'),
  convert_to('abortable-permit','UTF8'),NOW(),NOW()+INTERVAL '45 seconds',
  'owner-staging');
UPDATE node_xsp_cutover_permit_ledger SET state='aborted'
 WHERE node_id=$node_id AND request_id='cutover-abort';"
assert_rejected "abort resurrection" "
UPDATE node_xsp_cutover_permit_ledger SET state='issued'
 WHERE node_id=$node_id AND request_id='cutover-abort';"
assert_rejected "aborted permit rewrite" "
UPDATE node_xsp_cutover_permit_ledger SET signed_permit=convert_to('resurrected','UTF8')
 WHERE node_id=$node_id AND request_id='cutover-abort';"
state="$("${psql_cmd[@]}" -Atq -c "
 SELECT string_agg(request_id || ':' || state, ',' ORDER BY request_id)
 FROM node_xsp_cutover_permit_ledger WHERE node_id=$node_id;")"
if [[ "$state" != "cutover-abort:aborted,cutover-one:receipt_sent" ]]; then
  printf 'FAIL: unexpected ledger state: %s\n' "$state" >&2;exit 1
fi
echo 'XSP-v2 staging ledger: uniqueness, immutability and monotonic transitions PASS'
