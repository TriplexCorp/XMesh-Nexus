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
const target=runtime.match(/pub const CONTROL_AGENT_VERSION: &str = "(control-v[4-9]\.[0-9]+\.[0-9]+)";/);
assert.ok(target,'Panel must advertise a numbered control runtime');
assert.ok(agent.includes('AGENT_VERSION="'+target[1]+'"'),'Installer must report the same runtime version as the panel');
assert.match(runtime,/version LIKE 'control-v5[.]%'/,'Agent updates must accept control-v5');
assert.match(migration,/CHECK \(action IN \('restart_xray', 'update_xray', 'update_agent'\)\)/);
assert.match(agent,/AGENT_VERSION="control-v[45][.][0-9]+[.][0-9]+"/);
assert.match(agent,/if action not in \("restart_xray","update_xray","update_agent"\)/);
assert.match(agent,/systemctl start --wait xmesh-node-agent-upgrade[.]service/);
assert.match(agent,/signed_post '\/api\/v1\/node\/restart\/ack'/);
assert.match(updater,/MODE="\$\{1:-manual\}"/);
assert.match(updater,/xmesh-node-agent-upgrade[.]service/);
assert.match(updater,/if \[\[ "\$MODE" != --remote \]\]/);

assert.match(updater,/declare -f update_router/,'Router upgrade must execute in the scoped worker');
assert.match(updater,/export HOME=\/run\/xmesh-node-router-upgrade/,'Systemd-constrained Docker builds need a writable HOME');
assert.match(updater,/export DOCKER_CONFIG="\$HOME\/\.docker"/,'Docker must not write to inaccessible /root/.docker');
assert.match(updater,/export BUILDX_CONFIG="\$HOME\/\.buildx"/,'Buildx must keep state in writable /run');
assert.match(updater,/docker --config "\$DOCKER_CONFIG" compose build xmesh-node/,'Compose builds must explicitly use Docker config in writable /run');
assert.match(updater,/export XDG_CACHE_HOME="\$HOME\/\.cache"/,'Buildx cache needs writable runtime path');
assert.match(updater,/export TMPDIR="\$HOME\/tmp"/,'Compose metadata must not use read-only /tmp');
assert.match(updater,/ReadWritePaths=\/run/,'The isolated router upgrade worker must be able to write Docker state');

assert.match(updater,/systemd-run --quiet --wait --collect --pipe/,'Router upgrade must be checked synchronously');
assert.match(updater,/--property=ReadWritePaths=\/opt\/xmesh-node/,'Router worker needs write access to the installed source');
assert.match(updater,/git -C "\$dir" fetch --unshallow origin main/,'Router source clone is shallow after bootstrap');
assert.match(updater,/docker --config "\$DOCKER_CONFIG" compose run --rm --no-deps xmesh-node -check/,'Rebuilt router must be validated');
assert.match(updater,/docker --config "\$DOCKER_CONFIG" compose up -d --no-deps --force-recreate xmesh-node/,'Router must actually be restarted');
assert.doesNotMatch(updater,/then\\n echo/,'Do not embed literal backslash-n in Bash');
assert.match(runtime,/INTERVAL '15 minutes'/,'Long full-node upgrades must not expire after 180 seconds');
const target=runtime.match(/pub const CONTROL_AGENT_VERSION: &str = "(control-v[4-9]\.[0-9]+\.[0-9]+)";/);
assert.ok(target,'Panel must advertise a versioned node runtime release');
assert.ok(agent.includes('AGENT_VERSION="'+target[1]+'"'),'Downloaded control agent must report the exact panel runtime target');
assert.match(runtime,/version LIKE 'control-v5[.]%'/,'Current control-v5 agents must be eligible for self-update');
assert.match(updater,/xmesh-policy-guard[.]py -o "\$policy_tmp"/,'Agent update must fetch updated signed policy guard');

assert.match(installer,/xmesh-node-agent-upgrade[.]service/);
assert.match(installer,/\/usr\/local\/sbin\/xmesh-update-agent/);
assert.match(app,/data-node-agent-version/);
assert.match(app,/data-agent-update/);
assert.match(app,/Date\.now\(\)\+900000/,'Full node update UI must wait 15 minutes');
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
