#!/usr/bin/env node
'use strict';
// Cache keys describe file contents, including the dependency keys in CSS imports.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../frontend');
const check = process.argv.includes('--check');
const visited = new Set();
const changed = [];
const digest = content => crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
function refresh(file) {
  if (visited.has(file)) return fs.readFileSync(file, 'utf8');
  visited.add(file);
  const original = fs.readFileSync(file, 'utf8');
  const next = original.replace(/((?:href|src)=["']|url\(["']?)([^"')\s]+)(["']?\)?)/g, (whole, prefix, reference, suffix) => {
    if (/^(?:https?:|data:|#)/.test(reference)) return whole;
    const pathname = reference.split('?')[0];
    if (!/\.(?:css|js)$/.test(pathname)) return whole;
    const target = pathname.startsWith('/') ? path.join(root, pathname) : path.resolve(path.dirname(file), pathname);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) throw new Error(`Missing local asset: ${reference} in ${file}`);
    const content = pathname.endsWith('.css') ? refresh(target) : fs.readFileSync(target);
    return `${prefix}${pathname}?v=${digest(content)}${suffix}`;
  });
  if (next !== original) {
    changed.push(path.relative(root, file));
    if (!check) fs.writeFileSync(file, next);
  }
  return next;
}
refresh(path.join(root, 'index.html'));
refresh(path.join(root, 'login.html'));
if (check && changed.length) {
  console.error('Stale asset content keys:', changed.join(', '));
  process.exitCode = 1;
} else console.log(check ? 'Asset content keys: OK' : `Updated asset keys in ${changed.length} files`);
