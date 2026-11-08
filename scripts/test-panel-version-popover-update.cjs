#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');

const script=fs.readFileSync('frontend/js/features/settings/panel-version-topbar.js','utf8');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const html=fs.readFileSync('frontend/index.html','utf8');
const backend=fs.readFileSync('backend/src/main.rs','utf8');
const version=fs.readFileSync('backend/src/panel_version.rs','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
assert.match(html,/data-panel-version-update hidden/);
assert.match(html,/data-panel-version-update-status[^>]*role="status"/);
assert.match(html,/data-panel-version-reload hidden/);
assert.match(app,/window\.XMeshPanelUpdater=\{/);
assert.match(app,/sessionUser\?\.role!=='owner'/);
assert.match(app,/panelConfirm\(/);
assert.match(app,/backendRequest\('\/api\/v1\/panel\/update',\{method:'POST'/);
assert.match(backend,/require_owner\(&actor\)\?/);
assert.match(version,/option_env!\("PANEL_DISPLAY_VERSION"\)/);
assert.match(version,/"compatibility_version": PRODUCT_VERSION\.trim\(\)/);
assert.match(docker,/resolve-panel-display-version[.]sh/);
assert.match(docker,/PANEL_DISPLAY_VERSION="\$\(cat \/build\/PANEL_DISPLAY_VERSION\)"/);

const listeners=new Map(),elements=new Map();
function element(id) {
 if(elements.has(id))return elements.get(id);
 const node={
  id,hidden:false,disabled:false,textContent:'',title:'',dataset:{},attributes:{},listeners:{},
  addEventListener(name,callback){this.listeners[name]=callback},
  setAttribute(name,value){this.attributes[name]=value},
  focus(){},
  click(){this.listeners.click?.({preventDefault(){}})}
 };
 elements.set(id,node);
 return node;
}
const root=element('top-panel-version');
root.querySelector=selector=>elements.get(selector)||element(selector);
root.contains=target=>target?.insideMenu!==false;
for(const selector of [
 '[data-panel-version-trigger]','[data-panel-version-menu]',
 '[data-panel-version-heading]','[data-panel-version-close]',
 '[data-panel-version-installed]','[data-panel-version-number]',
 '[data-panel-version-revision]',
 '[data-panel-version-status]','[data-panel-version-update]',
 '[data-panel-version-update-status]','[data-panel-version-reload]',
 '[data-panel-version-caption]'
])element(selector);
const doc={
 hidden:false, listeners:{},
 getElementById(id){return id==='top-panel-version'?root:null},
 addEventListener(name,cb){this.listeners[name]=cb}
};
let server={status:'idle'},requests=0,reads=0,approved=true,reloads=0;
const timers=new Map();let timerId=0;
const window={
 XMeshI18n:{getLanguage:()=> 'ru'},
 XMeshPanelUpdater:{
  async request(){requests++;if(approved)server={status:'queued'};return approved?{status:'queued'}:{cancelled:true}},
  async status(){reads++;return {...server}}
 },
 setTimeout:fn=>{fn();return 1}
};
const location={hash:'',reload(){reloads++}};
const fetch=async url=>{
 if(url==='/api/v1/panel/version')return {ok:true,json:async()=>({version:'6.0.1',revision:'a'.repeat(40)})};
 if(url==='/api/v1/panel/version/check')return {ok:true,json:async()=>({status:'update_available',latest_revision:'b'.repeat(40)})};
 throw Error('Unexpected URL: '+url);
};
vm.runInNewContext(script,{
 window,document:doc,location,fetch,
 setInterval:(fn)=>{const id=++timerId;timers.set(id,fn);return id},
 clearInterval:id=>timers.delete(id)
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function run(){
 await window.XMeshPanelVersion.init({role:'admin'});
 element('[data-panel-version-trigger]').click();
 await tick();
 assert.equal(element('[data-panel-version-update]').hidden,true,'Non-owner has no install action');
 assert.doesNotMatch(html,/data-panel-version-check|data-panel-version-settings/,'Obsolete actions must be absent from markup');
 assert.equal(element('[data-panel-version-update]').hidden,true,'Admin cannot update');
 assert.equal(requests,0);
 element('[data-panel-version-trigger]').click();

 await window.XMeshPanelVersion.init({role:'owner'});
 element('[data-panel-version-trigger]').click();
 await tick();
 assert(reads>=1,'Owner checks real host status on opening');
 assert.equal(element('[data-panel-version-update]').hidden,false);
 assert.equal(element('[data-panel-version-update]').disabled,false);
 approved=false;
 element('[data-panel-version-update]').click();
 await tick();
 assert.equal(requests,1);
 assert.equal(element('[data-panel-version-update-status]').textContent,'','Cancelled requests must not show a false progress message');
 assert.equal(element('[data-panel-version-menu]').dataset.actionMode,'update','Cancellation keeps the available update action');
 approved=true;
 element('[data-panel-version-update]').click();
 // The shared confirmation dialog is outside the dropdown in the DOM.
 doc.listeners.click({target:{insideMenu:false}});
 assert.equal(element('[data-panel-version-menu]').hidden,false,'Owner confirmation must not dismiss the status popover');
 await tick();
 assert.equal(requests,2);
 assert.equal(element('[data-panel-version-update]').hidden,true,'Queued upgrade hides the unusable update action');
 assert.equal(element('[data-panel-version-status]').dataset.state,'queued');
 assert.notEqual(element('[data-panel-version-status]').dataset.state,'success','HTTP 202 is not deployment');
 assert.equal(timers.size,1,'Queue should be polled while menu is open');
 server={status:'running'};
 [...timers.values()][0]();
 await tick();
 assert.equal(element('[data-panel-version-status]').dataset.state,'running');
 assert.equal(element('[data-panel-version-update]').hidden,true);
 server={status:'success'};
 [...timers.values()][0]();
 await tick();
 assert.equal(element('[data-panel-version-reload]').hidden,false);
 assert.equal(element('[data-panel-version-update]').hidden,true,'Old update action must disappear on completion');
 assert.equal(element('[data-panel-version-menu]').dataset.actionMode,'reload','Reload becomes the primary action');
 assert.equal(element('[data-panel-version-status]').dataset.state,'success');
 assert.equal(timers.size,0,'Stop polling once completed');
 element('[data-panel-version-reload]').click();
 assert.equal(reloads,1);
 element('[data-panel-version-trigger]').click();
 await tick();
 assert.equal(timers.size,0,'Closed menu cannot leak polling timers');

 // A new browser session finds the host marker left at "success" by
 // the previous deployment. A fresh GitHub check must unlock the next one.
 await window.XMeshPanelVersion.init({role:'owner'});
 server={status:'success'};
 element('[data-panel-version-trigger]').click();
 await tick();
 assert.equal(element('[data-panel-version-reload]').hidden,true,
   'Old successful deployment must not require another reload');
 assert.equal(element('[data-panel-version-reload]').hidden,true,
   'Old success must not demand a pointless second reload');
 assert.equal(element('[data-panel-version-update]').hidden,false,
   'A confirmed newer GitHub build must be installable after old host success');
 assert.equal(element('[data-panel-version-menu]').dataset.actionMode,'update',
   'Fresh check must restore the update action despite persisted success');
 // A second request may still be queued; host-side GET/POST remain the
 // authoritative protection against concurrent worker execution.
 approved=false;
 element('[data-panel-version-update]').click();
 await tick();
 assert.equal(requests,3,'Old success must not block a new owner update request');
 assert.equal(element('[data-panel-version-menu]').dataset.actionMode,'update',
   'Cancelled follow-up request must not lock the update button');
 element('[data-panel-version-trigger]').click();

 await window.XMeshPanelVersion.init({role:'owner'});
 server={status:'unavailable'};
 element('[data-panel-version-trigger]').click();
 await tick();
 assert.equal(element('[data-panel-version-update]').hidden,true,'Missing updater must not display an unusable update action');
 assert.match(element('[data-panel-version-update-status]').textContent,/недоступен/i,
   'Missing updater must explain the problem instead of suggesting a redundant link');
 console.log('Panel version popover: owner gate, cancel, queue, polling, success, unavailable and reload passed');
}
run().catch(error=>{console.error(error);process.exitCode=1});
