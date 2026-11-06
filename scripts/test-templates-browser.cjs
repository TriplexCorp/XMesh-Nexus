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
   assert.equal(await page.locator('[data-ne="tpls"]:visible').count(),1,'Only one create action should be visible');
   assert.equal(await page.locator('.templates-heading,.templates-kicker').count(),0,'Repeated headings must be removed');
   await page.locator('[data-template-search=tpls]').fill('Premium');
   assert.equal(await page.locator('[data-template-card]:visible').count(),1);
   await page.locator('[data-template-tab=subs]').click();
   assert(await page.locator('[data-template-section=subs] .template-empty').isVisible());
   assert.equal(await page.locator('[data-ne="subs"]:visible').count(),1);
   await page.locator('[data-template-tab=subs]').press('Home');
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
