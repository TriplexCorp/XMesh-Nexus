#!/usr/bin/env node
'use strict';
// Behavioural SVG geometry check: execute the real renderers with measured data.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
function extract(start,end){
 const from=app.indexOf(start),to=app.indexOf(end,from+start.length);
 assert(from!==-1&&to>from,'renderer source boundaries must exist: '+start);
 return app.slice(from,to);
}
const helpers={
 esc:v=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
 fmt:(n,d=2)=>Number(n).toFixed(d),
 panelIsEnglish:()=>false,
 trafficMbit:n=>Number(n)*8/1000000,
 DB:{nodes:[{id:1}]},
 ic:()=>'<svg></svg>'
};
const stats=new Function(...Object.keys(helpers),
 extract('const statsDetailedChart=', '// SVG coordinates are resized horizontally')+
 '\nreturn statsDetailedChart;')(...Object.values(helpers));
const dashboard=new Function(...Object.keys(helpers),
 extract('function trafficChartMarkup(', '/* ================= ДАШБОРД')+
 '\nreturn trafficChartMarkup;')(...Object.values(helpers));

function viewBox(html){
 const match=html.match(/viewBox="0 0 (\d+) (\d+)"/);
 assert(match,'SVG viewBox must be emitted');
 return match.slice(1).map(Number);
}
const points=[
 {bucketMs:1792900000000,rxBytesPerSec:20000,txBytesPerSec:12000},
 {bucketMs:1792900060000,rxBytesPerSec:30000,txBytesPerSec:18000},
 {bucketMs:1792900120000,rxBytesPerSec:15000,txBytesPerSec:9000}
];
for(const [renderer,height] of [[w=>stats(points,w),340],[w=>dashboard({points,sampleCount:3},'1h',w),292]]){
 const small=renderer(720),large=renderer(1920);
 assert.deepEqual(viewBox(small),[720,height]);
 assert.deepEqual(viewBox(large),[1920,height]);
 // At a constant logical height, Y positions remain unchanged and the X span grows.
 const line=(html)=>html.match(/class="(?:stats-detail-line rx|traffic-line rx)" d="([^"]+)"/)?.[1];
 assert(line(small)&&line(large),'RX path must exist');
 assert.notEqual(line(small),line(large),'X coordinates must expand');
 const endpoints=html=>Array.from(line(html).matchAll(/[ML]\s*([0-9.]+)\s+([0-9.]+)/g),m=>[+m[1],+m[2]]);
 const a=endpoints(small),b=endpoints(large);
 assert.equal(a.length,b.length);
 for(let i=0;i<a.length;i++)assert(Math.abs(a[i][1]-b[i][1])<0.01,'Y must not scale with width');
 assert(b.at(-1)[0]>a.at(-1)[0],'Plot must expand horizontally');
}
assert.match(css,/\.stats-detail-chart\{[^}]*height:21\.25rem/);
assert.match(css,/\.traffic-chart-svg\{[^}]*height:18\.25rem/);
assert.doesNotMatch(css,/width:min\(100%,(?:72|100)rem\)/);
assert.match(app,/new ResizeObserver\(update\)/);
assert.match(app,/observer\.observe\(wrapper\)/);
console.log('Statistics/Dashboard SVG horizontal reflow and independent heights: PASS');
