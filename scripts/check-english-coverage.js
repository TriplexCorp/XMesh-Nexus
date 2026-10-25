#!/usr/bin/env node
'use strict';
/* Audits statically quoted Cyrillic interface copy. This is not a full parser:
 * dynamic templates and runtime/server data require browser-level language QA.
 * Existing misses are tracked as explicit debt; newly untranslated copy fails CI.
 */
const fs=require('node:fs');
const assert=require('node:assert/strict');
const src=fs.readFileSync('i18n.js','utf8');
const doc={readyState:'loading',addEventListener(){},documentElement:{lang:'ru'}};
const win={};
new Function('window','localStorage','document',src+';return window.XMeshI18n;')(win,{getItem(){return'en'},setItem(){}},doc);
const api=win.XMeshI18n;
const files=[
 'xray-studio-v4.js','xray-studio-tools.js','xray-studio-hosts.js',
 'xray-studio-dialogs.js','xray-studio-composer.js','app.js',
 'security-ui.js','node-routing.js','client-routing.js','subscription-studio.js'
];
const take=source=>{
 const found=new Set();
 // Extract complete simple quoted literals only. Skip HTML templates, source code,
 // computed strings, interpolations and technical identifiers.
 for(const m of source.matchAll(/(['"])([^'"\\\r\n]{2,240})\1/g)){
  const value=m[2].trim();
  if(!/[А-Яа-яЁё]/.test(value)||/[<>{}\\]/.test(value))continue;
  // Never treat a fragment of a JavaScript expression as user-visible copy.
  if(value.includes(').toLocaleLowerCase()')||value.includes('.replace('))continue;
  if(/^(?:https?:|\/|#|\.|[a-z][-a-z0-9_]*:)/i.test(value))continue;
  found.add(value);
 }
 return [...found].sort((a,b)=>a.localeCompare(b,'ru'));
};
const missing={};let examined=0,translated=0;
for(const file of files){
 const values=take(fs.readFileSync(file,'utf8'));
 examined+=values.length;
 const outstanding=values.filter(v=>{
  const result=api.translate(v);
  if(result!==v&&!/[А-Яа-яЁё]/.test(result)){translated++;return false}
  return true;
 });
 if(outstanding.length)missing[file]=outstanding;
}
const baseline=JSON.parse(fs.readFileSync('scripts/english-coverage-baseline.json','utf8'));
const newMissing=[];
for(const [file,items] of Object.entries(missing)){
 const existing=new Set(baseline[file]||[]);
 for(const value of items)if(!existing.has(value))newMissing.push(file+': '+value);
}
const resolved=[];
for(const [file,items] of Object.entries(baseline)){
 const current=new Set(missing[file]||[]);
 for(const value of items)if(!current.has(value))resolved.push(file+': '+value);
}
console.log('English static copy audit: '+examined+' candidates, '+translated+' translated, '+Object.values(missing).reduce((n,x)=>n+x.length,0)+' existing outstanding.');
if(resolved.length)console.log('Translation debt reduced by '+resolved.length+' phrases. Regenerate the baseline to record progress.');
if(newMissing.length){
 console.error('New untranslated English UI copy ('+newMissing.length+'):');
 for(const phrase of newMissing.slice(0,80))console.error('  '+phrase);
 if(newMissing.length>80)console.error('  ... +'+(newMissing.length-80)+' more');
 process.exitCode=1;
}
const strict=[
 'Перенос строк','Сохранить профиль · Ctrl+S','Новый JSON',
 'Открыть новый JSON-редактор','Публичные подключения',
 'Удалить публичное подключение?','Выберите inbound',
 'Сгенерировать новый privateKey (ротация)',
 'Сохранить действующий privateKey (рекомендуется)'
];
for(const ru of strict)assert(!/[А-Яа-яЁё]/.test(api.translate(ru))&&api.translate(ru)!==ru,'Critical XRAY STUDIO translation missing: '+ru);
if(!process.exitCode)console.log('English translation coverage regression: PASS; existing untranslated debt is tracked.');
