#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const source=fs.readFileSync('app.js','utf8');
const ui=fs.readFileSync('xray-studio-v5.js','utf8');
const css=fs.readFileSync('xray-studio.css','utf8');
const start=source.indexOf('const XRAY_TRANSPORT_SUPPORT=');
const end=source.indexOf('function validateXDriveTemplate(',start);
assert(start>=0&&end>start,'Capability model must exist');
const model=new Function(source.slice(start,end)+';return {xrayAllowedNetworks,xrayAllowedSecurity};')();
const networks=model.xrayAllowedNetworks;
const security=model.xrayAllowedSecurity;
assert(networks('vless').includes('xhttp'));
assert(networks('vless').includes('xdrive'));
assert(!networks('trojan').includes('xdrive'));
assert.deepEqual(networks('hysteria'),['hysteria']);
assert.deepEqual(networks('masque'),['masque']);
assert.deepEqual(networks('wireguard'),['raw']);
assert(security('vless','raw').includes('reality'));
assert(security('vless','xhttp').includes('reality'));
assert(!security('vless','websocket').includes('reality'));
assert.deepEqual(security('hysteria','hysteria'),['tls']);
assert.deepEqual(security('masque','masque'),['tls']);
assert.deepEqual(security('wireguard','raw'),['none']);
for(const snippet of [
 'option.disabled=!allowed;option.hidden=!allowed;',
 'panel.hidden=!sections[panel.dataset.xrayConfigPanel]',
 "security:['reality','tls'].includes(sec)",
 "studioRoot.classList.add('studio-v3','studio-inline')"
])assert(source.includes(snippet),'Missing editor marker: '+snippet);
assert(css.includes('>.xray-config-tabs{display:none!important}'));
assert(css.includes('.sr-inline-context'));
assert(ui.includes("xhttp.dataset.xhttpExpanded='false'"));
assert(ui.includes('if(option.hidden)return;'));
console.log('Contextual XRAY STUDIO: dependency matrix, inline panels and advanced disclosure OK');
