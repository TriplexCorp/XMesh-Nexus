#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const sql=fs.readFileSync('backend/migrations/0099_node_xsp_v2_public_state.sql','utf8');
const migrationVersions=fs.readdirSync('backend/migrations').filter(name=>/^\d{4}_.+\.sql$/.test(name)).map(name=>Number(name.slice(0,4)));
assert(migrationVersions.includes(104) && migrationVersions.includes(105) && migrationVersions.includes(106),
 'Signed receipt migration chain 0104 -> 0105 -> 0106 must remain present');
assert.equal(migrationVersions.filter(version=>version===102).length,1,'Expected one migration version 0102');

assert.equal(migrationVersions.filter(version=>version===103).length,1,'Expected one migration version 0103');
const ledger=fs.readFileSync('backend/migrations/0103_node_xsp_cutover_permit_ledger.sql','utf8');
assert.match(ledger,/CREATE TABLE node_xsp_cutover_permit_ledger/);
assert.match(ledger,/UNIQUE \(node_id, permit_nonce\)/);
assert.match(ledger,/UNIQUE \(node_id, permit_input_sha256\)/);
assert.match(ledger,/PRIMARY KEY \(node_id, request_id\)/);
assert.match(ledger,/CREATE UNIQUE INDEX node_xsp_cutover_one_issued_per_node/);
assert.match(ledger,/octet_length\(signed_permit\) BETWEEN 1 AND 16384/);
assert.match(ledger,/state IN \('issued','ack_verified','receipt_sent','aborted'\)/);
assert.match(ledger,/INTERVAL '60 seconds'/);
assert(!/private_key|private_seed|plaintext_secret/i.test(ledger.replace(/--[^\n]*/g,'')),
    'The signed permit ledger must never persist private keys');
assert(!/\b(?:UPDATE|DELETE)\s+node_xsp_(?:suite_state|public_keysets)\b/i.test(ledger.replace(/--[^\n]*/g,'')),
    'The passive ledger must never change the trusted epoch or public keys');

assert.equal(migrationVersions.filter(version=>version===104).length,1,'Expected one migration version 0104');
const ledgerGuard=fs.readFileSync('backend/migrations/0104_node_xsp_cutover_ledger_immutability.sql','utf8');
assert.match(ledgerGuard,/CREATE FUNCTION xsp2_cutover_ledger_guard\(\) RETURNS TRIGGER/);
assert.match(ledgerGuard,/BEFORE UPDATE ON node_xsp_cutover_permit_ledger/);
assert.match(ledgerGuard,/NEW\.signed_permit, NEW\.issued_at, NEW\.expires_at/);
assert.match(ledgerGuard,/OLD\.signed_permit, OLD\.issued_at, OLD\.expires_at/);
assert.match(ledgerGuard,/NEW\.state NOT IN \('ack_verified', 'receipt_sent'\)/);
assert.match(ledgerGuard,/NEW\.state NOT IN \('issued', 'ack_verified', 'aborted'\)/);
assert.match(ledgerGuard,/NEW\.applied_ack_sha256, NEW\.signed_applied_ack/);
assert(!/\b(?:UPDATE|DELETE)\s+node_xsp_(?:suite_state|public_keysets)\b/i.test(ledgerGuard.replace(/--[^\n]*/g,'')),
    'Staging ledger guard must not rotate trusted keys or lower the floor');

assert.equal(migrationVersions.filter(version=>version===105).length,1,'Expected one immutable receipt outbox migration 0105');
const outbox=fs.readFileSync('backend/migrations/0105_node_xsp_signed_commit_receipt_outbox.sql','utf8');
assert.match(outbox,/CREATE TABLE node_xsp_signed_commit_receipt_outbox/);
assert.match(outbox,/PRIMARY KEY \(node_id,request_id\)/);
assert.match(outbox,/ON DELETE RESTRICT/);
assert.match(outbox,/CREATE FUNCTION xsp2_signed_receipt_outbox_guard\(\) RETURNS TRIGGER/);
assert.match(outbox,/BEFORE UPDATE OR DELETE ON node_xsp_signed_commit_receipt_outbox/);
assert.match(outbox,/committed\.state <> 'ack_verified'/);
assert.match(outbox,/committed\.applied_ack_sha256 IS DISTINCT FROM NEW\.applied_ack_sha256/);
assert(!/private_key|private_seed|plaintext_secret/i.test(outbox.replace(/--[^\n]*/g,'')),
  'Signed receipt outbox must not persist private keys');

assert.equal(migrationVersions.filter(version=>version===106).length,1,
 'Expected one migration version 0106');
const truncateGuard=fs.readFileSync('backend/migrations/0106_node_xsp_signed_receipt_truncate_guard.sql','utf8');
assert.match(truncateGuard,/BEFORE TRUNCATE ON node_xsp_signed_commit_receipt_outbox/);
assert.match(truncateGuard,/FOR EACH STATEMENT/);
assert.match(truncateGuard,/CREATE FUNCTION xsp2_signed_receipt_outbox_deny_truncate\(\) RETURNS TRIGGER/);
assert.match(truncateGuard,/REVOKE TRUNCATE ON node_xsp_signed_commit_receipt_outbox FROM PUBLIC/);
assert(!/private_key|private_seed|plaintext_secret/i.test(truncateGuard.replace(/--[^\n]*/g,'')),
 'Receipt truncate guard may not persist private keys');

const rotations=fs.readFileSync('backend/migrations/0102_node_xsp_rotation_preparations.sql','utf8');
assert.match(rotations,/CREATE TABLE node_xsp_rotation_preparations/);
assert.match(rotations,/proved_at TIMESTAMPTZ/);
assert.match(rotations,/CHECK \(to_epoch = from_epoch \+ 1\)/);
assert(!/private_key|private_seed|password/.test(rotations.replace(/--[^\n]*/g,'')),'Never persist PQ/Ed private key material');
assert.equal(migrationVersions.filter(version=>version===101).length,1,'Expected one migration version 0101');
const recovery=fs.readFileSync('backend/migrations/0101_node_enrollment_owner_recovery.sql','utf8');
assert.match(recovery,/allow_key_replacement BOOLEAN NOT NULL DEFAULT FALSE/);
assert.equal(migrationVersions.filter(version=>version===99).length,1,'Expected one migration version 0099');
assert.equal(migrationVersions.filter(version=>version===100).length,1,'Expected one migration version 0100');
const approval=fs.readFileSync('backend/migrations/0100_node_xsp_owner_key_approval.sql','utf8');
assert.match(approval,/CREATE TABLE node_xsp_key_enrollment_approvals/);
assert.match(approval,/challenge_sha256 BYTEA/);
assert.match(approval,/approved_by TEXT/);
assert.match(approval,/CHECK \(expires_at > created_at/);
assert(!/private_key|private_seed/.test(approval.replace(/--[^\n]*/g,'')),'No secret material in approval table');
const nginx=fs.readFileSync('deploy/xsp-v2-node-ingress.nginx.conf.example','utf8');
const live=fs.readFileSync('deploy/install-panel-host.sh','utf8');
for(const name of ['node_xsp_suite_state','node_xsp_public_keysets','node_xsp_replay_nonces']){
 assert(sql.includes('CREATE TABLE '+name),'Missing additive table '+name);
}
assert.match(sql,/minimum_suite SMALLINT NOT NULL DEFAULT 1/);
assert.match(sql,/NEW.minimum_suite < OLD.minimum_suite/);
assert.match(sql,/NEW.key_epoch < OLD.key_epoch/);
assert.match(sql,/OLD.activation_phase = 'strict' AND NEW.activation_phase <> 'strict'/);
assert.match(sql,/octet_length\(ed25519_public\) = 32/);
assert.match(sql,/octet_length\(mldsa65_public\) = 1952/);
assert.match(sql,/PRIMARY KEY \(node_id, key_epoch, direction, nonce\)/);
assert.match(sql,/REFERENCES node_metric_keys\(node_id\)/);
assert(!/private_key|private_seed|password|plaintext_secret/i.test(sql.replace(/--[^\n]*/g,'')),'Do not store secrets in public key schema');
assert.match(nginx,/listen 127\.0\.0\.1:8444 ssl;/);
assert.match(nginx,/ssl_protocols TLSv1\.3;/);
assert.match(nginx,/ssl_ecdh_curve X25519MLKEM768;/);
assert.match(nginx,/ssl_session_tickets off;/);
assert.match(nginx,/ssl_session_cache off;/);
assert.match(nginx,/location \/ \{ return 404; \}/);
assert(!/proxy_pass|listen 443 ssl;/.test(nginx.replace(/^\s*#.*$/gm,'')),'Test-only template must not forward or listen publicly');
assert(!live.includes('xsp-v2-node-ingress.nginx.conf.example'),'Installer must not activate test ingress');
// The live Docker/Compose path MUST NOT compile or activate experimental PQ.
const cargo=fs.readFileSync('backend/Cargo.toml','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
const compose=fs.readFileSync('compose.yaml','utf8');
const rust=fs.readFileSync('backend/src/xsp_v2_api.rs','utf8');
const main=fs.readFileSync('backend/src/main.rs','utf8');
assert.match(cargo,/default\s*=\s*\[\s*\]/);
assert.match(cargo,/xsp-v2-experimental\s*=\s*\[\s*"dep:openssl"\s*\]/);
assert(!docker.includes('--features xsp-v2-experimental'),'Production Docker may not compile XSP-v2');
assert(!compose.includes('XSP_V2_EXPERIMENTAL_HEARTBEAT'),'Never enable staging XSP-v2 in production Compose');
assert(!live.includes('XSP_V2_EXPERIMENTAL_HEARTBEAT'),'Host installer must not enable staging API');
assert.match(main,/#\[cfg\(feature = "xsp-v2-experimental"\)\]/);
assert.match(rust,/XSP_V2_EXPERIMENTAL_HEARTBEAT/);
assert.match(rust,/minimum_suite=1|floor != 1/);
assert.match(rust,/phase != "shadow"/);
assert.match(rust,/verify_both\(&parsed, &ed, &pq\)/);
assert.match(rust,/INSERT INTO node_xsp_replay_nonces/);
const enrollment=fs.readFileSync('backend/src/xsp_v2_enrollment.rs','utf8');
assert.match(enrollment,/crate::require_owner\(&actor\)/);
assert.match(enrollment,/verify_proof\(&signing_input, &ed, &pq, &ed_sig, &pq_sig\)/);
assert.match(enrollment,/consumed_at IS NULL AND expires_at>NOW\(\)/);
assert.match(enrollment,/activation_phase='dual_enrolled'/);
// The old one-shot rotation could revoke active Node keys before any signed
// cutover ACK. This source contract now forbids such revocation and requires
// both endpoints to call the initial-only guard. Its positive/negative cases
// are additionally exercised by the Rust test suite.
assert.match(enrollment,/fn initial_enrollment_allowed\(/);
assert.match(enrollment,/current == 0 && proposed == 1/);
assert.match(enrollment,/!initial_enrollment_allowed\(floor, &phase, current, input.key_epoch\)/);
assert.match(enrollment,/!initial_enrollment_allowed\(floor, &phase, epoch, input.key_epoch\)/);
assert(!/UPDATE node_xsp_public_keysets SET revoked_at=NOW\(\)/.test(enrollment),
 'Staging claim must never revoke an active key before a signed Node cutover ACK');
const rotation=fs.readFileSync('backend/src/xsp_v2_rotation.rs','utf8');
assert.match(rotation,/XSP2-KEY-ROTATE-PREPARE-V1/);
assert.match(rotation,/verify_proof\(&signed, &ed, &pq/);
assert.match(rotation,/fn rotation_allowed\(/);
assert.match(rotation,/cutoverAuthorized":false/);
assert(!/UPDATE node_xsp_public_keysets SET revoked_at=NOW\(\)/.test(rotation),'Proof must not revoke old keys');
assert(!/UPDATE node_xsp_suite_state SET/.test(rotation),'Proof must not advance active epoch');
assert.match(main,/xsp_v2_rotation::prepare/);
assert.match(main,/xsp_v2_rotation::prove/);
assert(!rust.includes('InsecureSkipVerify'),'Experimental API must not disable TLS trust');
console.log('Production defaults: opt-in v2 route excluded from Docker, Compose and installer: OK');
console.log('XSP-v2 dormant foundation: public-key state, non-decreasing floor, and loopback-only TLS ingress: OK');
