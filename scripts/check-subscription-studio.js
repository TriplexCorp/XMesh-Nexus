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
assert.equal(studio.clientCatalog.length,16,'Show a deliberate finite client catalog');
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
assert.match(validation,/"subscriptionLogoUrl"/);
assert.match(validation,/safe_https_url/);
assert.match(css,/\.subscription-client-editor/);
assert.match(css,/\.subscription-preview-apps/);
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
assert.match(app,/subscriptionDomain.*DB.set.subscriptionDomain/);
assert.match(app,/api.saveSettings\(d\)/,'General settings must save both independent domains');
assert.match(rust,/"subscriptionDomain"\s*\|\s*"subscriptionPath"/);
assert.match(rust,/"nodePlacement"/);
assert.match(rust,/"deploymentServerB"/);
assert.match(rust,/"subscriptionPlacement", &\["a", "b", "c"\]/);
assert(!rust.includes('.route("/s/'),'The management panel must not implement public subscription serving');
assert.match(html,/subscription-studio\.js\?v=20261021-2/);
assert.match(html,/subscription-studio\.css\?v=20261021-2/);
assert.match(docker,/subscription-studio\.css subscription-studio\.js/);
assert.match(css,/\.subscription-studio-layout/);
assert.match(css,/@media\(max-width:780px\)/);
assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
console.log('Subscription Studio, separate-domain management and deployment blueprint: OK');
