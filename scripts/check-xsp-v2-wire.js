'use strict';
// XSP-v2 PR01 offline test: deterministic bytes, not live signatures.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const vectors=JSON.parse(fs.readFileSync('docs/XSP_V2_VECTORS.json','utf8'));
assert.equal(vectors.schema,'xsp2-wire-candidate-1');
assert.equal(vectors.vectors.length,2);
function canonical(v){
 const direction={
  'node.enroll':1,'node.desired-config.request':1,'node.desired-config.response':2,
  'node.heartbeat':1,'metrics.ingest':1,'node.command.poll':1,
  'node.command.response':2,'node.command.ack':1,'node.security.activate':3,
  'node.keys.rotate':3,'node.security.recover':3
 };
 assert([1,2].includes(v.direction_id),'direction');
 assert(direction[v.message_type]&v.direction_id,'type/direction binding');
 assert(Number.isSafeInteger(v.node_id)&&v.node_id>0&&Number.isSafeInteger(v.key_epoch)&&v.key_epoch>0,'identity/epoch');
 assert(v.issued_at_ms>0&&v.expires_at_ms>v.issued_at_ms&&v.expires_at_ms-v.issued_at_ms<=300000,'lifetime');
 assert.equal(v.method,'POST');
 assert(v.path.startsWith('/api/v2/node/')&&!/[?#\\]/.test(v.path)&&!v.path.includes('..'),'path');
 const payload=Buffer.from(v.payload_utf8,'utf8');assert(payload.length<=524288);
 assert(/^[0-9a-f]{32}$/.test(v.nonce_hex),'nonce');
 const chunks=[Buffer.from('XSP2-SIGNED-MESSAGE\0','ascii'),Buffer.from([2,1,v.direction_id])];
 const txt=(s,max,optional=false)=>{
  assert(typeof s==='string'&&s.length<=max&&(optional||s.length>0)&&(!s.length||/^[\x21-\x7e]+$/.test(s)),'ASCII bounds');
  const raw=Buffer.from(s,'ascii'),len=Buffer.alloc(4);len.writeUInt32BE(raw.length);chunks.push(len,raw);
 };
 const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(n));chunks.push(b)};
 const i64=n=>{const b=Buffer.alloc(8);b.writeBigInt64BE(BigInt(n));chunks.push(b)};
 txt(v.message_type,64);txt(v.issuer_id,64);u64(v.node_id);
 txt(v.method,8);txt(v.path,256);txt(v.ed_key_id,64);txt(v.pq_key_id,64);
 u64(v.key_epoch);i64(v.issued_at_ms);i64(v.expires_at_ms);
 chunks.push(Buffer.from(v.nonce_hex,'hex'));
 txt(v.request_id,64);txt(v.revision,128,true);
 chunks.push(crypto.createHash('sha256').update(payload).digest());
 return Buffer.concat(chunks);
}
for(const v of vectors.vectors){
 const got=canonical(v);
 assert.equal(got.toString('hex'),v.signing_input_hex,v.id);
 assert.equal(crypto.createHash('sha256').update(Buffer.from(v.payload_utf8)).digest('hex'),v.payload_sha256);
 assert.notDeepEqual(canonical({...v,payload_utf8:v.payload_utf8+'!'}),got);
 assert.notDeepEqual(canonical({...v,path:v.path+'/other'}),got);
 assert.throws(()=>canonical({...v,direction_id:3}));
 assert.throws(()=>canonical({...v,nonce_hex:'ff'}));
 assert.throws(()=>canonical({...v,expires_at_ms:v.issued_at_ms-1}));
}
console.log('XSP-v2 PR01 canonical bytes verified in JavaScript (NO signatures).');
