'use strict';
// Real template + public assets, with disposable server-rendered subscription data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('./browser/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=process.env.XMESH_BROWSER_OUTPUT||'/tmp/xmesh-public-portal';
const read=f=>fs.readFileSync(path.join(root,f));
// Model an older XMesh Sub gateway: HTML is available, but static portal
// CSS/JS URLs may return 404. The page must still render and work.
const embeddedCss=[
 'frontend/styles/features/subscriptions/subscription-studio.css',
 'frontend/styles/features/subscriptions/subscription-surface.css',
 'frontend/styles/features/subscriptions/subscription-public.css'
].map(file=>read(file).toString()).join('\n');
const embeddedScripts=[
 'frontend/js/core/qr-code.js',
 'frontend/js/features/subscriptions/subscription-experience.js',
 'frontend/js/features/subscriptions/subscription-traffic.js',
 'frontend/js/features/subscriptions/subscription-portal.js'
].map(file=>'<script nonce="fixture-test">\n'+read(file).toString()+'\n</script>').join('\n');
const assets={
 '/subscription-studio.css':'frontend/styles/features/subscriptions/subscription-studio.css',
 '/subscription-surface.css':'frontend/styles/features/subscriptions/subscription-surface.css',
 '/subscription-public.css':'frontend/styles/features/subscriptions/subscription-public.css',
 '/subscription-experience.js':'frontend/js/features/subscriptions/subscription-experience.js',
 '/subscription-traffic.js':'frontend/js/features/subscriptions/subscription-traffic.js',
 '/subscription-portal.js':'frontend/js/features/subscriptions/subscription-portal.js',
 '/qr-code.js':'frontend/js/core/qr-code.js'
};
function fixture(url){
 const state=url.searchParams.get('state')||'ACTIVE';
 const en=url.searchParams.get('lang')==='en',active=url.searchParams.get('active')!=='0'&&!['EXPIRED','LIMITED','DISABLED'].includes(state),unlimited=url.searchParams.get('limit')==='0',light=url.searchParams.get('theme')==='light';
 const text=(ru,enText)=>en?enText:ru;
 const data={PUBLIC_CSS:embeddedCss,PUBLIC_SCRIPTS:embeddedScripts,LANG:en?'en':'ru',BRAND:process.env.XMESH_TEST_BRAND||'Private VPN',LOGO:'<span aria-hidden="true">S</span>',
 ACCENT:url.searchParams.get('accent')==='dark'?'#2549bf':light?'#86e0b6':'#ff9788',SECONDARY_ACCENT:'#a3bffa',BACKGROUND:light?'#f6f8fa':'#0d1218',CARD_COLOR:light?'#ffffff':'#151c25',TEXT_COLOR:light?'#1c2938':'#edf2f7',RADIUS:'20',THEME:light?'light':'dark',LAYOUT:'standard',FONT:'system',CARD_STYLE:url.searchParams.get('material')||'soft',
 RU_SELECTED:en?'':'on',EN_SELECTED:en?'on':'',RU_CURRENT:en?'false':'page',EN_CURRENT:en?'page':'false',
 STATUS_DOT:'<span class="subscription-preview-ok">● '+text(active?'Активна':'Неактивна',active?'Active':'Inactive')+'</span>',
 HERO:text(active?'Подписка активна':'Подписка неактивна',active?'Subscription active':'Subscription inactive'),DESCRIPTION:text('Ваш доступ к интернету. Всё необходимое для подключения.','Your internet access. Everything you need to get connected.'),
 METRICS:url.searchParams.get('metrics')==='0'?'':'<div class="subscription-preview-meta" data-subscription-metrics><div data-subscription-traffic data-traffic-servers="[{&quot;name&quot;:&quot;Poland&quot;,&quot;gib&quot;:20,&quot;upload&quot;:5,&quot;download&quot;:15},{&quot;name&quot;:&quot;Germany&quot;,&quot;gib&quot;:14.5,&quot;upload&quot;:4,&quot;download&quot;:10.5}]" data-used-gib="34.5" data-limit-gib="'+(unlimited?0:100)+'"><small>'+text('Трафик','Data usage')+'</small><b>'+text(unlimited?'34,5 ГБ / Без лимита':'34,5 / 100 ГБ',unlimited?'34.5 GB / Unlimited':'34.5 / 100 GB')+'</b><div class="subscription-preview-progress"><i style="width:'+(unlimited?'0':'34.5')+'%"></i></div></div><div data-subscription-expiry><small>'+text('Действует до','Expires')+'</small><b data-expiry="1796688000000"></b></div></div>',
 CTA:active?'<button type="button" class="subscription-preview-cta" id="connect-link">'+text('Подключиться','Connect')+'</button><input type="hidden" id="subscription-link" value="/s/disposable-test-token-0123456789abcdef">':'<div class="subscription-preview-cta" aria-disabled="true">'+text('Подписка неактивна','Subscription inactive')+'</div>',
 QUICK_ACTIONS:active?'<div class="subscription-preview-quick"><button type="button" id="copy-link">'+text('Скопировать ссылку','Copy link')+'</button><button type="button" id="toggle-qr" aria-expanded="false">QR</button><button type="button" id="toggle-link" aria-expanded="false">'+text('Показать ссылку','Show private link')+'</button><button type="button" id="toggle-devices">'+text('Устройства','Devices')+'</button></div>':'',
 QR:active?'<div id="subscription-qr" class="subscription-preview-qr" hidden></div>':'',DEVICE_INFO:active?'<div id="subscription-devices" class="subscription-public-devices" hidden>'+text('Зарегистрировано устройств: 2 · Лимит: 5','Registered devices: 2 · Limit: 5')+'</div>':'',
 APPS:active&&url.searchParams.get('apps')!=='0'?'<section class="subscription-preview-apps"><header>'+text('Приложения для подключения','Connection apps')+'</header><div>'+[['Happ','iOS · Android · Windows · macOS'],['v2rayNG','Android'],['v2rayN','Windows · Linux'],['Streisand','iOS']].map(([n,p])=>'<a class="subscription-preview-app" data-client-id="'+n.toLowerCase()+'" href="https://example.invalid/'+n+'" target="_blank" rel="noopener noreferrer"><span>'+n.slice(0,2)+'</span><div><b>'+n+'</b><small>'+p+'</small></div></a>').join('')+'</div></section>':'',
 SUPPORT:'<a class="subscription-preview-support" href="https://support.example.invalid" rel="noopener noreferrer">'+text('Написать в поддержку','Contact support')+'</a>',FOOTER:''};
 if(state==='LIMITED')data.METRICS=data.METRICS.replace('data-used-gib="34.5"','data-used-gib="100"');
 if(url.searchParams.get('empty')==='1')data.METRICS=data.METRICS.replace('data-used-gib="34.5"','data-used-gib="0"').replace(/data-traffic-servers="[^"]*"/,'data-traffic-servers="[]"');
 return read('backend/src/subscription_template.html').toString().replace('class="subscription-preview"','class="subscription-preview" data-subscription-state="'+state+'"').replace(/\{\{([A-Z_]+)\}\}/g,(_,key)=>{assert(key in data,'Missing fixture '+key);return data[key]});
}
async function dismissDialog(page,dialog,opener){
 await dialog.evaluate(d=>{d._testClosed=false;d.addEventListener('close',()=>{d._testClosed=true},{once:true});});
 await page.keyboard.press('Escape');
 await page.waitForFunction(d=>d._testClosed&&!d.open,await dialog.elementHandle());
 assert(await opener.evaluate(b=>b.getRootNode().activeElement===b),'Dialog close restores focus to its opener');
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(assets[u.pathname]){res.statusCode=404;res.end('Legacy gateway does not serve static assets');return;}if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(fixture(u));return;}res.statusCode=404;res.end();});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:process.env.XMESH_CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 let checks=0;
 try{
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  await context.route('https://fonts.googleapis.com/**',r=>r.abort());const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const [width,height] of [[320,780],[375,812],[390,844],[430,932],[768,1024],[1024,768],[1440,1000],[1920,1080]])for(const lang of ['ru','en']){
   await page.setViewportSize({width,height});await page.goto(base+'/?lang='+lang+'&theme='+(lang==='en'?'light':'dark'));await page.waitForSelector('.portal-donut');
   assert.equal(await page.locator('#subscription-link-card,#toggle-link').count(),0,'No link reveal UI');
   const g=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth,body:innerWidth,title:parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),minTap:Math.min(...[...document.querySelectorAll('.subscription-cabinet-tab:not([hidden]),.subscription-preview-languages a,.subscription-preview-cta')].map(el=>el.getBoundingClientRect().height))}));
   assert(g.overflow<=g.body+1,JSON.stringify(g));assert(g.title>=30,'Readable heading');assert(g.minTap>=44,'Touch target too small');
   assert.equal(await page.locator('.experience-shortcuts strong').count(),4,'Available shortcuts have visible labels');assert.equal(await page.locator('.experience-quick-platforms button').count(),6);assert.equal(await page.locator('.experience-server-panel h2').innerText(),lang==='en'?'Usage by server':'Трафик по серверам');
   assert.equal(await page.locator('[role="tab"]').count(),0,'No tab navigation');assert(await page.locator('.experience-start').isVisible());assert(await page.locator('[data-setup-section="connect"]').isVisible());assert.equal(await page.locator('#copy-link').count(),0,'Only one copy button');
   assert.equal(await page.locator('.portal-donut-server').count(),2);
   const server=page.locator('.portal-donut-server').first();await server.click();
   assert.equal(await page.locator('.portal-donut-center small').innerText(),'Poland');
   assert.match(await page.locator('.portal-donut-center b').innerText(),/^20 /);
   const arc=page.locator('.portal-donut-chart [role="button"]').first();await arc.focus();await page.keyboard.press('Enter');assert.equal(await arc.getAttribute('aria-pressed'),'false');await page.keyboard.press('Enter');assert.equal(await arc.getAttribute('aria-pressed'),'true');
   await page.locator('.portal-donut-reset').click();
   assert.match(await page.locator('.portal-donut-center b').innerText(),/^34[.,]5 /);
   const layout=await page.evaluate(()=>{
     const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,bottom:r.bottom}};
     return {copy:rect('#connect-link'),qr:rect('#toggle-qr'),apps:rect('[data-setup-section="apps"]'),usage:rect('[data-subscription-traffic]')};
   });
   assert(await page.locator('[data-setup-section="apps"]').isHidden(),'Catalog is progressively disclosed');
   if(width>=390)assert(Math.abs(layout.copy.top-layout.qr.top)<1,'Copy and QR share one row');
   if(width<=390)assert(layout.copy.top<layout.usage.top,'Mobile prioritizes access before metrics');
   if(width===390||width===1440)await page.screenshot({path:path.join(out,'portal-overview-'+width+'-'+lang+'.png'),fullPage:true,animations:'disabled'});
   await page.locator('.experience-start').click();
   assert(await page.locator('.experience-guide').evaluate(el=>el.open));
   await page.locator('.experience-platforms button').filter({hasText:'Android'}).click();
   await page.locator('.experience-app').filter({hasText:'Happ'}).click();
   assert((await page.locator('.experience-open').getAttribute('href')).startsWith('happ://add/'+base+'/s/'));
   assert(await page.locator('.experience-install').isVisible());
   assert.equal(await page.locator('.experience-instructions li').count(),3);
   if(width===390||width===1440)await page.screenshot({path:path.join(out,'portal-guide-'+width+'-'+lang+'.png'),animations:'disabled'});
   await dismissDialog(page,page.locator('.experience-guide'),page.locator('.experience-start'));

   await page.locator('#connect-link').click();
   assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),base+'/s/disposable-test-token-0123456789abcdef');
   assert.equal(await page.locator('#subscription-action-status').innerText(),'');assert.equal(await page.locator('#connect-link').innerText(),lang==='en'?'Copied':'Скопировано');assert.equal(await page.locator('.portal-quickstart').count(),0);
   await page.locator('#toggle-qr').click();await page.locator('.experience-qr').waitFor({state:'visible'});assert(await page.locator('.experience-qr').evaluate(d=>d.open),'QR modal finishes opening before keyboard interaction');assert.equal(await page.locator('#subscription-qr svg').count(),1);assert.equal(await page.locator('#subscription-qr').getAttribute('aria-label'),lang==='en'?'Subscription QR code':'QR-код подписки');assert.equal(await page.locator('.subscription-preview-languages').getAttribute('aria-label'),lang==='en'?'Language':'Язык');assert.equal(await page.locator('#subscription-qr svg').getAttribute('aria-label'),lang==='en'?'Subscription QR code':'QR-код подписки');

   await dismissDialog(page,page.locator('.experience-qr'),page.locator('#toggle-qr'));
   await page.locator('#connect-link').focus();
   const focusBefore=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,dialogs:[...document.querySelectorAll('dialog')].map(d=>({open:d.open,modal:d.matches(':modal')}))}));
   await page.keyboard.press('Tab');
   const focusAfter=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,html:document.activeElement.outerHTML.slice(0,300),buttons:[...document.querySelectorAll('.subscription-public-primary-action button')].map(b=>({id:b.id,tabIndex:b.tabIndex,disabled:b.disabled,hidden:b.hidden,display:getComputedStyle(b).display}))}));
   assert.equal(focusAfter.id,'toggle-qr','Keyboard order follows setup: '+width+'px '+lang+' '+JSON.stringify({before:focusBefore,after:focusAfter}));
   if(lang==='en')assert(!/[А-Яа-яЁё]/.test(await page.locator('body').innerText()),'English portal has untranslated copy');checks++;
  }
  await page.goto(base+'/?lang=en');await page.waitForSelector('.experience-quick-platforms');
  await page.locator('.experience-quick-platforms button').filter({hasText:'iOS'}).click();
  assert.equal(await page.locator('.experience-quick-platforms [aria-pressed=true]').innerText(),'iOS');
  await page.locator('.experience-quick-open').click();assert.equal(await page.locator('.experience-platforms [aria-pressed=true]').innerText(),'iOS / iPadOS');
  await dismissDialog(page,page.locator('.experience-guide'),page.locator('.experience-quick-open'));
  const deviceShortcut=page.locator('.experience-shortcuts button').filter({hasText:/^Devices/});
  await deviceShortcut.click();await page.locator('.experience-devices').waitFor({state:'visible'});assert.equal(await page.locator('.experience-device-value').innerText(),'Registered devices: 2 · Limit: 5');
  await dismissDialog(page,page.locator('.experience-devices'),deviceShortcut);
  await page.locator('.experience-shortcuts button').filter({hasText:'By server'}).click();assert(await page.locator('.experience-server-panel').evaluate(el=>document.activeElement===el));
  assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'),'34.5');checks++;
  for(const [state,title]of [['EXPIRED','Your subscription has expired'],['LIMITED','Data allowance reached'],['DISABLED','Subscription paused'],['ON_HOLD','Ready for your first connection']]){
   await page.goto(base+'/?lang=en&state='+state);await page.waitForFunction(()=>document.querySelector('h1').textContent!=='Subscription active');assert.equal(await page.locator('h1').innerText(),title);
   if(state!=='ON_HOLD'){assert(await page.locator('[data-setup-section="connect"]').isHidden());assert(await page.locator('.experience-start').isHidden());assert(await page.locator('.experience-shortcuts').isHidden());assert.equal(await page.locator('.experience-dashboard').count(),1);}
   checks++;
  }
  await page.goto(base+'/?lang=en');await page.waitForSelector('#connect-link');
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied')}},configurable:true});document.execCommand=()=>{throw Error('fallback denied')}});
  await page.locator('#connect-link').click();assert.equal(await page.locator('#subscription-action-status').innerText(),'Copy not available');checks++;
  for(const [ua,touches,expected]of [
   ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',1,'iOS / iPadOS'],
   ['Mozilla/5.0 (Linux; Android 15)',1,'Android'],
   ['Mozilla/5.0 (Windows NT 10.0; Win64)',0,'Windows'],
   ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',0,'macOS'],
   ['Mozilla/5.0 (X11; Linux x86_64)',0,'Linux'],
   ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',5,'iOS / iPadOS']]){
    const device=await browser.newContext({userAgent:ua});await device.addInitScript(n=>Object.defineProperty(navigator,'maxTouchPoints',{get:()=>n}),touches);const p=await device.newPage();await p.route('https://fonts.googleapis.com/**',r=>r.abort());await p.goto(base+'/?lang=en');await p.locator('.experience-start').click();assert.equal(await p.locator('.experience-platforms [aria-pressed=true]').innerText(),expected);await device.close();checks++;
  }
  await page.goto(base+'/?lang=en');await page.waitForSelector('.portal-donut');
  await page.evaluate(()=>window.XMeshSubscriptionTraffic.mount(document.querySelector('[data-subscription-traffic]'),{used:1048576,limit:0,servers:[{name:'<img src=x onerror=alert(1)> very long server name',gib:1048576,upload:0,download:1048576}],language:'en'}));
  assert.equal(await page.locator('.experience-unlimited-summary>b').innerText(),'1 PB');await page.locator('.experience-server-details>summary').click();assert.equal(await page.locator('.portal-donut img').count(),0);assert((await page.locator('.portal-donut-server').innerText()).includes('<img'));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
  await page.goto(base+'/?lang=en&empty=1');await page.waitForSelector('.portal-donut');assert.equal(await page.locator('.portal-donut-server').count(),0);assert.equal(await page.locator('.portal-donut-center b').innerText(),'0 GB');checks++;
  await page.goto(base+'/?lang=en&accent=dark');await page.waitForSelector('#connect-link');assert.equal(await page.locator('.experience-start').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)','Dark custom accent needs contrasting button text');checks++;
  await page.goto(base+'/?lang=en&apps=0');await page.waitForFunction(()=>document.querySelector('[data-setup-section="apps"]').hidden);assert(await page.locator('#connect-link').isVisible());checks++;
  await page.goto(base+'/?lang=en&metrics=0');await page.waitForFunction(()=>document.querySelector('.subscription-public-info-panel').hidden);checks++;
  await page.goto(base+'/?lang=en&limit=0');await page.waitForSelector('#connect-link');assert.equal(await page.locator('[role="meter"],[role="progressbar"]').count(),0);assert.equal(((await page.locator('[data-subscription-traffic]').innerText()).match(/Unlimited/g)||[]).length,1);await page.screenshot({path:path.join(out,'portal-unlimited-1920-en.png'),fullPage:true,animations:'disabled'});checks++;
  await page.goto(base+'/?lang=en&active=0');await page.waitForFunction(()=>document.querySelector('[data-setup-section="connect"]').hidden);assert(await page.locator('[data-setup-section="apps"]').isHidden());assert(await page.locator('[data-setup-section="support"]').isVisible());checks++;
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(base+'/?lang=en');await page.waitForSelector('#connect-link');assert.equal(await page.locator('[data-setup-section="connect"]').evaluate(el=>getComputedStyle(el).animationName),'none');checks++;
  await page.goto(base+'/?lang=en');
  await page.addScriptTag({content:read('frontend/js/features/subscriptions/subscription-experience.js').toString()});
  await page.addScriptTag({content:read('frontend/js/features/subscriptions/subscription-traffic.js').toString()});
  await page.addScriptTag({content:read('frontend/js/features/subscriptions/subscription-studio.js').toString()});
  await page.addStyleTag({content:read('frontend/styles/features/subscriptions/subscription-studio.css').toString()});
  await page.evaluate(()=>{
    window.__subEnrollCallCount=0;
    window.__subOnline=false;
    const subApi={
      status:async()=>window.__subOnline
        ? {enrolled:true,online:true,domainMatches:true,version:'v0.3.0',lastSeen:1794460000,update:{}}
        : {enrolled:false,online:false,domainMatches:false,update:{}},
      enroll:async()=>{window.__subEnrollCallCount++;return {enrollmentToken:'a'.repeat(64),expiresInSeconds:3600}},
      update:async()=>{throw Error('Update requires a paired, online agent')}
    };
    const [markup,mount]=window.XMeshSubscriptionStudio.create({domain:'panel.example.org',subscriptionLanguage:'en',subscriptionSyncPanelTheme:false,subscriptionShowDevices:true,subscriptionShowSupport:true},async()=>{},()=>{},{users:2,nodes:1},null,subApi);
    document.body.innerHTML=markup;mount();
  });
  const studio=page.locator('[data-subscription-preview-frame]');
  assert.equal(await studio.locator('.subscription-preview').getAttribute('lang'),'en');assert(await studio.locator('.experience-days').isVisible());
  assert.match(await studio.locator('.portal-donut-center b').innerText(),/^12.4 /);
  assert(!/[А-Яа-яЁё]/.test(await studio.innerText()),'Studio English preview has untranslated copy');
  assert(await studio.locator('.portal-app-disclosure').evaluate(el=>!el.open));
  await studio.locator('.experience-start').click();assert(await studio.locator('.experience-guide').evaluate(el=>el.open));await dismissDialog(page,studio.locator('.experience-guide'),studio.locator('.experience-start'));
  await studio.locator('[data-subscription-qr]').click();await studio.locator('.experience-qr').waitFor({state:'visible'});assert(await studio.locator('.experience-qr').evaluate(el=>el.open));assert.equal(await studio.locator('.experience-qr svg').count(),1);await dismissDialog(page,studio.locator('.experience-qr'),studio.locator('[data-subscription-qr]'));assert(await studio.locator('[data-preview-qr]').isHidden());

  await studio.locator('[data-portal-language="ru"]').click();
  assert.match(await studio.locator('.portal-donut-center b').innerText(),/^12,4 /);
  await page.locator('[name="subscriptionShowTraffic"]').uncheck();
  assert(await studio.locator('[data-subscription-traffic]').isHidden());
  const hiddenLayout=await studio.locator('.subscription-preview-hero').evaluate(el=>{const c=el.closest('.subscription-preview').querySelector('[data-setup-section="connect"]');return {header:el.getBoundingClientRect().bottom,connect:c.getBoundingClientRect().top}});assert(hiddenLayout.connect>=hiddenLayout.header,'Hidden metrics must not overlap connection and heading');
  await page.locator('[name="subscriptionShowExpiry"]').uncheck();
  assert(await studio.locator('.subscription-public-info-panel').isHidden());
  await page.locator('[name="subscriptionShowQr"]').uncheck();
  assert(await studio.locator('[data-subscription-qr]').isHidden());checks++;
  // The Content redesign preserves real controls and shared save handling.
  await page.emulateMedia({reducedMotion:'no-preference'});
  const contentTab=page.locator('[data-substudio-tab="content"]');
  await contentTab.click();
  const content=page.locator('#substudio-content');
  assert(await content.isVisible());
  assert.equal(await content.locator('.subscription-content-card').count(),3);
  assert.equal(await content.locator('.subscription-content-language').count(),2);
  assert.equal(await content.locator('[name="subscriptionSupportUrl"]').count(),1);
  assert.equal(await content.locator('[name="subscriptionShowSupport"]').count(),1);
  const announceToggle=content.locator('[name="subscriptionAnnouncementEnabled"]');
  assert.equal(await announceToggle.getAttribute('role'),'switch');
  assert(await announceToggle.isChecked(),'Announcements remain enabled by default');
  const cssMotion=await announceToggle.evaluate(el=>getComputedStyle(el).transitionDuration);
  assert.notEqual(cssMotion,'0s','The active switch has an animation');
  await announceToggle.uncheck();
  assert.equal(await content.locator('.subscription-content-announcements').getAttribute('data-announcements-enabled'),'false');
  assert.equal(await page.locator('.subscription-studio').getAttribute('data-unsaved'),'true');
  await announceToggle.focus();await page.keyboard.press('Space');
  assert(await announceToggle.isChecked(),'Space toggles the switch with the keyboard');
  const personal=content.locator('[name="subscriptionProfileWebPageEnabled"]');
  const embedded=content.locator('[name="subscriptionUseEmbeddedPortal"]');
  const url=content.locator('[name="subscriptionProfileWebPageUrl"]');
  assert(await personal.isChecked()&&await embedded.isChecked());
  assert(await url.isDisabled(),'Built-in portal mode disables external URL editing');
  await embedded.uncheck();
  assert(await url.isEnabled(),'Own website mode enables the URL input');
  await url.fill('https://account.example.org/membership');
  assert.match(await content.locator('[data-subscription-profile-page-preview]').innerText(),
    /https:\/\/account\.example\.org\/membership/);
  await embedded.check();
  assert.equal(await url.inputValue(),'','Switching to embedded portal clears the override');
  assert(await url.isDisabled());
  await personal.uncheck();
  assert.match(await content.locator('[data-subscription-profile-page-preview]').innerText(),/Выключено/);
  assert(await embedded.isDisabled());
  await personal.check();
  assert(await embedded.isEnabled());
  await content.locator('[name="subscriptionShowSupport"]').uncheck();
  assert(await studio.locator('[data-setup-section="support"]').isHidden());
  await content.locator('[name="subscriptionShowSupport"]').check();
  await page.setViewportSize({width:1600,height:900});
  const desktopContent=await page.evaluate(()=>({
    overflow:document.documentElement.scrollWidth>innerWidth+1,
    columns:[...document.querySelectorAll('#substudio-content .subscription-content-language')].map(el=>({
      top:Math.round(el.getBoundingClientRect().top),
      left:Math.round(el.getBoundingClientRect().left)
    }))
  }));
  assert(!desktopContent.overflow,'Content workspace must not overflow at 1600px');
  assert.equal(desktopContent.columns[0].top,desktopContent.columns[1].top,
    'RU and EN inputs should align as two columns');
  await page.screenshot({path:path.join(out,'studio-content-desktop.png'),fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  const mobileContent=await page.evaluate(()=>({
    overflow:document.documentElement.scrollWidth>innerWidth+1,
    columns:[...document.querySelectorAll('#substudio-content .subscription-content-language')].map(el=>
      Math.round(el.getBoundingClientRect().top))
  }));
  assert(!mobileContent.overflow,'Content workspace must not overflow at 390px');
  assert(mobileContent.columns[1]>mobileContent.columns[0],
    'RU and EN inputs should stack on mobile');
  await page.screenshot({path:path.join(out,'studio-content-mobile.png'),fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:1600,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await announceToggle.evaluate(el=>getComputedStyle(el).transitionDuration),'0s',
    'Respect reduced-motion preference for switches');
  checks++;
  // Keep the live preview mounted across six Studio workspaces.
  const portalTab=page.locator('[data-substudio-tab="portal"]');
  const serversTab=page.locator('[data-substudio-tab="servers"]');
  const securityTab=page.locator('[data-substudio-tab="security"]');
  assert.equal(await page.locator('[data-substudio-tab]').count(),6,'Studio has six functional workspaces');
  await serversTab.click();
  assert.equal(await serversTab.getAttribute('aria-selected'),'true');
  assert(await studio.isVisible(),'Preview must remain visible across settings and server workspaces');
  assert(await page.locator('.subscription-servers-page').isVisible());
  assert(await page.locator('#substudio-portal').isHidden());
  assert.equal(await page.locator('.subscription-server-address').count(),1,'Address is a standalone card');
  assert.equal(await page.locator('.subscription-server-management').count(),1,'Management is a standalone card');
  assert.equal(await page.locator('.subscription-server-provisioning').count(),1,'Installation is a standalone card');
  assert.equal(await page.locator('.subscription-sub-step').count(),3,'Installer renders three compact step cards');
  assert(await page.locator('[data-sub-public-copy]').isDisabled(),'No copyable public template before domain is saved');
  assert(await page.locator('[data-sub-health-copy]').isDisabled(),'Health address copy requires saved domain');
  assert(await page.locator('.subscription-sub-install-command').isHidden(),
    'Sensitive installer command is not displayed before enrollment');
  await page.setViewportSize({width:1600,height:900});
  const desktop=await page.evaluate(()=>{
    const box=q=>{const r=document.querySelector(q).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
    return {address:box('.subscription-server-address'),management:box('.subscription-server-management'),
      installation:box('.subscription-server-provisioning'),
      overflow:document.documentElement.scrollWidth>innerWidth+1};
  });
  assert(!desktop.overflow,'Desktop cards may not overflow horizontally');
  assert(desktop.installation.top>=Math.min(desktop.address.top,desktop.management.top)-2,
    'Installation should remain in the server workspace beneath or alongside the management cards');
  await page.screenshot({path:path.join(out,'studio-server-cards-desktop.png'),fullPage:true,animations:'disabled'});
  await securityTab.click();
  assert(await page.locator('[data-sub-flood-card]').isVisible(),'Flood protection belongs to its own security workspace');
  assert(await page.locator('.subscription-sub-scope').isVisible(),'Security explanation belongs to its workspace');
  assert(await studio.isVisible(),'Security settings preserve the live portal preview');
  await serversTab.click();
  await page.setViewportSize({width:390,height:844});
  const mobile=await page.evaluate(()=>{
    const box=q=>{const r=document.querySelector(q).getBoundingClientRect();return {top:r.top,bottom:r.bottom}};
    const offenders=[...document.querySelectorAll('body *')].filter(el=>{
      const r=el.getBoundingClientRect();
      return r.width>0&&r.height>0&&r.right>innerWidth+1;
    }).map(el=>({tag:el.tagName,cls:String(el.className||'').slice(0,75),
      width:Math.round(el.getBoundingClientRect().width),right:Math.round(el.getBoundingClientRect().right)})).slice(0,12);
    return {address:box('.subscription-server-address'),management:box('.subscription-server-management'),
      installation:box('.subscription-server-provisioning'),overflow:document.documentElement.scrollWidth>innerWidth+1,offenders};
  });
  assert(!mobile.overflow,'Mobile server cards may not cause horizontal scroll: '+JSON.stringify(mobile.offenders));
  assert(mobile.management.top>=mobile.address.bottom-2,'Mobile management must stack below address');
  assert(mobile.installation.top>=mobile.management.bottom-2,'Mobile installation must stack below management');
  await page.screenshot({path:path.join(out,'studio-server-cards-mobile.png'),fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:1600,height:900});

  const commandCopy=page.locator('[data-sub-install-copy]');
  assert(await commandCopy.isDisabled(),'Installation cannot be copied before domain settings are saved');
  assert(await page.locator('[data-sub-health-link]').isHidden(),'Health link needs validated saved DNS');
  await page.locator('[name="subscriptionDomain"]').fill('sub.example.org');
  assert(await commandCopy.isDisabled(),'Editing the domain is not equivalent to saving it');
  await page.locator('button[form="subscription-studio-form"]').click();
  assert(await commandCopy.isDisabled(),'Saving a domain must not allow an unmanaged installer copy');
  const installGenerate=page.locator('[data-sub-enroll]');
  assert(await installGenerate.isEnabled(),'A saved domain must enable owner-only install generation');
  await installGenerate.click();
  await page.waitForFunction(()=>document.querySelector('[data-sub-install-command]').textContent.includes('--enroll-token-stdin'));
  assert(await commandCopy.isEnabled(),'Copy must only be available after one-time enrollment');
  assert.equal(await page.evaluate(()=>window.__subEnrollCallCount),1,'Exactly one enroll request');
  const managedInstall=await page.locator('[data-sub-install-command]').textContent();
  assert(managedInstall.includes('--domain sub.example.org --path /s --enroll-token-stdin'), 'Installer must read enrollment from stdin');
  const commandLines=managedInstall.split(String.fromCharCode(10));
  assert(commandLines.includes('a'.repeat(64))&&commandLines.includes('XMESH_ENROLL_TOKEN'),
    'Single command carries the one-time token as a here-document, not argv');
  assert(managedInstall.includes('sha256sum --check --status'), 'Bootstrap must verify SHA-256 before root execution');
  assert(!managedInstall.includes('--enroll-token '+'a'.repeat(64)), 'Enrollment token must not be an argv parameter');
  assert.equal(await page.locator('[data-sub-health-link]').getAttribute('href'),'https://sub.example.org/healthz');
  assert.match(await page.locator('[data-sub-install-state]').innerText(),/Команда готова/);
  assert(!/подключён|онлайн/i.test(await page.locator('[data-sub-install-state]').innerText()),
    'A generated command is not proof of a paired or online server');

  assert(await page.locator('[data-sub-agent-version]').innerText()==='—','Disconnected agent has no invented version');
  assert(await page.locator('[data-sub-update]').isDisabled(),'Update must not run while offline');
  await page.evaluate(()=>{window.__subOnline=true;});
  await page.locator('[data-sub-check]').click();
  await page.waitForFunction(()=>document.querySelector('[data-sub-agent-state]').textContent==='На связи');
  assert.equal(await page.locator('[data-sub-agent-version]').innerText(),'v0.3.0','Agent version must come from the status API');
  assert.notEqual(await page.locator('[data-sub-agent-seen]').innerText(),'—','Last seen is real API data');
  assert(await page.locator('[data-sub-update]').isEnabled(),'Live managed agent enables update action');
  checks++;
  await portalTab.click();
  assert(await studio.isVisible(),'Portal preview must remain mounted after tab switches');
  assert.equal(await page.locator('[name="subscriptionDomain"]').inputValue(),'sub.example.org');
  assert(await page.locator('.subscription-servers-page').isHidden());
  await serversTab.focus();
  await page.keyboard.press('Home');
  assert.equal(await portalTab.getAttribute('aria-selected'),'true','Keyboard Home must select the first Studio workspace');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-substudio-tab="appearance"]').getAttribute('aria-selected'),'true',
    'ArrowRight must navigate to the adjacent functional workspace');
  checks++;
  assert.deepEqual(errors,[]);console.log('Public portal: '+checks+' viewport/locale/state cases, onboarding, copy, QR, filters, keyboard, English, real usage and reduced motion passed');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
