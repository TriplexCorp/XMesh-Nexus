#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const sql=fs.readFileSync('backend/migrations/0099_node_xsp_v2_public_state.sql','utf8');
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
console.log('XSP-v2 dormant foundation: public-key state, non-decreasing floor, and loopback-only TLS ingress: OK');
