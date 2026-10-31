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
const normalize=sandbox.window.XMeshProtocolTlsPolicy?.normalizeInbound;
assert.equal(typeof normalize,'function','TLS policy must export normalizeInbound for regression checks');

const cert={certificateFile:'/etc/xray/server.crt',keyFile:'/etc/xray/server.key'};

const trojan={protocol:'trojan',streamSettings:{network:'raw',security:'none',tlsSettings:{certificates:[cert]}}};
assert.equal(normalize(trojan),true);
assert.equal(trojan.streamSettings.security,'tls','Trojan must enable TLS automatically');
assert.deepEqual(trojan.streamSettings.tlsSettings.certificates[0],cert,'Existing Trojan certificate paths must be preserved');

const vless={protocol:'vless',streamSettings:{network:'xhttp',security:'tls',tlsSettings:{certificates:[cert]}}};
assert.equal(normalize(vless),true);
assert.equal(vless.streamSettings.security,'none','VLESS must not inherit TLS from the previous protocol');
assert.deepEqual(vless.streamSettings.tlsSettings.certificates[0],cert,'Disabling TLS must not destroy reusable certificate paths');

const vmess={protocol:'vmess',streamSettings:{network:'raw',security:'tls'}};
assert.equal(normalize(vmess),true);
assert.equal(vmess.streamSettings.security,'none','VMess must not inherit TLS from the previous protocol');

const hysteria={protocol:'hysteria',streamSettings:{network:'hysteria',security:'none',tlsSettings:{certificates:[],alpn:['h3']}}};
assert.equal(normalize(hysteria),true);
assert.equal(hysteria.streamSettings.security,'tls','Hysteria2 must enable TLS automatically');
assert.deepEqual(hysteria.streamSettings.tlsSettings.alpn,['h3'],'Hysteria2 h3 TLS settings must survive normalization');

const reality={protocol:'vless',streamSettings:{network:'xhttp',security:'reality',realitySettings:{serverNames:['example.org']}}};
assert.equal(normalize(reality),false);
assert.equal(reality.streamSettings.security,'reality','Manual VLESS Reality must not be disabled by the TLS policy');

console.log('XRAY STUDIO protocol TLS policy: OK');
