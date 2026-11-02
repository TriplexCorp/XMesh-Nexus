#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

const loose=fs.readdirSync(root,{withFileTypes:true})
  .filter(entry=>(entry.isFile()||entry.isSymbolicLink())&&/\.(?:css|js|html)$/i.test(entry.name))
  .map(entry=>entry.name);
assert.deepEqual(loose,[],`Browser assets must live under frontend/, found at repo root: ${loose.join(', ')}`);

for(const stale of [
  'node-geodata-ui.js',
  'docs/.keep-p0e-final-assembler',
  'docs/P0E_FINAL_ASSEMBLER_READY',
  'docs/P0E_FINAL_ASSEMBLER_READY2',
  'scripts/.p0e-final-assembler-version',
  'scripts/README.p0e-final-assembler.txt',
  'scripts/check-button-radius.js',
  'scripts/check-sni-fallback-composer.js',
  'scripts/check-studio-profiles.js',
]){
  assert(!fs.existsSync(path.join(root,stale)),`Obsolete repository artifact must stay deleted: ${stale}`);
}

for(const required of [
  'frontend/index.html',
  'frontend/login.html',
  'frontend/styles/legacy/styles.css',
  'frontend/styles/system/nexus-ui-v3.css',
  'frontend/js/core/app.js',
  'frontend/js/features/xray-studio/xray-studio-v4.js',
  'docs/checkpoints/P0E_CHECKPOINT.md',
]) assert(fs.existsSync(path.join(root,required)),`Missing canonical repository path: ${required}`);

const docker=fs.readFileSync(path.join(root,'backend/Dockerfile'),'utf8');
assert.match(docker,/COPY frontend\/ \/app\/static\//,
  'Production image must package the canonical frontend tree directly');
assert(!/COPY\s+index\.html\s+styles\.css/.test(docker),
  'The historical flat static COPY list must not return');

console.log('Repository layout: canonical frontend tree, no loose browser assets, no known orphan markers: OK');
