#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');

const api=fs.readFileSync('backend/src/main.rs','utf8');
const runtimeEntry=fs.readFileSync('backend/src/node_runtime.rs','utf8');
const runtimeLegacy=fs.readFileSync('backend/src/node_runtime_legacy.rs','utf8');
const runtime=runtimeEntry+'\n'+runtimeLegacy;
const migration=fs.readFileSync('backend/migrations/0024_node_agent_updates.sql','utf8');
const releaseManifest=fs.readFileSync('backend/migrations/0107_node_xsp_agent_release_manifests.sql','utf8');
const migrationBinding=fs.readFileSync('backend/migrations/0108_node_xsp_agent_migration_binding.sql','utf8');
const releaseAck=fs.readFileSync('backend/migrations/0109_node_xsp_agent_release_ack_identity.sql','utf8');
const agent=fs.readFileSync('deploy/node-control-agent.sh','utf8');
const updater=fs.readFileSync('deploy/update-node-control-agent.sh','utf8');
const installer=fs.readFileSync('deploy/install-node-metrics-agent.sh','utf8');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const tests=fs.readFileSync('scripts/test-node-auth-integration.py','utf8');
const orchestration=fs.readFileSync('scripts/test-xsp-agent-orchestration-api.py','utf8');
const migrationDesign=fs.readFileSync('docs/XSP_V2_AGENT_MIGRATION_ARCHITECTURE.md','utf8');

assert.match(api,/\/nodes\/\{id\}\/agent-update/);
assert.match(runtimeEntry,/pub async fn request_agent_update/);
assert.match(runtimeLegacy,/pub struct AgentUpdateRequest \{\}/);
assert.match(runtime,/deny_unknown_fields/);
assert.match(runtimeLegacy,/crate::require_mutation\(&actor\)/);
assert.match(runtimeLegacy,/version LIKE 'control-v4\.%'/);
assert.match(runtimeLegacy,/VALUES\(\$1,'update_agent',\$2,\$3\)/);
assert.match(runtimeLegacy,/pub const CONTROL_AGENT_VERSION/);
const target=runtimeLegacy.match(/pub const CONTROL_AGENT_VERSION: &str = "(control-v[4-9]\.[0-9]+\.[0-9]+)";/);
assert.ok(target,'Panel must advertise a numbered control runtime');
assert.ok(agent.includes('AGENT_VERSION="'+target[1]+'"'),'Installer must report the same runtime version as the panel');
assert.match(runtimeLegacy,/version LIKE 'control-v5[.]%'/,'Agent updates must accept control-v5');
assert.match(migration,/CHECK \(action IN \('restart_xray', 'update_xray', 'update_agent'\)\)/);

// P0-D starts with an inert append-only release identity ledger. It must not
// broaden the existing remote command surface or encode a caller-selected URL.
assert.match(releaseManifest,/CREATE TABLE node_xsp_agent_release_manifests/);
assert.match(releaseManifest,/version TEXT NOT NULL UNIQUE/,'One version must have one immutable identity');
assert.match(releaseManifest,/source_revision ~ '\^\[0-9a-f\]\{40\}\$'/,'Source revision must be a canonical Git commit SHA');
assert.match(releaseManifest,/artifact_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/,'Artifact digest must be canonical SHA-256');
assert.match(releaseManifest,/UNIQUE \(source_revision, artifact_sha256\)/);
assert.match(releaseManifest,/BEFORE UPDATE OR DELETE ON node_xsp_agent_release_manifests/);
assert.match(releaseManifest,/BEFORE TRUNCATE ON node_xsp_agent_release_manifests/);
assert.match(releaseManifest,/append-only/);
assert.doesNotMatch(releaseManifest,/\b(url|uri|script|command)\b\s+TEXT/i,
  'Release manifest must never introduce remotely selected executable locations or commands');
assert.doesNotMatch(releaseManifest,/strict-pq=on/,'Manifest foundation must not activate strict PQ');

// P0-D1b binds that immutable identity to the existing update_agent queue only.
assert.match(migrationBinding,/ADD COLUMN release_manifest_id BIGINT/);
assert.match(migrationBinding,/REFERENCES node_xsp_agent_release_manifests\(id\) ON DELETE RESTRICT/);
assert.match(migrationBinding,/CHECK \(release_manifest_id IS NULL OR action = 'update_agent'\)/);
assert.match(migrationBinding,/CREATE OR REPLACE FUNCTION validate_node_xsp_agent_migration_binding/);
assert.match(migrationBinding,/NEW\.target_version IS DISTINCT FROM manifest_version/);
assert.match(migrationBinding,/bound XSP-v2 Agent migration identity is immutable/);
assert.match(migrationBinding,/CREATE OR REPLACE FUNCTION stage_node_xsp_agent_migration/);
assert.match(migrationBinding,/p_node_id, 'update_agent', p_requested_by, manifest\.version, manifest\.id/);
assert.match(migrationBinding,/ON CONFLICT DO NOTHING/,'Existing single-flight queue must remain authoritative');
assert.match(migrationBinding,/node already has an active control command/);
assert.doesNotMatch(migrationBinding,/\b(url|uri|script|command_text|shell)\b\s+(TEXT|VARCHAR)/i,
  'Migration binding must not add remotely selected executable input');
assert.doesNotMatch(migrationBinding,/strict-pq=on/,'Binding primitive must not activate strict PQ');

// P0-D1c reuses the same endpoint. `{}` is delegated into the previous handler;
// release selection is exact-gated, owner-only and resolves identity server-side.
assert.match(runtimeEntry,/path = "node_runtime_legacy[.]rs"/,
  'D1c must preserve the previous runtime implementation as the legacy path');
assert.match(runtimeEntry,/release_version: String/);
assert.match(runtimeEntry,/rename_all = "camelCase", deny_unknown_fields/);
assert.match(runtimeEntry,/XSP_V2_P0D_AGENT_MIGRATION/);
assert.match(runtimeEntry,/value == Some\("staging-only"\)/,
  'Migration gate must require the exact staging-only value');
assert.match(runtimeEntry,/crate::require_owner\(actor\)/,
  'Release selection must require owner authorization');
assert.match(runtimeEntry,/FROM stage_node_xsp_agent_migration\(\$1,\$2,\$3\)/,
  'D1c must reuse the D1b atomic manifest-binding primitive');
assert.match(runtimeEntry,/Approved Agent release was not found/);
assert.match(runtimeEntry,/AgentUpdateRequest::Legacy\(_\)/);
assert.match(runtimeEntry,/legacy::request_agent_update/,
  'Legacy empty requests must execute the previous handler');
assert.match(runtimeEntry,/AgentUpdateRequest::Migration\(request\)/);
assert.doesNotMatch(runtimeEntry,/\b(url|uri|script|shell|command_text)\s*:/i,
  'D1c request schema must never accept caller-selected executable input');
assert.doesNotMatch(runtimeEntry,/strict-pq=on/,'D1c must not activate strict PQ');

// Exact release identity moves through the existing authenticated poll/apply/ACK lifecycle.
assert.match(runtimeEntry,/pub async fn poll_restart/);
assert.match(runtimeEntry,/LEFT JOIN node_xsp_agent_release_manifests m ON m[.]id=c[.]release_manifest_id/);
assert.match(runtimeEntry,/command\["releaseIdentity"\]/);
assert.match(runtimeEntry,/pub async fn acknowledge_restart/);
assert.match(runtimeEntry,/FOR UPDATE OF c/);
assert.match(runtimeEntry,/Bound Agent command requires exact release identity acknowledgement/);
assert.match(runtimeEntry,/release_ack_version=\$5/);
assert.match(runtimeEntry,/release_ack_received_at=CASE WHEN \$5::TEXT IS NULL THEN NULL ELSE NOW\(\) END/);
assert.match(runtimeEntry,/Legacy command must not carry Agent release identity/);
assert.doesNotMatch(runtimeEntry,/\b(url|uri|script|shell|command_text)\s*:/i,
  'Poll/ACK identity must not add executable input');

assert.match(releaseAck,/ADD COLUMN release_ack_version TEXT/);
assert.match(releaseAck,/ADD COLUMN release_ack_source_revision TEXT/);
assert.match(releaseAck,/ADD COLUMN release_ack_artifact_sha256 TEXT/);
assert.match(releaseAck,/ADD COLUMN release_ack_success BOOLEAN/);
assert.match(releaseAck,/CREATE OR REPLACE FUNCTION validate_node_xsp_agent_release_ack_identity/);
assert.match(releaseAck,/XSP-v2 Agent release ACK identity is immutable/);
assert.match(releaseAck,/legacy Agent command cannot carry XSP-v2 release ACK identity/);
assert.match(releaseAck,/XSP-v2 Agent release ACK identity mismatch/);
assert.match(releaseAck,/NEW[.]state = 'succeeded'/);
assert.match(releaseAck,/NEW[.]release_ack_success IS DISTINCT FROM TRUE/,
  'Bound heartbeat-only success must be ignored unless exact successful ACK evidence exists');
assert.doesNotMatch(releaseAck,/strict-pq=on/,'ACK identity gate must not activate strict PQ');

assert.match(agent,/AGENT_VERSION="control-v[45][.][0-9]+[.][0-9]+"/);
assert.match(agent,/router_running\(\)\{/,'Control agent needs an independent edge-router health probe');
assert.match(agent,/if router_running;then router=true;fi/,'Router heartbeat must come from its own process');
assert.ok(agent.includes('router_running\\":$router'),'Router status must not be copied from Xray health');
assert.match(agent,/if action not in \("restart_xray","update_xray","update_agent"\)/);
assert.match(agent,/releaseIdentity/);
assert.match(agent,/set\(identity\)!=\{"version","sourceRevision","artifactSha256"\}/);
assert.match(agent,/stage_agent_release_identity\(\)/);
assert.match(agent,/RELEASE_IDENTITY_FILE=\/run\/xmesh-node-control\/agent-release-identity[.]json/);
assert.match(agent,/ack_identity=.*releaseIdentity/);
assert.match(agent,/systemctl start --wait xmesh-node-agent-upgrade[.]service/);
assert.match(agent,/signed_post '\/api\/v1\/node\/restart\/ack'/);
assert.match(updater,/MODE="\$\{1:-manual\}"/);
assert.match(updater,/xmesh-node-agent-upgrade[.]service/);
assert.match(updater,/if \[\[ "\$MODE" != --remote \]\]/);

assert.match(updater,/declare -f update_router/,'Router upgrade must execute in the scoped worker');
assert.match(updater,/export HOME=\/run\/xmesh-node-router-upgrade/);
assert.match(updater,/export DOCKER_CONFIG="\$HOME\/\.docker"/);
assert.match(updater,/export BUILDX_CONFIG="\$HOME\/\.buildx"/);
assert.match(updater,/docker --config "\$DOCKER_CONFIG" compose build xmesh-node/);
assert.match(updater,/export XDG_CACHE_HOME="\$HOME\/\.cache"/);
assert.match(updater,/export TMPDIR="\$HOME\/tmp"/);
assert.match(updater,/ReadWritePaths=\/run/);
assert.match(updater,/systemd-run --quiet --wait --collect --pipe/);
assert.match(updater,/--property=ReadWritePaths=\/opt\/xmesh-node/);
assert.match(updater,/git -C "\$dir" fetch --unshallow origin main/);
assert.match(updater,/docker --config "\$DOCKER_CONFIG" compose run --rm --no-deps xmesh-node -check/);
assert.match(updater,/docker --config "\$DOCKER_CONFIG" compose up -d --no-deps --force-recreate xmesh-node/);
assert.doesNotMatch(updater,/then\\n echo/,'Do not embed literal backslash-n in Bash');
assert.match(runtime,/INTERVAL '15 minutes'/,'Long full-node upgrades must not expire after 180 seconds');
assert.match(updater,/xmesh-policy-guard[.]py -o "\$policy_tmp"/);
assert.match(updater,/xmesh-profile-attest[.]py -o "\$profile_tmp"/);
assert.match(updater,/python3 -m py_compile "\$profile_tmp"/);
assert.match(updater,/grep -q 'verify_envelope' "\$profile_tmp"/);
assert.match(updater,/mv -f \/usr\/local\/libexec\/\.xmesh-profile-attest[.]new \/usr\/local\/libexec\/xmesh-profile-attest[.]py/);
assert.match(agent,/profile_check='helper_missing'/);
assert.match(app,/helper_missing:'Проверка профиля не установлена · нажмите «Обновить Agent»'/);

assert.match(installer,/xmesh-node-agent-upgrade[.]service/);
assert.match(installer,/\/usr\/local\/sbin\/xmesh-update-agent/);
assert.match(app,/data-node-agent-version/);
assert.match(app,/data-agent-update/);
assert.match(app,/Date\.now\(\)\+900000/,'Full node update UI must wait 15 minutes');
assert.match(app,/\/api\/v1\/nodes\/'\+encodeURIComponent\(id\)\+'\/agent-update/);
assert.match(css,/\[data-agent-update\]/);
assert.match(tests,/admin queued a fixed agent self-update/);
assert.match(orchestration,/bound ACK without release identity fails closed/);
assert.match(orchestration,/bound migration cannot become success from version-only heartbeat/);
assert.match(orchestration,/exact immutable release identity is durable ACK evidence/);

// P0-D real Agent integration design: lock down component identity, reuse and rollback.
assert.match(migrationDesign,/root Go 1\.23 router is not the control Agent/,
  'Migration design must distinguish the edge router from the control Agent');
assert.match(migrationDesign,/\/usr\/local\/sbin\/xmesh-node-control/);
assert.match(migrationDesign,/xmesh-node-control\.service/);
assert.match(migrationDesign,/xmesh-node-control\.timer/);
assert.match(migrationDesign,/xmesh-node-agent-upgrade\.service/);
assert.match(migrationDesign,/agent\/xspv2/,'Go 1.27 migration must reuse the Node Agent artifact boundary');
assert.match(migrationDesign,/Go 1\.27\.3/);
assert.match(migrationDesign,/bedbec74413a5ea86f69aca685f24bf028775a98/,
  'Design must pin the reviewed Node PR #34/#35 artifact checkpoint');
assert.match(migrationDesign,/reuse, not copy/,
  'Design must forbid a parallel XSP-v2 state machine');
assert.match(migrationDesign,/last-known-good/,'Rollback boundary must be defined before apply work');
assert.match(migrationDesign,/There is \*\*no silent downgrade\*\*/);
assert.match(migrationDesign,/old shell Agent or Go Agent missing required PQ\/state support \| fail closed/);
assert.match(migrationDesign,/XMESH1, Ed25519-only, X25519-only, TLS 1\.2/);
assert.match(migrationDesign,/Address.*direct TCP connect target/);
assert.match(migrationDesign,/ServerName.*authenticated authority/);
assert.match(migrationDesign,/remote action remains exactly `update_agent`/);
assert.match(migrationDesign,/must not roll security epochs\/replay floors backwards/);
assert.match(migrationDesign,/`strict-pq` remains OFF/);
assert.doesNotMatch(migrationDesign,/production activation authorized/i,
  'Design gate must not authorize production activation');

for(const file of ['deploy/node-control-agent.sh','deploy/update-node-control-agent.sh','deploy/install-node-metrics-agent.sh']){
  const result=spawnSync('bash',['-n',file],{encoding:'utf8'});
  assert.equal(result.status,0, file+': '+result.stderr);
}
const syntax=spawnSync(process.execPath,['--check','app.js'],{encoding:'utf8'});
assert.equal(syntax.status,0,syntax.stderr);
console.log('Signed Agent upgrade, release identity lifecycle and Go 1.27 migration architecture contract: OK');
