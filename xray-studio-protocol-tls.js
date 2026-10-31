'use strict';

// Keep TLS security aligned with the selected inbound protocol in XRAY STUDIO.
// Trojan and Hysteria2 require TLS. Other protocols must not inherit a stale
// TLS security mode merely because the previous inbound protocol used it.
(()=>{
 const tlsProtocols=new Set(['trojan','hysteria']);
 let pending=null;

 function studioRoot(node){return node?.closest?.('#xm-studio-v4')||null}
 function sourceOf(root){return root?.querySelector?.('[data-v="source"]')||null}

 function normalizeInbound(inbound){
  if(!inbound||typeof inbound!=='object')return false;
  const protocol=String(inbound.protocol||'').toLowerCase();
  const stream=inbound.streamSettings??=( {} );
  const before=stream.security||'none';

  if(tlsProtocols.has(protocol)){
   stream.security='tls';
   // Preserve existing certificate paths when they are already configured.
   // Hysteria's native migration fills its own h3/tlsSettings details.
   if(!stream.tlsSettings)stream.tlsSettings={certificates:[]};
  }else if(before==='tls'){
   // Do not destroy tlsSettings: certificate paths remain available if the
   // operator later switches back to Trojan/Hysteria. Only disable TLS use.
   stream.security='none';
  }
  return before!==stream.security;
 }

 function applyPending(root){
  if(!pending||!root)return;
  const source=sourceOf(root);if(!source)return;
  let doc;try{doc=JSON.parse(source.value)}catch{return}
  const inbound=Array.isArray(doc?.inbounds)?doc.inbounds[pending.index]:null;
  if(!inbound||String(inbound.protocol||'')!==pending.protocol)return;

  const changed=normalizeInbound(inbound);
  pending=null;
  if(!changed)return;

  source.value=JSON.stringify(doc,null,2);
  source.dispatchEvent(new Event('input',{bubbles:true}));
 }

 document.addEventListener('change',event=>{
  const select=event.target;
  if(!(select instanceof HTMLSelectElement)||select.dataset.field!=='protocol')return;
  const root=studioRoot(select);if(!root)return;
  const inboundSelect=root.querySelector('[data-field="inboundSelect"]');
  const token={protocol:select.value,index:Number(inboundSelect?.value||0)};
  pending=token;
  // Protocol changes in Studio can await a confirmation dialog. The actual
  // JSON mutation is observed below via the source textarea input event.
  setTimeout(()=>{if(pending===token)pending=null},30000);
 },true);

 document.addEventListener('input',event=>{
  if(!pending)return;
  const root=studioRoot(event.target);if(!root)return;
  if(event.target!==sourceOf(root))return;
  applyPending(root);
 },true);

 window.XMeshProtocolTlsPolicy={normalizeInbound};
})();
