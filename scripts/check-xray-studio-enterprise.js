#!/usr/bin/env node
'use strict';
/* XRAY STUDIO enterprise shell / read-only inspector regression checks. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const js=fs.readFileSync('xray-studio-v4.js','utf8');
const tools=fs.readFileSync('xray-studio-tools.js','utf8');
const css=fs.readFileSync('xray-studio-v4.css','utf8');
const html=fs.readFileSync('index.html','utf8');
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
assert.match(tools,/specialized.push\('hysteria-config','tls','protocol-config'\)/,'Hysteria2 must have protocol-specific commands');
assert.match(tools,/host.addEventListener\('change'/,'Inbound selection must update tools');
assert.match(js,/toolPaletteHandle\?\.refresh\(\)/,'Template changes must refresh tools');
assert.match(css,/--vround:var\(--ui-control-radius/,'Global corner radius inherited');
assert(!page.includes('data-action="format"')&&!page.includes('data-action="expand"'),'No redundant editor toolbar actions');
assert.match(css,/height:clamp\(36rem,calc\(100dvh - 16rem\)/,'Editor responds to viewport height');
assert.match(css,/\.sv-studio\.sv-outline-hidden \.sv-workspace\{grid-template-columns:minmax\(0,1fr\)\}/,'Hidden inspector restores full editor width');
assert.match(css,/container:sv-studio-workspace \/ inline-size/,'Workspace must react to the user-selected content width');
assert.match(css,/@container sv-studio-workspace \(max-width:940px\)/,'Narrow content width stacks inspector');
assert.match(css,/--vcode:/,'Same font token for JSON and overlay');
assert.match(html,/xray-studio-v4\.css\?v=20261024-wide-composer-v4/,'CSS cache key must change');
assert.match(html,/xray-studio-v4\.js\?v=20261024-wide-composer-v4/,'JS cache key must change');
assert.match(html,/xray-studio-composer\.js\?v=20261024-wide-composer-v4/,'Composer script asset is versioned');
assert.match(html,/xray-studio-tools\.js\?v=20261024-composer-tools-v5/,'Tool cache key must change');
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
console.log('XRAY Studio enterprise: shell, theme, keyboard navigation, inspector safety, responsive layout and cache keys OK');
