/* Cross-protocol regression checks for XRAY STUDIO. Run: node scripts/check-studio-protocol-matrix.js */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ctx={window:{}};
vm.runInNewContext(fs.readFileSync('xray-studio-composer.js','utf8'),ctx);
const C=ctx.window.XMeshStudioComposer;
const cases=[
 ['vless','raw','none'],['vmess','ws','tls'],['trojan','grpc','tls'],
 ['shadowsocks','raw','none'],['socks','raw','none'],['http','raw','none'],
 ['hysteria','hysteria','tls'],['masque','masque','tls']
];
for(const [protocol,transport,security] of cases){
 const o={protocol,transport,security,tag:'test-'+protocol,port:12443,listen:'127.0.0.1'};
 const review=C.analyze(o);
 assert.deepEqual(Array.from(review.errors),[],protocol+' compatibility errors: '+review.errors.join('; '));
 const x=C.buildInbound(o,{shadowsocksPassword:'c2VydmVyU2VjcmV0'});
 assert.equal(x.protocol,protocol);
 assert.equal(x.streamSettings.network,transport);
 assert.equal(x.streamSettings.security,security);
 assert.equal(x.tag,'test-'+protocol);
 assert.equal(typeof x.settings,'object');
 if(['vless','vmess','trojan','hysteria'].includes(protocol))assert(Array.isArray(x.settings.users),protocol+' users');
 if(protocol==='vless')assert.equal(x.settings.decryption,'none');
 if(protocol==='hysteria')assert.equal(x.settings.version,2);
 if(protocol==='shadowsocks')assert.equal(x.settings.method,'2022-blake3-aes-256-gcm');
 if(security==='tls')assert(Array.isArray(x.streamSettings.tlsSettings.certificates));
}
for(const bad of [
 {protocol:'vmess',transport:'hysteria',security:'tls'},
 {protocol:'trojan',transport:'masque',security:'tls'},
 {protocol:'hysteria',transport:'raw',security:'tls'},
 {protocol:'masque',transport:'masque',security:'none'},
 {protocol:'vless',transport:'xdrive',security:'none'}
])assert(C.analyze(bad).errors.length,'Must reject '+JSON.stringify(bad));
console.log('XRAY STUDIO protocol matrix OK: '+cases.map(x=>x[0]).join(', '));
