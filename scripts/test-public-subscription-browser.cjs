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
 '/subscription-portal.js':'frontend/js/features/subscriptions/subscription-portal.js',
 '/qr-code.js':'frontend/js/core/qr-code.js'
};
function fixture(url){
 const en=url.searchParams.get('lang')==='en',active=url.searchParams.get('active')!=='0',unlimited=url.searchParams.get('limit')==='0',light=url.searchParams.get('theme')==='light';
 const text=(ru,enText)=>en?enText:ru;
 const data={LANG:en?'en':'ru',BRAND:'Simple VPN',LOGO:'<span aria-hidden="true">S</span>',
 ACCENT:url.searchParams.get('accent')==='dark'?'#2549bf':light?'#86e0b6':'#b9e68b',SECONDARY_ACCENT:'#a3bffa',BACKGROUND:light?'#f6f8fa':'#0d1218',CARD_COLOR:light?'#ffffff':'#151c25',TEXT_COLOR:light?'#1c2938':'#edf2f7',RADIUS:'20',THEME:light?'light':'dark',LAYOUT:'standard',FONT:'system',CARD_STYLE:url.searchParams.get('material')||'soft',
 RU_SELECTED:en?'':'on',EN_SELECTED:en?'on':'',RU_CURRENT:en?'false':'page',EN_CURRENT:en?'page':'false',
 STATUS_DOT:'<span class="subscription-preview-ok">● '+text(active?'Активна':'Неактивна',active?'Active':'Inactive')+'</span>',
 HERO:text(active?'Подписка активна':'Подписка неактивна',active?'Subscription active':'Subscription inactive'),DESCRIPTION:text('Ваш доступ к интернету. Всё необходимое для подключения.','Your internet access. Everything you need to get connected.'),
 METRICS:url.searchParams.get('metrics')==='0'?'':'<div class="subscription-preview-meta" data-subscription-metrics><div data-subscription-traffic><small>'+text('Трафик','Data usage')+'</small><b>'+text(unlimited?'34,5 ГБ / Без лимита':'34,5 / 100 ГБ',unlimited?'34.5 GB / Unlimited':'34.5 / 100 GB')+'</b><div class="subscription-preview-progress"><i style="width:'+(unlimited?'0':'34.5')+'%"></i></div></div><div data-subscription-expiry><small>'+text('Действует до','Expires')+'</small><b data-expiry="1796688000000"></b></div></div>',
 CTA:active?'<button type="button" class="subscription-preview-cta" id="connect-link">'+text('Подключиться','Connect')+'</button><input type="hidden" id="subscription-link" value="/s/disposable-test-token-0123456789abcdef">':'<div class="subscription-preview-cta" aria-disabled="true">'+text('Подписка неактивна','Subscription inactive')+'</div>',
 QUICK_ACTIONS:active?'<div class="subscription-preview-quick"><button type="button" id="copy-link">'+text('Скопировать ссылку','Copy link')+'</button><button type="button" id="toggle-qr" aria-expanded="false">QR</button><button type="button" id="toggle-link" aria-expanded="false">'+text('Показать ссылку','Show private link')+'</button><button type="button" id="toggle-devices">'+text('Устройства','Devices')+'</button></div>':'',
 QR:active?'<div id="subscription-qr" class="subscription-preview-qr" hidden></div>':'',DEVICE_INFO:active?'<div id="subscription-devices" class="subscription-public-devices" hidden>'+text('Подключённые устройства: 2 · Лимит: 5','Connected devices: 2 · Limit: 5')+'</div>':'',
 APPS:active&&url.searchParams.get('apps')!=='0'?'<section class="subscription-preview-apps"><header>'+text('Приложения для подключения','Connection apps')+'</header><div>'+[['Happ','iOS · Android · Windows · macOS'],['v2rayNG','Android'],['v2rayN','Windows · Linux'],['Streisand','iOS']].map(([n,p])=>'<a class="subscription-preview-app" href="https://example.invalid/'+n+'" target="_blank" rel="noopener noreferrer"><span>'+n.slice(0,2)+'</span><div><b>'+n+'</b><small>'+p+'</small></div></a>').join('')+'</div></section>':'',
 SUPPORT:'<a class="subscription-preview-support" href="https://support.example.invalid" rel="noopener noreferrer">'+text('Написать в поддержку','Contact support')+'</a>',FOOTER:''};
 return read('backend/src/subscription_template.html').toString().replace(/\{\{([A-Z_]+)\}\}/g,(_,key)=>{assert(key in data,'Missing fixture '+key);return data[key]});
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
  for(const [width,height] of [[320,780],[390,844],[768,1024],[1440,1000],[1920,1080]])for(const lang of ['ru','en']){
   await page.setViewportSize({width,height});await page.goto(base+'/?lang='+lang+'&theme='+(lang==='en'?'light':'dark'));await page.waitForFunction(()=>!!document.querySelector('[role="meter"]'));
   assert(await page.locator('#subscription-link-card').isHidden(),'Personal link must start hidden');
   const g=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth,body:innerWidth,title:parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),minTap:Math.min(...[...document.querySelectorAll('.subscription-cabinet-tab:not([hidden]),.subscription-preview-languages a,.subscription-preview-cta')].map(el=>el.getBoundingClientRect().height))}));
   assert(g.overflow<=g.body+1,JSON.stringify(g));assert(g.title>=30,'Readable heading');assert(g.minTap>=44,'Touch target too small');
   assert.equal(await page.locator('[role="tab"]').count(),0,'No tab navigation');assert(await page.locator('[data-setup-section="apps"]').isVisible());assert(await page.locator('[data-setup-section="connect"]').isVisible());assert.equal(await page.locator('#copy-link').count(),0,'Only one copy button');
   assert.equal(await page.locator('[role="meter"]').getAttribute('aria-valuenow'),'34.5');
   if(width===390||width===1440)await page.screenshot({path:path.join(out,'portal-overview-'+width+'-'+lang+'.png'),fullPage:true,animations:'disabled'});
   await page.locator('[data-app-filter="android"]').click();assert.equal(await page.locator('.subscription-preview-app:visible').count(),2);

   await page.locator('#connect-link').click();
   assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),base+'/s/disposable-test-token-0123456789abcdef');
   assert((await page.locator('#subscription-action-status').innerText()).length>10);
   await page.locator('#toggle-qr').click();assert.equal(await page.locator('#subscription-qr svg').count(),1);assert.equal(await page.locator('#subscription-qr').getAttribute('aria-label'),lang==='en'?'Subscription QR code':'QR-код подписки');assert.equal(await page.locator('.subscription-preview-languages').getAttribute('aria-label'),lang==='en'?'Language':'Язык');assert.equal(await page.locator('#subscription-qr svg').getAttribute('aria-label'),lang==='en'?'Subscription QR code':'QR-код подписки');
   await page.locator('#toggle-link').click();assert(await page.locator('#subscription-link-card').isVisible());await page.locator('#toggle-link').click();assert(await page.locator('#subscription-link-card').isHidden());
   await page.locator('#connect-link').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'toggle-qr','Keyboard order follows setup');
   if(lang==='en')assert(!/[А-Яа-яЁё]/.test(await page.locator('body').innerText()),'English portal has untranslated copy');checks++;
  }
  await page.goto(base+'/?lang=en&accent=dark');await page.waitForSelector('#connect-link');assert.equal(await page.locator('#connect-link').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)','Dark custom accent needs contrasting button text');checks++;
  await page.goto(base+'/?lang=en&apps=0');await page.waitForFunction(()=>document.querySelector('[data-setup-section="apps"]').hidden);assert(await page.locator('#connect-link').isVisible());checks++;
  await page.goto(base+'/?lang=en&metrics=0');await page.waitForFunction(()=>document.querySelector('.subscription-public-info-panel').hidden);checks++;
  await page.goto(base+'/?lang=en&limit=0');await page.waitForSelector('#connect-link');assert(await page.locator('.subscription-preview-progress').isHidden(),'Unlimited usage must not imply a percentage');checks++;
  await page.goto(base+'/?lang=en&active=0');await page.waitForFunction(()=>document.querySelector('[data-setup-section="connect"]').hidden);assert(await page.locator('[data-setup-section="apps"]').isHidden());assert(await page.locator('[data-setup-section="support"]').isVisible());checks++;
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(base+'/?lang=en');await page.waitForSelector('#connect-link');assert.equal(await page.locator('[data-setup-section="connect"]').evaluate(el=>getComputedStyle(el).animationName),'none');checks++;
  assert.deepEqual(errors,[]);console.log('Public portal: '+checks+' viewport/locale/state cases, onboarding, copy, QR, filters, keyboard, English, real usage and reduced motion passed');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
