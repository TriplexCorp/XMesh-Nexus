'use strict';
/* Regression tests for the JSON editor tool handlers. No browser or Xray daemon needed. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const source=fs.readFileSync('xray-studio-tools.js','utf8');
const studio=fs.readFileSync('xray-studio-v4.js','utf8');
// Regression: the more-specific global dialog selector used to squeeze
// FinalMask's multi-column catalog into a 30rem popup.
const studioCss=fs.readFileSync('xray-studio-v4.css','utf8');
assert.ok(studioCss.includes('dialog.xm-studio-modal.xm-studio-modal--cards{'),
 'FinalMask must scope its width rule to the native dialog');
assert.ok(studioCss.includes('width:min(84rem,calc(100vw - 2rem))!important'),
 'FinalMask width must win against the global dialog constraint');
assert.ok(studioCss.includes('grid-template-columns:repeat(4,minmax(0,1fr))'),
 'Wide FinalMask catalog must use four columns');

// Credential managers mistook constructor password + Short ID fields for panel login.
assert.ok(!studio.includes("field('private'"),'Never render a Reality privateKey password input in the constructor');
assert.ok(!studio.includes("field('shortid'"),'Never expose a Short ID text field beside password inputs');
assert.ok(studio.includes('validRealityX25519Key'),'Studio must reject non-X25519 secrets before saving');
assert.ok(studio.includes('const reality=x.streamSettings?.realitySettings;'),'Dormant Reality payloads must be checked as well');
const PREVIOUS_KEY='A'.repeat(43),NEW_PRIVATE='B'.repeat(43),NEW_PUBLIC='C'.repeat(43);
const sample=()=>({
 log:{loglevel:'warning'},
 inbounds:[{
   tag:'vless-main',listen:'0.0.0.0',port:443,protocol:'vless',
   settings:{users:[],decryption:'none'},
   streamSettings:{
     network:'xhttp',security:'reality',xhttpSettings:{path:'/xhttp',mode:'auto'},
     realitySettings:{
       show:false,target:'www.microsoft.com:443',serverNames:['www.microsoft.com'],
       privateKey:PREVIOUS_KEY,shortIds:['admin','0123456789abcdef']
     }
   }
 }],
 outbounds:[{tag:'direct',protocol:'freedom'}],routing:{domainStrategy:'AsIs',rules:[]}
});

function harness(documentValue,{confirmValue=true,confirmHandler,requestValues,realityKeys,selectorUI=false}={}){
 const calls=[],listeners={},confirmCalls=[],clipboard=[],requests=[];
 const area={
   value:JSON.stringify(documentValue,null,2),selectionStart:0,selectionEnd:0,
   focus(){},setSelectionRange(){},
   addEventListener(name,fn){(listeners[name]??=[]).push(fn)},
   dispatchEvent(e){for(const fn of listeners[e.type]||[])fn(e)}
 };
 const status={textContent:''},issue={hidden:true},issueMessage={textContent:''};
 const inboundSelector={value:'0'};
 const host={
   innerHTML:'',click:null,change:null,
   querySelector(q){
    if(q==='[data-tool-inbound]')return selectorUI&&this.innerHTML.includes('data-tool-inbound')?inboundSelector:null;
    return ({'[data-tool-status]':status,'[data-tool-issue]':issue,'[data-tool-issue-message]':issueMessage})[q]||null;
   },
   addEventListener(type,fn){if(type==='click')this.click=fn;if(type==='change')this.change=fn}
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
   requests.push(spec);
   if(!confirmValue)return null;
   return Object.fromEntries((spec.fields||[]).map(field=>[field.name,String(requestValues?.[field.name]??field.value??'')]));
  }
 };
 vm.runInNewContext(source,environment,{filename:'xray-studio-tools.js'});
 const toolHandle=win.XMeshJsonTools.setup(root,{
   toast:text=>calls.push(text),
   realityKeys:realityKeys||(async()=>({privateKey:NEW_PRIVATE,publicKey:NEW_PUBLIC}))
 });
 return {
   area,host,status,issue,issueMessage,calls,confirmCalls,clipboard,requests,
   refresh(){toolHandle.refresh()},
   selectInbound(index){
    inboundSelector.value=String(index);
    host.change({target:{value:String(index),matches:q=>q==='[data-tool-inbound]'}});
   },
   run(tool){return host.click({target:{closest:()=>({dataset:{tool}})}})},
   doc(){return JSON.parse(area.value)}
 };
}
const ids=d=>d.inbounds[0].streamSettings.realitySettings.shortIds;
const validShortId=x=>/^(?:[0-9a-f]{2}){0,8}$/.test(x);
const tick=async()=>{for(let n=0;n<12;n++)await Promise.resolve()};

async function run(){
 const initial=harness(sample());
 assert.equal((initial.host.innerHTML.match(/class="sv-toolitem /g)||[]).length,9,'VLESS XHTTP Reality now includes FinalMask creation');
 assert.equal(initial.issue.hidden,false,'broken ID visible as contextual warning');
 assert.deepEqual(['reality','shortid','vlessens','vision','xhttp','dns','routing','outbounds','inbound'].map(x=>initial.host.innerHTML.includes('data-tool="'+x+'"')),[true,true,true,false,true,true,true,true,true]);

 const shadowsocksReality=sample();
 shadowsocksReality.inbounds=[{tag:'ss-reality',port:443,protocol:'shadowsocks',settings:{network:'tcp,udp',method:'2022-blake3-aes-256-gcm',password:'local-secret'},streamSettings:{network:'xhttp',security:'reality',xhttpSettings:{path:'/proxy',mode:'auto'},realitySettings:{target:'front.example.org:443',serverNames:['front.example.org'],privateKey:PREVIOUS_KEY,shortIds:['0a0b']}}}];
 const ssUI=harness(shadowsocksReality);
 for(const tool of ['reality','shortid','xhttp','protocol-config'])
  assert.ok(ssUI.host.innerHTML.includes('data-tool="'+tool+'"'),'Shadowsocks XHTTP REALITY exposes '+tool);
 for(const tool of ['vision','vlessens','hysteria-config'])
  assert.ok(!ssUI.host.innerHTML.includes('data-tool="'+tool+'"'),'Shadowsocks cannot show VLESS/Hysteria tool '+tool);
 const ssEdited=harness(shadowsocksReality,{requestValues:{target:'alternate.example.org:443',serverNames:'alternate.example.org'}});
 await ssEdited.run('reality');
 assert.equal(ssEdited.doc().inbounds[0].streamSettings.realitySettings.target,'alternate.example.org:443','REALITY dialog also works on Shadowsocks');
 assert.equal(ssEdited.doc().inbounds[0].settings.password,'local-secret','REALITY edit preserves Shadowsocks credentials');

 const hysteria=sample();
 hysteria.inbounds=[{tag:'hysteria-main',port:443,protocol:'hysteria',
  settings:{version:2,users:[]},
  streamSettings:{network:'hysteria',security:'tls',hysteriaSettings:{version:2},tlsSettings:{certificates:[]}}}];
 const hysteriaUI=harness(hysteria);
 for(const id of ['hysteria-config','tls','protocol-config','dns','routing','outbounds','inbound'])
  assert.ok(hysteriaUI.host.innerHTML.includes('data-tool="'+id+'"'),'Hysteria tools need '+id);
 for(const id of ['reality','shortid','vision','vlessens','xhttp'])
  assert.ok(!hysteriaUI.host.innerHTML.includes('data-tool="'+id+'"'),'No irrelevant tool '+id+' for Hysteria');
 assert.ok(hysteriaUI.host.innerHTML.includes('Hysteria2 · HYSTERIA · TLS'),'Active protocol context displayed');
 const hEdit=harness(hysteria,{requestValues:{json:'{"version":2,"customOption":"test"}'}});
 await hEdit.run('hysteria-config');
 assert.equal(hEdit.doc().inbounds[0].streamSettings.hysteriaSettings.customOption,'test');
 assert.deepEqual(hEdit.doc().inbounds[0].streamSettings.tlsSettings,{certificates:[]},'Hysteria editor must preserve TLS');
 // FinalMask editor must persist server and client projections separately.
 const withMask=JSON.parse(JSON.stringify(hysteria));
 withMask.inbounds[0].streamSettings.finalmask={udp:[{type:'salamander',settings:{password:'shared'}}]};
 const paired=harness(withMask,{requestValues:{
  action:'advanced',
  json:JSON.stringify({udp:[{type:'salamander',settings:{password:'shared-2'}}]}),
  client:JSON.stringify({udp:[{type:'noise',settings:{noise:[{rand:'10-20'}]}}]})
 }});
 assert.ok(paired.host.innerHTML.includes('data-tool="finalmask"'),'FinalMask tool must appear');
 await paired.run('finalmask');
 const pairedInbound=paired.doc().inbounds[0];
 assert.equal(pairedInbound.streamSettings.finalmask.udp[0].settings.password,'shared-2');
 assert.equal(pairedInbound.xmesh.clientFinalmask.udp[0].type,'noise');
 assert.equal(pairedInbound.streamSettings.finalmask.udp[0].type,'salamander',
  'client mask must not overwrite server mask');
 // Guided presets generate a fresh cryptographic secret; the client inherits shared masks.
 const autoUDP=harness(hysteria);
 await autoUDP.run('finalmask');
 const autoLayer=autoUDP.doc().inbounds[0].streamSettings.finalmask.udp[0];
 assert.equal(autoLayer.type,'salamander');
 assert.match(autoLayer.settings.password,/^[a-f0-9]{64}$/,'Generate a 256-bit random shared secret');
 assert.equal(autoUDP.doc().inbounds[0].xmesh?.clientFinalmask,undefined,'Shared masks inherit automatically');
 const autoTCP=harness(sample(),{requestValues:{action:'sudoku'}});
 await autoTCP.run('finalmask');
 assert.equal(autoTCP.doc().inbounds[0].streamSettings.finalmask.tcp[0].type,'sudoku');
 assert.match(autoTCP.doc().inbounds[0].streamSettings.finalmask.tcp[0].settings.password,/^[a-f0-9]{64}$/);
 const fragmentPreset=harness(sample(),{requestValues:{action:'fragment'}});
 await fragmentPreset.run('finalmask');
 assert.equal(fragmentPreset.doc().inbounds[0].xmesh.clientFinalmask.tcp[0].type,'fragment');
 assert.equal(fragmentPreset.doc().inbounds[0].streamSettings.finalmask,undefined,'Fragment stays client-only');
 const noisePreset=harness(hysteria,{requestValues:{action:'noise'}});
 await noisePreset.run('finalmask');
 assert.equal(noisePreset.doc().inbounds[0].xmesh.clientFinalmask.udp[0].type,'noise');
 assert.equal(noisePreset.doc().inbounds[0].streamSettings.finalmask,undefined,'Noise stays client-only');

 // Full catalog includes all supported protocol layers; Gecko is Salamander packetSize,
 // not a separate Xray layer type. Unsupported transports must not offer XDNS.
 const tcpCatalog=autoTCP.requests[0].fields[0].options.map(opt=>opt.value);
 for(const id of ['sudoku','tcp-header','fragment','tcp-xmc','tcp-filter','advanced','clear'])
  assert.ok(tcpCatalog.includes(id),'TCP catalog must expose '+id);
 const udpCatalog=autoUDP.requests[0].fields[0].options.map(opt=>opt.value);
 for(const id of ['salamander','udp-sudoku','udp-header','udp-mkcp','noise','udp-hop','udp-xicmp','udp-realm','udp-filter','quic-params'])
  assert.ok(udpCatalog.includes(id),'UDP catalog must expose '+id);
 assert.equal(autoUDP.requests[0].fields[0].options.find(o=>o.value==='udp-xdns').disabled,true,
  'XDNS should be visible but disabled for Hysteria/QUIC');
 assert.equal(autoTCP.requests[0].fields[0].options.find(o=>o.value==='udp-sudoku').disabled,true,
  'UDP choices should be visible but disabled for TCP-only inbound');
 const udpSudoku=harness(hysteria,{requestValues:{action:'udp-sudoku'}});
 await udpSudoku.run('finalmask');
 assert.equal(udpSudoku.doc().inbounds[0].streamSettings.finalmask.udp[0].type,'sudoku');
 assert.match(udpSudoku.doc().inbounds[0].streamSettings.finalmask.udp[0].settings.password,/^[0-9a-f]{64}$/);
 const tcpHeader=harness(sample(),{requestValues:{action:'tcp-header'}});
 await tcpHeader.run('finalmask');
 assert.equal(tcpHeader.doc().inbounds[0].streamSettings.finalmask.tcp[0].type,'header-custom');
 assert.ok(Array.isArray(tcpHeader.doc().inbounds[0].streamSettings.finalmask.tcp[0].settings.clients[0]));
 const udpHeader=harness(hysteria,{requestValues:{action:'udp-header'}});
 await udpHeader.run('finalmask');
 assert.equal(udpHeader.doc().inbounds[0].streamSettings.finalmask.udp[0].settings.client[0].type,'hex');
 const mkcpMask=harness(hysteria,{requestValues:{action:'udp-mkcp'}});
 await mkcpMask.run('finalmask');
 assert.equal(mkcpMask.doc().inbounds[0].streamSettings.finalmask.udp[0].type,'mkcp-legacy');
 const serverFilter=harness(sample(),{requestValues:{
  action:'tcp-filter',settings:JSON.stringify({allowedSourceIPs:['192.0.2.0/24'],blockedSourceIPs:[]})
 }});
 await serverFilter.run('finalmask');
 assert.equal(serverFilter.doc().inbounds[0].streamSettings.finalmask.tcp[0].type,'filter');
 assert.equal(serverFilter.doc().inbounds[0].xmesh?.clientFinalmask,undefined,'Never project inbound filter');
 const minecraft=harness(sample(),{requestValues:{action:'tcp-xmc',settings:'{"password":"client-password"}'}});
 await minecraft.run('finalmask');
 assert.equal(minecraft.doc().inbounds[0].xmesh.clientFinalmask.tcp[0].type,'xmc');
 const xicmp=harness(hysteria,{requestValues:{action:'udp-xicmp'}});
 await xicmp.run('finalmask');
 assert.equal(xicmp.doc().inbounds[0].xmesh.clientFinalmask.udp[0].type,'xicmp');
 const realm=harness(hysteria,{requestValues:{action:'udp-realm',settings:'{"url":"realm://token@example.org/id"}'}});
 await realm.run('finalmask');
 assert.equal(realm.doc().inbounds[0].xmesh.clientFinalmask.udp[0].type,'realm');
 const hopping=harness(hysteria,{requestValues:{
  action:'udp-hop',settings:'{"mode":"perconnremote","remotePorts":"20000-50000","interval":"5-10"}'
 }});
 await hopping.run('finalmask');
 assert.equal(hopping.doc().inbounds[0].xmesh.clientFinalmask.udp.at(-1).type,'udphop');
 const quicParams=harness(hysteria,{requestValues:{action:'quic-params'}});
 await quicParams.run('finalmask');
 assert.equal(quicParams.doc().inbounds[0].xmesh.clientFinalmask.quicParams.congestion,'bbr');
 const mkcpTransport=JSON.parse(JSON.stringify(hysteria));
 mkcpTransport.inbounds[0].streamSettings.network='mkcp';
 const dnsTunnel=harness(mkcpTransport,{requestValues:{
  action:'udp-xdns',settings:'{"domains":[{"names":["t.example.com"],"types":[16]}],"resolvers":[{"addrs":["udp://1.1.1.1:53"]}]}'
 }});
 await dnsTunnel.run('finalmask');
 assert.equal(dnsTunnel.requests[0].fields[0].options.find(opt=>opt.value==='udp-xdns').disabled,false,
  'mKCP enables XDNS');
 assert.equal(dnsTunnel.doc().inbounds[0].xmesh.clientFinalmask.udp[0].type,'xdns');
 // Adding client-only masks must preserve shared symmetric server layers in client override.
 const layeredNoise=harness(withMask,{requestValues:{action:'noise'}});
 await layeredNoise.run('finalmask');
 assert.deepEqual(layeredNoise.doc().inbounds[0].xmesh.clientFinalmask.udp.map(v=>v.type),
  ['salamander','noise'],'Client mask must retain required Salamander');
 const layeredHop=harness(withMask,{requestValues:{
  action:'udp-hop',settings:'{"mode":"perconnremote","remotePorts":"20000-50000"}'
 }});
 await layeredHop.run('finalmask');
 assert.deepEqual(layeredHop.doc().inbounds[0].xmesh.clientFinalmask.udp.map(v=>v.type),
  ['salamander','udphop'],'UDP hop must follow inherited Salamander');
 const maskedQUIC=harness(withMask,{requestValues:{action:'quic-params'}});
 await maskedQUIC.run('finalmask');
 assert.deepEqual(maskedQUIC.doc().inbounds[0].xmesh.clientFinalmask.udp.map(v=>v.type),
  ['salamander'],'QUIC params cannot drop symmetric layers');
 assert.ok(maskedQUIC.doc().inbounds[0].xmesh.clientFinalmask.quicParams);
 const invalidHop=harness(hysteria,{requestValues:{action:'udp-hop'}});
 await invalidHop.run('finalmask');
 const hopValidation=invalidHop.requests[1].fields[0].validate;
 assert.ok(hopValidation('{"mode":"invalid","remotePorts":"100-200"}'),'Reject invalid UDP hop mode');

 const reset=harness(withMask,{requestValues:{action:'clear'}});
 await reset.run('finalmask');
 assert.equal(reset.doc().inbounds[0].streamSettings.finalmask,undefined,'Reset deletes server mask');
 const explicitClient=JSON.parse(JSON.stringify(withMask));
 explicitClient.inbounds[0].xmesh={clientFinalmask:{udp:[{type:'noise',settings:{noise:[{rand:'10-20'}]}}]}};
 const preserve=harness(explicitClient,{requestValues:{action:'salamander'}});
 await preserve.run('finalmask');
 assert.deepEqual(preserve.doc(),explicitClient,'Guided mode refuses to overwrite a custom client mask');
 const tlsEdit=harness(hysteria,{requestValues:{json:'{"certificates":[],"minVersion":"1.3"}'}});
 await tlsEdit.run('tls');
 assert.equal(tlsEdit.doc().inbounds[0].streamSettings.tlsSettings.minVersion,'1.3');
 assert.deepEqual(tlsEdit.doc().inbounds[0].streamSettings.hysteriaSettings,{version:2});
 const protocolEdit=harness(hysteria,{requestValues:{json:'{"version":2,"users":[],"customProtocolSetting":42}'}});
 await protocolEdit.run('protocol-config');
 assert.equal(protocolEdit.doc().inbounds[0].settings.customProtocolSetting,42);
 const newTLS=JSON.parse(JSON.stringify(hysteria));newTLS.inbounds[0].streamSettings.security='none';
 const enableTLS=harness(newTLS,{requestValues:{json:'{"certificates":[]}'}});
 await enableTLS.run('tls');
 assert.equal(enableTLS.doc().inbounds[0].streamSettings.security,'tls','Hysteria TLS setup enables security without changing protocol');
 const importedTemplate=harness(sample());importedTemplate.area.value=JSON.stringify(hysteria,null,2);
 importedTemplate.refresh();
 assert.ok(importedTemplate.host.innerHTML.includes('data-tool="hysteria-config"'),'Programmatic template loading refreshes tools without synthetic typing');

 const changed=harness(hysteria);
 changed.area.value=JSON.stringify(sample(),null,2);changed.area.dispatchEvent({type:'input'});
 assert.ok(changed.host.innerHTML.includes('data-tool="reality"'),'VLESS tools appear on template switch');
 assert.ok(!changed.host.innerHTML.includes('data-tool="hysteria-config"'),'Hysteria tools disappear');
 changed.area.value='{broken-json';changed.area.dispatchEvent({type:'input'});
 assert.ok(changed.host.innerHTML.includes('Инструменты временно недоступны'),'Malformed JSON hides stale actions');
 changed.area.value=JSON.stringify(hysteria,null,2);changed.area.dispatchEvent({type:'input'});
 assert.ok(changed.host.innerHTML.includes('data-tool="hysteria-config"'),'Fixing JSON restores Hysteria tools');

 // Multi-inbound profiles expose a real selector; action target must follow its choice.
 const mixed=JSON.parse(JSON.stringify(hysteria));
 const vless=sample().inbounds[0];
 vless.streamSettings.realitySettings.shortIds=['aabbccdd'];
 vless.settings.decryption='mlkem768x25519plus.native.testvalue';
 mixed.inbounds.push(vless);
 const multiPalette=harness(mixed,{selectorUI:true});
 assert.ok(multiPalette.host.innerHTML.includes('data-tool-inbound'),'Multiple inbounds must expose a selector');
 assert.ok(multiPalette.host.innerHTML.includes('data-tool="hysteria-config"'),'First inbound controls visible');
 multiPalette.selectInbound(1);
 assert.ok(multiPalette.host.innerHTML.includes('data-tool="vision"'),'Selected VLESS controls visible');
 assert.ok(!multiPalette.host.innerHTML.includes('data-tool="hysteria-config"'),'Mixed profile does not mix protocol tool groups');
 await multiPalette.run('vision');
 assert.equal(multiPalette.doc().inbounds[1].settings.flow,'xtls-rprx-vision','Vision applied only to selected VLESS inbound');
 assert.deepEqual(multiPalette.doc().inbounds[0],hysteria.inbounds[0],'Other inbound is untouched');
 const escaped=harness({...hysteria,inbounds:[{...hysteria.inbounds[0],tag:'"><img src=x onerror=alert(1)>'}]});
 assert.ok(!escaped.host.innerHTML.includes('<img'),'Inbound tags are escaped before display in toolbar');

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
 assert.equal(stable.confirmCalls.length,0,'opening Reality never requests key rotation automatically');

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
 const noRotation=harness(preserveAndRepair,{requestValues:{shortIds:'aabbccdd, 0123456789abcdef'}});
 await noRotation.run('reality');await tick();
 assert.equal(noRotation.doc().inbounds[0].streamSettings.realitySettings.privateKey,PREVIOUS_KEY,'existing private key survives routine repairs');
 assert.ok(ids(noRotation.doc()).every(validShortId),'explicitly corrected Short IDs applied without key rotation');
 assert.ok(noRotation.calls.some(m=>m.includes('без изменения privateKey')),'visible confirmation of key preservation');

 let resolveDelayed;
 const delayedKeys=new Promise(resolve=>{resolveDelayed=resolve});
 const delayed=harness(noReality,{requestValues:{target:'cdn.example.org:443'},realityKeys:()=>delayedKeys});
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



 const canceledCreate=harness(sample(),{confirmValue:false});
 const beforeCreate=canceledCreate.area.value;
 await canceledCreate.run('inbound');
 assert.equal(canceledCreate.area.value,beforeCreate,'cancel new inbound never changes JSON');

 const vmessCreate=harness(sample(),{requestValues:{tag:'vmess-unique',protocol:'vmess',port:'445',transport:'ws'}});
 await vmessCreate.run('inbound');
 const vm=vmessCreate.doc().inbounds.at(-1);
 assert.equal(vm.tag,'vmess-unique','custom modal sets inbound tag');
 assert.equal(vm.protocol,'vmess','custom modal sets protocol');
 assert.equal(vm.listen,'127.0.0.1','new modal always uses safe listen address');
 assert.equal(vm.port,445,'modal port is numeric');
 assert.deepEqual(vm.settings,{users:[]},'VMess uses settings.users');
 assert.equal(vm.streamSettings.wsSettings.path,'/ws','transport-specific settings generated');

 const duplicateTag=harness(sample(),{requestValues:{tag:'vless-main'}});
 const priorTag=duplicateTag.area.value;
 await duplicateTag.run('inbound');
 assert.equal(duplicateTag.area.value,priorTag,'duplicate inbound tag is rejected without mutation');

 const generated=harness(noReality,{requestValues:{target:'cdn.example.org:443'}});
 await generated.run('reality');await tick();
 const reality=generated.doc().inbounds[0].streamSettings;
 assert.equal(reality.security,'reality');
 assert.equal(reality.realitySettings.target,'cdn.example.org:443','target must come from the user, never a hardcoded default');
 assert.deepEqual(reality.realitySettings.serverNames,['cdn.example.org'],'empty SNI field derives from selected target');
 assert.equal(reality.realitySettings.privateKey,NEW_PRIVATE);
 assert.equal(reality.realitySettings.shortIds.length,1);
 assert.ok(validShortId(reality.realitySettings.shortIds[0]),'reality setup generates valid Short ID');
 assert.ok(generated.clipboard.includes(NEW_PUBLIC),'public key copied');


 // A normal Reality click must never rekey or silently rewrite a healthy config.
 const unchanged=sample();
 unchanged.inbounds[0].streamSettings.realitySettings.shortIds=['aabbccdd'];
 const unchangedHarness=harness(unchanged,{realityKeys:async()=>{throw Error('unexpected key rotation')}});
 await unchangedHarness.run('reality');
 assert.equal(unchangedHarness.area.value,JSON.stringify(unchanged,null,2),'reviewing Reality without edits is a no-op');
 assert.equal(unchangedHarness.confirmCalls.length,0,'no extra confirmation dialog for routine settings');
 assert.equal(unchangedHarness.clipboard.length,0,'do not copy keys on a routine click');

 // Changing target and SNI must preserve a pre-existing key and advanced server fields.
 const custom=sample();
 const config=custom.inbounds[0].streamSettings.realitySettings;
 config.shortIds=['aabbccdd'];
 config.maxTimeDiff=60000;
 config.mldsa65Seed='untouched-secret';
 const edited=harness(custom,{requestValues:{target:'front.example.net:8443',serverNames:'front.example.net, alt.example.net',shortIds:'aabbccdd'}});
 await edited.run('reality');
 const changedReality=edited.doc().inbounds[0].streamSettings.realitySettings;
 assert.equal(changedReality.target,'front.example.net:8443');
 assert.deepEqual(changedReality.serverNames,['front.example.net','alt.example.net']);
 assert.equal(changedReality.privateKey,config.privateKey,'existing private key retained');
 assert.equal(changedReality.maxTimeDiff,60000,'advanced Reality settings preserved');
 assert.equal(changedReality.mldsa65Seed,'untouched-secret','PQ signature seed preserved');

 const deniedRotation=harness(custom,{
  requestValues:{keyMode:'rotate'},
  confirmHandler:title=>!title.includes('Заменить ключ REALITY'),
  realityKeys:async()=>{throw Error('rotation was not approved')}
 });
 const beforeDenied=deniedRotation.area.value;
 await deniedRotation.run('reality');
 assert.equal(deniedRotation.area.value,beforeDenied,'rejected key rotation never changes the config');
 assert.equal(deniedRotation.confirmCalls.length,1,'explicit rotation gets a second warning');

 const rotated=harness(custom,{requestValues:{keyMode:'rotate'}});
 await rotated.run('reality');
 assert.equal(rotated.doc().inbounds[0].streamSettings.realitySettings.privateKey,NEW_PRIVATE,'explicitly approved rotation generates new private key');
 assert.ok(rotated.clipboard.includes(NEW_PUBLIC),'new public key can be transferred to clients');

 const invalidShortIds=harness(sample());
 await invalidShortIds.run('reality');
 assert.ok(ids(invalidShortIds.doc()).every(validShortId),'invalid Short IDs are replaced only after explicit form submission');
 assert.ok(!ids(invalidShortIds.doc()).includes('admin'),'a username must never become a Reality Short ID');

 const invalidTarget=harness(noReality,{requestValues:{target:'not a domain'}});
 const beforeTarget=invalidTarget.area.value;
 await invalidTarget.run('reality');
 assert.equal(invalidTarget.area.value,beforeTarget,'invalid Reality target must not enter server JSON');
 assert.ok(invalidTarget.calls.some(x=>x.includes('Reality target')),'invalid target gets a clear error');

 const untouchedOther=sample();
 untouchedOther.inbounds[0].streamSettings.realitySettings.shortIds=['aabbccdd'];
 const second=JSON.parse(JSON.stringify(untouchedOther.inbounds[0]));
 second.tag='other-inbound';untouchedOther.inbounds.push(second);
 const multi=harness(untouchedOther,{requestValues:{index:'1',target:'second.example.org:443',serverNames:'second.example.org'}});
 await multi.run('reality');
 assert.equal(multi.doc().inbounds[0].streamSettings.realitySettings.target,'www.microsoft.com:443','unselected inbound must be unchanged');
 assert.equal(multi.doc().inbounds[1].streamSettings.realitySettings.target,'second.example.org:443');

 // Regression: browser login and password-manager token inserted into a dormant REALITY block.
 const poisoned=sample();const poison=poisoned.inbounds[0].streamSettings;
 poison.security='none';poison.realitySettings.shortIds=['Triplex'];
 poison.realitySettings.privateKey='a'.repeat(256);
 const poisonCancel=harness(poisoned,{confirmValue:false});
 const beforePoison=poisonCancel.area.value;
 await poisonCancel.run('reality');
 assert.equal(poisonCancel.area.value,beforePoison,'cancel never overwrites a suspected credential');
 const poisonFix=harness(poisoned);
 await poisonFix.run('reality');
 const recovered=poisonFix.doc().inbounds[0].streamSettings;
 assert.equal(recovered.security,'reality','confirmed recovery enables REALITY');
 assert.equal(recovered.realitySettings.privateKey,NEW_PRIVATE,'credential-like token is replaced with canonical X25519 key');
 assert.ok(recovered.realitySettings.shortIds.every(validShortId),'admin login is replaced by hex Short ID');
 assert.ok(!recovered.realitySettings.shortIds.includes('Triplex'),'admin login must not survive a repair');
 assert.equal(poisonFix.confirmCalls.length,1,'replacing an invalid existing secret needs confirmation');
 assert.ok(poisonFix.clipboard.includes(NEW_PUBLIC),'public key is exported after new generation');
 const brokenGenerator=harness(noReality,{requestValues:{target:'cdn.example.org:443'},realityKeys:async()=>({privateKey:'deadbeef',publicKey:'0'.repeat(43)})});
 const beforeGenerator=brokenGenerator.area.value;
 await brokenGenerator.run('reality');
 assert.equal(brokenGenerator.area.value,beforeGenerator,'generator output with wrong length is rejected');
 assert.ok(brokenGenerator.calls.some(v=>/base64url/.test(v)),'the user is told X25519 key requirements');

 const failed=harness(noReality,{requestValues:{target:'cdn.example.org:443'},realityKeys:async()=>{throw Error('generation failed')}});
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
