#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('xray-studio-xhttp-strict.js','utf8');
const sandbox={
 window:{},document:{addEventListener(){}},crypto:webcrypto,
 globalThis:null,Event:function(){},console
};
sandbox.globalThis=sandbox;
vm.runInNewContext(source,sandbox,{filename:'xray-studio-xhttp-strict.js'});
const api=sandbox.window.XMeshXhttpStrict;
assert(api,'Strict XHTTP API must be exported');

const stream=api.generatedProfile('stream-up','minimal');
assert('scStreamUpServerSecs' in stream,'stream-up must get stream keepalive');
for(const key of ['scMaxEachPostBytes','scMinPostsIntervalMs','scMaxBufferedPosts'])
 assert(!(key in stream),`stream-up must not generate packet-only ${key}`);

const packet=api.generatedProfile('packet-up','minimal');
for(const key of ['scMaxEachPostBytes','scMinPostsIntervalMs','scMaxBufferedPosts'])
 assert(key in packet,`packet-up must generate ${key}`);
assert(!('scStreamUpServerSecs' in packet),'packet-up must not generate stream-up keepalive');

const auto=api.generatedProfile('auto','minimal');
for(const key of ['scMaxEachPostBytes','scMinPostsIntervalMs','scMaxBufferedPosts','scStreamUpServerSecs'])
 assert(!(key in auto),`auto preset must stay neutral and omit ${key}`);

let errors=api.validateSettings({path:'/x',mode:'stream-up',extra:{scMaxEachPostBytes:'500000-1000000'}});
assert(errors.some(x=>x.includes('packet-up')),'stream-up must reject packet-up tuning');
errors=api.validateSettings({path:'/x',mode:'stream-up',extra:{h2Params:{}}});
assert(errors.some(x=>x.includes('Неизвестный параметр Xray-core: h2Params')),'unknown h2Params must be rejected');
errors=api.validateSettings({path:'/x',mode:'stream-up',extra:{uplinkHTTPMethod:'GET'}});
assert(errors.some(x=>x.includes('GET допустим только')),'GET must be rejected outside packet-up');
errors=api.validateSettings({path:'/x',mode:'stream-one',extra:{uplinkDataPlacement:'header'}});
assert(errors.some(x=>x.includes('header допустим только')),'header uplink placement must be packet-up only');
errors=api.validateSettings({path:'/x',mode:'packet-up',extra:{xmux:{maxConnections:2,maxConcurrency:4}}});
assert(errors.some(x=>x.includes('нельзя задавать одновременно')),'mutually exclusive xmux strategies must be rejected');

const dirty={path:'/x',mode:'packet-up',extra:{
 scMaxEachPostBytes:'500000-1000000',scMinPostsIntervalMs:'10-30',scMaxBufferedPosts:30,
 scStreamUpServerSecs:'20-60',uplinkHTTPMethod:'GET',uplinkDataPlacement:'header'
}};
api.normalizeForMode(dirty,'stream-up');
for(const key of ['scMaxEachPostBytes','scMinPostsIntervalMs','scMaxBufferedPosts'])
 assert(!(key in dirty.extra),`mode switch must delete ${key}`);
assert.equal(dirty.extra.scStreamUpServerSecs,'20-60');
assert.equal(dirty.extra.uplinkHTTPMethod,'POST');
assert.equal(dirty.extra.uplinkDataPlacement,'auto');
assert.deepEqual(api.validateSettings(dirty),[]);

const html=fs.readFileSync('index.html','utf8');
assert(html.indexOf('xray-studio-xhttp-strict.js')<html.indexOf('xray-studio-protocol-tls.js'),
 'strict XHTTP click handler must load before legacy XHTTP handler');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
assert.match(docker,/xray-studio-xhttp-strict\.js/);
assert.match(docker,/xray-xhttp-core-validator\.js/);
console.log('XHTTP strict core schema and mode-specific generation: OK');
