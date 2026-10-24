#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const subscription=fs.readFileSync('backend/src/user_subscriptions.rs','utf8');
const hostEditor=fs.readFileSync('xray-studio-hosts.js','utf8');
const fu=app.slice(app.indexOf('const FU='),app.indexOf('const COUNTRY_CODES='));
assert(!fu.includes("k:'fingerprint'"),'User creation and editing must not expose fingerprint');
assert(!app.includes('uTLS fingerprint пользователя'),'No user fingerprint field');
assert(!app.includes('u.fingerprint'),'User list must not display or filter on user fingerprint');
assert(!app.includes("fingerprint:d.fingerprint"),'User creation must not store an extra fingerprint');
assert.match(app,/FE\.find\(f=>f\.k==='limit'\)/,'User traffic limit is still editable');
assert.match(app,/FE\.find\(f=>f\.k==='strategy'\)/,'User reset strategy is still editable');
assert.match(hostEditor,/data-endpoint="fp"/,'Host fingerprint editor remains available');
const transport=fs.readFileSync('backend/src/subscription_transport.rs','utf8');
assert.match(subscription,/crate::subscription_transport::client_stream\(\s*inbound\s*,\s*host\s*,\s*device\s*,?\s*\)/,
  'Subscription must delegate stream generation to the transport projector');
assert.match(transport,/field\(\s*host\s*,\s*"fp"\s*\)\s*\.or_else\(\s*\|\|\s*field\(\s*host\s*,\s*"fingerprint"\s*\)\s*\)/,
  'Client TLS/REALITY fingerprint must be resolved from the host, never the user');
assert.doesNotMatch(transport,/field\(user,"(?:fp|fingerprint)"\)/,
  'Transport projector must not read a user fingerprint');
console.log('Fingerprint ownership: hosts only; user forms unchanged otherwise.');
