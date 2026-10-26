/* XRAY STUDIO v4: JSON-first 2-in-1 editor, server configuration only. */
window.XMeshStudioV4=(()=>{
'use strict';
const escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=(r,k)=>r.querySelector('[data-v="'+k+'"]');
const field=(k,title,type='text')=>'<label class="sv-field"><span>'+title+'</span><input data-field="'+k+'" type="'+type+'" autocomplete="'+(type==='password'?'new-password':'off')+'" data-lpignore="true" data-1p-ignore="true"></label>';
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
 tag,listen:'127.0.0.1',port:443,protocol,
 settings:inboundSettingsFor(protocol),
 streamSettings:{network:'raw',security:'none'}
});
function migrateInboundProtocol(inbound,next){
 if(inbound.protocol===next)return;
 const previous=inbound.protocol;
 inbound.protocol=next;
 // Credentials and protocol-specific options must never be inherited across protocols.
 inbound.settings=inboundSettingsFor(next);
 const network=inbound.streamSettings?.network||'raw';
 // QUIC-only Hysteria has its own transport and TLS settings. Reset it when leaving.
 if(next==='hysteria'){
  inbound.streamSettings={network:'hysteria',security:'tls',hysteriaSettings:{version:2},tlsSettings:{certificates:[],alpn:['h3']}};
 }else if(previous==='hysteria'||network==='hysteria'||network==='masque'){
  inbound.streamSettings={network:'raw',security:'none'};
 }else if(network==='xdrive'&&next!=='vless'){
  inbound.streamSettings={network:'raw',security:'none'};
 }
}
function generateRealityShortId(){const bytes=new Uint8Array(8);crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
const defaultDoc=()=>({log:{loglevel:'warning'},inbounds:[{tag:'vless-main',listen:'127.0.0.1',port:443,protocol:'vless',settings:{users:[],decryption:'none'},streamSettings:{network:'xhttp',security:'none',xhttpSettings:{path:'/xhttp',mode:'auto'}}}],outbounds:[{tag:'direct',protocol:'freedom'}],routing:{domainStrategy:'AsIs',rules:[]}});
function view(){return [
'<section id="xm-studio-v4" class="sv-studio">',
'<header class="sv-title"><span class="sv-title-symbol"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg></span><div class="sv-title-copy"><span class="sv-eyebrow">CONFIGURATION WORKSPACE</span><h2>XRAY STUDIO</h2><p class="sv-subtitle">Серверные профили, инструменты Xray и проверка конфигураций в одной рабочей области.</p></div><span class="sv-title-mode"><span class="sv-live-dot"></span> JSON FIRST</span></header>',


'<div class="sv-topbar"><nav class="sv-page-tabs" aria-label="Рабочие разделы XRAY STUDIO">',
'<button class="active" type="button" data-action="studio-editor" aria-current="page"><span class="sv-page-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg></span><span class="sv-page-tab-text"><strong>JSON-редактор</strong><small>Конфигурация Xray</small></span></button>',
'<button type="button" data-action="profiles"><span class="sv-page-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="5" rx="1.5"/><rect x="4" y="11" width="16" height="5" rx="1.5"/><rect x="4" y="18" width="16" height="3" rx="1.5"/></svg></span><span class="sv-page-tab-text"><strong>Профили</strong><small>Библиотека Xray</small></span><span class="sv-page-count" data-v="profilesCount">0</span></button>',
'</nav><div class="sv-actions"><button type="button" data-action="check" title="Проверить Xray-core"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/><path d="M12 2a10 10 0 1 0 10 10"/></svg> Проверить</button><button type="button" data-action="templates"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/></svg> Конструктор</button><span class="sv-action-divider" aria-hidden="true"></span><button type="button" data-action="import" title="Импортировать JSON"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5"/><path d="M4 16v4h16v-4"/></svg> Импорт</button><button type="button" data-action="export" title="Экспортировать JSON"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13m-5-5 5 5 5-5"/><path d="M4 17v4h16v-4"/></svg> Экспорт</button><button class="sv-primary" type="button" data-action="save" title="Сохранить профиль · Ctrl+S"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10M7 21v-8h10v8"/></svg> Сохранить</button></div></div>',
'<section class="sv-profiles-page" data-v="profilesPage" hidden>',
'<header class="sv-library-hero"><div class="sv-library-heading"><span class="sv-library-eyebrow"><span class="sv-library-beacon"></span> XRAY STUDIO / LIBRARY</span><h2>Библиотека профилей</h2><p>Все серверные конфигурации Xray в одном месте. Выберите профиль, чтобы продолжить редактирование.</p><div class="sv-library-summary"><span><strong data-v="profilesTotal">0</strong> сохранённых профилей</span><span data-v="profilesActive">Нет открытого профиля</span></div></div><button class="sv-primary sv-library-create" type="button" data-action="new-profile"><span aria-hidden="true">＋</span> Новый профиль</button></header>',
'<div class="sv-library-toolbar"><label class="sv-library-search"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 5 5"/></svg></span><input class="sv-profiles-search" data-v="profilesSearch" type="search" placeholder="Поиск по профилям и inbound..." aria-label="Поиск профилей"></label><span class="sv-library-found" data-v="profilesFound" role="status" aria-live="polite">0 профилей</span></div>',
'<div class="sv-profiles-list" data-v="profilesList"></div></section>',
'<div class="sv-workspace"><div class="sv-columns"><section class="sv-codepanel"><header class="sv-codebar"><div class="sv-codebar-start"><label class="sv-profile-name"><span>Профиль</span><input data-field="name" type="text" maxlength="120" placeholder="Название профиля" autocomplete="off"></label><span class="sv-codebar-file"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg> config.json</span><small class="sv-file-state" data-v="dirty">Черновик</small></div><div class="sv-codebar-actions"><button type="button" data-action="undo" aria-label="Отменить" title="Отменить · Ctrl+Z">↶</button><button type="button" data-action="redo" aria-label="Повторить" title="Повторить · Ctrl+Y">↷</button><button type="button" data-action="outline" aria-controls="sv-studio-outline" aria-expanded="true" title="Показать или скрыть структуру"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18M7 8h4M7 12h4M7 16h3"/></svg> <span>Структура</span></button></div></header>',
'<div class="sv-inline-tools" aria-label="Инструменты JSON"><div data-xm-tools class="sv-legacy"></div></div>',
'<div class="sv-editor-context"><span><i class="sv-context-marker" aria-hidden="true"></i> JSON / SERVER CONFIG</span><span>Сохраните профиль, чтобы применить изменения</span></div><div class="sv-codesurface"><pre class="sv-gutter" data-v="gutter" aria-hidden="true"></pre><div class="sv-codeholder"><pre class="sv-highlight" data-v="highlight" aria-hidden="true"></pre><textarea data-v="source" data-xm="manual" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Серверный JSON"></textarea></div><pre class="sv-minimap" data-v="minimap" aria-hidden="true"></pre></div><div class="sv-core-diagnostics" data-v="coreIssues" role="status" aria-live="polite" hidden></div><footer class="sv-codestatus"><span data-v="position">Строка 1, столбец 1</span><span class="sv-codestatus-lines" data-v="lines">0 строк</span><span class="sv-codestatus-valid" data-v="valid" role="status">Проверка...</span><label><input type="checkbox" data-v="wrap" checked> Перенос строк</label></footer></section>',
'<section class="sv-constructor"><header><h3>Конструктор конфигурации</h3><p>Изменения параметров синхронизируются с JSON.</p></header><nav class="sv-tabs"><button type="button" data-tab="basic" class="active">Основные</button><button type="button" data-tab="inbound">Входящие</button><button type="button" data-tab="outbound">Исходящие</button><button type="button" data-tab="routing">Маршрутизация</button><button type="button" data-tab="extra">Дополнительно</button></nav>',
'<div class="sv-formbody"><div data-section="basic"><h4>Общие параметры</h4>','<p class="sv-muted">Название профиля редактируется над JSON и сохраняется вместе с конфигурацией.</p>','<div class="sv-two">',select('log','Логирование',[['warning','warning'],['info','info'],['debug','debug'],['error','error'],['none','none']]),select('strategy','Domain strategy',[['AsIs','AsIs'],['IPIfNonMatch','IPIfNonMatch'],['IPOnDemand','IPOnDemand']]),'</div><p data-v="summary" class="sv-muted"></p><p class="sv-note">Пользователи и UUID создаются автоматически вне XRAY STUDIO.</p></div>',
'<div data-section="inbound" hidden><div class="sv-sectionhead"><h4>Входящие соединения (inbounds)</h4><button data-action="add-inbound" type="button">+ Inbound</button></div>',select('inboundSelect','Выберите inbound',[['0','Inbound']]),'<div class="sv-inbound-summary"><span class="sv-statusmark"></span><strong data-v="inboundTitle">vless-main</strong><span class="sv-protobadge" data-v="protocolBadge">VLESS</span><button type="button" data-action="remove-inbound" title="Удалить inbound">✕</button></div><div class="sv-two">',field('tag','Тег inbound'),field('port','Порт','number'),'</div><div class="sv-two">',select('protocol','Протокол',[['vless','VLESS'],['vmess','VMess'],['trojan','Trojan'],['shadowsocks','Shadowsocks'],['hysteria','Hysteria2'],['socks','SOCKS'],['http','HTTP']]),field('listen','Адрес прослушивания'),'</div><div class="sv-two">',select('transport','Транспорт',[['raw','TCP / RAW'],['xhttp','XHTTP'],['ws','WebSocket'],['grpc','gRPC'],['httpupgrade','HTTPUpgrade'],['hysteria','Hysteria2']]),select('security','Защита',[['none','Без TLS'],['reality','Reality'],['tls','TLS']]),'</div><div data-when="reality"><h4>REALITY</h4><p class="sv-muted">Target, SNI, Short ID и ключи X25519 редактируются в отдельном диалоге. Секретные поля удалены из конструктора, чтобы браузер не подставлял учётные данные панели.</p><div class="sv-inline"><button type="button" data-action="reality">Настроить REALITY</button><button type="button" data-action="shortid">Новый Short ID</button></div></div><div data-when="finalmask"><details class="sv-advanced"><summary>FinalMask — TCP / UDP / QUIC</summary><label class="sv-field"><span>streamSettings.finalmask (JSON)</span><textarea data-field="finalmaskJson" rows="6" spellcheck="false" placeholder="{}"></textarea></label><p class="sv-muted">Сервер. Автоэкспорт: TCP Sudoku, header-custom; UDP Salamander/Gecko, Sudoku, mkcp-legacy, header-custom.</p></details><details class="sv-advanced"><summary>Клиентская FinalMask · подписки</summary><label class="sv-field"><span>xmesh.clientFinalmask (JSON)</span><textarea data-field="clientFinalmaskJson" rows="7" spellcheck="false" placeholder="{}"></textarea></label><p class="sv-muted">Явная клиентская сторона: fragment, xmc, noise, xdns (mKCP), xicmp, realm, udphop и quicParams. Имеет приоритет над автоэкспортом. Проверяйте версию Xray на устройстве.</p></details></div><div data-when="hysteria"><h4>Hysteria2</h4><div class="sv-two">',field('hysteriaVersion','Версия','number'),field('hysteriaIdle','UDP idle timeout (с)','number'),'</div></div><div data-when="vless"><h4>VLESS Encryption</h4>',field('vlessDecryption','Decryption (сервер)'),'<p class="sv-muted">none или результат xray vlessenc.</p></div><div data-when="shadowsocks"><h4>Shadowsocks</h4><div class="sv-two">',select('ssMethod','Метод',[['2022-blake3-aes-128-gcm','2022 AES-128-GCM'],['2022-blake3-aes-256-gcm','2022 AES-256-GCM'],['2022-blake3-chacha20-poly1305','2022 ChaCha20']]),field('ssPassword','Секретный ключ','password'),'</div></div><div data-when="xhttp"><h4>Настройки XHTTP</h4><div class="sv-two">',field('path','Path'),select('xhttpMode','Mode',[['auto','auto'],['packet-up','packet-up'],['stream-up','stream-up'],['stream-one','stream-one']]),'</div><details class="sv-advanced"><summary>Расширенные параметры XHTTP</summary><label class="sv-field"><span>xhttpSettings.extra (JSON)</span><textarea data-field="xhttpExtra" rows="7" spellcheck="false" placeholder="{}"></textarea></label><p class="sv-muted">XMUX и другие опции. Поля вне extra не удаляются.</p></details></div><div data-when="tls"><h4>TLS</h4>',field('certificate','Certificate file'),field('key','Private key file'),'</div><p class="sv-note">Клиенты и UUID создаются автоматически вне XRAY STUDIO.</p>'+window.XMeshStudioHosts.view()+'</div>',
'<section class="sv-outbound-preview"><div class="sv-sectionhead"><h4>Исходящие соединения (outbounds)</h4><button type="button" data-action="add-outbound">+ Outbound</button></div><div data-v="outboundQuickList" class="sv-outbound-list"></div></section>',
'<div data-section="outbound" hidden><div class="sv-sectionhead"><h4>Исходящие соединения</h4><button type="button" data-action="add-outbound">+ Outbound</button></div>',select('outSelect','Выберите outbound',[['0','direct']]),field('outTag','Тег outbound'),select('outProtocol','Протокол',[['freedom','Freedom'],['blackhole','Blackhole'],['socks','SOCKS'],['http','HTTP'],['wireguard','WireGuard']]),'<button class="sv-danger" type="button" data-action="remove-outbound">Удалить outbound</button><p class="sv-note">Расширенные настройки outbound остаются в JSON.</p></div>',
'<div data-section="routing" hidden><h4>Маршрутизация</h4>',select('routeStrategy','Domain strategy',[['AsIs','AsIs'],['IPIfNonMatch','IPIfNonMatch'],['IPOnDemand','IPOnDemand']]),'<p class="sv-note">Существующие routing.rules сохраняются. Добавляйте правила через JSON или Tools.</p></div>',
'<div data-section="extra" hidden><h4>Дополнительные параметры</h4>',field('dns','DNS-серверы (через запятую)'),'<p class="sv-note">Другие параметры остаются без изменений.</p></div></div><footer data-v="sync">Синхронизировано с JSON</footer></section>',
'</div>',
'<aside class="sv-outline" id="sv-studio-outline" aria-label="Структура конфигурации"><div class="sv-outline-head"><div><span class="sv-outline-eyebrow">DOCUMENT INSPECTOR</span><h3>Структура</h3></div><button type="button" data-action="outline" aria-label="Скрыть структуру" title="Скрыть структуру">×</button></div><div class="sv-outline-content"><div class="sv-overview-metrics"><div><strong data-v="insInbounds">0</strong><span>Входящие</span></div><div><strong data-v="insOutbounds">0</strong><span>Исходящие</span></div><div><strong data-v="insRules">0</strong><span>Правила</span></div></div><section class="sv-outline-section"><h4>Разделы JSON</h4><nav data-v="jsonOutline" class="sv-outline-nav" aria-label="Навигация по JSON"></nav></section><section class="sv-outline-section"><h4>Входящие соединения</h4><div data-v="inboundOutline" class="sv-inbound-outline"></div></section></div><div class="sv-outline-footer"><span class="sv-outline-status-dot"></span><span data-v="outlineStatus">Ожидается проверка JSON</span><button type="button" data-action="check">Проверить</button></div></aside>',
'</div>',
'<footer class="sv-bottom"><span data-v="saveState">Несохранённая конфигурация</span><div><button type="button" data-action="reset">Сбросить изменения</button></div></footer>',
'<div class="sv-overlay" data-v="overlay" hidden><div class="sv-dialog"><header><h3 data-v="overlayTitle">Профили</h3><button type="button" data-action="close">×</button></header><div data-v="overlayBody"></div></div></div><input data-v="upload" type="file" accept=".json,application/json" hidden></section>'
].join('')}
function mount(root,ctx){
const overlayElement=$(root,'overlay');
const get=k=>$(root,k)||(k==='overlay'?overlayElement:overlayElement.querySelector('[data-v="'+k+'"]'));
const control=k=>root.querySelector('[data-field="'+k+'"]'),value=k=>control(k)?.value||'',set=(k,v)=>{if(control(k))control(k).value=v??''};
const input=get('source'),gutter=get('gutter'),highlight=get('highlight'),minimap=get('minimap');
let name='Новый профиль',id=null,inboundIndex=0,outIndex=0,saved='',locked=false,tools=true;
let diagnosticsLine=null,validatedSource=null,toolPaletteHandle=null;
const notify=msg=>ctx.toast?.(msg);
const studioDialog=window.XMeshStudioDialogs;
 // The composer handles its own buttons; the dialog header close is delegated here.
 overlayElement.addEventListener('click',event=>{
  if(event.target.closest('[data-action="close"]')){event.preventDefault();overlayElement.hidden=true;}
 });
 const overlayWatch=new MutationObserver(()=>{
  if(overlayElement.hidden&&overlayElement.parentElement?.classList.contains('sv-studio-portal')){
   root.append(overlayElement);
   document.querySelector('body > .sv-studio-portal:empty')?.remove();
  }
 });
 overlayWatch.observe(overlayElement,{attributes:true,attributeFilter:['hidden']});
const approve=async spec=>{if(!studioDialog?.confirm)throw Error('Диалоги XRAY STUDIO не загружены');return studioDialog.confirm(spec)};
const unsavedApproval=async description=>input.value===saved||await approve({title:'Несохранённые изменения',description,notice:'Изменения в текущем JSON будут потеряны. При необходимости сначала сохраните профиль.',danger:true,confirmLabel:'Продолжить без сохранения',cancelLabel:'Вернуться'});
 const hostManager=window.XMeshStudioHosts.mount(root,{
   DB:ctx.DB,api:ctx.api,notify,confirm:approve,
   profileId:()=>id,
   inboundTag:()=>{try{return JSON.parse(input.value)?.inbounds?.[inboundIndex]?.tag||''}catch{return ''}}
 });

// Each JSON tab owns its draft, profile identity and editor selection.
const documents=new Map();
let documentSequence=0,activeDocument='draft:0',switchingDocument=false;
function captureDocument(){
 return {id,name,source:input.value,saved,inboundIndex,outIndex,
  start:input.selectionStart,end:input.selectionEnd,scroll:input.scrollTop};
}
function stashDocument(){if(!switchingDocument)documents.set(activeDocument,captureDocument())}
function renderDocumentTabs(){
 const nav=root.querySelector('.sv-page-tabs');
 const editorButton=nav.querySelector('[data-action="studio-editor"]');
 editorButton.hidden=true;
 const tabs=[...documents];
 const counts=new Map();
 for(const [,doc] of tabs){const title=(doc.name||'Новый профиль').trim();counts.set(title,(counts.get(title)||0)+1)}
 const positions=new Map();
 // Reuse existing elements to avoid losing keyboard focus on every keystroke.
 const old=new Map([...nav.querySelectorAll('.sv-json-document-tab')].map(el=>[el.dataset.documentKey,el]));
 let anchor=editorButton;
 for(const [key,doc] of tabs){
  let wrap=old.get(key);
  if(!wrap){
   wrap=document.createElement('span');wrap.className='sv-json-document-tab';wrap.dataset.documentKey=key;
   const button=document.createElement('button');button.type='button';button.className='sv-document-open';button.dataset.docOpen=key;
   const label=document.createElement('span');label.className='sv-document-label';
   const indicator=document.createElement('span');indicator.className='sv-document-indicator';
   indicator.setAttribute('aria-hidden','true');button.append(label,indicator);
   const close=document.createElement('button');close.type='button';close.className='sv-document-close';close.dataset.docClose=key;
   close.textContent='×';wrap.append(button,close);
  }
  const title=(doc.name||'Новый профиль').trim();
  const position=(positions.get(title)||0)+1;positions.set(title,position);
  const display=counts.get(title)>1?title+' · '+position:title;
  const dirty=doc.source!==doc.saved;
  wrap.classList.toggle('active',key===activeDocument);
  wrap.classList.toggle('is-dirty',dirty);
  const button=wrap.querySelector('.sv-document-open'),close=wrap.querySelector('.sv-document-close');
  button.querySelector('.sv-document-label').textContent=display;
  button.title=display+(dirty?' — не сохранено':' — сохранено');
  button.setAttribute('aria-label','Открыть JSON: '+display);
  button.setAttribute('aria-selected',String(key===activeDocument));
  close.title='Закрыть '+display;close.setAttribute('aria-label','Закрыть JSON: '+display);
  anchor.after(wrap);anchor=wrap;old.delete(key);
 }
 for(const el of old.values())el.remove();
 let plus=nav.querySelector('.sv-json-document-add');
 if(!plus){plus=document.createElement('button');plus.type='button';plus.className='sv-json-document-add';plus.dataset.docNew='true';plus.title='Новый JSON';plus.setAttribute('aria-label','Открыть новый JSON-редактор');plus.textContent='+'}
 anchor.after(plus);
}
function switchDocument(key){
 if(key===activeDocument){setPage('editor');return}
 const next=documents.get(key);if(!next)return;
 if(!switchingDocument)stashDocument();switchingDocument=true;
 try{
  activeDocument=key;id=next.id;name=next.name;saved=next.saved;
  inboundIndex=next.inboundIndex;outIndex=next.outIndex;
  hostManager.close();input.value=next.source;
  input.dispatchEvent(new Event('xmesh:reset-history'));
  input.setSelectionRange(Math.min(next.start||0,input.value.length),Math.min(next.end||0,input.value.length));
  input.scrollTop=next.scroll||0;paint();setPage('editor');
 }finally{switchingDocument=false}
 renderDocumentTabs();
}
function openDocument(doc){
 stashDocument();
 const existing=doc.id!=null?[...documents].find(([,d])=>d.id===doc.id&&d.id!=null)?.[0]:null;
 if(existing){switchDocument(existing);return}
 const key='draft:'+ ++documentSequence;
 documents.set(key,{...doc,start:0,end:0,scroll:0});
 switchDocument(key);
}
async function closeDocument(key){
 const doc=key===activeDocument?captureDocument():documents.get(key);
 if(!doc)return;
 if(doc.source!==doc.saved){
  const ok=await approve({title:'Закрыть JSON?',description:'В этом документе есть несохранённые изменения.',notice:'Изменения будут потеряны.',danger:true,confirmLabel:'Закрыть без сохранения'});
  if(!ok)return;
 }
 const isCurrent=key===activeDocument;
 documents.delete(key);
 if(isCurrent){
  const next=documents.keys().next().value;
  if(next){
   // Avoid restoring the just-closed document while switching.
   switchingDocument=true;
   try{activeDocument='__closed__';switchDocument(next)}finally{switchingDocument=false}
  }else{
   const fresh='draft:'+ ++documentSequence;
   activeDocument=fresh;id=null;name='Новый профиль';inboundIndex=outIndex=0;
   saved='';input.value=pretty(defaultDoc());
   input.dispatchEvent(new Event('xmesh:reset-history'));paint();
   documents.set(fresh,captureDocument());
  }
 }
 renderDocumentTabs();
}
let activePage='editor';
function setPage(page){
 activePage=page;
 const editor=page==='editor';
 get('profilesPage').hidden=editor;
 root.querySelector('.sv-workspace').hidden=!editor;
 root.classList.toggle('sv-profiles-active',!editor);
 root.querySelector('.sv-bottom').hidden=!editor;
 for(const b of root.querySelectorAll('.sv-page-tabs>button[data-action]')){
  const selected=b.dataset.action===(editor?'studio-editor':'profiles');
  b.classList.toggle('active',selected);
  if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
 }
 if(!editor)renderProfiles();
}
async function openProfile(p){
 try{
  const d=typeof p.config==='string'?JSON.parse(p.config):p.config;
  openDocument({id:p.id,name:p.name||'Без названия',source:pretty(d),saved:pretty(d),inboundIndex:0,outIndex:0});
 }catch(err){notify('Не удалось открыть профиль: '+err.message)}
}
async function newProfile(){
 openDocument({id:null,name:'Новый профиль',source:pretty(defaultDoc()),saved:'',inboundIndex:0,outIndex:0});
}
function describeProfile(p){
 try{
  const raw=typeof p.config==='string'?JSON.parse(p.config):p.config;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Неверная структура');
  const inbound=Array.isArray(raw.inbounds)?raw.inbounds:[];
  const outbound=Array.isArray(raw.outbounds)?raw.outbounds:[];
  const protocols=[...new Set(inbound.map(x=>String(x?.protocol||'').toUpperCase()).filter(Boolean))];
  const security=[...new Set(inbound.map(x=>x?.streamSettings?.security).filter(x=>x&&x!=='none'))];
  const transport=[...new Set(inbound.map(x=>x?.streamSettings?.network).filter(Boolean))];
  const tags=inbound.map(x=>String(x?.tag||'')).filter(Boolean);
  return {valid:true,inbound:inbound.length,outbound:outbound.length,protocols,security,transport,tags};
 }catch{
  return {valid:false,inbound:0,outbound:0,protocols:[],security:[],transport:[],tags:[]};
 }
}
const profileEl=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el};
function renderProfiles(){
 const all=Array.isArray(ctx.DB.profiles)?ctx.DB.profiles:[];
 const search=get('profilesSearch').value.trim().toLocaleLowerCase();
 const list=get('profilesList');list.replaceChildren();
 get('profilesCount').textContent=String(all.length);
 get('profilesTotal').textContent=String(all.length);
 const current=all.find(p=>String(p.id)===String(id)&&id!=null);
 get('profilesActive').textContent=current?'Открыт: '+(current.name||'Без названия'):'Нет открытого профиля';
 const found=all.filter(p=>{
  if(!search)return true;
  const info=describeProfile(p);
  return [p.name,...info.tags,...info.protocols,...info.transport].join(' ').toLocaleLowerCase().includes(search);
 });
 get('profilesFound').textContent=search?'Найдено: '+found.length+' из '+all.length:'Показано: '+all.length;
 if(!found.length){
  const empty=profileEl('div','sv-library-empty');
  const symbol=profileEl('span','sv-library-empty-symbol');
  symbol.innerHTML='<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="13" y="14" width="38" height="10" rx="3"/><rect x="13" y="29" width="38" height="10" rx="3"/><rect x="13" y="44" width="38" height="10" rx="3"/><path d="M21 19h.01M21 34h.01M21 49h.01"/></svg>';
  const title=profileEl('h3','',search?'Совпадений не найдено':'Здесь появятся ваши профили');
  const desc=profileEl('p','',search?'Попробуйте другой запрос — можно искать по названию, тегу и протоколу.':'Создайте первый профиль Xray, затем откройте его для настройки конфигурации.');
  const btn=profileEl('button','sv-library-empty-action',search?'Очистить поиск':'Создать первый профиль');
  btn.type='button';
  btn.onclick=search?()=>{get('profilesSearch').value='';renderProfiles();get('profilesSearch').focus()}:newProfile;
  empty.append(symbol,title,desc,btn);list.append(empty);return;
 }
 for(const p of found){
  const info=describeProfile(p);
  const selected=id!=null&&String(p.id)===String(id);
  const card=profileEl('article','sv-profile-card'+(selected?' is-current':''));
  const heading=profileEl('div','sv-profile-top');
  const emblem=profileEl('span','sv-profile-emblem');
  emblem.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="6" rx="1.5"/><rect x="3.5" y="14" width="17" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/></svg>';
  const titles=profileEl('div','sv-profile-titles');
  const nameEl=profileEl('h3','',p.name||'Без названия');nameEl.title=p.name||'Без названия';
  const subtitle=profileEl('p','',info.valid?(info.tags[0]||'Конфигурация Xray'):'Конфигурация требует проверки');
  titles.append(nameEl,subtitle);
  const active=profileEl('span','sv-profile-state'+(selected?' is-current':''),selected?'Открыт':info.valid?'Сохранён':'Ошибка JSON');
  heading.append(emblem,titles,active);
  const chips=profileEl('div','sv-profile-chips');
  for(const protocol of info.protocols.slice(0,3))chips.append(profileEl('span','sv-profile-chip is-protocol',protocol));
  for(const security of info.security.slice(0,2))chips.append(profileEl('span','sv-profile-chip is-security',security.toUpperCase()));
  if(!info.protocols.length)chips.append(profileEl('span','sv-profile-chip',info.valid?'Нет inbound':'Требует проверки'));
  const stats=profileEl('div','sv-profile-stats');
  const first=profileEl('div','sv-profile-stat');
  first.append(profileEl('strong','',info.inbound),profileEl('span','','Входящих'));
  const second=profileEl('div','sv-profile-stat');
  second.append(profileEl('strong','',info.outbound),profileEl('span','','Исходящих'));
  const third=profileEl('div','sv-profile-stat');
  third.append(profileEl('strong','',info.transport[0]?.toUpperCase()||'—'),profileEl('span','','Транспорт'));
  stats.append(first,second,third);
  const footer=profileEl('div','sv-profile-footer');
  const open=profileEl('button','sv-profile-open','Открыть профиль');
  open.type='button';open.setAttribute('aria-label','Открыть '+(p.name||'профиль'));
  open.append(profileEl('span','sv-open-arrow','→'));
  open.onclick=()=>openProfile(p);
  const del=profileEl('button','sv-profile-delete');
  del.type='button';del.title='Удалить профиль';
  del.setAttribute('aria-label','Удалить профиль '+(p.name||'Без названия'));
  del.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
  del.onclick=async()=>{
   if(!await approve({title:'Удалить профиль?',description:'Профиль «'+(p.name||'Без названия')+'» будет удалён из библиотеки.',notice:'Действие необратимо. Проверьте назначения профиля рабочим узлам.',danger:true,confirmLabel:'Удалить профиль',cancelLabel:'Отмена'}))return;
   del.disabled=true;
   try{
    await ctx.api.remove('profiles',p.id);
    if(id!=null&&String(id)===String(p.id)){
     id=null;name='Новый профиль';saved='';
     paint();
    }
    notify('Профиль удалён');
    renderProfiles();
   }catch(error){del.disabled=false;notify('Ошибка удаления: '+error.message)}
  };
  footer.append(open,del);
  card.append(heading,chips,stats,footer);
  list.append(card);
 }
}
get('profilesSearch').addEventListener('input',renderProfiles);
const json=()=>{const d=JSON.parse(input.value);if(!d||typeof d!=='object'||Array.isArray(d))throw Error('JSON должен быть объектом');return d};
const hasValidJSON=()=>{try{return json()}catch{return null}};
const pretty=d=>JSON.stringify(d,null,2);
// Read-only document inspector. Never copies secrets from the Xray configuration.
let outlineSignature='';
const outlineSections=[
 ['log','Логирование'],['dns','DNS'],['inbounds','Inbounds'],
 ['outbounds','Outbounds'],['routing','Маршрутизация'],['policy','Политики'],['stats','Статистика']
];
function inspectorButton(label,description,jump){
 const btn=document.createElement('button');btn.type='button';btn.className='sv-outline-item';
 btn.dataset.svJump=jump;btn.title='Найти в JSON: '+label;
 const left=document.createElement('span');left.className='sv-outline-item-label';left.textContent=label;
 const note=document.createElement('small');note.textContent=description||'';
 const arrow=document.createElement('span');arrow.className='sv-outline-item-arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');
 btn.append(left,note,arrow);return btn;
}
function renderInspector(doc,issues=[],source=''){
 const inbounds=Array.isArray(doc?.inbounds)?doc.inbounds:[];
 const outbounds=Array.isArray(doc?.outbounds)?doc.outbounds:[];
 const rules=Array.isArray(doc?.routing?.rules)?doc.routing.rules:[];
 const errors=issues.filter(issue=>issue.severity==='error').length;
 const sourceIsValid=Boolean(doc);
 const coreVerified=sourceIsValid&&validatedSource===source&&!get('coreIssues').hidden;
 const key=JSON.stringify({properties:doc?Object.keys(doc):[],inbounds:inbounds.map(x=>[x?.tag,x?.protocol,x?.streamSettings?.network,x?.streamSettings?.security]),outbounds:outbounds.length,rules:rules.length,errors,coreVerified,coreStatus:get('coreIssues').dataset.status||''});
 if(key===outlineSignature)return;
 outlineSignature=key;
 get('insInbounds').textContent=sourceIsValid?String(inbounds.length):'—';
 get('insOutbounds').textContent=sourceIsValid?String(outbounds.length):'—';
 get('insRules').textContent=sourceIsValid?String(rules.length):'—';
 const nav=get('jsonOutline');nav.replaceChildren();
 const inboundList=get('inboundOutline');inboundList.replaceChildren();
 if(sourceIsValid){
  for(const [key,label] of outlineSections){
   if(!Object.prototype.hasOwnProperty.call(doc,key))continue;
   const value=doc[key];
   const description=Array.isArray(value)?value.length+' элементов':typeof value==='object'&&value!==null?Object.keys(value).length+' полей':'Значение';
   nav.append(inspectorButton(label,description,key));
  }
  for(const [index,ib] of inbounds.slice(0,12).entries()){
   const name=typeof ib?.tag==='string'&&ib.tag?ib.tag:'Inbound '+(index+1);
   const protocol=String(ib?.protocol||'unknown').toUpperCase();
   const network=String(ib?.streamSettings?.network||'raw').toUpperCase();
   const security=String(ib?.streamSettings?.security||'none').toUpperCase();
   inboundList.append(inspectorButton(name,protocol+' · '+network+' · '+security,'inbound:'+index));
  }
  if(inbounds.length>12){const more=document.createElement('p');more.className='sv-outline-more';more.textContent='Ещё '+(inbounds.length-12)+' inbound — в JSON';inboundList.append(more)}
 }else{
  const msg=document.createElement('p');msg.className='sv-outline-empty';msg.textContent='Исправьте синтаксис JSON — структура появится автоматически.';nav.append(msg);
 }
 if(sourceIsValid&&!inbounds.length){
  const empty=document.createElement('p');empty.className='sv-outline-empty';empty.textContent='Входящих соединений пока нет';inboundList.append(empty);
 }
 const status=get('outlineStatus');
 const dot=root.querySelector('.sv-outline-status-dot');
 let state='neutral';
 if(!sourceIsValid){status.textContent='Ошибка синтаксиса JSON';state='bad'}
 else if(errors){status.textContent='Ошибки анализа: '+errors;state='bad'}
 else if(coreVerified){
  state=get('coreIssues').dataset.status==='ok'?'ok':'bad';
  status.textContent=state==='ok'?'Проверено Xray-core':'Xray-core: ошибка проверки';
 }else{status.textContent='JSON разобран · ядро не проверено';state='neutral'}
 dot.dataset.status=state;
}
function jumpToSection(jump){
 const source=input.value;
 let offset=-1;
 if(jump.startsWith('inbound:')){
  const index=Number(jump.slice(8)),data=hasValidJSON();
  const inbound=Array.isArray(data?.inbounds)?data.inbounds[index]:null;
  const base=source.indexOf('"inbounds"');
  if(inbound?.tag&&base>=0)offset=source.indexOf(JSON.stringify(inbound.tag),base);
  if(offset<0)offset=base;
 }else if(outlineSections.some(([key])=>key===jump)){
  offset=source.indexOf('"'+jump+'"');
 }
 if(offset<0)return;
 input.focus({preventScroll:true});input.setSelectionRange(offset,offset);
 // The browser scrolls selection into view while preserving the code/editor overlay.
 const line=source.slice(0,offset).split('\n').length;
 const styles=getComputedStyle(input);
 const lineHeight=parseFloat(styles.lineHeight)||22;
 input.scrollTop=Math.max(0,(line-5)*lineHeight);
 input.dispatchEvent(new Event('scroll'));
 const parts=source.slice(0,offset).split('\n');
 get('position').textContent='Строка '+parts.length+', столбец '+(parts.at(-1).length+1);
}
function setInspectorVisible(show,persist=true){
 root.classList.toggle('sv-outline-hidden',!show);
 const panel=get('jsonOutline')?.closest('.sv-outline');
 if(panel){
  if(!show&&panel.contains(document.activeElement))
   root.querySelector('.sv-codebar [data-action="outline"]')?.focus({preventScroll:true});
  panel.setAttribute('aria-hidden',String(!show));
 }
 root.querySelectorAll('[data-action="outline"]').forEach(button=>{
  if(button.hasAttribute('aria-expanded'))button.setAttribute('aria-expanded',String(show));
 });
 if(persist){try{window.localStorage?.setItem('xmesh-studio-inspector',show?'visible':'hidden')}catch(_){}}
}
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
 renderInspector(obj,issues,source);
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
 get('lines').textContent=source.split('\n').length+' строк';
 const count=Math.min(source.split('\n').length,10000);
 gutter.textContent=Array.from({length:count},(_,i)=>{
  const n=i+1;return (diagnosticsLine===n?'✕ ':byLine.has(n)?'! ':'')+n;
 }).join('\n');
 const parts=source.slice(0,input.selectionStart).split('\n');
 get('position').textContent='Строка '+parts.length+', столбец '+(parts.at(-1).length+1);
 const dirty=input.value!==saved;
 get('dirty').textContent=dirty?'● Не сохранено':'✓ Сохранено';
 get('dirty').dataset.state=dirty?'pending':'saved';
 root.dataset.dirty=dirty?'true':'false';
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
 toolPaletteHandle?.refresh();
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
 hostManager.render();
 set('tag',ib.tag);get('inboundTitle').textContent=ib.tag||'Inbound';get('protocolBadge').textContent=(ib.protocol||'').toUpperCase();set('port',ib.port);set('listen',ib.listen||'0.0.0.0');set('protocol',ib.protocol||'vless');set('transport',ss.network||'raw');set('security',ss.security||'none');
 set('path',ss.xhttpSettings?.path||'/xhttp');set('xhttpMode',ss.xhttpSettings?.mode||'auto');set('finalmaskJson',JSON.stringify(ss.finalmask||{},null,2));set('clientFinalmaskJson',JSON.stringify(ib.xmesh?.clientFinalmask||{},null,2));set('hysteriaVersion',ib.settings?.version||2);set('hysteriaIdle',ss.hysteriaSettings?.udpIdleTimeout??60);set('vlessDecryption',ib.settings?.decryption||'none');set('ssMethod',ib.settings?.method||'2022-blake3-aes-128-gcm');set('ssPassword',ib.settings?.password||'');set('xhttpExtra',JSON.stringify(ss.xhttpSettings?.extra||{},null,2));
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
async function formChanged(el){
 if(locked||!el.dataset.field)return;const k=el.dataset.field;
 if(k==='name'){name=el.value;stashDocument();renderDocumentTabs();get('saveState').textContent='Имя профиля будет сохранено при сохранении';return}
 if(k==='inboundSelect'){inboundIndex=Number(el.value);sync(json());return}
 if(k==='outSelect'){outIndex=Number(el.value);sync(json());return}
 if(k==='protocol'){
  try{
   const before=json(),ib=currentInbound(before);
   if(ib.protocol!==el.value){
    const count=(ib.settings?.users||ib.settings?.clients||[]).length;
    const ok=await approve({title:'Изменить протокол inbound?',
      description:'Переключить «'+(ib.tag||'inbound')+'» с '+String(ib.protocol).toUpperCase()+' на '+el.value.toUpperCase()+'?',
      notice:'Специфичные настройки прежнего протокола будут заменены.'+(count?' Текущих пользователей: '+count+'.':''),
      danger:count>0,confirmLabel:'Сменить протокол',cancelLabel:'Отмена'});
    if(!ok){sync(json());return}
   }
  }catch(e){notify(e.message);sync(json());return}
 }
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
 if(k==='finalmaskJson'||k==='clientFinalmaskJson'){
  let parsed;try{parsed=JSON.parse(el.value)}catch{throw Error('Некорректный JSON FinalMask')}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('FinalMask должен быть объектом');
  const allowed=['tcp','udp','quicParams'];
  if(Object.keys(parsed).some(key=>!allowed.includes(key)))throw Error('FinalMask: разрешены только tcp, udp и quicParams');
  for(const key of ['tcp','udp']){
   if(parsed[key]!==undefined&&(!Array.isArray(parsed[key])||parsed[key].length>16))throw Error('FinalMask '+key+': требуется массив до 16 слоёв');
   if(parsed[key]?.some(x=>!x||typeof x.type!=='string'||!x.settings||typeof x.settings!=='object'||Array.isArray(x.settings)))throw Error('FinalMask '+key+': каждый слой требует type и settings');
  }
  if(parsed.quicParams!==undefined&&(!parsed.quicParams||typeof parsed.quicParams!=='object'||Array.isArray(parsed.quicParams)))throw Error('FinalMask quicParams должен быть объектом');
  if(k==='clientFinalmaskJson'){
   if(Object.values(parsed).some(x=>Array.isArray(x)&&x.some(layer=>layer.type==='filter')))throw Error('FinalMask filter используется только на сервере');
   if(Object.keys(parsed).length)(ib.xmesh??={}).clientFinalmask=parsed;
   else if(ib.xmesh){delete ib.xmesh.clientFinalmask;if(!Object.keys(ib.xmesh).length)delete ib.xmesh}
  }else if(Object.keys(parsed).length)ss.finalmask=parsed;else delete ss.finalmask;
 }
 if(k==='hysteriaVersion'){if(ib.protocol!=='hysteria')throw Error('Не Hysteria2 inbound');if(Number(el.value)!==2)throw Error('Поддерживается Hysteria v2');ib.settings.version=2}
 if(k==='hysteriaIdle'){if(ib.protocol!=='hysteria')throw Error('Не Hysteria2 inbound');(ss.hysteriaSettings??={version:2}).udpIdleTimeout=Number(el.value)}
 if(k==='vlessDecryption'){if(ib.protocol!=='vless')throw Error('Не VLESS inbound');(ib.settings??={}).decryption=el.value.trim()}
 if(k==='ssMethod'||k==='ssPassword'){if(ib.protocol!=='shadowsocks')throw Error('Не Shadowsocks inbound');(ib.settings??={})[k==='ssMethod'?'method':'password']=el.value}
 if(k==='xhttpExtra'){let parsed;try{parsed=JSON.parse(el.value)}catch{throw Error('Некорректный JSON в xhttpSettings.extra')}if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('xhttpSettings.extra должен быть JSON-объектом');(ss.xhttpSettings??={path:'/xhttp',mode:'auto'}).extra=parsed}

 if(k==='transport')ss.network=el.value;
 if(k==='security'){ss.security=el.value;if(el.value==='reality'){const r=ss.realitySettings??={show:false,serverNames:[],shortIds:[]};if(!Array.isArray(r.shortIds)||r.shortIds.length===0)r.shortIds=[generateRealityShortId()];}}

 if(k==='path')(ss.xhttpSettings??={mode:'auto'}).path=el.value;if(k==='xhttpMode')(ss.xhttpSettings??={path:'/xhttp'}).mode=el.value;
 if(k==='certificate'||k==='key'){const tls=ss.tlsSettings??={certificates:[{}]};tls.certificates??=[{}];tls.certificates[0]??={};tls.certificates[0][k==='certificate'?'certificateFile':'keyFile']=el.value}
 }
 });
 if(k==='protocol'&&el.value==='shadowsocks')notify('Shadowsocks: укажите надёжный ключ перед публикацией.');
}
const validRealityX25519Key=key=>typeof key==='string'&&/^[A-Za-z0-9_-]{43}$/.test(key);
function validate(d){if(!Array.isArray(d.inbounds)||!d.inbounds.length)throw Error('Нужен хотя бы один inbound');const tags=new Set();for(const x of d.inbounds){
 if(x.protocol==='vless'&&!Array.isArray(x.settings?.users))throw Error('VLESS inbound требует settings.users (массив).');
 if((x.protocol==='vmess'||x.protocol==='trojan')&&!Array.isArray(x.settings?.users))throw Error(x.protocol.toUpperCase()+' inbound требует settings.users (массив).');
 if(x.protocol==='hysteria'&&(x.settings?.version!==2||x.streamSettings?.network!=='hysteria'))throw Error('Hysteria2 требует settings.version=2 и transport hysteria.');
 if(x.protocol==='shadowsocks'&&(!x.settings?.method||!x.settings?.password))throw Error('Shadowsocks: необходимо указать method и password в серверном JSON.');
if(!x.tag||tags.has(x.tag))throw Error('Пустой или повторяющийся tag inbound');tags.add(x.tag);if(!Number.isInteger(x.port)||x.port<1||x.port>65535)throw Error('Некорректный порт '+x.tag);
 // Reject credentials accidentally injected by a browser password manager.
 // Also inspect dormant realitySettings under security="none".
 const reality=x.streamSettings?.realitySettings;
 if(reality!==undefined){
  if(!reality||typeof reality!=='object'||Array.isArray(reality))throw Error('REALITY '+x.tag+': realitySettings должен быть объектом.');
  if(reality.privateKey&&!validRealityX25519Key(reality.privateKey))throw Error('REALITY '+x.tag+': privateKey неверного формата. Требуется X25519 base64url (43 символа). Возможно, браузер подставил пароль администратора. Откройте «Настроить REALITY».');
  if(reality.shortIds!==undefined){
   if(!Array.isArray(reality.shortIds))throw Error('REALITY '+x.tag+': shortIds должен быть массивом.');
   const uniqueIds=new Set();
   for(const item of reality.shortIds){
    if(typeof item!=='string'||!/^(?:[0-9a-fA-F]{2}){0,8}$/.test(item))throw Error('REALITY '+x.tag+': Short ID должен быть HEX до 16 символов. Используйте «Настроить REALITY».');
    if(uniqueIds.has(item.toLowerCase()))throw Error('REALITY '+x.tag+': повторяющийся Short ID.');
    uniqueIds.add(item.toLowerCase());
   }
  }
 }
 if(x.streamSettings?.security==='reality'){
 const r=x.streamSettings.realitySettings||{};
 if(!['raw','xhttp','grpc'].includes(x.streamSettings.network||'raw'))throw Error('REALITY допускает только RAW, XHTTP и gRPC для '+x.tag);
 if(!validRealityX25519Key(r.privateKey)||!(r.target||r.dest)||!Array.isArray(r.serverNames)||!r.serverNames.length)throw Error('REALITY '+x.tag+': требуется X25519 privateKey (base64url, 43 символа), target и SNI. Используйте «Настроить REALITY».');
 if(!Array.isArray(r.shortIds)||!r.shortIds.length)throw Error('Reality: добавьте хотя бы один Short ID для '+x.tag);
 const ids=new Set();
 for(const value of r.shortIds){
  if(typeof value!=='string'||!/^(?:[0-9a-fA-F]{2}){0,8}$/.test(value))throw Error('Reality '+x.tag+': неверный Short ID '+JSON.stringify(value)+'. Нажмите Short ID, чтобы исправить.');
  if(ids.has(value.toLowerCase()))throw Error('Reality '+x.tag+': повторяющийся Short ID '+JSON.stringify(value));
  ids.add(value.toLowerCase());
 }
 }
}}
function openComposer(){
 // Move the constructor into a body-level portal to blur the whole app shell.
 // Preserve the original overlay and its event handlers; restore it on close.
 if(overlayElement.parentElement===root){
  const portal=document.createElement('div');
  portal.className='sv-studio sv-studio-portal';
  portal.append(overlayElement);
  document.body.append(portal);
 }
 const engine=window.XMeshStudioComposer;
 if(!engine){notify('Конструктор не загружен. Обновите страницу без кеша.');return}
 const overlay=get('overlay'),body=get('overlayBody');
 overlay.classList.add('sv-overlay-composer');
 get('overlayTitle').textContent='Конструктор конфигураций';
 const original=hasValidJSON();
 const primary=Array.isArray(original?.inbounds)?original.inbounds[0]:null;
 const opts={...engine.defaults};
 if(primary){
  const proto=String(primary.protocol||''),net=String(primary.streamSettings?.network||'raw');
  opts.protocol=engine.protocols.some(x=>x.id===proto)?proto:'custom';
  opts.customProtocol=opts.protocol==='custom'?proto:'';
  opts.transport=engine.transports.some(x=>x.id===net)?net:'custom';
  opts.customTransport=opts.transport==='custom'?net:'';
  opts.security=primary.streamSettings?.security||'none';
  opts.port=primary.port||443;
  opts.path=primary.streamSettings?.xhttpSettings?.path||primary.streamSettings?.wsSettings?.path||primary.streamSettings?.grpcSettings?.serviceName||'/xhttp';
  opts.target=primary.streamSettings?.realitySettings?.target||'';
  opts.sni=primary.streamSettings?.realitySettings?.serverNames?.[0]||'';
   opts.alpn=primary.streamSettings?.tlsSettings?.alpn?.join(', ')||'auto';
   opts.certificateFile=primary.streamSettings?.tlsSettings?.certificates?.[0]?.certificateFile||'';
   opts.keyFile=primary.streamSettings?.tlsSettings?.certificates?.[0]?.keyFile||'';
 }
 opts.tag=(opts.protocol==='custom'?(opts.customProtocol||'server'):opts.protocol)+'-main';
 opts.name='Новая конфигурация';
 let autoTag=true,tab='builder',busy=false;
 const comboCount=engine.countKnownCombinations();
 body.innerHTML=
 '<div class="sv-compose" data-compose-root>'+
   '<div class="sv-compose-intro"><div><span class="sv-compose-kicker">КОНСТРУКТОР XRAY</span>'+
      '<p>Протокол, транспорт и защита — любые доступные сочетания.</p></div>'+
      '<div class="sv-compose-count"><strong>'+comboCount+'</strong><span>сочетания<br>+ ручной JSON</span></div></div>'+
   '<div class="sv-compose-tabs" role="tablist" aria-label="Режим конструктора">'+
      '<button type="button" data-compose-tab="builder" aria-selected="true">Собрать своё</button>'+
      '<button type="button" data-compose-tab="examples" aria-selected="false">Быстрый старт</button></div>'+
   '<div class="sv-compose-workspace" data-compose-workspace>'+
      '<div class="sv-compose-form">'+
       '<div class="sv-compose-choices" data-compose-choices></div>'+
       '<div class="sv-compose-parameters"><div class="sv-compose-panel-heading"><h4>Параметры нового inbound</h4><span>Будут записаны в JSON</span></div>'+
         '<div class="sv-compose-fields">'+
           '<label><span>Название профиля</span><input data-compose-field="name" maxlength="100" autocomplete="off"></label>'+
           '<label><span>Тег inbound</span><input data-compose-field="tag" maxlength="64" autocomplete="off" spellcheck="false"></label>'+
           '<label><span>Порт</span><input data-compose-field="port" type="number" min="1" max="65535"></label>'+
           '<label><span>Listen</span><input data-compose-field="listen" placeholder="127.0.0.1" spellcheck="false"></label>'+
           '<label data-compose-when="alpn" class="sv-compose-field-wide"><span>ALPN (auto / h2 / h3 / http/1.1)</span><input data-compose-field="alpn" placeholder="auto" spellcheck="false"></label>'+
           '<label data-compose-when="certificateFile" class="sv-compose-field-wide"><span>TLS certificateFile (путь на ноде)</span><input data-compose-field="certificateFile" placeholder="/etc/letsencrypt/live/domain/fullchain.pem" spellcheck="false"></label>'+
           '<label data-compose-when="keyFile" class="sv-compose-field-wide"><span>TLS keyFile (путь на ноде)</span><input data-compose-field="keyFile" placeholder="/etc/letsencrypt/live/domain/privkey.pem" spellcheck="false"></label>'+
           '<label data-compose-when="vlessDecryption" class="sv-compose-field-wide"><span>VLESS Encryption · decryption (xray vlessenc)</span><input data-compose-field="vlessDecryption" autocomplete="off" spellcheck="false"></label>'+
           '<label data-compose-when="xdriveService"><span>XDRIVE service</span><select data-compose-field="xdriveService"><option value="local">local</option><option value="google-drive">google-drive</option><option value="template">template</option></select></label>'+
           '<label data-compose-when="xdriveRemoteFolder" class="sv-compose-field-wide"><span>XDRIVE remoteFolder</span><input data-compose-field="xdriveRemoteFolder" spellcheck="false"></label>'+
           '<label data-compose-when="xdriveSecrets" class="sv-compose-field-wide"><span>XDRIVE secrets (по одному на строку)</span><textarea data-compose-field="xdriveSecrets" rows="3" autocomplete="off" spellcheck="false"></textarea></label>'+
           '<label data-compose-when="xdriveTemplate" class="sv-compose-field-wide"><span>XDRIVE template (JSON)</span><textarea data-compose-field="xdriveTemplate" rows="6" spellcheck="false"></textarea></label>'+
           '<label data-compose-when="path" class="sv-compose-field-wide"><span>Путь / serviceName</span><input data-compose-field="path" spellcheck="false"></label>'+
           '<label data-compose-when="target" class="sv-compose-field-wide"><span>REALITY target (домен:порт)</span><input data-compose-field="target" placeholder="your-domain.example:443" autocomplete="off" spellcheck="false"></label>'+
           '<label data-compose-when="sni" class="sv-compose-field-wide"><span>REALITY SNI</span><input data-compose-field="sni" placeholder="your-domain.example" autocomplete="off" spellcheck="false"></label>'+
           '<label data-compose-when="method" class="sv-compose-field-wide"><span>Метод Shadowsocks</span><select data-compose-field="method"></select></label>'+
           '<label data-compose-when="customProtocol" class="sv-compose-field-wide"><span>Название своего протокола в Xray-core</span><input data-compose-field="customProtocol" placeholder="my-protocol" spellcheck="false"></label>'+
           '<label data-compose-when="customTransport" class="sv-compose-field-wide"><span>Название своего транспорта в Xray-core</span><input data-compose-field="customTransport" placeholder="my-transport" spellcheck="false"></label>'+
         '</div>'+
       '</div>'+
       ''+
      '</div>'+
      '<aside class="sv-compose-preview"><div class="sv-compose-preview-head"><span>LIVE JSON / INBOUND</span><strong data-compose-summary>—</strong></div>'+
       '<div class="sv-compose-diagnostics"><strong data-compose-state>Черновик</strong><div data-compose-messages></div></div>'+
       '<pre data-compose-json aria-label="Предпросмотр создаваемого inbound"></pre>'+
       '<p class="sv-compose-preview-note">Это предварительный JSON. Секреты добавляются только при создании; окончательная проверка — через Xray-core.</p></aside>'+
   '</div>'+
   '<div class="sv-compose-examples" data-compose-examples hidden></div>'+
   '<div class="sv-compose-footer">'+
    '<fieldset class="sv-compose-apply-mode"><legend>Результат</legend>'+
     '<label><input type="radio" name="sv-compose-mode" value="new" checked><span>Новый профиль</span></label>'+
     '<label><input type="radio" name="sv-compose-mode" value="add"><span>Добавить inbound</span></label>'+
    '</fieldset>'+
    '<label class="sv-compose-override" data-compose-override hidden>'+
      '<input type="checkbox" data-compose-field="allowExperimental"> Всё равно создать экспериментальный JSON с предупреждениями</label>'+
    '<span class="sv-compose-footer-note" data-compose-footer-note>Черновик · без перезапуска нод</span>'+
    '<button type="button" data-compose-close>Отмена</button>'+
    '<button type="button" class="sv-primary" data-compose-apply>Создать JSON</button></div>'+
 '</div>';
 const scope=body.querySelector('[data-compose-root]'),by=name=>scope.querySelector('[data-compose-field="'+name+'"]');
 const list=scope.querySelector('[data-compose-choices]'),examples=scope.querySelector('[data-compose-examples]');
 const choose=scope.querySelector('[data-compose-apply]'),messages=scope.querySelector('[data-compose-messages]'),preview=scope.querySelector('[data-compose-json]');
 const groups=[['protocol','Протокол',engine.protocols],['transport','Транспорт',engine.transports],['security','Защита',engine.securities]];
 const htmlSafe=escapeHtml;
 for(const method of engine.shadowsocksMethods){
  const opt=document.createElement('option');opt.value=method.id;opt.textContent=method.id;by('method').append(opt);
 }
 const allInputs=scope.querySelectorAll('[data-compose-field]');
 const renderFields=()=>{
  for(const el of allInputs){
   if(el.type==='checkbox')el.checked=Boolean(opts[el.dataset.composeField]);
   else el.value=String(opts[el.dataset.composeField]??'');
  }
  const protocol=opts.protocol,network=opts.transport,security=opts.security;
  const flags={
   path:['xhttp','ws','grpc','httpupgrade'].includes(network),
   target:security==='reality',sni:security==='reality',
    alpn:security==='tls',certificateFile:security==='tls',keyFile:security==='tls',
   vlessDecryption:network==='xdrive',xdriveService:network==='xdrive',
   xdriveRemoteFolder:network==='xdrive',
   xdriveSecrets:network==='xdrive'&&['google-drive','template'].includes(opts.xdriveService),
   xdriveTemplate:network==='xdrive'&&opts.xdriveService==='template',
   method:protocol==='shadowsocks',customProtocol:protocol==='custom',
   customTransport:network==='custom'
  };
  for(const el of scope.querySelectorAll('[data-compose-when]'))el.hidden=!flags[el.dataset.composeWhen];
  for(const radio of scope.querySelectorAll('[name="sv-compose-mode"]'))radio.checked=radio.value===opts.mode;
 };
 const renderChoices=()=>{
  list.replaceChildren();
  for(const [key,title,choices] of groups){
   const group=document.createElement('section');group.className='sv-compose-choice-group';
   const heading=document.createElement('h4');heading.textContent=title;group.append(heading);
   for(const choice of choices){
    const button=document.createElement('button');button.type='button';
    button.className='sv-compose-choice'+(opts[key]===choice.id?' active':'');
    button.dataset.composeChoice=key;button.dataset.composeValue=choice.id;
    button.setAttribute('aria-pressed',String(opts[key]===choice.id));
    const top=document.createElement('strong');top.textContent=choice.label;
    const hint=document.createElement('small');hint.textContent=choice.hint;
    button.append(top,hint);group.append(button);
   }
   list.append(group);
  }
 };
 const renderExamples=()=>{
  examples.replaceChildren();
  const lead=document.createElement('div');lead.className='sv-compose-examples-title';lead.textContent='Примеры можно использовать как отправную точку — любую часть затем можно поменять.';
  examples.append(lead);
  for(const preset of engine.presets){
   const button=document.createElement('button');button.type='button';button.className='sv-compose-example';button.dataset.composePreset=preset.id;
   const label=document.createElement('strong');label.textContent=preset.label;
   const note=document.createElement('small');note.textContent=preset.description;
   const mark=document.createElement('span');mark.textContent='Настроить ↗';
   button.append(label,note,mark);examples.append(button);
  }
 };
 const validation=()=>{
  const quality=engine.analyze(opts);
  const issues=[...quality.errors.map(message=>['error',message]),...quality.warnings.map(message=>['warning',message]),...quality.info.map(message=>['info',message])];
  if(opts.mode==='add'&&(!original||!Array.isArray(original.inbounds)))issues.unshift(['error','Текущий JSON нельзя разобрать: сначала исправьте его или создайте новый профиль.']);
  if(opts.mode==='add'&&original?.inbounds?.some(ib=>ib.tag===opts.tag))issues.unshift(['error','Этот тег inbound уже существует. Укажите уникальный тег.']);
  if(opts.security==='reality'&&(!opts.target||!opts.sni))issues.push(['warning','Укажите реальный target и SNI. Без них REALITY не готов к запуску.']);
  if(opts.protocol==='shadowsocks')issues.push(['info','Ключ Shadowsocks будет сгенерирован локально криптографическим генератором браузера.']);
  return {quality,issues};
 };
 const renderPreview=()=>{
  const {quality,issues}=validation();
  const experimental=quality.errors.length>0;
  const override=scope.querySelector('[data-compose-override]');
  override.hidden=!experimental;
  scope.querySelector('[data-compose-state]').textContent=quality.status==='unsupported'?'Комбинация не поддерживается':quality.status==='unknown'?'Неизвестно ядру':quality.status==='review'?'Требуются дополнительные настройки':'По таблице Xray допустимо';
  scope.querySelector('[data-compose-state]').dataset.severity=experimental?'error':quality.status==='supported'?'ok':'warning';
  scope.querySelector('[data-compose-summary]').textContent=[quality.protocol||'?',quality.transport||'?',quality.security||'?'].join(' / ');
  messages.replaceChildren();
  for(const [kind,text] of issues.slice(0,7)){
   const row=document.createElement('p');row.className='sv-compose-message '+kind;row.textContent=text;messages.append(row);
  }
  if(!issues.length){const row=document.createElement('p');row.className='sv-compose-message ok';row.textContent='Предварительно допустимо по таблице транспорта. Запустите проверку ядром перед применением.';messages.append(row)}
  try{
   const draft=engine.buildInbound({...opts,allowExperimental:true});
   preview.textContent=JSON.stringify(draft,null,2);
   choose.disabled=busy||(experimental&&!opts.allowExperimental)||(opts.mode==='add'&&issues.some(([level,msg])=>level==='error'&&msg.includes('тег inbound')));
   if(opts.mode==='add'&&(!original||!Array.isArray(original.inbounds)))choose.disabled=true;
  }catch(e){preview.textContent='// '+e.message;choose.disabled=true}
  choose.textContent=opts.mode==='add'?'Добавить inbound':'Создать JSON';
  if(busy){choose.disabled=true;choose.textContent='Создание…'}
 };
 const refresh=()=>{renderChoices();renderFields();renderPreview()};
 renderExamples();refresh();
 const tabs=()=>{for(const button of scope.querySelectorAll('[data-compose-tab]'))button.setAttribute('aria-selected',String(button.dataset.composeTab===tab));scope.querySelector('[data-compose-workspace]').hidden=tab!=='builder';examples.hidden=tab!=='examples'};
 tabs();
 function close(){overlay.hidden=true;overlay.classList.remove('sv-overlay-composer')}
 scope.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button||busy)return;
  if(button.hasAttribute('data-compose-close')){close();return}
  if(button.hasAttribute('data-compose-tab')){tab=button.dataset.composeTab;tabs();return}
  if(button.hasAttribute('data-compose-choice')){
   const key=button.dataset.composeChoice,newValue=button.dataset.composeValue;
   if(opts[key]===newValue)return;
   opts[key]=newValue;
   if(key==='protocol'&&autoTag){opts.tag=(newValue==='custom'?(opts.customProtocol||'custom'):newValue)+'-main';if(newValue==='socks')opts.port=10808;if(newValue==='http')opts.port=10809;}
   if(key==='protocol'&&['hysteria','masque'].includes(newValue)){opts.transport=newValue;opts.security='tls';}
   if(key==='protocol'&&['socks','http'].includes(newValue)){opts.transport='raw';opts.security='none';}
   if(key==='protocol'&&newValue!=='vless'&&opts.transport==='xdrive'){opts.transport='raw';opts.security='none';}
   if(key==='transport'&&newValue==='xdrive'){opts.protocol='vless';opts.security='none';}
   if(key==='transport'){if(newValue==='xhttp')opts.path='/xhttp';if(newValue==='ws')opts.path='/ws';if(newValue==='grpc')opts.path='grpc';}
   refresh();return;
  }
  if(button.hasAttribute('data-compose-preset')){
   const preset=engine.presets.find(x=>x.id===button.dataset.composePreset);if(!preset)return;
   opts.protocol=preset.protocol;opts.transport=preset.transport;opts.security=preset.security;
   opts.tag=preset.protocol+'-main';autoTag=true;
   opts.path=opts.transport==='ws'?'/ws':opts.transport==='grpc'?'grpc':'/xhttp';
   opts.name=preset.label;opts.allowExperimental=false;
   tab='builder';tabs();refresh();
  }
 });
 scope.addEventListener('input',event=>{
  const field=event.target.dataset.composeField;
  if(!field)return;
  opts[field]=event.target.type==='checkbox'?event.target.checked:event.target.value;
  if(field==='tag')autoTag=false;
  if(field==='xdriveService')renderFields();
  renderPreview();
 });
 scope.addEventListener('change',event=>{
  if(event.target.name==='sv-compose-mode'){
   opts.mode=event.target.value;
   if(opts.mode==='add'&&original?.inbounds?.some(ib=>ib.tag===opts.tag)){
    let i=2;const base=String(opts.tag||'new-inbound');
    while(original.inbounds.some(ib=>ib.tag===base+'-'+i))i++;
    opts.tag=base+'-'+i;
   }
   refresh();
  }
 });
 const apply=async()=>{
  if(busy)return;
  const {quality,issues}=validation();
  if(quality.errors.length&&!opts.allowExperimental){notify('Исправьте несовместимую комбинацию или подтвердите экспериментальный режим.');return}
  if(opts.mode==='add'&&(!original||!Array.isArray(original.inbounds)||original.inbounds.some(ib=>ib.tag===opts.tag))){
   notify('Нельзя добавить inbound: текущий JSON повреждён или тег уже занят.');return;
  }
  if(opts.mode==='new'&&!await unsavedApproval('Создать новую конфигурацию вместо текущего черновика?'))return;
  const chosen={...opts},originalSource=input.value,selectionSignature=JSON.stringify(opts);
  busy=true;renderPreview();
  try{
   let shadowsocksPassword,keys,publicKey;
   if(chosen.protocol==='shadowsocks'){
    shadowsocksPassword=engine.generateShadowsocksPassword(chosen.method,window.crypto);
   }
   if(chosen.security==='reality'&&chosen.target&&chosen.sni&&typeof ctx.realityKeys==='function'){
    const pair=await ctx.realityKeys();
    if(!/^[A-Za-z0-9_-]{43}$/.test(pair?.privateKey||'')||!/^[A-Za-z0-9_-]{43}$/.test(pair?.publicKey||''))
      throw Error('Генератор X25519 не вернул корректную пару. JSON не изменён.');
    const random=new Uint8Array(8);
    if(!window.crypto?.getRandomValues)throw Error('Безопасный генератор Short ID недоступен.');
    window.crypto.getRandomValues(random);
    keys={privateKey:pair.privateKey,shortId:Array.from(random,b=>b.toString(16).padStart(2,'0')).join('')};
    publicKey=pair.publicKey;
   }
   if(overlay.hidden||!scope.isConnected)throw Error('Конструктор был закрыт. JSON оставлен без изменений.');
   if(input.value!==originalSource||JSON.stringify(opts)!==selectionSignature)throw Error('JSON или параметры изменились во время генерации. Черновик не заменён.');
   const activeJson=chosen.mode==='add'?JSON.parse(originalSource):null;
   const documentValue=engine.buildDocument(chosen,activeJson,{shadowsocksPassword,realityKeys:keys});
   if(chosen.mode==='new'){id=null;name=String(chosen.name||'Новая конфигурация').trim().slice(0,100)||'Новая конфигурация';inboundIndex=outIndex=0;saved=''}
   update(documentValue);
   if(chosen.mode==='new')input.dispatchEvent(new Event('xmesh:reset-history'));
   setPage('editor');close();
   if(publicKey){
    try{await navigator.clipboard.writeText(publicKey);notify('JSON создан. Public key REALITY скопирован; сохраните его для клиентов.')}catch{notify('JSON создан. Откройте REALITY и скопируйте public key для клиентов.')}
   }else{
    const suffix=chosen.security==='reality'?' Для REALITY завершите настройку target/SNI и ключей.':'';
    notify('JSON-черновик создан. Проверьте конфигурацию через Xray-core перед сохранением.'+suffix);
   }
  }catch(error){notify('Не удалось собрать JSON: '+error.message)}
  finally{busy=false;if(!overlay.hidden)renderPreview()}
 };
 scope.querySelector('[data-compose-apply]').addEventListener('click',apply);
 overlay.hidden=false;
}
function showPopup(title,kind){
 const body=get('overlayBody');body.replaceChildren();get('overlay').classList.remove('sv-overlay-composer');get('overlayTitle').textContent=title;
 if(kind==='profiles'){
 const create=document.createElement('button');create.className='sv-dialogitem';create.textContent='+ Новый профиль';create.onclick=async()=>{if(!await unsavedApproval('Открыть новый профиль без сохранения изменений?'))return;id=null;name='Новый профиль';inboundIndex=outIndex=0;saved='';update(defaultDoc());input.dispatchEvent(new Event('xmesh:reset-history'));get('overlay').hidden=true};body.append(create);
 for(const p of ctx.DB.profiles||[]){const b=document.createElement('button');b.className='sv-dialogitem';b.textContent=p.name;b.onclick=async()=>{if(!await unsavedApproval('Открыть другой профиль без сохранения изменений?'))return;try{const d=typeof p.config==='string'?JSON.parse(p.config):p.config;id=p.id;name=p.name;inboundIndex=outIndex=0;input.value=pretty(d);saved=input.value;paint();input.dispatchEvent(new Event('xmesh:reset-history'));get('overlay').hidden=true}catch(err){notify(err.message)}};body.append(b)}
 }else{
  openComposer();return;
 }
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
async function save(){try{const d=json();validate(d);if(!name.trim())throw Error('Укажите название профиля');const body={name:name.trim(),config:pretty(d)};if(id!=null)await ctx.api.update('profiles',id,body);else {const created=await ctx.api.create('profiles',body);id=created.id}saved=input.value;stashDocument();renderDocumentTabs();paint();hostManager.render();renderProfiles();notify('Профиль сохранён')}catch(err){notify('Не удалось сохранить: '+err.message)}}
const bytes=n=>{const b=new Uint8Array(n);crypto.getRandomValues(b);return Array.from(b,v=>v.toString(16).padStart(2,'0')).join('')};
async function action(a){
 switch(a){
 case 'focus-code':input.focus();return;
 case 'focus-form':root.querySelector('[data-tab="inbound"]')?.click();root.querySelector('.sv-constructor')?.scrollIntoView?.({block:'nearest'});return;
 case 'profiles':setPage('profiles');return;
 case 'studio-editor':setPage('editor');return;
 case 'new-profile':return newProfile();
 case 'templates':return showPopup('Конструктор конфигураций','templates');
 case 'close':get('overlay').hidden=true;return;
 case 'save':return save();
 case 'import':get('upload').click();return;
 case 'export':{const url=URL.createObjectURL(new Blob([input.value],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=(name.replace(/[^a-z0-9_-]/gi,'-')||'xray')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return}
 case 'check':return checkWithCore();
 
 case 'outline':setInspectorVisible(root.classList.contains('sv-outline-hidden'));return;
 case 'reset':if(await approve({title:'Сбросить изменения?',description:'Вернуться к последней сохранённой версии JSON?',notice:'Все изменения после сохранения будут потеряны.',danger:true,confirmLabel:'Сбросить изменения'})){input.value=saved||pretty(defaultDoc());paint();input.dispatchEvent(new Event('xmesh:reset-history'))}return;
 case 'undo':root.querySelector('[data-tool="undo"]')?.click();return;
 case 'redo':root.querySelector('[data-tool="redo"]')?.click();return;
 case 'add-inbound':root.querySelector('[data-tool="inbound"]')?.click();return;
 case 'remove-inbound':if(await approve({title:'Удалить inbound?',description:'Выбранный inbound будет удалён из JSON.',notice:'Клиенты, использующие этот тег, могут потерять доступ.',danger:true,confirmLabel:'Удалить inbound'}))mutate(d=>{d.inbounds.splice(inboundIndex,1);inboundIndex=Math.max(inboundIndex-1,0)});return;
 case 'add-outbound':mutate(d=>{d.outbounds??=[];let i=1;while(d.outbounds.some(x=>x.tag==='outbound-'+i))i++;d.outbounds.push({tag:'outbound-'+i,protocol:'freedom'});outIndex=d.outbounds.length-1});return;
 case 'remove-outbound':if(await approve({title:'Удалить outbound?',description:'Исходящее соединение будет удалено из конфигурации.',notice:'Проверьте правила маршрутизации с этим тегом.',danger:true,confirmLabel:'Удалить outbound'}))mutate(d=>{d.outbounds.splice(outIndex,1);outIndex=Math.max(outIndex-1,0)});return;
 case 'shortid':root.querySelector('[data-tool="shortid"]')?.click();return;
 case 'reality':root.querySelector('[data-tool="reality"]')?.click();return;
 }
}
root.addEventListener('click',ev=>{const tabOpen=ev.target.closest('[data-doc-open]'),tabClose=ev.target.closest('[data-doc-close]'),tabNew=ev.target.closest('[data-doc-new]');if(tabOpen){ev.preventDefault();switchDocument(tabOpen.dataset.docOpen);return}if(tabClose){ev.preventDefault();closeDocument(tabClose.dataset.docClose).catch(err=>notify(err.message));return}if(tabNew){ev.preventDefault();newProfile();return}const jump=ev.target.closest('[data-sv-jump]');if(jump){ev.preventDefault();jumpToSection(jump.dataset.svJump);return}const quick=ev.target.closest('[data-quick-outbound]');if(quick){outIndex=Number(quick.dataset.quickOutbound);root.querySelector('[data-tab="outbound"]')?.click();const d=hasValidJSON();if(d)sync(d);return}const b=ev.target.closest('[data-action]');if(b){ev.preventDefault();Promise.resolve(action(b.dataset.action)).catch(x=>notify(x.message))}const tab=ev.target.closest('[data-tab]');if(tab){root.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===tab));root.querySelectorAll('[data-section]').forEach(x=>x.hidden=x.dataset.section!==tab.dataset.tab)}});
root.addEventListener('change',ev=>{if(ev.target.matches('[data-field]'))Promise.resolve(formChanged(ev.target)).catch(err=>notify(err.message))});
input.addEventListener('input',()=>{paint();stashDocument();renderDocumentTabs()});
input.addEventListener('scroll',()=>{highlight.scrollTop=input.scrollTop;highlight.scrollLeft=input.scrollLeft;gutter.scrollTop=input.scrollTop});
input.addEventListener('click',paint);input.addEventListener('keyup',paint);
input.addEventListener('keydown',ev=>{if(ev.key==='Tab'){ev.preventDefault();const i=input.selectionStart;input.setRangeText('  ',i,input.selectionEnd,'end');input.dispatchEvent(new Event('input',{bubbles:true}))}if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='s'){ev.preventDefault();save()}});
root.classList.toggle('sv-wrap',get('wrap').checked);
get('wrap').addEventListener('change',ev=>root.classList.toggle('sv-wrap',ev.target.checked));
get('upload').addEventListener('change',async ev=>{const f=ev.target.files?.[0];if(!f)return;try{if(f.size>2e6)throw Error('Файл больше 2 МБ');const raw=await f.text();JSON.parse(raw);if(!await unsavedApproval('Импортировать JSON вместо текущего черновика?'))return;input.value=raw;paint();input.dispatchEvent(new Event('xmesh:reset-history'));notify('JSON импортирован')}catch(err){notify(err.message)}finally{ev.target.value=''}});
try{setInspectorVisible(window.localStorage?.getItem('xmesh-studio-inspector')!=='hidden',false)}catch(_){setInspectorVisible(true,false)}
input.value=pretty(defaultDoc());saved='';paint();documents.set(activeDocument,captureDocument());renderDocumentTabs();root.querySelector('[data-tab="inbound"]')?.click();renderProfiles();
toolPaletteHandle=window.XMeshJsonTools?.setup(root,{toast:notify,realityKeys:ctx.realityKeys,apiRequest:ctx.apiRequest})||null;
}
return {view,mount};
})();