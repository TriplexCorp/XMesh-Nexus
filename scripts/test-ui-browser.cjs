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

const sizes = [[1366,768], [1440,900], [1920,1080], [2560,1440], [3440,1440], [3840,2160]];
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
      viewport:{width:innerWidth,height:innerHeight},scrollWidth:root.scrollWidth,
      view:view && box(view),top:top && box(top),outside,columns,nodeCards,ranges,
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
    // At the ordinary desktop scale both columns fit even at 1366px. The
    // enlarged interface is allowed to reflow in separate accessibility cases.
    assert(Math.abs(g.columns[0].x - g.columns[1].x) > 100, 'Settings превратилась в одну длинную колонку.');
    assert(g.columns.every(c => c.width >= 360), 'Settings превратилась в узкие вертикальные башни.');
    for (const column of g.columns) for (let i=1;i<column.cards.length;i++) {
      const gap = column.cards[i].y - column.cards[i-1].bottom;
      assert(gap >= -1 && gap <= 48, `Искусственный вертикальный разрыв между карточками: ${gap}px.`);
    }
    assert(g.ranges.every(r => r.width <= 660), 'Ползунок растянут на чрезмерную ширину.');
  }
  if (route === 'nodes' && g.nodeCards.length === 1) {
    assert(g.nodeCards[0].y - g.view.y < 230, 'Toolbar и счётчик занимают слишком много высоты перед одним узлом.');
    assert(g.nodeCards[0].width > g.view.width * .7, 'Единственный узел остался узким островком.');
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
    await api('POST','/auth/login',{username,password});
    dashboard = (await api('GET','/security/policy')).policy.dashboardPath;
    // Exercise the real login form, not only cookie injection into a browser.
    await context.clearCookies();
    await page.goto(base + dashboard, {waitUntil:'domcontentloaded'});
    await page.locator('#username').fill(username);
    await page.locator('#password').fill(password);
    await page.locator('#submit').click();
    await page.waitForSelector('#nav');
    await checked('Вход через форму',async () => {
      assert.equal(await page.locator('#login-form').count(),0);
      assert(await page.locator('#view').isVisible());
    });
    const inboundTag = prefix.replace(/-/g,'_');
    const profile = await create('profiles',{name:`${prefix} · Профиль`,config:JSON.stringify({inbounds:[{tag:inboundTag,listen:'127.0.0.1',port:28352,protocol:'vless',settings:{decryption:'none',clients:[]},streamSettings:{network:'tcp',security:'none'}}],outbounds:[{tag:'direct',protocol:'freedom'}]})});
    const node = await create('nodes',{name:`${prefix} · Москва`,addr:'192.0.2.10',profileId:profile.id});
    const squad = await create('squads',{name:`${prefix} · Сквад`,desc:'Данные браузерной проверки',inb:[inboundTag]});
    await create('hosts',{remark:`${prefix} · Хост`,profileId:profile.id,tag:inboundTag,address:'ui.example.invalid',port:443,nodes:[node.id]});
    const user = await create('users',{username:`${prefix}-client`,squads:[squad.id],hwid:2});

    for (const [width,height] of sizes) {
      await page.setViewportSize({width,height});
      for (const route of routes) await checked(`${route}: ${width}×${height}`, async () => {
        await navigate(route);
        const g = await geometry(page);
        if (['set','nodes'].includes(route) || width === 1440 || width === 3440) await screenshot(page,`${route}-${width}`);
        verifyPage(g,route);
        return g;
      });
    }

    // Real Settings controls change appearance. Cover representative combinations
    // instead of pretending an enormous Cartesian product improves assurance.
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
        // Dense and spacious modes may reflow Settings by actual container width.
        assert(g.scrollWidth<=1921, 'Изменение оформления вызвало горизонтальную прокрутку.');
        assert.equal(g.outside.length,0,'Изменение оформления обрезало элементы управления.');
        if (route==='set' || route==='nodes') await screenshot(page,`${route}-${theme}-${surface}-${sidebar}`);
      }
    });

    // Restore ordinary scale before viewport-safety checks of long create/edit
    // forms and user drawer. No form is saved except the owned node edit below.
    await navigate('set');
    for (const [key,value] of [['surface','solid'],['sidebar','standard'],['density','comfortable']]) await page.locator(`[data-ui="${key}"][data-value="${value}"]`).click();
    await page.locator('[data-th="dark"]').click();
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

    // Validate real edit behavior without altering any pre-existing record.
    await checked('Редактирование узла сохраняется через API',async()=>{
      await navigate('nodes');
      await page.locator(`[data-ne="nodes:${node.id}"]`).click();
      await page.locator('dialog form input[name="name"]').fill(`${prefix} · Изменён`);
      await page.locator('dialog form button[type="submit"]').click();
      await page.waitForSelector('dialog[open]',{state:'detached'});
      const saved=await api('GET','/collections/nodes');
      assert(saved.items.some(n=>n.id===node.id&&n.name===`${prefix} · Изменён`));
    });

    // Multi-card composition is checked with a real second and third node.
    await create('nodes',{name:`${prefix} · Берлин`,addr:'192.0.2.11',profileId:profile.id});
    await create('nodes',{name:`${prefix} · Амстердам`,addr:'192.0.2.12',profileId:profile.id});
    for(const width of [1366,1920,3440]) await checked(`Коллекция узлов: ${width}px`,async()=>{
      await page.setViewportSize({width,height:1080});
      await navigate('nodes');
      const g=await geometry(page);
      verifyPage(g,'nodes');
      assert(g.nodeCards.length>=3);
      assert(g.nodeCards.every(c=>c.width>=300),'Карточки коллекции стали слишком узкими.');
      await screenshot(page,`nodes-multiple-${width}`);
      return g;
    });

    assert.equal(report.javascriptErrors.length,0,'В браузере возникли JavaScript ошибки.');
  } finally {
    // Delete in dependency order; preserve any pre-existing data. Error details
    // deliberately omit API response bodies, which can contain credentials.
    const order=['users','hosts','nodes','squads','profiles'];
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

main().catch(error=>{console.error(`Браузерная проверка прервана: ${shortError(error)}`);process.exitCode=1;});
