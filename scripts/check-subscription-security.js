#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const read=path=>fs.readFileSync(path,'utf8');
const backend=read('backend/src/user_subscriptions.rs');
const main=read('backend/src/main.rs');
const host=read('deploy/install-panel-host.sh');
const app=read('app.js');
const compose=read('compose.yaml');
const install=read('install.sh');
const test=read('scripts/test-auth-integration.py');
const credentials=read('backend/src/user_credentials.rs');
const nodes=read('backend/src/node_runtime.rs');
const client=read('client-config.js');

assert.match(backend,/OsRng\.fill_bytes\(&mut secret\)/,'Subscription secrets must remain 256-bit CSPRNG values');
assert.match(backend,/fn token_hash\(token: &str\)/,'Bearer lookup must use hashes');
assert.match(backend,/SUBSCRIPTION_CIPHER_V2/,'Encrypted tokens need explicit key-identity prefix');
assert.match(backend,/state\.subscription_key/,'Encryption must use independent key');
assert.match(backend,/legacy_subscription_cipher/,'Legacy encrypted links must survive upgrade');
assert.match(backend,/migrate_legacy_ciphertexts/,'Legacy tokens must be migrated before serving');
assert.match(backend,/WHERE user_id=\$2 AND token_ciphertext=\$3/,'Ciphertext migration must be race-safe');
assert.match(main,/SUBSCRIPTION_ENCRYPTION_KEY/,'API must require independent key');
assert.match(main,/user_subscriptions::migrate_legacy_ciphertexts\(&state\)\.await/);
assert.match(install,/ensure-subscription-key\.sh/);
assert.match(compose,/SUBSCRIPTION_ENCRYPTION_KEY/);
assert.match(host,/access_log off;/,'Public subscription requests must not enter standard access logs');
assert.match(main,/make_span_with/,'HTTP trace must not expose dynamic secret-bearing URL paths');
assert.match(main,/HeaderValue::from_static\("no-referrer"\)/,'Do not leak bearer URLs in referer headers');
assert.match(main,/credentials\/rotate/,'Credential rotation must have a dedicated endpoint');
assert.match(backend,/pub async fn rotate_credentials/);
assert.match(backend,/crate::require_owner\(&actor\)/,'High-impact rekey must require owner role');
assert.match(backend,/FOR UPDATE/,'Concurrent credential rotations must lock the user row');
assert.match(backend,/tx\.commit\(\)\.await/,'VPN and subscription secrets must update atomically');
assert.match(backend,/ssPassword128/,'Shadowsocks 2022 keys must rotate with UUID');
assert.match(app,/data-user-credentials-rotate/,'Owner must have a visible explicit UI action');
assert.match(app,/requiresNodeSync|синхронизацию каждой ноды/,'UI must warn about delayed remote revocation');
assert.match(test,/viewer forbidden from rotating VPN credentials/);
assert.match(credentials,/OsRng\.fill_bytes\(&mut secret\)/,'All password-based protocols require independent CSPRNG secrets');
assert.match(credentials,/Uuid::new_v4\(\)/,'VLESS and VMess require distinct random UUIDs');
for(const key of ['vmessId','trojanPassword','hysteriaPassword','masquePassword',
 'ssLegacyPassword','socksPassword','httpPassword']){
 assert(credentials.includes('"'+key+'"'),'Missing isolated per-user credential '+key);
}
assert.match(main,/object\.extend\(user_credentials::generate\(\)\)/,'New users must receive isolated keys');
assert.match(backend,/object\.extend\(new_credentials\)/,'Owner-only rotation must refresh every credential');
assert.match(backend,/credentialsSeparated/,'UI must receive legacy migration status');
assert.match(nodes,/user_credentials::for_protocol/,'Node authorization must read protocol-specific secrets');
assert.match(backend,/user_credentials::for_protocol/,'Subscriptions must export the same secrets as the node');
assert.match(client,/userCredential\(user,'trojanPassword'\)/,'Admin JSON export must use Trojan password');
assert.match(app,/managedUserCredential\(user,'hysteria'\)/,'Manual profiles must not reuse UUID for Hysteria');
assert.doesNotMatch(nodes,/"auth":uuid\.to_string\(\)/,'Hysteria2 node must not reuse VLESS UUID');
assert.doesNotMatch(nodes,/"pass":uuid\.to_string\(\)/,'MASQUE node must not reuse VLESS UUID');
assert.ok(!/token_expire_at|token_ttl|expires_at.*user_subscription_tokens/.test(backend),
  'Subscription bearer URLs must not be assigned a rolling TTL');
console.log('Subscription key separation, logging redaction, indefinite tokens, rotation contract: PASS');
