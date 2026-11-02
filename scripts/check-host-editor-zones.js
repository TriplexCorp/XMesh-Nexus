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

// User Details is deliberately wider than a form dialog and must have only one
// material shell. The canonical selector intentionally matches the legacy
// dialog#dlg:is(.node-wide,.user-modal) specificity so load order is authoritative.
assert.match(css,/dialog#dlg\.user-modal\s*\{[\s\S]*?--dialog-width:1960px[\s\S]*?--modal-off:translateY\(22px\) scale\(\.972\)[\s\S]*?min-inline-size:min\(1480px,calc\(100vw - 1\.5rem\)\)[\s\S]*?min-height:0[\s\S]*?max-block-size:calc\(100dvh - 1\.5rem\)/,
 'User details dialog must outrank the legacy min-height and use the taller wide workspace contract');
assert.match(css,/dialog#dlg\.user-modal\s*\{[\s\S]*?opacity \.34s[\s\S]*?transform \.50s[\s\S]*?overlay \.50s allow-discrete/,
 'User details must use the slower premium open/close motion contract');
assert.match(css,/dialog#dlg\.user-modal>\.user-canvas\s*\{[\s\S]*?block-size:auto[\s\S]*?max-block-size:calc\(100dvh - 1\.5rem\)[\s\S]*?display:flex[\s\S]*?flex-direction:column[\s\S]*?border:0[\s\S]*?background:transparent[\s\S]*?box-shadow:none/,
 'User details canvas must stay single-surface and use the taller desktop viewport budget');
assert.match(css,/#dlg\.user-modal \.user-canvas-grid\s*\{[\s\S]*?flex:0 1 auto[\s\S]*?overflow:auto/,
 'User details body must be the shrinkable scroll owner');
assert.match(css,/@media\(min-width:1200px\)[\s\S]*?#dlg\.user-modal \.user-canvas-grid\s*\{[\s\S]*?grid-template-columns:minmax\(0,1\.02fr\) minmax\(0,1\.02fr\) minmax\(0,1\.35fr\)/,
 'Desktop User Details must spend more width on the intelligence pane');
assert.match(css,/@media\(min-width:1600px\)[\s\S]*?#dlg\.user-modal \.user-pane-insights\s*\{[\s\S]*?grid-template-columns:minmax\(0,1\.35fr\) minmax\(12rem,.75fr\)[\s\S]*?grid-template-rows:auto minmax\(0,1fr\)/,
 'Traffic and devices may split horizontally only on genuinely wide desktop surfaces');
assert.match(css,/#dlg\.user-modal \.user-canvas-foot\s*\{[\s\S]*?flex:0 0 auto[\s\S]*?position:relative[\s\S]*?border-top:0[\s\S]*?background:transparent[\s\S]*?box-shadow:none/,
 'User details footer must remain metadata, not render as a second material strip');
assert.match(css,/html\[data-motion=off\] #dlg\.user-modal[\s\S]*?transition:none!important/,
 'User details premium motion must respect the animation setting');
console.log('Workspace dialogs: host shell and taller horizontal user details OK');
