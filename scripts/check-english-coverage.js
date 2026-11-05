#!/usr/bin/env node
'use strict';
/* Audits statically quoted Cyrillic interface copy. Dynamic strings that carry
 * runtime counts are owned by core/i18n-consistency.js and are checked below.
 * Missing translations fail CI; no existing-debt baseline is allowed. */
const fs=require('node:fs');
const {frontendAsset}=require('./ci/frontend-source.cjs');
const assert=require('node:assert/strict');
const src=fs.readFileSync('frontend/js/core/i18n.js','utf8');
const consistency=fs.readFileSync('frontend/js/core/i18n-consistency.js','utf8');
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
 for(const m of source.matchAll(/(['"])([^'"\\\r\n]{2,240})\1/g)){
  const value=m[2].trim();
  if(!/[А-Яа-яЁё]/.test(value)||/[<>{}\\]/.test(value))continue;
  if(value.includes(').toLocaleLowerCase()')||value.includes('.replace('))continue;
  if(/^(?:https?:|\/|#|\.|[a-z][-a-z0-9_]*:)/i.test(value))continue;
  found.add(value);
 }
 return [...found].sort((a,b)=>a.localeCompare(b,'ru'));
};
const missing={};let examined=0,translated=0;
for(const file of files){
 const values=take(fs.readFileSync(frontendAsset(file),'utf8'));
 examined+=values.length;
 const outstanding=values.filter(v=>{
  const result=api.translate(v);
  if(result!==v&&!/[А-Яа-яЁё]/.test(result)){translated++;return false}
  return true;
 });
 if(outstanding.length)missing[file]=outstanding;
}
const outstandingCount=Object.values(missing).reduce((n,items)=>n+items.length,0);
console.log('English static copy audit: '+examined+' candidates, '+translated+' translated, '+outstandingCount+' missing.');
if(outstandingCount){for(const [file,items]of Object.entries(missing))for(const text of items)console.error(file+': '+text);process.exitCode=1}
const strict=[
 'Перенос строк','Сохранить профиль · Ctrl+S','Новый JSON',
 'Открыть новый JSON-редактор','Публичные подключения',
 'Удалить публичное подключение?','Выберите inbound',
 'Сгенерировать новый privateKey (ротация)',
 'Сохранить действующий privateKey (рекомендуется)'
];
for(const ru of strict)assert(!/[А-Яа-яЁё]/.test(api.translate(ru))&&api.translate(ru)!==ru,'Critical XRAY STUDIO translation missing: '+ru);

/* Visible late-render copy must never hide inside the legacy debt baseline.
 * These phrases are intentionally hard-gated because they appear in primary
 * navigation, user analytics and statistics surfaces. */
const lateCritical={
 'Балансировщики':'Balancers',
 'Подробная статистика':'Detailed statistics',
 'История трафика':'Traffic history',
 'Inbound и ноды':'Inbounds & nodes',
 'Измерения':'Measurements',
 'По серверам':'By server',
 'Персональный трафик Xray':'Per-user Xray traffic',
 'Скорость сети нод':'Node network throughput',
 'Top-10: подтверждённый трафик за период':'Top 10 verified traffic'
};
for(const [ru,en] of Object.entries(lateCritical)){
 const escaped=ru.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const enEsc=en.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 assert.match(consistency,new RegExp("['\"]"+escaped+"['\"]\\s*:\\s*['\"]"+enEsc+"['\"]"),
   'Late-render English consistency mapping missing: '+ru);
}
assert.match(consistency,/MutationObserver/,'Late-render i18n must observe async UI surfaces');
assert.match(consistency,/characterData:true/,'Late-render i18n must cover live status text updates');
if(!process.exitCode)console.log('English translation coverage regression: PASS; late-render critical copy is hard-gated.');
