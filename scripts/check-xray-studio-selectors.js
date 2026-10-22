'use strict';

const fs = require('node:fs');
const path = require('node:path');

const appPath = path.join(__dirname, '..', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');
const lines = source.split(/\r?\n/);
const issues = [];

// A single-element query ($) must not be used like a collection.
// node --check validates syntax, but cannot detect this runtime error.
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  if (/(^|[^$])\$\([^)]*\)\.(?:forEach|some|map|filter)\s*\(/.test(line)) {
    issues.push('app.js:' + (index + 1) + ': single-element selector used with a collection method');
  }
  if (/\${3,}\s*\(/.test(line)) {
    issues.push('app.js:' + (index + 1) + ': malformed selector prefix (three or more dollar signs)');
  }
}

// Keep the primary transport step and panel from disappearing in refactors.
const studioSource = fs.readFileSync(path.join(__dirname, '..', 'xray-studio-v4.js'), 'utf8');
const requiredFragments = [
  ['transport selection', "select('transport','Транспорт'"],
  ['active Studio editor', 'data-v="source"'],
  ['security selection', "select('security','Защита'"],
];
for (const [label, fragment] of requiredFragments) {
  if (!studioSource.includes(fragment)) issues.push('xray-studio-v4.js: required ' + label + ' marker is missing');
}

if (issues.length) {
  console.error('XRAY Studio selector audit failed:');
  for (const issue of issues) console.error(' - ' + issue);
  process.exitCode = 1;
} else {
  console.log('XRAY Studio selector audit passed.');
}
