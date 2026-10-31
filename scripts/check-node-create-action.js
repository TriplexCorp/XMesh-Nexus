#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
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
assert.match(html,/<script src="node-bootstrap-v6\.js\?v=20261031-strict-pq-only"><\/script>/,
 'Panel must load the strict-PQ bootstrap override after app.js');
assert.ok(html.indexOf('app.js?v=')<html.indexOf('node-bootstrap-v6.js?v='),
 'Strict-PQ bootstrap override must load after the historical app handler');
assert.match(strictBootstrap,/XMESH_V6_NODE_BOOTSTRAP_SHA='7b6ec04d7dfe6e9b785f9988b5c43afb64499456'/,
 'Fresh Node installation must pin the reviewed XMesh-Node strict-PQ-only release');
assert.match(strictBootstrap,/XMesh Node v6 fresh installer\. Security invariant:/,
 'The downloaded installer must be marker-checked as the v6 fail-closed bootstrap');
assert.match(strictBootstrap,/sudo env XMESH_NODE_RELEASE_REF='\+XMESH_V6_NODE_BOOTSTRAP_SHA\+' bash \/tmp\/xmesh-bootstrap-v6\.sh/,
 'Panel command must make the reviewed release SHA authoritative inside bootstrap checkout');
assert.match(strictBootstrap,/document\.addEventListener\('click',xmeshV6StrictPqBootstrapClick,true\)/,
 'Strict-PQ handler must capture the bootstrap click before the historical handler');
assert.match(strictBootstrap,/\/api\/v1\/nodes\/'\+encodeURIComponent\(id\)\+'\/enrollment'/,
 'Bootstrap must use owner-issued one-time enrollment credentials');
assert.match(strictBootstrap,/enrollPath\+'\/reissue'/,
 'Explicit owner-approved recovery must remain available without silent key replacement');
assert.match(strictBootstrap,/Node\/Xray не запустятся без подтверждённой strict-PQ активации/,
 'UI must state the fail-closed runtime invariant');
assert.match(dockerfile,/app\.js node-bootstrap-v6\.js unified-selects\.js/,
 'Production panel image must package the strict-PQ bootstrap override');

assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length,'CSS braces must remain balanced');
new Function(app);
new Function(strictBootstrap);
console.log('Node action: visuals + exact-release v6 strict-PQ-only bootstrap contract OK');
