#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');
const base=read('styles.css');
const studio=read('xray-studio.css');
const docker=read('backend/Dockerfile');
const links=[...html.matchAll(/href="([^"]*xray-studio[^"]*\.css(?:\?[^"]*)?)"/g)];
assert.equal(links.length,1,'Exactly one XRAY Studio stylesheet must be linked');
assert.match(links[0][1],/^xray-studio\.css(?:\?.*)?$/);
assert.equal((base.match(/\.xray-builder/g)||[]).length,0,'Global CSS must not duplicate Studio layout rules');
assert.match(docker,/COPY [^\n]*xray-studio\.css[^\n]* \/app\/static\//,'Studio CSS must ship in Docker');
assert.match(studio,/--sr-accent:var\(--a\)/,'Use the shared accent');
for(const variable of ['--bg','--s1','--s2','--ln','--tx','--mu','--ok']){
 assert.ok(studio.includes('var('+variable+')'),'Missing shared design token '+variable);
}
assert.match(studio,/html\[data-theme=light\]/,'Light theme integration missing');
assert.match(studio,/html\[data-density=compact\]/,'Density integration missing');
assert.match(studio,/html\[data-borders=off\]/,'Border setting integration missing');
assert.match(studio,/html body \.xray-builder\.studio-reference-v5:not\(\.manual-mode\) \[hidden\]\s*\{\s*display:none!important\s*\}/,'Semantic hidden must win over panel and toolbar display rules');
assert.match(studio,/\.xray-builder\.manual-mode\s*>\s*\.xray-config-tabs\s*\{\s*display:none!important\s*\}/,'Manual JSON must not show visual tabs');
assert.ok(!studio.includes('body:has(.studio-reference-v5) .top{display:none'),'Studio must not hide the global panel header');
assert.equal((studio.match(/\{/g)||[]).length,(studio.match(/\}/g)||[]).length,'CSS braces must balance');
console.log('XRAY Studio design integration: OK');
