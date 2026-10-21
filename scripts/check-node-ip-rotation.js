#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

const app=fs.readFileSync('app.js','utf8');
const backend=fs.readFileSync('backend/src/main.rs','utf8');
const rot=fs.readFileSync('backend/src/node_rotation.rs','utf8');
const migration=fs.readFileSync('backend/migrations/0007_node_ip_rotation.sql','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('styles.css','utf8');

assert.match(app,/k:'rotationEnabled'.*t:'bool'/,'Node editor must expose an enable switch');
assert.match(app,/k:'rotationIps'.*t:'area'/,'Node editor must expose IP address pool');
assert.match(app,/chk:nodeRotationValidate/,'Node form must validate before submitting');
assert.match(app,/class="node-rotation-editor"/,'Optional node rotation must be collapsible');
assert.match(app,/data-node-rotation-probe/,'Node editor must provide an authenticated test');
assert.match(app,/nodeRotationIPs\(n\)\.length/,'Node card must show real pool size');
assert.match(css,/\.node-rotation-editor>summary/,'Node rotation section needs visual affordance');
assert.match(html,/app\.js\?v=20261021-settings-language-1/);
assert.match(html,/styles\.css\?v=20261021-settings-language-1/);

assert.match(backend,/mod node_rotation;/);
assert.match(backend,/node_rotation::validate_node\(data\)\?/);
assert.match(backend,/post\(node_rotation::rotate_next\)/);
assert.match(rot,/FOR UPDATE/,'Concurrent refreshes must lock the user-node cursor');
assert.match(rot,/tx\.commit\(\)\.await/,'Allocation must commit atomically');
assert.match(rot,/user_status\(&user, now_ms\) != "ACTIVE"/,'Inactive users must be rejected');
assert.match(rot,/\#\[test\]/,'Algorithm must have Rust tests');
assert.match(migration,/PRIMARY KEY \(node_id, user_id\)/,'Cursors must be per user and node');
new Function(app);
console.log('Node IP rotation source integration: OK');
