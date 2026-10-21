#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const html=fs.readFileSync('index.html','utf8');

assert.match(app,/<section class="nodes-page"><div class="bar2 nodes-toolbar">/,'Page needs a dedicated grid container');
assert.match(app,/<div class="nodes" data-grid-mode="\$\{gridMode\}" data-node-count="\$\{r\.items\.length\}">/,'Nodes grid must expose current mode and node count');
assert.match(app,/localStorage\.getItem\(NODE_GRID_KEY\)/,'Current mode must persist across navigation');
assert.match(css,/\.nodes-page\{[^}]*container:nodes-grid \/ inline-size;/s,'Layout must use its available container width');
for(const width of ['32rem','52rem','70rem']){
 assert(css.includes('@container nodes-grid (min-width:'+width+')'),'Missing grid breakpoint '+width);
}
const columns=/@container nodes-grid \(min-width:70rem\)\{([\s\S]*?)\n\}/.exec(css)?.[1];
assert(columns,'Large container columns missing');
for(const [mode,count] of [['compact',4],['standard',3],['spacious',2]]){
 assert(columns.includes('.nodes-page>.nodes[data-grid-mode='+mode+']{\n    grid-template-columns:repeat('+count+',minmax(0,1fr));'),
  mode+' must display '+count+' columns when enough nodes exist');
}
assert(columns.includes('.nodes-page>.nodes[data-node-count="3"][data-grid-mode=compact]'),
 'Compact 3-node list must not waste a fourth column');
for(const mode of ['compact','spacious']){
 assert(css.includes('.nodes-page>.nodes[data-grid-mode='+mode+']>.nc{'),'Density must affect cards, not only grid columns');
}
// Low node counts must still have three visibly distinct density choices.
for(const [mode,width] of [['compact',22],['standard',30],['spacious',40]]){
 assert(css.includes('.nodes-page>.nodes[data-node-count="1"][data-grid-mode='+mode+']{\n    grid-template-columns:minmax(0,'+width+'rem);'),
  'One node must show a different card width for '+mode);
}
assert(css.includes('@container nodes-grid (min-width:52rem){') &&
  css.includes('.nodes-page>.nodes[data-node-count="2"]{'),
 'Two nodes must use the available container width at desktop breakpoints');
// Regression: 3 nodes in Standard must form THREE full-width columns on
// desktop; an old 2-column + max-width override left a huge empty right side.
const gridRules=css.slice(css.indexOf('/* Nodes density modes'),css.indexOf('/* Node IP rotation status'));
assert(gridRules.includes('.nodes-page>.nodes[data-grid-mode=standard]{\n    grid-template-columns:repeat(3,minmax(0,1fr));'),
 'Standard grid must use three columns at 70rem+');
assert.doesNotMatch(gridRules,/\.nodes-page>\.nodes\[data-node-count="3"\]\[data-grid-mode=standard\]\s*\{/,
 'Three-node Standard cannot override the desktop 3-column grid');
assert.doesNotMatch(gridRules,/\.nodes-page>\.nodes\[data-node-count="2"\]\[data-grid-mode=(?:standard|compact|spacious)\]\s*\{/,
 'Two-node layout cannot be clamped to a narrow grid');
assert.doesNotMatch(gridRules,/max-width:\s*(?:48|64|68)rem/,
 'Two- and three-node grids must fill available horizontal space');
assert(html.includes('styles.css?v=20261021-layout-qr-2'),'Stylesheet cache key not updated');
assert.match(html,/app\.js\?v=[a-z0-9-]+/);
assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length,'CSS brace balance');
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
console.log('Nodes grid responsive layout and click/persistence: OK');
