#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('./browser/node_modules/playwright');
const source=fs.readFileSync('frontend/js/core/app.js','utf8');
const start=source.indexOf('const statsDetailedChart='),end=source.indexOf('// SVG coordinates',start);
const render=new Function('esc','fmt','panelIsEnglish','speedUnitMbps',source.slice(start,end)+';return statsDetailedChart;')(v=>String(v).replace(/"/g,'&quot;'),v=>String(v),()=>false,()=> 'Mbps');
const binding=source.slice(source.indexOf('function bindStatisticsChartSelection('),source.indexOf('// Detailed chart uses'));
const styles=fs.readFileSync('frontend/styles/features/statistics/statistics.css','utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:process.env.XMESH_CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 try{
  const context=await browser.newContext({hasTouch:true});const page=await context.newPage();
  const mount=async(points,width,scale=1)=>{
   await page.setContent('<style>:root{--a:#f68;--b:#b8f;--s1:#123;--mu:#abc}body{margin:0}'+styles+'</style><div id="fixture" style="zoom:'+scale+'">'+render(points,Math.max(300,width))+'</div>');
   await page.addScriptTag({content:binding+";window.selected=[];bindStatisticsChartSelection(document.querySelector('#fixture'),bucket=>window.selected.push(bucket));"});
  };
  let cases=0;
  for(const width of [390,1440,2560])for(const count of [1,7,61,301])for(const scale of [1,1.3]){
   await page.setViewportSize({width,height:900});
   const points=Array.from({length:count},(_,i)=>({bucketMs:1700000000000+i*60000,rxBytesPerSec:100000+i%5*30000,txBytesPerSec:400000-i%5*30000}));
   await mount(points,width,scale);
   for(const index of [...new Set([0,Math.floor(count/2),count-1])]){
    const target=page.locator('.stats-detail-bucket-target').nth(index);
    await target.scrollIntoViewIfNeeded();const b=await target.boundingBox();
    for(const y of [b.y+2,b.y+b.height/2,b.y+b.height-2]){
     const x=b.x+b.width/2;
     await page.mouse.click(x,y);
     assert.equal(await page.evaluate(()=>window.selected.at(-1)),points[index].bucketMs,`${width}px ${count} intervals at ${scale}: full-height target must choose nearest time`);
    }
   }
   const first=page.locator('.bucket[role=button]').first();await first.focus();await first.press('End');await page.keyboard.press('Enter');
   assert.equal(await page.evaluate(()=>window.selected.at(-1)),points.at(-1).bucketMs,'End/Enter must select final interval');
   await page.keyboard.press('Home');await page.keyboard.press(' ');
   assert.equal(await page.evaluate(()=>window.selected.at(-1)),points[0].bucketMs,'Home/Space must select first interval');
   cases++;
  }
  await page.setViewportSize({width:1440,height:900});
  const points=Array.from({length:61},(_,i)=>({bucketMs:1700000000000+i*60000,rxBytesPerSec:100000,txBytesPerSec:400000}));
  await mount(points,1440);
  let b=await page.locator('.stats-detail-bucket-target').nth(30).boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();
  // A live refresh removes the pressed SVG and shifts its time range before release.
  await page.locator('#fixture').evaluate((root,html)=>{root.innerHTML=html},render(points.map(p=>({...p,bucketMs:p.bucketMs+60000})),1440));
  await page.mouse.up();assert.equal(await page.evaluate(()=>window.selected.at(-1)),points[30].bucketMs,'Refresh during press must retain the pressed interval');
  await mount(points,1440);b=await page.locator('.stats-detail-bucket-target').nth(30).boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+50);await page.mouse.down();await page.mouse.move(b.x+b.width/2+30,b.y+80);await page.mouse.up();
  assert.equal(await page.evaluate(()=>window.selected.length),0,'Scrolling/dragging must not open details');
  const gap=points.map((p,i)=>i===30?{...p,rxBytesPerSec:null,txBytesPerSec:null}:p);
  await mount(gap,1440);const left=await page.locator('.stats-detail-bucket-target').nth(29).boundingBox(),right=await page.locator('.stats-detail-bucket-target').nth(30).boundingBox();
  await page.mouse.click((left.x+left.width+right.x)/2,left.y+left.height/2);
  assert.equal(await page.evaluate(()=>window.selected.length),0,'Missing intervals must not be interpolated into a selection');
  await mount(points,1440);b=await page.locator('.stats-detail-bucket-target').nth(30).boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+30);
  assert.equal(await page.evaluate(()=>window.selected.at(-1)),points[30].bucketMs,'Touch must select the same interval');
  await context.close();console.log(`Statistics selection: ${cases} density/viewport/scale cases, keyboard, live refresh, drag, missing intervals and touch passed`);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
