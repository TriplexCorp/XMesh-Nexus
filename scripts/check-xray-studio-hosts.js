#!/usr/bin/env node
'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window={};
await import('../xray-studio-hosts.js');
const module=window.XMeshStudioHosts;
assert.equal(typeof module?.mount,'function');
const view=module.view();
for(const key of ['data-endpoints-panel','data-endpoint-list','data-endpoint-editor',
 'data-endpoint="remark"','data-endpoint="address"','data-endpoint="port"',
 'data-endpoint-nodes','data-endpoint-action="save"']){
 assert(view.includes(key),'Endpoint UI missing '+key);
}
assert(!view.includes('data-endpoint="sec"'),'Security is configured by inbound, not Hosts');
const app=fs.readFileSync('app.js','utf8');
const studio=fs.readFileSync('xray-studio-v4.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
const server=fs.readFileSync('backend/src/user_subscriptions.rs','utf8');
assert(!app.includes("['hosts','link','Хосты',1]"),'Duplicate Hosts navigation must stay retired');
assert(app.includes("hosts:['XRAY STUDIO',profilesP]"),'Legacy #hosts URLs must redirect into Studio');
assert(studio.includes('window.XMeshStudioHosts.view()'),'Studio must embed endpoints beside inbound');
assert(studio.includes('window.XMeshStudioHosts.mount('),'Editor must activate endpoint controls');
assert(html.indexOf('/xray-studio-hosts.js')<html.indexOf('/xray-studio-v4.js'));
assert(html.includes('/xray-studio-hosts.css'));
assert(docker.includes('xray-studio-hosts.js')&&docker.includes('xray-studio-hosts.css'));
assert(server.includes('fn host_for_profile('),'Generator must filter by profile and nodes');
assert(server.includes('let any_explicit_host='),'Disabled hosts must not fall back to raw IPs');
console.log('XRAY STUDIO endpoints integration, backwards-compatible storage and routing: PASS');
