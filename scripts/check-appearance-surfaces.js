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
assert.match(app,/cl\(Number\(C\.contentWidth\)\|\|1920,720,3000\)/,
 'Content width must support narrower desktop viewports');
assert.match(app,/id="content-width" min="720" max="3000" step="1"/,
 'The width slider must support fine-grained adjustment on desktop screens');
assert.match(html,/styles\.css\?v=[a-z0-9-]+/,'The active stylesheet needs a versioned cache key');

assert.match(app,/id="content-width" min="720" max="3000" step="1"/,
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
for(let w=721;w<=2991;w+=10){widthFns.C.contentWidth=w;widthFns.previewContentWidth();}
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
widthFns.C.contentWidth=3000;
widthFns.previewContentWidth();
[...frameQueue.values()][0]();frameQueue.clear();
assert.equal(values.get('--panel-content-max'),'3000px',
 'Ultrawide screens must support the full 3000px content width');
widthFns.C.contentWidth=3150;
widthFns.saveContentWidth();
assert.equal(values.get('--panel-content-max'),'3000px',
 'The setting must clamp widths larger than 3000px');
// Appearance grid must pair cards on real grid rows, including when the panel width changes.
assert.match(css,/\.appearance-column\{display:contents\}/,'Independent masonry columns must be flattened');
for(const rule of [
 '.appearance-column:first-child>.card:nth-child(1){grid-area:1/1}',
 '.appearance-column:nth-child(2)>.card:nth-child(1){grid-area:1/2}',
 '.appearance-column:first-child>.card:nth-child(2){grid-area:2/1}',
 '.appearance-column:nth-child(2)>.card:nth-child(2){grid-area:2/2}',
 '.appearance-column:first-child>.card:nth-child(3){grid-area:3/1}',
 '.appearance-column:nth-child(2)>.card:nth-child(3){grid-area:3/2}'
])assert(css.includes(rule),'Aligned card row missing: '+rule);
assert.match(css,/@container appearance-view \(max-width:70rem\)/,'Narrow workspace width must stack cards even on a large monitor');
assert.match(app,/id="palette-apply"/,'Custom palette must have an Apply button');
assert.match(app,/id="palette-cancel"/,'Custom palette must have a Cancel button');
assert.match(app,/const paletteDraft=/,'Palette editor must use draft state');
assert.match(app,/C\.customA=paletteDraft\.a;/,'Custom palette must commit only on confirmation');
assert.match(app,/paletteDraft\.a=hslHex/,'Hue slider must modify draft instead of live accent');
assert.match(app,/class="palette-preset/,'Curated color options must have labelled preview tiles');
for(const name of ['sapphire','teal','coral','indigo','copper','glacier','graphite'])
 assert(css.includes('[data-accent='+name+']'),'Curated theme missing '+name);
// Confirm custom colors without triggering the browser-native color selector.
const customMarkup=app.slice(app.indexOf('async function setP()'),app.indexOf('/* ================= ПАЛИТРА КОМАНД'));
assert.doesNotMatch(customMarkup,/<input type="color"/,'Native color popup must be absent');
assert.match(customMarkup,/class="palette-hex-fields"/,'Custom palette must offer HEX inputs');
assert(css.includes('.appearance-layout .color-slider-grid{display:grid;'),
 'HSL rows must not be overridden by generic card flex rules');
const colorCode=app.slice(app.indexOf('const updatePaletteColor='),app.indexOf('const brand=()=>'));
assert(colorCode.startsWith('const updatePaletteColor='));
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
assert.equal(previewCount,0,'Incomplete input must not repaint theme');
assert.equal(attrs['aria-invalid'],'true');
control.value='#abcdef';
assert.equal(updateHex(control),true);
assert.equal(draft.a,'#ABCDEF');
assert.equal(previewCount,1);
assert.equal(attrs['aria-invalid'],'false');
control.id='custom-b';control.value='13579b';
updateHex(control);
assert.equal(draft.b,'#13579B');
assert.equal(draft.a,'#ABCDEF','Second color must not modify first');

// Palette layout: the 8-column ultrawide gallery has three complete rows of 8 presets.
const paletteCode=app.slice(app.indexOf('  const sw=[',app.indexOf('async function setP()')),
 app.indexOf('  const choices=',app.indexOf('async function setP()')));
const palettePresets=[...paletteCode.matchAll(/\['([a-z]+)','(#[0-9a-f]{6})','(#[0-9a-f]{6})','([^']+)'\]/g)];
assert.equal(palettePresets.length,24,'The gallery must contain 24 presets (three rows of eight on ultrawide displays)');
assert.equal(new Set(palettePresets.map(match=>match[1])).size,24,'Preset keys must be unique');
for(const theme of [["lime","Лайм","Lime"],["terracotta","Терракота","Terracotta"],["orchid","Орхидея","Orchid"],["aurora","Аврора","Aurora"],["sakura","Сакура","Sakura"],["storm","Шторм","Storm"],["flame","Пламя","Flame"],["sage","Шалфей","Sage"],["midnight","Полночь","Midnight"],["tropical","Тропики","Tropics"]]){
 const [id,name,en]=theme;
 assert(palettePresets.some(match=>match[1]===id&&match[4]===name),'Missing Russian-labelled preset '+id);
 assert(css.includes('[data-accent='+id+']'),'Missing dark-mode theme '+id);
 assert(css.includes('[data-theme=light][data-accent='+id+']'),'Missing light-mode theme '+id);
 const catalog=fs.readFileSync('i18n.js','utf8');
 assert(catalog.includes('["'+name+'","'+en+'"]'),'Missing RU/EN label for '+id);
}

// Smooth appearance transitions must not reintroduce full-theme work on every frame.
assert.match(css,/\.wrap:has\(#view \.appearance-layout\)\{\s*transition:max-width/,
 'Workspace width needs a gently eased transition');
assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{/,
 'OS reduced-motion preferences must disable the added transitions');
assert.match(css,/html\[data-motion=on\] \.appearance-layout\{/,
 'Motion must respect the panel animation toggle');
assert.match(css,/::-webkit-slider-thumb/);
assert.match(css,/::-moz-range-thumb/);
assert.match(app,/initializeRangeProgress\(v\)/,
 'Appearance tracks must fill to their saved values on render');
assert.match(app,/syncRangeProgress\(e\.target\)/,
 'Track progress must update during slider movement');
const rangeLogic=app.slice(app.indexOf('const syncRangeProgress='),
 app.indexOf('const brand=()=>'));
assert(rangeLogic.startsWith('const syncRangeProgress='));
const updateProgress=new Function(rangeLogic+
 ';return {syncRangeProgress,initializeRangeProgress};')();
let fill=null,count=0;
const range={
 min:'720',max:'3000',value:'1860',matches:s=>s==='input[type="range"]',
 style:{setProperty:(key,value)=>{assert.equal(key,'--range-pct');fill=value;count++}}
};
updateProgress.syncRangeProgress(range);
assert.equal(fill,'50.00%','Saved halfway width must fill half of its track');
range.value='3000';
updateProgress.syncRangeProgress(range);
assert.equal(fill,'100.00%','Max width must fill entire range');
range.value='720';
updateProgress.syncRangeProgress(range);
assert.equal(fill,'0.00%','Min width must clear range fill');
const nonAppearance={...range,matches:()=>false};
updateProgress.syncRangeProgress(nonAppearance);
assert.equal(count,3,'Non-range elements should not trigger range updates');
const root={querySelectorAll:()=>[range]};
updateProgress.initializeRangeProgress(root);
assert.equal(count,4,'Saved slider progress must hydrate after page rendering');

// Common range styles must include SUBSCRIPTION STUDIO, not only appearance page.
const subscriptionJs=fs.readFileSync('subscription-studio.js','utf8');
assert.match(subscriptionJs,/type="range" name="subscriptionRadius"/);
assert.match(css,/^input\[type="range"\]\{/m);
assert.match(css,/^input\[type="range"\]::-webkit-slider-thumb\{/m);
assert.match(css,/^input\[type="range"\]::-moz-range-thumb\{/m);
assert.match(css,/html\[data-motion=on\] input\[type="range"\]/);
assert.match(app,/const saveAppearanceControls=\(\)=>/);
assert.match(app,/\['ts','radius','gap-scale'\]\.includes\(t\.id\)/);
assert.match(app,/id="ts" min="0.9" max="2" step="0.01"/,'Unified interface scale must advance by 1%');
assert.match(app,/id="tsv" data-appearance-value="ts" min="90" max="200" step="1"/,
 'Scale must support exact numeric 1% adjustment');
assert.doesNotMatch(app,/id="text-size"/,'Duplicate text scaling control must not reappear');
assert.doesNotMatch(css,/--text-size-scale/,'Text must inherit unified interface scale only');
for(const key of ['ts','radius','gap-scale']){
 const handler=app.match(new RegExp("e\\.target\\.id(?:===|==)'"+key+"'\\)\\{([^}]+)\\}"))?.[1];
 assert(handler?.includes('previewAppearanceControls()')&&!handler.includes('apply()'),
  key+' must not trigger full theme serialization on drag');
}
const fineAdjust=app.slice(app.indexOf('let appearanceControlsFrame=0;'),app.indexOf('const brand=()=>'));
const pending=new Map(),cssValues=new Map();let id=0,saveCount=0,themeSyncCount=0;
const appearance=new Function('C','document','requestAnimationFrame','cancelAnimationFrame','cl','apply','syncSubscriptionTheme',
 fineAdjust+'return {previewAppearanceControls,saveAppearanceControls};')(
 {ts:1.2,radius:16,gapScale:1,density:'comfortable'},
 {documentElement:{style:{setProperty:(key,value)=>cssValues.set(key,value)}}},
 fn=>{const frame=++id;pending.set(frame,fn);return frame},frame=>pending.delete(frame),
 (v,min,max)=>Math.max(min,Math.min(max,v)),()=>{saveCount++},()=>{themeSyncCount++});
for(let n=0;n<60;n++)appearance.previewAppearanceControls();
assert.equal(pending.size,1,'Input bursts must coalesce into one layout preview');
assert.equal(saveCount,0,'No full apply during dragging');
[...pending.values()][0]();pending.clear();
assert.equal(cssValues.get('--ui-radius'),'16px');
assert.equal(cssValues.get('--ts'),1.2);
appearance.saveAppearanceControls();
assert.equal(saveCount,1,'Final appearance state must save once');
assert.equal(themeSyncCount,1,'Final appearance change must also sync the linked subscription theme');

/* The user sees steps in pixels or percentages; fractional multipliers must
   advance by 0.01 for one percentage point, not by a whole multiplier. */
for(const [id,min,max,step] of [
 ['ts','0.9','2','0.01'],['radius','1','36','1'],
 ['content-width','720','3000','1'],['gap-scale','0.8','1.4','0.01'],
 ['hue','0','360','1'],['sat','0','100','1'],['lum','15','85','1']
]){
 assert.match(app,new RegExp('id="'+id+'" min="'+min+'" max="'+max+'" step="'+step+'"'),
  'Incorrect range settings for '+id);
}
assert.match(app,/cl\(\+C\.ts\|\|1,\.9,2\)/,'Stored scale must cap at 200%');
assert.match(app,/cl\(Number\(C\.ts\)\|\|1,\.9,2\)/,'Scale preview must cap at 200%');
assert(app.includes("Number(C.radius):16,1,36"),'Applied radius must support 1..36px without false fallback for zero');
assert.match(app,/const radius=cl\(Number\.isFinite\(Number\(C\.radius\)\)\?Number\(C\.radius\):16,1,36\)/,'Radius preview must support 1..36px');
assert.doesNotMatch(app,/id="ts" min="0.9" max="1.3"/);
assert.doesNotMatch(app,/id="radius" min="1" max="48"/);

// Appearance slider precision must be independent of its minimum:
// 4px + 10 used to produce 4,14,24,34; now it snaps to absolute tens.
const precisionStart=app.indexOf('const APPEARANCE_RANGE_IDS=');
const precisionEnd=app.indexOf('// No serialization or full appearance recomputation',precisionStart);
assert(precisionStart>0&&precisionEnd>precisionStart);
const precisionCode=app.slice(precisionStart,precisionEnd);
const precisionState={rangePrecision:10};
const precisionLib=new Function('C','cl','syncRangeProgress',
 precisionCode+'return {configureRangePrecision,snapAppearanceSlider,commitAppearanceNumber};')(
 precisionState,(x,a,b)=>Math.min(b,Math.max(a,x)),()=>{});
const mockSlider=(id,min,max,value,step='1')=>({
 id,min:String(min),max:String(max),value:String(value),step,dataset:{},
 matches:selector=>selector==='input[type="range"]',
 getAttribute:key=>key==='step'?step:null
});
const radiusRange=mockSlider('radius',1,36,29);
precisionLib.configureRangePrecision(radiusRange);
assert.equal(radiusRange.step,'1','Radius keeps 1px precision in either mode');
precisionLib.snapAppearanceSlider(radiusRange);
assert.equal(Number(radiusRange.value),29,'Coarse mode must preserve an exact 29px radius');
for(const [raw,expected] of [[1,1],[16,16],[27,27],[29,29],[34,34],[36,36]]){
 radiusRange.value=String(raw);precisionLib.snapAppearanceSlider(radiusRange);
 assert.equal(Number(radiusRange.value),expected,'Coarse radius '+raw);
}
const widthRange=mockSlider('content-width',720,3000,2558);
precisionLib.configureRangePrecision(widthRange);
precisionLib.snapAppearanceSlider(widthRange);
assert.equal(Number(widthRange.value),2560,'Width must snap to absolute tens');
const scaleRange=mockSlider('ts',.9,2,1.13,'0.01');
precisionLib.configureRangePrecision(scaleRange);
precisionLib.snapAppearanceSlider(scaleRange);
assert.equal(Number(scaleRange.value),1.13,'Unified interface scale must retain 1% precision even in coarse mode');
precisionState.rangePrecision=1;
precisionLib.configureRangePrecision(scaleRange);
scaleRange.value='1.13';precisionLib.snapAppearanceSlider(scaleRange);
assert.equal(Number(scaleRange.value),1.13,'Fine mode should allow 113%');
radiusRange.value='17';precisionLib.configureRangePrecision(radiusRange);
assert.equal(Number(radiusRange.value),17,'Switching precision must not overwrite a custom value');
assert.match(app,/data-appearance-value="radius"/);
assert.match(app,/data-appearance-value="ts"/);
assert.match(app,/data-appearance-value="content-width"/);
assert.match(app,/data-appearance-value="gap-scale"/);
assert.match(app,/commitAppearanceNumber\(t\)/,'Exact numeric values must be saved');
assert.match(app,/r\.style\.setProperty\('--ui-control-radius',radius\+'px'\)/,
 'Configured radius should apply consistently to buttons');
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
let applied=0,uiThemeSyncs=0;
for(const [index,value] of ['glass','raised','solid'].entries()){
 run(buttons.find(x=>x.dataset.value===value),C,()=>{applied++},doc,()=>{uiThemeSyncs++});
 assert.equal(C.surface,value,'The surface value must update');
 assert.equal(buttons.filter(x=>x.classList.contains('on')).length,1,'Exactly one choice must be highlighted');
 assert.equal(buttons.find(x=>x.classList.contains('on')).dataset.value,value,'Highlight must follow selected style');
 for(const button of buttons)assert.equal(button.getAttribute('aria-pressed'),String(button.dataset.value===value),'ARIA state must follow selection');
}
assert.equal(applied,3);
assert.equal(uiThemeSyncs,3,'Panel surface switches must update linked subscription appearance');
assert.match(app,/aria-pressed="\$\{\(C\[key\]\|\|CDEFAULT\[key\]\)==v\?'true':'false'\}/,'Initial selection must expose aria-pressed');
new Function(app);
console.log('Appearance surface choices, visual state and migration: OK');
