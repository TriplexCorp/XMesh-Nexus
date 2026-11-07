#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const read=file=>fs.readFileSync(file,'utf8');
const template=read('backend/src/subscription_template.html');
const studioSource=read('frontend/js/features/subscriptions/subscription-studio.js');
const portal=read('frontend/js/features/subscriptions/subscription-portal.js');
const css=read('frontend/styles/features/subscriptions/subscription-public.css');
const {assertPackaged}=require('./ci/frontend-source.cjs');
assertPackaged(assert,['subscription-studio.js','subscription-portal.js','subscription-public.css']);
new Function(studioSource);
new Function(portal);
const context={};
new Function('window',studioSource+';return window.XMeshSubscriptionStudio;')(context);
const [preview]=context.XMeshSubscriptionStudio.create({},async()=>{},()=>{},{users:2,nodes:1});
const expected=['overview','connect','apps','devices','support'];
for(const name of expected){
  for(const markup of [template,preview]){
    assert.match(markup,new RegExp('data-cabinet-tab="'+name+'"'));
    assert.match(markup,new RegExp('data-cabinet-panel="'+name+'"'));
    assert.match(markup,new RegExp('id="cabinet-panel-'+name+'"[^>]*hidden|id="cabinet-panel-'+name+'"[^>]*data-cabinet-panel="overview"'));
  }
}
assert.equal((preview.match(/data-cabinet-tab="/g)||[]).length,5);
assert.equal((template.match(/data-cabinet-tab="/g)||[]).length,5);
assert.match(template,/role="tablist"/);
assert.match(template,/aria-selected="true" tabindex="0" data-cabinet-tab="overview"/);
assert.match(portal,/event\.key==='ArrowRight'/,'Keyboard tabs must support arrow navigation');
assert.match(portal,/button\.tabIndex=selected\?0:-1/);
assert.match(portal,/selectCabinetTab\('overview'\)/);
assert.match(studioSource,/switchPreviewTab\(previewTab\)/);
assert.match(studioSource,/previewShadow\.querySelectorAll\('\[data-cabinet-panel\]'\)/);
assert.match(portal,/apps:!!document\.querySelector\('\.subscription-preview-app'\)/);
assert.match(portal,/devices:!!document\.getElementById\('subscription-devices'\)/);
assert.match(portal,/support:!!document\.querySelector\('\.subscription-preview-support'\)/);
assert.match(template,/id="subscription-link-card" hidden/,'Bearer link must be hidden');
assert.match(preview,/data-preview-link-card hidden/,'Preview must hide demo URL until explicitly revealed');
assert.match(portal,/card\.hidden = true/,'Private link hidden on load');
assert.match(template,/id="subscription-qr" class="subscription-preview-qr" hidden|\{\{QR\}\}/,'QR is exclusively inside the connection panel');
const overview=template.split('data-cabinet-panel="overview"')[1].split('data-cabinet-panel="connect"')[0];
assert(!overview.includes('id="subscription-link-card"'),'Private URLs must not appear on dashboard');
assert(!overview.includes('class="subscription-preview-qr"'),'QR must never dominate overview');
assert.match(template,/data-app-filter="windows"/);
assert.match(template,/data-app-filter="ios"/);
assert.match(template,/id="cabinet-app-search"/);
assert.match(portal,/search\?\.addEventListener\('input',searchApps\)/);
assert.match(portal,/selectedPlatform==='all'\|\|platform\.includes\(selectedPlatform\)/);
assert.match(studioSource,/applyPreviewFilter\(\)/);
assert.match(studioSource,/window\.qrcodegen\?\.QrCode/,'Demo QR should use the real bundled encoder');
assert.match(css,/container:cabinet\/inline-size/);
assert.match(css,/@container cabinet \(max-width:900px\)/);
assert.match(css,/@container cabinet \(max-width:560px\)/);
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(css,/@keyframes cabinetReveal/);
assert.match(css,/\[data-portal-cards=glass\]/);
assert.match(css,/\[data-portal-cards=raised\]/);
assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length,'CSS braces must balance');
for(const tag of ['div','section','span','nav','article','aside']){
  const open=(preview.match(new RegExp('<'+tag+'(?:[ >])','g'))||[]).length;
  const close=(preview.match(new RegExp('</'+tag+'>','g'))||[]).length;
  assert.equal(open,close,'Studio HTML must balance '+tag);
}
console.log('Subscription personal cabinet: real tabs, privacy, filters and preview parity OK');
