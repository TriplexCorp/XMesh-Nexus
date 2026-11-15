#!/usr/bin/env node
'use strict';
/* XRAY STUDIO enterprise shell / read-only inspector regression checks. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {assertPackaged,panelStyles}=require('./ci/frontend-source.cjs');
const js=fs.readFileSync('frontend/js/features/xray-studio/xray-studio-v4.js','utf8');
const tools=fs.readFileSync('frontend/js/features/xray-studio/xray-studio-tools.js','utf8');
const css=fs.readFileSync('frontend/styles/features/xray-studio/xray-studio-v4.css','utf8');
const html=fs.readFileSync('frontend/index.html','utf8');
const panelCss=panelStyles();
new Function(js);new Function(tools);
const w={XMeshStudioHosts:{view:()=>'<div></div>'}};
new Function('window',js)(w);
const page=w.XMeshStudioV4.view();
for(const marker of ['data-v="source"','data-v="highlight"','data-v="gutter"',
 'data-action="check"','data-action="save"','data-v="jsonOutline"',
 'data-v="inboundOutline"','data-v="outlineStatus"','data-v="insInbounds"',
 'data-v="insOutbounds"','data-v="insRules"','data-v="lines"',
 'data-action="outline"']){
 assert(page.includes(marker),'XRAY editor missing '+marker);
}
assert.equal((page.match(/data-v="source"/g)||[]).length,1,'Single authoritative JSON editor');
assert.equal((page.match(/data-action="outline"/g)||[]).length,2,'Inspector has toolbar toggle and close');
assert(page.indexOf('sv-inline-tools')<page.indexOf('sv-codesurface'),'Tools precede editor');
assert(page.indexOf('sv-codepanel')<page.indexOf('sv-outline'),'Editor remains primary');
assert.match(tools,/function contextualToolGroups\(/,'Commands must derive from inbound configuration');
assert.match(tools,/specialized.push\('hysteria-config','tls','ech','protocol-config'\)/,'Hysteria2 must expose TLS and ECH commands');
assert.match(tools,/host.addEventListener\('change'/,'Inbound selection must update tools');
assert.match(js,/toolPaletteHandle\?\.refresh\(\)/,'Template changes must refresh tools');
assert.match(css,/--vround:var\(--ui-control-radius/,'Global corner radius inherited');
assert(!page.includes('data-action="format"')&&!page.includes('data-action="expand"'),'No redundant editor toolbar actions');
assert.match(css,/height:clamp\(28rem,calc\(100dvh - 12rem\)/,'Editor responds to viewport height');
assert.match(css,/\.sv-studio\.sv-outline-hidden \.sv-workspace\{grid-template-columns:minmax\(0,1fr\)\}/,'Hidden inspector restores full editor width');
assert.match(css,/container:sv-studio-workspace \/ inline-size/,'Workspace must react to the user-selected content width');
assert.match(css,/@container sv-studio-workspace \(max-width:940px\)/,'Narrow content width stacks inspector');
assert.match(css,/--vcode:/,'Same font token for JSON and overlay');

// XRAY STUDIO CSS belongs to the single canonical panel stylesheet graph. It
// must be packaged and reachable through that graph, not reintroduced as a
// direct feature <link>. Runtime JS entrypoints remain content-addressed.
assertPackaged(assert,[
 'xray-studio-v4.css',
 'xray-studio-v4.js',
 'xray-studio-composer.js',
 'xray-studio-tools.js'
]);
assert.match(panelCss,/\.sv-studio\{/,
 'XRAY STUDIO feature CSS must be reachable from the canonical panel CSS graph');
assert.doesNotMatch(html,/<link[^>]+xray-studio-v4\.css/,
 'XRAY STUDIO feature CSS must not bypass the canonical panel CSS entrypoint');
for(const asset of ['xray-studio-v4.js','xray-studio-composer.js','xray-studio-tools.js']){
 const entry=html.match(new RegExp(asset.replaceAll('.', '\\.')+'\\?v=([a-f0-9]{12})'));
 assert(entry&&entry[1],asset+' must carry a content-addressed cache key');
}

class Element {
 constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.textContent='';this.hidden=false}
 append(...items){this.children.push(...items)}
 replaceChildren(...items){this.children=items}
 setAttribute(key,value){this.attrs[key]=String(value)}
 contains(node){return this.children.includes(node)}
}
const ids=Object.fromEntries(['insInbounds','insOutbounds','insRules','jsonOutline','inboundOutline','outlineStatus','coreIssues','position'].map(k=>[k,new Element()]));
ids.coreIssues.hidden=true;
const dot=new Element(),side=new Element();
ids.jsonOutline.closest=()=>side;
const toggle=new Element('button');toggle.setAttribute('aria-expanded','true');
toggle.hasAttribute=name=>name==='aria-expanded';
const cls=new Set(),root={
 classList:{toggle:(n,enable)=>enable?cls.add(n):cls.delete(n),contains:n=>cls.has(n)},
 querySelector:s=>s==='.sv-outline-status-dot'?dot:s==='.sv-codebar [data-action="outline"]'?toggle:null,
 querySelectorAll:s=>s==='[data-action="outline"]'?[toggle]:[]
};
const config={log:{loglevel:'warning'},inbounds:[{
 tag:'NL-VLESS',protocol:'vless',streamSettings:{network:'xhttp',security:'reality',realitySettings:{privateKey:'NEVER_EXPORT_THIS_KEY'}}
}],outbounds:[{tag:'direct',protocol:'freedom'}],routing:{rules:[]}};
const input={value:JSON.stringify(config,null,2),selectionStart:0,scrollTop:0,
 focus(){},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end},dispatchEvent(){}};
const start=js.indexOf('let outlineSignature='),end=js.indexOf('const codeColor=',start);
assert(start>0&&end>start,'Read-only inspector functions exist');
const outlineJs=js.slice(start,end);
const f=new Function('window','document','root','get','input','getComputedStyle','Event','validatedSource',
 'const hasValidJSON=()=>JSON.parse(input.value);'+outlineJs+
 '\nreturn {renderInspector,jumpToSection,setInspectorVisible};');
const inspector=f({localStorage:{setItem(){}}},{createElement:tag=>new Element(tag),activeElement:null},root,
 k=>ids[k],input,()=>({lineHeight:'22px'}),class Event{constructor(type){this.type=type}},null);
inspector.renderInspector(config,[],input.value);
assert.equal(ids.insInbounds.textContent,'1');
assert.equal(ids.insOutbounds.textContent,'1');
assert.equal(ids.insRules.textContent,'0');
assert(ids.jsonOutline.children.some(x=>x.dataset.svJump==='inbounds'),'Inbound navigator works');
assert(ids.inboundOutline.children[0].children.some(x=>x.textContent==='NL-VLESS'),'Shows only inbound metadata');
assert(!JSON.stringify(ids).includes('NEVER_EXPORT_THIS_KEY'),'Inspector must never leak private key');
inspector.jumpToSection('routing');
assert(input.selectionStart>0,'Section jump selects a valid JSON position');
assert(/Строка/.test(ids.position.textContent),'Jump updates cursor location');
inspector.setInspectorVisible(false);
assert(root.classList.contains('sv-outline-hidden'),'Hide inspector');
assert.equal(toggle.attrs['aria-expanded'],'false','Toggle accessibility synced');
inspector.setInspectorVisible(true);
assert(!root.classList.contains('sv-outline-hidden'),'Show inspector');
inspector.renderInspector(null,[],'{invalid');
assert.equal(ids.insInbounds.textContent,'—','Invalid JSON cannot display stale counts');
assert(/Ошибка/.test(ids.outlineStatus.textContent),'Invalid JSON is announced');
// The visible transport toolbar shortcut must skip the expert-server catalog.
// Exercise the actual capture-phase dispatcher, not just a text marker.
const expertSource=fs.readFileSync('frontend/js/features/xray-studio/xray-studio-xhttp-expert.js','utf8');
new Function(expertSource);
const expertEvents=[],dialogTitles=[];
const expertWindow={
 XMeshXhttpStrict:{normalizeForMode(){}},
 XMeshStudioDialogs:{request:async spec=>{dialogTitles.push(spec.title);return null}},
 addEventListener(type,listener,capture){if(type==='click')expertEvents.push({listener,capture})}
};
new Function('window',expertSource)(expertWindow);
assert.equal(expertEvents.length,1,'XHTTP must register one capture handler');
assert.equal(expertEvents[0].capture,true,'XHTTP tools must use capture before generic toolbar actions');
const xhttpSource={value:JSON.stringify({inbounds:[{
 tag:'vless-main',protocol:'vless',streamSettings:{network:'xhttp',xhttpSettings:{path:'/xhttp',mode:'auto'}}
}]})};
const expertRoot={
 querySelector(selector){
  if(selector==='[data-v="source"]')return xhttpSource;
  if(selector==='[data-tool-inbound]')return {value:'0'};
  return null;
 }
};
const invokeExpert=tool=>{
 let prevented=false,stopped=false;
 const button={dataset:{tool},closest:selector=>selector==='#xm-studio-v4'?expertRoot:null};
 expertEvents[0].listener({
  target:{closest:selector=>selector.includes('[data-tool="'+tool+'"]')?button:null},
  preventDefault(){prevented=true},
  stopImmediatePropagation(){stopped=true}
 });
 assert(prevented&&stopped,tool+' shortcut must bypass the generic dispatcher');
};
invokeExpert('xhttp-device');
assert.deepEqual(dialogTitles,['Профили устройств'],
 'One click should show platform selection directly, never the expert-server catalog');
dialogTitles.length=0;
invokeExpert('xhttp');
assert.deepEqual(dialogTitles,['XHTTP · серверные настройки'],
 'XHTTP server entry must open its redesigned localized editor without changing dispatch behavior');

// Exercise clean/RAW XHTTP using the real capture dispatcher and complete
// device profile save path, not just checking for a visible toolbar button.
const runCleanXhttp=async()=>{
 const cases=[
  {raw:'{}',expect:'new'},
  {raw:JSON.stringify({inbounds:[{tag:'raw-test',protocol:'vless',listen:'127.0.0.1',port:443,
   settings:{users:[],decryption:'none'},streamSettings:{network:'raw',security:'tls',tlsSettings:{certificates:[]}}}]}),expect:'convert'}
 ];
 for(const sample of cases){
  const field={value:sample.raw,dispatchEvent(){}},messages=[],calls=[];
  const root={querySelector(selector){
   if(selector==='[data-v="source"]')return field;
   if(selector==='[data-tool-status]')return {set textContent(value){messages.push(value)}};
   return null;
  }};
  let handler;
  const win={
   XMeshXhttpStrict:{normalizeForMode(){},validateSettings:()=>[],validateAdvanced:()=>[]},
   XMeshStudioDialogs:{
    confirm:async spec=>{calls.push(spec.title);return true},
    request:async spec=>{
     calls.push(spec.title);
     if(spec.title==='Профили устройств')return {device:'iOS',preset:'ios'};
     if(spec.title==='XHTTP · iOS')return Object.fromEntries(spec.fields.map(f=>[f.name,String(f.value??'')]));
     throw Error('Unexpected dialog: '+spec.title);
    }
   },
   addEventListener(type,fn){if(type==='click')handler=fn}
  };
  new Function('window','Event',expertSource)(win,class SyntheticEvent{constructor(type){this.type=type}});
  const button={dataset:{tool:'xhttp-device'},closest:()=>root};
  handler({target:{closest:selector=>selector.includes('data-tool="xhttp-device"')?button:null},
   preventDefault(){},stopImmediatePropagation(){}});
  await new Promise(resolve=>setImmediate(resolve));
  const doc=JSON.parse(field.value),ib=doc.inbounds[0];
  assert.equal(ib.streamSettings.network,'xhttp','Device editor must initialize real XHTTP transport');
  assert.equal(ib.xmesh.xhttpDeviceProfiles.iOS.mode,'packet-up','iOS must persist in JSON');
  assert.equal(ib.xmesh.xhttpDeviceProfiles.iOS.xmux.maxConnections,'3-6','XMUX values must persist');
  assert(calls.some(title=>title.includes('XHTTP')),'Explicit change must be confirmed');
  if(sample.expect==='new'){
   assert.equal(ib.listen,'127.0.0.1','Fresh XHTTP inbound must never open a public listener');
   assert.equal(ib.settings.users.length,0,'No credentials are created implicitly');
   assert.equal(doc.outbounds[0].protocol,'freedom');
  }else{
   assert.equal(ib.streamSettings.security,'tls','Converting RAW to XHTTP must preserve TLS');
   assert.deepEqual(ib.streamSettings.tlsSettings.certificates,[]);
  }
 }
 // A cancellation on a clean document must leave the source byte-for-byte intact.
 const untouched={value:'{}'},root={querySelector:q=>q==='[data-v="source"]'?untouched:null};
 let handler;
 const win={
  XMeshXhttpStrict:{normalizeForMode(){},validateSettings:()=>[],validateAdvanced:()=>[]},
  XMeshStudioDialogs:{confirm:async()=>false,request:async()=>{throw Error('Confirmation bypassed')}},
  addEventListener(type,fn){if(type==='click')handler=fn}
 };
 new Function('window','Event',expertSource)(win,class SyntheticEvent{constructor(type){this.type=type}});
 const b={dataset:{tool:'xhttp-device'},closest:()=>root};
 handler({target:{closest:sel=>sel.includes('data-tool="xhttp-device"')?b:null},preventDefault(){},stopImmediatePropagation(){}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(untouched.value,'{}','Cancelling clean config setup must not modify JSON');
};
runCleanXhttp()
 .then(()=>console.log('XRAY Studio enterprise: shell, XHTTP clean/RAW persistence, security and sizing passed'))
 .catch(error=>{console.error(error);process.exitCode=1});
