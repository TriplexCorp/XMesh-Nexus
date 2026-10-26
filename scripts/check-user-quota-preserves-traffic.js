#!/usr/bin/env node
'use strict';
// Guard against silent user-traffic resets when editing quotas and bulk fields.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const api=fs.readFileSync('backend/src/main.rs','utf8');
const ui=fs.readFileSync('app.js','utf8');
const integration=fs.readFileSync('scripts/test-node-auth-integration.py','utf8');

const update=api.slice(api.indexOf('async fn update_record('),api.indexOf('async fn delete_record('));
assert.match(update,/patch_object\.contains_key\("used"\) && patch_object\.len\(\) != 1/,
  'Mixed account edits including usage must be rejected');
assert.match(update,/user_metered_bytes\(&state\.pool, id\)\.await/,
  'User PATCH response must include the existing signed byte counters');
assert.match(update,/add_metered_usage\(&mut result/,
  'User PATCH response must return actual effective usage');
assert.match(update,/if collection == "users" && patch_object\.contains_key\("used"\)/,
  'Explicit usage update must remain possible');
const bulk=ui.slice(ui.indexOf('async bulk(c,ids,fn)'),ui.indexOf('async saveSettings('));
assert.match(bulk,/structuredClone\(record\)/,
  'Bulk actions must not mutate the live record before API success');
assert.match(bulk,/JSON\.stringify\(next\[key\]\)!==JSON\.stringify\(record\[key\]\)/,
  'Bulk requests must send only fields the user changed');
assert.doesNotMatch(bulk,/this\.update\(c,\s*(?:x|record)\.id,\s*\{\.\.\.(?:x|record)\}/,
  'Bulk actions must not re-submit read-only effective usage');
assert.match(integration,/make metered user unlimited without resetting usage/);
assert.match(integration,/set quota for previously unlimited user/);
assert.match(integration,/verify signed traffic survives new quota/);
assert.match(integration,/reject accidental accounting reset in mixed user PATCH/);
assert.match(integration,/traffic reset clears meter totals but keeps Xray baselines/,
  'Explicit traffic reset must still work');
console.log('User quota edits preserve traffic and bulk actions avoid implicit resets: OK');
