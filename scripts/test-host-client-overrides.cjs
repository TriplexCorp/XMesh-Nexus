'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const gen=require('../frontend/js/features/users/client-config.js');
const user={xrayId:'3b4ac49b-d220-4e9a-a91a-236e95623eb8'};
const host={address:'node.example',port:443,remark:'Test'};
const inbound={protocol:'vless',settings:{decryption:'none'},streamSettings:{network:'xhttp',security:'tls',tlsSettings:{serverName:'profile.example'},xhttpSettings:{path:'/profile',mode:'auto'}}};
const build=(h,i=inbound)=>gen.build(user,{...host,...h},i).outbounds[0].streamSettings;
const settings={mode:'stream-one',headers:{'User-Agent':'Client'},xmux:{maxConcurrency:4},downloadSettings:{address:'download.example'},serverMaxHeaderBytes:999};
const projected=build({clientXhttpSettings:settings,clientTlsSettings:{minVersion:'1.3',enableSessionResumption:true,certificates:[{keyFile:'never-export'}]}});
assert.equal(projected.xhttpSettings.mode,'stream-one');
assert.deepEqual(projected.xhttpSettings.xmux,{maxConcurrency:4});
assert.equal(projected.xhttpSettings.downloadSettings.address,'download.example');
assert(!('serverMaxHeaderBytes' in projected.xhttpSettings));
assert.equal(projected.tlsSettings.minVersion,'1.3');assert(!('certificates' in projected.tlsSettings));
assert.equal(build({clientXhttpSettings:settings,path:'/host'}).xhttpSettings.path,'/host');
const ws={...inbound,streamSettings:{network:'ws',security:'tls',wsSettings:{path:'/ws'}},xmesh:{clientHeaders:{'User-Agent':'Inherited'}}};
assert.equal(build({clientHeaders:null},ws).wsSettings.headers['User-Agent'],'Inherited');
assert.deepEqual(build({clientHeaders:{}},ws).wsSettings.headers,{});
assert.equal(build({clientHeaders:{'User-Agent':'Explicit'},host:'override.example'},ws).wsSettings.headers.Host,'override.example');
const source=fs.readFileSync('frontend/js/core/app.js','utf8');
const start=source.indexOf('    chk:d=>{',source.indexOf('  hosts:{')),end=source.indexOf('\n    cols:',start);
const check=new Function('panelIsEnglish','return ('+source.slice(start,end).trim().slice(4).replace(/,\s*$/,'')+');')(()=>false);
for(const key of ['clientXhttpSettings','clientHeaders','clientTlsSettings','clientMasqueSettings']){
 for(const raw of ['[]','null','true','broken'])assert(check({disabled:true,[key]:raw}).includes(key),'Invalid JSON must identify its field');
 const clear={disabled:true,[key]:''};assert.equal(check(clear),'');assert.equal(clear[key],null);
 const explicit={disabled:true,[key]:'{"mode":"auto"}'};assert.equal(check(explicit),'');assert.deepEqual(explicit[key],{mode:'auto'});
}
console.log('Host client overrides: inheritance, clearing, serialization, precedence, secret exclusion and validation passed');
