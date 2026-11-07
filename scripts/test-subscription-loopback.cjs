'use strict';
// Real data-plane smoke test. Disposable loopback only; no production tokens/nodes.
const assert=require('node:assert/strict'),http=require('node:http'),net=require('node:net'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),gen=require('../frontend/js/features/users/client-config.js');
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
(async()=>{
 const binary=process.env.XRAY_TEST_BINARY;if(!binary)throw Error('Set XRAY_TEST_BINARY to a verified Xray-core binary');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xmesh-subscription-tunnel-')),children=[];
 const payload='xmesh-loopback-'+crypto.randomUUID(),target=http.createServer((q,s)=>s.end(payload));await new Promise(r=>target.listen(0,'127.0.0.1',r));
 try{
  const serverPort=await port(),socksPort=await port(),httpPort=await port();
  await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-days','1','-subj','/CN=tunnel.test','-addext','subjectAltName=DNS:tunnel.test','-addext','basicConstraints=critical,CA:FALSE']);
  const cert=new crypto.X509Certificate(await fs.readFile(path.join(dir,'cert.pem')));
  const pin=crypto.createHash('sha256').update(cert.raw).digest('hex');
  const id=crypto.randomUUID(),inbound={tag:'test-vless',protocol:'vless',listen:'127.0.0.1',port:serverPort,settings:{decryption:'none',clients:[{id}]},streamSettings:{network:'raw',security:'tls',tlsSettings:{certificates:[{certificateFile:path.join(dir,'cert.pem'),keyFile:path.join(dir,'key.pem')}]}}};
  const server={log:{loglevel:'warning'},inbounds:[inbound],outbounds:[{protocol:'freedom',tag:'direct',settings:{finalRules:[{action:'allow',ip:['127.0.0.1'],port:String(target.address().port)}]}}]};
  const client=gen.build({id:1,username:'disposable',xrayId:id},{remark:'Disposable loopback',address:'tunnel.test',sni:'tunnel.test',clientTlsSettings:{pinnedPeerCertSha256:pin},port:serverPort},inbound);
  // Replace only the public endpoint for this isolated local test. The generator
  // correctly rejects private addresses in production. The ephemeral self-signed test certificate is pinned by SHA-256.
  client.outbounds[0].settings.vnext[0].address='127.0.0.1';
  client.inbounds=client.inbounds.filter(i=>['socks','http'].includes(i.protocol));for(const i of client.inbounds){i.listen='127.0.0.1';i.port=i.protocol==='socks'?socksPort:httpPort}
  // The product deliberately bypasses private destinations. Override ONLY this
  // test routing rule so a loopback HTTP target actually traverses the VLESS hop.
  client.log={loglevel:'warning'};
  client.routing={domainStrategy:'AsIs',rules:[{type:'field',network:'tcp',outboundTag:'proxy'}]};
  for(const [name,config]of [['server',server],['client',client]]){const f=path.join(dir,name+'.json');await fs.writeFile(f,JSON.stringify(config));try{await run(binary,['run','-test','-config',f],{timeout:10000})}catch(e){throw Error((e.stdout||'')+(e.stderr||''))};const child=spawn(binary,['run','-config',f],{stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);child.testLog=()=>log;children.push(child)}
  let result,lastError;for(let i=0;i<3;i++){try{result=await run('curl',['--fail','--silent','--show-error','--max-time','2','--noproxy','','--socks5-hostname','127.0.0.1:'+socksPort,'http://127.0.0.1:'+target.address().port],{timeout:3000});break}catch(e){lastError=e;await new Promise(r=>setTimeout(r,100))}}
  if(!result)console.error(lastError?.stderr||lastError?.message);
  if(!result)for(const c of children)console.error(c.testLog().slice(-2500));
  assert.equal(result?.stdout,payload,'Generated client must carry HTTP through the VLESS server');
  // A broken server must break the tunnel: proves the private target was not bypassed.
  children[0].kill();await new Promise(r=>children[0].once('exit',r));
  await assert.rejects(run('curl',['--fail','--silent','--max-time','2','--noproxy','','--socks5-hostname','127.0.0.1:'+socksPort,'http://127.0.0.1:'+target.address().port],{timeout:3000}));
  console.log('Real Xray loopback: generated JSON validates; HTTP traverses VLESS; stopped server breaks tunnel.');
 }finally{for(const c of children)c.kill();target.closeAllConnections();await new Promise(r=>target.close(r));await fs.rm(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e.message);process.exitCode=1});
