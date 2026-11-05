'use strict';
const fs=require('node:fs'),path=require('node:path');
const acorn=require('../browser/node_modules/acorn');
function runtime(){const window={},document={readyState:'loading',addEventListener(){},documentElement:{lang:'ru'}};new Function('window','localStorage','document',fs.readFileSync('frontend/js/core/i18n.js','utf8'))(window,{getItem(){return'en'},setItem(){}},document);return window.XMeshI18n}
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const decode=s=>s.replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g,v=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[v]));
function candidates(){const found=new Map();
 const take=(s,file)=>{s=decode(s).replace(/\s+/g,' ').trim();if(!/[А-Яа-яЁё]/u.test(s))return;const sources=found.get(s)||new Set();sources.add(file);found.set(s,sources)};
 const literal=(value,file)=>{
  if(!/[А-Яа-яЁё]/u.test(value))return;
  if(!/[<>]|(?:aria-label|aria-description|placeholder|title|alt|data-l|data-rail-tip)\s*=/.test(value)){take(value,file);return}
  for(const m of value.matchAll(/(?:placeholder|title|aria-label|aria-description|alt|data-l|data-rail-tip)\s*=\s*(["'])([^"']*)(?:\1|$)/g))take(m[2],file);
  for(let text of value.replace(/<[^>]*(?:>|$)/g,'\n').split('\n')){
   if(text.includes('>'))text=text.slice(text.lastIndexOf('>')+1);
   if(/[-a-z]+\s*=/.test(text))continue;
   take(text,file);
  }
 };

 for(const file of walk('frontend').filter(f=>/\.(?:js|html)$/.test(f)&&!/(?:^|\/)i18n(?:-consistency)?\.js$/.test(f))){const source=fs.readFileSync(file,'utf8');if(/(?:DateTimeFormat|toLocale(?:Date|Time)?String)\(['"]ru-RU['"]/.test(source))throw Error(file+': display dates must use the selected panel locale');if(file.endsWith('.html')){literal(source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),file);continue}const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'script'});const visit=node=>{if(!node||typeof node!=='object')return;if(node.type==='Literal'&&typeof node.value==='string')literal(node.value,file);if(node.type==='TemplateElement')literal(node.value.cooked||node.value.raw,file);for(const [key,value]of Object.entries(node)){if(key==='value'&&node.type==='Literal')continue;if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value)}};visit(ast)}
 // CSS-generated labels are visible interface copy too.
 for(const file of walk('frontend').filter(f=>f.endsWith('.css'))){
  const source=fs.readFileSync(file,'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  for(const match of source.matchAll(/content\s*:\s*(["'])([^"']*)\1/g))take(match[2],file);
 }
 // Backend error strings can be shown by panel toasts and validation forms.
 for(const file of walk('backend/src').filter(f=>f.endsWith('.rs'))){
  const source=fs.readFileSync(file,'utf8');
  for(const match of source.matchAll(/"([^"\\\n]*(?:\\.[^"\\\n]*)*)"/g)){
   if(!/[А-Яа-яЁё]/u.test(match[1]))continue;
   try{literal(JSON.parse('"'+match[1]+'"'),file)}catch{/* Non-JSON Rust escapes are not UI string literals. */}
  }
 }
 return found;
}
module.exports={runtime,candidates};
