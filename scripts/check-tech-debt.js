#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const server=fs.readFileSync('backend/src/main.rs','utf8');
new Function(app);

// Dead compatibility logic must not silently return or delete user data.
assert.doesNotMatch(app,/\blegacyDemo\b/);
assert.doesNotMatch(app,/localStorage\.removeItem\('xmeshNexusDB'\)/);
assert.doesNotMatch(app,/\b_legacy\b/);

// The former bearer credential UI has become Ed25519 enrollment.
assert.doesNotMatch(app,/data-metrics-token|dataset\.metricsToken/);
assert.match(app,/data-node-metrics/);
assert.match(app,/dataset\.nodeMetrics/);
assert.match(app,/\/api\/v1\/nodes\/.*metrics-key/);
assert.doesNotMatch(server,/create_node_metrics_token|\/nodes\/\{id\}\/metrics-token/);

// No externally hosted flag assets: all countries use local same-origin SVG.
assert.doesNotMatch(app,/flagcdn\.com/);
assert.match(app,/\/flags\/\$\{country\.code\.toLowerCase\(\)\}\.svg/);

// The new-node action must respond to the global UI radius slider.
const selector=css.match(/\.nodes-toolbar \.node-create-action\{([^}]*)\}/s);
assert(selector,'Missing primary node action rule');
assert.match(selector[1],/border-radius:\s*var\(--ui-control-radius\);/);

// Compatibility preserved on purpose: historic Xray configuration data may
// contain clients instead of users; database migrations must remain stable.
assert.match(app,/Array\.isArray\(inbound\.settings\.clients\)/);
assert.match(server,/sqlx::migrate!/);
console.log('Technical debt invariants: no retired UI routes, no destructive demo heuristic, local flags, shared CSS radius; safe migrations retained.');
