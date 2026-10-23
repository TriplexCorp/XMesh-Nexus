#!/usr/bin/env node
'use strict';
// Exercise the real bell handler independently of the Nodes page. Regression:
// runtime was declared locally in nodesP(), but used by a global click handler.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8');
const start=app.indexOf('const nodeNotificationTitle=');
const end=app.indexOf("$('#restart').onclick=",start);
assert(start>0&&end>start,'Notification button wiring must exist');
const source=app.slice(start,end);
assert(!source.includes('runtime.get('),'Bell handler cannot access nodesP-local runtime');
async function settle(){await new Promise(resolve=>setImmediate(resolve));}
function fixture({nodes=[],users=[],getStatus=async()=>({connected:true,xrayRunning:true,routerRunning:true})}={}){
 const content={innerHTML:''};
 const refresh={disabled:false,handler:null,addEventListener(event,handler){if(event==='click')this.handler=handler}};
 const workspace={isConnected:true,querySelector(selector){
   if(selector==='[data-notifications-content]')return content;
   if(selector==='[data-notifications-refresh]')return refresh;
   return null;
 }};
 const dlg={open:true,querySelector:()=>workspace,contains:el=>el===workspace,addEventListener(){}};
 const button={expanded:null,setAttribute(key,value){if(key==='aria-expanded')this.expanded=value}};
 const calls=[];
 const context={
  $:selector=>selector==='#bell'?button:null,
  dlg,DB:{nodes,users},DAY:864e5,Date,Intl,Number,String,Math,Promise,
  encodeURIComponent,
  modal:html=>calls.push(html),ic:()=>'<svg></svg>',
  flagView:(_,cls)=>'<img class="'+cls+'" src="/flags/nl.svg">',
  esc:s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
  backendRequest:getStatus,st:()=> 'ACTIVE',left:()=> '1 дн'
 };
 vm.runInNewContext(source,context,{timeout:2000});
 return {button,content,refresh,calls};
}
(async()=>{
 const node={id:21,name:'Нидерланды',hosting:'Cloud <VPS>',flag:'🇳🇱',disabled:false};
 let requests=[];
 const first=fixture({nodes:[node],getStatus:async path=>{
   requests.push(path);
   return {connected:true,xrayRunning:false,routerRunning:true};
 }});
 first.button.onclick();
 assert.equal(first.calls.length,1,'Dialog opens synchronously');
 assert.equal(first.button.expanded,'true');
 await settle();
 assert.deepEqual(requests,['/api/v1/nodes/21/runtime']);
 assert.match(first.content.innerHTML,/Xray остановлен/);
 assert.match(first.content.innerHTML,/Нидерланды/);
 assert.match(first.content.innerHTML,/Cloud &lt;VPS&gt;/);
 assert(!first.content.innerHTML.includes('Cloud <VPS>'),'Escape displayed node metadata');
 assert.equal(first.refresh.disabled,false);

 const failed=fixture({nodes:[node],getStatus:async()=>{throw Error('Connection failed')}});
 failed.button.onclick();await settle();
 assert.match(failed.content.innerHTML,/Не удалось получить состояние агента/);
 assert.doesNotMatch(failed.content.innerHTML,/Агент не отвечает/,'Do not claim outage on API failure');

 const empty=fixture();
 empty.button.onclick();await settle();
 assert.match(empty.content.innerHTML,/Новых уведомлений нет/);
 assert.equal(typeof empty.refresh.handler,'function','Refresh must be wired');
 empty.refresh.handler();await settle();
 assert.match(empty.content.innerHTML,/Новых уведомлений нет/);
 console.log('Notifications: bell opens on every page, fetches node runtime, handles offline/API errors and refresh: PASS');
})().catch(err=>{console.error(err);process.exitCode=1});
