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
const names=['profileId','tag','nodes','disabled','remark','serverDescription','address','port','countryCode',
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
assert.equal(helpers.hostNodeCountryRemark({flag:'🇵🇱',name:'Польша'}),'🇵🇱 Польша','Subscription remark must include both flag and exact node name');
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
assert.equal(fields.remark.value,'🇳🇱 Нидерланды','Implicit autofill must include flag and node name in client remark');
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
 'host-editor-card host-primary-panel',
 'host-editor-card host-public-panel',
 'host-editor-card host-assignment-panel',
 'host-editor-card host-advanced host-advanced-panel',
 'host-editor-card host-health-panel',
 'host-editor-card host-editor-side'
],'All six semantic editing zones must be present together in a single page.');
for(const key of names){
 const occurrences=html.split('name="'+key+'"').length-1;
 assert.equal(occurrences,1,'Input '+key+' must occur exactly once');
}
for(const action of ['data-host-node-preset','data-host-count','data-host-resolved',
  'data-host-runtime','data-host-clear-overrides']){
 assert(html.includes(action),'Missing working host editor action '+action);
}
assert.equal((html.match(/class="host-advanced-fields"/g)||[]).length,1,
  'Client overrides must occupy a single compact two-column editor');
assert.match(html,/class="host-extra-settings"/,
  'Additional overrides must stay accessible in an inline disclosure');
assert.match(html,/class="host-client-settings"/,
  'Expert JSON metadata must remain reachable in an inline disclosure');
assert.match(feature, /\['remark','address','port','countryCode','serverDescription'\]/, 'Optional description follows the public endpoint without breaking field pairs');
assert.match(html,/name="serverDescription"/,'The Host editor must expose the optional description field');
assert(!html.includes('host-description-hint')&&!html.includes('Описание сервера показывается'),'Host form must not show redundant description hints');

// Bootstrap refreshes replace arrays. An existing feature instance must see
// the new collections and must leave their objects untouched during rendering.
DB.profiles=[{id:2,name:'Replacement profile'}];
DB.nodes=[{id:6,name:'Replacement node',addr:'new.example.net',profileId:2}];
const snapshot=JSON.stringify(DB);
const updated=editor({profileId:2},fspec);
assert(updated.includes('Replacement node'),'The factory must not retain stale node arrays');
assert(updated.includes('name="profileId" value="2"'),'The factory must not retain stale profiles');
assert.equal(JSON.stringify(DB),snapshot,'Rendering must not mutate application collections');


// One page is the canonical editor, not a wizard. Keep all fields once and
// preserve all existing adapters, keyboard validation and copying actions.
assert.match(html,/data-host-single-page/,
  'Host editor must expose the one-page layout');
assert.equal((html.match(/role="tab"/g)||[]).length,0,
  'Host creation must not hide fields behind any task tabs');
assert(!html.includes(' inert') && !html.includes('data-active="false"'),
  'Core host controls must remain immediately interactive; decorative icons may be aria-hidden');
assert.match(html,/class="f host-icon-field"/,'Host controls include semantic, decorative SVG glyph slots');
assert((html.match(/host-control-glyph/g)||[]).length>=12,
 'Host editor must not silently lose its SVG icon slots');
assert.match(app,/class="host-heading-emblem"/,'Host title restores the concept emblem');
assert.match(app,/Создать хост/,'New Host has an explicit create action');
assert.match(feature,/form.addEventListener\('invalid'/,
  'Native validation must reveal controls inside optional disclosures');
assert.match(app,/bindHostEditor\(form\)/,
  'The real Host form must bind single-page interactions');
assert.match(html,/class="host-editor-column host-editor-column-primary"/,
  'Connection and public endpoint must stack independently');
assert.match(html,/class="host-editor-column host-editor-column-middle"/,
  'Assignment and client overrides must stack independently');
assert.match(html,/class="host-editor-column host-editor-column-preview"/,
  'Status and live preview must stack independently');
assert.equal((html.match(/class="host-editor-column host-editor-column-/g)||[]).length,3,
  'Single-page editor must have exactly three independent columns');
assert.match(css,/#dlg\.host-wide \.host-editor-column\{[\s\S]*?grid-auto-rows:max-content/,
  'Card heights must be independent; avoid empty shared grid rows');
assert.match(css,/#dlg\.host-wide \.host-editor-layout\{[\s\S]*?grid-template-areas:none/,
  'The active editor must not retain the legacy shared-row geometry');
assert.match(css,/@media\(max-width:760px\)\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)/,
  'Mobile layout must stack the three groups without horizontal overflow');
assert.doesNotMatch(html,/host-editor-main-column|host-editor-primary-column|host-editor-client-column|host-editor-sidebar/,
  'Obsolete Host layout wrapper layers must not return');
assert.doesNotMatch(css,/display\s*:\s*contents/,
  'Design-system contract: Host editor must never rely on display:contents');
assert.match(css,/#dlg\.host-wide \.host-icon-field>\.host-control-glyph\{/,
  'Field-level SVG glyphs must share the control grid row');
assert.match(css,/grid-column:1;grid-row:2;[\s\S]*?align-self:center;justify-self:start/,
  'Field icon position must be based on the control, never a fixed top offset');
assert.equal((html.match(/class="host-section-icon"/g)||[]).length,6,
  'Every semantic Host section heading must have an identical SVG icon frame');
assert.match(css,/\.host-resolved\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)/,
  'Right-side preview uses single-column rows instead of a wide empty canvas');
assert.match(css,/#dlg\.host-wide\s*\{[^}]*--dialog-width:86rem/,
  'Host retains a bounded readable desktop dialog width');
assert.match(css,/#dlg\.host-wide>form\.box\s*\{[\s\S]*?grid-template-rows:auto minmax\(0,1fr\) auto auto[\s\S]*?overflow:hidden/,
  'Shell retains a visible footer outside the central scroller');
assert.match(css,/#dlg\.host-wide>form\.box>\.host-editor-layout\s*\{[^}]*overflow-y:auto/,
  'Only the content surface may scroll on short or mobile viewports');
assert.match(css,/#dlg\.host-wide>form\.box>\.act\s*\{[^}]*position:static[^}]*z-index:auto/,
  'Save actions must remain fixed in the modal footer');
assert.match(css,/@media\(max-width:1050px\)[\s\S]*?\.host-editor-layout\{grid-template-columns:minmax\(0,1fr\)/,
  'Narrow Host editor stacks columns without horizontal overflow');
assert.match(css,/@media\(max-width:520px\)[\s\S]*?\.host-connect-fields,\.host-public-fields,\.host-advanced-fields,\.host-extra-fields\{grid-template-columns:minmax\(0,1fr\)/,
  'Phone fields must stay readable');
// User Details uses a wider viewport-bounded dialog with adaptive height.
assert.match(css,/dialog#dlg\.user-modal\s*\{[\s\S]*?--dialog-width:clamp\(72rem,72vw,112rem\)[\s\S]*?height:min\(clamp\(38\.5rem,64dvh,49rem\),calc\(100dvh - 2rem\)\)[\s\S]*?max-block-size:calc\(100dvh - 2rem\)/,
 'User Details must widen without overflowing a desktop viewport');
assert.match(css,/@media\s*\(min-width:1100px\)[\s\S]*?dialog#dlg\.user-modal:has\([\s\S]*?data-user-editor-tab="traffic"[\s\S]*?76dvh/,
 'Traffic tab must gain usable vertical space');
assert.match(css,/@media\s*\(min-width:1100px\)[\s\S]*?data-user-editor-tab="routing"[\s\S]*?58dvh/,
 'Routing and devices tabs should remain compact');

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
 canonicalDialogsCss.includes('--dialog-width:84rem;') &&
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
