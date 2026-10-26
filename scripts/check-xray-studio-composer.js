#!/usr/bin/env node
'use strict';
/* Matrix + secure generation regressions for the XRAY STUDIO combinatorial composer. */
const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=fs.readFileSync('xray-studio-composer.js','utf8');
const studio=fs.readFileSync('xray-studio-v4.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
const css=fs.readFileSync('xray-studio-v4.css','utf8');
new Function(source);new Function(studio);
const env={window:{}};
vm.runInNewContext(source,env,{filename:'xray-studio-composer.js'});
const C=env.window.XMeshStudioComposer;
assert(C&&C.protocols&&C.transports&&C.securities,'Composer must export independent dimensions');
assert(C.protocols.some(x=>x.id==='shadowsocks'));
assert(C.transports.some(x=>x.id==='xhttp'));
assert(C.securities.some(x=>x.id==='reality'));
assert(C.presets.length>=10,'Optional starter recipes remain');
assert(C.presets.some(x=>x.protocol==='shadowsocks'&&x.transport==='xhttp'&&x.security==='reality'),'Shadowsocks XHTTP Reality must be a first-class example');
const comboCount=C.countKnownCombinations();
assert(comboCount>=90,'Matrix must support many combinations, not twelve templates');
assert(comboCount<=C.protocols.length*C.transports.length*C.securities.length);
const cfg={protocol:'shadowsocks',transport:'xhttp',security:'reality',
 tag:'ss-xhttp-reality',listen:'127.0.0.1',port:443,path:'/p',
 method:'2022-blake3-aes-256-gcm',target:'front.example.net:443',sni:'front.example.net'};
const compat=C.analyze(cfg);
assert.equal(compat.errors.length,0,'Shadowsocks XHTTP REALITY is permitted by the transport compatibility table');
assert(compat.warnings.some(x=>x.includes('UDP')),'SS native UDP/XUDP caveat must be visible');
const preview=C.buildInbound(cfg);
assert.equal(preview.protocol,'shadowsocks');
assert.equal(preview.streamSettings.network,'xhttp');
assert.equal(preview.streamSettings.security,'reality');
assert.equal(preview.streamSettings.xhttpSettings.path,'/p');
assert.equal(preview.streamSettings.realitySettings.privateKey,'','Preview must not manufacture key');
assert.equal(preview.streamSettings.realitySettings.target,cfg.target);
assert.equal(preview.streamSettings.realitySettings.serverNames[0],cfg.sni);
assert.equal(preview.settings.method,cfg.method);
assert(preview.settings.password.includes('ПРИ_СОЗДАНИИ'),'Preview must label future secret');
assert.deepEqual(Array.from(preview.streamSettings.realitySettings.shortIds),[],'Never silently inject Short ID or login');
const real=C.buildInbound(cfg,{shadowsocksPassword:'real-ss-secret',realityKeys:{privateKey:'A'.repeat(43),shortId:'0a0b0c0d'}});
assert.equal(real.settings.password,'real-ss-secret');
assert.equal(real.streamSettings.realitySettings.privateKey,'A'.repeat(43));
assert.equal(real.streamSettings.realitySettings.shortIds[0],'0a0b0c0d');
const versions=[
 {protocol:'vless',transport:'raw',security:'reality'},
 {protocol:'vmess',transport:'ws',security:'tls'},
 {protocol:'trojan',transport:'grpc',security:'tls'},
 {protocol:'shadowsocks',transport:'raw',security:'none'},
 {protocol:'hysteria',transport:'hysteria',security:'tls'},
 {protocol:'masque',transport:'masque',security:'tls'},
 {protocol:'socks',transport:'raw',security:'none'},
 {protocol:'http',transport:'raw',security:'none'}
];
for(const [i,entry] of versions.entries()){
 const opts={...entry,tag:'in-'+i,port:443,listen:'127.0.0.1'};
 assert.equal(C.analyze(opts).errors.length,0,'Known supported transport '+JSON.stringify(entry));
 const doc=C.buildDocument(opts);
 assert.equal(doc.inbounds[0].protocol,entry.protocol);
 assert.equal(doc.inbounds[0].streamSettings.security,entry.security);
 assert.equal(doc.inbounds[0].streamSettings.network,entry.transport);
}
assert.equal(C.buildInbound({protocol:'hysteria',transport:'hysteria',security:'tls',tag:'hy',port:443}).settings.version,2);
assert.equal(C.buildInbound({protocol:'hysteria',transport:'hysteria',security:'tls',tag:'hy',port:443}).streamSettings.hysteriaSettings.version,2);
const masque=C.buildInbound({protocol:'masque',transport:'masque',security:'tls',tag:'mq',port:443});
assert.deepEqual(Array.from(masque.settings.address),['10.129.0.1/24'],'MASQUE must have a server tunnel address');
assert.deepEqual(Array.from(masque.settings.users),[],'MASQUE must expose user slots for panel provisioning');
// Transport-specific TLS ALPN must be generated and editable in the UI.
for(const [transport,expected] of [
 ['xhttp',['h2','http/1.1']],['grpc',['h2']],
 ['ws',['http/1.1']],['httpupgrade',['http/1.1']],
 ['hysteria',['h3']],['masque',['h3']]
]){
 const protocol=transport==='hysteria'||transport==='masque'?transport:'vless';
 const generated=C.buildInbound({protocol,transport,security:'tls',tag:'tls-'+transport});
 assert.deepEqual(Array.from(generated.streamSettings.tlsSettings.alpn),expected,'Auto ALPN for '+transport);
}
const withCert=C.buildInbound({protocol:'vless',transport:'xhttp',security:'tls',tag:'tls-files',
 alpn:'h2',certificateFile:'/etc/xray/fullchain.pem',keyFile:'/etc/xray/privkey.pem'});
assert.deepEqual(Array.from(withCert.streamSettings.tlsSettings.alpn),['h2']);
assert.equal(withCert.streamSettings.tlsSettings.certificates[0].certificateFile,'/etc/xray/fullchain.pem');
assert.equal(withCert.streamSettings.tlsSettings.certificates[0].keyFile,'/etc/xray/privkey.pem');
assert(C.analyze({protocol:'vless',transport:'xhttp',security:'tls',certificateFile:'only-cert'}).errors.length);
assert(C.analyze({protocol:'vless',transport:'grpc',security:'tls',alpn:'http/1.1'}).errors.length);
assert(C.analyze({protocol:'vless',transport:'xhttp',security:'tls',alpn:'bad'}).errors.length);
assert(C.analyze({protocol:'vless',transport:'xhttp',security:'tls'}).warnings.some(x=>x.includes('certificateFile')));
for(const name of ['alpn','certificateFile','keyFile'])
 assert(studio.includes('data-compose-field="'+name+'"'),'Builder exposes '+name);

const invalid=C.analyze({protocol:'vless',transport:'ws',security:'reality'});
assert(invalid.errors.length,'WebSocket REALITY is not supported by Xray docs');
assert.throws(()=>C.buildInbound({protocol:'vless',transport:'ws',security:'reality',tag:'bad',port:443}),/REALITY/);
assert.equal(C.buildInbound({protocol:'vless',transport:'ws',security:'reality',allowExperimental:true,tag:'experimental',port:443}).tag,'experimental');
const future=C.analyze({protocol:'custom',customProtocol:'future-protocol',transport:'custom',customTransport:'future-net',security:'tls'});
assert.equal(future.status,'unknown');
assert.equal(future.errors.length,0,'Future core names must not be blocked by the 2026 catalog');
assert.equal(C.buildInbound({protocol:'custom',customProtocol:'future-protocol',transport:'custom',customTransport:'future-net',security:'tls',tag:'future',port:443}).protocol,'future-protocol');
const original={log:{loglevel:'debug'},inbounds:[{tag:'existing',protocol:'vless',settings:{users:[],decryption:'none'}}],
 customMetadata:{subscribers:['keep'],extensions:{version:7}},outbounds:[{tag:'direct',protocol:'freedom'}]};
const before=JSON.stringify(original);
const appended=C.buildDocument({protocol:'shadowsocks',transport:'raw',security:'none',tag:'new-ss',port:8388,mode:'add'},
 original,{shadowsocksPassword:'new-secret'});
assert.equal(JSON.stringify(original),before,'Append cannot mutate source document');
assert.equal(appended.inbounds.length,2);
assert.equal(appended.customMetadata.extensions.version,7,'Unknown top-level fields must be preserved');
assert.equal(appended.inbounds[0].tag,'existing','Old inbound is unchanged');
assert.equal(appended.inbounds[1].settings.password,'new-secret');
assert.throws(()=>C.buildDocument({protocol:'vless',transport:'raw',security:'tls',tag:'existing',port:443,mode:'add'},original),/существует/,'Duplicate inbound tag blocked');
assert.throws(()=>C.buildDocument({protocol:'vless',transport:'raw',security:'tls',tag:'safe',port:0,mode:'new'}),/Порт/);
assert.throws(()=>C.buildDocument({protocol:'vless',transport:'raw',security:'tls',tag:'<script>',port:443,mode:'new'}),/Тег/);
assert.throws(()=>C.buildDocument({protocol:'vless',transport:'raw',security:'tls',tag:'safe',port:443,listen:'bad location',mode:'new'}),/адрес/);
// The 2022-blake3-aes-128/256 keys are 16/32 bytes, produced with cryptographic entropy only.
let nonce=0;
const rng={getRandomValues(bytes){nonce++;for(let i=0;i<bytes.length;i++)bytes[i]=(i*29+nonce*17)&255;return bytes}};
for(const method of C.shadowsocksMethods){
 const pass=C.generateShadowsocksPassword(method.id,rng);
 assert.equal(Buffer.from(pass,'base64').length,method.bytes,'Correct key length for '+method.id);
 assert(/^[A-Za-z0-9+/]+={0,2}$/.test(pass),'Base64 password for Shadowsocks');
}
assert.throws(()=>C.generateShadowsocksPassword('2022-blake3-aes-256-gcm',null),/генератор/);
assert(studio.includes('function openComposer()'),'Studio must mount composer');
assert(!studio.includes('const templates=['),'Fixed list must not be the only mode');
assert(studio.includes('engine.buildDocument(chosen,activeJson'),'Studio must use the reusable document generator');
assert(studio.includes("if(overlay.hidden||!scope.isConnected)"),'Closed modal must not commit an async generated key');
assert(studio.includes('selectionSignature=JSON.stringify(opts)'),'Composer must detect async option changes');
assert(studio.includes("unsavedApproval('Создать новую конфигурацию"),'Destructive replacement needs permission');
assert(studio.includes("get('overlay').classList.remove('sv-overlay-composer')"),'Dialog can return to normal layout');
assert(html.includes('/xray-studio-composer.js?v='),'Composer must load before Studio');
assert(html.indexOf('xray-studio-composer.js')<html.indexOf('xray-studio-v4.js'),'Correct script order');
assert(docker.includes('xray-studio-composer.js'),'Production Docker must include module');
assert(css.includes('.sv-compose-workspace'),'Enterprise composer styles must exist');
assert(css.includes('.sv-compose-preview'),'JSON preview must exist');
console.log('XRAY STUDIO composer: '+comboCount+' documented combinations, Shadowsocks XHTTP REALITY, safe generator, append/no-overwrite and UI packaging OK.');
