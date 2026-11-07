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
for(const markup of [template,preview]){
 assert.doesNotMatch(markup,/role="tab(?:list|panel)?"|data-cabinet-tab|data-cabinet-panel/,'Customer setup must be one page');
 assert.doesNotMatch(markup,/cabinet-feature-actions|subscription-cabinet-checklist|portal-app-next/,'No duplicated overview or navigation actions');
 for(const key of ['apps','connect','devices','support'])assert(markup.includes('data-setup-section="'+key+'"'),'Missing setup section '+key);
 assert(markup.indexOf('data-setup-section="connect"')<markup.indexOf('data-setup-section="apps"'),'Access actions precede the secondary app catalog');
 assert.match(markup,/<details class="portal-app-disclosure">/,'Apps must start collapsed');
 assert.doesNotMatch(markup,/class="portal-quickstart"/,'Instructions must not repeat access actions');
}
assert.match(template,/id="subscription-link-card" hidden/,'Private URL remains hidden');
assert.match(preview,/data-preview-link-card[^>]*hidden/,'Preview must hide the private URL');
assert.match(portal,/card\.hidden = true/);
assert.match(portal,/getElementById\('copy-link'\)\?\.remove/,'Do not render two copy actions');
assert.match(portal,/section.hidden=!available\[section.dataset.setupSection\]/,'Honor capability settings');
assert.match(studioSource,/syncPreviewSections\(\)/,'Studio must preview the same one-page sections');
assert.match(portal,/navigator\.clipboard\.writeText\(subscriptionUrl\)/);
assert.match(portal,/Qr\.encodeText\(subscriptionUrl/);
assert.match(portal,/search\?\.addEventListener\('input',searchApps\)/);
assert.match(studioSource,/applyPreviewFilter\(\)/);
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
console.log('Subscription personal cabinet: one-page setup, privacy, filters and preview parity OK');
