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
const hash=text=>crypto.createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex').slice(0,12);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const featureFiles=walk(path.join(root,'frontend/styles/features')).filter(name=>name.endsWith('.css'));
const allCss=panelStyles();

for(const retired of ['frontend/styles/legacy/styles.css','frontend/js/core/ui-builder.js','frontend/styles/system/nexus-v3-workspaces.css']){
  assert(!fs.existsSync(path.join(root,retired)),`Historical implementation must be removed: ${retired}`);
  assert(!html.includes(path.basename(retired)),`Historical implementation must not load: ${retired}`);
}
assert(!fs.existsSync(path.join(root,'scripts/ci/stage-frontend-compat.sh')),'Source checks must not synthesize old assets or mutate backend files');
assert.equal((html.match(/nexus-ui-v3\.css\?v=/g)||[]).length,1,'Panel has one presentation entrypoint');
assert(html.includes(`nexus-ui-v3.css?v=${hash(entry)}`),'Design-system cache key must match the content');
assert(html.includes(`app.js?v=${hash(app)}`),'Runtime cache key must match the content');
for(const name of ['nexus-v3-foundation.css','nexus-v3-components.css','nexus-v3-layout.css']){
 const css=read('frontend/styles/system/'+name);
 assert(entry.includes(`${name}?v=${hash(css)}`),`Imported system asset must be content addressed: ${name}`);
}
assert.equal((entry.match(/@import/g)||[]).length,3,'System owns foundation, components, and shared layouts only');
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

for(const file of featureFiles){
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
console.log(`UI architecture: canonical assets, three system owners, ${featureFiles.length} scoped feature stylesheets, explicit layout, and dialog safety: PASS`);
