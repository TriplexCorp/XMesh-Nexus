#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');
const studio=fs.readFileSync('subscription-studio.js','utf8');
const engine=fs.readFileSync('backend/src/subscription_json.rs','utf8');
assert.match(app,/\['balancers','network','Балансировщики'\]/);
assert.match(app,/balancers:\['Балансировщики',balancersP\]/);
assert.match(app,/clientBalancers:rows/,'Custom groups must be persisted');
assert.match(app,/subscriptionJson:\{\.\.\.\(DB\.set\.subscriptionJson\|\|\{\}\),smart:false,balance:'off'\}/,
 'Custom editor must disable legacy SMART without wiping DNS settings');
assert.match(studio,/balance:'leastPing',smart:false/);
assert.doesNotMatch(studio,/name="json_smart"/,'Balancer switch belongs in its own workspace');
assert.doesNotMatch(studio,/name="json_balance"/,'Strategy belongs in its own workspace');
assert.match(engine,/let\s+smart\s*=\s*smart_enabled\(\s*setting\s*\)/);
assert.match(engine,/enabled\(\s*opts\s*,\s*"smart"\s*,\s*false\s*\)/);
assert.match(engine,/if\s+smart\s*&&\s*tags\.len\(\)\s*>\s*1\s*&&\s*balance\s*!=\s*"off"/);
assert.match(engine,/fn balancers_are_opt_in_and_servers_remain_distinct/);
const subscriptions=fs.readFileSync('backend/src/user_subscriptions.rs','utf8')+'\n'+fs.readFileSync('backend/src/user_subscriptions_base.rs','utf8');
assert.match(subscriptions,/let\s+mut\s+response\s*=\s*Json\(\s*json\s*\)\.into_response\(\)/,
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
assert.match(engine,/fn disabled_smart_never_emits_balancer_or_observatory\(\)/);
assert.match(engine,/В JSON обнаружена балансировка, хотя SMART отключён/);
assert.match(engine,/pub(?:\(crate\))?\s+fn\s+build_feed\(\s*proxies:\s*Vec<Value>\s*,\s*settings:\s*&Value\s*\)/,
 'Feed must return a JSON array of independent Xray configs');
assert.match(engine,/Ok\(Value::Array\(entries\)\)/);
assert.match(engine,/fn feed_exposes_one_full_json_profile_per_server\(\)/);
assert.match(engine,/fn smart_is_an_optional_additional_profile\(\)/);
assert.match(subscriptions,/subscription_json::build_feed\(\s*outbounds\s*,\s*&settings\s*\)/);
assert.match(subscriptions,/subscription_json::build_feed\(\s*proxies\s*,\s*&setting\s*\)/);
assert.match(engine,/fn validate_client_balancers\(/);
assert.match(engine,/settings\.get\("clientBalancers"\)/);
assert.match(engine,/xmeshSourceKey/);
assert.match(app,/data-balancer-source/);
assert.match(app,/hideSelectedInbounds/);
assert.match(subscriptions,/format!\("host:\{id\}"\)/);
assert.match(subscriptions,/format!\("node:\{id\}:\{tag\}"\)/);
assert.match(engine,/fn round_robin_and_random_never_require_missing_observatory\(\)/,
 'roundRobin and random must never request an unavailable Observatory');
assert.match(engine,/fn least_ping_preserves_observatory_and_fallback\(\)/,
 'leastPing must retain its explicit Observatory and fallback');
console.log('Dedicated opt-in balancer workspace: OK');
