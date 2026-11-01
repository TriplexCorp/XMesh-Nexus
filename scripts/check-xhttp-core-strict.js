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

const streamServer=api.generatedProfile('stream-up','server');
assert('scStreamUpServerSecs' in streamServer,'server stream-up must get stream keepalive');
for(const key of ['scMaxEachPostBytes','scMinPostsIntervalMs','scMaxBufferedPosts'])
 assert(!(key in streamServer),`server stream-up must not generate packet-only ${key}`);

const packetServer=api.generatedProfile('packet-up','server');
assert('scMaxEachPostBytes' in packetServer,'server packet-up must get POST size');
assert('scMaxBufferedPosts' in packetServer,'server packet-up must get server buffer limit');
assert(!('scMinPostsIntervalMs' in packetServer),'server packet-up must not get client-only post interval');
assert(!('scStreamUpServerSecs' in packetServer),'server packet-up must not get stream-up keepalive');

const packetClient=api.generatedProfile('packet-up','client');
assert('scMaxEachPostBytes' in packetClient,'client packet-up must get POST size');
assert('scMinPostsIntervalMs' in packetClient,'client packet-up may get client post interval');
assert(!('scMaxBufferedPosts' in packetClient),'client packet-up must not get server buffered-post limit');

const auto=api.generatedProfile('auto','server');
for(const key of ['scMaxEachPostBytes','scMinPostsIntervalMs','scMaxBufferedPosts','scStreamUpServerSecs'])
 assert(!(key in auto),`auto server preset must stay neutral and omit ${key}`);

let errors=api.validateSettings({path:'/x',mode:'stream-up',extra:{scMaxEachPostBytes:'500000-1000000'}},'server');
assert(errors.some(x=>x.includes('packet-up')),'stream-up must reject packet-up tuning');
errors=api.validateSettings({path:'/x',mode:'packet-up',extra:{scMinPostsIntervalMs:'10-20'}},'server');
assert(errors.some(x=>x.includes('client-only')),'server inbound must reject client-only post interval');
errors=api.validateSettings({path:'/x',mode:'stream-up',extra:{noGRPCHeader:true}},'server');
assert(errors.some(x=>x.includes('client-only')),'server inbound must reject client-only noGRPCHeader');
errors=api.validateSettings({path:'/x',mode:'packet-up',extra:{xmux:{maxConnections:2}}},'server');
assert(errors.some(x=>x.includes('client-only')),'server inbound must reject client-only xmux');
errors=api.validateSettings({path:'/x',mode:'stream-up',extra:{noSSEHeader:true}},'client');
assert(errors.some(x=>x.includes('server-only')),'client outbound must reject server-only noSSEHeader');
errors=api.validateSettings({path:'/x',mode:'stream-up',extra:{scStreamUpServerSecs:'20-60'}},'client');
assert(errors.some(x=>x.includes('server-only')),'client outbound must reject server-only stream keepalive');
errors=api.validateSettings({path:'/x',mode:'stream-up',extra:{h2Params:{}}},'server');
assert(errors.some(x=>x.includes('Неизвестный параметр Xray-core: h2Params')),'unknown h2Params must be rejected');
errors=api.validateSettings({path:'/x',mode:'stream-up',extra:{uplinkHTTPMethod:'GET'}},'server');
assert(errors.some(x=>x.includes('GET допустим только')),'GET must be rejected outside packet-up');
errors=api.validateSettings({path:'/x',mode:'stream-one',extra:{uplinkDataPlacement:'header'}},'server');
assert(errors.some(x=>x.includes('header допустим только')),'header uplink placement must be packet-up only');
errors=api.validateSettings({path:'/x',mode:'packet-up',extra:{xmux:{maxConnections:2,maxConcurrency:4}}},'client');
assert(errors.some(x=>x.includes('нельзя задавать одновременно')),'client xmux strategies must remain mutually exclusive');

const dirty={path:'/x',mode:'packet-up',extra:{
 scMaxEachPostBytes:'500000-1000000',scMinPostsIntervalMs:'10-30',scMaxBufferedPosts:30,
 scStreamUpServerSecs:'20-60',noGRPCHeader:true,xmux:{maxConnections:2},
 uplinkHTTPMethod:'GET',uplinkDataPlacement:'header'
}};
api.normalizeForMode(dirty,'stream-up','server');
for(const key of ['scMaxEachPostBytes','scMinPostsIntervalMs','scMaxBufferedPosts','noGRPCHeader','xmux'])
 assert(!(key in dirty.extra),`server mode switch must delete ${key}`);
assert.equal(dirty.extra.scStreamUpServerSecs,'20-60');
assert.equal(dirty.extra.uplinkHTTPMethod,'POST');
assert.equal(dirty.extra.uplinkDataPlacement,'auto');
assert.equal(api.validateSettings(dirty,'server').length,0,'normalized server stream-up settings must pass strict validation');

const html=fs.readFileSync('index.html','utf8');
assert(html.indexOf('xray-studio-xhttp-strict.js')<html.indexOf('xray-studio-protocol-tls.js'),
 'strict XHTTP click handler must load before legacy XHTTP handler');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
assert.match(docker,/xray-studio-xhttp-strict\.js/);
assert.match(docker,/xray-xhttp-core-validator\.js/);
assert.doesNotMatch(source,/option\('h2params'/,'nonexistent h2Params UI must not return');
console.log('XHTTP strict core schema, mode and endpoint-role generation: OK');
