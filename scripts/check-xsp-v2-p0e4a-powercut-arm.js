#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const contract=JSON.parse(fs.readFileSync('deploy/xsp-v2-p0e4a-powercut-arm.contract.json','utf8'));

function fetchPinnedNodeSource(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xmesh-node-p0e4a-arm-'));
  execFileSync('git',['-C',root,'init','-q']);
  execFileSync('git',['-C',root,'remote','add','origin','https://github.com/TriplexCorp/XMesh-Node.git']);
  execFileSync('git',['-C',root,'fetch','--quiet','--depth=1','origin',contract.verifiedNodeSource.revision]);
  execFileSync('git',['-C',root,'checkout','--quiet','--detach','FETCH_HEAD']);
  return root;
}

function read(root,rel){return fs.readFileSync(path.join(root,rel),'utf8');}

function verify(nodeRoot){
  assert.equal(contract.schema,'xsp2-p0e4a-powercut-arm-contract-1');
  assert.equal(contract.productionActivation,false);
  assert.equal(contract.strictPqDefault,'off');
  assert.equal(contract.verifiedNodeSource.repository,'TriplexCorp/XMesh-Node');
  assert.equal(contract.verifiedNodeSource.revision,'50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e');
  assert.equal(contract.verifiedNodeSource.pullRequest,44);

  const actual=execFileSync('git',['-C',nodeRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  assert.equal(actual,contract.verifiedNodeSource.revision,'must inspect exact merged Node PR #44 source');

  const normal=read(nodeRoot,'security/xspv2/poc-go/keyring/durability_checkpoint.go');
  const crash=read(nodeRoot,'security/xspv2/poc-go/keyring/durability_checkpoint_crash.go');
  const lab=read(nodeRoot,'security/xspv2/poc-go/keyring/durability_checkpoint_powercut_linux.go');
  const labTest=read(nodeRoot,'security/xspv2/poc-go/keyring/durability_checkpoint_powercut_linux_test.go');
  const rotation=read(nodeRoot,'security/xspv2/poc-go/keyring/two_phase.go');
  const workflow=read(nodeRoot,'.github/workflows/xsp-p0e4a-powercut-arm.yml');
  const crashWorkflow=read(nodeRoot,'.github/workflows/xsp-p0e-crash-durability.yml');
  const proofDoc=read(nodeRoot,'docs/XSP_V2_P0E4A_POWERCUT_ARM.md');

  assert.match(normal,/^\/\/go:build !xspv2_crash_test && !xspv2_powercut_qualification$/m);
  assert.match(normal,/func rotationDurabilityCheckpoint\(string\) \{\}/);
  assert.doesNotMatch(normal,/XMESH_XSPV2_POWERCUT|EXTERNAL_POWER_CUT_LAB_ONLY/);
  assert.match(crash,/^\/\/go:build xspv2_crash_test && !xspv2_powercut_qualification$/m);
  assert.match(lab,/^\/\/go:build linux && xspv2_powercut_qualification && !xspv2_crash_test$/m);

  for(const point of ['after-previous','after-floor','after-active','after-recovery-abort','after-recovery-active']){
    assert.match(rotation,new RegExp(`rotationDurabilityCheckpoint\\("${point}"\\)`),`missing existing durability checkpoint ${point}`);
    assert.match(lab,new RegExp(`"${point}"`),`lab allowlist missing ${point}`);
  }

  for(const marker of [
    'XMESH_XSPV2_POWERCUT_POINT',
    'XMESH_XSPV2_POWERCUT_ARM',
    'XMESH_XSPV2_POWERCUT_RUN_ID',
    'XMESH_XSPV2_POWERCUT_SIGNAL_FD',
    'EXTERNAL_POWER_CUT_LAB_ONLY',
    'XSP2-POWERCUT-ARMED-V1'
  ]) assert.match(lab,new RegExp(marker));

  assert.match(lab,/os[.]NewFile\(uintptr\(cfg[.]fd\), "xspv2-powercut-controller"\)/,
    'external controller notification must use inherited FD only');
  assert.match(lab,/signal[.]WriteString\(marker\)/);
  assert.match(lab,/for \{\s*time[.]Sleep\(24 \* time[.]Hour\)\s*\}/,
    'selected checkpoint must stop security-state progress until external cut');
  assert.doesNotMatch(lab,/exec[.]Command|os[.]StartProcess|net[.]Dial|http[.](Get|Post|NewRequest)|syscall[.]Reboot|unix[.]Reboot/,
    'lab hook must not gain autonomous command/network/power control');

  assert.match(labTest,/XSP2-POWERCUT-ARMED-V1 run=p0e4a-lab-run-0001 point=after-previous/);
  assert.match(labTest,/cmd[.]Process[.]Kill\(\)/,
    'CI may terminate its helper only after proving the lab hook remained blocked');
  assert.match(workflow,/Reject ambiguous dual evidence build/);
  assert.match(workflow,/xspv2_crash_test xspv2_powercut_qualification/);
  assert.match(workflow,/normal Agent artifact contains a test\/lab durability hook/);
  assert.match(crashWorkflow,/production build excludes crash and power-cut qualification hooks/i);
  assert.match(proofDoc,/GitHub CI is not physical power-loss evidence and cannot close P0-E4a[.]/);
  assert.match(proofDoc,/physically independent BMC\/PDU\/controller\/hypervisor/i);
  assert.match(proofDoc,/strict-pq` remains OFF/i);

  const boundary=contract.proofBoundary;
  assert.equal(boundary.name,'P0-E4a-external-powercut-arm-primitive');
  for(const key of ['labBuildTagOnly','normalAgentHookNoop','processCrashInjectorSeparate','dualEvidenceBuildRejected','boundedCheckpointSelection','inheritedSignalFdOnly','exactArmMarker','securityTransitionBlocksAfterArm']){
    assert.equal(boundary[key],true,`${key} must remain proven by the bounded source contract`);
  }
  for(const key of ['autonomousPowerControl','networkControlPath','shellCommandControlPath']){
    assert.equal(boundary[key],false,`${key} must remain absent`);
  }
  for(const key of ['physicalPowerRemovalOccurred','controllerOrDriveWriteCacheDurability','powerLossProtectionCorrectness','postgresqlAbruptPowerRecovery','representativeHardwareQualification','productionRollout']){
    assert.equal(contract.notProvenByThisGate[key],true,`${key} must remain explicitly unproven`);
  }
  assert.equal(contract.nextRequiredEvidence,'P0-E4a-representative-physical-powercut-matrix');
  console.log(`PASS: P0-E4a Node power-cut arm source contract verified at ${actual}`);
}

let temporaryRoot=null;
try{
  const supplied=process.argv[2];
  const nodeRoot=supplied ? path.resolve(supplied) : (temporaryRoot=fetchPinnedNodeSource());
  verify(nodeRoot);
} finally {
  if(temporaryRoot) fs.rmSync(temporaryRoot,{recursive:true,force:true});
}
