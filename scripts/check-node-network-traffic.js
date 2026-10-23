#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const agent=fs.readFileSync('deploy/node-metrics-agent.sh','utf8');
const api=fs.readFileSync('backend/src/main.rs','utf8');
const app=fs.readFileSync('app.js','utf8');
const migration=fs.readFileSync('backend/migrations/0022_node_network_traffic_totals.sql','utf8');
assert.match(agent,/"rxTotalBytes":%s,"txTotalBytes":%s/,'Agent reports real monotonic NIC counters');
assert.match(api,/node_network_traffic_totals AS totals/,'API persists cumulative NIC deltas');
assert.match(api,/GREATEST\(EXCLUDED\.last_rx_bytes-totals\.last_rx_bytes,0\)/,
 'RX counter resets cannot subtract traffic');
assert.match(api,/GREATEST\(EXCLUDED\.last_tx_bytes-totals\.last_tx_bytes,0\)/,
 'TX counter resets cannot subtract traffic');
assert.match(api,/totals\.interface_name=EXCLUDED\.interface_name/,
 'Changing network interface must establish a new baseline');
assert.match(api,/networkRxBytes/);
assert.match(api,/networkTxBytes/);
assert.match(app,/networkTotalBytes/);
assert.match(app,/Трафик сети/);
const section=app.slice(app.indexOf('async function nodesP()'),app.indexOf('/* ================= ДИАГНОСТИКА'));
assert.doesNotMatch(section,/n\.used/,'Node traffic gauge must not use a static DB field');
assert.match(migration,/node_id BIGINT PRIMARY KEY/);
console.log('Node NIC RX/TX accounting and live UI: OK');
