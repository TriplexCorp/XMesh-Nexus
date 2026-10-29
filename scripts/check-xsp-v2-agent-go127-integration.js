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
  assert.equal(contract.schema,'xsp2-agent-go127-integration-v2');
  assert.equal(contract.productionActivation,false,'This gate must never authorize production activation');
  assert.equal(contract.strictPqDefault,'off','strict-pq must stay OFF');
  assert.equal(contract.verifiedNodeSource.repository,'TriplexCorp/XMesh-Node');
  assert.equal(contract.verifiedNodeSource.revision,'5e8ee562915a570eb49ed46d59d723f233f3cc68',
    'The integration contract must pin the merged durable-state Node checkpoint');

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
  assert.match(agentReadme,/production-capable Agent integration boundary for XSP-v2/);
  assert.match(agentReadme,/not installed or activated by default/i);
  assert.match(agentReadme,/security\/xspv2\/poc-go\/cutover/);
  assert.match(agentReadme,/\/var\/lib\/xmesh-agent\/xsp-v2/);
  assert.match(agentReadme,/node-request[.]vault[.]min-epoch/);
  assert.match(agentReadme,/Restoring an old active vault below the floor/);

  const stateLayout=fs.readFileSync(path.join(agentDir,'state','state_linux.go'),'utf8');
  const durableState=fs.readFileSync(path.join(agentDir,'state','durable_linux.go'),'utf8');
  const stateTests=fs.readFileSync(path.join(agentDir,'state','state_linux_test.go'),'utf8');
  assert.match(stateLayout,/DefaultRoot = "\/var\/lib\/xmesh-agent\/xsp-v2"/);
  assert.match(stateLayout,/filepath[.]Join\(root, "cutover"\)/);
  assert.match(stateLayout,/filepath[.]Join\(root, "keys"\)/);
  assert.match(stateLayout,/"node-request[.]vault"/);
  assert.match(stateLayout,/"node-request[.]master"/);
  assert.match(stateLayout,/Prepare creates only the production-style private directory boundaries/);
  assert.match(durableState,/keyring[.]AttestAppliedRotation\(layout[.]Vault, layout[.]MasterKey/,
    'Real Agent durable state must reuse the proven keyring applied-rotation attestation');
  assert.match(durableState,/layout[.]Vault \+ "[.]previous"/);
  assert.match(durableState,/layout[.]Vault \+ "[.]next"/);
  assert.match(durableState,/old\/new authenticated key snapshots must be retained/);
  assert.match(stateTests,/TestAppliedSecurityStateSurvivesAgentRestartWithoutRegeneration/);
  assert.match(stateTests,/TestOldVaultRestoreBelowEpochFloorFailsClosed/);
  assert.match(stateTests,/TestLoweredCorruptOrMissingDurableEvidenceFailsClosed/);
  assert.match(stateTests,/Prepare rewrote durable security material/);

  const durable=contract.agentIntegrationModule.durableSecurityState;
  assert.equal(durable.cutoverJournalDirectory,'cutover');
  assert.equal(durable.keyStateDirectory,'keys');
  assert.equal(durable.nodeRequestVault,'keys/node-request.vault');
  assert.equal(durable.nodeRequestMasterKey,'keys/node-request.master');
  assert.equal(durable.prepareMayCreateOrRegenerateIdentity,false);
  assert.equal(durable.appliedRotationAttestation,'keyring.AttestAppliedRotation');
  assert.equal(durable.persistedEpochFloorRequired,true);
  assert.equal(durable.preparedCandidateRetentionRequired,true);
  assert.equal(durable.previousIdentityRetentionRequired,true);
  assert.equal(durable.packageRollbackMayLowerSecurityFloor,false);
  assert.equal(durable.corruptOrStaleState,'fail-closed');

  const agentTransport=fs.readFileSync(path.join(agentDir,'runtime','transport_linux.go'),'utf8');
  const agentTransportTests=fs.readFileSync(path.join(agentDir,'runtime','transport_linux_test.go'),'utf8');
  assert.match(agentTransport,/cutover "github[.]com\/TriplexCorp\/XMesh-Node\/security\/xspv2\/poc-go\/cutover"/);
  assert.match(agentTransport,/Agent integration bridge, not another protocol\/state machine/);
  assert.match(agentTransport,/func Exchange[\s\S]*attestDurableAppliedState\(layout, permit, next, minimumEpoch\)[\s\S]*ExchangeSignedACKForReceipt\(ctx, endpoint[.]Address, endpoint[.]ServerName/,
    'Exchange must attest durable applied state before network transport');
  assert.match(agentTransport,/func Recover[\s\S]*attestDurableAppliedState\(layout, permit, next, minimumEpoch\)[\s\S]*RecoverSignedACKReceipt\(ctx, endpoint[.]Address, endpoint[.]ServerName/,
    'Recovery must attest durable applied state before network transport');
  assert.match(agentTransport,/snapshot[.]Matches\(message[.]NodeID, minimumEpoch, next[.]Purpose/,
    'Durable active identity must match the authenticated pending signer');
  assert.match(agentTransportTests,/TestDurableAppliedStateIsRequiredBeforeNetwork/);
  assert.match(agentTransportTests,/substituted pending public key accepted/);
  assert.match(agentTransportTests,/missing retained old-key snapshot accepted/);

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

  const keyringAttestation=fs.readFileSync(path.join(securityDir,'keyring','applied_attestation.go'),'utf8');
  assert.match(keyringAttestation,/floor!=toEpoch/,'Applied rotation must require the exact persisted epoch floor');
  assert.match(keyringAttestation,/secureFile\(previousPath\(vault\)\)/,'Applied rotation must authenticate retained old keys');
  assert.match(keyringAttestation,/secureFile\(stagedPath\(vault\)\)/,'Applied rotation must authenticate the prepared candidate');
  assert.match(keyringAttestation,/active encrypted vault does not match prepared candidate/);

  const cutoverTransport=fs.readFileSync(path.join(securityDir,'cutover','pq_only_ack_receipt_exchange_linux.go'),'utf8');
  assert.match(cutoverTransport,/request[.]Host = serverName/,
    'HTTP authority must equal the authenticated TLS server name');
  assert.match(cutoverTransport,/DialStrictMutual\(dialCtx, address, serverName/,
    'Strict TLS must authenticate ServerName while dialing the separate Address');
  assert.match(cutoverTransport,/Proxy:\s+nil/,'Migrated transport must not inherit a proxy');
  assert.match(cutoverTransport,/XSP-v2 signed ACK redirection forbidden/,'Migrated transport must reject redirects');

  const authority=contract.authenticatedAuthority;
  assert.equal(authority.directConnectField,'Address');
  assert.equal(authority.authenticatedServerNameField,'ServerName');
  assert.equal(authority.tlsSniFromServerName,true);
  assert.equal(authority.certificateHostnameFromServerName,true);
  assert.equal(authority.httpAuthorityFromServerName,true);
  assert.equal(authority.proxyAllowed,false);
  assert.equal(authority.redirectAllowed,false);
  assert.equal(authority.alternateAuthorityAllowed,false);

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
  assert.equal(contract.packagingBoundary.stagedDownloadVerifyApplyRollbackComplete,true);
  assert.equal(contract.packagingBoundary.packageIdentitySeparatedFromSecurityState,true);

  assert.match(design,/Agent artifact boundary is `agent\/xspv2`/);
  assert.match(design,/durable real-Agent security state/);
  assert.match(design,/`keyring[.]AttestAppliedRotation`/);
  assert.match(design,/HTTP authority.*`ServerName`/s);
  assert.match(design,/staged download \/ verify \/ apply \/ rollback.*complete/is);
  assert.match(design,/strict-pq` remains \*\*OFF\*\*/);
  assert.match(architecture,/only approved starting point.*production-capable XSP-v2 Agent/is);
  assert.match(architecture,/`cutover\/`.*`keys\/`/s);
  assert.match(architecture,/package rollback.*security.*floor/is);
  assert.match(architecture,/HTTP `Host`.*`ServerName`/s);
  assert.doesNotMatch(JSON.stringify(contract),/strict-pq=on/i);

  console.log(`PASS: P0-D durable Go 1.27 Agent state + authority verified against XMesh-Node ${actualRevision}`);
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
