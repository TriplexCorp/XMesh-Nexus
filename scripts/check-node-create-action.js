#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const html=fs.readFileSync('index.html','utf8');

assert.match(app, /<div class="bar2 nodes-toolbar"><p class="note">/,
 'Node list toolbar must be scoped to nodes page');
assert.match(app, /<button type="button" class="node-create-action" data-ne="nodes" aria-label="Добавить новый узел"><span class="node-create-icon" aria-hidden="true">/ ,
 'New Node button must retain its existing creation handler and accessible label');
assert.match(app, /<span class="node-create-label">Новый узел<\/span>/,
 'Node primary action must have clear visible text');
assert.doesNotMatch(app, /<button class="btn" data-ne="nodes">\$\{ic\('plus'\)\}Узел<\/button>/,
 'Old generic add-node button must not be rendered');
assert.match(app, /else if\(b=g\('\[data-ne\]'\)\)\{const \[k,id\]=b\.dataset\.ne\.split\(':'\);entForm\(k,id\)\}/,
 'Click must still open the existing node-creation dialog');
for(const selector of [
 '.nodes-toolbar .node-create-action{',
 '.nodes-toolbar .node-create-icon{',
 '.nodes-toolbar .node-create-label{',
 '.nodes-toolbar .node-create-action:hover{',
 '.nodes-toolbar .node-create-action:focus-visible{'
])assert(css.includes(selector),'Missing action styling: '+selector);
assert.match(css, /\.nodes-toolbar \.node-create-icon\{[^}]*background:var\(--a\);[^}]*color:var\(--btn-text\);/s,
 'Icon must follow the active accent theme');
assert.match(css, /\.nodes-toolbar \.node-create-action\{[^}]*background:color-mix\(in srgb,var\(--a\) 9%,var\(--elevated\)\);/s,
 'Action must follow the selected theme surface');
assert.match(css, /@media\(max-width:390px\)\{\s*\.nodes-toolbar \.node-create-action\{width:100%;margin-left:0\}/,
 'New Node button must fit narrow phones');
assert.match(html,/styles\.css\?v=[a-z0-9-]+/,'Update CSS cache');
assert.match(html,/app\.js\?v=[a-z0-9-]+/,'Update JS cache');
assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length,'CSS braces must remain balanced');
new Function(app);
console.log('Node action: visuals, responsive styling and create handler OK');
