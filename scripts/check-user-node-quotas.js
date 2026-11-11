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
assert.match(ui,/function createMarkup\(nodes\)/);
assert.match(ui,/<section class="user-create-section user-create-node-quotas"/,
  'Quota controls must be a visible section, not a collapsed details element');
assert.doesNotMatch(ui,/<details class="user-create-node-quotas"/,
  'Node limits must not require expanding a hidden accordion');
assert.match(ui,/data-user-create-quota-status/,'Each node must show its configured/unlimited state');
assert.match(ui,/function readCreate\(form\)/);
assert.match(ui,/function bindCreate\(form\)/);
const dialog=fs.readFileSync('frontend/js/features/nodes/node-dialogs.js','utf8');
assert.match(dialog,/XMeshNodeQuotas\.createMarkup\(DB\.nodes\)/);
assert.match(dialog,/XMeshNodeQuotas\.bindCreate\(dlg\.querySelector/);
assert.match(dialog,/\$\{nodeQuotas\}/);
assert.match(app,/XMeshNodeQuotas\.readCreate\(f\)/);
assert.match(app,/nodeTrafficLimits:nodePolicies/);
// Check create-only payload semantics without a browser: empty/zero is unlimited,
// periods and decimal GB survive, invalid values fail before POST.
const stubWindow={XMeshI18n:{getLanguage:()=> 'ru'}};
new Function('window',ui)(stubWindow);
const helper=stubWindow.XMeshNodeQuotas;
assert.equal(helper.createMarkup([]),'');
const created=helper.createMarkup([{id:12,name:'Польша'},{id:19,name:'Норвегия'}]);
assert.match(created,/data-user-create-quota-row="12"/);
assert.match(created,/data-user-create-quota-row="19"/);
assert.match(created,/data-user-create-quota-count/);
assert.match(created,/Безлимит/);
assert.equal(created.includes('<details'),false,'The per-node panel must appear immediately');
assert.match(helper.createMarkup([{id:3,name:'A & <B>'}]),/A &amp; &lt;B&gt;/,
  'Node names must be escaped before rendering');
assert.match(helper.createMarkup(Array.from({length:7},(_,i)=>({id:i+1,name:'Node '+i}))),/data-user-create-node-search/,
  'Large node catalogs need a search field');
const nodeRow=(id,value,period)=>({
  dataset:{userCreateQuotaRow:String(id)},
  querySelector:selector=>selector==='[data-user-create-quota-limit]'?{value:String(value)}:
    selector==='[data-user-create-quota-period]'?{value:period}:null
});
const form=rows=>({querySelectorAll:()=>rows});
assert.deepEqual(helper.readCreate(form([nodeRow(12,'5','monthly'),nodeRow(19,'847','lifetime')])),{
  '12':{limitGb:5,period:'monthly'},'19':{limitGb:847,period:'lifetime'}
});
assert.deepEqual(helper.readCreate(form([nodeRow(12,'','monthly'),nodeRow(19,'0','monthly')])),{});
for(const value of ['-1','1000001','abc','0.0000000001']){
  assert.throws(()=>helper.readCreate(form([nodeRow(12,value,'monthly')])));
}
assert.throws(()=>helper.readCreate(form([nodeRow(12,'5','weekly')])));

assert.match(ui,/save\(\{nodeTrafficLimits:policies\}\)/);
assert.match(app,/XMeshNodeQuotas\.mount/);
assert.doesNotMatch(ui,/nodeQuotaUsedBytes\s*:/,'UI may not write server-owned counter');
assert.doesNotMatch(backend,/UPDATE user_node_quota_monthly SET uplink_bytes=0/,'general traffic reset must not erase per-node quotas');
console.log('Independent user/node quota limits, signed accounting, API and UI contracts: PASS');
