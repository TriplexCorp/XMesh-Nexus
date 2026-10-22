#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
new Function(app);
const start=app.indexOf('function xrayStudioEndpointOptions(');
const end=app.indexOf('function xrayClientSample()',start);
assert(start!==-1&&end>start,'Missing source-derived endpoint resolver');
const {options,auto}=new Function(app.slice(start,end)+';return {options:xrayStudioEndpointOptions,auto:xrayStudioAutoEndpoint};')();
const node=(id,addr,profileId)=>({id,addr,profileId,name:'Node '+id});
const host=(id,tag,address,opts={})=>({id,tag,address,remark:'CDN '+id,port:443,...opts});
const cfg={inbounds:[{tag:'DE_VLESS',protocol:'vless'}]};
const profile={id:3,config:JSON.stringify(cfg)};
const db={nodes:[node(1,'10.0.0.4',3),node(2,'203.0.113.4',3)],profiles:[profile],
  hosts:[host(30,'DE_VLESS','cdn.example.net',{sni:'edge.example.net',path:'/xhttp'})]};
let candidates=options(db,'DE_VLESS');
assert.equal(auto(candidates).address,'cdn.example.net','Explicit CDN host wins over raw node IP');
assert.equal(auto(candidates).port,443,'Host external port is kept');
assert.equal(auto(candidates).sni,'edge.example.net','Host SNI must propagate');
assert.equal(auto(candidates).path,'/xhttp','Host transport path must propagate');
assert(!candidates.some(c=>c.address==='10.0.0.4'),'Private node control-plane address cannot leak');
assert(!candidates.some(c=>c.address==='SERVER_ADDRESS'),'No generated fake addresses');
assert.equal(auto(options({...db,hosts:[]},'DE_VLESS')).address,'203.0.113.4',
  'Unique valid node address is used when no exact host matches');
assert.equal(auto(options({...db,hosts:[...db.hosts,host(31,'DE_VLESS','cdn2.example.net')]},'DE_VLESS')),null,
  'Multiple CDN choices cannot silently pick the wrong one');
assert.equal(auto(options({...db,hosts:[],nodes:[node(5,'1.1.1.1',3),node(6,'2.2.2.2',3)]},'DE_VLESS')),null,
  'Multiple node addresses must be resolved by user selection');
assert.equal(auto(options({...db,hosts:[host(7,'FR','fr.example.net')]},'DE_VLESS')).address,
  '203.0.113.4','Unrelated inbound host may not contaminate Client JSON');
assert.equal(auto(options({nodes:[node(1,'192.168.1.4',3)],hosts:[],profiles:[profile]},'DE_VLESS')),null,
  'Refuse private-only endpoint');
// The v3 form was retired; keep testing real host resolution above and the
// active Studio V4 editor separately from removed xpb DOM wiring.
const active=fs.readFileSync('xray-studio-v4.js','utf8');
assert.match(active,/window\.XMeshStudioV4=/);
assert.match(active,/data-v="source"/);
assert.doesNotMatch(app,/location\.hostname.*server-address/);
console.log('XRAY STUDIO client endpoint auto-fill: host-first, node fallback, ambiguity, private IP rejection and manual override OK');
