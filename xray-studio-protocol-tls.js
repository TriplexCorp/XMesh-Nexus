'use strict';

// XRAY STUDIO stream-security activation policy plus generation hardening.
// The selected streamSettings.security value is the single source of truth:
// - security="tls"     -> TLS certificate mode is active;
// - security="reality" -> TLS certificate mode is inactive;
// - security="none"    -> TLS certificate mode is inactive.
//
// Do not infer or rewrite security from protocol/transport. VLESS Encryption
// and other valid advanced profiles may intentionally use security="none".
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
  const bytes=randomValues(new Uint8Array(size));
  return Array.from(bytes,b=>URL_SAFE[b&63]).join('');
 }
 function randomHex(bytes=8){
  return Array.from(randomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 }
 function randomRange(startMin,startMax,widthMin,widthMax){
  const start=randomInt(startMin,startMax);
  const end=start+randomInt(widthMin,widthMax);
  return start+'-'+end;
 }
 function randomXhttpPath(){return '/'+randomUrlSafe(64)}
 function randomFragmentSettings(){
  return {
   packets:'tlshello',
   lengths:[randomRange(2,5,1,3),randomRange(6,10,2,5),randomRange(12,20,4,12)],
   delays:[randomRange(5,25,5,25)],
   maxSplit:randomRange(3,5,1,4)
  };
 }
 function randomNoiseSettings(){
  return {
   reset:randomRange(20,60,15,60),
   noise:[{rand:randomRange(8,24,8,40),delay:randomRange(5,20,5,25)}]
  };
 }
 function randomTcpHeaderSettings(){
  return {
   clients:[[{type:'str',packet:randomUrlSafe(randomInt(12,24))}]],
   servers:[[{type:'str',packet:randomUrlSafe(randomInt(12,24))}]]
  };
 }
 function randomUdpHeaderSettings(){
  return {
   client:[{type:'hex',packet:randomHex(randomInt(4,12))}],
   server:[{type:'hex',packet:randomHex(randomInt(4,12))}]
  };
 }

 function desiredSecurity(inbound){
  const current=String(inbound?.streamSettings?.security||'none').toLowerCase();
  return {security:['tls','reality'].includes(current)?current:'none',reason:'explicit-security-selection'};
 }

 function normalizeInbound(inbound){
  if(!inbound||typeof inbound!=='object')return false;
  const stream=inbound.streamSettings??=( {} );
  const before=String(stream.security||'none');
  const decision=desiredSecurity(inbound);

  // Never choose TLS/REALITY from protocol or transport. The operator's
  // Security selector is authoritative.
  stream.security=decision.security;

  if(decision.security==='tls'){
   // TLS is selected: expose/preserve certificate configuration immediately.
   if(!stream.tlsSettings)stream.tlsSettings={certificates:[]};
   if(!Array.isArray(stream.tlsSettings.certificates))stream.tlsSettings.certificates=[];
  }
  // For REALITY/NONE we intentionally keep dormant tlsSettings on disk so
  // certificate paths are not destroyed. Xray does not activate tlsSettings
  // unless streamSettings.security is "tls".

  return before!==stream.security;
 }

 function findPreviousInbound(previous,inbound,index){
  if(!Array.isArray(previous?.inbounds))return null;
  const tag=typeof inbound?.tag==='string'&&inbound.tag?inbound.tag:null;
  if(tag){
   const match=previous.inbounds.find(item=>item?.tag===tag);
   if(match)return match;
  }
  return previous.inbounds[index]||null;
 }
 function changedLayerSettings(currentMask,previousMask,direction,type,defaults,factory){
  const currentList=Array.isArray(currentMask?.[direction])?currentMask[direction]:[];
  const layer=currentList.find(item=>item?.type===type);
  if(!layer||!sameJson(layer.settings,defaults))return false;
  const previousList=Array.isArray(previousMask?.[direction])?previousMask[direction]:[];
  const before=previousList.find(item=>item?.type===type);
  if(before&&sameJson(before.settings,layer.settings))return false;
  layer.settings=factory();
  return true;
 }
 function randomizeInbound(inbound,previous,forceXhttp=false){
  if(!inbound||typeof inbound!=='object')return false;
  let changed=false;
  const stream=inbound.streamSettings??=( {} );
  const beforeStream=previous?.streamSettings||{};
  const network=String(stream.network||'raw').toLowerCase();
  const beforeNetwork=String(beforeStream.network||'raw').toLowerCase();

  if(network==='xhttp'){
   const xhttp=stream.xhttpSettings??=( {} );
   const path=String(xhttp.path||'');
   const beforePath=String(beforeStream.xhttpSettings?.path||'');
   const becameXhttp=beforeNetwork!=='xhttp';
   const generatedPlaceholder=(!path||path==='/xhttp')&&(forceXhttp||becameXhttp||beforePath!==path);
   if(generatedPlaceholder){xhttp.path=randomXhttpPath();changed=true}
  }

  const finalmask=stream.finalmask||{};
  const beforeFinalmask=beforeStream.finalmask||{};
  const client=inbound.xmesh?.clientFinalmask||{};
  const beforeClient=previous?.xmesh?.clientFinalmask||{};

  changed=changedLayerSettings(client,beforeClient,'tcp','fragment',FRAGMENT_DEFAULT,randomFragmentSettings)||changed;
  changed=changedLayerSettings(client,beforeClient,'udp','noise',NOISE_DEFAULT,randomNoiseSettings)||changed;
  changed=changedLayerSettings(finalmask,beforeFinalmask,'tcp','header-custom',TCP_HEADER_DEFAULT,randomTcpHeaderSettings)||changed;
  changed=changedLayerSettings(finalmask,beforeFinalmask,'udp','header-custom',UDP_HEADER_DEFAULT,randomUdpHeaderSettings)||changed;
  return changed;
 }
 function randomizeDocument(doc,previous,forceXhttp=false){
  if(!doc||typeof doc!=='object'||!Array.isArray(doc.inbounds))return false;
  let changed=false;
  doc.inbounds.forEach((inbound,index)=>{
   changed=randomizeInbound(inbound,findPreviousInbound(previous,inbound,index),forceXhttp)||changed;
  });
  return changed;
 }
 function seedSource(source){
  if(!source||snapshots.has(source))return;
  try{snapshots.set(source,JSON.parse(source.value))}catch{}
 }
 function seedFromNode(node){
  const root=studioRoot(node);if(!root)return;
  const source=sourceOf(root);
  seedSource(source);
  const trigger=node?.closest?.('[data-compose-apply],[data-tool="inbound"]');
  if(trigger&&source)forceNextRandomization.add(source);
 }
 function seedAll(){
  if(typeof document.querySelectorAll!=='function')return;
  document.querySelectorAll('#xm-studio-v4 [data-v="source"]').forEach(seedSource);
 }
 function applyRandomization(source){
  let doc;try{doc=JSON.parse(source.value)}catch{return false}
  const previous=snapshots.get(source);
  const forceXhttp=forceNextRandomization.has(source);
  if(forceXhttp)forceNextRandomization.delete(source);
  if(!previous){snapshots.set(source,clone(doc));return false}
  const changed=randomizeDocument(doc,previous,forceXhttp);
  snapshots.set(source,clone(doc));
  if(!changed)return false;
  source.value=JSON.stringify(doc,null,2);
  rewriting.add(source);
  try{source.dispatchEvent(new Event('input',{bubbles:true}))}finally{rewriting.delete(source)}
  return true;
 }

 function applyPending(root){
  if(!pending||!root)return;
  const source=sourceOf(root);if(!source)return;
  let doc;try{doc=JSON.parse(source.value)}catch{return}
  const inbound=Array.isArray(doc?.inbounds)?doc.inbounds[pending.index]:null;
  if(!inbound)return;

  const actual=String(inbound.streamSettings?.security||'none');
  if(actual!==pending.value)return;

  const changed=normalizeInbound(inbound);
  pending=null;
  if(!changed)return;

  source.value=JSON.stringify(doc,null,2);
  snapshots.set(source,clone(doc));
  source.dispatchEvent(new Event('input',{bubbles:true}));
 }

 // XHTTP constructor -------------------------------------------------------
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
 function writeXhttpExtra(xhttp,extra){
  if(extra&&Object.keys(extra).length)xhttp.extra=extra;
  else delete xhttp.extra;
 }
 function effectiveXhttpValue(xhttp,extra,key,fallback){
  if(Object.prototype.hasOwnProperty.call(extra,key))return extra[key];
  if(Object.prototype.hasOwnProperty.call(xhttp||{},key))return xhttp[key];
  return fallback;
 }
 function ensureXhttpSettings(inbound){
  if(!inbound||typeof inbound!=='object')throw Error('Inbound отсутствует');
  const stream=inbound.streamSettings??=( {} );
  stream.network='xhttp';
  if(!stream.xhttpSettings||typeof stream.xhttpSettings!=='object'||Array.isArray(stream.xhttpSettings))stream.xhttpSettings={};
  const xhttp=stream.xhttpSettings;
  if(!String(xhttp.path||'').trim()||xhttp.path==='/xhttp')xhttp.path=randomXhttpPath();
  if(!String(xhttp.mode||'').trim())xhttp.mode='auto';
  return xhttp;
 }
 function xhttpSelection(root,doc){
  const list=Array.isArray(doc?.inbounds)?doc.inbounds:[];
  if(!list.length)throw Error('В конфигурации нет inbound');
  const toolSelect=root.querySelector('[data-tool-inbound]');
  const formSelect=root.querySelector('[data-field="inboundSelect"]');
  const raw=toolSelect?.value??formSelect?.value??'0';
  const index=Number(raw);
  if(!Number.isInteger(index)||index<0||index>=list.length)throw Error('Некорректно выбран inbound');
  return {index,tag:list[index]?.tag??null,inbound:list[index]};
 }
 function setToolStatus(root,message){
  const target=root.querySelector('[data-tool-status]');
  if(target)target.textContent=String(message||'');
 }
 function commitXhttp(root,index,tag,mutator,label){
  const source=sourceOf(root);if(!source)throw Error('JSON-редактор XRAY STUDIO не найден');
  let doc;try{doc=JSON.parse(source.value)}catch(e){throw Error('Исправьте JSON перед настройкой XHTTP: '+e.message)}
  const inbound=Array.isArray(doc.inbounds)?doc.inbounds[index]:null;
  if(!inbound||inbound.tag!==tag)throw Error('Выбранный inbound изменился. Повторите действие.');
  mutator(inbound,doc);
  source.value=JSON.stringify(doc,null,2);
  snapshots.set(source,clone(doc));
  source.dispatchEvent(new Event('input',{bubbles:true}));
  setToolStatus(root,label);
 }
 function rangeOrInteger(value,{min=0,allowEmpty=false}={}){
  const text=String(value??'').trim();
  if(!text&&allowEmpty)return '';
  if(/^-?\d+$/.test(text))return Number(text)>=min?'':'Минимальное значение: '+min;
  const match=text.match(/^(-?\d+)-(-?\d+)$/);
  if(!match)return 'Введите целое число или диапазон min-max';
  const a=Number(match[1]),b=Number(match[2]);
  return a>=min&&b>=a?'':'Диапазон должен быть не меньше '+min+' и min ≤ max';
 }
 function numberOrRangeValue(value){
  const text=String(value??'').trim();
  return /^-?\d+$/.test(text)?Number(text):text;
 }
 function jsonObject(value,label){
  let parsed;try{parsed=JSON.parse(value)}catch{return {error:label+': некорректный JSON'}}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {error:label+': требуется JSON-объект'};
  return {value:parsed};
 }
 async function confirmXhttpSwitch(dialog,source,initial,selection){
  const network=String(selection.inbound?.streamSettings?.network||'raw').toLowerCase();
  if(network==='xhttp')return true;
  const ok=await dialog.confirm({
   eyebrow:'XRAY STUDIO / XHTTP',
   title:'Переключить транспорт на XHTTP?',
   description:'Inbound «'+(selection.tag||'Inbound')+'» сейчас использует '+network.toUpperCase()+'. После переключения старые настройки транспорта останутся в JSON, но перестанут быть активными.',
   notice:'TLS и REALITY не меняются: Security остаётся отдельной настройкой.',
   confirmLabel:'Переключить на XHTTP'
  });
  if(!ok)return false;
  if(source.value!==initial){setToolStatus(studioRoot(source),'JSON изменился. Повторите настройку XHTTP.');return false}
  return true;
 }
 async function openXhttpMenu(root){
  const dialog=window.XMeshStudioDialogs;
  if(!dialog?.request||!dialog?.confirm){setToolStatus(root,'Диалоговый модуль XRAY STUDIO не загружен');return}
  const source=sourceOf(root);if(!source){return}
  let doc;try{doc=JSON.parse(source.value)}catch(e){setToolStatus(root,'Исправьте JSON: '+e.message);return}
  let selection;try{selection=xhttpSelection(root,doc)}catch(e){setToolStatus(root,e.message);return}
  const initial=source.value;
  const inbound=selection.inbound;
  const stream=inbound.streamSettings||{};
  const xhttp=stream.xhttpSettings&&typeof stream.xhttpSettings==='object'&&!Array.isArray(stream.xhttpSettings)?stream.xhttpSettings:{};
  const mode=String(xhttp.mode||'auto');
  const currentNetwork=String(stream.network||'raw').toUpperCase();
  const choices=[
   {value:'auto',label:'AUTO · Универсальный',description:'Автовыбор XHTTP режима. Для обычной конфигурации достаточно Path.'},
   {value:'packet-up',label:'PACKET-UP · Совместимость',description:'Раздельные POST-запросы вверх и потоковый download; наиболее совместим с CDN и reverse proxy.'},
   {value:'stream-up',label:'STREAM-UP · Потоковый upload',description:'Потоковый upload + отдельный download. Хорошо подходит для H2/REALITY и совместимых прокси.'},
   {value:'stream-one',label:'STREAM-ONE · Один поток',description:'Один двунаправленный HTTP-запрос; быстрее и проще, но менее универсален через некоторые CDN.'},
   {value:'basic',label:'Основные параметры',description:'Path, Host и Mode в одном окне.'},
   {value:'rotate-path',label:'Новый случайный Path',description:'Сгенерировать новый 64-символьный URL-safe Path криптографическим генератором.'},
   {value:'headers-padding',label:'Headers & Padding',description:'HTTP headers, xPaddingBytes, gRPC/SSE header switches.'},
   {value:'packet-tuning',label:'PACKET-UP · Тюнинг',description:'Размер POST, интервал клиентских POST и серверный буфер.'},
   {value:'stream-tuning',label:'STREAM-UP · Keepalive',description:'Серверный интервал padding keepalive для stream-up.'},
   {value:'xmux',label:'XMUX',description:'Concurrency, reuse limits, HTTP request limits и keepalive H2/H3.'},
   {value:'advanced',label:'Расширенный JSON',description:'Полностью редактировать streamSettings.xhttpSettings вручную.'},
   {value:'reset-extra',label:'Сбросить расширенные параметры',description:'Удалить extra, сохранив Path, Host и Mode.'}
  ];
  const action=await dialog.request({
   eyebrow:'XRAY STUDIO / XHTTP',
   title:'XHTTP · конструктор',
   description:'Выберите режим или группу параметров. Текущий транспорт: '+currentNetwork+' · режим: '+mode+'.',
   notice:'Path генерируется случайно. Security (TLS / REALITY / none) управляется отдельно и этим меню не переключается.',
   confirmLabel:'Продолжить',selectFirst:false,
   fields:[{name:'action',label:'Настройки XHTTP',type:'cards',wide:true,value:['auto','packet-up','stream-up','stream-one'].includes(mode)?mode:'basic',options:choices}]
  });
  if(!action)return;
  if(source.value!==initial){setToolStatus(root,'JSON изменился. Повторите настройку XHTTP.');return}
  if(!(await confirmXhttpSwitch(dialog,source,initial,selection)))return;

  const simpleModes=new Set(['auto','packet-up','stream-up','stream-one']);
  if(simpleModes.has(action.action)){
   commitXhttp(root,selection.index,selection.tag,ib=>{ensureXhttpSettings(ib).mode=action.action},'XHTTP: режим '+action.action+' применён');
   return;
  }
  if(action.action==='rotate-path'){
   commitXhttp(root,selection.index,selection.tag,ib=>{ensureXhttpSettings(ib).path=randomXhttpPath()},'XHTTP: создан новый случайный Path');
   return;
  }
  if(action.action==='reset-extra'){
   const ok=await dialog.confirm({
    eyebrow:'XRAY STUDIO / XHTTP',title:'Сбросить расширенные XHTTP параметры?',
    description:'Будет удалён только xhttpSettings.extra. Path, Host и Mode сохранятся.',danger:true,confirmLabel:'Сбросить extra'
   });
   if(!ok)return;
   if(source.value!==initial){setToolStatus(root,'JSON изменился. Повторите действие.');return}
   commitXhttp(root,selection.index,selection.tag,ib=>{const settings=ensureXhttpSettings(ib);delete settings.extra},'XHTTP: расширенные параметры сброшены');
   return;
  }

  let latest;try{latest=JSON.parse(source.value)}catch{return}
  const current=latest.inbounds?.[selection.index];
  if(!current||current.tag!==selection.tag){setToolStatus(root,'Inbound изменился. Повторите действие.');return}
  const settings=current.streamSettings?.xhttpSettings&&typeof current.streamSettings.xhttpSettings==='object'&&!Array.isArray(current.streamSettings.xhttpSettings)?current.streamSettings.xhttpSettings:{};
  let extra;try{extra=xhttpExtraObject(settings)}catch(e){setToolStatus(root,e.message);return}

  if(action.action==='basic'){
   const response=await dialog.request({
    eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · основные параметры',
    description:'Path должен совпадать на сервере и клиенте. Host обычно можно оставить пустым.',confirmLabel:'Применить',
    fields:[
     {name:'path',label:'Path',wide:true,value:String(settings.path||randomXhttpPath()),required:true,maxLength:512,
      validate:value=>value.startsWith('/')&&!/\s/.test(value)?'':'Path должен начинаться с / и не содержать пробелы'},
     {name:'host',label:'Host · необязательно',wide:true,value:String(settings.host||''),placeholder:'example.com'},
     {name:'mode',label:'Mode',type:'select',wide:true,value:String(settings.mode||'auto'),options:[
      {value:'auto',label:'auto'},{value:'packet-up',label:'packet-up'},{value:'stream-up',label:'stream-up'},{value:'stream-one',label:'stream-one'}]}
    ]
   });
   if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>{const target=ensureXhttpSettings(ib);target.path=response.path;target.mode=response.mode;if(response.host)target.host=response.host;else delete target.host},'XHTTP: основные параметры обновлены');
   return;
  }

  if(action.action==='headers-padding'){
   const headers=effectiveXhttpValue(settings,extra,'headers',{});
   const response=await dialog.request({
    eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · Headers & Padding',
    description:'Header padding уменьшает фиксированные признаки длины HTTP-заголовков. Параметры сохраняются в extra и могут экспортироваться клиенту.',confirmLabel:'Применить',
    fields:[
     {name:'headers',label:'Headers · JSON',type:'textarea',wide:true,rows:6,value:JSON.stringify(headers&&typeof headers==='object'?headers:{},null,2),required:true,
      validate:value=>jsonObject(value,'Headers').error||''},
     {name:'xPaddingBytes',label:'xPaddingBytes',wide:true,value:String(effectiveXhttpValue(settings,extra,'xPaddingBytes','100-1000')),required:true,
      help:'Например 100-1000',validate:value=>rangeOrInteger(value,{min:0})},
     {name:'noGRPCHeader',label:'Отключить gRPC header',type:'select',value:String(Boolean(effectiveXhttpValue(settings,extra,'noGRPCHeader',false))),options:[{value:'false',label:'Нет'},{value:'true',label:'Да'}]},
     {name:'noSSEHeader',label:'Отключить SSE header',type:'select',value:String(Boolean(effectiveXhttpValue(settings,extra,'noSSEHeader',false))),options:[{value:'false',label:'Нет'},{value:'true',label:'Да'}]}
    ]
   });
   if(!response)return;
   const parsedHeaders=jsonObject(response.headers,'Headers');if(parsedHeaders.error){setToolStatus(root,parsedHeaders.error);return}
   commitXhttp(root,selection.index,selection.tag,ib=>{
    const target=ensureXhttpSettings(ib),body=xhttpExtraObject(target);
    body.headers=parsedHeaders.value;body.xPaddingBytes=numberOrRangeValue(response.xPaddingBytes);
    body.noGRPCHeader=response.noGRPCHeader==='true';body.noSSEHeader=response.noSSEHeader==='true';writeXhttpExtra(target,body);
   },'XHTTP: headers и padding обновлены');
   return;
  }

  if(action.action==='packet-tuning'){
   const response=await dialog.request({
    eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · PACKET-UP tuning',
    description:'Диапазоны уменьшают фиксированный паттерн. Серверные параметры остаются на inbound, совместимые клиентские экспортируются подпиской.',confirmLabel:'Применить',
    fields:[
     {name:'scMaxEachPostBytes',label:'Макс. данных в POST',wide:true,value:String(effectiveXhttpValue(settings,extra,'scMaxEachPostBytes',1000000)),required:true,validate:value=>rangeOrInteger(value,{min:1})},
     {name:'scMinPostsIntervalMs',label:'Мин. интервал POST · ms',wide:true,value:String(effectiveXhttpValue(settings,extra,'scMinPostsIntervalMs',30)),required:true,validate:value=>rangeOrInteger(value,{min:0})},
     {name:'scMaxBufferedPosts',label:'Серверный буфер POST',wide:true,value:String(effectiveXhttpValue(settings,extra,'scMaxBufferedPosts',30)),required:true,validate:value=>rangeOrInteger(value,{min:1})}
    ]
   });
   if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>{
    const target=ensureXhttpSettings(ib),body=xhttpExtraObject(target);
    body.scMaxEachPostBytes=numberOrRangeValue(response.scMaxEachPostBytes);
    body.scMinPostsIntervalMs=numberOrRangeValue(response.scMinPostsIntervalMs);
    body.scMaxBufferedPosts=numberOrRangeValue(response.scMaxBufferedPosts);writeXhttpExtra(target,body);
   },'XHTTP: PACKET-UP параметры обновлены');
   return;
  }

  if(action.action==='stream-tuning'){
   const response=await dialog.request({
    eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · STREAM-UP keepalive',
    description:'scStreamUpServerSecs задаёт интервал серверного padding keepalive. -1 отключает механизм.',confirmLabel:'Применить',
    fields:[{name:'scStreamUpServerSecs',label:'scStreamUpServerSecs',wide:true,value:String(effectiveXhttpValue(settings,extra,'scStreamUpServerSecs','20-80')),required:true,
     help:'Например 20-80 или -1',validate:value=>value==='-1'?'':rangeOrInteger(value,{min:0})}]
   });
   if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>{const target=ensureXhttpSettings(ib),body=xhttpExtraObject(target);body.scStreamUpServerSecs=numberOrRangeValue(response.scStreamUpServerSecs);writeXhttpExtra(target,body)},'XHTTP: STREAM-UP keepalive обновлён');
   return;
  }

  if(action.action==='xmux'){
   const currentXmux=extra.xmux&&typeof extra.xmux==='object'&&!Array.isArray(extra.xmux)?extra.xmux:{};
   const response=await dialog.request({
    eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · XMUX',
    description:'XMUX управляет повторным использованием H2/H3 соединений. maxConcurrency и maxConnections не должны одновременно быть ненулевыми.',confirmLabel:'Применить',
    fields:[
     {name:'maxConcurrency',label:'maxConcurrency',wide:true,value:String(currentXmux.maxConcurrency??'16-32'),required:true,validate:value=>rangeOrInteger(value,{min:0})},
     {name:'maxConnections',label:'maxConnections',wide:true,value:String(currentXmux.maxConnections??0),required:true,validate:value=>rangeOrInteger(value,{min:0})},
     {name:'cMaxReuseTimes',label:'cMaxReuseTimes',wide:true,value:String(currentXmux.cMaxReuseTimes??0),required:true,validate:value=>rangeOrInteger(value,{min:0})},
     {name:'hMaxRequestTimes',label:'hMaxRequestTimes',wide:true,value:String(currentXmux.hMaxRequestTimes??'600-900'),required:true,validate:value=>rangeOrInteger(value,{min:0})},
     {name:'hMaxReusableSecs',label:'hMaxReusableSecs',wide:true,value:String(currentXmux.hMaxReusableSecs??'1800-3000'),required:true,validate:value=>rangeOrInteger(value,{min:0})},
     {name:'hKeepAlivePeriod',label:'hKeepAlivePeriod',wide:true,value:String(currentXmux.hKeepAlivePeriod??0),required:true,validate:value=>/^-?\d+$/.test(value)?'':'Введите целое число'}
    ],
    validate:values=>{
     const active=value=>String(value).trim()!=='0';
     return active(values.maxConcurrency)&&active(values.maxConnections)?'maxConcurrency и maxConnections конфликтуют: оставьте один из них равным 0.':'';
    }
   });
   if(!response)return;
   commitXhttp(root,selection.index,selection.tag,ib=>{
    const target=ensureXhttpSettings(ib),body=xhttpExtraObject(target);
    body.xmux={
     maxConcurrency:numberOrRangeValue(response.maxConcurrency),maxConnections:numberOrRangeValue(response.maxConnections),
     cMaxReuseTimes:numberOrRangeValue(response.cMaxReuseTimes),hMaxRequestTimes:numberOrRangeValue(response.hMaxRequestTimes),
     hMaxReusableSecs:numberOrRangeValue(response.hMaxReusableSecs),hKeepAlivePeriod:Number(response.hKeepAlivePeriod)
    };writeXhttpExtra(target,body);
   },'XHTTP: XMUX обновлён');
   return;
  }

  if(action.action==='advanced'){
   const initialSettings=Object.keys(settings).length?settings:{path:randomXhttpPath(),mode:'auto'};
   const response=await dialog.request({
    eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · расширенный JSON',
    description:'Полный объект streamSettings.xhttpSettings. Используйте этот режим для новых или редких параметров Xray-core.',confirmLabel:'Применить',
    fields:[{name:'json',label:'xhttpSettings · JSON',type:'textarea',wide:true,rows:14,value:JSON.stringify(initialSettings,null,2),required:true,
     validate:value=>jsonObject(value,'xhttpSettings').error||''}]
   });
   if(!response)return;
   const parsed=jsonObject(response.json,'xhttpSettings');if(parsed.error){setToolStatus(root,parsed.error);return}
   commitXhttp(root,selection.index,selection.tag,ib=>{const streamSettings=ib.streamSettings??={};streamSettings.network='xhttp';streamSettings.xhttpSettings=parsed.value;ensureXhttpSettings(ib)},'XHTTP: расширенный JSON применён');
  }
 }

 document.addEventListener('pointerdown',event=>seedFromNode(event.target),true);
 document.addEventListener('focusin',event=>seedFromNode(event.target),true);

 // Capture the XHTTP tool before the legacy one-click handler in
 // xray-studio-tools.js. This keeps the existing palette button while replacing
 // its old "focus JSON" behavior with the same card UI used by FinalMask.
 document.addEventListener('click',event=>{
  const button=event.target?.closest?.('[data-tool="xhttp"]');
  if(!button)return;
  const root=studioRoot(button);if(!root)return;
  event.preventDefault();event.stopImmediatePropagation();
  Promise.resolve(openXhttpMenu(root)).catch(error=>setToolStatus(root,'XHTTP: '+error.message));
 },true);

 document.addEventListener('change',event=>{
  const select=event.target;
  if(!(select instanceof HTMLSelectElement)||select.dataset.field!=='security')return;
  const root=studioRoot(select);if(!root)return;
  seedSource(sourceOf(root));
  const inboundSelect=root.querySelector('[data-field="inboundSelect"]');
  const token={value:select.value,index:Number(inboundSelect?.value||0)};
  pending=token;
  // Studio mutates JSON after the selector change. Observe that mutation and
  // only then normalize the selected TLS activation state.
  setTimeout(()=>{if(pending===token)pending=null},30000);
 },true);

 document.addEventListener('input',event=>{
  const root=studioRoot(event.target);if(!root)return;
  const source=sourceOf(root);if(event.target!==source)return;
  if(rewriting.has(source)){
   try{snapshots.set(source,JSON.parse(source.value))}catch{}
   if(pending)applyPending(root);
   return;
  }
  applyRandomization(source);
  if(pending)applyPending(root);
 },true);

 setTimeout(seedAll,0);

 window.XMeshProtocolTlsPolicy={
  normalizeInbound,desiredSecurity,
  randomXhttpPath,randomizeDocument,
  randomFragmentSettings,randomNoiseSettings,randomTcpHeaderSettings,randomUdpHeaderSettings,
  ensureXhttpSettings,xhttpExtraObject,openXhttpMenu
 };
})();