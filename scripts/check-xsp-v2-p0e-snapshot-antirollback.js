#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const contract=JSON.parse(fs.readFileSync('deploy/xsp-v2-p0e-snapshot-antirollback.contract.json','utf8'));

function fetchPinnedNodeSource(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xmesh-node-p0e2a-'));
  execFileSync('git',['-C',root,'init','-q'],{stdio:'inherit'});
  execFileSync('git',['-C',root,'remote','add','origin','https://github.com/TriplexCorp/XMesh-Node.git'],{stdio:'inherit'});
  execFileSync('git',['-C',root,'fetch','--quiet','--depth=1','origin',contract.verifiedNodeSource.revision],{stdio:'inherit'});
  execFileSync('git',['-C',root,'checkout','--quiet','--detach','FETCH_HEAD'],{stdio:'inherit'});
  return root;
}

function lineOf(source, needle, start=0){
  const index=source.indexOf(needle,start);
  assert(index>=0,`missing source marker: ${needle}`);
  return source.slice(0,index).split('\n').length;
}

function verify(nodeRoot){
  assert.equal(contract.schema,'xsp2-p0e-snapshot-antirollback-1');
  assert.equal(contract.productionActivation,false);
  assert.equal(contract.strictPqDefault,'off');
  assert.equal(contract.verifiedNodeSource.repository,'TriplexCorp/XMesh-Node');
  assert.equal(contract.verifiedNodeSource.revision,'3fffa9fd74195114a7c4e573a8a11e075c84f403');
  assert.equal(contract.verifiedNodeSource.pullRequest,39);

  const actualRevision=execFileSync('git',['-C',nodeRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  assert.equal(actualRevision,contract.verifiedNodeSource.revision,
    'P0-E2a must validate the exact merged Node PR #39 checkpoint');

  const runtimeDir=path.join(nodeRoot,'agent','xspv2','runtime');
  const rollbackTest=fs.readFileSync(path.join(runtimeDir,'snapshot_antirollback_linux_test.go'),'utf8');
  const transport=fs.readFileSync(path.join(runtimeDir,'transport_linux.go'),'utf8');
  const workflow=fs.readFileSync(path.join(nodeRoot,'.github','workflows','xsp-p0e-snapshot-antirollback.yml'),'utf8');
  const proofDoc=fs.readFileSync(path.join(nodeRoot,'docs','XSP_V2_P0E_SNAPSHOT_ANTIROLLBACK.md'),'utf8');

  assert.match(rollbackTest,/^\/\/go:build linux$/m);
  assert.match(rollbackTest,/copyPrivateTree\(t, layout[.]Root, snapshotRoot\)/,
    'Test must capture the complete Agent state root before rotation');
  assert.match(rollbackTest,/os[.]RemoveAll\(fixture[.]layout[.]Root\)/,
    'Test must remove current local state before restoring the old snapshot');
  assert.match(rollbackTest,/copyPrivateTree\(t, fixture[.]snapshotRoot, fixture[.]layout[.]Root\)/,
    'Test must restore the complete pre-rotation Agent snapshot');
  assert.match(rollbackTest,/entry[.]Type\(\)&os[.]ModeSymlink/,
    'Snapshot harness must reject symlink substitution');
  assert.match(rollbackTest,/!info[.]Mode\(\)[.]IsRegular\(\)/,
    'Snapshot harness must reject unexpected non-regular state files');

  const describeLine=lineOf(rollbackTest,'rolledBack, err := state.DescribeCurrent(layout)');
  const redeliverLine=lineOf(rollbackTest,'currentPermit, err := cutover.PersistVerifiedPermit',
    rollbackTest.indexOf('TestOneSidedAgentSnapshotRollbackRequiresCurrentRemoteWitness'));
  assert(describeLine<redeliverLine,
    'The proof must demonstrate that the restored old snapshot is locally self-consistent before the current remote witness is reintroduced');
  assert.match(rollbackTest,/rolledBack[.]KeyEpoch != fixture[.]prior[.]KeyEpoch/,
    'The restored snapshot must be verified as the exact prior epoch');
  assert.match(rollbackTest,/rolledBack[.]PreviousRetained \|\| rolledBack[.]CandidateRetained/,
    'The old snapshot must exclude post-rotation evidence');
  assert.match(rollbackTest,/current signed permit could not be re-delivered after local snapshot rollback/,
    'Current Nexus permit must be re-delivered unchanged after local rollback');
  assert.match(rollbackTest,/attestDurableAppliedState\(layout, currentPermit, fixture[.]next, fixture[.]candidate[.]KeyEpoch\); err == nil/,
    'Current remote epoch/candidate witness must reject the rolled-back local applied state');

  assert.match(rollbackTest,/TestOneSidedAgentSnapshotRollbackRequiresCurrentRemoteWitness/);
  assert.match(rollbackTest,/TestOneSidedAgentSnapshotRollbackBlocksHistoricalRecoveryBeforeNetwork/);
  assert.match(rollbackTest,/Exchange\(ctx, endpoint,[\s\S]*fixture[.]candidate[.]KeyEpoch/,
    'The proof must exercise the real Exchange entry point');
  assert.match(rollbackTest,/Recover\(ctx, endpoint,[\s\S]*fixture[.]candidate[.]KeyEpoch/,
    'The proof must exercise the real Recover entry point');
  assert.match(rollbackTest,/func assertNoTCPConnection\(/);
  assert.match(rollbackTest,/tcpListener[.]Accept\(\)/,
    'The proof must observe the TCP accept boundary rather than infer no-network from an error string');
  assert.match(rollbackTest,/rolled-back Agent reached the network before durable-state rejection/,
    'TCP connection before rejection must fail the test');

  const attestNeedle='if err := attestDurableAppliedState(layout, permit, next, minimumEpoch); err != nil {';
  const firstAttest=transport.indexOf(attestNeedle);
  const secondAttest=transport.indexOf(attestNeedle,firstAttest+1);
  assert(firstAttest>=0 && secondAttest>firstAttest,
    'Both Exchange and Recover must attest durable applied state');
  const exchangeNetwork=transport.indexOf('return cutover.ExchangeSignedACKForReceipt');
  const recoverNetwork=transport.indexOf('return cutover.RecoverSignedACKReceipt');
  assert(exchangeNetwork>firstAttest && exchangeNetwork<secondAttest,
    'Exchange durable-state attestation must occur before its network call');
  assert(recoverNetwork>secondAttest,
    'Recover durable-state attestation must occur before its network call');

  assert.match(workflow,/Verify attestation precedes both network operations/);
  assert.match(workflow,/go test [.][.][\/]... -count=1|go test [.][\/]... -count=1/,
    'P0-E2a workflow must retain baseline Agent tests');
  assert.match(workflow,/TestOneSidedAgentSnapshotRollbackRequiresCurrentRemoteWitness/);
  assert.match(workflow,/TestOneSidedAgentSnapshotRollbackBlocksHistoricalRecoveryBeforeNetwork/);

  assert.match(proofDoc,/complete VM\/filesystem snapshot/i);
  assert.match(proofDoc,/local state alone cannot prove/i);
  assert.match(proofDoc,/current dual-signed Nexus permit/i);
  assert.match(proofDoc,/coordinated rollback of both the Agent state and Nexus\/PostgreSQL/i);
  assert.match(proofDoc,/independent non-rolled-back authority/i);
  assert.match(proofDoc,/strict-pq` remains [^\n]*OFF/i);

  const boundary=contract.proofBoundary;
  assert.equal(boundary.name,'P0-E2a-one-sided-agent-snapshot-rollback');
  assert.equal(boundary.completeLocalStateRootRestored,true);
  assert.equal(boundary.restoredSnapshotLocallySelfConsistent,true);
  assert.equal(boundary.currentDualSignedNexusPermitRedelivered,true);
  assert.equal(boundary.runtimeAttestationPrecedesExchangeNetwork,true);
  assert.equal(boundary.runtimeAttestationPrecedesRecoveryNetwork,true);
  assert.equal(boundary.exchangeRejectedBeforeTcpConnect,true);
  assert.equal(boundary.recoveryRejectedBeforeTcpConnect,true);
  assert.equal(boundary.sameSnapshotLocalMarkerIsIndependentWitness,false);

  for(const key of [
    'coordinatedNodeAndNexusRollback',
    'postgresqlSnapshotRestore',
    'offHostOwnerMonotonicCheckpoint',
    'physicalPowerRemoval',
    'controllerOrDriveWriteCacheDurability',
    'backupRestore',
    'oldKeyRetirement',
    'productionRollout'
  ]){
    assert.equal(contract.notProvenByThisGate[key],true,
      `${key} must remain explicitly outside P0-E2a evidence`);
  }
  assert.equal(contract.nextRequiredGate,'P0-E2b-postgresql-snapshot-rollback-and-cross-domain-detection');

  console.log(`PASS: P0-E2a one-sided Agent snapshot anti-rollback source contract verified against XMesh-Node ${actualRevision}`);
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
