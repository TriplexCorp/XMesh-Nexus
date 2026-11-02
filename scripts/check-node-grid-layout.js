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
console.log('Enterprise Nodes workspace composition and grid persistence: OK');
