#!/usr/bin/env node
'use strict';
const {assertPackaged,panelStyles}=require('./ci/frontend-source.cjs');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const js=fs.readFileSync('frontend/js/features/users/user-create-policy-v6.js','utf8');
const html=fs.readFileSync('frontend/index.html','utf8');
const css=panelStyles();
new Function(js);

assert.match(html,/\/js\/features\/users\/user-create-policy-v6\.js\?v=[a-f0-9]{12}/,
 'Policy calendar JS must use a content-addressed cache key');
assert.ok(html.indexOf('/js/features/nodes/node-dialogs.js?v=')<html.indexOf('/js/features/users/user-create-policy-v6.js?v='),
 'Policy enhancement must load after the base create-user dialog');
assertPackaged(assert,['user-create-policy-v6.js']);

assert.match(js,/window\.userNew=function userNewPolicyCalendarV6/,
 'Create-user calendar must enhance the existing dialog instead of replacing submission logic');
assert.match(js,/type="hidden" name="days"/,
 'Calendar UI must preserve the existing backend days field');
assert.match(js,/\['0','∞'\],\['7','7 дней'\],\['30','30 дней'\],\['90','90 дней'\],\['180','180 дней'\]/,
 'Duration control must offer safe quick presets');
assert.match(js,/data-user-create-date=/,
 'Calendar must support exact date selection');
assert.match(js,/Срок начнётся с первого подключения/,
 'On-hold mode must explain duration semantics');
assert.match(js,/Math\.max\(1,Math\.round\(serial\(target\)-serial\(today\(\)\)\)\)/,
 'Selected calendar dates must translate back into the existing integer-day contract');

// CSS ownership moved into the canonical user-editor feature owner. Read the
// complete panel graph so this test protects behavior without reviving deleted
// user-create-policy-v6.css / user-create-extra-v7.css compatibility layers.
assert.match(css,/#dlg\.user-create-modal\{/,
 'User editor styles must be wired into the canonical panel CSS graph');
assert.match(css,/\.user-create-limits-grid\{[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
 'Policy controls must retain a balanced two-column desktop grid');
assert.match(css,/\.user-create-limits-grid>\.user-create-field\{[\s\S]*grid-template-rows:auto 3rem minmax\(1\.1rem,auto\)/,
 'Policy fields must share aligned label/control/help rows');
assert.match(css,/input\[type=number\]::-webkit-inner-spin-button/,
 'Native Chromium number spinners must be suppressed');
assert.match(css,/appearance:textfield/,
 'Native numeric controls must use the Nexus surface instead of browser spinner chrome');
assert.match(css,/\.user-create-duration-calendar\{/,
 'Duration picker must render as a dedicated calendar popover');
assert.match(css,/\.user-create-cal-day\.is-selected/,
 'Selected calendar date must have an explicit state');
assert.match(css,/\.user-create-section-extra\{container-type:inline-size;container-name:nx-user-extra\}/,
 'Metadata section must own container-responsive layout');
assert.match(css,/@container nx-user-extra \(min-width:44rem\)/,
 'Metadata must reflow into two columns at medium widths');
assert.match(css,/grid-template-areas:"squads squads" "tag hold" "desc desc"/,
 'Long squad lists and notes should receive full-row width on medium layouts');
assert.match(css,/#dlg\.user-create-modal \.user-create-hold \.sw>span\{[\s\S]*width:2\.8rem;[\s\S]*height:1\.6rem/,
 'The toggle track must remain compact inside the adaptive on-hold row');
assert.match(css,/#dlg\.user-create-modal \.user-create-desc textarea\{[^}]*min-height:5\.2rem;[^}]*resize:vertical;[^}]*overflow-x:hidden;/,
 'Notes must have usable height, vertical resize and no horizontal overflow');
assert.doesNotMatch(css,/\.user-create-(?:limits|duration|extra|hold|desc)[^{]*\{[^}]*!important/,
 'User editor geometry must not depend on legacy !important overrides');

console.log('Create-user policy calendar + canonical user-editor CSS contract: OK');
