#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
// Node 24 supplies a read-only global WebCrypto implementation.
assert(global.crypto?.subtle, 'Node WebCrypto required for X25519 tests');
const gen=require('../client-config.js');
(async()=>{
 const user={id:17,username:'user17',xrayId:crypto.randomUUID(),squads:[5]};
 const privateRaw=Buffer.alloc(32,7);
 const b64=privateRaw.toString('base64url');
 const p8=Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'),privateRaw]);
 const expected=crypto.createPublicKey(crypto.createPrivateKey({key:p8,format:'der',type:'pkcs8'}))
  .export({format:'der',type:'spki'}).subarray(-32).toString('base64url');
 assert.equal(await gen.publicKeyFromPrivate(b64),expected,'X25519 public key derives from server private key');
 const inbound={tag:'DE_VLESS',protocol:'vless',port:443,
  settings:{decryption:'none',flow:'xtls-rprx-vision'},
  streamSettings:{network:'raw',security:'reality',realitySettings:{
   privateKey:b64,shortIds:['0a1b2c3d'],serverNames:['www.example.com']}}};
 const host={id:77,tag:'DE_VLESS',address:'cdn.example.net',port:8443,remark:'CDN',
  sni:'www.example.com',fp:'firefox'};
 const db={squads:[{id:5,inb:['DE_VLESS']}],hosts:[host],
  profiles:[{id:1,config:JSON.stringify({inbounds:[inbound]})}],
  nodes:[{id:3,profileId:1,addr:'192.168.0.5'}]};
 const results=await gen.generate(user,db);
 assert.equal(results.length,1);
 assert(!results[0].error,results[0].error);
 const config=results[0].json;
 const outbound=config.outbounds[0];
 assert.equal(outbound.settings.vnext[0].address,'cdn.example.net');
 assert.equal(outbound.settings.vnext[0].port,8443);
 assert.equal(outbound.settings.vnext[0].users[0].id,user.xrayId);
 assert.equal(outbound.settings.vnext[0].users[0].flow,'xtls-rprx-vision');
 assert.equal(outbound.streamSettings.realitySettings.publicKey,expected);
 assert.equal(outbound.streamSettings.realitySettings.serverName,'www.example.com');
 assert(!JSON.stringify(config).includes(b64),'Private Reality key MUST NOT appear in Client JSON');
 assert.equal(config.remarks,'CDN','Host name is the exported client remark');
 assert.equal(config.dns.queryStrategy,'UseIPv4');
 assert.equal(config.inbounds[0].port,10808);
 assert.equal(config.inbounds[1].port,10809);
 assert.deepEqual(config.outbounds.slice(1).map(x=>x.tag),['dns-out','direct','block']);
 assert.equal(config.routing.domainStrategy,'IPIfNonMatch');
 assert.deepEqual(config.routing.rules.map(x=>x.outboundTag),['direct','direct','dns-out','proxy']);
 assert(!JSON.stringify(config).includes('REPLACE_WITH_'),'No template placeholders for complete user data');
 const wrong=await gen.generate({...user,squads:[]},db);
 assert.equal(wrong.length,0,'Do not leak inbounds outside assigned squads');
 const noHost=await gen.generate(user,{...db,hosts:[],nodes:[{id:3,profileId:1,addr:'203.0.113.8'}]});
 assert.equal(noHost.length,1);
 assert.equal(noHost[0].json.outbounds[0].settings.vnext[0].address,'203.0.113.8');
 const incorrectHost={...host,profileId:99};
 const inaccessible=await gen.generate(user,{...db,hosts:[incorrectHost],nodes:[{id:3,profileId:1,addr:'203.0.113.8'}]});
 assert.equal(inaccessible.length,1,'No eligible host means fallback to explicitly assigned node');
 assert.equal(inaccessible[0].json.outbounds[0].settings.vnext[0].address,'203.0.113.8');
 const blocked=await gen.generate(user,{...db,hosts:[{...host,disabled:true}]});
 assert.equal(blocked.length,0,'Disabled host prevents raw-node fallback');
 const pqInbound={...inbound,settings:{decryption:'mlkem768x25519plus.native.example'}};
 assert.throws(()=>gen.build(user,host,pqInbound),/VLESS Encryption/,
  'Do not produce unusable plaintext client when server requires post-quantum encryption');
 const pq=gen.build(user,{...host,publicKey:expected,clientEncryption:'mlkem768x25519plus.native.client'},pqInbound);
 assert.equal(pq.outbounds[0].settings.vnext[0].users[0].encryption,'mlkem768x25519plus.native.client');
 assert.throws(()=>gen.build(user,{...host,publicKey:''},
  {...inbound,streamSettings:{network:'raw',security:'reality',realitySettings:{shortIds:['aa'],serverNames:['www.example.com']}}}),
  /Reality: требуются публичный ключ/,
  'Absent public key must fail closed');
 // Admin-side exports must match the managed node's per-protocol credentials.
 const different={
  ...user,vmessId:crypto.randomUUID(),trojanPassword:crypto.randomBytes(32).toString('hex'),
  ssLegacyPassword:crypto.randomBytes(32).toString('hex')
 };
 const tls={tag:'AUTH',port:443,streamSettings:{network:'raw',security:'tls',
  tlsSettings:{serverName:'vpn.example.org'}},settings:{}};
 const vmess=gen.build(different,host,{...tls,protocol:'vmess'});
 assert.equal(vmess.outbounds[0].settings.vnext[0].users[0].id,different.vmessId);
 const trojan=gen.build(different,host,{...tls,protocol:'trojan'});
 assert.equal(trojan.outbounds[0].settings.servers[0].password,different.trojanPassword);
 const legacySS=gen.build(different,host,{...tls,protocol:'shadowsocks',
  settings:{method:'aes-256-gcm',password:'SERVER_PASSWORD_MUST_NOT_LEAK'}});
 assert.equal(legacySS.outbounds[0].settings.servers[0].password,different.ssLegacyPassword);
 const serverPSK=crypto.randomBytes(32).toString('base64');
 const clientPSK=crypto.randomBytes(32).toString('base64');
 const modernSS=gen.build({...different,ssPassword:clientPSK},host,
  {...tls,protocol:'shadowsocks',settings:{method:'2022-blake3-aes-256-gcm',
   password:serverPSK}});
 assert.equal(modernSS.outbounds[0].settings.servers[0].password,serverPSK+':'+clientPSK);
 assert.throws(()=>gen.build({...different,trojanPassword:'broken'},host,
  {...tls,protocol:'trojan'}),/Повреждён секрет/);
 assert.equal(gen.build(user,host,{...tls,protocol:'trojan'})
  .outbounds[0].settings.servers[0].password,user.xrayId,
  'Pre-upgrade user imports remain functional until explicit rekey');
 console.log('Per-user Marzban-style Client JSON, auto Reality key, DNS/routing, access controls: PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
