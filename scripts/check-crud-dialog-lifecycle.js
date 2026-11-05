#!/usr/bin/env node
'use strict';
const {panelStyles}=require('./ci/frontend-source.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const css=panelStyles();
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
const codes=app.match(/const COUNTRY_CODES='([^']+)'\.split\(' '\);/)?.[1]?.split(' ');
assert.equal(codes?.length,250,'249 ISO codes plus Kosovo XK');
assert.equal(new Set(codes).size,250,'country codes must be unique');
for(const code of ['GB','GY','XK','KP','TW','PS','VA'])assert(codes.includes(code),'Missing country '+code);
assert.match(app,/GB:'UK United Kingdom Англия England/,'UK / England must resolve to GB');
assert.match(app,/XK:'Kosovo Косово/,'Kosovo must be searchable');
assert.match(app,/const matches=countrySearchMatches\(q\)/,'picker must use unified country index');
assert.doesNotMatch(app,/matches\.slice\(0,100\)/,'country list must not be truncated');
// Execute the real country index (without DOM) and cover every entry, not just UK.
const indexStart=app.indexOf('const COUNTRY_CODES=');
const indexEnd=app.indexOf('// Country flags are bundled',indexStart);
assert(indexStart>=0&&indexEnd>indexStart,'country index must be available');
const {COUNTRIES,countrySearchMatches,countryRomanize,normalizeCountrySearch}=new Function(
 'panelIsEnglish',app.slice(indexStart,indexEnd)+
 '\\nreturn {COUNTRIES,countrySearchMatches,countryRomanize,normalizeCountrySearch};'
)(()=>false);
assert.equal(COUNTRIES.length,250,'all ISO-2 countries and Kosovo must be available');
assert.equal(countrySearchMatches('').length,250,'all countries must be browseable without filtering');
assert.equal(new Set(COUNTRIES.map(c=>c.iso3)).size,250,'ISO-3 codes must be unique');
for(const country of COUNTRIES){
 for(const query of [country.code,country.iso3]){
  assert.equal(countrySearchMatches(query)[0]?.code,country.code,'exact code must rank first: '+query);
 }
 for(const query of [country.name,country.enName,countryRomanize(country.name)]){
  assert(countrySearchMatches(query).some(c=>c.code===country.code),'country must match localized or romanized name: '+query);
 }
}
for(const [query,code] of Object.entries({
 UK:'GB',England:'GB',GBR:'GB',USA:'US',America:'US',UAE:'AE',Deutschland:'DE',
 Germaniya:'DE',Rossiya:'RU',Holland:'NL',Kosova:'XK',Czechia:'CZ',
 'Czech Republic':'CZ','Cote d Ivoire':'CI','Ivory Coast':'CI',
 'East Timor':'TL','South Korea':'KR',España:'ES',
 'Великобритания':'GB','Англия':'GB','Косово':'XK','Германия':'DE','США':'US'
}))assert.equal(countrySearchMatches(query)[0]?.code,code,'common alias must rank first: '+query);
assert.equal(normalizeCountrySearch('CÔTE—D’IVOIRE'),normalizeCountrySearch('Cote d Ivoire'),
 'search must ignore accent, case and punctuation differences');
console.log('Country index: 250 entries × RU/EN/transliteration/ISO-2/ISO-3 + common aliases: PASS');
console.log('CRUD dialog lifecycle (create/edit/renew/squad), submit dedupe, and local SVG country flags: OK');
