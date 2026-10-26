'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const api=fs.readFileSync('backend/src/main.rs','utf8');
const css=fs.readFileSync('settings-updates.css','utf8');
const html=fs.readFileSync('index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
assert.ok(html.includes('settings-updates.css?v='));
assert.ok(docker.includes('styles.css settings-updates.css'));
assert.ok(css.includes('#core-panel .update-action-row,'));
assert.ok(css.includes('#panel-update-card .update-action-row{'));
assert.ok(css.includes('grid-template-columns:repeat(2,minmax(0,12.5rem))'));
assert.ok(css.includes('@media(max-width:420px)'));
assert.ok(app.includes('const ownerUpdates=sessionUser?.role===\'owner\''));
assert.ok(app.includes('panelUpdateStatusText(panelUpdateView.status)'));
for(const route of ['"/core", get(get_core_status)','"/core/update", post(update_core)','post(request_panel_update).get(get_panel_update_status)']){
 assert.ok(api.includes(route),'API route missing: '+route);
}
for(const name of ['async fn update_core(','async fn request_panel_update(','async fn get_panel_update_status(']){
 const i=api.indexOf(name);assert.ok(i>0);
 assert.ok(api.slice(i,i+400).includes('require_owner(&actor)?'),'Owner required by '+name);
}
assert.ok(api.includes('if pending.trim() == "update"'));
const begin=app.indexOf("  else if(b=g('[data-panel-update-status]'))");
const end=app.indexOf("  else if(b=g('[data-pi]'))",begin);
assert.ok(begin>0&&end>begin);
const code='return async function click(g){let b;if(false){}'+app.slice(begin,end)+'}';
async function run(){
 const calls=[],timers=[],toasts=[];
 let confirm=true,error='',panelChecks=0,coreChecks=0,watches=0;
 const fields={
  '#core-target':{value:'v26.10.21'},
  '#core-message':{textContent:''},
  '#panel-update-message':{textContent:''}
 };
 const button={disabled:false};
 const request=async(url,opt={})=>{
  calls.push({url,method:opt.method||'GET',body:opt.body});
  if(error)throw Error(error);
  return {status:'queued',message:'Queued'};
 };
 const handle=new Function('backendRequest','panelConfirm','refreshPanelUpdateStatus','refreshCoreStatus','startPanelUpdateWatch','$','toast','setTimeout',code)(
  request,async()=>confirm,async()=>{panelChecks++},async()=>{coreChecks++},
  ()=>{watches++},selector=>fields[selector]||null,txt=>toasts.push(txt),f=>timers.push(f));
 const click=action=>handle(selector=>selector==='['+action+']'?button:null);
 await click('data-panel-update-status');
 assert.equal(panelChecks,1);assert.equal(button.disabled,false);
 await click('data-panel-update');
 assert.deepEqual(calls.at(-1),{url:'/api/v1/panel/update',method:'POST',body:'{}'});
 assert.equal(fields['#panel-update-message'].textContent,'Queued');
 assert.equal(watches,1);assert.equal(button.disabled,false);
 await click('data-core-refresh');
 assert.equal(coreChecks,1);assert.equal(button.disabled,false);
 await click('data-core-update');
 assert.deepEqual(calls.at(-1),{url:'/api/v1/core/update',method:'POST',body:'{"version":"v26.10.21"}'});
 assert.equal(coreChecks,2);assert.equal(timers.length,1);
 confirm=false;
 const before=calls.length;
 await click('data-panel-update');
 assert.equal(calls.length,before,'Cancel must not call API');
 confirm=true;error='API 503';
 await click('data-panel-update');
 assert.equal(fields['#panel-update-message'].textContent,'API 503');
 assert.equal(button.disabled,false);
 await click('data-core-update');
 assert.equal(fields['#core-message'].textContent,'API 503');
 assert.equal(button.disabled,false);
 assert.ok(toasts.some(s=>s.includes('503')));
 console.log('Settings update actions: 4 handlers, API routes, failures, cancel and alignment: OK');
}
run().catch(e=>{console.error(e);process.exitCode=1});
