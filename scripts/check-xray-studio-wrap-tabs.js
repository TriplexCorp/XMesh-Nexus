#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const js=fs.readFileSync('xray-studio-v4.js','utf8');
const css=fs.readFileSync('xray-studio-v4.css','utf8');
const html=fs.readFileSync('index.html','utf8');
new Function(js);
assert.match(js,/data-v="wrap" checked/,'soft wrap checkbox defaults to on');
assert.match(js,/root\.classList\.toggle\('sv-wrap',get\('wrap'\)\.checked\)/,'initial wrap class matches checkbox');
assert.match(js,/get\('wrap'\)\.addEventListener\('change'/,'user can turn wrapping off');
assert.match(js,/plus\.dataset\.docNew='true'/,'Add JSON action is wired');
assert.match(js,/if\(tabNew\)\{ev\.preventDefault\(\);newProfile\(\)/,'Add JSON creates document');
assert.match(css,/\.sv-studio \.sv-topbar>\.sv-page-tabs>button\.sv-json-document-add\{/,'add button wins against responsive tab flex');
assert.match(css,/flex:0 0 2\.75rem/,'add button does not shrink');
assert.match(css,/min-inline-size:2\.75rem/,'add button keeps square width');
assert.match(css,/min-block-size:2\.75rem/,'add button keeps square height');
assert.match(html,/xray-studio-v4\.css\?v=[A-Za-z0-9._-]+/,'CSS cache bust');
assert.match(html,/xray-studio-v4\.js\?v=[A-Za-z0-9._-]+/,'JS cache bust');
console.log('XRAY STUDIO wrap default and document add tab source checks: OK');
