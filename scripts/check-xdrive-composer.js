/* Regression coverage for XDRIVE in XRAY STUDIO composer. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={window:{}};
vm.runInNewContext(fs.readFileSync('xray-studio-composer.js','utf8'),context);
const C=context.window.XMeshStudioComposer;
assert(C.transports.some(t=>t.id==='xdrive'),'XDRIVE must appear in transport picker');
const valid={protocol:'vless',transport:'xdrive',security:'none',
 tag:'drive-main',port:443,listen:'127.0.0.1',
 vlessDecryption:'test-decryption-value',xdriveService:'local',xdriveRemoteFolder:'/tmp/xdrive'};
assert.equal(C.analyze(valid).errors.length,0);
const ib=C.buildInbound(valid);
assert.equal(ib.streamSettings.network,'xdrive');
assert.equal(ib.streamSettings.security,'none');
assert.equal(ib.settings.decryption,'test-decryption-value');
assert.equal(ib.streamSettings.xdriveSettings.service,'local');
assert.equal(ib.streamSettings.xdriveSettings.remoteFolder,'/tmp/xdrive');
assert(C.analyze({...valid,protocol:'vmess'}).errors.length);
assert(C.analyze({...valid,security:'tls'}).errors.length);
assert(C.analyze({...valid,vlessDecryption:'none'}).errors.length);
assert(C.analyze({...valid,xdriveRemoteFolder:''}).errors.length);
const google=C.buildInbound({...valid,xdriveService:'google-drive',xdriveSecrets:'id\nsecret\nrefresh'});
assert.equal(google.streamSettings.xdriveSettings.secrets.length,3);
assert(C.analyze({...valid,xdriveService:'google-drive',xdriveSecrets:'one'}).errors.length);
const templ=C.buildInbound({...valid,xdriveService:'template',xdriveTemplate:'{"auth":{}}'});
assert.equal(templ.streamSettings.xdriveSettings.template.auth.constructor,Object);
assert(C.analyze({...valid,xdriveService:'template',xdriveTemplate:'not json'}).errors.length);
console.log('XDRIVE composer validation and serialization OK');
