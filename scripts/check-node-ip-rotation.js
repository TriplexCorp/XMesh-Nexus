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
// Exercise the actual browser validation helpers, not their whitespace or order.
const vm=require('node:vm');
const validationStart=app.indexOf('const nodeRotationIPs =');
const validationEnd=app.indexOf('const ENT=',validationStart);
assert(validationStart>=0&&validationEnd>validationStart,'Node rotation validation helpers must exist');
const validate=vm.runInNewContext(app.slice(validationStart,validationEnd)+';nodeRotationValidate',{URL});
assert.equal(validate({rotationEnabled:false,rotationIps:''}),'');
assert.equal(validate({rotationEnabled:true,rotationIps:'198.51.100.10\n203.0.113.20'}),'');
assert.match(validate({rotationEnabled:true,rotationIps:'198.51.100.10'}),/минимум два/);
assert.match(validate({rotationEnabled:true,rotationIps:'198.51.100.10\n198.51.100.10'}),/одинаковые/);
assert.match(validate({rotationEnabled:true,rotationIps:'999.999.999.999\n198.51.100.10'}),/корректные/);
assert.match(validate({rotationEnabled:true,rotationIps:'198.51.100.10\n203.0.113.20\n'.repeat(129)}),/не более 256/);
// The node form must surface validation failures before accepting its data.
const nodeFormStart=app.indexOf('chk:data=>{',app.indexOf("const ENT="));
assert(nodeFormStart>=0,'Node editor must declare a validation callback');
const nodeFormEnd=app.indexOf('const issue=nodeRotationValidate(data)',nodeFormStart);
assert(nodeFormEnd>nodeFormStart&&nodeFormEnd-nodeFormStart<3500,'Node form must validate before submitting');
assert.match(app.slice(nodeFormEnd,nodeFormEnd+100),/if\s*\(issue\)\s*return\s+issue/,'Node form must reject invalid rotation pool');
assert.match(app,/class="node-rotation-editor-body"/,'Node rotation fields must remain grouped in the redesigned editor');
assert.match(app,/data-node-rotation-probe/,'Node editor must provide an authenticated test');
assert.match(app,/nodeRotationIPs\(n\)\.length/,'Node card must show real pool size');
assert.match(css,/\.node-rotation-editor>summary/,'Node rotation section needs visual affordance');
assert.match(html,/app\.js\?v=[a-z0-9-]+/);
assert.match(html,/styles\.css\?v=[a-z0-9-]+/);

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
