#!/usr/bin/env node
'use strict';
// Full Chromium interaction test. Mount the REAL XHTTP controller, strict
// validator, shared modal runtime, localization and production CSS cascade.
// This catches problems that textual source/VM tests cannot: dialogs, scaling,
// locale switches, nested transitions, safe cancellation and actual JSON writes.
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('./browser/node_modules/playwright');
const {panelStyles}=require('./ci/frontend-source.cjs');

const asset=name=>path.resolve(__dirname,'../frontend/js/'+name);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const makePage=async(browser,width,height,lang)=>{
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce',locale:lang==='en'?'en-US':'ru-RU'});
 const html='<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>XRAY STUDIO</title></head>'+
  '<body><main id="xm-studio-v4" class="sv-studio">'+
  '<select data-tool-inbound aria-label="Inbound"><option value="0">Main inbound</option></select>'+
  '<textarea data-v="source" aria-label="JSON" spellcheck="false"></textarea>'+
  '<small data-tool-status role="status"></small>'+
  '<button data-tool="xhttp">XHTTP</button>'+
  '<button data-tool="xhttp-device">Device profiles</button>'+
  '</main></body></html>';
 await page.route('http://studio.xmesh.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
 await page.goto('http://studio.xmesh.test/',{waitUntil:'domcontentloaded'});
 await page.addStyleTag({content:panelStyles()});
 for(const script of [
  'core/i18n.js',
  'core/i18n-consistency.js',
  'features/xray-studio/xray-studio-xhttp-strict.js',
  'features/xray-studio/xray-studio-dialogs.js',
  'features/xray-studio/xray-studio-xhttp-expert.js'
 ])await page.addScriptTag({path:asset(script)});
 await page.evaluate(lang=>window.XMeshI18n.setLanguage(lang),lang);
 return page;
};
const modal=page=>page.locator('dialog.xm-studio-modal[open]');
const setSource=async(page,doc)=>{
 await page.locator('[data-v="source"]').fill(typeof doc==='string'?doc:JSON.stringify(doc,null,2));
};
const json=async page=>JSON.parse(await page.locator('[data-v="source"]').inputValue());
const checkDialog=async(page,label)=>{
 await modal(page).waitFor({state:'visible'});
 const geometry=await page.evaluate(()=>{
  const d=document.querySelector('dialog.xm-studio-modal[open]'),rect=d.getBoundingClientRect(),foot=d.querySelector('.xm-studio-modal-footer');
  const nodes=[...d.querySelectorAll('.xm-studio-modal-field,.xm-studio-modal-choice,.xm-studio-modal-preview')];
  return {rect:rect.toJSON(),width:d.clientWidth,scrollWidth:d.scrollWidth,
   minButton:Math.min(...[...d.querySelectorAll('button:not(:disabled)')].map(n=>n.getBoundingClientRect().height)),
   clipped:nodes.filter(n=>{const r=n.getBoundingClientRect();return r.right>rect.right+3||r.left<rect.left-3}).length,
   hasFooter:!!foot,footerWidth:foot?.getBoundingClientRect().width||0};
 });
 const viewport=page.viewportSize();
 assert(geometry.rect.left>=-2&&geometry.rect.right<=viewport.width+2,label+': dialog overflows viewport '+JSON.stringify(geometry));
 assert(geometry.rect.top>=-2&&geometry.rect.bottom<=viewport.height+2,label+': dialog vertically offscreen');
 assert(geometry.scrollWidth<=geometry.width+4,label+': horizontal scroll in dialog');
 assert.equal(geometry.clipped,0,label+': clipped editor blocks');
 assert(geometry.minButton>=32,label+': buttons are too small');
 assert(geometry.hasFooter&&geometry.footerWidth>=160,label+': missing action footer');
 return geometry;
};
const englishAudit=async(page,label)=>{
 await page.waitForTimeout(90);
 const leaks=await modal(page).evaluate(dlg=>{
  const results=[];
  const walker=document.createTreeWalker(dlg,NodeFilter.SHOW_TEXT);
  let node;while((node=walker.nextNode())){
   if(node.parentElement.closest('pre,code,textarea,[translate="no"]'))continue;
   if(!node.parentElement.getClientRects().length)continue;
   if(/[А-Яа-яЁё]/u.test(node.nodeValue))results.push(node.nodeValue.trim());
  }
  for(const el of dlg.querySelectorAll('[title],[placeholder],[aria-label]')){
   if(!el.getClientRects().length)continue;
   for(const attr of ['title','placeholder','aria-label'])
    if(/[А-Яа-яЁё]/u.test(el.getAttribute(attr)||''))results.push(el.tagName+' '+attr+': '+el.getAttribute(attr));
  }
  const code=dlg.querySelector('.xm-studio-modal-preview-code');
  if(code&&/[А-Яа-яЁё]/u.test(code.textContent))results.push('Raw JSON preview has Cyrillic');
  return results;
 });
 assert.deepEqual(leaks,[],label+': untranslated English UI '+JSON.stringify(leaks.slice(0,12)));
};
const openExpert=async(page)=>{
 await page.locator('[data-tool="xhttp"]').click();
 await modal(page).waitFor({state:'visible'});
};
const choose=async(page,key)=>{
 await modal(page).locator('.xm-studio-modal-choice[data-choice="'+key+'"]').click();
 assert.equal(await modal(page).locator('.xm-studio-modal-choice[data-choice="'+key+'"]').getAttribute('aria-pressed'),'true');
 await modal(page).locator('.xm-studio-modal-accept').click();
};
const main=async()=>{
 const browser=await chromium.launch({headless:true,
  ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),
  args:process.env.XMESH_CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 const errors=[];
 try{
  for(const lang of ['ru','en']){
   const page=await makePage(browser,1440,900,lang);
   page.on('pageerror',e=>errors.push(String(e)));
   try{
    const doc={inbounds:[{tag:'vless-main',listen:'127.0.0.1',port:443,protocol:'vless',
     settings:{users:[],decryption:'none'},streamSettings:{network:'xhttp',security:'none',
     xhttpSettings:{path:'/xhttp',mode:'auto'}}}],outbounds:[{tag:'direct',protocol:'freedom'}]};
    await setSource(page,doc);
    await openExpert(page);
    await checkDialog(page,lang+' expert cards');
    const preview=JSON.parse(await modal(page).locator('.xm-studio-modal-preview-code').textContent());
    assert.equal(preview.xhttpSettings.path,'/xhttp');
    assert.equal(preview.network,'xhttp');
    assert(!/[А-Яа-яЁё]/u.test(JSON.stringify(preview)),lang+': JSON preview must only contain actual keys');
    if(lang==='en')await englishAudit(page,'expert choices');
    else assert.match(await modal(page).locator('h2').textContent(),/серверные настройки/);
    await choose(page,'mode');
    await modal(page).locator('select[name="mode"]').waitFor();
    const geo=await checkDialog(page,lang+' compact mode');
    assert(geo.rect.width<=600,'Single-field mode editor must be compact, not old oversized dialog');
    if(lang==='en'){
     assert.match(await modal(page).locator('h2').textContent(),/XHTTP mode/i);
     await englishAudit(page,'mode editor');
    }
    await modal(page).locator('select[name="mode"]').selectOption('packet-up');
    await modal(page).locator('.xm-studio-modal-accept').click();
    await page.waitForTimeout(120);
    console.log('XHTTP mode after Apply:',JSON.stringify(await page.evaluate(()=>({
      mode:(()=>{try{return JSON.parse(document.querySelector('[data-v="source"]').value).inbounds?.[0]?.streamSettings?.xhttpSettings?.mode}catch{return 'invalid'}})(),
      status:document.querySelector('[data-tool-status]')?.textContent,
      dialog:document.querySelector('dialog.xm-studio-modal[open]')?.innerText?.slice(0,450)
    }))));
    // Closing the native dialog resolves the modal promise; the caller then
    // commits JSON in the next microtask. Await actual persisted state.
    await page.waitForFunction(()=>{
     try{return JSON.parse(document.querySelector('[data-v="source"]').value).inbounds?.[0]?.streamSettings?.xhttpSettings?.mode==='packet-up'}
     catch{return false}
    });
    assert.equal((await json(page)).inbounds[0].streamSettings.xhttpSettings.mode,'packet-up');
    // Nested edit then Cancel must not alter JSON.
    await openExpert(page);
    await choose(page,'basic');
    await modal(page).locator('input[name="path"]').fill('/should-not-save');
    await modal(page).locator('.xm-studio-modal-cancel').click();
    assert.equal((await json(page)).inbounds[0].streamSettings.xhttpSettings.path,'/xhttp');
    await openExpert(page);
    await choose(page,'basic');
    await modal(page).locator('input[name="path"]').fill('/saved-'+lang);
    await modal(page).locator('.xm-studio-modal-accept').click();
    await page.waitForFunction(expected=>{
     try{return JSON.parse(document.querySelector('[data-v="source"]').value).inbounds?.[0]?.streamSettings?.xhttpSettings?.path===expected}
     catch{return false}
    },'/saved-'+lang);
    assert.equal((await json(page)).inbounds[0].streamSettings.xhttpSettings.path,'/saved-'+lang);
    // Edit on a clean JSON: explicit conversion, two-step profile choice and
    // REAL strict XHTTP client validation + live, JSON-only preview.
    await setSource(page,'{}');
    await page.locator('[data-tool="xhttp-device"]').click();
    await modal(page).waitFor();
    await checkDialog(page,lang+' clean inbound confirmation');
    await modal(page).locator('.xm-studio-modal-accept').click();
    await modal(page).locator('select[name="preset"]').waitFor();
    await modal(page).locator('select[name="device"]').selectOption('iOS');
    await modal(page).locator('select[name="preset"]').selectOption('ios');
    await modal(page).locator('.xm-studio-modal-accept').click();
    await modal(page).locator('input[name="maxConnections"]').waitFor();
    await checkDialog(page,lang+' device profile');
    if(lang==='en')await englishAudit(page,'device profile');
    await modal(page).locator('input[name="maxConnections"]').fill('4-7');
    const raw=await modal(page).locator('.xm-studio-modal-preview-code').textContent();
    const data=JSON.parse(raw);
    assert.equal(data.xmesh.xhttpDeviceProfiles.iOS.xmux.maxConnections,'4-7');
    assert(!/[А-Яа-яЁё]/u.test(raw),lang+': preview contains translated prose inside JSON');
    // Switch language in an OPEN dialog and verify the live preview remains
    // valid JSON, the description re-localizes and values are not reset.
    await page.evaluate(value=>window.XMeshI18n.setLanguage(value),lang==='ru'?'en':'ru');
    await page.waitForTimeout(90);
    const other=await modal(page).locator('.xm-studio-modal-copy p').textContent();
    assert(other.includes(lang==='ru'?'The profile is saved':'Профиль сохраняется'),
     'Changing language in an open modal did not update its description: '+other);
    assert.equal((JSON.parse(await modal(page).locator('.xm-studio-modal-preview-code').textContent())).xmesh.xhttpDeviceProfiles.iOS.xmux.maxConnections,'4-7');
    await page.evaluate(value=>window.XMeshI18n.setLanguage(value),lang);
    await modal(page).locator('.xm-studio-modal-accept').click();
    await page.waitForFunction(()=>{
     try{return JSON.parse(document.querySelector('[data-v="source"]').value).inbounds?.[0]?.xmesh?.xhttpDeviceProfiles?.iOS?.xmux?.maxConnections==='4-7'}
     catch{return false}
    });
    const saved=await json(page),inbound=saved.inbounds[0];
    assert.equal(inbound.listen,'127.0.0.1');
    assert.equal(inbound.streamSettings.network,'xhttp');
    assert.equal(inbound.xmesh.xhttpDeviceProfiles.iOS.xmux.maxConnections,'4-7');
    assert.equal(saved.outbounds[0].protocol,'freedom');
    assert.equal(windowTestIsFinite(inbound.port),true);
    console.log('XHTTP browser '+lang+': localized editor, real save/cancel, live device preview, clean JSON OK');
   }finally{await page.close()}
  }
  // Responsive geometries: one compact control, a card chooser and a profile
  // preview should never overflow on a phone or a small laptop.
  for(const [width,height] of [[390,844],[768,1024],[1366,768],[1920,1080]]){
   const page=await makePage(browser,width,height,'ru');
   page.on('pageerror',e=>errors.push(String(e)));
   try{
    await setSource(page,{inbounds:[{tag:'main',listen:'127.0.0.1',port:443,protocol:'vless',
     settings:{users:[],decryption:'none'},
     streamSettings:{network:'xhttp',security:'none',xhttpSettings:{path:'/xhttp',mode:'auto'}}}]});
    await openExpert(page);
    await checkDialog(page,'expert '+width+'x'+height);
    await choose(page,'mode');
    await checkDialog(page,'single setting '+width+'x'+height);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('dialog.xm-studio-modal[open]'));
    await page.locator('[data-tool="xhttp-device"]').click();
    await modal(page).locator('select[name="preset"]').waitFor();
    await modal(page).locator('select[name="preset"]').selectOption('ios');
    await modal(page).locator('.xm-studio-modal-accept').click();
    await modal(page).locator('input[name="maxConnections"]').waitFor();
    await checkDialog(page,'device '+width+'x'+height);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('dialog.xm-studio-modal[open]'));
    console.log('XHTTP modal geometry '+width+'x'+height+': OK');
   }finally{await page.close()}
  }
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('XHTTP RU/EN Chromium end-to-end, strict schema and responsive dialog regression passed');
 }finally{await browser.close()}
};
const windowTestIsFinite=value=>Number.isSafeInteger(value);
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
