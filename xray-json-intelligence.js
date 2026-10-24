/* XRAY STUDIO — explainable Xray-aware diagnostics.
   Heuristic offline assistant, not a model and not an xray-core parser.
   Strict JSON token positions underpin contextual diagnostics. */
(function(global){
'use strict';
const MAX_BYTES=900000, MAX_ISSUES=100;
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const sets={
 root:['log','api','dns','routing','policy','inbounds','outbounds','transport','stats','reverse','fakedns','observatory','burstObservatory','browserForwarder','metrics','assets','services','subscription'],
 endpoint:['tag','listen','port','protocol','settings','streamSettings','sniffing','allocate','sendThrough','mux','proxySettings'],
 stream:['network','security','sockopt','rawSettings','tcpSettings','xhttpSettings','splithttpSettings','wsSettings','grpcSettings','httpupgradeSettings','kcpSettings','tlsSettings','realitySettings','hysteriaSettings','masqueSettings','xdriveSettings','finalmask','address','port','method'],
 reality:['show','target','dest','xver','serverNames','serverName','privateKey','publicKey','shortIds','shortId','fingerprint','spiderX','minClientVer','maxClientVer','maxTimeDiff','mldsa65Seed','mldsa65Verify','masterKeyLog','limitFallbackUpload','limitFallbackDownload'],
 xhttp:['host','path','mode','headers','xPaddingBytes','xPaddingObfsMode','xPaddingKey','xPaddingHeader','xPaddingPlacement','xPaddingMethod','uplinkHTTPMethod','sessionIDPlacement','sessionIDKey','sessionIDTable','sessionIDLength','seqPlacement','seqKey','uplinkDataPlacement','uplinkDataKey','uplinkChunkSize','noGRPCHeader','noSSEHeader','scMaxEachPostBytes','scMinPostsIntervalMs','scMaxBufferedPosts','scStreamUpServerSecs','serverMaxHeaderBytes','xmux','downloadSettings','extra'],
 xmux:['maxConcurrency','maxConnections','cMaxReuseTimes','hMaxRequestTimes','hMaxReusableSecs','hKeepAlivePeriod']
};
const networkAliases={tcp:'raw',raw:'raw',xhttp:'xhttp',splithttp:'xhttp',ws:'ws',websocket:'ws',grpc:'grpc',httpupgrade:'httpupgrade',mkcp:'mkcp',kcp:'mkcp',hysteria:'hysteria',masque:'masque',xdrive:'xdrive'};
const networks=['raw','tcp','xhttp','splithttp','ws','websocket','grpc','httpupgrade','mkcp','kcp','hysteria','masque','xdrive'];
const deprecatedNetworks=['h2','h3','http','quic'];
const inboundProtocols=['vless','vmess','trojan','shadowsocks','socks','mixed','http','dokodemo-door','tunnel','wireguard','hysteria','masque','tun'];
const outboundProtocols=['freedom','blackhole','block','vless','vmess','trojan','shadowsocks','socks','http','dns','wireguard','loopback','hysteria','masque'];
const issueCode=(severity,code,message,at,path,fix)=>({severity,kind:severity==='error'?'structure':severity,message,code,start:at?.start??0,end:at?.end??1,path,fix:fix||null});
function tokenize(source){
 const tokens=[];let i=0;
 while(i<source.length){
  const c=source[i];
  if(/\s/.test(c)){i++;continue}
  if('{}[]:,'.includes(c)){tokens.push({type:c,start:i,end:++i});continue}
  if(c==='"'){
   let j=i+1,esc=false;
   while(j<source.length){if(esc){esc=false;j++;continue}if(source[j]==='\\'){esc=true;j++;continue}if(source[j++]==='"')break}
   const raw=source.slice(i,j);
   tokens.push({type:'string',value:JSON.parse(raw),start:i,end:j});
   i=j;continue;
  }
  if(/[tfn\-0-9]/.test(c)){
   const matched=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(i));
   if(!matched)throw Error('Invalid literal');
   tokens.push({type:'primitive',value:JSON.parse(matched[0]),start:i,end:i+matched[0].length});
   i+=matched[0].length;continue;
  }
  throw Error('Unknown token');
 }
 return tokens;
}
function indexTree(source){
 const tokens=tokenize(source);let i=0,depth=0;
 function read(path){
  if(++depth>80)throw Error('Too deeply nested');
  const t=tokens[i++];if(!t)throw Error('Unexpected end');
  let node={start:t.start,end:t.end,path,value:null,properties:[],elements:[]};
  if(t.type==='{'){
   node.type='object';node.value={};
   while(tokens[i]?.type!=='}'){
    const key=tokens[i++];if(!key||key.type!=='string'||tokens[i++]?.type!==':')throw Error('Bad object');
    const child=read(path.concat(key.value));
    node.properties.push({key:key.value,keyToken:key,node:child});
    if(tokens[i]?.type===',')i++;
    else if(tokens[i]?.type!=='}')throw Error('Bad object separator');
   }
   node.end=tokens[i++].end;
  }else if(t.type==='['){
   node.type='array';node.value=[];
   while(tokens[i]?.type!==']'){
    const child=read(path.concat(node.elements.length));
    node.elements.push(child);
    if(tokens[i]?.type===',')i++;
    else if(tokens[i]?.type!==']')throw Error('Bad array separator');
   }
   node.end=tokens[i++].end;
  }else{
   node.type=typeof t.value;
   node.value=t.value;
   node.end=t.end;
  }
  depth--;return node;
 }
 const root=read([]);
 if(i!==tokens.length)throw Error('Unused tokens');
 return root;
}
function prop(node,key){return node?.type==='object'?node.properties.find(p=>p.key===key)?.node:undefined}
function entry(node,key){return node?.type==='object'?node.properties.find(p=>p.key===key):undefined}
function items(node){return node?.type==='array'?node.elements:[]}
function primitive(n){return n&&n.type!=='object'&&n.type!=='array'?n.value:undefined}
function location(source,index){
 const before=source.slice(0,index);
 const segments=before.split('\n');
 return {line:segments.length,column:segments[segments.length-1].length+1};
}
function distance(a,b){
 if(Math.abs(a.length-b.length)>2)return 99;
 const matrix=Array.from({length:a.length+1},(_,i)=>[i]);
 for(let j=0;j<=b.length;j++)matrix[0][j]=j;
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)
  matrix[i][j]=Math.min(matrix[i-1][j]+1,matrix[i][j-1]+1,matrix[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
 return matrix[a.length][b.length];
}
function analyze(source,data){
 if(source.length>MAX_BYTES)return [{severity:'info',kind:'info',code:'SIZE_LIMIT',message:'Глубокий анализ ограничен 900 КБ: для этого файла доступна только проверка синтаксиса.',line:1,column:1,start:0,end:1,fix:null}];
 let root;try{root=indexTree(source)}catch{return []}
 const issues=[];
 function add(severity,code,message,node,path,fix){
  if(issues.length>=MAX_ISSUES)return;
  const d=issueCode(severity,code,message,node,path,fix);
  Object.assign(d,location(source,d.start));
  issues.push(d);
 }
 function wrongKeys(node,allowed,path){
  if(!node||node.type!=='object')return;
  const keys=node.properties.map(x=>x.key);
  const seen=new Set();
  for(const p of node.properties){
   if(seen.has(p.key)){
    add('error','DUPLICATE_KEY','Повторяющееся поле «'+p.key+'»: Xray/JSON использует последнее значение, предыдущее будет потеряно.',p.keyToken,path.concat(p.key));continue;
   }
   seen.add(p.key);
   if(allowed.includes(p.key))continue;
   const near=allowed.map(v=>({v,d:distance(p.key.toLowerCase(),v.toLowerCase())})).filter(x=>x.d>0&&x.d<=2).sort((a,b)=>a.d-b.d);
   if(!near.length||near[0].d===near[1]?.d)continue;
   const name=near[0].v;
   const replacement=JSON.stringify(name);
   // only an unambiguous spelling correction; never overwrite existing fields.
   const fix=keys.includes(name)?null:{start:p.keyToken.start,end:p.keyToken.end,replacement,label:'Исправить название на '+name,confidence:'high'};
   add('warning','MISSPELLED_KEY','Возможно, «'+p.key+'» — опечатка. Для этого раздела известно поле «'+name+'».',p.keyToken,path.concat(p.key),fix);
  }
 }
 function checkPort(node,required,path){
  if(!node){if(required)add('warning','NO_PORT','Для входящего подключения обычно требуется порт.',root,path);return}
  const n=primitive(node);
  if(!(typeof n==='number'&&Number.isInteger(n)&&n>=1&&n<=65535) &&
     !(typeof n==='string'&&(/^\d{1,5}$/.test(n)||/^\d{1,5}-\d{1,5}$/.test(n)))){
    add('error','BAD_PORT','Порт должен быть числом 1–65535 или допустимым диапазоном портов.',node,path);return;
  }
  if(typeof n==='string'&&n.includes('-')){
   const [a,b]=n.split('-').map(Number);
   if(a<1||b>65535||a>b)add('error','BAD_PORT_RANGE','У диапазона портов границы должны быть 1–65535 по возрастанию.',node,path);
  }else if(Number(n)>65535||Number(n)<1)add('error','BAD_PORT','Порт должен быть от 1 до 65535.',node,path);
 }
 function validateStream(n,path,role){
  if(!n)return;
  if(n.type!=='object'){add('error','TYPE_STREAM','streamSettings должен быть объектом.',n,path);return}
  wrongKeys(n,sets.stream,path);
  const networkNode=prop(n,'method')||prop(n,'network'), secNode=prop(n,'security');
  const network=primitive(networkNode)||'raw', security=primitive(secNode)||'none';
  const canonical=networkAliases[network]||network;
  if(networkNode&&typeof network!=='string')add('error','TYPE_NETWORK','method/network должен быть строкой.',networkNode,path.concat(networkNode===prop(n,'method')?'method':'network'));
  else if(deprecatedNetworks.includes(network))add('error','REMOVED_NETWORK','Транспорт '+network+' удалён из актуальных версий Xray-core. Обычно вместо него используют XHTTP.',networkNode,path.concat('network'));
  else if(!networks.includes(network))add('warning','UNKNOWN_NETWORK','Транспорт «'+network+'» не удалось сопоставить с известными вариантами Xray-core.',networkNode,path.concat('network'));
  if(secNode&&!['none','tls','reality'].includes(security))add('error','UNKNOWN_SECURITY','Поддерживаются значения security: none, tls и reality.',secNode,path.concat('security'));
  if(security==='reality'){
   if(!['raw','xhttp','grpc'].includes(canonical))add('error','REALITY_TRANSPORT','REALITY совместим с RAW/TCP, XHTTP и gRPC; выбран '+network+'.',secNode||networkNode||n,path.concat('security'));
   if(!prop(n,'realitySettings'))add('error','REALITY_MISSING','Для security: reality требуется объект realitySettings.',secNode||n,path.concat('realitySettings'));
  }
  if(security==='tls'&&!prop(n,'tlsSettings'))add('warning','TLS_SETTINGS','Для TLS проверьте tlsSettings и наличие сертификата или другого поддерживаемого источника ключей.',secNode||n,path.concat('tlsSettings'));
  const reality=prop(n,'realitySettings');
  if(reality&&security!=='reality')
   add('warning','REALITY_INACTIVE','realitySettings присутствует, но security не равен reality — Xray игнорирует эти настройки. Выберите REALITY или удалите неиспользуемые настройки.',reality,path.concat('realitySettings'));
  if(reality&&reality.type==='object'){
   wrongKeys(reality,sets.reality,path.concat('realitySettings'));
   const ids=prop(reality,'shortIds');
   if(ids){
    if(ids.type!=='array')add('error','SHORTIDS_TYPE','shortIds должен быть массивом шестнадцатеричных строк.',ids,path.concat('realitySettings','shortIds'));
    else items(ids).forEach((id,j)=>{
     const v=primitive(id);
     if(typeof v!=='string'||!/^(?:[a-fA-F0-9]{2}){0,8}$/.test(v))
      add('error','SHORTID_FORMAT','Short ID должен состоять из чётного количества HEX-символов (не более 16); пустая строка допускается.',id,path.concat('realitySettings','shortIds',j));
    });
   }
   const key=prop(reality,role==='inbound'?'privateKey':'publicKey');
   if(role==='inbound'&&!key&&security==='reality')add('warning','REALITY_KEY','Для серверного REALITY нужен privateKey X25519. Создайте его через «Настроить REALITY».',reality,path.concat('realitySettings','privateKey'));
   if(role==='inbound'&&key&&typeof primitive(key)==='string'&&primitive(key)&&!/^[A-Za-z0-9_-]{43}$/.test(primitive(key)))
    add('error','REALITY_PRIVATEKEY_FORMAT','Некорректный X25519 privateKey: ожидается base64url из 43 символов. Возможно, браузер подставил пароль администратора. Не сохраняйте такой JSON; используйте «Настроить REALITY».',key,path.concat('realitySettings','privateKey'));
   else if(key&&typeof primitive(key)==='string'&&/REPLACE|YOUR[_-]?KEY|example/i.test(primitive(key)))
    add('warning','PLACEHOLDER_KEY','Похоже, здесь пример ключа, а не реальный ключ REALITY.',key,path.concat('realitySettings',role==='inbound'?'privateKey':'publicKey'));
  }
  const xhttp=prop(n,'xhttpSettings')||prop(n,'splithttpSettings');
  if(canonical==='xhttp'&&!xhttp)add('warning','XHTTP_MISSING','Для XHTTP рекомендуется явно задать xhttpSettings (например, path и mode).',networkNode||n,path.concat('xhttpSettings'));
  if(xhttp){
   if(canonical!=='xhttp')add('warning','XHTTP_INACTIVE','xhttpSettings указаны, но network не равен xhttp. Эти настройки могут игнорироваться.',xhttp,path.concat('xhttpSettings'));
   if(xhttp.type!=='object'){add('error','XHTTP_TYPE','xhttpSettings должен быть объектом.',xhttp,path.concat('xhttpSettings'))}
   else{
    const xp=path.concat('xhttpSettings');wrongKeys(xhttp,sets.xhttp,xp);
    const mode=prop(xhttp,'mode');
    if(mode&&!['auto','packet-up','stream-up','stream-one'].includes(primitive(mode)))
     add('error','XHTTP_MODE','Неизвестный режим XHTTP: допустимы auto, packet-up, stream-up, stream-one.',mode,xp.concat('mode'));
    const route=prop(xhttp,'path');
    if(route&&typeof primitive(route)==='string'&&!primitive(route).startsWith('/')){
     const old=primitive(route),fix={start:route.start,end:route.end,replacement:JSON.stringify('/'+old),label:'Добавить / перед path',confidence:'high'};
     add('warning','XHTTP_PATH','Путь XHTTP обычно начинается с символа «/».',route,xp.concat('path'),fix);
    }
    const extra=prop(xhttp,'extra');
    if(extra&&extra.type!=='object')add('error','XHTTP_EXTRA_TYPE','extra внутри xhttpSettings должен быть объектом.',extra,xp.concat('extra'));
    // Xray accepts advanced values in XHTTP extra; the editor generates
    // its extended options here, not at the top level.
    const advanced=extra?.type==='object'?extra:xhttp;
    const ap=extra?.type==='object'?xp.concat('extra'):xp;
    const xmux=prop(advanced,'xmux')||prop(xhttp,'xmux');
    const muxPath=prop(advanced,'xmux')?ap:xp;
    if(xmux){
     if(xmux.type!=='object')add('error','XMUX_TYPE','xmux должен быть объектом.',xmux,ap.concat('xmux'));
     else{
      wrongKeys(xmux,sets.xmux,muxPath.concat('xmux'));
      const mx=prop(xmux,'maxConcurrency'), mc=prop(xmux,'maxConnections');
      const greaterThanZero=n=>{const x=primitive(n);return typeof x==='number'?x>0:typeof x==='string'?Number(x.split('-').at(-1))>0:false};
      if(greaterThanZero(mx)&&greaterThanZero(mc))add('warning','XMUX_CONFLICT','maxConcurrency и maxConnections одновременно заданы положительными. Проверьте выбор стратегии xmux.',mc,muxPath.concat('xmux','maxConnections'));
     }
    }
    for(const field of ['xPaddingBytes','scMaxEachPostBytes','scMinPostsIntervalMs','uplinkChunkSize','sessionIDLength','scStreamUpServerSecs']){
     const val=prop(advanced,field)||prop(xhttp,field);if(!val)continue;
     const raw=primitive(val);
     if(!(typeof raw==='number'&&Number.isInteger(raw)&&raw>=0)&&!(typeof raw==='string'&&/^\d+(?:-\d+)?$/.test(raw)))
      add('warning','XHTTP_RANGE','Для '+field+' ожидается неотрицательное число или диапазон, например «10-50».',val,ap.concat(field));
    }
   }
  }
 }
 function validateEndpoint(n,index,role){
  const base=[role==='inbound'?'inbounds':'outbounds',index];
  if(n.type!=='object'){add('error','ENDPOINT_TYPE','Элемент '+role+' должен быть объектом.',n,base);return}
  wrongKeys(n,sets.endpoint,base);
  const protocol=prop(n,'protocol'),tag=prop(n,'tag');
  if(!protocol)add('error','NO_PROTOCOL','Не задан protocol: укажите тип подключения.',n,base.concat('protocol'));
  else if(typeof primitive(protocol)!=='string')add('error','PROTOCOL_TYPE','protocol должен быть строкой.',protocol,base.concat('protocol'));
  else if(!(role==='inbound'?inboundProtocols:outboundProtocols).includes(primitive(protocol)))
   add('warning','UNKNOWN_PROTOCOL','Неизвестный '+role+' protocol: '+primitive(protocol)+'. Проверьте поддержку текущей версией Xray.',protocol,base.concat('protocol'));
  if(tag&&typeof primitive(tag)!=='string')add('error','TAG_TYPE','tag должен быть строкой.',tag,base.concat('tag'));
  if(role==='inbound')checkPort(prop(n,'port'),true,base.concat('port'));
  const stream=prop(n,'streamSettings');validateStream(stream,base.concat('streamSettings'),role);
  const settings=prop(n,'settings');
  const p=primitive(protocol);
  if(['vless','trojan','vmess'].includes(p)&&!settings)add('warning','NO_SETTINGS','У протокола '+p+' отсутствует settings; проверьте, кто управляет пользователями и учётными данными.',protocol||n,base.concat('settings'));
  if(p==='vless'&&role==='inbound'&&settings?.type==='object'){
   const dec=prop(settings,'decryption');
   if(!dec)add('warning','VLESS_DECRYPTION','Для VLESS inbound укажите settings.decryption: "none" или актуальную конфигурацию шифрования.',settings,base.concat('settings','decryption'));
   else if(primitive(dec)==='')add('error','VLESS_EMPTY_DECRYPTION','Пустой decryption недопустим: используйте "none" либо ключ VLESS Encryption.',dec,base.concat('settings','decryption'),
     {start:dec.start,end:dec.end,replacement:'"none"',label:'Заменить пустое decryption на none',confidence:'high'});
  }
  if(p==='vless'&&stream?.type==='object'&&(!prop(stream,'security')||primitive(prop(stream,'security'))==='none')){
   add('info','VLESS_NO_TLS','VLESS без TLS/REALITY требует доверенной сети или VLESS Encryption; убедитесь, что соединение защищено.',stream,base.concat('streamSettings'));
  }
  if(p==='vless'&&settings?.type==='object'){
   const users=prop(settings,'users');
   if(users?.type==='array'){
    items(users).forEach((u,j)=>{
     const id=prop(u,'id');const val=primitive(id);
     if(id&&typeof val==='string'&&/REPLACE|YOUR_UUID|example/i.test(val))add('warning','ID_PLACEHOLDER','Похоже, здесь демонстрационный ID, а не реальный идентификатор клиента.',id,base.concat('settings','users',j,'id'));
    });
   }
  }
 }
 if(root.type!=='object'){add('error','ROOT_OBJECT','Корень конфигурации Xray должен быть объектом.',root,[]);return issues}
 wrongKeys(root,sets.root,[]);
 const hasInbounds=prop(root,'inbounds'),hasOutbounds=prop(root,'outbounds');
 if(!hasInbounds&&!hasOutbounds)add('error','EMPTY_CONFIG','Добавьте хотя бы один inbounds или outbounds, иначе Xray не будет обрабатывать подключения.',root,[]);
 for(const [field,role] of [['inbounds','inbound'],['outbounds','outbound']]){
  const a=prop(root,field);if(!a)continue;
  if(a.type!=='array')add('error','LIST_TYPE',field+' должен быть массивом.',a,[field]);
  else items(a).forEach((node,i)=>validateEndpoint(node,i,role));
 }
 const all=[...items(hasInbounds),...items(hasOutbounds)].flatMap((n,i)=>{const t=prop(n,'tag');return t&&typeof primitive(t)==='string'?[{name:primitive(t),node:t,i}]:[]});
 const used=new Map();
 for(const tag of all){
  if(used.has(tag.name))add('warning','DUPLICATE_TAG','Тег «'+tag.name+'» используется несколько раз. Маршрутизация по нему может стать неоднозначной.',tag.node,['tag']);
  else used.set(tag.name,tag);
 }
 const rules=items(prop(prop(root,'routing'),'rules'));
 for(const [idx,rule] of rules.entries()){
  const target=prop(rule,'outboundTag'),val=primitive(target);
  if(target&&typeof val==='string'&&items(hasOutbounds).length&&!items(hasOutbounds).some(n=>primitive(prop(n,'tag'))===val)){
   const balancer=prop(rule,'balancerTag');
   if(!balancer)add('warning','MISSING_OUTBOUND_TAG','Маршрут ссылается на отсутствующий outboundTag «'+val+'».',target,['routing','rules',idx,'outboundTag']);
  }
 }
 if(issues.length>=MAX_ISSUES)issues.push({severity:'info',kind:'info',code:'TRUNCATED',message:'Показаны первые '+MAX_ISSUES+' замечаний.',start:0,end:1,...location(source,0),fix:null});
 return issues.sort((a,b)=>(a.start??0)-(b.start??0));
}
global.XrayJsonIntelligence={analyze,indexTree,MAX_BYTES};
})(window);
