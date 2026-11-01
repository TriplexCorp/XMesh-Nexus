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
 const xhttpExpert=fs.readFileSync(path.join(root,'xray-studio-xhttp-expert.js'),'utf8');
 new Function(tlsJs);
 new Function(xhttpExpert);
 assert.match(index,/xray-studio-tls-dialog\.css\?v=20261101-tls-horizontal-v3/,
   'TLS horizontal workspace stylesheet must receive a fresh cache key');
 assert.match(index,/xray-studio-tls-dialog\.js\?v=20261101-tls-workspace-v2/,
   'TLS workspace behavior cache key must remain stable when JS is unchanged');
 assert.match(index,/node-dialogs\.js\?v=20261101-agent-update-autovalidation-v1/,
   'Agent update autovalidation handler must receive a fresh cache key');
 assert.match(index,/xray-studio-xhttp-expert\.js\?v=20261101-core-schema-v2/,
   'Expert XHTTP editor must be cache-busted and loaded after the strict schema');
 assert.match(dockerfile,/xray-studio-xhttp-strict\.js xray-studio-xhttp-expert\.js xray-xhttp-core-validator\.js/,
   'Production image must package strict + expert XHTTP assets');
 assert.match(xhttpExpert,/Session ID/);
 assert.match(xhttpExpert,/sessionIDPlacement/);
 assert.match(xhttpExpert,/sessionIDTable/);
 assert.match(xhttpExpert,/sessionIDLength/);
 assert.match(xhttpExpert,/seqPlacement/);
 assert.match(xhttpExpert,/uplinkHTTPMethod/);
 assert.match(xhttpExpert,/uplinkDataPlacement/);
 assert.match(xhttpExpert,/uplinkChunkSize/);
 assert.match(xhttpExpert,/xPaddingKey/);
 assert.match(xhttpExpert,/xPaddingHeader/);
 assert.match(xhttpExpert,/serverMaxHeaderBytes/);
 assert.match(xhttpExpert,/noSSEHeader/);
 assert.match(xhttpExpert,/window\.addEventListener\(['"]click['"],[\s\S]*true\)/,
   'Expert XHTTP editor must intercept before the legacy document-capture menu');
 assert.match(xhttpExpert,/Client-only поля xmux\/downloadSettings\/noGRPCHeader\/scMinPostsIntervalMs блокируются/,
   'Server editor must keep client-only XHTTP knobs out of the guided UI');
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
   'TLS editor must retain the guided workspace wrapper');
 assert.match(tlsJs,/class="xm-tls-summary"/,
   'TLS editor must expose the transport summary strip');
 assert.match(tlsCss,/\.xm-tls-dialog\{[\s\S]*width:min\(1380px/,
   'TLS dialog must use the wide horizontal workspace surface');
 assert.match(tlsCss,/\.xm-tls-layout\{display:grid;grid-template-columns:1fr/,
   'TLS workspace must flow vertically only at the outer shell level');
 assert.match(tlsCss,/\.xm-tls-summary\{[\s\S]*grid-template-columns:minmax\(180px,.8fr\) minmax\(430px,2fr\) minmax\(310px,1.35fr\)/,
   'Desktop TLS summary must be a horizontal status strip');
 assert.match(tlsCss,/\.xm-tls-settings\{[\s\S]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,
   'Desktop TLS controls must be presented as three horizontal columns');
 assert.match(tlsCss,/\.xm-tls-advanced\{grid-column:1\/-1/,
   'Advanced JSON must occupy a dedicated full-width lower row');
 assert.doesNotMatch(tlsCss,/position:sticky;top:0[\s\S]*\.xm-tls-summary/,
   'TLS summary must not return as a sticky vertical sidebar');
 assert.match(tlsCss,/@media\(max-width:760px\)/,
   'TLS dialog must remain responsive on narrow screens');
 console.log('Static assets + expert XHTTP schema controls + horizontal TLS workspace: OK.');
}
