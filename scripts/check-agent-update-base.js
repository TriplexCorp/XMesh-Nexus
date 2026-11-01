#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');

const api=fs.readFileSync('backend/src/main.rs','utf8');
const runtimeEntry=fs.readFileSync('backend/src/node_runtime.rs','utf8');
const runtimeLegacy=fs.readFileSync('backend/src/node_runtime_legacy.rs','utf8');
const runtime=runtimeEntry+'\n'+runtimeLegacy;
const artifactSource=fs.readFileSync('backend/src/node_agent_artifact.rs','utf8');
const migration=fs.readFileSync('backend/migrations/0024_node_agent_updates.sql','utf8');
const releaseManifest=fs.readFileSync('backend/migrations/0107_node_xsp_agent_release_manifests.sql','utf8');
const migrationBinding=fs.readFileSync('backend/migrations/0108_node_xsp_agent_migration_binding.sql','utf8');
const releaseAck=fs.readFileSync('backend/migrations/0109_node_xsp_agent_release_ack_identity.sql','utf8');
const agent=fs.readFileSync('deploy/node-control-agent.sh','utf8');
const updater=fs.readFileSync('deploy/update-node-control-agent.sh','utf8');
const installer=fs.readFileSync('deploy/install-node-metrics-agent.sh','utf8');
const stager=fs.readFileSync('deploy/xsp-v2-agent-staged-apply.sh','utf8');
const stageUnit=fs.readFileSync('deploy/xmesh-xsp-v2-agent-stage.service','utf8');
const stagedLifecycleTest=fs.readFileSync('scripts/test-xsp-agent-staged-apply.sh','utf8');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');

assert.equal(fs.readFileSync('VERSION','utf8').trim(),'6.0.0');
assert.equal(fs.readFileSync('AGENT_VERSION','utf8').trim(),'control-v6.0.6');
assert.match(api,/\/nodes\/\{id\}\/agent-update/);
assert.match(runtimeEntry,/pub const CONTROL_AGENT_VERSION: &str = "control-v6[.]0[.]6";/);
assert.match(runtimeEntry,/control_v6_transition_active/);
for(const v of ['control-v4','control-v5','control-v6']) assert.ok(runtimeEntry.includes(v),`v6 transition must accept ${v}`);
assert.match(runtimeEntry,/VALUES\(\$1,'update_agent',\$2,\$3\)/);
assert.match(runtimeEntry,/\.bind\(CONTROL_AGENT_VERSION\)/);
assert.match(runtimeEntry,/AgentUpdateRequest::Migration/,'Manifest-bound migration path must remain available');
assert.match(runtimeEntry,/staged::request_agent_update/,'Non-empty immutable release migration stays on reviewed staged path');
assert.doesNotMatch(runtimeEntry,/\b(url|uri|script|shell|command_text)\s*:/i,'v6 API must not accept executable remote input');

assert.match(migration,/CHECK \(action IN \('restart_xray', 'update_xray', 'update_agent'\)\)/);
assert.match(releaseManifest,/CREATE TABLE node_xsp_agent_release_manifests/);
assert.match(releaseManifest,/version TEXT NOT NULL UNIQUE/);
assert.match(releaseManifest,/source_revision ~ '\^\[0-9a-f\]\{40\}\$'/);
assert.match(releaseManifest,/artifact_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
assert.match(releaseManifest,/BEFORE UPDATE OR DELETE ON node_xsp_agent_release_manifests/);
assert.match(releaseManifest,/BEFORE TRUNCATE ON node_xsp_agent_release_manifests/);
assert.doesNotMatch(releaseManifest,/\b(url|uri|script|command)\b\s+TEXT/i);

assert.match(migrationBinding,/ADD COLUMN release_manifest_id BIGINT/);
assert.match(migrationBinding,/ON DELETE RESTRICT/);
assert.match(migrationBinding,/release_manifest_id IS NULL OR action = 'update_agent'/);
assert.match(migrationBinding,/bound XSP-v2 Agent migration identity is immutable/);
assert.match(migrationBinding,/stage_node_xsp_agent_migration/);
assert.doesNotMatch(migrationBinding,/\b(url|uri|script|command_text|shell)\b\s+(TEXT|VARCHAR)/i);

for(const field of ['release_ack_version','release_ack_source_revision','release_ack_artifact_sha256','release_ack_success']) {
  assert.ok(releaseAck.includes(field),`Missing durable Agent ACK field: ${field}`);
}
assert.match(releaseAck,/XSP-v2 Agent release ACK identity is immutable/);
assert.match(releaseAck,/XSP-v2 Agent release ACK identity mismatch/);
assert.match(releaseAck,/NEW[.]release_ack_success IS DISTINCT FROM TRUE/);

// v6 shell control worker remains the authority for the fixed command surface.
assert.match(agent,/AGENT_VERSION="control-v6[.]0[.]6"/);
assert.match(agent,/if action not in \("restart_xray","update_xray","update_agent"\)/);
assert.match(agent,/router_running\(\)/);
assert.match(agent,/releaseIdentity/);
assert.match(agent,/stage_agent_release_identity\(\)/);
assert.match(agent,/verify_staged_agent_package\(\)/);
assert.match(agent,/run_agent_updater\(\)/,'Agent must self-heal a missing updater unit');
assert.match(agent,/systemd-run[\s\S]*xmesh-node-agent-upgrade-repair/,'Missing static updater unit must use a fixed hardened transient repair service');
assert.match(agent,/raw[.]githubusercontent[.]com\/TriplexCorp\/XMesh-Nexus\/main\/deploy\/update-node-control-agent[.]sh/,'Missing updater executable must have a fixed-source bootstrap path');
assert.match(agent,/signed_post '\/api\/v1\/node\/restart\/ack'/);
assert.match(agent,/grep -Fxq "AGENT_VERSION=\\"\$target_version\\""/);
assert.doesNotMatch(agent,/eval\s|bash -c.*\$|sh -c.*\$/,'Control worker must not execute remote shell input');

// A legacy v4/v5/v6.0.0 node upgrades to the current v6 patch using the same
// authenticated fixed action, with a real PQ production binary and exact identity.
assert.match(updater,/MODE="\$\{1:-manual\}"/);
assert.match(updater,/AGENT_VERSION=\\?"control-v6[.]0[.]6/);
assert.match(updater,/XMesh-Node\/main/);
assert.match(updater,/VERSION/);
assert.match(updater,/6[.]0[.]0/);
assert.match(updater,/AGENT_VERSION/);
assert.match(updater,/control-v6[.]0[.]6/);
assert.match(updater,/install-xsp-v2-production-agent[.]sh/);
assert.match(updater,/xmesh-agent-xspv2-activate --identity/);
assert.match(updater,/xmesh-hot-user-reconcile[.]py/);
assert.match(updater,/sourceRevision|source_revision/);
assert.match(updater,/artifactSha256/);
assert.match(updater,/ReadWritePaths=.*\/usr\/local\/bin/);
assert.match(updater,/ReadWritePaths=.*\/var\/lib\/xmesh-agent/);
assert.match(updater,/git -C "\$dir" merge --ff-only FETCH_HEAD/);
assert.match(updater,/compose run --rm --no-deps xmesh-node -check/);
assert.match(updater,/compose up -d --no-deps --force-recreate xmesh-node/);
assert.match(updater,/reset --hard "\$previous"/,'Router source rollback must remain defined');
assert.match(updater,/RELEASE_IDENTITY_FILE=\/run\/xmesh-node-control\/agent-release-identity[.]json/);
const boundDispatch=updater.indexOf('if [[ "$MODE" == --remote && -e "$RELEASE_IDENTITY_FILE" ]]');
const movingMainFetch=updater.indexOf('https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/node-control-agent.sh');
assert.ok(boundDispatch>=0 && movingMainFetch>boundDispatch,'Manifest-bound apply must dispatch locally before moving-main fetch');

// Fresh enrollment must also install a real v6 PQ runtime, not merely a badge.
assert.match(installer,/AGENT_VERSION=\\?"control-v6[.]0[.]6/);
assert.match(installer,/install_v6_pq_runtime\(\)/);
assert.match(installer,/install-xsp-v2-production-agent[.]sh/);
assert.match(installer,/xmesh-agent-xspv2-activate --identity/);
assert.match(installer,/VERSION/);
assert.match(installer,/6[.]0[.]0/);
assert.match(installer,/control-v6[.]0[.]6/);
assert.match(installer,/ReadWritePaths=.*\/usr\/local\/bin/);
assert.match(installer,/ReadWritePaths=.*\/var\/lib\/xmesh-agent/);

// Authenticated content-addressed staged migration remains intact for explicit
// immutable release identities and still cannot roll security state backwards.
assert.match(runtimeEntry,/artifactVersion/);
assert.match(runtimeEntry,/artifact::download_claimed/);
assert.match(artifactSource,/XSP_V2_P0D_AGENT_ARTIFACT_DIR/);
assert.match(artifactSource,/c[.]state='claimed'/);
assert.match(artifactSource,/Sha256::digest\(&bytes\)/);
assert.doesNotMatch(artifactSource,/\b(url|uri|script|command_text)\s*:/i);
assert.match(stager,/artifactVersion/);
assert.match(stager,/sha256sum "\$binary"/);
assert.match(stager,/"\$binary" --identity/);
assert.match(stager,/"\$binary" --check-state "\$STATE_ROOT"/);
assert.match(stager,/last-known-good[.]json/);
assert.match(stager,/rollback\(\)/);
assert.match(stager,/STATE_ROOT="\$BASE\/xsp-v2"/);
assert.doesNotMatch(stager,/rm -rf[^\n]*STATE_ROOT|mv[^\n]*STATE_ROOT/);
assert.match(stageUnit,/^ProtectSystem=strict$/m);
assert.match(stageUnit,/^ProtectHome=true$/m);
assert.match(stageUnit,/^ReadWritePaths=\/run \/var\/lib\/xmesh-agent$/m);
assert.doesNotMatch(stageUnit,/WantedBy=/);

assert.match(app,/data-node-agent-version/);
assert.match(app,/data-agent-update/);
assert.match(css,/\[data-agent-update\]/);
assert.match(stagedLifecycleTest,/digest mismatch unexpectedly succeeded/);
assert.match(stagedLifecycleTest,/embedded identity mismatch unexpectedly succeeded/);
assert.match(stagedLifecycleTest,/post-switch self-check failure unexpectedly succeeded/);

for(const file of ['deploy/node-control-agent.sh','deploy/update-node-control-agent.sh','deploy/install-node-metrics-agent.sh','deploy/xsp-v2-agent-staged-apply.sh','scripts/provision-xsp-v2-v6-foundation.sh','install.sh']) {
  const result=spawnSync('bash',['-n',file],{encoding:'utf8'});
  assert.equal(result.status,0,file+': '+result.stderr);
}
const staged=spawnSync('bash',['scripts/test-xsp-agent-staged-apply.sh'],{encoding:'utf8',timeout:60000});
assert.equal(staged.status,0,'Staged Agent lifecycle test failed:\n'+(staged.stdout||'')+'\n'+(staged.stderr||''));
assert.match(staged.stdout,/staged Agent package apply\/rollback lifecycle: OK/);
const syntax=spawnSync(process.execPath,['--check','app.js'],{encoding:'utf8'});
assert.equal(syntax.status,0,syntax.stderr);
console.log('XMesh control-v6.0.6 POSTQUANTUM Agent upgrade/install and immutable staged migration contract: OK');
