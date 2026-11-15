#!/usr/bin/env node
'use strict';
// Chromium regression: real Nexus CSS cascade, real Telegram rendering and
// the previously washed-out XRAY "Сохранить профиль" button.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('./browser/node_modules/playwright');
const {panelStyles}=require('./ci/frontend-source.cjs');
const js=fs.readFileSync(path.resolve(__dirname,'../frontend/js/features/settings/telegram-admin-bot.js'),'utf8');
const root=async(page,theme)=>{
 await page.setContent('<html data-theme="'+theme+'" data-accent="lime"><body><main id="view"></main><div id="save-fixtures"><div class="sv-studio"><button class="sv-primary">Сохранить</button></div><button class="btn">Сохранить</button><div class="xm-studio-modal" style="--xm-dialog-accent:#c8ed7a;--btn-text:#102112"><div class="xm-studio-modal-footer"><button class="xm-studio-modal-accept">Сохранить профиль</button></div></div></div></body></html>');
 await page.addStyleTag({content:panelStyles()});
 await page.addScriptTag({content:js});
 await page.evaluate(async()=>{
  const data={enabled:false,tokenConfigured:false,connected:false,adminIds:[],lastConnectedAtMs:null,lastError:null};
  const [markup,start]=await window.XMeshTelegramBot.page({
   owner:true,request:async()=>data,toast:()=>{},confirm:async()=>false,schedule:()=>{}
  });
  document.getElementById('view').innerHTML=markup;
  start();
 });
};
const rgb=s=>{
 const srgb=/^color\(srgb\s+([.\d]+)\s+([.\d]+)\s+([.\d]+)/.exec(s);
 if(srgb)return srgb.slice(1,4).map(v=>Number(v)*255);
 const rgba=/^rgba?\(\s*([.\d]+)[, ]+([.\d]+)[, ]+([.\d]+)/.exec(s);
 if(rgba)return rgba.slice(1,4).map(Number);
 throw Error('Unexpected CSS color: '+s);
};
const lum=c=>rgb(c).map(x=>{const v=x/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((acc,x,i)=>acc+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)};
(async()=>{
 const browser=await chromium.launch({headless:true,args:process.env.XMESH_CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  for(const theme of ['dark','light'])for(const width of [390,768,1366,1920]){
   const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
   try{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await root(page,theme);
    const form=page.locator('#tb-config-form');
    await form.waitFor({state:'visible'});
    await page.locator('#tb-admins').fill('123456789\n987654321');
    assert.equal(await page.locator('#tb-admins-count').textContent(),'2 / 50',
      'Admin count must update immediately');
    const geometry=await page.evaluate(()=>({
      excess:Math.max(
        document.querySelector('.tb-workspace').scrollWidth-document.querySelector('.tb-workspace').clientWidth,
        document.querySelector('.tb-workspace').getBoundingClientRect().right-innerWidth
      ),
      cols:getComputedStyle(document.querySelector('.tb-status-grid')).gridTemplateColumns.split(' ').length,
      enable:getComputedStyle(document.querySelector('.tb-enable-row')).display
    }));
    assert(geometry.excess<=2,'Telegram console horizontal overflow at '+width+'px: '+geometry.excess);
    assert.equal(geometry.cols,width<=680?1:3,'Status tiles responsive at '+width);
    assert.equal(geometry.enable,'flex');
    for(const selector of ['#tb-save','.xm-studio-modal-accept','.sv-studio .sv-primary','button.btn']){
      const button=page.locator(selector);
      const colors=()=>button.evaluate(b=>({bg:getComputedStyle(b).backgroundColor,fg:getComputedStyle(b).color}));
      const before=await colors();
      await button.hover();
      const after=await colors();
      assert(contrast(after.bg,after.fg)>=3,'Save contrast lost on hover: '+selector+' '+theme+' '+width+' '+JSON.stringify({before,after}));
      if(selector==='.xm-studio-modal-accept')
       assert.equal(after.bg,before.bg,'XRAY Save button must not be repainted with a dark neutral hover');
    }
    assert.deepEqual(errors,[],'Telegram page JS errors at '+width+'px');
    console.log('Telegram hover/geometry OK: '+theme+' '+width+'px');
   }finally{await page.close()}
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
