#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const html=read('index.html'),app=read('app.js'),docker=read('backend/Dockerfile'),security=read('backend/src/security.rs');
const active=['xray-studio-v4.js','xray-studio-v4.css','xray-studio-tools.js'];
for(const name of active){
 assert(fs.existsSync(name),'Active XRAY STUDIO asset missing: '+name);
 assert(html.includes(name+'?v='),'HTML does not load active asset: '+name);
 assert(docker.includes(name),'Docker does not package active asset: '+name);
}
assert(html.includes('src="/xray-studio-v4.js'),'Unexpected Studio entrypoint');
assert(html.includes('href="xray-studio-v4.css'),'Unexpected Studio stylesheet');
assert(html.indexOf('xray-studio-tools.js')<html.indexOf('xray-studio-v4.js'),'Tools must load before studio');
assert(app.includes('window.XMeshStudioV4.view()')&&app.includes('window.XMeshStudioV4.mount'),'App must mount V4');
assert(security.includes('"xray-studio-v4.js"')&&security.includes('"xray-studio-v4.css"'),'Dashboard alias must rewrite Studio assets');
for(const legacy of ['xray-studio-next.js','xray-studio-next.css']){
 assert(!html.includes(legacy),'Obsolete asset referenced by HTML: '+legacy);
 assert(!docker.includes(legacy),'Obsolete asset packaged: '+legacy);
 assert(!fs.existsSync(legacy),'Obsolete asset still exists: '+legacy);
}
const studio=read('xray-studio-v4.js');
assert(studio.includes('window.XMeshStudioV4='),'V4 export missing');
assert(studio.includes('data-xm="manual"'),'JSON Tools integration missing');
assert(!studio.includes('data-field="uuid"'),'Studio must not edit client UUID');
for(const name of ['xray-studio-v4.js','xray-studio-tools.js'])new Function(read(name));
console.log('XRAY STUDIO V4 asset entrypoint, Docker packaging and mount chain: OK');
