'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('frontend/js/features/users/workspace-bulk-actions.js','utf8');
const start=source.indexOf(' async function updateNodeAgents(');
const end=source.indexOf(' async function updateNodeXrays(',start);
assert(start>=0&&end>start);

async function exercise(english,failOne){
 const ids=['1','2','3','4','5','6','7'];
 const state={ids:new Set(ids),mode:true,busy:true,batch:null};
 const gates=new Map(),started=[],toasts=[];
 const context={
  selection:()=>state,queueMicrotask,
  cardName:(_,id)=>'node-'+id,
  trans:(ru,en)=>english?en:ru,
  update:()=>{},toast:message=>toasts.push(message),
  window:{XMeshNodeAgentOps:{updateOne:(id,{onStage})=>{
   started.push(id);
   onStage('installing');
   return new Promise((resolve,reject)=>gates.set(id,{resolve,reject,onStage}));
  }}}
 };
 vm.createContext(context);
 vm.runInContext(source.slice(start,end)+'\nglobalThis.run=updateNodeAgents;',context);
 let finished=false;
 const batch=context.run({}, {kind:'nodes'}, ids).then(()=>{finished=true;});
 assert.deepEqual(started,[1,2,3,4,5,6,7],
  'Every selected node must start before any node finishes; no two-node queue');
 assert(state.batch.items.every(item=>item.status==='running'));
 assert(state.batch.items.every(item=>item.message===(english?'Installing Agent':'Установка Agent')));

 if(failOne)gates.get(3).reject(new Error('node-3 rejected'));
 else gates.get(3).resolve({warning:false});
 gates.get(1).onStage('verifying');
 assert.equal(state.batch.items[0].message,english?'Verifying version':'Проверка версии');
 for(const id of [7,2,4,6])gates.get(id).resolve({warning:id===7});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(finished,false,'Fast successes/failure cannot finish the pending nodes');
 assert.equal(state.busy,true);
 assert.equal(state.batch.items[4].status,'running');
 assert.equal(state.batch.items[6].message,english?
  'Command succeeded, awaiting heartbeat':'Команда выполнена, ожидается heartbeat');
 if(failOne){
  assert.equal(state.batch.items[2].status,'error');
  assert.equal(state.batch.items[2].message,'node-3 rejected');
 }
 gates.get(5).resolve({warning:false});
 gates.get(1).resolve({warning:false});
 await batch;
 assert.equal(finished,true);
 assert.equal(state.busy,false);
 assert.equal(state.batch.items.filter(item=>item.status==='success').length,failOne?6:7);
 assert.deepEqual([...state.ids],failOne?['3']:[],'Only failed nodes stay selected for retry');
 assert.equal(state.mode,failOne);
 assert.equal(toasts.length,1);
 assert.match(toasts[0],failOne?/6\/7.*(?:failed|ошибок): 1/:/7\/7/);
}

async function confirmation(english){
 const state={ids:new Set(['1','2','3']),mode:true,busy:false};
 let message='';
 const context={
  selection:()=>state,DB:{nodes:[{id:1},{id:2},{id:3}]},update:()=>{},
  trans:(ru,en)=>english?en:ru,
  actionText:()=>english?'Update Agent':'Обновить Agent',
  panelConfirm:async text=>{message=text;return false;},
  updateNodeAgents:()=>{throw Error('A cancelled confirmation must not update nodes');}
 };
 vm.createContext(context);
 const execute=source.slice(source.indexOf(' async function execute('),source.indexOf(' window.XMeshBulk='));
 vm.runInContext(execute+'\nglobalThis.run=execute;',context);
 await context.run({}, {kind:'nodes'}, 'agent-update');
 assert.match(message,english?/all selected nodes at once/:/одновременно на всех выбранных узлах/);
 assert.doesNotMatch(message,/at most two|двух нодах/);
 assert.equal(state.busy,false);
}

(async()=>{
 for(const english of [false,true]){
  for(const failOne of [false,true])await exercise(english,failOne);
  await confirmation(english);
 }
 console.log('Agent fleet: all seven start together, independent results, slow nodes, retry selection and RU/EN stages passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
