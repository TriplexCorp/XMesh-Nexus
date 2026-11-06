#!/usr/bin/env node
'use strict';
// The same per-user draft must feed both subscription paths and preserve global routing.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const draft=fs.readFileSync('frontend/js/features/users/user-editor-draft.js','utf8');
const routing=fs.readFileSync('frontend/js/features/users/user-client-routing.js','utf8');
const shared=fs.readFileSync('frontend/js/features/routing/client-routing.js','utf8');
const rust=fs.readFileSync('backend/src/client_routing.rs','utf8');
const backend=fs.readFileSync('backend/src/user_subscriptions_base.rs','utf8');
const api=fs.readFileSync('backend/src/main.rs','utf8');
const html=fs.readFileSync('frontend/index.html','utf8');
const css=fs.readFileSync('frontend/styles/features/users/user-details.css','utf8');
new vm.Script(routing,{filename:'user-client-routing.js'});
const context={
  window:{
    XMeshI18n:{getLanguage:()=> 'en'},
    XMeshClientRouting:{destinations:()=>[
      {key:'host:30',label:'Poland'},
      {key:'host:31',label:'United Kingdom'}
    ]},
    XMeshSelects:{refresh(){}}
  },
  document:{addEventListener(){}}
};
vm.runInNewContext(routing,context);
const controller=context.window.XMeshUserClientRouting;
assert.equal(typeof controller?.mount,'function');
assert.equal(typeof controller?.serialize,'function');
function card(user){
  const handlers={};
  const root={
    innerHTML:'',isConnected:true,
    addEventListener:(name,handler)=>{handlers[name]=handler},
    querySelectorAll:()=>[]
  };
  const dirty={textContent:''};
  const canvas={
    querySelector:selector=>selector==='[data-user-client-routing-root]'?root:
      selector==='[data-user-edit-dirty]'?dirty:null,
    closest:()=>null
  };
  controller.mount(canvas,user,{});
  return {canvas,root,handlers,dirty};
}
const ivan=card({clientRouting:{mode:'custom',rules:[
  {match:'geosite',value:'youtube',action:'server',server:'host:30'}
]}});
const sempatin=card({clientRouting:{mode:'custom',rules:[
  {match:'geosite',value:'youtube',action:'server',server:'host:31'}
]}});
assert.equal(controller.serialize(ivan.canvas).rules[0].server,'host:30');
assert.equal(controller.serialize(sempatin.canvas).rules[0].server,'host:31');
assert(ivan.root.innerHTML.includes('Personal client routing'));
assert(ivan.root.innerHTML.includes('host:30'));
ivan.handlers.change({target:{name:'user-route-mode',value:'inherit'}});
assert.equal(controller.serialize(ivan.canvas).mode,'inherit');
assert.equal(controller.serialize(ivan.canvas).rules.length,0);
assert.equal(controller.serialize(sempatin.canvas).rules[0].server,'host:31');
assert.equal(ivan.dirty.textContent,'Unsaved changes');
ivan.handlers.change({target:{name:'user-route-mode',value:'custom'}});
assert.equal(controller.serialize(ivan.canvas).rules[0].server,'host:30');
const broken=card({clientRouting:{mode:'custom',rules:[
  {match:'geosite',value:'youtube',action:'server',server:''}
]}});
assert.throws(()=>controller.serialize(broken.canvas),/Select a destination/);
assert.match(shared,/global\.XMeshClientRouting=\{create,destinations\}/);
assert.match(app,/\['routing','Маршрутизация','route'\]/);
assert.match(app,/data-user-editor-pane="routing"/);
assert.match(app,/XMeshUserClientRouting\?\.mount/);
assert.match(draft,/\['ov','acc','routing','traffic','dev'\]/);
assert.match(draft,/data\.clientRouting=personal/);
assert.match(rust,/pub fn validate_user_override/);
assert.match(rust,/rows\.extend\(extra\.iter\(\)\.cloned\(\)\)/);
assert.match(rust,/rows\.extend\(shared\.iter\(\)\.cloned\(\)\)/);
assert.match(rust,/pub fn scoped_settings/);
assert.match(api,/client_routing::validate_user_override\(personal\)/);
assert.equal((backend.match(/client_routing::scoped_settings\(&(?:setting|settings), &user\)/g)||[]).length,2,
 'Admin preview and public subscription must share the personal override');
assert.match(html,/src="\/js\/features\/users\/user-client-routing\.js\?v=[a-f0-9]{12}"/);
assert.match(css,/user-route-rule-fields/);
console.log('Personal client routing: independent users, global inheritance, UI save, auth boundaries, and subscription wiring OK.');
