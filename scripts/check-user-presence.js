/* User presence must mean recent VERIFIED traffic, not a persistent flag. */
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const backend=fs.readFileSync('backend/src/main.rs','utf8');
const agent=fs.readFileSync('deploy/node-metrics-agent.sh','utf8');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');

assert.match(backend,/const USER_ONLINE_WINDOW_MS: i64 = 45_000;/);
assert.match(backend,/now_ms - USER_ONLINE_WINDOW_MS/);
assert.match(app,/const USER_PRESENCE_WINDOW_MS=45_000;/);
assert.match(app,/data-user-presence-id/);
assert.match(backend,/\.route\("\/users\/presence", get\(get_user_presence\)\)/);
assert.match(backend,/\.route_layer\(middleware::from_fn_with_state\(state\.clone\(\), auth::require_session\)\)/);
assert.match(app,/fetch\('\/api\/v1\/users\/presence'/);
assert.doesNotMatch(app.match(/const refreshPresence=async\(\)=>\{[\s\S]*?\n    \};/)?.[0]||'',/\/api\/v1\/bootstrap/);
assert.match(agent,/USER_STATS_AT_MS="\$snapshot_timestamp"/);
assert.match(agent,/now-last>45/);
assert.match(backend,/pg_advisory_xact_lock\(\$1\)/);
assert.match(backend,/telemetry_tx\.commit\(\)\.await\?/);
assert.match(backend,/metrics->>'userStatsAccepted'='true'/);
assert.match(backend,/sample\.uplink_bytes >= previous\.last_uplink_bytes/);
assert.match(backend,/sample\.downlink_bytes >= previous\.last_downlink_bytes/);
assert.match(backend,/LEAST\(\$3::BIGINT,\$4::BIGINT\)/);
assert.match(html,/app\.js\?v=20261024-presence-fix-v4/);

// Behavioral model of the counters/source-time gate; protects the intended
// edge-case matrix alongside the signed Postgres integration test.
function active(prev,next,source,lastSource){
 return source>lastSource && !!prev &&
  next.up>=prev.up && next.down>=prev.down &&
  (next.up>prev.up || next.down>prev.down);
}
const a={up:100,down:50};
assert.equal(active(null,a,11,10),false,'first sample only establishes baseline');
assert.equal(active(a,{up:101,down:50},11,10),true,'uplink delta');
assert.equal(active(a,{up:100,down:51},11,10),true,'downlink delta');
assert.equal(active(a,a,11,10),false,'idle samples are not activity');
assert.equal(active(a,{up:90,down:51},11,10),false,'mixed counter reset');
assert.equal(active(a,{up:101,down:49},11,10),false,'mixed counter reset other direction');
assert.equal(active(a,{up:101,down:51},10,10),false,'duplicate sample');
assert.equal(active(a,{up:101,down:51},9,10),false,'out-of-order sample');
console.log('User presence guard and 45-second activity window: PASS');
