#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const qrSource=fs.readFileSync('qr-code.js','utf8');
const qrcodegen=new Function(qrSource+';return qrcodegen;')();
const sample='https://free-tier.shop/subscription/0123456789abcdef0123456789abcdef';
const qr=qrcodegen.QrCode.encodeText(sample,qrcodegen.QrCode.Ecc.MEDIUM);
assert(qr.size>=21&&qr.getModule(0,0),'Bundled encoder must encode a realistic subscription URL');
const portal=fs.readFileSync('subscription-portal.js','utf8');
assert.match(portal,/window\.qrcodegen\?\.QrCode/,'Subscription portal must use the bundled qrcodegen global');
assert.doesNotMatch(portal,/window\.qrgen\?\.QrCode/,'Broken qrgen alias must not return');
assert.match(portal,/const quiet = 4/,'Subscription QR must include a four-module quiet zone');
assert.match(portal,/x \+ quiet/);
assert.match(portal,/y \+ quiet/);
const template=fs.readFileSync('backend/src/subscription_template.html','utf8');
assert.match(template,/subscription-portal\.js\?v=20261101-qr-fix-v1/,'Public portal must cache-bust the repaired QR code');
console.log('Subscription QR encoder/global/quiet-zone contract: OK');
