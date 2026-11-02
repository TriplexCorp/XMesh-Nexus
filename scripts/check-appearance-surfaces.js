#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');

const app=fs.readFileSync('app.js','utf8');
const legacy=fs.readFileSync('styles.css','utf8');
const foundation=fs.readFileSync('nexus-v3-foundation.css','utf8');
const workspaces=fs.readFileSync('nexus-v3-workspaces.css','utf8');
const html=fs.readFileSync('index.html','utf8');

// Appearance modes and migration.
assert.match(app,/choices\('surface',\[\['solid','Классика'\],\['glass','Glass'\],\['raised','Объём'\]\]\)/,
 'Appearance must offer only Classic, Glass and Raised');
assert.doesNotMatch(app,/\['flat','Плоский'\]/,'Deprecated Flat must not be selectable');
assert.doesNotMatch(app,/Выберите плоский/,'Old Flat explanatory text must stay removed');
assert.doesNotMatch(legacy,/data-surface=flat/,'Deprecated Flat CSS must stay removed');
const migration=app.match(/if\(!\['solid','glass','raised'\]\.includes\(C\.surface\)\)C\.surface='solid';/);
assert(migration,'Saved invalid/flat values must migrate to Classic');
const normalize=new Function('C',migration[0]+'return C.surface;');
for(const [input,expected] of [['flat','solid'],['bogus','solid'],[null,'solid'],['solid','solid'],['glass','glass'],['raised','raised']]){
 assert.equal(normalize({surface:input}),expected,'Appearance migration failed: '+input);
}
assert.match(app,/prop!=='surface'\|\|\['solid','glass','raised'\]\.includes\(value\)/,
 'Event handler must reject removed material modes');
for(const surface of ['solid','glass','raised']){
 assert(foundation.includes('html[data-surface='+surface+']'),'Foundation missing '+surface+' material');
}

// Legacy may retain old compatibility selectors, but modern workspace geometry
// must explicitly own Settings and must never erase its structural columns.
assert.match(workspaces,/#view>\.appearance-layout\{[\s\S]*grid-template-columns:minmax\(0,1\.08fr\) minmax\(0,\.92fr\)/,
 'Settings must use the canonical enterprise two-column composition');
assert.match(workspaces,/#view>\.appearance-layout>\.appearance-column\{[\s\S]*display:grid/,
 'Settings structural columns must remain real grid containers');
assert.doesNotMatch(workspaces,/\.appearance-column\s*\{[^}]*display:contents/,
 'Modern Settings must never flatten appearance columns with display:contents');
assert.match(workspaces,/#view>\.appearance-layout>\.appearance-column>\.card:nth-child\(n\)\{[\s\S]*grid-area:auto/,
 'Modern Settings must neutralize historical explicit grid-area placement');
assert.match(workspaces,/@container settings-workspace \(max-width:88rem\)/,
 'Settings must stack from actual workspace width rather than viewport width');
assert.match(app,/<div class="appearance-layout">/,'Appearance workspace markup must exist');
assert.match(app,/appearance-column/,'Appearance workspace must retain structural columns');

// Content-width control: preview is frame-coalesced and persistence happens only
// on commit, so dragging cannot serialize the whole theme for every pixel.
assert.match(app,/cl\(Number\(C\.contentWidth\)\|\|1920,720,3000\)/,
 'Content width must support the 720..3000px range');
assert.match(app,/id="content-width" min="720" max="3000" step="1"/,
 'Content width needs exact 1px adjustment');
assert.match(app,/const previewContentWidth=\(\)=>/,'Width preview scheduler missing');
assert.match(app,/contentWidthFrame=requestAnimationFrame\(/,'Width preview must be frame-coalesced');
assert.match(app,/const saveContentWidth=\(\)=>/,'Width commit function missing');
const dragBranch=app.match(/else if\(e\.target\.id==='content-width'\)\{[^}]+\}/)?.[0];
assert(dragBranch?.includes('previewContentWidth()')&&!dragBranch.includes('apply()'),
 'Dragging width may only preview; it must not run full apply()');
const changeBranch=app.match(/if\(t\.id==='content-width'\)\{[\s\S]*?\n  \}/)?.[0];
assert(changeBranch?.includes('saveContentWidth()'),'Width must persist on final change');

const previewCode=app.slice(app.indexOf('let contentWidthFrame=0;'),app.indexOf('const brand=()=>'));
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
for(let w=721;w<=2991;w+=10){widthFns.C.contentWidth=w;widthFns.previewContentWidth();}
assert.equal(frameQueue.size,1,'Burst width input must coalesce to one frame');
assert.equal(storageWrites,0,'Width drag must not write storage');
assert.equal(styleWrites,0,'No width paint before scheduled frame');
[...frameQueue.values()][0]();frameQueue.clear();
assert.equal(styleWrites,1,'Scheduled width frame must paint once');
widthFns.C.contentWidth=1711;widthFns.previewContentWidth();widthFns.saveContentWidth();
assert.equal(frameQueue.size,0,'Commit must cancel a stale width frame');
assert.equal(values.get('--panel-content-max'),'1711px');
assert.equal(storageWrites,1,'Width commit must write once');
widthFns.C.contentWidth=3150;widthFns.saveContentWidth();
assert.equal(values.get('--panel-content-max'),'3000px','Content width must clamp above 3000px');

// Palette editing remains transactional.
assert.match(app,/id="palette-apply"/,'Custom palette needs Apply');
assert.match(app,/id="palette-cancel"/,'Custom palette needs Cancel');
assert.match(app,/const paletteDraft=/,'Palette editor must use draft state');
assert.match(app,/C\.customA=paletteDraft\.a;/,'Custom palette must commit only on confirmation');
assert.match(app,/paletteDraft\.a=hslHex/,'Hue slider must update the draft, not live saved state');
assert.match(app,/class="palette-preset/,'Curated theme tiles must remain labelled');
assert.match(app,/class="palette-hex-fields"/,'Custom palette must offer HEX inputs');
assert.doesNotMatch(app.slice(app.indexOf('async function setP()'),app.indexOf('/* ================= ПАЛИТРА КОМАНД')),/<input type="color"/,
 'Native color popups must stay absent');
assert.match(workspaces,/#view \.appearance-layout \.palette-preset-grid\{[\s\S]*repeat\(4,minmax\(0,1fr\)\)/,
 'Palette gallery must use the modern stable four-column grid');
assert.match(workspaces,/#view \.appearance-layout \.color-slider-grid\{[\s\S]*display:grid/,
 'HSL editor rows must be owned by modern workspace geometry');

const colorCode=app.slice(app.indexOf('const updatePaletteColor='),app.indexOf('const brand=()=>'));
let previewCount=0;
const draft={a:'#112233',b:'#445566',h:0,s:0,l:0};
const updateHex=new Function('paletteDraft','paletteHsl','paintPaletteDraft',
 colorCode+'return updatePaletteColor;')(draft,()=>({h:150,s:55,l:66}),()=>{previewCount++});
const classes=new Set(),attrs={};
const control={id:'custom-a',value:'#ABC',classList:{
 toggle:(name,active)=>active?classes.add(name):classes.delete(name)
},setAttribute:(key,value)=>{attrs[key]=value}};
assert.equal(updateHex(control),true);
assert.equal(draft.a,'#112233','Partial HEX must not be applied');
assert.equal(previewCount,0,'Incomplete HEX must not repaint');
assert.equal(attrs['aria-invalid'],'true');
control.value='#abcdef';updateHex(control);
assert.equal(draft.a,'#ABCDEF');
assert.equal(previewCount,1);
assert.equal(attrs['aria-invalid'],'false');

// Curated catalogue remains complete.
const paletteCode=app.slice(app.indexOf('  const sw=[',app.indexOf('async function setP()')),
 app.indexOf('  const choices=',app.indexOf('async function setP()')));
const palettePresets=[...paletteCode.matchAll(/\['([a-z]+)','(#[0-9a-f]{6})','(#[0-9a-f]{6})','([^']+)'\]/g)];
assert.equal(palettePresets.length,24,'Appearance gallery must contain 24 curated presets');
assert.equal(new Set(palettePresets.map(match=>match[1])).size,24,'Preset keys must be unique');
for(const name of ['sapphire','teal','coral','indigo','copper','glacier','graphite']){
 assert(legacy.includes('[data-accent='+name+']'),'Curated theme missing '+name);
}

// Range behavior: visible values use pixels/percentages and fine values remain exact.
assert.match(app,/initializeRangeProgress\(v\)/,'Appearance range tracks must initialize from saved values');
assert.match(app,/syncRangeProgress\(e\.target\)/,'Appearance range tracks must update during drag');
for(const [id,min,max,step] of [
 ['ts','0.9','2','0.01'],['radius','1','36','1'],
 ['content-width','720','3000','1'],['gap-scale','0.8','1.4','0.01'],
 ['hue','0','360','1'],['sat','0','100','1'],['lum','15','85','1']
]){
 assert.match(app,new RegExp('id="'+id+'" min="'+min+'" max="'+max+'" step="'+step+'"'),
  'Incorrect range settings for '+id);
}
assert.match(app,/id="tsv" data-appearance-value="ts" min="90" max="200" step="1"/,
 'Interface scale needs exact 1% numeric adjustment');
assert.doesNotMatch(app,/id="text-size"/,'Duplicate text scaling control must not return');
assert.doesNotMatch(legacy,/--text-size-scale/,'Text must inherit the unified scale only');
assert.match(app,/data-appearance-value="radius"/);
assert.match(app,/data-appearance-value="content-width"/);
assert.match(app,/data-appearance-value="gap-scale"/);
assert.match(app,/commitAppearanceNumber\(t\)/,'Exact numeric values must be persisted');
assert.match(app,/r\.style\.setProperty\('--ui-control-radius',radius\+'px'\)/,
 'Configured radius must apply to shared controls');

// Shared range styling remains available to other feature surfaces.
const subscriptionJs=fs.readFileSync('subscription-studio.js','utf8');
assert.match(subscriptionJs,/type="range" name="subscriptionRadius"/);
assert.match(legacy,/^input\[type="range"\]\{/m);
assert.match(legacy,/^input\[type="range"\]::-webkit-slider-thumb\{/m);
assert.match(legacy,/^input\[type="range"\]::-moz-range-thumb\{/m);

// Surface selection must update one visual/ARIA state at a time.
const beginning=app.indexOf("else if(b=g('[data-ui]'))");
const ending=app.indexOf("\n  else if(g('#rs'))",beginning);
assert(beginning>=0&&ending>beginning,'Appearance event handler must be present');
const eventHandler=app.slice(beginning,ending).replace("else if(b=g('[data-ui]'))","if(b)");
const run=new Function('b','C','apply','document','syncSubscriptionTheme',eventHandler);
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
let applied=0,themeSyncs=0;
for(const value of ['glass','raised','solid']){
 run(buttons.find(item=>item.dataset.value===value),C,()=>{applied++},doc,()=>{themeSyncs++});
 assert.equal(C.surface,value,'Surface value must update');
 assert.equal(buttons.filter(item=>item.classList.contains('on')).length,1,'Exactly one material choice must be active');
 assert.equal(buttons.find(item=>item.classList.contains('on')).dataset.value,value,'Highlight must follow selected material');
 for(const item of buttons)assert.equal(item.getAttribute('aria-pressed'),String(item.dataset.value===value),'ARIA state must follow selection');
}
assert.equal(applied,3);
assert.equal(themeSyncs,3,'Surface switches must update linked subscription appearance');
assert.match(app,/aria-pressed="\$\{\(C\[key\]\|\|CDEFAULT\[key\]\)==v\?'true':'false'\}/,
 'Initial material selection must expose aria-pressed');

assert.match(html,/styles\.css\?v=[a-z0-9-]+/,'Legacy compatibility asset must remain versioned');
assert.match(html,/app\.js\?v=[a-z0-9-]+/,'Application script must remain versioned');
new Function(app);
console.log('Appearance behavior and enterprise Settings workspace: OK');
