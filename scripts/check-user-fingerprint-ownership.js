#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const overlay=fs.readFileSync('user-fingerprint-override.js','utf8');
const subscription=fs.readFileSync('backend/src/user_subscriptions.rs','utf8');
const base=fs.readFileSync('backend/src/user_subscriptions_base.rs','utf8');
const transport=fs.readFileSync('backend/src/subscription_transport.rs','utf8');
const hostEditor=fs.readFileSync('xray-studio-hosts.js','utf8');
const clientSource=fs.readFileSync('client-config.js','utf8');
const clientConfig=require('../client-config.js');
const index=fs.readFileSync('index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');

assert.match(overlay,/inherited\.textContent='По умолчанию'/,'User fingerprint selector must expose a visible default option');
assert.match(overlay,/наследует fingerprint из хоста/,'Default mode must explain host inheritance');
assert.match(overlay,/data-user-fingerprint/,'User card must expose the per-user fingerprint control');
assert.match(overlay,/fingerprint:select\.value/,'User edit save must persist the per-user override');
assert.match(index,/app\.js[^\n]*<\/script>\n<script src="\/user-fingerprint-override\.js/,'Override must load after app.js');
assert.match(docker,/app\.js user-fingerprint-override\.js node-bootstrap-v6\.js/,'Backend image must package the override');
assert.match(hostEditor,/data-endpoint="fp"/,'Host fingerprint editor remains available');
assert.match(hostEditor,/fp:value\('fp'\)\|\|'chrome'/,'Saved hosts must materialize chrome when no explicit choice exists');
assert.match(subscription,/user_fingerprint\(/,'Backend wrapper must read the per-user override');
assert.match(subscription,/ensure_default_fingerprint\(/,'Backend JSON wrapper must materialize the final chrome fallback');
assert.match(subscription,/Value::String\("chrome"\.to_owned\(\)\)/,'Backend JSON wrapper must use chrome as the empty host fallback');
assert.match(subscription,/apply_fingerprint\(/,'Backend wrapper must project a per-user override into generated client JSON');
assert.match(subscription,/\["tlsSettings", "realitySettings"\]/,'Override applies only to TLS/REALITY client security settings');
assert.match(base,/crate::subscription_transport::client_stream\(inbound, host, device\)/,'Original transport projection remains intact');
assert.match(transport,/field\(host, "fp"\).*field\(host, "fingerprint"\)/s,'Backend transport must keep host fingerprint ownership');
assert.match(clientSource,/fingerprint:nonempty\(host\.fp\)\|\|nonempty\(host\.fingerprint\)\|\|'chrome'/,
 'Admin-side client serializer must materialize chrome for TLS and Reality');

const user={xrayId:'123e4567-e89b-42d3-a456-426614174000'};
const inbound={
 protocol:'vless',port:443,settings:{decryption:'none'},
 streamSettings:{security:'tls',network:'xhttp',tlsSettings:{serverName:'vpn.example.com'},xhttpSettings:{path:'/x'}}
};
const inherited=clientConfig.build(user,{address:'vpn.example.com',port:443,sni:'vpn.example.com'},inbound);
assert.equal(inherited.outbounds[0].streamSettings.tlsSettings.fingerprint,'chrome',
 'TLS client JSON must contain the documented chrome fallback, not merely show it in the UI');
const explicit=clientConfig.build(user,{address:'vpn.example.com',port:443,sni:'vpn.example.com',fp:'safari'},inbound);
assert.equal(explicit.outbounds[0].streamSettings.tlsSettings.fingerprint,'safari',
 'Explicit host fingerprint must override the chrome fallback');

console.log('Per-user fingerprint override: user -> host -> serialized chrome fallback for TLS/Reality.');
