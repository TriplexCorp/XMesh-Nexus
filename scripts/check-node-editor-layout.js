#!/usr/bin/env node
'use strict';
const {panelStyles}=require('./ci/frontend-source.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');

const ui=fs.readFileSync('frontend/js/core/app.js','utf8');
const css=panelStyles();
const v3Layout=fs.readFileSync('frontend/styles/system/nexus-v3-layout.css','utf8');
const index=fs.readFileSync('frontend/index.html','utf8');
assert.match(ui,/const nodeCoreOrder=\['name','hosting','flag','profileId','addr','port','xrayLocalPort','tlsAutoProvision','tlsManualProvision','tlsDomain','tlsAcmeEmail','mult','limit','resetDay'\]/);
assert.match(ui,/node-tls-settings/,'Node editor must keep the managed TLS certificate controls');
assert.match(ui,/arrangedNodeCoreFields\.filter/,'Editor must exclude certificate-only fields from the main grid');
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
// Shared dialog safety is independent of a node-specific placement patch.
assert.match(css,/node-form-layout/,'Node editor must retain its form sections');
assert.match(css,/node-address-port/,'Address and port remain one field group');
assert.match(css,/node-traffic-limit-control/,'Traffic controls remain available');
assert.doesNotMatch(css,/top:50%!important/,'Dialog must not need a positional specificity override');
assert.match(v3Layout,/100dvh/,'Dialogs must be bounded by the dynamic viewport');
assert.match(v3Layout,/overflow\s*:\s*(?:auto|hidden)/,'Dialog overflow must be owned by its shell/body');
const syntax=spawnSync(process.execPath,['--check','frontend/js/core/app.js'],{encoding:'utf8'});
assert.equal(syntax.status,0,syntax.stderr);
console.log('Centered three-column node editor + Design System v3 viewport safety: OK');
