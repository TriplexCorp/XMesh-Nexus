/* XMesh Nexus: generate Xray client JSON from REAL user, inbound and host data.
 * No template placeholders, no guessing Reality public keys, no panel hostname.
 * This is an authenticated admin-side export, NOT the public subscription API.
 */
(function(global){
 'use strict';
 const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const copy=value=>JSON.parse(JSON.stringify(value));
 const nonempty=value=>typeof value==='string'&&value.trim()?value.trim():'';
 const validUUID=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));
 function address(value){
  const v=nonempty(value);
  if(!v||/[\s/?#@\\]/.test(v)||v.includes('://')||v==='0.0.0.0'||v==='::'||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/i.test(v)||/^(fc|fd|fe80|\[fc|\[fd|\[fe80)/i.test(v))return '';
  if(/^[^:]+:\d+$/.test(v))return '';
  return v;
 }
 function port(value){const v=Number(value);return Number.isInteger(v)&&v>0&&v<65536?v:null}
 function defaults(){
  return {
   dns:{queryStrategy:'UseIPv4',servers:['1.1.1.1']},
   inbounds:[
    {tag:'socks',listen:'127.0.0.1',port:10808,protocol:'socks',settings:{auth:'noauth',udp:true},sniffing:{enabled:true,destOverride:['http','tls','quic']}},
    {tag:'http',listen:'127.0.0.1',port:10809,protocol:'http',sniffing:{enabled:true,destOverride:['http','tls','quic']}}
   ]
  };
 }
 function base(outbound){
  return {...defaults(),outbounds:[
   outbound,
   {tag:'dns-out',protocol:'dns'},
   {tag:'direct',protocol:'freedom',settings:{domainStrategy:'AsIs'}},
   {tag:'block',protocol:'blackhole',settings:{response:{type:'none'}}}
  ],routing:{domainStrategy:'IPIfNonMatch',rules:[
   {type:'field',ip:['geoip:private'],outboundTag:'direct'},
   {type:'field',domain:['geosite:private'],outboundTag:'direct'},
   {type:'field',inboundTag:['socks','http'],port:'53',network:'udp,tcp',outboundTag:'dns-out'},
   {type:'field',network:'tcp,udp',outboundTag:'proxy'}
  ]}};
 }
 function stream(inbound,host){
  const source=obj(inbound.streamSettings),security=nonempty(source.security)||'none';
  let network=nonempty(source.network)||'tcp';
  if(network==='splithttp')network='xhttp';
  if(network==='ws')network='ws';
  const result={network,security};
  const sourceSettings={xhttp:source.xhttpSettings||source.splithttpSettings,
   grpc:source.grpcSettings,ws:source.wsSettings,websocket:source.wsSettings,
   httpupgrade:source.httpupgradeSettings,raw:source.rawSettings,tcp:source.tcpSettings};
  const map={xhttp:'xhttpSettings',grpc:'grpcSettings',ws:'wsSettings',
   websocket:'wsSettings',httpupgrade:'httpupgradeSettings',raw:'rawSettings',tcp:'tcpSettings'};
  if(map[network]&&sourceSettings[network])result[map[network]]=copy(sourceSettings[network]);
  const domain=nonempty(host.sni)||nonempty(host.externalSNI)||nonempty(source.realitySettings?.serverNames?.[0])||nonempty(source.tlsSettings?.serverName);
  if(security==='reality'){
   const reality=obj(source.realitySettings);
   // Server config normally contains privateKey, not publicKey. Never expose it
   // and never use it as a publicKey. Host/public metadata must provide it.
   const publicKey=nonempty(host.publicKey)||nonempty(host.realityPublicKey)||nonempty(inbound.publicKey)||nonempty(reality.publicKey);
   const shortId=nonempty(host.shortId)||nonempty(host.externalShortId)||nonempty(reality.shortIds?.[0]);
   if(!publicKey||!shortId||!domain)throw new Error('Reality: требуются публичный ключ, Short ID и SNI. Добавьте publicKey в публичные настройки хоста.');
   result.realitySettings={serverName:domain,publicKey,shortId,
    fingerprint:nonempty(host.fp)||nonempty(host.fingerprint)||'chrome',
    spiderX:nonempty(host.spiderX)||'/'};
  }else if(security==='tls'){
   result.tlsSettings={serverName:domain||nonempty(host.address),
    ...(source.tlsSettings?.alpn?{alpn:copy(source.tlsSettings.alpn)}:{})};
  }else if(security!=='none'){
   throw new Error('Неизвестный режим защиты '+security+'. Требуется ручная проверка Xray.');
  }
  const clientHost=nonempty(host.host)||nonempty(host.externalHost);
  const path=nonempty(host.path);
  for(const prop of ['xhttpSettings','wsSettings','httpupgradeSettings']){
   if(!result[prop])continue;
   if(path)result[prop].path=path;
   if(clientHost){
    if(prop==='wsSettings')result[prop].headers={...obj(result[prop].headers),Host:clientHost};
    else result[prop].host=clientHost;
   }
  }
  return result;
 }
 async function publicKeyFromPrivate(value){
  const encoded=nonempty(value);
  if(!encoded)return '';
  if(!/^[a-zA-Z0-9_-]{42,44}$/.test(encoded))throw new Error('Reality privateKey имеет неизвестный формат X25519.');
  const binary=atob(encoded.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-encoded.length%4)%4));
  const raw=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(raw.length!==32)throw new Error('Reality privateKey должен содержать 32 байта.');
  const subtle=global.crypto?.subtle;
  if(!subtle)throw new Error('Для автоматического Reality publicKey откройте панель по HTTPS.');
  // RFC 8410 PKCS#8 X25519 private-key encoding (never exported to JSON).
  const der=new Uint8Array([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x6e,0x04,0x22,0x04,0x20,...raw]);
  const privateKey=await subtle.importKey('pkcs8',der,{name:'X25519'},false,['deriveBits']);
  const basepoint=new Uint8Array(32);basepoint[0]=9;
  const publicBase=await subtle.importKey('raw',basepoint,{name:'X25519'},false,[]);
  const derived=new Uint8Array(await subtle.deriveBits({name:'X25519',public:publicBase},privateKey,256));
  return btoa(String.fromCharCode(...derived)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 }
 function build(user,host,inbound){
  if(!validUUID(user?.xrayId))throw new Error('У пользователя отсутствует действительный UUID. Создайте/обновите его через сервер XMesh.');
  const endpoint=address(host?.externalAddress||host?.address||host?.publicAddress||host?.addr);
  if(!endpoint)throw new Error('Для хоста нет публичного адреса. Укажите внешний домен или IP.');
  const protocol=nonempty(inbound?.protocol).toLowerCase();
  const actualPort=port(host.externalPort)||port(host.port)||port(inbound.port);
  if(!actualPort)throw new Error('У хоста отсутствует корректный публичный порт.');
  let settings;
  if(protocol==='vless'){
   const encryption=nonempty(host.clientEncryption)||nonempty(host.externalClientEncryption)
    ||nonempty(user.vlessEncryption)||nonempty(inbound.xmesh?.clientEncryption)||'none';
   const decryption=nonempty(inbound.settings?.decryption)||'none';
   if(decryption!=='none'&&encryption==='none')throw new Error('VLESS Encryption активен на сервере, но в хосте не указан клиентский encryption.');
   if(obj(inbound.streamSettings).security==='none'&&!encryption.startsWith('mlkem768x25519plus.'))
    throw new Error('VLESS без TLS/REALITY требует VLESS Encryption.');
   const userEntry={id:user.xrayId,encryption};
   const flow=nonempty(inbound.settings?.flow);
   if(flow)userEntry.flow=flow;
   settings={vnext:[{address:endpoint,port:actualPort,users:[userEntry]}]};
  }else if(protocol==='vmess'){
   settings={vnext:[{address:endpoint,port:actualPort,users:[{id:user.xrayId,alterId:0,security:'auto'}]}]};
  }else if(protocol==='trojan'){
   settings={servers:[{address:endpoint,port:actualPort,password:user.xrayId}]};
  }else if(protocol==='shadowsocks'){
   const ss=obj(inbound.settings);
   const method=nonempty(ss.method);
   const password=nonempty(host.password)||nonempty(ss.password);
   if(!method||!password)throw new Error('Shadowsocks: для клиента нужны действительный method и password.');
   settings={servers:[{address:endpoint,port:actualPort,method,password}]};
  }else{
   throw new Error('Протокол '+protocol+' требует отдельного сериализатора. Некорректный Client JSON не выдаётся.');
  }
  const outbound={tag:'proxy',protocol,settings};
  if(protocol!=='shadowsocks'||inbound.streamSettings)outbound.streamSettings=stream(inbound,host);
  return base(outbound);
 }
 async function generate(user,db){
  const allowed=new Set((Array.isArray(db?.squads)?db.squads:[])
   .filter(s=>(user.squads||[]).some(id=>String(id)===String(s.id)))
   .flatMap(s=>Array.isArray(s.inb)?s.inb:[]).map(String));
  const profiles=Array.isArray(db?.profiles)?db.profiles:[];
  const entries=[];
  for(const profile of profiles){
   let parsed;try{parsed=typeof profile.config==='string'?JSON.parse(profile.config):profile.config}catch{continue}
   for(const inbound of Array.isArray(parsed?.inbounds)?parsed.inbounds:[]){
    if(!allowed.has(String(inbound.tag)))continue;
    const allHosts=(Array.isArray(db.hosts)?db.hosts:[]).filter(h=>String(h.tag)===String(inbound.tag)
      &&(h.profileId==null||String(h.profileId)===String(profile.id)));
    const associatedNodes=(Array.isArray(db.nodes)?db.nodes:[]).filter(n=>!n.disabled&&String(n.profileId)===String(profile.id));
    const hosts=allHosts.filter(h=>!h.disabled && (!Array.isArray(h.nodes)||!h.nodes.length
      ||h.nodes.some(id=>associatedNodes.some(n=>String(n.id)===String(id)))));
    // When a host is explicitly disabled or pinned elsewhere, never silently
    // re-publish the node's unprotected raw address as an alternative.
    const candidates=hosts.length?hosts:(allHosts.length?[]:associatedNodes.map(n=>({
      id:'node:'+n.id,remark:n.name,address:n.publicAddress||n.externalAddress||n.addr,
      port:inbound.port,sni:inbound.streamSettings?.realitySettings?.serverNames?.[0]||''
    })));
    for(const host of candidates){
     const item={name:(host.remark||host.address||inbound.tag),tag:inbound.tag,hostId:host.id};
     try{
      const runtimeHost={...host};
      const reality=obj(inbound.streamSettings?.realitySettings);
      if(inbound.streamSettings?.security==='reality'
        && !nonempty(runtimeHost.publicKey||runtimeHost.realityPublicKey||inbound.publicKey||reality.publicKey)
        && nonempty(reality.privateKey)){
        runtimeHost.publicKey=await publicKeyFromPrivate(reality.privateKey);
      }
      item.json=build(user,runtimeHost,inbound);
     }catch(err){item.error=err.message}
     entries.push(item);
    }
   }
  }
  return entries;
 }
 const api={generate,build,defaults,base,publicKeyFromPrivate};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 global.XMeshClientConfig=api;
})(typeof window!=='undefined'?window:globalThis);
