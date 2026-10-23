#!/usr/bin/env node
'use strict';
// Prevent the production failure caused by two different SQLx migration files
// sharing a version. Also enforce the boundaries of Xray remote management.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const migrations=fs.readdirSync('backend/migrations').filter(x=>/^\d+_.*\.sql$/.test(x));
const versions=new Map();
for(const filename of migrations){
 const version=Number(filename.split('_')[0]);
 assert(Number.isSafeInteger(version) && version>0,'Invalid migration: '+filename);
 assert(!versions.has(version),'Duplicate SQLx migration version '+version+': '+versions.get(version)+' and '+filename);
 versions.set(version,filename);
}
assert(versions.has(20) && versions.has(21) && versions.has(23),'Xray update migrations must exist');
const migration=fs.readFileSync('backend/migrations/0020_managed_xray_updates.sql','utf8');
assert.match(migration,/update_xray/);
const api=fs.readFileSync('backend/src/node_runtime.rs','utf8');
const router=fs.readFileSync('backend/src/main.rs','utf8');
const agent=fs.readFileSync('deploy/node-control-agent.sh','utf8');
const frontend=fs.readFileSync('app.js','utf8');
assert.match(router,/\/nodes\/\{id\}\/xray-update/);
assert.match(api,/pub async fn request_xray_update/);
const restart=api.slice(api.indexOf('pub async fn request_restart('),api.indexOf('pub async fn available_xray_releases('));
assert.doesNotMatch(restart,/\.bind\(target\)/,'Restart cannot bind an undefined Xray release target');
assert.match(api,/if disabled \{/,'Disabled nodes must enforce Xray shutdown via control poll');
assert.match(api,/version LIKE 'control-v3%'/);
assert.match(api,/node\.xray\.update\.requested/);
assert.match(agent,/update_managed_xray\(\)/);
assert.match(agent,/ghcr\.io\/xtls\/xray-core:\$image_tag/);
assert.doesNotMatch(agent,/local image=ghcr\.io\/xtls\/xray-core:latest/);
assert.match(agent,/xmesh-managed-xray/);
assert.match(agent,/run -test -config \/etc\/xray\/config\.json/);
assert.match(agent,/previous image restored/);
assert.doesNotMatch(agent,/\beval\b/,'Never evaluate remote commands');
assert.match(frontend,/data-xray-update/);
assert.match(frontend,/const selectNodeXrayRelease=/);
const lint=spawnSync('bash',['-n','deploy/node-control-agent.sh'],{encoding:'utf8'});
assert.equal(lint.status,0,'Control agent shell syntax: '+lint.stderr);
console.log('Xray managed update safety and SQLx migration uniqueness: OK');
