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
  await mount(points,1440);b=await page.locator('.stats-detail-bucket-target').nth(30).boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+30);await page.waitForTimeout(200);
  assert.equal(await page.locator('.rx.is-hovered,.tx.is-hovered').count(),2,'Hover must highlight both visible points for the interval');
  assert.equal(await page.locator('.stats-detail-bucket-target').nth(30).evaluate(el=>getComputedStyle(el).cursor),'pointer','Clickable intervals must use a hand, never a crosshair');
  assert(parseFloat(await page.locator('.rx.is-hovered .stats-detail-point-core').evaluate(el=>getComputedStyle(el).r))>5,'Hovered data points must visibly grow');
  await page.mouse.move(0,650);assert.equal(await page.locator('.is-hovered').count(),0,'Leaving the plot must clear hover');
  const detailStart=source.indexOf('  const openBucket=async(bucketMs)=>{'),detailEnd=source.indexOf("  bindStatisticsChartSelection($('#stats-trend'),openBucket);",detailStart);
  const closeStart=source.indexOf("  $('#stats-bucket-detail')?.addEventListener",detailEnd),closeEnd=source.indexOf("  $('#stats-refresh')?.addEventListener",closeStart);
  await page.setContent('<style>'+styles+'</style><div id="stats-trend"></div><section id="stats-bucket-detail" class="stats-bucket-detail" hidden></section>');
  await page.addScriptTag({content:`window.detailC={motion:true};window.pending=[];window.testOpen=(()=>{
   const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],C=window.detailC,cur='statistics',esc=String,fmt=String,statsRate=String,panelIsEnglish=()=>true;
   let selectedBucketMs=null,detailRequest=0;const chartPoints=[{bucketMs:1},{bucketMs:2},{bucketMs:3}];
   const backendRequest=()=>new Promise((resolve,reject)=>window.pending.push({resolve,reject}));
   ${source.slice(detailStart,detailEnd)}
   ${source.slice(closeStart,closeEnd)}
   return openBucket;})();`});
  const resolve=async(index,name)=>page.evaluate(({index,name})=>window.pending[index].resolve({nodes:[{id:1,name,rxBytesPerSec:100,txBytesPerSec:200,sampleCount:1}]}),{index,name});
  await page.evaluate(()=>{window.testOpen(1)});
  assert(await page.locator('#stats-bucket-detail').evaluate(el=>el.hidden),'Initial load must not create a tiny placeholder card that then jumps in height');
  await resolve(0,'First interval');await page.locator('.stats-bucket-content').waitFor();await page.waitForTimeout(300);
  const before=await page.locator('#stats-bucket-detail').boundingBox();
  await page.evaluate(()=>{window.testOpen(2)});
  assert.match(await page.locator('#stats-bucket-detail').innerText(),/First interval/,'Switching intervals must retain the previous card until data arrives');
  assert.equal((await page.locator('#stats-bucket-detail').boundingBox()).height,before.height,'Pending requests must not collapse the details card');
  await resolve(1,'Second interval');await page.getByRole('cell',{name:'Second interval',exact:true}).waitFor();
  assert(await page.locator('.stats-bucket-content').evaluate(el=>el.getAnimations().length>0),'Replacement content must fade in');
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{window.testOpen(3)});await resolve(2,'Reduced motion');
  await page.getByRole('cell',{name:'Reduced motion',exact:true}).waitFor();
  assert.equal(await page.locator('.stats-bucket-content').evaluate(el=>el.getAnimations().length),0,'OS reduced motion must disable the fade');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>{window.detailC.motion=false;document.documentElement.dataset.motion='off';window.testOpen(1)});await resolve(3,'Motion off');
  await page.getByRole('cell',{name:'Motion off',exact:true}).waitFor();
  assert.equal(await page.locator('.stats-bucket-content').evaluate(el=>el.getAnimations().length),0,'Panel motion preference must disable the fade');
  await page.evaluate(()=>{window.testOpen(2)});await page.locator('[data-stats-detail-close]').click();await resolve(4,'Late response');
  assert(await page.locator('#stats-bucket-detail').evaluate(el=>el.hidden),'A late response must not reopen closed details');
  await context.close();console.log(`Statistics selection: ${cases} density/viewport/scale cases, keyboard, live refresh, drag, missing intervals, touch, hover and smooth details passed`);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
