#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const source=fs.readFileSync('backend/src/main.rs','utf8');
const enroll=fs.readFileSync('backend/src/node_enrollment.rs','utf8');
assert.match(source,/"\/api\/v1\/node\/enroll"\s*=>/);
assert.match(source,/"\/api\/v1\/node\/heartbeat"/);
assert.match(source,/request\.headers\(\)\.get\(header::COOKIE\)\.is_none\(\)/);
assert.match(source,/request\.headers\(\)\.get\(header::ORIGIN\)\.is_none\(\)/);
assert.match(source,/request\.headers\(\)\.get\("sec-fetch-site"\)\.is_none\(\)/);
assert.match(source,/eq_ignore_ascii_case\("application\/json"\)/);
assert.match(enroll,/expires_at>NOW\(\) FOR UPDATE/);
assert.match(enroll,/consumed_at=NOW\(\)/);
// Regression: the Sub agent has no reusable Bearer token. It signs the
// exact route/body/time/nonce with its Ed25519 key. A leftover Bearer-based
// CSRF exception produced 403 after a successful enrollment, every 20 sec.
const subGuard=source.slice(source.indexOf('async fn csrf_guard('),source.indexOf('async fn csrf_guard(')+4700);
const signedHelper=source.slice(source.indexOf('fn signed_sub_agent_request('),source.indexOf('async fn csrf_guard('));
assert.match(subGuard,/\/api\/v1\/sub-server\/agent\/poll/);
assert.match(subGuard,/signed_sub_agent_request\(request\.headers\(\)\)/);
for(const header of ['x-xmesh-sub-signature','x-xmesh-sub-timestamp','x-xmesh-sub-nonce'])
 assert(signedHelper.includes(header),'Missing Sub signature header shape: '+header);
assert.match(signedHelper,/contains_key\(header::AUTHORIZATION\)/,
 'Ed25519 agent requests must not send legacy Bearer authorization');
assert.doesNotMatch(signedHelper,/starts_with\("Bearer "\)/,
 'Agent CSRF exception must never require Bearer credentials');
console.log('Machine-only enrollment and Sub Ed25519 CSRF scope: OK');
