#!/usr/bin/env node
'use strict';
import {assertPackaged,panelStyles} from './ci/frontend-source.cjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window={};
await import('../frontend/js/features/xray-studio/xray-studio-hosts.js');
const module=window.XMeshStudioHosts;
assert.equal(typeof module?.mount,'function');
const view=module.view();
for(const key of ['data-endpoints-panel','data-endpoint-list','data-endpoint-editor',
 'data-endpoint="remark"','data-endpoint="address"','data-endpoint="port"',
 'data-endpoint-nodes','data-endpoint-action="save"']){
 assert(view.includes(key),'Endpoint UI missing '+key);
}
assert(!view.includes('data-endpoint="sec"'),'Security is configured by inbound, not Hosts');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const studio=fs.readFileSync('frontend/js/features/xray-studio/xray-studio-v4.js','utf8');
const html=fs.readFileSync('frontend/index.html','utf8');
const panelCss=panelStyles();
const docker=fs.readFileSync('backend/Dockerfile','utf8');
const server=fs.readFileSync('backend/src/user_subscriptions.rs','utf8')+'\n'+fs.readFileSync('backend/src/user_subscriptions_base.rs','utf8');
assert(!app.includes("['hosts','link','Хосты',1]"),'Duplicate Hosts navigation must stay retired');
assert(app.includes("hosts:['Хосты',()=>simple(['hosts'])]"),'Hosts route must render the dedicated Hosts page');
assert(app.includes("['hosts','globe-2','Хосты']"),'Hosts navigation must remain accessible');
assert(studio.includes('window.XMeshStudioHosts.view()'),'Studio must embed endpoints beside inbound');
assert(studio.includes('window.XMeshStudioHosts.mount('),'Editor must activate endpoint controls');
assert(html.indexOf('/js/features/xray-studio/xray-studio-hosts.js')<html.indexOf('/js/features/xray-studio/xray-studio-v4.js'));
assert.doesNotMatch(html,/<link[^>]+xray-studio-hosts\.css/,
 'XRAY STUDIO Hosts CSS must stay behind the canonical panel stylesheet entrypoint');
assert.match(panelCss,/\.sv-public-endpoints\{/,
 'XRAY STUDIO Hosts styles must be reachable from the canonical panel CSS graph');
assertPackaged(assert,['xray-studio-hosts.js', 'xray-studio-hosts.css']);
assert(server.includes('fn host_for_profile('),'Generator must filter by profile and nodes');
// Explicit Hosts are the only publishable endpoint source. This fail-closed
// contract is shared with the browser Client JSON generator.
assert.match(server,/fn published_hosts_for_profile/,'Only real Hosts can be published');
assert.match(server,/\.filter\(\|host\| host_for_profile\(host, tag, profile, nodes\)\)/,
 'Disabled, mismatched and unassigned Hosts must not be published');
assert.doesNotMatch(server,/else\s+if\s+!any_explicit_host/,
 'No implicit raw-node fallback is allowed, even when the Hosts table is empty');
assert.doesNotMatch(server,/xmeshSourceKey"\] = json!\(format!\("node:/,
 'Subscription sources must come from explicit Host records only');
assert.match(server,/\bOk\(outbounds\)/,
 'Empty authorized endpoint sets must remain valid empty subscriptions');
const jsClient=fs.readFileSync('frontend/js/features/users/client-config.js','utf8');
assert.match(jsClient,/const candidates=hosts;/,
 'Browser Client JSON can use only explicit Host records');
assert.doesNotMatch(jsClient,/associatedNodes\.map\(n=>\(\{/,
 'Browser Client JSON must not synthesize endpoints from Nodes');
// Regression: the Hosts form previously rejected Hysteria2 (and every non-VLESS
// protocol) before sending any request, even though backend subscriptions worked.
const hostStart=app.indexOf("hosts:{t:'Хосты'");
const hostEnd=app.indexOf("nodes:{t:'Узлы'",hostStart);
assert(hostStart>=0&&hostEnd>hostStart,'Hosts form source not found');
const hostCode=app.slice(hostStart,hostEnd);
const validatorStart=hostCode.indexOf('chk:d=>{');
const validatorEnd=hostCode.indexOf('\n    },\n    cols:',validatorStart);
assert(validatorStart>=0&&validatorEnd>validatorStart,'Hosts validation function not found');
const validator=hostCode.slice(validatorStart+4,validatorEnd+6);
const protocols=['vless','vmess','trojan','shadowsocks','hysteria','masque'];
const whitelist=app.match(/const SUBSCRIPTION_PROTOCOLS=new Set\(\[([^\]]+)\]\);/);
assert(whitelist,'Subscription protocol whitelist missing');
const exported=whitelist[1].split(',').map(s=>s.trim().replace(/^'|'$/g,''));
assert.deepEqual(exported,protocols,'UI whitelist must match native subscription protocols');
const createValidator=DB=>new Function('DB','inbs','SUBSCRIPTION_PROTOCOLS',
 'return ('+validator+');')(DB,p=>JSON.parse(p.config).inbounds,new Set(exported));
for(const protocol of [...protocols,'socks']){
 const profile={id:11,config:JSON.stringify({inbounds:[{tag:'main',protocol,
  streamSettings:{network:protocol==='hysteria'?'hysteria':'raw',security:'tls'}}]})};
 const DB={profiles:[profile],nodes:[{id:27,profileId:11,disabled:false}]};
 const check=createValidator(DB);
 const host={disabled:false,remark:'Example node',address:'node.example.org',port:443,
  profileId:11,tag:'main',nodes:[27]};
 if(protocol==='socks')assert.match(check(host),/не поддерживается/);
 else assert.equal(check(host),'',protocol+' host must be accepted');
 if(protocol==='hysteria'){
  assert.match(check({...host,nodes:[99]}),/не использует выбранный XRAY-профиль/);
  assert.equal(check({...host,disabled:true}),'','Disabled host remains editable');
 }
}
assert(!app.includes('Генератор подписок пока поддерживает только VLESS. Выберите VLESS inbound.'),
 'Remove the obsolete VLESS-only save restriction');
assert(!app.includes('Для подписок сейчас поддерживается только VLESS.'),
 'Remove the obsolete VLESS-only editor warning');
assert.match(app,/inbs\(profile\)\.find\(i=>SUBSCRIPTION_PROTOCOLS\.has\(i\.protocol\)\)/,
 'Creating a host from a node must not require a VLESS inbound');
assert.equal((server.match(/if let Some\(mut outbound\) = proxy_outbound\(user, inbound, &?host, device\)/g)||[]).length,1,
 'Exactly one explicit-Host export path must exist for all supported protocols');

console.log('XRAY STUDIO endpoints integration, backwards-compatible storage and routing: PASS');
