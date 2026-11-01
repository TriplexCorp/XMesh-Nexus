#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const dialogCss=fs.readFileSync('node-dialogs.css','utf8');
const userCss=fs.readFileSync('user-create-v3.css','utf8');
const dialogJs=fs.readFileSync('node-dialogs.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const strictBootstrap=fs.readFileSync('node-bootstrap-v6.js','utf8');
const dockerfile=fs.readFileSync('backend/Dockerfile','utf8');

assert.match(app, /<div class="bar2 nodes-toolbar"><p class="note">/,
 'Node list toolbar must be scoped to nodes page');
assert.match(app, /<button type="button" class="node-create-action" data-ne="nodes" aria-label="Добавить новый узел"><span class="node-create-icon" aria-hidden="true">/ ,
 'New Node button must retain its existing creation handler and accessible label');
assert.match(app, /<span class="node-create-label">Новый узел<\/span>/,
 'Node primary action must have clear visible text');
assert.doesNotMatch(app, /<button class="btn" data-ne="nodes">\$\{ic\('plus'\)\}Узел<\/button>/,
 'Old generic add-node button must not be rendered');
assert.match(app, /else if\(b=g\('\[data-ne\]'\)\)\{const \[k,id\]=b\.dataset\.ne\.split\(':'\);entForm\(k,id\)\}/,
 'Click must still open the existing node-creation dialog');
for(const selector of [
 '.nodes-toolbar .node-create-action{',
 '.nodes-toolbar .node-create-icon{',
 '.nodes-toolbar .node-create-label{',
 '.nodes-toolbar .node-create-action:hover{',
 '.nodes-toolbar .node-create-action:focus-visible{'
])assert(css.includes(selector),'Missing action styling: '+selector);
const nodeActionRule=css.match(/\.nodes-toolbar \.node-create-action\{([^}]*)\}/s);
assert(nodeActionRule,'Missing New Node CSS rule');
assert.match(nodeActionRule[1],/border-radius:\s*var\(--ui-control-radius\)\s*;/,
 'New Node button must consume the shared 1–36 px control radius with a valid semicolon');
assert.match(nodeActionRule[1],/background:color-mix\(in srgb,var\(--a\) 9%,var\(--elevated\)\);/,
 'Following surface declaration must remain independent of border-radius');
const radiusLines=css.split(/\r?\n/);
for(let i=0;i<radiusLines.length-1;i++){
  if(/^\s*border-radius\s*:/.test(radiusLines[i])
    && !/[;}]\s*(?:\/\/.*)?$/.test(radiusLines[i])
    && /^\s*[a-z-]+\s*:/.test(radiusLines[i+1]))
    assert.fail('Unterminated border-radius declaration before another CSS property at styles.css line '+(i+1));
}
assert.match(css, /\.nodes-toolbar \.node-create-icon\{[^}]*background:var\(--a\);[^}]*color:var\(--btn-text\);/s,
 'Icon must follow the active accent theme');
assert.match(css, /\.nodes-toolbar \.node-create-action\{[^}]*background:color-mix\(in srgb,var\(--a\) 9%,var\(--elevated\)\);/s,
 'Action must follow the selected theme surface');
assert.match(css, /@media\(max-width:390px\)\{\s*\.nodes-toolbar \.node-create-action\{width:100%;margin-left:0\}/,
 'New Node button must fit narrow phones');
assert.match(html,/styles\.css\?v=[a-z0-9-]+/,'Update CSS cache');
assert.match(html,/app\.js\?v=[a-z0-9-]+/,'Update JS cache');

// XMesh v6 security invariant: the UI must override the historical installer
// handler and pin the reviewed strict-PQ-only Node release. The Node bootstrap
// itself blocks router/Xray startup until a durable verified receipt exists.
assert.match(html,/<script src="\/node-bootstrap-v6\.js\?v=20261101-hysteria-policy-v1"><\/script>/,
 'Panel must cache-bust the strict-PQ bootstrap after changing the reviewed Node release pin');
assert.ok(html.indexOf('app.js?v=')<html.indexOf('/node-bootstrap-v6.js?v='),
 'Strict-PQ bootstrap override must load after the historical app handler');
assert.match(strictBootstrap,/XMESH_V6_NODE_BOOTSTRAP_SHA='6ff742b416e1134801943bf6f64d997e68dbdcaf'/,
 'Fresh Node installation must pin the reviewed XMesh-Node release with independent protocol credentials');
assert.match(strictBootstrap,/curl --proto "=https" --tlsv1\.3 --tls-max 1\.3/,
 'Public bootstrap download must negotiate TLS 1.3 only rather than advertising a TLS 1.2 minimum');
assert.doesNotMatch(strictBootstrap,/--tlsv1\.2/,
 'Generated bootstrap command must not retain the misleading TLS 1.2 floor');
assert.match(strictBootstrap,/XMesh Node v6 fresh installer\. Security invariant:/,
 'The downloaded installer must be marker-checked as the v6 fail-closed bootstrap');
assert.match(strictBootstrap,/sudo env XMESH_NODE_RELEASE_REF='\+XMESH_V6_NODE_BOOTSTRAP_SHA\+' bash \/tmp\/xmesh-bootstrap-v6\.sh/,
 'Panel command must make the reviewed release SHA authoritative inside bootstrap checkout');
assert.match(strictBootstrap,/document\.addEventListener\('click',xmeshV6StrictPqBootstrapClick,true\)/,
 'Strict-PQ handler must capture the bootstrap click before the historical handler');
assert.match(strictBootstrap,/\/api\/v1\/nodes\/'\+encodeURIComponent\(id\)\+'\/enrollment'/,
 'Bootstrap must use owner-issued one-time enrollment credentials');
assert.match(strictBootstrap,/enrollPath\+'\/reissue'/,
 'Explicit owner-approved legacy recovery must remain available without silent key replacement');
assert.match(strictBootstrap,/XMESH_V6_XSP_IDENTITY_CONFLICT='XSP-v2 identity already enrolled: legacy re-enrollment cannot rotate it\.'/,
 'UI must recognize the backend refusal to rotate an enrolled XSP-v2 identity through legacy recovery');
assert.match(strictBootstrap,/reuseExistingIdentity=true/,
 'Same-VPS XSP-v2 repair must reuse the existing durable identity instead of failing on legacy re-enrollment');
assert.match(strictBootstrap,/if\(!reuseExistingIdentity&&\(!issued\|\|!Number\.isInteger\(Number\(issued\.nodeId\)\)\|\|String\(issued\.token\|\|''\)\.length!==64\)\)/,
 'Fresh/legacy bootstrap must still require a valid issued one-time token while XSP-v2 same-VPS repair is tokenless');
assert.match(strictBootstrap,/Новый enrollment token не выдаётся, ключи не ротируются/,
 'Repair UI must explicitly state that XSP-v2 identity is preserved');
assert.match(strictBootstrap,/Для новой или заменённой VPS требуется отдельный XSP-v2 recovery\/rotation flow/,
 'Tokenless repair must be scoped to the same VPS and must not masquerade as replacement-host recovery');
assert.match(strictBootstrap,/Node\/Xray не запустятся без подтверждённой strict-PQ активации/,
 'UI must state the fail-closed runtime invariant');

// Redesigned modal surfaces share one cache-busted dialog asset layer.
assert.match(html,/<link rel="stylesheet" href="\/node-dialogs\.css\?v=20261101-user-create-v2">/,
 'Base dialog redesign stylesheet must remain available');
assert.match(html,/<link rel="stylesheet" href="\/user-create-v3\.css\?v=20261101-enterprise-v3">/,
 'Enterprise create-user stylesheet must be cache-busted');
assert.match(html,/<script src="\/node-dialogs\.js\?v=20261101-user-create-enterprise-v3"><\/script>/,
 'Dialog behavior enhancer must be cache-busted after create-user markup repair');
assert.match(dialogCss,/dialog\.xm-action-confirm:has\(\.xm-action-confirm-icon\)\{[\s\S]*width:min\(760px/,
 'Registered-node confirmation must no longer use the tiny shared width');
assert.match(dialogCss,/\.xm-action-confirm-close\{[\s\S]*grid-area:close/,
 'Confirmation close control must occupy the top-right grid area');
assert.match(dialogCss,/#dlg:has\(\.node-setup\)\{[\s\S]*width:min\(1060px/,
 'Strict-PQ command dialog must use the redesigned wide layout');
assert.match(dialogCss,/\.node-setup \.node-setup-close\{[\s\S]*right:0/,
 'Strict-PQ close button must be anchored on the right');
assert.match(dialogJs,/cancel\.click\(\)/,
 'Injected confirmation X must delegate to the existing cancel action so promises resolve');
assert.match(strictBootstrap,/node-setup-title-wrap/,'Strict-PQ dialog must expose the redesigned header structure');
assert.match(strictBootstrap,/node-setup-identity-note/,'Strict-PQ identity warning must use the redesigned note surface');

// New-user dialog keeps existing form contracts while presenting a valid,
// horizontal enterprise workspace. This explicitly guards the malformed class
// regression that caused native controls/options to render as loose text.
assert.match(dialogJs,/userNew=function userNewRedesigned\(\)/,
 'New-user action must be overridden after app.js without changing the generic form renderer');
assert.match(dialogJs,/class="box user-create-dialog" data-k="user" method="dialog"/,
 'Redesigned form must preserve the existing user submit contract');
assert.ok(dialogJs.includes('class="f user-create-field ${extra}"'),
 'Decorated field class must keep its closing quote so the browser receives valid HTML');
assert.doesNotMatch(dialogJs,/class="f user-create-field \$\{extra\}`/,
 'Malformed unclosed class replacement must never return');
assert.match(dialogJs,/window\.XMeshSelects\?\.refresh\?\.\(dlg\)/,
 'Dynamic user selects must be explicitly enhanced after rendering');
assert.match(dialogJs,/id="tplsel"/,'Template handler must keep its existing selector');
assert.match(dialogJs,/data-generate-username/,'Username generator action must be preserved');
assert.match(dialogJs,/decorate\('xrayProfileId'/,'Xray profile assignment must remain in the form');
assert.match(dialogJs,/decorate\('squads'/,'Squad assignment must remain in the form');
assert.match(dialogJs,/decorate\('hold'/,'On-hold expiry mode must remain in the form');
assert.match(dialogJs,/name="desc"/,'Description must still submit through the existing user payload');
assert.match(dialogJs,/class="user-create-close" data-x aria-label="Закрыть">×<\/button>/,
 'New-user close control must use the shared data-x close contract');
assert.match(dialogJs,/user-create-workspace/,'Create-user form must use the enterprise workspace wrapper');
assert.match(dialogJs,/Умный лимит устройств/,'Device limit behavior must be explained in the creation flow');
assert.match(userCss,/#dlg\.user-create-modal\{[\s\S]*width:min\(1280px/,
 'New-user dialog must use the wider desktop surface');
assert.match(userCss,/\.user-create-workspace\{[\s\S]*grid-template-columns:minmax\(0,1\.28fr\) minmax\(360px,\.72fr\)/,
 'Desktop create-user workspace must use a balanced two-zone layout');
assert.match(userCss,/\.user-create-limits-grid\{[\s\S]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/,
 'Limits must use readable two-column policy layout instead of four squeezed controls');
assert.match(userCss,/\.user-create-section-extra\{grid-column:1\/-1\}/,
 'Metadata section must span the full desktop workspace');
assert.match(userCss,/@media\(max-width:680px\)[\s\S]*\.user-create-limits-grid,/,
 'Create-user workspace must collapse cleanly on narrow screens');
assert.match(userCss,/\.user-create-footer-actions\{display:flex/,
 'Create/cancel actions must stay grouped in a dedicated footer');

assert.match(dockerfile,/node-dialogs\.css user-create-v3\.css node-dialogs\.js/,
 'Production panel image must package the create-user enterprise stylesheet with dialog assets');
assert.match(dockerfile,/app\.js user-fingerprint-override\.js node-bootstrap-v6\.js unified-selects\.js/,
 'Production panel image must package user fingerprint control and the strict-PQ bootstrap override');

assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length,'CSS braces must remain balanced');
assert.equal((dialogCss.match(/\{/g)||[]).length,(dialogCss.match(/\}/g)||[]).length,'Dialog CSS braces must remain balanced');
assert.equal((userCss.match(/\{/g)||[]).length,(userCss.match(/\}/g)||[]).length,'Create-user CSS braces must remain balanced');
new Function(app);
new Function(strictBootstrap);
new Function(dialogJs);
console.log('Node action: redesigned repair + valid enterprise new-user dialog, TLS 1.3 bootstrap and exact-release strict-PQ repair contract OK');
