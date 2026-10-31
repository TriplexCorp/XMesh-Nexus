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
assert.equal(typeof normalize,'function','TLS policy must export normalizeInbound');
assert.equal(typeof policy?.desiredSecurity,'function','TLS policy must expose its decision function');

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

assert.ok((listeners.change||[]).length>0,'Policy must observe Security selector changes');
assert.match(source,/dataset\.field!=='security'/,'Policy must only react to the Security selector');
assert.doesNotMatch(source,/field!=='protocol'/,'Protocol changes must not drive TLS activation');
assert.doesNotMatch(source,/field!=='transport'/,'Transport changes must not drive TLS activation');

console.log('XRAY STUDIO authoritative security/TLS activation policy: OK');
