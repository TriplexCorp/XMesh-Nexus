#!/usr/bin/env node
const fs = require('node:fs');
const assert = require('node:assert/strict');

const apiCargo = fs.readFileSync('backend/Cargo.toml','utf8');
const permitCargo = fs.readFileSync('backend/xsp-permit/Cargo.toml','utf8');
const signer = fs.readFileSync('backend/src/bin/xsp_v2_permit_signer.rs','utf8');
const operator = fs.readFileSync('backend/src/bin/xsp_v2_permit_operator.rs','utf8');
const sql = fs.readFileSync('deploy/postgres/22-create-xsp-v2-permit-signer-role.sql','utf8');
const dockerfile = fs.readFileSync('backend/Dockerfile.xsp-permit','utf8');
const doc = fs.readFileSync('docs/XSP_V2_PROTECTED_PERMIT_OPERATOR.md','utf8');

for (const name of ['xsp-v2-permit-signer','xsp-v2-permit-operator']) {
  assert.match(permitCargo, new RegExp(`name = "${name}"[\\s\\S]*required-features = \\["xsp-v2-experimental"\\]`));
}
assert.doesNotMatch(
  apiCargo,
  /name = "xsp-v2-permit-(?:signer|operator)"/,
  'protected permit binaries must remain outside API all-target test harness',
);
assert.match(dockerfile,/cp \/source\/backend\/xsp-permit\/Cargo\.toml/);

assert.match(signer,/XSP_V2_PROTECTED_PERMIT_ISSUER[\s\S]{0,120}staging-only/);
assert.match(signer,/xmesh_permit_signer_reader/);
assert.match(signer,/read-only/);
assert.match(signer,/sign-approved-permit/);
assert.match(signer,/load_approved_candidate/);
assert.match(signer,/approved_by == authenticated_owner/);
assert.match(signer,/candidate_sha256\(&material\)/);
assert.match(signer,/sign_staging_permit/);
assert.match(signer,/state='issued'/);
assert.match(signer,/permit signer socket directory must be signer-owned 2750/);
assert.match(signer,/peer\.uid\(\) == OPERATOR_UID && peer\.gid\(\) == OPERATOR_GID/);
assert.doesNotMatch(signer,/INSERT INTO|UPDATE node_xsp|DELETE FROM node_xsp/,
  'permit signer must remain SELECT-only');

assert.match(operator,/XSP_V2_PROTECTED_PERMIT_OPERATOR[\s\S]{0,120}staging-only/);
assert.match(operator,/current_user == "xmesh_app"/);
assert.match(operator,/panel_auth_users WHERE username=\$1 FOR UPDATE/);
assert.match(operator,/role == "owner"/);
assert.match(operator,/Argon2::default\(\)[\s\S]{0,120}\.verify_password/);
assert.match(operator,/load_locked_candidate\(&mut tx/);
assert.match(operator,/snapshot\.approved_by == args\.owner/);
assert.match(operator,/persist_verified_permit/);
assert.match(operator,/tx\.commit\(\)[\s\S]{0,80}\.await/);
assert.match(operator,/peer\.uid\(\) == SIGNER_UID && peer\.gid\(\) == SIGNER_GID/);
assert.match(operator,/signedPermitB64/);
assert.match(operator,/"cutoverAuthorized"\s*:\s*true/);
assert.match(operator,/"strictActivated"\s*:\s*false/);
assert.match(operator,/"productionActivation"\s*:\s*false/);
assert.doesNotMatch(operator,/panel-ed25519\.pem|panel-mldsa65\.pem|PRIVATE KEY/,
  'operator must not reference signer private key material');

assert.match(sql,/CREATE ROLE xmesh_permit_signer_reader LOGIN PASSWORD/);
assert.match(sql,/default_transaction_read_only = on/);
assert.match(sql,/NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS/);
assert.match(sql,/GRANT SELECT ON TABLE[\s\S]*node_xsp_suite_state[\s\S]*node_xsp_public_keysets[\s\S]*node_xsp_rotation_preparations[\s\S]*node_xsp_cutover_permit_ledger[\s\S]*TO xmesh_permit_signer_reader/);
assert.doesNotMatch(sql,/GRANT (INSERT|UPDATE|DELETE|TRUNCATE)/,
  'permit signer DB role must not receive write grants');

assert.match(dockerfile,/AS permit-signer/);
assert.match(dockerfile,/USER 10006:10001/);
assert.match(dockerfile,/AS permit-operator/);
assert.match(dockerfile,/USER 10007:10005/);
assert.match(dockerfile,/--bin xsp-v2-permit-signer --bin xsp-v2-permit-operator/);

assert.match(doc,/strictActivated=false/);
assert.match(doc,/productionActivation=false/);
assert.match(doc,/does \*\*not\*\* activate the Node vault/);

console.log('PASS: protected permit signer/operator boundary is explicit, isolated, and fail-closed');
