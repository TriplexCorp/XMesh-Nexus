#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const api=fs.readFileSync('backend/src/main.rs','utf8');
const pool=fs.readFileSync('backend/src/cdn_quota.rs','utf8');
const runtime=fs.readFileSync('backend/src/node_runtime_legacy.rs','utf8');
const ui=fs.readFileSync('frontend/js/core/app.js','utf8');
const integration=fs.readFileSync('scripts/test-node-auth-integration.py','utf8');

assert.match(api,/cdn_quota::validate_settings/,'Owner-controlled pool must validate tag list');
assert.match(api,/cdn_quota::validate_user\(data\)/,'User quota must be validated on saved records');
assert.match(api,/cdn_quota::attach_usage\(pool, &mut records\)/,'Bootstrap and user fetch must use server-signed CDN accounting');
assert.match(api,/cdn_quota::attach_usage\(&state\.pool, std::slice::from_mut/,'User PATCH must return authoritative CDN usage');
assert.match(pool,/FROM user_inbound_traffic_totals/,'Pool must aggregate per-user per-inbound meters');
assert.match(pool,/inbound_tag = ANY\(\$1::TEXT\[\]\)/,'Only selected inbound tags may enter the quota');
assert.doesNotMatch(pool,/node_network_traffic_totals/,'Node NIC totals are not user CDN usage');
assert.match(pool,/pub fn exhausted/,'Per-user CDN quota must have a dedicated eligibility function');
assert.match(runtime,/cdn_quota::exhausted\(user, tag, cdn_tags\)/,'Only tagged inbounds must be removed');
assert.match(runtime,/let cdn_tags = crate::cdn_quota::tags/,'Signed desired config must use the persisted CDN group');
assert.match(ui,/name="cdnInboundTags"/,'Settings must expose explicit inbound selection');
assert.match(ui,/data-cdn-tags-save/,'Group changes must be saved through owner-controlled settings API');
assert.match(ui,/cdnLimitGb/,'User and template forms must edit separate CDN quota');
assert.match(integration,/CDN quota must not revoke unrelated MAIN inbound/,'Main inbound must stay available after CDN exhaustion');
assert.match(integration,/Exhausted CDN user must not be provisioned/,'CDN cutoff must affect signed desired config');
console.log('CDN group accounting, owner settings, per-user quotas and isolated runtime cutoff contract OK');
