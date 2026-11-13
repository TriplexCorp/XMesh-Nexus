#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const studio=fs.readFileSync('frontend/js/features/subscriptions/subscription-studio.js','utf8');
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
assert.match(subscriptions,/if format == crate::subscription_formats::FeedFormat::Xray/,
 'Native Xray branch must remain explicit and separate');
assert.match(subscriptions,/let feed = crate::subscription_json::build_feed\(outbounds, &scoped\)/,
 'Original Xray feed builder preserves independent balancers and user routing');
assert.match(subscriptions,/crate::subscription_formats::render\(&outbounds, format\)/,
 'Alternate formats must reuse authenticated user-scoped client outbounds');
const negotiation=fs.readFileSync('backend/src/subscription_user_agent.rs','utf8');
assert.match(negotiation,/pub fn feed_format\(/,'Formats must be explicitly allowlisted');
assert.match(negotiation,/options\.get\("format"\)/,'Explicit client format is available without changing the token');
assert.match(negotiation,/options\.get\("device"\)/,
 'Keep device-specific XHTTP configuration');
assert.match(engine,/fn disabled_smart_never_emits_balancer_or_observatory\(\)/);
assert.match(engine,/В JSON обнаружена балансировка, хотя SMART отключён/);
assert.match(engine,/pub(?:\(crate\))?\s+fn\s+build_feed\(\s*proxies:\s*Vec<Value>\s*,\s*settings:\s*&Value\s*\)/,
 'Feed must return a JSON array of independent Xray configs');
assert.match(engine,/Ok\(Value::Array\(entries\)\)/);
assert.match(engine,/fn feed_exposes_one_full_json_profile_per_server\(\)/);
assert.match(engine,/fn smart_is_an_optional_additional_profile\(\)/);
// Feed generation is still native JSON; each request uses a copy of the global
// settings scoped to its authenticated user. This preserves opt-in balancers
// while allowing per-user routing without mutating the shared configuration.
const subscriptionBase=fs.readFileSync('backend/src/user_subscriptions_base.rs','utf8');
const routing=fs.readFileSync('backend/src/client_routing.rs','utf8');
assert.match(subscriptionBase,/let scoped = crate::client_routing::scoped_settings\(&settings, &user\)/,
 'Every feed must compute its own user-scoped settings before serialization');
assert.match(subscriptionBase,/subscription_json::build_feed\(outbounds, &scoped\)/,
 'Native client JSON must retain global balancers with per-user routing');
assert.match(subscriptionBase,/subscription_json::build_feed\(\s*proxies\s*,\s*&crate::client_routing::scoped_settings\(\s*&setting\s*,\s*&user\s*\)\s*,?\s*\)/,
 'Admin preview must use the same scoped settings as the public feed');
assert.match(routing,/let mut scoped = settings\.clone\(\)/,
 'A user override must not mutate global panel settings');
assert.match(routing,/scoped\["xmeshUserClientRouting"\] = override_value\.clone\(\)/,
 'Per-user rules must be isolated in the scoped settings clone');
assert.match(engine,/fn validate_client_balancers\(/);
assert.match(engine,/settings\.get\("clientBalancers"\)/);
assert.match(engine,/xmeshSourceKey/);
assert.match(app,/data-balancer-source/);
assert.match(app,/hideSelectedInbounds/);
assert.match(subscriptions,/format!\("host:\{id\}"\)/);
assert.doesNotMatch(subscriptions,/format!\("node:\{id\}:\{tag\}"\)/,
 'A source selector may only reference a published Host, never synthesize a Node endpoint');
assert.match(engine,/fn round_robin_and_random_never_require_missing_observatory\(\)/,
 'roundRobin and random must never request an unavailable Observatory');
assert.match(engine,/fn least_ping_preserves_observatory_and_fallback\(\)/,
 'leastPing must retain its explicit Observatory and fallback');
console.log('Dedicated opt-in balancer workspace: OK');
