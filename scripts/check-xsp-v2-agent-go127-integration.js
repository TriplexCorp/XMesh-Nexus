#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const contract=JSON.parse(fs.readFileSync('deploy/xsp-v2-agent-go127.contract.json','utf8'));
const design=fs.readFileSync('docs/XSP_V2_AGENT_GO127_INTEGRATION.md','utf8');
const architecture=fs.readFileSync('docs/XSP_V2_AGENT_MIGRATION_ARCHITECTURE.md','utf8');
const control=fs.readFileSync('deploy/node-control-agent.sh','utf8');
const updater=fs.readFileSync('deploy/update-node-control-agent.sh','utf8');

function fetchPinnedNodeSource(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xmesh-node-go127-'));
  execFileSync('git',['-C',root,'init','-q'],{stdio:'inherit'});
  execFileSync('git',['-C',root,'remote','add','origin','https://github.com/TriplexCorp/XMesh-Node.git'],{stdio:'inherit'});
  execFileSync('git',['-C',root,'fetch','--quiet','--depth=1','origin',contract.verifiedNodeSource.revision],{stdio:'inherit'});
  execFileSync('git',['-C',root,'checkout','--quiet','--detach','FETCH_HEAD'],{stdio:'inherit'});
  return root;
}

function verify(nodeRoot){
  assert.equal(contract.schema,'xsp2-agent-go127-integration-v1');
  assert.equal(contract.productionActivation,false,'This gate must never authorize production activation');
  assert.equal(contract.strictPqDefault,'off','strict-pq must stay OFF');
  assert.equal(contract.verifiedNodeSource.repository,'TriplexCorp/XMesh-Node');
  assert.equal(contract.verifiedNodeSource.revision,'bedbec74413a5ea86f69aca685f24bf028775a98',
    'The integration contract must follow the current Node PR #34/#35 Agent boundary');

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

  // The production-capable Agent boundary is the side-by-side agent/xspv2
  // module added by Node PR #34/#35. It is a thin integration wrapper over the
  // already-proven security/xspv2/poc-go primitives, not a second state machine.
  const agentDir=path.join(nodeRoot,contract.agentIntegrationModule.moduleDirectory);
  const agentGo=fs.readFileSync(path.join(agentDir,'go.mod'),'utf8');
  assert.match(agentGo,/^module github[.]com\/TriplexCorp\/XMesh-Node\/agent\/xspv2$/m);
  assert.match(agentGo,/^go 1[.]27[.]3$/m,'Production-capable Agent integration module must remain Go 1.27.3');
  assert.match(agentGo,/require github[.]com\/TriplexCorp\/XMesh-Node\/security\/xspv2\/poc-go v0[.]0[.]0/m,
    'Agent integration module must reuse the proven security module');
  assert.match(agentGo,/replace github[.]com\/TriplexCorp\/XMesh-Node\/security\/xspv2\/poc-go => [.][.]\/[.][.]\/security\/xspv2\/poc-go/m);
  assert.equal(contract.agentIntegrationModule.modulePath,'github.com/TriplexCorp/XMesh-Node/agent/xspv2');
  assert.equal(contract.agentIntegrationModule.goVersion,'1.27.3');
  assert.equal(contract.agentIntegrationModule.stateRoot,'/var/lib/xmesh-agent/xsp-v2');
  assert.equal(contract.agentIntegrationModule.installedByDefault,false);
  assert.equal(contract.agentIntegrationModule.productionActivated,false);
  assert.equal(contract.agentIntegrationModule.mayReplaceProductionRouter,false);
  assert.equal(contract.agentIntegrationModule.mayCreateParallelCommandQueue,false);
  assert.equal(contract.agentIntegrationModule.securityPrimitiveModule,'security/xspv2/poc-go');

  const agentReadme=fs.readFileSync(path.join(agentDir,'README.md'),'utf8');
  assert.match(agentReadme,/first production-capable Agent integration boundary for XSP-v2/);
  assert.match(agentReadme,/not installed or activated by default/);
  assert.match(agentReadme,/reuses the already-proven `security\/xspv2\/poc-go\/cutover`/);
  assert.match(agentReadme,/\/var\/lib\/xmesh-agent\/xsp-v2/);

  const agentTransport=fs.readFileSync(path.join(agentDir,'runtime','transport_linux.go'),'utf8');
  assert.match(agentTransport,/cutover "github[.]com\/TriplexCorp\/XMesh-Node\/security\/xspv2\/poc-go\/cutover"/);
  assert.match(agentTransport,/Agent integration bridge, not another protocol\/state machine/);
  assert.match(agentTransport,/ExchangeSignedACKForReceipt\(ctx, endpoint[.]Address, endpoint[.]ServerName/);
  assert.match(agentTransport,/RecoverSignedACKReceipt\(ctx, endpoint[.]Address, endpoint[.]ServerName/);

  const securityDir=path.join(nodeRoot,contract.go127SecurityRuntime.moduleDirectory);
  const securityGo=fs.readFileSync(path.join(securityDir,'go.mod'),'utf8');
  assert.match(securityGo,/^module github[.]com\/TriplexCorp\/XMesh-Node\/security\/xspv2\/poc-go$/m);
  assert.match(securityGo,/^go 1[.]27[.]3$/m,'Reused XSP-v2 security module must remain Go 1.27.3');
  assert.equal(contract.go127SecurityRuntime.goVersion,'1.27.3');
  assert.equal(contract.go127SecurityRuntime.integrationModel,'dependency-of-agent-integration-module');
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

  assert.match(design,/Agent artifact boundary is `agent\/xspv2`/);
  assert.match(design,/dependency module: `security\/xspv2\/poc-go`/);
  assert.match(design,/root production router module remains Go 1[.]23/);
  assert.match(design,/production-capable `agent\/xspv2` integration module exists and remains Go 1[.]27[.]3/);
  assert.match(design,/staged download \/ verify \/ apply \/ rollback/);
  assert.match(design,/strict-pq` remains \*\*OFF\*\*/);
  assert.match(architecture,/only approved starting point for the future production-capable XSP-v2 Agent/);
  assert.match(architecture,/agent\/xspv2/);
  assert.match(architecture,/thin bridge into the proven XSP-v2 cutover implementation/);
  assert.doesNotMatch(JSON.stringify(contract),/strict-pq=on/i);

  console.log(`PASS: P0-D Go 1.27 Agent wrapper + reused security primitives verified against XMesh-Node ${actualRevision}`);
}

let temporaryRoot=null;
try{
  const supplied=process.argv[2];
  const nodeRoot=supplied ? path.resolve(supplied) : (temporaryRoot=fetchPinnedNodeSource());
  verify(nodeRoot);
} finally {
  if(temporaryRoot){
    fs.rmSync(temporaryRoot,{recursive:true,force:true});
  }
}
