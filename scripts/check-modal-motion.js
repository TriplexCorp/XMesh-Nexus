#!/usr/bin/env node
'use strict';
const {panelStyles}=require('./ci/frontend-source.cjs');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('frontend/js/core/app.js','utf8'),css=panelStyles(),html=fs.readFileSync('frontend/index.html','utf8');
const start=app.indexOf("if(k=='user'){"),end=app.indexOf("else if(k=='uedit')",start);
assert(start>=0&&end>start,'User create handler present');
const flow=app.slice(start,end);
assert.match(flow,/e\.preventDefault\(\)/,'Submit should not close before API completes');
assert.match(flow,/const c=await api\.create\('users',u\)/);
assert.match(flow,/dlg\.close\(\)/,'Successful creation closes form');
assert.match(flow,/location\.hash='users'/,'Successful creation navigates to users');
assert.match(flow,/'Открыть',\(\)=>userDrawer\(c\.id,'ov'\)/,
 'Details should open only if user clicks the success toast');
assert.doesNotMatch(flow,/setTimeout\([\s\S]*userDrawer/,'No automatic drawer after creating a user');
assert.match(flow,/f\.dataset\.creating='1'/,'Double-click prevention');
assert.match(flow,/catch\(error\)\{er\(/,'API errors should stay visible in form');
assert.match(app,/const modal=\(h,c=''\)=>/);
assert.match(app,/dlg\.showModal\(\)/,'Preserve native Escape/focus behavior');
assert.match(app,/typeof dlg\.firstElementChild\?\.animate==='function'/,'Animate replacement content');
assert.match(css,/#dlg\{[\s\S]*?overlay \.32s allow-discrete/,'Closing transition keeps top-layer');
assert.match(css,/#dlg\[open\]\{opacity:1;transform:/);
assert.match(css,/#dlg\[open\]::backdrop\{opacity:1\}/);
assert.match(css,/@starting-style\{/,'Opening animation must have starting style');
assert.match(css,/#dlg\.side\{--modal-off:translateX/,'Side drawer animates from edge');
assert.match(css,/html\[data-motion=off\] #dlg/);
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(html,/<script\s+src="\/js\/core\/js\/core\/app\.js\?v=[a-zA-Z0-9._-]+"\s*><\/script>/,
 'Application entrypoint must be loaded with a nonempty cache-busting version');
assert.match(html,/<style id="xmesh-legacy-compat">@import url\("\/styles\/legacy\/styles\/legacy\/styles\.css\?v=[a-zA-Z0-9._-]+"\) layer\(xmesh-legacy\);<\/style>/,
 'Legacy compatibility stylesheet must remain versioned and quarantined in its cascade layer');
assert.match(html,/<link\s+rel="stylesheet"\s+href="\/styles\/system\/styles\/system\/nexus-ui-v3\.css\?v=[a-f0-9]{12}"\s*\/?\s*>/,
 'Modern Design System entrypoint must remain the final versioned stylesheet');
console.log('User creation, dialog open/exit animations and accessibility controls: OK');
