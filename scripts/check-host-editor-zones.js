#!/usr/bin/env node
'use strict';
const {frontendAsset,panelStyles,assertPackaged}=require('./ci/frontend-source.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const css=panelStyles();
new Function(app); // Catch invalid JavaScript before shipping any layout changes.
const feature=fs.readFileSync(frontendAsset('host-editor.js'),'utf8');
new Function(feature);
const scope={};
new Function('window',feature)(scope);
assert.deepEqual(Object.keys(scope),['XMeshHostEditor'],'Hosts must expose one explicit factory, not new implicit globals');
assert.deepEqual(Object.keys(scope.XMeshHostEditor),['create']);
assert(Object.isFrozen(scope.XMeshHostEditor),'The feature namespace must not carry mutable application state');
const DB={
  profiles:[{id:1,name:'Sample profile'}],
  nodes:[{id:5,name:'Netherlands',addr:'example.net',port:443,profileId:1}],
};
const field=(f,value)=>'<label class="f"><span>'+f.l+'</span><input name="'+f.k+'" value="'+String(value??'')+'"></label>';
const names=['profileId','tag','nodes','disabled','remark','address','port','countryCode',
 'sni','host','path','fp','publicKey','shortId','spiderX','alpn','serviceName','clientEncryption','clientXhttpSettings','clientHeaders','clientTlsSettings','clientMasqueSettings'];
const fspec=names.map(k=>({k,l:k}));
const countries=[{code:'NL',flag:'🇳🇱'},{code:'PL',flag:'🇵🇱'},{code:'DE',flag:'🇩🇪'}];
const flag=code=>String.fromCodePoint(...code.split('').map(c=>127397+c.charCodeAt(0)));
const helpers=scope.XMeshHostEditor.create({
 getProfiles:()=>DB.profiles,getNodes:()=>DB.nodes,
 findProfile:id=>DB.profiles.find(p=>String(p.id)===String(id)),
 inbounds:()=>[{tag:'vless-main-2',protocol:'vless'}],renderField:field,
 escapeHtml:x=>String(x).replace(/&/g,'&amp;').replace(/"/g,'&quot;'),icon:()=>'',
 countryCodes:countries.map(c=>c.code),countries,countryFlag:flag
});
assert(Object.isFrozen(helpers),'An instance must only expose its bounded operations');
const editor=helpers.hostEditorMarkup;
const index=fs.readFileSync('frontend/index.html','utf8');
assert.match(index,/<script src="\/js\/features\/hosts\/host-editor\.js\?v=[a-f0-9]{12}"><\/script>/,'Hosts must use a content-addressed classic script');
assert(index.indexOf('/js/features/hosts/host-editor.js?v=')<index.indexOf('/js/core/app.js?v='),'Hosts factory must load before app consumes it');
assertPackaged(assert,['host-editor.js']);
for(const name of ['hostEditorMarkup','hostNodeCountryCode','hostNodeCountryRemark','hostAutofillNodeFields']){
 assert(!app.includes('function '+name+'('),'Moved function must not remain duplicated in app.js: '+name);
 assert.equal((feature.match(new RegExp('function '+name+'\\(','g'))||[]).length,1,'Feature must own exactly one '+name);
}
assert.match(app,/getProfiles:\(\)=>DB\.profiles,getNodes:\(\)=>DB\.nodes/,'The adapter must read live collections instead of copying mutable DB');
assert.match(app,/hostEditorMarkup\(o,e\.fs\)/,'Hosts renderer receives only the relevant field schema');
assert.equal(helpers.hostNodeCountryCode({flag:'🇳🇱'}),'NL','Flag emoji must resolve to ISO country');
assert.equal(helpers.hostNodeCountryCode({flag:'pl'}),'PL','Legacy ISO flag must be accepted');
assert.equal(helpers.hostNodeCountryCode({countryCode:'DE',flag:'🇳🇱'}),'DE','Explicit node ISO must be authoritative');
assert.equal(helpers.hostNodeCountryCode({flag:'❓'}),'','Unknown flags must not generate fake ISO codes');
assert.equal(helpers.hostNodeCountryRemark({flag:'🇵🇱',name:'Польша'}),'🇵🇱 Польша','Happ Remark must include both flag and exact node name');
assert.equal(helpers.hostNodeCountryRemark({flag:'NL',name:'Нидерланды'}),'🇳🇱 Нидерланды','ISO node flags must produce a client-visible emoji and name');
assert.equal(helpers.hostNodeCountryRemark({countryCode:'DE',flag:'🇵🇱',name:'Custom Berlin'}),'🇩🇪 Custom Berlin','Explicit ISO override determines the emoji while preserving node name');
assert.equal(helpers.hostNodeCountryRemark({flag:'PL',name:'Warsaw Premium #2'}),'🇵🇱 Warsaw Premium #2','Custom names must be transferred verbatim');
assert.equal(helpers.hostNodeCountryRemark({flag:'PL',name:'  Польша  '}),'🇵🇱 Польша','Surrounding whitespace must not leak into client remarks');
assert.equal(helpers.hostNodeCountryRemark({flag:'DE',name:'Germany Premium'}),'🇩🇪 Germany Premium');
assert.equal(helpers.hostNodeCountryRemark({flag:'PL',name:'  '}),'🇵🇱');
assert.equal(helpers.hostNodeCountryRemark({flag:'PL'}),'🇵🇱','Unnamed node retains its flag');
assert.equal(helpers.hostNodeCountryRemark({name:'Custom node',flag:'❓'}),'Custom node','Unknown country must not generate a fake flag');
const fields={remark:{value:''},countryCode:{value:''}};
const form={elements:{namedItem:key=>fields[key]}};
helpers.hostAutofillNodeFields(form,{flag:'🇳🇱',name:'Нидерланды'});
assert.equal(fields.remark.value,'🇳🇱 Нидерланды','Implicit autofill must include flag and node name in Happ');
assert.equal(fields.countryCode.value,'NL');
fields.remark.value='Manual custom name';
helpers.hostAutofillNodeFields(form,{flag:'🇵🇱',name:'Польша'});
assert.equal(fields.remark.value,'Manual custom name','Implicit autofill must preserve a manual remark');
helpers.hostAutofillNodeFields(form,{flag:'🇵🇱',name:'Польша'},true);
assert.equal(fields.remark.value,'🇵🇱 Польша','Explicit node preset must replace the stale label with flag and node name');
assert.equal(fields.countryCode.value,'PL','Explicit node preset must update country');
assert.match(app,/hostAutofillNodeFields\(form,node,true\)/,'Node preset must fill country and remark');
assert.match(app,/remark:hostNodeCountryRemark\(node\)\|\|'Новый хост',countryCode/,'Create Host from a node must use emoji for client and ISO for routing');
const html=editor({profileId:1,tag:'vless-main-2',remark:'🇳🇱',
 address:'example.net',port:443,nodes:[5]}, fspec);
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
assert(!html.includes('<details class="host-advanced'),'Existing transport and security overrides must remain visible');
assert(html.includes('host-client-settings'),'Expert client metadata must have its own disclosure');
// Bootstrap refreshes replace arrays. An existing feature instance must see
// the new collections and must leave their objects untouched during rendering.
DB.profiles=[{id:2,name:'Replacement profile'}];
DB.nodes=[{id:6,name:'Replacement node',addr:'new.example.net',profileId:2}];
const snapshot=JSON.stringify(DB);
const updated=editor({profileId:2},fspec);
assert(updated.includes('Replacement node'),'The factory must not retain stale node arrays');
assert(updated.includes('name="profileId" value="2"'),'The factory must not retain stale profiles');
assert.equal(JSON.stringify(DB),snapshot,'Rendering must not mutate application collections');


// Host geometry is feature-owned inside the canonical panel graph. Desktop keeps
// three permanent zones on one row; smaller viewports deliberately reflow them.
assert.match(css,/\.host-editor-layout\s*\{[\s\S]*?display:grid[\s\S]*?grid-template-columns:minmax\(0,1\.15fr\) minmax\(0,1fr\) minmax\(0,\.95fr\)[\s\S]*?grid-template-areas:"primary overrides preview" "assignment assignment preview"/,
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
assert.match(css,/@media \(max-width:1260px\)[\s\S]*?grid-template-areas:"primary preview" "assignment preview" "overrides overrides"/,
 'Medium viewports must reflow the three zones without overlap');
assert.match(css,/@media \(max-width:760px\)[\s\S]*?grid-template-areas:"primary" "assignment" "overrides" "preview"/,
 'Small screens must stack all three zones');
assert.match(css,/@media \(max-width:440px\)[\s\S]*?\.host-connect-fields[^{}]*\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)/,
 'Phone layout must keep host fields usable');

// User Details is deliberately wider than a form dialog and must have only one
// material shell. The canonical selector intentionally matches the legacy
// dialog#dlg:is(.node-wide,.user-modal) specificity so load order is authoritative.
assert.match(css,/dialog#dlg\.user-modal\s*\{[\s\S]*?--dialog-width:84rem[\s\S]*?--modal-off:translateY\(22px\) scale\(\.972\)[\s\S]*?min-inline-size:0[\s\S]*?min-height:0[\s\S]*?max-block-size:calc\(100dvh - 1\.5rem\)/,
 'User details dialog must outrank the legacy min-height and use the taller wide workspace contract');
assert.match(css,/dialog#dlg\.user-modal\s*\{[\s\S]*?opacity \.34s[\s\S]*?transform \.50s[\s\S]*?overlay \.50s allow-discrete/,
 'User details must use the slower premium open/close motion contract');
assert.match(css,/dialog#dlg\.user-modal>\.user-canvas\s*\{[\s\S]*?block-size:auto[\s\S]*?max-block-size:calc\(100dvh - 1\.5rem\)[\s\S]*?display:flex[\s\S]*?flex-direction:column[\s\S]*?border:0[\s\S]*?background:transparent[\s\S]*?box-shadow:none/,
 'User details canvas must stay single-surface and use the taller desktop viewport budget');
assert.match(css,/#dlg\.user-modal \.user-canvas-grid\s*\{[\s\S]*?flex:0 1 auto[\s\S]*?overflow:auto/,
 'User details body must be the shrinkable scroll owner');
assert.match(css,/#dlg\.user-modal \.user-canvas-grid\s*\{[\s\S]*?grid-template-columns:minmax\(0,1fr\);grid-template-rows:minmax\(0,1fr\)/,
 'User task panels must share one intrinsic frame');
assert.match(css,/\[data-user-editor-pane\]\[data-active=false\][\s\S]*?visibility:hidden;pointer-events:none;max-height:100%;overflow:clip/,
 'Inactive task content must reserve geometry without extending the active scroll range');
assert.match(css,/#dlg\.user-modal \.user-canvas-foot\s*\{[\s\S]*?flex:0 0 auto[\s\S]*?position:relative[\s\S]*?border-top:0[\s\S]*?background:transparent[\s\S]*?box-shadow:none/,
 'User details footer must remain metadata, not render as a second material strip');
assert.match(css,/html\[data-motion=off\] #dlg\.user-modal[\s\S]*?transition:none!important/,
 'User details premium motion must respect the animation setting');
console.log('Workspace dialogs: host shell and taller horizontal user details OK');
