#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');

const index=fs.readFileSync('index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
const css=fs.readFileSync('ui-system.css','utf8');
const design=fs.readFileSync('design-system-v2.css','utf8');
const spatial=fs.readFileSync('spatial-engine.css','utf8');
const spatialAdapters=fs.readFileSync('spatial-layout.css','utf8');
const builder=fs.readFileSync('ui-builder.js','utf8');
const docs=fs.readFileSync('docs/UI_SYSTEM.md','utf8');
const spatialDocs=fs.readFileSync('docs/SPATIAL_COMPOSITION.md','utf8');
const squad=fs.readFileSync('squad-editor-premium-v5.css','utf8');

assert.match(index,/ui-system\.css\?v=[a-z0-9-]+/,'Unified UI stylesheet must be cache-busted');
assert.match(index,/design-system-v2\.css\?v=[a-z0-9-]+/,'Design-system composition layer must be cache-busted');
assert.match(index,/spatial-engine\.css\?v=[a-z0-9-]+/,'Universal spatial engine must be cache-busted');
assert.match(index,/spatial-layout\.css\?v=[a-z0-9-]+/,'Spatial adapter layer must be cache-busted');
assert.match(index,/ui-builder\.js\?v=[a-z0-9-]+/,'Unified UI builder must be cache-busted');
const uiPos=index.indexOf('ui-system.css?v=');
const designPos=index.indexOf('design-system-v2.css?v=');
const spatialPos=index.indexOf('spatial-engine.css?v=');
const adapterPos=index.indexOf('spatial-layout.css?v=');
const lastCss=index.lastIndexOf('<link rel="stylesheet"');
assert(uiPos>=0&&designPos>uiPos,'design-system-v2.css must load after ui-system.css');
assert(spatialPos>designPos&&adapterPos>spatialPos,'Spatial engine/adapters must load after design-system-v2.css');
assert(index.slice(lastCss).includes('spatial-layout.css'),'spatial-layout.css must be the final geometry stylesheet');
assert(index.indexOf('app.js?v=')<index.indexOf('ui-builder.js?v='),'UI builder must load after app.js');
assert.match(docker,/ui-system\.css/,'Production image must package ui-system.css');
assert.match(docker,/design-system-v2\.css/,'Production image must package design-system-v2.css');
assert.match(docker,/spatial-engine\.css/,'Production image must package spatial-engine.css');
assert.match(docker,/spatial-layout\.css/,'Production image must package spatial-layout.css');
assert.match(docker,/ui-builder\.js/,'Production image must package ui-builder.js');

for(const surface of ['solid','glass','raised']){
  assert(css.includes('html[data-surface='+surface+']'),'Missing shared '+surface+' material');
}
for(const token of [
  '--ui-surface-panel-bg','--ui-surface-dialog-bg','--ui-surface-section-bg','--ui-surface-item-bg',
  '--ui-surface-control-bg','--ui-surface-border','--ui-surface-panel-shadow','--ui-surface-dialog-shadow',
  '--ui-surface-control-shadow','--ui-dialog-section-bg','--ui-dialog-control-bg','--ui-separator','--ui-surface-filter',
  '--ui-segment-track-bg','--ui-segment-active-bg','--ui-segment-active-border','--ui-segment-active-shadow'
])assert(css.includes(token),'Missing shared token '+token);

assert.match(css,/html\[data-surface=glass\][\s\S]*--ui-surface-filter:blur\(/,
  'Glass must use real backdrop blur');
assert.match(css,/:where\(input:not\(\[type="range"\]\)[\s\S]*--ui-surface-control-bg/,
  'Shared material must include form controls');
assert.match(css,/box-shadow:var\(--ui-surface-control-shadow\)!important/,
  'Shared controls must consume the material control-shadow token');
assert.match(css,/\.app>aside\{[\s\S]*--ui-surface-panel-bg/,
  'Sidebar must inherit shared material');
assert.match(css,/html\[data-borders=off\]/,'Border setting must feed shared tokens');
assert.match(css,/html\[data-borders=strong\]/,'Strong border setting must feed shared tokens');
assert.match(css,/html\[data-density=compact\]/,'Density must feed shared spacing tokens');
assert.match(css,/prefers-reduced-transparency/,'Glass must respect reduced-transparency preference');

const raisedMatch=css.match(/html\[data-surface=raised\]\{([\s\S]*?)\n\}/);
assert(raisedMatch,'Raised material block missing');
const raised=raisedMatch[1];
assert.doesNotMatch(raised,/--ui-surface-section-bg:[^;]*var\(--a\)/,
  'Raised sections must be neutral; accent belongs to focus/selection, not slab fills');
assert.doesNotMatch(raised,/--ui-surface-item-bg:[^;]*var\(--a\)/,
  'Raised items must be neutral; accent belongs to focus/selection, not slab fills');
assert.match(raised,/--ui-surface-control-shadow:(?!none)[^;]+;/,
  'Raised controls must have restrained local elevation instead of staying flat like Classic');

const raisedLightMatch=css.match(/html\[data-theme=light\]\[data-surface=raised\]\{([\s\S]*?)\n\}/);
assert(raisedLightMatch,'Light theme must have an explicit Raised depth profile');
const raisedLight=raisedLightMatch[1];
assert.match(raisedLight,/--ui-surface-panel-bg:/,'Light Raised must define a dedicated panel tone');
assert.match(raisedLight,/--ui-surface-panel-shadow:/,'Light Raised must define visible panel elevation');
assert.match(raisedLight,/--ui-surface-section-shadow:/,'Light Raised must define a section depth level');
assert.match(raisedLight,/--ui-surface-control-shadow:(?!none)[^;]+;/,'Light Raised controls must be visibly elevated from Classic controls');
assert.doesNotMatch(raisedLight,/--ui-surface-(?:panel|section|item|control)-bg:[^;]*var\(--a\)/,
  'Light Raised depth must remain neutral instead of becoming accent-tinted slabs');

const strongMatch=css.match(/html\[data-borders=strong\]\{([\s\S]*?)\n\}/);
assert(strongMatch,'Strong border block missing');
assert.doesNotMatch(strongMatch[1],/--ui-separator:/,
  'Strong borders must not amplify structural separators into hard ruled lines');
assert.match(css,/\.setting-row\{[\s\S]*border-top-color:var\(--ui-separator\)!important/,
  'Setting-row hairlines must use the quiet separator token');

assert.match(css,/\.appearance-layout \.setting-row\{[\s\S]*background:transparent!important/,
  'Appearance setting rows must stay flat inside their parent card');
assert.match(css,/dialog :where\(\[data-ui-surface="section"\],[\s\S]*box-shadow:none!important;[\s\S]*backdrop-filter:none!important/,
  'Nested modal groups must not stack outer shadows or backdrop blur');
assert.match(css,/dialog :where\(input:not\(\[type="range"\]\)[\s\S]*--ui-dialog-control-bg/,
  'Modal controls must use the dialog control material');

assert.match(css,/:where\(\.seg\)[\s\S]*--ui-segment-track-bg/,
  'Generic segmented controls must consume the shared segmented track token');
assert.match(css,/:where\(\.seg button\.on\)[\s\S]*--ui-segment-active-bg[\s\S]*--ui-segment-active-border[\s\S]*--ui-segment-active-shadow/,
  'Selected segmented options must use a dedicated material active state');
assert.match(css,/:where\(\.seg button:not\(\.on\):hover\)[\s\S]*--ui-segment-hover-bg/,
  'Inactive segmented options must retain a distinct hover state');
assert.doesNotMatch(css,/:where\(\.seg button\.on\)\{[^}]*background:var\(--ui-surface-item-bg\)/,
  'Segment selection must not collapse back to the generic item background');

assert.match(css,/:where\(\[data-ui-control="shell"\]\)[\s\S]*--ui-surface-control-bg/,
  'Composite control shells must own shared control material');
assert.match(css,/:where\(\[data-ui-control="inner"\]\)[\s\S]*background:transparent!important;[\s\S]*border:0!important/,
  'Composite control inner fields must stay transparent and borderless');
assert.match(css,/\.precision-number input\[type="number"\]\{[\s\S]*background:transparent!important;[\s\S]*border:0!important/,
  'Legacy Appearance precision inputs must not render a second rectangular control inside the unit capsule');

/* Design v2 owns scale/composition, while material remains in ui-system.css. */
assert.doesNotMatch(design,/html\[data-surface=(?:solid|glass|raised)\]/,
  'Design-system composition layer must not fork Classic/Glass/Raised materials');
for(const token of ['--ds-control-h','--ds-card-pad','--ds-hover-bg','--ds-selected-bg']){
  assert(design.includes(token),'Missing design-system scale token '+token);
}
assert.match(design,/body::before,body::after\{[^}]*animation:none!important/,
  'Ambient decorative bloom must be restrained and non-animated');
assert.match(design,/:where\(button,\.btn,\.ib,\.gh,\.dg,[\s\S]*:hover\{[\s\S]*transform:none!important;[\s\S]*box-shadow:none!important/,
  'Generic hover must not use lift/bloom effects');
assert.match(design,/\.nodes-page \.node-explorer\{[\s\S]*background:transparent!important;[\s\S]*border-bottom:/,
  'Node explorer base layer must remain a quiet toolbar before spatial composition');
assert.match(design,/\.nodes-page>\.nodes\[data-node-count="1"\]\[data-grid-mode=spacious\][\s\S]*48rem/,
  'Base single-node spacious mode must provide a genuinely large card before runtime recomposition');
assert.match(design,/\.appearance-layout \.setting-row\{[\s\S]*min-height:4\.2rem/,
  'Base Settings rows must retain readable control rhythm before spatial compaction');
assert.match(design,/\.sv-studio \.sv-workspace\{[\s\S]*height:clamp\(42rem/,
  'XRAY Studio must prioritize the editor workspace');
assert.match(design,/\.sv-studio \.sv-topbar\{[\s\S]*background:transparent!important;[\s\S]*border-bottom:/,
  'XRAY Studio command chrome must be flattened into a quiet toolbar');

/* Spatial geometry is final and must remain material-agnostic. */
for(const layer of [spatial,spatialAdapters]){
  assert.doesNotMatch(layer,/html\[data-surface=(?:solid|glass|raised)\]/,
    'Spatial geometry must not fork Classic/Glass/Raised materials');
}
assert.match(spatial,/\.view\[data-ui-flow="workspace"\][\s\S]*grid-auto-rows:max-content/,
  'Universal workspace flow must be content-driven');
assert.match(spatial,/\[data-ui-layout="empty"\]/,
  'Universal engine must include empty-state geometry');
assert.match(spatial,/\[data-ui-collection\]\[data-ui-count="1"\]/,
  'Universal engine must include low-count collection geometry');
assert.match(spatialAdapters,/\.appearance-layout\{[\s\S]*grid-template-columns:/,
  'Settings unique composition must live in the spatial adapter layer');
assert.match(spatialAdapters,/\.nodes-page>\.nodes\[data-node-count="1"\]/,
  'Single-node unique composition must live in the spatial adapter layer');

for(const role of ['panel','dialog','section','metric','item','floating']){
  assert(builder.includes("'"+role+"'"),'Builder role missing '+role);
}
assert.match(builder,/new MutationObserver/,'Dynamic SPA surfaces must be hydrated');
assert.match(builder,/window\.XMeshUIBuilder/,'Builder must expose the shared runtime API');
assert.match(builder,/node\.matches\('section'\)&&!node\.closest\('dialog'\)/,
  'Plain semantic sections inside dialogs must remain structural by default');
assert.match(builder,/register\('\.squad-editor-layout>section','section'\)/,
  'Squad editor must be adapted through the central builder');
assert.match(builder,/classifyWorkspace/,'Builder must classify workspace geometry globally');
assert.match(builder,/classifyCollections/,'Builder must classify low-count collections globally');
assert.match(builder,/measureSparse/,'Builder must detect accidental sparse panels');
assert.match(builder,/composeNodes/,'Builder must support narrow structural adapters without replacing feature logic');

assert.match(docs,/Feature styles own geometry\. `ui-system\.css` owns material\./,
  'Documentation must state the geometry/material ownership rule');
assert.match(docs,/`design-system-v2\.css` owns shared scale, composition and interaction restraint/,
  'Documentation must define the global design composition layer');
assert.match(docs,/Raised is a \*\*depth hierarchy\*\*/,
  'Documentation must define Raised as hierarchy rather than accent tinting');
assert.match(docs,/Light theme must preserve a visibly larger depth delta/,
  'Documentation must require perceptible Raised depth in light mode');
assert.match(docs,/A modal has exactly one primary material shell\./,
  'Documentation must define modal depth isolation');
assert.match(docs,/Separators are structural, not surface borders\./,
  'Documentation must define quiet separator hierarchy');
assert.match(docs,/A composite control has exactly one material shell\./,
  'Documentation must define composite-control ownership');
assert.match(docs,/Do \*\*not\*\* create `my-feature-glass\.css`/,
  'Documentation must forbid feature-specific material forks');
assert.match(docs,/Bloom is not an interaction primitive/,
  'Documentation must forbid bloom as the default interaction language');
assert.match(spatialDocs,/whole panel on one design conveyor/,
  'Spatial documentation must define the panel-wide conveyor model');
assert.match(spatialDocs,/Content-driven height is the default/,
  'Spatial documentation must make content-driven height the default');

assert.doesNotMatch(squad,/html\[data-surface=(?:solid|glass|raised)\]/,
  'Squad editor must not implement its own Appearance material variants');

console.log('Unified UI system + Design System v2 + spatial pipeline checks passed');
