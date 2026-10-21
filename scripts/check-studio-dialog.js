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
assert.doesNotMatch(css,/\.sr-studio-dialog:not\(\[open\]\)\{\s*display:none!important/,
 'Forced immediate display:none would prevent the closing transition');
assert.match(css,/\.sr-studio-dialog\[open\]/,'Open state must remain present');
assert.match(css,/display \.32s allow-discrete,overlay \.32s allow-discrete/,
 'Closing window must keep its native display/top-layer until transition ends');
assert.match(css,/@starting-style\{/,'Opening must be animated consistently');
assert.match(css,/html\[data-motion=off\] \.sr-studio-dialog/,'Respect appearance motion toggle');
assert.match(css,/\.sr-studio-dialog\[data-active-panel="transport"\]/,'Transport settings overlay missing');
// Both sides share one auto-sized grid row on wide screens.
const equalHeightBlock=css.match(/\.studio-drawer-layout:not\(\.manual-mode\) \.xray-workspace-layout\{([^}]+)\}/);
assert(equalHeightBlock&&/align-items:stretch!important/.test(equalHeightBlock[1]),'Editor and JSON must stretch to the same row height');
const dockBlock=css.match(/\.studio-drawer-layout:not\(\.manual-mode\) \.xray-output-dock\{([^}]+)\}/);
assert(dockBlock&&/align-self:stretch!important/.test(dockBlock[1])&&/height:100%!important/.test(dockBlock[1]),'JSON panel must reach the editor bottom');
assert.match(css,/\.studio-drawer-layout:not\(\.manual-mode\):not\(\.sr-v5-expanded\) \.xray-code-view\{\s*height:100%!important/,'Code viewport must fill remaining available panel height');
assert.match(css,/@media\(max-width:1250px\)\{\s*\.xray-builder\.studio-reference-v5\.studio-inline\.studio-drawer-layout:not\(\.manual-mode\) \.xray-workspace-layout\{\s*grid-template-columns:minmax\(0,1fr\)!important;\s*align-items:start!important;/,'Stacked mobile layout must keep natural card heights');
assert.match(css,/width:min\(1700px,calc\(100vw - 72px\)\)!important/,'Dialog must leave a visible margin around the panel');
assert.match(css,/-webkit-backdrop-filter:blur\(12px\) saturate\(\.78\)!important/,'Modal must blur the underlying app');
assert.match(css,/\.studio-inline\.manual-mode\s*>\s*\.xray-workspace-layout/,'Manual JSON must use the same Studio shell');
assert.match(css,/\.studio-inline\.manual-mode\s+\.xray-custom-mode \.xray-output-head/,'Manual JSON must use shared editor header styling');
assert.match(css,/\.studio-inline\.manual-mode\s+\.xray-custom-code-view/,'Manual JSON code editor must retain its full-width design');
assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length,'Unbalanced CSS');
console.log('XRAY Studio modal settings integration: OK');
