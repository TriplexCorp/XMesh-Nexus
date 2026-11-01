#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');

const index=fs.readFileSync('index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
const css=fs.readFileSync('ui-system.css','utf8');
const builder=fs.readFileSync('ui-builder.js','utf8');
const docs=fs.readFileSync('docs/UI_SYSTEM.md','utf8');
const squad=fs.readFileSync('squad-editor-premium-v5.css','utf8');

assert.match(index,/ui-system\.css\?v=[a-z0-9-]+/,'Unified UI stylesheet must be cache-busted');
assert.match(index,/ui-builder\.js\?v=[a-z0-9-]+/,'Unified UI builder must be cache-busted');
const lastCss=index.lastIndexOf('<link rel="stylesheet"');
assert(index.slice(lastCss).includes('ui-system.css'),'ui-system.css must be the final stylesheet');
assert(index.indexOf('app.js?v=')<index.indexOf('ui-builder.js?v='),'UI builder must load after app.js');
assert.match(docker,/ui-system\.css/,'Production image must package ui-system.css');
assert.match(docker,/ui-builder\.js/,'Production image must package ui-builder.js');

for(const surface of ['solid','glass','raised']){
  assert(css.includes('html[data-surface='+surface+']'),'Missing shared '+surface+' material');
}
for(const token of [
  '--ui-surface-panel-bg','--ui-surface-dialog-bg','--ui-surface-section-bg','--ui-surface-item-bg',
  '--ui-surface-control-bg','--ui-surface-border','--ui-surface-panel-shadow','--ui-surface-dialog-shadow',
  '--ui-dialog-section-bg','--ui-dialog-control-bg','--ui-separator','--ui-surface-filter'
])assert(css.includes(token),'Missing shared token '+token);

assert.match(css,/html\[data-surface=glass\][\s\S]*--ui-surface-filter:blur\(/,
  'Glass must use real backdrop blur');
assert.match(css,/:where\(input:not\(\[type="range"\]\)[\s\S]*--ui-surface-control-bg/,
  'Shared material must include form controls');
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

assert.match(css,/:where\(\[data-ui-control="shell"\]\)[\s\S]*--ui-surface-control-bg/,
  'Composite control shells must own shared control material');
assert.match(css,/:where\(\[data-ui-control="inner"\]\)[\s\S]*background:transparent!important;[\s\S]*border:0!important/,
  'Composite control inner fields must stay transparent and borderless');
assert.match(css,/\.precision-number input\[type="number"\]\{[\s\S]*background:transparent!important;[\s\S]*border:0!important/,
  'Legacy Appearance precision inputs must not render a second rectangular control inside the unit capsule');

for(const role of ['panel','dialog','section','metric','item','floating']){
  assert(builder.includes("'"+role+"'"),'Builder role missing '+role);
}
assert.match(builder,/new MutationObserver/,'Dynamic SPA surfaces must be hydrated');
assert.match(builder,/window\.XMeshUIBuilder/,'Builder must expose the shared runtime API');
assert.match(builder,/node\.matches\('section'\)&&!node\.closest\('dialog'\)/,
  'Plain semantic sections inside dialogs must remain structural by default');
assert.match(builder,/register\('\.squad-editor-layout>section','section'\)/,
  'Squad editor must be adapted through the central builder');

assert.match(docs,/Feature styles own geometry\. `ui-system\.css` owns material\./,
  'Documentation must state the geometry/material ownership rule');
assert.match(docs,/Raised is a \*\*depth hierarchy\*\*/,
  'Documentation must define Raised as hierarchy rather than accent tinting');
assert.match(docs,/A modal has exactly one primary material shell\./,
  'Documentation must define modal depth isolation');
assert.match(docs,/Separators are structural, not surface borders\./,
  'Documentation must define quiet separator hierarchy');
assert.match(docs,/A composite control has exactly one material shell\./,
  'Documentation must define composite-control ownership');
assert.match(docs,/Do \*\*not\*\* create `my-feature-glass\.css`/,
  'Documentation must forbid feature-specific material forks');

assert.doesNotMatch(squad,/html\[data-surface=(?:solid|glass|raised)\]/,
  'Squad editor must not implement its own Appearance material variants');

console.log('Unified UI system checks passed');
