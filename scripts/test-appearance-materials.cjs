'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('./browser/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:process.env.XMESH_CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 try{
  const page=await browser.newPage();
  await page.setViewportSize({width:800,height:460});
  await page.setContent('<main style="padding:48px"><section class="card"><h2>Настройки панели</h2><p class="note">Оформление и управление рабочим пространством</p><div class="setting-row"><div class="setting-copy"><b>Стиль карточек</b><small>Одинаковая карточка во всех трёх режимах</small></div><button class="btn">Новый пользователь</button></div></section><section class="card" style="margin-top:24px"><h3>Состояние системы</h3><p class="note">Все службы работают</p></section></main>');
  const materials=new Map();
  if(process.env.XMESH_MATERIAL_OUTPUT)fs.mkdirSync(process.env.XMESH_MATERIAL_OUTPUT,{recursive:true});
  for(const file of ['nexus-v3-foundation.css','nexus-v3-components.css'])await page.addStyleTag({content:fs.readFileSync('frontend/styles/system/'+file,'utf8')});
  for(const theme of ['light','dark'])for(const surface of ['solid','glass','raised']){
   const samples=[];
   for(const borders of ['off','soft','strong'])samples.push(await page.evaluate(({theme,surface,borders})=>{
    Object.assign(document.documentElement.dataset,{theme,surface,borders});
    const css=getComputedStyle(document.querySelector('.card'));
    const ctx=document.createElement('canvas').getContext('2d');
    const alpha=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data[3]};
    return {border:css.borderTopColor,borderAlpha:alpha(css.borderTopColor),background:css.backgroundColor,image:css.backgroundImage,backgroundAlpha:alpha(css.backgroundColor),backdrop:css.backdropFilter,shadow:css.boxShadow};
   },{theme,surface,borders}));
   materials.set(theme+' '+surface,samples[1]);
   assert.equal(samples[0].borderAlpha,0,theme+' '+surface+': borders off');
   assert.notEqual(samples[1].border,samples[2].border,theme+' '+surface+': border strength must change');
   if(surface==='glass'){
    assert(samples.every(s=>s.backgroundAlpha>0&&s.backgroundAlpha<255),'Glass must remain translucent');
    assert(samples.every(s=>s.backdrop.includes('blur')),'Glass must blur its backdrop');
    assert(samples.every(s=>!s.shadow.includes('inset')),'Glass must not reintroduce hidden borders via inset shadows');
   }else assert(samples.every(s=>s.backgroundAlpha===255),'Opaque materials must stay opaque');
  }
  for(const theme of ['light','dark']){
   const variants=['solid','glass','raised'].map(surface=>materials.get(theme+' '+surface));
   assert.equal(new Set(variants.map(v=>v.background)).size,3,theme+': materials need distinct fills');
   assert.equal(new Set(variants.map(v=>v.image)).size,3,theme+': materials need distinct lighting');
   assert.equal(new Set(variants.map(v=>v.shadow)).size,3,theme+': materials need distinct elevation');
   if(process.env.XMESH_MATERIAL_OUTPUT)for(const surface of ['solid','glass','raised']){
    await page.evaluate(v=>Object.assign(document.documentElement.dataset,v),{theme,surface,borders:'soft'});
    await page.screenshot({path:process.env.XMESH_MATERIAL_OUTPUT+'/'+theme+'-'+surface+'.png'});
   }
  }
  const button=page.locator('.btn');await button.click();
  assert.equal(await button.evaluate(b=>b.matches(':focus-visible')),false,'Pointer click must not show a keyboard ring');
  await page.keyboard.press('Tab');await button.focus();
  const focus=await button.evaluate(b=>({visible:b.matches(':focus-visible'),offset:parseFloat(getComputedStyle(b).outlineOffset),width:parseFloat(getComputedStyle(b).outlineWidth)}));
  assert(focus.visible&&focus.width>=2&&focus.offset<0,'Keyboard focus must remain visible inside the button');
  console.log('Appearance materials: 18 theme/material/border combinations and pointer/keyboard focus passed');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
