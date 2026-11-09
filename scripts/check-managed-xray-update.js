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
const worker=fs.readFileSync('deploy/xmesh-xray-update.py','utf8');
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
assert.match(agent,/xmesh-xray-update[.]py/);
assert.match(worker,/OFFICIAL = "ghcr.io\/xtls\/xray-core:"/);
assert.doesNotMatch(worker,/xray-core:latest/);
assert.ok(worker.includes("[identity, 'run', '-test', '-config', '/etc/xray/config.json']"));
assert.ok(worker.includes("['rename', self.name, self.backup]"),'Exact old container must survive switching');
assert.ok(worker.includes("self.health(self.name, self.record['oldImage'])"),'Rollback must be checked');
assert.ok(worker.includes("self.record['result']"),'Result must be durable for duplicate delivery');
assert.ok(worker.includes("['pull', image], timeout=115"));
assert.ok(worker.includes('for attempt in range(2)'));
assert.match(worker,/registry_unavailable/);
assert.match(worker,/pinned-release[.]json/);
const transaction=spawnSync('python3',['scripts/test-xray-update-unit.py'],{encoding:'utf8'});
assert.equal(transaction.status,0,'Executable transaction tests: '+transaction.stderr);
for(const source of ['backend/src/node_runtime.rs','backend/src/node_runtime_p0d_staged.rs','backend/src/node_runtime_legacy.rs']){
 const rust=fs.readFileSync(source,'utf8');
 assert.match(rust,/action='update_xray' AND requested_at<NOW\(\)-INTERVAL '10 minutes'/,
  'Managed Xray lease must cover a bounded image download and rollback: '+source);
}
const bulk=fs.readFileSync('frontend/js/features/users/workspace-bulk-actions.js','utf8');
assert.match(bulk,/action==='xray-update'/,'Bulk nodes toolbar must dispatch Xray update');
assert.match(bulk,/st\.batch=\{action:'xray-update',version,items\}/,'Per-node Xray update outcomes are visible');
assert.match(bulk,/const result=await ops\.updateOne\(Number\(item\.id\),version/,'Bulk update must use the single signed Xray updater');

const installer=fs.readFileSync('deploy/install-node-metrics-agent.sh','utf8');
const updater=fs.readFileSync('deploy/update-node-control-agent.sh','utf8');
assert.match(installer,/TimeoutStartSec=420s/,'Fresh control services must allow bounded GHCR retries');
assert.match(updater,/TimeoutStartSec=420s/,'Agent updates must also extend existing control services');
assert.match(frontend,/window\.XMeshNodeXrayOps=XMeshNodeXrayOps/,'Single and bulk Xray must use one API operation');
assert.match(frontend,/const verifyUntil=Date\.now\(\)\+45000/,'Command ACK requires heartbeat verification without stale-version false failures');
assert.doesNotMatch(agent,/\beval\b/,'Never evaluate remote commands');
assert.match(frontend,/data-xray-update/);
assert.match(frontend,/const selectNodeXrayRelease=/);
const lint=spawnSync('bash',['-n','deploy/node-control-agent.sh'],{encoding:'utf8'});
assert.equal(lint.status,0,'Control agent shell syntax: '+lint.stderr);
console.log('Xray managed update safety and SQLx migration uniqueness: OK');
