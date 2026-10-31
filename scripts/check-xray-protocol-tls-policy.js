#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');

const source=fs.readFileSync('xray-studio-protocol-tls.js','utf8');
const listeners={};
class HTMLSelectElement{}
const sandbox={
 window:{},
 HTMLSelectElement,
 Event:class Event{constructor(type,init={}){this.type=type;Object.assign(this,init)}},
 setTimeout:()=>0,
 document:{addEventListener(type,fn){(listeners[type]??=[]).push(fn)}}
};
vm.runInNewContext(source,sandbox,{filename:'xray-studio-protocol-tls.js'});
const policy=sandbox.window.XMeshProtocolTlsPolicy;
const normalize=policy?.normalizeInbound;
assert.equal(typeof normalize,'function','Smart security policy must export normalizeInbound');
assert.equal(typeof policy?.desiredSecurity,'function','Smart security policy must expose its decision function');

const cert={certificateFile:'/etc/xray/server.crt',keyFile:'/etc/xray/server.key'};

const trojan={protocol:'trojan',streamSettings:{network:'raw',security:'none',tlsSettings:{certificates:[cert]}}};
assert.equal(normalize(trojan),true);
assert.equal(trojan.streamSettings.security,'tls','Trojan must enable TLS automatically');
assert.deepEqual(trojan.streamSettings.tlsSettings.certificates[0],cert,'Trojan certificate paths must be preserved');

const vlessXhttp={protocol:'vless',streamSettings:{network:'xhttp',security:'none'}};
assert.equal(normalize(vlessXhttp),true);
assert.equal(vlessXhttp.streamSettings.security,'tls','VLESS + XHTTP must automatically enable TLS');

const vlessXhttpReality={protocol:'vless',streamSettings:{network:'xhttp',security:'reality',realitySettings:{serverNames:['example.org']}}};
assert.equal(normalize(vlessXhttpReality),false);
assert.equal(vlessXhttpReality.streamSettings.security,'reality','Valid VLESS + XHTTP + REALITY must be preserved');

const vmessWs={protocol:'vmess',streamSettings:{network:'ws',security:'none'}};
assert.equal(normalize(vmessWs),true);
assert.equal(vmessWs.streamSettings.security,'tls','VMess + WebSocket must automatically enable TLS');

const grpcReality={protocol:'vless',streamSettings:{network:'grpc',security:'reality',realitySettings:{privateKey:'configured'}}};
assert.equal(normalize(grpcReality),false);
assert.equal(grpcReality.streamSettings.security,'reality','Valid gRPC REALITY must not be overwritten by TLS');

const realityToWs={protocol:'vless',streamSettings:{network:'ws',security:'reality',realitySettings:{serverNames:['example.org']}}};
assert.equal(normalize(realityToWs),true);
assert.equal(realityToWs.streamSettings.security,'tls','Incompatible REALITY on WebSocket must be repaired to TLS');

const vlessRawTls={protocol:'vless',streamSettings:{network:'raw',security:'tls',tlsSettings:{certificates:[cert]}}};
assert.equal(normalize(vlessRawTls),false);
assert.equal(vlessRawTls.streamSettings.security,'tls','Explicit VLESS RAW TLS must be preserved');

const vlessRawConfigured={protocol:'vless',streamSettings:{network:'raw',security:'none',tlsSettings:{certificates:[cert]}}};
assert.equal(normalize(vlessRawConfigured),true);
assert.equal(vlessRawConfigured.streamSettings.security,'tls','VLESS RAW should reuse complete configured TLS material');

const xdrive={protocol:'vless',streamSettings:{network:'xdrive',security:'tls',tlsSettings:{certificates:[cert]}}};
assert.equal(normalize(xdrive),true);
assert.equal(xdrive.streamSettings.security,'none','XDRIVE must disable stream TLS automatically');
assert.deepEqual(xdrive.streamSettings.tlsSettings.certificates[0],cert,'Disabling TLS must not destroy reusable certificate paths');

const socks={protocol:'socks',streamSettings:{network:'xhttp',security:'tls'}};
assert.equal(normalize(socks),true);
assert.equal(socks.streamSettings.network,'raw','SOCKS must normalize to RAW transport');
assert.equal(socks.streamSettings.security,'none','SOCKS must not inherit public TLS mode');

const hysteria={protocol:'hysteria',streamSettings:{network:'raw',security:'none',tlsSettings:{certificates:[]}}};
assert.equal(normalize(hysteria),true);
assert.equal(hysteria.streamSettings.network,'hysteria','Hysteria2 must select its native transport');
assert.equal(hysteria.streamSettings.security,'tls','Hysteria2 must enable TLS automatically');
assert.ok(hysteria.streamSettings.tlsSettings.alpn.includes('h3'),'Hysteria2 must ensure h3 ALPN');

const masque={protocol:'masque',streamSettings:{network:'raw',security:'none'}};
assert.equal(normalize(masque),true);
assert.equal(masque.streamSettings.network,'masque','MASQUE must select its native transport');
assert.equal(masque.streamSettings.security,'tls','MASQUE must enable TLS automatically');
assert.ok(masque.streamSettings.tlsSettings.alpn.includes('h3'),'MASQUE must ensure h3 ALPN');

console.log('XRAY STUDIO smart protocol/transport security policy: OK');
