#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');

const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const {panelStyles}=require('./ci/frontend-source.cjs');
const css=panelStyles();
const foundation=fs.readFileSync('frontend/styles/system/nexus-v3-foundation.css','utf8');
const settings=fs.readFileSync('frontend/styles/features/settings/settings.css','utf8');
const html=fs.readFileSync('frontend/index.html','utf8');

// Appearance modes and migration.
assert.match(app,/choices\('surface',\[\['solid','Классика'\],\['glass','Glass'\],\['raised','Объём'\]\]\)/,
 'Appearance must offer only Classic, Glass and Raised');
assert.doesNotMatch(app,/\['flat','Плоский'\]/,'Deprecated Flat must not be selectable');
assert.doesNotMatch(app,/Выберите плоский/,'Old Flat explanatory text must stay removed');
assert.doesNotMatch(css,/data-surface=flat/,'Deprecated Flat CSS must stay removed');
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

// Structural columns are declared by the route and remain ordinary containers.
assert.match(app,/appearance-layout/,'Appearance workspace markup must exist');
assert.match(app,/appearance-column/,'Appearance workspace must retain structural columns');
assert.doesNotMatch(settings,/display\s*:\s*contents/,'Settings must not flatten its structural columns');
assert.doesNotMatch(settings,/grid-area\s*:/,'Settings cards must flow naturally, without historical slot placement');
assert.match(settings,/@(?:container|media)/,'Settings requires responsive reflow');

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
 assert(css.includes('[data-accent='+name+']'),'Curated theme missing '+name);
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
assert.doesNotMatch(css,/--text-size-scale/,'Text must inherit the unified scale only');
assert.match(app,/data-appearance-value="radius"/);
assert.match(app,/data-appearance-value="content-width"/);
assert.match(app,/data-appearance-value="gap-scale"/);
assert.match(app,/commitAppearanceNumber\(t\)/,'Exact numeric values must be persisted');
assert.match(app,/r\.style\.setProperty\('--ui-control-radius',radius\+'px'\)/,
 'Configured radius must apply to shared controls');

// Shared range styling remains available to other feature surfaces.
const subscriptionJs=fs.readFileSync('frontend/js/features/subscriptions/subscription-studio.js','utf8');
assert.match(subscriptionJs,/type="range" name="subscriptionRadius"/);
assert.match(css,/^input\[type=range\]\{/m);
assert.match(css,/^input\[type=range\]::-webkit-slider-thumb\{/m);
assert.match(css,/^input\[type=range\]::-moz-range-thumb\{/m);

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

// Raised needs a small directional reflection to distinguish it from Classic
// in both palettes, but it must never become a bright full-card gradient slab.
// The visual browser audit independently checks three distinct materials.
const darkRaised=foundation.match(/html\[data-surface=raised\]\{([^}]+)\}/)?.[1];
const lightRaised=foundation.match(/html\[data-theme=light\]\[data-surface=raised\]\{([^}]+)\}/)?.[1];
assert(darkRaised&&lightRaised,'Both dark and light Raised material overrides must exist');
for(const [name,block] of [['dark',darkRaised],['light',lightRaised]]){
 const sheen=block.match(/--nx-panel-image:linear-gradient\(180deg,rgba\((\d+),(\d+),(\d+),([\d.]+)\),transparent (\d+)%\)/);
 assert(sheen,'Raised '+name+' must have a subtle top-edge reflection, fading to transparent');
 const [,r,g,b,a,stop]=sheen;
 assert(Math.max(+r,+g,+b)-Math.min(+r,+g,+b)<=20,'Raised '+name+' must keep a neutral reflection');
 assert(+a>0&&+a<=(name==='dark'?.05:.30),'Raised '+name+' reflection must stay low intensity');
 assert(+stop>=25&&+stop<=45,'Raised '+name+' reflection must fade near the top edge');
 assert.equal((block.match(/gradient\(/g)||[]).length,1,'Raised '+name+' must not stack decorative gradients');
 assert.match(block,/--nx-panel-shadow:/,'Raised '+name+' needs one restrained elevation');
 assert.match(block,/--nx-item-shadow:none/,'Nested '+name+' items must not stack raised shadows');
 assert.match(block,/--nx-control-shadow:none/,'Nested '+name+' controls must not stack raised shadows');
}

assert.doesNotMatch(html,/styles\/legacy\//,'Historical CSS must not be loaded');
assert.match(html,/app\.js\?v=[a-z0-9-]+/,'Application script must remain versioned');
new Function(app);
console.log('Appearance behavior and enterprise Settings workspace: OK');
