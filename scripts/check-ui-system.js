#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');

const index=fs.readFileSync('index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
const app=fs.readFileSync('app.js','utf8');
const entry=fs.readFileSync('nexus-ui-v3.css','utf8');
const foundation=fs.readFileSync('nexus-v3-foundation.css','utf8');
const components=fs.readFileSync('nexus-v3-components.css','utf8');
const layout=fs.readFileSync('nexus-v3-layout.css','utf8');
const workspaces=fs.readFileSync('nexus-v3-workspaces.css','utf8');
const builder=fs.readFileSync('ui-builder.js','utf8');
const docs=fs.readFileSync('docs/UI_SYSTEM.md','utf8');
const squad=fs.readFileSync('squad-editor-premium-v5.css','utf8');

const gitBlobSha=content=>crypto.createHash('sha1')
  .update(`blob ${Buffer.byteLength(content,'utf8')}\0`)
  .update(content,'utf8')
  .digest('hex');
const cacheKey=content=>gitBlobSha(content).slice(0,12);

// Core runtime assets are content-addressed.
assert(index.includes(`app.js?v=${cacheKey(app)}`),'app.js cache key must match its Git blob SHA');
assert(index.includes(`ui-builder.js?v=${cacheKey(builder)}`),'UI builder cache key must match its Git blob SHA');
assert(index.includes(`nexus-ui-v3.css?v=${cacheKey(entry)}`),'Design System v3 entrypoint cache key must match its Git blob SHA');
for(const [name,content] of [
  ['nexus-v3-foundation.css',foundation],
  ['nexus-v3-components.css',components],
  ['nexus-v3-layout.css',layout],
  ['nexus-v3-workspaces.css',workspaces]
]){
  assert(entry.includes(`${name}?v=${cacheKey(content)}`),`${name} cache key must match its Git blob SHA`);
}

assert.match(index,/nexus-ui-v3\.css\?v=[a-f0-9]{12}/,'Design System v3 must be content-addressed');
assert.match(index,/ui-builder\.js\?v=[a-f0-9]{12}/,'UI builder must be content-addressed');
assert.match(index,/app\.js\?v=[a-f0-9]{12}/,'Core app must be content-addressed');
assert.match(index,/<style id="xmesh-legacy-compat">@import url\("\/styles\/legacy\/styles\.css\?v=[^"]+"\) layer\(xmesh-legacy\);<\/style>/,
 'Legacy stylesheet must be quarantined in the low-priority cascade layer');
assert.doesNotMatch(index,/<link[^>]+styles\/legacy\/styles\.css/,
 'Legacy stylesheet must never be loaded as an unlayered link');
const lastCss=index.lastIndexOf('<link rel="stylesheet"');
assert(index.slice(lastCss).includes('nexus-ui-v3.css'),'Design System v3 must remain the final linked global stylesheet');
assert(index.indexOf('app.js?v=')<index.indexOf('ui-builder.js?v='),'UI builder must load after app.js');
assert.match(index,/<aside data-ui-surface="panel">/,'Sidebar must opt into shared panel material');

for(const retired of ['global-hover.css','ui-system.css','design-system-v2.css','spatial-engine.css','spatial-layout.css']){
  assert(!index.includes(retired),'Retired global layer must not be loaded: '+retired);
  assert(!docker.includes(' '+retired+' '),'Retired global layer must not be packaged: '+retired);
}
for(const asset of ['nexus-ui-v3.css','nexus-v3-foundation.css','nexus-v3-components.css','nexus-v3-layout.css','nexus-v3-workspaces.css','ui-builder.js']){
  assert(docker.includes(asset),'Production compatibility fixture must package '+asset);
}

for(const module of ['nexus-v3-foundation.css','nexus-v3-components.css','nexus-v3-layout.css','nexus-v3-workspaces.css']){
  assert(entry.includes(module),'v3 entrypoint must import '+module);
}
assert.equal((entry.match(/@import/g)||[]).length,4,'v3 entrypoint must have exactly four architecture modules');

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

for(const [name,css] of [['components',components],['layout',layout],['workspaces',workspaces]]){
  assert.doesNotMatch(css,/html\[data-surface=(?:solid|glass|raised)\]/,
    name+' must consume material tokens, not fork surface modes');
}
assert.match(components,/body \.app \.card,[\s\S]*\[data-ui-surface="panel"\][\s\S]*--nx-panel-bg/,'Shared panel primitive missing');
assert.match(components,/body \.app>aside\[data-ui-surface="panel"\]/,'Sidebar material must be owned by v3 components');
assert.match(components,/:is\(\.app,dialog\) \.seg button\.on[\s\S]*--ui-segment-active-bg/,'Selected segment primitive missing');
assert.match(components,/dialog#dlg \.box,dialog#dlg form\.box/,'Shared dialog shell primitive missing');
assert.match(components,/Composite controls own exactly one material shell/,'Composite control ownership must be documented');
assert.match(components,/transform:none/,'Generic hover must not use lift motion');

assert.match(layout,/\.wrap\{[\s\S]*max-width:var\(--panel-content-max,1920px\)/,
 'Shared shell must honor the user content width directly');
assert.doesNotMatch(layout,/data-ui-frame="(?:management|data|canvas)"/,
 'Shared layout must not impose frame-specific width caps');
assert.match(layout,/\.view\[data-ui-flow="workspace"\][\s\S]*grid-auto-rows:max-content/,'Workspace flow must be content-driven');
assert.match(layout,/\[data-ui-collection\]\[data-ui-count="1"\]\[data-ui-low-count="expand"\]/,'Low-count collection rule missing');
assert.match(layout,/\[data-ui-layout="empty"\]/,'Empty-state geometry missing');
assert.match(layout,/\[data-ui-layout="editor"\],\[data-ui-layout="canvas"\]/,'Purposeful editor/canvas exception missing');
assert.doesNotMatch(layout,/\.appearance-layout|\.nodes-page/,
 'Shared layout must never own complex page-specific workspace geometry');

assert.match(workspaces,/#view>\.appearance-layout\{[\s\S]*grid-template-columns:minmax\(0,1\.08fr\) minmax\(0,\.92fr\)/,
 'Settings must use a real balanced two-column workspace');
assert.match(workspaces,/#view>\.appearance-layout>\.appearance-column\{[\s\S]*display:grid/,
 'Settings columns must remain real grid containers');
assert.match(workspaces,/#view>\.appearance-layout>\.appearance-column>\.card:nth-child\(n\)\{[\s\S]*grid-area:auto/,
 'Settings must neutralize historical explicit grid placement');
assert.match(workspaces,/\.palette-preset-grid\{[\s\S]*repeat\(4,minmax\(0,1fr\)\)/,
 'Theme gallery must be a stable four-column control surface');
assert.match(workspaces,/card:nth-child\(3\)[\s\S]*\.choice\{[\s\S]*repeat\(3,minmax\(0,1fr\)\)/,
 'Font chooser must use a structured grid');
assert.doesNotMatch(workspaces,/settings-appearance-header::before[\s\S]*radial-gradient/,
 'Settings headings must not reintroduce fake decorative icon bubbles');

assert.match(workspaces,/#view>\.nodes-page\{[\s\S]*container:nodes-workspace \/ inline-size/,'Nodes workspace must use container-driven composition');
assert.match(workspaces,/width:min\(100%,150rem\)/,'Core workspaces need an enterprise desktop width');
assert.match(workspaces,/body \.app #view>\.nodes-page>\.nodes\[data-node-count="1"\]>\.nc\{[\s\S]*grid-template-columns:minmax\(24rem,\.82fr\) minmax\(38rem,1\.18fr\)/,
 'Single node must use proportional two-zone composition');
assert.match(workspaces,/\.node-gauges\{[\s\S]*width:100%[\s\S]*repeat\(3,minmax\(12rem,1fr\)\)/,
 'Node metrics must fill the operations zone');
assert.doesNotMatch(workspaces,/width:min\(100%,48rem\)/,
 'Fixed 48rem KPI bottleneck must never return');
assert.match(workspaces,/@container settings-workspace \(max-width:88rem\)/,'Settings must reflow by actual workspace width');
assert.match(workspaces,/@container nodes-workspace \(max-width:72rem\)/,'Nodes must reflow by actual workspace width');
assert.match(layout,/dialog#dlg\.node-wide[\s\S]*100dvh - 48px/,'Node editor viewport safety must live in shared layout');

for(const role of ['panel','dialog','section','metric','item','floating']){
  assert(builder.includes("'"+role+"'"),'Builder role missing '+role);
}
for(const value of ['panel','table','empty','editor','canvas']){
  assert(builder.includes("'"+value+"'"),'Builder layout missing '+value);
}
assert.match(builder,/const register=\(selector,role\)=>/,'Semantic registry must be locally defined and deterministic');
assert.match(builder,/data-ui-card-head/,'Builder must expose reusable card heading anatomy');
assert.match(builder,/register\('\.node-explorer','panel'\)/,'Node explorer must consume shared panel material');
assert.match(builder,/register\('\.ngauge','metric'\)/,'Node gauges must consume shared metric role');
assert.match(builder,/new MutationObserver/,'Dynamic SPA surfaces must be hydrated');
assert.match(builder,/window\.XMeshUIBuilder/,'Builder must expose the shared runtime API');
assert.match(builder,/classifyCollections/,'Builder must classify low-count collections');
assert.match(builder,/classifyToolbar/,'Builder must classify toolbars');
assert.match(builder,/!node\.parentElement\?\.matches\('\.view'\)/,'Builder must not wrap direct page composition');
assert.doesNotMatch(builder,/getBoundingClientRect/,'Runtime builder must not measure geometry');
assert.doesNotMatch(builder,/composeNodes/,'Runtime builder must not contain page-specific Nodes composition');
assert.doesNotMatch(builder,/createElement\(['"]div['"]\)/,'Runtime builder must not create presentation wrappers');

for(const phrase of [
  'one presentation entrypoint',
  'semantic adapter, not a layout engine',
  'Content-driven height is the default',
  'Low-count states recompose',
  'Do not fill voids with fake UI',
  'legacy cascade layer',
  'workspace composition',
  'New global visual work in it is forbidden'
])assert(docs.includes(phrase),'UI_SYSTEM v3 contract missing phrase: '+phrase);

assert.doesNotMatch(squad,/html\[data-surface=(?:solid|glass|raised)\]/,'Squad editor must not implement Appearance material variants');

console.log('XMesh Nexus Design System v3 enterprise architecture checks passed');
