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
for(const contract of ['data-node-tls-effective','data-node-tls-state','data-node-tls-dialog','data-node-tls-open','syncNodeEffectiveTls(dlg.querySelector','form[data-ent="nodes"] [name="profileId"]'])
 assert(ui.includes(contract),'Node TLS UI contract missing: '+contract);

// A TLS-required profile cannot be saved without a real certificate source.
const readyStart=ui.indexOf('function nodeTlsReadiness(profile,data={}){');
const readyEnd=ui.indexOf('function syncNodeEffectiveTls(',readyStart);
assert(readyStart>=0&&readyEnd>readyStart,'Missing certificate readiness helper');
const readiness=new Function('nodeEffectiveTlsMode','inbs',
  ui.slice(readyStart,readyEnd)+'return nodeTlsReadiness;')(mode,p=>p.inbounds);
const makeProfile=(protocol,security,certificates)=>({inbounds:[{protocol,
  streamSettings:{security,tlsSettings:certificates?{certificates}:{}}}]});
for(const protocol of ['vless','trojan','vmess','shadowsocks','hysteria','masque','custom']){
  assert.equal(readiness(makeProfile(protocol,'none'),{addr:'192.0.2.5'}).ready,true,protocol+' NONE must not be blocked');
  assert.equal(readiness(makeProfile(protocol,'reality'),{addr:'192.0.2.5'}).ready,true,protocol+' REALITY must not be blocked');
  const missing=readiness(makeProfile(protocol,'tls'),{addr:'192.0.2.5'});
  assert.equal(missing.ready,false,protocol+' TLS without a certificate must be blocked');
  assert.match(missing.reason,/DNS-домен/);
  const acme=readiness(makeProfile(protocol,'tls'),{addr:'192.0.2.5',tlsDomain:'node.example.org',tlsAcmeEmail:'admin@example.org'});
  assert.equal(acme.ready,true,protocol+' TLS with ACME must be ready to provision');
  assert.equal(acme.method,'acme');
}
const external=[{certificateFile:'/etc/ssl/node.crt',keyFile:'/etc/ssl/node.key'}];
assert.equal(readiness(makeProfile('trojan','tls',external),{addr:'192.0.2.5',tlsManualProvision:true}).ready,true);
assert.equal(readiness(makeProfile('trojan','tls'),{addr:'node.example.org',tlsManualProvision:true}).ready,false);
assert.equal(readiness(makeProfile('vless','tls'),{addr:'node.example.org',tlsAcmeEmail:''}).ready,false);
assert.equal(readiness(makeProfile('vless','tls'),{tlsDomain:'node.example.org',tlsAcmeEmail:'ops@example.org',tlsAutoProvision:true,tlsManualProvision:true}).ready,false);
assert.match(ui,/data-node-tls-readiness/);
assert.match(ui,/data-node-tls-dialog/);
assert.match(ui,/data-node-tls-open/);
assert.match(ui,/nodeTlsMethod/);
assert.match(ui,/openNodeTlsSetup\(f,readiness\.field\)/);
assert(!ui.includes('node-tls-popup'),'Legacy overlapping TLS popover must not return');
assert.match(ui,/node-network-stack/);
assert.match(ui,/certificate\.mode==='on'&&!certificate\.ready/);
assert(css.includes('dialog.node-wide .node-network-stack {'),'TLS settings must have right-column layout');
assert(css.includes('dialog.node-wide dialog.node-tls-setup-dialog'),'Certificate setup must have an independent modal surface');
assert(!css.includes('.node-tls-popup'),'Old overlapping popup CSS should be removed');

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
