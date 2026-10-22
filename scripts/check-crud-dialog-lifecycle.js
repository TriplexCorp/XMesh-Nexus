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

const countryStart=app.indexOf('const NORTH_KOREA_FLAG='),countryEnd=app.indexOf('\n',app.indexOf('const flagView=',countryStart));
assert(countryStart!==-1&&countryEnd>countryStart,'Missing DPRK SVG renderer');
const source=app.slice(countryStart,countryEnd);
const flagView=new Function('COUNTRIES','esc',source+'\nreturn flagView;')(
  [{code:'KP',name:'Северная Корея',flag:'🇰🇵'}],
  x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;')
);
const html=flagView('🇰🇵');
assert.match(html,/<svg[^>]+viewBox="0 0 32 20"/);
assert.match(html,/north-korea-flag/);
assert.doesNotMatch(html,/flagcdn/, 'DPRK flag must not rely on external images');
assert.match(css,/\.north-korea-flag svg/);
assert.match(app,/c\.code==='KP'\?' Северная Корея КНДР North Korea DPRK'/);
assert.match(app,/\bKP\b/, 'ISO KP must remain in supported countries');
console.log('CRUD dialog lifecycle (create/edit/renew/squad), submit dedupe, and offline DPRK flag: OK');
