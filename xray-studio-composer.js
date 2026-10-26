/* XRAY STUDIO / composable server-side config builder.
 * Independent dimensions, never an allowlist of named templates.
 * The current Xray-core is the final authority; compatibility hints are advisory.
 */
window.XMeshStudioComposer=(()=>{
'use strict';
const protocols=[
 {id:'vless',label:'VLESS',hint:'UUID · Encryption · Vision'},
 {id:'vmess',label:'VMess',hint:'UUID и аутентификация'},
 {id:'trojan',label:'Trojan',hint:'Пароль и TLS'},
 {id:'shadowsocks',label:'Shadowsocks',hint:'AEAD / 2022 · XUDP'},
 {id:'socks',label:'SOCKS',hint:'Локальный SOCKS5'},
 {id:'http',label:'HTTP',hint:'Локальный HTTP proxy'},
 {id:'hysteria',label:'Hysteria2',hint:'QUIC и TLS 1.3'},
 {id:'masque',label:'MASQUE',hint:'HTTP/3 поверх QUIC'},
 {id:'custom',label:'Свой протокол',hint:'Неизвестный ядру / новый'}
];
const transports=[
 {id:'raw',label:'RAW / TCP',hint:'Прямой поток'},
 {id:'xhttp',label:'XHTTP',hint:'HTTP transport'},
 {id:'grpc',label:'gRPC',hint:'HTTP/2'},
 {id:'ws',label:'WebSocket',hint:'WebSocket / reverse proxy'},
 {id:'httpupgrade',label:'HTTPUpgrade',hint:'HTTP/1.1 upgrade'},
 {id:'kcp',label:'mKCP',hint:'UDP-based transport'},
 {id:'hysteria',label:'Hysteria',hint:'QUIC / Hysteria2'},
 {id:'masque',label:'MASQUE',hint:'HTTP/3 MASQUE'},
 {id:'custom',label:'Свой транспорт',hint:'Для новых версий ядра'}
];
const securities=[
 {id:'none',label:'Без TLS',hint:'Только доверенные каналы'},
 {id:'tls',label:'TLS',hint:'Сертификат сервера'},
 {id:'reality',label:'REALITY',hint:'X25519 · SNI · маскировка'}
];
const shadowsocksMethods=[
 {id:'2022-blake3-aes-128-gcm',bytes:16},
 {id:'2022-blake3-aes-256-gcm',bytes:32},
 {id:'2022-blake3-chacha20-poly1305',bytes:32},
 {id:'aes-256-gcm',bytes:32},
 {id:'aes-128-gcm',bytes:16},
 {id:'chacha20-poly1305',bytes:32}
];
const presets=[
 {id:'vless-xhttp-reality',label:'VLESS · XHTTP · REALITY',description:'VLESS c REALITY и XHTTP',protocol:'vless',transport:'xhttp',security:'reality'},
 {id:'shadowsocks-xhttp-reality',label:'Shadowsocks · XHTTP · REALITY',description:'Допустимая связка; UDP требует отдельного внимания',protocol:'shadowsocks',transport:'xhttp',security:'reality'},
 {id:'vless-raw-reality',label:'VLESS · RAW · REALITY',description:'Прямое TLS-подобное соединение',protocol:'vless',transport:'raw',security:'reality'},
 {id:'vless-xhttp-tls',label:'VLESS · XHTTP · TLS',description:'TLS и XHTTP за доверенной схемой',protocol:'vless',transport:'xhttp',security:'tls'},
 {id:'vless-ws-tls',label:'VLESS · WebSocket · TLS',description:'HTTP reverse proxy',protocol:'vless',transport:'ws',security:'tls'},
 {id:'vmess-ws-tls',label:'VMess · WebSocket · TLS',description:'VMess поверх защищённого WebSocket',protocol:'vmess',transport:'ws',security:'tls'},
 {id:'trojan-grpc-tls',label:'Trojan · gRPC · TLS',description:'Trojan + gRPC',protocol:'trojan',transport:'grpc',security:'tls'},
 {id:'shadowsocks-raw',label:'Shadowsocks 2022 · RAW',description:'Стандартный Shadowsocks 2022',protocol:'shadowsocks',transport:'raw',security:'none'},
 {id:'hysteria2',label:'Hysteria2 · QUIC · TLS',description:'Hysteria с TLS и QUIC',protocol:'hysteria',transport:'hysteria',security:'tls'},
 {id:'masque',label:'MASQUE · QUIC · TLS',description:'MASQUE поверх HTTP/3',protocol:'masque',transport:'masque',security:'tls'},
 {id:'socks',label:'SOCKS · RAW',description:'Локальный SOCKS5',protocol:'socks',transport:'raw',security:'none'},
 {id:'http',label:'HTTP · RAW',description:'Локальный HTTP proxy',protocol:'http',transport:'raw',security:'none'}
];
const defaults={protocol:'vless',transport:'xhttp',security:'reality',name:'Новая конфигурация',
 tag:'vless-main',port:443,listen:'127.0.0.1',path:'/xhttp',target:'',sni:'',
 alpn:'auto',certificateFile:'',keyFile:'',
 method:'2022-blake3-aes-256-gcm',mode:'new',customProtocol:'',customTransport:'',allowExperimental:false};
const selected=(options,field)=>String(field==='protocol'&&options.protocol==='custom'?options.customProtocol:
 field==='transport'&&options.transport==='custom'?options.customTransport:options[field]||'').trim().toLowerCase();
const normalize=options=>({...defaults,...(options||{})});
const isNetworkAllowed=(network,security)=>security!=='reality'||['raw','xhttp','grpc'].includes(network);
const specialProtocol=p=>p==='hysteria'||p==='masque';
// ALPN is negotiated by TLS, not inferred from the VLESS protocol name.
// Keep transport-specific safe defaults while permitting explicit overrides.
const recommendedAlpn=t=>t==='grpc'?['h2']:
 ['ws','httpupgrade'].includes(t)?['http/1.1']:
 t==='masque'?['h3']:
 t==='hysteria'?['h3']:
 ['xhttp','raw'].includes(t)?['h2','http/1.1']:[];
function parsedAlpn(input,transport){
 const text=String(input??'auto').trim();
 if(!text||text.toLowerCase()==='auto')return recommendedAlpn(transport);
 const values=text.split(',').map(v=>v.trim()).filter(Boolean);
 if(!values.length||values.length>4||new Set(values).size!==values.length||
    values.some(v=>!['h2','h3','http/1.1'].includes(v)))throw Error('ALPN: используйте auto, h2, h3 или http/1.1 через запятую без повторов.');
 return values;
}
function analyze(input){
 const o=normalize(input),p=selected(o,'protocol'),t=selected(o,'transport'),s=selected(o,'security');
 const errors=[],warnings=[],info=[];
 const custom=o.protocol==='custom'||o.transport==='custom';
 if(!p||!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(p))errors.push('Укажите корректное имя протокола.');
 if(!t||!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(t))errors.push('Укажите корректное имя транспорта.');
 if(!['none','tls','reality'].includes(s))errors.push('Неизвестный режим транспортной защиты.');
 if(!isNetworkAllowed(t,s))errors.push('REALITY поддерживается только с RAW, XHTTP и gRPC (по текущей документации Xray).');
 if(specialProtocol(p)&&(t!==p||s!=='tls'))errors.push((p==='hysteria'?'Hysteria2':'MASQUE')+' требует свой QUIC-транспорт и TLS.');
 if(['hysteria','masque'].includes(t)&&p!==t)errors.push('Транспорт '+t.toUpperCase()+' не поддерживается выбранным протоколом.');
 if((p==='vless'||p==='trojan')&&s==='none')warnings.push('Для публичного соединения нужна транспортная защита или предусмотренные Xray исключения (доверенная сеть / VLESS Encryption).');
 if(['shadowsocks','socks'].includes(p)&&(t!=='raw'||s!=='none'))warnings.push('Для '+p.toUpperCase()+' обычный UDP может обходить выбранный транспорт и TLS/REALITY. Для UDP изучите XUDP.');
 if(s==='reality')warnings.push('REALITY требует корректные target/SNI и действующий X25519 privateKey. Нажмите REALITY после создания либо используйте генератор.');
 if(s==='tls'){
  let alpn=[];
  try{alpn=parsedAlpn(o.alpn,t)}catch(e){errors.push(e.message)}
  if(t==='grpc'&&!alpn.includes('h2'))errors.push('gRPC через TLS требует ALPN h2.');
  if(['ws','httpupgrade'].includes(t)&&!alpn.includes('http/1.1'))warnings.push('Для WebSocket/HTTPUpgrade предпочтителен ALPN http/1.1; h2 требует проверенного reverse proxy.');
  if(['masque','hysteria'].includes(t)&&!alpn.includes('h3'))warnings.push('Проверьте QUIC/HTTP3: без h3 выбранный транспорт может не работать как ожидается.');
  if(Boolean(o.certificateFile)!==Boolean(o.keyFile))errors.push('Для TLS укажите оба пути: certificateFile и keyFile.');
  if(!o.certificateFile&&!o.keyFile)warnings.push('TLS-сертификат не настроен: добавьте реальные certificateFile/keyFile, доступные процессу Xray.');
 }
 if(String(o.listen).trim()==='127.0.0.1'&&!['socks','http'].includes(p))warnings.push('Inbound доступен только локально: для внешних клиентов нужен reverse proxy или явная смена Listen.');
 if(['vless','vmess','trojan','hysteria'].includes(p))info.push('В шаблоне users пустой: клиентов требуется добавить через панель или Xray до подключения.');
 if(p==='hysteria')warnings.push('Hysteria2 требует пользователей и валидные TLS-сертификаты.');
 if(p==='masque')warnings.push('MASQUE требует корректные настройки UDP/HTTP3 и TLS.');
 if(p==='shadowsocks')info.push('Пароль Shadowsocks 2022 генерируется криптографически при создании; клиенты должны получить тот же ключ.');
 if(p==='vmess')info.push('VMess зависит от синхронизации времени.');
 if(custom)warnings.push('Пользовательское имя протокола или транспорта: совместимость неизвестна. Проверьте установленным Xray-core.');
 const major=errors.length? 'unsupported':custom?'unknown':warnings.length?'review':'supported';
 return {status:major,errors,warnings,info,protocol:p,transport:t,security:s,experimental:errors.length>0||custom};
}
function countKnownCombinations(){
 let count=0;
 for(const p of protocols.filter(p=>p.id!=='custom')){
  for(const t of transports.filter(t=>t.id!=='custom')){
   for(const s of securities){
    if(analyze({protocol:p.id,transport:t.id,security:s.id}).errors.length===0)count++;
   }
  }
 }
 return count;
}
function makeSettings(p,o,secret){
 switch(p){
  case 'vless':return {users:[],decryption:'none'};
  case 'vmess':case 'trojan':return {users:[]};
  case 'shadowsocks':return {network:'tcp,udp',method:o.method,password:secret||'<КЛЮЧ_ПРИ_СОЗДАНИИ>'};
  case 'socks':return {auth:'noauth',users:[],udp:true};
  case 'http':return {users:[]};
  case 'hysteria':return {version:2,users:[]};
  case 'masque':return {};
  default:return {};
 }
}
function buildInbound(input,{shadowsocksPassword,realityKeys}={}){
 const o=normalize(input),v=analyze(o);if(v.errors.length&&!o.allowExperimental)throw Error(v.errors.join(' '));
 const port=Number(o.port),tag=String(o.tag||'').trim(),listen=String(o.listen||'').trim();
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Порт должен быть целым числом от 1 до 65535.');
 if(!/^[a-zA-Z0-9_.-]{1,64}$/.test(tag))throw Error('Тег: 1–64 символа (латиница, цифры, точка, _ и -).');
 if(!listen||listen.length>255||/[\s"\\<>]/.test(listen))throw Error('Некорректный адрес прослушивания.');
 const p=v.protocol,t=v.transport,s=v.security;
 if(p==='shadowsocks'&&!shadowsocksMethods.some(m=>m.id===o.method))throw Error('Неподдерживаемый метод Shadowsocks; выберите метод из каталога.');
 const streamSettings={network:t,security:s};
 switch(t){
  case 'raw':break;
  case 'xhttp':streamSettings.xhttpSettings={path:String(o.path||'/xhttp'),mode:'auto'};break;
  case 'grpc':streamSettings.grpcSettings={serviceName:String(o.path||'grpc').replace(/^\//,'')||'grpc'};break;
  case 'ws':streamSettings.wsSettings={path:String(o.path||'/ws')};break;
  case 'httpupgrade':streamSettings.httpupgradeSettings={path:String(o.path||'/')};break;
  case 'kcp':streamSettings.kcpSettings={};break;
  case 'hysteria':streamSettings.hysteriaSettings={version:2};break;
  case 'masque':streamSettings.masqueSettings={};break;
 }
 if(s==='tls'){
  const alpn=parsedAlpn(o.alpn,t);
  const certificateFile=String(o.certificateFile||'').trim(),keyFile=String(o.keyFile||'').trim();
  if(Boolean(certificateFile)!==Boolean(keyFile))throw Error('TLS требует одновременно certificateFile и keyFile.');
  streamSettings.tlsSettings={
   ...(alpn.length?{alpn}:{}),
   certificates:certificateFile?[{certificateFile,keyFile}]:[]
  };
 }
 if(s==='reality'){
  const target=String(o.target||'').trim(),sni=String(o.sni||'').trim();
  streamSettings.realitySettings={
   show:false,target,serverNames:sni?[sni]:[],
   shortIds:realityKeys?.shortId?[realityKeys.shortId]:[],
   privateKey:realityKeys?.privateKey||''
  };
 }
 return {tag,listen,port,protocol:p,settings:makeSettings(p,o,shadowsocksPassword),streamSettings};
}
function buildDocument(input,oldDoc,options={}){
 const o=normalize(input),inbound=buildInbound(o,options);
 if(o.mode==='add'){
  if(!oldDoc||typeof oldDoc!=='object'||Array.isArray(oldDoc)||!Array.isArray(oldDoc.inbounds))throw Error('Для добавления нужен текущий JSON с массивом inbounds.');
  const doc=JSON.parse(JSON.stringify(oldDoc));
  if(doc.inbounds.some(x=>x?.tag===inbound.tag))throw Error('Inbound с тегом «'+inbound.tag+'» уже существует. Измените тег.');
  doc.inbounds.push(inbound);
  return doc;
 }
 return {log:{loglevel:'warning'},inbounds:[inbound],outbounds:[{tag:'direct',protocol:'freedom'}],routing:{domainStrategy:'AsIs',rules:[]}};
}
function generateShadowsocksPassword(method,random){
 const m=shadowsocksMethods.find(x=>x.id===method);
 if(!m)throw Error('Неизвестный метод Shadowsocks.');
 if(!random?.getRandomValues)throw Error('Криптографический генератор браузера недоступен.');
 const bytes=new Uint8Array(m.bytes);random.getRandomValues(bytes);
 const binary=Array.from(bytes,n=>String.fromCharCode(n)).join('');
 if(typeof btoa==='function')return btoa(binary);
 // Node/test fallback: a small explicit binary-to-base64 encoder with no non-crypto entropy.
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',buf=[];
 for(let i=0;i<bytes.length;i+=3){
  const a=bytes[i],b=bytes[i+1],c=bytes[i+2];
  buf.push(alphabet[a>>2],alphabet[((a&3)<<4)|((b||0)>>4)],
   b===undefined?'=':alphabet[((b&15)<<2)|((c||0)>>6)],
   c===undefined?'=':alphabet[c&63]);
 }
 return buf.join('');
}
return {protocols,transports,securities,shadowsocksMethods,presets,defaults,analyze,countKnownCombinations,buildInbound,buildDocument,generateShadowsocksPassword};
})();