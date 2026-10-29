#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const contract=JSON.parse(fs.readFileSync('deploy/xsp-v2-p0e-crash-durability.contract.json','utf8'));

function fetchPinnedNodeSource(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xmesh-node-p0e1a-'));
  execFileSync('git',['-C',root,'init','-q'],{stdio:'inherit'});
  execFileSync('git',['-C',root,'remote','add','origin','https://github.com/TriplexCorp/XMesh-Node.git'],{stdio:'inherit'});
  execFileSync('git',['-C',root,'fetch','--quiet','--depth=1','origin',contract.verifiedNodeSource.revision],{stdio:'inherit'});
  execFileSync('git',['-C',root,'checkout','--quiet','--detach','FETCH_HEAD'],{stdio:'inherit'});
  return root;
}

function verify(nodeRoot){
  assert.equal(contract.schema,'xsp2-p0e-crash-durability-1');
  assert.equal(contract.productionActivation,false,'P0-E1a must not authorize production activation');
  assert.equal(contract.strictPqDefault,'off','strict-pq must stay OFF');
  assert.equal(contract.verifiedNodeSource.repository,'TriplexCorp/XMesh-Node');
  assert.equal(contract.verifiedNodeSource.revision,'8a86227f369aed2e6e952f1e41af52c7414aa4e3',
    'P0-E1a must pin the exact merged Node PR #38 checkpoint');
  assert.equal(contract.verifiedNodeSource.pullRequest,38);

  const actualRevision=execFileSync('git',['-C',nodeRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  assert.equal(actualRevision,contract.verifiedNodeSource.revision,
    'CI must validate the exact pinned XMesh-Node P0-E1a source checkpoint');

  const securityDir=path.join(nodeRoot,'security','xspv2','poc-go','keyring');
  const normalCheckpoint=fs.readFileSync(path.join(securityDir,'durability_checkpoint.go'),'utf8');
  const crashCheckpoint=fs.readFileSync(path.join(securityDir,'durability_checkpoint_crash.go'),'utf8');
  const rotation=fs.readFileSync(path.join(securityDir,'two_phase.go'),'utf8');
  const crashTests=fs.readFileSync(path.join(securityDir,'crash_durability_linux_test.go'),'utf8');
  const sealed=fs.readFileSync(path.join(securityDir,'sealed.go'),'utf8');
  const workflow=fs.readFileSync(path.join(nodeRoot,'.github','workflows','xsp-p0e-crash-durability.yml'),'utf8');
  const proofDoc=fs.readFileSync(path.join(nodeRoot,'docs','XSP_V2_P0E_CRASH_DURABILITY.md'),'utf8');

  assert.match(normalCheckpoint,/^\/\/go:build !xspv2_crash_test$/m);
  assert.match(normalCheckpoint,/func rotationDurabilityCheckpoint\(string\) \{\}/,
    'Normal builds must compile only a no-op durability checkpoint');
  assert.doesNotMatch(normalCheckpoint,/XMESH_XSPV2_CRASH_POINT|os[.]Exit/,
    'Normal checkpoint must not expose the crash injector');

  assert.match(crashCheckpoint,/^\/\/go:build xspv2_crash_test$/m);
  assert.match(crashCheckpoint,/XMESH_XSPV2_CRASH_POINT/);
  assert.match(crashCheckpoint,/os[.]Exit\(86\)/,
    'Tagged crash proof must hard-exit the process rather than return an ordinary error');

  const activationPoints=contract.proofBoundary.activationDurableBoundaries;
  const recoveryPoints=contract.proofBoundary.recoveryDurableBoundaries;
  assert.deepEqual(activationPoints,['after-previous','after-floor','after-active']);
  assert.deepEqual(recoveryPoints,['after-recovery-abort','after-recovery-active']);
  for(const point of [...activationPoints,...recoveryPoints]){
    assert(rotation.includes(`rotationDurabilityCheckpoint("${point}")`),
      `Real rotation implementation missing durability checkpoint ${point}`);
    assert(crashTests.includes(point),`Crash matrix missing checkpoint ${point}`);
  }

  assert.match(rotation,/func ActivatePreparedRotation\(/);
  assert.match(rotation,/atomicFile\(previousPath\(vault\), oldRaw\)[\s\S]*rotationDurabilityCheckpoint\("after-previous"\)[\s\S]*updateFloor\(vault, candidate[.]KeyEpoch\)[\s\S]*rotationDurabilityCheckpoint\("after-floor"\)[\s\S]*atomicFile\(vault, nextRaw\)[\s\S]*rotationDurabilityCheckpoint\("after-active"\)/,
    'Activation crash checkpoints must follow the exact durable old-snapshot -> floor -> active-vault order');
  assert.match(rotation,/func RecoverRotation\(/);
  assert.match(rotation,/os[.]Remove\(previousPath\(vault\)\)[\s\S]*syncParent\(vault\)[\s\S]*rotationDurabilityCheckpoint\("after-recovery-abort"\)/,
    'Pre-floor recovery checkpoint must occur after the parent directory sync');
  assert.match(rotation,/atomicFile\(vault, nextRaw\)[\s\S]*rotationDurabilityCheckpoint\("after-recovery-active"\)/,
    'Forward recovery checkpoint must occur after the durable active-vault replacement');

  assert.match(sealed,/tmp[.]Sync\(\)/,'Atomic file writes must fsync temporary file data');
  assert.match(sealed,/os[.]Rename\(tmp[.]Name\(\),path\)/,'Atomic file writes must rename into place');
  assert.match(sealed,/return d[.]Sync\(\)/,'Atomic file writes must fsync the parent directory');
  assert.match(sealed,/func updateFloor\(path string,epoch uint64\)error\{[\s\S]*return atomicFile\(floorPath\(path\)/,
    'Monotonic epoch-floor update must use the same fsync+rename primitive');

  assert.match(crashTests,/^\/\/go:build linux && xspv2_crash_test$/m);
  assert.match(crashTests,/TestActivatePreparedRotationCrashMatrix/);
  assert.match(crashTests,/TestRecoverRotationCrashMatrix/);
  assert.match(crashTests,/exec[.]Command\(os[.]Args\[0\], "-test[.]run=\^TestCrashDurabilityHelper\$"\)/,
    'Crash matrix must cross a real subprocess boundary');
  assert.match(crashTests,/ActivatePreparedRotation\(vault, master, oldEpoch/,
    'Crash helper must execute the real activation function');
  assert.match(crashTests,/RecoverRotation\(vault, master\)/,
    'Crash helper must execute the real recovery function');
  assert.match(crashTests,/exitErr[.]ExitCode\(\) != 86/,
    'Parent test must distinguish the intentional hard-exit from ordinary failures');
  assert.match(crashTests,/old active identity was accepted after the epoch floor advanced/,
    'Post-floor crash must explicitly prove fail-closed old-vault rejection');

  assert.match(workflow,/go build -trimpath -o \/tmp\/xmesh-agent-xspv2/,
    'P0-E workflow must build a normal Agent artifact');
  assert.match(workflow,/strings \/tmp\/xmesh-agent-xspv2 \| grep -Fq 'XMESH_XSPV2_CRASH_POINT'/,
    'P0-E workflow must reject a normal artifact containing the crash injector');
  assert.match(workflow,/go test -tags xspv2_crash_test [.][\/]keyring/,
    'P0-E workflow must execute the tagged hard-exit matrix');

  assert.match(proofDoc,/not a full hardware power-cut claim/i);
  assert.match(proofDoc,/physical power removal/i);
  assert.match(proofDoc,/snapshot anti-rollback/i);
  assert.match(proofDoc,/strict-pq` remains OFF/i);

  const boundary=contract.proofBoundary;
  assert.equal(boundary.name,'P0-E1a-process-crash-fsync-order');
  assert.equal(boundary.realProductionRotationFunctions,true);
  assert.equal(boundary.subprocessHardExit,true);
  assert.equal(boundary.normalAgentContainsCrashInjector,false);
  assert.equal(boundary.oldIdentityAcceptedAfterFloorAdvance,false);
  assert.equal(boundary.recoveryMayLowerEpochFloor,false);
  assert.equal(boundary.previousIdentityRetainedAfterForwardRecovery,true);
  assert.equal(boundary.preparedCandidateRetainedAfterForwardRecovery,true);

  const notProven=contract.notProvenByThisGate;
  for(const key of [
    'physicalPowerRemoval',
    'controllerOrDriveWriteCacheDurability',
    'filesystemSnapshotAntiRollback',
    'postgresqlBackupRestore',
    'oldKeyRetirement',
    'productionRollout'
  ]){
    assert.equal(notProven[key],true,`${key} must remain explicitly outside P0-E1a evidence`);
  }
  assert.equal(contract.nextRequiredGate,'P0-E1b-physical-power-loss-and-filesystem-durability');

  console.log(`PASS: P0-E1a process-crash/fsync-order source contract verified against XMesh-Node ${actualRevision}`);
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
