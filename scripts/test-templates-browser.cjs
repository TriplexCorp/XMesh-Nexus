#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('./browser/node_modules/playwright');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const feature=app.slice(app.indexOf('/* Templates share the canonical CRUD'),app.indexOf('async function simple(ks)'));
const styles=['frontend/styles/system/nexus-v3-foundation.css','frontend/styles/system/nexus-v3-components.css','frontend/styles/features/templates/templates.css'].map(p=>fs.readFileSync(p,'utf8')).join('\n');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:process.env.XMESH_CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 try{
  const page=await browser.newPage();
  for(const width of [390,768,1920]){
   await page.setViewportSize({width,height:1000});
   await page.setContent('<style>'+styles+'</style>');
   await page.addScriptTag({content:`window.boot=async()=>{
    const DB={tpls:[{id:1,name:'Premium',days:30,limit:0,hwid:2,squads:[3],strategy:'NO_RESET'},{id:2,name:'Starter',days:7,limit:10,hwid:0,squads:[],strategy:'NO_RESET'}],subs:[],squads:[{id:3,name:'TLS'}]};
    const api={list:async kind=>({items:DB[kind]})},esc=String,ic=()=>'',STRAT=[['NO_RESET','Не сбрасывать']],entForm=()=>{},userNew=()=>{},panelIsEnglish=()=>false;
    ${feature}
    const [html,mount]=await templatesP();document.body.innerHTML=html;mount();
   };window.boot();`});
   await page.locator('[data-template-card="tpls:1"]').waitFor();
   const geometry=await page.evaluate(()=>{
     const bar=document.querySelector('[data-template-section=tpls] .template-section-tools');
     const tabs=bar?.querySelector('.templates-tabs');
     const search=bar?.querySelector('[data-template-search]');
     const actions=bar?.querySelector('.nx-workspace-actions');
     const rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,right:r.right,top:r.top,bottom:r.bottom,mid:(r.top+r.bottom)/2}};
     return{
       bar:bar?rect(bar):null,
       tabs:tabs?rect(tabs):null,
       search:search?rect(search):null,
       actions:actions?rect(actions):null,
       tabCount:document.querySelectorAll('.templates-tabs').length,
       standalone:document.querySelectorAll('.templates-workspace > .templates-tabs').length,
       overflow:document.documentElement.scrollWidth>innerWidth+1
     };
   });
   assert.equal(geometry.tabCount,1,'Exactly one accessible template tablist must exist');
   assert.equal(geometry.standalone,0,'Template types must be inside the active toolbar, not on a separate row');
   assert(geometry.tabs&&geometry.search&&geometry.actions,'The active toolbar must contain tabs, search and actions');
   assert(!geometry.overflow,'The unified toolbar must not overflow the document');
   for(const child of [geometry.tabs,geometry.search,geometry.actions]){
     assert(child.x>=geometry.bar.x-1&&child.right<=geometry.bar.right+1,
       'All template toolbar controls must stay inside its framed surface');
   }
   if(width===1920)assert(
     Math.abs(geometry.tabs.mid-geometry.search.mid)<3&&
     Math.abs(geometry.search.mid-geometry.actions.mid)<3,
     'On desktop, template types, search and actions must share one horizontal line');

   assert.equal(await page.locator('[data-ne="tpls"]:visible').count(),1,'Only one create action should be visible');
   assert.equal(await page.locator('.templates-heading,.templates-kicker').count(),0,'Repeated headings must be removed');
   await page.locator('[data-template-search=tpls]').fill('Premium');
   assert.equal(await page.locator('[data-template-card]:visible').count(),1);
   await page.locator('[data-template-tab=subs]').click();
   assert.equal(await page.locator('[data-template-section=subs] .template-section-tools .templates-tabs').count(),1,
     'Tab switching must move the same navigation into the subscription toolbar');
   assert.equal(await page.locator('.templates-tabs').count(),1,'Tablist must not be duplicated when switching');
   assert(await page.locator('[data-template-section=subs] .template-empty').isVisible());
   assert.equal(await page.locator('[data-ne="subs"]:visible').count(),1);
   await page.locator('[data-template-tab=subs]').press('Home');
   assert.equal(await page.locator('[data-template-section=tpls] .template-section-tools .templates-tabs').count(),1,
     'Keyboard Home must return the tablist to the user template toolbar');
   assert.equal(await page.locator('[data-template-search=tpls]').inputValue(),'Premium','Switching tabs must preserve the search');
   await page.locator('[data-template-search=tpls]').press('Escape');
   assert.equal(await page.locator('[data-template-card]:visible').count(),2);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Workspace must fit the viewport');
   await page.addScriptTag({content:fs.readFileSync('frontend/js/core/i18n.js','utf8')});
   await page.evaluate(()=>window.XMeshI18n.setLanguage('en'));
   await page.waitForTimeout(100);
   assert(!/[А-Яа-яЁё]/.test(await page.locator('body').innerText()),'English templates must contain no untranslated UI');
   await page.locator('[data-template-tab=subs]').click();await page.waitForTimeout(100);
   assert(!/[А-Яа-яЁё]/.test(await page.locator('body').innerText()),'Empty subscription tab must also be translated');
   await page.locator('[data-template-tab=tpls]').click();
   await page.screenshot({path:'/tmp/templates-clean-'+width+'.png',fullPage:true});
  }
  console.log('Templates browser: tabs, empty state, single create action, persistent search and responsive bounds passed');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
