#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');
const layout=fs.readFileSync('nexus-v3-layout.css','utf8');
const workspaces=fs.readFileSync('nexus-v3-workspaces.css','utf8');
const html=fs.readFileSync('index.html','utf8');

assert.match(app,/<section class="nodes-page"><div class="bar2 nodes-toolbar">/,'Page needs a dedicated grid container');
assert.match(app,/<div class="nodes" data-grid-mode="\$\{gridMode\}" data-node-count="\$\{r\.items\.length\}"><\/div>/,'Nodes grid must expose density mode and count for lazy rendering');
assert.match(app,/localStorage\.getItem\(NODE_GRID_KEY\)/,'Current mode must persist across navigation');

assert.doesNotMatch(layout,/\.nodes-page/,'Shared layout must not own Nodes-specific geometry');
assert.match(workspaces,/#view>\.nodes-page\{[\s\S]*container:nodes-workspace \/ inline-size/,'Workspace module must own the Nodes container query');
assert.match(workspaces,/width:min\(100%,150rem\)/,'Nodes workspace must use a broad enterprise desktop canvas rather than the former 120rem frame');
for(const width of ['32rem','52rem','70rem']){
 assert(workspaces.includes('@container nodes-workspace (min-width:'+width+')'),'Missing Nodes workspace breakpoint '+width);
}

const large=/@container nodes-workspace \(min-width:70rem\)\{([\s\S]*?)\n\}/.exec(workspaces)?.[1];
assert(large,'Large Nodes workspace block missing');
for(const [mode,count] of [['compact',4],['standard',3],['spacious',2]]){
 assert(large.includes('#view>.nodes-page>.nodes[data-grid-mode='+mode+']{\n    grid-template-columns:repeat('+count+',minmax(0,1fr));'),
  mode+' must display '+count+' columns when enough nodes exist');
}
assert(large.includes('#view>.nodes-page>.nodes[data-node-count="3"][data-grid-mode=compact]'),
 'Compact 3-node state must not preserve a phantom fourth column');
assert(large.includes('#view>.nodes-page>.nodes[data-node-count="2"]'),
 'Two nodes must deliberately use both available columns');

assert.match(workspaces,/body \.app #view>\.nodes-page>\.nodes\[data-node-count="1"\]>\.nc\{[\s\S]*max-width:none/,
 'Single-node card must never inherit a historical narrow fleet cap');
assert.match(workspaces,/grid-template-columns:minmax\(24rem,\.82fr\) minmax\(38rem,1\.18fr\)/,
 'Single-node card must use a proportional information/operations composition');
assert.match(workspaces,/#view>\.nodes-page>\.nodes\[data-node-count="1"\]>\.nc>\.node-gauges\{[\s\S]*width:100%[\s\S]*repeat\(3,minmax\(12rem,1fr\)\)/,
 'Single-node KPI row must use the operations zone instead of a fixed 48rem bottleneck');
assert.match(workspaces,/#view>\.nodes-page>\.nodes\[data-node-count="1"\]>\.nc>\.node-speed\{[\s\S]*width:100%/,
 'Single-node speed rail must align with the full operations zone');
assert.doesNotMatch(workspaces,/width:min\(100%,48rem\)/,
 'The old 48rem KPI/speed bottleneck must not return');
assert.match(workspaces,/#view \.nodes-page \.node-explorer\{[\s\S]*minmax\(24rem,2fr\)[\s\S]*minmax\(13rem,\.82fr\)/,
 'Node explorer must use proportional full-surface controls');
for(const mode of ['compact','standard','spacious']){
 assert(workspaces.includes('#view>.nodes-page>.nodes[data-grid-mode='+mode+']>.nc{padding:'),
  'Density '+mode+' must visibly affect card rhythm');
 assert(workspaces.includes('#view>.nodes-page>.nodes[data-node-count="1"][data-grid-mode='+mode+']>.nc{gap:'),
  'Single-node '+mode+' must remain visibly distinct without shrinking the card');
}

assert.match(html,/nexus-ui-v3\.css\?v=[a-f0-9]{12}/,'Nodes presentation must ship through content-addressed Design System v3');
assert.match(html,/app\.js\?v=[a-f0-9]{12}/);
for(const [name,css] of [['layout',layout],['workspaces',workspaces]]){
 assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length,name+' CSS brace balance');
}
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
