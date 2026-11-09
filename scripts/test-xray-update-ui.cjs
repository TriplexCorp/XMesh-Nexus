'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('frontend/js/core/app.js','utf8');
const start=source.indexOf('const xrayUpdateStageLabel='),end=source.indexOf('window.XMeshNodeXrayOps=XMeshNodeXrayOps;',start);
assert(start>0&&end>start);
const stages={1:[],2:[]},calls=[],polls={1:0,2:0};
const progress=['downloading','validating','staging','starting','health_check'];
const context={window:{XMeshI18n:{translate:t=>t}},DB:{nodes:[{id:1,name:'A'},{id:2,name:'B'}]},nodeXrayUpdating:new Set(),nodeXrayRestarting:new Set(),paintNodeXrayUpdate:()=>{},updateNodeRuntimeBadges:()=>{},selectNodeXrayRelease:()=>{},setTimeout:f=>{f();return 0},Date,console,
 backendRequest:async(path,request)=>{
  calls.push(path);const id=Number(path.match(/nodes\/(\d+)/)?.[1]);
  if(path.endsWith('/runtime'))return{connected:true,xrayUpdateSupported:true,xrayUpdateTransactionSupported:true,xrayVersion:'26.10.31'};
  if(path.endsWith('/xray-update')){assert.equal(JSON.parse(request.body).version,'v26.10.31');return{id:id*10};}
  if(path.endsWith('/restart')){
   const n=polls[id]++;
   if(id===2)return{id:20,state:'failed',result:'bounded fallback',progress:{stage:'validating',code:'tls_resource_missing',exitCode:23,rollback:'unchanged'}};
   return{id:10,state:n<progress.length?'claimed':'succeeded',progress:{stage:progress[n]||'completed'},result:'verified'};
  }
  throw Error('Unexpected route '+path);
 }};
vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nwindow.ops=XMeshNodeXrayOps;',context);
(async()=>{
 const results=await Promise.allSettled([1,2].map(id=>context.window.ops.updateOne(id,'v26.10.31',{onStage:s=>stages[id].push(s)})));
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
 assert.match(results[1].reason.message,/TLS/);assert.match(results[1].reason.message,/exit 23/);
 assert.equal(context.nodeXrayUpdating.size,0);
 for(const s of progress)assert(stages[1].includes(s),'Missing real progress '+s);
 assert.equal(results[0].value.warning,false);
 console.log('Xray UI: actual stages, specific diagnostics, exact version refresh and independent node outcomes passed');
})().catch(e=>{console.error(e);process.exitCode=1});
