#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');

const index=fs.readFileSync('index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
const entry=fs.readFileSync('nexus-ui-v3.css','utf8');
const foundation=fs.readFileSync('nexus-v3-foundation.css','utf8');
const components=fs.readFileSync('nexus-v3-components.css','utf8');
const layout=fs.readFileSync('nexus-v3-layout.css','utf8');
const builder=fs.readFileSync('ui-builder.js','utf8');
const docs=fs.readFileSync('docs/UI_SYSTEM.md','utf8');
const squad=fs.readFileSync('squad-editor-premium-v5.css','utf8');

assert.match(index,/nexus-ui-v3\.css\?v=[a-z0-9-]+/,'Design System v3 entrypoint must be cache-busted');
assert.match(index,/ui-builder\.js\?v=[a-z0-9-]+/,'UI builder must be cache-busted');
const lastCss=index.lastIndexOf('<link rel="stylesheet"');
assert(index.slice(lastCss).includes('nexus-ui-v3.css'),'Design System v3 must be the final global stylesheet');
assert(index.indexOf('app.js?v=')<index.indexOf('ui-builder.js?v='),'UI builder must load after app.js');
assert.match(index,/<aside data-ui-surface="panel">/,'Sidebar must opt into the shared panel material explicitly');

for(const retired of ['global-hover.css','ui-system.css','design-system-v2.css','spatial-engine.css','spatial-layout.css']){
  assert(!index.includes(retired),'Retired global layer must not be loaded: '+retired);
  assert(!docker.includes(' '+retired+' '),'Retired global layer must not be packaged: '+retired);
}
for(const asset of ['nexus-ui-v3.css','nexus-v3-foundation.css','nexus-v3-components.css','nexus-v3-layout.css','ui-builder.js']){
  assert(docker.includes(asset),'Production image must package '+asset);
}

for(const module of ['nexus-v3-foundation.css','nexus-v3-components.css','nexus-v3-layout.css']){
  assert(entry.includes(module),'v3 entrypoint must import '+module);
}
assert.equal((entry.match(/@import/g)||[]).length,3,'v3 entrypoint must have exactly three architecture modules');

for(const surface of ['solid','glass','raised']){
  assert(foundation.includes('html[data-surface='+surface+']'),'Missing shared '+surface+' material');
}
for(const token of [
  '--nx-control-h','--nx-card-pad','--nx-page-gap','--nx-panel-bg','--nx-control-bg','--nx-selected-bg',
  '--ui-surface-panel-bg','--ui-surface-dialog-bg','--ui-surface-section-bg','--ui-surface-item-bg',
  '--ui-surface-control-bg','--ui-surface-border','--ui-separator','--ui-surface-filter',
  '--ds-control-h','--ds-card-pad','--ds-page-gap','--ds-selected-bg'
])assert(foundation.includes(token),'Missing v3 foundation token '+token);
assert.match(foundation,/html\[data-surface=glass\][\s\S]*--nx-backdrop:blur\(/,'Glass must use real backdrop blur');
assert.match(foundation,/html\[data-surface=raised\]/,'Raised material block missing');
assert.match(foundation,/html\[data-theme=light\]\[data-surface=raised\]/,'Light Raised must have a dedicated depth profile');
assert.match(foundation,/html\[data-borders=off\]/,'Border off mode must be centralized');
assert.match(foundation,/html\[data-borders=strong\]/,'Strong border mode must be centralized');
assert.match(foundation,/html\[data-density=compact\]/,'Density must be centralized');
assert.match(foundation,/prefers-reduced-transparency/,'Glass must respect reduced transparency');

assert.doesNotMatch(components,/html\[data-surface=(?:solid|glass|raised)\]/,'Components must consume material tokens, not fork surface modes');
assert.doesNotMatch(layout,/html\[data-surface=(?:solid|glass|raised)\]/,'Layout must consume material tokens, not fork surface modes');
assert.match(components,/body \.app \.card,[\s\S]*\[data-ui-surface="panel"\][\s\S]*--nx-panel-bg/,'Shared panel primitive must outrank legacy material selectors without theme forks');
assert.match(components,/body \.app>aside\[data-ui-surface="panel"\]/,'Sidebar material must be owned by the shared v3 primitive');
assert.match(components,/:is\(\.app,dialog\) \.seg button\.on[\s\S]*--ui-segment-active-bg/,'Shared selected segment primitive missing');
assert.match(components,/dialog#dlg \.box,dialog#dlg form\.box/,'Shared dialog shell primitive missing');
assert.match(components,/Composite controls own exactly one material shell/,'Composite control ownership must be documented in CSS');
assert.match(components,/transform:none/,'Generic hover must not use lift motion');

assert.match(layout,/\.view\[data-ui-flow="workspace"\][\s\S]*grid-auto-rows:max-content/,'Workspace flow must be content-driven');
assert.match(layout,/\[data-ui-collection\]\[data-ui-count="1"\]\[data-ui-low-count="expand"\]/,'Low-count collection rule missing');
assert.match(layout,/\[data-ui-layout="empty"\]/,'Empty-state geometry missing');
assert.match(layout,/\[data-ui-layout="editor"\],\[data-ui-layout="canvas"\]/,'Purposeful editor/canvas exception missing');
assert.match(layout,/\.appearance-layout\{[\s\S]*grid-template-columns:minmax\(0,1\.06fr\) minmax\(28rem,\.94fr\)/,'Settings must use balanced full-width desktop columns');
assert.match(layout,/\.appearance-layout>\.appearance-column>\.card:nth-child\(n\)\{grid-area:auto\}/,'Settings must explicitly clear legacy implicit-grid placement');
assert.match(layout,/body \.app \.nodes-page\.card,[\s\S]*background:transparent/,'Nodes outer shell must not become a giant enclosing card');
assert.match(layout,/\.nodes-page\{[\s\S]*container:nodes-grid \/ inline-size/,'Nodes fleet composition must be owned by v3 container queries');
assert.match(layout,/\.nodes-page>\.nodes\[data-node-count="1"\]>\.nc\{[\s\S]*grid-template-columns:minmax\(18rem,\.72fr\) minmax\(30rem,1\.28fr\)/,'Single-node card must use deliberate wide composition');
assert.match(layout,/\.nodes-page>\.nodes\[data-node-count="1"\]>\.nc\{[\s\S]*max-width:none/,'Single-node card must not inherit a narrow fleet cap');
assert.match(layout,/dialog#dlg\.node-wide[\s\S]*100dvh - 48px/,'Node editor viewport safety must live in v3 layout');

for(const role of ['panel','dialog','section','metric','item','floating']){
  assert(builder.includes("'"+role+"'"),'Builder role missing '+role);
}
for(const value of ['panel','table','empty','editor','canvas']){
  assert(builder.includes("'"+value+"'"),'Builder layout missing '+value);
}
assert.match(builder,/new MutationObserver/,'Dynamic SPA surfaces must be hydrated');
assert.match(builder,/window\.XMeshUIBuilder/,'Builder must expose the shared runtime API');
assert.match(builder,/classifyCollections/,'Builder must classify low-count collections');
assert.match(builder,/classifyToolbar/,'Builder must classify toolbars');
assert.doesNotMatch(builder,/getBoundingClientRect/,'Runtime builder must not measure geometry');
assert.doesNotMatch(builder,/composeNodes/,'Runtime builder must not contain page-specific Nodes composition');
assert.doesNotMatch(builder,/createElement\(['"]div['"]\)/,'Runtime builder must not create presentation wrappers');

for(const phrase of [
  'one presentation entrypoint',
  'semantic adapter, not a layout engine',
  'Content-driven height is the default',
  'Low-count states recompose',
  'Do not fill voids with fake UI',
  'New global visual work in it is forbidden'
])assert(docs.includes(phrase),'UI_SYSTEM v3 contract missing phrase: '+phrase);

assert.doesNotMatch(squad,/html\[data-surface=(?:solid|glass|raised)\]/,'Squad editor must not implement Appearance material variants');

console.log('XMesh Nexus Design System v3 architecture checks passed');
