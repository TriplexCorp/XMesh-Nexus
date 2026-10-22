#!/usr/bin/env node
'use strict';
// Regression guard: Appearance > Corner radius must control actionable buttons
// across the sidebar, top toolbar, user dialogs, and XRAY STUDIO.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const cssFiles=['styles.css','xray-studio-v4.css','subscription-studio.css'];
const css=Object.fromEntries(cssFiles.map(file=>[file,fs.readFileSync(file,'utf8')]));

assert((app.match(/setProperty\('--ui-control-radius'/g)||[]).length>=2,
 'Appearance radius must update during both full apply and lightweight preview');
assert.match(css['styles.css'],/button\{cursor:pointer;background:none;border:0;border-radius:var\(--ui-control-radius\)\}/,
 'Buttons without component overrides must inherit the configured radius');
const header=html.match(/<header\b[\s\S]*?<\/header>/)?.[0]||'';
const sidebar=html.match(/<aside\b[\s\S]*?<\/aside>/)?.[0]||'';
assert.match(header,/id="addb"/,'New User action belongs in the header');
assert.doesNotMatch(header,/id="logout"/,'Logout must not be adjacent to New User');
assert.match(sidebar,/id="logout"/,'Logout belongs to the account sidebar');

const rulePattern=/([^{}]+)\{([^{}]*)\}/g;
const controls=[
'nav a,nav .more',
'.app>aside nav a,.app>aside nav .more',
'aside #logout',
'.nodes-toolbar .node-create-action',
'.top #addb',
'.top .tl>.ib,.top .tl>#addb',
'dialog.user-modal .user-save-button',
'dialog.user-modal .user-cal-nav button',
'.sv-tabs button',
'.sv-studio button'
];
const found=new Set();
for(const [file,contents] of Object.entries(css)){
 for(const match of contents.matchAll(rulePattern)){
   const selector=match[1].split('*/').pop().trim().replace(/\s+/g,' ');
   const value=match[2].match(/\bborder-radius\s*:\s*([^;}\n]+)/)?.[1]?.trim();
   if(!value)continue;
   if(controls.includes(selector)&&value.includes('var(--ui-control-radius)'))found.add(selector);
   // Circular color pickers and swatches are intentionally not action-button shapes.
   if(/\.swt button|\.color-bubble|\.palette-swatch/.test(selector))continue;
   const actionable=/\bbutton\b|\.ia\b|\.ib\b|\.more\b|\.node-create-action|#addb|#logout|\.user-id-copy|\.user-stats-refresh/.test(selector);
   if(actionable)assert(/var\(--ui-control-radius\)|inherit/.test(value),
     file+': hardcoded radius '+value+' for '+selector);
 }
}
for(const selector of controls.filter(x=>!x.startsWith('.sv-')))assert(found.has(selector),'Missing shared button radius: '+selector);
assert.match(css['xray-studio-v4.css'],/--vround:var\(--ui-control-radius/,'Studio v4 controls must inherit the shared radius');
console.log('Button-radius consistency checks passed');
