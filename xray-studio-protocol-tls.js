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
 function sourceOf(root){return root?.querySelector?.('[data-v="source"]')||null}
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
  const trigger=node?.closest?.('[data-compose-apply],[data-tool="inbound"],[data-tool="xhttp"]');
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

 document.addEventListener('pointerdown',event=>seedFromNode(event.target),true);
 document.addEventListener('focusin',event=>seedFromNode(event.target),true);

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
  randomFragmentSettings,randomNoiseSettings,randomTcpHeaderSettings,randomUdpHeaderSettings
 };
})();
