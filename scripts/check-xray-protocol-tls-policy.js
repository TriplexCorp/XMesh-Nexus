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
assert.equal(typeof policy?.ensureXhttpSettings,'function','Studio policy must expose XHTTP constructor normalization');
assert.equal(typeof policy?.xhttpExtraObject,'function','Studio policy must expose XHTTP extra parser');
assert.equal(typeof policy?.materializeXhttpExtra,'function','Studio policy must expose safe top-level to extra migration');
assert.equal(typeof policy?.randomXhttpAdvancedProfile,'function','Studio policy must expose randomized XHTTP profile generation');
assert.equal(typeof policy?.openXhttpMenu,'function','Studio policy must expose the XHTTP constructor entrypoint');

const cert={certificateFile:'/etc/xray/server.crt',keyFile:'/etc/xray/server.key'};
const vlessXhttpNone={protocol:'vless',streamSettings:{network:'xhttp',security:'none',tlsSettings:{certificates:[cert]}}};
assert.equal(normalize(vlessXhttpNone),false);
assert.equal(vlessXhttpNone.streamSettings.security,'none');
assert.deepEqual(vlessXhttpNone.streamSettings.tlsSettings.certificates[0],cert);
const vlessXhttpTls={protocol:'vless',streamSettings:{network:'xhttp',security:'tls'}};
assert.equal(normalize(vlessXhttpTls),false);
assert.equal(vlessXhttpTls.streamSettings.security,'tls');
assert.ok(vlessXhttpTls.streamSettings.tlsSettings);
assert.ok(Array.isArray(vlessXhttpTls.streamSettings.tlsSettings.certificates));
const vlessXhttpReality={protocol:'vless',streamSettings:{network:'xhttp',security:'reality',tlsSettings:{certificates:[cert]},realitySettings:{serverNames:['example.org']}}};
assert.equal(normalize(vlessXhttpReality),false);
assert.equal(vlessXhttpReality.streamSettings.security,'reality');
assert.deepEqual(vlessXhttpReality.streamSettings.tlsSettings.certificates[0],cert);
const vmessWsNone={protocol:'vmess',streamSettings:{network:'ws',security:'none'}};
assert.equal(normalize(vmessWsNone),false);
const trojanNone={protocol:'trojan',streamSettings:{network:'raw',security:'none'}};
assert.equal(normalize(trojanNone),false);
const hysteriaNone={protocol:'hysteria',streamSettings:{network:'hysteria',security:'none'}};
assert.equal(normalize(hysteriaNone),false);
const unknown={protocol:'vless',streamSettings:{network:'raw',security:'unexpected'}};
assert.equal(normalize(unknown),true);
assert.equal(unknown.streamSettings.security,'none');

const pathA=policy.randomXhttpPath();
const pathB=policy.randomXhttpPath();
assert.match(pathA,/^\/[A-Za-z0-9_-]{64}$/);
assert.match(pathB,/^\/[A-Za-z0-9_-]{64}$/);
assert.notEqual(pathA,pathB,'Consecutive generated XHTTP paths must not be reused');

const rawInbound={protocol:'vless',streamSettings:{network:'raw',security:'reality'}};
const createdXhttp=policy.ensureXhttpSettings(rawInbound);
assert.equal(rawInbound.streamSettings.network,'xhttp');
assert.equal(createdXhttp.mode,'auto');
assert.match(createdXhttp.path,/^\/[A-Za-z0-9_-]{64}$/);
assert.equal(rawInbound.streamSettings.security,'reality');
const existingXhttp={protocol:'vless',streamSettings:{network:'xhttp',security:'tls',xhttpSettings:{path:'/custom-path',mode:'stream-up'}}};
const existingSettings=policy.ensureXhttpSettings(existingXhttp);
assert.equal(existingSettings.path,'/custom-path');
assert.equal(existingSettings.mode,'stream-up');
assert.equal(existingXhttp.streamSettings.security,'tls');

assert.equal(JSON.stringify(policy.xhttpExtraObject({extra:'{"xPaddingBytes":"120-900","xmux":{"maxConcurrency":"8-16"}}'})),JSON.stringify({xPaddingBytes:'120-900',xmux:{maxConcurrency:'8-16'}}));
const migrated={path:'/p',mode:'stream-up',headers:{Accept:'*/*'},sessionIDPlacement:'cookie',extra:{xPaddingBytes:'32-1024'}};
const migratedExtra=policy.materializeXhttpExtra(migrated);
assert.equal(JSON.stringify(migratedExtra.headers),JSON.stringify({Accept:'*/*'}));
assert.equal(migratedExtra.sessionIDPlacement,'cookie');
assert.equal(migratedExtra.xPaddingBytes,'32-1024');
assert.equal(migrated.headers,undefined);
assert.equal(migrated.sessionIDPlacement,undefined);
assert.equal(migrated.path,'/p');
assert.equal(migrated.mode,'stream-up');

const randomProfile=policy.randomXhttpAdvancedProfile('stream-up','firefox');
assert.ok(randomProfile.headers['User-Agent'].includes('Firefox/'));
assert.equal(randomProfile.xPaddingMethod,'tokenish');
assert.equal(randomProfile.uplinkHTTPMethod,'POST');
assert.equal(randomProfile.sessionIDTable,'Base62');
assert.match(String(randomProfile.sessionIDLength),/^\d+-\d+$/);
assert.ok(['cookie','query','header'].includes(randomProfile.sessionIDPlacement));
assert.ok(['cookie','query','header'].includes(randomProfile.seqPlacement));
assert.equal(randomProfile.xmux.maxConnections,0);
assert.equal(randomProfile.xmux.hKeepAlivePeriod,0);

const previousRaw={inbounds:[{tag:'main',streamSettings:{network:'raw',security:'none'}}]};
const generatedXhttp={inbounds:[{tag:'main',streamSettings:{network:'xhttp',security:'none',xhttpSettings:{path:'/xhttp',mode:'auto'}}}]};
assert.equal(policy.randomizeDocument(generatedXhttp,previousRaw),true);
assert.match(generatedXhttp.inbounds[0].streamSettings.xhttpSettings.path,/^\/[A-Za-z0-9_-]{64}$/);
const legacyPrevious={inbounds:[{tag:'legacy',streamSettings:{network:'xhttp',xhttpSettings:{path:'/xhttp',mode:'auto'}}}]};
const legacyCurrent=JSON.parse(JSON.stringify(legacyPrevious));
assert.equal(policy.randomizeDocument(legacyCurrent,legacyPrevious),false);
assert.equal(legacyCurrent.inbounds[0].streamSettings.xhttpSettings.path,'/xhttp');
const composerRebuild=JSON.parse(JSON.stringify(legacyPrevious));
assert.equal(policy.randomizeDocument(composerRebuild,legacyPrevious,true),true);
assert.match(composerRebuild.inbounds[0].streamSettings.xhttpSettings.path,/^\/[A-Za-z0-9_-]{64}$/);

const fragmentDefaults={packets:'tlshello',lengths:['3-5','6-8','10-20'],delays:['10-20'],maxSplit:'3-6'};
const noiseDefaults={reset:'30-60',noise:[{rand:'8-32',delay:'10-20'}]};
const tcpHeaderDefaults={clients:[[{type:'str',packet:'HELLO'}]],servers:[[{type:'str',packet:'WELCOME'}]]};
const udpHeaderDefaults={client:[{type:'hex',packet:'a1b2c3d4'}],server:[{type:'hex',packet:'d4c3b2a1'}]};
const finalmaskBefore={inbounds:[{tag:'mask',streamSettings:{network:'raw',finalmask:{}},xmesh:{clientFinalmask:{}}}]};
const finalmaskGenerated={inbounds:[{tag:'mask',streamSettings:{network:'raw',finalmask:{tcp:[{type:'header-custom',settings:tcpHeaderDefaults}],udp:[{type:'header-custom',settings:udpHeaderDefaults}]}},xmesh:{clientFinalmask:{tcp:[{type:'fragment',settings:fragmentDefaults}],udp:[{type:'noise',settings:noiseDefaults}]}}}]};
assert.equal(policy.randomizeDocument(finalmaskGenerated,finalmaskBefore),true);
const randomized=finalmaskGenerated.inbounds[0];
assert.notDeepEqual(randomized.xmesh.clientFinalmask.tcp[0].settings,fragmentDefaults);
assert.notDeepEqual(randomized.xmesh.clientFinalmask.udp[0].settings,noiseDefaults);
assert.notDeepEqual(randomized.streamSettings.finalmask.tcp[0].settings,tcpHeaderDefaults);
assert.notDeepEqual(randomized.streamSettings.finalmask.udp[0].settings,udpHeaderDefaults);

assert.ok((listeners.change||[]).length>0);
assert.ok((listeners.input||[]).length>0);
assert.ok((listeners.pointerdown||[]).length>0);
assert.ok((listeners.click||[]).length>0);
assert.match(source,/XHTTP · конструктор/);
assert.match(source,/type:'cards'/);
for(const label of ['AUTO · Универсальный','PACKET-UP · Совместимость','STREAM-UP · Потоковый upload','STREAM-ONE · Один поток','Полный randomized profile','Browser Headers','Padding & HTTP disguise','Session ID & Sequence','Uplink layout','XMUX','Server limits','Разделение download','H2 Params','Расширенный JSON'])
 assert.ok(source.includes(label),'XHTTP constructor is missing card: '+label);
for(const field of ['xPaddingObfsMode','xPaddingKey','xPaddingHeader','xPaddingPlacement','xPaddingMethod','uplinkHTTPMethod','sessionIDPlacement','sessionIDKey','sessionIDTable','sessionIDLength','seqPlacement','seqKey','uplinkDataPlacement','uplinkDataKey','uplinkChunkSize','serverMaxHeaderBytes','downloadSettings','h2Params'])
 assert.ok(source.includes(field),'XHTTP constructor is missing field: '+field);
assert.match(source,/data-tool=\\?"xhttp\\?"/);
assert.match(source,/data-compose-apply/);
assert.match(source,/dataset\.field!=='security'/);
assert.doesNotMatch(source,/field!=='protocol'/);
assert.doesNotMatch(source,/field!=='transport'/);
console.log('XRAY STUDIO security policy + randomized XHTTP/FinalMask generation + full XHTTP card menu: OK');
