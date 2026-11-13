#!/usr/bin/env node
'use strict';

// Run against an isolated API/database. This suite creates only uniquely named
// fixtures, removes them in finally, and never activates nodes or installs Xray.
// npm ci --prefix scripts/browser
// npx --prefix scripts/browser playwright install chromium
// XMESH_UI_DISPOSABLE=1 ADMIN_PASSWORD=... node scripts/test-ui-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({chromium} = require('./browser/node_modules/playwright')); }
catch { ({chromium} = require('playwright')); }

const base = (process.env.XMESH_TEST_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD;
assert(password, 'Укажите ADMIN_PASSWORD в окружении, не в аргументах команды.');
assert.equal(process.env.XMESH_UI_DISPOSABLE, '1', 'Укажите XMESH_UI_DISPOSABLE=1 для отдельного тестового экземпляра API.');
const output = path.resolve(process.env.XMESH_BROWSER_OUTPUT || '/tmp/xmesh-browser-results');
fs.mkdirSync(output, {recursive: true});

const sizes = [[390,844],[768,1024],[1366,768], [1440,900], [1920,1080], [2560,1440], [3440,1440], [3840,2160]];
const routes = ['home','statistics','users','squads','hosts','nodes','templates','profiles','subscription','balancers','clientrouting','tools','admins','security','set'];
const report = {checks: [], failures: [], javascriptErrors: [], screenshots: []};
const fixtures = [];
const prefix = `ui-${Date.now().toString(36)}`;
const shortError = error => String(error.message || error).split('\n')[0];

async function checked(label, fn) {
  try {
    const detail = await fn();
    report.checks.push({label, detail});
  } catch (error) {
    const details = String(error.stack || error.message || error);
    report.failures.push({label, error: shortError(error), details: details.slice(0, 4000)});
    console.error(`ОШИБКА: ${label}: ${shortError(error)}`);
    if (/Timeout|locator\.click/.test(details)) console.error(details.split('\n').slice(1, 12).join('\n'));
  }
}

async function screenshot(page, name) {
  const filename = `${name}.png`;
  await page.screenshot({path: path.join(output, filename), fullPage: true, animations: 'disabled'});
  report.screenshots.push(filename);
}

// Measurements live only in the test. Production layout must never depend on
// these observations or on JavaScript guessing the purpose of arbitrary divs.
async function geometry(page) {
  return page.evaluate(() => {
    const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const box = node => {
      const r = node.getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};
    };
    const view = document.querySelector('#view');
    const dialog = document.querySelector('dialog[open]');
    const intentionalScroll = '.tw,.table-scroll,pre,textarea,.json-editor,.code-editor,.xray-raw-editor';
    const outside = [...(dialog || view || document.body).querySelectorAll('button,input,select,textarea')]
      .filter(visible)
      .filter(node => !node.closest(intentionalScroll))
      .map(node => ({tag:node.tagName,identifier:node.id || node.getAttribute('name') || node.textContent.trim().slice(0,40),...box(node)}))
      .filter(r => r.width && (r.x < -1 || r.right > innerWidth + 1));
    const columns = [...document.querySelectorAll('.appearance-column')].filter(visible).map(node => ({...box(node),display:getComputedStyle(node).display,cards:[...node.querySelectorAll(':scope > .card')].filter(visible).map(box)}));
    const nodeCards = [...document.querySelectorAll('#view .nodes > .nc')].map(box);
    const ranges = [...document.querySelectorAll('.appearance-layout input[type=range]')].filter(visible).map(box);
    const top = document.querySelector('.top');
    const root = document.documentElement;
    return {
      viewport:{width:innerWidth,height:innerHeight},rootFont:parseFloat(getComputedStyle(root).fontSize),scrollWidth:root.scrollWidth,
      view:view && box(view),top:top && box(top),outside,columns,nodeCards,ranges,nodeGridMode:document.querySelector('.nodes')?.dataset.gridMode,
      cards:[...(view?.querySelectorAll('.card') || [])].filter(visible).map(box),
      settingsUpdates:[...document.querySelectorAll('#core-panel,#panel-update-card')].filter(visible).map(panel=>({actions:box(panel.querySelector('.update-action-row')),message:box(panel.querySelector('.history-placeholder'))})),
      dialog:dialog && box(dialog),
      material:{surface:root.dataset.surface,theme:root.dataset.theme,sidebar:root.dataset.sidebar,density:root.dataset.density},
      renderFailed:!!view?.textContent.includes('Не удалось открыть раздел'),
    };
  });
}

function verifyPage(g, route) {
  assert(!g.renderFailed, 'Раздел завершился сообщением об ошибке рендера.');
  assert(g.view?.width > 0, 'Рабочая область отсутствует.');
  assert(g.scrollWidth <= g.viewport.width + 1, `Горизонтальная прокрутка документа: ${g.scrollWidth}/${g.viewport.width}.`);
  assert.equal(g.outside.length, 0, `Элементы управления выходят за окно: ${JSON.stringify(g.outside.slice(0,4))}`);
  assert(g.view.x >= 0 && g.view.right <= g.viewport.width + 1, 'Рабочая область выходит за окно.');
  if (route === 'set') {
    assert([1,2].includes(g.columns.length), 'Settings должна показывать только выбранный раздел, в одной или двух колонках.');
    for(const panel of g.settingsUpdates)assert(panel.message.y-panel.actions.bottom>=8,'Update actions and status must have a visible gap');
    assert(g.columns.every(c => c.display !== 'contents'), 'Стек Settings потерял собственную геометрию.');
    const sideBySide=g.columns.length===2&&Math.abs(g.columns[0].x-g.columns[1].x)>100;
    if(sideBySide)assert(g.columns.every(c => c.width >= 330), 'Settings превратилась в узкие вертикальные башни.');
    else assert(g.columns.every(c => c.width >= Math.min(720,g.view.width*.66)), 'Адаптивный стек Settings стал неоправданно узким.');
    for (const column of g.columns) for (let i=1;i<column.cards.length;i++) {
      const gap = column.cards[i].y - column.cards[i-1].bottom;
      assert(gap >= -1 && gap <= 48, `Искусственный вертикальный разрыв между карточками: ${gap}px.`);
    }
    assert(g.ranges.every(r => r.width <= 660), 'Ползунок растянут на чрезмерную ширину.');
  }
  if (route === 'nodes' && g.nodeCards.length === 1) {
    assert(g.nodeCards[0].y - g.view.y < 230, 'Toolbar и счётчик занимают слишком много высоты перед одним узлом.');
    assert(g.nodeCards[0].width >= Math.min(g.view.width,g.rootFont*(g.nodeGridMode==='compact'?40:52))-1, 'Единственный узел стал слишком узким для рабочей композиции.');
    assert(g.nodeCards[0].width <= g.rootFont*76+1, 'Единственный узел снова растягивается на ultrawide.');
  }
}

async function main() {
  const launch = {headless:true, args:['--disable-dev-shm-usage']};
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  if (process.env.XMESH_CHROMIUM_NO_SANDBOX === '1') launch.args.push('--no-sandbox');
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({viewport:{width:1440,height:900}, reducedMotion:'reduce',colorScheme:'light',locale:'ru-RU'});
  const page = await context.newPage();
  page.on('pageerror', error => report.javascriptErrors.push(shortError(error)));
  async function api(method, url, data) {
    const response = await context.request.fetch(base + '/api/v1' + url, {method, headers:{Origin:base}, data});
    assert(response.ok(), `${method} ${url}: HTTP ${response.status()}`);
    return response.json();
  }
  async function create(collection, data) {
    const item = await api('POST', '/collections/' + collection, data);
    fixtures.push({collection,id:item.id});
    return item;
  }
  async function navigate(route) {
    // An earlier failing case must not leave a native top-layer dialog blocking this route.
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
    await page.goto(base + dashboard + '#' + route, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => !!document.querySelector('#view')?.children.length && !document.querySelector('#view .sk'));
    // A hash-only navigation can keep the previous Settings subpage in the DOM
    // until its async renderer has finished. A nonempty #view and a 150ms sleep
    // are not evidence that the destination is ready.
    const settingsAliases={
      colors:'appearance',layout:'appearance',typography:'appearance',
      integrations:'general',traffic:'system'
    };
    const settingsSlug=route.startsWith('set/')?route.slice(4):null;
    const settingsCategory=settingsSlug?(settingsAliases[settingsSlug]||settingsSlug):
      route==='admins'?'admins':route==='security'?'security':null;
    if(settingsCategory){
      await page.locator('#settings-subpage[data-settings-section="'+settingsCategory+'"]').waitFor({state:'visible'});
      // The page-specific content must be mounted, not just the persistent
      // Settings toolbar retained from the previous route.
      const required={
        general:'#start-page',appearance:'#palette-apply',
        system:'#core-panel',security:'#security-tab-auth',
        admins:'[data-ne="admins"]',data:'#appearance-import'
      }[settingsCategory];
      if(required)await page.locator('#settings-subpage').locator(required).first().waitFor({state:'attached'});
    }else{
      const destination={
        admins:'[data-ne="admins"]',squads:'[data-ne="squads"]',
        templates:'.templates-workspace'
      }[route];
      if(destination)await page.locator('#view').locator(destination).first().waitFor({state:'visible'});
    }
    assert(!await page.locator('#login-form').count(), 'Сессия авторизации потеряна.');
  }
  let dashboard;
  try {
    await checked('Canonical nested frontend assets bypass subscription routes',async()=>{
      for(const asset of ['/js/auth/login.js','/js/core/app.js','/styles/system/nexus-ui-v3.css','/styles/features/nodes/nodes.css']){
        const response=await context.request.get(base+asset);
        assert(response.ok(),`${asset}: HTTP ${response.status()}`);
        assert((await response.body()).length>100,`${asset} must contain the canonical asset`);
      }
    });
    await api('POST','/auth/login',{username,password});
    dashboard = (await api('GET','/security/policy')).policy.dashboardPath;
    await context.clearCookies();
    await page.goto(base + dashboard, {waitUntil:'domcontentloaded'});
    await page.locator('#username').fill(username);
    await page.locator('#password').fill(password);
    await page.locator('#submit').click();
    await page.waitForFunction(() => !!document.querySelector('#view')?.children.length && !document.querySelector('#view .sk'));
    await checked('Вход через форму',async () => {
      assert.equal(await page.locator('#login-form').count(),0);
      assert(await page.locator('#view').isVisible());
    });
    const inboundTag = prefix.replace(/-/g,'_');
    const profile = await create('profiles',{name:`${prefix} · Профиль`,config:JSON.stringify({inbounds:[{tag:inboundTag,listen:'127.0.0.1',port:28352,protocol:'vless',settings:{decryption:'none',clients:[]},streamSettings:{network:'tcp',security:'tls',tlsSettings:{serverName:'ui.example.invalid',certificates:[{certificateFile:'/etc/xmesh/external/fullchain.pem',keyFile:'/etc/xmesh/external/privkey.pem'}]}}}],outbounds:[{tag:'direct',protocol:'freedom'}]})});
    const node = await create('nodes',{name:`${prefix} · Москва`,addr:'192.0.2.10',flag:'🇵🇱',port:443,xrayLocalPort:13456,mult:1,limit:0,resetDay:1,profileId:profile.id,rotationEnabled:false,rotationIntervalHours:24,rotationIps:'',billingCurrency:'EUR',billingPeriod:'monthly',billingRemindDays:7,billingPrice:0,hosting:'Datagio',tlsManualProvision:true,geoEnabled:true});
    const squad = await create('squads',{name:`${prefix} · Сквад`,desc:'Данные браузерной проверки',inb:[inboundTag]});
    const host = await create('hosts',{remark:`${prefix} · Хост`,profileId:profile.id,tag:inboundTag,address:'ui.example.invalid',port:443,nodes:[node.id]});
    const user = await create('users',{username:`${prefix}-client`,squads:[squad.id],hwid:2,created:Date.now(),adminId:1,desc:'Служебная заметка: Лунная комета 73293, проверить доступ'});
    const otherUser = await create('users',{username:`${prefix}-other`,squads:[squad.id],hwid:2,created:Date.now(),adminId:1});
    await create('tpls',{name:`${prefix} · Standard`,limit:30,days:30,strategy:'NO_RESET',hwid:2,squads:[squad.id]});

    const fixtureBootstrap=await api('GET','/bootstrap');
    assert(fixtureBootstrap.collections?.profiles?.some(item=>item.id===profile.id),'Bootstrap не увидел тестовый профиль.');
    assert(fixtureBootstrap.collections?.nodes?.some(item=>item.id===node.id),'Bootstrap не увидел тестовый узел.');
    assert(fixtureBootstrap.collections?.users?.some(item=>item.id===user.id),'Bootstrap не увидел тестового пользователя.');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => !!document.querySelector('#view')?.children.length && !document.querySelector('#view .sk'));


    await checked('Create user: per-node quotas persist in the initial POST',async()=>{
      await page.setViewportSize({width:1366,height:768});
      await navigate('users');
      await page.locator('[data-nu]').first().click();
      const form=page.locator('#dlg.user-create-modal form[data-k="user"]');
      await form.waitFor({state:'visible'});
      const details=form.locator('[data-user-create-node-quotas]');
      assert.equal(await details.count(),1,'A new user must allow node quota policies before saving');
      assert.equal(await details.isVisible(),true,'Node quotas must be visible immediately, with no accordion click');
      assert.equal(await details.locator('.user-create-node-quotas-head').isVisible(),true,
        'A visible quota heading and summary must appear on creation');
      const row=form.locator('[data-user-create-quota-row="'+node.id+'"]');
      assert.deepEqual(
        await row.locator('[data-user-create-quota-period] option').evaluateAll(
          options=>options.map(option=>option.value)),
        ['daily','weekly','monthly','lifetime'],
        'New users should have all four per-node periods'
      );
      await row.locator('[data-user-create-quota-limit]').fill('5');
      await row.locator('[data-user-create-quota-period]').evaluate(select=>{
        select.value='daily';select.dispatchEvent(new Event('change',{bubbles:true}));
      });
      assert.match(await details.locator('[data-user-create-quota-count]').innerText(),/1\s*\/\s*\d+/);
      assert.equal(await row.getAttribute('data-limited'),'true','Configured node has an active state');
      assert.match(await row.locator('[data-user-create-quota-status]').innerText(),/5/);
      const sampled=await form.evaluate(f=>window.XMeshNodeQuotas.readCreate(f));
      assert.deepEqual(sampled[String(node.id)],{limitGb:5,period:'daily'});
      await form.locator('input[name="username"]').fill(prefix+'-node-quota-create');
      await form.locator('[name="squads"][value="'+squad.id+'"]').check();
      const response=page.waitForResponse(res=>res.url().includes('/api/v1/collections/users')&&res.request().method()==='POST');
      await form.locator('.user-create-submit').click();
      const created=await response;
      assert.equal(created.status(),201,'User and node policy must be accepted in one create request');
      const payload=JSON.parse(created.request().postData()||'{}');
      assert.deepEqual(payload.nodeTrafficLimits[String(node.id)],{limitGb:5,period:'daily'});
      assert.equal(payload.nodeQuotaUsedBytes,undefined,'Browser must never submit quota meter state');
      const saved=await created.json();
      fixtures.push({collection:'users',id:saved.id});
      assert.deepEqual(saved.nodeTrafficLimits[String(node.id)],{limitGb:5,period:'daily'});
    });

    await checked('Version popover: available, completed, unavailable and accessible actions',async()=>{
      await navigate('home');
      await page.locator('[data-panel-version-trigger]').waitFor({state:'visible'});
      await page.route('**/api/v1/panel/version/check',route=>route.fulfill({
        status:200,contentType:'application/json',
        body:JSON.stringify({status:'update_available',latest_revision:'0123456789abcdef0123456789abcdef01234567'})
      }));
      await page.evaluate(()=>{
        window.__versionUpdaterStatus=window.XMeshPanelUpdater.status;
        window.__versionUpdaterStage='idle';
        window.XMeshPanelUpdater.status=async()=>({status:window.__versionUpdaterStage});
      });
      const trigger=page.locator('[data-panel-version-trigger]');
      const menu=page.locator('[data-panel-version-menu]');
      const close=page.locator('[data-panel-version-close]');
      try{
        await trigger.click();
        await menu.waitFor({state:'visible'});
        // Opening the version menu initiates a read-only check automatically.
        // Wait for the result instead of racing the temporary disabled button.
        await page.waitForFunction(()=>{
          const panel=document.querySelector('[data-panel-version-menu]');
          return panel?.dataset.actionMode==='update'&&!panel.querySelector('[data-panel-version-update]').hidden;
        });
        const updateAction=await page.locator('[data-panel-version-update]').evaluate(button=>{
          const style=getComputedStyle(button);
          return{disabled:button.disabled,background:style.backgroundColor,color:style.color};
        });
        assert.equal(updateAction.disabled,false,'An available update must have an enabled primary action');
        assert.notEqual(updateAction.background,updateAction.color,'Primary update text must contrast with the background');

        // An old success marker after a fresh page load is NOT this page's
        // completed request. The next update must remain available.
        await page.evaluate(()=>{window.__versionUpdaterStage='success'});
        await close.click();
        await trigger.click();
        await page.waitForFunction(()=>document.querySelector('[data-panel-version-menu]')?.dataset.actionMode==='update');
        assert.equal(await page.locator('[data-panel-version-update]').isVisible(),true,
          'Stale success must not hide another confirmed upgrade');
        assert.equal(await page.locator('[data-panel-version-reload]').isVisible(),false,
          'A previous update must not permanently demand a browser reload');
        assert.equal(await page.locator('[data-panel-version-check]').count(),0,
          'The automatic read-only check must not have a redundant manual button');

        // A queued/running update witnessed in the same page does require a
        // reload when the host worker subsequently reports completion.
        await page.evaluate(()=>{window.__versionUpdaterStage='queued'});
        await close.click();
        await trigger.click();
        await page.waitForFunction(()=>document.querySelector('[data-panel-version-status]')?.dataset.state==='queued');
        await page.evaluate(()=>{window.__versionUpdaterStage='success'});
        await close.click();
        await trigger.click();
        await page.waitForFunction(()=>document.querySelector('[data-panel-version-menu]')?.dataset.actionMode==='reload');
        assert.equal(await page.locator('[data-panel-version-update]').isVisible(),false,
          'The obsolete update action must disappear when the host updater reports success');
        assert.equal(await page.locator('[data-panel-version-check]').count(),0,
          'Successful updates must not show manual version checks');
        assert.equal(await page.locator('[data-panel-version-reload]').isVisible(),true);
        assert.match(await page.locator('[data-panel-version-status]').innerText(),/Перезагрузите|Reload/i);

        await page.evaluate(()=>{window.__versionUpdaterStage='unavailable'});
        await close.click();
        await trigger.click();
        await page.waitForFunction(()=>document.querySelector('[data-panel-version-update-status]')?.dataset.state==='unavailable');
        assert.equal(await page.locator('[data-panel-version-update]').isVisible(),false,
          'Do not show an unusable dark update button');
        assert.equal(await page.locator('[data-panel-version-settings]').count(),0,
          'Do not show another update path in the version popover');
        assert.match(await page.locator('[data-panel-version-update-status]').innerText(),/недоступен|unavailable/i);

        await page.emulateMedia({reducedMotion:'reduce'});
        assert.equal(await menu.evaluate(el=>getComputedStyle(el).animationName),'none',
          'Reduced-motion mode must disable popover animation');
        await close.click();
        assert.equal(await trigger.getAttribute('aria-expanded'),'false');
        assert.equal(await trigger.evaluate(el=>document.activeElement===el),true,
          'Closing the menu should return keyboard focus to its trigger');
      }finally{
        await page.evaluate(()=>{
          if(window.__versionUpdaterStatus)window.XMeshPanelUpdater.status=window.__versionUpdaterStatus;
          delete window.__versionUpdaterStatus;
          delete window.__versionUpdaterStage;
          document.querySelector('[data-panel-version-menu]:not([hidden]) [data-panel-version-close]')?.click();
        });
        await page.unroute('**/api/v1/panel/version/check');
      }
    });

    await checked('Version popover: node actions cannot cover its contents',async()=>{
      await page.setViewportSize({width:1366,height:768});
      await navigate('nodes');
      const trigger=page.locator('[data-panel-version-trigger]');
      const menu=page.locator('[data-panel-version-menu]');
      await trigger.click();
      await menu.waitFor({state:'visible'});
      try{
        // A card action menu in the workspace may use the ordinary popover layer.
        // Reproduce that overlap at the version window's actual position.
        const hit=await menu.evaluate(panel=>{
          const r=panel.getBoundingClientRect();
          const x=r.left+r.width/2,y=r.top+r.height/2;
          const competing=document.createElement('button');
          competing.textContent='⋯';
          competing.setAttribute('aria-label','Node actions overlap probe');
          competing.style.cssText='position:fixed;z-index:var(--nx-z-popover);width:36px;height:36px;pointer-events:auto;';
          competing.style.left=(x-18)+'px';
          competing.style.top=(y-18)+'px';
          document.querySelector('#view').appendChild(competing);
          try{return panel.contains(document.elementFromPoint(x,y))}
          finally{competing.remove()}
        });
        assert.equal(hit,true,'Node actions must remain behind the open panel-version popover');
      }finally{
        await menu.locator('[data-panel-version-close]').click();
      }
    });

    await checked('Settings composition: full-width, left-aligned desktop workspace and compact navigation',async()=>{
      await page.setViewportSize({width:1920,height:1080});
      for(const section of ['general','appearance','system','data']){
        await navigate('set/'+section);
        const g=await page.evaluate(()=>{
          const box=node=>{const r=node.getBoundingClientRect();return{x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height}};
          const shell=document.querySelector('.settings-center'),main=document.querySelector('.settings-center-main'),view=document.querySelector('#view');
          const toolbar=document.querySelector('.settings-center-rail'),navigation=document.querySelector('.settings-center-nav'),grid=document.querySelector('.settings-center-grid');
          return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,rem:parseFloat(getComputedStyle(document.documentElement).fontSize),
            view:box(view),shell:box(shell),main:box(main),toolbar:box(toolbar),grid:box(grid),
            navDisplay:getComputedStyle(navigation).display,nav:[...navigation.querySelectorAll('.settings-center-link')].map(box),
            cards:[...grid.querySelectorAll('.card')].filter(node=>node.getClientRects().length).map(box),single:main.dataset.single,
            duplicateHeadings:document.querySelectorAll('.settings-center-heading').length,
            scrollToolbar:toolbar.scrollWidth>toolbar.clientWidth+1,
            mainLabel:main.getAttribute('aria-label')};
        });
        assert(g.scrollWidth<=g.viewport+1,'Settings must not create horizontal page scrolling');
        assert(Math.abs(g.shell.x-g.view.x)<=3,'Settings should start at the normal dashboard content left edge');
        assert(Math.abs(g.shell.width-g.view.width)<=3,'Settings must use all available dashboard width');
        assert.equal(g.duplicateHeadings,0,'Subpage title and subtitle must not consume an extra Settings row');
        assert.equal(g.navDisplay,'flex','Category navigation must always be a horizontal toolbar');
        assert.equal(g.nav.length,6,'Owner must have six original functional Settings categories');
        assert(g.nav.every(n=>n.height<=g.rem*3),'Toolbar tabs should remain compact');
        assert(g.nav.every(n=>Math.abs((n.y+n.height/2)-(g.nav[0].y+g.nav[0].height/2))<2),
          'All category tabs must share one continuous toolbar row');
        assert(Math.abs(g.main.x-g.shell.x)<3,'Settings cards must begin at the full workspace left edge');
        assert(Math.abs(g.main.width-g.view.width)<3,'No vertical rail may reserve dashboard width');
        assert(g.main.y>=g.toolbar.bottom,'Settings form must follow the toolbar');
        assert(!g.scrollToolbar,'Desktop Settings toolbar should show all six tabs without internal scrolling');
        assert(g.mainLabel,'Settings content region must have an accessible name');
        assert(g.cards.every(c=>c.width>=g.rem*20),'Cards must remain usable, not squeezed by navigation');
        if(g.single==='true'&&g.cards.length)assert(Math.abs(g.cards[0].x-g.main.x)<3,
          'Single card must align with the full-width Settings content');
        if(section==='appearance')await screenshot(page,'settings-appearance-consolidated-desktop');
      }
    });
    await checked('Settings composition: narrow screens retain usable subpages without overflow',async()=>{
      await page.setViewportSize({width:390,height:844});
      await navigate('set/appearance');
      const g=await page.evaluate(()=>{
        const box=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,width:r.width}};
        const shell=document.querySelector('.settings-center'),nav=document.querySelector('.settings-center-nav'),toolbar=document.querySelector('.settings-center-rail'),grid=document.querySelector('.settings-center-grid');
        const cards=[...grid.querySelectorAll('.card')].filter(node=>node.getClientRects().length);
        const links=[...nav.querySelectorAll('a')].map(box);
        return{viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,shell:box(shell),navDisplay:getComputedStyle(nav).display,
          toolbar:box(toolbar),toolbarScrollable:toolbar.scrollWidth>toolbar.clientWidth+1,links,cards:cards.map(box)};
      });
      assert(g.scrollWidth<=g.viewport+1,'Mobile Settings must not cause document overflow');
      assert(g.navDisplay==='flex','Settings navigation must stay horizontal on mobile');
      assert(g.toolbarScrollable,'Small-screen Settings navigation should scroll inside its own toolbar');
      assert(g.links.every(link=>Math.abs(link.y-g.links[0].y)<2),'Category tabs must not wrap into stacked rows');
      assert(g.cards.every(card=>card.width>=g.shell.width*.85),'Mobile cards must use available width');
      await screenshot(page,'settings-composition-compact-mobile');
    });

    await checked('Settings audit: palette columns, real previews, links and notification testing',async()=>{
      await page.setViewportSize({width:1440,height:900});
      await navigate('set/colors');
      assert.equal(await page.locator('.settings-palette-gallery [data-ac]').count(),24,
        'All 24 working accent presets must stay accessible after redistribution');
      assert.equal(await page.locator('#custom-a').count(),1);
      assert.equal(await page.locator('#hue').count(),1);
      assert.equal(await page.locator('#palette-apply').count(),1);
      const result=await page.evaluate(()=>{
        const root=document.querySelector('#settings-subpage');
        const visible=node=>node.getClientRects().length>0;
        const columns=[...root.querySelectorAll('.appearance-column')].filter(visible);
        return {columns:columns.length,heights:columns.map(node=>node.getBoundingClientRect().height),
          specimen:visible(root.querySelector('.settings-theme-specimen')),
          scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
      });
      assert.equal(result.columns,2,'Colors need two useful real columns');
      assert(result.specimen,'The selected theme should have a specimen inside the gallery');
      assert(result.scrollWidth<=result.viewport+1,'Palette gallery must not overflow horizontally');
      assert(Math.min(...result.heights)>=Math.max(...result.heights)*.44,
        'Color cards must no longer leave a mostly empty companion column');
      await screenshot(page,'settings-colors-rebalanced-desktop');
      await navigate('set/layout');
      assert(await page.locator('.settings-layout-specimen').isVisible());
      await navigate('set/typography');
      assert(await page.locator('.settings-type-specimen').isVisible());
      await navigate('set/integrations');
      await page.locator('[data-settings-test-toast]').click();
      assert.match(await page.locator('#xmesh-feedback-toast').innerText(),/Тестовое уведомление|Test notification/);
      assert(await page.locator('[data-hook-count]').isVisible());
      await navigate('set/general');
      assert.equal(await page.locator('.settings-feature-links a[href="#subscription"]').count(),1);
      await navigate('set/data');
      assert.equal(await page.locator('.settings-data-summary').count(),2);
      await navigate('set/system');
      assert(await page.locator('.settings-update-outline').count()>0);
      await page.setViewportSize({width:390,height:844});
      await navigate('set/colors');
      const mobile=await page.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
        presetWidth:document.querySelector('.settings-palette-gallery')?.getBoundingClientRect().width||0}));
      assert(mobile.documentWidth<=mobile.viewport+1,'Narrow palette page must not horizontally scroll');
      assert(mobile.presetWidth>200,'Preset gallery must remain usable on phone width');
      await screenshot(page,'settings-colors-rebalanced-mobile');
    });

    await checked('Settings compact groups: no blank column, real controls and retained drafts',async()=>{
      await page.setViewportSize({width:1920,height:1080});
      const grouped={
        general:{general:'#brand-panel',integrations:'[data-hk]'},
        appearance:{colors:'#custom-a',layout:'#content-width',typography:'#ts'},
      };
      for(const [section,groups] of Object.entries(grouped)){
        await navigate('set/'+section);
        const buttons=page.locator('#settings-subpage [data-settings-focus]');
        assert.equal(await buttons.count(),Object.keys(groups).length,'Incorrect compact group count: '+section);
        for(const [group,control] of Object.entries(groups)){
          await page.locator('#settings-subpage [data-settings-focus="'+group+'"]').click();
          assert.equal(await page.locator('[data-settings-focus="'+group+'"]').getAttribute('aria-pressed'),'true');
          assert.equal(new URL(page.url()).hash,'#set/'+group,'Group links must remain shareable');
          assert(await page.locator(control).evaluateAll(elements=>elements.some(el=>
            el.getClientRects().length>0)),'Active group control must be visible: '+group);
          const layout=await page.evaluate(()=>{
            const grid=document.querySelector('.settings-center-grid');
            const visible=el=>el.getClientRects().length>0;
            const columns=[...grid.querySelectorAll('.appearance-column')].filter(visible);
            const activeCards=[...grid.querySelectorAll('[data-settings-group]')].filter(visible);
            const wrong=activeCards.filter(el=>el.dataset.settingsGroup!==document.querySelector('.settings-focus-bar [aria-pressed="true"]').dataset.settingsFocus);
            return{columns:columns.length,active:activeCards.length,wrong:wrong.length,overflow:document.documentElement.scrollWidth>innerWidth+1,
              hidden:[...grid.querySelectorAll('[data-settings-group][hidden]')].every(el=>!visible(el)),
              width:grid.getBoundingClientRect().width,cardWidths:activeCards.map(el=>el.getBoundingClientRect().width)};
          });
          assert.equal(layout.wrong,0,'Unrelated cards must not consume workspace height');
          assert.equal(layout.hidden,true,'Inactive settings cards must be hidden, not removed');
          assert(layout.active>0&&layout.columns>0,'Focused group needs functional controls');
          assert.equal(layout.overflow,false,'Compact groups must not overflow viewport');
          if(layout.active===1)assert.equal(layout.columns,1,'Single-card group must not reserve a blank second column');
          assert(layout.cardWidths.every(w=>w>0),'Visible settings cards must have useful width');
        }
      }
      await navigate('set/system');
      assert.equal(await page.locator('#settings-subpage [data-settings-focus]').count(),0,
        'System and bypass quota must not live in separate two-control subpages');
      assert(await page.locator('#core-panel').isVisible(),'Core updates must remain visible');
      assert(await page.locator('[data-cdn-tags-save]').isVisible(),'Bypass quota settings must remain visible beside core updates');
      await navigate('set/appearance');
      await page.locator('[data-settings-focus="colors"]').click();
      const original=await page.locator('#custom-a').inputValue();
      try{
        await page.locator('#custom-a').fill('#ABCDEF');
        await page.locator('[data-settings-focus="layout"]').click();
        await page.goBack({waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>document.querySelector('.settings-focus-bar [data-settings-focus="colors"]')?.getAttribute('aria-pressed')==='true');
        assert.equal(await page.locator('#custom-a').inputValue(),'#ABCDEF',
          'Back navigation within Settings must preserve unsaved fields');
        await page.locator('[data-settings-focus="layout"]').click();
        await page.locator('[data-settings-focus="colors"]').click();
        assert.equal(await page.locator('#custom-a').inputValue(),'#ABCDEF',
          'Switching internal groups must preserve unsaved input without remounting');
      }finally{
        await page.locator('#custom-a').fill(original);
      }
      await navigate('set/security');
      assert(await page.locator('#security-tab-auth').isVisible(),'Security keeps its functional internal tabs');
      await navigate('set/admins');
      assert(await page.locator('[data-ne="admins"]').first().isVisible(),'Admins remains a functional Settings category');
      await navigate('set/data');
      assert(await page.locator('#gx').isVisible(),'Data export remains available');
      assert(await page.locator('#appearance-import').isVisible(),'Theme import remains available');
    });

    await checked('Router: leaving Settings never traps global navigation until reload',async()=>{
      await page.setViewportSize({width:1440,height:900});
      // Enter Settings through the actual global navigation and immediately
      // leave again, reproducing the report without a browser refresh.
      await navigate('users');
      await page.locator('#nav a[href="#set"]').click();
      await page.waitForFunction(()=>
        location.hash==='#set'&&
        document.querySelector('#settings-subpage')?.dataset.settingsSection==='general'&&
        document.querySelector('#view')?.dataset.page==='set');
      await page.locator('#nav a[href="#users"]').click();
      await page.waitForFunction(()=>
        location.hash==='#users'&&
        document.querySelector('#view')?.dataset.page==='users'&&
        !document.querySelector('#settings-subpage')&&!document.querySelector('#view .sk'));
      // Exercise a real sidebar click, not navigate() (which uses page.goto
      // and can conceal a broken hashchange-only route transition).
      for(const [from,destination,selector] of [
        ['set/general','users','.users-panel'],
        ['set/integrations','nodes','.nodes'],
        ['set/appearance','hosts','.host-directory'],
        ['set/system','templates','.templates-workspace']
      ]){
        await navigate(from);
        assert.equal(await page.locator('#view').getAttribute('data-page'),'set',
          'Precondition: Settings is actually rendered before leaving '+from);
        await page.locator('#nav a[href="#'+destination+'"]').click();
        await page.waitForFunction(dest=>
          location.hash==='#'+dest&&
          document.querySelector('#view')?.dataset.page===dest&&
          !document.querySelector('#view .sk')&&
          !document.querySelector('#settings-subpage'),destination);
        assert(await page.locator('#view '+selector).first().isVisible(),
          'Global navigation should render '+destination+' immediately after '+from);
        assert.equal(new URL(page.url()).hash,'#'+destination);
        assert((await page.locator('#nav a[href="#'+destination+'"]').getAttribute('class')).includes('on'),
          'Main navigation should highlight the destination, not Settings');
      }
      // Also cover a direct hash change from the default Settings page.
      await navigate('set/general');
      await page.evaluate(()=>{location.hash='#home'});
      await page.waitForFunction(()=>
        location.hash==='#home'&&document.querySelector('#view')?.dataset.page==='home'&&
        !document.querySelector('#settings-subpage')&&!document.querySelector('#view .sk'));
      // Moving within Settings should still preserve its existing optimization.
      await navigate('set/general');
      await page.locator('[data-settings-focus="integrations"]').click();
      assert.equal(new URL(page.url()).hash,'#set/integrations');
      assert.equal(await page.locator('[data-settings-section="general"]').count(),1);
      assert.equal(await page.locator('[data-settings-focus="integrations"]').getAttribute('aria-pressed'),'true');
      await page.locator('#nav a[href="#users"]').click();
      await page.waitForFunction(()=>document.querySelector('#view')?.dataset.page==='users'&&
        !document.querySelector('#settings-subpage')&&!document.querySelector('#view .sk'));
    });

    await checked('Settings tabs: persistent navigation and accessible transitions',async()=>{
      await page.setViewportSize({width:1440,height:900});
      // The browser suite normally uses reduced motion: explicitly opt in
      // for the positive animation case, then restore the original policy.
      await page.emulateMedia({reducedMotion:'no-preference'});
      try{
        await navigate('set/general');
        await page.evaluate(()=>{
          const rail=document.querySelector('.settings-center-rail');
          rail.dataset.motionProbe='preserved';
          window.__settingsHadSkeleton=false;
          window.__settingsSkeletonObserver=new MutationObserver(()=>{
            if(document.querySelector('#view .sk'))window.__settingsHadSkeleton=true;
          });
          window.__settingsSkeletonObserver.observe(document.querySelector('#view'),{childList:true,subtree:true});
        });
        await page.locator('.settings-center-link[href="#set/appearance"]').click();
        await page.locator('[data-settings-section="appearance"]').waitFor({state:'visible'});
        const state=await page.evaluate(()=>{
          window.__settingsSkeletonObserver.disconnect();
          return{
            rail:document.querySelector('.settings-center-rail')?.dataset.motionProbe,
            skeleton:window.__settingsHadSkeleton,
            active:document.querySelectorAll('.settings-center-link[aria-current="page"]').length,
            duplicateHeadings:document.querySelectorAll('.settings-center-heading').length,
            grid:getComputedStyle(document.querySelector('.settings-center-grid')).animationName
          };
        });
        assert.equal(state.rail,'preserved','Switching settings pages must not replace the navigation rail');
        assert.equal(state.skeleton,false,'Switching settings pages must not flash global skeletons');
        assert.equal(state.active,1,'Exactly one navigation entry stays active');
        assert.equal(state.duplicateHeadings,0,'Horizontal Settings navigation must not insert page headings');
        assert.equal(state.grid,'nx-settings-panel-enter','Content should transition on category changes');

        await page.evaluate(()=>{document.documentElement.dataset.motion='off'});
        await page.locator('.settings-center-link[href="#set/system"]').click();
        await page.locator('[data-settings-section="system"]').waitFor({state:'visible'});
        assert.equal(await page.locator('.settings-center-grid').evaluate(el=>getComputedStyle(el).animationName),'none',
          'Panel motion-off must disable Settings transitions');
        await page.evaluate(()=>{document.documentElement.dataset.motion='on'});
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.locator('.settings-center-link[href="#set/appearance"]').click();
        await page.locator('[data-settings-section="appearance"]').waitFor({state:'visible'});
        assert.equal(await page.locator('.settings-center-grid').evaluate(el=>getComputedStyle(el).animationName),'none',
          'OS reduced-motion must disable Settings transitions');
      }finally{
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.evaluate(()=>{document.documentElement.dataset.motion='off'});
      }
    });

    await checked('CDN traffic pool: owner chooses inbounds and selection survives reload',async()=>{
      await page.setViewportSize({width:1440,height:900});
      await navigate('set/traffic');
      const save=page.locator('[data-cdn-tags-save]');
      await save.waitFor({state:'visible'});
      assert(await page.locator('#core-panel').isVisible(),'Old traffic bookmark must show unified System page');
      assert(await page.locator('[data-bypass-legacy]').isVisible(),'Legacy tag rules must remain discoverable');
      await page.locator('[data-bypass-legacy] summary').click();
      const period=page.locator('[name="cdnResetPeriod"]');
      const initialPeriod=await period.inputValue();
      await period.selectOption('monthly');
      const options=page.locator('[name="cdnInboundTags"]');
      const count=await options.count();
      const original=await options.evaluateAll(items=>items.filter(el=>el.checked).map(el=>el.value));
      if(count){
        await options.first().check();
        await save.click();
        await page.reload({waitUntil:'domcontentloaded'});
        await page.locator('[data-cdn-tags-save]').waitFor({state:'visible'});
        assert.equal(await page.locator('[name="cdnResetPeriod"]').inputValue(),'monthly','Monthly LTE period must persist through owner settings API');
        assert(await page.locator('[name="cdnInboundTags"]').first().isChecked(),
          'Selected CDN inbound must persist through the owner settings API');
        await page.locator('[name="cdnInboundTags"]').evaluateAll((items,saved)=>{
          for(const item of items)item.checked=saved.includes(item.value);
        },original);
        await page.locator('[name="cdnResetPeriod"]').selectOption(initialPeriod);
        await page.locator('[data-cdn-tags-save]').click();
      }else{
        await save.click();
        await page.reload({waitUntil:'domcontentloaded'});
        await page.locator('[data-cdn-tags-save]').waitFor({state:'visible'});
        assert.equal(await page.locator('[name="cdnResetPeriod"]').inputValue(),'monthly');
        await page.locator('[name="cdnResetPeriod"]').selectOption(initialPeriod);
        await page.locator('[data-cdn-tags-save]').click();
      }
      assert.equal(new URL(page.url()).hash,'#set/traffic');
      assert.equal(await page.locator('[data-settings-section="system"]').count(),1,'Legacy CDN link resolves to the grouped System page');
      assert.equal(await page.locator('#core-panel').count(),1,'The same page also provides core updates');
      await screenshot(page,'settings-cdn-inbound-quota');
    });

    await checked('Settings: deep links show one category, survive reload and preserve browser navigation',async()=>{
      await page.setViewportSize({width:1440,height:900});
      const content={
        general:['#brand-panel','#start-page','[data-hk]','#toast-duration'],
        appearance:['#palette-apply','#content-width','#ts','#follow-reduced-motion'],
        system:['#core-panel','[data-cdn-tags-save]'],
        security:['#security-tab-auth'],
        admins:['[data-ne="admins"]'],
        data:['#gx','#appearance-import']
      };
      const expectedCards={general:5,appearance:6,system:3,security:1,admins:1,data:2};
      const expectedGroups={
        general:['general','integrations'],
        appearance:['colors','layout','typography'],
        system:['system','traffic'],
        security:['security'],admins:['admins'],data:['data']
      };
      assert.equal(await page.locator('.settings-center-link').count(),6,
        'Only six meaningful settings categories should appear in navigation');
      for(const [category,selectors] of Object.entries(content)){
        await navigate('set/'+category);
        assert.equal(await page.locator('.settings-center-link[aria-current="page"]').count(),1,'Exactly one settings page must be active');
        for(const selector of selectors)assert(await page.locator(selector).count()>0,'Missing working settings control '+selector+' on '+category);
        assert.equal(await page.locator('[data-settings-group]').count(),expectedCards[category],
          'Settings '+category+' must mount its complete grouped functional cards');
        assert.equal(await page.locator('[data-settings-group]').evaluateAll(items=>new Set(items.map(item=>item.dataset.settingsGroup)).size),expectedGroups[category].length,
          'The page must contain all source feature groups exactly once');
        const mounted=await page.locator('[data-settings-group]').evaluateAll(items=>items.map(item=>item.dataset.settingsGroup));
        assert(mounted.every(group=>expectedGroups[category].includes(group)),'Only relevant grouped settings may be mounted');
      }
      const aliases={colors:'appearance',layout:'appearance',typography:'appearance',integrations:'general',traffic:'system'};
      for(const [legacy,canonical] of Object.entries(aliases)){
        await navigate('set/'+legacy);
        assert.equal(await page.locator('#settings-subpage').getAttribute('data-settings-section'),canonical,
          'Legacy settings links must resolve to their new group');
      }
      assert.equal(await page.locator('#nav a[href="#admins"],#nav a[href="#security"]').count(),0,
        'Admin and Security must not occupy the global sidebar');
      assert.equal(await page.locator('a.settings-center-link[href="#set/admins"]').count(),1,
        'Owner must see the Admins category inside Settings');
      await navigate('security');
      assert.equal(new URL(page.url()).hash,'#set/security',
        'Legacy Security URL must redirect to Settings');
      await page.locator('#security-tab-auth').waitFor({state:'visible'});
      await navigate('admins');
      assert.equal(new URL(page.url()).hash,'#set/admins',
        'Legacy Admins URL must redirect to Settings');
      await page.locator('[data-ne="admins"]').first().waitFor({state:'visible'});
      await navigate('set/colors');
      await page.reload({waitUntil:'domcontentloaded'});
      await page.locator('#palette-apply').waitFor({state:'visible'});
      assert.equal(new URL(page.url()).hash,'#set/colors','Direct settings link must survive reload');
      await page.locator('.settings-center-nav a.settings-center-link[href="#set/system"]').click();
      await page.locator('#core-panel').waitFor({state:'visible'});
      await page.goBack({waitUntil:'domcontentloaded'});
      await page.locator('#palette-apply').waitFor({state:'visible'});
      assert.equal(new URL(page.url()).hash,'#set/colors','Browser Back must restore legacy appearance deep link');
      assert.equal(await page.locator('[data-settings-section="appearance"]').count(),1);
      await screenshot(page,'settings-appearance-consolidated-1440');
    });

    await checked('Settings: functional browser preferences apply and persist without changing server settings',async()=>{
      await navigate('set/colors');
      const original=await page.evaluate(()=>localStorage.getItem('xmeshNexusSettings'));
      try{
        await page.locator('[data-ui="contrast"][data-value="high"]').click();
        assert.equal(await page.locator('html').getAttribute('data-contrast'),'high');
        await page.locator('[data-ui="linkStyle"][data-value="underline"]').click();
        assert.equal(await page.locator('html').getAttribute('data-link-style'),'underline');
        await navigate('set/general');
        await page.locator('#start-page').selectOption('nodes');
        await page.locator('#nav-counter').uncheck();
        assert.equal(await page.locator('html').getAttribute('data-nav-counter'),'off');
        await page.reload({waitUntil:'domcontentloaded'});
        await page.locator('#start-page').waitFor({state:'visible'});
        assert.equal(await page.locator('#start-page').inputValue(),'nodes');
        assert.equal(await page.locator('html').getAttribute('data-contrast'),'high');
        assert.equal(await page.locator('#nav-counter').isChecked(),false);
        await navigate('set/typography');
        await page.locator('[data-ui="lineSpacing"][data-value="relaxed"]').click();
        await page.locator('#tabular-nums').check();
        assert.equal(await page.locator('html').getAttribute('data-line-spacing'),'relaxed');
        assert.equal(await page.locator('html').getAttribute('data-tabular-nums'),'on');
        await navigate('set/integrations');
        await page.locator('#toast-duration').selectOption('6');
        await page.locator('[data-ui="toastPosition"][data-value="right"]').click();
        const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('xmeshNexusSettings')));
        assert.equal(saved.toastDuration,6);
        assert.equal(saved.toastPosition,'right');
        assert.equal(saved.startPage,'nodes');
        await navigate('set/data');
        assert(await page.locator('[data-appearance-export]').isVisible());
        assert(await page.locator('#appearance-import').count()===1);
      }finally{
        await page.evaluate(old=>{
          if(old===null)localStorage.removeItem('xmeshNexusSettings');
          else localStorage.setItem('xmeshNexusSettings',old);
        },original);
        await navigate('set/colors');
      }
    });

    await checked('Global search: user notes, Ctrl+K and command activation',async()=>{
      await navigate('set/colors');
      await page.locator('#pal').click();
      const query=page.locator('#dlg #pq');
      await query.waitFor({state:'visible'});
      await query.fill('лУННАЯ КОМЕТА 73293');
      const result=page.locator('#dlg #pr [data-search-user="'+user.username+'"]');
      await result.waitFor({state:'visible'});
      assert((await result.innerText()).includes('Лунная комета'),
        'Saved user note matches must include the matching excerpt');
      await result.click();
      await page.waitForSelector('#dlg.user-modal[open]');
      assert((await page.locator('#dlg [data-user-note]').inputValue()).includes('Лунная комета'),
        'Global search result must open the matching user with its note');
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!document.querySelector('#dlg')?.open);

      // Test the actual keyboard shortcut, not only a dispatched synthetic event.
      await page.locator('#custom-a').focus();
      await page.keyboard.press('Control+k');
      await page.locator('#dlg.pal[open] #pq').waitFor({state:'visible'});
      assert(await page.locator('#dlg #pq').evaluate(el=>document.activeElement===el),
        'Ctrl+K must focus global search even from an input');
      await page.keyboard.press('Control+k');
      assert.equal(await page.locator('#dlg.pal[open]').count(),1,
        'Pressing Ctrl+K twice must not create another modal');
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!document.querySelector('#dlg')?.open);

      await page.keyboard.press('Meta+k');
      await page.locator('#dlg.pal[open] #pq').waitFor({state:'visible'});
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!document.querySelector('#dlg')?.open);
    });

    await checked('Users status filters: distinct labels, readable count badges, and selection',async()=>{
      for(const theme of ['light','dark']){
        await page.setViewportSize({width:1440,height:900});
        await navigate('users');
        const layout=await page.locator('#uf').evaluate((root,theme)=>{
          const old=document.documentElement.dataset.theme;
          document.documentElement.dataset.theme=theme;
          const buttons=[...root.querySelectorAll('button[data-uf]')];
          const dimensions=buttons.map(button=>{
            const label=button.querySelector('.users-filter-label');
            const count=button.querySelector('.users-filter-count');
            const l=label?.getBoundingClientRect(),c=count?.getBoundingClientRect(),b=button.getBoundingClientRect();
            return{
              label:label?.textContent,number:count?.textContent,
              gap:l&&c?c.left-l.right:0,
              countWidth:c?.width||0,
              verticalDelta:l&&c?Math.abs((l.top+l.bottom)/2-(c.top+c.bottom)/2):100,
              pressed:button.getAttribute('aria-pressed'),
              active:button.classList.contains('on'),
              inside:l&&c&&c.right<=b.right+1
            };
          });
          if(old===undefined)delete document.documentElement.dataset.theme;
          else document.documentElement.dataset.theme=old;
          return{dimensions,overflow:document.documentElement.scrollWidth>innerWidth+1};
        },theme);
        assert.equal(layout.dimensions.length,7,'Every status category must have a count');
        assert(layout.dimensions.every(v=>v.gap>=6),'Labels must have a visible gap before their counters');
        assert(layout.dimensions.every(v=>v.countWidth>=18&&v.verticalDelta<=3&&v.inside),
          'Each count badge must be readable and aligned inside its button');
        assert(layout.dimensions.every(v=>v.pressed===(v.active?'true':'false')),
          'Accessible filter selection must match visual state');
        assert.equal(layout.overflow,false,'User filter pills must not overflow the page');
      }
      await page.locator('#uf [data-uf="ONLINE"]').click();
      await page.waitForFunction(()=>document.querySelector('#uf [data-uf="ONLINE"]')?.getAttribute('aria-pressed')==='true');
      assert.equal(await page.locator('#uf [aria-pressed="true"]').count(),1);
      await page.locator('#uf [data-uf="all"]').click();
      await page.waitForFunction(()=>document.querySelector('#uf [data-uf="all"]')?.getAttribute('aria-pressed')==='true');
      await page.setViewportSize({width:390,height:844});
      const narrow=await page.locator('#uf').evaluate(root=>({
        overflow:document.documentElement.scrollWidth>innerWidth+1,
        all:[...root.querySelectorAll('button[data-uf]')].every(b=>b.getBoundingClientRect().width>=48),
        gaps:[...root.querySelectorAll('button[data-uf]')].map(b=>b.querySelector('.users-filter-count').getBoundingClientRect().left-b.querySelector('.users-filter-label').getBoundingClientRect().right)
      }));
      assert.equal(narrow.overflow,false,'Mobile status counters must not cause horizontal overflow');
      assert(narrow.all&&narrow.gaps.every(n=>n>=6),'Mobile filters must keep readable label-to-count spacing');
    });

    await checked('Users pagination: 15 / 30 / 60 with enhanced select',async()=>{
      await navigate('users');
      await page.evaluate(async userId=>{
        const source=DB.users.find(item=>item.id===userId);
        if(!source)throw Error('Pagination test source user missing');
        window.__paginationFixtureIds=[];
        for(let i=0;i<62;i++){
          const id=900000000000+i;
          DB.users.push({...source,id,username:'ui-pagination-fixture-'+i,squads:[...source.squads]});
          window.__paginationFixtureIds.push(id);
        }
        UQ.q='';UQ.st='all';UQ.sq='';UQ.inbound='';UQ.tag='';UQ.fp='';
        UQ.node='';UQ.expiry='';UQ.size=15;UQ.page=1;
        await drawUsers();
      },user.id);
      const choose=async size=>{
        await page.locator('#ut .pg .xm-select-trigger').click();
        await page.locator('.xm-select-popover:visible .xm-select-option')
          .filter({hasText:new RegExp('^'+size+'$')}).click();
        await page.waitForFunction(size=>{
          const select=document.querySelector('#ut select[data-psz]');
          return UQ.size===size&&UQ.page===1&&select?.value===String(size)&&
            document.querySelectorAll('#ut tbody tr').length===size;
        },size);
        assert.equal(await page.locator('#ut tbody tr').count(),size);
      };
      try{
        await choose(30);
        await choose(60);
        await choose(15);
        await page.locator('#ut [data-pg="1"]').click();
        await page.waitForFunction(()=>UQ.page===2);
        await choose(30);
      }finally{
        await page.evaluate(async()=>{
          const ids=new Set(window.__paginationFixtureIds||[]);
          DB.users=DB.users.filter(item=>!ids.has(item.id));
          delete window.__paginationFixtureIds;
          UQ.size=15;UQ.page=1;
          await drawUsers();
        });
      }
    });

    await checked('Squad sections: equal height with unequal inbound counts',async()=>{
      await page.setViewportSize({width:1920,height:1080});
      await navigate('squads');
      const positions=await page.locator('.squad-card-grid').evaluate(grid=>{
        const original=grid.querySelector('.squad-card');
        if(!original)throw Error('Squad fixture missing');
        const variants=[
          ['TLS', 'Длинное описание группы доступа к подключениям Xray', ['hysteria-main','masque-main','shadowsocks-main','trojan-main','vless-main']],
          ['Vless', 'Группа доступа', ['vless-main']],
          ['shadowsocks', 'Ещё одно описание группы доступа', ['hysteria-main']]
        ];
        const cards=[original];
        variants.forEach(([name,description,tags],i)=>{
          const card=original.cloneNode(true);
          card.dataset.squadCard='alignment-fixture-'+i;
          card.querySelector('.squad-card-name').textContent=name;
          card.querySelector('.squad-card-identity p').textContent=description;
          const tagContainer=card.querySelector('.squad-card-tags');
          tagContainer.replaceChildren(...tags.map(value=>{
            const chip=document.createElement('span');
            chip.className='chip';
            chip.textContent=value;
            return chip;
          }));
          grid.append(card);
          cards.push(card);
        });
        const sectionNames=['.squad-card-head','.squad-card-tags','.squad-card-metrics','.squad-card-relations','.squad-card-traffic'];
        return cards.map(card=>{
          const box=card.getBoundingClientRect();
          return{
            top:box.top,bottom:box.bottom,
            starts:sectionNames.map(selector=>card.querySelector(selector).getBoundingClientRect().top),
            tagsVisible:card.querySelector('.squad-card-tags').scrollHeight<=card.querySelector('.squad-card-tags').clientHeight+1,
            title:card.querySelector('.squad-card-name').textContent,
            titleFragments:(()=>{
              const range=document.createRange();
              range.selectNodeContents(card.querySelector('.squad-card-name'));
              return range.getClientRects().length;
            })()
          };
        });
      });
      assert(positions.every(item=>item.tagsVisible),'All squad inbound tags must remain visible');
      assert(positions.length>=4,'Need multiple squad cards for alignment test');
      assert.equal(positions.find(card=>card.title==='shadowsocks')?.titleFragments,1,
        'Readable Squad titles must fit without breaking ordinary protocol names');
      // Compare alignment only within the same grid row. Larger accessible
      // card widths legitimately move the fourth fixture to the next row.
      const rows=[];
      for(const card of positions){
        let row=rows.find(group=>Math.abs(group[0].top-card.top)<2);
        if(!row){row=[];rows.push(row)}
        row.push(card);
      }
      assert(rows.some(row=>row.length>=2),'At least two Squad cards must share a row');
      for(const row of rows)for(const card of row.slice(1)){
        const first=row[0];
        assert(Math.abs(card.bottom-first.bottom)<2,'Squad cards in the same row must end at the same height');
        card.starts.forEach((top,i)=>{
          assert(Math.abs(top-first.starts[i])<2,'Squad section '+i+' must align within each row');
        });
      }
    });

    await checked('Catalogue bulk toolbars: select, count and clear without mutating records',async()=>{
      await page.setViewportSize({width:1920,height:1080});
      for(const [route,root,card] of [
        ['nodes','.nodes-page','[data-node-card-id]'],
        ['hosts','.host-directory','[data-host-card-id]'],
        ['squads','.squad-directory','[data-squad-card]']
      ]){
        await navigate(route);
        const scope=page.locator(root);
        assert(await scope.locator(card).count()>0,route+' requires a persisted fixture');
        const mode=scope.locator('[data-bulk-action="mode"]');
        assert(await mode.isVisible(),route+' must have bulk actions in its existing toolbar');
        assert.match((await mode.innerText()).trim(),/^(Массовые действия|Bulk actions)$/);
        const geometry=await scope.evaluate(area=>{
          const toolbar=area.querySelector('.nodes-toolbar,.host-directory-toolbar,.squad-directory-toolbar');
          const search=toolbar.querySelector('.node-explorer-search,.nx-directory-search').getBoundingClientRect();
          const bulk=toolbar.querySelector('[data-bulk-toolbar]').getBoundingClientRect();
          const density=toolbar.querySelector('.node-grid-controls,.nx-workspace-grid-controls').getBoundingClientRect();
          const frame=toolbar.getBoundingClientRect();
          return{searchRight:search.right,bulkLeft:bulk.left,bulkRight:bulk.right,
            densityLeft:density.left,toolbarLeft:frame.left,toolbarRight:frame.right};
        });
        assert(geometry.bulkLeft>=geometry.toolbarLeft-1&&geometry.bulkRight<=geometry.toolbarRight+1,
          route+' bulk trigger must remain inside the main toolbar');
        assert(geometry.bulkRight<=geometry.densityLeft+2,
          route+' bulk trigger must precede density controls');
        await mode.click();
        const selection=await scope.evaluate(area=>{
          const toolbar=area.querySelector('.nodes-toolbar,.host-directory-toolbar,.squad-directory-toolbar');
          const controls=area.querySelector('[data-bulk-toolbar]');
          return{inside:toolbar.contains(controls),visible:controls.getClientRects().length>0,
            separate:!!area.querySelector(':scope > .nx-bulk-context'),
            hasCount:!!controls.querySelector('.nx-bulk-count'),
            hasActions:!!controls.querySelector('.nx-bulk-actions')};
        });
        assert(selection.inside&&selection.visible&&!selection.separate&&selection.hasCount&&selection.hasActions,
          route+' selection, count and actions must all stay in the original toolbar');
        assert((await scope.locator('[data-bulk-toolbar] svg.ic').count())>=4,
          route+' bulk operations must use recognizable semantic icons');
        assert.match((await mode.innerText()).trim(),/^(Завершить выбор|Finish selection)$/);
        const first=scope.locator(card+' [data-bulk-check]').first();
        assert(await first.isVisible(),route+' must expose a selection checkbox on each card');
        await first.check();
        assert.match(await scope.locator('.nx-bulk-count').innerText(),/\b1\b/);
        if(route==='nodes'){
          const update=scope.locator('[data-bulk-action="agent-update"]');
          assert.equal(await update.count(),1,'Nodes must expose a mass Agent update command');
          assert(await update.isEnabled(),'Selected nodes must enable mass Agent update');
          const xray=scope.locator('[data-bulk-action="xray-update"]');
          assert.equal(await xray.count(),1,'Nodes must expose mass Xray update alongside Agent update');
          assert(await xray.isEnabled(),'Selected nodes must enable mass Xray update');
        }
        await scope.locator('[data-bulk-action="all"]').click();
        const visible=await scope.locator(card+':visible').count();
        assert.equal(await scope.locator('[data-bulk-check]:checked').count(),visible,
          route+' select visible must target only visible cards');
        await scope.locator('[data-bulk-action="clear"]').click();
        assert.equal(await scope.locator('[data-bulk-check]:checked').count(),0);
        await mode.click();
        assert.equal(await scope.locator('[data-bulk-check]:visible').count(),0);
      }
      await navigate('users');
      assert.equal(await page.locator('.users-toolbar #bulk').count(),1,
        'Existing User bulk actions must live inside the main toolbar');
      const checkbox=page.locator('#ut [data-sel]').first();
      await checkbox.check();
      assert(await page.locator('.users-toolbar #bulk.on').isVisible(),
        'User bulk toolbar should activate as soon as a row is selected');
      await page.locator('[data-bk="clr"]').click();
    });

    await checked('Host directory: cards, layout, active state and existing controls',async()=>{
      for(const [width,height] of [[1920,1080],[1366,768],[390,844]]){
        await page.setViewportSize({width,height});
        await navigate('hosts');
        const card=page.locator('[data-host-card-id="'+host.id+'"]');
        assert(await card.isVisible(),'Persisted host must be shown as a card');
        assert.equal(await page.locator('#view tr[data-e^="hosts:"]').count(),0,'Host table rows must be replaced');
        assert.equal(await card.locator('.host-card-edit').count(),1,'One-click Host settings must stay available');
        assert.equal(await card.locator('[data-host-duplicate]').count(),1,'Duplicate action must remain available');
        assert.equal(await card.locator('[data-host-copy]').count(),1,'Address must offer a direct copy action');
        assert.equal(await card.locator('[data-mv]').count(),2,'Host order controls must be retained');
        assert.equal(await card.locator('.host-card-endpoint b').innerText(),'ui.example.invalid:443');
        assert(await card.locator('.host-card-readiness .chip').isVisible(),'Readiness must use the existing Host validation');
        const g=await card.evaluate(el=>{
          const a=el.getBoundingClientRect();
          const viewport=window.innerWidth;
          const overflow=[...el.querySelectorAll('button,input,summary')]
            .filter(e=>e.getClientRects().length)
            .some(e=>{const b=e.getBoundingClientRect();return b.left<a.left-2||b.right>a.right+2});
          return{left:a.left,right:a.right,viewport,overflow};
        });
        assert(g.left>=0&&g.right<=g.viewport+1,'Host card cannot overflow viewport');
        assert(!g.overflow,'Host card controls must remain contained');
        if(width===1920){
          const toggle=card.locator('input[data-tg^="hosts:"]');
          const off=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/api/v1/collections/hosts/'+host.id);
          await toggle.uncheck();assert((await off).ok(),'Disable must persist via existing API');
          await page.waitForFunction(id=>!!document.querySelector('[data-host-card-id="'+id+'"] .host-card-state.is-disabled'),host.id);
          const on=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/api/v1/collections/hosts/'+host.id);
          await page.locator('[data-host-card-id="'+host.id+'"] input[data-tg^="hosts:"]').check();
          assert((await on).ok(),'Enable must persist via existing API');
          await page.waitForFunction(id=>!!document.querySelector('[data-host-card-id="'+id+'"] .host-card-state.is-enabled'),host.id);
        }
      }
    });

    await checked('Hosts directory: left search filters records without changing summary',async()=>{
      for(const [width,height] of [[1920,1080],[390,844]]){
        await page.setViewportSize({width,height});
        await navigate('hosts');
        const input=page.locator('[data-host-search]');
        const card=page.locator('[data-host-card-id="'+host.id+'"]');
        const clear=page.locator('[data-host-search-clear]');
        const empty=page.locator('[data-host-search-empty]');
        await input.waitFor({state:'visible'});
        assert(await card.isVisible(),'Real Host must remain visible before search');
        const before=await page.locator('.host-card-grid .host-card:visible').count();
        const totals=await page.locator('.host-directory-summary').innerText();
        assert.equal(await page.locator('.host-directory-summary .host-summary-metric').count(),3,
          'Hosts toolbar must show total, active and disabled metrics');
        assert.equal(await page.locator('.host-directory-toolbar > .host-directory-summary').count(),1,
          'Host metrics must live inside the toolbar, never as a separate second row card');
        assert.equal(await page.locator('.host-directory > .host-directory-summary').count(),0,
          'Do not render a separate statistics surface beneath the toolbar');
        for(const phrase of [host.remark,'UI.EXAMPLE.INVALID',profile.name,inboundTag.toUpperCase(),node.name]){
          await input.fill(phrase);
          assert(await card.isVisible(),'Hosts search must match saved metadata: '+phrase);
          assert.equal(await page.locator('[data-host-search-count-value]').innerText(),'1');
          assert(!(await empty.isVisible()),'Successful search must not show empty result state');
        }
        await input.fill('___no_host_matches_this_phrase___');
        assert.equal(await page.locator('.host-card-grid .host-card:visible').count(),0);
        assert(await empty.isVisible(),'Missing Host must show an empty result message');
        assert.equal(await page.locator('[data-host-search-count-value]').innerText(),'0');
        assert.equal(await page.locator('.host-directory-summary').innerText(),totals,
          'Search must not alter the unfiltered inventory totals');
        await clear.click();
        assert.equal(await input.inputValue(),'');
        assert.equal(await page.locator('.host-card-grid .host-card:visible').count(),before);
        await input.fill('__no_match__');
        await input.press('Escape');
        assert.equal(await input.inputValue(),'','Escape must clear Hosts search');
        assert(await card.isVisible(),'Escape must restore all Hosts');
        const g=await page.locator('.host-directory-toolbar').evaluate(el=>{
          const toolbar=el.getBoundingClientRect();
          const style=getComputedStyle(el);
          const contentLeft=toolbar.left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft);
          const search=el.querySelector('[data-host-search]').getBoundingClientRect();
          const create=el.querySelector('[data-ne="hosts"]').getBoundingClientRect();
          return{left:toolbar.left,right:toolbar.right,contentLeft,searchLeft:search.left,
            searchRight:search.right,searchMid:(search.top+search.bottom)/2,createMid:(create.top+create.bottom)/2,
            createLeft:create.left,createRight:create.right,viewport:window.innerWidth};
        });
        assert(g.left>=0&&g.right<=g.viewport+1,'Hosts toolbar must stay inside viewport');
        assert(Math.abs(g.searchLeft-g.contentLeft)<2,'Hosts search must align with the left content edge, including designed padding');
        assert(Math.abs(g.searchMid-g.createMid)<3,'Hosts search and creation must share the leading toolbar row');
        assert(g.searchRight<g.createLeft,'Hosts creation must stay to the right of search');
        assert(g.createRight<=g.right+1,'Hosts create must stay inside toolbar');
      }
    });

    await checked('Hosts bulk actions stay within responsive toolbar bounds',async()=>{
      for(const width of [1920,1366,1024,390]){
        await page.setViewportSize({width,height:900});
        await navigate('hosts');
        const mode=page.locator('.host-directory-toolbar [data-bulk-action="mode"]');
        await mode.click();
        await page.locator('.host-card-grid [data-bulk-check]').first().check();
        const g=await page.locator('.host-directory-toolbar').evaluate(el=>{
          const t=el.getBoundingClientRect(),b=el.querySelector('[data-bulk-toolbar]').getBoundingClientRect();
          return{toolbarLeft:t.left,toolbarRight:t.right,bulkLeft:b.left,bulkRight:b.right,overflow:document.documentElement.scrollWidth>innerWidth+1};
        });
        assert(!g.overflow,'Host bulk selection must not overflow page');
        assert(g.bulkLeft>=g.toolbarLeft-1&&g.bulkRight<=g.toolbarRight+1,'Bulk controls stay inside toolbar at '+width);
        await mode.click();
      }
    });

    await checked('Hosts toolbar: inline counters share a compact row on desktop',async()=>{
      for(const width of [1920,1366,1024,390]){
        await page.setViewportSize({width,height:900});
        await navigate('hosts');
        const result=await page.locator('.host-directory-toolbar').evaluate(toolbar=>{
          const box=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,mid:(r.top+r.bottom)/2}};
          const search=box(toolbar.querySelector('[data-host-search]'));
          const summary=box(toolbar.querySelector('.host-directory-summary'));
          const density=box(toolbar.querySelector('.nx-workspace-grid-controls'));
          const bulk=box(toolbar.querySelector('[data-bulk-toolbar]'));
          const add=box(toolbar.querySelector('.nx-workspace-create'));
          const metrics=[...toolbar.querySelectorAll('.host-summary-metric')].map(box);
          const bar=box(toolbar);
          return{bar,search,summary,bulk,density,add,metrics,
            columns:getComputedStyle(toolbar).gridTemplateColumns.split(/\s+/).length,
            overflow:document.documentElement.scrollWidth>innerWidth+1,
            separate:!!document.querySelector('.host-directory > .host-directory-summary')};
        });
        assert.equal(result.separate,false,'Hosts stats must not make a second standalone surface');
        assert.equal(result.metrics.length,3,'All three host inventory counters must remain visible');
        assert(!result.overflow,'Toolbar counts must not create horizontal page overflow');
        assert(result.metrics.every(m=>m.width>0),'Host summary numbers must have visible widths');
        for(const item of [result.search,result.summary,result.bulk,result.density,result.add])
          assert(item.x>=result.bar.x-1&&item.right<=result.bar.right+1,
            'Every toolbar control must fit within its framed surface');
        assert(Math.abs(result.search.mid-result.add.mid)<3,
          'Search and create should remain aligned in one leading row');
        // The host directory can enter its container-based compact layout
        // even at desktop viewport widths if scale/sidebar reduce content area.
        if(result.columns===5){
          assert(Math.abs(result.search.mid-result.summary.mid)<3,
            'Desktop counts must share the same toolbar row as search');
          assert(Math.abs(result.search.mid-result.bulk.mid)<3,
            'Desktop bulk action trigger must share the leading toolbar row');
          assert(Math.abs(result.summary.mid-result.density.mid)<3,
            'Desktop density controls must stay on the same row as counters');
          assert(result.bar.height<=95,'Hosts desktop toolbar must not waste space on stacked metrics');
        }
      }
    });

    await checked('Squad bulk selection: 768px card buttons never escape their cards',async()=>{
      await page.setViewportSize({width:768,height:1024});
      await navigate('squads');
      await page.locator('.squad-directory-toolbar [data-bulk-action="mode"]').click();
      const select=page.locator('.squad-card [data-bulk-check]').first();
      await select.check();
      const bounds=await page.locator('.squad-card').first().evaluate(card=>{
        const h=card.querySelector('.squad-card-head').getBoundingClientRect();
        const r=card.getBoundingClientRect();
        const icon=card.querySelector('.squad-card-emblem').getBoundingClientRect();
        const label=card.querySelector('.squad-card-identity').getBoundingClientRect();
        return{cardRight:r.right,headerRight:h.right,iconRight:icon.right,labelRight:label.right,
          editVisible:getComputedStyle(card.querySelector('.squad-card-head-actions')).display!=='none',
          overflow:document.documentElement.scrollWidth>innerWidth+1};
      });
      assert(bounds.editVisible,'Edit must remain visible during bulk selection');
      assert(bounds.iconRight<=bounds.cardRight+1&&bounds.labelRight<=bounds.cardRight+1,
        'Squad identity must remain inside its card when selection is active');
      assert(!bounds.overflow,'Bulk selection must not overflow 768px viewports');
    });

    await checked('Squad directory: instant search by name, description and inbound',async()=>{
      for(const [width,height] of [[1920,1080],[390,844]]){
        await page.setViewportSize({width,height});
        await navigate('squads');
        const search=page.locator('#view .squad-directory-toolbar:visible [data-squad-search]');
        const card=page.locator('[data-squad-card="'+squad.id+'"]');
        const clear=page.locator('#view .squad-directory-toolbar:visible [data-squad-search-clear]');
        const empty=page.locator('#view .squad-directory [data-squad-search-empty]');
        await search.waitFor({state:'visible'});
        assert(await card.isVisible(),'Squad must be initially visible');
        const before=await page.locator('.squad-card-grid .squad-card:visible').count();
        assert(before>=1,'Squad inventory must contain test squad');
        for(const phrase of [squad.name,'Данные браузерной проверки',inboundTag.toUpperCase()]){
          await search.fill(phrase);
          assert(await card.isVisible(),'Search must match name, description and inbound (case-insensitive): '+phrase);
          assert.equal(await page.locator('.squad-card-grid .squad-card:visible').count(),1,
            'Search result must not include unrelated squads');
          assert(await page.locator('[data-squad-search-count]').isVisible(),'Search must display result count');
          assert.equal(await page.locator('[data-squad-search-count-value]').innerText(),'1');
        }
        await search.fill('___no_squad_matches_this_phrase___');
        assert.equal(await page.locator('.squad-card-grid .squad-card:visible').count(),0);
        assert(await empty.isVisible(),'Empty search must have a visible explanation');
        assert.equal(await page.locator('[data-squad-search-count-value]').innerText(),'0');
        await clear.click();
        assert.equal(await search.inputValue(),'');
        assert.equal(await page.locator('.squad-card-grid .squad-card:visible').count(),before);
        assert(!(await empty.isVisible()),'Empty search state must disappear on clear');
        await search.fill('___nothing___');
        await search.press('Escape');
        assert.equal(await search.inputValue(),'','Escape must clear active search');
        assert(await card.isVisible(),'Escape must restore squad cards');
        const layout=await page.locator('.squad-directory-toolbar').evaluate(el=>{
          const bounds=el.getBoundingClientRect();
          const style=getComputedStyle(el);
          const contentLeft=bounds.left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft);
          const input=el.querySelector('[data-squad-search]').getBoundingClientRect();
          const create=el.querySelector('[data-ne="squads"]').getBoundingClientRect();
          return {bounds:{left:bounds.left,right:bounds.right},contentLeft,
            input:{left:input.left,right:input.right,mid:(input.top+input.bottom)/2},
            create:{left:create.left,right:create.right,mid:(create.top+create.bottom)/2},
            viewport:window.innerWidth};
        });
        assert(layout.bounds.left>=0&&layout.bounds.right<=layout.viewport+1,'Squad toolbar must fit viewport');
        assert(Math.abs(layout.input.left-layout.contentLeft)<2,'Squads search must align with the left content edge, including designed padding');
        assert(Math.abs(layout.input.mid-layout.create.mid)<3,'Squads search and creation must share the leading toolbar row');
        assert(layout.input.right<layout.create.left,'Squads create must remain to the right of search');
        assert(layout.create.right<=layout.bounds.right+1,'Squads create must remain inside toolbar');
      }
    });

    await checked('Squad cards: real access mapping, traffic source and responsive grid',async()=>{
      const metrics=await api('GET','/squads/traffic/24h');
      assert.equal(metrics.source,'verified_traffic_deltas');
      assert.equal(metrics.sourceType,'user');
      assert.equal(metrics.range,'24h');
      assert.equal(metrics.membership,'current');
      assert(Array.isArray(metrics.items),'Squad traffic must be backed by verified counter data');
      // The create-user quota test creates another member of this squad.
      // Count from persisted assignments rather than a stale hard-coded 2.
      const roster=(await api('GET','/bootstrap')).collections.users;
      const expectedSquadMembers=roster.filter(u=>Array.isArray(u.squads)&&
        u.squads.some(id=>String(id)===String(squad.id))).length;
      assert(expectedSquadMembers>=2,'Base fixtures must remain assigned to the squad');
      for(const [width,height] of [[1920,1080],[1366,768],[390,844]]){
        await page.setViewportSize({width,height});
        await navigate('squads');
        const card=page.locator(`[data-squad-card="${squad.id}"]`);
        assert(await card.isVisible(),'Squad must render as a card');
        assert.equal(await page.locator('.squad-card-grid [data-e]').count(),0,'Legacy table rows must not appear');
        assert.equal(await card.locator('.squad-card-metrics strong').first().innerText(),String(expectedSquadMembers),'Members from current user assignments');
        assert.equal(await card.locator('.squad-card-metrics strong').nth(1).innerText(),'1','Inbound count from saved squad');
        assert.equal(await card.locator('.squad-card-relations b').first().innerText(),'1','Hosts from enabled host mapping');
        await page.waitForFunction(id=>!!document.querySelector(`[data-squad-traffic="${id}"] .squad-card-traffic-value`),squad.id);
        const g=await page.locator('.squad-card-grid').evaluate(el=>{
          const rect=el.getBoundingClientRect();
          const style=getComputedStyle(el);
          const gap=parseFloat(style.columnGap)||0;
          const fontSize=parseFloat(getComputedStyle(document.documentElement).fontSize)||16;
          const minCardWidth=Math.min(rect.width,24*fontSize);
          return{left:rect.left,right:rect.right,viewport:innerWidth,
            columns:style.gridTemplateColumns.split(' ').length,
            expectedColumns:Math.max(1,Math.floor((rect.width+gap+.01)/(minCardWidth+gap)))};
        });
        assert(g.left>=0&&g.right<=g.viewport+1,'Cards must fit horizontally');
        assert.equal(g.columns,g.expectedColumns,'Squad grid columns must follow the available workspace width');
        if(width===1920)assert(g.columns>=3,'Desktop squad cards must keep readable titles instead of overfilling the row');
        if(width===390)assert.equal(g.columns,1,'Mobile must show one squad card per row');
        await screenshot(page,`squad-cards-${width}x${height}`);
        const edit=card.locator('.squad-card-edit');
        assert(await edit.isVisible(),'Edit must be directly visible, not hidden in an actions menu');
        assert.equal(await card.locator('.squad-card-menu [data-ne]').count(),0,'Actions menu must not duplicate the primary edit action');
        assert.equal(await card.locator('.squad-card-menu [data-del]').count(),1,'Delete must remain behind the actions menu');
        const editBounds=await edit.boundingBox(),cardBounds=await card.boundingBox();
        assert(editBounds&&cardBounds&&editBounds.x>=cardBounds.x-1&&editBounds.x+editBounds.width<=cardBounds.x+cardBounds.width+1,'Direct edit must stay inside the card');
        await edit.click();
        assert(await page.locator('form[data-ent="squads"]').isVisible(),'One click on Edit must open the existing Squad editor');
        await page.keyboard.press('Escape');
        await page.waitForSelector('dialog[open]',{state:'detached'});
      }
    });

    for (const [width,height] of sizes) {
      await page.setViewportSize({width,height});
      for (const route of routes) await checked(`${route}: ${width}×${height}`, async () => {
        await navigate(route);
        const g = await geometry(page);
        if(route==='statistics'){
          // Navigation only confirms the view shell. Node metrics arrive from an
          // independent asynchronous request; do not measure its counter while
          // it is still empty rather than reporting a real filtered/total count.
          await page.waitForFunction(()=>{
            const nodeCount=document.querySelector('#stats-node-count');
            return nodeCount && /^\d+ (?:из|of) \d+$/.test(nodeCount.textContent.trim());
          },null,{timeout:15000});
          const toolbar=await page.locator('.stats-nodes-toolbar').evaluate(root=>{
            const rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,centerY:r.y+r.height/2}};
            const search=root.querySelector('.stats-node-search'),input=root.querySelector('#stats-node-search');
            const filter=root.querySelector('.xm-select-shell')||root.querySelector('#stats-node-filter');
            const toggle=root.querySelector('.stats-node-view-toggle'),count=root.querySelector('#stats-node-count');
            const actions=root.querySelector('.stats-node-toolbar-actions');
            return {outer:rect(root),search:rect(search),filter:rect(filter),toggle:rect(toggle),count:rect(count),
              actions:rect(actions),toggleButtons:[...toggle.querySelectorAll('button')].map(rect),
              outerBorder:getComputedStyle(root).borderTopWidth,
              toggleBorder:getComputedStyle(toggle).borderTopWidth,
              countBorder:getComputedStyle(count).borderTopWidth,
              countText:count.textContent.trim(),
              wrap:getComputedStyle(root).flexWrap,inputBorder:getComputedStyle(input).borderTopWidth,
              inputShadow:getComputedStyle(input).boxShadow};
          });
          assert.equal(toolbar.inputBorder,'0px','Statistics search must not draw a second pill border');
          assert.equal(toolbar.inputShadow,'none','Statistics search must not have a second shadow');
          assert.equal(toolbar.outerBorder,'0px','Statistics toolbar must not draw an enclosing capsule');
          assert.equal(toolbar.toggleBorder,'0px','Statistics segmented switch must not have a thick outer border');
          assert.equal(toolbar.countBorder,'0px','Statistics node count must remain unboxed');
          assert(/^\d+ (?:из|of) \d+$/.test(toolbar.countText),
            'Node count must be a compact number, e.g. 3 из 3');
          assert.equal(toolbar.toggleButtons.length,2,'Statistics must offer both grid and list views');
          for(const button of toolbar.toggleButtons){
            assert(button.x>=toolbar.toggle.x-1&&button.right<=toolbar.toggle.right+1&&
              button.y>=toolbar.toggle.y-1&&button.bottom<=toolbar.toggle.bottom+1,
              'Statistics grid/list button escapes its segmented track at '+width+'px');
          }
          for(const part of ['search','filter','toggle','count','actions']){
            const r=toolbar[part],outer=toolbar.outer;
            assert(r.x>=outer.x-2&&r.right<=outer.right+2,
              'Statistics toolbar '+part+' escapes horizontal bounds at '+width+'px');
          }
          const statusPlacement=await page.locator('.stats-node').evaluateAll(cards=>cards.map(card=>{
            const state=card.querySelector('.stats-node-state');
            const head=card.querySelector('.stats-node-head');
            const time=card.querySelector('.stats-node-time');
            const bounds=el=>{const r=el.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom}};
            return {card:bounds(card),head:bounds(head),state:bounds(state),time:bounds(time)};
          }));
          for(const entry of statusPlacement){
            assert(entry.state.x>=entry.head.x-1&&entry.state.right<=entry.head.right+1&&
              entry.state.y>=entry.head.y-1&&entry.state.bottom<=entry.head.bottom+1,
              'Freshness belongs inside its node card header, not under the statistics toolbar');
          }
          if(width>=1366){
            assert.equal(toolbar.wrap,'nowrap','Desktop Statistics toolbar must be a single row');
            assert(toolbar.outer.height<=66,'Statistics toolbar has grown into stacked rows');
            const boxes=[toolbar.search,toolbar.filter,toolbar.toggle,toolbar.count];
            assert(boxes.every(b=>Math.abs(b.centerY-boxes[0].centerY)<=8),
              'Statistics controls and count must share one horizontal baseline');
            assert(boxes.every((b,i)=>i===0||boxes[i-1].right<=b.x+3),
              'Statistics toolbar controls overlap instead of forming one line');
          }
        }
        if (['set','nodes'].includes(route) || width === 390 || width === 768 || width === 1440 || width === 1920 || width === 3440) await screenshot(page,`${route}-${width}`);
        if(width<1000){
          assert(!g.renderFailed,'Mobile route must render');
          assert(g.scrollWidth<=width+1,'Mobile document must not overflow horizontally: '+JSON.stringify({width:g.scrollWidth,outside:g.outside}));
          assert(g.view.x>=0&&g.view.right<=width+1,'Mobile workspace must stay in viewport');
        }else verifyPage(g,route);
        return g;
      });
    }

    for(const [width,height,count,limit] of [[1920,1080,2,2],[2560,1440,5,5],[390,844,5,0],[1920,1080,0,2]])await checked(`Device workspace: ${width} ${count}/${limit||'unlimited'}`,async()=>{
      await page.setViewportSize({width,height});
      const pattern='**/api/v1/bootstrap',mutation=`**/api/v1/collections/users/${user.id}`,removeRoute=`**/api/v1/users/${user.id}/subscription?deviceAction=remove&deviceId=*`;
      let snapshot,failNext=false;const patches=[],removals=[];
      const initial=await page.evaluate(()=>({role:sessionUser.role,language:XMeshI18n.getLanguage()}));
      await page.route(mutation,async route=>{
        const patch=route.request().postDataJSON();patches.push(patch);
        assert(!('devices' in patch),'Device bindings must not be deleted through user JSON PATCH');
        snapshot={...snapshot,...patch};await route.fulfill({json:snapshot});
      });
      await page.route(removeRoute,async route=>{
        assert.equal(route.request().method(),'POST');
        const id=Number(new URL(route.request().url()).searchParams.get('deviceId'));removals.push(id);
        if(failNext){failNext=false;await route.fulfill({status:503,json:{error:'Device write temporarily unavailable'}});return}
        snapshot.devices=snapshot.devices.filter(d=>d.id!==id);
        await route.fulfill({json:{ok:true,deviceLimit:{devices:snapshot.devices,count:snapshot.devices.length,limit:snapshot.hwid}}});
      });
      await page.route(pattern,async route=>{
        const response=await route.fetch(),data=await response.json();
        const u=data.collections.users.find(u=>u.id===user.id);
        u.hwid=limit;u.devices=Array.from({length:count},(_,i)=>({id:1000+i,model:i?(count===2?'DESKTOP-FMFMPGO_x86_64':'Phone '+i):'DESKTOP-D17RJR9_x86_64',plat:i&&count!==2?'Android':'Windows',os:i&&count!==2?'Android':'Windows',osVersion:i&&count!==2?'15':'11_10.0.26200',app:'Happ',first:Date.now()-86400000*(10+i),last:Date.now()-600000*(i+1),fingerprint:'test-hwid-<unsafe>-'+i,refreshes:12}));
        snapshot=structuredClone(u);await route.fulfill({response,json:data});
      });
      try{
        await navigate('users');
        await page.reload({waitUntil:'domcontentloaded'});
        await page.locator(`#ut [data-sharing-detail="${user.id}"][data-sharing-focus="devices"]`).waitFor();
        if(width>=1920){
          const pager=await page.locator('#ut .pg').evaluate(p=>{const s=p.querySelector('.xm-select-shell');return{height:p.getBoundingClientRect().height,selectWidth:s?.getBoundingClientRect().width}});
          assert(pager.selectWidth<=120&&pager.height<=80,'Users pagination must stay on one compact row');
        }
        const activityEntry=page.locator('#ut .xm-activity-entry').first();
        await activityEntry.waitFor({state:'attached'});
        assert(await activityEntry.getAttribute('aria-label'),'Activity history must have an accessible entry point');
        if(width>=1120)assert(await activityEntry.isVisible(),'Desktop activity entry should be visible');
        // Mobile may retain Activity inside the table's own horizontal scroller.
        // Its exact visibility is a responsive-layout choice, not a correctness gate.
        assert.equal(await page.locator('#ut .xm-risk-pill,.xm-sharing-overview').count(),0,
          'Routine device activity must not produce speculative sharing warnings');
        await screenshot(page,`devices-table-${width}-${count}-${limit}`);
        await page.locator(`#ut [data-sharing-detail="${user.id}"][data-sharing-focus="devices"]`).click();
        const dialog=page.locator('#xm-sharing-dialog');
        await dialog.locator('.xm-device-capacity').waitFor();
        assert.equal(await dialog.locator('.xm-sharing-device').count(),count);
        assert.equal(await dialog.locator('[data-device-tab=devices]').getAttribute('aria-selected'),'true');
        const originalRadius=await page.evaluate(()=>document.documentElement.style.getPropertyValue('--ui-control-radius'));
        try{
          for(const radius of ['6px','999px']){
            await page.evaluate(value=>document.documentElement.style.setProperty('--ui-control-radius',value),radius);
            const shape=await dialog.locator('.xm-device-tabs button').evaluateAll(buttons=>buttons.map(b=>{const s=getComputedStyle(b),r=b.getBoundingClientRect();return{radii:[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomLeftRadius,s.borderBottomRightRadius],borders:[s.borderTopWidth,s.borderRightWidth,s.borderLeftWidth],bottom:r.bottom,line:s.borderBottomWidth}}));
            assert(shape.every(b=>b.radii.every(r=>r==='0px')),'Navigation underline must stay straight at every global corner setting');
            assert(shape.every(b=>b.borders.every(w=>w==='0px')&&b.line==='2px'),'Tabs must have only a bottom indicator, not a capsule edge');
            assert(Math.abs(shape[0].bottom-shape[1].bottom)<=1,'Tab indicators must share a baseline');
            assert.notEqual(await dialog.locator('.xm-sharing-close').evaluate(b=>getComputedStyle(b).borderRadius),'0px','Ordinary controls must keep global rounding');
          }
          if(width===1920&&count===2){
            const filename='devices-tabs-max-radius.png';
            await dialog.locator('.xm-device-toolbar').screenshot({path:path.join(output,filename),animations:'disabled'});report.screenshots.push(filename);
          }
        }finally{
          await page.evaluate(value=>{if(value)document.documentElement.style.setProperty('--ui-control-radius',value);else document.documentElement.style.removeProperty('--ui-control-radius')},originalRadius);
        }

        assert(!(await page.locator('.xm-sharing-overview').isVisible()),'Healthy users must not get an anti-sharing warning banner');
        if(count){
          assert(!(await dialog.locator('.xm-device-picker').innerText()).includes('26200'),'Build identifiers must not dominate device choices');
          assert(!(await dialog.locator('.xm-device-picker').innerText()).includes('x86_64'),'Architecture suffix belongs in diagnostics');
          assert((await dialog.locator('.xm-device-inspector h3').innerText()).includes('D17RJR9'),'Inspector must name the selected machine');
          assert((await dialog.locator('.xm-device-identity p').innerText()).includes('Windows 11'),'Windows display version must be retained without the build');
          await dialog.locator('.xm-sharing-device-details summary').first().click();
          assert((await dialog.locator('.xm-sharing-device-details dd').first().innerText()).includes('<unsafe>'),'HWID must remain literal escaped text');
          assert((await dialog.locator('.xm-sharing-device-details').innerText()).includes('11_10.0.26200'),'Raw version remains available in diagnostics');
          await dialog.locator('.xm-sharing-device-details summary').first().click();
        }else assert(await dialog.locator('.xm-sharing-empty').isVisible());
        const bounds=await dialog.evaluate(d=>{const r=d.getBoundingClientRect(),sh=d.querySelector('.xm-sharing-shell').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,shellHeight:sh.height,scroll:d.querySelector('.xm-sharing-body').scrollWidth,client:d.querySelector('.xm-sharing-body').clientWidth}});
        assert(bounds.left>=0&&bounds.right<=width+1&&bounds.top>=0&&bounds.bottom<=height+1,'Device dialog must fit the viewport');
        assert(bounds.scroll<=bounds.client+1,'Device content must not overflow horizontally');
        assert(bounds.height<=bounds.shellHeight+5,
          'Native dialog must match its intrinsic content height, not stretch to the viewport');
        if(height>=650)assert(bounds.height<=Math.max(440,height*.78),
          'Device dialog must not leave an empty lower half at ordinary viewport heights');
        if(width>=1920)assert(bounds.width>=900,'Device workspace must not inherit the narrow generic action dialog');
        await screenshot(page,`devices-${width}-${count}-${limit}`);
        await dialog.locator('[data-device-tab=activity]').click();
        assert(await dialog.locator('#xm-activity-panel:not([hidden])').isVisible(),
          'Activity history must be shown in its own tab');
        assert.equal(await dialog.locator('.xm-activity-stat').count(),4,
          'Activity shows only factual metrics, never a risk score');
        assert.equal(await dialog.locator('.xm-sharing-score,.xm-assessment-meter').count(),0,
          'A device change must not imply a fabricated probability of sharing');
        assert((await dialog.locator('.xm-activity-note').innerText()).includes('сами по себе не подтверждают'),
          'Context must explain why these observations do not establish sharing');
        const activityBounds=await dialog.evaluate(d=>{
          const r=d.getBoundingClientRect(),sh=d.querySelector('.xm-sharing-shell').getBoundingClientRect();
          const body=d.querySelector('.xm-sharing-body'),last=d.querySelector('.xm-activity-note');
          const contentBottom=last?.getBoundingClientRect().bottom??0;
          const viewportBottom=body.getBoundingClientRect().bottom;
          return {
            height:r.height,shellHeight:sh.height,
            overflow:body.scrollWidth>body.clientWidth+1,
            bodyScrolls:body.scrollHeight>body.clientHeight+2,
            trailingGap:viewportBottom-contentBottom
          };
        });
        assert(activityBounds.height<=activityBounds.shellHeight+5,
          'Activity modal must hug its content instead of filling the screen');
        assert(!activityBounds.overflow,'Activity history must not overflow horizontally');
        if(!activityBounds.bodyScrolls)assert(activityBounds.trailingGap<=32,
          'Activity history must not leave unused space below its final content');
        if(width>=760&&height>=650)assert(activityBounds.height<=Math.max(440,height*.78),
          'Desktop activity history must not inherit an oversized dialog frame');
        if(count){
          await dialog.locator('[data-device-view-devices]').click();
          assert.equal(await dialog.locator('[data-device-tab=devices]').getAttribute('aria-selected'),'true',
            'Activity action must return to the device workspace');
          await dialog.locator('[data-device-tab=activity]').click();
        }
        await screenshot(page,`devices-activity-${width}-${count}-${limit}`);
        await page.keyboard.press('Escape');
        await page.locator(`#ut [data-sharing-detail="${user.id}"][data-sharing-focus="activity"]`).evaluate(el=>el.click());
        await dialog.locator('#xm-activity-panel:not([hidden])').waitFor();
        await dialog.locator('[data-device-tab=activity]').focus();await page.keyboard.press('ArrowLeft');
        assert.equal(await dialog.locator('[data-device-tab=devices]').getAttribute('aria-selected'),'true','Arrow keys must switch device tabs');
        if(count>1){
          await dialog.locator('[data-device-select="1001"]').click();
          assert((await dialog.locator('.xm-device-inspector').innerText()).includes(count===2?'FMFMPGO':'Phone 1'),'Selecting a device must update its inspector');
        }
        await dialog.locator('[data-device-limit-open]').click();
        await dialog.locator('[name=limit]').fill('3');
        await dialog.locator('.xm-device-limit-form .btn').click();
        await page.waitForFunction(()=>document.querySelector('[data-device-limit-open]')?.textContent.includes('3'));
        assert.deepEqual(patches.at(-1),{hwid:3});
        if(count){
          await dialog.locator('[data-device-remove]').click();
          await page.locator('.xm-action-confirm .gh').click();
          assert.equal(removals.length,0,'Cancel must not remove the binding');
          failNext=true;
          await dialog.locator('[data-device-remove]').click();
          await page.locator('.xm-action-confirm .dg').click();
          await dialog.locator('.xm-device-feedback').filter({hasText:'Device write temporarily unavailable'}).waitFor();
          assert.equal(await dialog.locator('.xm-sharing-device').count(),count,'Failed removal must preserve devices');
          await dialog.locator('[data-device-remove]').click();
          await page.locator('.xm-action-confirm .dg').click();
          await page.waitForFunction(expected=>document.querySelectorAll('.xm-sharing-device').length===expected,count-1);
          assert.deepEqual(snapshot.devices.map(d=>d.id),Array.from({length:count},(_,i)=>1000+i).filter(id=>id!==(count>1?1001:1000)),'Removal must keep every other device');
        }
        await page.keyboard.press('Escape');
        await page.locator(`tr[data-id="${user.id}"]`).click();
        await page.locator('[data-user-editor-tab=dev]').click();
        await page.locator('#dlg .xm-device-capacity').waitFor();
        await page.keyboard.press('Escape');await page.keyboard.press('Escape');
        if(width===1920&&count===2){
          await page.evaluate(()=>{sessionUser.role='viewer';XMeshI18n.setLanguage('en')});
          await page.locator(`#ut [data-sharing-detail="${user.id}"][data-sharing-focus="devices"]`).click();
          await dialog.locator('.xm-device-capacity').waitFor();
          assert(await dialog.locator('[data-device-limit-open]').isDisabled(),'Read-only viewer must not change the limit');
          assert.equal(await dialog.locator('[data-device-remove]').count(),0,'Read-only viewer must not remove bindings');
          assert.equal(await dialog.locator('h2').innerText(),'Devices & activity');
          await screenshot(page,'devices-viewer-english');
        }
        return bounds;
      }finally{
        if(await page.locator('#xm-sharing-dialog[open]').count())await page.keyboard.press('Escape');
        if(await page.locator('#dlg[open]').count())await page.keyboard.press('Escape');
        await page.evaluate(initial=>{sessionUser.role=initial.role;XMeshI18n.setLanguage(initial.language)},initial);
        await page.unroute(pattern);await page.unroute(mutation);await page.unroute(removeRoute);
      }
    });

    await checked('Device removal persists through the real subscription API',async()=>{
      await api('PATCH',`/collections/users/${user.id}`,{hwid:3});
      const subscription=await api('GET',`/users/${user.id}/subscription`);
      assert(subscription.token,'Test subscription must have a real public token');
      const feed=base+new URL(subscription.url,base).pathname+'?format=json';
      async function register(model){
        const response=await context.request.get(feed,{headers:{'x-hwid':require('node:crypto').randomUUID(),'x-device-os':'Windows','x-ver-os':'11','x-device-model':model,'User-Agent':'Happ/1.0'}});
        assert(response.ok(),'Public subscription must register the test HWID: HTTP '+response.status());
      }
      await register('Real device A');await register('Real device B');
      const before=(await api('GET',`/users/${user.id}/subscription`)).deviceLimit.devices;
      assert.equal(before.length,2,'Two real SQL-backed device slots must be registered');
      const removed=before.find(d=>d.model==='Real device A'),retained=before.find(d=>d.model==='Real device B');
      await navigate('users');await page.reload({waitUntil:'domcontentloaded'});
      // Open the older device directly from its preview. The device workspace
      // must preserve that identity rather than silently selecting the newest.
      await page.locator(`#ut tr[data-id="${user.id}"]`).click();
      await page.locator('[data-user-editor-tab=dev]').click();
      await page.locator('[data-user-editor-tab=ov]').click();
      await page.locator('[data-user-note]').fill('Keep this device draft');
      await page.locator('[data-user-editor-tab=dev]').click();
      await page.locator('#dlg .xm-sharing-device').first().waitFor();
      const previews=page.locator('#dlg .xm-sharing-device');
      assert.equal(await previews.count(),2);
      await previews.last().click();
      let dialog=page.locator('#dlg .user-inline-devices');
      await dialog.locator('.xm-device-capacity').waitFor();
      assert.equal(await dialog.locator('[data-device-select][aria-pressed="true"]').getAttribute('data-device-select'),String(removed.id),'Clicking a device preview must select that exact device, not the most recent one');
      // Register another device after the UI snapshot. Removing A must not
      // overwrite B or this newly registered C with a stale devices array.
      await register('Real device C');
      const third=(await api('GET',`/users/${user.id}/subscription`)).deviceLimit.devices.find(d=>d.model==='Real device C');
      await dialog.locator('[data-device-remove]').click();
      await page.locator('.xm-action-confirm .dg').click();
      await dialog.locator(`[data-device-select="${removed.id}"]`).waitFor({state:'detached'});
      const after=(await api('GET',`/users/${user.id}/subscription`)).deviceLimit.devices;
      assert.equal(await page.locator('[data-user-note]').inputValue(),'Keep this device draft','Removing a device must preserve the settings draft');
      assert.deepEqual(after.map(d=>d.id).sort(),[retained.id,third.id].sort(),'Real API must delete only the selected SQL row, retaining concurrent registrations');
      await page.keyboard.press('Escape');await page.reload({waitUntil:'domcontentloaded'});
      dialog=page.locator('#xm-sharing-dialog');
      await page.locator(`#ut [data-sharing-detail="${user.id}"][data-sharing-focus=devices]`).click();
      await dialog.locator(`[data-device-select="${retained.id}"]`).waitFor();
      assert.equal(await dialog.locator('.xm-sharing-device').count(),2,'Deletion must survive a full page reload');
      await page.keyboard.press('Escape');
      const crossUser=await context.request.post(base+`/api/v1/users/${otherUser.id}/subscription?deviceAction=remove&deviceId=${retained.id}`,{headers:{Origin:base}});
      assert.equal(crossUser.status(),404,'A device from another user must not be removed');
      for(const id of [retained.id,third.id])await api('POST',`/users/${user.id}/subscription?deviceAction=remove&deviceId=${id}`);
      await api('PATCH',`/collections/users/${user.id}`,{hwid:2});
      await page.reload({waitUntil:'domcontentloaded'});
    });

    await checked('Routing workspace: readable interactive gallery and contextual saving',async()=>{
      const original=await page.evaluate(()=>structuredClone(DB.set.clientRoutingProfiles||[]));
      try{
        await page.evaluate(id=>{DB.set.clientRoutingProfiles=[{id:'ui-route-main',name:'RU DIRECT',enabled:true,servers:['node:'+id],rules:[{match:'geosite',value:'category-ru',action:'direct'},{match:'geoip',value:'ru',action:'direct'},{match:'domain',value:'ads.example.invalid',action:'block',network:'udp'}]},{id:'ui-route-empty',name:'Draft routing',enabled:false,servers:[],rules:[]},{id:'ui-route-long',name:'Long values',enabled:true,servers:[],rules:[{match:'domain',value:'long-subdomain-'.repeat(12)+'.example.invalid',action:'proxy'}]}]},node.id);
        await page.evaluate(()=>DB.set.clientRoutingProfiles[2].rules.push(...[80,443,8080,8443].map(port=>({match:'port',value:String(port),action:'direct'}))));
        await navigate('clientrouting');
        for(const [width,height] of [[1920,1080],[1366,768],[768,1024],[390,844]]){
          await page.setViewportSize({width,height});
          await page.locator('[data-cr-profile="ui-route-main"]').waitFor();
          const compact=await page.locator('#client-route-root').evaluate(root=>{
            const rect=el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,mid:(r.top+r.bottom)/2}};
            const bar=root.querySelector('.crx-page-head'),title=bar.querySelector('.crx-toolbar-label');
            const count=bar.querySelector('[data-cr-counter]'),create=bar.querySelector('[data-cr-add]');
            const grid=root.querySelector('.crx-list'),cards=[...grid.querySelectorAll('[data-cr-profile]')];
            return{
              toolbar:rect(bar),heading:rect(title),create:rect(create),count:count.textContent.trim(),
              repeatedTitle:bar.querySelectorAll('h2').length,
              list:rect(grid),cards:cards.map(rect),
              rootWidth:rect(root).width,overflow:document.documentElement.scrollWidth>innerWidth+1
            };
          });
          assert.equal(compact.count,'3','Routing toolbar must show the real number of templates');
          assert.equal(compact.repeatedTitle,0,'Remove the oversized redundant Templates page heading');
          assert(compact.toolbar.height<90,'Routing controls should occupy one compact toolbar');
          assert(Math.abs(compact.heading.mid-compact.create.mid)<5,
            'Routing count and create action must stay on the same toolbar row');
          assert(compact.create.right<=compact.toolbar.right+1,
            'Create action must remain inside the toolbar frame');
          assert.equal(compact.cards.length,3,'All routing templates remain visible');
          if(width>=1366){
            const sameRow=compact.cards.filter(card=>Math.abs(card.top-compact.cards[0].top)<3);
            const rem=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize));
            assert(Math.abs(compact.cards[0].left-compact.list.left)<2,
              'Routing cards should start at the left edge of the workspace');
            for(let i=1;i<sameRow.length;i++){
              const gap=sameRow[i].left-sameRow[i-1].right;
              assert(gap>=0&&gap<=Math.max(2*rem,32),
                'Adjacent routing templates should have a small, consistent gap: '+gap+'px');
            }
            assert(sameRow.every(card=>card.width<=30*rem+2),
              'Routing cards should remain readable without stretching over the entire workspace');
          }
          if(width>=1920)assert(compact.cards[0].height<500,
            'Routing assignment and three ordered rules should not need a tall card');
          assert(!compact.overflow,'Compact routing gallery must not overflow the document');
          assert(await page.locator('[data-cr-bottom]').isHidden(),'Clean routing list must not show a disabled save bar');
          const g=await geometry(page);assert(g.scrollWidth<=width+1,'Populated routing rows must not overflow');
          assert.equal(g.outside.length,0,'Routing controls must stay inside the viewport');
          assert((await page.locator('.crx-assigned-source').innerText()).includes(node.name),'Assigned node name must be readable');
          assert.equal(await page.locator('[data-cr-profile="ui-route-main"] .crx-assigned-source img.crx-flag[src="/flags/pl.svg"]').count(),1,'Explicit Polish flag must override the Moscow fixture name');
          assert.equal(await page.locator('[data-cr-profile="ui-route-main"] .crx-assigned-source .crx-globe').count(),0,'Known Polish country must never fall back to the globe');
          if(width>=1920){const card=await page.locator('[data-cr-profile="ui-route-main"]').boundingBox();assert(card.width<900,'Routing cards must keep a readable width');assert(card.height<650,'Three rules and an assignment must remain compact');const scope=await page.locator('[data-cr-profile="ui-route-main"] .crx-card-flags').boundingBox();const rules=await page.locator('[data-cr-profile="ui-route-main"] .crx-card-rules').boundingBox();assert(rules.y>=scope.y+scope.height,'Assignments must precede ordered rules inside each card');}
          assert.equal(await page.locator('[data-cr-profile="ui-route-main"] .crx-rule-chip').count(),3,'All three rules must be visible in the overview');
          assert((await page.locator('[data-cr-profile="ui-route-main"] .crx-card-rules').innerText()).includes('ads.example.invalid'),'The third rule must not be silently omitted');
          await screenshot(page,'routing-list-'+width);
        }
        const galleryAppearance=await page.evaluate(()=>({surface:C.surface,theme:C.theme,language:XMeshI18n.getLanguage()}));
        try{
          for(const theme of ['dark','light'])for(const surface of ['solid','glass','raised']){
            await page.setViewportSize({width:1920,height:1080});
            await page.evaluate(({theme,surface})=>{C.theme=theme;C.surface=surface;apply()}, {theme,surface});
            const material=await page.locator('[data-cr-profile="ui-route-main"]').evaluate(el=>({backdrop:getComputedStyle(el).backdropFilter,shadow:getComputedStyle(el).boxShadow,radius:getComputedStyle(el).borderRadius}));
            if(surface==='glass')assert.notEqual(material.backdrop,'none','Routing Glass must inherit the shared backdrop material');
            assert.notEqual(material.radius,'0px','Routing cards must inherit global rounding');
            await screenshot(page,'routing-gallery-'+theme+'-'+surface);
          }
          await page.evaluate(async()=>{XMeshI18n.setLanguage('en');syncTopLanguage();await render(1)});
          await page.locator('[data-cr-profile="ui-route-main"]').waitFor();
          await page.waitForTimeout(150);
          const englishRules=await page.locator('[data-cr-profile="ui-route-main"] .crx-card-rules').innerText();assert(!/[А-Яа-яЁё]/u.test(englishRules),'Populated routing rules must be fully English: '+JSON.stringify(englishRules));
          assert((await page.locator('[data-cr-profile="ui-route-main"] .crx-card-stats').innerText()).includes('3 rules'),'Populated counters must use English plurals');
          await screenshot(page,'routing-gallery-english');
        }finally{
          await page.evaluate(initial=>{C.theme=initial.theme;C.surface=initial.surface;apply();XMeshI18n.setLanguage(initial.language);syncTopLanguage();render(1)},galleryAppearance);
          await page.locator('[data-cr-profile="ui-route-main"]').waitFor();
        }
        await page.locator('[data-cr-source-open="ui-route-main"]').click();
        assert(await page.locator('[data-cr-source="node:'+node.id+'"]').isChecked(),'Assignment click must open the assigned source');
        await page.keyboard.press('Escape');
        const toggle=page.locator('[data-cr-expand="ui-route-main"]');
        await toggle.focus();await page.keyboard.press('Enter');
        assert.equal(await toggle.getAttribute('aria-expanded'),'false');
        assert(await page.locator('[data-cr-details="ui-route-main"]').isHidden(),'Collapsing must hide details');
        assert(await page.locator('[data-cr-bottom]').isHidden(),'Disclosure must not change the draft');
        await page.keyboard.press('Space');
        assert.equal(await toggle.getAttribute('aria-expanded'),'true');
        await page.locator('[data-cr-rule-open="ui-route-main"][data-cr-rule-index="2"]').click();
        assert.equal(await page.locator('[data-cr-rule="2"] input[data-cr-field="value"]').inputValue(),'ads.example.invalid');
        assert(await page.locator('[data-cr-rule="2"] input[data-cr-field="value"]').evaluate(el=>el===document.activeElement),'Rule click must focus the selected rule');
        await page.keyboard.press('Escape');
        const more=page.locator('[data-cr-profile="ui-route-long"] .crx-more-rules');
        assert(await more.isVisible(),'Rules after the fourth must remain accessible');
        await more.locator('summary').click();
        assert((await more.innerText()).includes('8443'),'Expanding must reveal the final rule');
        await page.locator('[data-cr-open="ui-route-main"]').click();
        await page.locator('[data-cr-tab="rules"]').click();
        assert.equal(await page.locator('.crx-rule').count(),3,'Configure must retain existing rules');
        await page.keyboard.press('Escape');
        await page.locator('[data-cr-duplicate="ui-route-main"]').click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('[data-cr-profile]').count(),4,'Duplicate must still create a draft');
        assert(await page.locator('[data-cr-bottom]').isVisible(),'Unsaved changes must reveal save actions');
        await page.locator('[data-cr-reset]').click();
        assert.equal(await page.locator('[data-cr-profile]').count(),3,'Reset must restore saved templates');
        assert(await page.locator('[data-cr-bottom]').isHidden());
        const demo=await page.evaluate(id=>{const target=DB.nodes.find(n=>n.id===id);const previous={name:target.name,profiles:structuredClone(DB.set.clientRoutingProfiles)};target.name='Польша';DB.set.clientRoutingProfiles=[{...DB.set.clientRoutingProfiles[0],rules:DB.set.clientRoutingProfiles[0].rules.slice(0,2)}];return previous},node.id);
        try{
          await page.setViewportSize({width:1920,height:1080});await page.evaluate(()=>render(1));
          await page.locator('[data-cr-profile="ui-route-main"]').waitFor();
          const single=await page.locator('[data-cr-profile="ui-route-main"]').boundingBox();
          assert(single.width<900,'A single template must keep its readable card width');
          assert.equal(await page.locator('[data-cr-profile]').count(),1);
          assert.equal(await page.locator('.crx-assigned-source img.crx-flag[src="/flags/pl.svg"]').count(),1,'Polish assignment must retain its flag');
          await screenshot(page,'routing-single-template');
        }finally{await page.evaluate(({id,demo})=>{DB.nodes.find(n=>n.id===id).name=demo.name;DB.set.clientRoutingProfiles=demo.profiles},{id:node.id,demo})}
      }finally{
        if(await page.locator('dialog.crx-overlay[open]').count())await page.keyboard.press('Escape');
        await page.evaluate(value=>{DB.set.clientRoutingProfiles=value},original);
      }
    });

    await checked('Node operation spinners actually rotate and respect motion preferences',async()=>{
      await page.setViewportSize({width:1920,height:1080});
      await page.emulateMedia({reducedMotion:'no-preference'});
      await navigate('nodes');
      await page.locator('[data-node-grid-mode="compact"]').click();
      const previous=await page.evaluate(()=>document.documentElement.dataset.motion);
      const samples=[];
      try{
        for(const operation of ['agent','update','restart']){
          await page.evaluate(({id,operation})=>{
            document.documentElement.dataset.motion='on';
            nodeAgentUpdating.delete(id);nodeXrayUpdating.delete(id);nodeXrayRestarting.delete(id);
            updateNodeRuntimeBadges(DB.nodes.find(n=>Number(n.id)===id),null);
            if(operation==='agent'){nodeAgentUpdating.add(id);paintNodeAgentUpdate(id,true)}
            else{(operation==='update'?nodeXrayUpdating:nodeXrayRestarting).add(id);paintNodeXrayUpdate(id)}
          },{id:node.id,operation});
          const spinner=page.locator(`[data-node-card-id="${node.id}"] ${operation==='agent'?'[data-node-agent-version]':'[data-node-xray-version]'} .node-agent-spinner`);
          const sample=()=>spinner.evaluate(el=>({transform:getComputedStyle(el).transform,animations:el.getAnimations().map(a=>({state:a.playState,time:a.currentTime}))}));
          await spinner.waitFor();
          const first=await sample();await page.waitForTimeout(170);const second=await sample();
          assert(first.animations.some(a=>a.state==='running'),'Operation must have a real running CSS animation: '+operation);
          assert(second.animations[0].time>first.animations[0].time+70,'Animation timeline must advance: '+operation);
          assert.notEqual(first.transform,second.transform,'Spinner rotation matrix must change: '+operation);
          samples.push({operation,first,second});
          if(operation==='restart')for(let i=0;i<6;i++){
            const filename=`node-spinner-motion-${i}.png`;
            await page.locator(`[data-node-card-id="${node.id}"] > .h`).screenshot({path:path.join(output,filename),animations:'allow'});
            report.screenshots.push(filename);await page.waitForTimeout(120);
          }
          await page.evaluate(()=>{document.documentElement.dataset.motion='off'});
          assert.equal((await sample()).animations.length,0,'Panel motion-off must stop the spinner');
          await page.evaluate(()=>{document.documentElement.dataset.motion='on'});
          await page.emulateMedia({reducedMotion:'reduce'});
          assert.equal((await sample()).animations.length,0,'System reduced-motion must stop the spinner');
          await page.emulateMedia({reducedMotion:'no-preference'});
        }
      }finally{
        await page.evaluate(({id,previous})=>{
          nodeAgentUpdating.delete(id);nodeXrayUpdating.delete(id);nodeXrayRestarting.delete(id);
          if(previous===undefined)delete document.documentElement.dataset.motion;else document.documentElement.dataset.motion=previous;
        },{id:node.id,previous});
        await page.emulateMedia({reducedMotion:'reduce'});
        await navigate('users');await navigate('nodes');
        await page.locator('[data-node-grid-mode="standard"]').click();
      }
      return samples;
    });

    // Reference acceptance checks use the real renderer and live runtime refresh.
    for(const [width,height] of [[1920,1080],[2560,1440],[3440,1440]]) await checked(`Reference Nodes: ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});
      await navigate('nodes');
      await page.waitForFunction(()=>document.querySelector('[data-node-tls-status]')?.dataset.state);
      const g=await page.locator('.nodes > .nc').evaluate(card=>{
        const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
        const q=s=>card.querySelector(s),all=s=>[...card.querySelectorAll(s)];
        const shadowProbe=document.createElement('div');shadowProbe.style.boxShadow='var(--nx-panel-shadow)';card.append(shadowProbe);
        const sharedShadow=getComputedStyle(shadowProbe).boxShadow;shadowProbe.remove();
        const expectedIcon=name=>{const template=document.createElement('template');template.innerHTML=ic(name);return template.content.firstElementChild.innerHTML};
        const icons=['link','redo','dl','refresh-cw','globe','git-branch','pause','pen','server'];
        return {rem:parseFloat(getComputedStyle(document.documentElement).fontSize),mode:card.parentElement.dataset.gridMode,toolbar:box(document.querySelector('.nodes-toolbar')),card:box(card),container:box(card.parentElement),body:box(q('.node-body')),summary:box(q('.node-summary')),metrics:box(q('.node-metrics')),
          primary:all('.kvg>div').map(box),kpis:all('.ngauge').map(box),speed:box(q('.node-speed')),speedBar:box(q('.node-speed .pb')),actions:box(q('.acts')),buttons:all('.acts>button').map(box),
          iconMatches:all('.acts>button').map((button,i)=>button.querySelector('svg')?.innerHTML===expectedIcon(icons[i])),
          shield:q('[data-node-tls-status] svg')?.innerHTML===expectedIcon('shield'),hosting:q('.node-hosting svg')?.innerHTML===expectedIcon('building-2'),
          geoDot:!!q('.node-ip-rotation .node-ip-indicator')&&getComputedStyle(q('.node-ip-indicator')).backgroundColor,
          shadow:getComputedStyle(card).boxShadow,sharedShadow,divider:getComputedStyle(q('.node-summary')).borderRightWidth,
          primaryDivider:getComputedStyle(q('.kvg>div+div')).borderLeftWidth};
      });
      const cap={compact:40,standard:68,spacious:76}[g.mode]*g.rem;
      assert(Math.abs(g.card.width-Math.min(g.container.width,cap))<=2,'Single-node width must follow density cap');
      assert(Math.abs(g.card.x-g.container.x)<=2,'Bounded card must anchor to the left workspace edge');
      assert(Math.abs(g.card.x-g.toolbar.x)<=2,'Single card must align with the left filter-toolbar edge');
      assert(g.summary.x<g.metrics.x);
      assert(g.summary.width/g.body.width>=.35&&g.summary.width/g.body.width<=.45,'Summary must occupy 35–45%');
      assert(g.metrics.width/g.body.width>=.55&&g.metrics.width/g.body.width<=.65,'Telemetry must occupy 55–65%');
      assert(parseFloat(g.divider)>0&&parseFloat(g.primaryDivider)>0,'Both vertical dividers must be visible');
      assert(Math.abs(g.primary[0].y-g.primary[1].y)<=3,'Users and profile must start together');
      assert(Math.abs(g.primary[0].y-g.kpis[0].y)<=3,'Summary and KPI baseline differs');
      assert(Math.max(...g.kpis.map(r=>r.y))-Math.min(...g.kpis.map(r=>r.y))<=3,'KPI tops must align');
      assert(Math.max(...g.kpis.map(r=>r.height))-Math.min(...g.kpis.map(r=>r.height))<=3,'KPI heights must align');
      assert(g.speed.y>=g.kpis[0].bottom&&g.speed.width>=g.metrics.width*.85,'Speed must span telemetry below KPIs');
      assert(g.speedBar.width>=g.speed.width*.98&&g.speedBar.height>=4,'Speed rail must be visible and full width');
      assert.equal(g.buttons.length,9);
      for(const offset of [0,4]){
        const row=g.buttons.slice(offset,offset+4);
        assert(Math.max(...row.map(r=>r.y))-Math.min(...row.map(r=>r.y))<=3,'Four actions must share a row');
        assert(Math.max(...row.map(r=>r.width))-Math.min(...row.map(r=>r.width))<=3,'Action widths must match');
      }
      assert(g.buttons[4].y>g.buttons[0].y&&g.buttons[8].y>g.buttons[4].y,'Actions must form 4 + 4 + 1');
      assert(g.buttons[8].width>=g.actions.width*.98,'Create Host must span the action container');
      assert(g.shield&&g.hosting&&g.geoDot&&g.iconMatches.every(Boolean),'Semantic SVG icons/dot are missing or incorrect');
      assert.equal(g.shadow,g.sharedShadow,'Node card must use only the shared neutral shadow');
      await screenshot(page,`nodes-${width}x${height}`);
      return g;
    });

    for(const [width,height] of [[1920,1080],[2560,1440],[3440,1440],[390,844]]) await checked(`Square compact Node: ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});
      await navigate('nodes');
      await page.locator('[data-node-grid-mode="compact"]').click();
      await page.locator('.nc .fg img').first().evaluate(img=>img.decode());
      const g=await page.locator('.nc').first().evaluate(card=>{
        const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
        const flag=card.querySelector('.fg img');
        return{card:box(card),grid:box(card.parentElement),rem:parseFloat(getComputedStyle(document.documentElement).fontSize),summary:box(card.querySelector('.node-summary')),metrics:box(card.querySelector('.node-metrics')),kpis:[...card.querySelectorAll('.ngauge')].map(box),actions:box(card.querySelector('.acts')),buttons:[...card.querySelectorAll('.acts>button')].map(box),icons:card.querySelectorAll('.acts>button svg').length,shield:!!card.querySelector('[data-node-tls-status] svg'),overflow:document.documentElement.scrollWidth,flag:box(flag),flagFrame:box(flag.parentElement),identity:box(card.querySelector('.node-identity')),flagLoaded:flag.complete&&flag.naturalWidth>0,flagAlt:flag.alt};
      });
      assert(Math.abs(g.card.x-g.grid.x)<=2,'Square card must remain left-anchored');
      assert(g.card.width<=g.rem*40+1,'Compact card must stop at 40rem');
      assert(g.metrics.y>=g.summary.bottom,'Compact telemetry must follow the summary');
      assert.equal(g.buttons.length,9);assert.equal(g.icons,9);assert(g.shield,'Compact card must retain TLS icon');
      assert(g.overflow<=width+1,'Compact layout must not overflow the document');
      assert(g.flagLoaded&&g.flagAlt,'Node flag must retain its local SVG and accessible country name');
      assert(g.flag.width>=g.rem*2.7&&g.flag.height>=g.rem*1.9,'Node flag must be a prominent header accent');
      assert(g.flag.x>=g.flagFrame.x&&g.flag.right<=g.flagFrame.right+1&&g.flag.bottom<=g.flagFrame.bottom+1,'Flag must fit its wrapper');
      assert(g.flagFrame.right<g.identity.x,'Flag accent must not overlap the node identity');
      const flagChrome=await page.locator('.nc .fg').first().evaluate(el=>{const s=getComputedStyle(el);return{border:s.borderTopWidth,background:s.backgroundColor}});
      assert.equal(flagChrome.border,'0px','Country flag must not have a surrounding ring');
      assert.equal(flagChrome.background,'rgba(0, 0, 0, 0)','Country flag must not have a backplate');
      if(width>=1920){
        const aspect=g.card.width/g.card.height;
        assert(aspect>=.85&&aspect<=1.35,'Normal compact fixture must read as a near-square card: '+aspect);
        assert(Math.max(...g.kpis.map(r=>r.y))-Math.min(...g.kpis.map(r=>r.y))<=3,'Compact KPI tops must align');
        assert(Math.max(...g.kpis.map(r=>r.height))-Math.min(...g.kpis.map(r=>r.height))<=3,'Compact KPI heights must align');
        for(const offset of [0,4]){
          assert(g.buttons.slice(offset,offset+4).every(b=>Math.abs(b.y-g.buttons[offset].y)<=3),'Compact actions must keep four columns');
          assert(g.buttons.slice(offset,offset+4).every(b=>Math.abs(b.height-g.buttons[offset].height)<=3),'Compact action heights must align despite wrapped labels');
        }
        assert(g.buttons[8].width>=g.actions.width*.98,'Compact Create Host must span the action grid');
      }
      await screenshot(page,`nodes-square-${width}x${height}`);
      await page.locator('[data-node-grid-mode="standard"]').click();
      return g;
    });

    for(const [width,height] of [[1920,1080],[2560,1440],[3077,1182],[3440,1440]]) await checked(`Reference User Details: ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});
      await navigate('users');
      await page.locator(`tr[data-id="${user.id}"]`).click();
      await page.waitForSelector('dialog[open] .user-canvas');
      await page.waitForTimeout(150);
      const g=await page.locator('#dlg').evaluate(dialog=>{
        const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
        const q=s=>dialog.querySelector(s),body=q('.user-canvas-grid');
        return {dialog:box(dialog),header:box(q('.user-head')),footer:box(q('.user-canvas-foot')),body:box(body),scrollTop:body.scrollTop,scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,
          panes:[...body.children].map(box),headings:[...body.querySelectorAll('[data-active=true] .user-pane-heading:first-child')].map(box),
          controls:[...q('.user-head-actions').children].map(box),usage:box(q('.user-usage-line')),identity:box(q('.user-identity-row')),
          maxHeight:getComputedStyle(dialog).maxHeight,cssHeight:getComputedStyle(dialog).height,
          zoom:getComputedStyle(document.body).zoom,modalZoom:getComputedStyle(dialog).zoom,rem:parseFloat(getComputedStyle(document.documentElement).fontSize),
          paneScrolls:[...body.children].filter(p=>getComputedStyle(p).overflowY==='auto'||getComputedStyle(p).overflowY==='scroll').length};
      });
      assert.equal(g.scrollTop,0,'Body must start at top');
      assert(Math.max(...g.panes.map(r=>r.y))-Math.min(...g.panes.map(r=>r.y))<=4,'Task panels must share the same origin');
      assert(g.headings.every(r=>r.y>=g.body.y),'Initial headings must not be clipped');
      assert(g.dialog.y>=0&&g.dialog.bottom<=height+1&&g.dialog.height<=height-1.5*g.rem+1,'Dialog must fit the available viewport height');
      assert(g.header.y>=g.dialog.y&&g.footer.bottom<=height,'Header/footer must remain visible');
      assert(g.body.bottom<=g.footer.y+1,'Body must not overlap footer');
      const centers=g.controls.map(r=>r.y+r.height/2);
      assert(Math.max(...centers)-Math.min(...centers)<=3,'Header controls must share a vertical axis');
      assert(Math.abs(g.usage.y+g.usage.height/2-g.identity.y-g.identity.height/2)<=3,'Usage and Xray ID must align');
      assert.equal(g.paneScrolls,0,'Only the shared body may scroll');
      assert(g.clientHeight>0,'Fixed-size frame must retain a scrollable content region');
      assert(g.dialog.bottom-g.footer.bottom<=2*g.rem,'Dialog must not leave a large empty area below its footer');
      assert(g.dialog.width>=width*.52&&g.dialog.width<=width*.9,
        'User Details must be a proportionate desktop workspace, not a narrow island: '+JSON.stringify(g.dialog));
      assert(g.dialog.height>=height*.54&&g.dialog.height<=height*(width===3077?.91:.88),
        'User Details must occupy a balanced viewport height without clipping: '+JSON.stringify({box:g.dialog,css:g.cssHeight,rem:g.rem,zoom:g.modalZoom}));
      if(width===3077){
        assert(g.dialog.width>=width*.56&&g.dialog.width<=width*.64&&g.dialog.height>=height*.67,
          'Zoomed-out 2000×768 equivalent must be a proportionate, readable workspace: '+JSON.stringify({dialog:g.dialog,rem:g.rem,zoom:g.modalZoom}));
      }
      const layout=await page.locator('#dlg').evaluate(d=>{
        const b=s=>{const r=d.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}};
        const fields=[...d.querySelectorAll('.user-basic-card>.f')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,bottom:r.bottom}});
        return {basic:b('.user-basic-card'),connection:b('.user-connection-card'),note:b('.user-note-card'),fields};
      });
      assert(layout.connection.x>=layout.basic.right-2,'Connection controls must form the right-hand column');
      assert(Math.abs(layout.note.x-layout.basic.x)<=2&&layout.note.y>=layout.basic.bottom-2,
        'Administrator note must follow the basic data on the left');
      assert(layout.fields.length===4&&Math.abs(layout.fields[0].x-layout.fields[1].x)>8,
        'Basic user data must form two compact columns on desktop');
      const finalBasicField=Math.max(...layout.fields.map(field=>field.bottom));
      assert(layout.basic.bottom-finalBasicField<=2.4*g.rem*(Number(g.modalZoom)||1),
        'Basic card must end after its actual fields without stretching to Connection card');
      assert(layout.note.y-layout.basic.bottom<=3.6*g.rem*(Number(g.modalZoom)||1),
        'Tag relocation must eliminate the oversized empty gap beneath Basic Data');
      assert(layout.connection.bottom-layout.basic.bottom<=3.4*g.rem*(Number(g.modalZoom)||1),
        'Connection card must not have a whole extra field row compared with Basic Data');
      const composition=await page.locator('#dlg').evaluate(d=>{
        const rect=s=>{const r=d.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
        const connectionNames=['limit','cdnLimitGb','strategy'];
        const controls=connectionNames.map(name=>d.querySelector('.user-connection-card [name="'+name+'"]'));
        const fields=controls.slice(0,2).map(control=>{
          const el=control?.closest('.f');
          if(!el)return null;
          const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width};
        });
        return{
          body:rect('.user-canvas-grid'),
          basic:rect('.user-basic-card'),
          connection:rect('.user-connection-card'),
          note:rect('.user-note-card'),
          save:rect('.user-save-button'),
          actions:rect('.user-editor-actions'),
          fields,
          connectionControls:controls.map(Boolean),
          noteTag:!!d.querySelector('.user-note-card [name="tag"]'),
          noteField:rect('.user-note-card textarea'),
          labelFont:parseFloat(getComputedStyle(d.querySelector('.user-basic-card>.f>span')).fontSize),
          controlFont:parseFloat(getComputedStyle(d.querySelector('.user-basic-card input')).fontSize),
          rem:parseFloat(getComputedStyle(document.documentElement).fontSize)
        };
      });
      assert(composition.connectionControls.every(Boolean)&&composition.noteTag,
        'Connection must preserve limits and reset; Tag belongs beside Note in the compact metadata row');
      assert(composition.fields.every(Boolean)&&Math.abs(composition.fields[0].x-composition.fields[1].x)>8&&Math.abs(composition.fields[0].y-composition.fields[1].y)<=4,
        'Connection controls must use two columns rather than a long vertical rail');
      assert(Math.abs(composition.note.x-composition.basic.x)<=2&&Math.abs(composition.note.right-composition.connection.right)<=2,
        'Compact Note must occupy both columns instead of leaving a large empty right-side gap');
      assert(composition.note.y>=Math.max(composition.basic.bottom,composition.connection.bottom)-2,
        'Note must begin immediately below both form cards without overlapping');
      assert(composition.labelFont>=.85*composition.rem && composition.controlFont>=.875*composition.rem,
        'User details must not silently shrink labels and controls below Nexus reading sizes');
      if(width===3077){
        assert(composition.noteField.bottom<=composition.body.bottom+2,
          'The note input should be visible without scrolling at a 2000×768 zoomed-out desktop');
      }
      assert(Math.abs(composition.save.right-(composition.actions.x+composition.actions.width))<=4,
        'Save action must be right-aligned in the fixed User Details footer');
      if(width>=2200){
        const expectedZoom=width===3077?1.28:1.12;
        assert(Math.abs(Number(g.modalZoom)-expectedZoom)<.01,
          'Wide effective viewports must scale User Details text and controls with its shell');
        assert(Math.abs(composition.basic.width-composition.connection.width)<composition.connection.width*.25,
          'Settings cards must keep balanced proportions');
        assert(composition.body.width>=70*g.rem,'Zoomed-out desktop user drawer must not become a narrow island');
      }
      for(const key of ['acc','routing','traffic','dev','ov']){
        await page.locator(`[data-user-editor-tab="${key}"]`).click();
        const bounds=await page.locator('#dlg').boundingBox();
        assert(Math.abs(bounds.height-g.dialog.height)<=1&&Math.abs(bounds.y-g.dialog.y)<=1,'User task switching must not shift the dialog');
        assert.equal(await page.locator('[data-user-editor-pane][inert]').count(),4);
        if(key==='acc') assert.equal(await page.locator('.user-pane-access .user-heading-with-icon > svg.ic').count(),2,'Access and subscription must keep semantic Nexus icons');
        if(key==='traffic') assert.equal(await page.locator('.user-pane-insights .user-heading-with-icon > svg.ic').count(),1,'Traffic heading must use the shared SVG icon');
        if(key==='ov') assert.equal(await page.locator('.user-pane-settings .user-card-title > svg.ic').count(),3,'Settings cards must retain their semantic icons');
        await screenshot(page,`user-task-${key}-${width}`);
      }
      await screenshot(page,`user-details-${width}x${height}`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!document.querySelector('#dlg')?.open);
      return g;
    });

    await checked('User Details: tabs preserve and save one draft',async()=>{
      await page.setViewportSize({width:1440,height:900});await navigate('users');
      await page.locator(`tr[data-id="${otherUser.id}"]`).click();
      await page.locator('[data-user-note]').fill('User tab draft');
      const first=await page.locator('[data-user-note]').elementHandle();
      await page.locator('[data-user-editor-tab=acc]').click();
      await page.locator(`[data-hw="${otherUser.id}"]`).fill('-1');
      await page.locator('[data-user-editor-tab=traffic]').click();
      await page.locator('.user-save-button').click();
      assert.equal(await page.locator('[data-user-editor-tab=acc]').getAttribute('aria-selected'),'true');
      assert(await page.locator('#dlg #fe').isVisible(),'Validation must be visible outside its original panel');
      await page.locator(`[data-hw="${otherUser.id}"]`).fill('4');
      await page.locator(`[data-usq="${otherUser.id}:${squad.id}"]`).uncheck();
      assert.equal((await api('GET','/bootstrap')).collections.users.find(u=>u.id===otherUser.id).hwid,2,'Switching panels must not persist a draft');
      await page.locator('[data-user-editor-tab=acc]').press('End');
      assert.equal(await page.locator('[data-user-editor-tab=dev]').getAttribute('aria-selected'),'true');
      await page.locator('[data-user-editor-tab=dev]').press('Home');
      assert.equal(await first.inputValue(),'User tab draft','Tab switches must preserve the original form DOM');
      await page.locator('[data-user-editor-tab=traffic]').click();
      const quotaEditor=page.locator('[data-user-node-quotas]');
      const quotaRow=quotaEditor.locator('[data-node-quota-row="'+node.id+'"]');
      await quotaRow.waitFor({state:'visible'});
      assert.equal(await quotaEditor.locator('[data-node-quota-save]').count(),0,
        'No separate save action is allowed for per-node quotas');
      await quotaRow.locator('[data-node-quota-limit]').fill('-1');
      await page.locator('.user-save-button').click();
      assert.equal(await page.locator('[data-user-editor-tab=traffic]').getAttribute('aria-selected'),'true',
        'Invalid quota must keep the Traffic tab selected');
      assert(await page.locator('#dlg #fe').isVisible(),'Quota validation must show an error');
      await quotaRow.locator('[data-node-quota-limit]').fill('5');
      assert.deepEqual(
        await quotaRow.locator('[data-node-quota-period] option').evaluateAll(
          options=>options.map(option=>option.value)),
        ['daily','weekly','monthly','lifetime'],
        'Existing users should have all four per-node periods'
      );
      await quotaRow.locator('[data-node-quota-period]').selectOption('weekly');
      assert.match(await page.locator('[data-user-edit-dirty]').innerText(),/несохранённые|Unsaved/i,
        'Editing quotas must flag unsaved user changes');
      const saved=page.waitForResponse(r=>r.url().endsWith(`/collections/users/${otherUser.id}`)&&r.request().method()==='PATCH');
      await page.locator('.user-save-button').click();
      const response=await saved;
      assert(response.ok());
      const patch=JSON.parse(response.request().postData()||'{}');
      assert.deepEqual(patch.nodeTrafficLimits[String(node.id)],{limitGb:5,period:'weekly'},
        'The one user Save must submit the changed quota alongside other settings');
      assert.equal(patch.nodeQuotaUsedBytes,undefined,'Never send server-owned counters');
      await page.waitForFunction(()=>!document.querySelector('#dlg')?.open);
      const result=(await api('GET','/bootstrap')).collections.users.find(u=>u.id===otherUser.id);
      assert.equal(result.desc,'User tab draft');assert.equal(result.hwid,4);assert.deepEqual(result.squads,[]);
      assert.deepEqual(result.nodeTrafficLimits[String(node.id)],{limitGb:5,period:'weekly'});
      await api('PATCH',`/collections/users/${otherUser.id}`,{desc:'',hwid:2,squads:[squad.id],nodeTrafficLimits:{}});
    });

    await checked('User Details: viewer can navigate every read-only tab',async()=>{
      await page.setViewportSize({width:1440,height:900});await navigate('users');
      await page.evaluate(()=>{sessionUser.role='viewer';document.documentElement.dataset.accessRole='viewer'});
      try{
        await page.locator(`tr[data-id="${user.id}"]`).click();
        for(const key of ['ov','acc','routing','traffic','dev']){
          const tab=page.locator(`[data-user-editor-tab="${key}"]`);
          assert(await tab.isEnabled());await tab.click();
          assert.equal(await tab.getAttribute('aria-selected'),'true');
        }
        assert(!(await page.locator('.user-save-button').isVisible()));
        assert(await page.locator(`[data-hw="${user.id}"]`).isDisabled());
        assert.equal(await page.locator('.user-id-value').count(),0,'Viewer credentials must remain masked');
      }finally{await page.keyboard.press('Escape');await page.evaluate(()=>{sessionUser.role='owner';document.documentElement.dataset.accessRole='owner'})}
    });

    await checked('User Details: scroll resets when reopening another user',async()=>{
      await page.setViewportSize({width:1920,height:500});
      await navigate('users');
      await page.locator(`tr[data-id="${user.id}"]`).click();
      await page.waitForSelector('dialog[open] .user-canvas-grid');
      const scrolled=await page.locator('.user-canvas-grid').evaluate(body=>{body.scrollTop=body.scrollHeight;return body.scrollTop});
      assert(scrolled>0,'Fixture must exercise actual body scrolling');
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!document.querySelector('#dlg')?.open);
      await page.locator(`tr[data-id="${otherUser.id}"]`).click();
      await page.waitForSelector('dialog[open] .user-canvas-grid');
      await page.waitForTimeout(150);
      assert.equal(await page.locator('.user-canvas-grid').evaluate(body=>body.scrollTop),0);
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!document.querySelector('#dlg')?.open);
    });

    for(const [width,height] of [[390,844],[768,1024]]) await checked(`User Details responsive tabs: ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});
      await navigate('users');
      await page.locator(`tr[data-id="${user.id}"]`).click();
      await page.waitForSelector('dialog[open] .user-canvas-grid');
      const g=await page.locator('#dlg').evaluate(dialog=>{
        const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height}};
        const body=dialog.querySelector('.user-canvas-grid');
        return {dialog:box(dialog),panes:[...body.children].map(box),scrollTop:body.scrollTop,scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,footer:box(dialog.querySelector('.user-canvas-foot'))};
      });
      assert(g.dialog.y>=0&&g.dialog.bottom<=height+1&&g.dialog.right<=width+1,'Mobile dialog must fit viewport');
      const rem=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize));
      assert(g.dialog.height<=Math.min(38.5*rem,height-rem)+3,
        'Mobile User Details frame must be compact and viewport-clamped: '+JSON.stringify({actual:g.dialog.height,limit:Math.min(38.5*rem,height-rem),rem}));
      assert.equal(g.scrollTop,0);
      assert.equal(g.panes.length,5,'All task panels must stay mounted');
      assert.equal(await page.locator('[data-user-editor-pane][data-active=true]').count(),1);
      assert.equal(await page.locator('[data-user-editor-pane][inert]').count(),4);
      for(const key of ['acc','routing','traffic','dev','ov']){
        await page.locator(`[data-user-editor-tab="${key}"]`).click();
        assert(await page.locator(`[data-user-editor-pane="${key}"]`).isVisible());
        const bounds=await page.locator('#dlg').boundingBox();
        assert(bounds.x>=0&&bounds.x+bounds.width<=width+1,'Task switch must fit narrow viewport');
        assert(Math.abs(bounds.height-g.dialog.height)<=1,'Tasks must retain the same frame height');
      }
      assert(g.footer.bottom<=height+1,'Mobile footer must stay visible');
      await page.screenshot({path:path.join(output,`user-details-${width}x${height}.png`),fullPage:false,animations:'disabled'});
      report.screenshots.push(`user-details-${width}x${height}.png`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!document.querySelector('#dlg')?.open);
      return g;
    });

    await checked('Topbar: переключатель языка сохраняет внутреннюю геометрию',async()=>{
      await page.setViewportSize({width:1366,height:768});
      await navigate('admins');
      const geometry=await page.locator('#language-trigger').evaluate(button=>{
        const box=node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
        return{outer:box(button),children:[...button.children].map(box)};
      });
      assert(geometry.outer.width>=70,'Переключатель языка снова сжат до квадратной icon-button ширины.');
      assert.equal(geometry.children.length,3,'Переключатель языка должен содержать иконку, метку и стрелку.');
      for(const child of geometry.children){
        assert(child.left>=geometry.outer.left-1&&child.right<=geometry.outer.right+1&&child.top>=geometry.outer.top-1&&child.bottom<=geometry.outer.bottom+1,'Содержимое переключателя языка выходит за границы кнопки.');
      }
      return geometry;
    });

    await checked('Настройки: 100% масштаб и ширина 3000 px работают буквально',async()=>{
      await page.setViewportSize({width:3840,height:2160});
      await navigate('set/layout');
      const rootFont=parseFloat(await page.locator('html').evaluate(el=>getComputedStyle(el).fontSize));
      assert(rootFont>=17.9&&rootFont<=18.1,`100% должен давать комфортный базовый размер около 18px, получено ${rootFont}px.`);
      const widthSlider=page.locator('#content-width');
      await widthSlider.evaluate(el=>{el.value='3000';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});
      await page.waitForTimeout(80);
      const widthState=await page.evaluate(()=>({value:Number(document.querySelector('#content-width')?.value),view:document.querySelector('#view')?.getBoundingClientRect().width||0,token:getComputedStyle(document.documentElement).getPropertyValue('--panel-content-max').trim()}));
      assert.equal(widthState.value,3000,'Ползунок ширины не принимает 3000 px.');
      assert(widthState.view>=2995,`Рабочая область всё ещё зажата скрытым cap: ${widthState.view}px.`);
      assert.equal(widthState.token,'3000px','Runtime token ширины не достиг 3000px.');
      await widthSlider.evaluate(el=>{el.value='1920';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});
      return widthState;
    });

    await checked('Настройки: точное числовое поле имеет одну рамку',async()=>{
      await page.setViewportSize({width:1920,height:1080});
      await navigate('set/layout');
      const chrome=await page.locator('#content-width-value').evaluate(input=>{
        const own=getComputedStyle(input),outer=getComputedStyle(input.parentElement);
        return{border:own.borderTopWidth,background:own.backgroundColor,shadow:own.boxShadow,outerBorder:outer.borderTopWidth};
      });
      assert.equal(chrome.border,'0px','Внутренний number input снова рисует собственную рамку.');
      assert.equal(chrome.shadow,'none','Внутренний number input снова рисует собственную тень.');
      assert(['rgba(0, 0, 0, 0)','transparent'].includes(chrome.background),'Внутренний number input должен быть прозрачным.');
      assert(parseFloat(chrome.outerBorder)>0,'Внешний precision-control потерял единственную рабочую рамку.');
      return chrome;
    });

    const setScale=async value=>{
      await navigate('set/typography');
      await page.locator('#ts').evaluate((el,next)=>{el.value=String(next);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))},value);
      await page.waitForTimeout(100);
    };
    await checked('Масштаб 130%: карточка пользователя не перекрывает содержимое footer',async()=>{
      await page.setViewportSize({width:1920,height:1080});
      await setScale(1.3);
      await navigate('users');
      await page.locator(`tr[data-id="${user.id}"]`).click();
      await page.waitForSelector('dialog[open] .user-canvas');
      const state=await page.locator('dialog[open] .user-canvas').evaluate(canvas=>{
        const box=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
        const grid=canvas.querySelector('.user-canvas-grid'),foot=canvas.querySelector('.user-canvas-foot');
        const visible=node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
        const outside=[...canvas.querySelectorAll('button,input,select,textarea')].filter(visible).map(box).filter(r=>r.x<canvas.getBoundingClientRect().x-1||r.right>canvas.getBoundingClientRect().right+1);
        return{viewport:{width:innerWidth,height:innerHeight},canvas:box(canvas),grid:box(grid),foot:box(foot),outside,gridClientHeight:grid.clientHeight,gridScrollHeight:grid.scrollHeight};
      });
      assert(state.canvas.x>=0&&state.canvas.right<=state.viewport.width+1&&state.canvas.y>=0&&state.canvas.bottom<=state.viewport.height+1,'User drawer выходит за viewport при 130%.');
      assert(state.grid.height>160,'Scrollable body карточки пользователя схлопнулся при 130%.');
      assert(state.grid.bottom<=state.foot.y+1,'Footer перекрывает центральное содержимое карточки пользователя.');
      assert.equal(state.outside.length,0,'Контролы карточки пользователя выходят за drawer при 130%.');
      await screenshot(page,'dialog-user-130-percent');
      await page.keyboard.press('Escape');
      await page.waitForSelector('dialog[open]',{state:'detached'});
      await setScale(1);
      return state;
    });

    await checked('User Intelligence: вкладки имеют полноценную рабочую область',async()=>{
      await page.setViewportSize({width:1920,height:1080});
      await navigate('users');
      await page.locator(`tr[data-id="${user.id}"]`).click();
      await page.waitForSelector('dialog[open] .user-canvas');
      await page.locator(`[data-open-user-traffic="${user.id}"]`).click();
      await page.waitForSelector('#stats-user-modal[open]');
      const shell=await page.locator('#stats-user-modal[open]').evaluate(dialog=>{const r=dialog.getBoundingClientRect(),w=dialog.querySelector('.stats-user-workspace')?.getBoundingClientRect();return{width:r.width,height:r.height,workspaceHeight:w?.height||0,workspaceWidth:w?.width||0}});
      assert(shell.width>=1400,`User Intelligence снова превратился в узкое окно: ${shell.width}px.`);
      assert(shell.workspaceHeight>=280,`Рабочая область User Intelligence схлопнулась: ${shell.workspaceHeight}px.`);
      for(const name of ['history','inbounds','observations']){
        await page.locator(`[data-stats-user-tab="${name}"]`).click();
        await page.waitForFunction(tab=>{const pane=document.querySelector(`[data-stats-user-pane="${tab}"]`);return pane&&!pane.hidden&&pane.getBoundingClientRect().height>0},name);
        const pane=await page.locator(`[data-stats-user-pane="${name}"]`).evaluate(el=>{const r=el.getBoundingClientRect();return{width:r.width,height:r.height,scrollHeight:el.scrollHeight,hidden:el.hidden}});
        assert(!pane.hidden&&pane.height>=180,`Вкладка ${name} не получила видимую рабочую область: ${JSON.stringify(pane)}.`);
      }
      // Regression: a native showModal() makes body-mounted dropdown options
      // inert. Verify actual pointer selection inside the modal on both panes.
      await page.waitForFunction(()=>!!document.querySelector('#stats-user-overview strong'));
      await page.evaluate(({tag,nodeId,nodeName})=>{
        for(const [id,value,label] of [
          ['stats-history-inbound',tag,tag],
          ['stats-history-node',String(nodeId),nodeName]
        ]){
          const select=document.getElementById(id);
          if(![...select.options].some(option=>option.value===value)){
            select.add(new Option(label,value));
            select._xmRefresh?.();
          }
        }
      },{tag:inboundTag,nodeId:node.id,nodeName:node.name});
      const chooseStatsFilter=async(id,value,apiPart,param)=>{
        const control=page.locator('#stats-user-modal #'+id);
        const trigger=page.locator('#stats-user-modal label:has(#'+id+') .xm-period-trigger');
        await trigger.click();
        const menu=page.locator('#stats-user-modal .xm-period-menu:not([hidden])');
        await menu.waitFor({state:'visible'});
        assert(await menu.evaluate(element=>element.closest('dialog')?.id==='stats-user-modal'),
          'Statistics select options must live inside the active native dialog, not inert body');
        const placement=await page.evaluate(id=>{
          const trigger=document.querySelector('#stats-user-modal label:has(#'+id+') .xm-period-trigger');
          const menu=document.querySelector('#stats-user-modal .xm-period-menu:not([hidden])');
          const a=trigger.getBoundingClientRect(),b=menu.getBoundingClientRect();
          return {left:b.left,top:b.top,bottom:b.bottom,width:b.width,
            anchorLeft:a.left,anchorTop:a.top,anchorBottom:a.bottom,anchorWidth:a.width,
            xError:Math.abs(b.left-a.left),widthError:Math.abs(b.width-a.width),
            below:Math.abs(b.top-a.bottom-5)<4,above:Math.abs(a.top-b.bottom-5)<4};
        },id);
        assert(placement.xError<4&&placement.widthError<4&&(placement.below||placement.above),
          'Selector '+id+' detached from its field: '+JSON.stringify(placement));
        const option=menu.locator('.xm-period-option[data-value="'+value+'"]');
        const requested=page.waitForRequest(request=>{
          const url=new URL(request.url());
          return url.pathname.includes('/users/'+user.id+'/traffic/'+apiPart) &&
            (value?url.searchParams.get(param)===value:!url.searchParams.has(param)) &&
            request.method()==='GET';
        });
        await option.click();
        await requested;
        assert.equal(await control.inputValue(),value,'Select must actually update '+id);
        assert.equal(await trigger.getAttribute('aria-expanded'),'false','Menu must close after selection');
      };
      await page.locator('[data-stats-user-tab="inbounds"]').click();
      await chooseStatsFilter('stats-history-inbound',inboundTag,'history','inboundTag');
      await chooseStatsFilter('stats-history-node',String(node.id),'history','nodeId');
      await chooseStatsFilter('stats-history-range','7d','history','range');
      await page.locator('[data-stats-user-tab="observations"]').click();
      await chooseStatsFilter('stats-history-inbound','', 'observations','inboundTag');
      await chooseStatsFilter('stats-history-node','', 'observations','nodeId');
      await chooseStatsFilter('stats-history-range','1h','observations','range');
      await chooseStatsFilter('stats-history-inbound',inboundTag,'observations','inboundTag');
      await chooseStatsFilter('stats-history-node',String(node.id),'observations','nodeId');
      await chooseStatsFilter('stats-history-range','24h','observations','range');
      await page.locator('[data-stats-user-tab="history"]').click();
      // Same native dialog at narrower viewports. Test all three dropdown
      // types without relying on screenshots or API traffic.
      for(const width of [1280,1440]){
        await page.setViewportSize({width,height:900});
        for(const id of ['stats-history-inbound','stats-history-node','stats-history-range']){
          const trigger=page.locator('#stats-user-modal label:has(#'+id+') .xm-period-trigger');
          await trigger.click();
          const menu=page.locator('#stats-user-modal .xm-period-menu:not([hidden])');
          await menu.waitFor({state:'visible'});
          const placement=await page.evaluate(id=>{
            const a=document.querySelector('#stats-user-modal label:has(#'+id+') .xm-period-trigger').getBoundingClientRect();
            const b=document.querySelector('#stats-user-modal .xm-period-menu:not([hidden])').getBoundingClientRect();
            return {dx:Math.abs(a.left-b.left),dw:Math.abs(a.width-b.width),below:Math.abs(a.bottom+5-b.top),above:Math.abs(a.top-5-b.bottom)};
          },id);
          assert(placement.dx<4&&placement.dw<4&&Math.min(placement.below,placement.above)<4,
            'Selector '+id+' has escaped its field at '+width+'px: '+JSON.stringify(placement));
          await trigger.click();
        }
      }
      await page.setViewportSize({width:1920,height:1080});
      await screenshot(page,'dialog-user-intelligence-history');
      // A nested horizontal table wrapper used to compute overflow-y:auto,
      // trap wheel events and prevent the outer history pane from scrolling.
      // Scroll by an actual mouse wheel event OVER a dense table, not by
      // assigning scrollTop in script (which would miss the regression).
      const wheelFixture=await page.locator('#stats-user-modal [data-stats-user-pane="history"]').evaluate(pane=>{
        const wrap=document.createElement('div');
        wrap.className='stats-bucket-table-wrap stats-wheel-fixture';
        wrap.innerHTML='<table><tbody>'+Array.from({length:64},(_,i)=>'<tr><td>Scroll fixture '+i+'</td><td>1 KB</td></tr>').join('')+'</tbody></table>';
        pane.prepend(wrap);
        pane.scrollTop=0;
        return {parentHeight:pane.clientHeight,parentScrollHeight:pane.scrollHeight,wrapperOverflowY:getComputedStyle(wrap).overflowY};
      });
      assert(wheelFixture.parentScrollHeight>wheelFixture.parentHeight+200,
        'User Intelligence wheel fixture must overflow the history pane');
      assert.equal(wheelFixture.wrapperOverflowY,'visible',
        'Table wrapper must not claim vertical scroll ownership or trap the mouse wheel');
      const wheelBox=await page.locator('#stats-user-modal .stats-wheel-fixture').boundingBox();
      assert(wheelBox&&wheelBox.height>30,'Wheel fixture must have a hit-testable table surface');
      await page.mouse.move(wheelBox.x+Math.min(wheelBox.width/2,90),wheelBox.y+28);
      await page.mouse.wheel(0,350);
      await page.waitForFunction(()=>document.querySelector('#stats-user-modal [data-stats-user-pane="history"]').scrollTop>10);
      await page.locator('#stats-user-modal [data-stats-user-pane="history"]').evaluate(pane=>{
        pane.querySelector('.stats-wheel-fixture')?.remove();
        pane.scrollTop=0;
      });
      await page.locator('#stats-user-close').click();
      await page.waitForFunction(()=>!document.querySelector('#stats-user-modal')?.open);
      if(await page.locator('dialog#dlg[open]').count()){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#dlg')?.open)}
      return shell;
    });

    await page.setViewportSize({width:1920,height:1080});
    const appearances = [
      ['dark','solid','standard','comfortable','emerald'],
      ['light','glass','compact','compact','ocean'],
      ['auto','raised','standard','spacious','violet'],
      ['dark','glass','compact','comfortable','amber'],
      ['light','solid','standard','comfortable','rose'],
      ['dark','raised','compact','compact','emerald'],
    ];
    for (const [theme,surface,sidebar,density,accent] of appearances) await checked(`Оформление: ${theme}/${surface}/${sidebar}/${density}`, async () => {
      await navigate('set/colors');
      await page.locator(`[data-th="${theme}"]`).click();
      await navigate('set/layout');
      for (const [key,value] of [['surface',surface],['sidebar',sidebar],['density',density]]) await page.locator(`[data-ui="${key}"][data-value="${value}"]`).click();
      await navigate('set/colors');
      const palette=page.locator(`[data-ac="${accent}"]`);
      assert.equal(await palette.count(),1, `Палитра ${accent} отсутствует.`);
      await palette.click();
      for (const route of ['set','nodes','users','profiles']) {
        await navigate(route);
        const g=await geometry(page);
        assert.equal(g.material.surface,surface);
        if(surface==='raised'&&route==='set'){
          const material=await page.locator('.appearance-layout .card').first().evaluate(el=>{
            const style=getComputedStyle(el);
            return{image:style.backgroundImage,shadow:style.boxShadow};
          });
          assert.equal(material.image,'none','Raised surfaces must not have a bright gradient sheen');
          assert.notEqual(material.shadow,'none','Raised cards must retain subtle depth');
        }
        assert.equal(g.material.sidebar,sidebar);
        assert.equal(g.material.density,density);
        assert.equal(g.material.theme,theme === 'auto' ? 'light' : theme);
        assert(g.scrollWidth<=1921, 'Изменение оформления вызвало горизонтальную прокрутку.');
        assert.equal(g.outside.length,0,'Изменение оформления обрезало элементы управления.');
        if (route==='set' || route==='nodes') await screenshot(page,`${route}-${theme}-${surface}-${sidebar}`);
      }
    });

    await navigate('set/layout');
    for (const [key,value] of [['surface','solid'],['sidebar','standard'],['density','comfortable']]) await page.locator(`[data-ui="${key}"][data-value="${value}"]`).click();
    await navigate('set/colors');
    await page.locator('[data-th="dark"]').click();
    for(const [width,height] of [[1920,1080],[768,1024],[390,844]]) for(const route of ['balancers','clientrouting']) await checked(`Populated editor audit: ${route} · ${width}`,async()=>{
      await page.setViewportSize({width,height});
      await navigate(route);
      await page.locator(route==='balancers'?'#balancer-add':'[data-cr-add]').first().click();
      if(route==='clientrouting') await page.waitForSelector('dialog[open]');
      const g=await geometry(page);
      assert(g.scrollWidth<=width+1,'Editor must not overflow the document');
      if(g.dialog)assert(g.dialog.x>=0&&g.dialog.right<=width+1,'Editor dialog must fit horizontally');
      if(route==='clientrouting'&&width===390){
        const body=await page.locator('.crx-dialog-body').boundingBox();
        assert(body.height>=height*.3,'Routing workspace must retain at least 30% of mobile viewport height');
      }
      await screenshot(page,`audit-editor-${route}-${width}`);
      if(route==='clientrouting')await page.keyboard.press('Escape');
      return g;
    });

    await checked('Settings: long update feedback stays inside mobile workspace',async()=>{
      await page.setViewportSize({width:390,height:844});
      await navigate('set/system');
      await page.locator('#core-message').evaluate(el=>{el.textContent='Update request failed: https://example.invalid/releases/'+('abcdef0123456789'.repeat(40))});
      const g=await geometry(page);
      assert(g.scrollWidth<=391,'Long updater feedback must wrap without expanding the document');
      await navigate('set/integrations');
      const hooks=await page.locator('[data-hk]').evaluateAll(inputs=>inputs.map(input=>{
        const row=input.closest('.rowi'),text=row.firstElementChild.getBoundingClientRect(),toggle=input.closest('.sw').getBoundingClientRect();
        return {name:input.dataset.hk,textRight:text.right,toggleLeft:toggle.left,wrapped:row.firstElementChild.scrollWidth<=row.firstElementChild.clientWidth+1};
      }));
      assert(hooks.every(h=>h.wrapped&&h.textRight< h.toggleLeft),'Webhook names must wrap before their switches: '+JSON.stringify(hooks));
      await screenshot(page,'audit-settings-long-feedback-390');
      return g;
    });

    for(const [width,height,scale] of [[1366,768,1],[1920,768,1],[1920,1080,1],[2560,1440,1],[4096,1582,.5],[390,844,1]]){
      await page.setViewportSize({width,height});
      const zoom=scale===1?null:await context.newCDPSession(page);
      if(zoom)await zoom.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});
      try{
        for(const edit of [false,true])await checked(`Node editor single surface: ${edit?'edit':'create'} ${width}×${height} scale ${scale}`,async()=>{
          await navigate('nodes');
          await page.locator(edit?`[data-ne="nodes:${node.id}"]`:'[data-ne="nodes"]').first().click();
          await page.waitForSelector('#dlg.node-wide[open]');
          try{
            const g=await page.locator('#dlg').evaluate(d=>{
              const f=d.querySelector('form.box'),r=d.getBoundingClientRect(),b=f.getBoundingClientRect(),s=getComputedStyle(f),layout=f.querySelector('.node-form-layout').getBoundingClientRect(),footer=f.querySelector('.act').getBoundingClientRect();
              return {bodyScroll:f.querySelector('.node-form-layout').scrollHeight,bodyClient:f.querySelector('.node-form-layout').clientHeight,layoutBottom:layout.bottom,footerTop:footer.top,dialog:{top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height},form:{top:b.top,bottom:b.bottom,height:b.height,scrollHeight:f.scrollHeight,clientHeight:f.clientHeight},tlsInSide:!!f.querySelector('.node-network-stack > .node-tls-settings'),background:s.backgroundColor,shadow:s.boxShadow,border:parseFloat(s.borderTopWidth),overflow:getComputedStyle(d).overflowY};
            });
            assert(Math.abs(g.dialog.bottom-g.form.bottom)<=2,'Node dialog must end with the form, without an empty material tail');
            assert(Math.abs(g.form.top-g.dialog.top)<=2,'Node dialog must not reserve an empty surface above the form');
            assert.equal(g.background,'rgba(0, 0, 0, 0)','Form must not render a second material surface');
            assert.equal(g.shadow,'none');
            assert.equal(g.border,0,'Only the dialog owns the outer edge');
            assert(g.dialog.top>=0&&g.dialog.bottom<=height+1&&g.dialog.left>=0&&g.dialog.right<=width+1,'Node editor must fit the viewport');
            assert.equal(g.overflow,'hidden','Native shell must not gain a second scrollbar');
            assert(g.tlsInSide,'TLS summary must be adjacent to connection fields');
            if(width>=1366&&height>=768&&scale===1){
              assert(g.form.scrollHeight<=g.form.clientHeight+2,'Desktop Node editor must have no scrollbar: '+JSON.stringify(g));
              assert(g.bodyScroll<=g.bodyClient+2,'Desktop connection fields must fit without hidden inner scrolling: '+JSON.stringify(g));
              assert(g.layoutBottom<=g.footerTop+1,'Footer must not cover the final Node fields: '+JSON.stringify(g));
              const inline=page.locator('#dlg [data-node-tls-inline]');
              assert(await inline.isVisible(),'Certificate setup must be expanded on opening, without a click');
              assert.equal(await page.locator('#dlg dialog').count(),0,'Certificate setup must not create a second dialog');
              const radioBox=await inline.locator('[name="nodeTlsMethod"]').first().boundingBox();
              assert(radioBox&&radioBox.width<=24&&radioBox.height<=24,'TLS radio must retain its native size');
              await screenshot(page,`node-tls-inline-${edit?'edit':'create'}-${width}x${height}`);
            }
            await screenshot(page,`node-editor-${edit?'edit':'create'}-${width}-${scale===1?'normal':'zoom-out'}`);
            return g;
          }finally{
            await page.keyboard.press('Escape');
            await page.waitForSelector('dialog[open]',{state:'detached'});
          }
        });
      }finally{
        if(zoom){await zoom.send('Emulation.clearDeviceMetricsOverride');await zoom.detach()}
      }
    }

    for(const [width,height] of [[1366,768],[390,844]])await checked(`Node editor task tabs: ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});await navigate('nodes');
      await page.locator(`[data-ne="nodes:${node.id}"]`).first().click();
      const form=page.locator('#dlg form[data-ent="nodes"]');
      try{
        const frame=()=>form.evaluate(f=>['#dlg','.node-editor-heading','.node-editor-tabs','.act'].map(selector=>{
          const r=(selector==='#dlg'?f.closest(selector):f.querySelector(selector)).getBoundingClientRect();
          return{selector,x:r.x,y:r.y,width:r.width,height:r.height};
        }));
        const originalFrame=await frame();
        await form.locator('[name="hosting"]').fill('Unsaved hosting');
        for(const key of ['traffic','network','billing','connection']){
          await form.locator(`[data-node-editor-tab="${key}"]`).click();
          const currentFrame=await frame();
          for(let i=0;i<originalFrame.length;i++)for(const axis of ['x','y','width','height'])assert(Math.abs(currentFrame[i][axis]-originalFrame[i][axis])<=.1,'Task switch must not resize or move '+originalFrame[i].selector+' '+axis+': '+JSON.stringify({originalFrame,currentFrame}));
          const scrolling=await form.evaluate(f=>{
            const body=f.querySelector('.node-form-layout'),active=f.querySelector('[data-node-editor-pane][data-active="true"]'),style=getComputedStyle(body);
            return{height:body.clientHeight,scroll:body.scrollHeight,content:active.getBoundingClientRect().height+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)};
          });
          assert(scrolling.scroll<=Math.max(scrolling.height,scrolling.content)+2,'Inactive tasks must not leave an empty scroll tail: '+JSON.stringify(scrolling));
          const inactive=form.locator('[data-node-editor-pane][data-active="false"]');
          assert.equal(await inactive.count(),3);
          assert(await inactive.evaluateAll(panes=>panes.every(p=>p.inert&&p.getAttribute('aria-hidden')==='true')),'Inactive tasks must not expose controls to focus/accessibility');
          if(width>=1366&&key!=='connection'){
            const workspace=await form.locator(`[data-node-editor-pane="${key}"] .node-task-workspace`).evaluate(el=>{
              const a=el.firstElementChild.getBoundingClientRect(),b=el.lastElementChild.getBoundingClientRect();
              return{left:a.left,right:a.right,aside:b.left,width:b.width};
            });
            assert(workspace.right<workspace.aside&&workspace.width>=200,'Desktop tasks must use two readable columns');
          }
          if(key==='traffic'){
            const mode=form.locator('[name="cdnMode"]');
            const bypass=form.locator('[data-node-cdn-kind="bypass"]');
            const standard=form.locator('[data-node-cdn-kind="standard"]');
            assert.equal(await mode.inputValue(),'standard','New nodes start as ordinary servers');
            await bypass.click();
            assert.equal(await mode.inputValue(),'all','Bypass option must meter the entire node');
            assert.equal(await bypass.getAttribute('aria-pressed'),'true');
            const scope=form.locator('[data-node-cdn-scope]');
            await scope.check();
            assert.equal(await mode.inputValue(),'selected','Advanced selection must reuse existing selected policy');
            assert(await form.locator('[data-node-cdn-inbounds]').isVisible(),'Selected inbound controls must appear');
            await scope.uncheck();
            assert.equal(await mode.inputValue(),'all','Leaving advanced selection must restore entire-node mode');
            assert(await form.locator('[data-node-cdn-inbounds]').isHidden());
            await standard.click();
            assert.equal(await mode.inputValue(),'standard','Ordinary servers must retain unlimited bypass quota');
            assert.equal(await standard.getAttribute('aria-pressed'),'true');
            assert(await form.locator('[data-node-cdn-inbounds]').isHidden());
          }
          if(key==='network'){
            await form.locator('[name="rotationIps"]').fill('192.0.2.10\n192.0.2.10\n192.0.2.11');
            await form.locator('[data-node-pool-normalize]').click();
            assert.equal((await form.locator('[name="rotationIps"]').inputValue()).trim(),'192.0.2.10\n192.0.2.11');
          }
          if(key==='billing'){
            const currency=form.locator('.xm-select-shell:has([name="billingCurrency"])');
            assert.equal(await currency.count(),1,'Billing currency must use the shared themed selector after activation');
            await currency.locator('.xm-select-trigger').click();
            await page.locator('.xm-select-popover:visible [role="option"]').filter({hasText:'USD'}).click();
            assert.equal(await form.locator('[name="billingCurrency"]').inputValue(),'USD','The themed currency selector must update the saved form value');
            await form.locator('[data-node-date-open]').click();
            await form.locator('[data-node-date-calendar] [data-user-date-today]').click();
            assert((await form.locator('[name="billingDueDate"]').inputValue()).length>0,'Billing calendar must remain usable in its tab');
          }
          assert.equal(await form.locator('[role="tab"][aria-selected="true"]').count(),1);
          assert.equal(await form.locator('[data-node-editor-pane]:visible').count(),1);
          const g=await geometry(page);assert(g.scrollWidth<=width+1,'Task panel must fit viewport');
          await screenshot(page,`node-task-${key}-${width}`);
        }
        assert.equal(await form.locator('[name="hosting"]').inputValue(),'Unsaved hosting','Switching tasks must preserve draft inputs');
        const first=form.locator('[data-node-editor-tab="connection"]');
        await first.focus();await page.keyboard.press('ArrowRight');
        assert.equal(await form.locator('[data-node-editor-tab="traffic"]').getAttribute('aria-selected'),'true');
        await page.keyboard.press('End');
        assert.equal(await form.locator('[data-node-editor-tab="billing"]').getAttribute('aria-selected'),'true');
        await form.locator('[name="billingPrice"]').fill('-1');
        await form.locator('[data-node-editor-tab="connection"]').click();
        await form.locator('.act .btn').click();
        assert.equal(await form.locator('[data-node-editor-tab="billing"]').getAttribute('aria-selected'),'true','Native validation must reveal the invalid field panel');
        await form.locator('[name="billingPrice"]').fill('0');
        await form.locator('[data-node-editor-tab="connection"]').click();
        const tls=form.locator('[data-node-tls-inline]');
        assert(await tls.isVisible(),'TLS controls must be permanently expanded in connection settings');
        await tls.locator('[name="nodeTlsMethod"][value="acme"]').check();
        await tls.locator('[name="tlsDomain"]').fill('node.example.invalid');
        await tls.locator('[name="tlsAcmeEmail"]').fill('ops@example.com');
        if(width>=1366){
          const bounds=await form.evaluate(f=>{const body=f.querySelector('.node-form-layout'),tls=f.querySelector('[data-node-tls-inline]').getBoundingClientRect(),footer=f.querySelector('.act').getBoundingClientRect();return{scroll:body.scrollHeight,client:body.clientHeight,tlsBottom:tls.bottom,footerTop:footer.top}});
          assert(bounds.scroll<=bounds.client+2,'Expanded ACME settings must fit desktop without inner scrolling: '+JSON.stringify(bounds));
          assert(bounds.tlsBottom<=bounds.footerTop+1,'Save actions must not cover inline certificate fields');
        }
        await screenshot(page,`node-tls-acme-${width}`);
        await tls.locator('[name="nodeTlsMethod"][value="external"]').check();
        assert(await tls.locator('[data-node-tls-external]').isVisible());
        assert(!(await tls.locator('[data-node-tls-acme]').isVisible()));
        await screenshot(page,`node-tls-external-${width}`);
      }finally{await page.keyboard.press('Escape')}
    });

    await checked('Node editor appearance and global radius',async()=>{
      await page.setViewportSize({width:1366,height:900});await navigate('nodes');
      await page.locator(`[data-ne="nodes:${node.id}"]`).first().click();
      const initial=await page.evaluate(()=>({theme:C.theme,surface:C.surface,radius:C.radius}));
      try{
        for(const theme of ['dark','light'])for(const surface of ['solid','glass','raised']){
          await page.evaluate(v=>{Object.assign(C,v);apply()},{theme,surface});
          await screenshot(page,`node-workspace-${theme}-${surface}`);
        }
        const modal=page.locator('[data-node-tls-inline]');
        await modal.locator('[name="nodeTlsMethod"][value="acme"]').check();
        for(const radius of [1,36]){
          await page.evaluate(radius=>{C.radius=radius;apply()},radius);
          const rounded=await modal.locator('.node-tls-method-option').first().evaluate(el=>getComputedStyle(el).borderTopLeftRadius);
          assert.equal(rounded,radius+'px','Certificate choices must inherit the global control radius');
        }
        await modal.locator('[name="tlsDomain"]').fill('node.example.invalid');
        await modal.locator('[name="tlsAcmeEmail"]').fill('ops@example.com');
        await screenshot(page,'node-tls-light-glass');
      }finally{
        await page.keyboard.press('Escape');
        await page.evaluate(v=>{Object.assign(C,v);apply()},initial);
      }
    });

    const dialogs=[
      ['nodes','[data-ne="nodes"]','Создание узла'],
      ['nodes',`[data-ne="nodes:${node.id}"]`,'Редактирование узла'],
      ['hosts','[data-ne="hosts"]','Создание хоста'],
      ['squads','[data-ne="squads"]','Создание сквада'],
      ['users','[data-nu]','Создание пользователя'],
      ['users',`tr[data-id="${user.id}"]`,'Просмотр пользователя'],
      ['templates','[data-ne="tpls"]','Шаблон пользователя'],
      ['admins','[data-ne="admins"]','Создание администратора'],
    ];
    for (const [width,height] of [[1366,768],[1920,1080]]) {
      await page.setViewportSize({width,height});
      for (const [route,selector,label] of dialogs) await checked(`${label}: ${width}×${height}`,async()=>{
        // Native dialogs stay in the top layer across same-document hash navigation.
        // Close stale test fixtures before clicking, otherwise one failure cascades
        // into unrelated 30-second click timeouts.
        await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close()));
        try {
        await navigate(route);
        await page.locator(selector).first().click();
        await page.waitForSelector('dialog[open]');
        if(route==='squads'){
          const search=await page.locator('dialog[open] form[data-ent="squads"] [data-squad-inbound-search]').evaluate(input=>{const s=getComputedStyle(input),r=input.getBoundingClientRect(),p=input.closest('.search').getBoundingClientRect();return {border:parseFloat(s.borderTopWidth),shadow:s.boxShadow,height:r.height,parentHeight:p.height}});
          assert.equal(search.border,0,'Composite search must not render a second input border');
          assert.equal(search.shadow,'none','Composite search must not render a nested input shadow');
          assert(search.height<=search.parentHeight,'Search input must fit its control shell');
        }
        const g=await geometry(page);
        assert(g.dialog.x>=-1 && g.dialog.y>=-1 && g.dialog.right<=width+1 && g.dialog.bottom<=height+1,'Диалог выходит за viewport.');
        assert.equal(g.outside.length,0,'Элементы диалога обрезаны по горизонтали.');
        const footerLoc=page.locator('dialog[open] > form.box > .act, dialog[open] > .box > .act, dialog[open] .user-create-footer, dialog[open] .user-canvas-foot');
        const footer=(await footerLoc.count())?await footerLoc.last().boundingBox():null;
        if(footer)assert(footer.y>=0&&footer.y+footer.height<=height+1,'Кнопки footer находятся за пределами viewport.');
        await screenshot(page,`dialog-${route}-${label.includes('Редактирование')?'edit':label.includes('Просмотр')?'drawer':'create'}-${width}`);
        return g;
        } finally {
          // A failed assertion must not leave a native modal blocking the next case.
          await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close()));
          await page.waitForSelector('dialog[open]',{state:'detached'});
        }
      });
    }

    // A large node catalog must not expand the native dialog beyond the viewport.
    // Only the center content scrolls; title, close and submit stay actionable.
    for(const [width,height] of [[390,680],[768,768],[1366,640],[1366,768],[1920,768],[2560,900],[3440,900],[3440,1440]]){
      await checked('Create-user viewport clipping and fixed actions: '+width+'×'+height,async()=>{
        await page.setViewportSize({width,height});
        await navigate('users');
        await page.locator('[data-nu]').first().click();
        const dialog=page.locator('#dlg.user-create-modal[open]');
        await dialog.waitFor({state:'visible'});
        try{
          const g=await dialog.evaluate(root=>{
            const bounds=selector=>{
              const node=selector==='self'?root:root.querySelector(selector);
              if(!node)return null;
              const r=node.getBoundingClientRect();
              return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height};
            };
            const body=root.querySelector('.user-create-body');
            return{
              viewport:{width:innerWidth,height:innerHeight},
              dialog:bounds('self'),head:bounds('.user-create-head'),
              body:bounds('.user-create-body'),footer:bounds('.user-create-footer'),
              close:bounds('.user-create-close'),submit:bounds('.user-create-submit'),
              bodyClient:body.clientHeight,bodyScroll:body.scrollHeight,
              overflow:getComputedStyle(body).overflowY
            };
          });
          const fits=b=>b&&b.top>=-1&&b.bottom<=g.viewport.height+1&&b.left>=-1&&b.right<=g.viewport.width+1;
          for(const part of ['dialog','head','body','footer','close','submit']){
            assert(fits(g[part]),part+' is outside the create-user viewport: '+JSON.stringify(g));
          }
          assert(g.head.bottom<=g.body.top+2,'Header must not be pushed behind the body');
          assert(g.body.bottom<=g.footer.top+2,'Scrollable body must not cover the footer');
          assert.equal(g.overflow,'auto','Only the creation body may scroll vertically');
          if(width>=1100&&height<=820){
            const rows=await dialog.locator('[data-user-create-quota-row]').first().evaluate(card=>{
              const a=card.querySelector('.user-create-quota-identity').getBoundingClientRect();
              const b=card.querySelector('.user-create-quota-controls').getBoundingClientRect();
              return{identityRight:a.right,controlsLeft:b.left,
                inputWidth:card.querySelector('[data-user-create-quota-limit]').getBoundingClientRect().width,
                selectWidth:card.querySelector('[data-user-create-quota-period]').getBoundingClientRect().width};
            });
            assert(rows.identityRight<=rows.controlsLeft+1,
              'Quota identity and inputs must fit side by side without overlap: '+JSON.stringify(rows));
            assert(rows.inputWidth>=55&&rows.selectWidth>=85,'Quota controls must remain readable');
          }

          assert(g.bodyClient>0,'Scrollable creation body must retain useful height');
          // The creation form contains a quota workspace even before entering a value.
          assert.equal(await dialog.locator('[data-user-create-node-quotas]').count(),1);
          await dialog.locator('.user-create-body').evaluate(body=>{body.scrollTop=body.scrollHeight});
          const controls=await dialog.evaluate(root=>{
            const rect=el=>el.getBoundingClientRect();
            const rootBounds=rect(root);
            const head=rect(root.querySelector('.user-create-head'));
            const footer=rect(root.querySelector('.user-create-footer'));
            return {headerVisible:head.top>=rootBounds.top-1,footerVisible:footer.bottom<=rootBounds.bottom+1};
          });
          assert(controls.headerVisible&&controls.footerVisible,'Header and footer must remain fixed while contents scroll');
        }finally{
          await page.keyboard.press('Escape');
          await page.waitForSelector('dialog[open]',{state:'detached'});
        }
      });
    }

    // The create-user metadata section must adapt to the *section* width,
    // including browser zoom and a long list of squad names. It may scroll
    // vertically within the chips box, never horizontally across other fields.
    for(const [width,height] of [[390,844],[768,1024],[1366,768],[1920,1080],[2560,1440],[3440,1440]]) await checked(`Create user metadata layout: ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});
      await navigate('users');
      await page.locator('[data-nu]').first().click();
      await page.waitForSelector('dialog#dlg.user-create-modal[open] .user-create-extra-grid');
      try{
        // Approved premium create-user design: readable typography, adequate
        // hit targets and balanced desktop cards at real browser widths.
        const design=await page.locator('#dlg.user-create-modal').evaluate(dialog=>{
          const bounds=selector=>{
            const el=dialog.querySelector(selector);
            if(!el)return null;
            const b=el.getBoundingClientRect();
            return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};
          };
          const font=selector=>{
            const el=dialog.querySelector(selector);
            return el?Number.parseFloat(getComputedStyle(el).fontSize):0;
          };
          return {
            dialog:bounds('form.user-create-dialog'),
            titleFont:font('.user-create-head h2'),
            labelFont:font('.user-create-username>span'),
            fieldHeight:bounds('input[name="username"]')?.height||0,
            identity:bounds('.user-create-section-main'),
            limits:bounds('.user-create-section-limits'),
            metadata:bounds('.user-create-section-extra'),
            footer:bounds('.user-create-footer'),
            zoomScale:Number.parseFloat(getComputedStyle(dialog).getPropertyValue('--uc'))||16,
            inputFont:font('input[name="limit"]'),
            sectionHeadingFont:font('.user-create-section-head h3'),
            sectionHelpFont:font('.user-create-section-head p'),
            rootFont:parseFloat(getComputedStyle(document.documentElement).fontSize),
            formToken:getComputedStyle(dialog).getPropertyValue('--nx-user-form-label-size').trim(),
            metadataLayout:getComputedStyle(dialog.querySelector('.user-create-extra-grid')).gridTemplateAreas
          };
        });
        assert(design.titleFont>=22,'Create-user modal title must be clearly readable');
        assert(design.labelFont>=.85*design.rootFont,'Create-user labels must match the User Details label scale');
        assert(design.formToken.length>0,'Create and edit must share the same Nexus user-form tokens');
        assert(design.sectionHeadingFont>=.95*design.rootFont&&design.sectionHelpFont>=.75*design.rootFont,
          'Create-user section headings and descriptions must match User Details reading sizes');
        assert(design.fieldHeight>=42,'Form controls must be comfortable to click');
        if(width>=2200){
          assert(design.zoomScale<=20.1,'Wide user creation dialog must have a bounded design scale');
          assert(design.fieldHeight<=62,'Wide dialog must not enlarge form fields excessively');
          assert(design.inputFont<=20.1,'Wide dialog input type must remain balanced with the other panel controls');
        }
        assert(design.dialog.width<=width+2,'Create-user modal must fit viewport width');
        if(width>=941){
          assert(design.identity.right<design.limits.left+2,'Identity and limits must be side by side');
          assert(Math.abs(design.identity.top-design.limits.top)<2,'Top cards must share a baseline');
          assert(Math.abs(design.identity.bottom-design.limits.bottom)<3,'Top cards must have matching heights');
          if(width>=1200)assert(design.metadataLayout.includes('squads tag hold desc'),
            'Desktop metadata must form one compact row like the User Details Tag / Note strip');
          assert(design.metadata.top>=design.identity.bottom-2,'Metadata card must be below the top cards');
        }else{
          assert(design.identity.bottom<=design.limits.top+2,'Narrow layout must stack sections without overlap');
        }
        assert(design.footer.height>=44,'Create/cancel footer must remain accessible');
        const quotas=page.locator('#dlg.user-create-modal [data-user-create-node-quotas]');
        assert.equal(await quotas.isVisible(),true,'Quota panel must be visible with no additional click');
        const quotaGrid=await quotas.evaluate(section=>{
          const list=section.querySelector('.user-create-node-quota-list');
          return {items:list.querySelectorAll('[data-user-create-quota-row]').length,
            columns:getComputedStyle(list).gridTemplateColumns.split(' ').length,
            width:section.getBoundingClientRect().width,
            overflow:list.scrollWidth-list.clientWidth};
        });
        assert(quotaGrid.items>0,'Quota cards must show existing nodes');
        assert(quotaGrid.overflow<=2,'Quota cards must not scroll horizontally');
        if(quotaGrid.width>=760)assert.equal(quotaGrid.columns,2,'Wide dialog uses two quota columns');
        else assert.equal(quotaGrid.columns,1,'Narrow dialog uses one quota column');
        const bypassLimit=page.locator('#dlg.user-create-modal input[name="cdnLimitGb"]');
        assert(await bypassLimit.isVisible(),'Bypass traffic limit must be present when creating a user');
        await bypassLimit.fill('5');
        assert.equal(await bypassLimit.inputValue(),'5','Separate user bypass quota must accept a custom value');
        const squads=page.locator('.user-create-squads .ms');
        await squads.evaluate(list=>{
          const first=list.querySelector('label.ck');
          if(!first)return;
          for(let i=0;i<10;i++){
            const item=first.cloneNode(true);
            item.querySelector('input').value='layout-test-'+i;
            item.querySelector('input').checked=false;
            item.querySelector('span').textContent='Очень длинное название сквада '+i+' с несколькими словами';
            list.append(item);
          }
        });
        const note=page.locator('.user-create-desc textarea');
        await note.fill('Комментарий для администраторов и дополнительная информация '.repeat(12));
        const hold=page.locator('.user-create-hold input[name="hold"]');
        await hold.check();
        assert(await hold.isChecked(),'On-hold toggle must remain interactive');
        const geo=await page.locator('.user-create-extra-grid').evaluate(grid=>{
          const rect=el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}};
          const section=grid.closest('.user-create-section-extra');
          const squads=grid.querySelector('.user-create-squads .ms');
          const note=grid.querySelector('.user-create-desc textarea');
          return{
            grid:rect(grid),section:rect(section),fields:[...grid.children].map(el=>({className:el.className,...rect(el)})),
            sectionWidth:section.clientWidth,sectionScroll:section.scrollWidth,
            gridWidth:grid.clientWidth,gridScroll:grid.scrollWidth,
            squadsWidth:squads.clientWidth,squadsScroll:squads.scrollWidth,
            squadsHeight:squads.clientHeight,squadsScrollHeight:squads.scrollHeight,
            noteWidth:note.clientWidth,noteScroll:note.scrollWidth,
            holdWidth:grid.querySelector('.user-create-hold .sw').getBoundingClientRect().width
          };
        });
        assert(geo.grid.width>0&&geo.section.width>0,'Metadata section must have real width');
        assert(geo.sectionScroll<=geo.sectionWidth+2,`Metadata section overflows: ${JSON.stringify(geo)}`);
        assert(geo.gridScroll<=geo.gridWidth+2,`Metadata grid overflows: ${JSON.stringify(geo)}`);
        assert(geo.squadsScroll<=geo.squadsWidth+2,'Squad chips must only scroll vertically');
        assert(geo.noteScroll<=geo.noteWidth+2,'Note must wrap instead of scrolling horizontally');
        assert(geo.holdWidth>=120,'On-hold row must not collapse');
        for(const field of geo.fields){
          assert(field.left>=geo.grid.left-2&&field.right<=geo.grid.right+2,
            `Metadata control escapes grid: ${JSON.stringify(field)}`);
        }
        await screenshot(page,`user-create-metadata-${width}x${height}`);
      }finally{
        await page.keyboard.press('Escape');
        await page.waitForSelector('dialog[open]',{state:'detached'});
      }
    });

    // At zoomed-out desktop sizes the complete default form should fit.
    // Previously the empty validation paragraph and generous vertical rhythm
    // created a small scroll range at otherwise sufficiently tall desktops.

    // Unlike the outer width, type and controls must follow Nexus tokens,
    // not the large CSS viewport produced by zooming out.
    for(const width of [1920,2560,3440])await checked(`Create-user shared design scale: ${width}×1200`,async()=>{
      await page.setViewportSize({width,height:1200});
      await navigate('users');
      await page.locator('[data-nu]').first().click();
      const dialog=page.locator('#dlg.user-create-modal[open]');
      await dialog.waitFor({state:'visible'});
      try{
        const g=await dialog.evaluate(root=>{
          const f=s=>parseFloat(getComputedStyle(root.querySelector(s)).fontSize);
          const input=root.querySelector('input[name="limit"]');
          return{
            root:parseFloat(getComputedStyle(document.documentElement).fontSize),
            zoom:Number.parseFloat(getComputedStyle(root).zoom)||1,
            title:f('.user-create-head h2'),section:f('.user-create-section-head h3'),
            label:f('.user-create-limit>span'),hint:f('.user-create-limit>small'),
            input:parseFloat(getComputedStyle(input).fontSize),
            height:input.getBoundingClientRect().height,
            mainWidth:root.querySelector('.user-create-section-main').getBoundingClientRect().width,
            limitsWidth:root.querySelector('.user-create-section-limits').getBoundingClientRect().width
          };
        });
        assert(g.title<=g.root*1.3+1,'Modal title must match shared typography');
        assert(g.section<=g.root*1.1+1,'Section title must match panel card typography');
        assert(g.label<=g.root*.83+1&&g.hint<=g.root*.75+1,'Field copy must use Nexus text tokens');
        assert(g.input>=g.label*.94&&g.input<=g.label*1.24+1,
          'Input typography must stay proportionate to the shared form label, including browser zoom: '+JSON.stringify(g));
        assert(g.height<=Math.max(42,g.root*2.85)*g.zoom+2,
          'Input height must follow Nexus control tokens after whole-dialog zoom: '+JSON.stringify(g));
        assert(g.mainWidth/g.limitsWidth>.88&&g.mainWidth/g.limitsWidth<1.15,
          'Create and edit must share balanced two-column cards, not a dominant rail: '+JSON.stringify(g));
        return g;
      }finally{
        await page.keyboard.press('Escape');
        await page.waitForSelector('dialog[open]',{state:'detached'});
      }
    });

    // Calendar must remain readable when browser zoom increases CSS viewport
    // dimensions; date rows should be dense without microscopic type.
    for(const [width,height] of [[390,844],[1920,1080],[3200,1280]])await checked(`Create-user duration calendar density: ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});
      await navigate('users');
      await page.locator('[data-nu]').first().click();
      const dialog=page.locator('#dlg.user-create-modal[open]');
      await dialog.waitFor({state:'visible'});
      try{
        await dialog.locator('[data-user-create-duration-open]').click();
        const calendar=dialog.locator('[data-user-create-duration-calendar]');
        await calendar.waitFor({state:'visible'});
        const metrics=await calendar.evaluate(panel=>{
          const font=selector=>Number.parseFloat(getComputedStyle(panel.querySelector(selector)).fontSize);
          const grid=panel.querySelector('.user-create-cal-grid');
          const day=panel.querySelector('.user-create-cal-day');
          const box=panel.getBoundingClientRect();
          return {
            width:box.width,left:box.left,right:box.right,
            position:getComputedStyle(panel).position,
            monthFont:font('.user-create-cal-head strong'),
            weekdayFont:font('.user-create-cal-weekdays span'),
            dayFont:font('.user-create-cal-day'),
            presetFont:font('.user-create-duration-preset'),
            dayHeight:day.getBoundingClientRect().height,
            gap:parseFloat(getComputedStyle(grid).rowGap),
            weekCount:panel.querySelectorAll('.user-create-cal-weekdays span').length,
            dayCount:panel.querySelectorAll('.user-create-cal-day').length,
            viewportWidth:innerWidth
          };
        });
        assert(metrics.weekCount===7&&metrics.dayCount>=28&&metrics.dayCount<=31,
          'Calendar must render all weekdays and valid month dates');
        assert(metrics.monthFont>=14&&metrics.weekdayFont>=11&&metrics.dayFont>=13&&metrics.presetFont>=11,
          `Calendar labels and dates must be legible: ${JSON.stringify(metrics)}`);
        assert(metrics.dayHeight/metrics.dayFont<=2.5&&metrics.gap<=4,
          `Calendar row spacing must be proportional to its text: ${JSON.stringify(metrics)}`);
        assert(metrics.left>=-1&&metrics.right<=metrics.viewportWidth+1,
          `Calendar must stay within viewport: ${JSON.stringify(metrics)}`);
        if(width>=2200)assert(metrics.width>=425,'Wide desktop calendar must not be a narrow miniature');
        if(width<=680)assert(metrics.position==='static','Mobile calendar must stay in normal document flow');
        const first=await calendar.getAttribute('data-month');
        await calendar.locator('[data-user-create-calendar-nav="1"]').click();
        assert.notEqual(await calendar.getAttribute('data-month'),first,'Month navigation must remain functional');
        await calendar.locator('[data-user-create-days-preset="30"]').click();
        assert.equal(await dialog.locator('input[name="days"]').inputValue(),'30',
          'Duration presets must continue using the existing integer-day contract');
        assert(await calendar.isHidden(),'Selecting a duration must close the calendar');
        return metrics;
      }finally{
        await page.keyboard.press('Escape');
        await page.waitForSelector('dialog[open]',{state:'detached'});
      }
    });

    for(const [width,height] of [[2925,1250],[3200,1280]]) await checked(`Create-user desktop micro-scroll: ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});
      await navigate('users');
      await page.locator('[data-nu]').first().click();
      const dialog=page.locator('#dlg.user-create-modal[open]');
      await dialog.waitFor({state:'visible'});
      try{
        const metrics=await dialog.evaluate(root=>{
          const body=root.querySelector('.user-create-body');
          const error=root.querySelector('.user-create-error');
          const extra=root.querySelector('.user-create-section-extra');
          const bodyRect=body.getBoundingClientRect();
          const extraRect=extra.getBoundingClientRect();
          return {
            overflow:body.scrollHeight-body.clientHeight,
            scrollTop:body.scrollTop,
            errorDisplay:getComputedStyle(error).display,
            extraBottom:extraRect.bottom,
            bodyBottom:bodyRect.bottom,
            viewportHeight:innerHeight
          };
        });
        assert.equal(metrics.errorDisplay,'none','Empty form validation message must not reserve space');
        assert(metrics.overflow<=2,`Default create-user form must not have phantom vertical scroll: ${JSON.stringify(metrics)}`);
        assert(metrics.extraBottom<=metrics.bodyBottom+1,'Metadata section must fit without clipping');
        await dialog.locator('#fe').evaluate(el=>{el.textContent='Проверка сообщения об ошибке.'});
        assert(await dialog.locator('#fe').isVisible(),'Real validation errors must still be visible');
        await dialog.locator('#fe').evaluate(el=>{el.textContent=''});
        assert.equal(await dialog.locator('#fe').evaluate(el=>getComputedStyle(el).display),'none');
        return metrics;
      }finally{
        await page.keyboard.press('Escape');
        await page.waitForSelector('dialog[open]',{state:'detached'});
      }
    });

    for(const [width,height] of [[1920,1080],[2560,1440],[768,900],[390,844]]) await checked(`Host assignments: ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});
      await navigate('hosts');
      await page.locator('[data-ne="hosts"]').first().click();
      await page.waitForSelector('dialog[open] .host-assignment-fields');
      await page.locator('.host-assignment-fields .ms').evaluate(list=>{
        const template=list.querySelector('label');
        for(const name of ['PL Польша','Тест','13455','Москва','Очень длинное название назначенной ноды без потери текста']){
          const label=template.cloneNode(true);
          label.querySelector('input').value='geometry-'+list.children.length;
          label.querySelector('input').checked=false;
          label.querySelector('span').textContent=name;
          list.append(label);
        }
      });
      const choice=page.locator('.host-assignment-fields .ms label').last();
      await choice.click();
      assert(await choice.locator('input').isChecked(),'Clicking the node label must toggle its checkbox');
      await choice.click();
      assert(!(await choice.locator('input').isChecked()),'Node assignment must toggle off');
      await page.locator('.host-assignment-fields').evaluate(el=>el.scrollIntoView({block:'nearest'}));
      const g=await page.locator('dialog[open]').evaluate(dialog=>{
        const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
        const labels=[...dialog.querySelectorAll('.ms label')].map(label=>({label:box(label),input:box(label.querySelector('input')),text:box(label.querySelector('span'))}));
        const body=dialog.querySelector('.host-editor-layout');
        return {labels,body:box(body),footer:box(dialog.querySelector('.act')),scrollHeight:body.scrollHeight,clientHeight:body.clientHeight};
      });
      for(const {label,input,text} of g.labels){
        assert(input.width<=24&&input.height<=24,'Checkbox must retain shared compact control dimensions');
        assert(text.x>=input.right&&text.right<=label.right+1,'Node name must fit inside its own choice');
        assert(label.x>=g.body.x&&label.right<=g.body.right+1,'Assignment must fit inside workspace');
      }
      for(let i=0;i<g.labels.length;i++) for(let j=i+1;j<g.labels.length;j++){
        const a=g.labels[i].label,b=g.labels[j].label;
        assert(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,'Node choices must not overlap');
      }
      assert(g.body.bottom<=g.footer.y+1,'Footer must not cover assignments');
      if(height>=1440) assert(g.scrollHeight<=g.clientHeight+1,'Desktop host content must fit when viewport has enough height');
      await screenshot(page,`host-assignments-${width}x${height}`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('dialog[open]',{state:'detached'});
      return g;
    });

    for(const [width,height] of [[1366,768],[1920,1080],[390,844]]) for(const [route,entity] of [['templates','tpls'],['admins','admins']]) await checked(`Entity editor containment: ${entity} · ${width}×${height}`,async()=>{
      try {
      await page.setViewportSize({width,height});
      await navigate(route);
      await page.locator(`[data-ne="${entity}"]`).first().click();
      await page.waitForSelector('dialog[open] .entity-editor-body');
      const body=page.locator('.entity-editor-body');
      if(entity==='tpls') await body.locator('.ck span').first().evaluate(el=>{el.textContent='Очень длинное название сквада '+('длинноеназвание'.repeat(8))});
      await body.evaluate(el=>{el.scrollTop=el.scrollHeight});
      const g=await page.locator('dialog[open]').evaluate(dialog=>{
        const box=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
        const body=dialog.querySelector('.entity-editor-body');
        const choices=[...body.querySelectorAll('.ck')].map(label=>({label:box(label),text:box(label.querySelector('span')),input:box(label.querySelector('input'))}));
        const last=body.lastElementChild;
        return {dialog:box(dialog),body:box(body),footer:box(dialog.querySelector('.act')),last:box(last),scrollTop:body.scrollTop,scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,choices};
      });
      assert(g.dialog.y>=0&&g.dialog.bottom<=height+1,'Entity editor must stay in viewport');
      assert(g.body.bottom<=g.footer.y+1,'Footer must have reserved space outside the scroll body');
      assert(g.last.bottom<=g.body.bottom+1,'Last field must be fully reachable above footer');
      assert(g.footer.bottom<=height,'Footer actions must stay visible');
      for(const c of g.choices){
        assert(c.input.width<=24,'Shared choices must retain compact checkboxes');
        assert(c.text.x>=c.input.right&&c.text.right<=c.label.right+1,'Long choice labels must wrap inside their own bounds');
        assert(c.label.right<=g.body.right+1,'Choice must fit scroll owner');
      }
      await screenshot(page,`entity-${entity}-${width}x${height}`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('dialog[open]',{state:'detached'});
      return g;
      } finally {
        await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
      }
    });

    const inspectStudioDialog=async(selector)=>page.locator(selector).evaluate(dialog=>{
      const visible=node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
      const box=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
      const outer=box(dialog);
      const controls=[...dialog.querySelectorAll('button,input,select,textarea')].filter(visible).map(node=>({identifier:node.id||node.getAttribute('name')||node.textContent.trim().slice(0,34),...box(node)}));
      const escaped=controls.filter(r=>r.width&&(r.x<outer.x-1||r.right>outer.right+1));
      const structural=[...dialog.querySelectorAll('.sv-dialog,[data-compose-root],.sv-compose-workspace,.sv-compose-choices,.sv-compose-choice-group,.sv-compose-preview,.xm-studio-modal-shell,.xm-studio-modal-fields,.xm-studio-modal-cardchoices')]
        .filter(visible)
        .map(node=>({name:node.className||node.getAttribute('data-compose-root')||node.tagName,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,...box(node)}));
      const overflow=structural.filter(item=>item.clientWidth>0&&item.scrollWidth>item.clientWidth+2);
      const cardRects=[...dialog.querySelectorAll('.xm-studio-modal-choice')].filter(visible).map(box);
      const groupRects=[...dialog.querySelectorAll('.sv-compose-choice-group')].filter(visible).map(box);
      const workspace=dialog.querySelector('.sv-compose-workspace');
      return{viewport:{width:innerWidth,height:innerHeight},outer,escaped,overflow,cardRects,groupRects,workspace:workspace&&box(workspace)};
    });
    const closeStudioDialog=async selector=>{
      await page.keyboard.press('Escape');
      await page.waitForFunction(sel=>!document.querySelector(sel)?.open,selector);
    };
    const seedStudioTcp=async()=>{
      await page.locator('#xm-studio-v4 [data-v="source"]').evaluate((el,tag)=>{
        el.value=JSON.stringify({inbounds:[{tag,listen:'127.0.0.1',port:443,protocol:'vless',settings:{users:[],decryption:'none'},streamSettings:{network:'tcp',security:'none'}}],outbounds:[{tag:'direct',protocol:'freedom'}]});
        el.dispatchEvent(new Event('input',{bubbles:true}));
      },inboundTag);
      await page.waitForTimeout(80);
    };

    for(const width of [1366,1920]) await checked(`XRAY Studio: конструктор сохраняет широкую рабочую геометрию · ${width}px`,async()=>{
      await page.setViewportSize({width,height:1080});
      await navigate('profiles');
      await page.locator('#xm-studio-v4 [data-action="templates"]').click();
      const selector='dialog.sv-overlay.sv-overlay-composer[open]';
      await page.waitForSelector(selector);
      const g=await inspectStudioDialog(selector);
      assert(g.outer.width>=width-48,`Конструктор снова сжат вместо workstation-ширины: ${g.outer.width}/${width}px.`);
      assert(g.workspace?.width>=g.outer.width*.9,'Рабочая область конструктора не использует ширину диалога.');
      assert(g.groupRects.length>=3,'Конструктор потерял группы выбора протокола/транспорта/защиты.');
      assert(g.groupRects.every(r=>r.width>=170),'Группа конструктора превратилась в узкую вертикальную колонку.');
      assert.equal(g.escaped.length,0,`Контролы конструктора выходят за диалог: ${JSON.stringify(g.escaped.slice(0,4))}`);
      assert.equal(g.overflow.length,0,`Внутренний layout конструктора переполнен: ${JSON.stringify(g.overflow.slice(0,4))}`);
      await screenshot(page,`dialog-xray-composer-${width}`);
      await closeStudioDialog(selector);
      return g;
    });

    for(const width of [1366,1920]) await checked(`XRAY Studio: FinalMask остаётся широким карточным диалогом · ${width}px`,async()=>{
      await page.setViewportSize({width,height:1080});
      await navigate('profiles');
      await seedStudioTcp();
      const trigger=page.locator('#xm-studio-v4 [data-tool="finalmask"]');
      assert(await trigger.count(),'Кнопка FinalMask отсутствует в реальном XRAY Studio toolset.');
      await trigger.first().click();
      const selector='dialog.xm-studio-modal.xm-studio-modal--cards[open]';
      await page.waitForSelector(selector);
      const g=await inspectStudioDialog(selector);
      const expected=Math.min(1400,width-40);
      assert(g.outer.width>=expected,`FinalMask снова сжат: ${g.outer.width}px, ожидается не менее ${expected}px.`);
      assert(g.cardRects.length>=8,'FinalMask потерял карточный каталог вариантов.');
      assert(g.cardRects.every(r=>r.width>=150),'Карточки FinalMask стали нечитаемо узкими.');
      const columns=new Set(g.cardRects.map(r=>Math.round(r.x/8)*8));
      assert(columns.size>=3,`FinalMask схлопнулся в ${columns.size} колонок на desktop.`);
      assert.equal(g.escaped.length,0,`Контролы FinalMask выходят за диалог: ${JSON.stringify(g.escaped.slice(0,4))}`);
      assert.equal(g.overflow.length,0,`Внутренний layout FinalMask переполнен: ${JSON.stringify(g.overflow.slice(0,4))}`);
      await screenshot(page,`dialog-finalmask-${width}`);
      await closeStudioDialog(selector);
      return g;
    });

    for(const width of [1366,1920]) await checked(`XRAY Studio: новый inbound использует нормальную form-ширину · ${width}px`,async()=>{
      await page.setViewportSize({width,height:1080});
      await navigate('profiles');
      await seedStudioTcp();
      const trigger=page.locator('#xm-studio-v4 [data-tool="inbound"]');
      assert(await trigger.count(),'Кнопка добавления inbound отсутствует в реальном XRAY Studio toolset.');
      await trigger.first().click();
      const selector='dialog.xm-studio-modal:not(.xm-studio-modal--cards)[open]';
      await page.waitForSelector(selector);
      const g=await inspectStudioDialog(selector);
      assert(g.outer.width>=820,`Форма нового inbound снова слишком узкая: ${g.outer.width}px.`);
      const fields=g.cardRects;
      assert.equal(g.escaped.length,0,`Контролы нового inbound выходят за диалог: ${JSON.stringify(g.escaped.slice(0,4))}`);
      assert.equal(g.overflow.length,0,`Внутренний layout нового inbound переполнен: ${JSON.stringify(g.overflow.slice(0,4))}`);
      await screenshot(page,`dialog-new-inbound-${width}`);
      await closeStudioDialog(selector);
      return{...g,fields};
    });

    await checked('Motion: refresh и native dialogs используют единый premium-контракт',async()=>{
      await page.setViewportSize({width:1920,height:1080});
      let previousMotion=null;
      let motionCaptured=false;
      try{
      await page.emulateMedia({reducedMotion:'no-preference'});
      await navigate('statistics');
      previousMotion=await page.evaluate(()=>document.documentElement.dataset.motion??null);
      motionCaptured=true;
      // An earlier reduced-motion settings test may leave data-motion="off".
      // Explicitly enable the feature under test without changing saved preferences.
      await page.evaluate(()=>{document.documentElement.dataset.motion='on'});
      const refresh=await page.locator('#stats-refresh').evaluate(button=>{
        const icon=button.querySelector('.ic,svg');
        const before=getComputedStyle(button);
        button.disabled=true;
        const busy=getComputedStyle(icon);
        const result={transitionProperty:before.transitionProperty,transitionDuration:before.transitionDuration,animationName:busy.animationName,animationDuration:busy.animationDuration};
        button.disabled=false;
        return result;
      });
      assert(refresh.transitionProperty.includes('transform'),'Общие кнопки не получили transform-transition.');
      assert(refresh.animationName.includes('nx-refresh-spin'),'Статистика не показывает единый spinner во время disabled/loading состояния.');
      assert.notEqual(refresh.animationDuration,'0s','Spinner статистики имеет нулевую длительность.');

      await navigate('profiles');
      await seedStudioTcp();
      await page.locator('#xm-studio-v4 [data-tool="inbound"]').first().click();
      const selector='dialog.xm-studio-modal:not(.xm-studio-modal--cards)[open]';
      await page.waitForSelector(selector);
      const dialogMotion=await page.locator(selector).evaluate(dialog=>{const s=getComputedStyle(dialog);return{transitionProperty:s.transitionProperty,transitionDuration:s.transitionDuration,transitionBehavior:s.transitionBehavior,animationName:s.animationName}});
      assert(dialogMotion.transitionProperty.includes('opacity')&&dialogMotion.transitionProperty.includes('transform'),'Native dialog не использует общий opacity/transform motion contract.');
      assert(dialogMotion.transitionBehavior.includes('allow-discrete'),'Native dialog не сохраняет transition во время закрытия top-layer.');
      assert.equal(dialogMotion.animationName,'none','Feature-specific dialog animation конкурирует с единым motion contract.');
      await page.emulateMedia({reducedMotion:'reduce'});
      const reduced=await page.locator(selector).evaluate(dialog=>{const s=getComputedStyle(dialog);return{transitionDuration:s.transitionDuration,animationName:s.animationName}});
      assert(reduced.transitionDuration.split(',').every(v=>parseFloat(v)===0),'prefers-reduced-motion не отключает dialog transitions.');
      assert.equal(reduced.animationName,'none','prefers-reduced-motion не отключает dialog animation.');
      await closeStudioDialog(selector);
      return{refresh,dialogMotion,reduced};
      }finally{
        // Always restore media and UI state, including when an assertion fails.
        // Otherwise later Node geometry checks can sample the opening transition.
        await page.emulateMedia({reducedMotion:'reduce'});
        if(motionCaptured)await page.evaluate(previous=>{
          if(previous===null)delete document.documentElement.dataset.motion;
          else document.documentElement.dataset.motion=previous;
        },previousMotion);
        await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
      }
    });

    // Certificate-only profiles must not inflate the later squad inventory.
    const tlsFixtureStart=fixtures.length;
    try{
      const noTlsProfile=await create('profiles',{name:`${prefix} · Без TLS`,config:JSON.stringify({inbounds:[{tag:inboundTag+'-plain',listen:'127.0.0.1',port:28353,protocol:'vless',settings:{decryption:'none',clients:[]},streamSettings:{network:'xhttp',security:'none',xhttpSettings:{path:'/tls-indicator'}}}],outbounds:[{tag:'direct',protocol:'freedom'}]})});
      const missingTlsProfile=await create('profiles',{name:prefix+' · TLS без сертификата',config:JSON.stringify({inbounds:[{tag:inboundTag+'-missing',listen:'127.0.0.1',port:28354,protocol:'trojan',settings:{clients:[]},streamSettings:{network:'tcp',security:'tls',tlsSettings:{}}}],outbounds:[{tag:'direct',protocol:'freedom'}]})});
      // A hash-only navigation retains the current bootstrap snapshot. Reload
      // after API fixture changes so the editor reads the intended inventory.
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>!!document.querySelector('#view')?.children.length&&!document.querySelector('#view .sk'));
    for(const [width,height,edit] of [[1366,768,true],[1920,1080,true],[1920,1080,false],[390,844,false]])await checked(`Node editor TLS mode stability: ${edit?'edit':'create'} ${width}×${height}`,async()=>{
      // This test compares stable layout geometry, not the dialog's opening
      // animation. Never sample the in-flight transform at arbitrary frames.
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.setViewportSize({width,height});await navigate('nodes');
      const initialScale=await page.evaluate(()=>C.ts);
      await page.evaluate(()=>{C.ts=1.1;apply()});
      await page.locator(edit?`[data-ne="nodes:${node.id}"]`:'[data-ne="nodes"]').first().click();
      const form=page.locator('#dlg form[data-ent="nodes"]');
      try{
        await form.locator('[name="profileId"]').selectOption(String(missingTlsProfile.id));
        await form.locator('[name="nodeTlsMethod"][value="acme"]').check();
        await form.locator('[name="tlsDomain"]').fill('node.example.invalid');
        await form.locator('[name="tlsAcmeEmail"]').fill('ops@example.com');
        const measure=()=>form.evaluate(f=>{
          const selectors=['#dlg','.node-editor-heading','[name="name"]','.node-tls-method','.act'];
          return selectors.map(selector=>{const r=(selector==='#dlg'?f.closest(selector):f.querySelector(selector)).getBoundingClientRect();return{selector,x:r.x,y:r.y,width:r.width,height:r.height}});
        });
        // Mobile may scroll a focused input into view. Compare both modes at the
        // same content origin so native focus scrolling is not mistaken for drift.
        await form.locator('.node-form-layout').evaluate(el=>el.scrollTop=0);
        const before=await measure();
        for(const method of ['external','acme','external','acme']){
          await form.locator(`[name="nodeTlsMethod"][value="${method}"]`).check();
          await form.locator('.node-form-layout').evaluate(el=>el.scrollTop=0);
          const inactive=form.locator('.node-tls-mode-panel[data-active="false"]');
          assert.equal(await inactive.count(),1,'Exactly one certificate mode must be inactive');
          assert(await inactive.evaluate(el=>el.inert&&el.getAttribute('aria-hidden')==='true'),'Inactive certificate controls must be excluded from focus and accessibility');
          assert(!(await inactive.isVisible()),'Inactive certificate fields must not be visible');
          const after=await measure();
          for(let i=0;i<before.length;i++)for(const key of ['x','y','width','height'])assert(Math.abs(after[i][key]-before[i][key])<=.1,'Certificate mode must not move '+before[i].selector+' '+key+': '+JSON.stringify({before,after}));
        }
        return before;
      }finally{await page.keyboard.press('Escape');await page.evaluate(ts=>{C.ts=ts;apply()},initialScale)}
    });

      await checked('Node certificate status follows Security, not saved TLS overrides',async()=>{
        try{
          await navigate('nodes');
          await page.locator(`[data-ne="nodes:${node.id}"]`).first().click();
          const form=page.locator('dialog form[data-ent="nodes"]');
          const toggle=form.locator('[data-node-tls-effective]');
          const setup=form.locator('[data-node-tls-inline]');
          assert.equal(await toggle.getAttribute('data-state'),'on','TLS profile must render TLS status ON');
          assert.equal(await toggle.locator('input,button').count(),0,'Derived TLS state must not pretend to be an editable control');
          await form.locator('[name="profileId"]').selectOption(String(noTlsProfile.id));
          assert.equal(await toggle.getAttribute('data-state'),'off','Security none must render OFF despite stored external override');
          assert.match(await form.locator('[data-node-tls-state]').innerText(),/Без TLS/);
          assert(await setup.isVisible(),'Certificate preferences stay expanded when switching profiles');
          assert.equal(await form.locator('[name="tlsManualProvision"]').isChecked(),true,'Saved override preference must not be erased');
          await form.locator('[name="profileId"]').selectOption(String(profile.id));
          assert.equal(await toggle.getAttribute('data-state'),'on','Status must return ON after restoring TLS profile');
        }finally{await page.keyboard.press('Escape')}
      });
      await checked('TLS certificate setup is required before saving a TLS Node profile',async()=>{
        try{
          await navigate('nodes');
          await page.locator('[data-ne="nodes:'+node.id+'"]').first().click();
          const form=page.locator('dialog form[data-ent="nodes"]');
          await form.locator('[name="profileId"]').selectOption(String(missingTlsProfile.id));
          const status=form.locator('[data-node-tls-note]:visible');
          const modal=form.locator('[data-node-tls-inline]');
          await modal.locator('[name="nodeTlsMethod"][value="acme"]').check();
          assert.equal(await form.locator('[name="tlsManualProvision"]').isChecked(),false,'Radio selection must disable stale external override');
          assert.match(await status.innerText(),/DNS-домен/,'Missing ACME domain must show a direct explanation');
          await form.locator('[data-node-editor-tab="billing"]').click();
          await form.locator('.act .btn').click();
          assert(await page.locator('#dlg.node-wide[open]').count(),'Unready TLS must not close the Node editor');
          assert.match(await page.locator('#fe').innerText(),/DNS-домен/,'TLS save must be rejected before the API call');
          assert(await modal.isVisible(),'Blocked save must reveal the inline certificate fields');
          assert.equal(await modal.locator('[name="tlsDomain"]').evaluate(el=>document.activeElement===el),true,'Missing TLS field should receive focus');
          await form.locator('[name="tlsDomain"]').fill('test-node.example.invalid');
          assert.match(await status.innerText(),/email ACME/,'Missing ACME email must be explained');
          await form.locator('[name="tlsAcmeEmail"]').fill('tls@example.com');
          assert.match(await modal.locator('[data-node-tls-note]:visible').innerText(),/Выпуск начнётся при применении профиля/,'Ready ACME settings must not claim a certificate has already been issued');
        }finally{await page.keyboard.press('Escape')}
      });
    }finally{
      await page.keyboard.press('Escape');
      for(const fixture of fixtures.splice(tlsFixtureStart))await api('DELETE','/collections/'+fixture.collection+'/'+fixture.id);
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>!!document.querySelector('#view')?.children.length&&!document.querySelector('#view .sk'));
    }
    await checked('Редактирование узла сохраняется через API',async()=>{
      await navigate('nodes');
      await page.locator(`[data-ne="nodes:${node.id}"]`).click();
      const form=page.locator('dialog form[data-ent="nodes"]');
      await form.locator('input[name="name"]').fill(`${prefix} · Изменён`);
      await form.locator('[data-node-editor-tab="billing"]').click();
      await form.locator('[name="billingNote"]').fill('Billing tab saved');
      await form.locator('[data-node-editor-tab="network"]').click();
      await form.locator('[name="rotationIntervalHours"]').fill('36');
      await form.locator('[data-node-editor-tab="connection"]').click();
      const invalid=await form.locator(':invalid').evaluateAll(nodes=>nodes.map(node=>({name:node.getAttribute('name')||node.id||node.tagName,message:node.validationMessage})));
      assert.equal(invalid.length,0,`Форма редактирования узла невалидна до отправки: ${JSON.stringify(invalid)}`);
      const save=form.locator('.act > button.btn');
      assert.equal(await save.count(),1,'Кнопка сохранения узла отсутствует или неоднозначна.');
      await save.click();
      await page.waitForFunction(()=>{
        const dialog=document.querySelector('dialog[open]');
        if(!dialog)return true;
        return !!dialog.querySelector('#fe')?.textContent?.trim();
      },null,{timeout:5000});
      if(await page.locator('dialog[open]').count()){
        const errorText=String(await page.locator('dialog[open] #fe').textContent()||'').trim();
        assert(!errorText,`Сохранение узла отклонено интерфейсом/API: ${errorText}`);
      }
      await page.waitForSelector('dialog[open]',{state:'detached',timeout:5000});
      const saved=await api('GET','/collections/nodes');
      assert(saved.items.some(n=>n.id===node.id&&n.name===`${prefix} · Изменён`));
      const savedNode=saved.items.find(n=>n.id===node.id);
      assert.equal(savedNode.billingNote,'Billing tab saved','Inactive billing fields must be included in the save');
      assert.equal(savedNode.rotationIntervalHours,36,'Inactive IP-pool fields must be included in the save');
    });

    await create('nodes',{name:`${prefix} · Берлин`,addr:'192.0.2.11',port:443,profileId:profile.id});
    await checked('Two nodes: bounded cards/actions and global radius on ultrawide',async()=>{
      await page.setViewportSize({width:3440,height:1440});
      await navigate('set/layout');
      await page.locator('#content-width').evaluate(el=>{el.value='3000';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});
      await page.reload({waitUntil:'domcontentloaded'});
      await navigate('nodes');
      const widths={};
      for(const [mode,cap] of [['compact',40],['standard',68],['spacious',76]]){
        await page.locator(`[data-node-grid-mode="${mode}"]`).click();
        const state=await page.locator('.nodes').evaluate(grid=>{
          const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,width:r.width}};
          return {left:grid.getBoundingClientRect().left,toolbarLeft:document.querySelector('.nodes-toolbar').getBoundingClientRect().left,rem:parseFloat(getComputedStyle(document.documentElement).fontSize),cards:[...grid.children].map(card=>({box:box(card),buttons:[...card.querySelectorAll('.acts>button')].map(box),summaryOnly:card.querySelector('.node-summary').children.length===1,summaryBorder:getComputedStyle(card.querySelector('.kvg')).borderBottomWidth}))};
        });
        assert(Math.abs(state.cards[0].box.x-state.left)<=2,'Fleet must anchor to the left grid edge in every density mode');
        assert(Math.abs(state.cards[0].box.x-state.toolbarLeft)<=2,'Cards must align with the left filter-toolbar edge');
        for(const card of state.cards){
          if(mode==='compact'&&card.summaryOnly)assert.equal(card.summaryBorder,'0px','Compact card without health rows must not show a redundant separator');
          if(mode==='spacious')assert(Math.abs(card.box.x-state.left)<=2,'Every single-column card must stay left-aligned');
          assert(Math.abs(card.box.width-cap*state.rem)<=2,'Card must stop at its density width cap');
          assert(card.buttons.slice(0,4).every(b=>Math.abs(b.y-card.buttons[0].y)<=3),'Narrower card must preserve four action columns');
          assert(card.buttons.slice(0,8).every(b=>b.width<card.box.width*.27),'Inner actions must narrow with the card');
        }
        if(mode!=='spacious')assert(state.cards[1].box.x-state.cards[0].box.right<=40,'Bounded cards must not leave an oversized internal gap');
        widths[mode]=state.cards[0].box.width;
        await screenshot(page,`nodes-two-3440-${mode}`);
      }
      assert(widths.compact<widths.standard&&widths.standard<widths.spacious,'Density must change actual card width');
      await page.locator('[data-node-grid-mode="compact"]').click();
      const radii=[];
      for(const radius of [6,28]){
        await navigate('set/layout');
        await page.locator('#radius').evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))},radius);
        await navigate('nodes');
        const actual=await page.locator('.nc').first().evaluate(card=>({card:parseFloat(getComputedStyle(card).borderTopLeftRadius),button:parseFloat(getComputedStyle(card.querySelector('.acts>button')).borderTopLeftRadius)}));
        assert.equal(actual.card,radius);assert.equal(actual.button,radius);radii.push(actual);
      }
      await navigate('set/layout');
      await page.locator('#radius').evaluate(el=>{el.value='16';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});
      await page.locator('#content-width').evaluate(el=>{el.value='1920';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});
      await navigate('nodes');
      await page.locator('[data-node-grid-mode="standard"]').click();
      return {widths,radii};
    });

    await create('nodes',{name:`${prefix} · Амстердам`,addr:'192.0.2.12',port:443,profileId:profile.id});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => !!document.querySelector('#view')?.children.length && !document.querySelector('#view .sk'));
    for(const width of [1366,1920,3440]) await checked(`Коллекция узлов: ${width}px`,async()=>{
      await page.setViewportSize({width,height:1080});
      await navigate('nodes');
      const g=await geometry(page);
      verifyPage(g,'nodes');
      assert(g.nodeCards.length>=3);
      assert(g.nodeCards.every(c=>c.width>=300),'Карточки коллекции стали слишком узкими.');
      const modeColumns={};
      for(const mode of ['compact','standard','spacious']){
        await page.locator(`[data-node-grid-mode="${mode}"]`).click();
        const state=await page.locator('.nodes').evaluate(grid=>({columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,width:grid.getBoundingClientRect().width,icons:[...grid.querySelectorAll('.nc')].every(card=>card.querySelectorAll('.acts>button svg').length===9)}));
        modeColumns[mode]=state.columns;
        assert(state.icons,'Fleet density must preserve semantic action icons');
        await screenshot(page,`nodes-multiple-${width}-${mode}`);
      }
      assert(modeColumns.compact>modeColumns.standard&&modeColumns.standard>modeColumns.spacious,'Density must change real fleet columns');
      await page.locator('[data-node-grid-mode="standard"]').click();
      await screenshot(page,`nodes-multiple-${width}`);
      return g;
    });

    await context.grantPermissions(['clipboard-read','clipboard-write']);
    const hostTlsProfile=await create('profiles',{name:`${prefix} · TLS host`,config:JSON.stringify({inbounds:[{tag:prefix+'-host-tls',listen:'127.0.0.1',port:29443,protocol:'vless',settings:{clients:[],decryption:'none'},streamSettings:{network:'xhttp',security:'tls',tlsSettings:{serverName:'tls.example.invalid'},xhttpSettings:{path:'/host-preview/'+('long-segment-'.repeat(24))}}}],outbounds:[{tag:'direct',protocol:'freedom'}]})});
    let hostPresetNode;
    for(let i=0;i<4;i++)hostPresetNode=await create('nodes',{name:`${prefix} · Сервер ${i+1}`,addr:`192.0.2.${30+i}`,port:443,profileId:hostTlsProfile.id,flag:'🇳🇱'});
    await create('nodes',{name:`${prefix} · Отключён`,addr:'192.0.2.50',port:443,profileId:profile.id,disabled:true,tlsManualProvision:true});
    await create('nodes',{name:`${prefix} · Без телеметрии`,addr:'192.0.2.51',port:443,profileId:profile.id,disabled:true});
    // Transport fixtures exercise the real renderer/live refresh without
    // activating a node or writing synthetic telemetry to the backend.
    const runtimePattern=/\/api\/v1\/nodes\/\d+\/runtime(?:\?.*)?$/;
    const runtimeFixture=async route=>{
      if(![node.id,hostPresetNode.id].some(id=>new URL(route.request().url()).pathname===`/api/v1/nodes/${id}/runtime`))return route.continue();
      await route.fulfill({json:{connected:true,xrayUpdateSupported:true,version:'control-v6.0.9',xrayVersion:'26.10.31',xrayRunning:true,routerRunning:true,desiredRevisionSource:'current',desiredRevision:'fixture',appliedRevision:'fixture',tlsStatus:{state:'valid',daysRemaining:87},geoData:{state:'current',files:{geoip:{},geosite:{}}}}});
    };
    const metricsPattern='**/api/v1/statistics/overview';
    const metricsFixture=async route=>{
      const response=await route.fetch(),data=await response.json();
      const active=data.nodes?.find(n=>Number(n.id)===node.id);
      if(active)Object.assign(active,{networkRxBytes:12345678900,networkTxBytes:123456789,latest:{stale:false,cpuPercent:27,ramUsedBytes:2e9,ramTotalBytes:8e9,rxBytesPerSec:0,txBytesPerSec:0,onlineClients:0}});
      await route.fulfill({response,json:data});
    };
    await page.route(runtimePattern,runtimeFixture);
    await page.route(metricsPattern,metricsFixture);
    try{
      await page.reload({waitUntil:'domcontentloaded'});
      await checked('TLS certificate is visible for profile-derived TLS without manual flags',async()=>{
        await navigate('nodes');
        const card=page.locator(`[data-node-card-id="${hostPresetNode.id}"]`);
        const badge=card.locator('[data-node-tls-status]');
        await badge.waitFor({state:'visible'});
        await page.waitForFunction(id=>document.querySelector(`[data-node-card-id="${id}"] [data-node-tls-label]`)?.textContent.includes('87'),hostPresetNode.id);
        assert.match(await badge.innerText(),/87 дн\./,'TLS certificate expiry days should be visible on the node card');
      });
      await checked('Xray release picker: control-v6 loading animation and catalog',async()=>{
        // A control-v6 heartbeat must not be rejected by the historic v3/v4
        // browser regex. Only the backend-authorized capability is consulted.
        const catalogRoute='**/api/v1/nodes/xray-releases';
        let releaseCatalog;
        const pendingCatalog=new Promise(resolve=>{releaseCatalog=resolve});
        const previous=await page.evaluate(()=>document.documentElement.dataset.motion);
        await page.route(catalogRoute,async route=>{await pendingCatalog;await route.fulfill({json:{items:[{
          version:'v26.10.30',published_at:'2026-10-30T00:00:00Z',prerelease:false,
          image_status:'available',url:'https://github.com/XTLS/Xray-core/releases/tag/v26.10.30'
        },{
          version:'v26.11.9',published_at:'2026-11-09T00:00:00Z',prerelease:false,
          image_status:'missing',url:'https://github.com/XTLS/Xray-core/releases/tag/v26.11.9'
        }]}})});
        try{
          await page.setViewportSize({width:1920,height:1080});
          await page.emulateMedia({reducedMotion:'no-preference'});
          await navigate('nodes');
          await page.evaluate(()=>{document.documentElement.dataset.motion='on'});
          await page.locator(`[data-xray-update="${node.id}"]`).first().click();
          const spinner=page.locator('.xray-release-spinner');
          await spinner.waitFor();
          const sample=()=>spinner.evaluate(el=>{const r=el.getBoundingClientRect();return{width:r.width,height:r.height,transform:getComputedStyle(el).transform,animations:el.getAnimations().map(a=>({state:a.playState,time:a.currentTime}))}});
          const first=await sample();await page.waitForTimeout(170);const second=await sample();
          assert(first.height>=12&&Math.abs(first.width-first.height)<=1,'Release spinner must be a circle, not a collapsed horizontal border');
          assert(first.animations.some(a=>a.state==='running'),'Release loader must have a running animation');
          assert(second.animations[0].time>first.animations[0].time+70,'Release loader timeline must advance');
          assert.notEqual(first.transform,second.transform,'Release loader must actually rotate');
          assert(await page.locator('.xray-release-search').isDisabled(),'Search stays disabled until the catalog arrives');
          assert(await page.locator('.xray-release-dialog .btn').isDisabled(),'Installation stays disabled while loading');
          await page.mouse.move(0,0);
          for(let i=0;i<6;i++){
            const filename=`xray-release-loading-motion-${i}.png`;
            await page.locator('.xray-release-dialog').screenshot({path:path.join(output,filename),animations:'allow'});
            report.screenshots.push(filename);await page.waitForTimeout(120);
          }
          for(const [width,height] of [[1920,1080],[390,844]]){
            await page.setViewportSize({width,height});
            const bounds=await page.locator('.xray-release-dialog').evaluate(d=>{
              const box=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
              return{dialog:box(d),content:box(d.firstElementChild),controls:[...d.querySelectorAll('input,button')].map(box)};
            });
            assert(bounds.content.right<=bounds.dialog.right+1,'Release picker content must fit its native dialog');
            assert(bounds.controls.every(r=>r.left>=bounds.dialog.left&&r.right<=bounds.dialog.right+1),'Loading controls must not be clipped horizontally');
            assert(bounds.dialog.top>=0&&bounds.dialog.bottom<=height+1,'Loading dialog must fit the viewport');
            await screenshot(page,`xray-release-loading-${width}`);
          }
          await page.setViewportSize({width:1920,height:1080});
          await page.evaluate(()=>{document.documentElement.dataset.motion='off'});
          assert.equal((await sample()).animations.length,0,'Panel motion-off must stop the release loader');
          await page.evaluate(()=>{document.documentElement.dataset.motion='on'});
          await page.emulateMedia({reducedMotion:'reduce'});
          assert.equal((await sample()).animations.length,0,'System reduced-motion must stop the release loader');
          releaseCatalog();
          const release=page.locator('.xray-release-row').first();
          await release.waitFor({timeout:12000});
          assert.equal(await release.locator('strong').innerText(),'v26.10.30');
          assert.equal(await spinner.count(),0,'Loading indicator must disappear after the catalog arrives');
          assert(!(await page.locator('.xray-release-search').isDisabled()),'Loaded catalog enables search');
          const missing=page.locator('.xray-release-row',{hasText:'v26.11.9'});
          await missing.click();
          assert.match(await missing.innerText(),/Нет Docker-образа/,
            'A published GitHub release without GHCR must not appear installable');
          assert(await page.locator('.xray-release-dialog .btn').isDisabled(),
            'Unpublished GHCR image must never enable Install');
          assert.match(await page.locator('.xray-release-info').innerText(),/не опубликован/,
            'Missing Docker artifact must be explained in the picker');
          await release.click();
          assert(!(await page.locator('.xray-release-dialog .btn').isDisabled()),
            'Only an available official Docker image can be installed');

          await page.locator('.xray-release-dialog .gh').click();
          await page.locator('.xray-release-dialog').waitFor({state:'detached'});
          return{first,second};
        }finally{
          releaseCatalog();
          if(await page.locator('.xray-release-dialog[open]').count())await page.keyboard.press('Escape');
          await page.unroute(catalogRoute);
          await page.emulateMedia({reducedMotion:'reduce'});
          await page.evaluate(previous=>{if(previous===undefined)delete document.documentElement.dataset.motion;else document.documentElement.dataset.motion=previous},previous);
        }
      });
      await navigate('set/layout');
      await page.locator('#content-width').evaluate(el=>{el.value='3000';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});
      for(const [mode,width,height] of [['compact',1920,1080],['compact',2560,1440],['compact',3440,1440],['standard',3440,1440],['spacious',3440,1440],['compact',390,844]])await checked(`Equal Node heights: ${mode} ${width}×${height}`,async()=>{
        await page.setViewportSize({width,height});
        await navigate('nodes');
        await page.locator(`[data-node-grid-mode="${mode}"]`).click();
        await page.locator(`[data-node-card-id="${node.id}"] .node-runtime-online`).waitFor();
        const g=await page.locator('.nodes').evaluate(grid=>{
          const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
          return{overflow:document.documentElement.scrollWidth,cards:[...grid.children].map(card=>({card:box(card),status:card.querySelector('[data-node-runtime-state]').textContent,body:box(card.querySelector('.node-body')),metrics:box(card.querySelector('.node-metrics')),speed:box(card.querySelector('.node-speed')),actions:box(card.querySelector('.acts')),buttons:[...card.querySelectorAll('.acts>button')].map(box),emptyFlag:!!card.querySelector('.fg>span.flag-img:empty'),flagDisplay:getComputedStyle(card.querySelector('.fg')).display}))};
        });
        await screenshot(page,`nodes-equal-${mode}-${width}x${height}`);
        assert(g.cards.length>=9,'Fixture must include multiple rows and mixed optional health fields');
        assert(g.cards.some(c=>c.status.includes('Активна'))&&g.cards.some(c=>c.status.includes('Остановка не подтверждена')),'Fixture must include active and disabled runtime states');
        assert(Math.max(...g.cards.map(c=>c.card.height))-Math.min(...g.cards.map(c=>c.card.height))<=2,'All visible cards must have equal heights across rows and statuses');
        assert(g.overflow<=width+1,'Equal-height layout must not overflow the document');
        for(const c of g.cards){
          if(c.emptyFlag)assert.equal(c.flagDisplay,'none','Unconfigured flag must not leave an empty accent frame');
          assert(c.body.bottom<=c.actions.y+1,'Body must not overlap actions');
          assert(c.buttons.every(b=>b.x>=c.card.x&&b.right<=c.card.right+1&&b.bottom<=c.card.bottom),'Every action must fit inside its card');
          const peers=g.cards.filter(other=>Math.abs(other.card.y-c.card.y)<=2);
          assert(peers.every(other=>Math.abs(other.actions.y-c.actions.y)<=3),'Action rows must align between cards in the same row');
          assert(peers.every(other=>Math.abs(other.speed.bottom-c.speed.bottom)<=3),'Speed rails must align between cards in the same row');
        }
        return g;
      });
      for(const outcome of ['cancel','succeeded','failed'])await checked(`Xray restart feedback: ${outcome}`,async()=>{
        await page.setViewportSize({width:1920,height:1080});
        await navigate('nodes');
        const path=`**/api/v1/nodes/${node.id}/restart`;
        let posts=0,release;
        const gate=new Promise(resolve=>{release=resolve});
        const handler=async route=>{
          if(route.request().method()==='POST'){posts++;return route.fulfill({json:{id:'restart-fixture',state:'queued'}})}
          await gate;
          return route.fulfill({json:{id:'restart-fixture',state:outcome,result:'Fixture restart failure'}});
        };
        await page.route(path,handler);
        try{
          await page.locator(`[data-nr="${node.id}"]`).click();
          await page.locator('.xm-action-confirm[open]').waitFor();
          if(outcome==='cancel'){
            await page.locator('.xm-action-confirm .gh').click();
          }else{
            await page.locator('.xm-action-confirm .btn').click();
            const badge=page.locator(`[data-node-card-id="${node.id}"] [data-node-xray-version]`);
            await badge.locator('.node-agent-spinner').waitFor();
            assert((await badge.innerText()).includes('Перезапуск Xray'),'Badge must describe the active restart');
            assert(await page.locator(`[data-nr="${node.id}"]`).isDisabled(),'Restart must block repeated submissions');
            await page.evaluate(()=>drawNodeLive());
            assert.equal(await badge.locator('.node-agent-spinner').count(),1,'Live refresh must preserve restart feedback');
            if(outcome==='failed'){
              await navigate('hosts');await navigate('nodes');
              await badge.locator('.node-agent-spinner').waitFor();
              assert(await page.locator(`[data-nr="${node.id}"]`).isDisabled(),'Rerender must preserve restart progress and submission guard');
            }
            await screenshot(page,`node-xray-restart-${outcome}`);
          }
          release();
          await page.waitForFunction(id=>{const b=document.querySelector('[data-nr="'+id+'"]');return b&&!b.disabled&&!b.querySelector('.node-agent-spinner')},node.id,{timeout:10000});
          assert.equal(posts,outcome==='cancel'?0:1,'Restart must send exactly one command only after confirmation');
          assert.equal(await page.locator(`[data-node-card-id="${node.id}"] [data-node-xray-version] .node-agent-spinner`).count(),0,'Terminal states must clear the badge spinner');
        }finally{release();await page.unroute(path,handler)}
      });
    }finally{
      await page.unroute(runtimePattern,runtimeFixture);
      await page.unroute(metricsPattern,metricsFixture);
      await page.setViewportSize({width:1920,height:1080});
      await navigate('set/layout');
      await page.locator('#content-width').evaluate(el=>{el.value='1920';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});
      await navigate('nodes');
      await page.locator('[data-node-grid-mode="standard"]').click();
    }
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!document.querySelector('#view')?.children.length&&!document.querySelector('#view .sk'));
    for(const [width,height] of [[1920,1080],[2560,1440],[390,844]]) await checked(`Host redesign with TLS and fleet: ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});
      await navigate('hosts');
      await page.locator('[data-ne="hosts"]').first().click();
      await page.waitForSelector('[data-host-node-preset]');
      await page.locator('[data-host-node-preset]').evaluate((select,id)=>{select.value=String(id);select.dispatchEvent(new Event('change',{bubbles:true}))},hostPresetNode.id);
      assert.equal(await page.locator('[name="address"]').inputValue(),hostPresetNode.addr,'Node preset must fill public endpoint');
      assert.equal(await page.locator('[name="remark"]').inputValue(),`🇳🇱 ${hostPresetNode.name}`,'Node preset must fill the flag emoji and exact node name for the Happ remark');
      assert.equal(await page.locator('[name="countryCode"]').inputValue(),'NL','Node preset must fill the explicit ISO country field');
      assert.equal(await page.locator('[name="profileId"]').inputValue(),String(hostTlsProfile.id),'Node preset must retain profile binding');
      assert.equal(await page.locator('[name="profileId"]').evaluate(select=>select.closest('.xm-select-shell').querySelector('.xm-select-caption').textContent),hostTlsProfile.name,'Visible profile caption must match preset binding');
      await page.locator('[name="remark"]').focus();
      const focus=await page.locator('[name="remark"]').evaluate(input=>{const s=getComputedStyle(input);return {style:s.outlineStyle,offset:parseFloat(s.outlineOffset),shadow:s.boxShadow}});
      assert.equal(focus.style,'solid','Text fields must keep visible keyboard focus');
      assert(focus.offset<=0,'Focus must stay inside the control without a detached double contour');
      assert.equal(focus.shadow,'none','Text fields must not add a second focus shadow');
      await screenshot(page,`audit-focus-host-${width}`);
      await page.locator('[data-host-editor-tab="client"]').click();
      for(const [name,value] of [['xhttpMode','packet-up'],['tlsVerification','insecure']]){
        await page.locator(`[name="${name}"]`).evaluate((input,next)=>{input.value=next;input.dispatchEvent(new Event('change',{bubbles:true}))},value);
      }
      assert.equal(JSON.parse(await page.locator('[name="clientXhttpSettings"]').inputValue()).mode,'packet-up','XHTTP dropdown must update the persisted client configuration');
      assert.equal(JSON.parse(await page.locator('[name="clientTlsSettings"]').inputValue()).allowInsecure,true,'Certificate control must update the persisted TLS settings');
      assert.equal(await page.locator('[name="alpn"]').evaluate(el=>el.tagName),'SELECT','ALPN must be a normal selection control');
      assert(!(await page.locator('[name="clientTlsSettings"]').isVisible()),'Raw JSON must remain hidden in the expert disclosure');
      await page.locator('[name="sni"]').fill('override.example.invalid');
      await page.locator('[name="sni"]').dispatchEvent('change');
      await page.locator('[data-host-editor-tab="preview"]').click();
      assert((await page.locator('[data-host-resolved]').innerText()).includes('override.example.invalid'),'Live preview must reflect SNI override');
      await page.locator('[data-host-editor-tab="connection"]').click();
      await page.locator('[data-host-editor-tab="client"]').click();
      assert.equal(await page.locator('[name="sni"]').inputValue(),'override.example.invalid','Switching tasks must preserve draft values');
      assert.equal(JSON.parse(await page.locator('[name="clientXhttpSettings"]').inputValue()).mode,'packet-up','Switching tasks must preserve structured metadata');
      await page.locator('[data-host-clear-overrides]').click();
      assert.equal(await page.locator('[name="sni"]').inputValue(),'','Reset must clear overrides');
      await page.locator('[data-host-editor-tab="preview"]').click();
      await page.locator('[data-host-copy-value^="/host-preview/"]').click();
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'/host-preview/'+('long-segment-'.repeat(24)),'Copy must preserve the entire long path');
      await page.waitForFunction(()=>!document.getElementById('xmesh-feedback-toast')?.matches(':popover-open'));
      const frame=await page.locator('#dlg').boundingBox();
      const footer=await page.locator('#dlg .act').boundingBox();
      for(const key of ['connection','client','preview']){
        await page.locator(`[data-host-editor-tab="${key}"]`).click();
        assert.equal(await page.locator('[data-host-editor-pane]:not([inert])').count(),1,'Only one task may accept interaction');
        const current=await page.locator('#dlg').boundingBox(),actions=await page.locator('#dlg .act').boundingBox();
        for(const prop of ['x','y','width','height'])assert(Math.abs(current[prop]-frame[prop])<=1.5,'Task switching must preserve dialog '+prop);
        assert(Math.abs(actions.y-footer.y)<=1.5,'Task switching must not move Save');
        await screenshot(page,`host-task-${key}-${width}x${height}`);
      }
      await page.locator('[data-host-editor-tab="connection"]').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('[data-host-editor-tab="client"]').getAttribute('aria-selected'),'true');
      await page.keyboard.press('End');
      assert.equal(await page.locator('[data-host-editor-tab="preview"]').getAttribute('aria-selected'),'true');
      await page.keyboard.press('Home');
      const remark=await page.locator('[name="remark"]').inputValue();
      await page.locator('[name="remark"]').fill('');
      await page.locator('[data-host-editor-tab="client"]').click();
      await page.locator('#dlg .act .btn').click();
      await page.waitForSelector('[data-host-editor-tab="connection"][aria-selected="true"]');
      assert(await page.locator('[name="remark"]').evaluate(input=>input===document.activeElement),'Validation must focus the first invalid control in its task');
      await page.locator('[name="remark"]').fill(remark);
      await page.locator('.host-editor-panes').evaluate(body=>{body.scrollTop=0});
      const g=await page.locator('#dlg').evaluate(d=>{
        const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
        const q=s=>d.querySelector(s),primary=q('.host-primary-panel'),advanced=q('.host-advanced-panel'),preview=q('.host-editor-side');
        return{dialog:box(d),primary:box(primary),advanced:box(advanced),preview:box(preview),assignment:box(q('.host-assignment-panel')),body:box(q('.host-editor-layout')),footer:box(q('.act')),port:box(q('[name="port"]')),country:box(q('[name="countryCode"]')),address:box(q('[name="address"]')),publicFields:box(q('.host-public-fields')),bodyScroll:q('.host-editor-panes').scrollHeight,bodyClient:q('.host-editor-panes').clientHeight,copyValues:[...d.querySelectorAll('[data-host-copy-value]')].map(button=>button.dataset.hostCopyValue),icons:[primary,advanced,preview].map(p=>!!p.querySelector('.node-form-section-title svg')),choices:[...d.querySelectorAll('.ms label')].map(box)};
      });
      await screenshot(page,`host-redesign-${width}x${height}`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('dialog[open]',{state:'detached'});
      assert(g.icons.every(Boolean),'Three editor zones must retain semantic SVG headings');
      assert(g.dialog.y>=0&&g.dialog.bottom<=height+1,'Host editor must fit viewport');
      assert(g.body.bottom<=g.footer.y+1,'Footer must not cover fields');
      if(width>=1920){
        assert(g.assignment.x>=g.primary.right,'Connection task must place node assignment beside endpoint fields');
        assert(Math.abs(g.port.y-g.country.y)<=3,'Paired public fields must share a baseline');
        assert(g.address.width>=g.publicFields.width*.4,'Paired public endpoint must retain readable width');
        assert(g.choices.length>=5,'Fixture must show a real node fleet');
        assert(Math.abs(g.assignment.y-g.primary.y)<=2,'Endpoint and node assignment must start together');
        assert(g.bodyScroll<=g.bodyClient+1,'Populated TLS/XHTTP Host editor must fit desktop without workspace scrolling: '+JSON.stringify(g));
        assert(g.copyValues.includes('/host-preview/'+('long-segment-'.repeat(24))),'Full long path must remain available to copy');
      }else assert(g.assignment.y>=g.primary.bottom,'Mobile connection task must stack node assignment below fields');
      return g;
    });

    // Issue #317: exercise the extracted feature through the real adapters,
    // including implicit/explicit presets and all shared appearance materials.
    const hostModuleFixtureStart=fixtures.length;
    try{
      const hostUniqueProfile=await create('profiles',{name:prefix+' unique preset',config:profile.config});
      const hostUniqueNode=await create('nodes',{name:prefix+' Poland',addr:'192.0.2.62',port:443,profileId:hostUniqueProfile.id,flag:'PL'});
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>!!document.querySelector('#view')?.children.length&&!document.querySelector('#view .sk'));
      const hostAppearance=await page.evaluate(()=>({surface:C.surface,language:XMeshI18n.getLanguage()}));
      try{
        for(const surface of ['solid','glass','raised'])for(const language of ['ru','en'])await checked(`Host module: ${surface} · ${language}`,async()=>{
          await page.setViewportSize(language==='en'?{width:390,height:844}:{width:1920,height:1080});
          await navigate('set/layout');
          await page.evaluate(language=>XMeshI18n.setLanguage(language),language);
          await page.locator(`[data-ui="surface"][data-value="${surface}"]`).click();
          await navigate('hosts');await page.locator('[data-ne="hosts"]').first().click();
          const form=page.locator('#dlg form[data-ent="hosts"]');await form.waitFor();
          const preset=async id=>form.locator('[data-host-node-preset]').evaluate((select,id)=>{select.value=String(id);select.dispatchEvent(new Event('change',{bubbles:true}))},id);
          await preset(hostUniqueNode.id);
          assert.equal(await form.locator('[name="countryCode"]').inputValue(),'PL');
          const manual=prefix+' manual host';await form.locator('[name="remark"]').fill(manual);
          await form.locator('[name="remark"]').dispatchEvent('change');
          // A unique compatible node is re-selected implicitly on a new Host.
          await form.locator(`[name="nodes"][value="${hostUniqueNode.id}"]`).evaluate(input=>{input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}))});
          assert.equal(await form.locator('[name="remark"]').inputValue(),manual,'Implicit autofill must preserve the manual remark');
          assert(await form.locator(`[name="nodes"][value="${hostUniqueNode.id}"]`).isChecked(),'Implicit preset must keep the compatible node binding');
          await preset(hostPresetNode.id);
          assert.equal(await form.locator('[name="remark"]').inputValue(),'🇳🇱 '+hostPresetNode.name,'Explicit preset must replace the remark');
          assert.equal(await form.locator('[name="countryCode"]').inputValue(),'NL');
          assert.equal(await form.locator('[name="profileId"]').inputValue(),String(hostTlsProfile.id));
          // Preview is intentionally inert while Connection is selected. Read the
          // visible Preview task rather than innerText of a hidden tab panel.
          await form.locator('[data-host-editor-tab="preview"]').click();
          assert((await form.locator('[data-host-resolved]').innerText()).includes(hostPresetNode.addr),'Client preview must follow preset changes');
          await form.locator('[data-host-editor-tab="connection"]').click();
          await form.locator('[name="remark"]').focus();await page.keyboard.press('Tab');
          assert(await form.locator('[name="address"]').evaluate(input=>input===document.activeElement),'Keyboard order must remain remark → address');
          assert.equal(await page.locator('html').getAttribute('data-surface'),surface);
          const g=await geometry(page);assert(g.scrollWidth<=g.viewport.width+1,'Host editor must fit mobile and desktop');
          await screenshot(page,`host-module-${surface}-${language}`);
          await page.keyboard.press('Escape');await form.waitFor({state:'hidden'});
        });
      }finally{
        if(await page.locator('#dlg[open]').count())await page.keyboard.press('Escape');
        await page.evaluate(initial=>{C.surface=initial.surface;apply();XMeshI18n.setLanguage(initial.language)},hostAppearance);
      }
      await checked('Host module: create/edit persistence and local X25519 derivation',async()=>{
        // Public RFC 7748 Alice test vector, never a production credential.
        const privateKey=Buffer.from('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a','hex').toString('base64url');
        const publicKey=Buffer.from('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a','hex').toString('base64url');
        const realityProfile=await create('profiles',{name:prefix+' Reality host',config:JSON.stringify({inbounds:[{tag:prefix+'-reality-host',listen:'127.0.0.1',port:29444,protocol:'vless',settings:{clients:[],decryption:'none'},streamSettings:{network:'tcp',security:'reality',realitySettings:{target:'www.microsoft.com:443',serverNames:['reality.example.invalid'],privateKey,shortIds:['0123456789abcdef']}}}],outbounds:[{tag:'direct',protocol:'freedom'}]})});
        const realityNode=await create('nodes',{name:prefix+' Germany Premium',addr:'192.0.2.61',port:443,profileId:realityProfile.id,flag:'DE'});
        await page.setViewportSize({width:1920,height:1080});await navigate('hosts');await page.reload({waitUntil:'domcontentloaded'});
        await page.locator('[data-ne="hosts"]').first().click();const form=page.locator('#dlg form[data-ent="hosts"]');
        const fpOptions=await form.locator('[name="fp"] option').evaluateAll(options=>options.map(option=>({value:option.value,label:option.textContent.trim()})));
        assert.equal(fpOptions.filter(option=>option.value==='chrome').length,1,'Host fingerprint must show chrome only once');
        assert(!fpOptions.some(option=>option.value===''),'Host fingerprint must not duplicate chrome as an empty default');
        assert.equal(fpOptions.find(option=>option.value==='chrome').label,'chrome');
        assert.equal(await form.locator('[name="fp"]').inputValue(),'chrome','New Host must select chrome automatically');
        await form.locator('[name="fp"]').evaluate(select=>{select.value='firefox';select.dispatchEvent(new Event('input',{bubbles:true}))});
        assert.equal(await form.locator('[name="fp"]').inputValue(),'firefox');
        await form.locator('[data-host-editor-tab="client"]').click();
        await form.locator('[data-host-clear-overrides]').click();
        assert.equal(await form.locator('[name="fp"]').inputValue(),'chrome','Reset overrides must restore chrome');
        await page.waitForFunction(()=>document.querySelector('#dlg [name="fp"]')?.closest('.xm-select-shell')?.querySelector('.xm-select-caption')?.textContent==='chrome');
        await form.locator('[data-host-editor-tab="connection"]').click();
        await form.locator('[data-host-node-preset]').evaluate((select,id)=>{select.value=String(id);select.dispatchEvent(new Event('change',{bubbles:true}))},realityNode.id);
        await page.waitForFunction(expected=>document.querySelector('#dlg [name="publicKey"]')?.value===expected,publicKey);
        assert.equal(await form.locator('[name="remark"]').inputValue(),'🇩🇪 '+realityNode.name);
        assert.equal(await form.locator('[name="countryCode"]').inputValue(),'DE');
        assert(!(await form.innerHTML()).includes(privateKey),'REALITY private key must never enter the Host DOM');
        assert.equal(await form.locator('[name="privateKey"]').count(),0);
        await form.locator('[data-host-editor-tab="client"]').click();
        await form.locator('[name="sni"]').fill('tabs.example.invalid');
        await form.locator('[name="fp"]').evaluate(el=>{el.value='firefox';el.dispatchEvent(new Event('change',{bubbles:true}))});
        await form.locator('[data-host-editor-tab="preview"]').click();
        const creation=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/collections/hosts');
        await form.locator('.act button.btn').click();const createdResponse=await creation;
        assert(createdResponse.ok(),'Host creation must retain submit/validation behavior');const createdHost=await createdResponse.json();fixtures.push({collection:'hosts',id:createdHost.id});
        assert(!JSON.stringify(createdResponse.request().postDataJSON()).includes(privateKey),'Host API payload must contain no server private key');
        assert.equal(createdHost.publicKey,publicKey);assert.equal(createdHost.countryCode,'DE');
        assert.equal(createdHost.sni,'tabs.example.invalid');assert.equal(createdHost.fp,'firefox','Save from Preview must include inactive Client settings');
        assert.deepEqual(createdHost.nodes,[realityNode.id]);
        await page.locator(`[data-host-card-id="${createdHost.id}"] .host-card-edit`).click();
        assert.equal(await form.locator('[name="remark"]').inputValue(),'🇩🇪 '+realityNode.name,'Edit must restore the saved remark');
        assert.equal(await form.locator('[name="publicKey"]').inputValue(),publicKey);
        assert.equal(await form.locator('[name="sni"]').inputValue(),'tabs.example.invalid','Reopening must retain inactive client values');
        await form.locator('[name="remark"]').fill(prefix+' edited host');
        const editing=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/api/v1/collections/hosts/'+createdHost.id);
        await form.locator('.act button.btn').click();const editedResponse=await editing;
        assert(editedResponse.ok(),'Host edit must submit successfully');const edited=await editedResponse.json();
        assert.equal(edited.remark,prefix+' edited host');assert.equal(edited.publicKey,publicKey);assert.equal(edited.countryCode,'DE');
        await page.locator(`[data-host-card-id="${createdHost.id}"] .host-card-edit`).click();
        assert.equal(await form.locator('[name="remark"]').inputValue(),prefix+' edited host','Saved manual changes must survive reopening');
        await page.keyboard.press('Escape');
      });

    }finally{
      if(await page.locator('#dlg[open]').count())await page.keyboard.press('Escape');
      // Extra Host fixtures must not change the inventory used by subsequent
      // Squad geometry checks. Remove only this case's tracked records.
      const temporary=fixtures.slice(hostModuleFixtureStart);
      for(const collection of ['hosts','nodes','profiles'])for(const fixture of temporary.filter(f=>f.collection===collection)){
        await api('DELETE',`/collections/${collection}/${fixture.id}`);
        fixtures.splice(fixtures.indexOf(fixture),1);
      }
    }

    await create('profiles',{name:`${prefix} · populated squad`,config:JSON.stringify({inbounds:['hysteria-main','masque-main','shadowsocks-main','trojan-main','vless-main'].map((tag,i)=>({tag:prefix+'-'+tag,listen:'127.0.0.1',port:29000+i,protocol:'vless',settings:{clients:[],decryption:'none'},streamSettings:{network:'tcp',security:'none'}})),outbounds:[{tag:'direct',protocol:'freedom'}]})});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!document.querySelector('#view')?.children.length&&!document.querySelector('#view .sk'));
    for(const [width,height] of [[1920,1080],[2560,1440],[1366,768],[390,844]]) await checked(`Populated Squad composition: ${width}×${height}`,async()=>{
      try {
      await page.setViewportSize({width,height});
      await navigate('squads');
      await page.locator('[data-ne="squads"]').first().click();
      await page.waitForSelector('.squad-inbound-row');
      const count=await page.locator('.squad-inbound-row').count();
      assert(count>=6,'Fixture must exercise a populated inbound list');
      const profileFilter=page.locator('[data-squad-profile]');
      await page.locator('.squad-profile-filter .xm-select-trigger').waitFor({state:'visible'});
      assert(await page.locator('.squad-profile-filter .xm-select-trigger').isVisible(),'Xray profile filter must retain the shared Nexus selector');
      const profileRows=page.locator('[data-squad-option]');
      const tagged=profileRows.filter({has:page.locator('input[name="inb"][value="'+prefix+'-hysteria-main"]')});
      const profileId=String(await tagged.getAttribute('data-squad-profiles')).split('|')[0];
      assert(profileId,'Known inbound must have an owning Xray profile');
      await profileFilter.selectOption(profileId);
      assert(await tagged.isVisible(),'Profile filter must retain matching inbound');
      const filteredCount=await page.locator('.squad-inbound-row:visible').count();
      assert(filteredCount>=5&&filteredCount<count,'Profile filter must narrow choices without deleting them');
      await page.locator('[data-squad-select="all"]').click();
      assert.equal(await page.locator('input[name="inb"]:checked').count(),filteredCount,'Select all must respect active profile filter');
      await profileFilter.selectOption('');
      assert.equal(await page.locator('input[name="inb"]:checked').count(),filteredCount,'Changing filter must preserve selected inbound');
      await page.locator('[data-squad-select="clear"]').click();
      assert.equal(await page.locator('input[name="inb"]:checked').count(),0,'Clear must affect all selections');
      assert.equal(await page.locator('.squad-editor-main .node-form-section-title .ic').count(),1,'Main section must retain native icon');
      assert.equal(await page.locator('.squad-editor-connections .node-form-section-title .ic').count(),1,'Connection section must retain native icon');
      assert.equal(await page.locator('.squad-editor-side .node-form-section-title .ic').count(),1,'Impact section must retain native icon');
      assert.equal(await page.locator('.squad-preview-stat > svg.ic').count(),4,'Impact metrics must use semantic Nexus icons');
      const details=page.locator('.squad-preview-details');
      assert.equal(await details.count(),1,'Impact panel must have one optional details disclosure');
      assert.equal(await details.evaluate(el=>el.open),false,'Impact names must be collapsed by default');
      assert.equal(await details.locator('.squad-preview-section:visible').count(),0,'No full user or host lists in the default summary');
      await details.locator('summary').click();
      assert.equal(await details.evaluate(el=>el.open),true,'Details should expand on one click');
      await details.locator('summary').click();
      assert.equal(await details.evaluate(el=>el.open),false,'Details should collapse again');

      if(height>=1080){
        const initial=await page.locator('.squad-editor-layout').evaluate(el=>({scroll:el.scrollHeight,client:el.clientHeight}));
        assert(initial.scroll<=initial.client+1,'New squad with no selected inbound must fit without a small workspace scrollbar: '+JSON.stringify(initial));
        await screenshot(page,`squad-create-unselected-${width}x${height}`);
      }
      await page.locator('[data-squad-select="all"]').click();
      assert.equal(await page.locator('input[name="inb"]:checked').count(),count,'Select all must still work');
      // Search the inbound choices inside the editor, not the separate
      // directory-wide squad search in the background page.
      const inboundSearch=page.locator('#dlg form[data-ent="squads"] [data-squad-inbound-search]');
      await inboundSearch.fill('hysteria-main');
      assert.equal(await page.locator('#dlg .squad-inbound-row:visible').count(),1,'Search must filter actual inbound choices');
      await inboundSearch.fill('');
      await page.locator('[data-squad-select="clear"]').click();
      assert.equal(await page.locator('input[name="inb"]:checked').count(),0,'Clear must still work');
      await details.locator('summary').click();
      assert.equal(await details.evaluate(el=>el.open),true);
      await page.locator('.squad-inbound-row').first().click();
      assert.equal(await details.evaluate(el=>el.open),true,'Recalculating impact must preserve expanded state');
      await details.locator('summary').click();
      assert.equal(await details.evaluate(el=>el.open),false,'Compact summary should be restored');
      await page.locator('input[name="name"]').fill('Squad layout check');
      const g=await page.locator('#dlg').evaluate(d=>{
        const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
        const q=s=>d.querySelector(s),list=q('.squad-inbound-list'),body=q('.squad-editor-layout');
        const button=q('button.btn'),cs=getComputedStyle(button);
        return {dialog:box(d),main:box(q('.squad-editor-main')),connections:box(q('.squad-editor-connections')),impact:box(q('.squad-editor-side')),body:box(body),footer:box(q('.act')),list:box(list),listScroll:list.scrollHeight,listClient:list.clientHeight,bodyScroll:body.scrollHeight,bodyClient:body.clientHeight,rows:[...list.children].map(box),button:{color:cs.color,background:cs.backgroundColor,disabled:button.disabled}};
      });
      await screenshot(page,`squad-populated-${width}x${height}`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('dialog[open]',{state:'detached'});
      assert(g.dialog.y>=0&&g.dialog.bottom<=height+1,'Squad dialog must fit viewport');
      assert(g.body.bottom<=g.footer.y+1,'Footer must not overlay body');
      assert(g.listScroll<=g.listClient+1,'Inbound list must not create a nested scrollbar');
      assert(!g.button.disabled,'Valid squad must enable save');
      assert.notEqual(g.button.color,g.button.background,'Save must retain visible foreground');
      if(width>=1366){
        assert(g.main.right<g.connections.x,'Settings and connections must occupy separate columns');
        assert(g.impact.x===g.main.x&&g.impact.y>=g.main.bottom,'Impact must follow settings without stretching the settings panel');
        assert(g.connections.width>g.main.width*1.5,'Inbound selection must receive most of the workspace width');
        assert(g.main.height<g.connections.height,'Two settings must not stretch to the height of the inbound list');
      }
      if(width<980){
        assert(g.connections.y>=g.main.bottom,'Mobile settings must not overlap connections');
        assert(g.impact.y>=g.connections.bottom,'Mobile connections must not overlap impact');
      }
      if(height>=1080) assert(g.bodyScroll<=g.bodyClient+1,'Normal populated squad must fit desktop without scrolling');
      return g;
      } finally {
        await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
      }
    });

    assert.equal(report.javascriptErrors.length,0,'В браузере возникли JavaScript ошибки.');
  } finally {
    const order=['users','tpls','hosts','nodes','squads','profiles'];
    for(const collection of order) for(const fixture of fixtures.filter(f=>f.collection===collection)) {
      try { await api('DELETE',`/collections/${fixture.collection}/${fixture.id}`); }
      catch(error) { report.failures.push({label:'Очистка тестовых данных',error:shortError(error)}); }
    }
    await browser.close();
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  }
  console.log(`Браузер: ${report.checks.length} проверок пройдено, ${report.failures.length} ошибок, ${report.screenshots.length} снимков.`);
  console.log(`Результаты: ${output}`);
  if(report.failures.length)process.exitCode=1;
}

main().catch(error=>{
  console.error(shortError(error));
  process.exitCode=1;
});
