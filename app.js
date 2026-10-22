
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const cl=(v,a,b)=>Math.min(b,Math.max(a,v));
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hs=s=>[...String(s)].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7);
const panelIsEnglish=()=>window.XMeshI18n?.getLanguage()==='en';
const fmt=(v,d=0)=>(+v).toLocaleString(panelIsEnglish()?'en-US':'ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});
const gb=v=>{const en=panelIsEnglish(),unit=en?[' TB',' GB',' MB']:[' ТБ',' ГБ',' МБ'];return v>=1024?fmt(v/1024,2)+unit[0]:v>=10?fmt(v,1)+unit[1]:v>=1?fmt(v,2)+unit[1]:fmt(v*1024)+unit[2]};
const ago=t=>{if(!t)return panelIsEnglish()?'never':'никогда';const s=(Date.now()-t)/1e3;return panelIsEnglish()?(s<60?'just now':s<3600?(s/60|0)+' min ago':s<86400?(s/3600|0)+' h ago':(s/86400|0)+' days ago'):(s<60?'только что':s<3600?(s/60|0)+' мин назад':s<86400?(s/3600|0)+' ч назад':(s/86400|0)+' дн назад')};
const DAY=864e5,left=t=>{if(!t)return panelIsEnglish()?'never':'бессрочно';const d=Math.ceil((t-Date.now())/DAY);return panelIsEnglish()?(d>0?d+' days':d===0?'expires today':'expired '+(-d)+' days ago'):(d>0?d+' дн':d===0?'истёк сегодня':'истёк '+(-d)+' дн назад')};
const chip=(t,c)=>`<span class="chip" style="--c:var(${c})">${t}</span>`;
const smooth=p=>{let d=`M${p[0]}`;for(let i=0;i<p.length-1;i++){const a=p[i-1]||p[i],b=p[i],c=p[i+1],e=p[i+2]||c;d+=`C${b[0]+(c[0]-a[0])/6},${b[1]+(c[1]-a[1])/6},${c[0]-(e[0]-b[0])/6},${c[1]-(e[1]-b[1])/6},${c}`}return d};
const P={
  home:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  layers:'<path d="m12 2 8 4.5v11L12 22l-8-4.5v-11L12 2Z"/><path d="m12 12 8-5.5M12 12 4 6.5M12 12v10"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  server:'<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  activity:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v6h6"/>',
  code:'<path d="m16 18 6-6-6-6M8 6l-6 6 6 6m6.5-15-5 18"/>',
  tool:'<path d="M14.7 6.3a3.5 3.5 0 0 0-4.3 4.3l-7.1 7.1a2.1 2.1 0 0 0 3 3l7.1-7.1a3.5 3.5 0 0 0 4.3-4.3L15 12l-3-3Z"/><path d="M16 5 19 2l3 3-3 3"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  sliders:'<path d="M4 7h9m6 0h1M4 17h1m6 0h9"/><circle cx="16" cy="7" r="3"/><circle cx="8" cy="17" r="3"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M6.35 17.65l-1.42 1.42M19.07 4.93l-1.42 1.42"/>',
  moon:'<path d="M20.985 12.486A9 9 0 0 1 11.514 3.015 9 9 0 1 0 20.985 12.486Z"/>',
  redo:'<path d="M3 12a9 9 0 0 1 15.36-6.36L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.36 6.36L3 16M3 21v-5h5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  copy:'<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  trash:'<path d="M3 6h18m-2 0-.9 14a2 2 0 0 1-2 2H7.9a2 2 0 0 1-2-2L5 6m4 0V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M10 11v6m4-6v6"/>',
  pause:'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play:'<path d="m8 5 12 7-12 7V5Z"/>',
  up:'<path d="m18 15-6-6-6 6"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  dl:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3"/>',
  pen:'<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z"/>',
  logout:'<path d="M10 17l5-5-5-5M15 12H3m9-9h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
  save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  check:'<path d="m20 6-11 11-5-5"/>',
  upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m12-7-5-5-5 5m5-5v12"/>',
  filter:'<path d="M4 4h16l-6.5 8v6l-3 2v-8L4 4Z"/>',
  arrowRight:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  arrowLeft:'<path d="M19 12H5m6 6-6-6 6-6"/>',
  chevronLeft:'<path d="m15 18-6-6 6-6"/>',
  chevronRight:'<path d="m9 18 6-6-6-6"/>',
  key:'<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  lock:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  globe:'<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/>',
  languages:'<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3H2"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  terminal:'<rect x="2" y="3" width="20" height="18" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  sparkles:'<path d="m12 3 1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9L12 3ZM19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7L19 17Z"/>'
};
const ic=n=>`<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[n]||P.file}</svg>`;
// Only explicit action buttons receive icons. Navigation tabs, palettes and Xray
// mode selectors have their own visual language and must never be decorated.
// Semantic icons for action buttons only. Existing icons and tab controls stay untouched.
const ACTION_ICON_RULES=[
 [/выйти|logout|sign out|log out/i,'logout'],
 [/удал|стереть|очистить|отозвать|delete|remove/i,'trash'],
 [/сохран|применить|save|apply/i,'save'],
 [/отмен|закры|cancel|close/i,'x'],
 [/копир|скопировать|copy|буфер/i,'copy'],
 [/скача|экспорт|download|export|резервн.*коп|backup/i,'dl'],
 [/импорт|загрузить файл|upload|import/i,'upload'],
 [/проверить статус|обновить|перезапуск|перезапустить|перезагруз|синхрон|повторить|сбросить|refresh|reload|sync/i,'redo'],
 [/отключ|останов|pause|stop/i,'pause'],
 [/включ|запуст|активир|enable|start/i,'play'],
 [/генер|создать пару|новый short id|uuid|парол/i,'key'],
 [/добав|созда|новый|новая|new\b|add\b|create|продл|\+\s*\d+/i,'plus'],
 [/редакт|изменить|переимен|edit/i,'pen'],
 [/поиск|найти|search/i,'search'],
 [/фильтр|filter/i,'filter'],
 [/настрой|параметр|settings/i,'sliders'],
 [/уведомлен|событи|notification/i,'bell'],
 [/диагност|метрик|статист|состояние/i,'activity'],
 [/выбрать все|select all/i,'check'],
 [/в сквад|групп|назначить/i,'users'],
 [/открыть|просмотр|подробнее|open|view/i,'arrowRight'],
 [/подключить|connect/i,'link'],
 [/назад|предыдущ|back|previous/i,'arrowLeft'],
 [/сервер|нода|узел|node|server/i,'server'],
 [/подписк|ссылка|url|link/i,'link'],
 [/защит|безопас|security/i,'shield'],
 [/json|конфиг|код|format|формат/i,'code'],
 [/профил|шаблон|profile/i,'layers'],
 [/документ|файл|file/i,'file'],
 [/готово|подтверд|confirm|применить/i,'check']
];
function decorateButtonIcons(root){
 if(!root||!root.querySelectorAll)return;
 const buttons=[];
 if(root.nodeType===1&&root.matches('button'))buttons.push(root);
 buttons.push(...root.querySelectorAll('button'));
 buttons.forEach(button=>{
  if(button.querySelector('svg,.ic,.xray-tab-icon')||button.dataset.actionIcon==='done')return;
  // These controls are selectors/tabs rather than actions; they have their own layout.
  if(button.closest('.seg,.fl,.swt,.choice,.palette-swatch,.country-picker,.color-bubbles,[role="tablist"],.xray-presets,.xray-preset-row'))return;
  if(button.matches('.palette-swatch,.country-option,[role="switch"],[data-ui],[data-th],[data-ac],[data-uf],[data-s],[data-dt],[data-tt],[data-lv],[data-traffic-range],[data-node-grid-mode],[data-xray-mode],[data-xray-config-tab],[data-xray-output]'))return;
  // Do not decorate arbitrary buttons (e.g. sortable table headings).
  if(!button.matches('.btn,.gh,.dg,.ib,.ia,.sm,[data-ne],[data-exp],[data-nu],[data-a],[data-bk],[data-core-refresh],[data-core-update]'))return;
  const label=(button.getAttribute('aria-label')||button.getAttribute('title')||button.textContent||'').replace(/\s+/g,' ').trim();
  if(!label)return;
  const icon=ACTION_ICON_RULES.find(([pattern])=>pattern.test(label))?.[1];
  if(!icon||!P[icon])return;
  button.insertAdjacentHTML('afterbegin',ic(icon));
  button.dataset.actionIcon='done';
 });
}
/* ================= ДАННЫЕ: пустое хранилище + слой API ================= */
const PL={iOS:['iPhone','iPad'],Android:['Android'],Windows:['Windows'],macOS:['macOS'],Linux:['Linux']};
const FMT=['XRAY_JSON','MIHOMO','CLASH','SINGBOX','STASH'];
const defaultHooks={
  'user.created':0,'user.limited':0,'user.expired':0,
  'user.expires_in_24_hours':0,'user.first_connected':0,
  'user.bandwidth_usage_threshold_reached':0
};
const emptyDB=()=>({
  users:[],nodes:[],profiles:[],hosts:[],squads:[],tpls:[],subs:[],admins:[],tokens:[],srh:[],
  set:{brand:'XMesh Nexus',domain:'',hooks:{...defaultHooks}}
});
let DB, legacyDemo=false;
try{DB=JSON.parse(localStorage.getItem('xmeshNexusDB')||'null')}catch(e){DB=null}
/* Remove the earlier built-in sample data, but preserve user-created records. */
legacyDemo=!!(DB&&Array.isArray(DB.nodes)&&DB.nodes.some(n=>/\.example\.(net|com|org)$/i.test(String(n.addr||'')))&&
  (DB.set?.domain==='panel.example.com'||(DB.users||[]).some(u=>String(u.email||'').endsWith('@mail.example'))));
if(!DB||!Array.isArray(DB.users)||legacyDemo) DB=emptyDB();
else {
  for(const k of ['users','nodes','profiles','hosts','squads','tpls','subs','admins','tokens','srh']) if(!Array.isArray(DB[k])) DB[k]=[];
  DB.set={brand:'XMesh Nexus',domain:'',hooks:{...defaultHooks,...(DB.set?.hooks||{})},...(DB.set||{})};
  DB.set.hooks={...defaultHooks,...(DB.set?.hooks||{})};
}
let sv,backendReady=false,sessionUser=null;const save=()=>{if(backendReady)return;clearTimeout(sv);sv=setTimeout(()=>{try{localStorage.setItem('xmeshNexusDB',JSON.stringify(DB))}catch(e){}},120)};
async function backendRequest(path,options={}){
  const headers={...(options.headers||{})};
  if(options.body&&!headers['Content-Type']&&!headers['content-type'])headers['Content-Type']='application/json';
  let response;
  try{response=await fetch(path,{...options,headers,credentials:'same-origin',cache:'no-store'})}
  catch(e){throw new Error('Не удалось связаться с backend API. Проверьте контейнеры Docker.')}
  const payload=await response.json().catch(()=>({}));
  if(response.status===401&&backendReady){backendReady=false;showAuthGate('Сессия завершена. Войдите снова.')}
  if(!response.ok)throw new Error(payload.error||'Ошибка backend API ('+response.status+').');
  return payload;
}
if(legacyDemo){try{localStorage.removeItem('xmeshNexusDB');localStorage.setItem('xmeshNexusDB',JSON.stringify(DB))}catch(e){}}
const lat=()=>Promise.resolve();
const st=u=>u.disabled?'DISABLED':u.hold?'ON_HOLD':(u.limit&&u.used>=u.limit)?'LIMITED':(u.expireAt&&u.expireAt<Date.now())?'EXPIRED':'ACTIVE';
const isOn=u=>st(u)=='ACTIVE'&&u.onlineAt>Date.now()-3e5;
const inbs=p=>{try{return JSON.parse(p.config).inbounds||[]}catch(e){return[]}};
const tags=()=>DB.profiles.flatMap(p=>inbs(p).map(i=>i.tag));
const tcol=t=>({vless:'--a',trojan:'--c3',shadowsocks:'--c4'}[DB.profiles.flatMap(inbs).find(x=>x.tag==t)?.protocol]||'--b');
const uin=u=>[...new Set(DB.squads.filter(s=>u.squads.includes(s.id)).flatMap(s=>s.inb))];
const api={
  async list(c,o={}){await lat();let a=DB[c]||[];if(o.f)a=a.filter(o.f);if(o.sort){const k=o.sort,d=o.dir=='desc'?-1:1,v=x=>k=='status'?st(x):x[k];a=[...a].sort((x,y)=>(v(x)>v(y)?1:v(x)<v(y)?-1:0)*d)}const ids=a.map(x=>x.id),total=a.length;if(o.size)a=a.slice((o.page-1)*o.size,o.page*o.size);return{items:a,total,ids}},
  async create(c,o){await lat();let row;if(backendReady){const path=c==='admins'?'/api/v1/admins':'/api/v1/collections/'+encodeURIComponent(c);const body=c==='admins'?{username:o.username,password:o.password,role:o.role,isActive:o.isActive}:o;row=await backendRequest(path,{method:'POST',body:JSON.stringify(body)})}else{if(c==='admins')throw new Error('Для создания администратора требуется доступ к Rust API.');o.id=DB[c].reduce((m,x)=>Math.max(m,x.id),0)+1;row=o}DB[c].push(row);save();return row},
  async update(c,id,p){await lat();const x=DB[c].find(y=>y.id==id);if(!x)throw new Error('Запись не найдена в локальном кеше.');const path=c==='admins'?'/api/v1/admins/'+encodeURIComponent(id):'/api/v1/collections/'+encodeURIComponent(c)+'/'+encodeURIComponent(id);const row=backendReady?await backendRequest(path,{method:'PATCH',body:JSON.stringify(p)}):{...x,...p};Object.assign(x,row);save();return x},
  async remove(c,id){await lat();const i=DB[c].findIndex(x=>x.id==id);const old=i>=0?DB[c][i]:null;if(backendReady){const path=c==='admins'?'/api/v1/admins/'+encodeURIComponent(id):'/api/v1/collections/'+encodeURIComponent(c)+'/'+encodeURIComponent(id);await backendRequest(path,{method:'DELETE'});}else if(i<0){throw new Error('Запись не найдена в локальном кеше.');}if(i>=0)DB[c].splice(i,1);save();return old},
  async bulk(c,ids,fn){await lat();for(const x of [...(DB[c]||[])].filter(item=>ids.has(item.id))){fn(x);await this.update(c,x.id,{...x})}save()},
  async saveSettings(patch){const saved=await backendRequest('/api/v1/settings',{method:'PATCH',body:JSON.stringify(patch)});DB.set={...DB.set,...saved,hooks:{...DB.set.hooks,...(saved.hooks||{})}};return DB.set},
  async stats(){await lat();const U=DB.users,by={};U.forEach(u=>{const status=st(u);by[status]=(by[status]||0)+1});const on=U.filter(isOn),live=DB.nodes.filter(n=>n.state==='ONLINE'&&!n.disabled),nodeOn={};live.forEach(n=>nodeOn[n.id]=0);return{by,total:U.length,online:on.length,conn:null,nodeOn,nOn:live.length,nAll:DB.nodes.length};},
  async systemStats(){if(!backendReady)return null;return backendRequest('/api/v1/system/stats')}
};

/* ================= МЕТАДАННЫЕ ================= */
const STM={ACTIVE:['Активен','--ok'],DISABLED:['Отключён','--mu'],LIMITED:['Лимит','--wr'],EXPIRED:['Истёк','--er'],ON_HOLD:['Ожидает','--c3']};
const NS={ONLINE:['Онлайн','--ok'],OFFLINE:['Не отвечает','--er'],CONNECTING:['Подключение','--wr'],DISABLED:['Отключён','--mu']};
const STRAT=[['NO_RESET','Не сбрасывать'],['DAY','Каждый день'],['WEEK','Каждую неделю'],['MONTH','Каждый месяц']];
const nstat=n=>n.disabled?'DISABLED':n.state;
const NAV=[['Обзор',[['home','home','Дашборд',1]]],['Управление',[['users','users','Пользователи',1],['squads','layers','Сквады'],['hosts','link','Хосты',1],['nodes','server','Узлы',1],['templates','file','Шаблоны'],['profiles','code','XRAY STUDIO'],['subscription','globe','SUBSCRIPTION STUDIO']]],['Инструменты',[['tools','tool','Диагностика']]],['Система',[['admins','shield','Админы'],['security','shield-check','Безопасность'],['set','sliders','Настройки']]]];
const FLAT=NAV.flatMap(g=>g[1]);
const swc=k=>r=>`<label class="sw"><input type="checkbox" data-tg="${k}:${r.id}" ${r.disabled?'':'checked'} aria-label="Включено"><span></span></label>`;
const nodeRotationIPs = node => String(node?.rotationIps||'').split(/\r?\n/).map(ip=>ip.trim()).filter(Boolean);
const nodeRotationValidate = data => {
  const ips=nodeRotationIPs(data);
  if(ips.length>64)return 'Можно добавить не более 64 IP-адресов.';
  if(new Set(ips).size!==ips.length)return 'В пуле ротации есть одинаковые IP-адреса.';
  if(ips.some(ip=>/\s/.test(ip)))return 'Введите каждый IP на отдельной строке, без порта и пробелов.';
  if(data.rotationEnabled&&ips.length<2)return 'Для включения ротации добавьте минимум два разных IP-адреса.';
  return '';
};
const ENT={
  squads:{t:'Сквады',n:'Набор инбаундов: что именно получает пользователь в подписке.',s:'id',nw:'Сквад',fs:[{k:'name',l:'Название',req:1},{k:'desc',l:'Описание'},{k:'inb',l:'Инбаунды (из профилей Xray)',t:'multi',o:tags}],
    cols:[['Название',r=>`<b>${esc(r.name)}</b><br><span class="mu">${esc(r.desc)}</span>`],['Инбаунды',r=>r.inb.map(t=>chip(esc(t),tcol(t))).join(' ')||'—'],['Пользователей',r=>DB.users.filter(u=>u.squads.includes(r.id)).length]],
    guard:r=>DB.users.some(u=>u.squads.includes(r.id))?'В скваде есть пользователи. Сначала переведите их в другой сквад.':''},
  hosts:{t:'Хосты',n:'Точки входа, которые попадают в подписку. Порядок определяет приоритет.',s:'order',nw:'Хост',mv:1,fs:[{k:'remark',l:'Название (remark)',req:1},{k:'address',l:'Адрес',req:1},{k:'port',l:'Порт',t:'num'},{k:'tag',l:'Инбаунд',t:'sel',o:tags},{k:'sni',l:'SNI'},{k:'path',l:'Path'},{k:'sec',l:'Безопасность',t:'sel',o:['reality','tls','none']},{k:'fp',l:'Fingerprint',t:'sel',o:['chrome','firefox','safari','random']},{k:'nodes',l:'Только на узлах',t:'multi',o:()=>DB.nodes.map(n=>[n.id,n.flag+' '+n.name]),h:'Ничего не выбрано — на всех узлах'}],
    def:()=>({port:443,sec:'reality',fp:'chrome',order:DB.hosts.length+1,nodes:[]}),
    cols:[['Название',r=>`<b>${esc(r.remark)}</b>`],['Адрес',r=>`${esc(r.address)}:${r.port}`],['Инбаунд',r=>chip(esc(r.tag),tcol(r.tag))],['SNI',r=>esc(r.sni||'—')],['Узлы',r=>r.nodes.length?r.nodes.map(i=>DB.nodes.find(n=>n.id==i)?.flag).join(' '):'все'],['Вкл.',swc('hosts')]]},
  nodes:{t:'Узлы',nw:'Узел',s:'id',fs:[{k:'name',l:'Название',req:1},{k:'flag',l:'Страна и флаг',t:'country'},{k:'addr',l:'Адрес',req:1},{k:'port',l:'Порт ноды',t:'num',req:1},{k:'profileId',l:'XRAY STUDIO',t:'sel',o:()=>DB.profiles.map(p=>[p.id,p.name])},{k:'mult',l:'Коэффициент трафика',t:'num',h:'1 — без изменений, 2 — считать вдвое'},{k:'limit',l:'Лимит трафика, ГБ',t:'num',h:'0 — без лимита'},{k:'resetDay',l:'День сброса счётчика',t:'num'},
    {k:'rotationEnabled',l:'Ротация IP-адресов',t:'bool',h:'Пул IP для будущей выдачи подписок: на каждом обновлении выбирается следующий адрес. Пока публичный генератор подписок в XMesh Nexus не реализован.'},
    {k:'rotationIps',l:'Пул внешних IP-адресов',t:'area',rows:7,h:'Один IPv4 или IPv6 на строку. Добавляйте только IP, реально назначенные VPS и доступные клиентам. До 64 адресов. Основной адрес узла остаётся прежним.'}],
    def:()=>({flag:'',mult:1,limit:0,resetDay:1,rotationEnabled:false,rotationIps:''}),
    chk:nodeRotationValidate,
    guard:r=>DB.hosts.some(h=>h.nodes.includes(r.id))?'Узел указан в хостах. Уберите его оттуда.':''},
  tpls:{t:'Шаблоны пользователей',n:'Готовые тарифы: выбираются при создании и подставляют лимиты, срок и доступ.',s:'id',nw:'Шаблон',fs:[{k:'name',l:'Название',req:1},{k:'limit',l:'Лимит, ГБ',t:'num',h:'0 — без лимита'},{k:'days',l:'Срок, дней',t:'num',h:'0 — бессрочно'},{k:'strategy',l:'Сброс трафика',t:'sel',o:STRAT},{k:'hwid',l:'Лимит устройств',t:'num'},{k:'squads',l:'Сквады',t:'multi',o:()=>DB.squads.map(s=>[s.id,s.name])},{k:'hold',l:'Отсчёт срока с первого подключения',t:'bool'}],def:()=>({strategy:'NO_RESET',hwid:2,squads:[]}),
    cols:[['Название',r=>`<b>${esc(r.name)}</b>`],['Трафик',r=>r.limit?r.limit+' ГБ':'∞'],['Срок',r=>r.days?r.days+' дн':'∞'],['Устройств',r=>r.hwid],['Сквады',r=>r.squads.map(i=>chip(esc(DB.squads.find(s=>s.id==i)?.name||'?'),'--b')).join(' ')],['Режим',r=>r.hold?chip('on hold','--c3'):'—']]},
  subs:{t:'Шаблоны подписки',n:'Что получает клиентское приложение: формат и содержимое конфигурации.',s:'id',nw:'Шаблон',fs:[{k:'name',l:'Название',req:1},{k:'fmt',l:'Формат',t:'sel',o:FMT},{k:'content',l:'Содержимое',t:'area',rows:9}],def:()=>({fmt:'XRAY_JSON',content:'{}'}),
    cols:[['Название',r=>`<b>${esc(r.name)}</b>`],['Формат',r=>chip(r.fmt,'--c3')],['Размер',r=>r.content.length+' симв.']]},
  profiles:{t:'XRAY STUDIO',n:'Конфигурации ядра. Инбаунды из профиля становятся доступны в сквадах и хостах.',s:'id',nw:'Профиль',fs:[{k:'name',l:'Название',req:1},{k:'config',l:'Конфигурация (JSON)',t:'area',rows:16,h:'Вставьте полный конфиг Xray. В нём должен быть хотя бы один inbound.'}],def:()=>({config:''}),
    chk:(d,id)=>{let j;try{j=JSON.parse(d.config)}catch(e){return'Некорректный JSON: '+e.message}if(!Array.isArray(j.inbounds)||!j.inbounds.length)return'В конфиге нет массива inbounds.';const t=j.inbounds.map(i=>i.tag);if(t.some(x=>!x))return'У каждого инбаунда должен быть tag.';if(new Set(t).size!=t.length)return'Теги инбаундов должны быть уникальными.';const ot=DB.profiles.filter(p=>p.id!=id).flatMap(p=>inbs(p).map(i=>i.tag));if(t.some(x=>ot.includes(x)))return'Тег уже используется в другом профиле.'},
    cols:[['Название',r=>`<b>${esc(r.name)}</b>`],['Инбаунды',r=>inbs(r).map(i=>chip(esc(i.tag)+' · '+i.port,tcol(i.tag))).join(' ')||'—'],['Узлов',r=>DB.nodes.filter(n=>n.profileId==r.id).length]],
    guard:r=>DB.nodes.some(n=>n.profileId==r.id)?'Профиль назначен узлам. Сначала смените профиль у этих узлов.':''},
  admins:{t:'Администраторы',n:'Реальные учётные записи входа. Права проверяются Rust API, а не интерфейсом.',s:'id',nw:'Администратор',
    fs:[{k:'username',l:'Логин',req:1,pat:'[A-Za-z0-9_.\\-]{3,64}'},
      {k:'password',l:'Новый пароль (от 16 символов)',t:'password',h:'Для новой записи обязателен. При редактировании оставьте пустым, чтобы сохранить пароль.'},
      {k:'role',l:'Роль',t:'sel',o:[['owner','Владелец'],['admin','Администратор'],['viewer','Наблюдатель']]},
      {k:'is_active',l:'Разрешить вход',t:'bool'}],
    def:()=>({role:'admin',is_active:true}),
    chk:(d,id)=>DB.admins.some(a=>a.username.toLowerCase()===d.username.toLowerCase()&&a.id!==id)?'Такой логин уже есть.':'',
    cols:[['Логин',r=>`<b>${esc(r.username)}</b>`],
      ['Роль',r=>chip({owner:'Владелец',admin:'Администратор',viewer:'Наблюдатель'}[r.role]||r.role,{owner:'--c4',admin:'--a',viewer:'--mu'}[r.role])],
      ['Статус',r=>r.is_active===false?'Отключён':'Активен'],
      ['Вход',r=>ago(r.last)]],
    guard:r=>r.id===sessionUser?.id?'Нельзя удалить собственную учётную запись.':'',
  },

};
const FU=[{k:'username',l:'Имя пользователя',req:1,pat:'[A-Za-z0-9_.\\-]{3,32}',h:'3–32 символа: латиница, цифры, _ . -'},{k:'xrayProfileId',l:'Xray-профиль',t:'sel',o:()=>[['','Не привязывать'],...DB.profiles.map(p=>[String(p.id),p.name])],h:'При выборе панель добавит учётные данные в inbound профиля.'},{k:'fingerprint',l:'uTLS fingerprint пользователя',t:'sel',o:()=>Array.from(new Set(['chrome','firefox','safari','ios','android','edge','random','randomized','randomizednoalpn','unsafe',...XRAY_FP])).map(x=>[x,x]),h:'Индивидуальный fingerprint клиентского профиля для этого пользователя.'},{k:'limit',l:'Лимит трафика, ГБ',t:'num',h:'0 — без лимита'},{k:'days',l:'Срок, дней',t:'num',h:'0 — бессрочно'},{k:'strategy',l:'Сброс трафика',t:'sel',o:STRAT},{k:'hwid',l:'Лимит устройств',t:'num'},{k:'tag',l:'Тег',ph:'например, vip'},{k:'squads',l:'Сквады',t:'multi',o:()=>DB.squads.map(s=>[s.id,s.name])},{k:'hold',l:'Отсчёт срока с первого подключения (on hold)',t:'bool'},{k:'desc',l:'Заметка'}];
const FE=[{k:'username',l:'Имя пользователя',req:1,pat:'[A-Za-z0-9_.\\-]{3,32}'},{k:'fingerprint',l:'uTLS fingerprint пользователя',t:'sel',o:()=>Array.from(new Set(['chrome','firefox','safari','ios','android','edge','random','randomized','randomizednoalpn','unsafe',...XRAY_FP])).map(x=>[x,x]),h:'Персональный fingerprint пользователя.'},{k:'limit',l:'Лимит, ГБ',t:'num',h:'0 — без лимита'},{k:'expireAt',l:'Действует до',t:'date',h:'Пусто — бессрочно'},{k:'strategy',l:'Сброс трафика',t:'sel',o:STRAT},{k:'tag',l:'Тег'},{k:'tg',l:'Telegram ID'},{k:'email',l:'Email'},{k:'desc',l:'Заметка'}];

const COUNTRY_CODES='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KH? KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.replace(' KH?','').split(' ');
const COUNTRY_NAMES=new Intl.DisplayNames(['ru'],{type:'region'});
const countryFlag=code=>String.fromCodePoint(...code.toUpperCase().split('').map(c=>127397+c.charCodeAt(0)));
const COUNTRIES=COUNTRY_CODES.map(code=>({code,flag:countryFlag(code),name:COUNTRY_NAMES.of(code)})).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
// Country flags are bundled in the Docker image. No external CDN at runtime.
const flagView=(value,cls='flag-img')=>{
 const country=COUNTRIES.find(c=>c.flag===value);
 return country?`<img class="${cls}" src="/flags/${country.code.toLowerCase()}.svg" alt="${esc(country.name)}" loading="lazy" decoding="async">`:`<span class="${cls}">${esc(value||'')}</span>`;
};

/* ================= ФОРМЫ ================= */
const opt=o=>(typeof o=='function'?o():o).map(x=>Array.isArray(x)?x:[x,x]);
function field(f,v){
  let i;const t=f.t||'text';
  if(t==='country'){
    const existing=COUNTRIES.find(c=>c.flag===v);
    const current=existing?existing.flag:(v||'');
    i=`<div class="country-picker">
      <div class="country-search-wrap"><input class="country-search" type="search" data-country-search placeholder="Поиск по названию или коду…" aria-label="Поиск страны" autocomplete="off" aria-controls="country-options-${f.k}" aria-expanded="false"><div class="country-options" id="country-options-${f.k}" role="listbox" aria-label="Результаты поиска стран" hidden></div></div>
      <div class="country-selected">${flagView(current,'country-flag-preview')}<span data-country-label>${existing?esc(existing.name):current?esc(current+' Сохранённый флаг'):'Выберите страну…'}</span></div>
      <input type="hidden" name="${f.k}" class="country-value" value="${esc(current)}">
      <small class="country-hint">Поиск по названию страны или ISO-коду. ${COUNTRIES.length} стран и территорий.</small>
    </div>`
  }
  else if(t=='sel')i=`<select name="${f.k}">${opt(f.o).map(([a,b])=>`<option value="${esc(a)}"${a==v?' selected':''}>${esc(b)}</option>`).join('')}</select>`;
  else if(t=='multi')i=`<div class="ms">${opt(f.o).map(([a,b])=>`<label class="ck"><input type="checkbox" name="${f.k}" value="${esc(a)}"${(v||[]).map(String).includes(String(a))?' checked':''}><span>${esc(b)}</span></label>`).join('')||'<span class="mu">Нет вариантов</span>'}</div>`;
  else if(t=='area')i=`<textarea name="${f.k}" rows="${f.rows||8}" spellcheck="false">${esc(v)}</textarea>`;
  else if(t=='bool')i=`<span class="sw"><input type="checkbox" name="${f.k}"${v?' checked':''}><span></span></span>`;
  else i=`<input name="${f.k}" type="${t=='num'?'number':t=='date'?'date':t=='password'?'password':'text'}"${t=='num'?' min="0" step="any"':''}${f.req?' required':''}${f.pat?` pattern="${f.pat}"`:''} value="${esc(t=='date'&&v?new Date(v).toLocaleDateString('sv'):v)}" placeholder="${esc(f.ph||'')}" autocomplete="off">`;
  const g=t=='multi'?'div':'label';return `<${g} class="f"><span>${f.l}</span>${i}${f.h?`<small>${f.h}</small>`:''}</${g}>`;
}
function read(fs,form){const d={};fs.forEach(f=>{const e=$$(`[name="${f.k}"]`,form);if(f.t=='multi')d[f.k]=e.filter(x=>x.checked).map(x=>isNaN(+x.value)?x.value:+x.value);else if(f.t=='bool')d[f.k]=e[0].checked;else if(f.t=='num')d[f.k]=+e[0].value||0;else if(f.t=='date')d[f.k]=e[0].value?new Date(e[0].value+'T23:59:59').getTime():null;else if(f.t=='sel')d[f.k]=isNaN(+e[0].value)?e[0].value:+e[0].value;else d[f.k]=e[0].value.trim()});return d}

/* ================= ОБОЛОЧКА ================= */
const dlg=$('#dlg');let CF;
/* A single viewport-positioned tooltip avoids clipping inside the scrolling sidebar. */
const railTip=document.createElement('div');
railTip.className='rail-tooltip';
railTip.id='rail-tooltip';
railTip.setAttribute('role','tooltip');
railTip.hidden=true;
document.body.append(railTip);
let railTipTarget=null;
function hideRailTip(){
  if(railTipTarget)railTipTarget.removeAttribute('aria-describedby');
  railTipTarget=null;
  railTip.hidden=true;
}
function showRailTip(target){
  if(!target||!C.railTips)return hideRailTip();
  const label=target.dataset.railTip;
  if(!label)return hideRailTip();
  if(railTipTarget&&railTipTarget!==target)railTipTarget.removeAttribute('aria-describedby');
  railTipTarget=target;
  railTip.textContent=label;
  railTip.hidden=false;
  target.setAttribute('aria-describedby','rail-tooltip');
  const rect=target.getBoundingClientRect();
  const box=railTip.getBoundingClientRect();
  const mobileRail=rect.top>window.innerHeight*.7&&window.innerWidth<=760;
  const left=mobileRail
    ?Math.min(window.innerWidth-box.width-8,Math.max(8,rect.left+(rect.width-box.width)/2))
    :Math.min(window.innerWidth-box.width-10,rect.right+12);
  const top=mobileRail
    ?Math.max(8,rect.top-box.height-10)
    :Math.max(8,Math.min(window.innerHeight-box.height-8,rect.top+(rect.height-box.height)/2));
  railTip.style.left=Math.max(8,left)+'px';
  railTip.style.top=top+'px';
}
document.addEventListener('pointerover',e=>{
  const target=e.target.closest?.('[data-rail-tip]');
  if(target&&target!==railTipTarget)showRailTip(target);
  else if(!target&&railTipTarget)hideRailTip();
});
document.addEventListener('focusin',e=>{
  const target=e.target.closest?.('[data-rail-tip]');
  if(target)showRailTip(target);
  else hideRailTip();
});
document.addEventListener('focusout',e=>{
  if(railTipTarget&&e.target===railTipTarget)hideRailTip();
});
/* Keep the inline calendar inside its dialog and close it predictably. */
document.addEventListener('click',e=>{
  const picker=dlg.querySelector('.user-date-field');
  if(picker&&!picker.contains(e.target))closeUserCalendar(picker);
});
document.addEventListener('keydown',e=>{
  const panel=e.target.closest?.('.user-date-calendar');
  if(!panel||panel.hidden)return;
  const picker=panel.closest('.user-date-field');
  if(e.key==='Escape'){
    e.preventDefault();
    closeUserCalendar(picker);
    picker.querySelector('[data-user-date-open]')?.focus();
    return;
  }
  const current=e.target.closest('[data-user-date-day]');
  if(!current)return;
  const steps={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
  if(!Object.prototype.hasOwnProperty.call(steps,e.key))return;
  e.preventDefault();
  const selected=userDateFromYmd(current.dataset.userDateDay);
  if(!selected)return;
  const target=new Date(selected.getFullYear(),selected.getMonth(),selected.getDate()+steps[e.key],12);
  if(target.getMonth()!==selected.getMonth()||target.getFullYear()!==selected.getFullYear())drawUserCalendar(picker,target);
  panel.querySelector('[data-user-date-day="'+userYmd(target)+'"]')?.focus();
});
document.addEventListener('pointerdown',hideRailTip);
window.addEventListener('scroll',hideRailTip,true);
window.addEventListener('resize',hideRailTip);

// Native modal semantics, unified entrance/exit transitions and subtle content swaps.
const modal=(h,c='')=>{
 const replacing=dlg.open;
 dlg.className=c;dlg.innerHTML=h;decorateButtonIcons(dlg);
 if(!replacing)dlg.showModal();
 else if(C.motion&&typeof dlg.firstElementChild?.animate==='function'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  dlg.firstElementChild.animate([
   {opacity:.6,transform:'translateY(7px) scale(.988)'},
   {opacity:1,transform:'translateY(0) scale(1)'}
  ],{duration:220,easing:'cubic-bezier(.2,.8,.25,1)'});
 }
};
dlg.addEventListener('click',e=>{if(e.target==dlg||e.target.closest('[data-x]'))dlg.close()});
const confirmBox=(h,ok,fn)=>{CF=fn;modal(`<div class="box"><h2>${h}</h2><div class="act"><button class="gh" data-x>Отмена</button><button class="btn" data-cf>${ok}</button></div></div>`)};
let tt;const toast=(m,al,fn)=>{const t=$('#toast');t.innerHTML=`<span>${esc(m)}</span>${al?`<button id="ta">${esc(al)}</button>`:''}`;if(al)$('#ta').onclick=()=>{fn();t.classList.remove('show')};t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),al?6000:2400)};
const CDEFAULT={theme:'dark',accent:'emerald',customA:'#60d6a2',customB:'#c3e879',hue:151,sat:62,lum:61,ts:1,motion:1,density:'comfortable',surface:'solid',glow:'normal',font:'onest',radius:16,borders:'soft',sidebar:'standard',railTips:0,contentWidth:1920,gapScale:1,autoCoreRefresh:1,coreRefreshSeconds:30};
let C={...CDEFAULT};try{Object.assign(C,JSON.parse(localStorage.xmeshNexusSettings||'{}'))}catch(e){}if(C.accent==='mint')C.accent='emerald';if(!['solid','glass','raised'].includes(C.surface))C.surface='solid';C.railTips=C.railTips===true||C.railTips===1?1:0;C.ts=cl(Number(C.ts)||1,.9,2);C.radius=cl(Number.isFinite(Number(C.radius))?Number(C.radius):16,1,36);// Remove legacy split-text preferences: the unified interface scale controls text and UI together.
delete C.textSize;delete C.textPrecision;C.rangePrecision=C.rangePrecision===10?10:1;
const hslHex=(h,s,l)=>{s/=100;l/=100;const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>{const c=(k(n)+12)%12;return l-a*Math.max(-1,Math.min(c-3,9-c,1))};return '#'+[f(0),f(8),f(4)].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('')};
const apply=()=>{const r=document.documentElement;r.dataset.theme=C.theme=='auto'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):C.theme;r.dataset.accent=C.accent;r.style.setProperty('--custom-a',C.customA||hslHex(+C.hue||151,+C.sat||62,+C.lum||61));r.style.setProperty('--custom-b',C.customB||'#c3e879');if(C.accent==='custom'){const rgb=(C.customA||'#60d6a2').match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16)/255);const linear=rgb.map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));const lum=.2126*linear[0]+.7152*linear[1]+.0722*linear[2];r.style.setProperty('--btn-text',lum>.42?'#082b1d':'#ffffff')}else r.style.setProperty('--btn-text',r.dataset.theme==='light'?'#ffffff':'#082b1d');r.dataset.density=C.density||CDEFAULT.density;r.dataset.surface=C.surface||CDEFAULT.surface;r.dataset.glow=C.glow||CDEFAULT.glow;r.dataset.font=C.font||CDEFAULT.font;r.dataset.borders=C.borders||CDEFAULT.borders;r.dataset.sidebar=C.sidebar||CDEFAULT.sidebar;r.dataset.railTips=C.railTips?'on':'off';if(!C.railTips)hideRailTip();r.style.setProperty('--ts',cl(+C.ts||1,.9,2));const radius=cl(Number.isFinite(Number(C.radius))?Number(C.radius):16,1,36);r.style.setProperty('--ui-radius',radius+'px');r.style.setProperty('--ui-control-radius',radius+'px');r.dataset.motion=C.motion?'on':'off';
r.style.setProperty('--panel-content-max',cl(Number(C.contentWidth)||1920,720,3000)+'px');
const baseGap=C.density==='compact'?.75:C.density==='spacious'?1.45:1.1;
r.style.setProperty('--view-gap',(baseGap*cl(Number(C.gapScale)||1,.8,1.4))+'rem');
try{localStorage.xmeshNexusSettings=JSON.stringify(C)}catch(e){}};
// Width preview is kept off the full appearance pipeline: dragging must not
// update unrelated CSS/theme attributes or serialize localStorage every pixel.
let contentWidthFrame=0;
const paintContentWidth=()=>{
 const next=Math.round(cl(Number(C.contentWidth)||1920,720,3000))+'px';
 const style=document.documentElement.style;
 if(style.getPropertyValue('--panel-content-max')!==next)style.setProperty('--panel-content-max',next);
};
const previewContentWidth=()=>{
 if(contentWidthFrame)return;
 contentWidthFrame=requestAnimationFrame(()=>{
  contentWidthFrame=0;
  paintContentWidth();
 });
};
const saveContentWidth=()=>{
 if(contentWidthFrame){cancelAnimationFrame(contentWidthFrame);contentWidthFrame=0;}
 paintContentWidth();
 try{localStorage.xmeshNexusSettings=JSON.stringify(C)}catch(e){}
};
// Custom palette inputs are a draft until explicitly confirmed by the user.
const paletteDraft={a:C.customA||'#60d6a2',b:C.customB||'#c3e879',h:C.hue??151,s:C.sat??62,l:C.lum??61};
const resetPaletteDraft=()=>Object.assign(paletteDraft,{a:C.customA||'#60d6a2',b:C.customB||'#c3e879',h:C.hue??151,s:C.sat??62,l:C.lum??61});
const paletteHsl=hex=>{
 const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
 const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
 let h=0,s=0,l=(max+min)/2;
 if(delta){s=delta/(1-Math.abs(2*l-1));if(max===r)h=((g-b)/delta)%6;else if(max===g)h=(b-r)/delta+2;else h=(r-g)/delta+4;h=(h*60+360)%360;}
 return {h:Math.round(h),s:Math.round(s*100),l:Math.round(l*100)};
};
const paintPaletteDraft=()=>{
 const panel=$('#palette-draft-preview');
 if(panel){panel.style.setProperty('--x',paletteDraft.a);panel.style.setProperty('--y',paletteDraft.b);}
 for(const [key,id,suffix] of [['h','hue','°'],['s','sat','%'],['l','lum','%']]){
  const slider=$('#'+id),out=$('#'+id+'v');
  if(slider)slider.value=paletteDraft[key];
  if(out)out.textContent=paletteDraft[key]+suffix;
 }
 const primary=$('#custom-a'),secondary=$('#custom-b');
 if(primary){primary.value=paletteDraft.a;primary.classList.remove('invalid');primary.setAttribute('aria-invalid','false')}
 if(secondary){secondary.value=paletteDraft.b;secondary.classList.remove('invalid');secondary.setAttribute('aria-invalid','false')}
 $('#palette-preview-a')?.style.setProperty('--picked',paletteDraft.a);
 $('#palette-preview-b')?.style.setProperty('--picked',paletteDraft.b);
};
const updatePaletteColor=(t)=>{
 if(t.id!=='custom-a'&&t.id!=='custom-b')return false;
 const raw=String(t.value||'').trim();
 const valid=/^#?[a-f0-9]{6}$/i.test(raw);
 t.classList.toggle('invalid',!valid);
 t.setAttribute('aria-invalid',String(!valid));
 // Keep incomplete HEX input available while the user types.
 if(valid){
  const hex='#'+raw.replace(/^#/,'').toUpperCase();
  if(t.id==='custom-a'){paletteDraft.a=hex;Object.assign(paletteDraft,paletteHsl(hex));}
  else paletteDraft.b=hex;
  paintPaletteDraft();
 }
 return true;
};
// Keep the accent-colored range track in sync with the actual value.
// This only sets one element-local CSS variable and never applies the full theme.
// Common track fill for every native slider in the panel and studios.
const syncRangeProgress=input=>{
 if(!input?.matches?.('input[type="range"]'))return;
 const min=Number(input.min),max=Number(input.max),value=Number(input.value);
 if(!Number.isFinite(min)||!Number.isFinite(max)||!Number.isFinite(value)||max<=min)return;
 const percent=Math.max(0,Math.min(100,(value-min)/(max-min)*100));
 input.style.setProperty('--range-pct',percent.toFixed(2)+'%');
};
// Only Appearance sliders use the 1/10 precision setting. Other studios retain
// their protocol-defined step sizes. Coarse values snap to absolute tens, not
// to (minimum + N * 10), and both endpoints remain reachable.
// UI scale uses its native .01 step (1%) regardless of the coarse slider mode.
const APPEARANCE_RANGE_IDS=new Set(['content-width','gap-scale','hue','sat','lum']);
const configureRangePrecision=input=>{
 if(!input?.matches?.('input[type="range"]'))return;
 if(APPEARANCE_RANGE_IDS.has(input.id)){
  if(!input.dataset.baseStep)input.dataset.baseStep=input.getAttribute('step')||'1';
  input.step=C.rangePrecision===10?'any':input.dataset.baseStep;
 }
 syncRangeProgress(input);
};
const snapAppearanceSlider=input=>{
 if(!input?.matches?.('input[type="range"]')||!APPEARANCE_RANGE_IDS.has(input.id))return;
 const factor=(input.id==='ts'||input.id==='gap-scale')?100:1;
 const min=Math.round(Number(input.min)*factor),max=Math.round(Number(input.max)*factor);
 const raw=Number(input.value)*factor;
 if(!Number.isFinite(raw))return;
 const step=C.rangePrecision===10?10:1;
 // Explicit endpoints remain reachable with coarse snapping.
 const next=raw<=min?min:raw>=max?max:cl(Math.round(raw/step)*step,min,max);
 input.value=String(Number((next/factor).toFixed(4)));
};
const initializeRangeProgress=root=>{
 root.querySelectorAll('input[type="range"]').forEach(configureRangePrecision);
};
const updateVisibleRangePrecision=()=>{
 document.querySelectorAll('input[type="range"]').forEach(configureRangePrecision);
};
const APPEARANCE_FIELDS={
 ts:{output:'tsv',unitFactor:100,min:90,max:200},
 radius:{output:'rv',unitFactor:1,min:1,max:36},
 'content-width':{output:'content-width-value',unitFactor:1,min:720,max:3000},
 'gap-scale':{output:'gap-scale-value',unitFactor:100,min:80,max:140}
};
const showAppearanceNumber=id=>{
 const f=APPEARANCE_FIELDS[id],input=f&&$('#'+f.output);
 if(!input||input===document.activeElement)return;
 const stored=id==='ts'?C.ts:id==='radius'?C.radius:id==='content-width'?C.contentWidth:C.gapScale;
 input.value=String(Math.round(stored*f.unitFactor));
};
const commitAppearanceNumber=input=>{
 const id=input.dataset.appearanceValue,f=APPEARANCE_FIELDS[id];
 if(!f)return false;
 let n=input.valueAsNumber;
 if(!Number.isFinite(n)){
  input.value=String(Math.round((id==='ts'?C.ts:id==='radius'?C.radius:id==='content-width'?C.contentWidth:C.gapScale)*f.unitFactor));
  return true;
 }
 n=cl(Math.round(n),f.min,f.max);
 input.value=String(n);
 const value=n/f.unitFactor;
 if(id==='ts')C.ts=value;
 else if(id==='radius')C.radius=value;
 else if(id==='content-width')C.contentWidth=value;
 else C.gapScale=value;
 const slider=$('#'+id);
 if(slider){slider.value=String(value);syncRangeProgress(slider)}
 if(id==='content-width')saveContentWidth();
 else saveAppearanceControls();
 return true;
};

// No serialization or full appearance recomputation in a range-input event.
let appearanceControlsFrame=0;
const paintAppearanceControls=()=>{
 const style=document.documentElement.style;
 style.setProperty('--ts',cl(Number(C.ts)||1,.9,2));
 const radius=cl(Number.isFinite(Number(C.radius))?Number(C.radius):16,1,36);
 style.setProperty('--ui-radius',radius+'px');
 style.setProperty('--ui-control-radius',radius+'px');
 const baseGap=C.density==='compact'?.75:C.density==='spacious'?1.45:1.1;
 style.setProperty('--view-gap',(baseGap*cl(Number(C.gapScale)||1,.8,1.4))+'rem');
};
const previewAppearanceControls=()=>{
 if(appearanceControlsFrame)return;
 appearanceControlsFrame=requestAnimationFrame(()=>{
  appearanceControlsFrame=0;paintAppearanceControls();
 });
};
const saveAppearanceControls=()=>{
 if(appearanceControlsFrame){cancelAnimationFrame(appearanceControlsFrame);appearanceControlsFrame=0;}
 apply();
};
const brand=()=>{$('#bn').textContent=DB.set.brand;$('#lg').textContent=(DB.set.brand[0]||'L').toUpperCase()};

let T=[],cur='',RT=0;
// The panel theme is browser-local; subscription appearance is saved via API.
const panelSubscriptionTheme=()=>{
 const root=document.documentElement,style=getComputedStyle(root);
 const color=(token,fallback)=>{
  const value=style.getPropertyValue(token).trim();
  return /^#[\da-f]{6}$/i.test(value)?value.toLowerCase():fallback;
 };
 return {
  subscriptionAccent:color('--a','#74ddb1'),
  subscriptionTheme:root.dataset.theme==='light'?'light':'dark',
  subscriptionBackground:color('--bg','#0a0e14'),
  subscriptionCardColor:color('--s1','#131923'),
  subscriptionTextColor:color('--tx','#edf3f5')
 };
};
let subscriptionThemeSync=Promise.resolve();
const syncSubscriptionTheme=()=>{
 if(!backendReady||sessionUser?.role!=='owner'||DB.set.subscriptionSyncPanelTheme===false)return subscriptionThemeSync;
 document.querySelector('.subscription-studio form')?.dispatchEvent(new Event('change',{bubbles:true}));
 subscriptionThemeSync=subscriptionThemeSync.catch(()=>{}).then(async()=>{
  if(DB.set.subscriptionSyncPanelTheme===false)return;
  const theme=panelSubscriptionTheme();
  const patch=Object.fromEntries(Object.entries(theme).filter(([key,value])=>DB.set[key]!==value));
  if(Object.keys(patch).length)await api.saveSettings(patch);
 }).catch(error=>toast('Не удалось синхронизировать тему подписки: '+(error.message||'API')));
 return subscriptionThemeSync;
};
const subscriptionStudioP=()=>window.XMeshSubscriptionStudio.create(DB.set,patch=>api.saveSettings(patch),toast,{users:DB.users.length,nodes:DB.nodes.length},panelSubscriptionTheme);
const pages={home:['Дашборд',homeP],users:['Пользователи',usersP],squads:['Сквады',()=>simple(['squads'])],hosts:['Хосты',()=>simple(['hosts'])],nodes:['Узлы',nodesP],templates:['Шаблоны',()=>simple(['tpls','subs'])],profiles:['XRAY STUDIO',profilesP],subscription:['SUBSCRIPTION STUDIO',subscriptionStudioP],tools:['Диагностика',toolsP],admins:['Администраторы',()=>simple(['admins'])],security:['Безопасность',securityP],set:['Настройки',setP]};
const skel=()=>`<div class="sk" style="height:7rem"></div><div class="sk" style="height:18rem"></div><div class="sk" style="height:12rem"></div>`;
const NAV_SHORT={home:'Главная',users:'Клиенты',hosts:'Хосты',nodes:'Узлы',subscription:'Подписка'};
$('#nav').innerHTML=NAV.map(([g,a])=>`<div class="g">${g}</div>`+a.map(([k,i,l,p])=>`<a href="#${k}" class="${p?'':'sec'}" aria-label="${l}" data-rail-tip="${l}">${ic(i)}<span class="lbl"><span class="nav-label-full">${l}</span><span class="nav-label-short" aria-hidden="true">${NAV_SHORT[k]||l}</span></span>${k=='users'?'<em id="unb"></em>':''}</a>`).join('')).join('')+`<button class="more" id="more" aria-label="Ещё разделы" data-rail-tip="Ещё разделы">${ic('more')}<span class="lbl">Ещё</span></button>`;
let pendingScrollTarget=null;
function scrollToSettingsTarget(id){
  const target=document.getElementById(id);
  if(!target)return false;
  target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  return true;
}
async function render(soft){
  T.forEach(clearInterval);T=[];cur=location.hash.slice(1);if(!pages[cur])cur='home';const rt=++RT,[t,f]=pages[cur],v=$('#view');
  $('#title').textContent=t;document.title=(window.XMeshI18n?.translate(t)||t)+' — '+DB.set.brand;$$('#nav a').forEach(a=>a.classList.toggle('on',a.getAttribute('href')=='#'+cur));
  if(!soft){v.classList.remove('still');v.innerHTML=skel();scrollTo(0,0)}
  const [h,i]=await f();if(rt!=RT)return;v.classList.toggle('still',!!soft);v.innerHTML=h;decorateButtonIcons(v);i&&i();initializeRangeProgress(v);window.XMeshMfa?.mount(v);window.XMeshSecurity?.mount(v);$('#unb').textContent=DB.users.length;drawBulk();
  if(pendingScrollTarget&&cur==='set'){
    const target=pendingScrollTarget;
    pendingScrollTarget=null;
    requestAnimationFrame(()=>scrollToSettingsTarget(target));
  }
}

/* ================= СИСТЕМНЫЕ МЕТРИКИ ================= */
const sysBytes=n=>{if(!Number.isFinite(+n))return'—';const v=+n;if(v<1024)return fmt(v)+' Б';if(v<1024**2)return fmt(v/1024,1)+' КБ';if(v<1024**3)return fmt(v/1024**2,1)+' МБ';if(v<1024**4)return fmt(v/1024**3,2)+' ГБ';return fmt(v/1024**4,2)+' ТБ'};
const sysPct=n=>n==null||n===''||!Number.isFinite(+n)?null:Math.max(0,Math.min(100,+n));
const sysBar=n=>{const p=sysPct(n);return p===null?'<div class="sys-progress"><i style="width:0%"></i></div>':`<div class="sys-progress ${p>=90?'danger':p>=75?'warning':''}"><i style="width:${p}%"></i></div>`};
const sysUptime=n=>{if(!Number.isFinite(+n))return'—';n=Math.max(0,Math.floor(+n));const d=Math.floor(n/86400),h=Math.floor(n%86400/3600),m=Math.floor(n%3600/60);return d?`${d} д ${h} ч`:h?`${h} ч ${m} мин`:`${m} мин`};
function systemPanel(s,error=''){
  if(!s)return `<section class="card system-card"><div class="hd"><div><p class="note">МОНИТОРИНГ</p><h3>Состояние системы</h3><p>${error?esc(error):'Получаем системные показатели…'}</p></div><span class="sys-live"><i></i> Ожидание</span></div><div class="sys-empty">${ic('server')}<span>Метрики станут доступны после подключения к backend.</span></div></section>`;
  const cpu=sysPct(s.cpu?.percent),ram=sysPct(s.ram?.percent),disk=sysPct(s.disk?.percent);
  const donut=(key,title,pct,detail,color)=>{
    const valid=pct!==null,p=valid?pct:0,dash=`${p} ${100-p}`;
    const tone=valid&&p>=90?'--er':valid&&p>=75?'--wr':color;
    return `<article class="sys-metric sys-metric-donut"><div class="sys-metric-head"><span>${title}</span><span class="sys-glyph">${key}</span></div><div class="sys-donut-row"><div class="sys-donut"><div class="ringwrap"><svg viewBox="0 0 40 40" role="img" aria-label="${title}: ${valid?fmt(p,1)+'%':'нет данных'}"><circle class="ng-track" cx="20" cy="20" r="16" pathLength="100"></circle><circle class="ng-arc" cx="20" cy="20" r="16" pathLength="100" stroke-dasharray="${dash}" style="--g-color:var(${tone})"></circle></svg><b class="ng-center">${valid?fmt(p,1)+'%':'—'}</b></div></div><div class="sys-donut-info"><b>${valid?'Использовано':'Нет данных'}</b><span>${detail}</span><small>${valid?fmt(Math.max(0,100-p),1)+'% свободно':'Ожидание показаний'}</small></div></div></article>`;
  };
  const info=(key,title,value,detail)=>`<article class="sys-metric sys-metric-uptime"><div class="sys-metric-head"><span>${title}</span><span class="sys-glyph">${key}</span></div><div class="sys-value">${value}</div><div class="sys-detail">${detail}</div><div class="sys-uptime-foot"><i></i> Процесс панели работает</div></article>`;
  const diskDetail=s.disk?`${sysBytes(s.disk.usedBytes)} из ${sysBytes(s.disk.totalBytes)}`:'Нет данных о файловой системе';
  const ramDetail=s.ram?.totalBytes?`${sysBytes(s.ram.usedBytes)} из ${sysBytes(s.ram.totalBytes)}`:'Нет данных о памяти';
  const cpuDetail=cpu===null?'Недостаточно данных для расчёта':`Средняя нагрузка: ${s.loadAverage?.one==null?'—':fmt(s.loadAverage.one,2)}`;
  const dbOnline=s.database==='online';
  const sampled=s.sampledAt?new Date(s.sampledAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
  return `<section class="card system-card"><div class="hd"><div><p class="note">МОНИТОРИНГ · LIVE</p><h3>Состояние системы</h3><p>Ресурсы и доступность сервисов панели в реальном времени.</p></div><span class="sys-live"><i></i> Обновляется</span></div><div class="sys-grid">
  ${donut('CPU','Процессор',cpu,cpuDetail,'--a')}
  ${donut('RAM','Оперативная память',ram,ramDetail,'--b')}
  ${donut('SSD','Диск',disk,diskDetail,'--c3')}
  ${info('UP','Время работы',sysUptime(s.uptimeSeconds),`Видимых процессов: ${s.processCount==null?'—':fmt(s.processCount)}`)}
  </div><div class="sys-details"><div class="sys-detail-item"><span class="sys-detail-label">Средняя нагрузка</span><b>${[s.loadAverage?.one,s.loadAverage?.five,s.loadAverage?.fifteen].map(v=>v==null?'—':fmt(v,2)).join(' / ')}</b><small>1 · 5 · 15 минут</small></div><div class="sys-detail-item"><span class="sys-detail-label">База данных</span><b class="${dbOnline?'sys-ok':'sys-bad'}"><i></i>${dbOnline?'Подключена':'Нет соединения'}</b><small>PostgreSQL · проверка SELECT 1</small></div><div class="sys-detail-item"><span class="sys-detail-label">Последнее обновление</span><b>${sampled}</b><small>Автообновление каждые 15 секунд</small></div></div><p class="sys-note">${esc(s.scope||'Показатели зависят от ресурсов, доступных контейнеру панели.')} Диск показывает файловую систему, смонтированную в контейнер как /.</p></section>`;
}


/* ================= RX/TX HISTORY ================= */
const trafficMbit=value=>Math.max(0,Number(value)||0)*8/1_000_000;
const trafficRateLabel=value=>{
  const mbps=trafficMbit(value);
  if(mbps>=1000)return fmt(mbps/1000,2)+' Гбит/с';
  if(mbps>=1)return fmt(mbps,2)+' Мбит/с';
  if(mbps>=0.01)return fmt(mbps*1000,1)+' Кбит/с';
  if(mbps===0)return '0 Мбит/с';
  return fmt(mbps*1000,3)+' Кбит/с';
};
function trafficSummaryMarkup(payload){
  const points=Array.isArray(payload?.points)?payload.points:[];
  const latest=points[points.length-1];
  const when=latest?.bucketMs?new Date(latest.bucketMs).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'—';
  const rx=latest?trafficRateLabel(latest.rxBytesPerSec):'—';
  const tx=latest?trafficRateLabel(latest.txBytesPerSec):'—';
  const detail=latest?('Последний бакет · '+when):'Ожидание телеметрии';
  return `<div class="traffic-kpi"><span><i class="traffic-dot rx"></i> RX · принято узлами</span><b>${rx}</b><small>${detail}</small></div><div class="traffic-kpi"><span><i class="traffic-dot tx"></i> TX · отправлено узлами</span><b>${tx}</b><small>${detail}</small></div>`;
}
function trafficChartMarkup(payload,range){
  const points=Array.isArray(payload?.points)?payload.points:[];
  if(!payload||!payload.sampleCount||!points.length){
    return `<div class="traffic-empty"><span class="traffic-empty-icon">${ic('activity')}</span><b>Пока нет данных RX/TX</b><span>TimescaleDB готова хранить телеметрию, но отправитель метрик от узлов ещё не подключён. График появится после поступления реальных измерений — фиктивные значения не отображаются.</span>${DB.nodes.length?'<small>Выбранный период: '+(range==='1h'?'последний час':'последние 24 часа')+'. Проверьте выбранный узел или сквад.</small>':'<small>Сначала добавьте узлы в раздел «Узлы».</small>'}</div>`;
  }
  const width=960,height=292,left=66,right=22,top=18,bottom=44,plotW=width-left-right,plotH=height-top-bottom;
  const rx=points.map(p=>trafficMbit(p.rxBytesPerSec)),tx=points.map(p=>trafficMbit(p.txBytesPerSec));
  const peak=Math.max(0,...rx,...tx);
  const max=peak>0?peak*1.12:1;
  const x=i=>left+(points.length>1?i/(points.length-1):0.5)*plotW;
  const y=v=>top+plotH-(v/max)*plotH;
  const path=values=>values.map((v,i)=>(i?'L':'M')+' '+x(i).toFixed(2)+' '+y(v).toFixed(2)).join(' ');
  const grid=[0,0.25,0.5,0.75,1].map(frac=>{
    const yy=y(max*frac);
    return `<line class="traffic-gridline" x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}"></line><text class="traffic-axis-label" x="${left-10}" y="${yy+4}" text-anchor="end">${fmt(max*frac,frac===0?0:2)}</text>`;
  }).join('');
  const axisLabels=[0,Math.floor((points.length-1)/2),points.length-1].filter((idx,i,arr)=>arr.indexOf(idx)===i).map(idx=>{
    const d=new Date(points[idx].bucketMs);
    const label=range==='24h'?d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    return `<text class="traffic-axis-label" x="${x(idx)}" y="${height-13}" text-anchor="${idx===0?'start':idx===points.length-1?'end':'middle'}">${label}</text>`;
  }).join('');
  const latest=points[points.length-1];
  const samples=Number(payload.sampleCount)||0;
  const nodes=Number(latest?.nodeCount)||0;
  return `<div class="traffic-chart-wrap"><svg class="traffic-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="RX и TX в Мбит/с за ${range==='1h'?'последний час':'последние 24 часа'}">${grid}<path class="traffic-area rx" d="${path(rx)} L ${x(points.length-1)} ${top+plotH} L ${x(0)} ${top+plotH} Z"></path><path class="traffic-area tx" d="${path(tx)} L ${x(points.length-1)} ${top+plotH} L ${x(0)} ${top+plotH} Z"></path><path class="traffic-line rx" d="${path(rx)}"></path><path class="traffic-line tx" d="${path(tx)}"></path>${points.map((point,i)=>'<circle class="traffic-point rx" cx="'+x(i)+'" cy="'+y(rx[i])+'" r="2.8"></circle><circle class="traffic-point tx" cx="'+x(i)+'" cy="'+y(tx[i])+'" r="2.8"></circle>').join('')}${axisLabels}<text class="traffic-axis-title" x="14" y="${top+plotH/2}" transform="rotate(-90 14 ${top+plotH/2})" text-anchor="middle">Мбит/с</text></svg></div><div class="traffic-chart-meta"><span>${fmt(points.length)} временных интервалов · ${fmt(samples)} исходных измерений</span><span>Данные получены от ${fmt(nodes)} узл. в последнем интервале</span></div>`;
}

/* ================= ДАШБОРД ================= */
const LV={};DB.nodes.forEach(n=>LV[n.id]={cpu:null,ram:null,mbps:null});
let ST;
async function homeP(){
  const stats=ST=await api.stats();
  let system=null,systemError="";try{system=await api.systemStats()}catch(e){systemError=e.message||"Не удалось получить системные показатели."}
  const totalItems=DB.nodes.length+DB.users.length+DB.profiles.length+DB.hosts.length+DB.squads.length+DB.tpls.length+DB.subs.length+DB.admins.length;
  const firstRun=totalItems===0;
  const counts=[['Узлы',DB.nodes.length,'server'],['Пользователи',DB.users.length,'users'],['XRAY STUDIO',DB.profiles.length,'code'],['Хосты',DB.hosts.length,'globe']];
  const setup=[
    ['01','XRAY STUDIO','Добавьте свой конфиг Xray с нужными inbound.','Профиль','profiles'],
    ['02','Узел','Укажите адрес сервера и назначьте профиль.','Добавить узел','nodes'],
    ['03','Хост','Опишите адреса и параметры подключения, которые будут доступны клиентам.','Добавить хост','hosts'],
    ['04','Сквад','Объедините inbound в группы доступа.','Создать сквад','squads']
  ];
  const setupHtml=setup.map(([num,title,desc,btn,key])=>`<article class="setup-step"><span class="stepnum">ШАГ ${num}</span><h3>${title}</h3><p>${desc}</p><button class="gh sm" data-ne="${key}">${ic('plus')}${btn}</button></article>`).join('');
  const nodeRows=DB.nodes.length?DB.nodes.slice(0,6).map(n=>`<div class="rowi"><span class="fg" style="font-size:1.25rem">${flagView(n.flag)}</span><div><b>${esc(n.name)}</b><br><small class="mu">${esc(n.addr)}${n.port?':'+esc(n.port):''}</small></div>${chip(NS[nstat(n)]?.[0]||'Не проверен',NS[nstat(n)]?.[1]||'--mu')}</div>`).join(''):'<div class="empty"><b>Узлов пока нет</b><span>Добавьте первый сервер, чтобы начать настройку.</span><button class="btn sm" data-ne="nodes">'+ic('plus')+'Добавить узел</button></div>';
  const userRows=DB.users.length?DB.users.slice(0,6).map(u=>`<div class="rowi"><button class="who" data-uo="${u.id}"><span class="av" style="background:linear-gradient(135deg,var(--b),var(--a))">${esc((u.username||'?')[0].toUpperCase())}</span><span>${esc(u.username)}</span></button>${chip(STM[st(u)]?.[0]||st(u),'--mu')}</div>`).join(''):'<div class="empty"><b>Пользователей пока нет</b><span>Создайте сквад перед добавлением первого пользователя.</span><button class="gh sm" data-ne="squads">'+ic('plus')+'Создать сквад</button></div>';
  return [`<section class="card home-overview"><div class="hd"><div><p class="note">ИНФРАСТРУКТУРА / ОБЗОР</p><h3>${firstRun?'Панель готова к настройке':'Обзор инфраструктуры'}</h3><p>${firstRun?'Добавьте свои серверы и конфигурации. Демонстрационных пользователей, узлов и фиктивной телеметрии здесь нет.':'Сводка по объектам, которые вы добавили в панель.'}</p></div><div class="setting-control"><a class="gh sm" href="#set" style="text-decoration:none;color:inherit">${ic('sliders')}Внешний вид</a></div></div><div class="home-counts">${counts.map(([label,value,glyph])=>`<div class="home-count"><span class="home-count-glyph" aria-hidden="true">${ic(glyph)}</span><b>${value}</b><span class="home-count-label">${label}</span></div>`).join('')}</div></section>
  <section class="card traffic-card" id="traffic-card">
    <div class="hd traffic-heading"><div><p class="note">TIMESCALEDB · TRAFFIC</p><h3>Трафик RX / TX</h3><p>Скорость сетевого интерфейса узлов. При работе других сервисов их трафик тоже попадёт в измерения.</p></div><div class="traffic-period" role="group" aria-label="Период графика"><button type="button" data-traffic-range="1h" class="on" aria-pressed="true">1 час</button><button type="button" data-traffic-range="24h" aria-pressed="false">24 часа</button></div></div>
    <div class="traffic-filters">
      <label class="f"><span>Узел</span><select id="traffic-node" aria-label="Фильтр по узлу"><option value="">Все узлы</option>${DB.nodes.map(n=>`<option value="${n.id}">${esc(n.name)} · ${esc(n.addr)}</option>`).join('')}</select></label>
      <label class="f"><span>Сквад</span><select id="traffic-squad" aria-label="Фильтр по скваду"><option value="">Все сквады</option>${DB.squads.map(q=>`<option value="${q.id}">${esc(q.name)}</option>`).join('')}</select></label>
      <span class="traffic-refresh"><i></i> Автообновление · 60 сек</span>
    </div>
    <div class="traffic-kpis" id="traffic-kpis"><div class="traffic-kpi"><span>RX</span><b>—</b><small>Загрузка показаний…</small></div><div class="traffic-kpi"><span>TX</span><b>—</b><small>Загрузка показаний…</small></div></div>
    <div id="traffic-chart" class="traffic-chart" aria-live="polite"><div class="traffic-empty"><b>Загрузка графика…</b></div></div>
  </section>
  <div id="system-stats">${systemPanel(system,systemError)}</div>
  ${firstRun?`<section class="card"><div class="hd"><div><h3>Первый запуск</h3><p>Создайте свои объекты — примеры не подставляются автоматически.</p></div></div><div class="setup-grid">${setupHtml}</div></section>`:`<div class="two"><section class="card"><div class="hd"><div><h3>Узлы</h3><p>${DB.nodes.length} настроено</p></div><button class="gh sm" data-ne="nodes">${ic('plus')}Добавить</button></div>${nodeRows}</section><section class="card"><div class="hd"><div><h3>Пользователи</h3><p>${DB.users.length} создано</p></div><a class="gh sm" href="#users" style="text-decoration:none;color:inherit">Все</a></div>${userRows}</section></div>`}`,()=>{const refreshSystem=async()=>{try{const latest=await api.systemStats();const target=$('#system-stats');if(target)target.innerHTML=systemPanel(latest)}catch(e){const target=$('#system-stats');if(target)target.innerHTML=systemPanel(null,e.message||'Не удалось обновить показатели.')}};const timer=setInterval(refreshSystem,15000);T.push(timer);
    let trafficRange='1h',trafficRequest=0;
    const refreshTraffic=async()=>{
      const chart=$('#traffic-chart'),kpis=$('#traffic-kpis');
      if(!chart||!kpis)return;
      const requestId=++trafficRequest;
      chart.innerHTML='<div class="traffic-empty"><b>Обновляем телеметрию…</b></div>';
      const params=new URLSearchParams({range:trafficRange});
      if($('#traffic-node')?.value)params.set('node_id',$('#traffic-node').value);
      if($('#traffic-squad')?.value)params.set('squad_id',$('#traffic-squad').value);
      try{
        const data=await backendRequest('/api/v1/metrics/traffic?'+params.toString());
        if(requestId!==trafficRequest||!$('#traffic-chart'))return;
        kpis.innerHTML=trafficSummaryMarkup(data);
        chart.innerHTML=trafficChartMarkup(data,trafficRange);
      }catch(error){
        if(requestId!==trafficRequest||!$('#traffic-chart'))return;
        kpis.innerHTML=trafficSummaryMarkup(null);
        chart.innerHTML='<div class="traffic-empty"><b>Не удалось загрузить график</b><span>'+esc(error.message||'Ошибка API метрик')+'</span></div>';
      }
    };
    $$('[data-traffic-range]').forEach(button=>button.addEventListener('click',()=>{
      trafficRange=button.dataset.trafficRange;
      $$('[data-traffic-range]').forEach(item=>{const active=item.dataset.trafficRange===trafficRange;item.classList.toggle('on',active);item.setAttribute('aria-pressed',active?'true':'false')});
      refreshTraffic();
    }));
    $('#traffic-node')?.addEventListener('change',refreshTraffic);
    $('#traffic-squad')?.addEventListener('change',refreshTraffic);
    refreshTraffic();
    T.push(setInterval(refreshTraffic,60000));
  }];
}
/* ================= ПОЛЬЗОВАТЕЛИ ================= */
const UQ={q:'',st:'all',sq:'',page:1,size:15,sort:'created',dir:'desc',sel:new Set()};let UIDS=[];
async function usersP(){
  return [`<div class="card users-panel"><div class="bar2 users-statusbar"><div class="fl" id="uf"></div></div><div class="users-toolbar">
    <div class="users-search-wrap"><label class="search users-search-field" style="cursor:text">${ic('search')}<input id="uq" placeholder="Поиск пользователей" value="${esc(UQ.q)}" aria-label="Поиск по имени, тегу, email, ссылке или Telegram ID"></label><span class="users-search-hint">Поиск по имени · тегу · email · ссылке · Telegram ID</span></div>
    <select id="usq" aria-label="Сквад"><option value="">Все сквады</option>${DB.squads.map(s=>`<option value="${s.id}"${UQ.sq==s.id?' selected':''}>${esc(s.name)}</option>`).join('')}</select>
    <div class="users-toolbar-actions"><button class="gh" data-exp>${ic('dl')}Экспорт CSV</button><button class="btn" data-nu>${ic('plus')}Пользователь</button></div>
  </div><div class="bulk" id="bulk" role="toolbar" aria-label="Массовые действия"></div><div id="ut"></div></div>`,()=>{drawUsers();let h;$('#uq').oninput=e=>{clearTimeout(h);h=setTimeout(()=>{UQ.q=e.target.value.trim().toLowerCase();UQ.page=1;drawUsers()},200)};$('#usq').onchange=e=>{UQ.sq=e.target.value;UQ.page=1;drawUsers()}}];
}
const uf=u=>(UQ.st=='all'||(UQ.st=='ONLINE'?isOn(u):st(u)==UQ.st))&&(!UQ.sq||u.squads.includes(+UQ.sq))&&(!UQ.q||[u.username,u.tag,u.email,u.desc,u.tg,u.short].join(' ').toLowerCase().includes(UQ.q));
async function drawUsers(){
  const [r,s]=await Promise.all([api.list('users',{f:uf,sort:UQ.sort,dir:UQ.dir,page:UQ.page,size:UQ.size}),api.stats()]);if(!$('#ut'))return;
  const pages=Math.max(1,Math.ceil(r.total/UQ.size));if(UQ.page>pages){UQ.page=pages;return drawUsers()}UIDS=r.ids;
  $('#uf').innerHTML=[['all','Все',s.total],['ONLINE','Онлайн',s.online],['ACTIVE','Активные',s.by.ACTIVE||0],['ON_HOLD','Ожидают',s.by.ON_HOLD||0],['LIMITED','Лимит',s.by.LIMITED||0],['EXPIRED','Истёк',s.by.EXPIRED||0],['DISABLED','Отключены',s.by.DISABLED||0]].map(([k,l,n])=>`<button data-uf="${k}" class="${UQ.st==k?'on':''}">${l}<b>${n}</b></button>`).join('');
  const th=(k,l)=>`<th><button data-s="${k}">${l}${UQ.sort==k?(UQ.dir=='asc'?' ↑':' ↓'):''}</button></th>`;
  const all=r.items.length&&r.items.every(u=>UQ.sel.has(u.id));
  $('#ut').innerHTML=r.total?`<div class="tw"><table class="tb"><thead><tr><th class="c1"><input type="checkbox" data-sela ${all?'checked':''} aria-label="Выбрать все на странице"></th>${th('username','Пользователь')}${th('status','Статус')}${th('used','Трафик')}${th('expireAt','Срок')}<th>Доступ</th>${th('onlineAt','Был в сети')}</tr></thead><tbody>${r.items.map(u=>{const [sl,sc]=STM[st(u)],k=u.limit?u.used/u.limit:0,h=hs(u.username)%360,on=isOn(u);return `<tr data-id="${u.id}" class="${UQ.sel.has(u.id)?'sel':''}"><td class="c1"><input type="checkbox" data-sel="${u.id}" ${UQ.sel.has(u.id)?'checked':''} aria-label="Выбрать ${esc(u.username)}"></td><td data-l=""><div class="who"><span class="av" style="background:linear-gradient(135deg,hsl(${h} 55% 70%),hsl(${(h+45)%360} 55% 64%))">${esc(u.username[0].toUpperCase())}</span><div>${esc(u.username)} ${u.tag?chip(esc(u.tag),'--c3'):''}<small class="mu">uTLS · ${esc(u.fingerprint||'chrome')}</small>${u.desc?`<small class="mu">${esc(u.desc)}</small>`:''}</div></div></td><td data-l="Статус">${chip(sl,sc)}</td><td data-l="Трафик"><div class="tr">${u.limit?`<div class="pb${k>=1?' er':k>.85?' wr':''}" style="--w:${Math.min(100,k*100)}%"><i></i></div>`:''}<small>${gb(u.used)} / ${u.limit?u.limit+' ГБ':'∞'}</small></div></td><td data-l="Срок"${u.expireAt&&u.expireAt<Date.now()+3*DAY?' class="er"':''}>${u.hold?u.holdDays+' дн после подключения':left(u.expireAt)}</td><td data-l="Доступ">${u.squads.map(i=>chip(esc(DB.squads.find(x=>x.id==i)?.name||'?'),'--b')).join(' ')}</td><td data-l="Был в сети">${on?'<span class="dot"></span> онлайн':ago(u.onlineAt)}</td></tr>`}).join('')}</tbody></table></div><div class="pg"><span>${(UQ.page-1)*UQ.size+1}–${Math.min(r.total,UQ.page*UQ.size)} из ${r.total}</span><select data-psz aria-label="Строк на странице">${[15,30,60].map(n=>`<option${n==UQ.size?' selected':''}>${n}</option>`).join('')}</select><button class="ia" data-pg="-1" ${UQ.page>1?'':'disabled'} aria-label="Назад">${ic('chevronLeft')}</button><button class="ia" data-pg="1" ${UQ.page<pages?'':'disabled'} aria-label="Вперёд">${ic('chevronRight')}</button></div>`:`<div class="empty"><b>Никого не найдено</b><span>Измените поиск или фильтр, либо создайте пользователя.</span><button class="btn sm" data-nu>${ic('plus')}Создать</button></div>`;
  drawBulk();
}
function drawBulk(){const b=$('#bulk'),n=UQ.sel.size;if(!b)return;b.classList.toggle('on',n>0&&cur=='users');if(!n){b.innerHTML='';return}b.innerHTML=`<b style="padding:0 .5rem">Выбрано ${n}</b>${UIDS.length>n?`<button class="gh sm" data-bk="all">Выбрать все ${UIDS.length}</button>`:''}<button class="gh sm" data-bk="on">Включить</button><button class="gh sm" data-bk="off">Отключить</button><button class="gh sm" data-bk="reset">Сбросить трафик</button><button class="gh sm" data-bk="ext">${ic('calendar')}Продлить…</button><button class="gh sm" data-bk="sq">В сквад</button><button class="dg sm" data-bk="del">${ic('trash')}Удалить</button><button class="ia" data-bk="clr" aria-label="Снять выбор">${ic('x')}</button>`;decorateButtonIcons(b)}
const uid=s=>{let h=hs(s),x='';for(let i=0;i<32;i++){h=(h*1664525+1013904223)>>>0;x+=(h>>>24&15).toString(16)}return x.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5')};
let UT='ov';const subUrl=u=>'';
/* Inline expiry editor: calendar is rendered inside the user dialog, so it
   does not escape the dialog's top layer or depend on browser date widgets. */
const userYmd=value=>{
  if(!value)return '';
  const d=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(d.getTime()))return '';
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
};
const userDateFromYmd=value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;
  const [year,month,day]=value.split('-').map(Number);
  const date=new Date(year,month-1,day,12);
  return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?date:null;
};
const userDateLabel=value=>{
  const d=userDateFromYmd(value);
  return d?new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(d):'Бессрочно';
};
function userCalendarMarkup(year,month,selected){
  const offset=(new Date(year,month,1).getDay()+6)%7;
  const total=new Date(year,month+1,0).getDate();
  const today=userYmd(new Date());
  const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day=>'<span class="user-cal-weekday">'+day+'</span>').join('');
  const blanks=Array.from({length:offset},()=>'<span class="user-cal-empty" aria-hidden="true"></span>').join('');
  const days=Array.from({length:total},(_,idx)=>{
    const day=idx+1,value=userYmd(new Date(year,month,day));
    const chosen=value===selected;
    const date=new Date(year,month,day);
    const label=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(date);
    return '<button type="button" class="user-cal-day'+(chosen?' selected':'')+(value===today?' is-today':'')+'" data-user-date-day="'+value+'" aria-label="'+esc(label)+'" aria-pressed="'+(chosen?'true':'false')+'">'+day+'</button>';
  }).join('');
  const monthLabel=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(year,month,1));
  return '<div class="user-cal-header"><strong>'+esc(monthLabel)+'</strong><div class="user-cal-nav"><button type="button" data-user-date-nav="-1" aria-label="Предыдущий месяц">'+ic('chevronLeft')+'</button><button type="button" data-user-date-nav="1" aria-label="Следующий месяц">'+ic('chevronRight')+'</button></div></div><div class="user-cal-grid">'+weekdays+blanks+days+'</div><div class="user-cal-footer"><button type="button" data-user-date-today>Сегодня</button><button type="button" data-user-date-clear>Бессрочно</button></div><div class="user-cal-renew"><input type="number" id="user-renew-days" min="1" max="36500" step="1" inputmode="numeric" aria-label="Продлить на количество дней" placeholder="Добавить дней"><button class="gh" type="button" data-user-renew-apply>Добавить</button></div><p class="er user-renew-error" role="status" hidden></p>';
}
function userExtendExpiryYmd(expireAt,days){
  if(!Number.isSafeInteger(days)||days<1||days>36500)throw new Error('Укажите количество дней от 1 до 36500.');
  const today=userYmd(new Date());
  const from=userYmd(expireAt);
  const base=userDateFromYmd(from&&from>today?from:today);
  return userYmd(new Date(base.getFullYear(),base.getMonth(),base.getDate()+days,12));
}
function userExtendExpiryTimestamp(expireAt,days){
  const date=userDateFromYmd(userExtendExpiryYmd(expireAt,days));
  return new Date(date.getFullYear(),date.getMonth(),date.getDate(),23,59,59).getTime();
}
function userDateField(u){
  const value=userYmd(u.expireAt);
  return '<div class="f user-date-field"><span id="user-expiry-label">Срок действия</span><button type="button" class="user-date-trigger" data-user-date-open aria-labelledby="user-expiry-label user-date-display" aria-expanded="false" aria-controls="user-date-calendar">'+ic('calendar')+'<span id="user-date-display" data-user-date-label>'+esc(userDateLabel(value))+'</span>'+ic('chevronRight')+'</button><input type="hidden" name="expireAt" value="'+esc(value)+'"><div class="user-date-calendar" id="user-date-calendar" role="group" aria-label="Выбор срока действия" hidden></div></div>';
}
function closeUserCalendar(picker){
  if(!picker)return;
  const cal=picker.querySelector('.user-date-calendar');
  const toggle=picker.querySelector('[data-user-date-open]');
  if(cal)cal.hidden=true;
  if(toggle)toggle.setAttribute('aria-expanded','false');
}
function drawUserCalendar(picker,date){
  const cal=picker.querySelector('.user-date-calendar');
  const selected=picker.querySelector('[name="expireAt"]').value;
  const month=new Date(date.getFullYear(),date.getMonth(),1);
  cal.dataset.month=userYmd(month);
  cal.innerHTML=userCalendarMarkup(month.getFullYear(),month.getMonth(),selected);
}
function setUserCalendarDate(picker,dateValue){
  const input=picker.querySelector('[name="expireAt"]');
  const label=picker.querySelector('[data-user-date-label]');
  input.value=dateValue;
  label.textContent=userDateLabel(dateValue);
  closeUserCalendar(picker);
  picker.querySelector('[data-user-date-open]').focus();
}
function handleUserCalendarAction(button){
  const picker=button.closest('.user-date-field');
  if(!picker)return;
  const cal=picker.querySelector('.user-date-calendar');
  if(button.hasAttribute('data-user-date-open')){
    if(!cal.hidden){closeUserCalendar(picker);return}
    const selected=userDateFromYmd(picker.querySelector('[name="expireAt"]').value)||new Date();
    drawUserCalendar(picker,selected);
    cal.hidden=false;
    button.setAttribute('aria-expanded','true');
    const chosen=cal.querySelector('.user-cal-day.selected,.user-cal-day.is-today,.user-cal-day');
    chosen?.focus();
  }else if(button.hasAttribute('data-user-date-nav')){
    const view=userDateFromYmd(cal.dataset.month)||new Date();
    const next=new Date(view.getFullYear(),view.getMonth()+Number(button.dataset.userDateNav),1);
    const direction=button.dataset.userDateNav;
    drawUserCalendar(picker,next);
    cal.querySelector('[data-user-date-nav="'+direction+'"]')?.focus();
  }else if(button.hasAttribute('data-user-date-day')){
    setUserCalendarDate(picker,button.dataset.userDateDay);
  }else if(button.hasAttribute('data-user-date-today')){
    setUserCalendarDate(picker,userYmd(new Date()));
  }else if(button.hasAttribute('data-user-date-clear')){
    setUserCalendarDate(picker,'');
  }
}
function handleUserRenewalAction(button){
  const picker=button.closest('.user-date-field');
  const panel=picker?.querySelector('.user-date-calendar');
  if(!picker||!panel||panel.hidden)return;
  const field=panel.querySelector('#user-renew-days');
  const error=panel.querySelector('.user-renew-error');
  const entered=String(field?.value||'').trim();
  const days=/^[1-9]\d*$/.test(entered)?Number(entered):NaN;
  try{
    const next=userExtendExpiryYmd(picker.querySelector('[name="expireAt"]').value,days);
    setUserCalendarDate(picker,next);
  }catch(err){
    error.textContent=err.message||'Укажите количество дней от 1 до 36500.';
    error.hidden=false;
    field?.focus();
  }
}
/* Per-user accounting is only rendered from authenticated node counter telemetry.
   Never derive a user's consumption from node-wide RX/TX interface speeds. */
const userTrafficBytes=v=>sysBytes(Number.isFinite(+v)&&+v>=0?+v:0);
function userTrafficDonutsMarkup(payload){
  const servers=Array.isArray(payload?.servers)?payload.servers.filter(r=>
    r&&Number.isFinite(+r.nodeId)&&Number.isFinite(+r.uplinkBytes)&&Number.isFinite(+r.downlinkBytes)
    &&+r.uplinkBytes>=0&&+r.downlinkBytes>=0):[];
  if(!servers.length)return '<div class="user-chart-empty"><div class="user-chart-empty-ring" aria-hidden="true"><span>—</span></div><div class="user-chart-empty-copy"><b>Нет данных по серверам</b><p>График появится после получения персональных счётчиков Xray от нод.</p><small>Трафик VPS не подменяет статистику пользователя.</small></div></div>';
  const up=servers.reduce((sum,r)=>sum+Number(r.uplinkBytes),0);
  const down=servers.reduce((sum,r)=>sum+Number(r.downlinkBytes),0);
  const total=up+down;
  const cards=servers.map(r=>{
    const amount=Number(r.uplinkBytes)+Number(r.downlinkBytes);
    const share=total?Math.min(100,Math.max(0,amount/total*100)):0;
    const percent=total?fmt(share,share<1?1:0):'0';
    const seen=Number.isFinite(+r.updatedAtMs)?new Date(+r.updatedAtMs).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
    return '<article class="user-server-item"><div class="user-server-donut" style="--traffic-share:'+share.toFixed(3)+'%" role="img" aria-label="'+esc(String(r.name||'Узел #'+r.nodeId))+': '+percent+'% пользовательского трафика"><span>'+percent+'%</span></div><div class="user-server-details"><b title="'+esc(r.name||'Узел #'+r.nodeId)+'">'+esc(r.name||'Узел #'+r.nodeId)+'</b><strong>'+userTrafficBytes(amount)+'</strong><small>↑ '+userTrafficBytes(r.uplinkBytes)+' · ↓ '+userTrafficBytes(r.downlinkBytes)+'</small><span class="user-server-updated">Срез '+esc(seen)+'</span></div></article>';
  }).join('');
  const downloadShare=total?down/total*100:0;
  const chart='<div class="user-traffic-visual"><div class="user-traffic-main-donut" style="--down-share:'+downloadShare.toFixed(3)+'%" role="img" aria-label="Скачано '+userTrafficBytes(down)+', загружено '+userTrafficBytes(up)+'"><div><small>Всего</small><strong>'+userTrafficBytes(total)+'</strong></div></div><div class="user-traffic-legend"><div><span class="user-legend-dot is-down"></span><span>Скачано</span><b>'+userTrafficBytes(down)+'</b></div><div><span class="user-legend-dot is-up"></span><span>Отправлено</span><b>'+userTrafficBytes(up)+'</b></div><small>Серверов с данными: '+servers.length+'</small></div></div>';
  return chart+(total===0?'<p class="user-server-pending">Счётчики подключены, но трафик пока не зарегистрирован.</p>':'')+'<div class="user-server-grid">'+cards+'</div><small class="user-server-source">Данные только из персональных счётчиков Xray. Общий трафик VPS не используется.</small>';
}
function userInboundTrafficMarkup(payload){
 const rows=Array.isArray(payload?.inbounds)?payload.inbounds.filter(r=>r&&typeof r.inboundTag==='string'&&Number.isFinite(+r.uplinkBytes)&&Number.isFinite(+r.downlinkBytes)): [];
 if(!rows.length)return '<section class="user-inbound-stats"><h4>Трафик по inbound</h4><p class="note">Пока нет персональных счётчиков по inbound. Обычный Xray StatsService отдаёт пользователя и inbound отдельно; эти общие значения нельзя перемножать или распределять искусственно. Требуется агент, передающий реальные счётчики userInboundTraffic.</p></section>';
 const cards=rows.map(r=>'<div class="user-inbound-item"><div><b>'+esc(r.inboundTag)+'</b><small>'+esc(r.nodeName||'Узел #'+r.nodeId)+'</small></div><div><b>'+userTrafficBytes(+r.uplinkBytes + +r.downlinkBytes)+'</b><small>↑ '+userTrafficBytes(r.uplinkBytes)+' · ↓ '+userTrafficBytes(r.downlinkBytes)+'</small></div></div>').join('');
 return '<section class="user-inbound-stats"><h4>Трафик по inbound</h4><div class="user-inbound-grid">'+cards+'</div><small class="user-server-source">Только фактические подписанные измерения узлов; не прибавляются повторно к общему трафику пользователя.</small></section>';
}
async function loadUserTrafficStats(userId){
  const container=dlg.querySelector('[data-user-traffic-id="'+userId+'"]');
  if(!container)return;
  if(!backendReady){
    container.innerHTML=userTrafficDonutsMarkup(null);
    return;
  }
  try{
    const payload=await backendRequest('/api/v1/users/'+encodeURIComponent(userId)+'/traffic');
    if(dlg.open&&container.isConnected&&dlg.contains(container)){
      container.innerHTML=userTrafficDonutsMarkup(payload)+userInboundTrafficMarkup(payload);
    }
  }catch(error){
    if(dlg.open&&container.isConnected&&dlg.contains(container)){
      container.innerHTML='<div class="user-traffic-empty">'+ic('activity')+'<div><b>Не удалось получить статистику</b><p>'+esc(error.message||'Ошибка загрузки метрик')+'</p><button type="button" class="gh sm" data-user-traffic-refresh="'+userId+'">Повторить</button></div></div>';
    }
  }
}
function userDrawer(id,tab){
  const u=DB.users.find(x=>x.id==id);
  if(!u)return dlg.close();
  if(!u.xrayId){
    u.xrayId=crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
      const r=crypto.getRandomValues(new Uint8Array(1))[0]&15;
      return(c==='x'?r:(r&3|8)).toString(16);
    });
    api.update('users',u.id,{xrayId:u.xrayId}).catch(err=>console.warn('Could not persist generated Xray credential',err));
  }
  const [label,statusColor]=STM[st(u)];
  const usageRatio=u.limit?u.used/u.limit:0;
  const avatarHue=hs(u.username)%360;
  const userInbounds=uin(u);
  const hosts=DB.hosts.filter(host=>!host.disabled&&userInbounds.includes(host.tag));
  const squadMarkup=DB.squads.length
    ?DB.squads.map(squad=>`<label class="ck user-squad-option"><input type="checkbox" data-usq="${u.id}:${squad.id}" ${u.squads.includes(squad.id)?'checked':''}><span>${esc(squad.name)}</span></label>`).join('')
    :'<span class="user-canvas-muted">Сквады ещё не созданы</span>';
  const inboundMarkup=userInbounds.length
    ?userInbounds.map(tag=>chip(esc(tag),tcol(tag))).join(' ')
    :'<span class="user-canvas-muted">Нет активных inbound</span>';
  const hostMarkup=hosts.length
    ?hosts.map(host=>`<div class="user-host-line"><span>${esc(host.remark||host.tag)}</span><small title="${esc(host.address||'')}">${esc(host.address||'')}:${esc(host.port||'')}</small></div>`).join('')
    :'<span class="user-canvas-muted">Подходящие серверы не назначены</span>';
  const devices=u.devices.length
    ?u.devices.map(d=>`<div class="user-device-line"><div><b>${esc(d.model)}</b><small>${esc(d.app)} · ${ago(d.last)}</small></div><button class="ia" data-dd="${u.id}:${d.id}" aria-label="Удалить устройство ${esc(d.model)}" title="Удалить устройство">${ic('trash')}</button></div>`).join('')
    :'<span class="user-canvas-muted">Подключённых устройств пока нет</span>';
  modal(`<div class="box user-drawer user-canvas">
    <header class="user-head">
      <div class="who"><span class="av" style="background:hsl(${avatarHue} 55% 68%)">${esc((u.username||'?')[0].toUpperCase())}</span><div><h2>${esc(u.username)}</h2>${chip(label,statusColor)} ${isOn(u)?'<span class="dot"></span>':''}</div></div>
      <div class="user-head-actions"><button type="button" class="gh sm" data-a="tog" data-u="${u.id}">${ic(u.disabled?'play':'pause')}${u.disabled?'Включить':'Отключить'}</button><button type="button" class="ia user-remove" data-a="del" data-u="${u.id}" aria-label="Удалить пользователя" title="Удалить пользователя">${ic('trash')}</button><button type="button" class="ia" data-x aria-label="Закрыть">${ic('x')}</button></div>
    </header>
    <div class="user-overview-band">
      <div class="user-usage-line"><span>Трафик</span><strong>${gb(u.used)}</strong><small>${u.limit?'из '+u.limit+' ГБ':'без лимита'}</small><button type="button" class="user-action-text" data-a="rst" data-u="${u.id}" title="Обнулить использованный трафик">${ic('redo')} Сбросить</button></div>
      ${u.limit?`<div class="user-usage-track" style="--usage:${Math.min(100,Math.max(0,usageRatio*100))}%" role="progressbar" aria-label="Использование трафика" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100,Math.max(0,usageRatio*100)))}"><i></i></div>`:''}
      <div class="user-identity-row"><span>Xray ID</span><code title="${esc(u.xrayId)}">${esc(u.xrayId)}</code><button type="button" class="user-id-copy" data-copy-xray-id="${u.id}" aria-label="Копировать Xray ID" title="Копировать Xray ID">${ic('copy')}</button></div>
    </div>
    <div class="user-canvas-grid">
      <section class="user-pane user-pane-settings" aria-label="Настройки пользователя">
        <div class="user-pane-heading"><div><h3>Настройки</h3><p>Все поля доступны сразу</p></div></div>
        <form data-k="uedit" data-id="${u.id}" method="dialog" class="user-inline-editor">
          <div class="user-edit-fields">
            ${field(FE[0],u.username)}
            ${field(FE[1],u.fingerprint)}
            ${field(FE[2],u.limit)}
            ${userDateField(u)}
            ${field(FE[4],u.strategy)}
            ${FE.slice(5).map(f=>field(f,u[f.k])).join('')}
          </div>
          <p class="er" id="fe" role="status"></p>
          <div class="user-editor-actions"><button type="submit" class="btn user-save-button">${ic('check')} Сохранить изменения</button></div>
        </form>
      </section>
      <section class="user-pane user-pane-access" aria-label="Доступ и подписка">
        <div class="user-pane-heading"><div><h3>Доступ</h3><p>Сквады и подключение</p></div></div>
        <div class="user-section-label">Сквады</div>
        <div class="user-squad-options">${squadMarkup}</div>
        <div class="user-section-label">Inbound</div>
        <div class="user-access-tags">${inboundMarkup}</div>
        <div class="user-section-label">Серверы</div>
        <div class="user-host-list">${hostMarkup}</div>
        <div class="user-dev-limit"><label class="f"><span>Лимит устройств</span><input type="number" min="0" value="${u.hwid}" data-hw="${u.id}" aria-label="Лимит устройств"></label></div>
        <div class="user-section-divider"></div>
        <div class="user-pane-heading user-sub-heading"><div><h3>Подписка</h3></div></div>
        <p class="user-sub-note">Сервис подписок будет отдельным компонентом. Оформление и размещение настраиваются в SUBSCRIPTION STUDIO.</p>
        <a class="user-inline-link" href="#subscription" data-x>${ic('globe')} SUBSCRIPTION STUDIO</a>
      </section>
      <section class="user-pane user-pane-insights" aria-label="Статистика и устройства">
        <div class="user-pane-heading"><div><h3>По серверам</h3><p>Персональный трафик Xray</p></div><button type="button" class="ia user-stats-refresh" data-user-traffic-refresh="${u.id}" title="Обновить статистику" aria-label="Обновить статистику">${ic('redo')}</button></div>
        <div class="user-traffic-stats" data-user-traffic-id="${u.id}" role="status" aria-live="polite"><span class="user-canvas-muted">Загружаем данные…</span></div>
        <div class="user-section-divider"></div>
        <div class="user-pane-heading"><div><h3>Устройства</h3><p>${u.devices.length} / ${u.hwid||'без лимита'}</p></div></div>
        <div class="user-devices">${devices}</div>
        ${u.hwid>0&&u.devices.length>u.hwid?`<p class="er">Количество устройств превышает лимит (${u.hwid}).</p>`:''}
      </section>
    </div>
    <footer class="user-canvas-foot"><span>Создан ${new Date(u.created).toLocaleDateString('ru-RU')}</span><span>Администратор: ${esc(DB.admins.find(a=>a.id==u.adminId)?.username||'—')}</span></footer>
  </div>`,'user-modal');
  void loadUserTrafficStats(u.id);
}
function userNew(){
  if(!DB.squads.length){modal(`<div class="box"><h2>Сначала создайте сквад</h2><p class="note">Пользователю нужно назначить группу доступа. Создайте сквад, а затем вернитесь к созданию пользователя.</p><div class="act"><button class="gh" data-x>Отмена</button><button class="btn" data-ne="squads">${ic('plus')}Создать сквад</button></div></div>`);return}
  const fs=FU;modal(`<form class="box" data-k="user" method="dialog"><h2>Новый пользователь</h2><label class="f"><span>Шаблон</span><select id="tplsel"><option value="">Без шаблона</option>${DB.tpls.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><small>При необходимости подставит параметры из сохранённого шаблона</small></label>${fs.map(f=>field(f,{limit:0,days:0,strategy:'NO_RESET',hwid:0,squads:[]}[f.k])).join('')}<p class="er" id="fe"></p><div class="act"><button type="button" class="gh" data-x>Отмена</button><button class="btn">Создать</button></div></form>`,'wide');
  setTimeout(()=>$('[name=username]')?.focus(),60);
}
function exportCsv(){const rows=[['username','status','used_gb','limit_gb','expire','tag','telegram','email','squads','sub_url']].concat(UIDS.map(id=>DB.users.find(u=>u.id==id)).map(u=>[u.username,st(u),u.used,u.limit,u.expireAt?new Date(u.expireAt).toISOString().slice(0,10):'',u.tag,u.tg,u.email,u.squads.map(i=>DB.squads.find(s=>s.id==i)?.name).join('|'),subUrl(u)]));
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')],{type:'text/csv'}));a.download='users.csv';a.click();toast(`Экспортировано: ${UIDS.length}`)}

/* ================= XRAY STUDIO: PROTOCOLS, TRANSPORTS & FINGERPRINTS ================= */
const XRAY_FP_RECOMMENDED=["chrome","firefox","safari","ios","android","edge","360","qq","random","randomized","randomizednoalpn","unsafe"];
const XRAY_FP_MODERN=["hellofirefox_120","hellofirefox_148","hellochrome_120","hellochrome_131","hellochrome_133","helloios_13","helloios_14","helloedge_106","hellosafari_26_3","hello360_11_0","helloqq_11_1"];
const XRAY_FP_OTHER=["hellogolang","hellorandomized","hellorandomizedalpn","hellorandomizednoalpn","hellofirefox_auto","hellofirefox_55","hellofirefox_56","hellofirefox_63","hellofirefox_65","hellofirefox_99","hellofirefox_102","hellofirefox_105","hellochrome_auto","hellochrome_58","hellochrome_62","hellochrome_70","hellochrome_72","hellochrome_83","hellochrome_87","hellochrome_96","hellochrome_100","hellochrome_102","hellochrome_106_shuffle","helloios_auto","helloios_11_1","helloios_12_1","helloandroid_11_okhttp","helloedge_85","helloedge_auto","hellosafari_16_0","hellosafari_auto","hello360_auto","hello360_7_5","helloqq_auto","hellochrome_100_psk","hellochrome_112_psk_shuf","hellochrome_114_padding_psk_shuf","hellochrome_115_pq","hellochrome_115_pq_psk","hellochrome_120_pq"];
const XRAY_FP=[...XRAY_FP_RECOMMENDED,...XRAY_FP_MODERN,...XRAY_FP_OTHER];
const XRAY_PROTOCOLS=[['vless','VLESS'],['vmess','VMess'],['trojan','Trojan'],['shadowsocks','Shadowsocks'],['socks','SOCKS'],['mixed','Mixed (SOCKS + HTTP)'],['http','HTTP proxy'],['dokodemo-door','Dokodemo-door'],['tunnel','Tunnel (alias)'],['wireguard','WireGuard'],['hysteria','Hysteria 2'],['tun','TUN interface'],['masque','MASQUE']];
const XRAY_NETWORKS=[['raw','RAW / TCP'],['xhttp','XHTTP'],['websocket','WebSocket'],['grpc','gRPC'],['httpupgrade','HTTPUpgrade'],['mkcp','mKCP'],['hysteria','Hysteria transport'],['masque','MASQUE transport'],['xdrive','XDrive · VLESS Encryption + Mux']];
/* Visual editor capability matrix: unsupported choices must never survive a
   protocol/transport switch. The JSON serializers remain the source of truth. */
const XRAY_TRANSPORT_SUPPORT={
 vless:['raw','xhttp','websocket','grpc','httpupgrade','mkcp','xdrive'],
 vmess:['raw','xhttp','websocket','grpc','httpupgrade','mkcp'],
 trojan:['raw','xhttp','websocket','grpc','httpupgrade','mkcp'],
 shadowsocks:['raw','websocket','grpc','httpupgrade'],
 socks:['raw'],mixed:['raw'],http:['raw'],
 'dokodemo-door':['raw'],tunnel:['raw'],wireguard:['raw'],tun:['raw'],
 hysteria:['hysteria'],masque:['masque']
};
function xrayAllowedNetworks(protocol){return XRAY_TRANSPORT_SUPPORT[protocol]||['raw']}
function xrayAllowedSecurity(protocol,network){
 if(protocol==='hysteria'||protocol==='masque')return ['tls'];
 if(['wireguard','tun','dokodemo-door','tunnel'].includes(protocol))return ['none'];
 if(['socks','mixed','http'].includes(protocol))return ['none','tls'];
 if(['vless','vmess','trojan'].includes(protocol)&&['raw','xhttp','grpc'].includes(network))return ['none','tls','reality'];
 return ['none','tls'];
}

function validateXDriveTemplate(template){
 if(!template||typeof template!=='object'||Array.isArray(template))throw new Error('XDrive template должен быть JSON-объектом.');
 const missing=['put','get','list','delete'].filter(key=>!template[key]||typeof template[key]!=='object'||typeof template[key].url!=='string'||!template[key].url.trim());
 if(missing.length)throw new Error('XDrive template: укажите URL для операций '+missing.join(', ')+'.');
 const pattern=template.list.namesRegex;
 if(typeof pattern!=='string'||!pattern.trim())throw new Error('XDrive template: list.namesRegex обязателен и должен содержать одну capture group.');
 let re;try{re=new RegExp(pattern)}catch(e){throw new Error('XDrive list.namesRegex невалиден: '+e.message)}
 let captures=0,inClass=false,escaped=false;
 for(let i=0;i<pattern.length;i++){
  const ch=pattern[i];
  if(escaped){escaped=false;continue}
  if(ch==='\\'){escaped=true;continue}
  if(ch==='['){inClass=true;continue}
  if(ch===']'){inClass=false;continue}
  if(ch==='('&&!inClass){
   if(pattern[i+1]!=='?')captures++;
   else if(pattern[i+2]==='<'&&pattern[i+3]!=='='&&pattern[i+3]!=='!')captures++;
  }
 }
 if(captures<1)throw new Error('XDrive list.namesRegex должен содержать хотя бы одну capture group.');
 return template;
}

/* XHTTP transport settings: share validated values across server/client previews. */
function xrayXhttpSettings(path,host,side){
 const v=id=>($('#xpb-xhttp-'+id)?.value||'').trim();
 const extra={xPaddingBytes:($('#xpb-xhttp-padding')?.value||'100-1000').trim()||'100-1000'};
 const range=(field,name)=>{
  const raw=v(field);
  if(!raw)return;
  if(!/^\d+(?:-\d+)?$/.test(raw))throw new Error('XHTTP '+name+': требуется число или диапазон вида 10-50.');
  if(raw.includes('-')){
   const [lo,hi]=raw.split('-').map(Number);
   if(lo>hi||hi>2147483647)throw new Error('XHTTP '+name+': неверный диапазон.');
   return raw;
  }
  if(Number(raw)>2147483647)throw new Error('XHTTP '+name+': число слишком велико.');
  return Number(raw);
 };
 const optional=(field,key,target=extra)=>{const val=v(field);if(val)target[key]=val};
 const bool=(field,key)=>{const val=v(field);if(val==='true'||val==='false')extra[key]=val==='true'};
 const num=(field,key,target=extra)=>{
  const raw=v(field);
  if(!raw)return;
  if(!/^\d+$/.test(raw)||Number(raw)>2147483647)throw new Error('XHTTP '+key+': требуется целое число.');
  target[key]=Number(raw);
 };
 const rng=(field,key,target=extra)=>{const val=range(field,key);if(val!==undefined)target[key]=val};
 bool('padding-obfs','xPaddingObfsMode');
 optional('padding-placement','xPaddingPlacement');
 optional('padding-key','xPaddingKey');
 optional('padding-header','xPaddingHeader');
 optional('padding-method','xPaddingMethod');
 if(side==='server'){
  bool('no-sse','noSSEHeader');
  num('buffered-posts','scMaxBufferedPosts');
  rng('stream-secs','scStreamUpServerSecs');
  num('server-headers','serverMaxHeaderBytes');
 }else{
  optional('uplink-method','uplinkHTTPMethod');
  bool('no-grpc','noGRPCHeader');
  rng('post-bytes','scMaxEachPostBytes');
  rng('post-interval','scMinPostsIntervalMs');
  optional('session-placement','sessionIDPlacement');
  optional('session-key','sessionIDKey');
  optional('seq-placement','seqPlacement');
  optional('seq-key','seqKey');
  optional('data-placement','uplinkDataPlacement');
  optional('data-key','uplinkDataKey');
  rng('chunk-size','uplinkChunkSize');
  rng('session-length','sessionIDLength');
  optional('session-table','sessionIDTable');
  const xmux={};
  rng('mux-concurrency','maxConcurrency',xmux);
  rng('mux-connections','maxConnections',xmux);
  rng('mux-reuse','cMaxReuseTimes',xmux);
  rng('mux-requests','hMaxRequestTimes',xmux);
  rng('mux-seconds','hMaxReusableSecs',xmux);
  num('mux-keepalive','hKeepAlivePeriod',xmux);
  if(xmux.maxConcurrency!==undefined&&xmux.maxConnections!==undefined){
   const upper=val=>typeof val==='string'?Number(val.split('-')[1]):val;
   if(upper(xmux.maxConcurrency)>0&&upper(xmux.maxConnections)>0)
    throw new Error('XHTTP xmux: maxConcurrency и maxConnections нельзя включать одновременно.');
  }
  if(Object.keys(xmux).length)extra.xmux=xmux;
 }
 const config={path,host,mode:v('mode')||'auto',extra};
 if(side==='client'&&v('headers')){
  let headers;
  try{headers=JSON.parse(v('headers'))}catch{throw new Error('XHTTP headers: введите корректный JSON-объект.')}
  if(!headers||typeof headers!=='object'||Array.isArray(headers)||
     Object.entries(headers).some(([k,val])=>!k||k==='__proto__'||k==='constructor'||typeof val!=='string'))
   throw new Error('XHTTP headers: требуется объект вида {"User-Agent":"Mozilla/5.0"}.');
  config.headers=headers;
 }
 return config;
}

function xrayBuilderConfig(){
 const v=id=>$('#xpb-'+id)?.value||'';
 const protocol=v('protocol')||'vless';
 let network=v('network')||'raw';
 let security=v('security')||'none';
 if(protocol==='masque'){network='masque';security='tls'}
 if(protocol==='hysteria'){network='hysteria';security='tls'}
 if(['tun','wireguard'].includes(protocol))security='none';
 const tag=v('tag').trim()||'inbound-1';
 const port=protocol==='tun'?0:cl(+v('port')||443,1,65535);
 const sni=v('sni').trim();
 const dest=v('dest').trim()||(sni?sni+':443':'example.com:443');
 const path=v('path').trim()||'/';
 const uuid=v('uuid').trim();
 const vlessEncMode=v('vlessenc-mode')||'off';
 const vlessEncRequired=protocol==='vless'&&(network==='xdrive'||vlessEncMode!=='off');
 const clientName=(v('name').trim()||'XMesh client').replace(/[<>"]/g,'').slice(0,64);
 const email=clientName||'xmesh-client';
 const login=(v('name').trim()||'xmesh').toLowerCase().replace(/[^a-z0-9_.-]/g,'-').slice(0,32)||'xmesh';
 const list=value=>String(value||'').split(',').map(x=>x.trim()).filter(Boolean);
 const ssMethod=v('ss-method')||'chacha20-ietf-poly1305';
 const ss2022=ssMethod.startsWith('2022-');
 const ssServerPassword=v('ss-password').trim()||(ss2022?'REPLACE_WITH_VALID_SS2022_SERVER_KEY':'REPLACE_WITH_STRONG_SERVER_PASSWORD');
 const ssUserPassword=v('ss-user-password').trim()||(ss2022?'REPLACE_WITH_VALID_SS2022_USER_KEY':(uuid||'REPLACE_WITH_USER_PASSWORD'));
 const lines=value=>String(value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 let xdriveTemplate;
 if(network==='xdrive'&&v('xdrive-service')==='template'){
  try{xdriveTemplate=validateXDriveTemplate(JSON.parse(v('xdrive-template')||'{}'))}
  catch(e){throw new Error(e.message.startsWith('XDrive')?e.message:'XDrive template должен быть корректным JSON: '+e.message)}
 }
 const settings={
  vless:{users:[],decryption:vlessEncRequired?(v('vless-decryption').trim()||'REPLACE_WITH_VLESS_ENCRYPTION_CONFIG'):'none'},
  vmess:{users:[],default:{alterId:0}},
  trojan:{clients:[]},
  shadowsocks:{network:'tcp,udp',method:ssMethod,...(ss2022||!uuid?{password:ssServerPassword}:{}),...(uuid?{users:[{password:ssUserPassword,...(ss2022?{}:{method:ssMethod}),level:0,email}]}:{})},
  socks:{auth:v('socks-auth')||'noauth',users:(v('socks-auth')==='password'&&uuid)?[{user:login,pass:uuid}]:[],udp:true,ip:'127.0.0.1'},
  mixed:{auth:v('socks-auth')||'noauth',users:(v('socks-auth')==='password'&&uuid)?[{user:login,pass:uuid}]:[],udp:true,ip:'127.0.0.1'},
  http:{users:uuid?[{user:login,pass:uuid}]:[],allowTransparent:false,userLevel:0},
  'dokodemo-door':{address:v('doko-address')||'127.0.0.1',port:cl(+v('doko-port')||53,1,65535),network:v('doko-network')||'tcp,udp',followRedirect:false},
  tunnel:{address:v('doko-address')||'127.0.0.1',port:cl(+v('doko-port')||53,1,65535),network:v('doko-network')||'tcp,udp',followRedirect:false},
  wireguard:{secretKey:v('wg-secret-key').trim()||'REPLACE_WITH_WIREGUARD_SERVER_PRIVATE_KEY',address:list(v('wg-address')||'10.0.0.1/32'),peers:v('wg-public-key').trim()?[{publicKey:v('wg-public-key').trim(),...(v('wg-pre-shared-key').trim()?{preSharedKey:v('wg-pre-shared-key').trim()}:{}),keepAlive:cl(+v('wg-keepalive')||0,0,65535),allowedIPs:list(v('wg-allowed-ips')||'0.0.0.0/0,::/0'),email,level:0}]:[],mtu:cl(+v('wg-mtu')||1420,1280,65535)},
  hysteria:{version:2,users:uuid?[{auth:uuid,level:0,email}]:[]},
  tun:{name:v('tun-name')||'',desc:v('tun-desc')||'Wintun',mtu:cl(+v('tun-mtu')||1500,576,9000),gateway:list(v('tun-gateway')),dns:list(v('tun-dns')),userLevel:0,...(list(v('tun-routes')).length?{autoSystemRoutingTable:list(v('tun-routes')),autoOutboundsInterface:'auto'}:{})},
  masque:{users:uuid?[{pass:uuid,level:0,email}]:[],address:list(v('masque-address')||'10.0.0.1/32'),mtu:cl(+v('masque-mtu')||1400,1280,65535)}
 }[protocol]||{};
 if(protocol==='vless'&&security!=='none'&&network==='raw'&&v('flow'))settings.users[0]&& (settings.users[0].flow=v('flow'));
 const inbound={tag,protocol,settings};
 if(protocol!=='tun'){inbound.listen=v('listen')||'0.0.0.0';inbound.port=port}
 if(!['tun','wireguard','dokodemo-door','tunnel'].includes(protocol)){
  const ss={network,security};
  if(network==='websocket')ss.wsSettings={path,headers:v('host')?{Host:v('host')}: {},heartbeatPeriod:0};
  if(network==='xhttp')ss.xhttpSettings=xrayXhttpSettings(path,v('host'),'server');
  if(network==='grpc')ss.grpcSettings={serviceName:path.replace(/^\//,'')||'grpc',multiMode:v('grpc-mode')==='multi'};
  if(network==='httpupgrade')ss.httpupgradeSettings={path,host:v('host')};
  if(network==='mkcp')ss.kcpSettings={mtu:1350,tti:20,uplinkCapacity:5,downlinkCapacity:20,congestion:false,readBufferSize:2,writeBufferSize:2,seed:v('kcp-seed')||''};
  if(network==='raw')ss.rawSettings={header:v('raw-header')==='http'?{type:'http',request:{version:'1.1',method:'GET',path:[path],headers:{Host:[v('host')||sni||'example.com'],'User-Agent':['Mozilla/5.0'],'Accept-Encoding':['gzip, deflate'],'Connection':['keep-alive']}}}:{type:'none'}};
  if(network==='hysteria')ss.hysteriaSettings={version:2,auth:v('hy-auth').trim()||(protocol==='hysteria'?'':uuid),udpIdleTimeout:cl(+v('hy-idle')||60,2,600),masquerade:{type:v('hy-masq-type')||'',...(v('hy-masq-dir').trim()?{dir:v('hy-masq-dir').trim()}:{}),...(v('hy-masq-url').trim()?{url:v('hy-masq-url').trim()}:{}),...(v('hy-masq-content').trim()?{content:v('hy-masq-content').trim()}:{}),...(v('hy-masq-type')==='string'?{statusCode:cl(+v('hy-masq-status')||200,100,599)}:{})}};
  if(network==='masque')ss.masqueSettings={host:v('masque-host').trim()||sni||'example.com',path:v('masque-path').trim()||'/masque',...(v('masque-user').trim()?{user:v('masque-user').trim()}:{}),...(v('masque-pass').trim()?{pass:v('masque-pass').trim()}:{}),headers:{}};
  if(network==='xdrive'){
   const service=v('xdrive-service')||'local',secrets=lines(v('xdrive-secrets'));
   if(service==='google-drive'&&secrets.length!==3)throw new Error('XDrive Google Drive требует ровно 3 секрета: Client ID, Client Secret и Refresh Token, каждый с новой строки.');
   if(service==='template'&&!xdriveTemplate)throw new Error('XDrive template требует корректный JSON-объект.');
   ss.xdriveSettings={remoteFolder:v('xdrive-folder').trim()||'/var/lib/xray/xdrive',service,secrets,
    ...(v('xdrive-segment-bytes')?{segmentBytes:cl(+v('xdrive-segment-bytes')||0,0,67108864)}:{}),
    ...(v('xdrive-flush-ms')?{flushIntervalMs:cl(+v('xdrive-flush-ms')||0,0,600000)}:{}),
    ...(v('xdrive-poll-ms')?{pollIntervalMs:cl(+v('xdrive-poll-ms')||0,0,600000)}:{}),
    ...(v('xdrive-max-poll-ms')?{maxPollIntervalMs:cl(+v('xdrive-max-poll-ms')||0,0,600000)}:{}),
    ...(v('xdrive-session-ttl')?{sessionTtlSeconds:cl(+v('xdrive-session-ttl')||0,0,86400)}:{}),
    ...(v('xdrive-concurrency')?{concurrency:cl(+v('xdrive-concurrency')||0,0,1024)}:{}),
    ...(v('xdrive-eager-ms')?{eagerWindowMs:cl(+v('xdrive-eager-ms')||0,0,600000)}:{}),
    ...(v('xdrive-hole-ms')?{holeTimeoutMs:cl(+v('xdrive-hole-ms')||0,0,600000)}:{}),
    ...(service==='template'?{template:xdriveTemplate}:{})};
  }
  if(security==='tls')ss.tlsSettings={serverName:sni||undefined,alpn:v('alpn').split(',').map(x=>x.trim()).filter(Boolean),minVersion:v('tls-min')||'1.2',maxVersion:v('tls-max')||'1.3',certificates:[{certificateFile:v('cert')||'/etc/ssl/xray/fullchain.pem',keyFile:v('key')||'/etc/ssl/xray/privkey.pem'}]};
  if(security==='reality')ss.realitySettings={show:false,target:dest,xver:cl(+v('xver')||0,0,2),serverNames:sni?[sni]:[],privateKey:v('private-key')||'REPLACE_WITH_XRAY_PRIVATE_KEY',shortIds:[(v('short-id')||'').replace(/[^a-fA-F0-9]/g,'').slice(0,16)]};
  inbound.streamSettings=ss;
 }
 return {log:{loglevel:v('loglevel')||'warning'},inbounds:[inbound],outbounds:[{protocol:'freedom',tag:'direct'},{protocol:'blackhole',tag:'blocked'}],routing:{rules:[{type:'field',outboundTag:'direct',inboundTag:[tag]}]}};
}
async function syncXrayUserToProfile(user){
 const profile=DB.profiles.find(p=>String(p.id)===String(user.xrayProfileId));
 if(!profile)throw new Error('Выбранный Xray-профиль не найден.');
 const config=typeof profile.config==='string'?JSON.parse(profile.config):structuredClone(profile.config||{});
 if(!Array.isArray(config.inbounds))throw new Error('В профиле отсутствует массив inbounds.');
 let changed=0,skipped=[];
 for(const inbound of config.inbounds){
  inbound.settings=inbound.settings||{};
  const email=String(user.username||'xmesh-user').replace(/[<>"]/g,'').slice(0,64);
  const login=String(user.username||'xmesh').toLowerCase().replace(/[^a-z0-9_.-]/g,'-').slice(0,32)||'xmesh';
  if(inbound.protocol==='vless'){
   const list=inbound.settings.users||(inbound.settings.users=[]);
   if(Array.isArray(inbound.settings.clients)){for(const legacy of inbound.settings.clients){if(legacy.id&&!list.some(x=>x.id===legacy.id))list.push({...legacy})}delete inbound.settings.clients}
   const flow=inbound.settings.flow||(((inbound.streamSettings?.method||inbound.streamSettings?.network)==='raw'&&['reality','tls'].includes(inbound.streamSettings?.security))?'xtls-rprx-vision':'');
   if(!list.some(x=>x.id===user.xrayId))list.push({id:user.xrayId,level:0,email,...(flow?{flow}:{})});
   changed++;
  }else if(inbound.protocol==='vmess'){
   const list=inbound.settings.users||(inbound.settings.users=[]);
   if(Array.isArray(inbound.settings.clients)){for(const legacy of inbound.settings.clients){if(legacy.id&&!list.some(x=>x.id===legacy.id))list.push({...legacy})}delete inbound.settings.clients}
   if(!list.some(x=>x.id===user.xrayId))list.push({id:user.xrayId,level:0,email,alterId:0});
   changed++;
  }else if(inbound.protocol==='trojan'){
   const list=inbound.settings.clients||(inbound.settings.clients=[]);
   if(!list.some(x=>x.password===user.xrayId))list.push({password:user.xrayId,email,level:0});
   changed++;
  }else if(inbound.protocol==='http'){
   const list=inbound.settings.users||(inbound.settings.users=[]);
   if(!list.some(x=>x.pass===user.xrayId||x.user===login))list.push({user:login,pass:user.xrayId});
   changed++;
  }else if(inbound.protocol==='socks'||inbound.protocol==='mixed'){
   inbound.settings.auth='password';
   const list=inbound.settings.users||(inbound.settings.users=[]);
   if(!list.some(x=>x.pass===user.xrayId||x.user===login))list.push({user:login,pass:user.xrayId});
   changed++;
  }else if(inbound.protocol==='hysteria'){
   inbound.settings.version=2;
   const list=inbound.settings.users||(inbound.settings.users=[]);
   if(!list.some(x=>x.auth===user.xrayId||x.email===email))list.push({auth:user.xrayId,level:0,email});
   changed++;
  }else if(inbound.protocol==='masque'){
   const list=inbound.settings.users||(inbound.settings.users=[]);
   if(!list.some(x=>x.pass===user.xrayId||x.email===email))list.push({pass:user.xrayId,level:0,email});
   changed++;
  }else if(inbound.protocol==='shadowsocks'){
   const method=String(inbound.settings.method||'chacha20-ietf-poly1305');
   if(method.startsWith('2022-')){skipped.push(inbound.tag||'Shadowsocks 2022');continue}
   const list=inbound.settings.users||(inbound.settings.users=[]);
   if(!list.some(x=>x.password===user.xrayId||x.email===email))list.push({password:user.xrayId,method,level:0,email});
   changed++;
  }
 }
 if(!changed){
  if(skipped.length)throw new Error('Для автоматического подключения к Shadowsocks 2022 нужна отдельная PSK для каждого пользователя. Используйте JSON-редактор и задайте валидный ключ.');
  throw new Error('В профиле нет подходящих inbound для автоматической учётной записи.');
 }
 await api.update('profiles',profile.id,{name:profile.name,config:JSON.stringify(config,null,2)});
 profile.config=JSON.stringify(config,null,2);
 if(skipped.length)toast('Не добавлен автоматически: '+skipped.join(', ')+'. Для SS2022 нужна отдельная PSK.','ОК');
 return changed;
}
async function removeXrayUserFromProfiles(user){
 if(!user?.xrayId)return;
 const email=String(user.username||'').replace(/[<>"]/g,'').slice(0,64);
 for(const profile of DB.profiles){
  try{
   const config=typeof profile.config==='string'?JSON.parse(profile.config):structuredClone(profile.config||{});
   let changed=false;
   for(const inbound of config.inbounds||[]){
    const settings=inbound.settings||{};
    for(const key of ['users','clients']){
     if(Array.isArray(settings[key])){
      const filtered=settings[key].filter(c=>c.id!==user.xrayId&&c.password!==user.xrayId&&c.pass!==user.xrayId&&c.auth!==user.xrayId&&(!email||c.email!==email));
      if(filtered.length!==settings[key].length){settings[key]=filtered;changed=true}
     }
    }
   }
   if(changed){await api.update('profiles',profile.id,{name:profile.name,config:JSON.stringify(config,null,2)});profile.config=JSON.stringify(config,null,2)}
  }catch(err){console.warn('Could not detach Xray credential from profile',profile.name,err)}
 }
}
function xrayClientSample(){
 const v=id=>$('#xpb-'+id)?.value||'';
 const protocol=v('protocol')||'vless';
 const network=protocol==='hysteria'?'hysteria':protocol==='masque'?'masque':v('network')||'raw';
 const security=['tun','wireguard'].includes(protocol)?'none':['hysteria','masque'].includes(protocol)?'tls':v('security')||'none';
 const sni=v('sni').trim()||'example.com';
 const address=v('server-address').trim()||'SERVER_ADDRESS';
 const port=protocol==='tun'?0:cl(+v('port')||443,1,65535);
 const path=v('path')||'/';
 const host=v('host')||sni;
 const uuid=v('uuid')||'REPLACE_WITH_USER_UUID';
 const flow=protocol==='vless'&&['tls','reality'].includes(security)&&network==='raw'?v('flow'):'';
 const vlessEncMode=v('vlessenc-mode')||'off';
 const vlessEncRequired=protocol==='vless'&&(network==='xdrive'||vlessEncMode!=='off');
 let outProtocol=protocol,settings;
 if(['dokodemo-door','tunnel','tun'].includes(protocol))return {remarks:$('#xpb-name')?.value.trim()||'XRAY STUDIO client',note:'Для этого inbound нет прямого одноимённого клиентского outbound. Используйте совместимый клиентский протокол или полный JSON-режим.',outbounds:[]};
 if(protocol==='vless')settings={vnext:[{address,port,users:[{id:uuid,encryption:vlessEncRequired?(v('vless-encryption').trim()||'REPLACE_WITH_VLESS_ENCRYPTION_CONFIG'):'none',...(flow?{flow}:{})}]}]};
 else if(protocol==='vmess')settings={vnext:[{address,port,users:[{id:uuid,alterId:0,security:v('vmess-security')||'auto'}]}]};
 else if(protocol==='trojan')settings={servers:[{address,port,password:uuid}]};
 else if(protocol==='shadowsocks'){
  const method=v('ss-method')||'chacha20-ietf-poly1305';
  const serverPassword=v('ss-password')||(method.startsWith('2022-')?'REPLACE_WITH_VALID_SS2022_SERVER_KEY':'REPLACE_WITH_STRONG_SERVER_PASSWORD');
  const userPassword=v('ss-user-password')||(method.startsWith('2022-')?'REPLACE_WITH_VALID_SS2022_USER_KEY':uuid);
  const multiUser=Boolean(uuid)&&!(method==='2022-blake3-chacha20-poly1305');
  const password=method.startsWith('2022-')?(multiUser?serverPassword+':'+userPassword:serverPassword):(multiUser?userPassword:serverPassword);
  settings={servers:[{address,port,method,password}]};
 }else if(protocol==='socks'||protocol==='mixed')settings={servers:[{address,port,...(v('socks-auth')==='password'?{users:[{user:(v('name')||'xmesh').toLowerCase().replace(/[^a-z0-9_.-]/g,'-'),pass:uuid}]}:{})}]};
 else if(protocol==='http')settings={servers:[{address,port,...(uuid?{users:[{user:(v('name')||'xmesh').toLowerCase().replace(/[^a-z0-9_.-]/g,'-'),pass:uuid}]}:{})}]};
 else if(protocol==='wireguard')settings={secretKey:'REPLACE_WITH_CLIENT_PRIVATE_KEY',address:['10.0.0.2/32'],peers:[{endpoint:address+':'+port,publicKey:'REPLACE_WITH_SERVER_PUBLIC_KEY',allowedIPs:['0.0.0.0/0','::/0']}]};
 else if(protocol==='hysteria')settings={version:2,address,port};
 else if(protocol==='masque')settings={address,port,remoteDNS:['1.1.1.1','8.8.8.8']};
 else settings={};
 if(protocol==='mixed')outProtocol='socks';
 const streamSettings={network,security};
 if(network==='websocket')streamSettings.wsSettings={path,headers:host?{Host:host}:{}};
 if(network==='raw')streamSettings.rawSettings={header:v('raw-header')==='http'?{type:'http',request:{version:'1.1',method:'GET',path:[path],headers:{Host:[v('host')||sni||'example.com'],'User-Agent':['Mozilla/5.0'],'Accept-Encoding':['gzip, deflate'],'Connection':['keep-alive']}}}:{type:'none'}};
 if(network==='xhttp')streamSettings.xhttpSettings=xrayXhttpSettings(path,host,'client');
 if(network==='grpc')streamSettings.grpcSettings={serviceName:path.replace(/^\//,'')||'grpc',multiMode:v('grpc-mode')==='multi'};
 if(network==='httpupgrade')streamSettings.httpupgradeSettings={path,host};
 if(network==='mkcp')streamSettings.kcpSettings={seed:v('kcp-seed')||''};
 if(network==='hysteria')streamSettings.hysteriaSettings={version:2,auth:v('hy-auth')||uuid,udpIdleTimeout:cl(+v('hy-idle')||60,2,600)};
 if(network==='masque')streamSettings.masqueSettings={host:v('masque-host')||sni,path:v('masque-path')||'/masque',...(v('masque-user')?{user:v('masque-user')}:{}),...(v('masque-pass')?{pass:v('masque-pass')}:{})};
 if(network==='xdrive'){
  const service=v('xdrive-service')||'local',secrets=String(v('xdrive-secrets')||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  let template;if(service==='template'){try{template=JSON.parse(v('xdrive-template')||'{}')}catch(e){template={}}}
  streamSettings.xdriveSettings={remoteFolder:v('xdrive-folder')||'/var/lib/xray/xdrive',service,secrets,
   ...(v('xdrive-segment-bytes')?{segmentBytes:cl(+v('xdrive-segment-bytes')||0,0,67108864)}:{}),
   ...(v('xdrive-flush-ms')?{flushIntervalMs:cl(+v('xdrive-flush-ms')||0,0,600000)}:{}),
   ...(v('xdrive-poll-ms')?{pollIntervalMs:cl(+v('xdrive-poll-ms')||0,0,600000)}:{}),
   ...(v('xdrive-max-poll-ms')?{maxPollIntervalMs:cl(+v('xdrive-max-poll-ms')||0,0,600000)}:{}),
   ...(v('xdrive-session-ttl')?{sessionTtlSeconds:cl(+v('xdrive-session-ttl')||0,0,86400)}:{}),
   ...(v('xdrive-concurrency')?{concurrency:cl(+v('xdrive-concurrency')||0,0,1024)}:{}),
   ...(v('xdrive-eager-ms')?{eagerWindowMs:cl(+v('xdrive-eager-ms')||0,0,600000)}:{}),
   ...(v('xdrive-hole-ms')?{holeTimeoutMs:cl(+v('xdrive-hole-ms')||0,0,600000)}:{}),
   ...(service==='template'&&template?{template}:{})};
 }
 if(security==='tls')streamSettings.tlsSettings={serverName:sni,alpn:v('alpn').split(',').map(x=>x.trim()).filter(Boolean),fingerprint:v('fingerprint')||'chrome'};
 if(security==='reality')streamSettings.realitySettings={serverName:sni,fingerprint:v('fingerprint')||'chrome',publicKey:v('public-key')||'REPLACE_WITH_REALITY_PUBLIC_KEY',shortId:v('short-id')||'REPLACE_SHORT_ID',spiderX:v('spider-x')||'/'};
 const outbound={tag:'proxy',protocol:outProtocol,settings};
 if(!['wireguard'].includes(protocol))outbound.streamSettings=streamSettings;
 if(network==='xdrive')outbound.mux={enabled:true,concurrency:cl(+v('xdrive-mux-concurrency')||8,1,1024)};
 return {
  remarks:$('#xpb-name')?.value.trim()||'XRAY STUDIO client',
  dns:{queryStrategy:'UseIPv4',servers:['1.1.1.1']},
  inbounds:[
   {listen:'127.0.0.1',port:10808,protocol:'socks',settings:{auth:'noauth',udp:true},sniffing:{enabled:true,destOverride:['http','tls','quic']},tag:'socks'},
   {listen:'127.0.0.1',port:10809,protocol:'http',settings:{},sniffing:{enabled:true,destOverride:['http','tls','quic']},tag:'http'}
  ],
  outbounds:[outbound,{tag:'direct',protocol:'freedom'},{tag:'block',protocol:'blackhole'}],
  routing:{domainStrategy:'AsIs',rules:[]}
 };
}
async function generateRealityKeyPair(){
 if(!globalThis.crypto?.subtle)throw new Error('Генерация ключей недоступна в этом браузере. Откройте панель по HTTPS.');
 try{
  const pair=await crypto.subtle.generateKey({name:'X25519'},true,['deriveBits']);
  const pub=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
  const der=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
  const priv=der.slice(-32);
  const enc=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return {privateKey:enc(priv),publicKey:enc(pub)};
 }catch(e){throw new Error('Браузер не поддерживает X25519 WebCrypto. Сгенерируйте пару командой xray x25519 на сервере.')};
}
function randomShortId(){const b=new Uint8Array(8);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}
function randomBase64(size){const b=new Uint8Array(size);crypto.getRandomValues(b);return btoa(Array.from(b,x=>String.fromCharCode(x)).join(''))}
async function profilesP(){
 const saved=await crudCard('profiles');
 const options=(items,selected)=>items.map(x=>'<option value="'+x[0]+'"'+(x[0]===selected?' selected':'')+'>'+x[1]+'</option>').join('');
 const field=(id,label,control,help)=>'<label class="f"><span>'+label+'</span>'+control+(help?'<small>'+help+'</small>':'')+'</label>';
 const inp=(id,value,placeholder,extra)=>'<input id="xpb-'+id+'" value="'+(value||'')+'" placeholder="'+(placeholder||'')+'" '+(extra||'')+'>';
 const sel=(id,items)=>'<select id="xpb-'+id+'">'+options(items)+'</select>';
 const group=(title,desc,body,_legacy,compact=false)=>'<section class="xray-section'+(compact?' xray-section-compact':'')+'">'+(compact?'':'<header class="xray-section-heading"><div><b>'+title+'</b><small>'+desc+'</small></div></header>')+'<div class="xray-section-body">'+body+'</div></section>';
 const optionGroup=(key,title,desc,body)=>'<section class="xray-option-group" data-xray-option-group="'+key+'"><div class="xray-option-group-head"><div><b>'+title+'</b><small>'+desc+'</small></div></div><div class="xray-option-grid">'+body+'</div></section>';
 /* Studio owns its layout; never apply .card (GLASS injects square overlays). */
 const builderHtml='<section class="xray-builder"><div class="xray-hero"><div class="xray-heading-copy"><p class="note">XRAY-CORE / ПРОФИЛЬ INBOUND</p><h2>Конструктор подключения</h2><p class="xray-hero-description">Настройте inbound — конфигурации сервера и клиента обновятся автоматически.</p></div></div>'+
 '<div class="xray-presets"><div class="xray-preset-row" role="group" aria-label="Режим настройки"><button type="button" class="xray-preset on" data-xray-mode="visual" aria-pressed="true">' + ic('sliders') + '<b>Конструктор</b></button><button type="button" class="xray-preset" data-xray-mode="custom" aria-pressed="false">' + ic('code') + '<b>Ручной JSON</b></button></div><button type="button" class="xray-import-btn" id="xpb-import-trigger">' + ic('upload') + 'Импорт JSON</button><input type="file" id="xpb-import-file" accept=".json,application/json,text/json" aria-label="Выбрать файл JSON" hidden></div>'+
 '<div class="xray-meta-grid">'+
 field('name','Название профиля',inp('name','VLESS Reality','Например, DE · Reality','maxlength="80" required'))+
 field('tag','Тег inbound',inp('tag','vless-reality','Уникальный tag','maxlength="64"'))+
 field('server-address','Адрес сервера для Client JSON',inp('server-address','','vpn.example.com или IP','autocomplete="url"'))+
 '</div>'+
 '<div class="xray-workspace-layout"><div class="xray-editor-pane">'+
 '<div id="xpb-visual-mode">'+
 '<div class="xray-config-steps"><nav class="xray-config-tabs" role="tablist" aria-label="Шаги настройки inbound">'+
 '<button type="button" class="on" data-xray-config-tab="basic" role="tab" aria-selected="true" aria-controls="xpb-config-basic">' + ic('server') + '<span>01</span><b>Основное</b></button>'+
 '<button type="button" data-xray-config-tab="security" role="tab" aria-selected="false" aria-controls="xpb-config-security">' + ic('shield') + '<span>02</span><b>Защита</b></button>'+
 '<button type="button" data-xray-config-tab="transport" role="tab" aria-selected="false" aria-controls="xpb-config-transport">' + ic('globe') + '<span>03</span><b>Транспорт</b></button>'+
 '<button type="button" data-xray-config-tab="encryption" role="tab" aria-selected="false" aria-controls="xpb-config-encryption">' + ic('lock') + '<span>04</span><b>VLESS Encryption</b></button>'+
 '<button type="button" data-xray-config-tab="client" role="tab" aria-selected="false" aria-controls="xpb-config-client">' + ic('key') + '<span>05</span><b>Протокол и клиент</b></button>'+
 '</nav><div class="xray-config-content">'+
 '<div class="xray-config-panel" id="xpb-config-basic" data-xray-config-panel="basic">'+
 '<div class="xray-config-panel-title"><div><h3>Основные параметры</h3><p>Выберите протокол inbound, сетевой транспорт, порт и режим TLS/Reality.</p></div><span class="xray-config-required">ОБЯЗАТЕЛЬНОЕ</span></div>'+
 '<div class="xray-main-grid xray-row-2">'+
 field('listen','Адрес прослушивания',inp('listen','0.0.0.0','0.0.0.0'))+
 field('port','Порт inbound',inp('port','443','443','type="number" min="1" max="65535" required'))+
 '</div><div class="xray-main-grid xray-row-3">'+
 field('protocol','Протокол',sel('protocol',XRAY_PROTOCOLS))+
 field('network','Транспорт',sel('network',XRAY_NETWORKS))+
 field('security','Режим защиты',sel('security',[['reality','Reality'],['tls','TLS'],['none','Без TLS / Reality']]))+
 '</div></div>'+
 '<div class="xray-config-panel" id="xpb-config-security" data-xray-config-panel="security" hidden>'+
 '<div class="xray-config-panel-title"><div><h3>Защита соединения</h3><p>Показываются только настройки, совместимые с выбранным режимом.</p></div></div>'+
 group('Настройки Reality','Ключи, Short ID и параметры назначения',
 '<div class="xray-key-actions"><button type="button" class="gh sm" id="xpb-generate-keys">' + ic('key') + 'Сгенерировать пару ключей</button><button type="button" class="gh sm" id="xpb-generate-short">' + ic('redo') + 'Новый Short ID</button></div>'+
 '<div class="xray-key-grid">'+
 field('private-key','Private key · сервер',inp('private-key','','Нажмите «Сгенерировать пару ключей»','autocomplete="off"'))+
 field('public-key','Public key · клиент',inp('public-key','','Заполнится после генерации','autocomplete="off"'))+
 field('short-id','Short ID',inp('short-id','','До 16 hex-символов','maxlength="16" autocapitalize="off"'))+
 field('dest','Целевой адрес (dest)',inp('dest','example.com:443','domain:443'))+
 field('sni','Имя сервера (SNI)',inp('sni','example.com','Домен назначения'))+
 field('spider-x','SpiderX · путь запроса',inp('spider-x','/','/'))+
 field('xver','PROXY protocol · xver',sel('xver',[['0','0 — по умолчанию'],['1','1'],['2','2']]))+
 '</div><p class="note xray-inline-note">Ключи генерируются как X25519 в браузере. Для production проверьте совместимость с вашей версией Xray; приватный ключ остаётся в форме и не отправляется на сервер до сохранения JSON.</p>',true)+
 group('Настройки TLS','Сертификат, ALPN и версия TLS',
 '<div class="xray-main-grid">'+
 field('cert','Путь к TLS-сертификату',inp('cert','/etc/ssl/xray/fullchain.pem','/path/fullchain.pem'))+
 field('key','Путь к приватному ключу TLS',inp('key','/etc/ssl/xray/privkey.pem','/path/privkey.pem'))+
 field('alpn','ALPN',inp('alpn','h2,http/1.1','h2,http/1.1'))+
 field('tls-min','Минимальная версия',sel('tls-min',[['1.2','TLS 1.2'],['1.3','TLS 1.3']]))+
 field('tls-max','Максимальная версия',sel('tls-max',[['1.3','TLS 1.3'],['1.2','TLS 1.2']]))+
 '</div>',false)+
 '</div>'+
 '<div class="xray-config-panel" id="xpb-config-transport" data-xray-config-panel="transport" hidden>'+
 '<div class="xray-config-panel-title"><div><h3>Настройки транспорта</h3><p>Тип сети задаётся в разделе «Основное»; здесь находятся её параметры. Неподходящие поля скрываются автоматически.</p></div></div>'+
 '<p id="xpb-transport-empty" class="xray-transport-empty" hidden>Для этого протокола отдельные параметры сети недоступны. Настройки транспорта отображаются для поддерживаемых протоколов; при необходимости используйте «Ручной JSON».</p>'+
 group('Транспорт','Параметры зависят от выбранной сети',
 optionGroup('transport-shared','Общие настройки','Поля зависят от выбранного транспорта',
 field('host','HTTP Host / authority',inp('host','','Необязательно'))+
 field('path','Путь / имя gRPC-сервиса',inp('path','/','/path или имя gRPC service'))+
 field('xhttp-mode','Режим XHTTP',sel('xhttp-mode',[['auto','auto'],['packet-up','packet-up'],['stream-up','stream-up'],['stream-one','stream-one']]))+
 field('grpc-mode','Режим gRPC',sel('grpc-mode',[['gun','gun'],['multi','multi']]))+
 field('kcp-seed','mKCP seed',inp('kcp-seed','','Необязательно'))+
 field('raw-header','RAW header',sel('raw-header',[['none','Без заголовка'],['http','HTTP camouflage']])))+
 optionGroup('transport-xhttp','XHTTP · расширенные параметры','Общие настройки, клиентский uplink, сервер и соединения xmux',
 '<div class="xray-xhttp-note">Пустые поля используют значения по умолчанию Xray-core. Серверные параметры попадут только в Server JSON, клиентские — только в Client JSON.</div>'+
 field('xhttp-padding','Padding · bytes',inp('xhttp-padding','100-1000','100-1000'),'Диапазон случайного HTTP padding')+
 field('xhttp-padding-obfs','Padding obfuscation',sel('xhttp-padding-obfs',[['','Автоматически'],['true','Включено'],['false','Выключено']]))+
 field('xhttp-padding-placement','Расположение padding',inp('xhttp-padding-placement','','query / header'))+
 field('xhttp-padding-key','Ключ padding',inp('xhttp-padding-key','','x_padding'))+
 field('xhttp-padding-header','Заголовок padding',inp('xhttp-padding-header','','X-Padding'))+
 field('xhttp-padding-method','Метод padding',inp('xhttp-padding-method','','По умолчанию'))+
 '<div class="xray-xhttp-subtitle">Клиент · HTTP uplink</div>'+
 field('xhttp-uplink-method','HTTP method',sel('xhttp-uplink-method',[['','Авто'],['POST','POST'],['GET','GET'],['PUT','PUT']]))+
 field('xhttp-no-grpc','Без gRPC header',sel('xhttp-no-grpc',[['','Авто'],['true','Да'],['false','Нет']]))+
 field('xhttp-post-bytes','Максимум bytes / POST',inp('xhttp-post-bytes','','131072-524288'),'Только packet-up · клиент')+
 field('xhttp-post-interval','Интервал POST · мс',inp('xhttp-post-interval','','10-50'),'Только packet-up · клиент')+
 field('xhttp-session-placement','Session ID placement',inp('xhttp-session-placement','','query / header'))+
 field('xhttp-session-key','Session ID key',inp('xhttp-session-key','','По умолчанию'))+
 field('xhttp-seq-placement','Sequence placement',inp('xhttp-seq-placement','','query / header'))+
 field('xhttp-seq-key','Sequence key',inp('xhttp-seq-key','','По умолчанию'))+
 field('xhttp-data-placement','Uplink data placement',inp('xhttp-data-placement','','По умолчанию'))+
 field('xhttp-data-key','Uplink data key',inp('xhttp-data-key','','По умолчанию'))+
 field('xhttp-chunk-size','Uplink chunk · bytes',inp('xhttp-chunk-size','','65536-262144'))+
 field('xhttp-session-length','Session ID length',inp('xhttp-session-length','','16-32'))+
 field('xhttp-session-table','Session ID table',inp('xhttp-session-table','','По умолчанию'))+
 field('xhttp-headers','Дополнительные HTTP headers','<textarea id="xpb-xhttp-headers" rows="3" spellcheck="false" placeholder=\'{ "User-Agent": "Mozilla/5.0" }\'></textarea>','JSON-объект строковых HTTP-заголовков')+
 '<div class="xray-xhttp-subtitle">Клиент · xmux</div>'+
 field('xhttp-mux-concurrency','maxConcurrency',inp('xhttp-mux-concurrency','','4-8'),'Не задавайте вместе с maxConnections')+
 field('xhttp-mux-connections','maxConnections',inp('xhttp-mux-connections','','3-6'),'Не задавайте вместе с maxConcurrency')+
 field('xhttp-mux-reuse','cMaxReuseTimes',inp('xhttp-mux-reuse','','64-128'))+
 field('xhttp-mux-requests','hMaxRequestTimes',inp('xhttp-mux-requests','','600-900'))+
 field('xhttp-mux-seconds','hMaxReusableSecs',inp('xhttp-mux-seconds','','1800-3000'))+
 field('xhttp-mux-keepalive','hKeepAlivePeriod',inp('xhttp-mux-keepalive','','0'))+
 '<div class="xray-xhttp-subtitle">Сервер · ограничения приёма</div>'+
 field('xhttp-no-sse','Без SSE header',sel('xhttp-no-sse',[['','Авто'],['true','Да'],['false','Нет']]))+
 field('xhttp-buffered-posts','Буферизованных POST',inp('xhttp-buffered-posts','','30'),'Только сервер · packet-up')+
 field('xhttp-stream-secs','Время stream-up · с',inp('xhttp-stream-secs','','20-80'),'Только сервер · stream-up')+
 field('xhttp-server-headers','Максимум header bytes',inp('xhttp-server-headers','','16384'),'Только сервер')
 )+
 optionGroup('transport-hysteria','Hysteria 2','Учётные данные, тайм-аут и masquerade',
 field('hy-auth','Аутентификация Hysteria',inp('hy-auth','','Обычно UUID пользователя','autocomplete="off"'))+
 field('hy-idle','UDP idle timeout',inp('hy-idle','60','Секунды','type="number" min="2" max="600"'))+
 field('hy-masq-type','Тип masquerade',sel('hy-masq-type',[['','По умолчанию'],['string','Текст'],['file','Каталог файлов'],['proxy','Обратный proxy']]))+
 field('hy-masq-dir','Каталог masquerade',inp('hy-masq-dir','','Путь к каталогу'))+
 field('hy-masq-url','URL masquerade',inp('hy-masq-url','','https://example.com'))+
 field('hy-masq-content','Содержимое masquerade',inp('hy-masq-content','','HTML / текст'))+
 field('hy-masq-status','HTTP status',inp('hy-masq-status','200','100–599','type="number" min="100" max="599"')))+
 optionGroup('transport-masque','MASQUE','Назначение и необязательная Basic Auth',
 field('masque-host','MASQUE · host',inp('masque-host','','Host / domain'))+
 field('masque-path','MASQUE · path',inp('masque-path','/masque','Path'))+
 field('masque-user','Пользователь Basic Auth',inp('masque-user','','Необязательно'))+
 field('masque-pass','Пароль Basic Auth',inp('masque-pass','','Необязательно','autocomplete="off"')))+
 optionGroup('transport-xdrive','XDrive · storage и mux','Хранилище и параметры потока',
 field('xdrive-service','Backend хранилища',sel('xdrive-service',[['local','Local filesystem'],['google-drive','Google Drive'],['template','Custom HTTP template']]))+
 field('xdrive-folder','Папка / remote ID',inp('xdrive-folder','/var/lib/xray/xdrive','Local path or remote folder ID'))+
 field('xdrive-secrets','Секреты интеграции','<textarea id="xpb-xdrive-secrets" rows="3" placeholder="Один секрет на строку"></textarea>')+
 field('xdrive-segment-bytes','Размер сегмента · bytes',inp('xdrive-segment-bytes','','0 = core default','type="number" min="0" max="67108864"'))+
 field('xdrive-flush-ms','Интервал flush · ms',inp('xdrive-flush-ms','','0 = core default','type="number" min="0" max="600000"'))+
 field('xdrive-poll-ms','Интервал poll · ms',inp('xdrive-poll-ms','','0 = core default','type="number" min="0" max="600000"'))+
 field('xdrive-max-poll-ms','Максимальный poll · ms',inp('xdrive-max-poll-ms','','0 = core default','type="number" min="0" max="600000"'))+
 field('xdrive-session-ttl','Session TTL · seconds',inp('xdrive-session-ttl','','0 = core default','type="number" min="0" max="86400"'))+
 field('xdrive-concurrency','Параллельные операции',inp('xdrive-concurrency','','0 = core default','type="number" min="0" max="1024"'))+
 field('xdrive-eager-ms','Eager window · ms',inp('xdrive-eager-ms','','0 = core default','type="number" min="0" max="600000"'))+
 field('xdrive-hole-ms','Hole timeout · ms',inp('xdrive-hole-ms','','0 = core default','type="number" min="0" max="600000"'))+
 field('xdrive-mux-concurrency','Client mux concurrency',inp('xdrive-mux-concurrency','8','1–1024','type="number" min="1" max="1024"'))+
 field('xdrive-template','HTTP template JSON','<textarea id="xpb-xdrive-template" rows="5" spellcheck="false" placeholder="{ }"></textarea>'))
 ,false,true)+
 '</div>'+
 '<div class="xray-config-panel" id="xpb-config-encryption" data-xray-config-panel="encryption" hidden>'+
 '<div class="xray-config-panel-title"><div><h3>VLESS Encryption</h3><p>Дополнительный механизм защиты для VLESS. Не является заменой транспорта.</p></div></div>'+
 group('Пара ключей','Серверный decryption и клиентский encryption',
 '<div class="xray-pq-intro"><b>Сгенерировать согласованную пару через Xray-core</b><span>Используется штатная команда <code>xray vlessenc</code>; панель разбирает её текстовый вывод. Значения показываются только в авторизованной панели и попадут в профиль после сохранения.</span></div>'+
 '<div class="xray-main-grid">'+
 field('vlessenc-mode','Режим VLESS Encryption',sel('vlessenc-mode',[['off','Отключено'],['mlkem768','ML-KEM-768 · постквантовый'],['x25519','X25519 · классический'],['manual','Ручная настройка']]),'Для обычного VLESS без VLESS Encryption выберите «Отключено». XDrive требует включённую функцию.')+
 '</div>'+
 '<div class="xray-key-actions"><button type="button" class="gh sm" id="xpb-generate-vlessenc">' + ic('key') + 'Сгенерировать пару на сервере</button><span class="mu">Xray создаст парные server/client значения в своём официальном формате.</span></div>'+
 '<div class="xray-main-grid">'+
 field('vless-decryption','Сервер · settings.decryption',inp('vless-decryption','','Значение decryption из xray vlessenc','autocomplete="off"'))+
 field('vless-encryption','Клиент · users[0].encryption',inp('vless-encryption','','Парное значение encryption','autocomplete="off"'))+
 '</div><p class="note xray-inline-note">Важно: ML-KEM-768 — не отдельный транспорт и не uTLS fingerprint. Он выбирает постквантовый способ аутентификации в VLESS Encryption. Эфемерный обмен также использует гибрид ML-KEM-768/X25519.</p>',false,true)+
 '</div>'+
 '<div class="xray-config-panel" id="xpb-config-client" data-xray-config-panel="client" hidden>'+
 '<div class="xray-config-panel-title"><div><h3>Протокол и параметры</h3><p>Учётные данные клиента и дополнительные параметры выбранного inbound-протокола.</p></div></div>'+
 group('Параметры протокола и клиента','Учётные данные и дополнительные параметры выбранного протокола',
 optionGroup('client-identity','Идентификация','UUID, fingerprint и режим протокола',
 field('uuid','UUID / credential клиента',inp('uuid','','UUID клиента','autocomplete="off"'))+
 '<div class="xray-field-action"><button type="button" class="gh sm" id="xpb-generate-uuid">' + ic('key') + 'Сгенерировать UUID</button></div>'+
 field('fingerprint','uTLS fingerprint · клиент','<select id="xpb-fingerprint"><optgroup label="Рекомендуемые">'+options(XRAY_FP_RECOMMENDED.map(x=>[x,x]))+'</optgroup><optgroup label="Современные профили">'+options(XRAY_FP_MODERN.map(x=>[x,x]))+'</optgroup><optgroup label="Дополнительные и legacy">'+options(XRAY_FP_OTHER.map(x=>[x,x]))+'</optgroup></select>')+
 field('flow','VLESS flow',sel('flow',[['','Без flow'],['xtls-rprx-vision','xtls-rprx-vision']]))+
 field('vmess-security','VMess cipher',sel('vmess-security',[['auto','auto'],['aes-128-gcm','aes-128-gcm'],['chacha20-poly1305','chacha20-poly1305'],['none','none']])))+
 optionGroup('client-shadowsocks','Shadowsocks','Метод шифрования и отдельные ключи сервера / пользователя',
 field('ss-method','Метод шифрования',sel('ss-method',[['chacha20-ietf-poly1305','chacha20-ietf-poly1305'],['chacha20-poly1305','chacha20-poly1305'],['xchacha20-poly1305','xchacha20-poly1305'],['aes-128-gcm','aes-128-gcm'],['aes-256-gcm','aes-256-gcm'],['2022-blake3-aes-128-gcm','2022-blake3-aes-128-gcm'],['2022-blake3-aes-256-gcm','2022-blake3-aes-256-gcm'],['2022-blake3-chacha20-poly1305','2022-blake3-chacha20-poly1305']]))+
 field('ss-password','Ключ / пароль сервера',inp('ss-password','','Сгенерируйте или введите ключ','autocomplete="off"'))+
 field('ss-user-password','Ключ пользователя',inp('ss-user-password','','SS2022: Base64-ключ','autocomplete="off"'))+
 '<div class="xray-field-action"><button type="button" class="gh sm" id="xpb-generate-ss-password">' + ic('key') + 'Сгенерировать пароли</button></div>')+
 optionGroup('client-local-proxy','SOCKS и Dokodemo-door','Авторизация и адрес локального назначения',
 field('socks-auth','SOCKS authentication',sel('socks-auth',[['noauth','Без авторизации'],['password','Логин / пароль']]))+
 field('doko-address','Адрес назначения',inp('doko-address','127.0.0.1','127.0.0.1'))+
 field('doko-port','Порт назначения',inp('doko-port','53','53','type="number" min="1" max="65535"'))+
 field('doko-network','Сеть назначения',sel('doko-network',[['tcp,udp','TCP + UDP'],['tcp','TCP'],['udp','UDP']])))+
 optionGroup('client-wireguard','WireGuard','Ключи peer, адреса, keepalive и MTU',
 field('wg-secret-key','Private key сервера',inp('wg-secret-key','','Сгенерируйте через xray wg','autocomplete="off"'))+
 field('wg-address','Адрес интерфейса',inp('wg-address','10.0.0.1/32','CIDR, через запятую'))+
 field('wg-public-key','Public key клиента',inp('wg-public-key','','PublicKey из xray wg','autocomplete="off"'))+
 field('wg-pre-shared-key','Pre-shared key',inp('wg-pre-shared-key','','Необязательно','autocomplete="off"'))+
 field('wg-allowed-ips','Allowed IPs',inp('wg-allowed-ips','0.0.0.0/0,::/0','CIDR через запятую'))+
 field('wg-keepalive','Keepalive · seconds',inp('wg-keepalive','0','0 = выключено','type="number" min="0" max="65535"'))+
 field('wg-mtu','MTU',inp('wg-mtu','1420','1280–65535','type="number" min="1280" max="65535"')))+
 optionGroup('client-tun','TUN interface','Имя интерфейса, IP-адреса, DNS и системные маршруты',
 field('tun-name','Имя интерфейса',inp('tun-name','','Пусто — имя выберет ядро'))+
 field('tun-desc','Описание интерфейса',inp('tun-desc','Wintun','Для Windows'))+
 field('tun-mtu','MTU',inp('tun-mtu','1500','576–9000','type="number" min="576" max="9000"'))+
 field('tun-gateway','Gateway',inp('tun-gateway','','CIDR через запятую'))+
 field('tun-dns','DNS',inp('tun-dns','','IP через запятую'))+
 field('tun-routes','Системные маршруты',inp('tun-routes','','Например, 0.0.0.0/0,::/0')))+
 optionGroup('client-logging','Диагностика','Уровень детализации журнала',
 field('loglevel','Уровень логирования',sel('loglevel',[['warning','warning'],['error','error'],['none','none'],['info','info'],['debug','debug']])))
 ,false,true)+ '</div></div></div></div></div><aside class="xray-output-dock">'+
 '<section class="xray-output-workspace" aria-label="JSON-конфигурации">'+
 '<div class="xray-output-workspace-head"><div><p class="note">JSON PREVIEW</p><b>Результат конфигурации</b><small>Server JSON и Client JSON обновляются по мере настройки. Экспорт не применяет конфиг к работающему ядру.</small></div><span class="xray-output-state" id="xpb-output-state">Предпросмотр готов</span></div>'+
 '<div class="xray-output-toolbar">'+
 '<div class="xray-output-tabs" role="tablist" aria-label="Выберите тип JSON">'+
 '<button type="button" id="xpb-tab-server" class="on" role="tab" aria-selected="true" aria-controls="xpb-output-server" data-xray-output="server">' + ic('server') + '<b>Server JSON</b></button>'+
 '<button type="button" id="xpb-tab-client" role="tab" aria-selected="false" aria-controls="xpb-output-client" data-xray-output="client">' + ic('terminal') + '<b>Client JSON</b></button>'+
 '</div>'+
 '<div class="xray-key-actions xray-output-actions" id="xpb-actions-server"><button type="button" class="gh sm" id="xpb-copy" title="Копировать Server JSON" aria-label="Копировать Server JSON">' + ic('copy') + 'Копировать</button><button type="button" class="gh sm" id="xpb-download" title="Скачать server.json" aria-label="Скачать server.json">' + ic('dl') + 'Скачать</button></div>'+
 '<div class="xray-key-actions xray-output-actions" id="xpb-actions-client" hidden><button type="button" class="gh sm" id="xpb-client-copy" title="Копировать Client JSON" aria-label="Копировать Client JSON">' + ic('copy') + 'Копировать</button><button type="button" class="gh sm" id="xpb-client-download" title="Скачать client.json" aria-label="Скачать client.json">' + ic('dl') + 'Скачать</button></div>'+
 '</div>'+
 '<div class="xray-output-pane" id="xpb-output-server" role="tabpanel" aria-labelledby="xpb-tab-server">'+
 '<div class="xray-output-head" id="xpb-server-output" aria-hidden="true"></div>'+
 '<div class="xray-code-view"><pre id="xpb-preview-syntax" class="xray-code-syntax" aria-hidden="true"></pre><textarea id="xpb-preview" class="xray-preview xray-code-input" spellcheck="false" readonly aria-label="Server JSON"></textarea></div>'+
 '<div id="xpb-custom-mode" class="xray-custom-mode" hidden>'+
 '<div class="xray-output-head"><div><b>Полный Server JSON · ручной режим</b><small>Расширенные поля Xray: DNS, policy, API, routing и любые параметры актуального ядра.</small></div><div class="xray-key-actions"><button type="button" class="gh sm" id="xpb-custom-copy">Копировать</button><button type="button" class="gh sm" id="xpb-custom-download">Скачать</button><button type="button" class="gh sm" id="xpb-format-json">Форматировать</button><button type="button" class="gh sm" id="xpb-reset-json">' + ic('redo') + 'Заново из конструктора</button></div></div>'+
 '<div class="xray-code-view xray-custom-code-view"><pre id="xpb-custom-syntax" class="xray-code-syntax" aria-hidden="true"></pre><textarea id="xpb-custom-json" class="xray-preview xray-code-input" spellcheck="false" aria-label="Ручной Server JSON" autocapitalize="off" autocomplete="off" autocorrect="off"></textarea></div>'+
 '<p class="mu" id="xpb-custom-error" role="status">Синтаксис JSON и обязательные поля проверяются перед сохранением.</p></div>'+
 '</div>'+
 '<div class="xray-output-pane" id="xpb-output-client" role="tabpanel" aria-labelledby="xpb-tab-client" hidden>'+
 '<div class="xray-output-head" id="xpb-client-output" aria-hidden="true"></div>'+
 '<p class="xray-client-hint" id="xpb-client-source-note">Это клиентский outbound-конфиг, а не серверный inbound. Если адрес узла, UUID или ключи оставлены как placeholders, замените их перед импортом в приложение.</p>'+
 '<div class="xray-code-view"><pre id="xpb-client-preview-syntax" class="xray-code-syntax" aria-hidden="true"></pre><textarea id="xpb-client-preview" class="xray-preview xray-code-input" spellcheck="false" readonly aria-label="Client JSON"></textarea></div>'+
 '</div></section>'+
 '<div class="xray-footer"><p class="er" id="xpb-error" role="status"></p><button type="button" class="btn" id="xpb-save">Сохранить профиль</button></div></aside></div></section>';
 return [builderHtml+saved,()=>{
  // Studio layout v3: move navigation and actions into their own full-width
  // rows; existing field ids, events, and JSON generation remain unchanged.
  const studioRoot=document.querySelector('.xray-builder');
  if(studioRoot){
    const tabs=studioRoot.querySelector('.xray-config-tabs');
    const layout=studioRoot.querySelector('.xray-workspace-layout');
    const footer=studioRoot.querySelector('.xray-footer');
    if(tabs&&layout)studioRoot.insertBefore(tabs,layout);
    if(footer)studioRoot.appendChild(footer);
    studioRoot.classList.add('studio-v3','studio-inline');
    const context=document.createElement('div');
    context.className='sr-inline-context';
    context.innerHTML='<span class="sr-inline-current" id="xpb-context-selected"></span><span class="sr-inline-hint" id="xpb-context-hint" role="status" aria-live="polite">Настройки обновляются автоматически</span>';
    if(layout)studioRoot.insertBefore(context,layout);
  }
  const renderJsonHighlight=(sourceId,targetId)=>{
   const source=$('#'+sourceId),target=$('#'+targetId);
   if(!source||!target)return;
   const raw=source.value||'';
   const tokenPattern=/"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]/g;
   let html='',last=0;
   for(const match of raw.matchAll(tokenPattern)){
    html+=esc(raw.slice(last,match.index));
    const token=match[0],tail=raw.slice(match.index+token.length).trimStart();
    let kind='punct';
    if(token[0]==='"')kind=tail.startsWith(':')?'key':'string';
    else if(token==='true'||token==='false')kind='boolean';
    else if(token==='null')kind='null';
    else if(/^-?\d/.test(token))kind='number';
    html+='<span class="jx-'+kind+'">'+esc(token)+'</span>';
    last=match.index+token.length;
   }
   target.innerHTML=html+esc(raw.slice(last));
  };
  [['xpb-preview','xpb-preview-syntax'],['xpb-client-preview','xpb-client-preview-syntax']].forEach(([sourceId,targetId])=>{
   const source=$('#'+sourceId),target=$('#'+targetId);
   if(source&&target)source.addEventListener('scroll',()=>{target.scrollTop=source.scrollTop;target.scrollLeft=source.scrollLeft},{passive:true});
  });
  $('#xpb-import-trigger').addEventListener('click',()=>$('#xpb-import-file').click());
  $('#xpb-import-file').addEventListener('change',async event=>{
   const file=event.target.files?.[0];
   if(!file)return;
   try{
    const text=await file.text(),parsed=JSON.parse(text);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!Array.isArray(parsed.inbounds)||!parsed.inbounds.length)throw new Error('Нужен полный Xray JSON с непустым массивом inbounds.');
    customArea.value=JSON.stringify(parsed,null,2);
    customInitialized=true;customDirty=true;
    setMode('custom');validateCustomJson();toast('JSON импортирован в ручной редактор');
   }catch(error){
    const message='Не удалось импортировать JSON: '+(error.message||'неизвестная ошибка');
    $('#xpb-error').textContent=message;toast(message);
   }finally{event.target.value=''}
  });
  const updatePreview=()=>{try{
   const protocol=$('#xpb-protocol').value,network=$('#xpb-network').value,security=$('#xpb-security').value;
   if(security==='reality'&&(!['raw','xhttp','grpc'].includes(network)||!['vless','vmess','trojan'].includes(protocol)))throw new Error('Reality в визуальном конструкторе доступен для VLESS/VMess/Trojan с RAW, XHTTP или gRPC.');
   if((protocol==='hysteria'||network==='hysteria')&&security!=='tls')throw new Error('Транспорт Hysteria требует TLS.');
   if((protocol==='masque'||network==='masque')&&security!=='tls')throw new Error('Транспорт MASQUE требует TLS.');
   if((protocol==='hysteria'&&network!=='hysteria')||(protocol==='masque'&&network!=='masque'))throw new Error('Выберите соответствующий транспорт для выбранного протокола.');
   if(network==='masque'&&protocol!=='masque')throw new Error('Транспорт MASQUE доступен только для inbound MASQUE.');
   if(network==='xdrive'&&protocol!=='vless')throw new Error('XDrive в текущем ядре требует VLESS. Выберите VLESS или используйте полный JSON-режим.');
   if(network==='xdrive'&&$('#xpb-flow').value)throw new Error('XDrive несовместим с VLESS flow. Оставьте flow пустым.');
   let warning='';
   if(security==='reality'){
    const sid=$('#xpb-short-id').value.trim();
    if(!sid||sid.length>16||sid.length%2||!/^[a-fA-F0-9]+$/.test(sid))warning='Reality: задайте Short ID длиной 2–16 hex-символов чётной длины.';
    else if(!$('#xpb-sni').value.trim())warning='Reality: укажите Server name / SNI.';
   }
   if(protocol==='vless'&&security==='none'&&(($('#xpb-vlessenc-mode')?.value||'off')==='off')&&network!=='xdrive')warning='Внимание: у VLESS нет TLS/Reality и VLESS Encryption. Для публичного узла включите один из этих способов защиты.';
   if(protocol==='shadowsocks'&&$('#xpb-ss-method').value==='2022-blake3-chacha20-poly1305'&&$('#xpb-uuid').value.trim())throw new Error('Shadowsocks 2022 ChaCha поддерживает только одного пользователя: очистите UUID или выберите AES-128/AES-256 для нескольких пользователей.');
   if(protocol==='shadowsocks'){const method=$('#xpb-ss-method').value||'chacha20-ietf-poly1305',hasUuid=!!$('#xpb-uuid').value.trim(),hasServerPass=!!$('#xpb-ss-password').value.trim(),hasUserPass=!!$('#xpb-ss-user-password').value.trim();if(method.startsWith('2022-')&&(!hasServerPass||(hasUuid&&!hasUserPass)))warning=hasUuid?'Укажите server key и user key Shadowsocks 2022 (сгенерируйте оба или введите Base64-ключи).':'Укажите серверный Base64-ключ Shadowsocks 2022.';else if(!hasUuid&&!hasServerPass)warning='Для Shadowsocks без отдельного UUID укажите серверный пароль или нажмите «Сгенерировать пароли Shadowsocks».';}
   if(protocol==='wireguard'&&!$('#xpb-wg-secret-key').value.trim())warning='Укажите серверный WireGuard private key (команда xray wg).';
   const pqMode=$('#xpb-vlessenc-mode')?.value||'off';
   if(network==='xdrive'&&pqMode==='off')warning='XDrive требует VLESS Encryption: выберите ML-KEM-768, X25519 или ручную настройку.';
   else if(protocol==='vless'&&(pqMode!=='off'||network==='xdrive')){
    const dec=$('#xpb-vless-decryption').value.trim(),enc=$('#xpb-vless-encryption').value.trim();
    if(!dec||!enc||dec.startsWith('REPLACE_')||enc.startsWith('REPLACE_'))warning=warning||'VLESS Encryption включён, но пара не заполнена. Нажмите «Сгенерировать пару на сервере» или вставьте оба значения вручную.';
   }
   const completenessWarnings=[];
   if(!$('#xpb-server-address').value.trim())completenessWarnings.push('Client JSON: укажите внешний IP-адрес или домен сервера в поле «Адрес узла».');
   if(['vless','vmess','trojan'].includes(protocol)&&!$('#xpb-uuid').value.trim())completenessWarnings.push('Не задан ID/credential клиента. Сгенерируйте UUID внизу конструктора.');
   if(completenessWarnings.length)warning=[warning,...completenessWarnings].filter(Boolean).join(' ');
   $('#xpb-error').textContent=warning;
   const state=$('#xpb-output-state');if(state)state.textContent=warning?'Проверьте предупреждение':'Предпросмотр готов';
   $('#xpb-preview').value=JSON.stringify(xrayBuilderConfig(),null,2);
   $('#xpb-client-preview').value=JSON.stringify(xrayClientSample(),null,2);
   renderJsonHighlight('xpb-preview','xpb-preview-syntax');
   renderJsonHighlight('xpb-client-preview','xpb-client-preview-syntax');
  }catch(e){$('#xpb-preview').value='';$('#xpb-client-preview').value='';renderJsonHighlight('xpb-preview','xpb-preview-syntax');renderJsonHighlight('xpb-client-preview','xpb-client-preview-syntax');$('#xpb-error').textContent=e.message;const state=$('#xpb-output-state');if(state)state.textContent='Ошибка генерации'}};
  const updateVisibility=()=>{
   let proto=$('#xpb-protocol').value,net=$('#xpb-network').value,sec=$('#xpb-security').value;
   const setGroup=(selector,show)=>{const d=$(selector);if(d)d.hidden=!show};
   const force=(id,value)=>{const e=$('#xpb-'+id);if(e&&e.value!==value)e.value=value};

   // Selecting a protocol filters the network list first. Do not leave
   // invisible or disabled options selected after switching protocols.
   const initialNetwork=net,initialSecurity=sec;
   const allowedNetworks=xrayAllowedNetworks(proto);
   const networkSelect=$('#xpb-network');
   if(!allowedNetworks.includes(net)){
    net=allowedNetworks[0];
    force('network',net);
   }
   if(networkSelect){
    const noTransport=['tun','wireguard','dokodemo-door','tunnel'].includes(proto);
    networkSelect.closest('.f').hidden=noTransport;
    networkSelect.disabled=noTransport;
    [...networkSelect.options].forEach(option=>{
     const allowed=allowedNetworks.includes(option.value);
     option.disabled=!allowed;option.hidden=!allowed;
    });
   }
   const securitySelect=$('#xpb-security');
   const allowedSecurity=xrayAllowedSecurity(proto,net);
   if(!allowedSecurity.includes(sec)){
    sec=allowedSecurity.includes('tls')&&sec==='reality'?'tls':allowedSecurity[0];
    force('security',sec);
   }
   if(net==='xdrive'&&$('#xpb-flow')?.value)force('flow','');
   if(securitySelect){
    const disabled=allowedSecurity.length===1;
    securitySelect.disabled=disabled;
    [...securitySelect.options].forEach(option=>{
     const allowed=allowedSecurity.includes(option.value);
     option.disabled=!allowed;option.hidden=!allowed;
    });
   }
   const hint=$('#xpb-context-hint');
   if(hint){
    const changed=[];
    if(initialNetwork!==net)changed.push('транспорт');
    if(initialSecurity!==sec)changed.push('защита');
    hint.textContent=changed.length
     ? 'Несовместимые параметры скорректированы: '+changed.join(' и ')
     : 'Показаны только совместимые настройки';
   }
   const listenField=$('#xpb-listen')?.closest('.f'),portField=$('#xpb-port')?.closest('.f'),securityField=$('#xpb-security')?.closest('.f');
   if(listenField)listenField.hidden=proto==='tun';
   if(portField)portField.hidden=proto==='tun';
   if(securityField)securityField.hidden=['tun','wireguard','dokodemo-door','tunnel'].includes(proto);
   setGroup('.xray-section:has(#xpb-private-key)',sec==='reality');
   setGroup('.xray-section:has(#xpb-cert)',sec==='tls'&&!['tun','wireguard','dokodemo-door','tunnel'].includes(proto));
   const transport=$('.xray-section:has(#xpb-host)');
   if(transport)transport.querySelectorAll('[id^="xpb-"]').forEach(el=>{
    const f=el.id.replace('xpb-',''),wrap=el.closest('.f');if(!wrap)return;
    let show=true;
    if(f.startsWith('xhttp-'))show=net==='xhttp';
    if(['xhttp-post-bytes','xhttp-post-interval','xhttp-buffered-posts'].includes(f))
     show=net==='xhttp'&&['auto','packet-up'].includes($('#xpb-xhttp-mode')?.value||'auto');
    if(f==='xhttp-stream-secs')
     show=net==='xhttp'&&['auto','stream-up'].includes($('#xpb-xhttp-mode')?.value||'auto');
    if(f==='grpc-mode')show=net==='grpc';
    if(f==='kcp-seed')show=net==='mkcp';
    if(f==='raw-header')show=net==='raw';
    if(f==='host')show=['websocket','xhttp','httpupgrade'].includes(net);
    if(f==='path')show=['raw','xhttp','websocket','grpc','httpupgrade'].includes(net);
    if(f.startsWith('xdrive-'))show=net==='xdrive';
    if(f==='xdrive-secrets')show=net==='xdrive'&&$('#xpb-xdrive-service').value!=='local';
    if(f==='xdrive-template')show=net==='xdrive'&&$('#xpb-xdrive-service').value==='template';
    if(f.startsWith('hy-'))show=net==='hysteria';
    if(f==='hy-masq-dir')show=net==='hysteria'&&$('#xpb-hy-masq-type').value==='file';
    if(f==='hy-masq-url')show=net==='hysteria'&&$('#xpb-hy-masq-type').value==='proxy';
    if(['hy-masq-content','hy-masq-status'].includes(f))show=net==='hysteria'&&$('#xpb-hy-masq-type').value==='string';
    if(f.startsWith('masque-'))show=proto==='masque'||net==='masque';
    wrap.hidden=!show;
   });
   setGroup('[data-xray-option-group="transport-xhttp"]',net==='xhttp');
   const uuidAction=$('#xpb-generate-uuid')?.closest('.xray-field-action');
   if(uuidAction)uuidAction.hidden=!['vless','vmess','trojan'].includes(proto);
   const pqGroup=$('.xray-section:has(#xpb-vlessenc-mode)');
   if(pqGroup){
    pqGroup.hidden=proto!=='vless';
    const mode=$('#xpb-vlessenc-mode')?.value||'off';
    const required=proto==='vless'&&(net==='xdrive'||mode!=='off');
    const decryption=$('#xpb-vless-decryption')?.closest('.f');
    const encryption=$('#xpb-vless-encryption')?.closest('.f');
    if(decryption)decryption.hidden=!required;
    if(encryption)encryption.hidden=!required;
   }
   const protoGroup=$('.xray-section:has(#xpb-fingerprint)');
   if(protoGroup)protoGroup.querySelectorAll('[id^="xpb-"]').forEach(el=>{
    const f=el.id.replace('xpb-',''),wrap=el.closest('.f');if(!wrap)return;
    let show=true;
    if(f==='uuid')show=['vless','vmess','trojan'].includes(proto);
    if(f==='fingerprint')show=sec!=='none'&&['vless','vmess','trojan'].includes(proto)&&net!=='masque';
    if(f==='flow')show=proto==='vless'&&net==='raw'&&sec!=='none';
    if(f==='vmess-security')show=proto==='vmess';
    if(['ss-method','ss-password','ss-user-password'].includes(f))show=proto==='shadowsocks';
    if(['socks-auth'].includes(f))show=['socks','mixed'].includes(proto);
    if(f.startsWith('doko-'))show=['dokodemo-door','tunnel'].includes(proto);
    if(f.startsWith('wg-'))show=proto==='wireguard';
    if(f.startsWith('tun-'))show=proto==='tun';
    if(f.startsWith('hy-'))show=net==='hysteria';
    if(f.startsWith('masque-'))show=proto==='masque'||net==='masque';
    wrap.hidden=!show;
   });
   $$('[data-xray-option-group]').forEach(section=>{
    const visibleField=section.querySelector('.f:not([hidden])');
    section.hidden=!visibleField;
   });
   const transportPanel=$('#xpb-config-transport');
   const transportEmpty=$('#xpb-transport-empty');
   const transportUnsupported=['tun','wireguard','dokodemo-door','tunnel'].includes(proto);
   if(transportUnsupported&&transportPanel)$$('[data-xray-option-group]',transportPanel).forEach(section=>section.hidden=true);
   const hasTransportSettings=!transportUnsupported&&transportPanel&&$$('[data-xray-option-group]',transportPanel).some(section=>!section.hidden&&$$('.f',section).some(field=>!field.hidden));
   if(transportEmpty)transportEmpty.hidden=!!hasTransportSettings;
   $$('[data-xray-mode]').forEach(b=>{const active=b.dataset.xrayMode===(customMode?'custom':'visual');b.classList.toggle('on',active);b.setAttribute('aria-pressed',active?'true':'false')});
   syncConfigTabs();
  };
  let customMode=false,customInitialized=false,customDirty=false,generatedVlessPairs=null;
  const selectGeneratedPair=()=>{
   const mode=$('#xpb-vlessenc-mode')?.value||'off';
   if(!generatedVlessPairs||!['x25519','mlkem768'].includes(mode))return;
   const pair=generatedVlessPairs[mode];
   if(!pair||typeof pair.decryption!=='string'||typeof pair.encryption!=='string')return;
   $('#xpb-vless-decryption').value=pair.decryption;
   $('#xpb-vless-encryption').value=pair.encryption;
  };
  $('#xpb-vlessenc-mode').addEventListener('change',()=>{selectGeneratedPair();updateVisibility();updatePreview()});
  const customArea=$('#xpb-custom-json');
  const jsonDiagnostics=window.XrayJsonDiagnostics?.attach(customArea);
  let activeOutput='server';
  const setOutput=target=>{
   if(!['server','client'].includes(target))return;
   activeOutput=target;
   $$('[data-xray-output]').forEach(button=>{
    const active=button.dataset.xrayOutput===target;
    button.classList.toggle('on',active);
    button.setAttribute('aria-selected',active?'true':'false');
   });
   $('#xpb-output-server').hidden=target!=='server';
   $('#xpb-output-client').hidden=target!=='client';
   const serverActions=$('#xpb-actions-server'),clientActions=$('#xpb-actions-client');
   if(serverActions)serverActions.hidden=target!=='server'||customMode;
   if(clientActions)clientActions.hidden=target!=='client';
  };
  $$('[data-xray-output]').forEach(button=>button.addEventListener('click',()=>setOutput(button.dataset.xrayOutput)));
  setOutput('server');
  // Contextual editor: sections are derived from active protocol/network.
  // No hidden tab state: every relevant setting is available on one page.
  const setConfigTab=()=>{};
  const syncConfigTabs=()=>{
   const proto=$('#xpb-protocol').value,net=$('#xpb-network').value,sec=$('#xpb-security').value;
   const networkFieldActive=!['tun','wireguard','dokodemo-door','tunnel'].includes(proto);
   const sections={
    basic:true,
    security:['reality','tls'].includes(sec)&&!['tun','wireguard','dokodemo-door','tunnel'].includes(proto),
    transport:networkFieldActive&&$$('[data-xray-option-group]',$('#xpb-config-transport')).some(section=>
      !section.hidden&&$$('.f',section).some(field=>!field.hidden)),
    encryption:proto==='vless',
    client:true
   };
   $$('[data-xray-config-panel]').forEach(panel=>{panel.hidden=!sections[panel.dataset.xrayConfigPanel]});
   $$('[data-xray-config-tab]').forEach(button=>{button.hidden=!sections[button.dataset.xrayConfigTab]});
   const chosen=$('#xpb-context-selected');
   if(chosen){
    const label=id=>$('#xpb-'+id)?.selectedOptions[0]?.textContent.trim()||'—';
    chosen.textContent=label('protocol')+'  /  '+(networkFieldActive?label('network'):'Без транспорта')+'  /  '+(sections.security?label('security'):'Без защиты');
   }
  };
  const renderCustomSyntax=()=>{
   const pre=$('#xpb-custom-syntax');if(!pre)return;
   const source=customArea.value;
   const issues=jsonDiagnostics?.inspectAll(source)||[];
   const run=(value,start,cls='')=>jsonDiagnostics
    ?jsonDiagnostics.decorateRun(value,start,cls,issues)
    :(cls?'<span class="'+cls+'">'+esc(value)+'</span>':esc(value));
   const token=/(\s+)|("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}\[\],:])/g;
   let out='',last=0,m;
   while((m=token.exec(source))!==null){
    out+=run(source.slice(last,m.index),last);
    const value=m[0];let cls='';
    if(m[2])cls='jx-key';else if(m[3])cls='jx-string';else if(m[4])cls='jx-number';else if(m[5])cls='jx-boolean';else if(m[6])cls='jx-null';else if(m[7])cls='jx-punct';
    out+=run(value,m.index,cls);
    last=token.lastIndex;
   }
   out+=run(source.slice(last),last);
   pre.innerHTML=out+'\n';
   pre.scrollTop=customArea.scrollTop;pre.scrollLeft=customArea.scrollLeft;
   jsonDiagnostics?.update(issues);
  };
  const validateCustomJson=()=>{
   renderCustomSyntax();
   const status=$('#xpb-custom-error');
   try{
    const obj=JSON.parse(customArea.value);
    if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('Корень JSON должен быть объектом Xray.');
    if(!Array.isArray(obj.inbounds)||!obj.inbounds.length)throw new Error('Добавьте хотя бы один inbound.');
    status.classList.remove('er');status.classList.add('mu');
    status.textContent='✓ Синтаксис корректен. Подсказки выше проверяют известные настройки; совместимость подтвердите через xray run -test.';
    status.setAttribute('aria-live','polite');
    customArea.removeAttribute('aria-invalid');
    return obj;
   }catch(e){
    status.classList.add('er');status.classList.remove('mu');
    const match=String(e.message).match(/(?:position|at position)\s+(\d+)/i);
    let detail=e.message;
    if(match){const pos=Number(match[1]),before=customArea.value.slice(0,pos),line=before.split('\n').length,col=pos-(before.lastIndexOf('\n')+1)+1;detail+=' · строка '+line+', столбец '+col}
    status.textContent='✕ Ошибка JSON: '+detail;
    customArea.setAttribute('aria-invalid','true');
    return null
   }
  };
  const setMode=mode=>{
   if(mode==='visual'&&customMode&&customDirty){
    if(!confirm('Вы переключаетесь обратно в визуальный редактор. Ручные правки останутся в JSON-режиме, но не будут перенесены в поля. Продолжить?'))return;
   }
   if(mode==='custom'&&!customInitialized){customArea.value=$('#xpb-preview').value||JSON.stringify(xrayBuilderConfig(),null,2);customInitialized=true;customDirty=false}
   customMode=mode==='custom';
   const studio=$('.xray-builder');if(studio)studio.classList.toggle('manual-mode',customMode);
   $('#xpb-visual-mode').hidden=customMode;
   $('#xpb-custom-mode').hidden=!customMode;
   const tagField=$('#xpb-tag')?.closest('.f');if(tagField)tagField.hidden=customMode;
   $('#xpb-server-output').hidden=customMode;
   const previewView=$('#xpb-preview')?.closest('.xray-code-view');
   if(previewView)previewView.hidden=customMode;
   $('#xpb-preview').hidden=customMode;
   $$('[data-xray-mode]').forEach(b=>{const active=b.dataset.xrayMode===(customMode?'custom':'visual');b.classList.toggle('on',active);b.setAttribute('aria-pressed',active?'true':'false')});
   setOutput('server');
   const clientSourceNote=$('#xpb-client-source-note');
   if(clientSourceNote)clientSourceNote.textContent=customMode
    ?'Режим Server JSON вручную: Client JSON по-прежнему строится из полей визуального конструктора и не синхронизируется автоматически с произвольными ручными правками. Перед использованием сверьте обе конфигурации.'
    :'Этот Client JSON — отдельный outbound-конфиг. Адрес узла, UUID, Reality public key / Short ID и другие placeholders нужно заполнить реальными значениями.';
   if(customMode)validateCustomJson();
  };
  $$('[data-xray-mode]').forEach(btn=>btn.addEventListener('click',()=>setMode(btn.dataset.xrayMode)));
  customArea.addEventListener('input',()=>{customDirty=true;validateCustomJson()});
  customArea.addEventListener('scroll',()=>{const pre=$('#xpb-custom-syntax');if(pre){pre.scrollTop=customArea.scrollTop;pre.scrollLeft=customArea.scrollLeft}});
  customArea.addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();const start=customArea.selectionStart,end=customArea.selectionEnd;customArea.setRangeText('  ',start,end,'end');customDirty=true;validateCustomJson()}});
  $('#xpb-custom-copy').onclick=()=>copyText('xpb-custom-json');
  $('#xpb-custom-download').onclick=()=>download('xpb-custom-json','server');
  $('#xpb-format-json').onclick=()=>{const obj=validateCustomJson();if(obj){customArea.value=JSON.stringify(obj,null,2);customDirty=true;validateCustomJson();toast('JSON отформатирован')}};
  $('#xpb-reset-json').onclick=()=>{if(confirm('Заменить ручной JSON текущим конфигом визуального конструктора?')){customArea.value=$('#xpb-preview').value;customDirty=false;validateCustomJson();toast('JSON обновлён из конструктора')}};
  $$('[id^="xpb-"]').filter(el=>(el.tagName==='INPUT'||el.tagName==='SELECT'||el.tagName==='TEXTAREA')&&!['xpb-custom-json','xpb-preview','xpb-client-preview'].includes(el.id)).forEach(el=>{el.addEventListener('input',()=>{updateVisibility();updatePreview()});el.addEventListener('change',()=>{updateVisibility();updatePreview()})});
  $('#xpb-security').addEventListener('change',()=>{if($('#xpb-security').value!=='none')setConfigTab('security')});
  $('#xpb-network').addEventListener('change',()=>{ /* conditional fields refresh below */ });
  $('#xpb-generate-short').onclick=()=>{$('#xpb-short-id').value=randomShortId();updatePreview();toast('Short ID создан')};
  $('#xpb-generate-ss-password').onclick=()=>{const method=$('#xpb-ss-method').value||'chacha20-ietf-poly1305';const n=method==='2022-blake3-aes-128-gcm'?16:32;$('#xpb-ss-password').value=randomBase64(n);$('#xpb-ss-user-password').value=randomBase64(n);updatePreview();toast('Пароли Shadowsocks сгенерированы')};
  $('#xpb-generate-uuid').onclick=()=>{const u=crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=crypto.getRandomValues(new Uint8Array(1))[0]&15;return(c==='x'?r:(r&3|8)).toString(16)});$('#xpb-uuid').value=u;updatePreview();toast('UUID создан')};
  $('#xpb-generate-keys').onclick=async()=>{const b=$('#xpb-generate-keys');b.disabled=true;b.lastChild.textContent='Генерация…';try{const keys=await generateRealityKeyPair();$('#xpb-private-key').value=keys.privateKey;$('#xpb-public-key').value=keys.publicKey;updatePreview();toast('Пара X25519 сгенерирована')}catch(e){$('#xpb-error').textContent=e.message;toast('Не удалось сгенерировать Reality: '+e.message)}finally{b.disabled=false;b.lastChild.textContent='Сгенерировать пару ключей'}};
  $('#xpb-generate-vlessenc').onclick=async()=>{
   const b=$('#xpb-generate-vlessenc');b.disabled=true;const label=b.lastChild.textContent;b.lastChild.textContent='Запрос к Xray-core…';
   try{
    const result=await backendRequest('/api/v1/core/vlessenc',{method:'POST',body:JSON.stringify({})});
    if(!result||!result.x25519||!result.mlkem768||typeof result.x25519.decryption!=='string'||typeof result.mlkem768.encryption!=='string')throw new Error('Xray-core вернул неизвестный формат ответа. Обновите ядро и повторите.');
    generatedVlessPairs=result;
    let mode=$('#xpb-vlessenc-mode').value;
    if(!['x25519','mlkem768'].includes(mode)){mode='mlkem768';$('#xpb-vlessenc-mode').value=mode}
    selectGeneratedPair();updateVisibility();updatePreview();
    toast(mode==='mlkem768'?'Пара ML-KEM-768 сгенерирована':'Пара X25519 сгенерирована');
   }catch(e){const message=e.message||'Не удалось сгенерировать VLESS Encryption';$('#xpb-error').textContent=message;toast(message);}
   finally{b.disabled=false;b.lastChild.textContent=label}
  };
  const copyText=async id=>{try{await navigator.clipboard.writeText($('#'+id).value);toast('JSON скопирован')}catch(e){$('#'+id).select();document.execCommand('copy');toast('JSON скопирован')}};
  const download=(id,suffix)=>{const a=document.createElement('a'),blob=URL.createObjectURL(new Blob([$('#'+id).value],{type:'application/json'}));a.href=blob;a.download=((($('#xpb-name').value||'xray-studio').trim().replace(/[^a-z0-9_-]+/gi,'-')||'xray-studio')+'-'+suffix+'.json');a.click();setTimeout(()=>URL.revokeObjectURL(blob),1000)};
  $('#xpb-copy').onclick=()=>copyText('xpb-preview');$('#xpb-client-copy').onclick=()=>copyText('xpb-client-preview');$('#xpb-download').onclick=()=>download('xpb-preview','server');$('#xpb-client-download').onclick=()=>download('xpb-client-preview','client');
  $('#xpb-save').onclick=async()=>{
   const name=$('#xpb-name').value.trim();
   if(!name){$('#xpb-error').textContent='Укажите название профиля.';return}
   try{
    const source=customMode?customArea.value:$('#xpb-preview').value;
    const data=JSON.parse(source);
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Корень конфига должен быть JSON-объектом.');
    if(!Array.isArray(data.inbounds)||!data.inbounds.length)throw new Error('В конфигурации нужен хотя бы один inbound.');
    const tags=data.inbounds.map(i=>String(i?.tag||'').trim());
    if(tags.some(t=>!t))throw new Error('У каждого inbound должен быть непустой tag.');
    if(new Set(tags).size!==tags.length)throw new Error('Теги inbound должны быть уникальными.');
    if(DB.profiles.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw new Error('Профиль с таким названием уже существует.');
    const used=DB.profiles.flatMap(inbs).map(i=>i.tag).filter(Boolean);
    if(tags.some(t=>used.includes(t)))throw new Error('Тег уже используется в другом профиле.');
    for(const inbound of data.inbounds){
     if(inbound?.streamSettings?.security==='reality'){
      const rk=inbound.streamSettings.realitySettings||{};
      if(!rk.privateKey||rk.privateKey==='REPLACE_WITH_XRAY_PRIVATE_KEY')throw new Error('Inbound '+(inbound.tag||'(без tag)')+': задайте настоящий Reality privateKey.');
      const ids=rk.shortIds||[];
      if(!Array.isArray(ids)||ids.some(id=>String(id).length>16||String(id).length%2||!/^[a-fA-F0-9]*$/.test(String(id))))throw new Error('Inbound '+(inbound.tag||'(без tag)')+': Short ID должен быть массивом из hex-значений до 16 символов чётной длины.');
     }
     if(inbound?.protocol==='vless'&&(!inbound.settings||typeof inbound.settings.decryption!=='string'||!inbound.settings.decryption.trim()))throw new Error('Inbound '+(inbound.tag||'(без tag)')+': явно задайте settings.decryption: "none" или корректное VLESS Encryption значение.');
     if(inbound?.protocol==='vless'&&inbound.settings?.decryption&&inbound.settings.decryption!=='none'){
      const decryption=String(inbound.settings.decryption);
      if(decryption.startsWith('REPLACE_')||!decryption.startsWith('mlkem768x25519plus.'))throw new Error('Inbound '+(inbound.tag||'(без tag)')+': задайте корректный VLESS Encryption decryption из xray vlessenc.');
     }
     if(inbound?.protocol==='shadowsocks'){
      const ss=inbound.settings||{};
      const ssUsersForValidation=Array.isArray(ss.users)?ss.users:[];
      if((String(ss.method||'').startsWith('2022-')||!ssUsersForValidation.length)&&(!ss.password||String(ss.password).startsWith('REPLACE_')||String(ss.password).startsWith('CHANGE_ME_')))throw new Error('Shadowsocks: задайте серверный пароль.');
      if(String(ss.method||'').startsWith('2022-')){
       const method=String(ss.method),expected=method==='2022-blake3-aes-128-gcm'?16:32;
       const keyBytes=value=>{try{return atob(String(value).replace(/-/g,'+').replace(/_/g,'/').replace(/\s/g,'')).length}catch{return -1}};
       if(keyBytes(ss.password)!==expected)throw new Error('Shadowsocks 2022: серверный ключ должен быть Base64-кодированным ключом на '+expected+' байт.');
       const users=Array.isArray(ss.users)?ss.users:[];
       if(method==='2022-blake3-chacha20-poly1305'&&users.length)throw new Error('Shadowsocks 2022 ChaCha поддерживает одного пользователя: уберите settings.users и используйте серверный ключ.');
       if(users.some(u=>keyBytes(u.password)!==expected))throw new Error('Shadowsocks 2022: каждый пользователь должен иметь Base64-ключ на '+expected+' байт.');
       if(users.length&&!method.includes('aes'))throw new Error('Shadowsocks 2022 multi-user поддерживается только методами AES-128-GCM и AES-256-GCM.');
      }else{
       const users=Array.isArray(ss.users)?ss.users:[];
       if(users.length){
        if(users.some(u=>!u.password||String(u.password).startsWith('REPLACE_')||!['chacha20-ietf-poly1305','chacha20-poly1305','xchacha20-poly1305','aes-128-gcm','aes-256-gcm'].includes(u.method)))throw new Error('Shadowsocks: задайте пароль и поддерживаемый method для каждого пользователя.');
       }else if(!ss.password||String(ss.password).startsWith('REPLACE_')||String(ss.password).startsWith('CHANGE_ME_'))throw new Error('Shadowsocks: задайте пароль сервера.');
      }
     }
     if(inbound?.protocol==='wireguard'&&(!inbound.settings?.secretKey||String(inbound.settings.secretKey).startsWith('REPLACE_')))throw new Error('WireGuard: задайте server private key (xray wg).');
     if((inbound?.streamSettings?.method||inbound?.streamSettings?.network)==='xdrive'&&inbound.protocol==='vless'&&(!inbound.settings?.decryption||inbound.settings.decryption==='none'||String(inbound.settings.decryption).startsWith('REPLACE_')))throw new Error('XDrive inbound: задайте настоящий VLESS Encryption decryption из xray vlessenc.');
     if((inbound?.streamSettings?.method||inbound?.streamSettings?.network)==='xdrive'){
      if(inbound.protocol!=='vless')throw new Error('XDrive transport в этой версии Xray требует VLESS.');
      const xs=inbound.streamSettings?.xdriveSettings||{},service=xs.service||'local';
      if(!['local','google-drive','template','Google Drive'].includes(service))throw new Error('XDrive: неизвестный service '+service+'.');
      if(service==='google-drive'&&(!Array.isArray(xs.secrets)||xs.secrets.length!==3||xs.secrets.some(x=>!String(x).trim())))throw new Error('XDrive Google Drive требует ровно 3 непустых секрета: Client ID, Client Secret и Refresh Token.');
      if(service==='template')validateXDriveTemplate(xs.template);
     }
    }
    const config=JSON.stringify(data,null,2);
    await api.create('profiles',{name,config});
    toast('Профиль сохранён в XRAY STUDIO');
    await render(1);
   }catch(e){const message=e.message||'Не удалось сохранить профиль.';$('#xpb-error').textContent=message;if(customMode)$('#xpb-custom-error').textContent=message;toast(message);}
  };
  if(!$('#xpb-short-id').value)$('#xpb-short-id').value=randomShortId();
  updateVisibility();updatePreview();
 }];
}

/* ================= CRUD-страницы ================= */
async function crudCard(k){
  const e=ENT[k],{items}=await api.list(k,{sort:e.s});
  const emptyLabel={nodes:'Узлов пока нет',profiles:'Профилей в XRAY STUDIO пока нет',squads:'Сквадов пока нет',hosts:'Хостов пока нет',tpls:'Шаблонов пока нет',subs:'Шаблонов подписки пока нет',admins:'Администраторов пока нет',tokens:'API-токенов пока нет'}[k]||'Пока пусто';
  const emptyHint={nodes:'Добавьте первый сервер и назначьте ему профиль.',profiles:'Добавьте собственную конфигурацию Xray с inbound.',squads:'Создайте группу доступа на основе inbound.',hosts:'Добавьте адреса подключения, которые должны видеть клиенты.',tpls:'Сохраните тарифные параметры для повторного использования.',subs:'Настройте формат выдачи подписки после подключения API.',admins:'Список заполнится после добавления администраторов.',tokens:'Создайте токен для внешней интеграции.'}[k]||'Добавьте первую запись.';
  return `<div class="card"><div class="hd"><div><h3>${e.t}</h3><p>${e.n||''}</p></div><button class="btn sm" data-ne="${k}">${ic('plus')}${e.nw}</button></div>${items.length?`<div class="tw"><table class="tb"><thead><tr>${e.cols.map(c=>`<th>${c[0]}</th>`).join('')}${e.mv?'<th></th>':''}</tr></thead><tbody>${items.map((r,i)=>`<tr data-e="${k}:${r.id}">${e.cols.map(c=>`<td data-l="${c[0]}">${c[1](r)}</td>`).join('')}${e.mv?`<td data-l="Порядок"><button class="ia" data-mv="${k}:${r.id}:-1" ${i?'':'disabled'} aria-label="Выше">${ic('up')}</button><button class="ia" data-mv="${k}:${r.id}:1" ${i<items.length-1?'':'disabled'} aria-label="Ниже">${ic('down')}</button></td>`:''}</tr>`).join('')}</tbody></table></div>`:`<div class="empty"><b>${emptyLabel}</b><span>${emptyHint}</span><button class="gh sm" data-ne="${k}">${ic('plus')}${e.nw}</button></div>`}</div>`
}
async function simple(ks){const h=await Promise.all(ks.map(crudCard));return [h.join('')]}
function entForm(k,id){const e=ENT[k],o=id?DB[k].find(x=>x.id==id):e.def?e.def():{};
  const standardFields=e.fs.map(f=>field(f,k==='admins'&&f.k==='password'?'':o[f.k])).join('');
  const rotationFields=e.fs.slice(-2).map(f=>field(f,o[f.k])).join('');
  const userOptions=DB.users.filter(u=>st(u)==='ACTIVE').map(u=>`<option value="${u.id}">${esc(u.username)}</option>`).join('');
  const rotationProbe=id&&o.rotationEnabled
    ?`<div class="node-rotation-probe"><label class="f"><span>Проверка на пользователе</span><select data-node-rotation-user>${userOptions||'<option value="">Нет активных пользователей</option>'}</select></label><button type="button" class="gh sm" data-node-rotation-probe="${id}" ${userOptions?'':'disabled'}>${ic('redo')}Получить следующий IP</button><output data-node-rotation-result aria-live="polite"></output><small>Тест изменяет счётчик ротации этого пользователя. Выдача подписок будет подключена отдельно.</small></div>`
    :'';
  const fields=k==='nodes'
    ?e.fs.slice(0,-2).map(f=>field(f,o[f.k])).join('')+`<details class="node-rotation-editor" ${o.rotationEnabled?'open':''}><summary>${ic('layers')}<span><b>IP-ротация</b><small>${o.rotationEnabled?nodeRotationIPs(o).length+' адресов в пуле':'Не используется · дополнительные адреса одной VM'}</small></span></summary><div class="node-rotation-editor-body">${rotationFields}${rotationProbe}</div></details>`
    :standardFields;
  modal(`<form class="box" data-k="ent" data-ent="${k}" data-id="${id||''}" method="dialog"><h2>${id?'Изменить':'Новый'}: ${e.nw.toLowerCase()}</h2>${fields}<p class="er" id="fe"></p><div class="act">${id?`<button type="button" class="dg" data-del="${k}:${id}" style="margin-right:auto">${ic('trash')}Удалить</button>`:''}<button type="button" class="gh" data-x>Отмена</button><button class="btn">Сохранить</button></div></form>`,k=='profiles'||k=='subs'?'wide':'')
}

/* ================= УЗЛЫ ================= */
function nodeGauge(n,key,label,pct,center,detail,color){
  const p=cl(Number(pct)||0,0,100),dash=`${p} ${100-p}`;
  return `<div class="ngauge" aria-label="${esc(label)}: ${esc(center)}">
    <div class="ringwrap"><svg viewBox="0 0 40 40" role="img" aria-label="${esc(label)} ${esc(center)}"><circle class="ng-track" cx="20" cy="20" r="16" pathLength="100"></circle><circle class="ng-arc" id="ngarc-${key}" cx="20" cy="20" r="16" pathLength="100" stroke-dasharray="${dash}" style="--g-color:var(${color})"></circle></svg><b class="ng-center" id="ngval-${key}">${esc(center)}</b></div>
    <span class="ng-label">${esc(label)}</span><small id="ngsub-${key}">${esc(detail)}</small>
  </div>`;
}
const NODE_GRID_KEY='xmeshNexusGridView';
const getNodeGridMode=()=>{try{const mode=localStorage.getItem(NODE_GRID_KEY);return ['compact','standard','spacious'].includes(mode)?mode:'standard'}catch(e){return 'standard'}};
async function nodesP(){
  const [r,s]=await Promise.all([api.list('nodes',{sort:'id'}),api.stats()]);ST=s;
  const cards=r.items.map(n=>{
    const ss=nstat(n),p=DB.profiles.find(x=>x.id==n.profileId),l=LV[n.id]||{cpu:null,ram:null,mbps:null},k=n.limit?cl(n.used/n.limit,0,1):0,tc=k>.9?'--er':k>.75?'--wr':'--c3';
    return `<div class="card nc${n.disabled?' off':''}"><div class="h"><span class="fg">${flagView(n.flag)}</span><div><b>${esc(n.name)}</b><br><small class="mu">${esc(n.addr)}${n.port?':'+esc(n.port):''}</small></div>${chip(NS[ss]?.[0]||'Не проверен',NS[ss]?.[1]||'--mu')}</div>
      <div class="kvg"><div><span>Активные пользователи</span><b>${s.nodeOn[n.id]??0}</b></div><div><span>XRAY STUDIO</span>${esc(p?.name||'—')}</div></div>
      ${n.rotationEnabled?`<div class="node-ip-rotation active" aria-label="Пул IP-ротации"><span class="node-ip-indicator" aria-hidden="true"></span><span>IP-пул · ${nodeRotationIPs(n).length} адресов</span></div>`:''}
      <div class="node-gauges">
        ${nodeGauge(n,'cpu-'+n.id,'CPU',Number.isFinite(l.cpu)?l.cpu:0,Number.isFinite(l.cpu)?Math.round(l.cpu)+'%':'—',Number.isFinite(l.cpu)?'загрузка':'нет данных','--a')}
        ${nodeGauge(n,'ram-'+n.id,'RAM',Number.isFinite(l.ram)?l.ram:0,Number.isFinite(l.ram)?Math.round(l.ram)+'%':'—',Number.isFinite(l.ram)?'занято':'нет данных','--b')}
        ${nodeGauge(n,'traffic-'+n.id,'Трафик',n.limit?k*100:0,n.limit?Math.round(k*100)+'%':'∞',n.limit?`${gb(n.used)} / ${gb(n.limit)}`:`${gb(n.used)} · без лимита`,tc)}
      </div>
      <div class="mb node-speed"><div><span>Текущая скорость</span><b id="nm${n.id}">${Number.isFinite(l.mbps)?fmt(l.mbps)+' Мбит/с':'—'}</b></div><div class="pb f" style="--w:${Number.isFinite(l.mbps)?cl(l.mbps/240*100,0,100):0}%" id="npm${n.id}"><i></i></div></div>
      <div class="acts"><button class="gh sm" data-metrics-token="${n.id}" title="Настроить Ed25519-аутентификацию и мониторинг узла">${ic('activity')}Настроить метрики</button><button class="gh sm" data-nr="${n.id}">${ic('redo')}Перезапуск</button><button class="gh sm" data-nt="${n.id}">${ic(n.disabled?'play':'pause')}${n.disabled?'Включить':'Отключить'}</button><button class="gh sm" data-ne="nodes:${n.id}">${ic('pen')}Изменить</button></div></div>`;
  }).join('');
  const empty=`<div class="card empty"><b>Узлов пока нет</b><span>Список начнёт заполняться после добавления ваших серверов.</span><button class="btn sm" data-ne="nodes">${ic('plus')}Добавить узел</button></div>`;
  const gridMode=getNodeGridMode();
  return [`<section class="nodes-page"><div class="bar2 nodes-toolbar"><p class="note">${s.nAll} узлов настроено. CPU, RAM и скорость требуют подключённого мониторинга.</p><div class="node-grid-controls"><span class="note">Сетка</span><div class="seg" role="group" aria-label="Плотность сетки"><button type="button" data-node-grid-mode="compact" aria-pressed="${gridMode==='compact'?'true':'false'}" class="${gridMode==='compact'?'on':''}">Плотно</button><button type="button" data-node-grid-mode="standard" aria-pressed="${gridMode==='standard'?'true':'false'}" class="${gridMode==='standard'?'on':''}">Стандарт</button><button type="button" data-node-grid-mode="spacious" aria-pressed="${gridMode==='spacious'?'true':'false'}" class="${gridMode==='spacious'?'on':''}">Крупно</button></div></div><button type="button" class="node-create-action" data-ne="nodes" aria-label="Добавить новый узел"><span class="node-create-icon" aria-hidden="true">${ic('plus')}</span><span class="node-create-label">Новый узел</span></button></div>${r.items.length?`<div class="nodes" data-grid-mode="${gridMode}" data-node-count="${r.items.length}">${cards}</div>`:empty}</section>`,drawNodeLive]
}
function setNodeGauge(key,pct,center,detail){
  const value=cl(Number(pct)||0,0,100),arc=$('#ngarc-'+key),val=$('#ngval-'+key),sub=$('#ngsub-'+key);
  if(arc)arc.style.strokeDasharray=`${value} ${100-value}`;
  if(val)val.textContent=center;
  if(sub)sub.textContent=detail;
}
function drawNodeLive(){DB.nodes.forEach(n=>{
  const l=LV[n.id]||{cpu:null,ram:null,mbps:null};
  const metrics=[['cpu-'+n.id,l.cpu,'загрузка'],['ram-'+n.id,l.ram,'занято']];
  metrics.forEach(([key,value,detail])=>setNodeGauge(key,Number.isFinite(value)?value:0,Number.isFinite(value)?Math.round(value)+'%':'—',Number.isFinite(value)?detail:'нет данных'));
  const traffic=n.limit?cl(n.used/n.limit*100,0,100):0,tc=traffic>90?'--er':traffic>75?'--wr':'--c3';
  setNodeGauge('traffic-'+n.id,traffic,n.limit?Math.round(traffic)+'%':'∞',n.limit?`${gb(n.used)} / ${gb(n.limit)}`:`${gb(n.used)} · без лимита`);
  const ta=$('#ngarc-traffic-'+n.id);if(ta)ta.style.setProperty('--g-color',`var(${tc})`);
  const speed=$('#nm'+n.id),bar=$('#npm'+n.id);if(speed)speed.textContent=Number.isFinite(l.mbps)?fmt(l.mbps)+' Мбит/с':'—';if(bar)bar.style.setProperty('--w',Number.isFinite(l.mbps)?cl(l.mbps/240*100,0,100)+'%':'0%');
});}

/* ================= ДИАГНОСТИКА ================= */
const TP={tab:'dev',q:'',f:'',pause:0,lv:'all'};let LOGS=[];
async function toolsP(){
  const flt=TP.tab=='dev'?`<input id="tq" placeholder="Пользователь, модель, приложение" style="width:min(18rem,100%)" value="${esc(TP.q)}"><select id="tf" style="width:auto"><option value="">Все платформы</option>${Object.keys(PL).map(p=>`<option${TP.f==p?' selected':''}>${p}</option>`).join('')}</select>`:TP.tab=='srh'?`<input id="tq" placeholder="Пользователь, IP, приложение" style="width:min(18rem,100%)" value="${esc(TP.q)}"><select id="tf" style="width:auto"><option value="">Все коды</option>${[200,403,404,429].map(c=>`<option${TP.f==c?' selected':''}>${c}</option>`).join('')}</select>`:`<div class="fl" id="lf">${['all','info','warn','error'].map(k=>`<button data-lv="${k}" class="${TP.lv==k?'on':''}">${k=='all'?'Все':k}</button>`).join('')}</div><input id="tq" placeholder="Фильтр по тексту" style="width:min(16rem,100%)" value="${esc(TP.q)}"><button class="gh" id="lpz"></button><button class="gh" id="lcl">${ic('trash')}Очистить</button>`;
  return [`<div class="card"><div class="hd"><div class="seg" id="tt">${[['dev','Устройства (HWID)'],['srh','Запросы подписки'],['log','Логи']].map(([k,l])=>`<button data-tt="${k}" class="${TP.tab==k?'on':''}">${l}</button>`).join('')}</div></div><div class="bar2" style="margin-bottom:1rem">${flt}</div><div id="tr"></div></div>`,()=>{drawTools();$('#tq').oninput=e=>{TP.q=e.target.value.toLowerCase();drawTools()};const f=$('#tf');if(f)f.onchange=e=>{TP.f=e.target.value;drawTools()};
    if(TP.tab=='log'){const pz=()=>$('#lpz').innerHTML=TP.pause?ic('play')+'Продолжить':ic('pause')+'Пауза';pz();$('#lpz').onclick=()=>{TP.pause^=1;pz()};$('#lcl').onclick=()=>{LOGS=[];drawTools()};$('#lf').onclick=e=>{const b=e.target.closest('button');if(!b)return;TP.lv=b.dataset.lv;$$('#lf button').forEach(x=>x.classList.toggle('on',x==b));drawTools()};
}}]
}
function drawTools(){const e=$('#tr');if(!e)return;const q=TP.q;
  if(TP.tab=='dev'){const a=DB.users.flatMap(u=>u.devices.map(d=>({u,d}))).filter(x=>(!TP.f||x.d.plat==TP.f)&&(x.u.username+x.d.model+x.d.app).toLowerCase().includes(q)).sort((x,y)=>y.d.last-x.d.last),over=DB.users.filter(u=>u.devices.length>u.hwid).length;
    e.innerHTML=`<p class="note" style="margin-bottom:.8rem">Устройств: ${DB.users.reduce((s,u)=>s+u.devices.length,0)}. Превышают лимит: ${over} польз.</p>`+(a.length?`<div class="tw"><table class="tb"><thead><tr><th>Пользователь</th><th>Устройство</th><th>Платформа</th><th>Приложение</th><th>Последний вход</th><th></th></tr></thead><tbody>${a.slice(0,80).map(({u,d})=>`<tr><td data-l="Пользователь"><button class="who" data-uo="${u.id}">${esc(u.username)}</button> ${u.devices.length>u.hwid?chip(u.devices.length+'/'+u.hwid,'--er'):''}</td><td data-l="Устройство">${esc(d.model)}</td><td data-l="Платформа">${chip(d.plat,'--c3')}</td><td data-l="Приложение">${esc(d.app)}</td><td data-l="Последний вход">${ago(d.last)}</td><td><button class="ia" data-dd="${u.id}:${d.id}" aria-label="Удалить">${ic('trash')}</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Ничего не найдено</div>')}
  else if(TP.tab=='srh'){const a=DB.srh.filter(x=>(!TP.f||x.code==TP.f)&&(x.user+x.ip+x.app).toLowerCase().includes(q));e.innerHTML=a.length?`<div class="tw"><table class="tb"><thead><tr><th>Время</th><th>Пользователь</th><th>IP</th><th>Приложение</th><th>Формат</th><th>Код</th></tr></thead><tbody>${a.slice(0,80).map(x=>`<tr><td data-l="Время">${ago(x.t)}</td><td data-l="Пользователь">${esc(x.user)}</td><td data-l="IP">${x.ip}</td><td data-l="Приложение">${esc(x.app)}</td><td data-l="Формат">${chip(x.fmt,'--c3')}</td><td data-l="Код">${chip(x.code,x.code==200?'--ok':x.code==429?'--wr':'--er')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Ничего не найдено</div>'}
  else{const lc={info:'--c3',warn:'--wr',error:'--er'};e.innerHTML=`<div class="logs">${LOGS.filter(x=>(TP.lv=='all'||x.l==TP.lv)&&x.m.toLowerCase().includes(q)).slice(0,120).map(x=>`<div class="ll"><time>${x.t}</time>${chip(x.l,lc[x.l])}<span>${esc(x.m)}</span></div>`).join('')||'<div class="empty"><b>Логов пока нет</b><span>Записи появятся после подключения источника логов Xray.</span></div>'}</div>`}}

/* ================= БЕЗОПАСНОСТЬ ================= */
function securityP(){
  const factor=window.XMeshMfa?.panel()||
    '<section class="card" role="alert"><h3>Не удалось загрузить настройки 2FA</h3><p>Обновите панель и страницу браузера. Скрипт mfa-ui.js не загружен.</p></section>';
  return [`<div class="security-workspace">
    <div class="security-overview">
      <div><p class="note">АККАУНТ / БЕЗОПАСНОСТЬ</p><h2>Безопасность аккаунта</h2>
      <p>Двухфакторная защита вашего аккаунта, серверные правила входа и управление активными сессиями.</p></div>
    </div>
    ${factor}
    ${window.XMeshSecurity?.panel()||''}
  </div>`];
}

/* ================= НАСТРОЙКИ ================= */
async function setP(){
  const sw=[
    ['emerald','#74ddb1','#c6e985','Изумруд'],
    ['ocean','#7fb3e8','#6fd8c3','Океан'],
    ['amber','#ebbd7a','#f0899a','Янтарь'],
    ['rose','#f0a0c4','#a0a2f6','Роза'],
    ['violet','#b7a1ff','#83d9ed','Фиолетовый'],
    ['cyan','#63dff2','#7fa8ff','Циан'],
    ['ruby','#ff8aa7','#d4a1ff','Рубин'],
    ['sapphire','#87aaff','#aed6ff','Сапфир'],
    ['teal','#5ed4c4','#a7e4d9','Бирюза'],
    ['coral','#ff9e8b','#fbd0a6','Коралл'],
    ['indigo','#a5a9f6','#cab3ff','Индиго'],
    ['copper','#d9ae80','#edc6a1','Медь'],
    ['glacier','#83c9e9','#c5eaf1','Ледник'],
    ['graphite','#aab9c9','#d6c8dc','Графит'],
    ['lime','#c8ed7a','#86d79c','Лайм'],
    ['terracotta','#e9a086','#f2c68e','Терракота'],
    ['orchid','#d99dde','#f1b5da','Орхидея'],
    ['aurora','#74dbc5','#a49ceb','Аврора'],
    ['sakura','#f8aac6','#f2d6ad','Сакура'],
    ['storm','#8fafd2','#c4b1e8','Шторм'],
    ['flame','#ff9276','#f5c260','Пламя'],
    ['sage','#a8d7ac','#d0e5b7','Шалфей'],
    ['midnight','#7398ed','#af86ce','Полночь'],
    ['tropical','#4ed5bc','#f6c787','Тропики']
  ];
  const choices=(key,items)=>`<div class="seg choice" role="group" aria-label="${key}">${items.map(([v,l])=>`<button type="button" data-ui="${key}" data-value="${v}" class="${(C[key]||CDEFAULT[key])==v?'on':''}" aria-pressed="${(C[key]||CDEFAULT[key])==v?'true':'false'}">${l}</button>`).join('')}</div>`;
  const tk=`<section class="card"><div class="hd"><div><h3>API-токены</h3><p>Выдача API-токенов для интеграций ещё не реализована.</p></div></div><p class="note">Не создавайте токены через этот раздел: безопасность доступа к API будет добавлена отдельным этапом.</p></section>`;
  let coreView={desired_version:'latest',installed_version:null,latest_version:null,status:'unknown',progress:null,last_error:null,architecture:'unknown'};
  try{coreView=await backendRequest('/api/v1/core')}catch(e){coreView.last_error=e.message}
  const coreLabel=coreView.status=='updating'?'Обновляется':coreView.status=='ready'?'Установлено':coreView.status=='error'?'Ошибка':'Не установлено';
  return [`<div class="appearance-layout">
<div class="appearance-column">
    <section class="card sg"><div class="settings-appearance-header">
      <div><h3>Цвет и тема</h3><small>Основная палитра интерфейса и брендовые акценты</small></div>
    </div>
      <div class="setting-row"><div class="setting-copy"><b>Тема</b><small>Автоматически — по настройкам ОС</small></div><div class="setting-control"><div class="seg choice" id="th">${[['dark','Тёмная'],['light','Светлая'],['auto','Авто']].map(([k,l])=>`<button type="button" data-th="${k}" class="${C.theme==k?'on':''}">${l}</button>`).join('')}</div></div></div>
      <div class="setting-row appearance-preset-row"><div class="setting-copy"><b>Цветовые темы</b><small>Подобранные сочетания для светлого и тёмного оформления</small></div><div class="palette-preset-grid" role="group" aria-label="Цветовые темы">${sw.map(([k,x,y,l])=>`<button type="button" class="palette-preset ${C.accent===k?'on':''}" data-ac="${k}" aria-pressed="${C.accent===k?'true':'false'}" style="--x:${x};--y:${y}"><span class="palette-preset-demo" aria-hidden="true"><i></i><em></em><b></b></span><span class="palette-preset-foot"><span>${l}</span><span class="palette-preset-tick">${ic('check')}</span></span></button>`).join('')}</div></div>
      <div class="setting-row"><div class="setting-copy"><b>Своя палитра</b><small>Введите HEX или настройте цвет ползунками. Палитра изменится только после подтверждения.</small></div><div class="setting-control"><div class="palette-hex-fields"><label class="palette-hex-field"><span>Основной</span><span class="palette-hex-editor"><i id="palette-preview-a" aria-hidden="true" style="--picked:${paletteDraft.a}"></i><input type="text" id="custom-a" value="${paletteDraft.a}" autocomplete="off" spellcheck="false" maxlength="7" aria-label="HEX основного цвета" placeholder="#74DDB1"></span></label><label class="palette-hex-field"><span>Вторичный</span><span class="palette-hex-editor"><i id="palette-preview-b" aria-hidden="true" style="--picked:${paletteDraft.b}"></i><input type="text" id="custom-b" value="${paletteDraft.b}" autocomplete="off" spellcheck="false" maxlength="7" aria-label="HEX вторичного цвета" placeholder="#C6E985"></span></label></div></div></div>
    </section>
    <section class="card sg"><div class="appearance-card-heading"><h3>Точная настройка цвета</h3><small>Оттенок, насыщенность и яркость собственной палитры</small></div>
      <div class="color-slider-grid"><label for="hue">Оттенок</label><input type="range" id="hue" min="0" max="360" step="1" value="${paletteDraft.h}"><output id="huev">${paletteDraft.h}°</output></div><div class="color-slider-grid"><label for="sat">Насыщенность</label><input type="range" id="sat" min="0" max="100" step="1" value="${paletteDraft.s}"><output id="satv">${paletteDraft.s}%</output></div><div class="color-slider-grid"><label for="lum">Яркость</label><input type="range" id="lum" min="15" max="85" step="1" value="${paletteDraft.l}"><output id="lumv">${paletteDraft.l}%</output></div>
      <div class="palette-draft-preview" id="palette-draft-preview" style="--x:${paletteDraft.a};--y:${paletteDraft.b}"><span class="palette-draft-samples"><i></i><i></i></span><span><b>Предпросмотр своей палитры</b><small>Цвета не изменятся до подтверждения</small></span></div>
      <div class="palette-draft-actions"><button class="gh sm" type="button" id="palette-cancel">Отмена</button><button class="btn" type="button" id="palette-apply">Применить палитру</button></div>
    </section>
    <section class="card sg"><div class="appearance-card-heading"><h3>Типографика</h3><small>Размер и начертание текста</small></div>
      <div class="setting-row"><div class="setting-copy"><b>Масштаб интерфейса</b><small>Масштаб текста и элементов вместе: 90–200% с шагом 1%. Для стандартного размера установите 100%.</small></div><div class="setting-control slider-control"><input type="range" id="ts" min="0.9" max="2" step="0.01" value="${C.ts}" aria-label="Масштаб интерфейса"><label class="precision-number"><input type="number" id="tsv" data-appearance-value="ts" min="90" max="200" step="1" value="${Math.round(C.ts*100)}" aria-label="Точный масштаб интерфейса"><span>%</span></label></div></div>
      <div class="setting-row"><div class="setting-copy"><b>Шрифт</b><small>Выберите нейтральный системный или моноширинный стиль</small></div><div class="setting-control">${choices('font',[['onest','Manrope'],['system','Системный'],['mono','Моно']])}</div></div>
    </section>
</div><div class="appearance-column">
    <section class="card sg"><div><h3>Композиция</h3><small>Плотность, радиусы и вид карточек</small></div>
      <div class="setting-row"><div class="setting-copy"><b>Плотность</b><small>От компактной таблицы до просторных карточек</small></div><div class="setting-control">${choices('density',[['compact','Компактно'],['comfortable','Стандарт'],['spacious','Свободно']])}</div></div>
      <div class="setting-row"><div class="setting-copy"><b>Стиль карточек</b><small>Классический, стеклянный или объёмный вид</small></div><div class="setting-control">${choices('surface',[['solid','Классика'],['glass','Glass'],['raised','Объём']])}</div></div>
      <div class="setting-row"><div class="setting-copy"><b>Скругление</b><small>От 1 до 36 px с точным шагом 1 независимо от режима остальных ползунков.</small></div><div class="setting-control slider-control"><input type="range" id="radius" min="1" max="36" step="1" value="${C.radius}" aria-label="Скругление углов"><label class="precision-number"><input type="number" id="rv" data-appearance-value="radius" min="1" max="36" step="1" value="${C.radius}" aria-label="Точное скругление углов"><span>px</span></label></div></div>
      <div class="setting-row"><div class="setting-copy"><b>Границы карточек</b><small>Можно убрать линии или сделать их заметнее</small></div><div class="setting-control">${choices('borders',[['off','Без линий'],['soft','Мягкие'],['strong','Яркие']])}</div></div>
      <div class="setting-row"><div class="setting-copy"><b>Боковая панель</b><small>Компактный режим оставляет в основном только иконки</small></div><div class="setting-control">${choices('sidebar',[['standard','Обычная'],['compact','Компактная']])}</div></div>
      <div class="setting-row"><div class="setting-copy"><b>Подсказки при наведении</b><small>Показывать названия разделов и кнопок боковой панели. Работает в обычном и компактном режимах.</small></div><label class="sw"><input type="checkbox" id="rail-tips" ${C.railTips?'checked':''} aria-label="Подсказки при наведении"><span></span></label></div>
    </section>
<section class="card sg">
    <div class="appearance-card-heading"><h3>Рабочее пространство</h3><small>Ширина панели и интервалы между разделами</small></div>
    <div class="setting-row"><div class="setting-copy"><b>Точность ползунков</b><small>Шаг 1 или 10 для остальных ползунков. Скругление всегда настраивается по 1 px.</small></div><div class="setting-control"><select id="range-precision" aria-label="Точность ползунков"><option value="1" ${C.rangePrecision===1?'selected':''}>Точно · 1</option><option value="10" ${C.rangePrecision===10?'selected':''}>С привязкой · 10</option></select></div></div>
    <div class="setting-row"><div class="setting-copy"><b>Ширина содержимого</b><small>Максимальная ширина рабочей области до 3000 px. На узком экране она ограничена размером окна.</small></div><div class="setting-control slider-control"><input type="range" id="content-width" min="720" max="3000" step="1" value="${C.contentWidth||1920}" aria-label="Ширина содержимого"><label class="precision-number"><input type="number" id="content-width-value" data-appearance-value="content-width" min="720" max="3000" step="1" value="${C.contentWidth||1920}" aria-label="Точная ширина содержимого"><span>px</span></label></div></div>
    <div class="setting-row"><div class="setting-copy"><b>Интервалы</b><small>Расстояние между карточками и блоками интерфейса</small></div><div class="setting-control slider-control"><input type="range" id="gap-scale" min="0.8" max="1.4" step="0.01" value="${C.gapScale||1}" aria-label="Расстояние между карточками"><label class="precision-number"><input type="number" id="gap-scale-value" data-appearance-value="gap-scale" min="80" max="140" step="1" value="${Math.round((C.gapScale||1)*100)}" aria-label="Точный интервал между карточками"><span>%</span></label></div></div>
  </section>
    <section class="card sg"><div><h3>Эффекты и движение</h3><small>Настройка фона и анимаций без изменения данных</small></div>
      <div class="setting-row"><div class="setting-copy"><b>Подсветка фона</b><small>Мягкое цветное свечение за панелью</small></div><div class="setting-control">${choices('glow',[['off','Выкл.'],['subtle','Мягкая'],['normal','Средняя'],['rich','Яркая']])}</div></div>
      <div class="setting-row"><div class="setting-copy"><b>Анимации</b><small>Отключите движение и переходы, если они отвлекают</small></div><label class="sw"><input type="checkbox" id="mo" ${C.motion?'checked':''} aria-label="Анимации"><span></span></label></div>
      <div class="setting-row"><div class="setting-copy"><b>Сохранение</b><small>Параметры оформления сохраняются в localStorage этого браузера</small></div><button class="gh sm" id="rs">Сбросить оформление</button></div>
    </section>
</div></div>
  <div class="card" id="brand-panel"><div class="hd"><div><h3>Бренд и домены</h3><p>Отдельные названия и домены панели управления и подписки</p></div></div><form data-k="brand" method="dialog" class="sg" style="gap:1rem"><div class="r2" style="display:grid;border:0;padding:0">${field({k:'brand',l:'Название панели',req:1},DB.set.brand)}${field({k:'domain',l:'Домен панели',req:1,ph:'panel.example.com'},DB.set.domain)}${field({k:'subscriptionBrand',l:'Название подписки',ph:'Название вашего сервиса',h:'Название клиентского портала. Если пусто — используется название панели. Изменяется также в SUBSCRIPTION STUDIO.'},DB.set.subscriptionBrand||'')}${field({k:'subscriptionDomain',l:'Домен подписки',ph:'sub.example.com',h:'Независим от домена панели. Оформление и размещение — в SUBSCRIPTION STUDIO.'},DB.set.subscriptionDomain||'')}</div><div style="border:0;padding:0"><button class="btn">Сохранить</button></div></form></div>
  <div class="card"><div class="hd"><div><h3>Вебхуки</h3><p>События, о которых панель сообщает во внешние сервисы</p></div></div>${Object.entries(DB.set.hooks).map(([k,v])=>`<div class="rowi"><div>${k}</div><label class="sw"><input type="checkbox" data-hk="${k}" ${v?'checked':''} aria-label="${k}"><span></span></label></div>`).join('')}</div>${tk}
  <div class="card" id="core-panel"><div class="hd"><div><h3>Xray-core</h3><p>Установка и обновление бинарника ядра на сервере панели</p></div><span class="chip" id="core-state">${esc(coreLabel)}</span></div>
    <div class="setting-row"><div class="setting-copy"><b>Установленная версия</b><small id="core-installed">${coreView.installed_version?esc(coreView.installed_version):'Ещё не установлена'}</small></div><div class="setting-copy"><b>Архитектура</b><small id="core-architecture">${esc(coreView.architecture||'—')}</small></div></div>
    <div class="setting-row"><div class="setting-copy"><b>Автопроверка статуса</b><small>Проверять Xray-core в фоне, только когда панель открыта и вкладка активна.</small></div><label class="sw"><input type="checkbox" id="auto-core-refresh" ${C.autoCoreRefresh?'checked':''} aria-label="Автоматически проверять статус Xray-core"><span></span></label></div>
    <div class="setting-row"><div class="setting-copy"><b>Интервал проверки</b><small>Как часто опрашивать backend, если автопроверка включена.</small></div><div class="setting-control"><select id="core-refresh-seconds" aria-label="Интервал проверки Xray-core"><option value="15" ${Number(C.coreRefreshSeconds)===15?'selected':''}>Каждые 15 секунд</option><option value="30" ${Number(C.coreRefreshSeconds)===30?'selected':''}>Каждые 30 секунд</option><option value="60" ${Number(C.coreRefreshSeconds)===60?'selected':''}>Каждую минуту</option><option value="120" ${Number(C.coreRefreshSeconds)===120?'selected':''}>Каждые 2 минуты</option></select></div></div>
    <div class="sg" style="gap:.6rem"><label class="f"><span>Версия для установки</span><input id="core-target" value="${esc(coreView.desired_version||'latest')}" placeholder="latest или v26.10.10" autocomplete="off"><small>Значение latest выбирает самый свежий опубликованный релиз GitHub. По умолчанию используется latest.</small></label></div>
    <div class="act"><button class="gh" type="button" data-core-refresh>Проверить статус</button><button class="btn" type="button" data-core-update>Установить / обновить</button></div>
    <div class="history-placeholder" id="core-message">${esc(coreView.last_error||coreView.progress||'Обновление ядра выполняется отдельно от запуска VPN-трафика.')}</div>
  </div>
  <div class="card" id="panel-update-card">
    <div class="hd"><div><h3>Обновление XMesh Nexus</h3><p>Обновление панели из GitHub main с резервной копией PostgreSQL и пересборкой Docker.</p></div><span class="chip">Owner</span></div>
    <p class="note">Обновление выполняет отдельный системный сервис. У веб-панели нет доступа к Docker socket и произвольным командам. Во время обновления соединение с интерфейсом прервётся.</p>
    <div class="act"><button type="button" class="gh" data-panel-update-status>Проверить состояние</button><button type="button" class="btn" data-panel-update>Обновить панель</button></div>
    <div class="history-placeholder" id="panel-update-message">Для веб-обновления требуется установить системный сервис через install.sh.</div>
  </div>
  <div class="card"><div class="hd"><div><h3>Данные панели</h3><p>Настройки и записи хранятся в PostgreSQL. Экспортируйте JSON перед переносом или резервным копированием.</p></div><button class="gh" id="gx">${ic('dl')}Скачать резервную копию</button></div><p class="note">На этом этапе панель и backend управляют данными и бинарником Xray-core. Запуск VPN-трафика и управление удалёнными узлами пока не подключены.</p></div>`]
}

/* ================= ПАЛИТРА КОМАНД ================= */
let PI=[],PX=0;
function palette(){modal(`<div class="box palette-box" style="gap:.6rem"><div class="palette-search-wrap"><label class="search palette-search-field" style="cursor:text">${ic('search')}<input id="pq" placeholder="Поиск команд и страниц" autocomplete="off" aria-label="Поиск страницы, действия или пользователя"></label><span class="palette-search-hint">Введите название страницы, действие или пользователя</span></div><div id="pr" role="listbox"></div></div>`,'pal');pdraw('');setTimeout(()=>$('#pq').focus(),40)}
function pdraw(q){q=q.toLowerCase();const go=k=>()=>{dlg.close();location.hash=k};
  PI=[...FLAT.map(([k,i,l])=>({i,l:'Перейти: '+l,r:go(k)})),{i:'plus',l:'Новый пользователь',r:()=>userNew()},{i:'plus',l:'Новый хост',r:()=>entForm('hosts')},{i:'plus',l:'Новый узел',r:()=>entForm('nodes')},{i:'plus',l:'Новый сквад',r:()=>entForm('squads')},{i:'sun',l:'Сменить тему',r:()=>{dlg.close();$('#theme').click()}},{i:'sliders',l:'Настроить внешний вид',r:go('set')}].filter(x=>x.l.toLowerCase().includes(q));
  if(q)PI.push(...DB.users.filter(u=>(u.username+u.tag+u.email+u.tg).toLowerCase().includes(q)).slice(0,6).map(u=>({i:'users',l:u.username,m:STM[st(u)][0],r:()=>userDrawer(u.id,'ov')})));PX=0;
  $('#pr').innerHTML=PI.slice(0,12).map((x,i)=>`<button class="pi${i?'':' on'}" data-pi="${i}">${ic(x.i)}<span>${esc(x.l)}</span>${x.m?`<em>${x.m}</em>`:''}</button>`).join('')||'<div class="empty">Ничего не найдено</div>'}

/* ================= СОБЫТИЯ ================= */
const copyT=t=>(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(()=>toast('Скопировано'),()=>{const i=$('#lk');i.select();document.execCommand('copy');toast('Скопировано')});
const sel=()=>{$$('#ut tbody tr').forEach(r=>{const i=+r.dataset.id;r.classList.toggle('sel',UQ.sel.has(i));const c=$('[data-sel]',r);if(c)c.checked=UQ.sel.has(i)});const a=$('[data-sela]');if(a)a.checked=$$('#ut tbody tr').every(r=>UQ.sel.has(+r.dataset.id));drawBulk()};
const delUsers=async ids=>{const gone=DB.users.filter(u=>[...ids].some(id=>String(id)===String(u.id)));try{for(const user of gone)await removeXrayUserFromProfiles(user);for(const id of ids)await api.remove('users',id)}catch(error){toast('Не удалось удалить пользователя: '+(error.message||'ошибка backend'));return}ids.forEach(i=>UQ.sel.delete(i));toast(`Удалено: ${ids.size}`,'Отменить',async()=>{try{if(backendReady){for(const user of gone)await api.create('users',user)}else{DB.users.push(...gone);save()}render(1);toast('Пользователи восстановлены')}catch(error){toast('Не удалось восстановить: '+error.message)}});dlg.close();render(1)};
document.addEventListener('click',async e=>{
  const g=s=>e.target.closest(s);let b;
  if(g('.sw')||g('[data-sel]')&&0)return;
  if(b=g('[data-scroll-target]')){
    e.preventDefault();
    pendingScrollTarget=b.dataset.scrollTarget;
    dlg.close();
    if(location.hash==='#set'){
      const target=pendingScrollTarget;
      pendingScrollTarget=null;
      requestAnimationFrame(()=>scrollToSettingsTarget(target));
    }else location.hash='set';
    return;
  }
  if(g('[data-nu]'))userNew();
  else if(b=g('[data-uf]')){UQ.st=b.dataset.uf;UQ.page=1;drawUsers()}
  else if(b=g('[data-s]')){const k=b.dataset.s;UQ.dir=UQ.sort==k&&UQ.dir=='asc'?'desc':'asc';UQ.sort=k;drawUsers()}
  else if(b=g('[data-pg]')){UQ.page+=+b.dataset.pg;drawUsers()}
  else if(g('[data-sela]')){const on=g('[data-sela]').checked;$$('#ut tbody tr').forEach(r=>on?UQ.sel.add(+r.dataset.id):UQ.sel.delete(+r.dataset.id));sel()}
  else if(b=g('[data-sel]')){const i=+b.dataset.sel;b.checked?UQ.sel.add(i):UQ.sel.delete(i);sel()}
  else if(g('[data-exp]'))exportCsv();
  else if(b=g('[data-bk]')){const a=b.dataset.bk,ids=new Set(UQ.sel),n=ids.size,now=Date.now();
    if(a=='clr'){UQ.sel.clear();sel()}else if(a=='all'){UIDS.forEach(i=>UQ.sel.add(i));sel()}
    else if(a=='del')confirmBox(`Удалить пользователей: ${n}?`,'Удалить',()=>delUsers(ids));
    else if(a=='sq')modal(`<form class="box" data-k="bsq" method="dialog"><h2>Добавить в сквад</h2><p class="note">Пользователей: ${n}</p>${field({k:'squads',l:'Сквады',t:'multi',o:()=>DB.squads.map(s=>[s.id,s.name])},[])}${acts2('Добавить')}</form>`);
    else if(a=='ext')modal(`<form class="box bulk-renew-dialog" data-k="bulk-renew" method="dialog"><h2>Продление доступа</h2><p class="note">Выбрано пользователей: ${n}. Срок увеличится на указанное количество дней для каждого пользователя.</p><label class="f"><span>Количество дней</span><input type="number" name="days" min="1" max="36500" step="1" inputmode="numeric" required placeholder="Введите число"><small>От текущей даты окончания, либо от сегодня, если доступ истёк.</small></label><p class="er" id="fe" role="status"></p><div class="act"><button type="button" class="gh" data-x>Отмена</button><button class="btn" type="submit">${ic('calendar')}Продлить</button></div></form>`);
    else{await api.bulk('users',ids,u=>{if(a=='on')u.disabled=false;if(a=='off')u.disabled=true;if(a=='reset')u.used=0});toast({on:'Включены',off:'Отключены',reset:'Трафик сброшен'}[a]+`: ${n}`);render(1)}}
  else if(b=g('[data-dt]')){userDrawer(+$('[data-a]').dataset.u,b.dataset.dt)}
  else if(b=g('tr[data-id]'))userDrawer(+b.dataset.id,'ov');
  else if(b=g('[data-uo]'))userDrawer(+b.dataset.uo,'dev');
  else if(b=g('[data-user-date-open],[data-user-date-nav],[data-user-date-day],[data-user-date-today],[data-user-date-clear]')){e.preventDefault();handleUserCalendarAction(b)}
  else if(b=g('[data-user-renew-apply]')){e.preventDefault();handleUserRenewalAction(b)}
  else if(b=g('[data-user-traffic-refresh]')){e.preventDefault();void loadUserTrafficStats(+b.dataset.userTrafficRefresh)}
  else if(b=g('[data-copy-xray-id]')){const u=DB.users.find(x=>x.id==+b.dataset.copyXrayId);if(u?.xrayId)copyT(u.xrayId)}
  else if(g('[data-copy]'))copyT($('#lk').value);
  else if(b=g('[data-a]')){const id=+b.dataset.u,a=b.dataset.a;
    if(a=='del'){confirmBox('Удалить пользователя?','Удалить',()=>delUsers(new Set([id])));return}
    const u=DB.users.find(x=>x.id==id);if(!u){toast('Пользователь не найден в локальном кеше. Обновите список и повторите.');return}
    const p=a=='tog'?{disabled:!u.disabled}:a=='rst'?{used:0}:a=='rev'?{short:Math.floor(Math.random()*2**40).toString(36).padStart(8,'a'),devices:[]}:null;
    if(!p)return;
    await api.update('users',id,p);toast({tog:'Статус изменён',rst:'Трафик сброшен',rev:'Ссылка перевыпущена'}[a]);render(1);userDrawer(id,a=='rev'?'sub':UT)}
  else if(b=g('[data-dd]')){const [ui,di]=b.dataset.dd.split(':').map(Number),u=DB.users.find(x=>x.id==ui);await api.update('users',ui,{devices:u.devices.filter(d=>d.id!=di)});toast('Устройство удалено');if(cur=='tools')drawTools();else userDrawer(ui,'dev')}
  else if(b=g('[data-qx]')){const u=DB.users.find(x=>x.id==b.dataset.qx);if(u)userDrawer(u.id,'ov')}
  else if(b=g('[data-qr]')){await api.update('users',+b.dataset.qr,{used:0});toast('Трафик сброшен');render(1)}
  else if(b=g('[data-ne]')){const [k,id]=b.dataset.ne.split(':');entForm(k,id)}
  else if(b=g('tr[data-e]')){const [k,id]=b.dataset.e.split(':');entForm(k,id)}
  else if(b=g('[data-mv]')){const [k,id,d]=b.dataset.mv.split(':'),a=[...DB[k]].sort((x,y)=>x.order-y.order),i=a.findIndex(x=>x.id==id),j=i+ +d;if(a[j]){const o=a[i].order;await api.update(k,a[i].id,{order:a[j].order});await api.update(k,a[j].id,{order:o});render(1)}}
  else if(b=g('[data-del]')){const [k,id]=b.dataset.del.split(':'),e=ENT[k],r=DB[k].find(x=>String(x.id)===id),m=e?.guard?.(r);if(m){const error=$('#fe');if(error)error.textContent=m;else toast(m);return}if(!r){toast('Запись уже удалена или не найдена.');return}confirmBox(`Удалить «${e?.t||k}»?`,'Удалить',async()=>{try{await api.remove(k,id);toast('Запись удалена');await render(1)}catch(err){toast('Не удалось удалить: '+(err.message||'ошибка backend'))}})}
  else if(b=g('[data-metrics-token]')){
    const id=Number(b.dataset.metricsToken),node=DB.nodes.find(n=>Number(n.id)===id);
    if(!node){toast('Узел не найден.');return}
    if(location.protocol!=='https:'){toast('Открой панель через HTTPS для управления идентичностью узла.');return}
    const shellQuote=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
    const installUrl='https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/install-node-metrics-agent.sh';
    const command='install_script="$(mktemp /tmp/xmesh-agent.XXXXXXXX)"\ncurl --proto "=https" --tlsv1.2 -fsSL '+shellQuote(installUrl)+' -o "$install_script" && sudo bash "$install_script" '+shellQuote(location.origin)+' '+shellQuote(String(id))+'\nrm -f "$install_script"';
    const html='<div class="box"><div class="bar2"><h2>Защищённый агент · '+esc(node.name)+'</h2><button class="ia" data-x aria-label="Закрыть">'+ic('x')+'</button></div>'+
      '<p class="note">Каждый узел получает собственный приватный Ed25519-ключ. Панель хранит только публичный ключ; токен Bearer не требуется. Подписываются тело запроса, время и случайный nonce.</p>'+
      '<label class="f"><span>1. Установите агент на Linux-узле (root)</span><textarea id="metrics-install-command" rows="3" spellcheck="false" readonly>'+esc(command)+'</textarea><small>В конце установки агент покажет публичный ключ. Не передавайте приватный ключ в панель.</small></label>'+
      '<div class="act"><button type="button" class="gh" data-copy-metrics-install>'+ic('copy')+'Скопировать команду</button></div>'+
      '<label class="f"><span>2. Публичный Ed25519-ключ узла (64 hex-символа)</span><input id="metrics-public-key" autocomplete="off" spellcheck="false" maxlength="64" placeholder="Вставьте публичный ключ, показанный в терминале"></label>'+
      '<p class="note">После регистрации Ed25519-ключа узел сможет отправлять метрики. Без зарегистрированного публичного ключа запросы отклоняются.</p>'+
      '<div class="act"><button type="button" class="gh" data-node-key-revoke="'+id+'">'+ic('shield-off')+'Отозвать доступ узла</button>'+
      '<button type="button" class="btn" data-node-key-enroll="'+id+'">'+ic('shield-check')+'Активировать защищённый агент</button></div></div>';
    modal(html,'wide');
  }
  else if(b=g('[data-node-key-enroll]')){
    const id=Number(b.dataset.nodeKeyEnroll),input=$('#metrics-public-key'),publicKey=(input?.value||'').trim();
    if(!/^[0-9a-f]{64}$/.test(publicKey)){toast('Требуется публичный Ed25519-ключ из 64 строчных hex-символов.');input?.focus();return}
    if(!confirm('Активировать Ed25519 для узла '+id+'? Если ключ уже существует, предыдущий ключ перестанет работать.'))return;
    b.disabled=true;
    try{
      await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/metrics-key',{method:'POST',body:JSON.stringify({publicKey})});
      toast('Ed25519 активирован. Подписанные запросы разрешены.');$('#metrics-public-key').value='';
    }catch(error){toast('Не удалось зарегистрировать ключ: '+(error.message||'ошибка API'))}
    finally{b.disabled=false}
  }
  else if(b=g('[data-node-key-revoke]')){
    const id=Number(b.dataset.nodeKeyRevoke);
    if(!confirm('Отозвать ВСЕ учётные данные узла '+id+'? Отправка метрик остановится до регистрации нового ключа.'))return;
    b.disabled=true;
    try{
      await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/metrics-key',{method:'DELETE'});
      toast('Все учётные данные узла отозваны.');
    }catch(error){toast('Не удалось отозвать ключ: '+(error.message||'ошибка API'))}
    finally{b.disabled=false}
  }
  else if(b=g('[data-copy-metrics-install]')){
    const field=$('#metrics-install-command');
    if(field){try{await navigator.clipboard.writeText(field.value);toast('Команда скопирована')}catch(error){field.focus();field.select();document.execCommand('copy');toast('Команда скопирована')}}
  }
  else if(b=g('[data-node-rotation-probe]')){
    const nodeId=Number(b.dataset.nodeRotationProbe);
    const userId=Number(b.closest('.node-rotation-editor')?.querySelector('[data-node-rotation-user]')?.value);
    const result=b.closest('.node-rotation-editor')?.querySelector('[data-node-rotation-result]');
    if(!Number.isSafeInteger(userId)||userId<1){toast('Выберите активного пользователя для проверки.');return}
    b.disabled=true;
    if(result)result.textContent='Получение адреса…';
    try{
      const r=await backendRequest('/api/v1/nodes/'+encodeURIComponent(nodeId)+'/rotation/next',{method:'POST',body:JSON.stringify({userId})});
      if(result)result.textContent=r.address;
    }catch(error){if(result)result.textContent=error.message||'Не удалось получить адрес.'}
    finally{b.disabled=false}
  }
  else if(b=g('[data-nr]')){toast('Перезапуск требует подключённого backend/API Xray. В автономном HTML он не выполняется.')}
  else if(b=g('[data-nt]')){const n=DB.nodes.find(x=>x.id==b.dataset.nt);await api.update('nodes',n.id,{disabled:!n.disabled});toast(`${n.name}: ${n.disabled?'отключён':'включён'}`);render(1)}
  else if(b=g('[data-tt]')){TP.tab=b.dataset.tt;TP.q='';TP.f='';render(1)}
  else if(b=g('[data-lv]')){}
  else if(b=g('[data-th]')){C.theme=b.dataset.th;apply();syncSubscriptionTheme();$$('#th button').forEach(x=>x.classList.toggle('on',x==b))}
  else if(b=g('[data-ac]')){C.accent=b.dataset.ac;apply();syncSubscriptionTheme();$$('[data-ac]').forEach(x=>{const active=x===b;x.classList.toggle('on',active);x.setAttribute('aria-pressed',String(active))})}
   else if(g('#palette-apply')){C.customA=paletteDraft.a;C.customB=paletteDraft.b;C.hue=paletteDraft.h;C.sat=paletteDraft.s;C.lum=paletteDraft.l;C.accent='custom';apply();syncSubscriptionTheme();render(1);toast('Палитра применена')}
   else if(g('#palette-cancel')){resetPaletteDraft();render(1)}
  else if(b=g('[data-ui]')){const prop=b.dataset.ui,value=b.dataset.value;if(prop&&value&&(prop!=='surface'||['solid','glass','raised'].includes(value))){C[prop]=value;apply();document.querySelectorAll(`[data-ui="${prop}"]`).forEach(x=>{const active=x.dataset.value===value;x.classList.toggle('on',active);x.setAttribute('aria-pressed',String(active))})}}
  else if(g('#rs')){const automation={autoCoreRefresh:C.autoCoreRefresh,coreRefreshSeconds:C.coreRefreshSeconds};C={...CDEFAULT,...automation};resetPaletteDraft();apply();syncSubscriptionTheme();syncCoreAutoRefresh();render(1);toast('Оформление сброшено')}
  else if(g('#gx')){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(DB,null,2)],{type:'application/json'}));a.download='xmesh-nexus-backup.json';a.click()}
  else if(b=g('[data-cf]')){dlg.close();CF&&CF()}
  else if(b=g('[data-panel-update-status]')){
    b.disabled=true;
    try{
      const state=await backendRequest('/api/v1/panel/update');
      const labels={idle:'Обновление не запущено.',running:'Обновление выполняется на сервере…',success:'Обновление завершено. Перезагрузите страницу.',failed:'Ошибка обновления. Проверьте journalctl -u xmesh-panel-update.service',unavailable:'Системный сервис обновления недоступен. Выполните bash install.sh от root.'};
      const target=$('#panel-update-message');if(target)target.textContent=labels[state.status]||state.status;
    }catch(err){const target=$('#panel-update-message');if(target)target.textContent=err.message}
    finally{b.disabled=false}
  }
  else if(b=g('[data-panel-update]')){
    if(!confirm('Обновить XMesh Nexus из origin/main? Сначала резервная копия PostgreSQL, затем пересборка Docker и перезапуск. Продолжить?'))return;
    b.disabled=true;
    try{
      const result=await backendRequest('/api/v1/panel/update',{method:'POST',body:JSON.stringify({})});
      const target=$('#panel-update-message');if(target)target.textContent=result.message||'Запрос принят.';
      toast('Обновление передано системному сервису');
    }catch(err){const target=$('#panel-update-message');if(target)target.textContent=err.message;toast(err.message)}
    finally{b.disabled=false}
  }
  else if(b=g('[data-core-refresh]')){try{await refreshCoreStatus(true)}catch(err){toast(err.message)}}
  else if(b=g('[data-core-update]')){const target=$('#core-target')?.value.trim()||'latest';b.disabled=true;try{const result=await backendRequest('/api/v1/core/update',{method:'POST',body:JSON.stringify({version:target})});$('#core-message').textContent=result.message||'Обновление запущено';await refreshCoreStatus();setTimeout(()=>refreshCoreStatus().catch(()=>{}),1800)}catch(err){$('#core-message').textContent=err.message;toast(err.message)}finally{b.disabled=false}}
  else if(b=g('[data-pi]')){const x=PI[+b.dataset.pi];if(x){dlg.close();x.r()}}
  else if(g('#more'))modal(`<div class="box"><h2>Разделы</h2>${FLAT.map(([k,i,l])=>`<button class="pi" data-go="${k}">${ic(i)}<span>${l}</span></button>`).join('')}</div>`);
  else if(b=g('[data-go]')){dlg.close();location.hash=b.dataset.go}
  else if(g('#pal'))palette();
});
function renderCountryOptions(picker, query=''){
 const input=picker.querySelector('[data-country-search]'),select=picker.querySelector('input.country-value[name=flag]'),options=picker.querySelector('.country-options');
 if(!input||!select||!options)return;
 const q=String(query||'').trim().toLocaleLowerCase('ru');
 const matches=COUNTRIES.filter(c=>(c.name+' '+c.code+(c.code==='KP'?' Северная Корея КНДР North Korea DPRK':'')).toLocaleLowerCase('ru').includes(q));
 const selected=select.value;
 const custom=selected&&!COUNTRIES.some(c=>c.flag===selected)?selected:'';
 const rows=[];
 if(!q)rows.push('<button type="button" class="country-option country-option-clear" role="option" data-country-choice="" aria-selected="'+(!selected?'true':'false')+'"><span class="country-option-empty">∅</span><span class="country-option-copy"><b>Не выбрана</b><small>Очистить выбор страны</small></span></button>');
 if(custom&&(!q||custom.toLocaleLowerCase('ru').includes(q)))rows.push('<button type="button" class="country-option" role="option" data-country-choice="'+esc(custom)+'" aria-selected="true">'+flagView(custom,'country-option-flag')+'<span class="country-option-copy"><b>'+esc(custom)+'</b><small>Сохранённое значение</small></span></button>');
 rows.push(...matches.slice(0,100).map(c=>'<button type="button" class="country-option" role="option" data-country-choice="'+esc(c.flag)+'" data-country-code="'+c.code+'" aria-selected="'+(c.flag===selected?'true':'false')+'">'+flagView(c.flag,'country-option-flag')+'<span class="country-option-copy"><b>'+esc(c.name)+'</b><small>'+c.code+'</small></span>'+(c.flag===selected?'<span class="country-option-check">✓</span>':'')+'</button>'));
 if(!rows.length)rows.push('<div class="country-no-results">Страна не найдена. Попробуйте другое название или ISO-код.</div>');
 options.innerHTML=rows.join('');
 options.hidden=false;
 input.setAttribute('aria-expanded','true');
}
function closeCountryOptions(picker){
 const input=picker?.querySelector('[data-country-search]'),options=picker?.querySelector('.country-options');
 if(options)options.hidden=true;
 if(input)input.setAttribute('aria-expanded','false');
}
document.addEventListener('focusin',e=>{
 const input=e.target.closest('[data-country-search]');
 if(!input)return;
 renderCountryOptions(input.closest('.country-picker'),input.value);
});
document.addEventListener('input',e=>{
 const input=e.target.closest('[data-country-search]');
 if(!input)return;
 renderCountryOptions(input.closest('.country-picker'),input.value);
});
document.addEventListener('keydown',e=>{
 const input=e.target.closest('[data-country-search]');
 if(!input)return;
 const picker=input.closest('.country-picker'),options=picker?.querySelector('.country-options');
 if(e.key==='Escape'){closeCountryOptions(picker);return}
 if(e.key==='ArrowDown'&&options?.hidden){e.preventDefault();renderCountryOptions(picker,input.value)}
 if(e.key==='Enter'&&options&&!options.hidden){
  const first=options.querySelector('[data-country-choice]');
  if(first){e.preventDefault();first.click()}
 }
});
document.addEventListener('click',e=>{
 const choice=e.target.closest('[data-country-choice]');
 if(choice){
  const picker=choice.closest('.country-picker');
  const select=picker?.querySelector('input.country-value[name=flag]');
  const input=picker?.querySelector('[data-country-search]');
  if(!picker||!select)return;
  select.value=choice.dataset.countryChoice||'';
  if(input)input.value='';
  select.dispatchEvent(new Event('change',{bubbles:true}));
  closeCountryOptions(picker);
  return;
 }
 if(!e.target.closest('.country-picker'))document.querySelectorAll('.country-picker').forEach(closeCountryOptions);
});
document.addEventListener('change',e=>{
 const select=e.target.closest('.country-picker input.country-value[name=flag]');
 if(!select)return;
 const picker=select.closest('.country-picker');
 const country=COUNTRIES.find(c=>c.flag===select.value);
 const preview=picker.querySelector('.country-selected');
 preview.innerHTML=flagView(select.value,'country-flag-preview')+`<span data-country-label>${country?esc(country.name):select.value?esc(select.value+' Сохранённый флаг'):'Выберите страну…'}</span>`;
});
function syncTopLanguage(){
  const selected=window.XMeshI18n?.getLanguage()==='en'?'en':'ru';
  const trigger=$('#language-trigger');
  if(trigger){
    trigger.innerHTML=ic('languages')+'<span class="top-language-label">'+selected.toUpperCase()+'</span>'+ic('down');
    trigger.setAttribute('aria-label',selected==='en'?'Interface language':'Язык интерфейса');
  }
  document.querySelectorAll('#language-menu [data-panel-language]').forEach(button=>{
    const active=button.dataset.panelLanguage===selected;
    button.classList.toggle('on',active);
    button.setAttribute('aria-pressed',String(active));
  });
}
function closeTopLanguage(){
  const menu=$('#language-menu'),trigger=$('#language-trigger');
  if(menu)menu.hidden=true;
  if(trigger)trigger.setAttribute('aria-expanded','false');
}
document.addEventListener('click',e=>{
  const trigger=e.target.closest('#language-trigger');
  if(trigger){
    const menu=$('#language-menu');
    menu.hidden=!menu.hidden;
    trigger.setAttribute('aria-expanded',String(!menu.hidden));
    return;
  }
  const button=e.target.closest('#language-menu button[data-panel-language]');
  if(button){
    closeTopLanguage();
    if(!['ru','en'].includes(button.dataset.panelLanguage))return;
    if(window.XMeshI18n?.getLanguage()!==button.dataset.panelLanguage){
      window.XMeshI18n?.setLanguage(button.dataset.panelLanguage);
      syncTopLanguage();
      render(1);
    }
    return;
  }
  if(!e.target.closest('#top-language'))closeTopLanguage();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeTopLanguage()});
document.addEventListener('change',async e=>{const t=e.target;
  syncRangeProgress(t);
  if(t.id==='range-precision'){
    C.rangePrecision=t.value==='10'?10:1;
    updateVisibleRangePrecision();
    // Changing precision never modifies an existing custom value.
    try{localStorage.xmeshNexusSettings=JSON.stringify(C)}catch(e){}
    return;
  }
  if(t.matches('input[data-appearance-value]')){
    commitAppearanceNumber(t);
    return;
  }
  if(['ts','radius','gap-scale'].includes(t.id)){
    saveAppearanceControls();
    return;
  }
  if(t.id==='content-width'){
    C.contentWidth=cl(Number(t.value)||1920,720,3000);
    saveContentWidth();
    return;
  }
  if(t.id==='auto-core-refresh'||t.id==='core-refresh-seconds'){
    if(t.id==='auto-core-refresh')C.autoCoreRefresh=t.checked?1:0;
    else C.coreRefreshSeconds=Number(t.value)||30;
    apply();
    syncCoreAutoRefresh();
    toast(t.id==='auto-core-refresh'?(C.autoCoreRefresh?'Автопроверка статуса включена':'Автопроверка статуса выключена'):'Интервал проверки сохранён');
    return;
  }
  if(updatePaletteColor(t)){
    if(t.classList.contains('invalid')){t.value=t.id==='custom-a'?paletteDraft.a:paletteDraft.b;t.classList.remove('invalid');t.setAttribute('aria-invalid','false')}
    return;
  }
  if(t.dataset.tg){const [k,id]=t.dataset.tg.split(':');await api.update(k,id,{disabled:!t.checked});toast(t.checked?'Включено':'Отключено')}
  else if(t.dataset.usq){const [ui,si]=t.dataset.usq.split(':').map(Number),u=DB.users.find(x=>x.id==ui);await api.update('users',ui,{squads:t.checked?[...new Set([...u.squads,si])]:u.squads.filter(x=>x!=si)});toast('Доступ обновлён');render(1);userDrawer(ui,'acc')}
  else if(t.dataset.hw){await api.update('users',+t.dataset.hw,{hwid:+t.value||0});toast('Лимит устройств сохранён');render(1);userDrawer(+t.dataset.hw,'acc')}
  else if(t.dataset.hk){const old=DB.set.hooks[t.dataset.hk];DB.set.hooks[t.dataset.hk]=t.checked?1:0;try{await api.saveSettings({hooks:{...DB.set.hooks}});toast(t.checked?'Событие включено':'Событие отключено')}catch(err){DB.set.hooks[t.dataset.hk]=old;t.checked=!!old;toast(err.message)}}
  else if(t.dataset.psz){UQ.size=+t.value;UQ.page=1;drawUsers()}
  else if(t.id==='rail-tips'){C.railTips=t.checked?1:0;apply()}
  else if(t.id=='mo'){C.motion=t.checked?1:0;apply()}
  else if(t.id=='tplsel'){const p=DB.tpls.find(x=>x.id==t.value);if(!p)return;const f=$('form[data-k=user]');const set=(k,v)=>{const el=$(`[name=${k}]`,f);if(el)el.value=v};set('limit',p.limit);set('days',p.days);set('strategy',p.strategy);set('hwid',p.hwid);$('[name=hold]',f).checked=p.hold;$$('[name=squads]',f).forEach(c=>c.checked=p.squads.includes(+c.value))}});
/* The coarse slider uses step="any" to preserve the full 48px endpoint.
   Provide explicit keyboard increments so Arrow keys never get stuck. */
document.addEventListener('keydown',e=>{
 const input=e.target;
 if((input?.id==='text-size'?C.textPrecision:C.rangePrecision)!==10||!input?.matches?.('input[type="range"]')||!APPEARANCE_RANGE_IDS.has(input.id))return;
 const directions={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1,PageUp:1,PageDown:-1};
 const dir=directions[e.key];
 if(dir===undefined&&e.key!=='Home'&&e.key!=='End')return;
 const factor=(input.id==='ts'||input.id==='gap-scale')?100:1;
 const min=Math.round(Number(input.min)*factor),max=Math.round(Number(input.max)*factor);
 const current=Math.round(Number(input.value)*factor);
 let next;
 if(e.key==='Home')next=min;
 else if(e.key==='End')next=max;
 else if(dir>0)next=cl(Math.floor(current/10)*10+10,min,max);
 else next=cl(Math.ceil(current/10)*10-10,min,max);
 if(next===current)return;
 e.preventDefault();
 input.value=String(next/factor);
 input.dispatchEvent(new Event('input',{bubbles:true}));
 input.dispatchEvent(new Event('change',{bubbles:true}));
});
document.addEventListener('input',e=>{snapAppearanceSlider(e.target);syncRangeProgress(e.target);if(updatePaletteColor(e.target))return;if(['hue','sat','lum'].includes(e.target.id)){
  paletteDraft.h=+$('#hue').value;paletteDraft.s=+$('#sat').value;paletteDraft.l=+$('#lum').value;
  paletteDraft.a=hslHex(paletteDraft.h,paletteDraft.s,paletteDraft.l);paintPaletteDraft();
}else if(e.target.id=='ts'){C.ts=cl(+e.target.value,.9,2);showAppearanceNumber('ts');previewAppearanceControls()}else if(e.target.id=='radius'){C.radius=cl(+e.target.value,1,36);showAppearanceNumber('radius');previewAppearanceControls()}
 else if(e.target.id==='content-width'){C.contentWidth=cl(Number(e.target.value)||1920,720,3000);showAppearanceNumber('content-width');previewContentWidth()}
 else if(e.target.id==='gap-scale'){C.gapScale=+e.target.value;showAppearanceNumber('gap-scale');previewAppearanceControls()}
 if(e.target.id=='pq')pdraw(e.target.value)});
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()=='k'){e.preventDefault();palette();return}
  if(e.target.id=='pq'){if(e.key=='ArrowDown'||e.key=='ArrowUp'){e.preventDefault();const n=Math.min(PI.length,12);PX=(PX+(e.key=='ArrowDown'?1:n-1))%Math.max(n,1);$$('.pi').forEach((x,i)=>x.classList.toggle('on',i==PX));$('.pi.on')?.scrollIntoView({block:'nearest'})}if(e.key=='Enter'){e.preventDefault();const x=PI[PX];if(x){dlg.close();x.r()}}return}
  if(e.key=='/'&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)){e.preventDefault();cur=='users'?$('#uq').focus():palette()}});
document.addEventListener('submit',async e=>{const f=e.target,k=f.dataset.k;if(!k)return;const er=m=>{e.preventDefault();$('#fe')&&($('#fe').textContent=m)};
  if(k=='user'){
    e.preventDefault();
    // Prevent premature method=dialog closure, duplicate clicks and stale dialogs.
    if(f.dataset.creating==='1')return;
    const d=read(FU,f);
    if(DB.users.some(u=>u.username.toLowerCase()==d.username.toLowerCase()))return er('Такое имя уже есть. Выберите другое.');
    if(!d.squads.length)return er('Выберите хотя бы один сквад.');
    const u={username:d.username,disabled:false,hold:d.hold,holdDays:d.days||30,created:Date.now(),expireAt:d.hold||!d.days?null:Date.now()+d.days*DAY,limit:d.limit,used:0,strategy:d.strategy,tag:d.tag,tg:'',email:'',desc:d.desc,hwid:d.hwid,fingerprint:d.fingerprint||'chrome',squads:d.squads,onlineAt:0,adminId:DB.admins.find(a=>a.role==='owner')?.id||null,short:Math.floor(Math.random()*2**40).toString(36).padStart(8,'a'),xrayId:crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=crypto.getRandomValues(new Uint8Array(1))[0]&15;return(c==='x'?r:(r&3|8)).toString(16)}),xrayProfileId:d.xrayProfileId||null,devices:[]};
    const submitButton=f.querySelector('.act .btn');
    f.dataset.creating='1';
    if(submitButton)submitButton.disabled=true;
    try{
      const c=await api.create('users',u);
      let xrayWarning='';
      if(c.xrayProfileId){
        try{await syncXrayUserToProfile(c)}
        catch(error){xrayWarning='Профиль Xray не обновлён: '+(error.message||'ошибка')}
      }
      UQ.q='';UQ.st='all';UQ.sort='created';UQ.dir='desc';UQ.page=1;
      dlg.close();
      if(location.hash==='#users')render(1);
      else location.hash='users';
      // Open details only when the user chooses the toast action.
      toast(xrayWarning||`Пользователь ${c.username} создан`,'Открыть',()=>userDrawer(c.id,'ov'));
    }catch(error){er('Не удалось создать пользователя: '+(error.message||'ошибка API'))}
    finally{
      delete f.dataset.creating;
      if(submitButton?.isConnected)submitButton.disabled=false;
    }
  }
  else if(k=='uedit'){
    e.preventDefault();
    if(f.dataset.saving==='1')return;
    const d=read(FE,f),id=+f.dataset.id;
    if(DB.users.some(u=>u.username.toLowerCase()==d.username.toLowerCase()&&u.id!=id))return er('Такое имя уже есть.');
    const button=f.querySelector('[type="submit"]');f.dataset.saving='1';if(button)button.disabled=true;
    try{
      await api.update('users',id,d);
      if(dlg.open&&dlg.contains(f))dlg.close();
      toast('Изменения сохранены');render(1);
    }catch(error){er('Не удалось сохранить пользователя: '+(error.message||'ошибка API'))}
    finally{delete f.dataset.saving;if(button?.isConnected)button.disabled=false}
  }
  else if(k=='ent'){e.preventDefault();const key=f.dataset.ent,e2=ENT[key],d=read(e2.fs,f),id=f.dataset.id,m=e2.chk?.(d,+id);if(m)return er(m);
    if(key==='admins'){
      if(!id&&d.password.length<16)return er('Для нового администратора требуется пароль минимум 16 символов.');
      if(id&&!d.password)delete d.password;
      d.isActive=d.is_active;delete d.is_active;
    }
    // Keep the dialog open on API failure; close exactly once on success.
    if(f.dataset.saving==='1')return;
    const submitButton=f.querySelector('button[type="submit"],.act .btn');
    f.dataset.saving='1';
    if(submitButton)submitButton.disabled=true;
    try{
      let created=null;
      if(id){await api.update(key,id,d)}
      else{
        const o=Object.assign({disabled:false,order:DB[key].length+1,created:Date.now(),last:0,used:0,state:'OFFLINE'},d);
        created=await api.create(key,o);
      }
      if(dlg.open&&dlg.contains(f))dlg.close();
      toast(id?'Сохранено':'Создано');
      // Respect the existing optional post-create workflow without reopening this form.
      if(created&&e2.after?.(created))return render(1);
      render(1);
    }catch(error){er(error.message||'Не удалось сохранить запись.')}
    finally{
      delete f.dataset.saving;
      if(submitButton?.isConnected)submitButton.disabled=false;
    }}
  else if(k=='bulk-renew'){
    e.preventDefault();
    const value=f.querySelector('[name="days"]')?.value.trim()||'';
    const days=/^[1-9]\d*$/.test(value)?Number(value):NaN;
    if(!Number.isSafeInteger(days)||days<1||days>36500)return er('Укажите количество дней от 1 до 36500.');
    const ids=new Set(UQ.sel);
    if(!ids.size)return er('Сначала выберите пользователей.');
    try{
      await api.bulk('users',ids,u=>{u.expireAt=userExtendExpiryTimestamp(u.expireAt,days)});
      dlg.close();
      toast('Срок продлён на '+days+' дн. · '+ids.size+' польз.');
      render(1);
    }catch(error){return er('Не удалось продлить доступ: '+(error.message||'ошибка API'))}
  }
  else if(k=='bsq'){
    e.preventDefault();
    if(f.dataset.saving==='1')return;
    const d=read([{k:'squads',t:'multi'}],f),ids=new Set(UQ.sel);
    if(!ids.size)return er('Выберите пользователей.');
    if(!d.squads.length)return er('Выберите хотя бы один сквад.');
    const button=f.querySelector('[type="submit"],.act .btn');f.dataset.saving='1';if(button)button.disabled=true;
    try{
      await api.bulk('users',ids,u=>u.squads=[...new Set([...u.squads,...d.squads])]);
      if(dlg.open&&dlg.contains(f))dlg.close();
      toast('Сквады добавлены');render(1);
    }catch(error){er('Не удалось добавить в сквад: '+(error.message||'ошибка API'))}
    finally{delete f.dataset.saving;if(button?.isConnected)button.disabled=false}
  }
  else if(k=='brand'){e.preventDefault();const d=read([{k:'brand'},{k:'domain'},{k:'subscriptionBrand'},{k:'subscriptionDomain'}],f);try{await api.saveSettings(d);brand();toast('Названия и домены сохранены')}catch(err){return er(err.message)}}});
const acts2=ok=>`<div class="act"><button type="button" class="gh" data-x>Отмена</button><button class="btn">${ok}</button></div>`;
$('#theme').onclick=()=>{C.theme=document.documentElement.dataset.theme=='dark'?'light':'dark';apply();syncSubscriptionTheme();if(cur=='set')render(1)};
$('#bell').onclick=()=>{const n=[...DB.nodes.filter(x=>nstat(x)=='OFFLINE').map(x=>[x.flag+' '+x.name,'узел не отвечает']),...DB.users.flatMap(u=>st(u)=='ACTIVE'&&u.limit&&u.used/u.limit>.9?[[u.username,`использовал ${Math.round(u.used/u.limit*100)}% трафика`]]:st(u)=='ACTIVE'&&u.expireAt&&u.expireAt-Date.now()<2*DAY?[[u.username,'подписка истекает: '+left(u.expireAt)]]:[]).slice(0,8)];$('#bell .pip')?.remove();
  modal(`<div class="box"><div class="bar2"><h2>Уведомления</h2><button class="ia" data-x style="margin-left:auto" aria-label="Закрыть">${ic('x')}</button></div><div>${n.map(([a,b])=>`<div class="nt"><b>${esc(a)}</b><span class="mu">${b}</span></div>`).join('')||'<p class="note">Новых уведомлений нет.</p>'}</div></div>`,'pop')};
$('#restart').onclick=()=>{location.hash='set';setTimeout(()=>document.querySelector('#core-panel')?.scrollIntoView({behavior:'smooth',block:'start'}),100)};

document.addEventListener('click',e=>{
  const button=e.target.closest('[data-node-grid-mode]');
  if(!button)return;
  const mode=button.dataset.nodeGridMode;
  if(!['compact','standard','spacious'].includes(mode))return;
  const grid=document.querySelector('.nodes');
  if(grid)grid.dataset.gridMode=mode;
  document.querySelectorAll('[data-node-grid-mode]').forEach(item=>{
    const active=item.dataset.nodeGridMode===mode;
    item.classList.toggle('on',active);
    item.setAttribute('aria-pressed',active?'true':'false');
  });
  try{localStorage.setItem(NODE_GRID_KEY,mode)}catch(e){}
});

/* ================= СТАРТ ================= */
$('#si').innerHTML=ic('search');$('#theme').innerHTML=ic('moon').replace('class="ic"','class="ic moon"')+ic('sun').replace('class="ic"','class="ic sun"');
$('#bell').innerHTML=ic('bell');syncTopLanguage();$('#logout').innerHTML=ic('logout')+'<span class="logout-label">Выйти</span>';$('#logout').setAttribute('aria-label','Выйти');$('#addb').innerHTML='<span class="addb-icon">'+ic('plus')+'</span><span class="addb-label">Новый пользователь</span>';
$('#logout').onclick=async()=>{const button=$('#logout');button.disabled=true;try{await fetch('/api/v1/auth/logout',{method:'POST',credentials:'same-origin',cache:'no-store'});}catch(_){}backendReady=false;location.replace(location.pathname)};$('#restart').setAttribute('aria-label','Настройки Xray-core');$('#restart').dataset.railTip='Настройки Xray-core';$('#restart').innerHTML=ic('code')+'<span class="lbl">Версия</span>';
apply();matchMedia('(prefers-color-scheme: light)').addEventListener('change',()=>{apply();if(C.theme==='auto')syncSubscriptionTheme()});
addEventListener('hashchange',()=>{if(backendReady)render()});
function showAuthGate(){
  backendReady=false;
  location.replace(location.pathname);
}
async function initializePanel(){
  const response=await fetch('/api/v1/bootstrap',{credentials:'same-origin',cache:'no-store'});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error||'Не удалось загрузить данные backend.');
  const collections=payload.collections||{};
  for(const key of ['users','nodes','profiles','hosts','squads','tpls','subs','admins','tokens','srh'])DB[key]=Array.isArray(collections[key])?collections[key]:[];
  DB.set={...DB.set,...(payload.settings||{}),hooks:{...DB.set.hooks,...(payload.settings?.hooks||{})}};
  backendReady=true;
  if(sessionUser?.role==='owner')syncSubscriptionTheme();
  $('#xmesh-auth')?.remove();
  brand();render();
  refreshCoreStatus().catch(()=>{});
  syncCoreAutoRefresh();
}
async function bootPanel(){
  try{
    const response=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('Backend API не отвечает.');
    const session=await response.json();
    if(!session.authenticated){location.replace(location.pathname);return}
    sessionUser=session.user||null;
    document.documentElement.dataset.accessRole=sessionUser?.role||'viewer';
    if(sessionUser?.role!=='owner'){
      document.querySelector('a[href="#admins"]')?.remove();
      if(location.hash==='#admins')location.hash='#home';
    }
    await initializePanel();
  }catch(err){location.replace(location.pathname+'?unavailable=1')}
}
function coreStateLabel(status){
  return status==='updating'?'Обновляется':status==='ready'?'Установлено':status==='error'?'Ошибка':'Не установлено';
}
function syncCoreBadge(state){
  const el=$('#cs'),dot=$('#cd'),rail=$('#core-rail-version'),settings=$('#restart');
  const installed=typeof state.installed_version==='string'?state.installed_version.trim():'';
  const status=state.status==='updating'?'Установка Xray-core…':installed?('Версия '+installed):state.status==='error'?'Ошибка установки':'Ядро не установлено';
  if(el)el.textContent=status;
  if(rail){
    const railLabel=installed||(state.status==='updating'?'Обновление':state.status==='error'?'Ошибка':'Нет ядра');
    if(rail.textContent!==railLabel)rail.textContent=railLabel;
    rail.title='Xray-core · '+status;
  }
  if(settings)settings.title='Настройки Xray-core · '+status;
  if(dot)dot.style.setProperty('--c',state.status==='ready'?'var(--ok)':state.status==='error'?'var(--er)':state.status==='updating'?'var(--wr)':'var(--mu)');
}
async function refreshCoreStatus(showToast=false){
  const state=await backendRequest('/api/v1/core');
  syncCoreBadge(state);
  if($('#core-state'))$('#core-state').textContent=coreStateLabel(state.status);
  if($('#core-installed'))$('#core-installed').textContent=state.installed_version||'Ещё не установлена';
  if($('#core-architecture'))$('#core-architecture').textContent=state.architecture||'—';
  if($('#core-message'))$('#core-message').textContent=state.last_error||state.progress||(state.status==='ready'?'Бинарник установлен и прошёл проверку версии. Сам VPN-процесс на этом этапе не запускается.':'Ожидание установки Xray-core.');
  if(showToast)toast(state.status==='error'?(state.last_error||'Ошибка Xray-core'):state.status==='updating'?'Xray-core обновляется':'Статус Xray-core обновлён');
  if(state.status==='updating'&&$('#core-panel'))setTimeout(()=>refreshCoreStatus().catch(()=>{}),2200);
  return state;
}
let coreRefreshTimer=null,coreRefreshBusy=false;
function syncCoreAutoRefresh(){
  if(coreRefreshTimer!==null){clearInterval(coreRefreshTimer);coreRefreshTimer=null}
  if(!C.autoCoreRefresh)return;
  const seconds=[15,30,60,120].includes(Number(C.coreRefreshSeconds))?Number(C.coreRefreshSeconds):30;
  coreRefreshTimer=setInterval(async()=>{
    if(document.hidden||!backendReady||coreRefreshBusy)return;
    coreRefreshBusy=true;
    try{await refreshCoreStatus()}catch(_){}
    finally{coreRefreshBusy=false}
  },seconds*1000);
}
bootPanel().catch(err=>showAuthGate(err.message||'Ошибка запуска панели'));

