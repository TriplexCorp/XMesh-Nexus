#!/usr/bin/env node
'use strict';
// Prevent service-specific copy from being shipped in the general-purpose panel.
// No prohibited full names or slogans are present as literals.
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const markers = [
  ['si', 'len', 'tium'].join(''),
  ['си', 'лен', 'тиум'].join(''),
  ['всё', ' просто', ' работает'].join(''),
  ['все', ' просто', ' работает'].join('')
];
const files = execFileSync('git', ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
const violations = [];
for (const path of files) {
  const name = path.toLocaleLowerCase('ru-RU');
  const stat = fs.lstatSync(path);
  const content = stat.isSymbolicLink()
    ? ''
    : fs.readFileSync(path).toString('utf8').toLocaleLowerCase('ru-RU');
  if (markers.some(marker => name.includes(marker) || content.includes(marker))) violations.push(path);
}
assert.deepEqual(violations, [], 'Unexpected provider-specific branding in tracked files: '+violations.join(', '));
const studio = fs.readFileSync('subscription-studio.js', 'utf8');
assert.match(studio, /placeholder:'Название вашего сервиса'/,
  'Portal must ship with a vendor-neutral name placeholder');
assert.match(studio, /subscriptionBrand:''/,
  'Portal must ship without a hard-coded provider name');
assert.match(studio, /subscriptionDescription:'Настройки подключения и информация о подписке\.'/,
  'Portal must ship with a vendor-neutral description');
console.log('Public repository white-label and generic subscription portal defaults: OK');
