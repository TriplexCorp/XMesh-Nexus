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
assert.match(view,/name="subscriptionShowTraffic"/);
assert.match(view,/name="subscriptionShowExpiry"/);
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
assert.match(rust,/"subscriptionDomain" \| "subscriptionPath"/);
assert.match(rust,/"nodePlacement"/);
assert.match(rust,/"deploymentServerB"/);
assert.match(rust,/"subscriptionPlacement", &\["a", "b", "c"\]/);
assert(!rust.includes('.route("/s/'),'The management panel must not implement public subscription serving');
assert.match(html,/subscription-studio\.js\?v=20261021-1/);
assert.match(html,/subscription-studio\.css\?v=20261021-1/);
assert.match(docker,/subscription-studio\.css subscription-studio\.js/);
assert.match(css,/\.subscription-studio-layout/);
assert.match(css,/@media\(max-width:780px\)/);
assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
console.log('Subscription Studio, separate-domain management and deployment blueprint: OK');
