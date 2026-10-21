#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const rust=fs.readFileSync('backend/src/mfa.rs','utf8');
const auth=fs.readFileSync('backend/src/auth.rs','utf8');
const admins=fs.readFileSync('backend/src/admin_accounts.rs','utf8');
const main=fs.readFileSync('backend/src/main.rs','utf8');
const sql=fs.readFileSync('backend/migrations/0009_totp.sql','utf8');
const login=fs.readFileSync('login.js','utf8');
const loginHtml=fs.readFileSync('login.html','utf8');
const panel=fs.readFileSync('app.js','utf8');
const mfaUi=fs.readFileSync('mfa-ui.js','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
const compose=fs.readFileSync('compose.yaml','utf8');
const installer=fs.readFileSync('install.sh','utf8');
const html=fs.readFileSync('index.html','utf8');
for(const js of [login,mfaUi,panel])new Function(js);
for(const field of ['panel_totp','panel_totp_recovery','panel_mfa_challenges'])assert(sql.includes(field));
for(const path of ['auth/mfa/status','auth/mfa/setup','auth/mfa/confirm','auth/mfa/disable','auth/mfa/verify'])
 assert(main.includes(path),'MFA route missing '+path);
assert.match(main,/mfa::decode_key/);
assert.match(main,/pub totp_key: Option<\[u8;\s*32\]>/);
assert.match(rust,/Aes256Gcm/,'TOTP secrets must be encrypted at rest');
assert.match(rust,/\.encrypt\(/);
assert.match(rust,/\.decrypt\(/);
assert.match(rust,/matching_step\s*\([\s\S]{0,180}last/);
assert.match(rust,/ct_eq/,'TOTP equality must use constant-time comparison');
assert.match(rust,/panel_totp_recovery/);
assert.match(rust,/DELETE FROM panel_totp_recovery.*RETURNING code_hash/);
assert.match(rust,/attempts\s*>=\s*5/,'MFA login challenges must limit attempts');
assert.match(rust,/password_is_valid/,'TOTP enrollment/disable must require password');
assert.match(rust,/last_used_step/,'TOTP codes must not be reusable');
assert.match(rust,/recoveryCodes/,'Recovery codes must be displayed only at first enrollment');
assert.match(rust,/WHERE admin_id=\$1 AND token_hash<>/,'Existing other sessions should be revoked on enabling');
assert.match(auth,/mfa::enabled\(\s*&state,\s*admin_id\s*\)/);
assert.match(admins,/DELETE FROM panel_mfa_challenges WHERE admin_id=\$1/,
 'Credential changes must revoke any outstanding password-verified MFA challenge');
assert.match(admins,/hashed\.is_some\(\) \|\| role != current_role \|\| !new_active/,
 'Any password, role or activation change must invalidate login challenges');
// Security regression: session issuance cannot race password/role revocation.
assert.match(auth,/WHERE id=\$1 FOR UPDATE/);
assert.match(auth,/current_hash\s*!=\s*password_hash/);
assert.match(auth,/new_challenge_in_transaction/);
assert.match(auth,/issue_session_in_transaction/);
assert.match(rust,/let account\s*=\s*sqlx::query\(\s*"SELECT username,role,is_active FROM panel_auth_users WHERE id=\$1 FOR UPDATE"/);
assert.match(rust,/auth::issue_session_in_transaction\(\s*&state\s*,\s*&mut tx[\s\S]*?tx\.commit\(\)\.await/);
assert.match(rust,/active\.is_none\(\)\s*\|\|\s*!live/);
const passwordSegment=auth.slice(auth.indexOf('let verified'),auth.indexOf('pub(crate) async fn clear_failed_login'));
assert(passwordSegment.indexOf('mfa::enabled')<passwordSegment.indexOf('issue_session'),
 'Authenticated session must only be created after an enabled MFA check');
assert.match(login,/payload\.mfaRequired===true/);
assert.match(login,/\/api\/v1\/auth\/mfa\/verify/);
assert.match(loginHtml,/id="mfa-step"/);
assert.match(panel,/window\.XMeshMfa\?\.panel/);
assert.match(panel,/window\.XMeshMfa\?\.mount/);
assert.match(panel,/\['security','shield-check','Безопасность'\]/,
 'Account security must have a visible sidebar entry');
assert.match(panel,/security:\['Безопасность',securityP\]/,
 'Security section must route to dedicated MFA workspace');
assert.match(panel,/href="#security"/,
 'General settings must link directly to account security');
assert.match(panel,/function securityP\(\)/,
 'A dedicated account security page must exist');
assert.doesNotMatch(panel,/window\.XMeshMfa\?\.panel\(\)\|\|''/,
 'MFA must not be hidden at the end of the long appearance settings page');
assert.match(mfaUi,/qrcodegen\?\.QrCode/,'MFA enrollment must generate the QR in the browser');
assert.match(mfaUi,/encodeText\(data\.otpauth/,'QR must encode the backend provisioning URI');
assert.match(mfaUi,/mfa-manual/,'Manual TOTP key must remain available');
assert.match(html,/qr-code\.js\?v=/,'QR encoder must be bundled with the frontend');
assert(html.indexOf('qr-code.js')<html.indexOf('mfa-ui.js'),'QR generator must load before MFA');
assert.match(docker,/qr-code\.js/,'Docker must package the local QR encoder');
assert.match(mfaUi,/<form id="mfa-start"/,
 '2FA enrollment form must be directly visible when disabled');
assert.match(html,/mfa-ui\.js\?v=/);
assert.match(docker,/mfa-ui\.js/);
assert.match(compose,/TOTP_ENCRYPTION_KEY/);
assert.match(installer,/openssl rand -hex 32/);
assert.match(installer,/TOTP_ENCRYPTION_KEY/);
assert.match(fs.readFileSync('.env.example','utf8'),/TOTP_ENCRYPTION_KEY/);
console.log('TOTP enrollment, encrypted secrets, login challenge, no bypass, backup recovery and deployment checks: OK');
