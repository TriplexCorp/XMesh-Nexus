#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const html=fs.readFileSync('index.html','utf8');
assert.match(app,/choices\('surface',\[\['solid','Классика'\],\['glass','Glass'\],\['raised','Объём'\]\]\)/,
 'Appearance must offer only Classic, Glass and Raised');
assert.doesNotMatch(app,/\['flat','Плоский'\]/,'Deprecated Flat must not be selectable');
assert.doesNotMatch(app,/Выберите плоский/,'Old explanatory text must be removed');
assert.doesNotMatch(css,/data-surface=flat/,'Deprecated Flat CSS must be removed');
const migration=app.match(/if\(!\['solid','glass','raised'\]\.includes\(C\.surface\)\)C\.surface='solid';/);
assert(migration,'Saved flat/invalid appearance values must migrate to Classic');
const normalize=new Function('C',migration[0]+'return C.surface;');
for(const [input,expected] of [['flat','solid'],['bogus','solid'],[null,'solid'],['solid','solid'],['glass','glass'],['raised','raised']]){
 assert.equal(normalize({surface:input}),expected,'Appearance migration failed: '+input);
}
assert.match(app,/prop!=='surface'\|\|\['solid','glass','raised'\]\.includes\(value\)/,'Event handler must reject removed Flat style');
assert.match(html,/styles\.css\?v=[a-z0-9-]+/,'Styles must retain a cache-busting version');
assert.match(html,/app\.js\?v=[a-z0-9-]+/,'Application script must retain a cache-busting version');

const wrapLimits=[...css.matchAll(/\.wrap\s*\{[^}]*max-width:[^;}]+/g)].map(match=>match[0]);
assert(wrapLimits.filter(rule=>rule.includes('var(--panel-content-max')).length>=3,
 'All desktop .wrap width rules must use the runtime setting, including later theme overrides');
assert(!wrapLimits.some(rule=>/max-width:(?:132rem|2112px)/.test(rule)),
 'Static desktop width caps must not override the slider');
assert.match(app,/cl\(Number\(C\.contentWidth\)\|\|1920,720,2240\)/,
 'Content width must support narrower desktop viewports');
assert.match(app,/id="content-width" min="720" max="2240" step="40"/,
 'The slider must offer visibly smaller widths on ordinary desktop screens');
assert.match(html,/styles\.css\?v=20261021-content-width-1/,'New CSS cache key must ship');

assert.match(app,/id="content-width" min="720" max="2240" step="10"/,
 'The width slider must have finer 10px increments');
assert.match(app,/const previewContentWidth=\(\)=>/,'Width changes must have a dedicated preview scheduler');
assert.match(app,/contentWidthFrame=requestAnimationFrame\(/,'Only one preview layout change per animation frame');
assert.match(app,/const saveContentWidth=\(\)=>/,'Width must persist on final change');
const dragBranch=app.match(/else if\(e\.target\.id==='content-width'\)\{[^}]+\}/)?.[0];
assert(dragBranch?.includes('previewContentWidth()')&&!dragBranch.includes('apply()'),
 'Dragging may only preview width; never invoke the heavyweight appearance updater');
const changeBranch=app.match(/if\(t\.id==='content-width'\)\{[\s\S]*?\n  \}/)?.[0];
assert(changeBranch?.includes('saveContentWidth()'),'Final width must be saved when the user releases the slider');
// Execute the real width preview and save implementation with a virtual frame
// queue to catch regressions that restore per-input storage writes.
const previewCode=app.slice(app.indexOf('let contentWidthFrame=0;'),
 app.indexOf('const brand=()=>'));
assert(previewCode.includes('paintContentWidth'));
const frameQueue=new Map();
let nextFrame=0,storageWrites=0,styleWrites=0;
const values=new Map();
const fakeStyle={
 getPropertyValue:key=>values.get(key)||'',
 setProperty:(key,value)=>{styleWrites++;values.set(key,value)}
};
const frameContext={
 C:{contentWidth:1920},cl:(n,a,b)=>Math.min(b,Math.max(a,n)),
 document:{documentElement:{style:fakeStyle}},
 requestAnimationFrame:fn=>{const id=++nextFrame;frameQueue.set(id,fn);return id},
 cancelAnimationFrame:id=>frameQueue.delete(id),
 localStorage:{set xmeshNexusSettings(value){storageWrites++;}}
};
const widthFns=new Function(...Object.keys(frameContext),
 previewCode+';return {previewContentWidth,saveContentWidth,C};')(...Object.values(frameContext));
for(let w=721;w<=2201;w+=10){widthFns.C.contentWidth=w;widthFns.previewContentWidth();}
assert.equal(frameQueue.size,1,'Burst of input events must be coalesced to one frame');
assert.equal(storageWrites,0,'No storage writes while dragging');
assert.equal(styleWrites,0,'No layout writes before the scheduled frame');
[...frameQueue.values()][0]();frameQueue.clear();
assert.equal(styleWrites,1,'A frame must repaint width only once');
widthFns.C.contentWidth=1711;widthFns.previewContentWidth();
widthFns.saveContentWidth();
assert.equal(frameQueue.size,0,'Committing must cancel a pending stale frame');
assert.equal(values.get('--panel-content-max'),'1711px');
assert.equal(storageWrites,1,'Final width must be stored once');
// Appearance uses two balanced columns and the locale selector is global.
assert.match(app,/<div class="appearance-layout">/,'Aligned appearance workspace must exist');
assert.match(app,/appearance-column/,'Appearance cards must use two columns');
assert.match(css,/\.appearance-layout\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(app,/id="content-width"/,'Workspace width setting must be present');
assert.match(app,/id="gap-scale"/,'Card spacing setting must be present');
assert.match(app,/setProperty\('--panel-content-max'/,'Workspace width must affect layout');
assert.match(app,/setProperty\('--view-gap'/,'Card spacing must affect layout');
assert.doesNotMatch(app,/settings-language-toggle/,'Locale selector must not be in appearance settings');
// The UI formerly changed C.surface but tried to call .forEach on $()
// (one element), leaving the previous choice visibly highlighted.
const beginning=app.indexOf("else if(b=g('[data-ui]'))");
const ending=app.indexOf("\n  else if(g('#rs'))",beginning);
assert(beginning>=0&&ending>beginning,'Appearance event handler must be present');
const eventHandler=app.slice(beginning,ending).replace("else if(b=g('[data-ui]'))","if(b)");
const run=new Function('b','C','apply','document',eventHandler);
function button(value,selected){
 const classes=new Set(selected?['on']:[]);
 const attrs={};
 return {
  dataset:{ui:'surface',value},
  classList:{contains:name=>classes.has(name),toggle:(name,on)=>on?classes.add(name):classes.delete(name)},
  setAttribute:(key,val)=>{attrs[key]=val},
  getAttribute:key=>attrs[key]
 };
}
const buttons=['solid','glass','raised'].map((value,i)=>button(value,i===0));
const C={surface:'solid'};
const doc={querySelectorAll:selector=>{
 assert.equal(selector,'[data-ui="surface"]');
 return buttons;
}};
let applied=0;
for(const [index,value] of ['glass','raised','solid'].entries()){
 run(buttons.find(x=>x.dataset.value===value),C,()=>{applied++},doc);
 assert.equal(C.surface,value,'The surface value must update');
 assert.equal(buttons.filter(x=>x.classList.contains('on')).length,1,'Exactly one choice must be highlighted');
 assert.equal(buttons.find(x=>x.classList.contains('on')).dataset.value,value,'Highlight must follow selected style');
 for(const button of buttons)assert.equal(button.getAttribute('aria-pressed'),String(button.dataset.value===value),'ARIA state must follow selection');
}
assert.equal(applied,3);
assert.match(app,/aria-pressed="\$\{\(C\[key\]\|\|CDEFAULT\[key\]\)==v\?'true':'false'\}/,'Initial selection must expose aria-pressed');
new Function(app);
console.log('Appearance surface choices, visual state and migration: OK');
