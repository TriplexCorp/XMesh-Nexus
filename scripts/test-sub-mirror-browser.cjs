#!/usr/bin/env node
'use strict';
// Real Chromium proof that multiple Sub gateways are genuine independent
// records, not duplicated appearance-only status cards.
const {chromium}=require('./browser/node_modules/playwright');
const {panelStyles}=require('./ci/frontend-source.cjs');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({
  headless:true,
  ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),
  args:process.env.XMESH_CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]
 });
 try{
  for(const width of [390,768,1366,1920]){
   const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
   try{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<main id="view"></main>');
    await page.addStyleTag({content:panelStyles()});
    await page.addScriptTag({path:path.resolve('frontend/js/features/subscriptions/subscription-studio.js')});
    await page.evaluate(()=>{
      window.confirm=()=>true;
      const id='a'.repeat(32);
      const rows=[{id,name:'Poland mirror',domain:'sub2.example.org',
                   enrolled:true,online:true,domainMatches:true,lastSeen:Math.floor(Date.now()/1000),
                   version:'0.4.2',update:null}];
      window.mirrorFake={
        rows,
        api:{
          status:async()=>({enrolled:true,online:true,domainMatches:true,version:'0.4.2',lastSeen:Date.now()/1000}),
          floodStatus:async()=>({requests:0,exceeded:0,blocked:0}),
          mirrors:async()=>({mirrors:rows,maxMirrors:16}),
          createMirror:async(name,domain)=>{
            const record={id:'b'.repeat(32),name,domain,enrolled:false,online:false};
            rows.push(record);return record;
          },
          enrollMirror:async id=>({domain:rows.find(x=>x.id===id).domain,
            enrollmentToken:'c'.repeat(64),expiresInSeconds:3600,mirrorId:id}),
          deleteMirror:async id=>{const pos=rows.findIndex(x=>x.id===id);rows.splice(pos,1);return {ok:true}},
          updateMirror:async id=>({jobId:'c'.repeat(32),stage:'queued',updatedAt:Date.now()/1000})
        }
      };
      const settings={domain:'panel.example.org',subscriptionDomain:'sub.example.org',
        subscriptionPath:'/s',subscriptionProfileWebPageEnabled:false};
      const [markup,mount]=window.XMeshSubscriptionStudio.create(settings,
        async()=>{},()=>{}, {users:2,nodes:2},()=>null,window.mirrorFake.api);
      document.getElementById('view').innerHTML=markup;
      mount();
    });
    await page.locator('[data-substudio-tab="servers"]').click();
    await page.locator('.subscription-mirror-card').first().waitFor();
    assert.equal(await page.locator('.subscription-mirror-card').count(),1);
    assert.equal(await page.locator('.subscription-mirror-card .subscription-mirror-state').first().textContent(),'На связи');
    await page.locator('[data-mirror-open]').click();
    await page.locator('[data-mirror-name]').fill('Backup Germany');
    await page.locator('[data-mirror-domain]').fill('sub3.example.org');
    await page.locator('[data-mirror-save]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.subscription-mirror-card').length===2);
    assert.equal(await page.locator('.subscription-mirror-card').count(),2);
    await page.locator('.subscription-mirror-card').last().locator('[data-mirror-action="enroll"]').click();
    const code=page.locator('.subscription-mirror-card').last().locator('.subscription-mirror-command code');
    await code.waitFor();
    assert((await code.textContent()).includes('sub3.example.org'),'Install must target selected mirror only');
    assert((await code.textContent()).includes('/bootstrap.sh'),'Every Sub install must use pinned short bootstrap');
    assert((await code.textContent()).includes('/6fca4eb0e0388e6ec5e6817e9a8d58942935aaa2/'),
      'Mirror must use immutable audited launcher');
    assert(!(await code.textContent()).includes('c'.repeat(64)),'Mirror secret cannot leak to console');
    assert(await page.locator('.subscription-mirror-card').last().locator('[data-mirror-action="copy-token"]').isVisible(),
      'Each mirror must expose separate one-time code copy');
    await page.locator('.subscription-mirror-card').last().locator('[data-mirror-action="remove"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.subscription-mirror-card').length===1);
    const bounds=await page.evaluate(()=>{
      const frame=document.querySelector('.subscription-servers-page');
      return Math.max(0,frame.scrollWidth-frame.clientWidth);
    });
    assert(bounds<=2,'Mirror workspace horizontal overflow at '+width+': '+bounds);
    assert.deepEqual(errors,[],'Runtime errors in mirrored fleet at '+width);
    console.log('Sub mirror UI '+width+'px: independent add/enroll/revoke, no overflow');
   }finally{await page.close()}
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
