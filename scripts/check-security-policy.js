#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const backend=fs.readFileSync('backend/src/security.rs','utf8');
const auth=fs.readFileSync('backend/src/auth.rs','utf8');
const main=fs.readFileSync('backend/src/main.rs','utf8');
const sql=fs.readFileSync('backend/migrations/0010_security_controls.sql','utf8');
const ui=fs.readFileSync('security-ui.js','utf8');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');

new Function(ui);new Function(app);
for(const f of ['session_hours','idle_minutes','max_sessions','login_attempts','lockout_minutes','dashboard_path'])
 assert.match(backend,new RegExp('pub '+f+': i64|pub '+f+': String'),'Policy field missing '+f);
for(const f of ['sessionHours','idleMinutes','maxSessions','loginAttempts','lockoutMinutes','dashboardPath'])
 assert.match(ui,new RegExp(f),'UI policy field missing '+f);
assert.match(backend,/admin_accounts::require_owner\(&actor\)/,'Policy updates must require owner');
assert.match(backend,/deny_unknown_fields/,'Reject unrecognized policy fields');
assert.match(backend,/\(self\.session_hours,1,168/);
assert.match(backend,/\(self\.idle_minutes,0,1440/);
assert.match(backend,/\(self\.max_sessions,1,20/);
assert.match(backend,/\(self\.login_attempts,3,15/);
assert.match(backend,/\(self\.lockout_minutes,5,120/);
assert.match(backend,/strip_prefix\("\/dashboard\/"\)/);
assert.match(backend,/security\.policy\.updated/,'Policy changes should be audited');
assert.match(backend,/DELETE FROM panel_sessions WHERE id=\$1 AND admin_id=\$2/,'Session revocation must be scoped to account');
assert.match(backend,/security\.sessions\.revoked_others/);
assert.match(auth,/policy\.session_hours\*3600/,'Session lifetime must be server controlled');
assert.match(auth,/policy\.idle_minutes\*60/,'Idle limit must be enforced');
assert.match(auth,/make_session_cookie\(&token, state\.cookie_secure, policy\.session_hours\*3600\)/);
assert.match(auth,/ORDER BY created_at DESC,token_hash DESC OFFSET \$2/,'Concurrent sessions must be capped');
assert.match(auth,/policy\.login_attempts/);
assert.match(auth,/policy\.lockout_minutes/);
assert.doesNotMatch(auth,/INTERVAL '12 hours'|INTERVAL '15 minutes'/,'Fixed session/lockout limits must not remain');
assert.match(sql,/ADD COLUMN IF NOT EXISTS id/);
assert.match(sql,/last_seen_at/);
for(const route of ['/security/policy','/security/sessions','/security/sessions/others','/security/sessions/{id}','/dashboard/{slug}'])
 assert(main.includes(route),'Missing server route '+route);
assert.match(backend,/Dashboard path is the sole HTML entrypoint/,'Dashboard path must be a single HTML entrypoint');
assert.match(main,/\.route\("\/", get\(\|\| async \{ StatusCode::NOT_FOUND \}\)\)/,'Root must not serve the panel');
assert.match(main,/\.route\("\/login", get\(\|\| async \{ StatusCode::NOT_FOUND \}\)\)/,'Default login path must be closed');
assert.match(backend,/join\("login.html"\)/,'Only the custom entrypoint may serve login HTML');
assert.match(backend,/crate::auth::is_authenticated/,'Alternate dashboard must require authentication');
assert.match(backend,/html=html\.replace/,'Nested dashboard entry must resolve root assets');
assert.match(html,/security-ui\.js\?v=/);
assert.match(docker,/security-ui\.js/,'UI module must be included in production image');
assert.match(app,/XMeshSecurity\?\.panel/);
assert.match(app,/XMeshSecurity\?\.mount/);
console.log('Advanced security policy, server enforcement, per-account session revocation and dashboard path: OK');
