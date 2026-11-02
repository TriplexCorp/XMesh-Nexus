#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const layout=fs.readFileSync('frontend/styles/system/nexus-v3-layout.css','utf8');
const workspaces=fs.readFileSync('frontend/styles/features/nodes/nodes.css','utf8');
const html=fs.readFileSync('frontend/index.html','utf8');

assert.match(app,/nodes-page/,'Node page requires an explicit composition root');
assert.match(app,/data-ui-collection/,'Collections must be declared in markup');
assert.match(app,/data-node-count/,'Node count must remain available for rendering');
assert.match(app,/localStorage\.getItem\(NODE_GRID_KEY\)/,'Current density mode persists across navigation');
assert.doesNotMatch(layout,/\.nodes-page/,'Shared layout must not own Nodes geometry');
assert.match(workspaces,/@container/,'Node layout must respond to its available container');
assert.doesNotMatch(workspaces,/!important/,'Node geometry must not depend on specificity escalation');
assert.doesNotMatch(workspaces,/min-height\s*:\s*(?:\d+vh|[4-9]\d{2}px)/,'Cards must not fill the viewport with artificial height');
assert.match(app,/node-summary/,'Node operational summary has explicit anatomy');
assert.match(app,/node-metrics/,'Node metrics have explicit anatomy');

/* Density must change real rendered geometry, especially for the common
 * two-node fleet shown in production. A dataset toggle alone is not enough. */
assert.match(workspaces,/\.nodes\[data-node-count="1"\]\[data-grid-mode=compact\],[\s\S]*?\.nodes\[data-node-count="1"\]\[data-grid-mode=standard\],[\s\S]*?\.nodes\[data-node-count="1"\]\[data-grid-mode=spacious\]\{grid-template-columns:minmax\(0,1fr\)\}/,
  'A single node must use the full management canvas in every density mode');
assert.match(workspaces,/\.nodes\[data-node-count="2"\]\[data-grid-mode=compact\],[\s\S]*?\.nodes\[data-node-count="2"\]\[data-grid-mode=standard\]\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/,
  'Compact and Standard keep a two-card fleet row');
assert.match(workspaces,/\.nodes\[data-node-count="2"\]\[data-grid-mode=spacious\]\{grid-template-columns:minmax\(0,1fr\)\}/,
  'Spacious must become a deliberate single-column concept layout for two nodes');
assert.match(workspaces,/\.nodes\[data-node-count="3"\]\[data-grid-mode=compact\]\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/,
  'Three-node Compact must expose three columns');
assert.match(workspaces,/\.nodes\[data-node-count="3"\]\[data-grid-mode=standard\]\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/,
  'Three-node Standard must expose fewer columns than Compact');
assert.match(workspaces,/\.nodes\[data-node-count="3"\]\[data-grid-mode=spacious\]\{grid-template-columns:minmax\(0,1fr\)\}/,
  'Three-node Spacious must preserve the wide concept composition');
assert.match(workspaces,/@container nodes-workspace \(min-width:96rem\)[\s\S]*?\.nodes\[data-node-count="2"\]\[data-grid-mode=compact\]>\.nc\{[\s\S]*?grid-template-columns:minmax\(14rem,.72fr\) minmax\(20rem,1.28fr\)/,
  'Two-node Compact must become vertically denser on ultrawide workspaces');

/* The approved concept is a genuine two-zone card, not a wide one-column card:
 * operational identity/health on the left and telemetry on the right. */
assert.match(workspaces,/\.nodes\[data-node-count="1"\]>\.nc,[\s\S]*?\.nodes\[data-grid-mode=spacious\]:is\(\[data-node-count="2"\],\[data-node-count="3"\]\)>\.nc\{[\s\S]*?grid-template-columns:minmax\(19rem,.78fr\) minmax\(28rem,1.22fr\)/,
  'Concept cards must keep the approved 40/60 two-zone anatomy');
assert.match(workspaces,/\.nodes\[data-node-count="1"\]>\.nc>\.node-summary,[\s\S]*?border-right:1px solid var\(--nx-separator\)/,
  'Concept cards must keep the vertical divider between operations and telemetry');
assert.match(workspaces,/\.nc\{[^}]*border-color:color-mix\(in srgb,var\(--a\) 42%,var\(--nx-border\)\)[^}]*background:color-mix\(in srgb,var\(--nx-panel-bg\) 96%,var\(--a\) 4%\)/,
  'Node card must retain the accent edge and tinted premium surface from the concept');
assert.match(workspaces,/@container node-card \(min-width:52rem\)\{[\s\S]*?\.ngauge\{grid-template-columns:auto minmax\(0,1fr\)[\s\S]*?min-height:5\.2rem/,
  'Wide concept cards must render compact horizontal telemetry panels');

/* Actions are the composed 4 + 4 + 1 console from the concept. */
assert.doesNotMatch(workspaces,/\.nc \.acts\{[^}]*auto-fit/,'Node action composition must not use auto-fit');
assert.match(workspaces,/\.nc \.acts>\[data-node-create-host\]\{grid-column:1\/-1/,
  'Create Host must finish the action console as a full-width CTA');
assert.match(workspaces,/\.nc \.acts>\[data-agent-update\]\{[^}]*color:var\(--a\);[^}]*border-color:color-mix\(in srgb,var\(--a\) 62%,var\(--nx-border\)\);[^}]*background:color-mix\(in srgb,var\(--a\) 10%,var\(--nx-control-bg\)\)/,
  'Update Agent must keep its premium accent treatment');
assert.match(workspaces,/@container node-card \(min-width:44rem\)\{\s*\.acts\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/,
  'Wide node cards must compose actions as four columns');
new Function(app);

// Exercise the real delegated click handler, rather than testing a copy.
const marker="document.addEventListener('click',e=>{\n  const button=e.target.closest('[data-node-grid-mode]');";
const begin=app.lastIndexOf(marker);
assert(begin>=0,'Grid control click handler not found');
const finish=app.indexOf('\n});',begin);
assert(finish>begin,'Grid click handler end not found');
const block=app.slice(begin,finish+4);
const listeners={};
const buttonStates=['compact','standard','spacious'].map(value=>{
 const classes=new Set(value==='standard'?['on']:[]);
 const attrs={};
 return {dataset:{nodeGridMode:value},classList:{
  contains:name=>classes.has(name),
  toggle:(name,enabled)=>enabled?classes.add(name):classes.delete(name)
 },setAttribute:(key,value)=>{attrs[key]=value},getAttribute:key=>attrs[key]};
});
const grid={dataset:{gridMode:'standard'}};
const storage=new Map();
const document={
 addEventListener:(type,fn)=>{listeners[type]=fn},
 querySelector:selector=>selector==='.nodes'?grid:null,
 querySelectorAll:selector=>selector==='[data-node-grid-mode]'?buttonStates:[]
};
const localStorage={setItem:(key,value)=>storage.set(key,value)};
new Function('document','localStorage','NODE_GRID_KEY',block)(document,localStorage,'xmeshNexusGridView');
assert.equal(typeof listeners.click,'function');
for(const mode of ['compact','spacious','standard']){
 const chosen=buttonStates.find(button=>button.dataset.nodeGridMode===mode);
 listeners.click({target:{closest:selector=>selector==='[data-node-grid-mode]'?chosen:null}});
 assert.equal(grid.dataset.gridMode,mode,'Grid mode not applied');
 assert.equal(storage.get('xmeshNexusGridView'),mode,'Grid mode not saved');
 for(const button of buttonStates){
  const selected=button.dataset.nodeGridMode===mode;
  assert.equal(button.classList.contains('on'),selected,'Active visual state incorrect');
  assert.equal(button.getAttribute('aria-pressed'),String(selected),'Pressed state incorrect');
 }
}
const prior=storage.get('xmeshNexusGridView');
listeners.click({target:{closest:()=>({dataset:{nodeGridMode:'invalid'}})}});
assert.equal(storage.get('xmeshNexusGridView'),prior,'Invalid mode should be ignored');
console.log('Enterprise Nodes grid modes, approved concept composition and persistence: OK');
