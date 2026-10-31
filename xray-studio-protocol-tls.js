'use strict';

// Smart transport-security policy for XRAY STUDIO.
// The policy is conservative: preserve an explicitly valid security mode,
// but repair stale/incompatible modes after protocol or transport changes.
(()=>{
 const realityNetworks=new Set(['raw','xhttp','grpc']);
 const webTlsNetworks=new Set(['xhttp','ws','httpupgrade','grpc']);
 const webTlsProtocols=new Set(['vless','vmess','trojan']);
 let pending=null;

 function studioRoot(node){return node?.closest?.('#xm-studio-v4')||null}
 function sourceOf(root){return root?.querySelector?.('[data-v="source"]')||null}
 function hasTlsMaterial(stream){
  const cert=stream?.tlsSettings?.certificates?.[0];
  return Boolean(cert?.certificateFile&&cert?.keyFile);
 }
 function hasRealityMaterial(stream){
  const r=stream?.realitySettings;
  return Boolean(r&&typeof r==='object'&&(
   r.privateKey||r.target||r.dest||r.serverNames?.length||r.shortIds?.length
  ));
 }
 function validReality(network){return realityNetworks.has(network)}

 function desiredSecurity(inbound){
  const protocol=String(inbound?.protocol||'').toLowerCase();
  const stream=inbound?.streamSettings||{};
  const network=String(stream.network||'raw').toLowerCase();
  const current=String(stream.security||'none').toLowerCase();

  // Protocol/transport pairs with mandatory security semantics.
  if(protocol==='hysteria')return {security:'tls',network:'hysteria',reason:'hysteria-required'};
  if(protocol==='masque')return {security:'tls',network:'masque',reason:'masque-required'};
  if(network==='xdrive')return {security:'none',reason:'xdrive-no-stream-security'};
  if(protocol==='socks'||protocol==='http')return {security:'none',network:'raw',reason:'local-proxy'};
  if(protocol==='trojan')return {security:'tls',reason:'trojan-required'};

  // Never destroy an explicit valid REALITY selection. If the transport stops
  // supporting REALITY, choose the safest sensible replacement below.
  if(current==='reality'&&validReality(network))return {security:'reality',reason:'preserve-valid-reality'};

  // Public HTTP-style transports for VLESS/VMess should not silently run
  // unprotected. TLS is the safe automatic default unless REALITY is already
  // explicitly configured and valid for the selected transport.
  if(webTlsProtocols.has(protocol)&&webTlsNetworks.has(network)){
   if(validReality(network)&&hasRealityMaterial(stream))return {security:'reality',reason:'reuse-reality'};
   return {security:'tls',reason:'public-web-transport'};
  }

  // If TLS is explicitly selected and still meaningful, preserve it. This is
  // especially important for RAW/TCP profiles using certificates or fallback.
  if(current==='tls')return {security:'tls',reason:'preserve-explicit-tls'};

  // RAW VLESS can legitimately use REALITY or TLS, but do not fabricate either
  // without evidence. Reuse configured material when it exists.
  if(protocol==='vless'&&network==='raw'){
   if(hasRealityMaterial(stream))return {security:'reality',reason:'reuse-reality'};
   if(hasTlsMaterial(stream))return {security:'tls',reason:'reuse-tls'};
  }

  // An incompatible inherited REALITY must never survive a transport switch.
  if(current==='reality'&&!validReality(network))return {security:'none',reason:'drop-incompatible-reality'};

  return {security:'none',reason:'no-security-required'};
 }

 function normalizeInbound(inbound){
  if(!inbound||typeof inbound!=='object')return false;
  const stream=inbound.streamSettings??=( {} );
  const beforeSecurity=String(stream.security||'none');
  const beforeNetwork=String(stream.network||'raw');
  const decision=desiredSecurity(inbound);

  if(decision.network)stream.network=decision.network;
  stream.security=decision.security;

  if(decision.security==='tls'){
   // Keep certificate paths if already configured. Creating an empty TLS shell
   // makes the constructor surface certificate fields immediately.
   if(!stream.tlsSettings)stream.tlsSettings={certificates:[]};
   if((inbound.protocol==='hysteria'||inbound.protocol==='masque')){
    stream.tlsSettings.alpn=Array.from(new Set([...(stream.tlsSettings.alpn||[]),'h3']));
   }
  }

  return beforeSecurity!==stream.security||beforeNetwork!==stream.network;
 }

 function applyPending(root){
  if(!pending||!root)return;
  const source=sourceOf(root);if(!source)return;
  let doc;try{doc=JSON.parse(source.value)}catch{return}
  const inbound=Array.isArray(doc?.inbounds)?doc.inbounds[pending.index]:null;
  if(!inbound)return;

  const actual=pending.field==='protocol'
   ?String(inbound.protocol||'')
   :String(inbound.streamSettings?.network||'raw');
  if(actual!==pending.value)return;

  const changed=normalizeInbound(inbound);
  pending=null;
  if(!changed)return;

  source.value=JSON.stringify(doc,null,2);
  source.dispatchEvent(new Event('input',{bubbles:true}));
 }

 document.addEventListener('change',event=>{
  const select=event.target;
  if(!(select instanceof HTMLSelectElement))return;
  const field=select.dataset.field;
  if(field!=='protocol'&&field!=='transport')return;
  const root=studioRoot(select);if(!root)return;
  const inboundSelect=root.querySelector('[data-field="inboundSelect"]');
  const token={field,value:select.value,index:Number(inboundSelect?.value||0)};
  pending=token;
  // Protocol changes can wait for a confirmation dialog. Transport changes are
  // synchronous, but use the same post-mutation observation path for both.
  setTimeout(()=>{if(pending===token)pending=null},30000);
 },true);

 document.addEventListener('input',event=>{
  if(!pending)return;
  const root=studioRoot(event.target);if(!root)return;
  if(event.target!==sourceOf(root))return;
  applyPending(root);
 },true);

 window.XMeshProtocolTlsPolicy={normalizeInbound,desiredSecurity};
})();
