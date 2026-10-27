#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const sql=fs.readFileSync('backend/migrations/0099_node_xsp_v2_public_state.sql','utf8');
const migrationVersions=fs.readdirSync('backend/migrations').filter(name=>/^\d{4}_.+\.sql$/.test(name)).map(name=>Number(name.slice(0,4)));
assert.equal(Math.max(...migrationVersions),100,'XSP-v2 enrollment approval migration must follow 0099');
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
assert(!rust.includes('InsecureSkipVerify'),'Experimental API must not disable TLS trust');
console.log('Production defaults: opt-in v2 route excluded from Docker, Compose and installer: OK');
console.log('XSP-v2 dormant foundation: public-key state, non-decreasing floor, and loopback-only TLS ingress: OK');
