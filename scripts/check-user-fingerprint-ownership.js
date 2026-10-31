#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const overlay=fs.readFileSync('user-fingerprint-override.js','utf8');
const subscription=fs.readFileSync('backend/src/user_subscriptions.rs','utf8');
const base=fs.readFileSync('backend/src/user_subscriptions_base.rs','utf8');
const hostEditor=fs.readFileSync('xray-studio-hosts.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');

assert.match(overlay,/inherited\.textContent='По умолчанию'/,'User fingerprint selector must expose a visible default option');
assert.match(overlay,/наследует fingerprint из хоста/,'Default mode must explain host inheritance');
assert.match(overlay,/data-user-fingerprint/,'User card must expose the per-user fingerprint control');
assert.match(overlay,/fingerprint:select\.value/,'User edit save must persist the per-user override');
assert.match(index,/app\.js[^\n]*<\/script>\n<script src="\/user-fingerprint-override\.js/,'Override must load after app.js');
assert.match(docker,/app\.js user-fingerprint-override\.js node-bootstrap-v6\.js/,'Backend image must package the override');
assert.match(hostEditor,/data-endpoint="fp"/,'Host fingerprint editor remains available');
assert.match(subscription,/user_fingerprint\(/,'Backend wrapper must read the per-user override');
assert.match(subscription,/apply_fingerprint\(/,'Backend wrapper must project it into generated client JSON');
assert.match(subscription,/\["tlsSettings", "realitySettings"\]/,'Override applies only to TLS/REALITY client security settings');
assert.match(base,/crate::subscription_transport::client_stream\(inbound, host, device\)/,'Original transport projection remains intact');
console.log('Per-user fingerprint override: user override; default inherits host, whose fallback is chrome.');
