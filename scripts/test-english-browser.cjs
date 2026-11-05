#!/usr/bin/env node
'use strict';
// A separate release check: scan rendered English on every panel route and
// common dialogs, including async errors and login/MFA. Run on a disposable API.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./browser/node_modules/playwright');
const base=(process.env.XMESH_TEST_URL||'http://127.0.0.1:8080').replace(/\/$/,''),password=process.env.ADMIN_PASSWORD;
assert(password&&process.env.XMESH_UI_DISPOSABLE==='1','Use an isolated API with ADMIN_PASSWORD and XMESH_UI_DISPOSABLE=1.');
const output=path.resolve(process.env.XMESH_BROWSER_OUTPUT||'/tmp/xmesh-english-results');fs.mkdirSync(output,{recursive:true});
const report={checks:[],failures:[]},fixtures=[],prefix='ui-en-'+Date.now().toString(36),dataNames=[];
const routes=['home','statistics','users','squads','hosts','nodes','templates','profiles','subscription','balancers','clientrouting','tools','admins','security','set'];
async function check(label,fn){try{await fn();report.checks.push(label)}catch(e){report.failures.push({label,error:e.message});console.error(label+': '+e.message)}}
async function scan(page,label){await page.waitForTimeout(300);const leaks=await page.evaluate(names=>{
 const found=[],ignored='script,style,pre,code,textarea,[contenteditable],[data-subscription-preview]';
 const visible=el=>el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
 const inspect=(text,where)=>{for(const name of names)text=text.split(name).join('');if(/[А-Яа-яЁё]/u.test(text))found.push({text:text.trim(),where})};
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
 while((node=walker.nextNode()))if(visible(node.parentElement)&&!node.parentElement.closest(ignored))inspect(node.nodeValue,node.parentElement.outerHTML.slice(0,240));
 for(const el of document.querySelectorAll('*'))if(visible(el)&&!el.closest('script,style,[data-subscription-preview]'))for(const attr of ['title','placeholder','aria-label','aria-description','data-l','data-rail-tip','alt'])if(el.hasAttribute(attr))inspect(el.getAttribute(attr),el.tagName+'['+attr+']');
 for(const el of document.querySelectorAll('*'))if(visible(el)&&!el.closest(ignored))for(const pseudo of ['::before','::after']){const content=getComputedStyle(el,pseudo).content;if(content&&content!=='none'&&content!=='normal')inspect(content,el.tagName+pseudo)}
 inspect(document.title,'document.title');return found;
 },dataNames);assert.equal(leaks.length,0,label+' contains untranslated UI: '+JSON.stringify(leaks.slice(0,15)));}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--disable-dev-shm-usage',...(process.env.XMESH_CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[])]});const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'});
 await context.addInitScript(()=>localStorage.setItem('xmeshNexusLanguage','en'));const page=await context.newPage();page.setDefaultTimeout(7000);let dashboard;
 const api=async(method,url,data)=>{const r=await context.request.fetch(base+'/api/v1'+url,{method,headers:{Origin:base},data});assert(r.ok(),method+' '+url+': '+r.status());return r.json()};
 const create=async(collection,data)=>{const item=await api('POST','/collections/'+collection,data);fixtures.push({collection,id:item.id});for(const key of ['name','remark','desc'])if(data[key])dataNames.push(data[key]);return item};
 let navigation=0;
 const navigate=async route=>{await page.goto(base+dashboard+'?english-audit='+(navigation++)+'#'+route,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!document.querySelector('#view')?.children.length&&!document.querySelector('#view .sk'));await page.waitForTimeout(200)};
 try{
  await api('POST','/auth/login',{username:process.env.ADMIN_USERNAME||'admin',password});dashboard=(await api('GET','/security/policy')).policy.dashboardPath;
  const profile=await create('profiles',{name:prefix+' Профиль',config:JSON.stringify({inbounds:[{tag:prefix,listen:'127.0.0.1',port:28354,protocol:'vless',settings:{decryption:'none',clients:[]}}],outbounds:[{tag:'direct',protocol:'freedom'}]})});
  const node=await create('nodes',{name:prefix+' Москва',addr:'192.0.2.11',flag:'🇵🇱',port:443,profileId:profile.id,hosting:'Datagio'});
  const squad=await create('squads',{name:prefix+' Сквад',desc:prefix+' Описание',inb:[prefix]});
  await create('hosts',{remark:prefix+' Хост',profileId:profile.id,tag:prefix,address:'ui.example.invalid',port:443,nodes:[node.id]});
  const user=await create('users',{username:prefix+'-client',squads:[squad.id],hwid:2,created:Date.now(),adminId:1});
  for(const route of routes)await check('English route: '+route,async()=>{await navigate(route);await scan(page,route)});
  const dialogs=[['nodes','[data-ne="nodes"]'],['nodes',`[data-ne="nodes:${node.id}"]`],['hosts','[data-ne="hosts"]'],['squads','[data-ne="squads"]'],['users','[data-nu]'],['users',`tr[data-id="${user.id}"]`],['templates','[data-ne="tpls"]'],['admins','[data-ne="admins"]'],['balancers','#balancer-add'],['clientrouting','[data-cr-add]']];
  for(const [route,selector]of dialogs)await check('English dialog: '+selector,async()=>{await navigate(route);await page.locator(selector).first().click();if(route!=='balancers')await page.locator('dialog[open]').waitFor();await scan(page,selector);if(route==='clientrouting')for(const tab of ['rules','json']){await page.locator('[data-cr-tab="'+tab+'"]').click();await scan(page,'routing '+tab)}await page.keyboard.press('Escape')});
  await check('English XRAY STUDIO composer',async()=>{await navigate('profiles');await page.locator('[data-action="templates"]').click();await page.locator('dialog[open]').waitFor();await scan(page,'composer');await page.keyboard.press('Escape')});
  for(const [tool,protocol,network,security]of [['reality','vless','raw','none'],['tls','vless','raw','tls'],['inbound','vless','raw','none'],['finalmask','vless','raw','none'],['xhttp','vless','xhttp','none'],['protocol-config','shadowsocks','raw','none'],['transport-config','vless','ws','tls'],['hysteria-config','hysteria','hysteria','tls']])await check('English Xray tool: '+tool,async()=>{
   await navigate('profiles');await page.locator('#xm-studio-v4 [data-v="source"]').evaluate((el,{protocol,network,security})=>{el.value=JSON.stringify({inbounds:[{tag:'english-test',listen:'127.0.0.1',port:443,protocol,settings:{users:[],decryption:'none'},streamSettings:{network,security}}],outbounds:[{tag:'direct',protocol:'freedom'}]});el.dispatchEvent(new Event('input',{bubbles:true}))},{protocol,network,security});
   await page.locator('[data-tool="'+tool+'"]').first().click();await page.locator('dialog[open]').waitFor();await scan(page,tool);await page.keyboard.press('Escape');
  });
  await check('English creation calendar and duration',async()=>{await navigate('users');await page.locator('[data-nu]').first().click();await page.locator('[data-user-create-duration-open]').click();await scan(page,'creation calendar');await page.locator('[data-user-create-days-preset="30"]').click();await scan(page,'selected duration');await page.keyboard.press('Escape')});
  await check('English expiry calendar',async()=>{await navigate('users');await page.locator('tr[data-id="'+user.id+'"]').click();await page.locator('[data-user-date-open]').click();await scan(page,'expiry calendar');await page.locator('[data-user-date-today]').click();await scan(page,'expiry date');await page.keyboard.press('Escape')});
  await check('English device workspace',async()=>{await navigate('users');await page.locator(`[data-sharing-detail="${user.id}"][data-sharing-focus="devices"]`).click();await page.locator('dialog[open]').waitFor();await scan(page,'devices');await page.locator('[data-device-tab="risk"]').click();await scan(page,'access check');await page.keyboard.press('Escape')});
  await check('Dynamic errors, attributes, protected data and reversible language',async()=>{
   await navigate('home');await page.evaluate(()=>{const el=document.createElement('div');el.id='english-runtime-probe';el.innerHTML='<span>Не удалось сохранить: Поле hwid должно быть текстом.</span><button title="Сохранить" aria-label="Сохранить" data-l="Пользователь">Сохранить</button><span data-no-translate>Москва</span><pre>{"remark":"Москва"}</pre><textarea placeholder="Описание">Москва</textarea><code aria-label="Xray ID скрыт">uuid</code>';document.body.append(el)});
   dataNames.push('Москва');await scan(page,'dynamic API error');assert.match(await page.locator('#english-runtime-probe').innerText(),/hwid/);assert.equal(await page.locator('#english-runtime-probe [data-no-translate]').innerText(),'Москва');assert.equal(await page.locator('#english-runtime-probe pre').innerText(),'{"remark":"Москва"}');
   await page.evaluate(()=>XMeshI18n.setLanguage('ru'));assert.equal(await page.locator('#english-runtime-probe button').innerText(),'Сохранить');await page.evaluate(()=>XMeshI18n.setLanguage('en'));await scan(page,'language switch');await page.locator('#english-runtime-probe').evaluate(el=>el.remove());
  });
  await check('English login, MFA and asynchronous authentication errors',async()=>{
   const anonymous=await browser.newContext();try{await anonymous.addInitScript(()=>localStorage.setItem('xmeshNexusLanguage','en'));const login=await anonymous.newPage();await login.goto(base+dashboard);await login.locator('#login-form').waitFor();await scan(login,'login');await anonymous.route('**/api/v1/auth/login',r=>r.fulfill({json:{mfaRequired:true,challenge:'a'.repeat(64)}}));await login.locator('#username').fill('ui-english');await login.locator('#password').fill('test-only');await login.locator('#submit').click();await login.locator('#mfa-step').waitFor({state:'visible'});await scan(login,'MFA');await anonymous.route('**/api/v1/auth/mfa/verify',r=>r.fulfill({status:401,json:{error:'Неверный код двухфакторной аутентификации.'}}));await login.locator('#mfa-code').fill('123456');await login.locator('#submit').click();await login.waitForTimeout(300);await scan(login,'MFA error')}finally{await anonymous.close()}
  });
 }finally{for(const collection of ['users','hosts','nodes','squads','profiles'])for(const fixture of fixtures.filter(f=>f.collection===collection))try{await api('DELETE','/collections/'+collection+'/'+fixture.id)}catch(e){report.failures.push({label:'cleanup',error:e.message})}await browser.close();fs.writeFileSync(path.join(output,'english-report.json'),JSON.stringify(report,null,2));}
 console.log('English browser audit: '+report.checks.length+' checks passed, '+report.failures.length+' failed.');if(report.failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
