#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync('xray-json-diagnostics.js','utf8');
const css=fs.readFileSync('xray-studio.css','utf8');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const dock=fs.readFileSync('backend/Dockerfile','utf8');
new Function(src);
const host={};
new Function('window',src)(host);
const editor=host.XrayJsonDiagnostics;
assert(editor,'Diagnostics must be exported');
function apply(source,fix){
 return source.slice(0,fix.start)+fix.replacement+source.slice(fix.end);
}
function fixCase(text,label){
 const problem=editor.inspect(text);
 assert(problem,'Expected validation error');
 assert(problem.fix,'Expected safe Hot Fix, got: '+problem.message);
 assert.match(problem.fix.label,new RegExp(label));
 const patched=apply(text,problem.fix);
 assert.equal(editor.inspect(patched),null,'One-click fix must yield a usable config: '+patched);
}
fixCase('{\n "inbounds":[{"protocol":"vless",}]\n}', 'лишнюю запятую');

fixCase('{\\n  "log": {"loglevel": "warning"},\\n  "inbounds": [\\n    {\\n      "tag": "vless-reality",\\n      "protocol": "vless",,\\n      "settings": {"users": [], "decryption": "none"}\\n    }\\n  ]\\n}', 'лишнюю запятую');
fixCase('{"inbounds":[{"protocol":"vless",   , "tag":"x"}]}', 'лишнюю запятую');
fixCase('{"inbounds":[{"protocol":"vless"}],, "log":{}}', 'лишнюю запятую');
assert.equal(editor.inspect('{"inbounds":[{"protocol":"vless","tag":",,"}]}'),null,'Do not treat commas inside strings as syntax errors');
assert.match(src,/Безопасное автоисправление не найдено/,'Explain why Hot Fix is hidden when the fix is ambiguous');

fixCase('{\n "inbounds" [{"protocol":"vless"}]\n}', 'двоеточие');
fixCase('{\n "inbounds":[{"protocol":"vless"}]\n "log":{"loglevel":"warning"}\n}', 'запятую');
const invalid=editor.inspect('{\n "inbounds":[\n   {\'protocol\':\'vless\'}\n ]\n}');
assert.equal(invalid.line,3);
assert.equal(invalid.fix,null,'Single-quoted JSON must not be blindly rewritten');
const structural=editor.inspect('{\n "inbounds":[]\n}');
assert.equal(structural.kind,'structure');
assert.equal(structural.line,2);
assert(!structural.fix,'Do not create an arbitrary inbound for the user');
assert.equal(editor.inspect('{"inbounds":[{"protocol":"vless"}]}'),null);
assert.equal(editor.inspect('{"inbounds":[]}').line,1);
assert.equal(editor.point('{\n "inbounds":[],\n "log":{}}',18).line,3);
assert.match(editor.decorateRun('<img src=x>',0,'jx-string',{
 start:0,end:1,message:'<script>alert(1)</script>'
}),/&lt;script&gt;/,'Error tooltips must escape untrusted source');
assert.doesNotMatch(editor.decorateRun('<img src=x>',0,'jx-string',null),/<img/,'Editor tokens must escape markup');
assert.match(app,/XrayJsonDiagnostics\?\.attach\(customArea\)/,'Builder must attach diagnostics');
assert.match(app,/jsonDiagnostics\.decorateRun/,'Builder must paint inline squiggles in syntax layer');
assert.match(app,/jsonDiagnostics\?\.update\(issue\)/,'Builder must update live validation status');
assert.match(src,/setRangeText\(proposal\.replacement,proposal\.start,proposal\.end,'end'\)/,'Hot Fix must edit only affected range');
assert.match(src,/textarea\.dispatchEvent\(new Event\('input'/,'Hot Fix must notify existing validators and JSON state');
assert.match(src,/Math\.floor\(\(scroll-topPad\)\/lineHeight\)/,'Line gutter must use virtualized visible lines');
assert.match(src,/textarea\.addEventListener\('scroll'/,'Line numbers should scroll with the editor');
assert.match(css,/text-decoration-style:wavy!important/,'Error must have a wavy underline');
assert.match(css,/\.sr-json-gutter-number\.is-error/,'Error line number must be marked');
assert.match(css,/grid-template-rows:auto auto minmax\(0,1fr\) auto!important/,'Diagnostic bar needs its own row');
assert.match(html,/<script src="xray-json-diagnostics\.js[^"]*"><\/script>\s*<script src="app\.js/,'Diagnostics must load before the editor');
assert.match(dock,/COPY [^\n]*xray-json-diagnostics\.js[^\n]* \/app\/static\//,'Docker image must include diagnostics');
console.log('Manual JSON line validation / gutter / Hot Fix: OK');
