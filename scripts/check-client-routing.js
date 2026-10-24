#!/usr/bin/env node
'use strict';
// Verify that reusable client rules have a real authoring and delivery path.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('client-routing.js','utf8');
const sandbox={window:{},crypto:require('node:crypto').webcrypto};
new vm.Script(source,{filename:'client-routing.js'}).runInNewContext(sandbox);
assert.equal(typeof sandbox.window.XMeshClientRouting?.create,'function');
const [markup,mount]=sandbox.window.XMeshClientRouting.create({
 nodes:[{id:2,name:'Netherlands',profileId:3}],
 hosts:[{id:7,tag:'NL',remark:'CDN NL'}],
 profiles:[{id:3,config:JSON.stringify({inbounds:[{tag:'NL'}]})}],
 set:{clientRoutingProfiles:[{id:'ru-route',name:'RU rules',enabled:true,
   servers:['node:2','host:7'],
   rules:[{match:'geosite',value:'category-ru',action:'server',server:'host:7'}]}]}
},()=>{},()=>{});
assert.equal(typeof mount,'function');
for(const key of ['data-cr-save','data-cr-add','data-cr-list','Клиентская маршрутизация'])
 assert(markup.includes(key),'Missing client routing workspace control: '+key);
assert.match(source,/clientRoutingProfiles/);
assert.match(source,/class="crx-card/,'Card gallery must render each routing template independently');
assert.match(source,/class="crx-overlay"/,'Full editor must open in a separate layer');
assert.match(source,/class="crx-dialog"/,'The layered editor must be present');
assert.match(source,/class="crx-flag"/,'Flags must be rendered without external resources');
assert.match(source,/data-cr-json-apply/,'JSON mode must remain available');
const clientCss=fs.readFileSync('client-routing.css','utf8');
assert.match(clientCss,/#client-route-root\.crx \.crx-card/,'Cards must have dedicated scoped styling');
assert.match(clientCss,/\.crx-source-grid/,'Server selection must use responsive cards');
assert.doesNotMatch(clientCss,/client-route-profile\{/,'Legacy routing layout must not return');

assert.match(source,/data-cr-source/);
assert.match(source,/data-cr-rule/);
assert.match(source,/data-cr-field="server"/);
const engine=fs.readFileSync('backend/src/subscription_json.rs','utf8');
const backend=fs.readFileSync('backend/src/client_routing.rs','utf8');
const api=fs.readFileSync('backend/src/main.rs','utf8');
const publicFeed=fs.readFileSync('backend/src/user_subscriptions.rs','utf8');
assert.match(engine,/client_routing::build_server\(proxy,&all_proxies/);
assert.match(backend,/fn same_template_is_shared_and_server_route_keeps_default_source/);
assert.match(backend,/fn unknown_or_unauthorized_destination_blocks_instead_of_falling_back/);
assert.match(backend,/unwrap_or\("block"\)/);
assert.match(publicFeed,/xmeshOwnerNodeKey/);
assert.match(api,/\.route\("\/client-routing", patch\(patch_client_routing\)\)/);
assert.match(api,/require_mutation\(&actor\)\?/);
const index=fs.readFileSync('index.html','utf8');
assert.match(index,/client-routing\.css\?v=20261024-client-cards-v2/,'New CSS should be cache busted');
assert.match(index,/client-routing\.js\?v=20261024-client-cards-v2/,'New JS should be cache busted');

const docker=fs.readFileSync('backend/Dockerfile','utf8');
for(const item of ['client-routing.js','client-routing.css']){
 assert(index.includes(item),'HTML must load '+item);
 assert(docker.includes(item),'Runtime image must package '+item);
}
console.log('Shared client routing: template editor, source assignment, subscriber authorization, admin API, and packaged assets OK.');
