#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');

const ui=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
assert.match(ui,/const nodeCoreOrder=\['name','hosting','flag','profileId','addr','port','xrayLocalPort','mult','limit','resetDay'\]/);
assert.match(ui,/arrangedNodeCoreFields\.map/);
assert.match(ui,/node-section-intro/);
assert.match(ui,/node-form-layout/);
assert.match(ui,/node-main-section/);
assert.match(ui,/node-ip-section/);
assert.match(ui,/node-billing-section/);
assert.match(ui,/node-traffic-reset-button/);
assert.match(ui,/data-node-pool-normalize/);
assert.match(ui,/data-node-pool-clear/);
assert.match(ui,/data-node-date-open/);
assert.match(ui,/data-node-reset-traffic/);
// The new layout must override legacy three-column styles at the end of CSS.
const final=css.slice(css.lastIndexOf('/* Node editor · horizontal, shared-grid workspace.'));
assert.ok(final.length>3500,'Expected complete final node editor styles');
assert.match(final,/grid-template-areas:"primary primary" "ips billing"/);
assert.match(final,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(final,/\.node-address-port\{/);
assert.match(final,/\.node-traffic-limit-control\{/);
assert.match(final,/grid-column:span 2/);
assert.match(final,/position:sticky/);
assert.match(final,/@media\(max-width:1320px\)/);
assert.match(final,/@media\(max-width:950px\)/);
assert.match(final,/@media\(max-width:620px\)/);
const syntax=spawnSync(process.execPath,['--check','app.js'],{encoding:'utf8'});
assert.equal(syntax.status,0,syntax.stderr);
console.log('Horizontal node editor: controls, visual order, responsive layout OK');
