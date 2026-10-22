#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
new Function(app);

function section(start, end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert(a!==-1&&b>a,'Missing CRUD branch '+start);
  return app.slice(a,b);
}
function assertDialogLifecycle(name, source){
  assert.match(source,/e\.preventDefault\(\)/,name+': native method=dialog must not auto-close');
  assert.match(source,/await api\.(create|update|bulk)\(/,name+': save must await server response');
  assert.match(source,/dlg\.close\(\)/,name+': successfully saved dialog must close');
  assert.match(source,/catch\(error\)/,name+': failed save must keep dialog and show error');
  assert.match(source,/\.dataset\.saving/,name+': prevent duplicate submissions');
  assert.match(source,/finally\s*\{/,name+': restore controls after save attempt');
}
assertDialogLifecycle('entity creation/edit',section("else if(k=='ent')","else if(k=='bulk-renew')"));
assertDialogLifecycle('user edit',section("else if(k=='uedit')","else if(k=='ent')"));
assertDialogLifecycle('bulk squad assignment',section("else if(k=='bsq')","else if(k=='brand')"));
const creation=section("if(k=='user')","else if(k=='uedit')");
assert.match(creation,/f\.dataset\.creating/, 'user create guards repeat submission');
assert.match(creation,/dlg\.close\(\)/, 'user create closes its dialog');
const renewal=section("else if(k=='bulk-renew')","else if(k=='bsq')");
assert.match(renewal,/dlg\.close\(\)/, 'bulk renewal closes after completion');
assert.match(renewal,/catch\(error\)/, 'bulk renewal reports server errors');

const rendererStart=app.indexOf('const flagView=');
const rendererEnd=app.indexOf('\n};',rendererStart)+3;
assert(rendererStart!==-1 && rendererEnd>rendererStart, 'Missing local SVG flag renderer');
const flagView=new Function('COUNTRIES','esc',app.slice(rendererStart,rendererEnd)+'\nreturn flagView;')(
  [{code:'KP',name:'Северная Корея',flag:'🇰🇵'},{code:'DE',name:'Германия',flag:'🇩🇪'}],
  x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;')
);
for(const [flag,iso] of [['🇰🇵','kp'],['🇩🇪','de']]){
  const html=flagView(flag);
  assert(html.includes('/flags/'+iso+'.svg'),'Flag '+iso+' must be served locally');
  assert(!/flagcdn|https?:\/\//.test(html),'Flags must never depend on external CDN');
}
assert(!app.includes('flagcdn.com'),'No flag CDN URLs in UI');
assert.match(app,/c\.code==='KP'\?' Северная Корея КНДР North Korea DPRK'/);
console.log('CRUD dialog lifecycle (create/edit/renew/squad), submit dedupe, and local SVG country flags: OK');
