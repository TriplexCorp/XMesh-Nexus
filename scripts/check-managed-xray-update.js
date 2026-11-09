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
const entry=fs.readFileSync('backend/src/node_runtime.rs','utf8');
const legacy=fs.readFileSync('backend/src/node_runtime_legacy.rs','utf8');
const api=entry+'\n'+legacy;
const router=fs.readFileSync('backend/src/main.rs','utf8');
const agent=fs.readFileSync('deploy/node-control-agent.sh','utf8');
const frontend=fs.readFileSync('frontend/js/core/app.js','utf8');
assert.match(router,/\/nodes\/\{id\}\/xray-update/);
assert.match(api,/pub async fn request_xray_update/);
// v6 shadows request_restart and request_xray_update in the same overlay. Scope
// this invariant to the restart function itself instead of slicing through the
// following legitimate Xray-update handler, which necessarily binds `target`.
const restartStart=entry.indexOf('pub async fn request_restart(');
const restartEnd=entry.indexOf('pub async fn request_xray_update(',restartStart);
assert(restartStart>=0 && restartEnd>restartStart,'Cannot isolate v6 restart handler');
const restart=entry.slice(restartStart,restartEnd);
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
assert.match(agent,/pull_pinned_xray_image\(\)/,'Agent must retry official GHCR image pulls');
assert.match(agent,/timeout 115 docker pull "\$image"/,'Allow a bounded registry download window');
assert.match(agent,/for attempt in 1 2;do/,'Download must retry once on transient GHCR failure');
assert.match(agent,/registry connectivity or CDN failure/,'Reported failure must distinguish registry connectivity');
assert.doesNotMatch(agent,/timeout 75 docker pull "\$image"/,'Old one-shot GHCR pull must not return');
for(const source of ['backend/src/node_runtime.rs','backend/src/node_runtime_p0d_staged.rs','backend/src/node_runtime_legacy.rs']){
 const rust=fs.readFileSync(source,'utf8');
 assert.match(rust,/action='update_xray' AND requested_at<NOW\(\)-INTERVAL '10 minutes'/,
  'Managed Xray lease must cover a bounded image download and rollback: '+source);
}
const bulk=fs.readFileSync('frontend/js/features/users/workspace-bulk-actions.js','utf8');
assert.match(bulk,/action==='xray-update'/,'Bulk nodes toolbar must dispatch Xray update');
assert.match(bulk,/st\.batch=\{action:'xray-update',version,items\}/,'Per-node Xray update outcomes are visible');
assert.match(bulk,/const result=await ops\.updateOne\(Number\(item\.id\),version/,'Bulk update must use the single signed Xray updater');

assert.doesNotMatch(agent,/\beval\b/,'Never evaluate remote commands');
assert.match(frontend,/data-xray-update/);
assert.match(frontend,/const selectNodeXrayRelease=/);
const lint=spawnSync('bash',['-n','deploy/node-control-agent.sh'],{encoding:'utf8'});
assert.equal(lint.status,0,'Control agent shell syntax: '+lint.stderr);
console.log('Xray managed update safety and SQLx migration uniqueness: OK');
