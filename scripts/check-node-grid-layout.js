#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');
const layout=fs.readFileSync('nexus-v3-layout.css','utf8');
const html=fs.readFileSync('index.html','utf8');

assert.match(app,/<section class="nodes-page"><div class="bar2 nodes-toolbar">/,'Page needs a dedicated grid container');
assert.match(app,/<div class="nodes" data-grid-mode="\$\{gridMode\}" data-node-count="\$\{r\.items\.length\}"><\/div>/,'Nodes grid must expose density mode and count for lazy rendering');
assert.match(app,/localStorage\.getItem\(NODE_GRID_KEY\)/,'Current mode must persist across navigation');
assert.match(layout,/\.nodes-page\{[^}]*container:nodes-grid \/ inline-size/s,'Design System v3 must own the Nodes container query');
for(const width of ['32rem','52rem','70rem']){
 assert(layout.includes('@container nodes-grid (min-width:'+width+')'),'Missing v3 grid breakpoint '+width);
}

const large=/@container nodes-grid \(min-width:70rem\)\{([\s\S]*?)\n\}/.exec(layout)?.[1];
assert(large,'Large v3 Nodes grid block missing');
for(const [mode,count] of [['compact',4],['standard',3],['spacious',2]]){
 assert(large.includes('.nodes-page>.nodes[data-grid-mode='+mode+']{grid-template-columns:repeat('+count+',minmax(0,1fr))}'),
  mode+' must display '+count+' columns when enough nodes exist');
}
assert(large.includes('.nodes-page>.nodes[data-node-count="3"][data-grid-mode=compact]{grid-template-columns:repeat(3,minmax(0,1fr))}'),
 'Compact 3-node state must not preserve a phantom fourth column');
assert(large.includes('.nodes-page>.nodes[data-node-count="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}'),
 'Two nodes must deliberately use both available columns');
assert(large.includes('.nodes-page>.nodes[data-node-count="1"]{grid-template-columns:minmax(0,1fr)}'),
 'One node must expand to the available workspace instead of staying a narrow fleet card');

assert.match(layout,/\.nodes-page>\.nodes\[data-node-count="1"\]>\.nc\{[\s\S]*max-width:none/,
 'Single-node card must not carry a historical narrow max-width');
for(const mode of ['compact','standard','spacious']){
 assert(layout.includes('.nodes-page>.nodes[data-grid-mode='+mode+']>.nc{padding:'),
  'Density '+mode+' must visibly affect card rhythm in v3');
 assert(layout.includes('.nodes-page>.nodes[data-node-count="1"][data-grid-mode='+mode+']>.nc{gap:'),
  'Single-node '+mode+' must remain visibly distinct without shrinking card width');
}
assert.doesNotMatch(layout,/data-node-count="1"[^\n]*grid-template-columns:minmax\(0,(?:22|30|40)rem\)/,
 'Design System v3 must not restore the historical tiny single-node widths');
assert.match(layout,/body \.app \.nodes-page\.card,[\s\S]*background:transparent/,
 'Nodes page outer wrapper must stay structural instead of becoming a giant enclosing card');

assert.match(html,/nexus-ui-v3\.css\?v=[a-z0-9-]+/,'Nodes presentation must ship through Design System v3');
assert.match(html,/app\.js\?v=[a-z0-9-]+/);
assert.equal((layout.match(/\{/g)||[]).length,(layout.match(/\}/g)||[]).length,'v3 layout CSS brace balance');
new Function(app);

// Exercise the real delegated click handler, rather than testing a copy.
// Grid mode must update the DOM, selection state, and persisted preference.
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
console.log('Design System v3 Nodes grid responsive layout and click/persistence: OK');
