'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const source=name=>fs.readFileSync(name,'utf8');
const quota=source('backend/src/node_user_quotas.rs');
const backend=source('backend/src/main.rs');
const runtime=source('backend/src/node_runtime_legacy.rs');
const migration=source('backend/migrations/0115_user_node_quota_ledgers.sql');
const renderer=source('backend/src/subscription_remark.rs');
const subscription=source('backend/src/user_subscriptions_base.rs');
const ui=source('frontend/js/features/users/user-node-quotas.js');
const app=source('frontend/js/core/app.js');

for(const [regex,message] of [
  [/CREATE TABLE user_node_quota_lifetime/,'independent lifetime accounting'],
  [/CREATE TABLE user_node_quota_monthly/,'independent UTC monthly accounting'],
  [/source_type='user'/,'backfill only signed user deltas'],
  [/FROM verified_traffic_deltas/,'monthly backfill from verified metrics'],
])assert.match(migration,regex,message);
assert.match(backend,/persist_verified_traffic_deltas\(conn, node_id, &serialized, sampled_at, false\)\.await\?;/);
assert.match(backend,/INSERT INTO user_node_quota_lifetime AS quota/);
assert.match(backend,/INSERT INTO user_node_quota_monthly AS monthly/);
assert.match(backend,/previous\.last_uplink_bytes/);
assert.match(backend,/JOIN user_node_traffic_totals AS previous/);
assert.match(backend,/node_user_quotas::validate_user\(data\)/);
assert.match(backend,/node_user_quotas::require_existing_nodes\(&mut tx, &data\)/);
assert.match(backend,/node_user_quotas::get_for_user/);
assert.match(runtime,/node_user_quotas::attach_for_node\(&state\.pool, node_id, &mut users\)/);
assert.match(runtime,/node_user_quotas::exhausted\(user, node_id\)/);
assert.match(runtime,/node_user_quotas::offline_remaining\(user, node_id\)/);
assert.match(quota,/nodeQuotaUsedBytes/);
assert.match(quota,/MAX_NODE_POLICIES/);
assert.match(quota,/remaining_for\(/);
assert.match(quota,/is_none_or\(\|used\| used < 0 \|\| used >= rule\.limit_bytes\)/);
assert.match(renderer,/"NODE_DATA_LEFT"/);
assert.match(renderer,/node_remaining/);
assert.match(subscription,/host_candidate_node_ids\(/);
assert.match(subscription,/node_user_quotas::usage_for_user/);
assert.match(subscription,/node_user_quotas::remaining_for/);
assert.match(ui,/data-node-quota-limit/);
assert.match(ui,/data-node-quota-period/);
assert.match(ui,/save\(\{nodeTrafficLimits:policies\}\)/);
assert.match(app,/XMeshNodeQuotas\.mount/);
assert.doesNotMatch(ui,/nodeQuotaUsedBytes\s*:/,'UI may not write server-owned counter');
assert.doesNotMatch(backend,/UPDATE user_node_quota_monthly SET uplink_bytes=0/,'general traffic reset must not erase per-node quotas');
console.log('Independent user/node quota limits, signed accounting, API and UI contracts: PASS');
