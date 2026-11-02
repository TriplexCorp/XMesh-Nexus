#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const assert=require('node:assert/strict');

const index=fs.readFileSync('index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
const engine=fs.readFileSync('spatial-engine.css','utf8');
const adapters=fs.readFileSync('spatial-layout.css','utf8');
const builder=fs.readFileSync('ui-builder.js','utf8');
const docs=fs.readFileSync('docs/SPATIAL_COMPOSITION.md','utf8');

for(const asset of ['spatial-engine.css','spatial-layout.css']){
  assert.match(index,new RegExp(asset.replace('.','\\.')+'\\?v=[a-z0-9-]+'),asset+' must be cache-busted');
  assert.match(docker,new RegExp(asset.replace('.','\\.')),asset+' must be packaged in the production image');
}

const uiPos=index.indexOf('ui-system.css?v=');
const designPos=index.indexOf('design-system-v2.css?v=');
const enginePos=index.indexOf('spatial-engine.css?v=');
const adaptersPos=index.indexOf('spatial-layout.css?v=');
assert(uiPos>=0&&designPos>uiPos&&enginePos>designPos&&adaptersPos>enginePos,
  'Spatial stack must load after material + design system, with generic engine before adapters');
assert(index.indexOf('app.js?v=')<index.indexOf('ui-builder.js?v='),
  'Runtime spatial classifier must load after app.js');

for(const css of [engine,adapters]){
  assert.doesNotMatch(css,/html\[data-surface=(?:solid|glass|raised)\]/,
    'Spatial CSS must never fork Classic / Glass / Raised material');
}

for(const marker of [
  'data-ui-flow="workspace"',
  'data-ui-layout="table"',
  'data-ui-layout="empty"',
  'data-ui-layout="sparse"',
  'data-ui-layout="editor"',
  'data-ui-collection',
  'data-ui-toolbar'
])assert(engine.includes(marker),'Universal spatial engine missing '+marker);

assert.match(engine,/grid-auto-rows:max-content/,
  'Workspace flow must be content-driven rather than equal-height');
assert.match(engine,/flex-grow:0!important/,
  'Ordinary spatial shells must not consume viewport leftovers through flex-grow');
assert.match(engine,/data-ui-count="1"\]\[data-ui-low-count="expand"/,
  'Low-count collections must have a generic one-item expansion rule');
assert.match(engine,/--spatial-empty-min:[^;]+;/,
  'Spatial engine must define one shared compact empty-state height token');
assert.match(engine,/data-ui-layout="empty"[\s\S]*min-height:var\(--spatial-empty-min\)!important/,
  'Empty states must consume the shared compact height contract');
assert.match(engine,/data-ui-layout="editor"/,
  'Purposeful editor whitespace must have an explicit exception');

for(const runtimeMarker of [
  "const LAYOUT_ATTR='data-ui-layout'",
  "const FLOW_ATTR='data-ui-flow'",
  'classifyWorkspace',
  'classifyCollections',
  'measureSparse',
  'composeNodes',
  "setAttribute('data-ui-toolbar'"
])assert(builder.includes(runtimeMarker),'UI builder missing spatial runtime primitive '+runtimeMarker);
assert.match(builder,/new MutationObserver/,
  'Spatial runtime must continue to hydrate future SPA content');
assert.match(builder,/requestAnimationFrame/,
  'Spatial measurement must run after layout rather than during raw DOM insertion');
assert.match(builder,/\.sv-studio,\.sv-workspace,\[data-ui-editor\]/,
  'XRAY Studio / explicit editors must be protected from automatic compaction');
assert.match(builder,/node-result-chip/,
  'Node count must be eligible for integration into the utility toolbar');
assert.match(builder,/node-summary-pane/,
  'Single-node state must recompose into a deliberate wide-card summary layout');
assert.match(builder,/node-metrics-pane/,
  'Single-node state must recompose metrics without replacing live metric nodes');

for(const phrase of [
  'whole panel on one design conveyor',
  'Content-driven height is the default',
  'Low-count states recompose',
  'Do not fill voids with fake UI',
  'Purposeful whitespace exceptions'
])assert(docs.includes(phrase),'Spatial documentation missing contract: '+phrase);

console.log('Universal spatial composition pipeline checks passed');
