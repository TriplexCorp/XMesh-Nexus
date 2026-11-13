#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const src=fs.readFileSync('frontend/js/features/subscriptions/subscription-studio.js','utf8');
const rust=fs.readFileSync('backend/src/user_subscriptions_base.rs','utf8');
const renderer=fs.readFileSync('backend/src/subscription_remark.rs','utf8');
new Function(src);
const scope={
  window:{},Event:class Event {
    constructor(type,opts={}){this.type=type;this.bubbles=Boolean(opts.bubbles)}
  }
};
vm.runInNewContext(src,scope);
const studio=scope.window.XMeshSubscriptionStudio;
const [html]=studio.create({
  subscriptionAnnouncement:'Пользователь: {USERNAME}\nLTE: {CDN_DATA_LEFT}'
},async()=>{},()=>{},{users:3,nodes:2});
for(const key of ['USERNAME','DATA_LEFT','DATA_LIMIT','DATA_USAGE','CDN_DATA_LEFT',
 'DAYS_LEFT','TIME_LEFT','EXPIRE_DATE','STATUS_TEXT','STATUS_EMOJI']){
  assert(html.includes('data-announcement-token="'+key+'"'),'missing public variable '+key);
}
for(const key of ['NODE_DATA_LEFT','TRAFFIC_LEFT','SERVER_IP','PROTOCOL','TRANSPORT']){
  assert(!html.includes('data-announcement-token="'+key+'"'),
   'global notice must not advertise an endpoint-only variable: '+key);
}
assert(html.includes('data-announcement-demo'),'live demo must be visible');
assert(html.includes('maxlength="4000"'),'announcement input must retain length limit');
assert.equal(studio.announcementPreview(
  'Пользователь: {USERNAME}\nОсталось LTE: {CDN_DATA_LEFT}'),
  'Пользователь: alice\nОсталось LTE: 3.25 ГБ');
assert.equal(studio.announcementPreview(
  '{USERNAME}\n---\n{CDN_DATA_LEFT}'),'alice',
  'demo must preview only the selected announcement, not combined rotation messages');
assert.equal(studio.announcementPreview('{UNRECOGNIZED}'),'{UNRECOGNIZED}');

let dispatched=0,focused=false;
const field={
  value:'Пользователь: \nLTE: ',
  selectionStart:'Пользователь: \nLTE: '.length,
  selectionEnd:'Пользователь: \nLTE: '.length,
  maxLength:4000,
  setRangeText(value,start,end){
    this.value=this.value.slice(0,start)+value+this.value.slice(end);
    this.selectionStart=this.selectionEnd=start+value.length;
  },
  dispatchEvent(e){assert.equal(e.type,'input');assert.equal(e.bubbles,true);dispatched++},
  focus(){focused=true}
};
assert.equal(studio.insertAnnouncementToken(field,'CDN_DATA_LEFT'),true);
assert.equal(field.value,'Пользователь: \nLTE: {CDN_DATA_LEFT}');
assert.equal(studio.insertAnnouncementToken(field,'USERNAME'),true);
assert.equal(field.value,'Пользователь: \nLTE: {CDN_DATA_LEFT}{USERNAME}');
assert.equal(dispatched,2);
assert(focused);
assert.equal(studio.insertAnnouncementToken(field,'NODE_DATA_LEFT'),false,
 'no node is uniquely selected in a global announcement');
assert.equal(dispatched,2);
field.maxLength=field.value.length;
assert.equal(studio.insertAnnouncementToken(field,'STATUS_EMOJI'),false);
assert.equal(dispatched,2);

assert.match(renderer,/pub fn render_announcement\(/);
assert.match(renderer,/fn sanitize_text\(/);
assert.match(renderer,/allow_newlines && ch == '\\n'/);
assert.match(rust,/selected_subscription_announcement\(settings, now_ms\)/);
assert.match(rust,/personalized_subscription_announcement\(&state, &user, &settings, now\)\.await/);
assert.match(rust,/cdn_quota::usage_for_user\(&state\.pool, settings, user_id\)/);
assert.match(rust,/add_subscription_profile_headers\(\s*&mut response,\s*&settings,\s*announcement\.as_deref\(\),\s*Some\(&token\),?\s*\)/);
assert.match(rust,/CACHE_CONTROL, "no-store, private"/);
console.log('Personalized multiline announcements, signed CDN balances, UI picker and safe header: PASS');
