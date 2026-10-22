/* XMesh Studio 2026 — standalone editor; no legacy presentation adapters. */
window.XMeshStudio=(()=>{
'use strict';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $=(root,id)=>root.querySelector('[data-xm="'+id+'"]');
const inp=(id,title,value='',type='text',hint='')=>'<label class="xm-field"><span>'+title+'</span><input data-xm="'+id+'" type="'+type+'" value="'+esc(value)+'" autocomplete="off">'+(hint?'<small>'+hint+'</small>':'')+'</label>';
const select=(id,title,choices)=>'<label class="xm-field"><span>'+title+'</span><select data-xm="'+id+'">'+choices.map(a=>'<option value="'+esc(a[0])+'">'+esc(a[1])+'</option>').join('')+'</select></label>';
const uuid=()=>{if(globalThis.crypto?.randomUUID)return crypto.randomUUID();if(!globalThis.crypto?.getRandomValues)return '';const b=new Uint8Array(16);crypto.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)};
const hex=n=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return Array.from(a,x=>x.toString(16).padStart(2,'0')).join('')};
function view(){
return '<section class="xm-studio" id="xm-studio">'+
'<header class="xm-head"><div><div class="xm-eyebrow">XRAY STUDIO / CONFIGURATION</div><h2>Конфигурация подключения</h2><p>Только необходимые параметры. Проверка и результат — рядом.</p></div><div class="xm-modes"><button type="button" class="xm-mode is-active" data-xm-action="visual">Конструктор</button><button type="button" class="xm-mode" data-xm-action="manual">Ручной JSON</button><button type="button" class="xm-mode" data-xm-action="import">Импорт JSON</button><input type="file" data-xm="file" accept=".json,application/json" hidden></div></header>'+
'<div class="xm-commandbar"><div class="xm-command-copy"><strong>Настройка inbound</strong><span>Основные параметры всегда перед глазами. Дополнительные — по запросу.</span></div><div class="xm-command-actions"><button type="button" class="xm-quiet" data-xm-action="toggleSecurity">Защита и транспорт <span data-xm="securityIndicator">+</span></button><button type="button" class="xm-quiet" data-xm-action="toggleClient">Клиент <span data-xm="clientIndicator">+</span></button><button type="button" class="xm-quiet xm-json-button" data-xm-action="togglePreview">Показать JSON</button></div></div>'+ 
'<div class="xm-layout"><div class="xm-editor">'+
'<section class="xm-panel" data-xm-panel="profile"><div class="xm-section-title"><span>01</span><div><h3>Профиль</h3><p>Название и уникальный идентификатор inbound</p></div></div><div class="xm-fields xm-two">'+inp('name','Название','Новый профиль')+inp('tag','Тег inbound','vless-main')+'</div></section>'+
'<section class="xm-panel" data-xm-visual data-xm-panel="connection"><div class="xm-section-title"><span>02</span><div><h3>Соединение</h3><p>Протокол, транспорт и порт сервера</p></div></div><div class="xm-fields xm-three">'+
select('protocol','Протокол',[['vless','VLESS'],['vmess','VMess'],['trojan','Trojan'],['shadowsocks','Shadowsocks']])+
select('transport','Транспорт',[['xhttp','XHTTP'],['raw','TCP / RAW'],['ws','WebSocket'],['grpc','gRPC']])+
select('security','Защита',[['reality','Reality'],['tls','TLS'],['none','Без TLS']])+
'</div><div class="xm-fields xm-two">'+inp('listen','Слушать','0.0.0.0')+inp('port','Порт',443,'number')+'</div></section>'+
'<section class="xm-panel" data-xm-visual data-xm-panel="security"><div class="xm-section-title"><span>03</span><div><h3>Защита и транспорт</h3><p>Показываются только относящиеся к подключению настройки</p></div></div>'+
'<div class="xm-fields xm-two" data-xm-section="reality">'+inp('sni','Server Name / SNI','www.microsoft.com')+inp('target','Reality target','www.microsoft.com:443')+inp('private','Reality private key','','text','Нужен серверный X25519 private key')+inp('public','Reality public key','','text','Нужен клиентскому JSON')+inp('short','Short ID','','text')+'</div>'+
'<div class="xm-inline" data-xm-section="reality"><button type="button" class="xm-quiet" data-xm-action="keys">Сгенерировать Reality ключи</button><button type="button" class="xm-quiet" data-xm-action="short">Новый Short ID</button></div>'+
'<div class="xm-fields xm-two" data-xm-section="tls">'+inp('tlsSni','TLS Server Name','')+inp('cert','Путь сертификата','/etc/ssl/xray/fullchain.pem')+inp('key','Путь закрытого ключа','/etc/ssl/xray/privkey.pem')+'</div>'+
'<div class="xm-fields xm-two" data-xm-section="web">'+inp('path','Path','/xhttp')+inp('host','HTTP Host','')+'</div>'+
'<div class="xm-fields xm-two" data-xm-section="vless">'+select('encMode','VLESS Encryption',[['none','Отключено'],['mlkem','ML-KEM-768']])+inp('decryption','Server decryption','')+inp('encryption','Client encryption','')+'</div><div class="xm-inline" data-xm-section="vless"><button type="button" class="xm-quiet" data-xm-action="vlessenc">Получить VLESS Encryption ключи через Xray-core</button></div>'+
'<div class="xm-fields xm-two" data-xm-section="shadowsocks">'+select('ssMethod','Метод',[['chacha20-ietf-poly1305','ChaCha20-Poly1305'],['aes-256-gcm','AES-256-GCM']])+inp('password','Пароль','')+'</div>'+
'</section><section class="xm-panel" data-xm-visual data-xm-panel="client"><div class="xm-section-title"><span>04</span><div><h3>Клиент</h3><p>Адрес подключения и тестовые параметры Client JSON</p></div></div>'+
'<div class="xm-fields xm-two">'+select('endpoint','Публичный адрес',[['manual','Ввести вручную']])+inp('address','Домен или IP','','text','Не подставляем адрес панели или внутренний IP')+inp('clientPort','Публичный порт','443','number')+inp('clientId','UUID / пароль',uuid())+'</div>'+
'<p class="xm-hint">Профиль сервера сохраняется без добавления тестового клиента. Реальные пользователи привязываются отдельно.</p></section>'+
'<section class="xm-panel" data-xm-manual hidden><div class="xm-section-title"><span>JSON</span><div><h3>Полный серверный JSON</h3><p>Редактирование без скрытой конвертации или потери полей</p></div></div><textarea data-xm="manual" class="xm-manual" spellcheck="false" aria-label="Полный JSON сервера"></textarea><div class="xm-inline"><button class="xm-quiet" type="button" data-xm-action="format">Форматировать</button><button class="xm-quiet" type="button" data-xm-action="fromVisual">Заново из конструктора</button></div></section>'+
'</div><aside class="xm-preview"><div class="xm-preview-head"><div><strong>JSON</strong><span data-xm="status">Проверка…</span></div><div class="xm-modes"><button type="button" class="xm-tab is-active" data-xm-action="server">Server</button><button type="button" class="xm-tab" data-xm-action="client">Client</button></div></div><pre data-xm="output" tabindex="0" aria-label="Предпросмотр JSON"></pre><div class="xm-preview-tools"><button type="button" class="xm-quiet" data-xm-action="copy">Копировать</button><button type="button" class="xm-quiet" data-xm-action="download">Скачать</button><button type="button" class="xm-quiet" data-xm-action="expand">Во весь экран</button></div><div class="xm-diagnostics" data-xm="diagnostics" role="status" aria-live="polite"></div></aside></div>'+
'<footer class="xm-footer"><p>Сохранение не запускает и не перезапускает Xray на узлах.</p><button class="btn" type="button" data-xm-action="save">Сохранить профиль</button></footer></section>';
}
function mount(root,ctx){
let mode='visual',tab='server',server='',client='',serverError='',clientError='',manualDirty=false,busy=false,endpointList=[];
let openSecurity=false,openClient=false,previewOpen=false;
const syncSections=()=>{
 root.querySelectorAll('[data-xm-panel]').forEach(el=>{
   const part=el.dataset.xmPanel;
   el.hidden=mode!=='visual'||(part==='security'&&!openSecurity)||(part==='client'&&!openClient);
 });
 const preview=root.querySelector('.xm-preview');
 if(preview)preview.hidden=!previewOpen&&mode!=='manual';
 const toggle=root.querySelector('[data-xm-action="togglePreview"]');
 if(toggle){toggle.textContent=previewOpen?'Скрыть JSON':'Показать JSON';toggle.setAttribute('aria-expanded',String(previewOpen))}
 const sec=$(root,'securityIndicator'),client=$(root,'clientIndicator');
 if(sec)sec.textContent=openSecurity?'−':'+';
 if(client)client.textContent=openClient?'−':'+';
 root.classList.toggle('xm-show-preview',previewOpen||mode==='manual');
};
const v=id=>$(root,id)?.value?.trim()||'';
const set=(id,value)=>{const e=$(root,id);if(e)e.value=value};
const info=(msg,bad=false)=>{const el=$(root,'status');if(el){el.textContent=msg;el.dataset.bad=bad?'1':'0'}};
const active=(section,shown)=>root.querySelectorAll('[data-xm-section="'+section+'"]').forEach(el=>{el.hidden=!shown});
function refreshFields(){
const protocol=v('protocol'),sec=v('security'),net=v('transport');
if(protocol==='shadowsocks'&&sec==='reality')set('security','none');
if(net==='ws'&&v('security')==='reality')set('security','tls');
active('reality',v('security')==='reality');active('tls',v('security')==='tls');
active('web',net!=='raw');active('vless',protocol==='vless');active('shadowsocks',protocol==='shadowsocks');
}
function refreshEndpoints(){
const old=v('endpoint'),tag=v('tag'),opts=[['manual','Ввести вручную']];
for(const h of ctx.DB.hosts||[])if(h.tag===tag&&h.address&&!/^(127\.|10\.|192\.168\.|localhost$)/i.test(h.address))opts.push(['host:'+h.id,'Хост: '+(h.remark||h.address)]);
for(const n of ctx.DB.nodes||[])if(n.addr&&!/^(127\.|10\.|192\.168\.|localhost$)/i.test(n.addr))opts.push(['node:'+n.id,'Узел: '+(n.name||n.addr)]);
const e=$(root,'endpoint');e.innerHTML=opts.map(a=>'<option value="'+esc(a[0])+'">'+esc(a[1])+'</option>').join('');
e.value=opts.some(a=>a[0]===old)?old:'manual';endpointList=opts;
}
function currentEndpoint(){
const id=v('endpoint'),all=[...(ctx.DB.hosts||[]).map(h=>({key:'host:'+h.id,address:h.address,port:h.port,sni:h.sni})),...(ctx.DB.nodes||[]).map(n=>({key:'node:'+n.id,address:n.addr,port:n.port}))];
return all.find(x=>x.key===id)||null;
}
const config=()=>{
const proto=v('protocol'),sec=v('security'),net=v('transport'),tag=v('tag'),port=Number(v('port'));
if(!tag||! /^[\w.-]{1,64}$/.test(tag))throw Error('Тег: 1–64 символа, латиница, цифры, точка, _ или -.');
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Порт inbound должен быть от 1 до 65535.');
const settings=proto==='vless'?{users:[],decryption:v('encMode')==='mlkem'?v('decryption'):'none'}:
proto==='vmess'?{users:[]}:proto==='trojan'?{clients:[]}: {method:v('ssMethod'),password:v('password'),network:'tcp,udp'};
const inbound={tag,listen:v('listen')||'0.0.0.0',port,protocol:proto,settings};
const stream={network:net,security:sec};
if(net==='xhttp')stream.xhttpSettings={path:v('path')||'/xhttp',mode:'auto',...(v('host')?{host:v('host')}:{})};
if(net==='ws')stream.wsSettings={path:v('path')||'/',...(v('host')?{headers:{Host:v('host')}}:{})};
if(net==='grpc')stream.grpcSettings={serviceName:(v('path')||'/grpc').replace(/^\//,'')};
if(sec==='reality')stream.realitySettings={show:false,target:v('target'),serverNames:[v('sni')].filter(Boolean),privateKey:v('private'),shortIds:[v('short')]};
if(sec==='tls')stream.tlsSettings={serverName:v('tlsSni')||undefined,certificates:[{certificateFile:v('cert'),keyFile:v('key')}]};
inbound.streamSettings=stream;
return {log:{loglevel:'warning'},stats:{},policy:{levels:{'0':{statsUserUplink:true,statsUserDownlink:true}}},inbounds:[inbound],outbounds:[{tag:'direct',protocol:'freedom'},{tag:'block',protocol:'blackhole'}]};
};
const clientConfig=()=>{
const proto=v('protocol'),net=v('transport'),sec=v('security'),ep=currentEndpoint(),address=(ep?.address||v('address')),port=Number(ep?.port||v('clientPort')),id=v('clientId');
if(!address)throw Error('Для Client JSON выберите публичный адрес или введите его.');
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Неверный публичный порт.');
if(!id)throw Error('Для Client JSON нужен UUID или пароль.');
let settings=proto==='vless'||proto==='vmess'?{vnext:[{address,port,users:[proto==='vless'?{id,encryption:v('encMode')==='mlkem'?v('encryption'):'none'}:{id,alterId:0,security:'auto'}]}]}:
proto==='trojan'?{servers:[{address,port,password:id}]}:{servers:[{address,port,method:v('ssMethod'),password:v('password')}]};
const stream={network:net,security:sec};
if(net==='xhttp')stream.xhttpSettings={path:v('path')||'/xhttp',mode:'auto',...(v('host')?{host:v('host')}:{})};
if(net==='ws')stream.wsSettings={path:v('path')||'/'};
if(net==='grpc')stream.grpcSettings={serviceName:(v('path')||'/grpc').replace(/^\//,'')};
if(sec==='reality')stream.realitySettings={serverName:ep?.sni||v('sni'),fingerprint:'chrome',publicKey:v('public'),shortId:v('short')};
if(sec==='tls')stream.tlsSettings={serverName:ep?.sni||v('tlsSni')||address,allowInsecure:false};
return {log:{loglevel:'warning'},dns:{queryStrategy:'UseIPv4',servers:['1.1.1.1']},inbounds:[{tag:'socks',listen:'127.0.0.1',port:10808,protocol:'socks',settings:{auth:'noauth',udp:true}},{tag:'http',listen:'127.0.0.1',port:10809,protocol:'http',settings:{}}],outbounds:[{tag:'proxy',protocol:proto,settings,streamSettings:stream},{tag:'direct',protocol:'freedom'},{tag:'block',protocol:'blackhole'}],routing:{rules:[{type:'field',inboundTag:['socks','http'],outboundTag:'proxy'}]}};
};
function validation(obj){
if(!obj||typeof obj!=='object'||Array.isArray(obj)||!Array.isArray(obj.inbounds)||!obj.inbounds.length)throw Error('Нужен объект JSON с непустым массивом inbounds.');
const tags=obj.inbounds.map(i=>String(i?.tag||''));if(tags.some(x=>!x)||new Set(tags).size!==tags.length)throw Error('Каждому inbound нужен уникальный тег.');
for(const inbound of obj.inbounds){
if(inbound?.streamSettings?.security==='reality'){
const r=inbound.streamSettings.realitySettings||{};
if(!r.privateKey||!Array.isArray(r.shortIds)||!r.serverNames?.length||!r.target)throw Error('Reality: нужны private key, target, SNI и Short ID.');
if(r.shortIds.some(s=>s.length>16||s.length%2||!/^[a-fA-F0-9]*$/.test(s)))throw Error('Reality: некорректный Short ID.');
}
if(inbound.protocol==='vless'&&(!inbound.settings?.decryption||String(inbound.settings.decryption).startsWith('REPLACE_')))throw Error('VLESS: укажите корректный decryption.');
if(inbound.protocol==='shadowsocks'&&!inbound.settings?.password)throw Error('Shadowsocks: заполните пароль.');
}
}
function refresh(){
refreshFields();
serverError='';clientError='';
try{server=JSON.stringify(mode==='manual'?JSON.parse(v('manual')):config(),null,2)}catch(e){server='';serverError=e.message}
if(mode==='manual'){client='';clientError='В ручном режиме клиентский JSON не генерируется из произвольного Server JSON. Используйте персональный экспорт пользователя.'}
else try{client=JSON.stringify(clientConfig(),null,2)}catch(e){client='';clientError=e.message}
const current=tab==='server'?server:client;
$(root,'output').textContent=current||(tab==='server'?'Server JSON пока недоступен':'Client JSON пока недоступен');
const problem=tab==='server'?serverError:clientError;
info(problem?'Исправьте параметры':'Предпросмотр готов',!!problem);
$(root,'diagnostics').textContent=problem||'';
}
function switchMode(next){
if(mode===next)return;
if(next==='manual'&&!manualDirty)set('manual',server||'{\n  "inbounds": []\n}');
mode=next;
root.querySelectorAll('[data-xm-visual]').forEach(x=>x.hidden=next!=='visual');
root.querySelectorAll('[data-xm-manual]').forEach(x=>x.hidden=next!=='manual');
syncSections();
root.querySelectorAll('[data-xm-action="visual"],[data-xm-action="manual"]').forEach(b=>b.classList.toggle('is-active',b.dataset.xmAction===next));
refresh();
}
const download=()=>{const data=tab==='server'?server:client;if(!data)return;const url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=(v('name').replace(/[^a-z0-9-]+/gi,'-')||'xray')+'-'+tab+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
const actions={
toggleSecurity:()=>{openSecurity=!openSecurity;syncSections()},
toggleClient:()=>{openClient=!openClient;syncSections()},
togglePreview:()=>{previewOpen=!previewOpen;syncSections()},
visual:()=>switchMode('visual'),manual:()=>switchMode('manual'),
import:()=>$(root,'file').click(),
server:()=>{tab='server';root.querySelectorAll('.xm-tab').forEach(x=>x.classList.toggle('is-active',x.dataset.xmAction===tab));refresh()},
client:()=>{tab='client';root.querySelectorAll('.xm-tab').forEach(x=>x.classList.toggle('is-active',x.dataset.xmAction===tab));refresh()},
short:()=>{set('short',hex(8));refresh()},
keys:async()=>{try{const kp=await ctx.realityKeys();set('private',kp.privateKey);set('public',kp.publicKey);refresh()}catch(e){ctx.toast(e.message||'Не удалось создать Reality ключи')}},
vlessenc:async()=>{try{const pair=await ctx.apiRequest('/api/v1/core/vlessenc',{method:'POST',body:JSON.stringify({})});set('encMode','mlkem');set('decryption',pair.mlkem768?.decryption||'');set('encryption',pair.mlkem768?.encryption||'');refresh()}catch(e){ctx.toast(e.message||'VLESS Encryption недоступен')}},
format:()=>{try{set('manual',JSON.stringify(JSON.parse(v('manual')),null,2));refresh()}catch(e){ctx.toast(e.message)}},
fromVisual:()=>{if(!confirm('Заменить ручной JSON данными конструктора?'))return;set('manual',JSON.stringify(config(),null,2));manualDirty=false;refresh()},
copy:async()=>{const data=tab==='server'?server:client;if(!data)return;try{await navigator.clipboard.writeText(data);ctx.toast('JSON скопирован')}catch(e){ctx.toast('Не удалось скопировать: '+e.message)}},
download,expand:()=>root.classList.toggle('xm-expanded'),
save:async()=>{if(busy)return;busy=true;const button=root.querySelector('[data-xm-action="save"]');button.disabled=true;
try{
const name=v('name');if(!name)throw Error('Укажите название профиля.');
if(ctx.DB.profiles.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw Error('Такое название профиля уже существует.');
const obj=mode==='manual'?JSON.parse(v('manual')):config();validation(obj);
const used=new Set(ctx.DB.profiles.flatMap(p=>{try{return JSON.parse(p.config).inbounds.map(i=>i.tag)}catch{return[]}}));
if(obj.inbounds.some(i=>used.has(i.tag)))throw Error('Тег inbound уже используется другим профилем.');
await ctx.api.create('profiles',{name,config:JSON.stringify(obj,null,2)});
ctx.toast('Профиль сохранён');await ctx.render();
}catch(e){ctx.toast('Не удалось сохранить: '+e.message);$(root,'diagnostics').textContent=e.message;info('Ошибка сохранения',true)}
finally{busy=false;button.disabled=false}}
};
root.addEventListener('click',event=>{const el=event.target.closest('[data-xm-action]');if(!el||!root.contains(el))return;event.preventDefault();Promise.resolve(actions[el.dataset.xmAction]?.()).catch(e=>ctx.toast(e.message))});
root.addEventListener('input',event=>{if(event.target?.dataset.xm==='manual')manualDirty=true;refresh()});
root.addEventListener('change',event=>{if(event.target?.dataset.xm==='endpoint'){const ep=currentEndpoint();if(ep){set('address',ep.address||'');set('clientPort',ep.port||443)}}refresh()});
$(root,'file').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>1024*1024)throw Error('JSON больше 1 МБ');const raw=await file.text();const parsed=JSON.parse(raw);validation(parsed);set('manual',JSON.stringify(parsed,null,2));manualDirty=true;switchMode('manual');refresh();ctx.toast('JSON импортирован')}catch(ex){ctx.toast('Ошибка импорта: '+ex.message)}finally{e.target.value=''}});
root.addEventListener('keydown',e=>{if(e.key==='Escape')root.classList.remove('xm-expanded');if(e.key==='Tab'&&e.target===$(root,'manual')){e.preventDefault();const t=e.target,start=t.selectionStart;t.setRangeText('  ',start,t.selectionEnd,'end');manualDirty=true;refresh()}});
set('short',hex(8));refreshEndpoints();syncSections();refresh();
}
return {view,mount};
})();