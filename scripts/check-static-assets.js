#!/usr/bin/env node
'use strict';
// Protect production builds from silent 404s while keeping frontend/ as the
// single canonical browser-source tree.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const frontend=path.join(root,'frontend');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const dockerfile=read('backend/Dockerfile');
assert.match(dockerfile,/COPY frontend\/ \/app\/static\//,
  'Production image must copy the canonical frontend tree');

const pages=['frontend/index.html','frontend/login.html'];
const errors=[];
for(const page of pages){
  const html=read(page);
  for(const match of html.matchAll(/(?:href|src)=["']([^"']+\.(?:css|js))(?:\?[^"']*)?["']/g)){
    const url=match[1];
    if(/^https?:\/\//.test(url))continue;
    const asset=url.replace(/^\/+/, '');
    if(!fs.existsSync(path.join(frontend,asset)))errors.push(page+': missing source '+asset);
  }
}
if(errors.length){
  console.error(errors.join('\n'));
  process.exit(1);
}

const index=read('frontend/index.html');
const tlsJs=read('frontend/js/features/xray-studio/xray-studio-tls-dialog.js');
const tlsCss=read('frontend/styles/features/xray-studio/xray-studio-tls-dialog.css');
const xhttpExpert=read('frontend/js/features/xray-studio/xray-studio-xhttp-expert.js');
const diagnosticsJs=read('frontend/js/features/nodes/diagnostics.js');
const diagnosticsCss=read('frontend/styles/features/nodes/diagnostics.css');
new Function(tlsJs);
new Function(xhttpExpert);
new Function(diagnosticsJs);

assert.match(index,/xray-studio-tls-dialog\.css\?v=20261101-tls-layout-v5/,
  'TLS dialog stylesheet must receive the specificity-fix cache key');
assert.match(index,/xray-studio-tls-dialog\.js\?v=20261101-tls-workspace-v2/,
  'TLS workspace behavior cache key must remain stable until intentionally rotated');
assert.match(index,/node-dialogs\.js\?v=20261101-user-create-enterprise-v3/,
  'Create-user structural repair and Agent autovalidation handler must receive the current cache key');
assert.match(index,/user-create-v3\.css\?v=20261101-enterprise-v4/,
  'Enterprise create-user layout must be cache-busted');
assert.match(xhttpExpert,/Session ID/);
assert.match(index,/xray-studio-xhttp-expert\.js\?v=20261101-core-schema-v2/,
  'Expert XHTTP editor must be cache-busted and loaded after the strict schema');
assert.match(xhttpExpert,/sessionIDPlacement/);
assert.match(xhttpExpert,/sessionIDTable/);
assert.match(xhttpExpert,/sessionIDLength/);
assert.match(xhttpExpert,/seqPlacement/);
assert.match(xhttpExpert,/uplinkHTTPMethod/);
assert.match(xhttpExpert,/uplinkDataPlacement/);
assert.match(xhttpExpert,/uplinkChunkSize/);
assert.match(xhttpExpert,/xPaddingKey/);
assert.match(xhttpExpert,/xPaddingHeader/);
assert.match(xhttpExpert,/serverMaxHeaderBytes/);
assert.match(xhttpExpert,/noSSEHeader/);
assert.match(xhttpExpert,/window\.addEventListener\(['"]click['"],[\s\S]*true\)/,
  'Expert XHTTP editor must intercept before the legacy document-capture menu');
assert.match(xhttpExpert,/Client-only поля xmux\/downloadSettings\/noGRPCHeader\/scMinPostsIntervalMs блокируются/,
  'Server editor must keep client-only XHTTP knobs out of the guided UI');
assert.match(tlsJs,/action!==['"]tls['"]&&action!==['"]hysteria['"]/,
  'TLS override must be narrowly scoped to TLS and quick-Hysteria actions');
assert.match(tlsJs,/ev\.stopImmediatePropagation\(\)/,
  'Guided editor must intercept the historical raw-JSON TLS action');
assert.match(tlsJs,/next\.alpn=\[['"]h3['"]\]/,
  'Hysteria TLS editor must enforce h3 ALPN');
assert.match(tlsJs,/next\.minVersion=['"]1\.3['"];next\.maxVersion=['"]1\.3['"]/,
  'Hysteria TLS editor must enforce TLS 1.3');
assert.match(tlsJs,/tlsSettings:\{alpn:\[['"]h3['"]\],minVersion:['"]1\.3['"],maxVersion:['"]1\.3['"],certificates:\[\]\}/,
  'New Hysteria profiles must start with TLS 1.3 / h3');
assert.match(tlsJs,/current\.streamSettings\.security=['"]tls['"]/,
  'Applying guided TLS must explicitly preserve TLS security mode');
assert.match(tlsJs,/const next=clone\(advanced\)/,
  'Advanced tlsSettings must be merged from the current JSON rather than rebuilt destructively');
assert.match(tlsJs,/class="xm-tls-layout"/);
assert.match(tlsJs,/class="xm-tls-summary"/);
assert.match(tlsJs,/class="xm-tls-close xm-studio-modal-close" data-x aria-label="Закрыть окно">×<\/button>/,
  'TLS dialog must reuse the Nexus-wide close control');
assert.doesNotMatch(tlsJs,/function closeIcon\(/,
  'TLS dialog must not carry a second private close icon implementation');
assert.match(tlsCss,/dialog\.xm-tls-dialog\{[\s\S]*width:min\(1180px,calc\(100vw - 2rem\)\)!important/);
assert.match(tlsCss,/\.xm-tls-layout\{display:grid;grid-template-columns:1fr/);
assert.match(tlsCss,/\.xm-tls-summary\{[\s\S]*grid-template-columns:minmax\(180px,.8fr\) minmax\(430px,2fr\) minmax\(260px,1.2fr\)/);
assert.match(tlsCss,/\.xm-tls-summary dl\{[\s\S]*grid-template-columns:repeat\(4,minmax\(92px,1fr\)\)/);
assert.match(tlsCss,/\.xm-tls-settings\{[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(tlsCss,/\.xm-tls-block:nth-of-type\(3\)\{grid-column:1\/-1/);
assert.match(tlsCss,/\.xm-tls-advanced\{grid-column:1\/-1/);
assert.doesNotMatch(tlsCss,/position:sticky;top:0[\s\S]*\.xm-tls-summary/);
assert.match(tlsCss,/@media\(max-width:760px\)/);

assert.match(index,/diagnostics\.css\?v=20261101-operations-v1/);
assert.match(index,/diagnostics\.js\?v=20261101-operations-v1/);
assert.ok(index.indexOf('/js/core/app.js?v=')<index.indexOf('/js/features/nodes/diagnostics.js?v='),
  'Diagnostics route override must load after app.js');
assert.match(diagnosticsJs,/pages\.tools=\[['"]Диагностика['"],diagnosticsPage\]/);
assert.match(diagnosticsJs,/\/api\/v1\/system\/stats/);
assert.match(diagnosticsJs,/\/api\/v1\/nodes\/'\+encodeURIComponent\(node\.id\)\+'\/runtime/);
assert.match(diagnosticsJs,/\/api\/v1\/security\/audit/);
assert.match(diagnosticsJs,/Array\.isArray\(DB\?\.srh\)/);
assert.match(diagnosticsJs,/privacyNote:'Subscription URLs, credentials, audit details and request IP addresses are intentionally excluded\.'/);
assert.match(diagnosticsJs,/setInterval\(\(\)=>\{if\(location\.hash===['"]#tools['"]/);
assert.doesNotMatch(diagnosticsJs,/let\s+LOGS\s*=\s*\[\]/);
assert.match(diagnosticsCss,/\.diag-overview-grid\{display:grid/);
assert.match(diagnosticsCss,/@media\(max-width:760px\)/);

console.log('Canonical frontend tree + packaged static assets + critical UI contracts: OK');
