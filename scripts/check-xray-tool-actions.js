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

function harness(documentValue,{confirmValue=true,confirmHandler,realityKeys}={}){
 const calls=[],listeners={},confirmCalls=[],clipboard=[];
 const area={
   value:JSON.stringify(documentValue,null,2),selectionStart:0,selectionEnd:0,
   focus(){},setSelectionRange(){},
   addEventListener(name,fn){(listeners[name]??=[]).push(fn)},
   dispatchEvent(e){for(const fn of listeners[e.type]||[])fn(e)}
 };
 const status={textContent:''},issue={hidden:true},issueMessage={textContent:''};
 const host={
   innerHTML:'',click:null,
   querySelector(q){return ({'[data-tool-status]':status,'[data-tool-issue]':issue,'[data-tool-issue-message]':issueMessage})[q]||null},
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
   Event:class Event{constructor(type){this.type=type}}
 };
 win.XMeshStudioDialogs={
  async confirm(spec){confirmCalls.push(spec.title||spec.description||'confirm');return confirmHandler?confirmHandler(spec.title||spec.description||''):confirmValue},
  async request(spec){
   if(!confirmValue)return null;
   return Object.fromEntries((spec.fields||[]).map(field=>[field.name,String(field.value??'')]));
  }
 };
 vm.runInNewContext(source,environment,{filename:'xray-studio-tools.js'});
 win.XMeshJsonTools.setup(root,{
   toast:text=>calls.push(text),
   realityKeys:realityKeys||(async()=>({privateKey:'generated-private',publicKey:'generated-public'}))
 });
 return {
   area,host,status,issue,issueMessage,calls,confirmCalls,clipboard,
   run(tool){return host.click({target:{closest:()=>({dataset:{tool}})}})},
   doc(){return JSON.parse(area.value)}
 };
}
const ids=d=>d.inbounds[0].streamSettings.realitySettings.shortIds;
const validShortId=x=>/^(?:[0-9a-f]{2}){0,8}$/.test(x);
const tick=async()=>{for(let n=0;n<12;n++)await Promise.resolve()};

async function run(){
 const initial=harness(sample());
 assert.equal((initial.host.innerHTML.match(/class="sv-toolitem /g)||[]).length,6,'only six main actions are visible');
 assert.equal(initial.issue.hidden,false,'broken ID visible as contextual warning');
 assert.deepEqual(['reality','shortid','xhttp','dns','routing','inbound'].map(x=>initial.host.innerHTML.includes('data-tool="'+x+'"')),[true,true,true,true,true,true]);

 const repair=harness(sample());
 await repair.run('shortid');
 assert.equal(ids(repair.doc()).length,2,'damaged ID is repaired without adding redundant third ID');
 assert.ok(ids(repair.doc()).every(validShortId),'all resulting IDs are valid hex');
 assert.equal(ids(repair.doc())[1],'0123456789abcdef','existing valid ID retained');
 assert.equal(repair.confirmCalls.length,1,'unsafe migration requires consent');
 assert.equal(repair.doc().inbounds[0].settings.users.length,0,'unrelated inbound settings unchanged');

 const oneClick=harness(sample());
 await oneClick.run('repair-shortids');
 assert.equal(ids(oneClick.doc()).length,2);
 assert.ok(ids(oneClick.doc()).every(validShortId));
 assert.equal(oneClick.issue.hidden,true,'repair clears inline warning immediately');
 assert.equal(oneClick.confirmCalls.length,1,'one explicit confirmation for repair');

 const oneClickNo=harness(sample(),{confirmValue:false});
 const oneClickBefore=oneClickNo.area.value;
 await oneClickNo.run('repair-shortids');
 assert.equal(oneClickNo.area.value,oneClickBefore,'cancel one-click repair preserves JSON');

 const clean=sample();clean.inbounds[0].streamSettings.realitySettings.shortIds=['aabbccdd'];
 const stable=harness(clean,{confirmValue:false,realityKeys:async()=>{throw Error('must not generate')}});
 await stable.run('reality');await tick();
 assert.equal(stable.area.value,JSON.stringify(clean,null,2),'existing valid Reality is idempotent');
 assert.ok(!stable.calls.some(v=>v.includes('Reality настроен')),'no false success on an idempotent action');
 assert.equal(stable.confirmCalls.length,1,'rotation requires explicit choice');

 const keyRecovery=sample();keyRecovery.inbounds[0].streamSettings.realitySettings.shortIds=['admin'];
 const preserved=harness(keyRecovery,{confirmValue:false});
 const protectedKey=preserved.doc().inbounds[0].streamSettings.realitySettings.privateKey;
 await preserved.run('reality');await tick();
 assert.equal(preserved.doc().inbounds[0].streamSettings.realitySettings.privateKey,protectedKey,'refusing rekey never rotates existing key');


 const many=sample(),another=JSON.parse(JSON.stringify(sample().inbounds[0]));
 another.tag='second';another.streamSettings.realitySettings.shortIds=['admin','eedd','eedd'];
 many.inbounds.push(another);
 const multiRepair=harness(many);await multiRepair.run('repair-shortids');
 assert.ok(multiRepair.doc().inbounds.every(ib=>ib.streamSettings.realitySettings.shortIds.every(validShortId)),'repair covers all Reality inbounds');
 assert.equal(new Set(multiRepair.doc().inbounds[1].streamSettings.realitySettings.shortIds).size,3,'duplicates repaired');
 assert.equal(multiRepair.doc().inbounds[1].streamSettings.realitySettings.shortIds[1],'eedd','valid ID retained');

 const validDoc=sample();validDoc.inbounds[0].streamSettings.realitySettings.shortIds=['aabbccdd'];
 const validRepair=harness(validDoc),pristine=validRepair.area.value;
 await validRepair.run('repair-shortids');
 assert.equal(validRepair.area.value,pristine,'repair of healthy IDs is a no-op');
 assert.equal(validRepair.issue.hidden,true,'healthy IDs show no warning');

 const cancel=harness(sample(),{confirmValue:false});
 const old=cancel.area.value;
 await cancel.run('shortid');
 assert.equal(cancel.area.value,old,'cancel preserves the byte-for-byte document');
 assert.ok(!cancel.calls.some(v=>/обновлен|добавлен|настроен/i.test(v)),'no false success toast');

 const duplicates=sample();duplicates.inbounds[0].streamSettings.realitySettings.shortIds=['aabb','aabb'];
 const dupe=harness(duplicates);await dupe.run('shortid');
 assert.equal(ids(dupe.doc())[0],'aabb');
 assert.equal(new Set(ids(dupe.doc())).size,2,'duplicate shortId repaired');

 const noReality=sample();noReality.inbounds[0].streamSettings.security='none';delete noReality.inbounds[0].streamSettings.realitySettings;
 const preserveAndRepair=sample();
 const noRotation=harness(preserveAndRepair,{confirmHandler:question=>!question.includes('Ротация ключей')});
 await noRotation.run('reality');await tick();
 assert.equal(noRotation.doc().inbounds[0].streamSettings.realitySettings.privateKey,'existing-valid-key','existing private key survives routine repairs');
 assert.ok(ids(noRotation.doc()).every(validShortId),'invalid Short ID repaired without key rotation');
 assert.ok(noRotation.calls.some(m=>m.includes('privateKey сохранён')),'visible confirmation of key preservation');

 let resolveDelayed;
 const delayedKeys=new Promise(resolve=>{resolveDelayed=resolve});
 const delayed=harness(noReality,{realityKeys:()=>delayedKeys});
 const pendingReality=delayed.run('reality');
 await tick();
 delayed.area.value=JSON.stringify({...noReality,log:{loglevel:'debug'}},null,2);
 resolveDelayed({privateKey:'late-private',publicKey:'late-public'});
 await pendingReality;
 assert.equal(delayed.doc().inbounds[0].streamSettings.security,'none','stale asynchronous Reality response cannot overwrite new JSON');
 assert.ok(!delayed.calls.some(m=>m.includes('Reality настроен')),'no false success after stale async response');

 const blocked=harness(noReality);const blockedBefore=blocked.area.value;
 await blocked.run('shortid');
 assert.equal(blocked.area.value,blockedBefore,'tool does not silently enable Reality');
 assert.ok(blocked.calls.some(v=>/reality/i.test(v)),'actionable failure message');

 const dns=harness(sample());await dns.run('dns');
 assert.ok(dns.doc().dns,'DNS tool inserts DNS');
 assert.deepEqual(ids(dns.doc()),ids(sample()),'DNS must not touch shortIds');
 const dnsOnce=dns.area.value;await dns.run('dns');
 assert.equal(dns.area.value,dnsOnce,'DNS repeat is no-op');

 const routing=harness(sample());await routing.run('routing');
 assert.deepEqual(ids(routing.doc()),ids(sample()),'routing must not touch shortIds');

 const xhttp=harness(sample());await xhttp.run('xhttp');
 assert.deepEqual(ids(xhttp.doc()),ids(sample()),'xhttp must not touch shortIds');

 const inbound=harness(sample());await inbound.run('inbound');
 assert.equal(inbound.doc().inbounds.length,2);
 assert.deepEqual(inbound.doc().inbounds[1].settings,{users:[],decryption:'none'},'new VLESS uses users, not clients');
 assert.equal(inbound.doc().inbounds[1].listen,'127.0.0.1','unencrypted inbound draft must not be exposed publicly');


 const generated=harness(noReality);
 await generated.run('reality');await tick();
 const reality=generated.doc().inbounds[0].streamSettings;
 assert.equal(reality.security,'reality');
 assert.equal(reality.realitySettings.target,'www.microsoft.com:443');
 assert.deepEqual(reality.realitySettings.serverNames,['www.microsoft.com']);
 assert.equal(reality.realitySettings.privateKey,'generated-private');
 assert.equal(reality.realitySettings.shortIds.length,1);
 assert.ok(validShortId(reality.realitySettings.shortIds[0]),'reality setup generates valid Short ID');
 assert.ok(generated.clipboard.includes('generated-public'),'public key copied');

 const failed=harness(noReality,{realityKeys:async()=>{throw Error('generation failed')}});
 await failed.run('reality');await tick();
 assert.equal(failed.doc().inbounds[0].streamSettings.security,'none','failed key generation does not mutate document');
 assert.ok(!failed.calls.some(v=>/Reality настроен/.test(v)),'failed action cannot report success');

 const invalid=harness(sample());invalid.area.value='{invalid';
 const invalidBefore=invalid.area.value;await invalid.run('shortid');
 assert.equal(invalid.area.value,invalidBefore,'malformed JSON cannot be changed by tool');
 assert.ok(!invalid.calls.some(v=>/обновлен|добавлен/i.test(v)),'malformed JSON cannot produce success');

 console.log('XRAY STUDIO JSON tools: contextual repair, key preservation and regression cases passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1});
