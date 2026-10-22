/* XRAY STUDIO v4: JSON-first 2-in-1 editor, server configuration only. */
window.XMeshStudioV4=(()=>{
'use strict';
const escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=(r,k)=>r.querySelector('[data-v="'+k+'"]');
const field=(k,title,type='text')=>'<label class="sv-field"><span>'+title+'</span><input data-field="'+k+'" type="'+type+'" autocomplete="off"></label>';
const select=(k,title,values)=>'<label class="sv-field"><span>'+title+'</span><select data-field="'+k+'">'+values.map(a=>'<option value="'+a[0]+'">'+a[1]+'</option>').join('')+'</select></label>';
const inboundSettingsFor=(protocol)=>{
 switch(protocol){
  case 'vless':return {users:[],decryption:'none'};
  case 'vmess':return {users:[]};
  case 'trojan':return {users:[]};
  case 'shadowsocks':return {network:'tcp,udp',method:'2022-blake3-aes-128-gcm',password:''};
  case 'hysteria':return {version:2,users:[]};
  case 'socks':return {auth:'noauth',accounts:[],udp:true};
  case 'http':return {accounts:[]};
  default:throw Error('Неподдерживаемый протокол '+protocol);
 }
};
const newInbound=(protocol='vless',tag='inbound-1')=>({
 tag,listen:'0.0.0.0',port:443,protocol,
 settings:inboundSettingsFor(protocol),
 streamSettings:{network:'raw',security:'none'}
});
function migrateInboundProtocol(inbound,next){
 if(inbound.protocol===next)return;
 const previous=inbound.protocol;
 const currentSettings=inbound.settings||{};
 const userCount=(currentSettings.users||currentSettings.clients||[]).length;
 if(userCount&&!confirm('Смена протокола удалит '+userCount+' пользователей из настроек inbound. Продолжить?'))throw Error('Смена протокола отменена.');
 if(!confirm('Переключить '+previous+' на '+next+'? Специфичные настройки предыдущего протокола будут заменены.'))throw Error('Смена протокола отменена.');
 inbound.protocol=next;inbound.settings=inboundSettingsFor(next);
 if(next==='hysteria')inbound.streamSettings={network:'hysteria',security:'tls',hysteriaSettings:{version:2}};
 else if(previous==='hysteria')inbound.streamSettings={network:'raw',security:'none'};
 if(next==='shadowsocks')alert('Укажите надёжный пароль Shadowsocks в JSON. Без ключа конфигурация не пройдёт проверку Xray-core.');
}
const defaultDoc=()=>({log:{loglevel:'warning'},inbounds:[{tag:'vless-main',listen:'0.0.0.0',port:443,protocol:'vless',settings:{users:[],decryption:'none'},streamSettings:{network:'xhttp',security:'none',xhttpSettings:{path:'/xhttp',mode:'auto'}}}],outbounds:[{tag:'direct',protocol:'freedom'}],routing:{domainStrategy:'AsIs',rules:[]}});
function view(){return [
'<section id="xm-studio-v4" class="sv-studio">',
'<header class="sv-title"><p class="sv-subtitle">Редактируйте конфигурации Xray в реальном времени. JSON и конструктор синхронизированы.</p></header>',


'<div class="sv-topbar"><nav class="sv-page-tabs" aria-label="Разделы XRAY STUDIO"><button class="active" type="button" data-action="studio-editor" aria-current="page">Редактор</button><button type="button" data-action="profiles">Профили <span data-v="profilesCount"></span></button></nav><nav class="sv-mainnav" aria-label="Действия XRAY STUDIO"><div class="sv-navtags"><button class="active" type="button" data-action="focus-code">JSON</button><button type="button" data-action="focus-form">Конструктор</button><button type="button" data-action="check">Проверка</button><button type="button" data-action="expand">Предпросмотр</button></div></nav><div class="sv-actions"><button type="button" data-action="templates">Шаблоны</button><button type="button" data-action="import">Импорт</button><button type="button" data-action="export">Экспорт</button><button class="sv-primary" type="button" data-action="save">Сохранить</button></div></div>',
'<section class="sv-profiles-page" data-v="profilesPage" hidden><header><div><h2>Профили Xray</h2><p>Сохранённые конфигурации для назначения узлам и сквадам</p></div><button class="sv-primary" type="button" data-action="new-profile">+ Новый профиль</button></header><input class="sv-profiles-search" data-v="profilesSearch" type="search" placeholder="Поиск по названию профиля" aria-label="Поиск профилей"><div class="sv-profiles-list" data-v="profilesList"></div></section>',
'<div class="sv-workspace"><div class="sv-columns"><section class="sv-codepanel"><header class="sv-codebar"><span><b class="sv-dot"></b> config.json <small data-v="dirty">Черновик</small></span><div><button type="button" data-action="undo" aria-label="Отменить">↶</button><button type="button" data-action="redo" aria-label="Повторить">↷</button><button type="button" data-action="format">Форматировать</button><button type="button" data-action="expand" aria-label="Полноэкранный редактор" title="Полноэкранный редактор">⛶</button></div></header>',
'<div class="sv-codesurface"><pre class="sv-gutter" data-v="gutter" aria-hidden="true"></pre><div class="sv-codeholder"><pre class="sv-highlight" data-v="highlight" aria-hidden="true"></pre><textarea data-v="source" data-xm="manual" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Серверный JSON"></textarea></div><pre class="sv-minimap" data-v="minimap" aria-hidden="true"></pre></div><div class="sv-core-diagnostics" data-v="coreIssues" role="status" aria-live="polite" hidden></div><footer class="sv-codestatus"><span data-v="position">Строка 1, столбец 1</span><span>JSON</span><span data-v="valid">Проверка...</span><label><input type="checkbox" data-v="wrap"> Перенос строк</label></footer></section>',
'<section class="sv-constructor"><header><h3>Конструктор конфигурации</h3><p>Изменения параметров синхронизируются с JSON.</p></header><nav class="sv-tabs"><button type="button" data-tab="basic" class="active">Основные</button><button type="button" data-tab="inbound">Входящие</button><button type="button" data-tab="outbound">Исходящие</button><button type="button" data-tab="routing">Маршрутизация</button><button type="button" data-tab="extra">Дополнительно</button></nav>',
'<div class="sv-formbody"><div data-section="basic"><h4>Общие параметры</h4>',field('name','Название профиля'),'<div class="sv-two">',select('log','Логирование',[['warning','warning'],['info','info'],['debug','debug'],['error','error'],['none','none']]),select('strategy','Domain strategy',[['AsIs','AsIs'],['IPIfNonMatch','IPIfNonMatch'],['IPOnDemand','IPOnDemand']]),'</div><p data-v="summary" class="sv-muted"></p><p class="sv-note">Пользователи и UUID создаются автоматически вне XRAY STUDIO.</p></div>',
'<div data-section="inbound" hidden><div class="sv-sectionhead"><h4>Входящие соединения (inbounds)</h4><button data-action="add-inbound" type="button">+ Inbound</button></div>',select('inboundSelect','Выберите inbound',[['0','Inbound']]),'<div class="sv-inbound-summary"><span class="sv-statusmark"></span><strong data-v="inboundTitle">vless-main</strong><span class="sv-protobadge" data-v="protocolBadge">VLESS</span><button type="button" data-action="remove-inbound" title="Удалить inbound">✕</button></div><div class="sv-two">',field('tag','Тег inbound'),field('port','Порт','number'),'</div><div class="sv-two">',select('protocol','Протокол',[['vless','VLESS'],['vmess','VMess'],['trojan','Trojan'],['shadowsocks','Shadowsocks'],['hysteria','Hysteria2'],['socks','SOCKS'],['http','HTTP']]),field('listen','Адрес прослушивания'),'</div><div class="sv-two">',select('transport','Транспорт',[['raw','TCP / RAW'],['xhttp','XHTTP'],['ws','WebSocket'],['grpc','gRPC'],['httpupgrade','HTTPUpgrade'],['hysteria','Hysteria2']]),select('security','Защита',[['none','Без TLS'],['reality','Reality'],['tls','TLS']]),'</div><div data-when="reality"><h4>Настройки Reality</h4><div class="sv-two">',field('target','Домен назначения (target)'),field('sni','Server Name (SNI)'),'</div><div class="sv-two">',field('private','Private Key','password'),field('shortid','Short ID'),'</div><div class="sv-inline"><button type="button" data-action="reality">Reality X25519</button><button type="button" data-action="shortid">Новый Short ID</button></div></div><div data-when="finalmask"><details class="sv-advanced"><summary>FinalMask — TCP / UDP / QUIC</summary><label class="sv-field"><span>streamSettings.finalmask (JSON)</span><textarea data-field="finalmaskJson" rows="6" spellcheck="false" placeholder="{}"></textarea></label><p class="sv-muted">TCP/UDP noise, Salamander, маски и QUIC. Проверяйте через Xray-core.</p></details></div><div data-when="hysteria"><h4>Hysteria2</h4><div class="sv-two">',field('hysteriaVersion','Версия','number'),field('hysteriaIdle','UDP idle timeout (с)','number'),'</div></div><div data-when="vless"><h4>VLESS Encryption</h4>',field('vlessDecryption','Decryption (сервер)'),'<p class="sv-muted">none или результат xray vlessenc.</p></div><div data-when="shadowsocks"><h4>Shadowsocks</h4><div class="sv-two">',select('ssMethod','Метод',[['2022-blake3-aes-128-gcm','2022 AES-128-GCM'],['2022-blake3-aes-256-gcm','2022 AES-256-GCM'],['2022-blake3-chacha20-poly1305','2022 ChaCha20']]),field('ssPassword','Секретный ключ','password'),'</div></div><div data-when="xhttp"><h4>Настройки XHTTP</h4><div class="sv-two">',field('path','Path'),select('xhttpMode','Mode',[['auto','auto'],['packet-up','packet-up'],['stream-up','stream-up'],['stream-one','stream-one']]),'</div><details class="sv-advanced"><summary>Расширенные параметры XHTTP</summary><label class="sv-field"><span>xhttpSettings.extra (JSON)</span><textarea data-field="xhttpExtra" rows="7" spellcheck="false" placeholder="{}"></textarea></label><p class="sv-muted">XMUX и другие опции. Поля вне extra не удаляются.</p></details></div><div data-when="tls"><h4>TLS</h4>',field('certificate','Certificate file'),field('key','Private key file'),'</div><p class="sv-note">Клиенты и UUID создаются автоматически вне XRAY STUDIO.</p></div>',
'<section class="sv-outbound-preview"><div class="sv-sectionhead"><h4>Исходящие соединения (outbounds)</h4><button type="button" data-action="add-outbound">+ Outbound</button></div><div data-v="outboundQuickList" class="sv-outbound-list"></div></section>',
'<div data-section="outbound" hidden><div class="sv-sectionhead"><h4>Исходящие соединения</h4><button type="button" data-action="add-outbound">+ Outbound</button></div>',select('outSelect','Выберите outbound',[['0','direct']]),field('outTag','Тег outbound'),select('outProtocol','Протокол',[['freedom','Freedom'],['blackhole','Blackhole'],['socks','SOCKS'],['http','HTTP'],['wireguard','WireGuard']]),'<button class="sv-danger" type="button" data-action="remove-outbound">Удалить outbound</button><p class="sv-note">Расширенные настройки outbound остаются в JSON.</p></div>',
'<div data-section="routing" hidden><h4>Маршрутизация</h4>',select('routeStrategy','Domain strategy',[['AsIs','AsIs'],['IPIfNonMatch','IPIfNonMatch'],['IPOnDemand','IPOnDemand']]),'<p class="sv-note">Существующие routing.rules сохраняются. Добавляйте правила через JSON или Tools.</p></div>',
'<div data-section="extra" hidden><h4>Дополнительные параметры</h4>',field('dns','DNS-серверы (через запятую)'),'<p class="sv-note">Другие параметры остаются без изменений.</p></div></div><footer data-v="sync">Синхронизировано с JSON</footer></section>',
'<aside class="sv-tools" data-v="toolsPane"><div class="sv-toolhead"><h3>ИНСТРУМЕНТЫ</h3><button type="button" data-action="tools" aria-label="Закрыть">×</button></div><p>Генераторы и утилиты Xray</p><div data-xm-tools class="sv-legacy"></div><div class="sv-template"><h4>Полезные шаблоны</h4><button type="button" data-action="templates">Открыть шаблоны</button></div></aside></div>',
'</div>',
'<footer class="sv-bottom"><span data-v="saveState">Несохранённая конфигурация</span><div><button type="button" data-action="reset">Сбросить изменения</button></div></footer>',
'<div class="sv-overlay" data-v="overlay" hidden><div class="sv-dialog"><header><h3 data-v="overlayTitle">Профили</h3><button type="button" data-action="close">×</button></header><div data-v="overlayBody"></div></div></div><input data-v="upload" type="file" accept=".json,application/json" hidden></section>'
].join('')}
function mount(root,ctx){
const get=k=>$(root,k),control=k=>root.querySelector('[data-field="'+k+'"]'),value=k=>control(k)?.value||'',set=(k,v)=>{if(control(k))control(k).value=v??''};
const input=get('source'),gutter=get('gutter'),highlight=get('highlight'),minimap=get('minimap');
let name='Новый профиль',id=null,inboundIndex=0,outIndex=0,saved='',locked=false,tools=true;
let diagnosticsLine=null,validatedSource=null;
const notify=msg=>ctx.toast?.(msg);
let activePage='editor';
function setPage(page){
 activePage=page;
 const editor=page==='editor';
 get('profilesPage').hidden=editor;
 root.querySelector('.sv-workspace').hidden=!editor;
 root.classList.toggle('sv-profiles-active',!editor);
 root.querySelector('.sv-bottom').hidden=!editor;
 for(const b of root.querySelectorAll('.sv-page-tabs button')){const selected=b.dataset.action===(editor?'studio-editor':'profiles');b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}
 if(!editor)renderProfiles();
}
function openProfile(p){
 if(input.value!==saved&&!confirm('Есть несохранённые изменения. Открыть другой профиль?'))return;
 try{
  const d=typeof p.config==='string'?JSON.parse(p.config):p.config;
  id=p.id;name=p.name;inboundIndex=outIndex=0;
  input.value=pretty(d);saved=input.value;paint();input.dispatchEvent(new Event('xmesh:reset-history'));
  setPage('editor');
 }catch(err){notify('Не удалось открыть профиль: '+err.message)}
}
function newProfile(){
 if(input.value!==saved&&!confirm('Есть несохранённые изменения. Создать новый профиль?'))return;
 id=null;name='Новый профиль';inboundIndex=outIndex=0;
 input.value=pretty(defaultDoc());saved=input.value;paint();input.dispatchEvent(new Event('xmesh:reset-history'));setPage('editor');
}
function renderProfiles(){
 const all=ctx.DB.profiles||[];
 const search=get('profilesSearch').value.trim().toLocaleLowerCase();
 const list=get('profilesList');list.replaceChildren();
 get('profilesCount').textContent=String(all.length);
 const found=all.filter(p=>(p.name||'').toLocaleLowerCase().includes(search));
 if(!found.length){const empty=document.createElement('p');empty.className='sv-profiles-empty';empty.textContent=search?'Профили не найдены.':'Профилей пока нет. Создайте первый профиль.';list.append(empty);return}
 for(const p of found){
  const button=document.createElement('button');button.type='button';button.className='sv-profile-row';
  const title=document.createElement('strong');title.textContent=p.name||'Без названия';
  const meta=document.createElement('span');meta.textContent='Открыть конфигурацию';
  const arrow=document.createElement('span');arrow.textContent='→';arrow.setAttribute('aria-hidden','true');
  button.append(title,meta,arrow);button.addEventListener('click',()=>openProfile(p));
  const card=document.createElement('div');card.className='sv-profile-card';card.append(button);
  const del=document.createElement('button');del.type='button';del.className='sv-profile-delete';del.textContent='Удалить';
  del.setAttribute('aria-label','Удалить профиль '+(p.name||''));
  del.onclick=async()=>{
   if(!confirm('Удалить профиль «'+(p.name||'Без названия')+'»? Действие необратимо.'))return;
   try{await ctx.api.remove('profiles',p.id);if(id===p.id){id=null;name='Новый профиль';saved='';}notify('Профиль удалён');renderProfiles();}
   catch(error){notify('Ошибка удаления: '+error.message)}
  };card.append(del);list.append(card);
 }
}
get('profilesSearch').addEventListener('input',renderProfiles);
const json=()=>{const d=JSON.parse(input.value);if(!d||typeof d!=='object'||Array.isArray(d))throw Error('JSON должен быть объектом');return d};
const hasValidJSON=()=>{try{return json()}catch{return null}};
const pretty=d=>JSON.stringify(d,null,2);
const codeColor=source=>{const rx=/"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;let result='',i=0,m;while((m=rx.exec(source))){result+=escapeHtml(source.slice(i,m.index));const token=m[0];const next=source.slice(m.index+token.length);const c=token[0]==='"'?( /^\s*:/.test(next)?'key':'string'):/^(?:true|false|null)$/.test(token)?'boolean':'number';result+='<span class="sv-'+c+'">'+escapeHtml(token)+'</span>';i=m.index+token.length}return result+escapeHtml(source.slice(i))+'\n'};
function paint(){
 const source=input.value;
 if(validatedSource!==source){diagnosticsLine=null;get('coreIssues').hidden=true}
 const obj=hasValidJSON();
 if(!obj && diagnosticsLine===null){
  try{JSON.parse(source)}catch(error){
   const msg=String(error.message||'');
   const line=msg.match(/line\s+(\d+)/i),position=msg.match(/position\s+(\d+)/i);
   diagnosticsLine=line?Number(line[1]):position?source.slice(0,Number(position[1])).split('\n').length:null;
   if(diagnosticsLine)validatedSource=source;
  }
 }
 const issues=obj?(window.XrayJsonIntelligence?.analyze?.(source,obj)||[]):[];
 const structuralErrors=issues.filter(x=>x.severity==='error');
 const byLine=new Map();
 for(const issue of structuralErrors){
  if(Number.isInteger(issue.line)&&issue.line>0&&!byLine.has(issue.line))byLine.set(issue.line,issue.message);
 }
 const paintedLines=codeColor(source).split('\n');
 highlight.innerHTML=paintedLines.map((part,i)=>{
  const line=i+1;
  const isCore=diagnosticsLine===line;
  const isStructural=byLine.has(line);
  if(!isCore&&!isStructural)return part;
  const message=isCore?'Ошибка, указанная Xray-core':byLine.get(line);
  return '<span class="sv-invalid-line" title="'+escapeHtml(message)+'">'+part+'</span>';
 }).join('\n');
 minimap.innerHTML=codeColor(source.split('\n').slice(0,180).join('\n'));
 const count=Math.min(source.split('\n').length,10000);
 gutter.textContent=Array.from({length:count},(_,i)=>{
  const n=i+1;return (diagnosticsLine===n?'✕ ':byLine.has(n)?'! ':'')+n;
 }).join('\n');
 const parts=source.slice(0,input.selectionStart).split('\n');
 get('position').textContent='Строка '+parts.length+', столбец '+(parts.at(-1).length+1);
 const dirty=input.value!==saved;
 get('dirty').textContent=dirty?'● Не сохранено':'✓ Сохранено';
 get('saveState').textContent=dirty?'Есть несохранённые изменения':'Конфигурация сохранена';
 if(obj){
  get('valid').textContent=structuralErrors.length?structuralErrors.length+' ошибок предварительного анализа':'✓ JSON корректен (ядро не проверяло)';
  get('valid').dataset.status=structuralErrors.length?'bad':'ok';
  sync(obj);
 }else{
  get('valid').textContent='Ошибка синтаксиса JSON';
  get('valid').dataset.status='bad';
  get('sync').textContent='Исправьте JSON, чтобы изменить параметры конструктором';
 }
}
function selected(arr,k){return Array.isArray(arr)?arr[k]||null:null}
function setOptions(k,labels,index){const el=control(k);el.replaceChildren();labels.forEach((v,i)=>{const opt=document.createElement('option');opt.value=String(i);opt.textContent=v;el.append(opt)});if(labels.length)el.value=String(Math.min(index,labels.length-1))}
function sync(d){
 locked=true;try{
 set('name',name);set('log',d.log?.loglevel||'warning');set('strategy',d.routing?.domainStrategy||'AsIs');set('routeStrategy',d.routing?.domainStrategy||'AsIs');
 set('dns',Array.isArray(d.dns?.servers)?d.dns.servers.filter(x=>typeof x==='string').join(', '):'');
 const ins=Array.isArray(d.inbounds)?d.inbounds:[],outs=Array.isArray(d.outbounds)?d.outbounds:[];
 inboundIndex=Math.min(inboundIndex,Math.max(0,ins.length-1));outIndex=Math.min(outIndex,Math.max(0,outs.length-1));
 setOptions('inboundSelect',ins.map(x=>(x.tag||'без тега')+' · '+(x.protocol||'').toUpperCase()),inboundIndex);
 setOptions('outSelect',outs.map(x=>(x.tag||'без тега')+' · '+(x.protocol||'')),outIndex);
 const ib=selected(ins,inboundIndex)||{},ss=ib.streamSettings||{},r=ss.realitySettings||{},tls=ss.tlsSettings||{},ob=selected(outs,outIndex)||{};
 set('tag',ib.tag);get('inboundTitle').textContent=ib.tag||'Inbound';get('protocolBadge').textContent=(ib.protocol||'').toUpperCase();set('port',ib.port);set('listen',ib.listen||'0.0.0.0');set('protocol',ib.protocol||'vless');set('transport',ss.network||'raw');set('security',ss.security||'none');
 set('target',r.target||r.dest||'');set('sni',r.serverNames?.[0]||'');set('private',r.privateKey||'');set('shortid',r.shortIds?.[0]||'');set('path',ss.xhttpSettings?.path||'/xhttp');set('xhttpMode',ss.xhttpSettings?.mode||'auto');set('finalmaskJson',JSON.stringify(ss.finalmask||{},null,2));set('hysteriaVersion',ib.settings?.version||2);set('hysteriaIdle',ss.hysteriaSettings?.udpIdleTimeout??60);set('vlessDecryption',ib.settings?.decryption||'none');set('ssMethod',ib.settings?.method||'2022-blake3-aes-128-gcm');set('ssPassword',ib.settings?.password||'');set('xhttpExtra',JSON.stringify(ss.xhttpSettings?.extra||{},null,2));
 set('certificate',tls.certificates?.[0]?.certificateFile||'');set('key',tls.certificates?.[0]?.keyFile||'');set('outTag',ob.tag);set('outProtocol',ob.protocol||'freedom');
 const quick=get('outboundQuickList');quick.replaceChildren();
 for(const [i,item] of outs.entries()){
  const button=document.createElement('button');button.type='button';button.className='sv-outbound-row';button.dataset.quickOutbound=String(i);
  const dot=document.createElement('span');dot.className='sv-statusmark';
  const label=document.createElement('strong');label.textContent=item.tag||'outbound';
  const protocol=document.createElement('span');protocol.className='sv-protobadge';protocol.textContent=item.protocol||'unknown';
  const arrow=document.createElement('span');arrow.className='sv-outbound-chevron';arrow.textContent='›';
  button.append(dot,label,protocol,arrow);quick.append(button);
 }
 if(!outs.length){const empty=document.createElement('p');empty.className='sv-muted';empty.textContent='Нет исходящих соединений';quick.append(empty)}

 root.querySelector('[data-when="finalmask"]').hidden=false;root.querySelector('[data-when="hysteria"]').hidden=ib.protocol!=='hysteria';root.querySelector('[data-when="vless"]').hidden=ib.protocol!=='vless';root.querySelector('[data-when="shadowsocks"]').hidden=ib.protocol!=='shadowsocks';root.querySelector('[data-when="reality"]').hidden=ss.security!=='reality';root.querySelector('[data-when="xhttp"]').hidden=ss.network!=='xhttp';root.querySelector('[data-when="tls"]').hidden=ss.security!=='tls';
 get('summary').textContent=ins.length+' inbound · '+outs.length+' outbound · '+(d.routing?.rules?.length||0)+' правил маршрутизации';get('sync').textContent='Параметры синхронизированы';
 }finally{locked=false}
}
function update(d){input.value=pretty(d);input.dispatchEvent(new Event('input',{bubbles:true}))}
function mutate(fn){try{const d=json();fn(d);update(d)}catch(err){notify('Изменение не применено: '+err.message)}}
function currentInbound(d){const ib=selected(d.inbounds,inboundIndex);if(!ib)throw Error('Выберите inbound');return ib}
function currentOut(d){const ob=selected(d.outbounds,outIndex);if(!ob)throw Error('Выберите outbound');return ob}
function formChanged(el){
 if(locked||!el.dataset.field)return;const k=el.dataset.field;
 if(k==='name'){name=el.value;get('saveState').textContent='Имя профиля будет сохранено при сохранении';return}
 if(k==='inboundSelect'){inboundIndex=Number(el.value);sync(json());return}
 if(k==='outSelect'){outIndex=Number(el.value);sync(json());return}
 mutate(d=>{
 if(k==='log')(d.log??={}).loglevel=el.value;
 else if(k==='strategy'||k==='routeStrategy')(d.routing??={rules:[]}).domainStrategy=el.value;
 else if(k==='dns'){(d.dns??={}).servers=el.value.split(',').map(x=>x.trim()).filter(Boolean)}
 else if(k==='outTag'||k==='outProtocol')currentOut(d)[k==='outTag'?'tag':'protocol']=el.value;
 else{
 const ib=currentInbound(d),ss=ib.streamSettings??={};
 if(k==='tag')ib.tag=el.value;
 if(k==='port')ib.port=Number(el.value);
 if(k==='listen')ib.listen=el.value;
 if(k==='protocol')migrateInboundProtocol(ib,el.value);
 if(k==='finalmaskJson'){let parsed;try{parsed=JSON.parse(el.value)}catch{throw Error('Некорректный JSON FinalMask')}if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('FinalMask должен быть объектом');if(Object.keys(parsed).length)ss.finalmask=parsed;else delete ss.finalmask}
 if(k==='hysteriaVersion'){if(ib.protocol!=='hysteria')throw Error('Не Hysteria2 inbound');if(Number(el.value)!==2)throw Error('Поддерживается Hysteria v2');ib.settings.version=2}
 if(k==='hysteriaIdle'){if(ib.protocol!=='hysteria')throw Error('Не Hysteria2 inbound');(ss.hysteriaSettings??={version:2}).udpIdleTimeout=Number(el.value)}
 if(k==='vlessDecryption'){if(ib.protocol!=='vless')throw Error('Не VLESS inbound');(ib.settings??={}).decryption=el.value.trim()}
 if(k==='ssMethod'||k==='ssPassword'){if(ib.protocol!=='shadowsocks')throw Error('Не Shadowsocks inbound');(ib.settings??={})[k==='ssMethod'?'method':'password']=el.value}
 if(k==='xhttpExtra'){let parsed;try{parsed=JSON.parse(el.value)}catch{throw Error('Некорректный JSON в xhttpSettings.extra')}if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('xhttpSettings.extra должен быть JSON-объектом');(ss.xhttpSettings??={path:'/xhttp',mode:'auto'}).extra=parsed}

 if(k==='transport')ss.network=el.value;
 if(k==='security')ss.security=el.value;
 if(['target','sni','private','shortid'].includes(k)){const r=ss.realitySettings??={show:false,serverNames:[],shortIds:[]};if(k==='target')r.target=el.value;if(k==='sni')r.serverNames=[el.value];if(k==='private')r.privateKey=el.value;if(k==='shortid')r.shortIds=[el.value]}
 if(k==='path')(ss.xhttpSettings??={mode:'auto'}).path=el.value;if(k==='xhttpMode')(ss.xhttpSettings??={path:'/xhttp'}).mode=el.value;
 if(k==='certificate'||k==='key'){const tls=ss.tlsSettings??={certificates:[{}]};tls.certificates??=[{}];tls.certificates[0]??={};tls.certificates[0][k==='certificate'?'certificateFile':'keyFile']=el.value}
 }
 });
}
function validate(d){if(!Array.isArray(d.inbounds)||!d.inbounds.length)throw Error('Нужен хотя бы один inbound');const tags=new Set();for(const x of d.inbounds){
 if(x.protocol==='vless'&&!Array.isArray(x.settings?.users))throw Error('VLESS inbound требует settings.users (массив).');
 if((x.protocol==='vmess'||x.protocol==='trojan')&&!Array.isArray(x.settings?.users))throw Error(x.protocol.toUpperCase()+' inbound требует settings.users (массив).');
 if(x.protocol==='hysteria'&&(x.settings?.version!==2||x.streamSettings?.network!=='hysteria'))throw Error('Hysteria2 требует settings.version=2 и transport hysteria.');
 if(x.protocol==='shadowsocks'&&(!x.settings?.method||!x.settings?.password))throw Error('Shadowsocks: необходимо указать method и password в серверном JSON.');
if(!x.tag||tags.has(x.tag))throw Error('Пустой или повторяющийся tag inbound');tags.add(x.tag);if(!Number.isInteger(x.port)||x.port<1||x.port>65535)throw Error('Некорректный порт '+x.tag);if(x.streamSettings?.security==='reality'){const r=x.streamSettings.realitySettings||{};if(!r.privateKey||!(r.target||r.dest)||!r.serverNames?.length)throw Error('Reality: укажите ключ, target и SNI')}}}
function showPopup(title,kind){
 const body=get('overlayBody');body.replaceChildren();get('overlayTitle').textContent=title;
 if(kind==='profiles'){
 const create=document.createElement('button');create.className='sv-dialogitem';create.textContent='+ Новый профиль';create.onclick=()=>{if(input.value!==saved&&!confirm('Открыть новый профиль без сохранения изменений?'))return;id=null;name='Новый профиль';inboundIndex=outIndex=0;saved='';update(defaultDoc());input.dispatchEvent(new Event('xmesh:reset-history'));get('overlay').hidden=true};body.append(create);
 for(const p of ctx.DB.profiles||[]){const b=document.createElement('button');b.className='sv-dialogitem';b.textContent=p.name;b.onclick=()=>{if(input.value!==saved&&!confirm('Потерять несохранённые изменения?'))return;try{const d=typeof p.config==='string'?JSON.parse(p.config):p.config;id=p.id;name=p.name;inboundIndex=outIndex=0;input.value=pretty(d);saved=input.value;paint();input.dispatchEvent(new Event('xmesh:reset-history'));get('overlay').hidden=true}catch(err){notify(err.message)}};body.append(b)}
 }else{for(const [kind,label] of [['base','VLESS + XHTTP'],['reality','VLESS + Reality'],['raw','VLESS + TCP']]){const b=document.createElement('button');b.className='sv-dialogitem';b.textContent=label;b.onclick=()=>{if(input.value!==saved&&!confirm('Заменить несохранённую конфигурацию?'))return;const d=defaultDoc();if(kind==='reality'){d.inbounds[0].streamSettings.security='reality';d.inbounds[0].streamSettings.realitySettings={target:'example.com:443',serverNames:['example.com'],privateKey:'',shortIds:[]}}if(kind==='raw')d.inbounds[0].streamSettings={network:'raw',security:'none'};inboundIndex=0;update(d);input.dispatchEvent(new Event('xmesh:reset-history'));get('overlay').hidden=true};body.append(b)}}
 get('overlay').hidden=false;
}
function reportCore(message,line=null,success=false){
 const box=get('coreIssues');box.hidden=false;box.textContent=message;
 box.dataset.status=success?'ok':'bad';diagnosticsLine=Number.isInteger(line)&&line>0?line:null;
 validatedSource=input.value;paint();
 if(diagnosticsLine){get('valid').textContent='⚠ Ошибка в строке '+diagnosticsLine;get('valid').dataset.status='bad'}
}
async function checkWithCore(){
 let documentValue;
 try{documentValue=json()}
 catch(err){
  const message=String(err.message),m=message.match(/line\s+(\d+)/i),position=message.match(/position\s+(\d+)/i);
  const positionLine=position?input.value.slice(0,Number(position[1])).split('\n').length:null;
  reportCore('Ошибка синтаксиса JSON: '+message,m?Number(m[1]):positionLine);
  return;
 }
 const source=input.value;
 get('valid').textContent='Проверяет установленный Xray-core…';
 try{
  const reply=await ctx.apiRequest('/api/v1/core/validate',{method:'POST',body:JSON.stringify({config:source})});
  if(source!==input.value)return;
  const valid=reply.valid===true,output=[reply.stderr,reply.stdout].filter(Boolean).join(' ').trim();
  const candidate=output.match(/(?:line|строка)\s+(\d+)(?:\D|$)/i);
  // Only underline a line when the engine explicitly provides one.
  const line=candidate?Number(candidate[1]):null;
  reportCore(valid?'✓ Xray-core: конфигурация принята.':('Xray-core: '+(output||reply.message||'Конфигурация отклонена.')),line,valid);
  get('valid').textContent=valid?'✓ Xray-core OK':'✕ Xray-core: ошибка';
  get('valid').dataset.status=valid?'ok':'bad';
 }catch(err){if(source!==input.value)return;reportCore('Проверка ядром недоступна: '+err.message)}
}
async function save(){try{const d=json();validate(d);if(!name.trim())throw Error('Укажите название профиля');const body={name:name.trim(),config:pretty(d)};if(id!=null)await ctx.api.update('profiles',id,body);else await ctx.api.create('profiles',body);saved=input.value;paint();notify('Профиль сохранён');await ctx.render?.()}catch(err){notify('Не удалось сохранить: '+err.message)}}
const bytes=n=>{const b=new Uint8Array(n);crypto.getRandomValues(b);return Array.from(b,v=>v.toString(16).padStart(2,'0')).join('')};
async function action(a){
 switch(a){
 case 'focus-code':input.focus();return;
 case 'focus-form':root.querySelector('[data-tab="inbound"]')?.click();root.querySelector('.sv-constructor')?.scrollIntoView?.({block:'nearest'});return;
 case 'profiles':setPage('profiles');return;
 case 'studio-editor':setPage('editor');return;
 case 'new-profile':newProfile();return;
 case 'templates':return showPopup('Шаблоны','templates');
 case 'close':get('overlay').hidden=true;return;
 case 'save':return save();
 case 'import':get('upload').click();return;
 case 'export':{const url=URL.createObjectURL(new Blob([input.value],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=(name.replace(/[^a-z0-9_-]/gi,'-')||'xray')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return}
 case 'format':try{update(json())}catch(err){notify(err.message)}return;
 case 'check':return checkWithCore();
 case 'tools':tools=!tools;get('toolsPane').hidden=!tools;root.classList.toggle('sv-hide-tools',!tools);return;
 case 'expand':root.classList.toggle('sv-expand');return;
 case 'reset':if(confirm('Сбросить несохранённые изменения?')){input.value=saved||pretty(defaultDoc());paint();input.dispatchEvent(new Event('xmesh:reset-history'))}return;
 case 'undo':root.querySelector('[data-tool="undo"]')?.click();return;
 case 'redo':root.querySelector('[data-tool="redo"]')?.click();return;
 case 'add-inbound':mutate(d=>{d.inbounds??=[];let i=1;while(d.inbounds.some(x=>x.tag==='inbound-'+i))i++;d.inbounds.push(newInbound('vless','inbound-'+i));inboundIndex=d.inbounds.length-1});return;
 case 'remove-inbound':if(confirm('Удалить выбранный inbound?'))mutate(d=>{d.inbounds.splice(inboundIndex,1);inboundIndex=Math.max(inboundIndex-1,0)});return;
 case 'add-outbound':mutate(d=>{d.outbounds??=[];let i=1;while(d.outbounds.some(x=>x.tag==='outbound-'+i))i++;d.outbounds.push({tag:'outbound-'+i,protocol:'freedom'});outIndex=d.outbounds.length-1});return;
 case 'remove-outbound':if(confirm('Удалить выбранный outbound?'))mutate(d=>{d.outbounds.splice(outIndex,1);outIndex=Math.max(outIndex-1,0)});return;
 case 'shortid':mutate(d=>{const ib=currentInbound(d),r=(ib.streamSettings??={}).realitySettings??={show:false,serverNames:[],shortIds:[]};r.shortIds??=[];r.shortIds.push(bytes(8))});return;
 case 'reality':try{const pair=await ctx.realityKeys();if(!pair?.privateKey)throw Error('Ключ не сгенерирован');mutate(d=>{const ss=currentInbound(d).streamSettings??={};ss.security='reality';const r=ss.realitySettings??={show:false,serverNames:[],shortIds:[]};if(r.privateKey&&!confirm('Перезаписать privateKey?'))throw Error('Отменено');r.privateKey=pair.privateKey});try{await navigator.clipboard.writeText(pair.publicKey);notify('Public Key скопирован')}catch{notify('Public Key: '+pair.publicKey)}}catch(err){notify(err.message)}return;
 }
}
root.addEventListener('click',ev=>{const quick=ev.target.closest('[data-quick-outbound]');if(quick){outIndex=Number(quick.dataset.quickOutbound);root.querySelector('[data-tab="outbound"]')?.click();const d=hasValidJSON();if(d)sync(d);return}const b=ev.target.closest('[data-action]');if(b){ev.preventDefault();Promise.resolve(action(b.dataset.action)).catch(x=>notify(x.message))}const tab=ev.target.closest('[data-tab]');if(tab){root.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===tab));root.querySelectorAll('[data-section]').forEach(x=>x.hidden=x.dataset.section!==tab.dataset.tab)}});
root.addEventListener('change',ev=>{if(ev.target.matches('[data-field]'))formChanged(ev.target)});
input.addEventListener('input',paint);
input.addEventListener('scroll',()=>{highlight.scrollTop=input.scrollTop;highlight.scrollLeft=input.scrollLeft;gutter.scrollTop=input.scrollTop});
input.addEventListener('click',paint);input.addEventListener('keyup',paint);
input.addEventListener('keydown',ev=>{if(ev.key==='Tab'){ev.preventDefault();const i=input.selectionStart;input.setRangeText('  ',i,input.selectionEnd,'end');input.dispatchEvent(new Event('input',{bubbles:true}))}if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='s'){ev.preventDefault();save()}});
get('wrap').addEventListener('change',ev=>root.classList.toggle('sv-wrap',ev.target.checked));
get('upload').addEventListener('change',async ev=>{const f=ev.target.files?.[0];if(!f)return;try{if(f.size>2e6)throw Error('Файл больше 2 МБ');const raw=await f.text();JSON.parse(raw);if(input.value!==saved&&!confirm('Заменить текущий черновик?'))return;input.value=raw;paint();input.dispatchEvent(new Event('xmesh:reset-history'));notify('JSON импортирован')}catch(err){notify(err.message)}finally{ev.target.value=''}});
input.value=pretty(defaultDoc());saved='';paint();root.querySelector('[data-tab="inbound"]')?.click();window.XMeshJsonTools?.setup(root,{toast:notify,realityKeys:ctx.realityKeys});
}
return {view,mount};
})();