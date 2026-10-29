#!/usr/bin/env node
"use strict";
// CI inventory guard: this checks essential staging artifacts remain tracked
// in the checkout. It is NOT proof of cryptographic or cutover correctness.
const fs=require("node:fs");
const assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process");

const expected=[
  "backend/migrations/0099_node_xsp_v2_public_state.sql",
  "backend/migrations/0100_node_xsp_owner_key_approval.sql",
  "backend/migrations/0102_node_xsp_rotation_preparations.sql",
  "backend/migrations/0103_node_xsp_cutover_permit_ledger.sql",
  "backend/migrations/0104_node_xsp_cutover_ledger_immutability.sql",
  "backend/migrations/0105_node_xsp_signed_commit_receipt_outbox.sql",
  "backend/migrations/0106_node_xsp_signed_receipt_truncate_guard.sql",
  "backend/src/xsp_v2_candidate_binding.rs",
  "backend/src/xsp_v2_db_candidate_snapshot.rs",
  "backend/src/xsp_v2_signed_cutover.rs",
  "backend/src/xsp_v2_permit_ledger_writer.rs",
  "backend/src/xsp_v2_ack_ledger_validator.rs",
  "deploy/xsp-v2-agent-go127.contract.json",
  "deploy/xsp-v2-p0e-crash-durability.contract.json",
  "deploy/xsp-v2-p0e-snapshot-antirollback.contract.json",
  "docs/XSP_V2_AGENT_GO127_INTEGRATION.md",
  "docs/XSP_V2_P0E_CRASH_DURABILITY.md",
  "docs/XSP_V2_P0E_SNAPSHOT_ANTIROLLBACK.md",
  "docs/XSP_V2_CUTOVER_CONTRACT_VECTORS.json",
  "docs/XSP_V2_CUTOVER_CANDIDATE_VECTORS.json",
  "docs/XSP_V2_SIGNED_CUTOVER_STAGING.md",
  "docs/XSP_V2_STAGING_VERIFIED_PERMIT_WRITER.md",
  "scripts/check-xsp-v2-agent-go127-integration.js",
  "scripts/check-xsp-v2-p0e-crash-durability.js",
  "scripts/check-xsp-v2-p0e-snapshot-antirollback.js",
  "scripts/test-xsp-v2-ledger-integration.sh"
];
for(const name of expected){
  assert(fs.statSync(name).isFile(),`XSP-v2 main checkpoint missing: ${name}`);
}
const core=fs.readFileSync("backend/src/main.rs","utf8");
const experimental=[
  "xsp_v2_signed_cutover",
  "xsp_v2_db_candidate_snapshot",
  "xsp_v2_permit_ledger_writer",
  "xsp_v2_ack_ledger_validator"
];
for(const name of experimental){
  // Reject accidental loss of the experimental feature boundary:
  const check=new RegExp("#\\[cfg\\(feature = \"xsp-v2-experimental\"\\)\\]\\s*mod "+name+";");
  assert(check.test(core),`XSP-v2 module must remain feature gated: ${name}`);
}
const config=JSON.parse(fs.readFileSync("docs/XSP_V2_CUTOVER_CONTRACT_VECTORS.json","utf8"));
assert.equal(config.schema,"xsp2-cutover-contract-1");
assert(config.permit && config.ack,"missing permit/ACK shared golden vectors");

const integration=spawnSync(process.execPath,["scripts/check-xsp-v2-agent-go127-integration.js"],{
  encoding:"utf8",
  stdio:["ignore","pipe","pipe"]
});
if(integration.stdout)process.stdout.write(integration.stdout);
if(integration.stderr)process.stderr.write(integration.stderr);
assert.equal(integration.status,0,"P0-D Go 1.27 Agent integration contract failed");

const crashDurability=spawnSync(process.execPath,["scripts/check-xsp-v2-p0e-crash-durability.js"],{
  encoding:"utf8",
  stdio:["ignore","pipe","pipe"]
});
if(crashDurability.stdout)process.stdout.write(crashDurability.stdout);
if(crashDurability.stderr)process.stderr.write(crashDurability.stderr);
assert.equal(crashDurability.status,0,"P0-E1a crash durability source contract failed");

const snapshotAntiRollback=spawnSync(process.execPath,["scripts/check-xsp-v2-p0e-snapshot-antirollback.js"],{
  encoding:"utf8",
  stdio:["ignore","pipe","pipe"]
});
if(snapshotAntiRollback.stdout)process.stdout.write(snapshotAntiRollback.stdout);
if(snapshotAntiRollback.stderr)process.stderr.write(snapshotAntiRollback.stderr);
assert.equal(snapshotAntiRollback.status,0,"P0-E2a snapshot anti-rollback source contract failed");

console.log(`PASS: ${expected.length} tracked Nexus XSP-v2 artifacts, experimental feature gates, pinned P0-D Agent integration, P0-E1a crash-durability and P0-E2a snapshot anti-rollback source contracts`);
