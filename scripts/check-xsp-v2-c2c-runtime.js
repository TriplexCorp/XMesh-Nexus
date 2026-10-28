#!/usr/bin/env node
'use strict';
const fs = require('fs');
const assert = require('assert');
const read = p => fs.readFileSync(p, 'utf8');

const cargo = read('backend/Cargo.toml');
const service = read('backend/src/bin/xsp_v2_c2c.rs');
const fixture = read('backend/src/bin/xsp_v2_c2c_fixture.rs');
const origin = read('deploy/xsp-v2-ingress/origin_ack_gate.py');
const docker = read('backend/Dockerfile.xsp-c2c');
const role = read('deploy/postgres/21-create-xsp-v2-c2c-role.sql');
const test = read('scripts/test-xsp-v2-c2c-integration.py');
const workflow = read('.github/workflows/xsp-c2c.yml');
const compose = read('compose.yaml');
const installer = read('install.sh');
const main = read('backend/src/main.rs');

assert.match(cargo, /\[\[bin\]\]\nname = "xsp-v2-c2c"\npath = "src\/bin\/xsp_v2_c2c\.rs"\nrequired-features = \["xsp-v2-experimental"\]\ntest = false/,
  'C2-C binary must be feature gated and excluded from cargo test harnessing');
assert.match(cargo, /\[\[bin\]\]\nname = "xsp-v2-c2c-fixture"\npath = "src\/bin\/xsp_v2_c2c_fixture\.rs"\nrequired-features = \["xsp-v2-experimental"\]\ntest = false/,
  'C2-C fixture must be an explicit test-only binary, not an integration-test crate');
assert.match(fixture, /XSP_V2_C2C_FIXTURE/);
assert.match(service, /UnixListener/);
assert.match(service, /peer_cred\(\)/);
assert.match(service, /ORIGIN_UID/);
assert.match(service, /commit_fresh_applied_ack_staging/);
assert.match(service, /readback_committed_applied_ack_staging/);
assert.match(service, /issue_or_recover_via_protected_signer_staging/);
assert.match(service, /XSP2C2C1/);
assert.doesNotMatch(service, /TcpListener|axum::|reqwest::|X-XSP-V2-Trusted-Node-ID/,
  'C2-C must not add TCP/HTTP/header identity handoff');

assert.match(origin, /C2C_GATE == "staging-only"/);
assert.match(origin, /SO_PEERCRED/);
assert.match(origin, /C2C_UID = 10001/);
assert.match(origin, /client\.getsockopt[\s\S]*unexpected C2-C service peer[\s\S]*client\.sendall/,
  'origin must authenticate the C2-C peer before sending ACK bytes');
assert.match(origin, /authorizationStatus": "not-verified"/,
  'C2-B behavior must remain when C2-C gate is off');

assert.match(docker, /USER 10001:10001/);
assert.match(docker, /--bin xsp-v2-c2c-fixture/);
assert.doesNotMatch(docker, /xmesh-signer-keys|panel-ed25519\.pem|panel-mldsa65\.pem/,
  'C2-C runtime must not contain signer private key paths');
assert.match(role, /CREATE ROLE xmesh_c2c_writer/);
assert.match(role, /GRANT UPDATE \(key_epoch\)/);
assert.match(role, /GRANT INSERT[\s\S]*node_xsp_signed_commit_receipt_outbox/);
assert.match(role, /REVOKE CREATE, TEMPORARY ON DATABASE xmesh FROM PUBLIC/);
assert.doesNotMatch(role, /GRANT ALL/);

for (const [name, text] of [['compose.yaml', compose], ['install.sh', installer], ['backend/src/main.rs', main]]) {
  assert(!text.includes('XSP_V2_C2C_') && !text.includes('xsp-v2-c2c'), `${name} must not activate C2-C`);
}
assert.match(test, /missing signer must fail HTTP success/);
assert.match(test, /concurrent exact retry/);
assert.match(test, /DB stall fails closed/);
assert.match(test, /old public keys remain unretired/);
assert.match(workflow, /test-xsp-v2-c2c-integration\.py/);
assert.match(workflow, /check-xsp-v2-c2c-runtime\.js/);
assert.match(workflow, /backend\/src\/bin\/xsp_v2_c2c_fixture\.rs/);
console.log('C2-C staging runtime/security contract: PASS');
