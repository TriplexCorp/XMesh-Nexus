'use strict';

// XRAY STUDIO security policy, randomized generation helpers and XHTTP constructor.
// streamSettings.security is authoritative: TLS/REALITY/NONE are never inferred
// from protocol or transport. Advanced XHTTP settings are edited without touching
// transport security.
(()=>{
 let pending=null;
 const snapshots=new WeakMap();
 const rewriting=new WeakSet();
 const forceNextRandomization=new WeakSet();
 const URL_SAFE='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 const FRAGMENT_DEFAULT={packets:'tlshello',lengths:['3-5','6-8','10-20'],delays:['10-20'],maxSplit:'3-6'};
 const NOISE_DEFAULT={reset:'30-60',noise:[{rand:'8-32',delay:'10-20'}]};
 const TCP_HEADER_DEFAULT={clients:[[{type:'str',packet:'HELLO'}]],servers:[[{type:'str',packet:'WELCOME'}]]};
 const UDP_HEADER_DEFAULT={client:[{type:'hex',packet:'a1b2c3d4'}],server:[{type:'hex',packet:'d4c3b2a1'}]};
 const ADVANCED_XHTTP_KEYS=[
  'headers','xPaddingBytes','xPaddingObfsMode','xPaddingKey','xPaddingHeader','xPaddingPlacement','xPaddingMethod',
  'uplinkHTTPMethod','sessionIDPlacement','sessionIDKey','sessionIDTable','sessionIDLength','seqPlacement','seqKey',
  'uplinkDataPlacement','uplinkDataKey','uplinkChunkSize','noGRPCHeader','noSSEHeader','scMaxEachPostBytes',
  'scMinPostsIntervalMs','scMaxBufferedPosts','scStreamUpServerSecs','serverMaxHeaderBytes','xmux','downloadSettings','h2Params'
 ];
 const boolOptions=[{value:'false',label:'Нет'},{value:'true',label:'Да'}];
 const modeOptions=['auto','packet-up','stream-up','stream-one'].map(value=>({value,label:value}));
 const placementOptions=['path','cookie','header','query'].map(value=>({value,label:value}));
 const paddingPlacementOptions=['queryInHeader','header','cookie','query'].map(value=>({value,label:value}));
 const uplinkDataPlacementOptions=['auto','body','cookie','header'].map(value=>({value,label:value}));

 function studioRoot(node){return node?.closest?.('#xm-studio-v4')||null}
 function sourceOf(root){return root?.querySelector?.('[data-v="source"]')||root?.querySelector?.('[data-xm="manual"]')||null}
 function clone(value){return value==null?value:JSON.parse(JSON.stringify(value))}
 function sameJson(a,b){return JSON.stringify(a)===JSON.stringify(b)}
 function randomValues(view){
  const api=globalThis.crypto;
  if(!api?.getRandomValues)throw Error('Криптографический генератор браузера недоступен');
  return api.getRandomValues(view);
 }
 function randomInt(min,max){
  const lo=Math.ceil(min),hi=Math.floor(max);
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<lo)throw Error('Некорректный диапазон генератора');
  const span=hi-lo+1;
  if(span===1)return lo;
  const limit=Math.floor(0x100000000/span)*span;
  const value=new Uint32Array(1);
  do randomValues(value); while(value[0]>=limit);
  return lo+(value[0]%span);
 }
 function randomUrlSafe(length=64){
  const size=Math.max(1,Math.min(256,Number(length)||64));
  const bytes=randomValues(new Uint8Array(size+1));
  return Array.from(bytes.slice(0,size),b=>URL_SAFE[b&63]).join('');
 }
 function randomHex(bytes=8){return Array.from(randomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('')}
 function randomRange(startMin,startMax,widthMin,widthMax){const start=randomInt(startMin,startMax);return start+'-'+(start+randomInt(widthMin,widthMax))}
 function randomXhttpPath(){return '/'+randomUrlSafe(64)}
 function randomFragmentSettings(){return {packets:'tlshello',lengths:[randomRange(2,5,1,3),randomRange(6,10,2,5),randomRange(12,20,4,12)],delays:[randomRange(5,25,5,25)],maxSplit:randomRange(3,5,1,4)}}
 function randomNoiseSettings(){return {reset:randomRange(20,60,15,60),noise:[{rand:randomRange(8,24,8,40),delay:randomRange(5,20,5,25)}]}}
 function randomTcpHeaderSettings(){return {clients:[[{type:'str',packet:randomUrlSafe(randomInt(12,24))}]],servers:[[{type:'str',packet:randomUrlSafe(randomInt(12,24))}]]}}
 function randomUdpHeaderSettings(){return {client:[{type:'hex',packet:randomHex(randomInt(4,12))}],server:[{type:'hex',packet:randomHex(randomInt(4,12))}]}}
 function randomBrowserHeaders(kind='firefox'){
  if(kind==='minimal')return {'Accept':'*/*','Content-Type':'application/octet-stream'};
  if(kind==='chrome'){
   const major=randomInt(146,160);
   return {
    'Accept':'*/*','Accept-Encoding':'gzip, deflate, br','Accept-Language':'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control':'no-cache','Content-Type':'application/octet-stream','Pragma':'no-cache','Sec-Fetch-Dest':'empty',
    'Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-origin',
    'User-Agent':`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
   };
  }
  const major=randomInt(148,160);
  return {
   'Accept':'*/*','Accept-Encoding':'gzip, deflate, br','Accept-Language':'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
   'Cache-Control':'no-cache','Content-Type':'application/octet-stream','Pragma':'no-cache','Sec-Fetch-Dest':'empty',
   'Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-origin',
   'User-Agent':`Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`
  };
 }
 function randomXhttpAdvancedProfile(mode='stream-up',browser='firefox'){
  const paddingStart=randomInt(24,96),paddingEnd=randomInt(768,1536);
  const sidStart=randomInt(14,24),sidEnd=randomInt(40,64);
  const seqPlacement=['query','header','cookie'][randomInt(0,2)];
  const sessionPlacement=['cookie','query','header'][randomInt(0,2)];
  const paddingPlacement=['queryInHeader','header'][randomInt(0,1)];
  return {
   headers:randomBrowserHeaders(browser),
   xPaddingBytes:`${paddingStart}-${paddingEnd}`,
   xPaddingObfsMode:true,
   xPaddingKey:['x-token','request_token','cache_key'][randomInt(0,2)],
   xPaddingHeader:['X-Request-Token','X-Request-ID','X-Trace-ID'][randomInt(0,2)],
   xPaddingPlacement:paddingPlacement,
   xPaddingMethod:'tokenish',
   uplinkHTTPMethod:'POST',
   sessionIDPlacement:sessionPlacement,
   sessionIDKey:sessionPlacement==='header'?'X-Session':['session_id','sid','session'][randomInt(0,2)],
   sessionIDTable:'Base62',
   sessionIDLength:`${sidStart}-${sidEnd}`,
   seqPlacement,
   seqKey:seqPlacement==='header'?'X-Seq':['segment','seq','part'][randomInt(0,2)],
   uplinkDataPlacement:'auto',
   uplinkDataKey:'X-Data',
   noGRPCHeader:false,
   noSSEHeader:false,
   scMaxEachPostBytes:`${randomInt(420000,650000)}-${randomInt(850000,1200000)}`,
   scMinPostsIntervalMs:`${randomInt(8,20)}-${randomInt(35,70)}`,
   scMaxBufferedPosts:randomInt(24,48),
   scStreamUpServerSecs:`${randomInt(15,30)}-${randomInt(55,90)}`,
   xmux:{
    maxConcurrency:mode==='stream-one'?'1':`${randomInt(8,16)}-${randomInt(20,36)}`,
    maxConnections:0,
    cMaxReuseTimes:`${randomInt(40,72)}-${randomInt(96,160)}`,
    hMaxRequestTimes:`${randomInt(480,640)}-${randomInt(760,940)}`,
    hMaxReusableSecs:`${randomInt(1500,2100)}-${randomInt(2600,3600)}`,
    hKeepAlivePeriod:0
   }
  };
 }

 function desiredSecurity(inbound){
  const current=String(inbound?.streamSettings?.security||'none').toLowerCase();
  return {security:['tls','reality'].includes(current)?current:'none',reason:'explicit-security-selection'};
 }
 function normalizeInbound(inbound){
  if(!inbound||typeof inbound!=='object')return false;
  const stream=inbound.streamSettings??={};
  const before=String(stream.security||'none');
  const decision=desiredSecurity(inbound);
  stream.security=decision.security;
  if(decision.security==='tls'){
   if(!stream.tlsSettings||typeof stream.tlsSettings!=='object'||Array.isArray(stream.tlsSettings))stream.tlsSettings={certificates:[]};
   if(!Array.isArray(stream.tlsSettings.certificates))stream.tlsSettings.certificates=[];
  }
  return before!==stream.security;
 }

 function findPreviousInbound(previous,inbound,index){
  if(!Array.isArray(previous?.inbounds))return null;
  const tag=typeof inbound?.tag==='string'&&inbound.tag?inbound.tag:null;
  if(tag){const match=previous.inbounds.find(item=>item?.tag===tag);if(match)return match}
  return previous.inbounds[index]||null;
 }
 function changedLayerSettings(currentMask,previousMask,direction,type,defaults,factory){
  const currentList=Array.isArray(currentMask?.[direction])?currentMask[direction]:[];
  const layer=currentList.find(item=>item?.type===type);
  if(!layer||!sameJson(layer.settings,defaults))return false;
  const previousList=Array.isArray(previousMask?.[direction])?previousMask[direction]:[];
  const before=previousList.find(item=>item?.type===type);
  if(before&&sameJson(before.settings,layer.settings))return false;
  layer.settings=factory();return true;
 }
 function randomizeInbound(inbound,previous,forceXhttp=false){
  if(!inbound||typeof inbound!=='object')return false;
  let changed=false;
  const stream=inbound.streamSettings??={};
  const beforeStream=previous?.streamSettings||{};
  const network=String(stream.network||stream.method||'raw').toLowerCase();
  const beforeNetwork=String(beforeStream.network||beforeStream.method||'raw').toLowerCase();
  if(network==='xhttp'){
   const xhttp=stream.xhttpSettings??={};
   const path=String(xhttp.path||'');
   const beforePath=String(beforeStream.xhttpSettings?.path||'');
   const becameXhttp=beforeNetwork!=='xhttp';
   if((!path||path==='/xhttp')&&(forceXhttp||becameXhttp||beforePath!==path)){xhttp.path=randomXhttpPath();changed=true}
  }
  const finalmask=stream.finalmask||{},beforeFinalmask=beforeStream.finalmask||{};
  const client=inbound.xmesh?.clientFinalmask||{},beforeClient=previous?.xmesh?.clientFinalmask||{};
  changed=changedLayerSettings(client,beforeClient,'tcp','fragment',FRAGMENT_DEFAULT,randomFragmentSettings)||changed;
  changed=changedLayerSettings(client,beforeClient,'udp','noise',NOISE_DEFAULT,randomNoiseSettings)||changed;
  changed=changedLayerSettings(finalmask,beforeFinalmask,'tcp','header-custom',TCP_HEADER_DEFAULT,randomTcpHeaderSettings)||changed;
  changed=changedLayerSettings(finalmask,beforeFinalmask,'udp','header-custom',UDP_HEADER_DEFAULT,randomUdpHeaderSettings)||changed;
  return changed;
 }
 function randomizeDocument(doc,previous,forceXhttp=false){
  if(!doc||typeof doc!=='object'||!Array.isArray(doc.inbounds))return false;
  let changed=false;
  doc.inbounds.forEach((inbound,index)=>{changed=randomizeInbound(inbound,findPreviousInbound(previous,inbound,index),forceXhttp)||changed});
  return changed;
 }
 function seedSource(source){if(!source||snapshots.has(source))return;try{snapshots.set(source,JSON.parse(source.value))}catch{}}
 function seedFromNode(node){
  const root=studioRoot(node);if(!root)return;
  const source=sourceOf(root);seedSource(source);
  const trigger=node?.closest?.('[data-compose-apply],[data-tool="inbound"]');
  if(trigger&&source)forceNextRandomization.add(source);
 }
 function seedAll(){if(typeof document.querySelectorAll!=='function')return;document.querySelectorAll('#xm-studio-v4 [data-v="source"]').forEach(seedSource)}
 function applyRandomization(source){
  let doc;try{doc=JSON.parse(source.value)}catch{return false}
  const previous=snapshots.get(source),forceXhttp=forceNextRandomization.has(source);
  if(forceXhttp)forceNextRandomization.delete(source);
  if(!previous){snapshots.set(source,clone(doc));return false}
  const changed=randomizeDocument(doc,previous,forceXhttp);snapshots.set(source,clone(doc));
  if(!changed)return false;
  source.value=JSON.stringify(doc,null,2);rewriting.add(source);
  try{source.dispatchEvent(new Event('input',{bubbles:true}))}finally{rewriting.delete(source)}
  return true;
 }
 function applyPending(root){
  if(!pending||!root)return;
  const source=sourceOf(root);if(!source)return;
  let doc;try{doc=JSON.parse(source.value)}catch{return}
  const inbound=Array.isArray(doc?.inbounds)?doc.inbounds[pending.index]:null;if(!inbound)return;
  if(String(inbound.streamSettings?.security||'none')!==pending.value)return;
  const changed=normalizeInbound(inbound);pending=null;if(!changed)return;
  source.value=JSON.stringify(doc,null,2);snapshots.set(source,clone(doc));source.dispatchEvent(new Event('input',{bubbles:true}));
 }

 function xhttpExtraObject(xhttp){
  const raw=xhttp?.extra;
  if(raw==null||raw==='')return {};
  if(typeof raw==='object'&&!Array.isArray(raw))return clone(raw);
  if(typeof raw==='string'){
   let parsed;try{parsed=JSON.parse(raw)}catch{throw Error('xhttpSettings.extra содержит некорректный JSON')}
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('xhttpSettings.extra должен быть JSON-объектом');
   return parsed;
  }
  throw Error('xhttpSettings.extra должен быть объектом или JSON-строкой');
 }
 function writeXhttpExtra(xhttp,extra){if(extra&&Object.keys(extra).length)xhttp.extra=extra;else delete xhttp.extra}
 function effectiveXhttpValue(xhttp,extra,key,fallback){
  if(Object.prototype.hasOwnProperty.call(extra,key))return extra[key];
  if(Object.prototype.hasOwnProperty.call(xhttp||{},key))return xhttp[key];
  return fallback;
 }
 function materializeXhttpExtra(xhttp){
  const extra=xhttpExtraObject(xhttp);
  for(const key of ADVANCED_XHTTP_KEYS){
   if(!Object.prototype.hasOwnProperty.call(extra,key)&&Object.prototype.hasOwnProperty.call(xhttp,key))extra[key]=clone(xhttp[key]);
   delete xhttp[key];
  }
  return extra;
 }
 function ensureXhttpSettings(inbound){
  if(!inbound||typeof inbound!=='object')throw Error('Inbound отсутствует');
  const stream=inbound.streamSettings??={};stream.network='xhttp';
  if(!stream.xhttpSettings||typeof stream.xhttpSettings!=='object'||Array.isArray(stream.xhttpSettings))stream.xhttpSettings={};
  const xhttp=stream.xhttpSettings;
  if(!String(xhttp.path||'').trim()||xhttp.path==='/xhttp')xhttp.path=randomXhttpPath();
  if(!String(xhttp.mode||'').trim())xhttp.mode='auto';
  return xhttp;
 }
 function xhttpSelection(root,doc){
  const list=Array.isArray(doc?.inbounds)?doc.inbounds:[];if(!list.length)throw Error('В конфигурации нет inbound');
  const raw=root.querySelector('[data-tool-inbound]')?.value??root.querySelector('[data-field="inboundSelect"]')?.value??'0';
  const index=Number(raw);if(!Number.isInteger(index)||index<0||index>=list.length)throw Error('Некорректно выбран inbound');
  return {index,tag:list[index]?.tag??null,inbound:list[index]};
 }
 function setToolStatus(root,message){const target=root?.querySelector?.('[data-tool-status]');if(target)target.textContent=String(message||'')}
 function commitXhttp(root,index,tag,mutator,label){
  const source=sourceOf(root);if(!source)throw Error('JSON-редактор XRAY STUDIO не найден');
  let doc;try{doc=JSON.parse(source.value)}catch(e){throw Error('Исправьте JSON перед настройкой XHTTP: '+e.message)}
  const inbound=Array.isArray(doc.inbounds)?doc.inbounds[index]:null;if(!inbound||inbound.tag!==tag)throw Error('Выбранный inbound изменился. Повторите действие.');
  mutator(inbound,doc);source.value=JSON.stringify(doc,null,2);snapshots.set(source,clone(doc));source.dispatchEvent(new Event('input',{bubbles:true}));setToolStatus(root,label);
 }
 function rangeOrInteger(value,{min=0,allowEmpty=false,allowNegative=false}={}){
  const text=String(value??'').trim();if(!text&&allowEmpty)return '';
  if(/^-?\d+$/.test(text)){const n=Number(text);return (allowNegative||n>=min)?'':'Минимальное значение: '+min}
  const match=text.match(/^(-?\d+)-(-?\d+)$/);if(!match)return 'Введите целое число или диапазон min-max';
  const a=Number(match[1]),b=Number(match[2]);return (allowNegative||a>=min)&&b>=a?'':'Некорректный диапазон';
 }
 function numberOrRangeValue(value){const text=String(value??'').trim();return /^-?\d+$/.test(text)?Number(text):text}
 function boolValue(value){return String(value)==='true'}
 function jsonObject(value,label){let parsed;try{parsed=JSON.parse(value)}catch{return {error:label+': некорректный JSON'}};return !parsed||typeof parsed!=='object'||Array.isArray(parsed)?{error:label+': требуется JSON-объект'}:{value:parsed}}
 function pathValid(value){const text=String(value||'').trim();return text.startsWith('/')?'':'Path должен начинаться с /'}
 function headersValid(value){
  const parsed=jsonObject(value,'Headers');if(parsed.error)return parsed.error;
  for(const [key,val] of Object.entries(parsed.value)){if(String(key).toLowerCase()==='host')return 'Host задаётся отдельным полем и не допускается внутри headers';if(typeof val!=='string')return 'Все значения headers должны быть строками'}
  return '';
 }
 function setOrDelete(object,key,value,emptyDeletes=true){if(emptyDeletes&&(value===''||value==null))delete object[key];else object[key]=value}
 function advancedMutation(ib,fn){const x=ensureXhttpSettings(ib),extra=materializeXhttpExtra(x);fn(extra,x);writeXhttpExtra(x,extra)}
 function currentXhttp(inbound){const stream=inbound?.streamSettings||{};return stream.xhttpSettings&&typeof stream.xhttpSettings==='object'&&!Array.isArray(stream.xhttpSettings)?stream.xhttpSettings:{}}
 async function confirmXhttpSwitch(dialog,source,initial,selection){
  const network=String(selection.inbound?.streamSettings?.network||selection.inbound?.streamSettings?.method||'raw').toLowerCase();if(network==='xhttp')return true;
  const ok=await dialog.confirm({eyebrow:'XRAY STUDIO / XHTTP',title:'Переключить транспорт на XHTTP?',description:'Inbound «'+(selection.tag||'Inbound')+'» сейчас использует '+network.toUpperCase()+'. Старые настройки транспорта останутся в JSON, но перестанут быть активными.',notice:'TLS / REALITY / NONE не меняются: Security остаётся отдельной настройкой.',confirmLabel:'Переключить на XHTTP'});
  if(!ok)return false;if(source.value!==initial){setToolStatus(studioRoot(source),'JSON изменился. Повторите настройку XHTTP.');return false}return true;
 }
 async function chooseCards(dialog,title,description,value,options){return dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title,description,confirmLabel:'Продолжить',selectFirst:false,fields:[{name:'action',label:'Выберите действие',type:'cards',wide:true,value,options}]})}

 async function openXhttpMenu(root){
  const dialog=window.XMeshStudioDialogs;
  if(!dialog?.request||!dialog?.confirm){setToolStatus(root,'Диалоговый модуль XRAY STUDIO не загружен');return}
  const source=sourceOf(root);if(!source)return;
  let doc;try{doc=JSON.parse(source.value)}catch(e){setToolStatus(root,'Исправьте JSON: '+e.message);return}
  let selection;try{selection=xhttpSelection(root,doc)}catch(e){setToolStatus(root,e.message);return}
  const initial=source.value;if(!await confirmXhttpSwitch(dialog,source,initial,selection))return;
  if(source.value!==initial){setToolStatus(root,'JSON изменился. Повторите настройку XHTTP.');return}
  const settings=currentXhttp(selection.inbound),extra=xhttpExtraObject(settings),mode=String(settings.mode||'auto');
  const choices=[
   {value:'auto',label:'AUTO · Универсальный',description:'Автовыбор XHTTP режима. Security не меняется.'},
   {value:'packet-up',label:'PACKET-UP · Совместимость',description:'POST-пакеты вверх + потоковый download. Максимальная совместимость с CDN/прокси.'},
   {value:'stream-up',label:'STREAM-UP · Потоковый upload',description:'Потоковый upload + отдельный download; gRPC-like HTTP headers поддерживаются.'},
   {value:'stream-one',label:'STREAM-ONE · Один поток',description:'Один двунаправленный HTTP-запрос.'},
   {value:'basic',label:'Основные параметры',description:'Path, Host и Mode.'},
   {value:'rotate-path',label:'Новый случайный Path',description:'Криптографически сгенерировать новый URL-safe Path длиной 64 символа.'},
   {value:'random-profile',label:'Полный randomized profile',description:'Сгенерировать browser headers + padding + session/seq + uplink + XMUX и показать JSON перед применением.'},
   {value:'browser-headers',label:'Browser Headers',description:'Firefox / Chrome / минимальный профиль или полный JSON headers.'},
   {value:'padding',label:'Padding & HTTP disguise',description:'xPaddingBytes, placement, method, key/header и gRPC/SSE switches.'},
   {value:'session-seq',label:'Session ID & Sequence',description:'Placement, keys, sessionIDTable, sessionIDLength и seq.'},
   {value:'uplink',label:'Uplink layout',description:'HTTP method, data placement/key и uplink chunk size.'},
   {value:'packet-tuning',label:'PACKET-UP · Тюнинг',description:'POST size/interval и server buffered posts.'},
   {value:'stream-tuning',label:'STREAM-UP · Keepalive',description:'Server padding keepalive interval.'},
   {value:'xmux',label:'XMUX',description:'Concurrency/connections, reuse, request/time limits и H2/H3 keepalive.'},
   {value:'server-limits',label:'Server limits',description:'serverMaxHeaderBytes и noSSEHeader.'},
   {value:'download',label:'Разделение download',description:'downloadSettings для отдельного адреса/порта/transport security.'},
   {value:'h2params',label:'H2 Params',description:'Низкоуровневые HTTP/2 параметры JSON.'},
   {value:'advanced',label:'Расширенный JSON',description:'Полностью редактировать streamSettings.xhttpSettings вручную.'},
   {value:'reset-extra',label:'Сбросить расширенные параметры',description:'Удалить extra, сохранив Path / Host / Mode.'}
  ];
  const action=await chooseCards(dialog,'XHTTP · конструктор','Почти все параметры XHTTP доступны отдельными формами. Низкочастотные параметры хранятся в extra, поэтому корректно экспортируются клиенту. Security не меняется.',mode,choices);
  if(!action)return;if(source.value!==initial){setToolStatus(root,'JSON изменился. Повторите настройку XHTTP.');return}
  const choice=action.action;

  if(['auto','packet-up','stream-up','stream-one'].includes(choice)){
   commitXhttp(root,selection.index,selection.tag,ib=>{ensureXhttpSettings(ib).mode=choice},'XHTTP mode: '+choice);return;
  }
  if(choice==='rotate-path'){
   const next=randomXhttpPath();
   const ok=await dialog.confirm({eyebrow:'XRAY STUDIO / XHTTP',title:'Сгенерировать новый Path?',description:next,notice:'После изменения клиенты должны получить обновлённую подписку.',confirmLabel:'Сменить Path'});if(!ok)return;
   commitXhttp(root,selection.index,selection.tag,ib=>{ensureXhttpSettings(ib).path=next},'XHTTP: новый случайный Path');return;
  }
  if(choice==='random-profile'){
   const preset=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · randomized profile',description:'Выберите mode и браузерный профиль. Security, Host и Path не меняются. Перед сохранением вы увидите весь generated extra JSON.',confirmLabel:'Сгенерировать',fields:[
    {name:'mode',label:'Mode',type:'select',wide:true,value:mode,options:modeOptions},
    {name:'browser',label:'Browser headers',type:'select',wide:true,value:'firefox',options:[{value:'firefox',label:'Firefox'},{value:'chrome',label:'Chrome'},{value:'minimal',label:'Минимальный'}]}
   ]});if(!preset)return;
   const generated=randomXhttpAdvancedProfile(preset.mode,preset.browser);
   const review=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · generated randomized profile',description:'Проверьте параметры. Можно вручную поправить JSON перед применением.',confirmLabel:'Применить',fields:[{name:'extra',label:'Generated extra JSON',type:'textarea',wide:true,rows:20,value:JSON.stringify(generated,null,2),required:true,validate:v=>jsonObject(v,'extra').error||''}]});if(!review)return;
   const parsed=JSON.parse(review.extra);
   commitXhttp(root,selection.index,selection.tag,ib=>{const x=ensureXhttpSettings(ib);x.mode=preset.mode;for(const key of ADVANCED_XHTTP_KEYS)delete x[key];writeXhttpExtra(x,parsed)},'XHTTP: randomized profile применён');return;
  }
  if(choice==='basic'){
   const response=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · основные параметры',description:'Host необязателен. Path должен совпадать на сервере и клиенте.',confirmLabel:'Применить',fields:[
    {name:'path',label:'Path',wide:true,value:String(settings.path||randomXhttpPath()),required:true,validate:pathValid},
    {name:'host',label:'Host · необязательно',wide:true,value:String(settings.host||'')},
    {name:'mode',label:'Mode',type:'select',wide:true,value:mode,options:modeOptions}
   ]});if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>{const x=ensureXhttpSettings(ib);x.path=response.path;x.mode=response.mode;setOrDelete(x,'host',response.host)},'XHTTP: основные параметры обновлены');return;
  }
  if(choice==='browser-headers'){
   const existing=effectiveXhttpValue(settings,extra,'headers',{});
   const profile=await chooseCards(dialog,'XHTTP · Browser Headers','Выберите профиль или откройте текущий headers JSON. Host сюда не добавляется.',Object.keys(existing||{}).length?'custom':'firefox',[
    {value:'firefox',label:'Firefox · случайная версия',description:'Реалистичный Windows Firefox-профиль: Accept*, Cache-Control, Fetch Metadata, UA.'},
    {value:'chrome',label:'Chrome · случайная версия',description:'Реалистичный Windows Chrome-профиль с тем же набором HTTP-заголовков.'},
    {value:'minimal',label:'Минимальный',description:'Только Accept и Content-Type.'},
    {value:'custom',label:'Свои Headers',description:'Редактировать headers как JSON key → string.'},
    {value:'clear',label:'Очистить Headers',description:'Удалить пользовательские HTTP headers из XHTTP.'}
   ]);if(!profile)return;
   if(profile.action==='clear'){commitXhttp(root,selection.index,selection.tag,ib=>advancedMutation(ib,e=>delete e.headers),'XHTTP: headers очищены');return}
   if(profile.action!=='custom'){
    const generated=randomBrowserHeaders(profile.action);
    const reviewed=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · '+(profile.action==='firefox'?'Firefox':profile.action==='chrome'?'Chrome':'минимальные')+' headers',description:'Профиль сгенерирован. При желании поправьте JSON перед применением.',confirmLabel:'Применить',fields:[{name:'headers',label:'Headers JSON',type:'textarea',wide:true,rows:12,value:JSON.stringify(generated,null,2),required:true,validate:headersValid}]});if(!reviewed)return;
    const parsed=JSON.parse(reviewed.headers);commitXhttp(root,selection.index,selection.tag,ib=>advancedMutation(ib,e=>e.headers=parsed),'XHTTP: browser headers обновлены');return;
   }
   const response=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · Headers',description:'Значения должны быть строками. Host задаётся отдельно.',confirmLabel:'Применить',fields:[{name:'headers',label:'Headers JSON',type:'textarea',wide:true,rows:12,value:JSON.stringify(existing||{},null,2),required:true,validate:headersValid}]});if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>advancedMutation(ib,e=>e.headers=JSON.parse(response.headers)),'XHTTP: headers обновлены');return;
  }
  if(choice==='padding'){
   const response=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · Padding & HTTP disguise',description:'Xray поддерживает repeat-x/tokenish и queryInHeader/header/cookie/query. Диапазон xPaddingBytes должен быть положительным.',confirmLabel:'Применить',fields:[
    {name:'xPaddingBytes',label:'xPaddingBytes',wide:true,value:String(effectiveXhttpValue(settings,extra,'xPaddingBytes','100-1000')),required:true,validate:v=>rangeOrInteger(v,{min:1})},
    {name:'xPaddingObfsMode',label:'xPaddingObfsMode',type:'select',value:String(Boolean(effectiveXhttpValue(settings,extra,'xPaddingObfsMode',false))),options:boolOptions},
    {name:'xPaddingPlacement',label:'xPaddingPlacement',type:'select',value:String(effectiveXhttpValue(settings,extra,'xPaddingPlacement','queryInHeader')),options:paddingPlacementOptions},
    {name:'xPaddingMethod',label:'xPaddingMethod',type:'select',value:String(effectiveXhttpValue(settings,extra,'xPaddingMethod','repeat-x')),options:[{value:'repeat-x',label:'repeat-x'},{value:'tokenish',label:'tokenish'}]},
    {name:'xPaddingKey',label:'xPaddingKey',wide:true,value:String(effectiveXhttpValue(settings,extra,'xPaddingKey','x_padding'))},
    {name:'xPaddingHeader',label:'xPaddingHeader',wide:true,value:String(effectiveXhttpValue(settings,extra,'xPaddingHeader','X-Padding'))},
    {name:'noGRPCHeader',label:'Отключить gRPC header',type:'select',value:String(Boolean(effectiveXhttpValue(settings,extra,'noGRPCHeader',false))),options:boolOptions},
    {name:'noSSEHeader',label:'Отключить SSE response header',type:'select',value:String(Boolean(effectiveXhttpValue(settings,extra,'noSSEHeader',false))),options:boolOptions}
   ]});if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>advancedMutation(ib,e=>{e.xPaddingBytes=numberOrRangeValue(response.xPaddingBytes);e.xPaddingObfsMode=boolValue(response.xPaddingObfsMode);e.xPaddingPlacement=response.xPaddingPlacement;e.xPaddingMethod=response.xPaddingMethod;setOrDelete(e,'xPaddingKey',response.xPaddingKey);setOrDelete(e,'xPaddingHeader',response.xPaddingHeader);e.noGRPCHeader=boolValue(response.noGRPCHeader);e.noSSEHeader=boolValue(response.noSSEHeader)}),'XHTTP: padding/headers disguise обновлены');return;
  }
  if(choice==='session-seq'){
   const response=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · Session ID & Sequence',description:'По умолчанию Xray размещает session и seq в path. Для cookie/header/query задайте key; пустой key получит дефолт Xray.',confirmLabel:'Применить',fields:[
    {name:'sessionIDPlacement',label:'sessionIDPlacement',type:'select',value:String(effectiveXhttpValue(settings,extra,'sessionIDPlacement','path')),options:placementOptions},
    {name:'sessionIDKey',label:'sessionIDKey',wide:true,value:String(effectiveXhttpValue(settings,extra,'sessionIDKey','session_id'))},
    {name:'sessionIDTable',label:'sessionIDTable',wide:true,value:String(effectiveXhttpValue(settings,extra,'sessionIDTable','Base62')),help:'Можно использовать predefined table, например Base62, BASE36, base36, HEX, Alphabet/alphabet, либо свой ASCII-набор.'},
    {name:'sessionIDLength',label:'sessionIDLength',wide:true,value:String(effectiveXhttpValue(settings,extra,'sessionIDLength','16-48')),required:true,validate:v=>rangeOrInteger(v,{min:1})},
    {name:'seqPlacement',label:'seqPlacement',type:'select',value:String(effectiveXhttpValue(settings,extra,'seqPlacement','path')),options:placementOptions},
    {name:'seqKey',label:'seqKey',wide:true,value:String(effectiveXhttpValue(settings,extra,'seqKey','segment'))}
   ]});if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>advancedMutation(ib,e=>{e.sessionIDPlacement=response.sessionIDPlacement;setOrDelete(e,'sessionIDKey',response.sessionIDKey);setOrDelete(e,'sessionIDTable',response.sessionIDTable);e.sessionIDLength=numberOrRangeValue(response.sessionIDLength);e.seqPlacement=response.seqPlacement;setOrDelete(e,'seqKey',response.seqKey)}),'XHTTP: session/sequence обновлены');return;
  }
  if(choice==='uplink'){
   const response=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · Uplink layout',description:'GET и uplinkDataPlacement cookie/header допустимы только для packet-up. Для stream-* используйте POST и auto/body.',confirmLabel:'Применить',fields:[
    {name:'uplinkHTTPMethod',label:'uplinkHTTPMethod',type:'select',value:String(effectiveXhttpValue(settings,extra,'uplinkHTTPMethod','POST')).toUpperCase(),options:[{value:'POST',label:'POST'},{value:'GET',label:'GET'}]},
    {name:'uplinkDataPlacement',label:'uplinkDataPlacement',type:'select',value:String(effectiveXhttpValue(settings,extra,'uplinkDataPlacement','auto')),options:uplinkDataPlacementOptions},
    {name:'uplinkDataKey',label:'uplinkDataKey',wide:true,value:String(effectiveXhttpValue(settings,extra,'uplinkDataKey','X-Data'))},
    {name:'uplinkChunkSize',label:'uplinkChunkSize',wide:true,value:String(effectiveXhttpValue(settings,extra,'uplinkChunkSize','')),placeholder:'Например 4096-16384',validate:v=>rangeOrInteger(v,{min:1,allowEmpty:true})}
   ],validate:values=>{const selectedMode=String(settings.mode||'auto');if(values.uplinkHTTPMethod==='GET'&&selectedMode!=='packet-up')return 'GET допустим только при mode=packet-up';if(['cookie','header'].includes(values.uplinkDataPlacement)&&selectedMode!=='packet-up')return values.uplinkDataPlacement+' допустим только при mode=packet-up';return ''}});if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>advancedMutation(ib,e=>{e.uplinkHTTPMethod=response.uplinkHTTPMethod;e.uplinkDataPlacement=response.uplinkDataPlacement;setOrDelete(e,'uplinkDataKey',response.uplinkDataKey);if(response.uplinkChunkSize)e.uplinkChunkSize=numberOrRangeValue(response.uplinkChunkSize);else delete e.uplinkChunkSize}),'XHTTP: uplink layout обновлён');return;
  }
  if(choice==='packet-tuning'){
   const response=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · PACKET-UP tuning',description:'Первые два параметра поддерживают диапазоны для снижения фиксированного паттерна.',confirmLabel:'Применить',fields:[
    {name:'scMaxEachPostBytes',label:'scMaxEachPostBytes',wide:true,value:String(effectiveXhttpValue(settings,extra,'scMaxEachPostBytes','500000-1000000')),required:true,validate:v=>rangeOrInteger(v,{min:1})},
    {name:'scMinPostsIntervalMs',label:'scMinPostsIntervalMs',wide:true,value:String(effectiveXhttpValue(settings,extra,'scMinPostsIntervalMs','10-50')),required:true,validate:v=>rangeOrInteger(v,{min:0})},
    {name:'scMaxBufferedPosts',label:'scMaxBufferedPosts · server',wide:true,type:'number',value:String(effectiveXhttpValue(settings,extra,'scMaxBufferedPosts',30)),min:1,required:true}
   ]});if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>advancedMutation(ib,e=>{e.scMaxEachPostBytes=numberOrRangeValue(response.scMaxEachPostBytes);e.scMinPostsIntervalMs=numberOrRangeValue(response.scMinPostsIntervalMs);e.scMaxBufferedPosts=Number(response.scMaxBufferedPosts)}),'XHTTP: packet-up tuning обновлён');return;
  }
  if(choice==='stream-tuning'){
   const response=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · STREAM-UP Keepalive',description:'scStreamUpServerSecs задаёт серверный padding keepalive. -1 отключает механизм.',confirmLabel:'Применить',fields:[{name:'scStreamUpServerSecs',label:'scStreamUpServerSecs',wide:true,value:String(effectiveXhttpValue(settings,extra,'scStreamUpServerSecs','20-80')),required:true,validate:v=>rangeOrInteger(v,{min:0,allowNegative:true})}]});if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>advancedMutation(ib,e=>e.scStreamUpServerSecs=numberOrRangeValue(response.scStreamUpServerSecs)),'XHTTP: stream-up keepalive обновлён');return;
  }
  if(choice==='xmux'){
   const current=effectiveXhttpValue(settings,extra,'xmux',{})||{};
   const response=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · XMUX',description:'maxConnections и maxConcurrency взаимоисключающие. hKeepAlivePeriod не поддерживает диапазон и может быть -1.',confirmLabel:'Применить',fields:[
    {name:'maxConcurrency',label:'maxConcurrency',wide:true,value:String(current.maxConcurrency??'16-32'),required:true,validate:v=>rangeOrInteger(v,{min:0})},
    {name:'maxConnections',label:'maxConnections',wide:true,value:String(current.maxConnections??0),required:true,validate:v=>rangeOrInteger(v,{min:0})},
    {name:'cMaxReuseTimes',label:'cMaxReuseTimes',wide:true,value:String(current.cMaxReuseTimes??'64-128'),required:true,validate:v=>rangeOrInteger(v,{min:0})},
    {name:'hMaxRequestTimes',label:'hMaxRequestTimes',wide:true,value:String(current.hMaxRequestTimes??'600-900'),required:true,validate:v=>rangeOrInteger(v,{min:0})},
    {name:'hMaxReusableSecs',label:'hMaxReusableSecs',wide:true,value:String(current.hMaxReusableSecs??'1800-3000'),required:true,validate:v=>rangeOrInteger(v,{min:0})},
    {name:'hKeepAlivePeriod',label:'hKeepAlivePeriod',wide:true,type:'number',value:String(current.hKeepAlivePeriod??0),required:true}
   ],validate:values=>{const positive=v=>{const s=String(v);if(/^\d+$/.test(s))return Number(s)>0;const m=s.match(/^(\d+)-(\d+)$/);return Boolean(m&&Number(m[2])>0)};return positive(values.maxConcurrency)&&positive(values.maxConnections)?'maxConnections нельзя использовать одновременно с maxConcurrency':''}});if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>advancedMutation(ib,e=>e.xmux={maxConcurrency:numberOrRangeValue(response.maxConcurrency),maxConnections:numberOrRangeValue(response.maxConnections),cMaxReuseTimes:numberOrRangeValue(response.cMaxReuseTimes),hMaxRequestTimes:numberOrRangeValue(response.hMaxRequestTimes),hMaxReusableSecs:numberOrRangeValue(response.hMaxReusableSecs),hKeepAlivePeriod:Number(response.hKeepAlivePeriod)}),'XHTTP: XMUX обновлён');return;
  }
  if(choice==='server-limits'){
   const response=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · Server limits',description:'Параметры серверной стороны. serverMaxHeaderBytes=0 оставляет системное значение.',confirmLabel:'Применить',fields:[
    {name:'serverMaxHeaderBytes',label:'serverMaxHeaderBytes',type:'number',wide:true,value:String(effectiveXhttpValue(settings,extra,'serverMaxHeaderBytes',0)),min:0,required:true},
    {name:'noSSEHeader',label:'noSSEHeader',type:'select',value:String(Boolean(effectiveXhttpValue(settings,extra,'noSSEHeader',false))),options:boolOptions}
   ]});if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>advancedMutation(ib,e=>{e.serverMaxHeaderBytes=Number(response.serverMaxHeaderBytes);e.noSSEHeader=boolValue(response.noSSEHeader)}),'XHTTP: server limits обновлены');return;
  }
  if(choice==='download'){
   const existing=effectiveXhttpValue(settings,extra,'downloadSettings',{});
   const response=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · разделение download',description:'Полный StreamSettings для отдельного downlink. network должен быть xhttp, а path на конечном сервере — совместим с upload.',confirmLabel:'Применить',fields:[{name:'downloadSettings',label:'downloadSettings JSON',type:'textarea',wide:true,rows:14,value:JSON.stringify(existing||{},null,2),required:true,validate:v=>{const p=jsonObject(v,'downloadSettings');if(p.error)return p.error;if(Object.keys(p.value).length&&String(p.value.network||'').toLowerCase()!=='xhttp')return 'downloadSettings.network должен быть xhttp';return ''}}]});if(!response)return;
   const parsed=JSON.parse(response.downloadSettings);commitXhttp(root,selection.index,selection.tag,ib=>advancedMutation(ib,e=>{if(Object.keys(parsed).length)e.downloadSettings=parsed;else delete e.downloadSettings}),'XHTTP: downloadSettings обновлён');return;
  }
  if(choice==='h2params'){
   const existing=effectiveXhttpValue(settings,extra,'h2Params',{});
   const response=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · H2 Params',description:'Низкоуровневый параметр. Используйте только если знаете требования вашего reverse proxy/CDN.',confirmLabel:'Применить',fields:[{name:'h2Params',label:'h2Params JSON',type:'textarea',wide:true,rows:12,value:JSON.stringify(existing||{},null,2),required:true,validate:v=>jsonObject(v,'h2Params').error||''}]});if(!response)return;
   const parsed=JSON.parse(response.h2Params);commitXhttp(root,selection.index,selection.tag,ib=>advancedMutation(ib,e=>{if(Object.keys(parsed).length)e.h2Params=parsed;else delete e.h2Params}),'XHTTP: h2Params обновлён');return;
  }
  if(choice==='reset-extra'){
   const ok=await dialog.confirm({eyebrow:'XRAY STUDIO / XHTTP',title:'Сбросить расширенные XHTTP параметры?',description:'Удалятся extra и все перенесённые в него advanced-параметры. Path, Host и Mode сохранятся.',danger:true,confirmLabel:'Сбросить'});if(!ok)return;
   commitXhttp(root,selection.index,selection.tag,ib=>{const x=ensureXhttpSettings(ib);delete x.extra;for(const key of ADVANCED_XHTTP_KEYS)delete x[key]},'XHTTP: расширенные параметры сброшены');return;
  }
  if(choice==='advanced'){
   const live=clone(settings);if(!Object.keys(live).length){live.path=randomXhttpPath();live.mode='auto'}
   const response=await dialog.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · расширенный JSON',description:'Полный streamSettings.xhttpSettings. Security находится вне этого объекта и не изменяется.',confirmLabel:'Применить',fields:[{name:'json',label:'xhttpSettings JSON',type:'textarea',wide:true,rows:18,value:JSON.stringify(live,null,2),required:true,validate:v=>{const parsed=jsonObject(v,'xhttpSettings');if(parsed.error)return parsed.error;if(parsed.value.path&&!String(parsed.value.path).startsWith('/'))return 'path должен начинаться с /';if(parsed.value.mode&&!['auto','packet-up','stream-up','stream-one'].includes(parsed.value.mode))return 'Неизвестный mode';return ''}}]});if(!response)return;
   const parsed=JSON.parse(response.json);commitXhttp(root,selection.index,selection.tag,ib=>{const stream=ib.streamSettings??={};stream.network='xhttp';stream.xhttpSettings=parsed;ensureXhttpSettings(ib)},'XHTTP: расширенный JSON обновлён');return;
  }
 }

 document.addEventListener('pointerdown',event=>seedFromNode(event.target),true);
 document.addEventListener('focusin',event=>seedFromNode(event.target),true);
 document.addEventListener('click',event=>{
  const button=event.target?.closest?.('[data-tool="xhttp"]');if(!button)return;
  const root=studioRoot(button);if(!root)return;
  event.preventDefault();event.stopImmediatePropagation();
  Promise.resolve(openXhttpMenu(root)).catch(error=>setToolStatus(root,'XHTTP: '+error.message));
 },true);
 document.addEventListener('change',event=>{
  const select=event.target;
  if(!(select instanceof HTMLSelectElement)||select.dataset.field!=='security')return;
  const root=studioRoot(select);if(!root)return;seedSource(sourceOf(root));
  const inboundSelect=root.querySelector('[data-field="inboundSelect"]');
  const token={value:select.value,index:Number(inboundSelect?.value||0)};pending=token;
  setTimeout(()=>{if(pending===token)pending=null},30000);
 },true);
 document.addEventListener('input',event=>{
  const root=studioRoot(event.target);if(!root)return;
  const source=sourceOf(root);if(event.target!==source)return;
  if(rewriting.has(source)){try{snapshots.set(source,JSON.parse(source.value))}catch{};if(pending)applyPending(root);return}
  applyRandomization(source);if(pending)applyPending(root);
 },true);
 setTimeout(seedAll,0);

 window.XMeshProtocolTlsPolicy={
  normalizeInbound,desiredSecurity,randomXhttpPath,randomizeDocument,
  randomFragmentSettings,randomNoiseSettings,randomTcpHeaderSettings,randomUdpHeaderSettings,
  randomBrowserHeaders,randomXhttpAdvancedProfile,ensureXhttpSettings,xhttpExtraObject,materializeXhttpExtra,openXhttpMenu
 };
})();
