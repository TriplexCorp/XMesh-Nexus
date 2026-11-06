#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('./browser/node_modules/playwright');
const source=fs.readFileSync('frontend/js/core/app.js','utf8');
const start=source.indexOf('const statsDetailedChart='),end=source.indexOf('// SVG coordinates',start);
const render=new Function('esc','fmt','panelIsEnglish','speedUnitMbps',source.slice(start,end)+';return statsDetailedChart;')(String,v=>String(v),()=>false,()=> 'Mbps');
const styles=fs.readFileSync('frontend/styles/features/statistics/statistics.css','utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:process.env.XMESH_CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 try{
  const page=await browser.newPage();
  for(const width of [390,1440,2560])for(const values of [[100000,400000],[400000,100000],[100000,100000]]){
   await page.setViewportSize({width,height:700});
   const points=Array.from({length:7},(_,i)=>({bucketMs:1700000000000+i*60000,rxBytesPerSec:values[0],txBytesPerSec:values[1]}));
   await page.setContent('<style>:root{--a:#f68;--b:#b8f;--s1:#123;--mu:#abc}body{margin:0}'+styles+'</style>'+render(points,Math.max(1000,width)));
   await page.evaluate(()=>{window.selected=[];document.addEventListener('click',e=>{const p=e.target.closest('.stats-detail-point-wrap');if(p)window.selected.push(Number(p.dataset.bucketMs))})});
   for(const series of ['rx','tx']){
    const point=page.locator(`.stats-detail-point-wrap.${series}`).nth(3);
    const b=await point.locator('.stats-detail-point-hit').boundingBox();
    for(const dx of [0,3,-3]){
     await page.mouse.click(b.x+b.width/2+dx,b.y+b.height/2);
     assert.equal(await page.evaluate(()=>window.selected.at(-1)),points[3].bucketMs,`${width}px ${values}: ${series} point must receive the click through the other series`);
     await page.evaluate(()=>window.selected=[]);
    }
    await point.focus();
    assert.equal(await point.evaluate(el=>el===document.activeElement),true,'Point must remain keyboard focusable');
   }
  }
  console.log('Statistics chart: RX/TX overlap and nearby pointer clicks pass at mobile, desktop and wide sizes');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
