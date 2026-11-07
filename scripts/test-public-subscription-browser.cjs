'use strict';
// Real template + public assets, with disposable server-rendered subscription data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('./browser/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=process.env.XMESH_BROWSER_OUTPUT||'/tmp/xmesh-public-portal';
const read=f=>fs.readFileSync(path.join(root,f));
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
 const data={LANG:en?'en':'ru',BRAND:process.env.XMESH_TEST_BRAND||'Private VPN',LOGO:'<span aria-hidden="true">S</span>',
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
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(assets[u.pathname]){res.setHeader('Content-Type',u.pathname.endsWith('.js')?'text/javascript':'text/css');res.end(read(assets[u.pathname]));return;}if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(fixture(u));return;}res.statusCode=404;res.end();});
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
   await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.className),'experience-start');

   await page.locator('#connect-link').click();
   assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),base+'/s/disposable-test-token-0123456789abcdef');
   assert.equal(await page.locator('#subscription-action-status').innerText(),'');assert.equal(await page.locator('#connect-link').innerText(),lang==='en'?'Copied':'Скопировано');assert.equal(await page.locator('.portal-quickstart').count(),0);
   await page.locator('#toggle-qr').click();assert.equal(await page.locator('#subscription-qr svg').count(),1);assert.equal(await page.locator('#subscription-qr').getAttribute('aria-label'),lang==='en'?'Subscription QR code':'QR-код подписки');assert.equal(await page.locator('.subscription-preview-languages').getAttribute('aria-label'),lang==='en'?'Language':'Язык');assert.equal(await page.locator('#subscription-qr svg').getAttribute('aria-label'),lang==='en'?'Subscription QR code':'QR-код подписки');

   await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'toggle-qr');
   await page.locator('#connect-link').focus();
   const focusBefore=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,dialogs:[...document.querySelectorAll('dialog')].map(d=>({open:d.open,modal:d.matches(':modal')}))}));
   await page.keyboard.press('Tab');
   const focusAfter=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,html:document.activeElement.outerHTML.slice(0,300),buttons:[...document.querySelectorAll('.subscription-public-primary-action button')].map(b=>({id:b.id,tabIndex:b.tabIndex,disabled:b.disabled,hidden:b.hidden,display:getComputedStyle(b).display}))}));
   assert.equal(focusAfter.id,'toggle-qr','Keyboard order follows setup: '+width+'px '+lang+' '+JSON.stringify({before:focusBefore,after:focusAfter}));
   if(lang==='en')assert(!/[А-Яа-яЁё]/.test(await page.locator('body').innerText()),'English portal has untranslated copy');checks++;
  }
  for(const [state,title]of [['EXPIRED','Your subscription has expired'],['LIMITED','Data allowance reached'],['DISABLED','Subscription paused'],['ON_HOLD','Ready for your first connection']]){
   await page.goto(base+'/?lang=en&state='+state);await page.waitForFunction(()=>document.querySelector('h1').textContent!=='Subscription active');assert.equal(await page.locator('h1').innerText(),title);
   if(state!=='ON_HOLD')assert(await page.locator('[data-setup-section="connect"]').isHidden());
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
  await page.goto(base+'/?lang=en&limit=0');await page.waitForSelector('#connect-link');assert.equal(await page.locator('[role="meter"]').count(),0);assert.equal(((await page.locator('[data-subscription-traffic]').innerText()).match(/Unlimited/g)||[]).length,1);await page.screenshot({path:path.join(out,'portal-unlimited-1920-en.png'),fullPage:true,animations:'disabled'});checks++;
  await page.goto(base+'/?lang=en&active=0');await page.waitForFunction(()=>document.querySelector('[data-setup-section="connect"]').hidden);assert(await page.locator('[data-setup-section="apps"]').isHidden());assert(await page.locator('[data-setup-section="support"]').isVisible());checks++;
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(base+'/?lang=en');await page.waitForSelector('#connect-link');assert.equal(await page.locator('[data-setup-section="connect"]').evaluate(el=>getComputedStyle(el).animationName),'none');checks++;
  await page.goto(base+'/?lang=en');
  await page.addScriptTag({content:read('frontend/js/features/subscriptions/subscription-experience.js').toString()});
  await page.addScriptTag({content:read('frontend/js/features/subscriptions/subscription-traffic.js').toString()});
  await page.addScriptTag({content:read('frontend/js/features/subscriptions/subscription-studio.js').toString()});
  await page.evaluate(()=>{
    const [markup,mount]=window.XMeshSubscriptionStudio.create({subscriptionLanguage:'en',subscriptionSyncPanelTheme:false,subscriptionShowDevices:true,subscriptionShowSupport:true},async()=>{},()=>{},{users:2,nodes:1});
    document.body.innerHTML=markup;mount();
  });
  const studio=page.locator('[data-subscription-preview-frame]');
  assert.equal(await studio.locator('.subscription-preview').getAttribute('lang'),'en');assert(await studio.locator('.experience-days').isVisible());
  assert.match(await studio.locator('.portal-donut-center b').innerText(),/^12.4 /);
  assert(!/[А-Яа-яЁё]/.test(await studio.innerText()),'Studio English preview has untranslated copy');
  assert(await studio.locator('.portal-app-disclosure').evaluate(el=>!el.open));
  await studio.locator('.experience-start').click();assert(await studio.locator('.experience-guide').evaluate(el=>el.open));await page.keyboard.press('Escape');
  await studio.locator('[data-subscription-qr]').click();await studio.locator('.experience-qr').waitFor({state:'visible'});assert(await studio.locator('.experience-qr').evaluate(el=>el.open));assert.equal(await studio.locator('.experience-qr svg').count(),1);await page.keyboard.press('Escape');assert(await studio.locator('[data-preview-qr]').isHidden());

  await studio.locator('[data-portal-language="ru"]').click();
  assert.match(await studio.locator('.portal-donut-center b').innerText(),/^12,4 /);
  await page.locator('[name="subscriptionShowTraffic"]').uncheck();
  assert(await studio.locator('[data-subscription-traffic]').isHidden());
  const hiddenLayout=await studio.locator('.subscription-preview-hero').evaluate(el=>{const c=el.closest('.subscription-preview').querySelector('[data-setup-section="connect"]');return {header:el.getBoundingClientRect().bottom,connect:c.getBoundingClientRect().top}});assert(hiddenLayout.connect>=hiddenLayout.header,'Hidden metrics must not overlap connection and heading');
  await page.locator('[name="subscriptionShowExpiry"]').uncheck();
  assert(await studio.locator('.subscription-public-info-panel').isHidden());
  await page.locator('[name="subscriptionShowQr"]').uncheck();
  assert(await studio.locator('[data-subscription-qr]').isHidden());checks++;
  assert.deepEqual(errors,[]);console.log('Public portal: '+checks+' viewport/locale/state cases, onboarding, copy, QR, filters, keyboard, English, real usage and reduced motion passed');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
