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
assert.match(html,/styles\.css\?v=20261021-node-grid-3/,'Update CSS cache key');
assert.match(html,/app\.js\?v=20261021-i18n-2/,'Update JS cache key');
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
