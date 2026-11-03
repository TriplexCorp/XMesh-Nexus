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
    report.failures.push({label, error: shortError(error)});
    console.error(`ОШИБКА: ${label}: ${shortError(error)}`);
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
    const columns = [...document.querySelectorAll('.appearance-column')].map(node => ({...box(node),display:getComputedStyle(node).display,cards:[...node.querySelectorAll(':scope > .card')].map(box)}));
    const nodeCards = [...document.querySelectorAll('#view .nodes > .nc')].map(box);
    const ranges = [...document.querySelectorAll('.appearance-layout input[type=range]')].map(box);
    const top = document.querySelector('.top');
    const root = document.documentElement;
    return {
      viewport:{width:innerWidth,height:innerHeight},rootFont:parseFloat(getComputedStyle(root).fontSize),scrollWidth:root.scrollWidth,
      view:view && box(view),top:top && box(top),outside,columns,nodeCards,ranges,nodeGridMode:document.querySelector('.nodes')?.dataset.gridMode,
      cards:[...(view?.querySelectorAll('.card') || [])].map(box),
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
    assert.equal(g.columns.length, 2, 'Settings должна содержать два явных стека карточек.');
    assert(g.columns.every(c => c.display !== 'contents'), 'Стек Settings потерял собственную геометрию.');
    const sideBySide=Math.abs(g.columns[0].x-g.columns[1].x)>100;
    if(g.viewport.width>=1500)assert(sideBySide,'На широком desktop Settings превратилась в одну длинную колонку.');
    if(sideBySide)assert(g.columns.every(c => c.width >= 360), 'Settings превратилась в узкие вертикальные башни.');
    else assert(g.columns.every(c => c.width >= Math.min(720,g.view.width*.72)), 'Адаптивный стек Settings стал неоправданно узким.');
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
    await page.goto(base + dashboard + '#' + route, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => !!document.querySelector('#view')?.children.length && !document.querySelector('#view .sk'));
    await page.waitForTimeout(150);
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
    const profile = await create('profiles',{name:`${prefix} · Профиль`,config:JSON.stringify({inbounds:[{tag:inboundTag,listen:'127.0.0.1',port:28352,protocol:'vless',settings:{decryption:'none',clients:[]},streamSettings:{network:'tcp',security:'none'}}],outbounds:[{tag:'direct',protocol:'freedom'}]})});
    const node = await create('nodes',{name:`${prefix} · Москва`,addr:'192.0.2.10',flag:'🇵🇱',port:443,xrayLocalPort:13456,mult:1,limit:0,resetDay:1,profileId:profile.id,rotationEnabled:false,rotationIntervalHours:24,rotationIps:'',billingCurrency:'EUR',billingPeriod:'monthly',billingRemindDays:7,billingPrice:0,hosting:'Datagio',tlsManualProvision:true,geoEnabled:true});
    const squad = await create('squads',{name:`${prefix} · Сквад`,desc:'Данные браузерной проверки',inb:[inboundTag]});
    await create('hosts',{remark:`${prefix} · Хост`,profileId:profile.id,tag:inboundTag,address:'ui.example.invalid',port:443,nodes:[node.id]});
    const user = await create('users',{username:`${prefix}-client`,squads:[squad.id],hwid:2,created:Date.now(),adminId:1});
    const otherUser = await create('users',{username:`${prefix}-other`,squads:[squad.id],hwid:2,created:Date.now(),adminId:1});
    await create('tpls',{name:`${prefix} · Standard`,limit:30,days:30,strategy:'NO_RESET',hwid:2,squads:[squad.id]});
    const fixtureBootstrap=await api('GET','/bootstrap');
    assert(fixtureBootstrap.collections?.profiles?.some(item=>item.id===profile.id),'Bootstrap не увидел тестовый профиль.');
    assert(fixtureBootstrap.collections?.nodes?.some(item=>item.id===node.id),'Bootstrap не увидел тестовый узел.');
    assert(fixtureBootstrap.collections?.users?.some(item=>item.id===user.id),'Bootstrap не увидел тестового пользователя.');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => !!document.querySelector('#view')?.children.length && !document.querySelector('#view .sk'));

    for (const [width,height] of sizes) {
      await page.setViewportSize({width,height});
      for (const route of routes) await checked(`${route}: ${width}×${height}`, async () => {
        await navigate(route);
        const g = await geometry(page);
        if (['set','nodes'].includes(route) || width === 390 || width === 768 || width === 1440 || width === 1920 || width === 3440) await screenshot(page,`${route}-${width}`);
        if(width<1000){
          assert(!g.renderFailed,'Mobile route must render');
          assert(g.scrollWidth<=width+1,'Mobile document must not overflow horizontally: '+JSON.stringify({width:g.scrollWidth,outside:g.outside}));
          assert(g.view.x>=0&&g.view.right<=width+1,'Mobile workspace must stay in viewport');
        }else verifyPage(g,route);
        return g;
      });
    }

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

    for(const [width,height] of [[1920,1080],[2560,1440],[3440,1440]]) await checked(`Reference User Details: ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});
      await navigate('users');
      await page.locator(`tr[data-id="${user.id}"]`).click();
      await page.waitForSelector('dialog[open] .user-canvas');
      await page.waitForTimeout(150);
      const g=await page.locator('#dlg').evaluate(dialog=>{
        const box=el=>{const r=el.getBoundingClientRect();return {y:r.y,bottom:r.bottom,height:r.height}};
        const q=s=>dialog.querySelector(s),body=q('.user-canvas-grid');
        return {dialog:box(dialog),header:box(q('.user-head')),footer:box(q('.user-canvas-foot')),body:box(body),scrollTop:body.scrollTop,scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,
          panes:[...body.children].map(box),headings:[...body.querySelectorAll('.user-pane-heading:first-child')].map(box),
          controls:[...q('.user-head-actions').children].map(box),usage:box(q('.user-usage-line')),identity:box(q('.user-identity-row')),
          maxHeight:getComputedStyle(dialog).maxHeight,rem:parseFloat(getComputedStyle(document.documentElement).fontSize),
          paneScrolls:[...body.children].filter(p=>getComputedStyle(p).overflowY==='auto'||getComputedStyle(p).overflowY==='scroll').length};
      });
      assert.equal(g.scrollTop,0,'Body must start at top');
      assert(Math.max(...g.panes.map(r=>r.y))-Math.min(...g.panes.map(r=>r.y))<=4,'Three columns must start together');
      assert(g.headings.every(r=>r.y>=g.body.y),'Initial headings must not be clipped');
      assert(g.dialog.y>=0&&g.dialog.bottom<=height+1&&g.dialog.height<=height-1.5*g.rem+1,'Dialog must fit the available viewport height');
      assert(g.header.y>=g.dialog.y&&g.footer.bottom<=height,'Header/footer must remain visible');
      assert(g.body.bottom<=g.footer.y+1,'Body must not overlap footer');
      const centers=g.controls.map(r=>r.y+r.height/2);
      assert(Math.max(...centers)-Math.min(...centers)<=3,'Header controls must share a vertical axis');
      assert(Math.abs(g.usage.y+g.usage.height/2-g.identity.y-g.identity.height/2)<=3,'Usage and Xray ID must align');
      assert.equal(g.paneScrolls,0,'Columns must not own individual scrollbars');
      if(height>=1440) assert(g.scrollHeight<=g.clientHeight+1,'Content must fit without scrolling when viewport height is sufficient');
      assert(g.dialog.bottom-g.footer.bottom<=2*g.rem,'Dialog must not leave a large empty area below its footer');
      await screenshot(page,`user-details-${width}x${height}`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!document.querySelector('#dlg')?.open);
      return g;
    });

    await checked('User Details: scroll resets when reopening another user',async()=>{
      await page.setViewportSize({width:1920,height:650});
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

    for(const [width,height] of [[390,844],[768,1024]]) await checked(`User Details stacked panes: ${width}×${height}`,async()=>{
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
      assert.equal(g.scrollTop,0);
      assert(g.scrollHeight>g.clientHeight,'Stacked panes must use the workspace scroll owner');
      for(let i=1;i<g.panes.length;i++){
        assert(Math.abs(g.panes[i].x-g.panes[0].x)<=3,'Narrow panes must use one column');
        assert(g.panes[i].y>=g.panes[i-1].bottom-1,'Stacked panes must not overlap');
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
      await navigate('set');
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
      await navigate('set');
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
      await navigate('set');
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
      await page.locator('[data-stats-user-tab="history"]').click();
      await screenshot(page,'dialog-user-intelligence-history');
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
      await navigate('set');
      await page.locator(`[data-th="${theme}"]`).click();
      for (const [key,value] of [['surface',surface],['sidebar',sidebar],['density',density]]) await page.locator(`[data-ui="${key}"][data-value="${value}"]`).click();
      const palette=page.locator(`[data-ac="${accent}"]`);
      assert.equal(await palette.count(),1, `Палитра ${accent} отсутствует.`);
      await palette.click();
      for (const route of ['set','nodes','users','profiles']) {
        await navigate(route);
        const g=await geometry(page);
        assert.equal(g.material.surface,surface);
        assert.equal(g.material.sidebar,sidebar);
        assert.equal(g.material.density,density);
        assert.equal(g.material.theme,theme === 'auto' ? 'light' : theme);
        assert(g.scrollWidth<=1921, 'Изменение оформления вызвало горизонтальную прокрутку.');
        assert.equal(g.outside.length,0,'Изменение оформления обрезало элементы управления.');
        if (route==='set' || route==='nodes') await screenshot(page,`${route}-${theme}-${surface}-${sidebar}`);
      }
    });

    await navigate('set');
    for (const [key,value] of [['surface','solid'],['sidebar','standard'],['density','comfortable']]) await page.locator(`[data-ui="${key}"][data-value="${value}"]`).click();
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
      await navigate('set');
      await page.locator('#core-message').evaluate(el=>{el.textContent='Update request failed: https://example.invalid/releases/'+('abcdef0123456789'.repeat(40))});
      const g=await geometry(page);
      assert(g.scrollWidth<=391,'Long updater feedback must wrap without expanding the document');
      const hooks=await page.locator('[data-hk]').evaluateAll(inputs=>inputs.map(input=>{
        const row=input.closest('.rowi'),text=row.firstElementChild.getBoundingClientRect(),toggle=input.closest('.sw').getBoundingClientRect();
        return {name:input.dataset.hk,textRight:text.right,toggleLeft:toggle.left,wrapped:row.firstElementChild.scrollWidth<=row.firstElementChild.clientWidth+1};
      }));
      assert(hooks.every(h=>h.wrapped&&h.textRight< h.toggleLeft),'Webhook names must wrap before their switches: '+JSON.stringify(hooks));
      await screenshot(page,'audit-settings-long-feedback-390');
      return g;
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
        await navigate(route);
        await page.locator(selector).first().click();
        await page.waitForSelector('dialog[open]');
        if(route==='squads'){
          const search=await page.locator('[data-squad-search]').evaluate(input=>{const s=getComputedStyle(input),r=input.getBoundingClientRect(),p=input.closest('.search').getBoundingClientRect();return {border:parseFloat(s.borderTopWidth),shadow:s.boxShadow,height:r.height,parentHeight:p.height}});
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
        await page.keyboard.press('Escape');
        await page.waitForSelector('dialog[open]',{state:'detached'});
        return g;
      });
    }

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
      await page.emulateMedia({reducedMotion:'no-preference'});
      await navigate('statistics');
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
    });

    await checked('Редактирование узла сохраняется через API',async()=>{
      await navigate('nodes');
      await page.locator(`[data-ne="nodes:${node.id}"]`).click();
      const form=page.locator('dialog form[data-ent="nodes"]');
      await form.locator('input[name="name"]').fill(`${prefix} · Изменён`);
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
    });

    await create('nodes',{name:`${prefix} · Берлин`,addr:'192.0.2.11',port:443,profileId:profile.id});
    await checked('Two nodes: bounded cards/actions and global radius on ultrawide',async()=>{
      await page.setViewportSize({width:3440,height:1440});
      await navigate('set');
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
        await navigate('set');
        await page.locator('#radius').evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))},radius);
        await navigate('nodes');
        const actual=await page.locator('.nc').first().evaluate(card=>({card:parseFloat(getComputedStyle(card).borderTopLeftRadius),button:parseFloat(getComputedStyle(card.querySelector('.acts>button')).borderTopLeftRadius)}));
        assert.equal(actual.card,radius);assert.equal(actual.button,radius);radii.push(actual);
      }
      await navigate('set');
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
    for(let i=0;i<4;i++)hostPresetNode=await create('nodes',{name:`${prefix} · Сервер ${i+1}`,addr:`192.0.2.${30+i}`,port:443,profileId:hostTlsProfile.id});
    await create('nodes',{name:`${prefix} · Отключён`,addr:'192.0.2.50',port:443,profileId:profile.id,disabled:true,tlsManualProvision:true});
    await create('nodes',{name:`${prefix} · Без телеметрии`,addr:'192.0.2.51',port:443,profileId:profile.id,disabled:true});
    // Transport fixtures exercise the real renderer/live refresh without
    // activating a node or writing synthetic telemetry to the backend.
    const runtimePattern=/\/api\/v1\/nodes\/\d+\/runtime(?:\?.*)?$/;
    const runtimeFixture=async route=>{
      if(new URL(route.request().url()).pathname!==`/api/v1/nodes/${node.id}/runtime`)return route.continue();
      await route.fulfill({json:{connected:true,version:'control-v6.0.7',xrayVersion:'26.10.31',xrayRunning:true,routerRunning:true,desiredRevisionSource:'current',desiredRevision:'fixture',appliedRevision:'fixture',tlsStatus:{state:'valid',daysRemaining:87},geoData:{state:'current',files:{geoip:{},geosite:{}}}}});
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
      await navigate('set');
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
      await navigate('set');
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
      assert.equal(await page.locator('[name="profileId"]').inputValue(),String(hostTlsProfile.id),'Node preset must retain profile binding');
      assert.equal(await page.locator('[name="profileId"]').evaluate(select=>select.closest('.xm-select-shell').querySelector('.xm-select-caption').textContent),hostTlsProfile.name,'Visible profile caption must match preset binding');
      await page.locator('[name="remark"]').focus();
      const focus=await page.locator('[name="remark"]').evaluate(input=>{const s=getComputedStyle(input);return {style:s.outlineStyle,offset:parseFloat(s.outlineOffset),shadow:s.boxShadow}});
      assert.equal(focus.style,'solid','Text fields must keep visible keyboard focus');
      assert(focus.offset<=0,'Focus must stay inside the control without a detached double contour');
      assert.equal(focus.shadow,'none','Text fields must not add a second focus shadow');
      await screenshot(page,`audit-focus-host-${width}`);
      await page.locator('[name="sni"]').fill('override.example.invalid');
      await page.locator('[name="sni"]').dispatchEvent('change');
      assert((await page.locator('[data-host-resolved]').innerText()).includes('override.example.invalid'),'Live preview must reflect SNI override');
      await page.locator('[data-host-clear-overrides]').click();
      assert.equal(await page.locator('[name="sni"]').inputValue(),'','Reset must clear overrides');
      await page.locator('[data-host-copy-value^="/host-preview/"]').click();
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'/host-preview/'+('long-segment-'.repeat(24)),'Copy must preserve the entire long path');
      await page.waitForFunction(()=>!document.getElementById('xmesh-feedback-toast')?.matches(':popover-open'));
      await page.locator('.host-editor-layout').evaluate(body=>{body.scrollTop=0});
      const g=await page.locator('#dlg').evaluate(d=>{
        const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
        const q=s=>d.querySelector(s),primary=q('.host-primary-panel'),advanced=q('.host-advanced-panel'),preview=q('.host-editor-side');
        return{dialog:box(d),primary:box(primary),advanced:box(advanced),preview:box(preview),assignment:box(q('.host-assignment-panel')),body:box(q('.host-editor-layout')),footer:box(q('.act')),port:box(q('[name="port"]')),country:box(q('[name="countryCode"]')),address:box(q('[name="address"]')),publicFields:box(q('.host-public-fields')),bodyScroll:q('.host-editor-layout').scrollHeight,bodyClient:q('.host-editor-layout').clientHeight,copyValues:[...d.querySelectorAll('[data-host-copy-value]')].map(button=>button.dataset.hostCopyValue),icons:[primary,advanced,preview].map(p=>!!p.querySelector('.node-form-section-title svg')),choices:[...d.querySelectorAll('.ms label')].map(box)};
      });
      await screenshot(page,`host-redesign-${width}x${height}`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('dialog[open]',{state:'detached'});
      assert(g.icons.every(Boolean),'Three editor zones must retain semantic SVG headings');
      assert(g.dialog.y>=0&&g.dialog.bottom<=height+1,'Host editor must fit viewport');
      assert(g.body.bottom<=g.footer.y+1,'Footer must not cover fields');
      if(width>=1920){
        assert(g.primary.right<g.advanced.x&&g.advanced.right<g.preview.x,'Desktop must keep three distinct editing zones');
        assert(Math.abs(g.port.y-g.country.y)<=3,'Paired public fields must share a baseline');
        assert(g.address.width>=g.publicFields.width*.4,'Paired public endpoint must retain readable width');
        assert(g.choices.length>=5,'Fixture must show a real node fleet');
        assert(g.assignment.y>=Math.max(g.primary.bottom,g.advanced.bottom),'Assignments must follow editable fields without waiting for preview height');
        assert(Math.abs(g.assignment.x-g.primary.x)<=2&&Math.abs(g.assignment.right-g.advanced.right)<=2,'Assignments must span the editable workspace beside preview');
        assert(g.bodyScroll<=g.bodyClient+1,'Populated TLS/XHTTP Host editor must fit desktop without workspace scrolling');
        assert(g.copyValues.includes('/host-preview/'+('long-segment-'.repeat(24))),'Full long path must remain available to copy');
      }else assert(g.assignment.y>=g.primary.bottom&&g.advanced.y>=g.assignment.bottom&&g.preview.y>=g.advanced.bottom,'Mobile sections must not overlap');
      return g;
    });

    await create('profiles',{name:`${prefix} · populated squad`,config:JSON.stringify({inbounds:['hysteria-main','masque-main','shadowsocks-main','trojan-main','vless-main'].map((tag,i)=>({tag:prefix+'-'+tag,listen:'127.0.0.1',port:29000+i,protocol:'vless',settings:{clients:[],decryption:'none'},streamSettings:{network:'tcp',security:'none'}})),outbounds:[{tag:'direct',protocol:'freedom'}]})});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!document.querySelector('#view')?.children.length&&!document.querySelector('#view .sk'));
    for(const [width,height] of [[1920,1080],[2560,1440],[1366,768],[390,844]]) await checked(`Populated Squad composition: ${width}×${height}`,async()=>{
      await page.setViewportSize({width,height});
      await navigate('squads');
      await page.locator('[data-ne="squads"]').first().click();
      await page.waitForSelector('.squad-inbound-row');
      const count=await page.locator('.squad-inbound-row').count();
      assert(count>=6,'Fixture must exercise a populated inbound list');
      await page.locator('[data-squad-select="all"]').click();
      assert.equal(await page.locator('input[name="inb"]:checked').count(),count,'Select all must still work');
      await page.locator('[data-squad-search]').fill('hysteria-main');
      assert.equal(await page.locator('.squad-inbound-row:visible').count(),1,'Search must filter actual inbound choices');
      await page.locator('[data-squad-search]').fill('');
      await page.locator('[data-squad-select="clear"]').click();
      assert.equal(await page.locator('input[name="inb"]:checked').count(),0,'Clear must still work');
      await page.locator('.squad-inbound-row').first().click();
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
