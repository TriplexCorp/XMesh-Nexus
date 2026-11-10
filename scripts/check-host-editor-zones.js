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
 'securityLayer','tlsVerification','xhttpMode','useSniAsHost','sni','host','path','fp','publicKey','shortId','spiderX','alpn','serviceName','clientEncryption','clientXhttpSettings','clientHeaders','clientTlsSettings','clientMasqueSettings'];
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
 'host-assignment-panel',
 'host-advanced host-advanced-panel',
 'host-client-group',
 'host-client-group',
 'host-editor-side'
],'Each task must preserve its semantic editing sections.');
for(const key of names){
 const occurrences=html.split('name="'+key+'"').length-1;
 assert.equal(occurrences,1,'Input '+key+' must occur exactly once');
}
for(const action of ['data-host-node-preset','data-host-count','data-host-resolved',
  'data-host-runtime','data-host-clear-overrides']){
 assert(html.includes(action),'Missing working host editor action '+action);
}
assert(!html.includes('<details class="host-advanced'),'Existing transport and security overrides must remain visible');
assert.equal((html.match(/class="host-client-group"/g)||[]).length,2,'Client fields must have Transport and Security groupings');
assert.match(html,/class="host-advanced-groups"/,'Both groups must remain inside the same Host form');
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


// Host tasks deliberately replace the old three-column desktop presentation.
assert.equal((html.match(/role="tab" /g)||[]).length,3,'Hosts need exactly three task tabs');
for(const key of ['connection','client','preview']){
 assert(html.includes('aria-controls="host-panel-'+key+'"'),'Tab must identify its panel');
 assert(html.includes('aria-labelledby="host-tab-'+key+'"'),'Panel must identify its tab');
}
assert.equal((html.match(/aria-selected="true"/g)||[]).length,1,'Only one task may be selected');
assert.equal((html.match(/ aria-hidden="true" inert/g)||[]).length,2,'Inactive tasks must be inaccessible');
assert.match(feature,/form.addEventListener\('invalid'/,'Native errors must reveal their task before focus');
assert.match(feature,/ArrowLeft.*ArrowRight.*Home.*End/,'Tabs need standard keyboard navigation');
assert.match(app,/bindHostEditor\(form\)/,'The real form must install task interactions');
assert.match(css,/\.host-editor-panes\s*\{[^}]*display:grid[^}]*overflow:auto/,'The task frame must own scrolling');
assert.match(css,/\.host-resolved\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'Preview must fill the canvas rather than leaving an empty right sidebar');
assert.match(css,/\.host-advanced-groups\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'Client fields must use two readable desktop groups');
assert.match(css,/\[data-host-editor-pane\]\s*\{[^}]*grid-area:1\/1/,'All tasks must share one intrinsic frame');
assert.match(css,/\[data-host-editor-pane\]\[data-active=false\][^}]*visibility:hidden;pointer-events:none;max-height:100%;overflow:clip/,'Inactive tasks must reserve geometry without extending the scroll area');
assert.match(css,/#dlg\.host-wide\s*\{[^}]*--dialog-width:80rem/,'Hosts must use a readable dialog width');
assert.match(css,/#dlg\.host-wide>form\.box\s*\{[\s\S]*?grid-template-rows:auto minmax\(0,1fr\) auto auto[\s\S]*?overflow:hidden/,'The shell must reserve a shrinkable body and visible footer');
assert.match(css,/#dlg\.host-wide>form\.box>\.host-editor-layout\s*\{[^}]*overflow:hidden/,'The tab rail must stay outside the scrolling task frame');
assert.match(css,/#dlg\.host-wide>form\.box>\.act\s*\{[^}]*position:static[^}]*z-index:auto/,'Footer must not cover fields');
assert.match(css,/@media \(max-width:900px\)[\s\S]*?\.host-connection-workspace,\.host-preview-workspace\{grid-template-columns:minmax\(0,1fr\)/,'Narrow task workspaces must stack');
assert.match(css,/@media \(max-width:560px\)[\s\S]*?\.host-connect-fields,\.host-public-fields,\.host-advanced-fields\{grid-template-columns:minmax\(0,1fr\)/,'Phone fields must keep usable widths');

// User Details keeps a stable tab frame while adapting to viewport and zoom.
assert.match(css,/dialog#dlg\.user-modal\s*\{[\s\S]*?--dialog-width:clamp\(64rem,54vw,100rem\)[\s\S]*?height:min\(clamp\(38\.5rem,64dvh,49rem\),calc\(100dvh - 2rem\)\)[\s\S]*?max-block-size:calc\(100dvh - 2rem\)/,
 'User Details must use the viewport-responsive width and bounded desktop height');
assert.match(css,/dialog#dlg\.user-modal\s*\{[\s\S]*?opacity \.34s[\s\S]*?transform \.50s[\s\S]*?overlay \.50s allow-discrete/,
 'User Details must retain its accessible premium open/close motion');
assert.match(css,/dialog#dlg\.user-modal>\.user-canvas\s*\{[\s\S]*?block-size:100%[\s\S]*?max-block-size:100%[\s\S]*?display:grid[\s\S]*?grid-template-rows:auto auto auto minmax\(0,1fr\) auto auto auto[\s\S]*?border:0[\s\S]*?background:transparent[\s\S]*?box-shadow:none/,
 'User Details canvas must fill its fixed frame and keep the footer outside the scroller');
assert.match(css,/#dlg\.user-modal \.user-canvas-grid\s*\{[\s\S]*?min-block-size:0[\s\S]*?height:100%[\s\S]*?overflow-y:auto/,
 'User Details shared body must be the only scroll owner');
assert.match(css,/#dlg\.user-modal \.user-canvas-grid\s*\{[\s\S]*?grid-template-columns:minmax\(0,1fr\);grid-template-rows:minmax\(0,1fr\)/,
 'User task panels must share one intrinsic frame');
assert.match(css,/\[data-user-editor-pane\]\[data-active=false\][\s\S]*?visibility:hidden;pointer-events:none;max-height:100%;overflow:clip/,
 'Inactive task content must reserve geometry without extending the active scroll range');
assert.match(css,/#dlg\.user-modal \.user-canvas-foot\s*\{[\s\S]*?flex:0 0 auto[\s\S]*?position:relative[\s\S]*?border-top:0[\s\S]*?background:transparent[\s\S]*?box-shadow:none/,
 'User details footer must remain metadata, not render as a second material strip');
assert.match(css,/html\[data-motion=off\] #dlg\.user-modal[\s\S]*?transition:none!important/,
 'User details premium motion must respect the animation setting');
const userDetailsCss=fs.readFileSync('frontend/styles/features/users/user-details.css','utf8');
const canonicalDialogsCss=fs.readFileSync('frontend/styles/system/workspace-dialog-contract.css','utf8');
assert.ok(canonicalDialogsCss.includes('zoom:1.12;') &&
 canonicalDialogsCss.includes('height:min(clamp(38.5rem,64dvh,49rem),82dvh);') &&
 canonicalDialogsCss.includes('block-size:min(clamp(38.5rem,64dvh,49rem),82dvh);'),
 'Wide User Details must proportionally scale typography and keep a viewport-safe height');
assert.ok(canonicalDialogsCss.includes('@media(min-width:1100px) and (max-width:2199px)') &&
 canonicalDialogsCss.includes('height:min(clamp(36rem,70dvh,47rem),calc(100dvh - 2rem));'),
 'Normal desktop workspaces may use the taller form, without making 768px tablet dialogs oversized');
assert.ok(canonicalDialogsCss.includes('@media(min-width:2800px) and (max-height:1300px)') &&
 canonicalDialogsCss.includes('--dialog-width:78rem;') &&
 canonicalDialogsCss.includes('zoom:1.28;') &&
 canonicalDialogsCss.includes('height:min(clamp(38.5rem,70dvh,49rem),82dvh);'),
 'Short wide zoomed-out screens must get a bounded and legible workspace');
assert.ok(userDetailsCss.includes('.user-settings-cards>.user-connection-card'),
 'Connection card must have explicit two-column desktop ownership');
assert.match(userDetailsCss,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
 'Connection fields must form compact readable columns');
assert.match(userDetailsCss,/\.user-settings-cards>\.user-note-card\{[\s\S]*?grid-column:1\/-1;[\s\S]*?grid-row:2;[\s\S]*?align-self:start;/,
 'Compact Note must span both columns below the form cards');
assert.match(userDetailsCss,/\.user-settings-cards>\.user-connection-card\{[\s\S]*?grid-column:2;grid-row:1;/,
 'Connection must occupy the first row without stretching Basic');
assert.match(userDetailsCss,/grid-template-rows:max-content max-content;[\s\S]*?align-items:start;/,
 'Settings cards must size to their content rather than creating empty equal-height slabs');
assert.match(userDetailsCss,/\.user-editor-actions \.user-save-button\{\s*order:1;\s*margin-inline-start:auto;/,
 'Save must sit at the trailing edge of the user footer');
assert.match(userDetailsCss,/\.user-editor-actions \.user-edit-dirty\{\s*order:0;\s*margin-inline-start:0;\s*text-align:start;/,
 'Unsaved-change status must remain at the leading edge of the user footer');
console.log('Workspace dialogs: accessible Host tasks, stable frame and User details OK');
