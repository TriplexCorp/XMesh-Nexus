'use strict';

// XRAY STUDIO TLS activation policy.
// The selected streamSettings.security value is the single source of truth:
// - security="tls"     -> TLS certificate mode is active;
// - security="reality" -> TLS certificate mode is inactive;
// - security="none"    -> TLS certificate mode is inactive.
//
// Do not infer or rewrite security from protocol/transport. VLESS Encryption
// and other valid advanced profiles may intentionally use security="none".
(()=>{
 let pending=null;

 function studioRoot(node){return node?.closest?.('#xm-studio-v4')||null}
 function sourceOf(root){return root?.querySelector?.('[data-v="source"]')||null}

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
  source.dispatchEvent(new Event('input',{bubbles:true}));
 }

 document.addEventListener('change',event=>{
  const select=event.target;
  if(!(select instanceof HTMLSelectElement)||select.dataset.field!=='security')return;
  const root=studioRoot(select);if(!root)return;
  const inboundSelect=root.querySelector('[data-field="inboundSelect"]');
  const token={value:select.value,index:Number(inboundSelect?.value||0)};
  pending=token;
  // Studio mutates JSON after the selector change. Observe that mutation and
  // only then normalize the selected TLS activation state.
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
