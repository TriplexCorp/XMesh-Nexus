#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');

const api=fs.readFileSync('backend/src/main.rs','utf8');
const runtime=fs.readFileSync('backend/src/node_runtime.rs','utf8');
const migration=fs.readFileSync('backend/migrations/0024_node_agent_updates.sql','utf8');
const agent=fs.readFileSync('deploy/node-control-agent.sh','utf8');
const updater=fs.readFileSync('deploy/update-node-control-agent.sh','utf8');
const installer=fs.readFileSync('deploy/install-node-metrics-agent.sh','utf8');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const tests=fs.readFileSync('scripts/test-node-auth-integration.py','utf8');

assert.match(api,/\/nodes\/\{id\}\/agent-update/);
assert.match(runtime,/pub async fn request_agent_update/);
assert.match(runtime,/pub struct AgentUpdateRequest \{\}/);
assert.match(runtime,/deny_unknown_fields/);
assert.match(runtime,/crate::require_mutation\(&actor\)/);
assert.match(runtime,/version LIKE 'control-v4\.%'/);
assert.match(runtime,/VALUES\(\$1,'update_agent',\$2,\$3\)/);
assert.match(runtime,/pub const CONTROL_AGENT_VERSION/);
assert.match(migration,/CHECK \(action IN \('restart_xray', 'update_xray', 'update_agent'\)\)/);
assert.match(agent,/AGENT_VERSION="control-v4[.]0[.]0"/);
assert.match(agent,/if action not in \("restart_xray","update_xray","update_agent"\)/);
assert.match(agent,/systemctl start --wait xmesh-node-agent-upgrade[.]service/);
assert.match(agent,/signed_post '\/api\/v1\/node\/restart\/ack'/);
assert.match(updater,/MODE="\$\{1:-manual\}"/);
assert.match(updater,/xmesh-node-agent-upgrade[.]service/);
assert.match(updater,/if \[\[ "\$MODE" != --remote \]\]/);
assert.match(installer,/xmesh-node-agent-upgrade[.]service/);
assert.match(installer,/\/usr\/local\/sbin\/xmesh-update-agent/);
assert.match(app,/data-node-agent-version/);
assert.match(app,/data-agent-update/);
assert.match(app,/\/api\/v1\/nodes\/'\+encodeURIComponent\(id\)\+'\/agent-update/);
assert.match(css,/\[data-agent-update\]/);
assert.match(tests,/admin queued a fixed agent self-update/);

for(const file of ['deploy/node-control-agent.sh','deploy/update-node-control-agent.sh','deploy/install-node-metrics-agent.sh']){
  const result=spawnSync('bash',['-n',file],{encoding:'utf8'});
  assert.equal(result.status,0, file+': '+result.stderr);
}
const syntax=spawnSync(process.execPath,['--check','app.js'],{encoding:'utf8'});
assert.equal(syntax.status,0,syntax.stderr);
console.log('Signed remote Agent upgrade, version reporting and install contract: OK');
