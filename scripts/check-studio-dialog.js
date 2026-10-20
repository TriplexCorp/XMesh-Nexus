#!/usr/bin/env node
'use strict';
// Regression guard for the fullscreen contextual editor. No duplicate fields:
// dialog moves the live panels and Xray JSON generation stays in app.js.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const app=read('app.js');
const dialog=read('xray-studio-dialog.js');
const css=read('xray-studio.css');
const html=read('index.html');
const docker=read('backend/Dockerfile');
new Function(dialog);
assert.match(html,/src="xray-studio-dialog\.js\?v=/,'Dialog script is not loaded');
assert.match(docker,/COPY [^\n]*xray-studio-dialog\.js[^\n]* \/app\/static\//,'Missing Docker runtime asset');
assert.match(dialog,/slot\.append\(panel\)/,'Live field elements must be moved, not copied');
assert.doesNotMatch(dialog,/cloneNode\s*\(/,'Cloning live fields would desynchronize generated JSON');
assert.match(dialog,/dialog\.showModal\(\)/,'Settings window must open as true modal');
assert.match(dialog,/xhttp\.dataset\.xhttpExpanded='true'/,'XHTTP fullscreen settings must show all options directly');
assert.match(dialog,/dialog\.addEventListener\('close'/,'Window must restore focus on close');
assert.match(dialog,/if\(button\.hidden\|\|sections\[key\]\.hidden\)return/,'Only compatible sections may be opened');
for(const name of ['basic','security','transport','encryption','client']){
 assert.ok(app.includes('id="xpb-config-'+name+'"'),'Missing source configuration section: '+name);
}
assert.match(css,/\.sr-studio-launch:is\(:hover,:focus-visible\)/,'Interactive launcher hover/focus missing');
assert.match(css,/\.sr-studio-dialog::backdrop/,'Full-screen dialog backdrop missing');
assert.match(css,/\.sr-studio-dialog\[open\]/,'Dialog open state missing');
assert.match(css,/\.sr-studio-dialog:not\(\[open\]\)/,'Closed dialog must remain hidden');
assert.match(css,/\.sr-studio-dialog\[data-active-panel="transport"\]/,'Transport settings overlay missing');
assert.match(css,/\.xray-workspace-layout\{\s*align-items:start!important/,'JSON and main editor must align at top');
assert.match(css,/width:min\(1700px,calc\(100vw - 72px\)\)!important/,'Dialog must leave a visible margin around the panel');
assert.match(css,/-webkit-backdrop-filter:blur\(12px\) saturate\(\.78\)!important/,'Modal must blur the underlying app');
assert.match(css,/\.studio-inline\.manual-mode\s*>\s*\.xray-workspace-layout/,'Manual JSON must use the same Studio shell');
assert.match(css,/\.studio-inline\.manual-mode\s+\.xray-custom-mode \.xray-output-head/,'Manual JSON must use shared editor header styling');
assert.match(css,/\.studio-inline\.manual-mode\s+\.xray-custom-code-view/,'Manual JSON code editor must retain its full-width design');
assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length,'Unbalanced CSS');
console.log('XRAY Studio modal settings integration: OK');
