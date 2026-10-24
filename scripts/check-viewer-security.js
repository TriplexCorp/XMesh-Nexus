'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const main=fs.readFileSync('backend/src/main.rs','utf8');
const runtime=fs.readFileSync('backend/src/node_runtime.rs','utf8');
const security=fs.readFileSync('backend/src/security.rs','utf8');
const users=fs.readFileSync('backend/src/user_subscriptions.rs','utf8');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const section=(source,start,end)=>{const a=source.indexOf(start);assert(a>=0,'Missing '+start);const b=source.indexOf(end,a+start.length);assert(b>=0,'Missing '+end);return source.slice(a,b)};
const observer=section(main,'fn viewer_read_only(','async fn bootstrap(');
assert.match(observer,/!matches!\(actor\.role\.as_str\(\), "owner" \| "admin"\)/);
assert.match(observer,/matches!\(collection, "users" \| "nodes" \| "squads"\)/);
assert.match(observer,/let fields:/);
for(const secret of ['xrayId','subscriptionUrl','privateKey','password','config','token','email','telegramId','devices']){
  assert(!observer.includes('"'+secret+'"'),'Forbidden viewer projection key: '+secret);
}
const boot=section(main,'async fn bootstrap(','async fn list_records(');
assert.match(boot,/viewer_read_only\(&actor\) && !viewer_can_read_collection\(collection\)/);
assert.match(boot,/viewer_record\(collection,r\)/);
assert.match(boot,/viewer_settings\(&settings\)/);
const listing=section(main,'async fn list_records(','async fn create_record(');
assert.match(listing,/enforce_collection\(&actor, &collection, false\)/);
assert.match(listing,/viewer_record\(&collection,item\)/);
const settings=section(main,'async fn get_settings(','async fn patch_settings(');
assert.match(settings,/viewer_settings\(&settings\)/);
const status=section(runtime,'pub async fn status(','pub async fn request_geodata_refresh(');
assert.match(status,/viewer_read_only\(&actor\)/);
const restart=section(runtime,'pub async fn restart_status(','struct NodeCommandPoll');
assert.match(restart,/require_mutation\(&actor\)/);
const policy=section(security,'pub async fn get_settings(','pub async fn update_settings(');
assert.match(policy,/require_mutation\(&actor\)/);
for(const name of ['status','admin_client_json']){
  const pos=users.indexOf('pub async fn '+name+'(');
  assert(pos>=0,'Missing '+name);
  assert.match(users.slice(pos,pos+650),/require_mutation\(&actor\)/,'Viewer subscription disclosure '+name);
}
assert(!app.includes("localStorage.getItem('xmeshNexusDB'"),'Persistent control-plane snapshot must never load');
assert(!app.includes("localStorage.setItem('xmeshNexusDB'"),'Persistent control-plane snapshot must never be saved');
assert.match(app,/const viewerMode=/);
assert.match(app,/if\(viewerMode\(\)\)/);
assert.match(app,/if\(!viewerMode\(\)\)void loadUserSubscription/);
assert.match(css,/data-access-role="viewer"/);
console.log('Viewer RBAC source contracts passed: server-side least privilege, no secret cache, read-only UI.');
