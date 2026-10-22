#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const app=read('app.js'),html=read('index.html'),css=read('styles.css');
const studio=read('subscription-studio.js');
const main=read('backend/src/main.rs');
const auth=read('backend/src/auth.rs');
const mfa=read('backend/src/mfa.rs');
const security=read('backend/src/security.rs');
const subs=read('backend/src/subscription_settings.rs');
const migration=read('backend/migrations/0011_global_auth_budget.sql');
new Function(app);new Function(studio);

// Authentication: server-side protections, session lifetime and revocation.
assert.match(main,/route_layer\(\s*middleware::from_fn_with_state\(\s*state\.clone\(\)\s*,\s*auth::require_session\s*,?\s*\)\s*\)/);
assert.match(main,/fn require_owner/);
assert.match(main,/middleware::from_fn\(\s*csrf_guard\s*\)/);
assert.match(main,/content-security-policy/);
assert.match(main,/script-src 'self'/);
assert.doesNotMatch(main,/script-src '[^']*unsafe-inline/);
assert.match(main,/append_index_html_on_directories\(false\)/);
assert.match(auth,/HttpOnly; SameSite=Strict; Max-Age=/);
assert.match(auth,/state\.cookie_secure/);
assert.match(auth,/policy\.session_hours/);
assert.match(auth,/policy\.idle_minutes/);
assert.match(auth,/policy\.max_sessions/);
assert.match(auth,/policy\.lockout_minutes/);
assert.match(auth,/auth_global_limits/);
assert.match(migration,/auth_global_limits/);
assert.match(auth,/global_attempts\s*>=\s*240/);
assert.match(auth,/DELETE FROM auth_login_limits/);
assert.match(security,/require_owner\(\s*&actor\s*\)/);
assert.match(security,/admin_id=\$1 AND token_hash<>\$2/);
assert.match(security,/WHERE id=\$1 AND admin_id=\$2/);
assert.match(mfa,/encrypt\(\s*&state\s*,\s*&secret\s*\)/);
assert.match(mfa,/panel_mfa_challenges/);

// Client DOM sinks: user-controlled text is encoded and language strictly whitelisted.
assert.match(app,/\$\{esc\(al\)\}/,'Toast action labels must be HTML-escaped');
assert.match(studio,/data-portal-language="ru"/);
assert.match(studio,/data-portal-language="en"/);
assert.match(studio,/if\(next!=='ru'&&next!=='en'\)return/);
assert.match(studio,/previewRoot\.lang=lang/);
assert.match(studio,/\$\('\[data-subscription-description\]'\)\.textContent/);
assert.match(studio,/\+esc\(label\)\+/);
assert.match(subs,/subscriptionHeroEn/);
assert.match(subs,/subscriptionAppsTitleEn/);
assert.match(subs,/text\.chars\(\)\.any\(\s*char::is_control\s*\)/);
assert.match(main,/subscriptionDescriptionEn/);
assert.match(main,/subscriptionFooterEn/);
assert.match(main,/"subscriptionAppsTitleEn"/);

// A unified interface scale replaces the removed duplicate text-scaling control.
// Appearance precision is controlled by a separate common rangePrecision policy.
assert.doesNotMatch(app,/id="text-size"/);
assert.doesNotMatch(css,/--text-size-scale/);
assert.match(css,/var\(--ts,1\)/);
assert.match(app,/C\.rangePrecision/);
assert.match(html,/subscription-studio\.js\?v=/);
console.log('Security audit guards: auth, sessions, CSRF, CSP, static routing, HTML escaping, portal locale, text precision: OK');
