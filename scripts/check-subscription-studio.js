#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const src=fs.readFileSync('subscription-studio.js','utf8');
const css=fs.readFileSync('subscription-studio.css','utf8');
const app=fs.readFileSync('app.js','utf8');
const rust=fs.readFileSync('backend/src/main.rs','utf8');
const html=fs.readFileSync('index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');

new Function(src);
const ctx={window:{}};
vm.runInNewContext(src,ctx);
const studio=ctx.window.XMeshSubscriptionStudio;
assert.equal(typeof studio.create,'function');
assert(studio.hostnameOK('sub.example.com'));
assert(!studio.hostnameOK('https://sub.example.com/'));
assert(studio.pathOK('/subscription'));
assert(!studio.pathOK('/api/v1'));
assert(!studio.pathOK('//s'));

const [view,init]=studio.create({
  brand:'My VPN',
  subscriptionDomain:'sub.example.com',
  subscriptionPath:'/s',
  subscriptionBrand:'<script>alert(1)</script>',
  subscriptionPlacement:'c',
  nodePlacement:'b'
},async()=>{},()=>{},{users:3,nodes:8});
assert.equal(typeof init,'function');
assert.match(view,/SUBSCRIPTION STUDIO/);
assert.match(view,/name="subscriptionDomain"/);
assert.match(view,/name="subscriptionPath"/);
assert.match(view,/name="subscriptionBrand"/);
assert.match(view,/name="subscriptionAccent"/);
assert.match(view,/name="subscriptionTheme"/);
assert.match(src,/preview\.dataset\.portalTheme=d\.subscriptionTheme/);
assert.match(rust,/"subscriptionTheme", &\["dark", "light"\]/);
assert.match(view,/name="subscriptionShowTraffic"/);
assert.match(view,/name="subscriptionShowExpiry"/);
for(const setting of [
 'subscriptionBackground','subscriptionCardColor','subscriptionTextColor',
 'subscriptionLayout','subscriptionCardStyle','subscriptionFont','subscriptionRadius',
 'subscriptionHero','subscriptionCta','subscriptionLogoUrl','subscriptionSupportLabel',
 'subscriptionSupportUrl','subscriptionClientLayout','subscriptionShowApps','subscriptionShowQr',
 'subscriptionShowCopy','subscriptionShowDevices','subscriptionShowStatus','subscriptionShowSupport'
])assert(view.includes('name="'+setting+'"'),'Missing studio setting '+setting);
assert.equal(studio.clientCatalog.length,16,'Built-in client catalog must remain intact');
assert.equal(studio.maxCustomClients,32,'Custom client limit must be bounded');

// Subscription Studio uses the same one-pixel precision as the main radius slider.
assert.match(src,/name="subscriptionRadius" min="0" max="36" step="1"/);

assert.equal(studio.nextCustomClientId([]),'custom-1');
assert.equal(studio.nextCustomClientId([{id:'custom-1'},{id:'custom-3'}]),'custom-2');
assert.equal(studio.appsHeading('ru'),'Приложения для подключения');
assert.equal(studio.appsHeading('en'),'Connection apps');
assert(view.includes('name="subscriptionAppsTitle"'),'Catalog section title must be editable');
assert(view.includes('data-custom-client-add'),'Custom client add button must exist');
assert(view.includes('data-custom-client-editor'),'Custom client editor container must exist');
const [customView]=studio.create({
 subscriptionAppsTitle:'Поддерживаемые клиенты',
 subscriptionCustomClients:[
  {id:'custom-1',name:'My & <Custom> "App"',platforms:'iOS · Android',
   url:'https://example.com/download?os=ios&app=test',enabled:true},
  {id:'custom-2',name:'Disabled Client',platforms:'Windows',url:'',enabled:false}
 ]
},async()=>{},()=>{},{users:0,nodes:0});
assert.match(customView,/name="subscriptionAppsTitle"[^>]*value="Поддерживаемые клиенты"/);
assert.match(customView,/data-custom-client-id="custom-1"/);
assert.match(customView,/data-custom-client-id="custom-2"/);
assert.match(customView,/data-custom-field="enabled" aria-label="Показывать приложение" checked/);
assert.match(customView,/My &amp; &lt;Custom&gt; &quot;App&quot;/);
assert.match(customView,/https:\/\/example\.com\/download\?os=ios&amp;app=test/);
assert.doesNotMatch(customView,/My & <Custom>/);
assert.match(src,/subscriptionCustomClients:readCustomClients\(\)/);
assert.match(src,/data-subscription-apps-title/);
assert.match(src,/allEnabled=\[\.\.\.enabled,\.\.\.customEnabled/);
assert.match(src,/data-custom-client-remove/);
assert.match(src,/customRows\(\)\.forEach/);
const rendered=studio.renderCustomClient({
 id:'custom-11',name:'Injected"><svg onload=alert(1)>',
 platforms:'iOS',url:'',enabled:false},true);
assert.match(rendered,/&quot;&gt;&lt;svg onload=alert\(1\)&gt;/);
assert(!rendered.includes('"><svg'),'Custom values must remain escaped in HTML');
assert.match(rendered,/data-custom-client-id="custom-11"/);

for(const key of ['happ','incy','v2raytun','v2rayn','v2rayng','streisand','hiddify','nekobox','shadowrocket']){
 assert(view.includes('name="subClient_'+key+'"'),'Missing app visibility setting '+key);
 assert(view.includes('name="subClientLink_'+key+'"'),'Missing app HTTPS-link field '+key);
}
const [overridden]=studio.create({
 subscriptionClients:{happ:false,incy:true},
 subscriptionClientLinks:{incy:'https://example.com/download?platform=ios'},
 subscriptionLogoUrl:'https://example.com/logo.png',
 subscriptionHero:'<script>alert(1)</script>'
},async()=>{},()=>{},{users:0,nodes:0});
assert.doesNotMatch(overridden,/name="subClient_happ" checked/);
assert.match(overridden,/name="subClient_incy" checked/);
assert.match(overridden,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert(studio.validHttps('https://example.com/download'));
assert(!studio.validHttps('javascript:alert(1)'));
assert(!studio.validHttps('https://user:pass@example.com'));
assert(!studio.validHttps('http://example.com'));
assert(!studio.validHttps('https://example.com:443'));
assert(!studio.validHttps('https://localhost\\evil.test'));
for(const value of ['div','section','label','span']){
 const opens=(view.match(new RegExp('<'+value+'(?:[ >])','g'))||[]).length;
 const closes=(view.match(new RegExp('</'+value+'>','g'))||[]).length;
 assert.equal(opens,closes,'HTML preview needs balanced '+value+' markup');
}
assert.match(src,/subscriptionClients:Object\.fromEntries\(clientCatalog/);
assert.match(src,/subscriptionClientLinks:Object\.fromEntries\(clientCatalog/);
assert.match(src,/enabled=clientCatalog\.filter/);
assert.match(src,/data-client-preset/);
assert.match(rust,/mod subscription_settings;/);
const validation=fs.readFileSync('backend/src/subscription_settings.rs','utf8');
assert.match(validation,/pub\(crate\) fn validate/);
assert.match(validation,/"subscriptionClients"/);
assert.match(validation,/"subscriptionClientLinks"/);
assert.match(validation,/"subscriptionCustomClients"/);
assert.match(validation,/"subscriptionAppsTitle"/);
assert.match(validation,/HashSet/,'Custom app IDs must be unique');
assert.match(rust,/"subscriptionAppsTitle"\s*\|\s*"subscriptionCustomClients"/);
assert.match(validation,/"subscriptionLogoUrl"/);
assert.match(validation,/safe_https_url/);
assert.match(css,/\.subscription-client-editor/);
assert.match(css,/\.subscription-preview-apps/);
assert.match(css,/\.subscription-custom-toolbar/);
assert.match(css,/\.subscription-custom-header/);
assert.match(view,/name="subscriptionPlacement"/);
assert.match(view,/name="nodePlacement"/);
assert.match(view,/name="deploymentServerB"/);
assert.match(view,/name="deploymentServerC"/);
assert.match(view,/value="c" selected/);
assert.match(view,/value="b" selected/);
assert(!view.includes('<script>alert(1)</script>'),'User-provided studio content must be escaped');
assert.match(view,/&lt;script&gt;/);
assert.match(view,/Экспорт схемы JSON/);
assert.match(view,/отдельном сервисе/);
assert.match(app,/subscription:\['SUBSCRIPTION STUDIO',subscriptionStudioP\]/);
assert.match(app,/field\(\{k:'subscriptionBrand',l:'Название подписки'/,
 'General Settings must have a distinct subscription name field');
assert.match(app,/DB\.set\.subscriptionBrand\|\|''/,
 'Subscription name field must read the same persisted key as Studio');
assert.match(app,/read\(\[\{k:'brand'\},\{k:'domain'\},\{k:'subscriptionBrand'\},\{k:'subscriptionDomain'\}\],f\)/,
 'Brand form must save both independent names and both domains');
assert.match(view,/Название подписки/,'Studio must use the same label as General Settings');
assert.match(rust,/\("subscriptionBrand", 80\)/,'Rust must validate saved subscription name');
assert.match(app,/subscriptionDomain.*DB.set.subscriptionDomain/);
assert.match(app,/api.saveSettings\(d\)/,'General settings must save both independent domains');
assert.match(rust,/"subscriptionDomain"\s*\|\s*"subscriptionPath"/);
assert.match(rust,/"nodePlacement"/);
assert.match(rust,/"deploymentServerB"/);
assert.match(rust,/"subscriptionPlacement", &\["a", "b", "c"\]/);
assert(!rust.includes('.route("/s/'),'The management panel must not implement public subscription serving');
assert.match(html,/subscription-studio\.js\?v=[a-z0-9-]+/,'Subscription Studio JavaScript must use a cache-busting version');
assert.match(html,/subscription-studio\.css\?v=20261021-custom-apps-1/);
assert.match(docker,/subscription-studio\.css subscription-studio\.js/);
assert.match(css,/\.subscription-studio-layout/);
assert.match(css,/@media\(max-width:780px\)/);
assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
console.log('Subscription Studio, separate-domain management and deployment blueprint: OK');
