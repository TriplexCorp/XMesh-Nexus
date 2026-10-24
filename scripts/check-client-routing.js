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
// Regression: the panel is served on /dashboard/<secret>, not on /.
// A dashboard-relative stylesheet with the right version is STILL a 404.
const oldLink={
 href:'https://panel.example/dashboard/client-routing.css?v=20261024-unified-route-v12',
 remove(){this.removed=true;}
};
const appended=[];
sandbox.URL=URL;
sandbox.location=new URL('https://panel.example/dashboard/private');
sandbox.document={
 querySelectorAll(selector){return selector==='link[rel="stylesheet"]'?[oldLink]:[];},
 getElementById(){return null;},
 createElement(tag){return {tagName:tag,dataset:{},id:'',textContent:'',href:'',rel:''};},
 head:{appendChild(node){appended.push(node);}}
};
mount();
const replacementLink=appended.find(el=>el.tagName==='link');
assert(replacementLink,'Routing must load a missing or misdirected CSS asset');
const currentCssVersion=source.match(/const CSS_VERSION = '([^']+)'/)?.[1];
assert(currentCssVersion,'Client routing stylesheet version must be explicit');
assert.equal(replacementLink.href,'/client-routing.css?v='+currentCssVersion);
assert.equal(oldLink.removed,true);

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
assert(index.includes('client-routing.css?v='+currentCssVersion),'Routing CSS must match the actual version');
assert.match(index,/href="\/client-routing\.css\?v=/,'Routing CSS must be absolute under the nested dashboard URL');
assert.match(index,/src="\/client-routing\.js\?v=/,'Routing JS must be absolute under the nested dashboard URL');

// The secured dashboard lives under /dashboard/<slug>. Every remaining
// relative local asset must be in the Rust rebasing allowlist.
const dashboardServer=fs.readFileSync('backend/src/security.rs','utf8');
for (const item of index.matchAll(/(?:href|src)="([^"]+)"/g)) {
 const uri=item[1];
 if(uri.startsWith('/')||/^[a-z][a-z0-9+.-]*:/i.test(uri))continue;
 const asset=uri.split('?')[0];
 if(!/\.(css|js)$/.test(asset))continue;
 assert(dashboardServer.includes('"'+asset+'"'),
  'Hidden dashboard route does not rebase '+asset);
}
assert.match(dashboardServer,/fn dashboard_client_routing_assets_are_absolute/);


assert.match(index,/client-routing\.js\?v=[A-Za-z0-9-]+/,'Routing JS must carry a cache-busting version');

const docker=fs.readFileSync('backend/Dockerfile','utf8');
for(const item of ['client-routing.js','client-routing.css']){
 assert(index.includes(item),'HTML must load '+item);
 assert(docker.includes(item),'Runtime image must package '+item);
}
console.log('Shared client routing: template editor, source assignment, subscriber authorization, admin API, and packaged assets OK.');

assert.match(source,/ensureStylesheet\(\)/,'Routing view must load its own CSS');
assert.match(source,/width="19" height="19"/,'SVG icons must have explicit dimensions');
assert.match(source,/ensureStylesheet\(\)/,'Routing stylesheet must load');

assert.doesNotMatch(source,/\['tcp,udp','TCP \+ UDP'\]/,'Network menu must not duplicate the all-networks choice');
assert.match(source,/\['','TCP \+ UDP'\]/,'Default network must be labelled TCP + UDP');
assert.match(source,/crx-tab-label/,'Editor navigation must have dedicated tab labels');

assert.match(source,/<dialog class="crx-overlay"/,'Editor must use a native top-layer dialog');
assert.match(source,/modal\.showModal\(\)/,'Editor must enter browser top layer');
const routingCSS=fs.readFileSync('client-routing.css','utf8');
assert.match(routingCSS,/dialog\.crx-overlay::backdrop/,'Native dialog must blur the full page backdrop');
assert.equal((routingCSS.match(/\.crx-overlay\{/g)||[]).length,1,'Only one modal overlay style should exist');

assert.match(source,/const reuse=Boolean\(live\?\.open&&live\.dataset\.crProfileId===p\.id\)/,
 'Changing routing tabs must reuse the same native dialog');
assert.match(source,/body\.replaceChildren\(\.\.\.replacement\.childNodes\)/,
 'Routing tabs should replace only panel content and preserve the modal shell');
assert.match(source,/modal\.addEventListener\('cancel'/,
 'Browser Escape must synchronize dialog state');
assert.match(clientCss,/width:min\(100%,var\(--panel-content-max,1920px\)\)/,
 'Editor width must follow the panel width slider');
assert.match(clientCss,/dialog\.crx-overlay::backdrop\{background:var\(--xm-modal-dim/,
 'Editor must use shared backdrop tokens');
assert.doesNotMatch(clientCss,/\.crx-overlay\{[^}]*backdrop-filter/,
 'Never apply page blur to the dialog content');

