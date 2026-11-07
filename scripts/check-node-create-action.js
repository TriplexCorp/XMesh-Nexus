#!/usr/bin/env node
'use strict';
const {assertPackaged}=require('./ci/frontend-source.cjs');
const {panelStyles}=require('./ci/frontend-source.cjs');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const css=panelStyles();
const dialogCss=fs.readFileSync('frontend/styles/features/nodes/node-dialogs.css','utf8');
const userCss=fs.readFileSync('frontend/styles/features/users/user-editor.css','utf8');
const sharingJs=fs.readFileSync('frontend/js/features/users/user-sharing-risk.js','utf8');
const sharingContext=fs.readFileSync('frontend/js/features/users/user-sharing-context.js','utf8');
const sharingCss=fs.readFileSync('frontend/styles/features/users/user-sharing-risk.css','utf8');
const dialogJs=fs.readFileSync('frontend/js/features/nodes/node-dialogs.js','utf8');
const html=fs.readFileSync('frontend/index.html','utf8');
const strictBootstrap=fs.readFileSync('frontend/js/features/nodes/node-bootstrap-v6.js','utf8');
const dockerfile=fs.readFileSync('backend/Dockerfile','utf8');

assert.match(app, /<div class="nodes-toolbar nx-workspace-toolbar" data-ui-toolbar="filters" role="search"/,
 'Node list toolbar must be scoped to nodes page');
assert.match(app, /<button type="button" class="node-create-action nx-workspace-create" data-ne="nodes" aria-label="Добавить новый узел"><span class="node-create-icon nx-workspace-create-icon" aria-hidden="true">/ ,
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
assert.match(html,/nexus-ui-v3\.css\?v=[a-f0-9]{12}/,'Update CSS cache');
assert.match(html,/app\.js\?v=[a-z0-9-]+/,'Update JS cache');

// XMesh v6 security invariant: the UI must override the historical installer
// handler and pin the reviewed strict-PQ-only Node release. The Node bootstrap
// itself blocks router/Xray startup until a durable verified receipt exists.
assert.match(html,/<script src="\/js\/features\/nodes\/node-bootstrap-v6\.js\?v=[a-z0-9._-]+"><\/script>/i,
 'Panel must cache-bust the strict-PQ bootstrap after changing the reviewed Node release pin');
assert.ok(html.indexOf('app.js?v=')<html.indexOf('/js/features/nodes/node-bootstrap-v6.js?v='),
 'Strict-PQ bootstrap override must load after the historical app handler');
assert.match(strictBootstrap,/XMESH_V6_NODE_BOOTSTRAP_SHA='8ec09c3bd4c0dfd0b4eabee074a68ad30a67830b'/,
 'Fresh Node installation must pin the strict-PQ Node release compatible with control-v6.0.7');
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
assert.match(html,/<script src="\/js\/features\/nodes\/node-dialogs\.js\?v=[a-z0-9._-]+"><\/script>/i,
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
assert.match(userCss,/#dlg\.user-create-modal\{[\s\S]*width:min\(1380px/,
 'New-user dialog must use the quieter v5 desktop surface');
assert.match(userCss,/\.user-create-workspace\{[\s\S]*grid-template-columns:minmax\(0,1\.72fr\) minmax\(360px,\.78fr\)/,
 'Desktop create-user workspace must use the refined v5 two-zone layout');
assert.match(userCss,/\.user-create-limits-grid\{[\s\S]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/,
 'Limits must use readable two-column policy layout instead of four squeezed controls');
assert.match(userCss,/\.user-create-section-extra\{grid-column:1\/-1/,
 'Metadata section must span the full desktop workspace');
assert.match(userCss,/container-type:inline-size;container-name:nx-user-extra/,
 'Metadata layout must respond to its actual dialog section width');
assert.match(userCss,/@container nx-user-extra \(min-width:44rem\)/,
 'Metadata must have a two-column layout at intermediate section sizes');
assert.match(userCss,/@container nx-user-extra \(min-width:78rem\)/,
 'Four-column metadata is allowed only when its parent is wide enough');
assert.match(userCss,/grid-template-areas:"squads squads" "tag hold" "desc desc"/,
 'Squads and notes must span both columns before the full-width layout');
assert.match(userCss,/#dlg\.user-create-modal \.user-create-hold \.sw>span\{[\s\S]*width:2\.8rem;[\s\S]*height:1\.6rem/,
 'On-hold control must retain a compact switch inside a full-width interactive row');
assert.match(userCss,/#dlg\.user-create-modal \.user-create-desc textarea\{[\s\S]*overflow-x:hidden;/,
 'User notes must never introduce a horizontal scroller');
assert.match(userCss,/\.user-create-section-kicker\{display:none\}/,
 'Duplicate English section kickers must stay visually suppressed');
assert.match(userCss,/\.user-create-footer-copy\{display:none\}/,
 'Footer must avoid repeating header explanatory copy');
assert.match(userCss,/@media\(max-width:680px\)[\s\S]*\.user-create-main-grid,\s*\.user-create-limits-grid\{grid-template-columns:minmax\(0,1fr\)/,
 'Create-user workspace must collapse cleanly on narrow screens');
assert.match(userCss,/\.user-create-footer-actions\{display:flex/,
 'Create/cancel actions must stay grouped in a dedicated footer');

// Activity history must report verifiable facts without pseudo-risk scoring.
assert.match(html,/user-sharing-context\.js\?v=[a-f0-9]{12}[\s\S]*user-sharing-risk\.js\?v=[a-f0-9]{12}/,
 'Context must load immediately before the isolated activity feature');
assert.match(sharingContext,/globalThis\.DB=DB/,
 'Activity workspace must receive the existing, authorized runtime snapshot');
assert.match(sharingJs,/traffic\/history\?range=7d/,
 'Traffic history must be sourced from the authenticated seven-day API');
assert.match(sharingJs,/function activityFor\(user\)/,
 'Activity must be loaded only when the user opens its details');
assert.match(sharingJs,/new7d:devices\.filter/,
 'Registered devices must be counted from their actual first-seen timestamps');
assert.match(sharingJs,/recent24h:valid\.filter/,
 'Rolling byte totals must reflect actual Xray samples');
assert.match(sharingJs,/trafficAvailable=false/,
 'History failures must not be silently displayed as zero traffic');
assert.doesNotMatch(sharingJs,/function tier\(score\)|const score=Math\.min\(100|riskFor\(|result\.score/,
 'Switching nodes or adding devices must never create a fabricated account-sharing score');
assert.doesNotMatch(sharingJs,/xm-sharing-overview-action|xm-sharing-score|xm-risk-pill/,
 'Do not turn routine traffic and device changes into a noisy global alert banner');
assert.match(sharingJs,/data-sharing-focus="activity"/,
 'Activity entry point must be available in the Users directory');
assert.match(sharingJs,/dataset\.sharingHead='devices'/,'Users table must retain Devices');
assert.match(sharingJs,/dataset\.sharingHead='risk'/,'Users table must retain Activity column');
assert.match(sharingJs,/const activityPanel=.{0,12}<section id="xm-activity-panel"/,
 'Neutral activity facts must render in the shared device-management workspace');
assert.match(sharingJs,/data-device-view-devices/,
 'Activity must provide navigation back to registered devices');
assert.match(sharingCss,/dialog#xm-sharing-dialog\.xm-sharing-dialog\{/,
 'Activity must reuse the native Nexus dialog material');
assert.match(sharingCss,/height:fit-content;block-size:fit-content/,
 'The native dialog must be content-sized instead of stretching to viewport height');
assert.match(sharingCss,/\.xm-activity-stats\{display:grid/,
 'Actual metrics must have a compact responsive layout');
assert.match(sharingCss,/@container sharing-content \(max-width:39rem\)/,
 'Embedded device workspace must reflow according to actual available width');
assert.match(sharingJs,/Лимит устройств контролируется отдельно на сервере/,
 'Interface must explain that real HWID restrictions are server-enforced');

assertPackaged(assert,['node-dialogs.css','user-editor.css','user-sharing-risk.css','node-dialogs.js']);
assertPackaged(assert,['diagnostics.js', 'diagnostics.css', 'user-sharing-context.js', 'user-sharing-risk.js']);
assertPackaged(assert,['app.js', 'user-fingerprint-override.js', 'node-bootstrap-v6.js', 'unified-selects.js']);

assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length,'CSS braces must remain balanced');
assert.equal((dialogCss.match(/\{/g)||[]).length,(dialogCss.match(/\}/g)||[]).length,'Dialog CSS braces must remain balanced');
assert.equal((userCss.match(/\{/g)||[]).length,(userCss.match(/\}/g)||[]).length,'Create-user CSS braces must remain balanced');
assert.equal((sharingCss.match(/\{/g)||[]).length,(sharingCss.match(/\}/g)||[]).length,'Sharing-risk CSS braces must remain balanced');
new Function(app);
new Function(strictBootstrap);
new Function(dialogJs);
new Function(sharingContext);
new Function(sharingJs);
// Keep create and edit user contact fields in sync (both are optional).
assert.ok(dialogJs.includes("decorate('tg','', 'user-create-tg')"),
 'Create dialog must show Telegram ID');
assert.ok(dialogJs.includes("decorate('email','', 'user-create-email')"),
 'Create dialog must show Email');
assert.ok(dialogJs.includes('user-create-contact-grid'),
 'Contact information must use the compact adaptive grid');
assert.ok(app.includes("{k:'tg',l:'Telegram ID'"),
 'Create schema must read Telegram ID');
assert.ok(app.includes("{k:'email',l:'Email',t:'email'"),
 'Create schema must read optional typed email');
assert.ok(app.includes('tag:d.tag,tg:d.tg,email:d.email,desc:d.desc'),
 'Create API payload must persist both contacts');
assert.ok(app.includes("querySelector('.user-create-submit, .act .btn')"),
 'Submitting the new dialog must disable its real create button');
assert.ok(userCss.includes('.user-create-contact-grid{'),
 'Canonical user editor must own contact field styles');

console.log('Node action: create-user v5 + explainable anti-sharing risk, strict-PQ repair and dialog contracts OK');
