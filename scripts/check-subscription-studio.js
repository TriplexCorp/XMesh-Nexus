#!/usr/bin/env node
'use strict';
const {assertPackaged}=require('./ci/frontend-source.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const src=fs.readFileSync('frontend/js/features/subscriptions/subscription-studio.js','utf8');
const css=fs.readFileSync('frontend/styles/features/subscriptions/subscription-studio.css','utf8');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const rust=fs.readFileSync('backend/src/main.rs','utf8');
const html=fs.readFileSync('frontend/index.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');

new Function(src);
const ctx={window:{}};
vm.runInNewContext(src,ctx);
const studio=ctx.window.XMeshSubscriptionStudio;
assert.equal(typeof studio.create,'function');
assert(studio.hostnameOK('sub.example.com'));
assert(!studio.hostnameOK('https://sub.example.com/'));
assert(studio.pathOK('/subscription'));
assert(!studio.pathOK('/api/v1'));
assert(!studio.pathOK('//s'));
const token='a'.repeat(64);
const install=studio.installCommand('panel.example.org','sub.example.org','/s',token);
assert.equal(studio.installCommand('panel.example.org','sub.example.org','/s'),'','No token must produce no command');
assert(install.includes('TriplexCorp/XMesh-Sub/51d90ff15ef2a68415e23b325b3a37393b8b97b5/install.sh'),'Bootstrap must use an immutable audited Git revision');
assert(install.includes('19d3049bff7d23a13ad00d06debfd86cfc3fd773ce49a87426e0a9723566579b'),'Bootstrap pins the vetted installer SHA-256');
assert(install.includes('sha256sum --check --status'),'Installer SHA-256 must be checked before root execution');
assert(install.includes("--enroll-token-stdin <<'XMESH_ENROLL_TOKEN'"),'One-time secret must be provided through stdin');
assert(!install.includes('--enroll-token '+token),'Credential must not occur in argv');
assert(install.includes('\n'+token+'\nXMESH_ENROLL_TOKEN'),'Token must be supplied as heredoc body only');
const checkShell=require('node:child_process').spawnSync('bash',['-n'],{input:install,encoding:'utf8'});
assert.equal(checkShell.status,0,'Generated installer must be valid Bash: '+checkShell.stderr);
assert.equal(studio.installCommand('panel.example.org','panel.example.org','/s'),'');
assert.equal(studio.installCommand('panel.example.org','sub.example.org','/api/v1'),'');
assert.equal(studio.installCommand('panel.example.org','sub.example.org','/s;curl bad'),'');
assert.equal(studio.installCommand('panel.example.org;bad','sub.example.org','/s'),'');


const [view,init]=studio.create({
  brand:'My VPN',
  subscriptionDomain:'sub.example.com',
  subscriptionPath:'/s',
  subscriptionBrand:'<script>alert(1)</script>',
  subscriptionPlacement:'c',
  nodePlacement:'b'
},async()=>{},()=>{},{users:3,nodes:8});
assert.equal(typeof init,'function');
assert.match(view,/data-sub-install-command/);
assert.match(view,/data-sub-install-copy/);
assert.match(view,/data-sub-enroll/,'One-command managed installation must be discoverable');
assert.match(view,/class="subscription-sub-install-actions"/,'The one-command generator belongs to the install step');
assert.match(view,/Создать команду установки/,'Install must begin by generating a managed command');
assert.doesNotMatch(view,/Создать команду привязки|Это базовая установка без управления/,
  'Never present separate unmanaged install and enrollment flows');
assert.equal((view.match(/data-sub-enroll/g)||[]).length,1,'Exactly one installer action');
assert.match(view,/data-sub-check/,'Server status must have a refresh action');
assert.match(view,/data-sub-update disabled/,'Update must remain disabled until authenticated heartbeat');
assert.match(view,/data-sub-agent-state/,'Server state needs real managed status');
assert.match(view,/class="subscription-server-left"/,'Address and management must share a distinct left column');
assert.match(view,/subscription-server-address/,'Address must be a standalone card');
assert.match(view,/subscription-server-management/,'Management must be a standalone card');
assert.match(view,/subscription-server-provisioning/,'Installation must be its own right-hand card');
assert.match(view,/subscription-sub-scope/,'Security guidance must live in a full-width card');
assert.match(view,/data-sub-agent-version/,'Server card must expose real agent version');
assert.match(view,/data-sub-agent-seen/,'Server card must expose live last-seen timestamp');
assert.match(view,/data-sub-flood-card/,'Owner needs a compact flood protection card');

assert.doesNotMatch(view,/option value="custom"/,'The DNS presets must not gain a fifth item');
assert.doesNotMatch(view,/name="json_customDnsProtocol"/,'No extra protocol dropdown');
assert.match(view,/name="json_customDnsAddress"/,'Exactly one optional custom DNS input');
assert.equal((view.match(/name="json_customDnsAddress"/g)||[]).length,1,'Do not duplicate DNS editors');
assert.match(view,/IP \/ IP:порт — UDP; HTTPS-ссылка — DoH/,'Explain automatic protocol detection');
assert.match(src,/customDnsAddress:input\(form,'json_customDnsAddress'\)\.value\.trim\(\)/,'The single input must be included when saving');
const [customDnsView]=studio.create({
  subscriptionJson:{dns:'cloudflare',customDnsAddress:'https://dns.example.org:8443/my-dns'}
},async()=>{},()=>{},{});
assert.match(customDnsView,/name="json_customDnsAddress"[^>]*value="https:\/\/dns\.example\.org:8443\/my-dns"/,
 'Restore the custom DoH URL, including custom port and path');
assert.doesNotMatch(customDnsView,/option value="custom"/,
 'Typing custom DNS must not add a new DNS preset');
const [udpDnsView]=studio.create({
  subscriptionJson:{dns:'yandex',customDnsAddress:'[2606:4700:4700::1111]:5353'}
},async()=>{},()=>{},{});
assert.match(udpDnsView,/name="json_customDnsAddress"[^>]*value="\[2606:4700:4700::1111\]:5353"/,
 'Custom IPv6 address must survive rerendering');
const [legacyDnsView]=studio.create({
  subscriptionJson:{dns:'custom',customDnsProtocol:'doh',customDnsAddress:'https://dns.example.net/query'}
},async()=>{},()=>{},{});
assert.match(legacyDnsView,/name="json_customDnsAddress"[^>]*value="https:\/\/dns\.example\.net\/query"/,
 'Previously saved custom DNS must migrate without data loss');
assert.match(legacyDnsView,/option value="cloudflare" selected/,
 'Earlier prototype custom selection must be normalized to a valid preset');

assert.match(view,/name="floodEnabled"/,'Flood protection must be togglable');
assert.match(view,/name="floodMode" value="monitor"/,'Monitoring must be available');
assert.match(view,/name="floodMode" value="protect"/,'Protection must be available');
assert.match(view,/name="floodIpPerMinute" min="1" max="600" step="1"/,'Edge IP slider must allow every integer, including 1 and 2');
assert.match(view,/name="floodTokenPerMinute" min="1" max="60" step="1"/,'Token slider must allow every integer, including 1 and 2');
assert.match(view,/name="floodIpExact" min="1" max="600" step="1"/,'IP limit needs an exact number input');
assert.match(view,/name="floodTokenExact" min="1" max="60" step="1"/,'Token limit needs an exact number input');
assert.match(src,/bindFloodLimit\('floodIpPerMinute','floodIpExact'\)/,'IP slider and number input must stay in sync');
assert.match(src,/bindFloodLimit\('floodTokenPerMinute','floodTokenExact'\)/,'Token slider and number input must stay in sync');
const [smallLimitsView]=studio.create({subscriptionFlood:{enabled:true,mode:'protect',ipPerMinute:1,tokenPerMinute:2}},async()=>{},()=>{},{});
assert.match(smallLimitsView,/name="floodIpExact"[^>]*value="1"/,'One request per minute must persist on render');
assert.match(smallLimitsView,/name="floodTokenExact"[^>]*value="2"/,'Two requests per minute must persist on render');
assert.match(view,/data-sub-flood-requests/,'Rate control needs live request telemetry');
assert.match(view,/data-sub-flood-blocked/,'Rate control needs blocked-request telemetry');
assert.match(app,/floodStatus:\(\)=>backendRequest/,'Telemetry must come from owner API');
const guard=fs.readFileSync('backend/src/subscription_flood.rs','utf8');
const route=fs.readFileSync('backend/src/user_subscriptions.rs','utf8');
assert.match(guard,/MAX_TOKEN_BUCKETS_PER_MINUTE/,'Untrusted-token keys must be bounded');
assert.match(guard,/RETRY_AFTER/,'429 responses must include Retry-After');
assert.match(guard,/const LUA/,'Redis counters must use atomic scripts');
assert.match(route,/subscription_flood::enforce/,'Public feed and portal paths require enforcement');
assert.match(rust,/get\(subscription_flood::status\)/,'Owner status route must exist');
assert.match(guard,/mode: "monitor"/,'Default must not block live customers');

assert.match(view,/data-sub-public-copy/,'Address card must offer copyable link template');
assert.match(view,/data-sub-health-copy/,'Health endpoint must be copyable');
assert.equal((view.match(/class="subscription-sub-step"/g)||[]).length,3,
  'Installer must render three distinct compact step cards');
assert.equal((view.match(/class="subscription-sub-step-index"/g)||[]).length,3,
  'Installer step numbers must remain visible');
assert(!view.includes('Версия агента</small><b>v2.0'),
  'The server card must never hardcode a fake agent version');
assert(!view.includes('Последняя связь</small><b>12.11.2026'),
  'The server card must never invent last-seen metadata');
assert.match(src,/agentVersion\.textContent/,'The agent version must update from API status');
assert.match(src,/agentSeen\.textContent/,'The last-seen field must update from API status');
assert.match(src,/commandGroup\.hidden=!managedCommand/,'Installer code should be hidden until securely generated');

assert.match(src,/subApi\.enroll\(\)/,'Pairing must call real protected API');
assert.match(src,/subApi\.status\(\)/,'Status must call real protected API');
assert.match(src,/subApi\.update\(\)/,'Update must queue an authenticated action');
assert.match(src,/enrollmentToken=result\.enrollmentToken/,'Pairing code must be ephemeral UI state');
assert.match(src,/--enroll-token-stdin/,'Managed install must pass the one-time code through stdin');
assert(src.includes('if(copy)copy.disabled=!managedCommand;'),
  'Copy must be disabled until the entire authenticated installer is available');
assert(src.includes('Date.now()>=enrollmentExpiresAt'),
  'Expired install commands must be invalidated automatically');
assert(src.includes('expiresInSeconds'), 'Installer must use the server-generated enrollment expiry');
assert.match(app,/\/api\/v1\/sub-server\/status/);
assert.match(app,/\/api\/v1\/sub-server\/enrollment/);
assert.match(app,/\/api\/v1\/sub-server\/update/);
const control=fs.readFileSync('backend/src/sub_server.rs','utf8');
assert.match(control,/require_owner\(&actor\)/,'Management must be owner-only');
assert.match(control,/subtle::ConstantTimeEq/,'Agent tokens require constant-time comparison');
assert.match(control,/GETDEL/,'Single-use enrollment and jobs must be atomic');
assert(control.includes('ENROLL_TTL_SECONDS: u64 = 3600'),
  'Fresh VPS installation needs time to install Docker before consuming the code');
assert(control.includes('.arg(ENROLL_TTL_SECONDS)'), 'Redis TTL must share the API response TTL');
assert.match(control,/PENDING_UPDATE/,'Update queue is server-owned');
assert.doesNotMatch(control,/std::process::Command|tokio::process::Command/,'Nexus must not execute remote shell commands');
assert.match(rust,/\/sub-server\/agent\/poll/,'Authenticated outbound agent poll endpoint must be mounted');
assert.match(rust,/\/sub-server\/agent\/report/,'Authenticated update results must be mounted');
assert.match(rust,/\/sub-server\/claim/,'One-time pairing endpoint must be mounted');

assert.match(view,/XMesh Sub/);
const linkedPalette={
 subscriptionAccent:'#4488cc',subscriptionSecondaryAccent:'#f0a560',subscriptionTheme:'light',
 subscriptionBackground:'#f7f9fc',subscriptionCardColor:'#ffffff',subscriptionTextColor:'#203040',
 subscriptionFont:'inter',subscriptionRadius:27,subscriptionCardStyle:'glass'
};
const [linkedView]=studio.create({subscriptionAccent:'#e8bb78'},async()=>{},()=>{},{users:0,nodes:0},()=>linkedPalette);
assert.match(linkedView,/name="subscriptionAccent"[^>]*value="#4488cc"/,
 'Linked portal preview must use the current panel accent');
assert.match(linkedView,/name="subscriptionTheme"[^>]*>[\s\S]*?value="light" selected/,
 'Linked portal must follow panel light/dark mode');
assert.match(linkedView,/name="subscriptionSyncPanelTheme" checked/,
 'New subscription appearance defaults to linked panel theme');
assert.match(linkedView,/name="subscriptionSecondaryAccent"[^>]*value="#f0a560"/,
 'Linked portal must inherit the secondary accent as well');
assert.match(linkedView,/name="subscriptionRadius"[^>]*value="27"/,
 'Linked portal must inherit corner rounding');
assert.match(linkedView,/name="subscriptionFont"[^>]*>[\s\S]*?value="inter" selected/,
 'Linked portal must inherit the panel font');
assert.match(linkedView,/name="subscriptionCardStyle"[^>]*>[\s\S]*?value="glass" selected/,
 'Linked portal must inherit glass surface style');
assert.match(app,/subscriptionSecondaryAccent:color\('--b'/);
assert.match(app,/subscriptionFont:C\.font/);
assert.match(app,/subscriptionRadius:Math\.round/);
assert.match(app,/subscriptionCardStyle:C\.surface/);
assert.match(app,/if\(prop==='font'\|\|prop==='surface'\)syncSubscriptionTheme\(\)/);
assert.match(app,/const saveAppearanceControls=\(\)=>\{[\s\S]*?syncSubscriptionTheme\(\)/);
assert(!/\.subscription-preview\{\s*--portal-accent:/.test(css),
 'Public subscription must not override its server-supplied accent');
assert(!/\.subscription-preview\{\s*--portal-bg:/.test(css),
 'Public subscription must not override its server-supplied background');
assert(!/\.subscription-preview\{\s*--portal-secondary:/.test(css),
 'Public subscription must not override its server-supplied secondary accent');
assert.match(css,/\.subscription-studio\{\s*--portal-accent:/,
 'Demo defaults must only be scoped to Subscription Studio');
const [customPaletteView]=studio.create({subscriptionSyncPanelTheme:false,subscriptionAccent:'#ff0022'},
 async()=>{},()=>{},{users:0,nodes:0},()=>linkedPalette);
assert.match(customPaletteView,/name="subscriptionAccent"[^>]*value="#ff0022"/,
 'Independent portal theme must preserve a custom accent');
assert.doesNotMatch(customPaletteView,/name="subscriptionSyncPanelTheme" checked/,
 'Explicit opt-out must remain unchecked');

assert.match(view,/data-portal-language="ru"/,'Visitors must be able to select Russian within the portal preview');
assert.match(view,/data-portal-language="en"/,'Visitors must be able to select English within the portal preview');
assert.match(view,/name="subscriptionDescriptionEn"/,'English custom copy must be independently editable');
assert.match(view,/name="subscriptionAppsTitleEn"/,'Apps heading must support the English locale');
assert.match(src,/if\(next!=='ru'&&next!=='en'\)return/,'Untrusted locale values must be rejected');
assert.match(src,/previewRoot\.lang=lang/,'Portal preview must set its own lang, not the admin language');
assert.match(src,/textContent=copy\[4\]/,'Copy-link action must follow the visitor locale');
assert.match(src,/english\?'Devices':'Устройства'/,'Device action must follow the visitor locale');
assert.match(src,/\$\('\[data-subscription-description\]'\)\.textContent=/,'Custom copy must use textContent, not untrusted HTML');
assert.doesNotMatch(view,/<h2>SUBSCRIPTION STUDIO<\/h2>/,'Global shell is the only Studio header');
assert.match(view,/name="subscriptionDomain"/);
assert.match(view,/name="subscriptionPath"/);
assert.match(view,/name="subscriptionBrand"/);
assert.match(view,/name="subscriptionAccent"/);
assert.match(view,/name="subscriptionSyncPanelTheme"/);
assert.match(src,/const applyPanelTheme=/);
assert.match(src,/subscriptionSyncPanelTheme:input\(form,'subscriptionSyncPanelTheme'\)\.checked/);
assert.match(app,/const syncSubscriptionTheme=/);
assert.match(app,/syncSubscriptionTheme\(\)/);
assert.match(rust,/"subscriptionSyncPanelTheme"/);
assert.match(view,/name="subscriptionTheme"/);
assert.match(src,/preview\.dataset\.portalTheme=previewThemeOverride==='auto'\?d\.subscriptionTheme:previewThemeOverride/,
 'Portal preview defaults to saved theme but can inspect other themes temporarily');
assert.match(rust,/"subscriptionTheme", &\["dark", "light"\]/);
assert.match(view,/name="subscriptionShowTraffic"/);
assert.match(view,/name="subscriptionShowExpiry"/);
for(const setting of [
 'subscriptionBackground','subscriptionCardColor','subscriptionTextColor','subscriptionSecondaryAccent',
 'subscriptionLayout','subscriptionCardStyle','subscriptionFont','subscriptionRadius',
 'subscriptionHero','subscriptionCta','subscriptionLogoUrl','subscriptionSupportLabel',
 'subscriptionSupportUrl','subscriptionClientLayout','subscriptionShowApps','subscriptionShowQr',
 'subscriptionShowCopy','subscriptionShowDevices','subscriptionShowStatus','subscriptionShowSupport'
])assert(view.includes('name="'+setting+'"'),'Missing studio setting '+setting);
assert.equal(studio.clientCatalog.length,16,'Built-in client catalog must remain intact');
assert.equal(studio.maxCustomClients,32,'Custom client limit must be bounded');

// Subscription Studio uses the same one-pixel precision as the main radius slider.
assert.match(src,/name="subscriptionRadius" min="1" max="36" step="1"/);

assert.equal(studio.nextCustomClientId([]),'custom-1');
assert.equal(studio.nextCustomClientId([{id:'custom-1'},{id:'custom-3'}]),'custom-2');
assert.equal(studio.appsHeading('ru'),'Приложения для подключения');
assert.equal(studio.appsHeading('en'),'Connection apps');
assert(view.includes('name="subscriptionAppsTitle"'),'Catalog section title must be editable');
assert(view.includes('data-custom-client-add'),'Custom client add button must exist');
assert(view.includes('data-custom-client-editor'),'Custom client editor container must exist');
const [customView]=studio.create({
 subscriptionAppsTitle:'Поддерживаемые клиенты',
 subscriptionCustomClients:[
  {id:'custom-1',name:'My & <Custom> "App"',platforms:'iOS · Android',
   url:'https://example.com/download?os=ios&app=test',enabled:true},
  {id:'custom-2',name:'Disabled Client',platforms:'Windows',url:'',enabled:false}
 ]
},async()=>{},()=>{},{users:0,nodes:0});
assert.match(customView,/name="subscriptionAppsTitle"[^>]*value="Поддерживаемые клиенты"/);
assert.match(customView,/data-custom-client-id="custom-1"/);
assert.match(customView,/data-custom-client-id="custom-2"/);
assert.match(customView,/data-custom-field="enabled" aria-label="Показывать приложение" checked/);
assert.match(customView,/My &amp; &lt;Custom&gt; &quot;App&quot;/);
assert.match(customView,/https:\/\/example\.com\/download\?os=ios&amp;app=test/);
assert.doesNotMatch(customView,/My & <Custom>/);
assert.match(src,/subscriptionCustomClients:readCustomClients\(\)/);
assert.match(src,/data-subscription-apps-title/);
assert.match(src,/allEnabled=\[\.\.\.enabled,\.\.\.customEnabled/);
assert.match(src,/data-custom-client-remove/);
assert.match(src,/customRows\(\)\.forEach/);
const rendered=studio.renderCustomClient({
 id:'custom-11',name:'Injected"><svg onload=alert(1)>',
 platforms:'iOS',url:'',enabled:false},true);
assert.match(rendered,/&quot;&gt;&lt;svg onload=alert\(1\)&gt;/);
assert(!rendered.includes('"><svg'),'Custom values must remain escaped in HTML');
assert.match(rendered,/data-custom-client-id="custom-11"/);

for(const key of ['happ','incy','v2raytun','v2rayn','v2rayng','streisand','hiddify','nekobox','shadowrocket']){
 assert(view.includes('name="subClient_'+key+'"'),'Missing app visibility setting '+key);
 assert(view.includes('name="subClientLink_'+key+'"'),'Missing app HTTPS-link field '+key);
}
const [overridden]=studio.create({
 subscriptionClients:{happ:false,incy:true},
 subscriptionClientLinks:{incy:'https://example.com/download?platform=ios'},
 subscriptionLogoUrl:'https://example.com/logo.png',
 subscriptionHero:'<script>alert(1)</script>'
},async()=>{},()=>{},{users:0,nodes:0});
assert.doesNotMatch(overridden,/name="subClient_happ" checked/);
assert.match(overridden,/name="subClient_incy" checked/);
assert.match(overridden,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert(studio.validHttps('https://example.com/download'));
assert(!studio.validHttps('javascript:alert(1)'));
assert(!studio.validHttps('https://user:pass@example.com'));
assert(!studio.validHttps('http://example.com'));
assert(!studio.validHttps('https://example.com:443'));
assert(!studio.validHttps('https://localhost\\evil.test'));
for(const value of ['div','section','label','span']){
 const opens=(view.match(new RegExp('<'+value+'(?:[ >])','g'))||[]).length;
 const closes=(view.match(new RegExp('</'+value+'>','g'))||[]).length;
 assert.equal(opens,closes,'HTML preview needs balanced '+value+' markup');
}
assert.match(src,/subscriptionClients:Object\.fromEntries\(clientCatalog/);
assert.match(src,/subscriptionClientLinks:Object\.fromEntries\(clientCatalog/);
assert.match(src,/enabled=clientCatalog\.filter/);
assert.match(src,/data-client-preset/);
assert.match(rust,/mod subscription_settings;/);
const validation=fs.readFileSync('backend/src/subscription_settings.rs','utf8');
assert.match(validation,/pub(?:\(crate\))?\s+fn\s+validate\s*\(/);
assert.match(validation,/"subscriptionClients"/);
assert.match(validation,/"subscriptionClientLinks"/);
assert.match(validation,/"subscriptionCustomClients"/);
assert.match(validation,/"subscriptionAppsTitle"/);
assert.match(validation,/HashSet/,'Custom app IDs must be unique');
assert.match(rust,/"subscriptionAppsTitle"\s*\|\s*"subscriptionAppsTitleEn"\s*\|\s*"subscriptionCustomClients"/);
assert.match(validation,/"subscriptionLogoUrl"/);
assert.match(validation,/safe_https_url/);
assert.match(css,/\.subscription-client-editor/);
assert.match(css,/\.subscription-preview-apps/);
assert.match(css,/\.subscription-custom-toolbar/);
assert.match(css,/\.subscription-custom-header/);
assert.match(src,/main\.dataset\.substudioPanel='portal'/,'Portal is the default mounted workspace');
for(const workspace of ['portal','appearance','content','clients','servers','security']){
 assert.match(view,new RegExp('data-substudio-tab="'+workspace+'"'),workspace+' must be a navigable Studio workspace');
 if(workspace!=='portal')assert(src.includes("makePanel('"+workspace+"')"),workspace+' must mount real content');
}
assert.doesNotMatch(view,/<h2>SUBSCRIPTION STUDIO<\/h2>/,'Studio must not duplicate the global header');
assert.match(view,/data-substudio-save-status/,'Toolbar must report unsaved settings');
assert.match(view,/data-substudio-preview-toggle/,'Preview must have a toolbar visibility control');
assert.match(view,/data-substudio-preview-size="mobile"/,'Preview must support mobile dimensions');
assert.match(view,/data-substudio-preview-lang="en"/,'Preview must support independent language');
assert.match(view,/data-substudio-preview-theme="light"/,'Preview must allow light/dark inspection');
assert.match(src,/append\(flood,scope\)/,'Flood protection must be isolated in Security workspace');
assert.match(src,/panes\.some\(panel=>panel\.dataset\.substudioPanel===next\)/,'Navigation must switch real workspace panels');
assert.doesNotMatch(view,/Архитектура LEGO|Экспорт схемы JSON|Сервер B · адрес|Сервер C · адрес/,
 'Remove misleading topology-only blueprint from user interface');
assert.doesNotMatch(view,/name="subscriptionPlacement"|name="nodePlacement"|name="deploymentServerB"|name="deploymentServerC"/,
 'Obsolete planning-only fields should not be editable');
assert.doesNotMatch(src,/input\(form,'subscriptionPlacement'\)|input\(form,'nodePlacement'\)/,
 'Legacy planning keys must not be included in future saves');
assert.match(view,/data-sub-health-url/,'VPS workflow needs explicit health endpoint guidance');
assert.match(view,/data-sub-health-link/,'VPS workflow must expose a real health link');
assert.match(view,/data-sub-agent-state/,'Managed status must be backed by the agent API');
assert.match(view,/Агент сам обращается к Nexus по HTTPS/,'Explain outbound-only management');
assert.match(src,/status\?\.online&&status\?\.domainMatches/,'Online state must require an authenticated and domain-matched heartbeat');
assert.match(src,/root\.dataset\.subscriptionView=next/,'Tabs must switch actual content, not just visual selection');
assert.match(src,/ArrowRight/,'Server tabs must support arrow-key navigation');

assert(!view.includes('<script>alert(1)</script>'),'User-provided studio content must be escaped');
assert.match(view,/&lt;script&gt;/);
assert.doesNotMatch(view,/Экспорт схемы JSON/);
assert.match(view,/data-substudio-tab="appearance"/,'Subscription Studio offers an appearance workspace');
assert.match(fs.readFileSync("backend/src/user_subscriptions.rs","utf8"),/subscriptionClientLinks/);
assert.match(fs.readFileSync("backend/src/user_subscriptions.rs","utf8"),/subscriptionPath/);
assert.match(app,/subscription:\['SUBSCRIPTION STUDIO',subscriptionStudioP\]/);
assert.match(app,/field\(\{k:'subscriptionBrand',l:'Название подписки'/,
 'General Settings must have a distinct subscription name field');
assert.match(app,/DB\.set\.subscriptionBrand\|\|''/,
 'Subscription name field must read the same persisted key as Studio');
assert.match(app,/read\(\[\{k:'brand'\},\{k:'domain'\},\{k:'subscriptionBrand'\},\{k:'subscriptionDomain'\}\],f\)/,
 'Brand form must save both independent names and both domains');
assert.match(view,/Название подписки/,'Studio must use the same label as General Settings');
assert.match(rust,/\("subscriptionBrand", 80\)/,'Rust must validate saved subscription name');
assert.match(app,/subscriptionDomain.*DB.set.subscriptionDomain/);
assert.match(app,/api.saveSettings\(d\)/,'General settings must save both independent domains');
assert.match(rust,/"subscriptionDomain"\s*\|\s*"subscriptionPath"/);
assert.match(rust,/"nodePlacement"/);
assert.match(rust,/"deploymentServerB"/);
assert.match(rust,/"subscriptionPlacement", &\["a", "b", "c"\]/);
assert(!rust.includes('.route("/s/'),'The management panel must not implement public subscription serving');
assert.match(html,/subscription-studio\.js\?v=[a-z0-9-]+/,'Subscription Studio JavaScript must use a cache-busting version');
assertPackaged(assert,['subscription-studio.css', 'subscription-public.css', 'subscription-studio.js', 'subscription-portal.js']);
const template=fs.readFileSync('backend/src/subscription_template.html','utf8');
const portalCss=fs.readFileSync('frontend/styles/features/subscriptions/subscription-public.css','utf8');
const portalJs=fs.readFileSync('frontend/js/features/subscriptions/subscription-portal.js','utf8');
new Function(portalJs);
const liveBackend=fs.readFileSync('backend/src/user_subscriptions.rs','utf8');
for(const cls of ['subscription-preview','subscription-preview-brand','subscription-preview-hero','subscription-preview-meta','subscription-preview-progress','subscription-preview-cta','subscription-preview-quick','subscription-preview-support']) {
  assert(template.includes(cls)||liveBackend.includes(cls), 'Live subscription missing preview component: '+cls);
}
assert(template.includes('id="subscription-public-assets">{{PUBLIC_CSS}}</style>'),
  'Portal must embed CSS without requiring the gateway to proxy assets');
assert(template.includes('{{PUBLIC_SCRIPTS}}'), 'Portal must embed working JavaScript');
assert(!template.includes('href="/subscription-studio.css') && !template.includes('src="/subscription-portal.js'),
  'Portal must not depend on separate CSS/JS URLs from XMesh Sub');
assert.match(portalCss,/subscription-public-shell/,'Live layout requires its mobile-safe shell');
const surfaceCss=fs.readFileSync('frontend/styles/features/subscriptions/subscription-surface.css','utf8');
const panelEntry=fs.readFileSync('frontend/styles/system/nexus-ui-v3.css','utf8');
// Regression 2026-11-07: two authorities turned the public app catalog
// wrapper into a three-column grid with only one child, squeezing 7 apps
// into an unreadable fraction of the page. Surface CSS must never own it.
assert.doesNotMatch(surfaceCss,/\.subscription-public \.subscription-public-catalog\s*\{[^}]*grid-template-columns/,
  'Shared surface stylesheet must not lay out the public catalog wrapper');
assert.doesNotMatch(surfaceCss,/\.subscription-public \.subscription-public-shell\s*\{/,
  'Standalone portal geometry belongs exclusively to public CSS');
assert.match(portalCss,/\.subscription-public \.subscription-preview-apps\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/,
  'Catalog heading must stack above the application cards');
assert.match(portalCss,/\.subscription-public \.subscription-preview-apps>div\s*\{[^}]*repeat\(auto-fit,minmax\(min\(100%,235px\),1fr\)\)/,
  'App card tracks must never squeeze regular app names');
assert(!panelEntry.includes('subscription-public.css'),
  'Public portal CSS must not leak into the authenticated panel');
assert.match(src,/previewHost\.attachShadow\(\{mode:'open'\}\)/,
  'Studio must use an isolated ShadowRoot for the production portal preview');
assert.match(src,/\/subscription-public[.]css[?]v=[a-f0-9]{12}/,
  'Studio preview must load the real public stylesheet inside its ShadowRoot');
const visitorRuntime=fs.readFileSync('backend/src/user_subscriptions_base.rs','utf8');
const publicDocker=fs.readFileSync('backend/Dockerfile','utf8');
const signerDocker=fs.readFileSync('backend/Dockerfile.xsp-signer','utf8');
const backendMain=fs.readFileSync('backend/src/main.rs','utf8');
for(const file of ['subscription-studio.css','subscription-surface.css','subscription-public.css',
                   'qr-code.js','subscription-experience.js','subscription-traffic.js','subscription-portal.js']) {
  assert(visitorRuntime.includes('include_str!("../../frontend/'), 'Public assets must be compiled into the API');
  assert(publicDocker.includes(file), 'Docker build must package '+file);
  assert(signerDocker.includes('source=frontend,target=/source/frontend'), 'Experimental signer must bind-mount frontend sources for inline assets');
}
assert(visitorRuntime.includes("script-src 'nonce-{nonce}'"), 'Public scripts must use a fresh CSP nonce');
assert(backendMain.includes('.entry(HeaderName::from_static("content-security-policy"))'),
  'Generic middleware must preserve the portal-specific CSP');
for(const cls of [
 'subscription-public-shell','subscription-public-workspace','subscription-public-access-panel',
 'subscription-public-info-panel','subscription-public-status-stack','subscription-public-catalog',
 'subscription-public-link-card','subscription-preview-hero-copy'
]) {
 assert(template.includes(cls),'Visitor portal is missing '+cls);
 assert(view.includes(cls),'Studio preview must reuse live portal structure: '+cls);
}
assert.match(view,/data-subscription-preview-frame/,
  'The studio preview must be container-responsive, not a separate mock');
assert.match(template,/class="subscription-public-overview"/,'Public page must expose the new status-first overview');
assert.match(view,/class="subscription-public-overview"/,'Studio preview must share the real overview layout');
assert.match(view,/data-preview-link-card[^>]*hidden/,'Studio must preview a private URL hidden by default');
assert.match(view,/data-subscription-reveal/,'Studio preview must offer the explicit reveal action');
assert.match(src,/quick\.hidden=false/,'Link reveal must stay available when other quick actions are disabled');
assert.match(portalCss,/\.subscription-studio-preview \.subscription-public-shell/,'Studio must receive container-sized portal styling');


assert.match(fs.readFileSync('backend/src/user_subscriptions.rs','utf8'),/include_str!\("subscription_template\.html"\)/,'Backend must use shared portal template');
assert.match(css,/\.subscription-studio-layout/);
assert.match(css,/@media\(max-width:780px\)/);
assert.match(css,/\.subscription-sub-install-command/);
assert.match(css,/\.subscription-servers-page/,'Server setup must have its own bounded layout');
assert.match(css,/\.subscription-server-left/,'Left card stack needs responsive layout');
assert.match(css,/\.subscription-sub-status-metrics/,'Managed status needs two compact data fields');
assert.match(css,/\.subscription-sub-step:hover/,'Installer steps need a subtle interactive hover surface');
assert.match(css,/@media\(max-width:1230px\)/,'Desktop cards must collapse for tighter viewports');
assert.match(css,/@media\(max-width:520px\)/,'Small mobile screens need compact controls');
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/,'Motion must respect reduced-motion settings');
assert.match(css,/\.subscription-studio-tabs button\.on/,'Tab state must be visible');
assert.match(css,/\[hidden\]\{display:none!important\}/,'Hidden workspace must not leak into the grid');

assert.match(src,/navigator\.clipboard\?\.writeText/);
assert.match(src,/savedInstall\.domain=draft\.subscriptionDomain/);
assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
console.log('Subscription Studio, separate-domain management and deployment blueprint: OK');
