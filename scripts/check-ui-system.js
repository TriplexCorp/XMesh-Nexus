#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {root,panelStyles,assertPackaged}=require('./ci/frontend-source.cjs');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const html=read('frontend/index.html');
const app=read('frontend/js/core/app.js');
const entry=read('frontend/styles/system/nexus-ui-v3.css');
const foundation=read('frontend/styles/system/nexus-v3-foundation.css');
const components=read('frontend/styles/system/nexus-v3-components.css');
const layout=read('frontend/styles/system/nexus-v3-layout.css');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex').slice(0,12);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const allFeatureFiles=walk(path.join(root,'frontend/styles/features')).filter(name=>name.endsWith('.css'));
const panelFeatureFiles=allFeatureFiles.filter(name=>!name.endsWith(path.join('subscriptions','subscription-public.css')));
const allCss=panelStyles();

for(const retired of ['frontend/styles/legacy/styles.css','frontend/js/core/ui-builder.js','frontend/styles/system/nexus-v3-workspaces.css']){
  assert(!fs.existsSync(path.join(root,retired)),`Historical implementation must be removed: ${retired}`);
  assert(!html.includes(path.basename(retired)),`Historical implementation must not load: ${retired}`);
}
assert(!fs.existsSync(path.join(root,'scripts/ci/stage-frontend-compat.sh')),'Source checks must not synthesize old assets or mutate backend files');
assert.equal((html.match(/nexus-ui-v3\.css\?v=/g)||[]).length,1,'Panel has one presentation entrypoint');
assert(!html.includes('/styles/features/'),'Feature styles are owned by the presentation entrypoint, not HTML');
assert(html.includes(`nexus-ui-v3.css?v=${hash(entry)}`),'Design-system cache key must match SHA-256 content contract');
assert(html.includes(`app.js?v=${hash(app)}`),'Runtime cache key must match SHA-256 content contract');

const systemNames=['nexus-v3-foundation.css','nexus-v3-components.css','nexus-v3-layout.css'];
for(const name of systemNames){
 const css=read('frontend/styles/system/'+name);
 assert(entry.includes(`${name}?v=${hash(css)}`),`Imported system asset must be content addressed: ${name}`);
}
const imports=[...entry.matchAll(/@import\s+url\(["']([^"']+)["']\)/g)].map(m=>m[1]);
assert.deepEqual(imports.slice(0,3).map(v=>v.split('?')[0]),systemNames.map(name=>'./'+name),'Foundation, components and shared layout must lead the graph in order');
assert(!entry.includes('subscription-public.css'),'Public subscription surface must not enter the authenticated panel graph');
for(const file of panelFeatureFiles){
 const css=fs.readFileSync(file,'utf8');
 const rel=path.relative(path.join(root,'frontend/styles/system'),file).split(path.sep).join('/');
 assert(entry.includes(`${rel}?v=${hash(css)}`),`Panel feature must be imported and content addressed: ${path.relative(root,file)}`);
}
assert.equal(imports.length,3+panelFeatureFiles.length,'Panel graph must contain exactly the three system owners plus every scoped panel feature once');
assertPackaged(assert,['nexus-ui-v3.css','nexus-v3-foundation.css','nexus-v3-components.css','nexus-v3-layout.css']);

for(const material of ['solid','glass','raised']) assert(foundation.includes(`data-surface=${material}`),`Missing shared material ${material}`);
for(const option of ['density','borders','motion']) assert(foundation.includes(`data-${option}`),`Missing shared ${option} preference`);
for(const token of ['--nx-control-h','--nx-card-pad','--nx-page-gap','--nx-panel-bg','--nx-control-bg','--nx-dialog-bg','--nx-selected-bg'])
 assert(foundation.includes(token),`Missing common token ${token}`);
assert.match(foundation,/prefers-reduced-(?:motion|transparency)/,'System respects accessibility media preferences');
assert.match(components,/focus-visible/,'Shared controls expose visible keyboard focus');
assert.match(layout,/data-workspace/,'Width categories belong to shared layout');
assert.match(app,/data-workspace|dataset\.workspace/,'Route must explicitly declare its frame');
assert.match(app,/data-ui-collection/,'Collections must be explicit');
assert.doesNotMatch(app,/classifyMetrics|classifyCollections|classifyFrame/,'No DOM-inferred page geometry');
assert.doesNotMatch(layout,/\.appearance-layout|\.nodes-page|#stats-dashboard|\.sv-studio/,'Shared layout cannot own feature geometry');
assert.doesNotMatch(allCss,/display\s*:\s*contents/,'Workspace wrappers must retain their layout boxes');

for(const file of panelFeatureFiles){
 const css=fs.readFileSync(file,'utf8'),name=path.relative(root,file);
 assert.doesNotMatch(css,/\bhtml\s*\[data-surface\s*=/,`${name}: shared material variants may only be declared in foundation`);
 assert.doesNotMatch(css,/(?:^|[},])\s*(?:body\s+)?(?:\.app|\.wrap|\.view|#view|aside|\.top)\s*\{/m,`${name}: feature cannot own global shell`);
 assert.doesNotMatch(css,/(?:^|[;{])\s*(?:width|min-width|max-width|height|min-height|max-height|grid-template-columns|grid-area|flex-grow)\s*:[^;}]*!important/,`${name}: feature geometry must not escalate specificity`);
}
for(const file of ['frontend/styles/features/settings/settings.css','frontend/styles/features/nodes/nodes.css']){
 const css=read(file);
 assert.doesNotMatch(css,/\.(?:nodes-page|appearance-layout)\s*\{[^}]*min-height\s*:/,`${file}: pages must have content-driven height`);
 assert.doesNotMatch(css,/:nth-child\([^)]*\)\s*\{[^}]*grid-area\s*:/,`${file}: no placement by historical child index`);
}
assert.match(layout+'\n'+components,/100dvh/,'Dialog geometry must be viewport-bounded');
assert.match(layout+'\n'+components,/overflow\s*:\s*auto/,'Dialogs need an internal scroll container');
// data-psz is a presence-only attribute, so dataset.psz is an empty string.
assert.match(app,/t\.matches\('select\[data-psz\]'\)/,
 'User pagination must recognize a value-less data-psz attribute');
assert.doesNotMatch(app,/else if\(t\.dataset\.psz\)/,
 'Empty data attributes must not break change events');
assert.match(app,/\[15,30,60\]\.includes\(size\)/,
 'Only supported pagination sizes are accepted');
assert.match(app,/UQ\.size=size;\s*UQ\.page=1;\s*void drawUsers\(\)/,
 'Page-size changes reset page 1 and rerender');

const squadCards=read('frontend/styles/features/squads/squad-cards.css');
// Search is purely client-side and must not mutate the inventory or rebuild
// cards on every keystroke (their verified live statistics must remain stable).
assert.match(app,/function applySquadSearch\(root\)/,
 'Squad search must have its own scoped filter function');
assert.match(app,/data-squad-search-text/,
 'Squad cards need a precomputed search index');
assert.match(app,/const searchText=\[display,s\.desc\|\|'',\.\.\.tags\]/,
 'Squad search must cover names, descriptions and inbound tags');
assert.match(app,/card\.hidden=!visible/,
 'Search must toggle existing squad cards without remounting them');
assert.match(app,/input\?\.addEventListener\('input'/,
 'Squad search must react immediately to input');
assert.match(app,/data-squad-search-empty/,
 'Squad search must show a distinct empty-results state');
assert.match(app,/data-squad-search-clear/,
 'Squad search must provide a clear control');


assert.match(squadCards,/\.squad-card-grid\{[\s\S]*align-items:stretch/,
 'Squad cards must stretch inside each grid row');
assert.match(squadCards,/@supports \(grid-template-rows:subgrid\)/,
 'Squad cards must share semantic section tracks on modern browsers');
assert.match(squadCards,/grid-row:span 5;grid-template-rows:subgrid/,
 'Subgrid must align all five sections');
assert.doesNotMatch(squadCards,/\.squad-card-tags\{[^}]*overflow:hidden/,
 'Alignment must not hide inbound tags');

// Host directory uses the canonical feature styles and existing mutations.
const hostCss=read('frontend/styles/features/hosts/hosts.css');
assert.match(app,/hosts:\['Хосты',hostsP\]/,
 'Hosts must use the card directory, not the old CRUD table');
assert.match(app,/function hostCard\(host,index,total\)/,
 'Host card renderer must preserve record identity and original order');
assert.match(app,/ENT\.hosts\.cols\[4\]\[1\]\(host\)/,
 'Readiness must reuse the existing saved Host validator');
for(const action of ['data-ne="hosts:', 'data-host-copy=', 'data-host-duplicate=', 'data-mv="hosts:', 'data-tg="hosts:'])
 assert(app.includes(action),'Host cards must retain the working '+action+' control');
assert.match(app,/if\(k==='hosts'\)\{[\s\S]*await api\.update\('hosts',host\.id,\{disabled:!t\.checked\}\)/,
 'Host switch must persist to the backend and handle errors');
assert.match(hostCss,/\.host-card-grid\{[\s\S]*grid-template-columns:repeat\(auto-fill/,
 'Host cards must form a responsive compact grid');
assert.match(hostCss,/\.host-card-footer\{[\s\S]*margin-top:auto/,
 'Host actions must align at the bottom without empty vertical space');
assert.match(hostCss,/@media\(max-width:440px\)/,
 'Host cards must adapt to narrow mobile layouts');

console.log(`UI architecture: one content-addressed panel graph, three system owners, ${panelFeatureFiles.length} scoped panel features, explicit layout, and dialog safety: PASS`);
