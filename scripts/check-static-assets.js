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
assert.match(dockerfile,/sed -E -i[\s\S]*\/app\/static\/nexus-ui-v3\.css \/app\/static\/login\.css/,
  'Flattened panel and login CSS entrypoints must rewrite relative imports to flat runtime aliases');
assert.match(dockerfile,/production silently loses design[\s\S]*tokens\/features/,
  'Packaging must document the relative-import failure mode protected by this contract');

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
if(errors.length){console.error(errors.join('\n'));process.exit(1)}

const index=read('frontend/index.html');
const login=read('frontend/login.html');
const loginJs=read('frontend/js/auth/login.js');
const loginCss=read('frontend/styles/auth/login.css');
const nexusCss=read('frontend/styles/system/nexus-ui-v3.css');
const userViewport=read('frontend/styles/features/users/user-dialog-viewport.css');
const subscriptionSurface=read('frontend/styles/features/subscriptions/subscription-surface.css');
const subscriptionPublic=read('frontend/styles/features/subscriptions/subscription-public.css');
const subscriptionTemplate=read('backend/src/subscription_template.html');
const i18nConsistency=read('frontend/js/core/i18n-consistency.js');
const tlsJs=read('frontend/js/features/xray-studio/xray-studio-tls-dialog.js');
const tlsCss=read('frontend/styles/features/xray-studio/xray-studio-tls-dialog.css');
const xhttpExpert=read('frontend/js/features/xray-studio/xray-studio-xhttp-expert.js');
const diagnosticsJs=read('frontend/js/features/nodes/diagnostics.js');
const diagnosticsCss=read('frontend/styles/features/nodes/diagnostics.css');
new Function(loginJs);
new Function(i18nConsistency);
new Function(tlsJs);
new Function(xhttpExpert);
new Function(diagnosticsJs);

const hashedAsset=(asset)=>new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\?v=[a-f0-9]{12}');
assert.match(login,hashedAsset('login.css'),'Login stylesheet must use a content-addressed cache key');
assert.match(login,hashedAsset('login.js'),'Login appearance/auth runtime must use a content-addressed cache key');
assert.match(login,/<script src="\/js\/core\/i18n\.js\?v=[a-f0-9]{12}" defer><\/script>\s*<script src="\/js\/auth\/login\.js\?v=[a-f0-9]{12}" defer><\/script>/,
  'Login must preserve canonical i18n-before-auth runtime order');
assert.match(loginJs,/localStorage\.xmeshNexusSettings/,'Login must reuse the panel appearance settings instead of a private theme');
for(const key of ['theme','accent','density','surface','glow','font','borders','motion']){
  assert.match(loginJs,new RegExp('root\\.dataset\\.'+key+'='),'Login must apply shared appearance dimension: '+key);
}
assert.match(loginCss,/@import url\("\.\.\/system\/nexus-v3-foundation\.css/,'Login must consume the canonical design-system foundation');
assert.match(loginCss,/@import url\("\.\.\/system\/nexus-v3-components\.css/,'Login must consume shared Nexus components/tokens');
assert.match(loginCss,/backdrop-filter:var\(--nx-backdrop\)/,'Login card must honor the shared solid/glass/raised material contract');

// Cross-surface consistency contracts introduced after the visual audit.
assert.match(index,hashedAsset('i18n-consistency.js'),'Late-render i18n consistency runtime must be content-addressed');
assert(index.indexOf('/js/core/i18n.js?v=')<index.indexOf('/js/core/i18n-consistency.js?v='),'Canonical i18n must load before its dynamic consistency layer');
assert(index.indexOf('/js/core/i18n-consistency.js?v=')<index.indexOf('/js/core/app.js?v='),'Dynamic i18n observer must exist before app routes render');
assert.match(nexusCss,/subscription-surface\.css\?v=[a-f0-9]{12}/,'Panel preview must import the shared subscription surface');
assert(subscriptionTemplate.includes('id="subscription-public-assets">{{PUBLIC_CSS}}</style>'),
  'Live subscription portal must bundle CSS for legacy gateways');
assert(read('backend/src/user_subscriptions_base.rs').includes('include_str!("../../frontend/styles/features/subscriptions/subscription-surface.css")'),
  'Bundled portal CSS must include the same shared surface as Studio');
for(const selector of ['subscription-preview-brand','subscription-preview-hero','subscription-preview-meta','subscription-preview-cta']){
  assert(subscriptionSurface.includes('.'+selector),'Shared subscription surface missing '+selector);
}
for(const selector of ['subscription-public-grid','subscription-public-catalog','subscription-preview-apps']){
  assert(subscriptionPublic.includes('.'+selector),'Production portal geometry missing '+selector);
}
assert(!subscriptionSurface.includes('.subscription-public .subscription-public-catalog{'),
  'Shared surface must never override visitor catalog geometry');
assert(!nexusCss.includes('subscription-public.css'),
  'Production visitor CSS must never enter authenticated panel graph');
assert.match(userViewport,/grid-template-rows:auto auto minmax\(0,1fr\) auto/,'User drawer must keep header/overview/body/footer as separate viewport rows');
assert.match(userViewport,/grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,21rem\),1fr\)\)/,'User drawer must reflow by available scaled width');
assert.match(nexusCss,/#stats-user-modal\{[\s\S]*--dialog-width:96rem/,'User Intelligence must remain a workstation-sized dialog');
assert.match(nexusCss,/#stats-user-modal \.stats-user-pane:not\(\[hidden\]\)\{[\s\S]*min-height:14rem[\s\S]*overflow:auto/,'Visible analytics tabs must own a real scrollable work area');
assert.match(nexusCss,/transition-behavior:allow-discrete/,'Dialog close motion must preserve discrete top-layer transitions');
assert.doesNotMatch(nexusCss,/:where\([^)]*\.search[^)]*\):not\(:disabled\):hover/,'Non-control search/container classes must not inherit clickable hover motion');

assert.match(index,hashedAsset('xray-studio-tls-dialog.js'),'TLS workspace behavior must use a content-addressed cache key');
assert.match(index,hashedAsset('node-dialogs.js'),'Create-user structural repair and Agent autovalidation handler must use a content-addressed cache key');
assert.match(xhttpExpert,/Session ID/);
assert.match(index,hashedAsset('xray-studio-xhttp-expert.js'),'Expert XHTTP editor must be content-addressed and loaded after the strict schema');
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
assert.match(xhttpExpert,/window\.addEventListener\(['"]click['"],[\s\S]*true\)/,'Expert XHTTP editor must intercept before the legacy document-capture menu');
assert.match(xhttpExpert,/Client-only поля xmux\/downloadSettings\/noGRPCHeader\/scMinPostsIntervalMs блокируются/,'Server editor must keep client-only XHTTP knobs out of the guided UI');
assert.match(tlsJs,/action!==['"]tls['"]&&action!==['"]hysteria['"]/,'TLS override must be narrowly scoped to TLS and quick-Hysteria actions');
assert.match(tlsJs,/ev\.stopImmediatePropagation\(\)/,'Guided editor must intercept the historical raw-JSON TLS action');
assert.match(tlsJs,/next\.alpn=\[['"]h3['"]\]/,'Hysteria TLS editor must enforce h3 ALPN');
assert.match(tlsJs,/next\.minVersion=['"]1\.3['"];next\.maxVersion=['"]1\.3['"]/,'Hysteria TLS editor must enforce TLS 1.3');
assert.match(tlsJs,/tlsSettings:\{alpn:\[['"]h3['"]\],minVersion:['"]1\.3['"],maxVersion:['"]1\.3['"],certificates:\[\]\}/,'New Hysteria profiles must start with TLS 1.3 / h3');
assert.match(tlsJs,/current\.streamSettings\.security=['"]tls['"]/,'Applying guided TLS must explicitly preserve TLS security mode');
assert.match(tlsJs,/const next=clone\(advanced\)/,'Advanced tlsSettings must be merged from the current JSON rather than rebuilt destructively');
assert.match(tlsJs,/class="xm-tls-layout"/);
assert.match(tlsJs,/class="xm-tls-summary"/);
assert.match(tlsJs,/class="xm-tls-close xm-studio-modal-close" data-x aria-label="Закрыть окно">×<\/button>/,'TLS dialog must reuse the Nexus-wide close control');
assert.doesNotMatch(tlsJs,/function closeIcon\(/,'TLS dialog must not carry a second private close icon implementation');
assert.match(tlsCss,/dialog\.xm-tls-dialog\{[\s\S]*width:min\(1180px,calc\(100vw - 2rem\)\);[\s\S]*max-width:calc\(100vw - 2rem\)/,'TLS dialog must remain viewport-bounded without specificity hacks');
assert.doesNotMatch(tlsCss,/dialog\.xm-tls-dialog\{[\s\S]*width:[^;}]+!important/,'TLS dialog width must not rely on !important');
assert.match(tlsCss,/\.xm-tls-layout\{display:grid;grid-template-columns:1fr/);
assert.match(tlsCss,/\.xm-tls-summary\{[\s\S]*grid-template-columns:minmax\(180px,.8fr\) minmax\(430px,2fr\) minmax\(260px,1.2fr\)/);
assert.match(tlsCss,/\.xm-tls-summary dl\{[\s\S]*grid-template-columns:repeat\(4,minmax\(92px,1fr\)\)/);
assert.match(tlsCss,/\.xm-tls-settings\{[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(tlsCss,/\.xm-tls-block:nth-of-type\(3\)\{grid-column:1\/-1/);
assert.match(tlsCss,/\.xm-tls-advanced\{grid-column:1\/-1/);
assert.doesNotMatch(tlsCss,/position:sticky;top:0[\s\S]*\.xm-tls-summary/);
assert.match(tlsCss,/@media\(max-width:760px\)/);

assert.match(index,hashedAsset('diagnostics.js'));
assert.ok(index.indexOf('/js/core/app.js?v=')<index.indexOf('/js/features/nodes/diagnostics.js?v='),'Diagnostics route override must load after app.js');
assert.match(diagnosticsJs,/pages\.tools=\[['"]Диагностика['"],diagnosticsPage\]/);
assert.match(diagnosticsJs,/\/api\/v1\/system\/stats/);
assert.match(diagnosticsJs,/\/api\/v1\/nodes\/'\+encodeURIComponent\(node\.id\)\+'\/runtime/);
assert.match(diagnosticsJs,/\/api\/v1\/security\/audit/);
assert.match(diagnosticsJs,/Array\.isArray\(DB\?\.srh\)/);
assert.match(diagnosticsJs,/privacyNote:'Subscription URLs, credentials, audit details and request IP addresses are intentionally excluded\.'/);
assert.match(diagnosticsJs,/setInterval\(\(\)=>\{if\(location\.hash===['"]#tools['"]/);
assert.doesNotMatch(diagnosticsJs,/let\s+LOGS\s*=\s*\[\]/);
assert.match(diagnosticsCss,/\.diag-overview-grid\{display:grid/);
assert.match(diagnosticsCss,/@container diagnostics \(max-width:760px\)/);

console.log('Canonical frontend tree + packaged static assets + login appearance + critical UI contracts: OK');
