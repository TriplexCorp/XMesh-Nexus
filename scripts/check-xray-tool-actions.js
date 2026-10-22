'use strict';
/* Regression tests for the JSON editor tool handlers. No browser or Xray daemon needed. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const source=fs.readFileSync('xray-studio-tools.js','utf8');
const sample=()=>({
 log:{loglevel:'warning'},
 inbounds:[{
   tag:'vless-main',listen:'0.0.0.0',port:443,protocol:'vless',
   settings:{users:[],decryption:'none'},
   streamSettings:{
     network:'xhttp',security:'reality',xhttpSettings:{path:'/xhttp',mode:'auto'},
     realitySettings:{
       show:false,target:'www.microsoft.com:443',serverNames:['www.microsoft.com'],
       privateKey:'existing-valid-key',shortIds:['admin','0123456789abcdef']
     }
   }
 }],
 outbounds:[{tag:'direct',protocol:'freedom'}],routing:{domainStrategy:'AsIs',rules:[]}
});

function harness(documentValue,{confirmValue=true,realityKeys}={}){
 const calls=[],listeners={},confirmCalls=[],clipboard=[];
 const area={
   value:JSON.stringify(documentValue,null,2),selectionStart:0,selectionEnd:0,
   focus(){},setSelectionRange(){},
   addEventListener(name,fn){(listeners[name]??=[]).push(fn)},
   dispatchEvent(e){for(const fn of listeners[e.type]||[])fn(e)}
 };
 const status={textContent:''};
 const host={
   innerHTML:'',click:null,
   querySelector(q){return q==='[data-tool-status]'?status:null},
   addEventListener(type,fn){if(type==='click')this.click=fn}
 };
 const root={querySelector(q){
   if(q==='[data-xm="manual"]')return area;
   if(q==='[data-xm-tools]')return host;
   return null;
 }};
 const win={};
 const environment={
   window:win,
   crypto:webcrypto,
   navigator:{clipboard:{async writeText(x){clipboard.push(x)}}},
   prompt:(question,fallback)=>fallback??null,
   confirm:question=>{confirmCalls.push(question);return confirmValue},
   Event:class Event{constructor(type){this.type=type}}
 };
 vm.runInNewContext(source,environment,{filename:'xray-studio-tools.js'});
 win.XMeshJsonTools.setup(root,{
   toast:text=>calls.push(text),
   realityKeys:realityKeys||async()=>({privateKey:'generated-private',publicKey:'generated-public'})
 });
 return {
   area,host,status,calls,confirmCalls,clipboard,
   run(tool){host.click({target:{closest:()=>({dataset:{tool}})}})},
   doc(){return JSON.parse(area.value)}
 };
}
const ids=d=>d.inbounds[0].streamSettings.realitySettings.shortIds;
const validShortId=x=>/^(?:[0-9a-f]{2}){0,8}$/.test(x);
const tick=async()=>{for(let n=0;n<12;n++)await Promise.resolve()};

async function run(){
 const initial=harness(sample());
 assert.equal((initial.host.innerHTML.match(/data-tool="/g)||[]).length,6,'only six useful actions are visible');
 assert.deepEqual(['reality','shortid','xhttp','dns','routing','inbound'].map(x=>initial.host.innerHTML.includes('data-tool="'+x+'"')),[true,true,true,true,true,true]);

 const repair=harness(sample());
 repair.run('shortid');
 assert.equal(ids(repair.doc()).length,2,'damaged ID is repaired without adding redundant third ID');
 assert.ok(ids(repair.doc()).every(validShortId),'all resulting IDs are valid hex');
 assert.equal(ids(repair.doc())[1],'0123456789abcdef','existing valid ID retained');
 assert.equal(repair.confirmCalls.length,1,'unsafe migration requires consent');
 assert.equal(repair.doc().inbounds[0].settings.users.length,0,'unrelated inbound settings unchanged');

 const cancel=harness(sample(),{confirmValue:false});
 const old=cancel.area.value;
 cancel.run('shortid');
 assert.equal(cancel.area.value,old,'cancel preserves the byte-for-byte document');
 assert.ok(!cancel.calls.some(v=>/обновлен|добавлен|настроен/i.test(v)),'no false success toast');

 const duplicates=sample();duplicates.inbounds[0].streamSettings.realitySettings.shortIds=['aabb','aabb'];
 const dupe=harness(duplicates);dupe.run('shortid');
 assert.equal(ids(dupe.doc())[0],'aabb');
 assert.equal(new Set(ids(dupe.doc())).size,2,'duplicate shortId repaired');

 const noReality=sample();noReality.inbounds[0].streamSettings.security='none';
 const blocked=harness(noReality);const blockedBefore=blocked.area.value;
 blocked.run('shortid');
 assert.equal(blocked.area.value,blockedBefore,'tool does not silently enable Reality');
 assert.ok(blocked.calls.some(v=>v.includes('REALITY')),'actionable failure message');

 const dns=harness(sample());dns.run('dns');
 assert.ok(dns.doc().dns,'DNS tool inserts DNS');
 assert.deepEqual(ids(dns.doc()),ids(sample()),'DNS must not touch shortIds');
 const dnsOnce=dns.area.value;dns.run('dns');
 assert.equal(dns.area.value,dnsOnce,'DNS repeat is no-op');

 const routing=harness(sample());routing.run('routing');
 assert.deepEqual(ids(routing.doc()),ids(sample()),'routing must not touch shortIds');

 const xhttp=harness(sample());xhttp.run('xhttp');
 assert.deepEqual(ids(xhttp.doc()),ids(sample()),'xhttp must not touch shortIds');

 const inbound=harness(sample());inbound.run('inbound');
 assert.equal(inbound.doc().inbounds.length,2);
 assert.deepEqual(inbound.doc().inbounds[1].settings,{users:[],decryption:'none'},'new VLESS uses users, not clients');

 const generated=harness(noReality);
 generated.run('reality');await tick();
 const reality=generated.doc().inbounds[0].streamSettings;
 assert.equal(reality.security,'reality');
 assert.equal(reality.realitySettings.target,'www.microsoft.com:443');
 assert.deepEqual(reality.realitySettings.serverNames,['www.microsoft.com']);
 assert.equal(reality.realitySettings.privateKey,'generated-private');
 assert.equal(reality.realitySettings.shortIds.length,1);
 assert.ok(validShortId(reality.realitySettings.shortIds[0]),'reality setup generates valid Short ID');
 assert.ok(generated.clipboard.includes('generated-public'),'public key copied');

 const failed=harness(noReality,{realityKeys:async()=>{throw Error('generation failed')}});
 failed.run('reality');await tick();
 assert.equal(failed.doc().inbounds[0].streamSettings.security,'none','failed key generation does not mutate document');
 assert.ok(!failed.calls.some(v=>/Reality настроен/.test(v)),'failed action cannot report success');

 const invalid=harness(sample());invalid.area.value='{invalid';
 const invalidBefore=invalid.area.value;invalid.run('shortid');
 assert.equal(invalid.area.value,invalidBefore,'malformed JSON cannot be changed by tool');
 assert.ok(!invalid.calls.some(v=>/обновлен|добавлен/i.test(v)),'malformed JSON cannot produce success');

 console.log('XRAY STUDIO JSON tools: 14 regression scenarios passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1});
