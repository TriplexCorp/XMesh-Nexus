#!/usr/bin/env node
'use strict';
// Protect production builds from silent 404s on static CSS/JS assets.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const dockerfile=fs.readFileSync(path.join(root,'backend/Dockerfile'),'utf8');
const copies=dockerfile.split('\n').filter(line=>/^\s*COPY\s+/.test(line));
const files=new Set();
for(const line of copies){
  const parts=line.trim().split(/\s+/);
  const dest=parts[parts.length-1];
  if(dest!=='/app/static/' && dest!=='/app/static')continue;
  for(const file of parts.slice(1,-1))files.add(file);
}
const pages=['index.html','login.html'];
const errors=[];
for(const page of pages){
 const html=fs.readFileSync(path.join(root,page),'utf8');
 for(const match of html.matchAll(/(?:href|src)=["']([^"']+\.(?:css|js))(?:\?[^"']*)?["']/g)){
  const asset=match[1].replace(/^\/+/, '');
  if(!fs.existsSync(path.join(root,asset)))errors.push(page+': missing source '+asset);
  else if(!files.has(asset))errors.push(page+': asset not packaged in Docker: '+asset);
 }
}
if(errors.length){
 console.error(errors.join('\n'));
 process.exitCode=1;
}else{
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const tlsJs=fs.readFileSync(path.join(root,'xray-studio-tls-dialog.js'),'utf8');
 const tlsCss=fs.readFileSync(path.join(root,'xray-studio-tls-dialog.css'),'utf8');
 new Function(tlsJs);
 assert.match(index,/xray-studio-tls-dialog\.css\?v=20261101-tls-workspace-v2/,
   'TLS workspace stylesheet must receive a fresh cache key');
 assert.match(index,/xray-studio-tls-dialog\.js\?v=20261101-tls-workspace-v2/,
   'TLS workspace behavior must receive a fresh cache key');
 assert.match(index,/node-dialogs\.js\?v=20261101-agent-update-autovalidation-v1/,
   'Agent update autovalidation handler must receive a fresh cache key');
 assert.match(dockerfile,/xray-studio-tls-dialog\.css xray-studio-tls-dialog\.js/,
   'Production image must package the TLS editor assets');
 assert.match(tlsJs,/action!==['"]tls['"]&&action!==['"]hysteria['"]/,
   'TLS override must be narrowly scoped to TLS and quick-Hysteria actions');
 assert.match(tlsJs,/ev\.stopImmediatePropagation\(\)/,
   'Guided editor must intercept the historical raw-JSON TLS action');
 assert.match(tlsJs,/next\.alpn=\[['"]h3['"]\]/,
   'Hysteria TLS editor must enforce h3 ALPN');
 assert.match(tlsJs,/next\.minVersion=['"]1\.3['"];next\.maxVersion=['"]1\.3['"]/,
   'Hysteria TLS editor must enforce TLS 1.3');
 assert.match(tlsJs,/tlsSettings:\{alpn:\[['"]h3['"]\],minVersion:['"]1\.3['"],maxVersion:['"]1\.3['"],certificates:\[\]\}/,
   'New Hysteria profiles must start with TLS 1.3 / h3');
 assert.match(tlsJs,/current\.streamSettings\.security=['"]tls['"]/,
   'Applying guided TLS must explicitly preserve TLS security mode');
 assert.match(tlsJs,/const next=clone\(advanced\)/,
   'Advanced tlsSettings must be merged from the current JSON rather than rebuilt destructively');
 assert.match(tlsJs,/class="xm-tls-layout"/,
   'TLS editor must use the flat summary + settings workspace');
 assert.match(tlsJs,/class="xm-tls-summary"/,
   'TLS editor must expose a compact transport summary rail');
 assert.match(tlsCss,/\.xm-tls-dialog\{[\s\S]*width:min\(1120px/,
   'TLS dialog must use the wide workspace surface');
 assert.match(tlsCss,/\.xm-tls-layout\{display:grid;grid-template-columns:minmax\(220px,260px\) minmax\(0,1fr\)/,
   'Desktop TLS layout must keep summary and controls side by side');
 assert.doesNotMatch(tlsCss,/\.xm-tls-section\{/,
   'Legacy nested TLS section cards must not return');
 assert.match(tlsCss,/@media\(max-width:640px\)/,
   'TLS dialog must remain responsive on narrow screens');
 console.log('Static asset packaging + fresh Agent/TLS cache keys + flat guided TLS contract: OK.');
}
