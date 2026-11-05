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
// Security, not protocol, VLESS Encryption or saved overrides, determines TLS.
const modeStart=ui.indexOf('function nodeEffectiveTlsMode(profile){');
const modeEnd=ui.indexOf('function syncNodeEffectiveTls(',modeStart);
assert(modeStart>=0&&modeEnd>modeStart,'Missing derived TLS mode helper');
const mode=new Function('inbs',ui.slice(modeStart,modeEnd)+'return nodeEffectiveTlsMode;')(profile=>profile.inbounds);
const config=(protocol,security)=>({inbounds:[{protocol,streamSettings:{security}}]});
for(const protocol of ['vless','trojan','vmess','shadowsocks','hysteria','masque','custom']){
 assert.equal(mode(config(protocol,'tls')),'on',protocol+' TLS must display ON');
 assert.equal(mode(config(protocol,'none')),'off',protocol+' none must display OFF');
 assert.equal(mode(config(protocol,'reality')),'off',protocol+' REALITY must display OFF');
}
assert.equal(mode({inbounds:[{protocol:'trojan',streamSettings:{security:'tls'}},{protocol:'vless',streamSettings:{security:'none'}}]}),'on');
assert.equal(mode(null),'unconfigured');
assert.equal(mode({inbounds:[] }),'unconfigured');
assert.equal(mode({inbounds:[{protocol:'trojan',streamSettings:{}}]}),'unconfigured');
for(const contract of ['data-node-tls-effective','data-node-tls-state','data-node-tls-preferences','syncNodeEffectiveTls(dlg.querySelector','form[data-ent="nodes"] [name="profileId"]'])
 assert(ui.includes(contract),'Node TLS UI contract missing: '+contract);

// Keep certificate preferences in their own right-side surface: never let the
// primary column become taller than the viewport from TLS controls.
const nodeLayoutStart=ui.indexOf("  const fields=k==='squads'?");
const nodeLayoutEnd=ui.indexOf('  const boundedEntityEditor=',nodeLayoutStart);
assert(nodeLayoutStart>0&&nodeLayoutEnd>nodeLayoutStart,'Node editor composition not found');
const nodeLayout=ui.slice(nodeLayoutStart,nodeLayoutEnd);
assert(nodeLayout.includes('node-side-stack'),'Node editor must have a separate certificate/billing side stack');
assert(nodeLayout.includes("${billingFields}</div></section>${nodeTlsFields}"),'Certificate must follow billing in its own section');
assert(!nodeLayout.includes("nodeMainFields+'</div>'+nodeTlsFields"),'TLS must not expand primary node fields');
assert.match(css,/dialog\\.node-wide \\.node-side-stack \\{/,'Right-side node stack must have scoped geometry');

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
