#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

// Preserve the full pre-P0-D-retry checker byte-for-byte in
// check-agent-update-base.js. It still owns every existing upgrade/migration
// invariant. The runtime implementation is now intentionally split: the merged
// PR #101 baseline remains in node_runtime_p0d_staged.rs and node_runtime.rs
// shadows only lost-response retry behavior.
const originalReadFileSync=fs.readFileSync.bind(fs);
const overlay=originalReadFileSync('backend/src/node_runtime.rs','utf8');
const staged=originalReadFileSync('backend/src/node_runtime_p0d_staged.rs','utf8');

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

console.log('Manifest-bound Agent lost-response retry source contract: OK');
