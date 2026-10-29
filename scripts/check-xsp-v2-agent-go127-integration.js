#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const nodeRoot=path.resolve(process.argv[2] || '.ci/xmesh-node');
const contract=JSON.parse(fs.readFileSync('deploy/xsp-v2-agent-go127.contract.json','utf8'));
const design=fs.readFileSync('docs/XSP_V2_AGENT_GO127_INTEGRATION.md','utf8');
const control=fs.readFileSync('deploy/node-control-agent.sh','utf8');
const updater=fs.readFileSync('deploy/update-node-control-agent.sh','utf8');

assert.equal(contract.schema,'xsp2-agent-go127-integration-v1');
assert.equal(contract.productionActivation,false,'This gate must never authorize production activation');
assert.equal(contract.strictPqDefault,'off','strict-pq must stay OFF');
assert.equal(contract.verifiedNodeSource.repository,'TriplexCorp/XMesh-Node');
assert.match(contract.verifiedNodeSource.revision,/^[0-9a-f]{40}$/);

const actualRevision=execFileSync('git',['-C',nodeRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(actualRevision,contract.verifiedNodeSource.revision,
  'CI must validate the exact pinned XMesh-Node source checkpoint');

const rootGo=fs.readFileSync(path.join(nodeRoot,'go.mod'),'utf8');
assert.match(rootGo,/^module github[.]com\/TriplexCorp\/XMesh-Node$/m);
assert.match(rootGo,/^go 1[.]23$/m,'Production edge-router module must remain on Go 1.23 in this gate');
assert.equal(contract.productionRouter.goVersion,'1.23');
assert.equal(contract.productionRouter.modulePath,'github.com/TriplexCorp/XMesh-Node');
assert.equal(contract.productionRouter.controlReporterInManagedDeployment,false);
assert.equal(contract.productionRouter.mustRemainUnchangedByThisGate,true);

const dockerfile=fs.readFileSync(path.join(nodeRoot,contract.productionRouter.dockerfile),'utf8');
assert.match(dockerfile,/^FROM golang:1[.]23-alpine AS build$/m,
  'Production router Docker build must remain Go 1.23 based');

const securityDir=path.join(nodeRoot,contract.go127SecurityRuntime.moduleDirectory);
const securityGo=fs.readFileSync(path.join(securityDir,'go.mod'),'utf8');
assert.match(securityGo,/^module github[.]com\/TriplexCorp\/XMesh-Node\/security\/xspv2\/poc-go$/m);
assert.match(securityGo,/^go 1[.]27[.]3$/m,'Verified XSP-v2 security module must remain Go 1.27.3');
assert.equal(contract.go127SecurityRuntime.goVersion,'1.27.3');
assert.equal(contract.go127SecurityRuntime.integrationModel,'local-fixed-helper');
assert.equal(contract.go127SecurityRuntime.remoteActionAuthority,'signedControlAgent');
assert.equal(contract.go127SecurityRuntime.inboundNetworkListener,false);
assert.equal(contract.go127SecurityRuntime.mayReplaceProductionRouter,false);
assert.equal(contract.go127SecurityRuntime.mayCreateParallelCommandQueue,false);

assert.deepEqual(contract.go127SecurityRuntime.reusePackages,
  ['envelope','keyring','tlsprobe','cutover']);
for(const pkg of contract.go127SecurityRuntime.reusePackages){
  assert(fs.statSync(path.join(securityDir,pkg)).isDirectory(),`Pinned Node source missing XSP-v2 package: ${pkg}`);
}

const bootstrap=fs.readFileSync(path.join(nodeRoot,'bootstrap.sh'),'utf8');
assert.match(bootstrap,/Signed heartbeats in managed deployments belong to node-control, not/,
  'Managed bootstrap must keep signed control reporting separate from the Go edge router');
assert.match(bootstrap,/for legacy in \("panel_url", "node_id", "private_key_file"\):/,
  'Managed bootstrap must remove legacy router reporter credentials');
assert.match(bootstrap,/install-node-metrics-agent[.]sh/,
  'Managed bootstrap must continue installing the separate signed control/metrics Agent path');

assert.equal(contract.signedControlAgent.fixedAction,'update_agent');
assert.equal(contract.signedControlAgent.systemdUpdater,'xmesh-node-agent-upgrade.service');
assert.equal(contract.signedControlAgent.migrationGate,'XSP_V2_P0D_AGENT_MIGRATION=staging-only');
assert.deepEqual(contract.signedControlAgent.releaseIdentity,
  ['version','sourceRevision','artifactSha256']);
assert.match(control,/if action not in \("restart_xray","update_xray","update_agent"\)/,
  'Control Agent remote action surface must remain fixed');
assert.match(control,/releaseIdentity/,'Control Agent must preserve the immutable release identity contract');
assert.match(updater,/MODE="\$\{1:-manual\}"/);
assert.match(updater,/xmesh-node-agent-upgrade[.]service/,
  'Go 1.27 integration must stay behind the existing fixed updater authority');

assert.equal(contract.migrationRules.legacyUnboundUpdateRemainsCompatible,true);
assert.equal(contract.migrationRules.boundMigrationRequiresExactReleaseIdentity,true);
assert.equal(contract.migrationRules.missingSecurityRuntime,'fail-closed');
assert.equal(contract.migrationRules.mixedVersionMigratedOperation,'fail-closed');
assert.equal(contract.migrationRules.missingOrInvalidReceipt,'fail-closed');
assert.equal(contract.migrationRules.transportFailure,'fail-closed');
assert.equal(contract.migrationRules.automaticFallback,false);
assert.deepEqual(contract.migrationRules.forbiddenFallbacks,
  ['XMESH1','Ed25519-only','X25519-only','TLS1.2','insecure-certificate-verification']);

assert.equal(contract.packagingBoundary.sourceRevisionMustEqualApprovedManifest,true);
assert.equal(contract.packagingBoundary.artifactSha256MustEqualApprovedManifest,true);
assert.equal(contract.packagingBoundary.callerSelectedExecutableLocation,false);
assert.equal(contract.packagingBoundary.callerSelectedDownloadUrl,false);
assert.equal(contract.packagingBoundary.lastKnownGoodRequiredBeforeApply,true);
assert.equal(contract.packagingBoundary.downloadVerifyApplyIsFutureGate,true);

assert.match(design,/local fixed security helper\/runtime/);
assert.match(design,/root production router module remains Go 1[.]23/);
assert.match(design,/nested verified XSP-v2 module remains Go 1[.]27[.]3/);
assert.match(design,/staged download \/ verify \/ apply \/ rollback/);
assert.match(design,/strict-pq` remains \*\*OFF\*\*/);
assert.doesNotMatch(JSON.stringify(contract),/strict-pq=on/i);

console.log(`PASS: P0-D Go 1.27 integration contract verified against XMesh-Node ${actualRevision}`);
