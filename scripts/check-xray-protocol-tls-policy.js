#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');

const source=fs.readFileSync('xray-studio-protocol-tls.js','utf8');
const listeners={};
let randomCounter=1;
class HTMLSelectElement{}
const sandbox={
 window:{},
 HTMLSelectElement,
 Event:class Event{constructor(type,init={}){this.type=type;Object.assign(this,init)}},
 crypto:{getRandomValues(view){for(let i=0;i<view.length;i++)view[i]=(randomCounter++>>>0);return view}},
 setTimeout:fn=>{fn();return 0},
 document:{
  addEventListener(type,fn){(listeners[type]??=[]).push(fn)},
  querySelectorAll(){return []}
 }
};
vm.runInNewContext(source,sandbox,{filename:'xray-studio-protocol-tls.js'});
const policy=sandbox.window.XMeshProtocolTlsPolicy;
const normalize=policy?.normalizeInbound;
assert.equal(typeof normalize,'function','TLS policy must export normalizeInbound');
assert.equal(typeof policy?.desiredSecurity,'function','TLS policy must expose its decision function');
assert.equal(typeof policy?.randomXhttpPath,'function','Studio policy must export random XHTTP path generator');
assert.equal(typeof policy?.randomizeDocument,'function','Studio policy must export generation randomizer');

const cert={certificateFile:'/etc/xray/server.crt',keyFile:'/etc/xray/server.key'};

const vlessXhttpNone={protocol:'vless',streamSettings:{network:'xhttp',security:'none',tlsSettings:{certificates:[cert]}}};
assert.equal(normalize(vlessXhttpNone),false);
assert.equal(vlessXhttpNone.streamSettings.security,'none','VLESS + XHTTP + NONE must stay NONE; VLESS Encryption may be intentional');
assert.deepEqual(vlessXhttpNone.streamSettings.tlsSettings.certificates[0],cert,'Dormant TLS material must not be destroyed');

const vlessXhttpTls={protocol:'vless',streamSettings:{network:'xhttp',security:'tls'}};
assert.equal(normalize(vlessXhttpTls),false);
assert.equal(vlessXhttpTls.streamSettings.security,'tls','Explicit TLS selection must remain active');
assert.ok(vlessXhttpTls.streamSettings.tlsSettings,'Selecting TLS must provision tlsSettings');
assert.ok(Array.isArray(vlessXhttpTls.streamSettings.tlsSettings.certificates),'Selecting TLS must expose certificates collection');

const vlessXhttpReality={protocol:'vless',streamSettings:{network:'xhttp',security:'reality',tlsSettings:{certificates:[cert]},realitySettings:{serverNames:['example.org']}}};
assert.equal(normalize(vlessXhttpReality),false);
assert.equal(vlessXhttpReality.streamSettings.security,'reality','Explicit REALITY selection must remain authoritative');
assert.deepEqual(vlessXhttpReality.streamSettings.tlsSettings.certificates[0],cert,'Switching away from TLS must not erase reusable certificate paths');

const vmessWsNone={protocol:'vmess',streamSettings:{network:'ws',security:'none'}};
assert.equal(normalize(vmessWsNone),false);
assert.equal(vmessWsNone.streamSettings.security,'none','Protocol/transport must never silently enable TLS');

const trojanNone={protocol:'trojan',streamSettings:{network:'raw',security:'none'}};
assert.equal(normalize(trojanNone),false);
assert.equal(trojanNone.streamSettings.security,'none','Even protocol-specific requirements must be left to validation, not silent rewriting');

const hysteriaNone={protocol:'hysteria',streamSettings:{network:'hysteria',security:'none'}};
assert.equal(normalize(hysteriaNone),false);
assert.equal(hysteriaNone.streamSettings.security,'none','Hysteria security selection must not be silently rewritten by this policy');

const unknown={protocol:'vless',streamSettings:{network:'raw',security:'unexpected'}};
assert.equal(normalize(unknown),true);
assert.equal(unknown.streamSettings.security,'none','Unknown/missing security values must fail closed to none');

const pathA=policy.randomXhttpPath();
const pathB=policy.randomXhttpPath();
assert.match(pathA,/^\/[A-Za-z0-9_-]{64}$/,'Generated XHTTP path must be a 64-char URL-safe token with leading slash');
assert.match(pathB,/^\/[A-Za-z0-9_-]{64}$/);
assert.notEqual(pathA,pathB,'Consecutive generated XHTTP paths must not be reused');

const previousRaw={inbounds:[{tag:'main',streamSettings:{network:'raw',security:'none'}}]};
const generatedXhttp={inbounds:[{tag:'main',streamSettings:{network:'xhttp',security:'none',xhttpSettings:{path:'/xhttp',mode:'auto'}}}]};
assert.equal(policy.randomizeDocument(generatedXhttp,previousRaw),true,'Switching to XHTTP must replace the placeholder path');
assert.match(generatedXhttp.inbounds[0].streamSettings.xhttpSettings.path,/^\/[A-Za-z0-9_-]{64}$/);
assert.notEqual(generatedXhttp.inbounds[0].streamSettings.xhttpSettings.path,'/xhttp');

const legacyPrevious={inbounds:[{tag:'legacy',streamSettings:{network:'xhttp',xhttpSettings:{path:'/xhttp',mode:'auto'}}}]};
const legacyCurrent=JSON.parse(JSON.stringify(legacyPrevious));
assert.equal(policy.randomizeDocument(legacyCurrent,legacyPrevious),false,'Existing legacy /xhttp path must not silently rotate on unrelated edits');
assert.equal(legacyCurrent.inbounds[0].streamSettings.xhttpSettings.path,'/xhttp');
const composerRebuild=JSON.parse(JSON.stringify(legacyPrevious));
assert.equal(policy.randomizeDocument(composerRebuild,legacyPrevious,true),true,'Explicit composer rebuild must force a fresh XHTTP path');
assert.match(composerRebuild.inbounds[0].streamSettings.xhttpSettings.path,/^\/[A-Za-z0-9_-]{64}$/);
assert.notEqual(composerRebuild.inbounds[0].streamSettings.xhttpSettings.path,'/xhttp');

const fragmentDefaults={packets:'tlshello',lengths:['3-5','6-8','10-20'],delays:['10-20'],maxSplit:'3-6'};
const noiseDefaults={reset:'30-60',noise:[{rand:'8-32',delay:'10-20'}]};
const tcpHeaderDefaults={clients:[[{type:'str',packet:'HELLO'}]],servers:[[{type:'str',packet:'WELCOME'}]]};
const udpHeaderDefaults={client:[{type:'hex',packet:'a1b2c3d4'}],server:[{type:'hex',packet:'d4c3b2a1'}]};
const finalmaskBefore={inbounds:[{tag:'mask',streamSettings:{network:'raw',finalmask:{}},xmesh:{clientFinalmask:{}}}]};
const finalmaskGenerated={inbounds:[{
 tag:'mask',
 streamSettings:{network:'raw',finalmask:{tcp:[{type:'header-custom',settings:tcpHeaderDefaults}],udp:[{type:'header-custom',settings:udpHeaderDefaults}]}},
 xmesh:{clientFinalmask:{tcp:[{type:'fragment',settings:fragmentDefaults}],udp:[{type:'noise',settings:noiseDefaults}]}}
}]};
assert.equal(policy.randomizeDocument(finalmaskGenerated,finalmaskBefore),true,'New basic FinalMask presets must be randomized');
const randomized=finalmaskGenerated.inbounds[0];
assert.notDeepEqual(randomized.xmesh.clientFinalmask.tcp[0].settings,fragmentDefaults,'Fragment ranges must not stay hard-coded');
assert.notDeepEqual(randomized.xmesh.clientFinalmask.udp[0].settings,noiseDefaults,'Noise ranges must not stay hard-coded');
assert.notDeepEqual(randomized.streamSettings.finalmask.tcp[0].settings,tcpHeaderDefaults,'TCP Header packets must not stay HELLO/WELCOME');
assert.notDeepEqual(randomized.streamSettings.finalmask.udp[0].settings,udpHeaderDefaults,'UDP Header packets must not stay fixed hex');
assert.match(randomized.streamSettings.finalmask.tcp[0].settings.clients[0][0].packet,/^[A-Za-z0-9_-]{12,24}$/);
assert.match(randomized.streamSettings.finalmask.udp[0].settings.client[0].packet,/^[0-9a-f]{8,24}$/);

assert.ok((listeners.change||[]).length>0,'Policy must observe Security selector changes');
assert.ok((listeners.input||[]).length>0,'Policy must observe Studio JSON mutations for generation hardening');
assert.ok((listeners.pointerdown||[]).length>0,'Policy must snapshot before composer/tool mutations');
assert.match(source,/data-compose-apply/,'Composer apply must force a fresh generated XHTTP placeholder path');
assert.match(source,/dataset\.field!=='security'/,'Policy must only react to the Security selector for TLS activation');
assert.doesNotMatch(source,/field!=='protocol'/,'Protocol changes must not drive TLS activation');
assert.doesNotMatch(source,/field!=='transport'/,'Transport changes must not drive TLS activation');

console.log('XRAY STUDIO security policy + randomized XHTTP/FinalMask generation: OK');
