#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');

// Preserve the full pre-P0-D-retry checker byte-for-byte in
// check-agent-update-base.js. It still owns every existing upgrade/migration
// invariant. The runtime implementation is now intentionally split: the merged
// PR #101 baseline remains in node_runtime_p0d_staged.rs and node_runtime.rs
// shadows only lost-response retry behavior.
const originalReadFileSync=fs.readFileSync.bind(fs);
const overlay=originalReadFileSync('backend/src/node_runtime.rs','utf8');
const staged=originalReadFileSync('backend/src/node_runtime_p0d_staged.rs','utf8');
const nodeDialogs=originalReadFileSync('node-dialogs.js','utf8');
const agentVersionRaw=originalReadFileSync('AGENT_VERSION','utf8').trim();
const agentPolicy=originalReadFileSync('docs/AGENT_RELEASE_POLICY.md','utf8');
const gateway=originalReadFileSync('deploy/xsp-v2-product-gateway/main.go','utf8');
new Function(nodeDialogs);

const versionMatch=/^control-v([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(agentVersionRaw);
assert.ok(versionMatch,'AGENT_VERSION must use control-vMAJOR.MINOR.PATCH');
const versionTuple=versionMatch.slice(1).map(Number);
assert.equal(agentVersionRaw,'control-v6.0.4','Nexus target Agent version must be control-v6.0.4');
assert.match(agentPolicy,/runtime behavior \*\*must increase the Agent version/);
assert.match(agentPolicy,/Node product `VERSION` and Agent version are independent/);
assert.match(gateway,/targetAgentVersion\s*=\s*"control-v6[.]0[.]4"/);
assert.match(gateway,/previousAgentVersion\s*=\s*"control-v6[.]0[.]3"/,
  'rolling upgrade must keep the immediately previous Agent release enrollable');
assert.match(gateway,/repairAgentVersion\s*=\s*"control-v6[.]0[.]0"/,
  'v6.0.0 bootstrap-hole nodes remain temporarily repairable');

function cmpVersion(a,b){
  for(let i=0;i<3;i++){
    if(a[i]!==b[i]) return a[i]-b[i];
  }
  return 0;
}
function runtimeSurface(path){
  if(path==='AGENT_VERSION') return false;
  if(path==='backend/src/node_runtime.rs' || path==='backend/src/node_runtime_p0d_staged.rs') return true;
  if(path.startsWith('deploy/')){
    if(path.endsWith('.md')) return false;
    if(path.includes('/test') || path.startsWith('deploy/test-')) return false;
    return true;
  }
  return false;
}

// Machine-enforced release policy: once the base branch has AGENT_VERSION,
// deployed runtime/control-contract changes cannot reuse the previous version.
const baseRef=(process.env.GITHUB_BASE_REF||'').trim();
if(baseRef){
  try{
    execFileSync('git',['fetch','--no-tags','--depth=1','origin',baseRef],{stdio:'pipe'});
    const base=`origin/${baseRef}`;
    let baseRaw='';
    try{
      baseRaw=execFileSync('git',['show',`${base}:AGENT_VERSION`],{encoding:'utf8'}).trim();
    }catch{
      // First adoption of the canonical version file: no historical version exists.
    }
    const changed=execFileSync('git',['diff','--name-only',base,'HEAD'],{encoding:'utf8'})
      .split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
    const runtimeChanged=changed.filter(runtimeSurface);
    if(baseRaw){
      const m=/^control-v([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(baseRaw);
      assert.ok(m,`Base AGENT_VERSION is invalid: ${baseRaw}`);
      const baseTuple=m.slice(1).map(Number);
      assert.ok(cmpVersion(versionTuple,baseTuple)>=0,
        `Agent version regression: ${agentVersionRaw} < ${baseRaw}`);
      assert.ok(runtimeChanged.length===0 || cmpVersion(versionTuple,baseTuple)>0,
        `Deployed Agent/runtime changed without AGENT_VERSION bump (${baseRaw} -> ${agentVersionRaw}): ${runtimeChanged.join(', ')}`);
    }else if(runtimeChanged.length){
      console.log('Agent version policy adoption: canonical AGENT_VERSION introduced with runtime changes');
    }
  }catch(err){
    if(err && err.name==='AssertionError') throw err;
    throw new Error(`Agent version policy check failed: ${err.message||err}`);
  }
}

fs.readFileSync=function(path,...args){
  if(path==='backend/src/node_runtime.rs'){
    return overlay+'\n'+staged;
  }
  return originalReadFileSync(path,...args);
};

require('./check-agent-update-base.js');

// New gate: only immutable manifest-bound claimed migrations are redelivered.
assert.match(overlay,/path = "node_runtime_p0d_staged[.]rs"/);
assert.match(overlay,/c[.]state='claimed' AND c[.]action='update_agent'/);
assert.match(overlay,/c[.]release_manifest_id IS NOT NULL/);
assert.match(overlay,/c[.]claimed_at>=NOW\(\)-INTERVAL '15 minutes'/);
assert.match(overlay,/node_auth::authenticate_for/,
  'Lost-poll redelivery must still require a fresh signed node request');
assert.match(overlay,/return staged::poll_restart/,
  'Legacy and artifact poll behavior must remain delegated to the reviewed baseline');

// Exact lost-ACK replay is accepted only when every durable identity/result
// field matches; a changed retry must fall back to the baseline conflict path.
for(const field of [
  'release_ack_version','release_ack_source_revision','release_ack_artifact_sha256',
  'release_ack_success','result','release_version','source_revision','artifact_sha256'
]) assert.ok(overlay.includes(field),`Missing durable duplicate-ACK comparison: ${field}`);
assert.match(overlay,/state IN \('succeeded','failed'\)/);
assert.match(overlay,/exact_duplicate_ack/);
assert.match(overlay,/"duplicate": true/);
assert.match(overlay,/return staged::acknowledge_restart/,
  'Non-exact and legacy duplicate ACKs must retain the previous fail-closed path');
assert.doesNotMatch(overlay,/strict-pq=on/,'Retry recovery must not activate strict PQ');
assert.doesNotMatch(overlay,/\b(url|uri|script|shell|command_text)\s*:/i,
  'Retry recovery must not introduce executable remote input');

// UI must never maintain a second Agent-version allow-list. It only proves a
// fresh runtime exists and lets the authenticated backend decide whether the
// fixed self-update command is legal for the currently connected Agent.
assert.match(nodeDialogs,/\[data-agent-update\]/);
assert.match(nodeDialogs,/event\.stopImmediatePropagation\(\)/,
  'Agent update override must supersede the historical app.js v4/v5 regex gate');
assert.match(nodeDialogs,/if\(!runtime\.connected\)/,
  'UI may reject stale connectivity before asking for an update');
assert.match(nodeDialogs,/\/agent-update['"],\{[\s\S]*method:['"]POST['"]/,
  'UI must delegate the update decision to the authenticated backend endpoint');
assert.doesNotMatch(nodeDialogs,/runtime\.version[^\n]{0,120}(?:match|test)\(/,
  'Frontend must not infer self-update capability from an Agent version regex');
assert.match(nodeDialogs,/No client-side version allow-list/,
  'The backend-authoritative capability contract must remain explicit');

console.log(`Mandatory Agent version policy: ${agentVersionRaw} OK`);
console.log('Manifest-bound Agent lost-response retry source contract: OK');
console.log('Backend-authoritative Agent update validation: OK');
