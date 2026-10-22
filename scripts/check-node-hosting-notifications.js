#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = fs.readFileSync('app.js','utf8');
const css = fs.readFileSync('styles.css','utf8');
const backend = fs.readFileSync('backend/src/main.rs','utf8');
new Function(app);
assert.match(app, /nodes:\{t:'Узлы'[\s\S]*?\{k:'hosting',l:'Хостинг \(необязательно\)'/);
assert.match(app, /node\.hosting\?\.trim\(\)/);
assert.match(app, /nodeNotificationTitle=node=>flagView\(node\.flag,'notification-country-flag'\)/);
assert.match(app, /notifications\.map\(item=>/);
assert.match(app, /title:nodeNotificationTitle\(node\)/);
assert.doesNotMatch(app, /\(COUNTRIES\.find\(c=>c\.flag===x\.flag\)\?\.code\|\|'—'\)\+' · '\+x\.name/);
assert.match(css,/\.nt \.notification-country-flag\{/);
assert.match(css,/\.nc \.node-hosting\{/);
assert.match(backend,/object\.get\("hosting"\)/);
assert.match(backend,/value\.chars\(\)\.count\(\) > 100/);
// Render the actual notification formatter with a minimal flag/escape fixture.
const start=app.indexOf('const nodeNotificationTitle=');
const end=app.indexOf("\n$('#bell').onclick=",start);
assert(start>=0&&end>start);
const format=new Function('flagView','esc',app.slice(start,end)+';return nodeNotificationTitle;')(
 (flag,cls)=>'<img src="/flags/ru.svg" class="'+cls+'" alt="ru">',
 v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
);
const html=format({name:'RU · <Node>',flag:'🇷🇺',hosting:'Cloudrix <VPS>'});
assert(html.includes('/flags/ru.svg'));
assert(html.includes('Cloudrix &lt;VPS&gt;'));
assert(!html.includes('<VPS>'));
assert(html.includes('RU · &lt;Node&gt;'));
assert(!format({name:'No hosting',flag:'🇷🇺',hosting:''}).includes('<small>'));
console.log('Node hosting field, optional card label, offline flags, notification safety: OK');
