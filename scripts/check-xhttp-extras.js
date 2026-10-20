#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');
const ui=fs.readFileSync('xray-studio-v5.js','utf8');
const css=fs.readFileSync('xray-studio.css','utf8');
const a=app.indexOf('function xrayXhttpSettings(');
const b=app.indexOf('function xrayBuilderConfig()',a);
assert(a>=0&&b>a,'XHTTP serializer must exist');
const source=app.slice(a,b);
const create=(fields,side)=>{
 const $=selector=>({value:fields[selector.replace(/^#xpb-/,'')]??''});
 const builder=new Function('$',source+'; return xrayXhttpSettings;')($);
 return builder('/path','cdn.example.com',side);
};
const defaults=create({},'server');
assert.equal(defaults.extra.xPaddingBytes,'100-1000');
assert.equal(defaults.mode,'auto');
const client=create({
 'xhttp-post-bytes':'131072-524288',
 'xhttp-post-interval':'10-50',
 'xhttp-mux-connections':'3-6',
 'xhttp-mux-reuse':'64-128',
 'xhttp-no-grpc':'true',
 'xhttp-headers':'{"User-Agent":"Mozilla/5.0"}'
},'client');
assert.equal(client.extra.scMaxEachPostBytes,'131072-524288');
assert.equal(client.extra.scMinPostsIntervalMs,'10-50');
assert.deepEqual(client.extra.xmux,{maxConnections:'3-6',cMaxReuseTimes:'64-128'});
assert.equal(client.extra.noGRPCHeader,true);
assert.equal(client.headers['User-Agent'],'Mozilla/5.0');
const server=create({'xhttp-buffered-posts':'30','xhttp-stream-secs':'20-80','xhttp-no-sse':'true'},'server');
assert.equal(server.extra.scMaxBufferedPosts,30);
assert.equal(server.extra.scStreamUpServerSecs,'20-80');
assert.equal(server.extra.noSSEHeader,true);
assert(!('xmux' in server.extra),'Client xmux must not leak into server JSON');
assert(!('scMaxBufferedPosts' in client.extra),'Server-only setting must not leak into client JSON');
assert.throws(()=>create({'xhttp-mux-connections':'4','xhttp-mux-concurrency':'8'},'client'),/нельзя включать/);
assert.throws(()=>create({'xhttp-post-bytes':'50-10'},'client'),/диапазон/);
assert.throws(()=>create({'xhttp-headers':'{"X":3}'},'client'),/строковых|JSON-объект/);
assert.match(app,/data-xray-option-group="transport-xhttp"/,'XHTTP section must be conditional');
assert.match(ui,/sr-v5-select-trigger/,'Themed select replacement missing');
assert.match(css,/\.sr-v5-menu-item:disabled/,'Disabled menu items must be visually distinct');
assert.match(css,/\.sr-v5-select-menu\[hidden\]/,'Dropdown hidden state must not be overridden');
console.log('XRAY Studio XHTTP serializer and themed selects: OK');
