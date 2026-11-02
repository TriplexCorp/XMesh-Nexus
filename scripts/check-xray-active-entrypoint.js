#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const {frontendAsset,assertPackaged,panelStyles}=require('./ci/frontend-source.cjs');
const assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const html=read('frontend/index.html'),app=read('frontend/js/core/app.js'),docker=read('backend/Dockerfile'),security=read('backend/src/security.rs');
const activeJs=['xray-studio-v4.js','xray-studio-tools.js','xray-studio-composer.js'];
for(const name of activeJs){
 assert(fs.existsSync(frontendAsset(name)),'Active XRAY STUDIO asset missing: '+name);
 assert.match(html,new RegExp(name.replaceAll('.', '\\.')+'\\?v=[a-f0-9]{12}'),'HTML does not load content-addressed active asset: '+name);
 assertPackaged(assert,[name]);
}
const activeCss='xray-studio-v4.css';
assert(fs.existsSync(frontendAsset(activeCss)),'Active XRAY STUDIO asset missing: '+activeCss);
assertPackaged(assert,[activeCss]);
assert.doesNotMatch(html,/<link[^>]+xray-studio-v4\.css/,
 'XRAY STUDIO CSS must stay behind the canonical panel stylesheet entrypoint');
assert.match(panelStyles(),/\.sv-studio\{/,
 'XRAY STUDIO CSS must be reachable from the canonical panel stylesheet graph');
assert(html.includes('src="/js/features/xray-studio/xray-studio-v4.js'),'Unexpected Studio entrypoint');
assert(html.indexOf('xray-studio-tools.js')<html.indexOf('xray-studio-v4.js'),'Tools must load before studio');
assert(html.indexOf('xray-studio-composer.js')<html.indexOf('xray-studio-v4.js'),'Composable config engine must load before Studio');
assert(app.includes('window.XMeshStudioV4.view()')&&app.includes('window.XMeshStudioV4.mount'),'App must mount V4');
assert(security.includes('"xray-studio-v4.js"')&&security.includes('"xray-studio-v4.css"'),'Dashboard alias must rewrite Studio assets');
for(const legacy of ['xray-studio-next.js','xray-studio-next.css']){
 assert(!html.includes(legacy),'Obsolete asset referenced by HTML: '+legacy);
 assert(!docker.includes(legacy),'Obsolete asset packaged: '+legacy);
 assert(!fs.existsSync(legacy),'Obsolete asset still exists: '+legacy);
}
const studio=read('frontend/js/features/xray-studio/xray-studio-v4.js');
assert(studio.includes('window.XMeshStudioV4='),'V4 export missing');
assert(studio.includes('data-xm="manual"'),'JSON Tools integration missing');
assert(!studio.includes('data-field="uuid"'),'Studio must not edit client UUID');
for(const name of activeJs)new Function(fs.readFileSync(frontendAsset(name),'utf8'));
console.log('XRAY STUDIO V4 asset entrypoint, canonical CSS graph, Docker packaging and mount chain: OK');
