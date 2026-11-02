'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

function frontendAsset(name) {
  const matches = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name === name) matches.push(file);
    }
  };
  visit(path.join(root, 'frontend'));
  if (matches.length !== 1) throw new Error(`Expected one canonical frontend asset ${name}; found ${matches.length}`);
  return matches[0];
}

// Read the actual stylesheet graph used by the panel. No rewritten HTML, root
// aliases, old declarations, or synthetic Docker COPY statements are involved.
function panelStyles() {
  const entry = path.join(root, 'frontend/index.html');
  const html = fs.readFileSync(entry, 'utf8');
  const seen = new Set();
  const readCss = file => {
    const resolved = path.resolve(file);
    if (seen.has(resolved)) return '';
    if (!resolved.startsWith(path.join(root, 'frontend') + path.sep)) throw new Error('Stylesheet escapes frontend');
    seen.add(resolved);
    const css = fs.readFileSync(resolved, 'utf8');
    const imports = [...css.matchAll(/@import\s+url\(["']?([^"')]+)["']?\)/g)]
      .map(match => readCss(path.resolve(path.dirname(resolved), match[1].split('?')[0])));
    return [...imports, css].join('\n');
  };
  return [...html.matchAll(/<link\b[^>]*href=["'](\/styles\/[^"']+\.css)(?:\?[^"']*)?["'][^>]*>/g)]
    .map(match => readCss(path.join(root, 'frontend', match[1]))).join('\n');
}

function assertPackaged(assert, names) {
  const docker = fs.readFileSync(path.join(root, 'backend/Dockerfile'), 'utf8');
  assert.match(docker, /COPY frontend\/ \/app\/static\//, 'Production must package the canonical frontend tree');
  for (const name of names) assert.ok(fs.statSync(frontendAsset(name)).isFile(), `Missing packaged asset ${name}`);
}

module.exports = {root, frontendAsset, panelStyles, assertPackaged};
