#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const read=path=>fs.readFileSync(path,'utf8');
const backend=read('backend/src/user_subscriptions.rs')+'\n'+read('backend/src/user_subscriptions_base.rs');
const protocols=read('backend/src/protocol_credentials.rs');
const node=read('backend/src/node_runtime.rs')+'\n'+read('backend/src/node_runtime_legacy.rs');
const main=read('backend/src/main.rs');
const host=read('deploy/install-panel-host.sh');
const app=read('frontend/js/core/app.js');
const compose=read('compose.yaml');
const install=read('install.sh');
const test=read('scripts/test-auth-integration.py');

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
assert.ok(!/token_expire_at|token_ttl|expires_at.*user_subscription_tokens/.test(backend),
  'Subscription bearer URLs must not be assigned a rolling TTL');
for(const protocol of ['vmess','trojan','hysteria','masque','shadowsocks']){
  assert.match(backend,new RegExp('for_protocol\\(\\s*user,\\s*"'+protocol+'"'),'Subscription feed must issue dedicated '+protocol+' secret');
  assert.match(node,new RegExp('for_protocol\\(\\s*user,\\s*"'+protocol+'"'),'Node authorization must use matching '+protocol+' secret');
}
assert.match(protocols,/fn secret256\(\) -> String/);
assert.match(protocols,/OsRng\.fill_bytes\(&mut bytes\)/);
assert.match(protocols,/pub fn provision/);
assert.match(protocols,/fn existing_records_keep_legacy_passwords_until_explicit_rekey/);
assert.match(protocols,/fn rekey_changes_all_protocol_credentials/);
assert.match(main,/protocol_credentials::provision\(object\)/);
assert.match(backend,/crate::protocol_credentials::provision\(object\)/);
// A public bearer URL must not reach PostgreSQL or a dynamic UA negotiator
// until its entire path and token are validated and its budget is checked.
const portalRoutes=read('backend/src/user_subscriptions.rs');
const flood=read('backend/src/subscription_flood.rs');
const handler=portalRoutes.slice(portalRoutes.indexOf('pub async fn portal_route('),portalRoutes.indexOf('#[cfg(test)]',portalRoutes.indexOf('pub async fn portal_route(')));
assert.match(handler,/validate_custom_route\(uri\.path\(\), &configured\)/,
  'Custom public paths must be classified using an in-memory settings snapshot');
assert.doesNotMatch(handler,/read_settings\(|\.fetch_(?:one|optional|all)\(/,
  'Untrusted custom-path requests must not query PostgreSQL');
assert.ok(handler.indexOf('validate_custom_route(')<handler.indexOf('subscription_flood::enforce('),
  'Custom path/token check must precede Redis enforcement');
assert.match(portalRoutes,/pub async fn serve\([\s\S]*?valid_token\(&token\)[\s\S]*?subscription_flood::enforce/,
  'Direct feed handler must reject malformed tokens before expensive work');
assert.match(portalRoutes,/pub async fn portal\([\s\S]*?valid_token\(&token\)[\s\S]*?wants_feed/,
  'Portal handler must reject malformed tokens before UA negotiations');
const portalHandler=portalRoutes.slice(
  portalRoutes.indexOf('pub async fn portal('),
  portalRoutes.indexOf('pub async fn portal_route('));
assert.ok(portalHandler.indexOf('subscription_flood::enforce(') <
  portalHandler.indexOf('subscription_user_agent::wants_feed('),
  'Portal must enforce the request budget before potentially expensive UA parsing');
assert.ok(handler.indexOf('subscription_flood::enforce(') <
  handler.indexOf('subscription_user_agent::wants_feed('),
  'Custom portal must enforce the request budget before parsing UA');
assert.doesNotMatch(portalHandler,/return serve\(State\(state\)/,
  'Portal must not charge the same request twice when serving client data');
assert.match(portalRoutes,/async fn serve_authorized\(/,
  'Portal and subscription feed must share one post-budget serving function');
assert.match(main,/pub subscription_path: std::sync::Arc<std::sync::RwLock<String>>/,
  'Custom subscription route needs a hot read-only path snapshot');
assert.match(main,/object\.contains_key\("subscriptionPath"\)/,
  'Subscription Studio saves must refresh the hot path');
assert.match(main,/get\(user_subscriptions::portal_route\)[\s\S]*?uri_budget_guard/,
  'Public custom URLs must have a route-local URI size limit');
assert.match(flood,/pub async fn uri_budget_guard\(/,
  'Public URI/query budget must run before Query extractor allocation');
assert.match(flood,/CONFIG_REFRESH_LOCK: tokio::sync::Mutex/,
  'Subscription flood policy refresh must have a single-flight lock');
assert.match(flood,/fn recent_config\(\) -> Option<FloodConfig>/,
  'Public requests must use a local short-lived policy snapshot');
assert.match(flood,/pub async fn invalidate_cache\(/,
  'Owner policy changes must invalidate the policy cache');
assert.match(main,/subscription_flood::invalidate_cache\(&state\)\.await/,
  'Owner settings updates must invalidate cached flood policy');
assert.match(flood,/static PUBLIC_REQUESTS: AtomicU64/,
  'An operator-independent process-wide emergency budget must exist');
assert.match(flood,/static INVALID_REQUESTS: AtomicU64/,
  'Malformed requests need a separate fixed-size budget');
assert.match(flood,/if !admit\(&PUBLIC_REQUESTS, MAX_PUBLIC_REQUESTS_PER_MINUTE\)/,
  'Valid paths must be bounded even when operator protection is disabled');
assert.doesNotMatch(flood,/X-Forwarded-For|x-forwarded-for/,
  'Never trust spoofable forwarding headers for rate limiting');

console.log('Subscription key separation, logging redaction, indefinite tokens, rotation contract: PASS');
