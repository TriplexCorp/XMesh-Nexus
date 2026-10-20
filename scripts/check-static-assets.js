#!/usr/bin/env node
'use strict';
// Protect production builds from silent 404s on static CSS/JS assets.
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
  const asset=match[1];
  if(!fs.existsSync(path.join(root,asset)))errors.push(page+': missing source '+asset);
  else if(!files.has(asset))errors.push(page+': asset not packaged in Docker: '+asset);
 }
}
if(errors.length){
 console.error(errors.join('\n'));
 process.exitCode=1;
}else{
 console.log('Static asset packaging: OK (every HTML CSS/JS reference exists in the Docker runtime).');
}
