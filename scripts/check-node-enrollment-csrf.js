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
console.log('Machine-only enrollment CSRF scope and token lifecycle: OK');
