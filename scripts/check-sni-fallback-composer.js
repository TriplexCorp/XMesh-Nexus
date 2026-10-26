/* Shared-port SNI fallback regression checks. Run: node scripts/check-sni-fallback-composer.js */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={window:{}};
vm.runInNewContext(fs.readFileSync('xray-studio-composer.js','utf8'),context);
const C=context.window.XMeshStudioComposer;
const base={protocol:'vless',transport:'raw',security:'tls',listen:'0.0.0.0',port:443,
 tag:'tls-entry',sniFallbackRoutes:'vmess.example.com 10001\ntrojan.example.com 10002'};
assert.deepEqual(Array.from(C.analyze(base).errors),[]);
const inbound=C.buildInbound(base);
assert.equal(inbound.settings.fallbacks.length,2);
assert.equal(inbound.settings.fallbacks[0].name,'vmess.example.com');
assert.equal(inbound.settings.fallbacks[0].dest,'127.0.0.1:10001');
assert.equal(inbound.settings.fallbacks[1].dest,'127.0.0.1:10002');
assert.equal(inbound.streamSettings.network,'raw');
assert.equal(inbound.streamSettings.security,'tls');
assert.equal(C.buildInbound({...base,protocol:'trojan'}).settings.fallbacks.length,2);
for(const config of [
 {...base,protocol:'vmess'},
 {...base,transport:'ws'},
 {...base,security:'reality'},
 {...base,sniFallbackRoutes:'vmess.example.com 443'},
 {...base,sniFallbackRoutes:'vmess.example.com not-port'},
 {...base,sniFallbackRoutes:'vmess.example.com 10001\nVMESS.EXAMPLE.COM 10002'}
])assert(C.analyze(config).errors.length,JSON.stringify(config));
assert(!Object.hasOwn(C.buildInbound({...base,sniFallbackRoutes:''}).settings,'fallbacks'));
console.log('Shared TCP TLS SNI fallback generation: OK');
