#!/usr/bin/env node
'use strict';
const {panelStyles}=require('./ci/frontend-source.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const css=panelStyles();
new Function(app); // Catch invalid JavaScript before shipping any layout changes.
const start=app.indexOf('function hostEditorMarkup(o,e){');
const end=app.indexOf('\nfunction squadEditorMarkup(',start);
assert(start>=0&&end>start,'Missing host editing template');
const source=app.slice(start,end);
const DB={
  profiles:[{id:1,name:'Sample profile'}],
  nodes:[{id:5,name:'Netherlands',addr:'example.net',port:443,profileId:1}],
};
const field=(f,value)=>'<label class="f"><span>'+f.l+'</span><input name="'+f.k+'" value="'+String(value??'')+'"></label>';
const names=['profileId','tag','nodes','disabled','remark','address','port','countryCode',
 'sni','host','path','fp','publicKey','shortId','spiderX','alpn','serviceName','clientEncryption'];
const fspec=names.map(k=>({k,l:k}));
const editor=new Function('DB','hostProfile','inbs','field','esc','ic',source+'\nreturn hostEditorMarkup;')(
 DB,()=>DB.profiles[0],()=>[{tag:'vless-main-2',protocol:'vless'}],
 field,x=>String(x).replace(/&/g,'&amp;').replace(/"/g,'&quot;'),()=>''
);
const html=editor({profileId:1,tag:'vless-main-2',remark:'NL',
 address:'example.net',port:443,nodes:[5]}, {fs:fspec});
const sections=[...html.matchAll(/<section class="([^"]+)"/g)].map(x=>x[1]);
assert.deepEqual(sections,[
 'host-editor-main host-primary-panel',
 'host-advanced host-advanced-panel',
 'host-editor-side'
],'The modal must have exactly three adjacent, permanent zones.');
for(const key of names){
 const occurrences=html.split('name="'+key+'"').length-1;
 assert.equal(occurrences,1,'Input '+key+' must occur exactly once');
}
for(const action of ['data-host-node-preset','data-host-count','data-host-resolved',
  'data-host-runtime','data-host-clear-overrides']){
 assert(html.includes(action),'Missing working host editor action '+action);
}
assert(!html.includes('<details'),'Advanced options must be always visible');

// Host geometry is feature-owned inside the canonical panel graph. Desktop keeps
// three permanent zones on one row; smaller viewports deliberately reflow them.
assert.match(css,/\.host-editor-layout\s*\{[\s\S]*?display:grid[\s\S]*?grid-template-columns:minmax\(0,1\.08fr\) minmax\(0,1fr\) minmax\(0,1\.08fr\)[\s\S]*?grid-template-areas:"primary overrides preview"/,
 'Host editor must keep the three-zone desktop grid');
const desktopEnd=css.indexOf('@media (max-width:1260px)',css.indexOf('.host-editor-layout {'));
assert(desktopEnd>0,'Host editor must define a 1260px responsive boundary');
const desktopCss=css.slice(css.indexOf('.host-editor-layout {'),desktopEnd);
assert(!desktopCss.includes('"overrides overrides"'),'No separate overrides row on desktop');

// The real outer workspace must outrank generic small-dialog fallbacks. Static
// checks previously validated only the inner three-column grid, which allowed a
// valid grid to be rendered inside a 30rem shell.
assert.match(css,/#dlg\.host-wide\s*\{[\s\S]*?width:min\(var\(--dialog-width\),calc\(100vw - 2rem\)\)[\s\S]*?min-inline-size:min\(72rem,calc\(100vw - 2rem\)\)/,
 'Host editor must own a workstation-sized outer dialog');
assert.match(css,/#dlg\.host-wide>form\.box\s*\{[\s\S]*?display:grid[\s\S]*?grid-template-rows:auto minmax\(0,1fr\) auto auto[\s\S]*?overflow:hidden/,
 'Host dialog shell must reserve a shrinkable body between header and footer');
assert.match(css,/#dlg\.host-wide>form\.box>\.host-editor-layout\s*\{[\s\S]*?min-height:0[\s\S]*?overflow:auto/,
 'Host editor workspace must own vertical scrolling instead of the whole form');
assert.match(css,/#dlg\.host-wide>form\.box>\.act\s*\{[\s\S]*?position:static[\s\S]*?z-index:auto/,
 'Host editor footer must stay in normal flow and never cover fields');
assert.doesNotMatch(css,/#dlg\.host-wide>form\.box>\.act\s*\{[^}]*!important/,
 'Host editor footer must not rely on specificity escalation');
assert.match(css,/@media \(max-width:1260px\)[\s\S]*?grid-template-areas:"primary preview" "overrides overrides"/,
 'Medium viewports must reflow the three zones without overlap');
assert.match(css,/@media \(max-width:760px\)[\s\S]*?grid-template-areas:"primary" "overrides" "preview"/,
 'Small screens must stack all three zones');
assert.match(css,/@media \(max-width:440px\)[\s\S]*?\.host-connect-fields\s*\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)/,
 'Phone layout must keep host fields usable');

// User details must be content-sized. A minimum shell height plus fixed canvas
// height created a large empty lower half even though all controls were visible.
assert.match(css,/#dlg\.user-modal\s*\{[\s\S]*?min-height:0[\s\S]*?height:auto/,
 'User details dialog must not force an artificial minimum height');
assert.match(css,/#dlg\.user-modal>\.user-canvas\s*\{[\s\S]*?block-size:auto[\s\S]*?display:flex[\s\S]*?flex-direction:column/,
 'User details canvas must grow naturally and shrink only at the viewport boundary');
assert.match(css,/#dlg\.user-modal \.user-canvas-grid\s*\{[\s\S]*?flex:0 1 auto[\s\S]*?overflow:auto/,
 'User details body must be the shrinkable scroll owner');
console.log('Workspace dialogs: host width/body/footer, responsive zones and user details content sizing OK');
