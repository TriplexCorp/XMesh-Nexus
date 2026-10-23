#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');
const studio=fs.readFileSync('subscription-studio.js','utf8');
const engine=fs.readFileSync('backend/src/subscription_json.rs','utf8');
assert.match(app,/\['balancers','network','Балансировщики'\]/);
assert.match(app,/balancers:\['Балансировщики',balancersP\]/);
assert.match(app,/subscriptionJson:\{\.\.\.current,smart,balance\}/,
 'Save the complete existing JSON settings object instead of wiping unrelated DNS options');
assert.match(app,/const smart=enabled\.checked/);
assert.match(studio,/balance:'leastPing',smart:false/);
assert.doesNotMatch(studio,/name="json_smart"/,'Balancer switch belongs in its own workspace');
assert.doesNotMatch(studio,/name="json_balance"/,'Strategy belongs in its own workspace');
assert.match(engine,/let smart=enabled\(opts,"smart",false\)/);
assert.match(engine,/if smart && tags\.len\(\)>1 && balance!="off"/);
assert.match(engine,/fn balancers_are_opt_in_and_servers_remain_distinct/);
const subscriptions=fs.readFileSync('backend/src/user_subscriptions.rs','utf8');
assert.match(subscriptions,/let mut response=Json\(json\)\.into_response\(\)/,
 'Every subscription returns native JSON regardless of SMART');
assert.doesNotMatch(subscriptions,/vless_link\(|links\.join\(|use_vless_feed\(/,
 'Legacy URI generation and fallback must remain removed');
const negotiation=fs.readFileSync('backend/src/subscription_user_agent.rs','utf8');
assert.doesNotMatch(negotiation,/\bFormat\b|contains_key\("format"\)|options\.get\("format"\)/,
 'Do not negotiate a format: JSON is the only response type');
assert.doesNotMatch(subscriptions,/Format::|options\.get\("format"\)|options\.contains_key\("format"\)/,
 'Feed generation must not support a format selector');
assert.match(negotiation,/options\.get\("device"\)/,
 'Keep device-specific XHTTP configuration');
console.log('Dedicated opt-in balancer workspace: OK');
