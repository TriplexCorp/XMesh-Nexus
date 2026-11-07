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

const [view,init]=studio.create({
  brand:'My VPN',
  subscriptionDomain:'sub.example.com',
  subscriptionPath:'/s',
  subscriptionBrand:'<script>alert(1)</script>',
  subscriptionPlacement:'c',
  nodePlacement:'b'
},async()=>{},()=>{},{users:3,nodes:8});
assert.equal(typeof init,'function');
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
assert.match(view,/SUBSCRIPTION STUDIO/);
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
assert.match(src,/preview\.dataset\.portalTheme=d\.subscriptionTheme/);
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
assert.match(view,/name="subscriptionPlacement"/);
assert.match(view,/name="nodePlacement"/);
assert.match(view,/name="deploymentServerB"/);
assert.match(view,/name="deploymentServerC"/);
assert.match(view,/value="c" selected/);
assert.match(view,/value="b" selected/);
assert(!view.includes('<script>alert(1)</script>'),'User-provided studio content must be escaped');
assert.match(view,/&lt;script&gt;/);
assert.match(view,/Экспорт схемы JSON/);
assert.match(view,/Оформление действующей страницы подписки/);
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
assert.match(template,/href="\/subscription-studio[.]css[?]v=[a-f0-9]{12}"/,'Live portal must use the same versioned Studio stylesheet');
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
assert.match(template,/subscription-surface\.css[^"]*"[^>]*>[\s\S]*subscription-public\.css/,
  'Visitor portal must apply public layout after shared surface tokens');
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
assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
console.log('Subscription Studio, separate-domain management and deployment blueprint: OK');
