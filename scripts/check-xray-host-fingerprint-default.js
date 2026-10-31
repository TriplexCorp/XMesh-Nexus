#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');

const hosts=fs.readFileSync('xray-studio-hosts.js','utf8');
const html=fs.readFileSync('index.html','utf8');

assert.match(hosts,/data-endpoint="fp"><option value="chrome">Chrome \(по умолчанию\)<\/option>/,
  'Fingerprint selector must default to chrome');
assert.match(hosts,/set\('fp',h\?\.fp\|\|'chrome'\)/,
  'New and legacy endpoints without fp must open as chrome');
assert.match(hosts,/fp:value\('fp'\)\|\|'chrome'/,
  'Saving an endpoint without explicit fingerprint must persist chrome');
assert.match(html,/xray-studio-hosts\.js\?v=20261031-fingerprint-chrome-default/,
  'Dashboard must bust the hosts asset cache for the fingerprint fix');

console.log('XRAY STUDIO host fingerprint default: chrome OK');
