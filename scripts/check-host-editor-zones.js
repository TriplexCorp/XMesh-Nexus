#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
new Function(app); // Catch invalid JavaScript before shipping any layout changes.
const start=app.indexOf('function hostEditorMarkup(o,e){');
const end=app.indexOf('\nfunction entForm(',start);
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
const finalCss=css.slice(css.lastIndexOf('/* Host editor v5.'));
assert(finalCss.length>2000,'Missing canonical layout stylesheet');
assert(finalCss.includes('grid-template-areas:"primary overrides preview"'),
 'All three zones must occupy one grid row');
const desktopCss=finalCss.split('@media(max-width:1260px)')[0];
assert(!desktopCss.includes('"overrides overrides"'),'No separate overrides row on desktop');
assert(finalCss.includes('position:static!important'),
 'Bottom buttons must not cover the settings');
assert(finalCss.includes('@media(max-width:760px)'),
 'Keep accessible small-screen fallback');
console.log('Host editor: three horizontal zones, all inputs, actions and safe footer OK');
