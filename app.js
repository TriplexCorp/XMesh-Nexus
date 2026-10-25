
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const cl=(v,a,b)=>Math.min(b,Math.max(a,v));
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hs=s=>[...String(s)].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7);
const panelIsEnglish=()=>window.XMeshI18n?.getLanguage()==='en';
const fmt=(v,d=0)=>(+v).toLocaleString(panelIsEnglish()?'en-US':'ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});
const gb=v=>{const en=panelIsEnglish(),unit=en?[' TB',' GB',' MB']:[' ТБ',' ГБ',' МБ'];return v>=1024?fmt(v/1024,2)+unit[0]:v>=10?fmt(v,1)+unit[1]:v>=1?fmt(v,2)+unit[1]:fmt(v*1024)+unit[2]};
const ago=t=>{if(!t)return panelIsEnglish()?'never':'никогда';const s=(Date.now()-t)/1e3;return panelIsEnglish()?(s<60?'just now':s<3600?(s/60|0)+' min ago':s<86400?(s/3600|0)+' h ago':(s/86400|0)+' days ago'):(s<60?'только что':s<3600?(s/60|0)+' мин назад':s<86400?(s/3600|0)+' ч назад':(s/86400|0)+' дн назад')};
const DAY=864e5,left=t=>{if(!t)return panelIsEnglish()?'never':'бессрочно';const d=Math.ceil((t-Date.now())/DAY);return panelIsEnglish()?(d>0?d+' days':d===0?'expires today':'expired '+(-d)+' days ago'):(d>0?d+' дн':d===0?'истёк сегодня':'истёк '+(-d)+' дн назад')};
const userExpiryCell=u=>{
  if(u.hold)return `<span class="user-expiry-primary">${esc(String(u.holdDays||0))} ${panelIsEnglish()?'days after connection':'дн после подключения'}</span>`;
  if(!u.expireAt)return `<span class="user-expiry-primary">${panelIsEnglish()?'Unlimited':'Бессрочно'}</span>`;
  const timestamp=Number(u.expireAt);
  if(!Number.isFinite(timestamp)||timestamp<=0)return '<span class="user-expiry-primary">—</span>';
  const remaining=timestamp-Date.now(),days=Math.max(0,Math.ceil(remaining/DAY));
  const date=new Date(timestamp).toLocaleDateString(panelIsEnglish()?'en-GB':'ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'});
  const label=remaining<=0?(panelIsEnglish()?'Expired':'Истёк'):(panelIsEnglish()?`Remaining: ${days} days`:`Осталось: ${days} дн`);
  return `<span class="user-expiry-primary">${label}</span><small class="user-expiry-date">${panelIsEnglish()?'Until':'До'} ${date}</small>`;
};
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
  'refresh-cw':'<path d="M20 11a8 8 0 0 0-14.3-5L3 9m0-6v6h6"/><path d="M4 13a8 8 0 0 0 14.3 5L21 15m0 6v-6h-6"/>',
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
  'git-branch':'<circle cx="6" cy="3" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 5v13M18 8v2a7 7 0 0 1-7 7H8"/>',
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
  if(button.matches('[data-x]')||button.querySelector('svg,.ic,.xray-tab-icon')||button.dataset.actionIcon==='done')return;
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
// Never restore another administrator's control-plane records from persistent
// browser storage. The API is the only source of privileged information.
try{localStorage.removeItem('xmeshNexusDB')}catch(_){}
let DB=emptyDB();
let sv,backendReady=false,sessionUser=null;
const save=()=>{}; // PostgreSQL is authoritative; no cross-role local snapshots.
const viewerMode=()=>Boolean(sessionUser&&!['owner','admin'].includes(sessionUser.role));
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
const lat=()=>Promise.resolve();
const st=u=>u.disabled?'DISABLED':u.hold?'ON_HOLD':(u.limit&&u.used>=u.limit)?'LIMITED':(u.expireAt&&u.expireAt<Date.now())?'EXPIRED':'ACTIVE';
const USER_PRESENCE_WINDOW_MS=45_000;
let presenceClockOffsetMs=0,presenceFeedHealthy=true;
const presenceNow=()=>Date.now()+presenceClockOffsetMs;
const isOn=u=>{
  const at=Number(u.onlineAt),now=presenceNow();
  return presenceFeedHealthy&&st(u)==='ACTIVE'&&Number.isSafeInteger(at)&&at>0
    &&at<=now&&at>now-USER_PRESENCE_WINDOW_MS;
};
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
  async stats(){await lat();const U=DB.users,by={};U.forEach(u=>{const status=st(u);by[status]=(by[status]||0)+1});const on=U.filter(isOn),live=DB.nodes.filter(n=>n.state==='ONLINE'&&!n.disabled),nodeOn={};
    // Count eligible users assigned to each node via its XRAY STUDIO profile and squad inbound tags.
    // This is an access count, not a per-node live connection count.
    DB.nodes.forEach(n=>{
      const profile=DB.profiles.find(p=>String(p.id)===String(n.profileId));
      const inboundTags=new Set(profile?inbs(profile).map(ib=>ib.tag).filter(Boolean):[]);
      nodeOn[n.id]=n.disabled||!inboundTags.size?0:U.filter(u=>st(u)==='ACTIVE'&&uin(u).some(tag=>inboundTags.has(tag))).length;
    });return{by,total:U.length,online:on.length,conn:null,nodeOn,nOn:live.length,nAll:DB.nodes.length};},
  async systemStats(){if(!backendReady)return null;return backendRequest('/api/v1/system/stats')}
};

/* ================= МЕТАДАННЫЕ ================= */
const STM={ACTIVE:['Активен','--ok'],DISABLED:['Отключён','--mu'],LIMITED:['Лимит','--wr'],EXPIRED:['Истёк','--er'],ON_HOLD:['Ожидает','--c3']};
const NS={ONLINE:['Онлайн','--ok'],OFFLINE:['Не отвечает','--er'],CONNECTING:['Подключение','--wr'],DISABLED:['Отключён','--mu']};
const STRAT=[['NO_RESET','Не сбрасывать'],['DAY','Каждый день'],['WEEK','Каждую неделю'],['MONTH','Каждый месяц']];
const nstat=n=>n.disabled?'DISABLED':n.state;
const NAV=[['Обзор',[['home','home','Дашборд',1],['statistics','chart-no-axes-combined','Статистика',1]]],['Управление',[['users','users','Пользователи',1],['squads','layers','Сквады'],['hosts','globe-2','Хосты'],['nodes','server','Узлы',1],['templates','file','Шаблоны'],['profiles','code','XRAY STUDIO'],['subscription','globe','SUBSCRIPTION STUDIO'],['balancers','network','Балансировщики'],['clientrouting','git-branch','Маршрутизация клиентов']]],['Инструменты',[['tools','tool','Диагностика']]],['Система',[['admins','shield','Админы'],['security','shield-check','Безопасность'],['set','sliders','Настройки']]]];
const FLAT=NAV.flatMap(g=>g[1]);
const swc=k=>r=>`<label class="sw"><input type="checkbox" data-tg="${k}:${r.id}" ${r.disabled?'':'checked'} aria-label="Включено"><span></span></label>`;
const nodeTrafficFactor=n=>{const factor=Number(n?.mult??1);return Number.isFinite(factor)&&factor>0&&factor<=1000?factor:1};
const nodeRotationIPs = node => String(node?.rotationIps||'').split(/\r?\n/).map(ip=>ip.trim()).filter(Boolean);
const nodeIpValid=address=>{
  const ip=String(address||'').trim();
  if(/^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(ip))return true;
  if(!ip.includes(':')||!/^[0-9a-fA-F:.]+$/.test(ip))return false;
  try{return new URL('http://['+ip+']/').hostname.startsWith('[')}catch{return false}
};
const nodeRotationValidate = data => {
  const ips=nodeRotationIPs(data);
  if(ips.length>256)return 'Можно добавить не более 256 IP-адресов.';
  if(new Set(ips).size!==ips.length)return 'В пуле ротации есть одинаковые IP-адреса.';
  if(ips.some(ip=>/\s/.test(ip)))return 'Введите каждый IP на отдельной строке, без порта и пробелов.';
  if(ips.some(ip=>!nodeIpValid(ip)))return 'IP-пул принимает только корректные IPv4 и IPv6, по одному адресу на строку.';
  if(data.rotationEnabled&&ips.length<2)return 'Для включения ротации добавьте минимум два разных IP-адреса.';
  return '';
};
const ENT={
  squads:{t:'Сквады',n:'Набор инбаундов: что именно получает пользователь в подписке.',s:'id',nw:'Сквад',fs:[{k:'name',l:'Название',req:1},{k:'desc',l:'Описание'},{k:'inb',l:'Инбаунды (из профилей Xray)',t:'multi',o:tags}],
    cols:[['Название',r=>`<b>${esc(r.name)}</b><br><span class="mu">${esc(r.desc)}</span>`],['Инбаунды',r=>r.inb.map(t=>chip(esc(t),tcol(t))).join(' ')||'—'],['Пользователей',r=>DB.users.filter(u=>u.squads.includes(r.id)).length]],
    guard:r=>DB.users.some(u=>u.squads.includes(r.id))?'В скваде есть пользователи. Сначала переведите их в другой сквад.':''},
  hosts:{t:'Хосты',n:'Публичные точки входа: наследование XRAY STUDIO, назначение нод и точечные переопределения для клиентов.',s:'order',nw:'Хост',mv:1,fs:[
    {k:'profileId',l:'Профиль XRAY STUDIO',t:'sel',o:()=>DB.profiles.map(p=>[p.id,p.name])},
    {k:'tag',l:'Inbound',t:'sel',o:tags},
    {k:'nodes',l:'Назначенные ноды',t:'multi',o:()=>DB.nodes.map(n=>[n.id,n.name])},
    {k:'disabled',l:'Отключить выдачу хоста в подписках',t:'bool'},
    {k:'remark',l:'Название сервера в приложении (Remarks)',req:1,h:'Например: Нидерланды. Это имя увидит клиент Happ; технические теги Xray формируются отдельно.'},
    {k:'address',l:'Публичный адрес',req:1},
    {k:'countryCode',l:'Страна (код из двух букв)',ph:'NL, DE, SE…',h:'Необязательно. Для Нидерландов укажите NL. Влияет на автогруппировку и имя технического outbound.'},
    {k:'port',l:'Публичный порт',t:'num'},
    {k:'sni',l:'SNI (переопределение)',ph:'Из inbound, если пусто'},
    {k:'host',l:'HTTP Host (переопределение)',ph:'Из inbound, если пусто'},
    {k:'path',l:'Путь транспорта (переопределение)',ph:'Из inbound, если пусто'},
    {k:'fp',l:'uTLS fingerprint',t:'sel',o:[['','По умолчанию (chrome)'],['chrome','chrome'],['firefox','firefox'],['safari','safari'],['ios','ios'],['android','android'],['edge','edge'],['360','360'],['qq','qq'],['random','random'],['randomized','randomized'],['randomizednoalpn','randomizednoalpn'],['unsafe','unsafe'],['hellofirefox_120','hellofirefox_120'],['hellofirefox_148','hellofirefox_148'],['hellochrome_120','hellochrome_120'],['hellochrome_131','hellochrome_131'],['hellochrome_133','hellochrome_133'],['helloios_13','helloios_13'],['helloios_14','helloios_14'],['helloedge_106','helloedge_106'],['hellosafari_26_3','hellosafari_26_3'],['hello360_11_0','hello360_11_0'],['helloqq_11_1','helloqq_11_1'],['hellogolang','hellogolang'],['hellorandomized','hellorandomized'],['hellorandomizedalpn','hellorandomizedalpn'],['hellorandomizednoalpn','hellorandomizednoalpn'],['hellofirefox_auto','hellofirefox_auto'],['hellofirefox_55','hellofirefox_55'],['hellofirefox_56','hellofirefox_56'],['hellofirefox_63','hellofirefox_63'],['hellofirefox_65','hellofirefox_65'],['hellofirefox_99','hellofirefox_99'],['hellofirefox_102','hellofirefox_102'],['hellofirefox_105','hellofirefox_105'],['hellochrome_auto','hellochrome_auto'],['hellochrome_58','hellochrome_58'],['hellochrome_62','hellochrome_62'],['hellochrome_70','hellochrome_70'],['hellochrome_72','hellochrome_72'],['hellochrome_83','hellochrome_83'],['hellochrome_87','hellochrome_87'],['hellochrome_96','hellochrome_96'],['hellochrome_100','hellochrome_100'],['hellochrome_102','hellochrome_102'],['hellochrome_106_shuffle','hellochrome_106_shuffle'],['helloios_auto','helloios_auto'],['helloios_11_1','helloios_11_1'],['helloios_12_1','helloios_12_1'],['helloandroid_11_okhttp','helloandroid_11_okhttp'],['helloedge_85','helloedge_85'],['helloedge_auto','helloedge_auto'],['hellosafari_16_0','hellosafari_16_0'],['hellosafari_auto','hellosafari_auto'],['hello360_auto','hello360_auto'],['hello360_7_5','hello360_7_5'],['helloqq_auto','helloqq_auto'],['hellochrome_100_psk','hellochrome_100_psk'],['hellochrome_112_psk_shuf','hellochrome_112_psk_shuf'],['hellochrome_114_padding_psk_shuf','hellochrome_114_padding_psk_shuf'],['hellochrome_115_pq','hellochrome_115_pq'],['hellochrome_115_pq_psk','hellochrome_115_pq_psk'],['hellochrome_120_pq','hellochrome_120_pq']]},
    {k:'publicKey',l:'REALITY publicKey (клиентский)',ph:'Если отсутствует в inbound'},
    {k:'shortId',l:'REALITY shortId',ph:'Первый ShortID inbound'},
    {k:'spiderX',l:'REALITY spiderX',ph:'/'},
    {k:'alpn',l:'TLS ALPN',ph:'h2,http/1.1'},
    {k:'serviceName',l:'gRPC serviceName',ph:'Из inbound'},
    {k:'clientEncryption',l:'VLESS Encryption (клиент)',ph:'Наследуется из inbound или пользователя'}
  ],
    def:()=>({port:443,fp:'',order:DB.hosts.length+1,nodes:[],profileId:DB.profiles[0]?.id||0}),
    chk:d=>{
      if(d.disabled)return '';
      if(!d.remark.trim()||!d.address.trim())return 'Укажите название и публичный адрес.';
      if(!Number.isInteger(d.port)||d.port<1||d.port>65535)return 'Публичный порт должен быть от 1 до 65535.';
      const profile=DB.profiles.find(p=>String(p.id)===String(d.profileId));
      if(!profile)return 'Выберите существующий профиль XRAY STUDIO.';
      const inbound=inbs(profile).find(i=>i.tag===d.tag);
      if(!inbound)return 'Выберите inbound из назначенного XRAY-профиля.';
      if(inbound.protocol!=='vless')return 'Генератор подписок пока поддерживает только VLESS. Выберите VLESS inbound.';
      if(!d.nodes.length)return 'Назначьте хотя бы одну ноду с выбранным профилем.';
      const bad=d.nodes.map(id=>DB.nodes.find(n=>String(n.id)===String(id))).find(n=>!n||n.disabled||String(n.profileId)!==String(profile.id));
      if(bad)return 'Одна из нод не использует выбранный XRAY-профиль или отключена. Исправьте привязку ноды.';
      const reality=inbound.streamSettings?.realitySettings||{};
      if(inbound.streamSettings?.security==='reality' &&
         !(d.publicKey||inbound.publicKey||reality.publicKey))
        return 'REALITY publicKey отсутствует. Укажите публичную часть ключа в расширенных настройках хоста (не privateKey).';
      if(inbound.streamSettings?.security==='reality' &&
         !(d.sni||reality.serverNames?.[0]))
        return 'REALITY требует SNI: укажите его в профиле или в хосте.';
      if(d.publicKey&&!/^[A-Za-z0-9_-]{43,44}$/.test(d.publicKey))return 'REALITY publicKey должен быть в формате X25519 base64url (43–44 символа).';
      if(d.shortId&&(!/^[\da-fA-F]*$/.test(d.shortId)||d.shortId.length>16||d.shortId.length%2!==0))return 'REALITY shortId должен быть чётной длины, hex до 16 символов.';
      return '';
    },
    cols:[['Название',r=>'<b>'+esc(r.remark)+'</b>'],['Адрес',r=>esc(r.address)+':'+esc(r.port)],['Профиль / inbound',r=>{
      const p=DB.profiles.find(p=>String(p.id)===String(r.profileId));
      return (p?esc(p.name)+' · ':'')+chip(esc(r.tag),tcol(r.tag));
    }],['Привязки',r=>Array.isArray(r.nodes)&&r.nodes.length?r.nodes.map(i=>flagView(DB.nodes.find(n=>String(n.id)===String(i))?.flag)).join(' '):'не заданы'],
      ['Готовность',r=>{const p=hostProfile(r.profileId),i=p&&hostInbound(p.id,r.tag);
        if(!p||!i)return chip('Профиль / inbound отсутствует','--er');
        if(!Array.isArray(r.nodes)||!r.nodes.length||r.nodes.some(id=>!DB.nodes.some(n=>String(n.id)===String(id)&&String(n.profileId)===String(p.id)&&!n.disabled)))return chip('Ошибка привязки нод','--er');
        if(i.streamSettings?.security==='reality'&&!(r.publicKey||i.publicKey||i.streamSettings?.realitySettings?.publicKey))return chip('Нет REALITY publicKey','--wr');
        return chip(r.disabled?'Выключен':'Настроен',r.disabled?'--mu':'--ok');
      }],['Вкл.',swc('hosts')]]},
  nodes:{t:'Узлы',nw:'Узел',s:'id',fs:[{k:'name',l:'Название',req:1},{k:'hosting',l:'Хостинг (необязательно)',h:'Например: Cloudrix, Hetzner, OVH. Отображается в карточке узла.'},{k:'flag',l:'Страна и флаг',t:'country'},{k:'addr',l:'Адрес ноды',req:1,ph:'1.2.3.4, 2001:db8::1 или nl1.example.com',h:'IPv4, IPv6 без скобок или домен. Порт указывается отдельно.'},{k:'port',l:'Порт ноды',t:'num',req:1},{k:'profileId',l:'XRAY STUDIO',t:'sel',o:()=>DB.profiles.map(p=>[p.id,p.name])},{k:'xrayLocalPort',l:'Локальный порт Xray',t:'num',h:'Планируемый порт Xray на 127.0.0.1; не является публичным портом ноды. Настройка пока не применяется автоматически.'},{k:'mult',l:'Коэффициент трафика',t:'num',h:'1 — без изменений, 2 — считать вдвое'},{k:'limit',l:'Лимит трафика, ГБ',t:'num',h:'0 — без лимита'},{k:'resetDay',l:'День сброса счётчика',t:'num'},
    {k:'billingPrice',l:'Стоимость аренды',t:'num'},
    {k:'billingCurrency',l:'Валюта',t:'sel',o:[['EUR','EUR · €'],['USD','USD · $'],['RUB','RUB · ₽'],['PLN','PLN · zł'],['GBP','GBP · £']]},
    {k:'billingDueDate',l:'Оплачено до',ph:'ГГГГ-ММ-ДД'},
    {k:'billingPeriod',l:'Период оплаты',t:'sel',o:[['monthly','Ежемесячно'],['quarterly','Раз в 3 месяца'],['yearly','Ежегодно'],['custom','Другой']]},
    {k:'billingRemindDays',l:'Напомнить за, дней',t:'num'},
    {k:'billingProviderUrl',l:'Сайт провайдера',ph:'https://provider.example'},
    {k:'billingNote',l:'Примечание по оплате'},
    {k:'rotationEnabled',l:'Ротация IP-адресов',t:'bool',h:'Пул IP-адресов для подключений узла. Используйте только назначенные серверу адреса.'},
    {k:'rotationIntervalHours',l:'Смена адреса каждые, ч',t:'num',h:'1–720 часов. По умолчанию 24. Адрес закреплён за пользователем между обновлениями подписки.'},
    {k:'rotationIps',l:'Пул внешних IP-адресов',t:'area',rows:7,h:'Один IPv4 или IPv6 на строку. Добавляйте только IP, реально назначенные VPS и доступные клиентам. До 256 адресов. Основной адрес узла остаётся прежним.'}],

    def:()=>({flag:'',mult:1,limit:0,resetDay:1,rotationEnabled:false,rotationIntervalHours:24,rotationIps:'',billingCurrency:'EUR',billingPeriod:'monthly',billingRemindDays:7,billingPrice:0}),
    chk:data=>{
      const address=String(data.addr??'');
      const ipv4=address.split('.');
      const isIPv4=ipv4.length===4&&ipv4.every(part=>/^\d{1,3}$/.test(part)&&Number(part)<=255);
      const isIPv6=(()=>{if(!address.includes(':')||!/^[0-9a-fA-F:]+$/.test(address))return false;
        try{return new URL('http://['+address+']/').hostname.startsWith('[')}catch{return false}
      })();
      const isDomain=address.length<=253&&/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/.test(address)
        &&address.split('.').every(label=>label.length<=63&&!label.startsWith('-')&&!label.endsWith('-'))
        &&!/^[0-9.]+$/.test(address);
      if(!address||address!==address.trim()||!(isIPv4||isIPv6||isDomain))
        return 'Укажите корректный IPv4, IPv6 без скобок или домен без порта.';
      const issue=nodeRotationValidate(data);if(issue)return issue;
      const interval=Number(data.rotationIntervalHours||24);
      if(data.rotationEnabled&&(!Number.isInteger(interval)||interval<1||interval>720))return 'Интервал IP-ротации должен быть от 1 до 720 часов.';
      const port=Number(data.xrayLocalPort||0),nodePort=Number(data.port||0);
      if(port&&(!Number.isInteger(port)||port<1||port>65535))return 'Локальный порт Xray должен быть от 1 до 65535.';
      if(port&&port===nodePort)return 'Порт Xray должен отличаться от порта XMesh Node на том же сетевом интерфейсе.';
      if(data.billingDueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(data.billingDueDate))return 'Дата аренды: ГГГГ-ММ-ДД.';
      if(data.billingDueDate&&!Number.isFinite(Date.parse(data.billingDueDate+'T00:00:00Z')))return 'Некорректная дата аренды.';
      if(data.billingProviderUrl&&!/^https:\/\//.test(data.billingProviderUrl))return 'Укажите HTTPS-ссылку провайдера.';
      return '';
    },
    guard:r=>''},
  tpls:{t:'Шаблоны пользователей',n:'Готовые тарифы: выбираются при создании и подставляют лимиты, срок и доступ.',s:'id',nw:'Шаблон',fs:[{k:'name',l:'Название',req:1},{k:'limit',l:'Лимит, ГБ',t:'num',h:'0 — без лимита'},{k:'days',l:'Срок, дней',t:'num',h:'0 — бессрочно'},{k:'strategy',l:'Сброс трафика',t:'sel',o:STRAT},{k:'hwid',l:'Лимит устройств',t:'num'},{k:'squads',l:'Сквады',t:'multi',o:()=>DB.squads.map(s=>[s.id,s.name])},{k:'hold',l:'Отсчёт срока с первого подключения',t:'bool'}],def:()=>({strategy:'NO_RESET',hwid:2,squads:[]}),
    cols:[['Название',r=>`<b>${esc(r.name)}</b>`],['Трафик',r=>r.limit?r.limit+' ГБ':'∞'],['Срок',r=>r.days?r.days+' дн':'∞'],['Устройств',r=>r.hwid],['Сквады',r=>r.squads.map(i=>chip(esc(DB.squads.find(s=>s.id==i)?.name||'?'),'--b')).join(' ')],['Режим',r=>r.hold?chip('on hold','--c3'):'—']]},
  subs:{t:'Шаблоны подписки',n:'Что получает клиентское приложение: формат и содержимое конфигурации.',s:'id',nw:'Шаблон',fs:[{k:'name',l:'Название',req:1},{k:'fmt',l:'Формат',t:'sel',o:FMT},{k:'content',l:'Содержимое',t:'area',rows:9}],def:()=>({fmt:'XRAY_JSON',content:'{}'}),
    cols:[['Название',r=>`<b>${esc(r.name)}</b>`],['Формат',r=>chip(r.fmt,'--c3')],['Размер',r=>r.content.length+' симв.']]},
  profiles:{t:'XRAY STUDIO',n:'Серверные конфигурации и публичные подключения. Инбаунды назначаются сквадам.',s:'id',nw:'Профиль',fs:[{k:'name',l:'Название',req:1},{k:'config',l:'Конфигурация (JSON)',t:'area',rows:16,h:'Вставьте полный конфиг Xray. В нём должен быть хотя бы один inbound.'}],def:()=>({config:''}),
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
const FU=[{k:'username',l:'Имя пользователя',req:1,pat:'[A-Za-z0-9_.\\-]{3,32}',h:'3–32 символа: латиница, цифры, _ . -'},{k:'xrayProfileId',l:'Xray-профиль',t:'sel',o:()=>[['','Не привязывать'],...DB.profiles.map(p=>[String(p.id),p.name])],h:'При выборе панель добавит учётные данные в inbound профиля.'},{k:'limit',l:'Лимит трафика, ГБ',t:'num',h:'0 — без лимита'},{k:'days',l:'Срок, дней',t:'num',h:'0 — бессрочно'},{k:'strategy',l:'Сброс трафика',t:'sel',o:STRAT},{k:'hwid',l:'Лимит устройств',t:'num'},{k:'tag',l:'Тег',ph:'например, vip'},{k:'squads',l:'Сквады',t:'multi',o:()=>DB.squads.map(s=>[s.id,s.name])},{k:'hold',l:'Отсчёт срока с первого подключения (on hold)',t:'bool'},{k:'desc',l:'Заметка'}];
const FE=[{k:'username',l:'Имя пользователя',req:1,pat:'[A-Za-z0-9_.\\-]{3,32}'},{k:'limit',l:'Лимит, ГБ',t:'num',h:'0 — без лимита'},{k:'expireAt',l:'Действует до',t:'date',h:'Пусто — бессрочно'},{k:'strategy',l:'Сброс трафика',t:'sel',o:STRAT},{k:'tag',l:'Тег'},{k:'tg',l:'Telegram ID'},{k:'email',l:'Email'},{k:'desc',l:'Заметка'}];

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
    i=`<div class="country-picker country-picker-dropdown">
      <button type="button" class="country-trigger" data-country-trigger aria-haspopup="listbox" aria-expanded="false" aria-controls="country-options-${f.k}"><span class="country-trigger-value">${flagView(current,'country-flag-preview')}<span data-country-label>${existing?esc(existing.name):current?esc(current+' Сохранённый флаг'):'Выберите страну…'}</span></span><span class="country-trigger-chevron">⌄</span></button>
      <div class="country-dropdown" hidden><div class="country-search-wrap"><input class="country-search" type="search" data-country-search placeholder="Поиск страны или кода…" aria-label="Поиск страны" autocomplete="off" aria-controls="country-options-${f.k}" aria-expanded="false"></div><div class="country-options" id="country-options-${f.k}" role="listbox" aria-label="Результаты поиска стран" hidden></div></div>
      <input type="hidden" name="${f.k}" class="country-value" value="${esc(current)}">
    </div>`
  }
  else if(t=='sel')i=`<select name="${f.k}">${opt(f.o).map(([a,b])=>`<option value="${esc(a)}"${a==v?' selected':''}>${esc(b)}</option>`).join('')}</select>`;
  else if(t=='multi')i=`<div class="ms">${opt(f.o).map(([a,b])=>`<label class="ck"><input type="checkbox" name="${f.k}" value="${esc(a)}"${(v||[]).map(String).includes(String(a))?' checked':''}><span>${esc(b)}</span></label>`).join('')||'<span class="mu">Нет вариантов</span>'}</div>`;
  else if(t=='area')i=`<textarea name="${f.k}" rows="${f.rows||8}" spellcheck="false">${esc(v)}</textarea>`;
  else if(t=='bool')i=`<span class="sw"><input type="checkbox" name="${f.k}"${v?' checked':''}><span></span></span>`;
  else i=`<input name="${f.k}" type="${t=='num'?'number':t=='date'?'date':t=='password'?'password':'text'}"${t=='num'?' min="0" step="any"':''}${f.req?' required':''}${f.pat?` pattern="${f.pat}"`:''} value="${esc(t=='date'&&v?new Date(v).toLocaleDateString('sv'):v)}" placeholder="${esc(f.ph||'')}" autocomplete="off">`;
  const g=t=='multi'?'div':'label';return `<${g} class="f"><span>${f.l}</span>${i}${f.h?`<small>${f.h}</small>`:''}</${g}>`;
}
function read(fs,form){const d={};fs.forEach(f=>{const e=$$(`[name="${f.k}"]`,form);if(f.t=='multi')d[f.k]=e.filter(x=>x.checked).map(x=>isNaN(+x.value)?x.value:+x.value);else if(f.t=='bool')d[f.k]=e[0].checked;else if(f.t=='num')d[f.k]=+e[0].value||0;else if(f.t=='date')d[f.k]=e[0].value?new Date(e[0].value+'T23:59:59').getTime():null;else if(f.t=='sel')d[f.k]=f.k==='fp'?e[0].value:(isNaN(+e[0].value)?e[0].value:+e[0].value);else d[f.k]=e[0].value.trim()});return d}

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
 if(viewerMode()&&c==='user-modal'){
   dlg.querySelectorAll('input,textarea,select').forEach(el=>{el.disabled=true});
   dlg.querySelectorAll('button').forEach(el=>{
     if(!el.matches('[data-x],[data-user-traffic-refresh]'))el.disabled=true;
   });
   dlg.classList.add('viewer-readonly');
   const subscriptionStatus=dlg.querySelector('[data-user-sub-state]');
   if(subscriptionStatus)subscriptionStatus.textContent='Доступ к ссылкам подписки ограничен для наблюдателя.';

 }
 if(!replacing)dlg.showModal();
 else if(C.motion&&typeof dlg.firstElementChild?.animate==='function'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  dlg.firstElementChild.animate([
   {opacity:.6,transform:'translateY(7px) scale(.988)'},
   {opacity:1,transform:'translateY(0) scale(1)'}
  ],{duration:220,easing:'cubic-bezier(.2,.8,.25,1)'});
 }
};
dlg.addEventListener('click',e=>{if(e.target==dlg||e.target.closest('[data-x]'))dlg.close()});
// Non-destructive branded confirmation: a second dialog preserves the editing form.
const panelConfirm=(message,{danger=false,title='Подтверждение',confirmLabel='Продолжить'}={})=>new Promise(resolve=>{
 const dialog=document.createElement('dialog');
 dialog.className='xm-action-confirm';
 const box=document.createElement('div');box.className='xm-action-confirm-box';
 const iconWrap=document.createElement('div');iconWrap.className='xm-action-confirm-icon';
 iconWrap.innerHTML=ic(danger?'alert-triangle':'shield-check');
 const heading=document.createElement('h2');heading.textContent=title;
 const body=document.createElement('p');body.textContent=message;
 const actions=document.createElement('div');actions.className='xm-action-confirm-actions';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='gh';cancel.textContent='Отмена';
 const accept=document.createElement('button');accept.type='button';accept.className=danger?'dg':'btn';accept.textContent=confirmLabel;
 actions.append(cancel,accept);box.append(iconWrap,heading,body,actions);dialog.append(box);document.body.append(dialog);
 let settled=false;
 const finish=value=>{if(settled)return;settled=true;resolve(value);dialog.close();dialog.remove()};
 cancel.addEventListener('click',()=>finish(false));accept.addEventListener('click',()=>finish(true));
 dialog.addEventListener('cancel',ev=>{ev.preventDefault();finish(false)});
 dialog.addEventListener('click',ev=>{if(ev.target===dialog)finish(false)});
 dialog.showModal();cancel.focus();
});
// Explicit release picker, preserving the existing page and its scroll state.
// Open immediately. Resolve releases asynchronously inside the dialog.
const selectNodeXrayRelease=(node,load,installed)=>new Promise(resolve=>{
 const dialog=document.createElement('dialog');dialog.className='xm-action-confirm xray-release-dialog';
 const box=document.createElement('div');box.className='xm-action-confirm-box';
 const title=document.createElement('h2');title.textContent='Версия Xray · '+(node.name||'Узел');
 const description=document.createElement('p');description.textContent='Текущая версия: '+(installed||'определяем…')+' · Установка может прервать соединения.';
 const search=document.createElement('input');search.type='search';search.className='xray-release-search';search.placeholder='Поиск версии Xray';search.setAttribute('aria-label','Поиск релиза Xray');search.disabled=true;
 const status=document.createElement('p');status.className='xray-release-loading';status.setAttribute('role','status');status.innerHTML='<span class="xray-release-spinner" aria-hidden="true"></span><span>Загружаем официальные релизы…</span>';
 const list=document.createElement('div');list.className='xray-release-list';list.setAttribute('role','radiogroup');list.setAttribute('aria-label','Версии Xray');
 const info=document.createElement('p');info.className='xray-release-info';
 const link=document.createElement('a');link.target='_blank';link.rel='noopener noreferrer';link.textContent='Открыть релиз на GitHub ↗';link.hidden=true;
 const actions=document.createElement('div');actions.className='xm-action-confirm-actions';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='gh';cancel.textContent='Отмена';
 const accept=document.createElement('button');accept.type='button';accept.className='btn';accept.textContent='Установить версию';accept.disabled=true;
 actions.append(cancel,accept);box.append(title,description,search,status,list,info,link,actions);dialog.append(box);document.body.append(dialog);
 let finished=false,releases=[],selected='';
 const finish=v=>{if(finished)return;finished=true;resolve(v);dialog.close();dialog.remove()};
 const render=()=>{
  list.replaceChildren();
  const query=search.value.trim().toLowerCase();
  const matches=releases.filter(r=>r.version.toLowerCase().includes(query));
  if(!matches.length){const empty=document.createElement('p');empty.className='xray-release-empty';empty.textContent='По вашему запросу версии не найдены';list.append(empty)}
  for(const item of matches){
   const installedHere=item.version.replace(/^v/,'')===String(installed||'').replace(/^v/,'');
   const row=document.createElement('button');row.type='button';row.className='xray-release-row'+(selected===item.version?' is-selected':'');
   row.setAttribute('role','radio');row.setAttribute('aria-checked',String(selected===item.version));
   const name=document.createElement('strong');name.textContent=item.version;
   const meta=document.createElement('span');meta.className='xray-release-meta';meta.textContent=installedHere?'Установлена':item.prerelease?'Предварительная':'Стабильная';
   row.append(name,meta);row.addEventListener('click',()=>{selected=item.version;render()});list.append(row);
  }
  const chosen=releases.find(r=>r.version===selected);
  const installedChosen=selected.replace(/^v/,'')===String(installed||'').replace(/^v/,'');
  accept.disabled=!chosen||installedChosen;
  info.textContent=chosen?(chosen.prerelease?'Предварительный релиз':'Стабильный релиз')+' · '+(chosen.published_at||'Дата не указана'):'Выберите версию из списка';
  const url=String(chosen?.url||'');
  if(/^https:\/\/github\.com\/XTLS\/Xray-core\/releases\/tag\/[A-Za-z0-9._+%-]+$/i.test(url)){link.href=url;link.hidden=false}
  else{link.removeAttribute('href');link.hidden=true}
 };
 search.addEventListener('input',render);
 cancel.addEventListener('click',()=>finish(null));accept.addEventListener('click',()=>finish(selected));
 dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null)});
 dialog.addEventListener('click',e=>{if(e.target===dialog)finish(null)});
 dialog.showModal();
 Promise.resolve().then(load).then(result=>{
  if(finished)return;
  installed=result.installed||installed;releases=(result.releases||[]).filter(r=>/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(r.version));
  status.remove();search.disabled=false;
  if(!releases.length){info.textContent='Не удалось получить список релизов. Повторите попытку.';return}
  selected=releases.find(r=>r.version.replace(/^v/,'')===String(installed||'').replace(/^v/,''))?.version||releases.find(r=>!r.prerelease)?.version||releases[0].version;
  description.textContent='Текущая версия: '+(installed||'неизвестно')+' · Установка может прервать соединения.';
  render();search.focus();
 }).catch(error=>{if(finished)return;status.remove();info.textContent='Не удалось загрузить версии: '+(error.message||'ошибка сети');});
});
const confirmBox=(h,ok,fn)=>{CF=fn;modal(`<div class="box"><h2>${h}</h2><div class="act"><button class="gh" data-x>Отмена</button><button class="btn" data-cf>${ok}</button></div></div>`)};
let tt;const toast=(m,al,fn)=>{
 // A manual popover participates in the browser top layer above modal dialogs.
 // A document-level fixed toast cannot reliably appear above showModal().
 let t=document.getElementById('xmesh-feedback-toast');
 if(!t){
  t=document.createElement('div');
  t.id='xmesh-feedback-toast';
  t.className='toast-dialog';
  t.setAttribute('popover','manual');
  t.setAttribute('aria-live','polite');
  document.body.append(t);
 }
 const msg=String(m||'');
 const isError=/ошиб|не удалось|нельзя|отказ|ошибк|недоступ|превыш|запрещ/i.test(msg);
 t.classList.toggle('toast-error',isError);
 t.classList.toggle('toast-success',!isError);
 t.innerHTML=`<span class="toast-state-icon" aria-hidden="true">${ic(isError?'alert-circle':'check-circle')}</span><span>${esc(msg)}</span>${al?'<button type="button" class="toast-action">'+esc(al)+'</button>':''}`;
 const close=()=>{t.classList.remove('show');if(t.matches(':popover-open'))t.hidePopover()};
 if(al)t.querySelector('.toast-action').onclick=()=>{fn?.();close()};
 t.setAttribute('role',isError?'alert':'status');
 // Place feedback directly below the active dialog; outside dialogs, use
 // the standard bottom-center position. Clamp to the viewport on small screens.
 const host=[...document.querySelectorAll('dialog[open]')].at(-1);
 t.classList.toggle('toast-below-dialog',!!host);
 if(!t.matches(':popover-open'))t.showPopover();
 t.classList.remove('show');
 if(host){
  const rect=host.getBoundingClientRect();
  const height=t.getBoundingClientRect().height||44;
  const below=rect.bottom+12;
  const above=rect.top-height-12;
  const top=below+height<=innerHeight-12?below:above>=12?above:Math.max(12,innerHeight-height-12);
  t.style.setProperty('--toast-top',top+'px');
  t.style.setProperty('--toast-left',Math.min(innerWidth-16,Math.max(16,rect.left+rect.width/2))+'px');
 }else{
  t.style.removeProperty('--toast-top');
  t.style.removeProperty('--toast-left');
 }
 void t.offsetWidth;t.classList.add('show');
 clearTimeout(tt);tt=setTimeout(close,al?6000:3600);
};
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
 syncSubscriptionTheme();
};
const brand=()=>{$('#bn').textContent=DB.set.brand;$('#lg').textContent=(DB.set.brand[0]||'L').toUpperCase()};

let T=[],cur='',RT=0;
// The panel theme is browser-local; subscription appearance is saved via API.
const panelSubscriptionTheme=()=>{
 const root=document.documentElement,style=getComputedStyle(root);
 const color=(token,fallback)=>{
  // CSS variables may be RGB or nested custom properties; never silently
  // persist an unrelated fallback accent when the owner changes the theme.
  let value=style.getPropertyValue(token).trim();
  for(let depth=0;depth<3&&/^var\(--[\w-]+\)$/.test(value);depth++){
    value=style.getPropertyValue(value.slice(4,-1)).trim();
  }
  if(/^#[\da-f]{6}$/i.test(value))return value.toLowerCase();
  const match=/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+[\d.]+)?\s*\)$/i.exec(value);
  if(match)return '#'+match.slice(1,4).map(part=>Math.max(0,Math.min(255,+part)).toString(16).padStart(2,'0')).join('');
  return fallback;
 };
 return {
  subscriptionAccent:color('--a','#74ddb1'),
  subscriptionSecondaryAccent:color('--b','#c6e985'),
  subscriptionTheme:root.dataset.theme==='light'?'light':'dark',
  subscriptionBackground:color('--bg','#0a0e14'),
  subscriptionCardColor:color('--s1','#131923'),
  subscriptionTextColor:color('--tx','#edf3f5'),
  subscriptionFont:C.font||'system',
  subscriptionRadius:Math.round(cl(Number(C.radius)||16,1,36)),
  subscriptionCardStyle:C.surface==='glass'?'glass':C.surface==='raised'?'raised':'soft'
 };
};
let subscriptionThemeSync=Promise.resolve();
const syncSubscriptionTheme=()=>{
 if(!backendReady||sessionUser?.role!=='owner'||DB.set.subscriptionSyncPanelTheme===false)return subscriptionThemeSync;
 // Serialize writes, but always read the current appearance after apply()
 // rather than a stale snapshot from another theme or browser session.
 subscriptionThemeSync=subscriptionThemeSync.catch(()=>{}).then(async()=>{
  if(DB.set.subscriptionSyncPanelTheme===false)return;
  const theme=panelSubscriptionTheme();
  const patch=Object.fromEntries(Object.entries(theme).filter(([key,value])=>DB.set[key]!==value));
  if(Object.keys(patch).length)await api.saveSettings(patch);
 }).catch(error=>toast('Не удалось синхронизировать тему подписки: '+(error.message||'API')));
 return subscriptionThemeSync;
};
const subscriptionStudioP=()=>window.XMeshSubscriptionStudio.create(DB.set,patch=>api.saveSettings(patch),toast,{users:DB.users.length,nodes:DB.nodes.length},panelSubscriptionTheme);
// Balancers are an explicit subscription feature, never inferred from node count.
// Keeping this as a separate workspace prevents accidental SMART activation.
const balancersP=async()=>{
 // Balancer selectors are stable record identities, never positional Xray tags.
 const choices=[];
 const enabledHosts=DB.hosts.filter(h=>!h.disabled);
 for(const h of enabledHosts){
  if(!Number.isSafeInteger(Number(h.id))||Number(h.id)<=0)continue;
  choices.push({key:'host:'+h.id,label:h.remark||h.name||h.address||h.tag||('Хост #'+h.id),
   meta:'Хост · '+(h.tag||'без тега')});
 }
 // Node fallback entries exist only when no explicit public host is assigned
 // to that inbound. The backend is the final authority for availability.
 for(const n of DB.nodes.filter(n=>!n.disabled)){
  const p=DB.profiles.find(p=>String(p.id)===String(n.profileId));
  if(!p)continue;
  for(const inbound of inbs(p)){
   const tag=inbound.tag;
   if(!tag||enabledHosts.some(h=>h.tag===tag && (!h.profileId||String(h.profileId)===String(p.id))))continue;
   const key='node:'+n.id+':'+tag;
   if(choices.some(c=>c.key===key))continue;
   choices.push({key,label:(n.name||'Узел #'+n.id)+' · '+tag,meta:'Узел · резервный адрес'});
  }
 }
 const stored=Array.isArray(DB.set.clientBalancers)?DB.set.clientBalancers:[];
 let draft=stored.map(row=>({...row,selector:[...(row.selector||[])],
   observatory:{...(row.observatory||{})}}));
 const options=[['leastPing','Наименьшая задержка'],['roundRobin','По очереди'],['random','Случайный сервер']];
 const field=(label,name,value,placeholder='',max=160)=>
  '<label class="f"><span>'+label+'</span><input data-balancer-field="'+name+'" maxlength="'+max+'" value="'+esc(value||'')+'" placeholder="'+esc(placeholder)+'"></label>';
 const view=()=>{
  const root=$('#balancers-list');
  if(!root)return;
  root.innerHTML=draft.length?draft.map((item,index)=>{
   const selected=new Set(item.selector||[]);
   const obs=item.observatory||{};
   // Never drop a saved selection just because its node is temporarily
   // unavailable or no longer listed. The administrator must uncheck it.
   const missing=[...selected].filter(key=>!choices.some(c=>c.key===key));
   const sourceChoices=[...choices,...missing.map(key=>({
      key,label:'Недоступный сервер · '+key,meta:'Сохранённый выбор, проверьте привязку'
   }))];
   const visible=(sourceChoices.length?sourceChoices.map(c=>
      '<label class="balancer-source"><input type="checkbox" data-balancer-source="'+esc(c.key)+'"'+(selected.has(c.key)?' checked':'')+'>'+
      '<span><strong>'+esc(c.label)+'</strong><small>'+esc(c.meta)+'</small></span></label>').join(''):
      '<p class="note">Добавьте хосты или узлы и назначьте им профиль XRAY STUDIO.</p>');
   return '<section class="card balancer-editor" data-balancer-index="'+index+'">'+
    '<div class="balancer-editor-head"><div><span class="balancer-seq">#'+(index+1)+'</span><strong>'+esc(item.remark||'Новый балансировщик')+'</strong></div>'+
    '<button type="button" class="gh sm" data-balancer-delete="'+index+'">'+ic('trash')+'Удалить</button></div>'+
    '<div class="balancer-edit-grid">'+field('Remark','remark',item.remark,'🇩🇪 Лучший — Германия {STATUS_EMOJI}',120)+
       field('Tag (уникальный)','tag',item.tag,'DE_BEST',64)+
       field('Описание','serverDescription',item.serverDescription,'Самый быстрый сервер',240)+
       '<label class="f"><span>Стратегия</span><select data-balancer-field="strategy">'+
       options.map(([k,label])=>'<option value="'+k+'"'+(item.strategy===k?' selected':'')+'>'+label+'</option>').join('')+
       '</select></label></div>'+
    '<div class="balancer-source-heading"><strong>Серверы для выбора</strong><span>Отметьте нужные галочками</span></div>'+
    '<div class="balancer-source-grid">'+visible+'</div>'+
    '<div class="balancer-checks"><label><input type="checkbox" data-balancer-field="enabled"'+(item.enabled!==false?' checked':'')+'> Включён</label>'+
    '<label><input type="checkbox" data-balancer-field="hideSelectedInbounds"'+(item.hideSelectedInbounds?' checked':'')+'> Скрыть выбранные одиночные профили</label></div>'+
    '<details class="balancer-advanced"><summary>Проверка доступности · дополнительные параметры</summary>'+
      '<div class="balancer-edit-grid">'+field('Интервал','probeInterval',obs.probeInterval||'20s','20s',5)+
      field('Таймаут','probeTimeout',obs.probeTimeout||'2s','2s',5)+
      field('Выборка','sampling',String(obs.sampling||5),'5',2)+
      field('Проверочный HTTPS URL','probeURL',obs.probeURL||'https://www.gstatic.com/generate_204','https://...',256)+
      field('Проверка связности','connectivity',obs.connectivity||'http://cp.cloudflare.com/generate_204','https://...',256)+
      '</div><p class="note">Xray поддерживает probeInterval и probeUrl. Таймаут, выборка и связность сохраняются как настройки группы, но не передаются в неподдерживаемые поля Xray.</p></details>'+
   '</section>';
  }).join(''):'<div class="balancer-empty"><strong>Балансировщиков пока нет</strong><p>Добавьте любую комбинацию серверов. Одиночные подключения работают независимо.</p></div>';
  $('#balancers-count').textContent=draft.length+' групп';
 };
 const read=()=>[...$$('.balancer-editor')].map((row,i)=>{
  const get=name=>row.querySelector('[data-balancer-field="'+name+'"]');
  const source=[...row.querySelectorAll('[data-balancer-source]:checked')].map(el=>el.dataset.balancerSource);
  const obs={probeInterval:get('probeInterval').value.trim(),probeTimeout:get('probeTimeout').value.trim(),
   sampling:Number(get('sampling').value),probeURL:get('probeURL').value.trim(),connectivity:get('connectivity').value.trim()};
  return {tag:get('tag').value.trim(),remark:get('remark').value.trim(),serverDescription:get('serverDescription').value.trim(),
   strategy:get('strategy').value,enabled:get('enabled').checked,hideSelectedInbounds:get('hideSelectedInbounds').checked,
   selector:source,observatory:obs};
 });
 const markup='<section class="balancer-workspace"><div class="balancer-intro"><div>'+
  '<h2>Балансировщики</h2><p>Создавайте собственные группы с любыми комбинациями серверов. Только JSON; без автоматических групп.</p>'+
  '</div><div class="balancer-toolbar"><span id="balancers-count"></span><button class="btn" type="button" id="balancer-add">'+ic('plus')+'Новый балансировщик</button></div></div>'+
  '<div id="balancers-list" class="balancer-list"></div>'+
  '<div class="balancer-savebar"><p>Серверы выбираются по стабильным ID. Изменения применятся после сохранения.</p>'+
  '<button type="button" class="btn" id="balancer-save">'+ic('save')+'Сохранить изменения</button></div></section>';
 return [markup,()=>{
  const list=$('#balancers-list');
  if(!list)return;
  view();
  $('#balancer-add').addEventListener('click',()=>{
   draft=read();
   let next=1;
   while(draft.some(item=>item.tag==='AUTO_'+next))next++;
   draft.push({tag:'AUTO_'+next,remark:'Новый балансировщик',serverDescription:'',
    enabled:true,strategy:'leastPing',selector:[],hideSelectedInbounds:false,
    observatory:{probeInterval:'20s',probeTimeout:'2s',sampling:5,
    probeURL:'https://www.gstatic.com/generate_204',connectivity:'http://cp.cloudflare.com/generate_204'}});
   view();
   list.lastElementChild?.scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  list.addEventListener('click',event=>{
   const button=event.target.closest('[data-balancer-delete]');
   if(!button)return;
   const index=Number(button.dataset.balancerDelete);
   draft=read().filter((_,i)=>i!==index);
   view();
  });
  const save=$('#balancer-save');
  save.addEventListener('click',async()=>{
   const rows=read();
   for(const row of rows){
    if(!row.tag||!row.remark||!row.selector.length){
     toast('Укажите tag, название и хотя бы один сервер для каждого балансировщика');return;
    }
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(row.tag)){toast('Tag допускает только латиницу, цифры, _ и -');return}
   }
   if(new Set(rows.map(r=>r.tag)).size!==rows.length){toast('Теги балансировщиков должны быть уникальными');return}
   save.disabled=true;
   try{
    // An explicit array disables legacy automatic SMART once and for all.
    await api.saveSettings({clientBalancers:rows,
      subscriptionJson:{...(DB.set.subscriptionJson||{}),smart:false,balance:'off'}});
    draft=rows;
    toast('Настройки балансировщиков сохранены');
    view();
   }catch(error){toast('Не удалось сохранить балансировщики: '+(error.message||'API'))}
   finally{save.disabled=false}
  });
 }];
};
const pages={home:['Дашборд',homeP],statistics:['Статистика',statisticsP],users:['Пользователи',usersP],squads:['Сквады',()=>simple(['squads'])],hosts:['Хосты',()=>simple(['hosts'])],nodes:['Узлы',nodesP],templates:['Шаблоны',()=>simple(['tpls','subs'])],profiles:['XRAY STUDIO',profilesP],subscription:['SUBSCRIPTION STUDIO',subscriptionStudioP],balancers:['Балансировщики',balancersP],clientrouting:['Маршрутизация клиентов',async()=>{
    // Do not assume the editor asset was loaded by an older cached index.html.
    // A failed optional script must not crash the whole workspace.
    if(typeof window.XMeshClientRouting?.create!=='function'){
      await new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src='/client-routing.js?v=20261024-client-routes-recovery-2';
        script.async=true;
        script.onload=resolve;
        script.onerror=()=>reject(new Error('Не удалось загрузить редактор маршрутизации. Проверьте обновление Docker-образа панели и наличие client-routing.js.'));
        document.head.append(script);
      });
    }
    if(typeof window.XMeshClientRouting?.create!=='function')
      throw new Error('Редактор маршрутизации не инициализирован. Проверьте ошибки client-routing.js в консоли браузера.');
    return window.XMeshClientRouting.create(DB,async patch=>{
      const result=await backendRequest('/api/v1/client-routing',{
        method:'PATCH',body:JSON.stringify({profiles:patch.clientRoutingProfiles})});
      DB.set.clientRoutingProfiles=result.profiles;
      return result;
    },toast);
  }],tools:['Диагностика',toolsP],admins:['Администраторы',()=>simple(['admins'])],security:['Безопасность',securityP],set:['Настройки',setP]};
const skel=()=>`<div class="sk" style="height:7rem"></div><div class="sk" style="height:18rem"></div><div class="sk" style="height:12rem"></div>`;
const NAV_SHORT={home:'Главная',users:'Клиенты',nodes:'Узлы',subscription:'Подписка'};
$('#nav').innerHTML=NAV.map(([g,a])=>`<div class="g">${g}</div>`+a.map(([k,i,l,p])=>`<a href="#${k}" class="${p?'':'sec'}" aria-label="${l}" data-rail-tip="${l}">${ic(i)}<span class="lbl"><span class="nav-label-full">${l}</span><span class="nav-label-short" aria-hidden="true">${NAV_SHORT[k]||l}</span></span>${k=='users'?'<em id="unb"></em>':''}</a>`).join('')).join('')+`<button class="more" id="more" aria-label="Ещё разделы" data-rail-tip="Ещё разделы">${ic('more')}<span class="lbl">Ещё</span></button>`;
let pendingScrollTarget=null;
function scrollToSettingsTarget(id){
  const target=document.getElementById(id);
  if(!target)return false;
  target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  return true;
}
async function render(soft){
  document.querySelector('body > .sv-studio-portal')?.remove();
  document.querySelector('body > #stats-user-modal')?.remove();
  T.forEach(clearInterval);T=[];cur=location.hash.slice(1);if(!pages[cur]||(viewerMode()&&!['home','statistics','users','nodes'].includes(cur)))cur='home';const rt=++RT,[t,f]=pages[cur],v=$('#view');
  $('#title').textContent=t;document.title=(window.XMeshI18n?.translate(t)||t)+' — '+DB.set.brand;$$('#nav a').forEach(a=>a.classList.toggle('on',a.getAttribute('href')=='#'+cur));
  if(!soft){v.classList.remove('still');v.innerHTML=skel();scrollTo(0,0)}
  try{
    const [h,i]=await f();if(rt!==RT)return;
    v.classList.toggle('still',!!soft);v.innerHTML=h;
    decorateButtonIcons(v);
    if(i)i();
    initializeRangeProgress(v);
    window.XMeshMfa?.mount(v);window.XMeshSecurity?.mount(v);
    $('#unb').textContent=DB.users.length;drawBulk();
  }catch(error){
    if(rt!==RT)return;
    console.error('XMesh page render failed:',cur,error);
    v.classList.remove('still');
    v.replaceChildren();
    const panel=document.createElement('section');
    panel.className='card';
    panel.style.cssText='max-width:850px;margin:2rem auto;padding:1.5rem';
    const title=document.createElement('h2');title.textContent='Не удалось открыть раздел';
    const details=document.createElement('p');details.className='er';details.textContent=error?.message||String(error);
    const help=document.createElement('p');help.className='note';help.textContent='Данные не изменены. Можно повторить загрузку или открыть другой раздел.';
    const retry=document.createElement('button');retry.className='btn';retry.textContent='Повторить загрузку';retry.addEventListener('click',()=>render(false));
    panel.append(title,details,help,retry);v.append(panel);
    return;
  }
  if(pendingScrollTarget&&cur==='set'){
    const target=pendingScrollTarget;
    pendingScrollTarget=null;
    requestAnimationFrame(()=>scrollToSettingsTarget(target));
  }
}


/* ================= СТАТИСТИКА ИНФРАСТРУКТУРЫ ================= */
// Data originates exclusively from the authenticated API; missing/stale readings
// are distinct from zero. The control-plane container isn't the host VPS.
const statsValue=(v,unit='')=>v===null||v===undefined||!Number.isFinite(Number(v))
  ?'Нет данных':fmt(Number(v),1)+unit;
const statsBytes=v=>v===null||v===undefined||!Number.isFinite(Number(v))
 ?'Нет данных':sysBytes(Number(v));
// Display network speeds in bits/s; lifetime data usage stays in bytes.
const statsRate=v=>{
 if(v===null||v===undefined||!Number.isFinite(Number(v)))return 'Нет данных';
 const bps=Number(v)*8,abs=Math.abs(bps);
 return abs>=1e9?fmt(bps/1e9,2)+' Гбит/с':abs>=1e6?fmt(bps/1e6,2)+' Мбит/с':abs>=1e3?fmt(bps/1e3,1)+' Кбит/с':fmt(bps,0)+' бит/с';
};
const statsMetric=(label,value,hint='')=>`<div class="stats-tile"><small>${esc(label)}</small><strong>${esc(String(value))}</strong>${hint?`<span>${esc(hint)}</span>`:''}</div>`;
const statsRow=(label,value)=>`<div class="stats-kv"><span>${esc(label)}</span><b>${esc(String(value))}</b></div>`;
// Detailed chart uses the same RX/TX color vocabulary as the dashboard.
// Each plotted point must be an actual TimescaleDB observation; nulls break paths.
const statsDetailedChart=(points)=>{
 const samples=(Array.isArray(points)?points:[]).filter(p=>Number.isFinite(Number(p.bucketMs))&&Number(p.bucketMs)>0);
 if(!samples.length)return '<p class="note">Нет подтверждённых измерений за выбранный период.</p>';
 const w=1000,h=340,left=72,right=22,top=20,bottom=48,pw=w-left-right,ph=h-top-bottom;
 const metrics=['rxBytesPerSec','txBytesPerSec'];
 const valid=(v)=>v!==null&&v!==undefined&&Number.isFinite(Number(v))&&Number(v)>=0;
 const max=Math.max(1,...samples.flatMap(p=>metrics.map(k=>valid(p[k])?Number(p[k])*8/1e6:0)))*1.1;
 const x=i=>left+(samples.length===1?.5:i/(samples.length-1))*pw;
 const y=v=>top+ph-v/max*ph;
 const line=(key)=>{
  let d='',area='',segment=[];
  const flush=()=>{
   if(!segment.length)return;
   const path=segment.map(([i,v],j)=>(j?'L':'M')+x(i).toFixed(2)+' '+y(v).toFixed(2)).join(' ');
   d+=path+' ';
   area+=path+' L'+x(segment[segment.length-1][0]).toFixed(2)+' '+(top+ph)+' L'+x(segment[0][0]).toFixed(2)+' '+(top+ph)+' Z ';
   segment=[];
  };
  samples.forEach((p,i)=>{
   if(!valid(p[key])){flush();return}
   segment.push([i,Number(p[key])*8/1e6]);
  });
  flush();
  const cls=key==='rxBytesPerSec'?'rx':'tx';
  const dots=samples.map((p,i)=>{
   if(!valid(p[key]))return '';
   const v=Number(p[key])*8/1e6;
   const when=new Date(Number(p.bucketMs)).toLocaleString(panelIsEnglish()?'en-US':'ru-RU');
   return '<g class="stats-detail-point-wrap '+cls+'" tabindex="0" role="button" data-bucket-ms="'+Number(p.bucketMs)+'" data-series="'+cls+'">'+
    '<circle class="stats-detail-point-hit" cx="'+x(i).toFixed(2)+'" cy="'+y(v).toFixed(2)+'" r="13"/>'+ 
    '<circle class="stats-detail-point-ring" cx="'+x(i).toFixed(2)+'" cy="'+y(v).toFixed(2)+'" r="10"/>'+
    '<circle class="stats-detail-point-core" cx="'+x(i).toFixed(2)+'" cy="'+y(v).toFixed(2)+'" r="5"><title>'+esc(when+' · '+cls.toUpperCase()+' · '+fmt(v,3)+' Мбит/с')+'</title></circle></g>';
  }).join('');
  return '<path class="stats-detail-area '+cls+'" d="'+area+'"/><path class="stats-detail-line '+cls+'" d="'+d+'"/>'+dots;
 };
 const grid=[0,.25,.5,.75,1].map(f=>'<line class="stats-detail-grid" x1="'+left+'" x2="'+(w-right)+'" y1="'+y(max*f)+'" y2="'+y(max*f)+'"/><text class="stats-detail-label" x="'+(left-12)+'" y="'+(y(max*f)+4)+'" text-anchor="end">'+esc(fmt(max*f,2))+'</text>').join('');
 const ticks=[0,Math.floor((samples.length-1)/2),samples.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>'<text class="stats-detail-label" x="'+x(i)+'" y="'+(h-15)+'" text-anchor="'+(i===0?'start':i===samples.length-1?'end':'middle')+'">'+esc(new Date(Number(samples[i].bucketMs)).toLocaleString(panelIsEnglish()?'en-US':'ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))+'</text>').join('');
 return '<div class="stats-detail-wrap"><svg class="stats-detail-chart" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="История RX и TX, Мбит/с. Наведите на точки для значений"><text class="stats-detail-axis" x="17" y="'+(top+ph/2)+'" transform="rotate(-90 17 '+(top+ph/2)+')" text-anchor="middle">Мбит/с</text>'+grid+line('rxBytesPerSec')+line('txBytesPerSec')+ticks+'</svg></div><div class="stats-detail-legend"><span><i class="rx"></i> RX · принято нодами</span><span><i class="tx"></i> TX · отправлено нодами</span><small>Наведите на точку для времени и скорости. Пропуски не интерполируются.</small></div>';
};
const statsRing=(label,percent,accent)=> {
 const valid=percent!==null&&percent!==undefined&&Number.isFinite(Number(percent));
 const pct=valid?Math.max(0,Math.min(100,Number(percent))):0;
 return '<div class="stats-ring-card" style="--ring-color:'+accent+';--ring-value:'+pct+'%"><div class="stats-ring"><div class="stats-ring-center"><strong>'+(valid?esc(fmt(pct,1))+'%':'—')+'</strong></div></div><span>'+esc(label)+'</span></div>';
};
// Plot only observed Xray delta buckets; missing intervals are deliberately not invented.
const statsXrayHistoryChart=points=>{
 const buckets=[...new Map(points.map(p=>[Number(p.bucketMs),null])).keys()].filter(Number.isFinite).sort((a,b)=>a-b);
 if(!buckets.length)return '';
 const byTime=new Map(buckets.map(t=>[t,{up:0,down:0}]));
 for(const p of points){
  const slot=byTime.get(Number(p.bucketMs));if(!slot)continue;
  slot.up+=Math.max(0,Number(p.uplinkBytes)||0);
  slot.down+=Math.max(0,Number(p.downlinkBytes)||0);
 }
 const w=960,h=260,l=74,r=20,t=20,b=45,max=Math.max(1,...[...byTime.values()].flatMap(v=>[v.up,v.down]));
 const x=i=>l+(buckets.length===1?.5:i/(buckets.length-1))*(w-l-r);
 const y=v=>t+(h-t-b)*(1-v/max);
 const series=(key,cls)=>'<polyline class="stats-xray-line '+cls+'" points="'+buckets.map((time,i)=>x(i).toFixed(1)+','+y(byTime.get(time)[key]).toFixed(1)).join(' ')+'" fill="none"/>'+buckets.map((time,i)=>'<circle class="stats-xray-dot '+cls+'" cx="'+x(i).toFixed(1)+'" cy="'+y(byTime.get(time)[key]).toFixed(1)+'" r="4"><title>'+esc(new Date(time).toLocaleString()+' · '+key+' · '+statsBytes(byTime.get(time)[key]))+'</title></circle>').join('');
 const grid=[0,.5,1].map(f=>'<line class="stats-detail-grid" x1="'+l+'" x2="'+(w-r)+'" y1="'+y(max*f)+'" y2="'+y(max*f)+'"/><text class="stats-detail-label" x="'+(l-8)+'" y="'+(y(max*f)+4)+'" text-anchor="end">'+esc(statsBytes(max*f))+'</text>').join('');
 const ticks=[0,Math.floor((buckets.length-1)/2),buckets.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>'<text class="stats-detail-label" x="'+x(i)+'" y="'+(h-12)+'" text-anchor="'+(i===0?'start':i===buckets.length-1?'end':'middle')+'">'+esc(new Date(buckets[i]).toLocaleString(panelIsEnglish()?'en-US':'ru-RU',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}))+'</text>').join('');
 return '<div class="stats-detail-wrap"><svg class="stats-detail-chart" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Подтверждённые дельты Upload и Download по интервалам; промежуточные значения отсутствуют">'+grid+series('up','rx')+series('down','tx')+ticks+'</svg></div><div class="stats-detail-legend"><span><i class="rx"></i> Upload</span><span><i class="tx"></i> Download</span><small>Каждая точка — сумма подтверждённых дельт в интервале; пропущенные интервалы не означают нулевой трафик. Линии лишь соединяют наблюдаемые точки.</small></div>';
};
function statisticsP(){
 const markup=`<div class="stats-dashboard" id="stats-dashboard">
  <div class="stats-heading"><div><h2>Статистика инфраструктуры</h2><p class="note">Реальные измерения. CPU steal показывает долю времени, которую виртуальная машина ожидала процессор гипервизора.</p></div>
   <div class="act"><button class="gh" id="stats-refresh" type="button" aria-label="Обновить статистику">${ic('refresh-cw')} Обновить</button><select id="stats-period" aria-label="Период графиков"><option value="live">В реальном времени</option><option value="5m">5 минут</option><option value="15m">15 минут</option><option value="30m">30 минут</option><option value="1h">1 час</option><option value="3h">3 часа</option><option value="6h">6 часов</option><option value="12h">12 часов</option><option value="24h">24 часа</option><option value="7d">7 дней</option><option value="30d">30 дней</option></select></div></div>
  <div class="stats-live-bar"><span id="stats-live-badge" class="stats-live-badge" aria-label="Режим наблюдения"><i aria-hidden="true"></i><b>LIVE</b></span><span id="stats-status" class="note" role="status" aria-live="polite">Получение измерений…</span><span id="stats-sample-age" class="note">Ожидание измерений</span></div><div id="stats-quality" class="note" role="status" aria-live="polite"></div>
  <div id="stats-summary" class="stats-overview-grid"></div>
  <div class="stats-layout">
   <section class="card"><div class="hd"><div><h3>Скорость сети нод</h3><p>RX/TX сетевых интерфейсов (включая сторонние сервисы), отдельно от персональных Xray-счётчиков.</p></div></div><div id="stats-trend"></div><section id="stats-bucket-detail" class="stats-bucket-detail" hidden aria-live="polite"></section></section>
  </div>
  <section class="card"><div class="hd"><div><h3>Top-10: подтверждённый трафик за период</h3><p>Только подтверждённые изменения Xray за выбранный период. Пользовательские и inbound-счётчики независимы и не складываются.</p></div></div><div class="stats-history-filters"><label>Период рейтинга<select id="stats-leaders-range"><option value="1h">1 час</option><option value="24h" selected>24 часа</option><option value="7d">7 дней</option><option value="30d">30 дней</option></select></label><label>Открыть любого пользователя по ID<input id="stats-user-lookup" type="number" min="1" step="1" placeholder="ID"></label><button class="gh" id="stats-user-lookup-open" type="button">Открыть карточку</button></div><div id="stats-leaders" class="stats-leaders"><p class="note">Загрузка рейтингов…</p></div></section>
  <div id="stats-user-modal" class="stats-user-overlay" hidden>
   <section class="stats-user-dialog" role="dialog" aria-modal="true" aria-labelledby="stats-user-title" tabindex="-1">
    <header class="stats-user-head"><div class="stats-user-avatar" aria-hidden="true">X</div><div><small>XMESH · USER INTELLIGENCE</small><h2 id="stats-user-title">Аналитика пользователя</h2><p id="stats-user-subtitle" class="note">Подтверждённая телеметрия Xray</p></div><div class="stats-user-actions"><button id="stats-user-refresh" class="gh stats-user-refresh" type="button" aria-label="Обновить аналитику"><svg class="stats-refresh-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-5L3 9m0-6v6h6"/><path d="M4 13a8 8 0 0 0 14.3 5L21 15m0 6v-6h-6"/></svg><span>Обновить</span></button><button id="stats-user-close" class="gh stats-user-close" type="button" aria-label="Закрыть аналитику" title="Закрыть"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div></header>
    <div id="stats-user-overview" class="stats-user-overview" aria-live="polite">Загрузка сводки…</div>
    <nav class="stats-user-tabs" aria-label="Аналитика пользователя"><button type="button" class="is-active" data-stats-user-tab="history">История трафика</button><button type="button" data-stats-user-tab="inbounds">Inbound и ноды</button><button type="button" data-stats-user-tab="observations">Измерения</button></nav>
    <div class="stats-user-workspace"><div class="stats-user-main"><div class="stats-history-filters"><label>ID пользователя<input id="stats-history-user" type="number" min="1" step="1" placeholder="ID"></label><label>Inbound<select id="stats-history-inbound"><option value="">Все (пользовательские счётчики)</option></select></label><label>Нода<select id="stats-history-node"><option value="">Все ноды</option></select></label><label>Период<select id="stats-history-range"><option value="1h">1 час</option><option value="24h" selected>24 часа</option><option value="7d">7 дней</option><option value="30d">30 дней</option></select></label></div>
    <div class="stats-user-pane" data-stats-user-pane="history"><div id="stats-history-results" class="stats-history-results" role="status" aria-live="polite">Укажите ID пользователя или выберите его в Top-10.</div></div>
    <div class="stats-user-pane" data-stats-user-pane="inbounds" hidden><div id="stats-user-breakdown" class="stats-user-breakdown">Загрузка…</div></div>
    <div class="stats-user-pane" data-stats-user-pane="observations" hidden><div class="stats-history-raw"><button class="gh" id="stats-history-observations-load" type="button">Показать отдельные измерения</button><div id="stats-history-observations" class="stats-history-results" aria-live="polite"></div></div></div>
    <p class="note stats-user-footnote">Источник: подписанные Xray-счётчики. Значения пользовательского и inbound-учёта не суммируются. Нет измерений ≠ нулевой расход.</p></div><aside class="stats-user-aside" aria-label="Сводка по трафику"><section class="stats-insight-card"><h3>Источники трафика</h3><div id="stats-user-source-insight" class="stats-insight-content">Загрузка подтверждённых измерений…</div></section><section class="stats-insight-card"><h3>Ноды с трафиком</h3><div id="stats-user-node-insight" class="stats-insight-content">Загрузка…</div></section><section class="stats-insight-card"><h3>Качество данных</h3><p class="note">Только подтверждённые дельты Xray. Отсутствие показаний не означает нулевой трафик.</p></section></aside></div>
   </section>
  </div>
  <section class="card"><div class="hd"><div><h3>Control Plane</h3><p>Метрики контейнера панели, не всей физической машины.</p></div></div><div id="stats-control"></div></section>
  <section class="card"><div class="hd"><div><h3>Узлы и виртуализация</h3><p>CPU, steal time, RAM, диски, сеть, активные соединения и свежесть данных.</p></div></div><div id="stats-nodes" class="stats-node-grid"></div></section>
  <p class="note">Новые показатели появляются только после установки обновлённого агента. Отсутствующие измерения и устаревшие показания не заменяются нулями.</p>
 </div>`;
 const init=()=>{
  let generation=0;
  let refreshing=false;
  let lastRefresh=0;
  let lastOverview=0,lastSystem=0,overviewCache=null,systemCache=null;
  let requestFailed=false,lastSampleAt=0,lastTrafficSignature='',lastTrafficPeriod='';
  let selectedBucketMs=null,detailRequest=0,chartPoints=[];
  const updateLiveStatus=()=>{
    const live=$('#stats-period')?.value==='live',badge=$('#stats-live-badge'),age=$('#stats-sample-age');
    if(badge)badge.classList.toggle('is-paused',!live||document.hidden||requestFailed);
    if(!age)return;
    if(!lastSampleAt){age.textContent='Нет подтверждённых измерений сети';return}
    const seconds=Math.max(0,Math.floor((Date.now()-lastSampleAt)/1000));
    age.textContent='Последняя точка TimescaleDB: '+seconds+' с назад'+(seconds>65?' · данные задерживаются':'');
  };
  const refresh=async(force=false)=>{
   if(refreshing||cur!=='statistics'||document.hidden)return;
   refreshing=true;
   const generationAtStart=++generation,status=$('#stats-status');
   const button=$('#stats-refresh');if(button)button.disabled=true;
   if(status)status.textContent='Обновление измерений…';
   try{
    const period=$('#stats-period')?.value||'live';
    // Fast network history remains live; expensive per-node overview and
    // container CPU sampling are cached independently to avoid DB overload.
    const now=Date.now();
    const needOverview=force||!overviewCache||now-lastOverview>=15000;
    const needSystem=force||!systemCache||now-lastSystem>=15000;
    const [overview,sys,traffic]=await Promise.all([
      needOverview?backendRequest('/api/v1/statistics/overview'):Promise.resolve(overviewCache),
      needSystem?api.systemStats():Promise.resolve(systemCache),
      backendRequest('/api/v1/metrics/traffic?range='+encodeURIComponent(period))
    ]);
    if(needOverview){overviewCache=overview;lastOverview=Date.now()}
    if(needSystem){systemCache=sys;lastSystem=Date.now()}
    requestFailed=false;
    if(generationAtStart!==generation||cur!=='statistics')return;
    const nodes=Array.isArray(overview.nodes)?overview.nodes:[];
    const fresh=nodes.filter(n=>n.telemetryState==='fresh'||(!n.telemetryState&&n.latest&&!n.latest.stale));
     const delayed=nodes.filter(n=>n.telemetryState==='delayed');
     const staleNodes=nodes.filter(n=>n.telemetryState==='stale'||n.telemetryState==='invalid');
     const missing=nodes.filter(n=>n.telemetryState==='never_received'||(!n.telemetryState&&!n.latest));
     const verified=fresh.filter(n=>['verified','direct'].includes(n.latest?.userStatsStatus));
     const quality=$('#stats-quality');
     if(quality)quality.textContent='Телеметрия: '+fresh.length+' свежих · '+delayed.length+' задержанных · '+staleNodes.length+' устаревших/недостоверных · '+missing.length+' без измерений. Персональные Xray-счётчики подтверждены на '+verified.length+' нодах.'+(delayed.length||staleNodes.length||missing.length?' Требуют внимания: '+[...delayed,...staleNodes,...missing].slice(0,5).map(n=>n.name).join(', ')+(delayed.length+staleNodes.length+missing.length>5?' и другие':'')+'.':'');
    const validNumbers=(key)=>fresh.map(n=>Number(n.latest[key])).filter(n=>Number.isFinite(n));
    const steals=fresh.map(n=>n.latest.cpuStealPercent).filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))).map(Number);
    const stealAvg=steals.length?steals.reduce((a,b)=>a+b,0)/steals.length:null;
    const rx=fresh.reduce((sum,n)=>sum+(Number(n.latest.rxBytesPerSec)||0),0);
     const rxReporting=fresh.filter(n=>n.latest.rxBytesPerSec!=null&&Number.isFinite(Number(n.latest.rxBytesPerSec))).length;
    const tx=fresh.reduce((sum,n)=>sum+(Number(n.latest.txBytesPerSec)||0),0);
     const txReporting=fresh.filter(n=>n.latest.txBytesPerSec!=null&&Number.isFinite(Number(n.latest.txBytesPerSec))).length;
    const tiles=[
      ['Узлы',String(overview.totalNodes??nodes.length),(panelIsEnglish()?fresh.length+' reporting fresh data':fresh.length+' передают свежие данные')],
      ['Пользователи',String(overview.totalUsers??'—'),'Учетные записи панели'],
      ['CPU steal',statsValue(stealAvg,'%'),steals.length?(panelIsEnglish()?steals.length+' nodes reporting':steals.length+' узлов с показаниями'):'Данные агента отсутствуют'],
      ['RX',rxReporting?statsRate(rx):'Нет данных','Сетевая скорость · '+rxReporting+'/'+nodes.length+' нод'],
      ['TX',txReporting?statsRate(tx):'Нет данных','Сетевая скорость · '+txReporting+'/'+nodes.length+' нод'],
      ['User × inbound',String(overview.inboundTraffic?.counters??0),'Записей фактического учета'],
      ['Uplink',Number(overview.inboundTraffic?.counters)>0?statsBytes(overview.inboundTraffic?.uplinkBytes):'Нет данных','Накопленный персональный трафик, не за выбранный период'],
      ['Downlink',Number(overview.inboundTraffic?.counters)>0?statsBytes(overview.inboundTraffic?.downlinkBytes):'Нет данных','Накопленный персональный трафик, не за выбранный период']
    ];
    $('#stats-summary').innerHTML=tiles.map(x=>statsMetric(...x)).join('');
    const control=[
      ['CPU',statsValue(sys.cpu?.percent,'%')],['RAM',statsValue(sys.ram?.percent,'%')],
      ['ОЗУ занято',statsBytes(sys.ram?.usedBytes)],['ОЗУ всего',statsBytes(sys.ram?.totalBytes)],
      ['Диск',statsValue(sys.disk?.percent,'%')],['Диск занят',statsBytes(sys.disk?.usedBytes)],
      ['Загрузка 1/5/15',Array.isArray([sys.loadAverage?.one,sys.loadAverage?.five,sys.loadAverage?.fifteen])?[sys.loadAverage?.one,sys.loadAverage?.five,sys.loadAverage?.fifteen].map(v=>statsValue(v)).join(' / '):'Нет данных'],
      ['Процессы',statsValue(sys.processCount)],['PostgreSQL',sys.database==='online'?'Онлайн':'Не отвечает'],
      ['Uptime',sys.uptimeSeconds==null?'Нет данных':Math.floor(sys.uptimeSeconds/3600)+(panelIsEnglish()?' h':' ч')]
    ];
    $('#stats-control').innerHTML='<div class="stats-control-rings">'+statsRing('CPU',sys.cpu?.percent,'#6f9bff')+statsRing('RAM',sys.ram?.percent,'#c294e8')+statsRing('Диск',sys.disk?.percent,'#44c9b6')+'</div><div class="stats-kvs">'+control.map(x=>statsRow(...x)).join('')+'</div>';
    const points=traffic.points||[];
    chartPoints=points;
    const latest=points[points.length-1]||{};
    const sampled=Number(latest.bucketMs);
    lastSampleAt=Number.isFinite(sampled)&&sampled>0?sampled:0;
    const trafficSignature=JSON.stringify(points);
    if(trafficSignature!==lastTrafficSignature||period!==lastTrafficPeriod){
     lastTrafficSignature=trafficSignature;
     lastTrafficPeriod=period;
     $('#stats-trend').innerHTML='<div class="stats-detail-kpis"><div><b>RX</b><strong>'+(latest.rxBytesPerSec!=null?statsRate(latest.rxBytesPerSec):'Нет данных')+'</strong></div><div><b>TX</b><strong>'+(latest.txBytesPerSec!=null?statsRate(latest.txBytesPerSec):'Нет данных')+'</strong></div><div><b>Временных интервалов</b><strong>'+esc(String(points.length))+'</strong></div></div>'+statsDetailedChart(points)+'<small class="note">'+(panelIsEnglish()?'Samples: ':'Измерений: ')+esc(String(traffic.sampleCount??0))+(panelIsEnglish()?' · Source: TimescaleDB':' · Источник: TimescaleDB')+'</small>';
    }
    updateLiveStatus();
    $('#stats-nodes').innerHTML=nodes.length?nodes.map(n=>{
      const v=n.latest,quality=n.telemetryState||(v?(v.stale?'stale':'fresh'):'never_received'),ok=v&&quality==='fresh';
      const head=flagView(n.flag)+' <b>'+esc(n.name)+'</b>'+(n.hosting?'<small>'+esc(n.hosting)+'</small>':'');
      const values=[
        ['CPU',statsValue(ok?v.cpuPercent:null,'%')],
        ['Steal time',statsValue(ok?v.cpuStealPercent:null,'%')],
        ['RAM',statsBytes(ok?v.ramUsedBytes:null)+' / '+statsBytes(ok?v.ramTotalBytes:null)],
        ['Диск',statsBytes(ok?v.diskUsedBytes:null)+' / '+statsBytes(ok?v.diskTotalBytes:null)],
        ['RX',ok?statsRate(v.rxBytesPerSec):'Нет данных'],
        ['TX',ok?statsRate(v.txBytesPerSec):'Нет данных'],
        ['TCP соединения',statsValue(ok?v.activeConnections:null)],
        ['Онлайн клиенты',statsValue(ok?v.onlineClients:null)],
         ['Учёт Xray',ok?(['verified','direct'].includes(v.userStatsStatus)?'Подтверждён':v.userStatsStatus==='unavailable'?'Недоступен':'Статус не получен'):'Нет свежего подтверждения']
      ];
      const last=v?.sampledAt?new Date(v.sampledAt).toLocaleString(panelIsEnglish()?'en-US':'ru-RU'):'Нет измерений';
      return '<article class="stats-node"><div class="stats-node-head">'+head+'</div><span class="stats-node-status">'+(quality==='fresh'?'Свежие данные':quality==='delayed'?'Данные задерживаются':quality==='stale'?'Данные устарели':quality==='invalid'?'Недостоверная метка времени':'Нет телеметрии')+' · '+esc(last)+'</span><div class="stats-node-rings">'+statsRing('CPU',ok?v.cpuPercent:null,'#6f9bff')+statsRing('Steal time',ok?v.cpuStealPercent:null,'#f3ae63')+statsRing('RAM',ok&&v.ramTotalBytes>0?v.ramUsedBytes/v.ramTotalBytes*100:null,'#c294e8')+statsRing('Диск',ok&&v.diskTotalBytes>0?v.diskUsedBytes/v.diskTotalBytes*100:null,'#44c9b6')+'</div><div class="stats-kvs">'+values.map(x=>statsRow(...x)).join('')+'</div></article>';
    }).join(''):'<p class="note">Узлы пока не созданы.</p>';
    if(status)status.textContent=(panelIsEnglish()?'Data updated · API checked at ':'Данные обновлены · API проверен в ')+new Date().toLocaleTimeString(panelIsEnglish()?'en-US':'ru-RU');
   }catch(error){requestFailed=true;updateLiveStatus();if(status)status.textContent=(panelIsEnglish()?'Unable to refresh statistics: ':'Не удалось обновить статистику: ')+(error.message||(panelIsEnglish()?'API error':'Ошибка API'))}
   finally{refreshing=false;lastRefresh=Date.now();if(button?.isConnected)button.disabled=false}
  };
  const openBucket=async(bucketMs)=>{
    if(!Number.isFinite(bucketMs)||!chartPoints.some(p=>Number(p.bucketMs)===bucketMs))return;
    selectedBucketMs=bucketMs;
    const panel=$('#stats-bucket-detail'),requestId=++detailRequest;
    if(!panel)return;
    panel.hidden=false;
    panel.innerHTML='<p class="note">Загрузка показаний узлов…</p>';
    $$('.stats-detail-point-wrap').forEach(el=>el.classList.toggle('is-selected',Number(el.dataset.bucketMs)===bucketMs));
    try{
      const range=$('#stats-period')?.value||'live';
      const detail=await backendRequest('/api/v1/metrics/traffic/bucket-detail?'+new URLSearchParams({range,bucketMs:String(bucketMs)}));
      if(requestId!==detailRequest||selectedBucketMs!==bucketMs||cur!=='statistics')return;
      const nodes=Array.isArray(detail.nodes)?detail.nodes:[];
      const totals=(key)=>nodes.reduce((sum,n)=>sum+(Number.isFinite(Number(n[key]))&&n[key]!=null?Number(n[key]):0),0);
      const rx=totals('rxBytesPerSec'),tx=totals('txBytesPerSec');
      const peak=nodes.filter(n=>n.rxBytesPerSec!=null).sort((a,b)=>Number(b.rxBytesPerSec)-Number(a.rxBytesPerSec))[0];
      const rows=nodes.map(n=>'<tr><td>'+esc(n.name||'Нода #'+n.id)+'</td><td>'+statsRate(n.rxBytesPerSec)+'</td><td>'+statsRate(n.txBytesPerSec)+'</td><td>'+esc(String(n.sampleCount??'—'))+'</td><td>'+(n.lastSampleMs?esc(new Date(n.lastSampleMs).toLocaleTimeString(panelIsEnglish()?'en-US':'ru-RU')):'—')+'</td></tr>').join('');
      panel.innerHTML='<div class="stats-detail-header"><div><h4>Детали интервала · '+esc(new Date(bucketMs).toLocaleString(panelIsEnglish()?'en-US':'ru-RU'))+'</h4><p class="note">RX — принято сетевыми интерфейсами; TX — отправлено. Другие сервисы хоста тоже учитываются. Это не персональный трафик Xray.</p></div><button class="gh sm" type="button" data-stats-detail-close>Закрыть</button></div>'+
        '<div class="stats-detail-kpis"><div><b>RX всех учтённых нод</b><strong>'+statsRate(rx)+'</strong></div><div><b>TX всех учтённых нод</b><strong>'+statsRate(tx)+'</strong></div><div><b>Нод с измерениями</b><strong>'+nodes.length+'</strong></div></div>'+
        (peak?'<p class="note">Наибольший вклад RX: '+esc(peak.name||'Нода #'+peak.id)+' · '+statsRate(peak.rxBytesPerSec)+(rx>0?' ('+fmt(Number(peak.rxBytesPerSec)/rx*100,1)+'%)':'')+'</p>':'')+
        '<div class="stats-bucket-table-wrap"><table><thead><tr><th>Нода</th><th>RX</th><th>TX</th><th>Измерений</th><th>Последняя точка</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
        '<p class="note">Источник: TimescaleDB · server_metric_samples'+(detail.truncated?' · Показаны первые 500 нод':'')+'. Отсутствующие измерения не заменены нулями.</p>';
    }catch(e){if(requestId===detailRequest&&panel)panel.textContent='Ошибка детализации: '+(e.message||'API error')}
  };
  $('#stats-trend')?.addEventListener('click',e=>{
    const point=e.target.closest?.('.stats-detail-point-wrap');
    if(point)void openBucket(Number(point.dataset.bucketMs));
  });
  $('#stats-trend')?.addEventListener('keydown',e=>{
    const point=e.target.closest?.('.stats-detail-point-wrap');
    if(point&&(e.key==='Enter'||e.key===' ')){e.preventDefault();void openBucket(Number(point.dataset.bucketMs))}
  });
  $('#stats-bucket-detail')?.addEventListener('click',e=>{
    if(e.target.closest?.('[data-stats-detail-close]')){
      selectedBucketMs=null;++detailRequest;$('#stats-bucket-detail').hidden=true;
      $$('.stats-detail-point-wrap').forEach(el=>el.classList.remove('is-selected'));
    }
  });
  $('#stats-refresh')?.addEventListener('click',()=>{void refresh(true)});
  $('#stats-period')?.addEventListener('change',()=>{lastRefresh=0;void refresh()});
  void refresh();
  const loadLeaders=async()=>{
    const root=$('#stats-leaders');if(!root)return;
    try{
      const result=await backendRequest('/api/v1/statistics/period-leaders?range='+encodeURIComponent($('#stats-leaders-range')?.value||'24h'));
      if(cur!=='statistics'||!root.isConnected)return;
      const table=(items,label)=>
        '<div><h4>'+label+'</h4><div class="stats-bucket-table-wrap"><table><thead><tr><th>Название</th><th>Uplink</th><th>Downlink</th><th>Всего</th></tr></thead><tbody>'+
        (items.length?items.map(item=>{
          const up=Number(item.uplinkBytes)||0,down=Number(item.downlinkBytes)||0;
          return '<tr><td>'+(item.userId?'<button class="gh sm" type="button" data-stats-history-user="'+esc(item.userId)+'">'+esc(item.name||'Пользователь #'+item.userId)+'</button>':esc(item.inboundTag||item.name||('Нода #'+item.nodeId)||'—'))+'</td><td>'+statsBytes(up)+'</td><td>'+statsBytes(down)+'</td><td>'+statsBytes(up+down)+'</td></tr>';
        }).join(''):'<tr><td colspan="4">Пока нет подтверждённых счётчиков</td></tr>')+
        '</tbody></table></div></div>';
      root.innerHTML=table(result.topUsers||[],'Пользователи')+table(result.topInbounds||[],'Inbound')+table(result.topNodes||[],'Ноды');
    }catch(e){if(root.isConnected)root.textContent='Рейтинги недоступны: '+(e.message||'API error')}
  };
  void loadLeaders();
  $('#stats-leaders-range')?.addEventListener('change',()=>void loadLeaders());
  const historyUser=$('#stats-history-user'),historyInbound=$('#stats-history-inbound'),historyNode=$('#stats-history-node'),historyRoot=$('#stats-history-results');
  let historyRequest=0;
  const historyOption=(value,label)=>'<option value="'+esc(String(value))+'">'+esc(label)+'</option>';
  const loadHistory=async(reloadDimensions=false)=>{
    const id=Number(historyUser?.value),request=++historyRequest;
    const refreshButton=$('#stats-user-refresh');
    if(refreshButton){refreshButton.classList.add('is-refreshing');refreshButton.disabled=true;refreshButton.setAttribute('aria-busy','true')}
    if(!Number.isSafeInteger(id)||id<=0){historyRoot.textContent='Укажите действительный ID пользователя.';if(refreshButton){refreshButton.classList.remove('is-refreshing');refreshButton.disabled=false;refreshButton.removeAttribute('aria-busy')}return}
    historyRoot.textContent='Запрашиваем подтверждённую историю…';
    try{
      if(reloadDimensions){
        const totals=await backendRequest('/api/v1/users/'+encodeURIComponent(id)+'/traffic');
        if(request!==historyRequest||cur!=='statistics')return;
        const inboundTags=[...new Set((totals.inbounds||[]).map(v=>v.inboundTag).filter(Boolean))].sort();
        const nodes=[...new Map((totals.servers||[]).map(v=>[Number(v.nodeId),v])).values()].filter(v=>Number(v.nodeId)>0);
        historyInbound.innerHTML=historyOption('','Все (пользовательские счётчики)')+inboundTags.map(v=>historyOption(v,v)).join('');
        historyNode.innerHTML=historyOption('','Все ноды')+nodes.map(v=>historyOption(v.nodeId,v.name||'Нода #'+v.nodeId)).join('');
        const overview=$('#stats-user-overview'),breakdown=$('#stats-user-breakdown');
        const totalUp=Number(totals.totalUplinkBytes)||0,totalDown=Number(totals.totalDownlinkBytes)||0;
        overview.innerHTML='<div><small>Подтверждённый Upload · накопленный</small><strong>'+statsBytes(totalUp)+'</strong></div><div><small>Подтверждённый Download · накопленный</small><strong>'+statsBytes(totalDown)+'</strong></div><div><small>Всего · накоплено</small><strong>'+statsBytes(totalUp+totalDown)+'</strong></div><div><small>Ноды с учётом</small><strong>'+nodes.length+'</strong></div>';
        const totalTraffic=totalUp+totalDown;
        const pct=value=>totalTraffic>0?(100*value/totalTraffic).toLocaleString(panelIsEnglish()?'en-US':'ru-RU',{maximumFractionDigits:1})+'%':'0%';
        const sourceInsight=$('#stats-user-source-insight');
        if(sourceInsight)sourceInsight.innerHTML='<div class="stats-insight-donut" style="--stats-download-share:'+(totalTraffic?100*totalDown/totalTraffic:0)+'%"><span><small>Всего</small><strong>'+statsBytes(totalTraffic)+'</strong></span></div><div class="stats-insight-legend"><div><i class="stats-insight-dot is-download"></i><span>Download</span><strong>'+statsBytes(totalDown)+' · '+pct(totalDown)+'</strong></div><div><i class="stats-insight-dot is-upload"></i><span>Upload</span><strong>'+statsBytes(totalUp)+' · '+pct(totalUp)+'</strong></div></div>';
        const nodeInsight=$('#stats-user-node-insight');
        if(nodeInsight){const servers=(Array.isArray(totals.servers)?totals.servers:[]).map(node=>({...node,bytes:(Number(node.uplinkBytes)||0)+(Number(node.downlinkBytes)||0)})).sort((a,b)=>b.bytes-a.bytes);const nodeTotal=servers.reduce((sum,node)=>sum+node.bytes,0);nodeInsight.innerHTML=servers.length?servers.slice(0,5).map(node=>'<div class="stats-insight-node"><div><span>'+esc(node.name||'Нода #'+node.nodeId)+'</span><strong>'+statsBytes(node.bytes)+'</strong></div><div class="stats-insight-track"><span style="width:'+(nodeTotal?Math.min(100,100*node.bytes/nodeTotal):0)+'%"></span></div></div>').join(''):'<p class="note">Нет подтверждённых измерений по нодам</p>';}
        const detailTable=(entries,title)=>'<article><h3>'+title+'</h3><div class="stats-bucket-table-wrap"><table><thead><tr><th>Источник</th><th>Upload</th><th>Download</th><th>Измерений</th></tr></thead><tbody>'+((entries||[]).length?entries.map(v=>'<tr><td>'+esc(v.inboundTag?(v.inboundTag+' · '+(v.nodeName||'Нода #'+v.nodeId)):(v.name||'Нода #'+v.nodeId))+'</td><td>'+statsBytes(v.uplinkBytes)+'</td><td>'+statsBytes(v.downlinkBytes)+'</td><td>'+esc(v.observations??'—')+'</td></tr>').join(''):'<tr><td colspan="4">Нет подтверждённых записей</td></tr>')+'</tbody></table></div></article>';
        breakdown.innerHTML=detailTable(totals.inbounds,'Inbound по нодам · независимый счётчик')+detailTable(totals.servers,'Ноды · пользовательский счётчик');

      }
      const params=new URLSearchParams({range:$('#stats-history-range').value});
      if(historyInbound.value)params.set('inboundTag',historyInbound.value);
      if(historyNode.value)params.set('nodeId',historyNode.value);
      const result=await backendRequest('/api/v1/users/'+encodeURIComponent(id)+'/traffic/history?'+params);
      if(request!==historyRequest||cur!=='statistics'||!historyRoot.isConnected)return;
      const points=Array.isArray(result.points)?result.points:[];
      const rows=points.map(p=>'<tr><td>'+esc(new Date(p.bucketMs).toLocaleString(panelIsEnglish()?'en-US':'ru-RU'))+'</td><td>'+esc(p.inboundTag||'Пользователь')+'</td><td>'+esc(p.nodeId)+'</td><td>'+statsBytes(p.uplinkBytes)+'</td><td>'+statsBytes(p.downlinkBytes)+'</td><td>'+esc(p.sampleCount)+'</td></tr>').join('');
      historyRoot.innerHTML=statsXrayHistoryChart(points)+'<p class="note">Источник: подтверждённые дельты Xray · '+(result.sourceType==='inbound'?'пользователь × inbound':'счётчик пользователя')+' · '+esc(result.range)+(result.truncated?' · Результат ограничен 5000 строками':'')+'. Счётчики разных источников не суммируются.</p>'+
       (rows?'<div class="stats-bucket-table-wrap"><table><thead><tr><th>Интервал</th><th>Источник</th><th>Нода</th><th>Upload</th><th>Download</th><th>Измерений</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p class="note">За период нет подтверждённых изменений. Это не доказательство нулевого трафика.</p>');
    }catch(error){if(request===historyRequest&&historyRoot.isConnected)historyRoot.textContent='История недоступна: '+(error.message||'Ошибка API')}
    finally{if(request===historyRequest&&refreshButton){refreshButton.classList.remove('is-refreshing');refreshButton.disabled=false;refreshButton.removeAttribute('aria-busy')}}
  };
  const loadObservations=async()=>{
    const root=$('#stats-history-observations'),id=Number(historyUser?.value);
    if(!root||!Number.isSafeInteger(id)||id<=0)return;
    root.textContent='Загрузка отдельных подтверждённых измерений…';
    try{
      const params=new URLSearchParams({range:$('#stats-history-range').value});
      if(historyInbound.value)params.set('inboundTag',historyInbound.value);
      if(historyNode.value)params.set('nodeId',historyNode.value);
      const data=await backendRequest('/api/v1/users/'+encodeURIComponent(id)+'/traffic/observations?'+params);
      if(cur!=='statistics'||!root.isConnected)return;
      const records=Array.isArray(data.observations)?data.observations:[];
      root.innerHTML='<p class="note">Первичные принятые дельты Xray · '+records.length+' записей'+(data.truncated?' · Показаны последние 500, результат неполный':'')+'. Отдельные пользовательские и inbound-счётчики не складываются.</p>'+
        (records.length?'<div class="stats-bucket-table-wrap"><table><thead><tr><th>Получено</th><th>Inbound</th><th>Нода</th><th>Upload</th><th>Download</th></tr></thead><tbody>'+records.map(p=>'<tr><td>'+esc(new Date(p.sampledAtMs).toLocaleString(panelIsEnglish()?'en-US':'ru-RU'))+'</td><td>'+esc(p.inboundTag||'Пользователь')+'</td><td>'+esc(p.nodeId)+'</td><td>'+statsBytes(p.uplinkBytes)+'</td><td>'+statsBytes(p.downlinkBytes)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="note">Нет подтверждённых записей для фильтра. Это не доказательство отсутствия трафика.</p>');
    }catch(error){if(root.isConnected)root.textContent='Не удалось загрузить измерения: '+(error.message||'Ошибка API')}
  };
  $('#stats-history-observations-load')?.addEventListener('click',()=>void loadObservations());
  historyUser?.addEventListener('change',()=>void loadHistory(true));
  for(const control of [historyInbound,historyNode,$('#stats-history-range')])control?.addEventListener('change',()=>void loadHistory());
  const showStatsUserTab=name=>{
    $$('.stats-user-pane').forEach(el=>{el.hidden=el.dataset.statsUserPane!==name});
    $$('.stats-user-tabs button').forEach(el=>el.classList.toggle('is-active',el.dataset.statsUserTab===name));
    if(name==='observations')void loadObservations();
  };
  // Portal above the app shell: backdrop must blur the navigation rail as well.
  const statsPortal=$('#stats-user-modal');
  if(statsPortal&&statsPortal.parentElement!==document.body)document.body.append(statsPortal);
  const closeStatsUser=()=>{++historyRequest;$('#stats-user-modal').hidden=true;$('#stats-leaders-range')?.focus()};
  $('#stats-user-close')?.addEventListener('click',closeStatsUser);
  $('#stats-user-refresh')?.addEventListener('click',()=>void loadHistory(true));
  $('#stats-user-modal')?.addEventListener('click',e=>{if(e.target.id==='stats-user-modal')closeStatsUser()});
  $('#stats-user-modal')?.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeStatsUser()}});
  $$('.stats-user-tabs button').forEach(el=>el.addEventListener('click',()=>showStatsUserTab(el.dataset.statsUserTab)));
  const openStatsUser=(id,name)=>{
    const modal=$('#stats-user-modal'),n=Number(id);
    if(!modal||!Number.isSafeInteger(n)||n<=0)return;
    historyUser.value=String(n);
    $('#stats-user-title').textContent=name||'Пользователь #'+n;
    $('#stats-user-subtitle').textContent='Пользователь #'+n+' · подтверждённый трафик Xray';
    $('#stats-user-overview').textContent='Загрузка сводки…';
    $('#stats-user-breakdown').textContent='Загрузка…';
    modal.hidden=false;
    showStatsUserTab('history');
    void loadHistory(true);
    $('#stats-user-close')?.focus();
  };
  $('#stats-leaders')?.addEventListener('click',event=>{
    const user=event.target.closest?.('[data-stats-history-user]');
    if(user)openStatsUser(user.dataset.statsHistoryUser,user.textContent.trim());
  });
  $('#stats-user-lookup-open')?.addEventListener('click',()=>openStatsUser($('#stats-user-lookup')?.value));
  $('#stats-user-lookup')?.addEventListener('keydown',e=>{if(e.key==='Enter')openStatsUser(e.target.value)});

  // One-second UI heartbeat, but no invented network samples: the sparkline
  // changes only when actual signed telemetry reaches TimescaleDB.
  T.push(setInterval(()=>{
    if(cur!=='statistics'||document.hidden)return;
    updateLiveStatus();
    const live=$('#stats-period')?.value==='live';
    const cadence=live?5000:30000;
    if(!refreshing&&Date.now()-lastRefresh>=cadence){void refresh();return}
    const status=$('#stats-status');
    if(status&&!requestFailed&&lastRefresh&&live){
      const age=Math.max(0,Math.floor((Date.now()-lastRefresh)/1000));
      status.textContent=(panelIsEnglish()?'API checked ':'API проверен ')+age+(panelIsEnglish()?'s ago':' с назад');
    }
  },1000));
 };
 return Promise.resolve([markup,init]);
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
  // Dashboard health comes from the agent runtime, never the legacy persisted node.state.
  const homeRuntime=new Map(await Promise.all(DB.nodes.slice(0,6).map(async n=>{
    try{return [Number(n.id),await backendRequest('/api/v1/nodes/'+encodeURIComponent(n.id)+'/runtime')]}
    catch(_){return [Number(n.id),null]}
  })));
  const homeNodeStatus=n=>{
    if(n.disabled)return ['Отключён','--mu'];
    const runtime=homeRuntime.get(Number(n.id));
    if(runtime?.connected===true){
      if(runtime.xrayRunning===false)return ['Xray остановлен','--wr'];
      if(runtime.routerRunning===false)return ['Маршрутизатор остановлен','--wr'];
      return ['Агент онлайн','--ok'];
    }
    if(runtime?.connected===false)return ['Нет связи с агентом','--er'];
    return ['Статус неизвестен','--mu'];
  };
  const nodeRows=DB.nodes.length?DB.nodes.slice(0,6).map(n=>`<div class="rowi"><span class="fg" style="font-size:1.25rem">${flagView(n.flag)}</span><div><b>${esc(n.name)}</b><br><small class="mu">${viewerMode()?'Адрес скрыт':esc(n.addr||'—')+(n.port?':'+esc(n.port):'')}</small></div>${chip(...homeNodeStatus(n))}</div>`).join(''):'<div class="empty"><b>Узлов пока нет</b><span>Добавьте первый сервер, чтобы начать настройку.</span><button class="btn sm" data-ne="nodes">'+ic('plus')+'Добавить узел</button></div>';
  const userRows=DB.users.length?DB.users.slice(0,6).map(u=>`<div class="rowi"><button class="who" data-uo="${u.id}"><span class="av" style="${userAvatarStyle(u)}">${esc((u.username||'?')[0].toUpperCase())}</span><span>${esc(u.username)}</span></button>${chip(STM[st(u)]?.[0]||st(u),'--mu')}</div>`).join(''):'<div class="empty"><b>Пользователей пока нет</b><span>Создайте сквад перед добавлением первого пользователя.</span><button class="gh sm" data-ne="squads">'+ic('plus')+'Создать сквад</button></div>';
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
const UQ={q:'',st:'all',sq:'',inbound:'',tag:'',fp:'',node:'',expiry:'',page:1,size:15,sort:'created',dir:'desc',sel:new Set()};let UIDS=[];
async function usersP(){
  return [`<div class="card users-panel"><div class="bar2 users-statusbar"><div class="fl" id="uf"></div></div><div class="users-toolbar">
    <div class="users-search-wrap"><label class="search users-search-field" style="cursor:text">${ic('search')}<input id="uq" placeholder="Поиск пользователей" value="${esc(UQ.q)}" aria-label="Поиск по имени, тегу, email, ссылке или Telegram ID"></label><span class="users-search-hint">Поиск по имени · тегу · email · ссылке · Telegram ID</span></div>
    <select id="usq" aria-label="Сквад"><option value="">Все сквады</option>${DB.squads.map(s=>`<option value="${s.id}"${UQ.sq==s.id?' selected':''}>${esc(s.name)}</option>`).join('')}</select>
    <div class="users-toolbar-actions"><button type="button" class="gh users-refresh-action" data-users-refresh title="Загрузить актуальные данные пользователей" aria-label="Обновить список пользователей">${ic('redo')}<span>Обновить</span></button><button class="gh" data-exp>${ic('dl')}Экспорт CSV</button><button class="btn" data-nu>${ic('plus')}Пользователь</button></div>
  </div><div class="users-advanced-filters" aria-label="Дополнительные фильтры пользователей">
    <label>Тег <select data-user-filter="tag"><option value="">Все теги</option>${[...new Set(DB.users.map(u=>u.tag).filter(Boolean))].sort().map(tag=>`<option value="${esc(tag)}"${UQ.tag===tag?' selected':''}>${esc(tag)}</option>`).join('')}</select></label>
    <label>Inbound <select data-user-filter="inbound"><option value="">Все inbound</option>${[...new Set(DB.squads.flatMap(s=>s.inb||[]))].sort().map(tag=>`<option value="${esc(tag)}"${UQ.inbound===tag?' selected':''}>${esc(tag)}</option>`).join('')}</select></label>
    <label>Узел <select data-user-filter="node"><option value="">Все узлы</option>${DB.nodes.map(n=>`<option value="${n.id}"${UQ.node===String(n.id)?' selected':''}>${esc(n.name)}</option>`).join('')}</select></label>
    <label>Срок <select data-user-filter="expiry"><option value="">Любой срок</option><option value="eternal"${UQ.expiry==='eternal'?' selected':''}>Бессрочно</option><option value="3"${UQ.expiry==='3'?' selected':''}>До 3 дней</option><option value="7"${UQ.expiry==='7'?' selected':''}>До 7 дней</option><option value="30"${UQ.expiry==='30'?' selected':''}>До 30 дней</option></select></label>
    <button type="button" class="gh sm" data-user-filter-reset>Сбросить фильтры</button>
  </div><div class="bulk" id="bulk" role="toolbar" aria-label="Массовые действия"></div><div id="ut"></div></div>`,()=>{drawUsers();let h;$('#uq').oninput=e=>{clearTimeout(h);h=setTimeout(()=>{UQ.q=e.target.value.trim().toLowerCase();UQ.page=1;drawUsers()},200)};$('#usq').onchange=e=>{UQ.sq=e.target.value;UQ.page=1;drawUsers()};
    $$('[data-user-filter]').forEach(el=>el.onchange=()=>{UQ[el.dataset.userFilter]=el.value;UQ.page=1;drawUsers()});
    $('[data-user-filter-reset]').onclick=()=>{for(const key of ['sq','inbound','tag','node','expiry'])UQ[key]='';UQ.page=1;render(1)};
    // Poll only user presence, not the entire bootstrap with profiles and secrets.
    // Xray confirms recent traffic, not a persistent TCP connection state.
    let presenceRefreshBusy=false,presenceErrorLogged=false;
    const refreshPresence=async()=>{
      if(cur!=='users'||document.hidden||presenceRefreshBusy)return;
      presenceRefreshBusy=true;
      try{
        const startedAt=Date.now();
        const signal=typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'
          ?AbortSignal.timeout(8000):undefined;
        const response=await fetch('/api/v1/users/presence',{
          credentials:'same-origin',cache:'no-store',signal
        });
        if(!response.ok)throw Error('HTTP '+response.status);
        const payload=await response.json();
        if(!Array.isArray(payload?.items)||payload.items.length>100000)throw Error('Invalid presence response');
        const serverNow=Number(payload.serverNowMs);
        if(!Number.isSafeInteger(serverNow)||serverNow<=0)throw Error('Invalid presence clock');
        // Use server time for TTL decisions even when the operator PC clock drifts.
        presenceClockOffsetMs=serverNow-Math.round((startedAt+Date.now())/2);
        const activity=new Map(payload.items.map(item=>[String(item.id),Number(item.onlineAt)]));
        for(const u of DB.users){
          const at=activity.get(String(u.id));
          if(Number.isSafeInteger(at)&&at>=0)u.onlineAt=at;
        }
        presenceFeedHealthy=true;
        presenceErrorLogged=false;
      }catch(error){
        // Unknown telemetry is not a proof of presence. Fail closed.
        presenceFeedHealthy=false;
        if(!presenceErrorLogged)console.warn('XMesh user presence refresh failed:',error);
        presenceErrorLogged=true;
      }finally{
        presenceRefreshBusy=false;
        if(cur==='users'){
          document.querySelectorAll('[data-user-presence-id]').forEach(dot=>{
            const user=DB.users.find(u=>String(u.id)===dot.dataset.userPresenceId);
            dot.style.display=user&&isOn(user)?'':'none';
          });
          if($('#ut'))void drawUsers();
        }
      }
    };
    void refreshPresence();
    T.push(setInterval(()=>{void refreshPresence()},10000));
  }];
}
const uf=u=>(UQ.st=='all'||(UQ.st=='ONLINE'?isOn(u):st(u)==UQ.st))&&(!UQ.sq||u.squads.includes(+UQ.sq))&&(!UQ.tag||u.tag===UQ.tag)
&&(!UQ.expiry||(UQ.expiry==='eternal'?!u.expireAt:!!u.expireAt&&u.expireAt>=Date.now()&&u.expireAt-Date.now()<=Number(UQ.expiry)*DAY))
&&(!UQ.inbound||DB.squads.some(s=>u.squads.includes(s.id)&&(s.inb||[]).includes(UQ.inbound)))
&&(!UQ.node||DB.nodes.some(n=>String(n.id)===UQ.node&&DB.squads.some(s=>u.squads.includes(s.id)&&(s.inb||[]).some(tag=>DB.profiles.some(p=>String(p.id)===String(n.profileId)&&inbs(p).some(ib=>ib.tag===tag))))))
&&(!UQ.q||[u.username,u.tag,u.email,u.desc,u.tg,u.short,...u.squads.map(id=>DB.squads.find(s=>s.id===id)?.name||'')].join(' ').toLowerCase().includes(UQ.q));
async function drawUsers(){
  const [r,s]=await Promise.all([api.list('users',{f:uf,sort:UQ.sort,dir:UQ.dir,page:UQ.page,size:UQ.size}),api.stats()]);if(!$('#ut'))return;
  const pages=Math.max(1,Math.ceil(r.total/UQ.size));if(UQ.page>pages){UQ.page=pages;return drawUsers()}UIDS=r.ids;
  $('#uf').innerHTML=[['all','Все',s.total],['ONLINE','Онлайн',s.online],['ACTIVE','Активные',s.by.ACTIVE||0],['ON_HOLD','Ожидают',s.by.ON_HOLD||0],['LIMITED','Лимит',s.by.LIMITED||0],['EXPIRED','Истёк',s.by.EXPIRED||0],['DISABLED','Отключены',s.by.DISABLED||0]].map(([k,l,n])=>`<button data-uf="${k}" class="${UQ.st==k?'on':''}">${l}<b>${n}</b></button>`).join('');
  const th=(k,l)=>`<th><button data-s="${k}">${l}${UQ.sort==k?(UQ.dir=='asc'?' ↑':' ↓'):''}</button></th>`;
  const all=r.items.length&&r.items.every(u=>UQ.sel.has(u.id));
  $('#ut').innerHTML=r.total?`<div class="tw"><table class="tb"><thead><tr><th class="c1"><input type="checkbox" data-sela ${all?'checked':''} aria-label="Выбрать все на странице"></th>${th('username','Пользователь')}${th('status','Статус')}${th('used','Трафик')}${th('expireAt','Срок')}<th>Доступ</th>${th('onlineAt','Был в сети')}<th class="user-row-actions-head">Действия</th></tr></thead><tbody>${r.items.map(u=>{const [sl,sc]=STM[st(u)],k=u.limit?u.used/u.limit:0,on=isOn(u);return `<tr data-id="${u.id}" class="${UQ.sel.has(u.id)?'sel':''}"><td class="c1"><input type="checkbox" data-sel="${u.id}" ${UQ.sel.has(u.id)?'checked':''} aria-label="Выбрать ${esc(u.username)}"></td><td data-l=""><div class="who"><span class="av" style="${userAvatarStyle(u)}">${esc(u.username[0].toUpperCase())}</span><div>${esc(u.username)} ${u.tag?chip(esc(u.tag),'--c3'):''}${u.desc?`<small class="mu">${esc(u.desc)}</small>`:''}</div></div></td><td data-l="Статус">${chip(sl,sc)}</td><td data-l="Трафик"><div class="tr">${u.limit?`<div class="pb${k>=1?' er':k>.85?' wr':''}" style="--w:${Math.min(100,k*100)}%"><i></i></div>`:''}<small>${gb(u.used)} / ${u.limit?u.limit+' ГБ':'∞'}</small></div></td><td data-l="Срок"${u.expireAt&&u.expireAt<Date.now()+3*DAY?' class="er"':''}>${userExpiryCell(u)}</td><td data-l="Доступ">${u.squads.map(i=>chip(esc(DB.squads.find(x=>x.id==i)?.name||'?'),'--b')).join(' ')}</td><td data-l="Был в сети">${on?'<span class="dot"></span> онлайн':ago(u.onlineAt)}</td><td data-l="Действия"><div class="user-row-actions"><button type="button" class="gh sm" data-row-sub-copy="${u.id}" title="Скопировать ссылку подписки" aria-label="Скопировать подписку ${esc(u.username)}">${ic('copy')}Ссылка</button><button type="button" class="gh sm user-row-delete" data-row-delete="${u.id}" title="Удалить пользователя" aria-label="Удалить пользователя ${esc(u.username)}">${ic('trash')}</button></div></td></tr>`}).join('')}</tbody></table></div><div class="pg"><span>${(UQ.page-1)*UQ.size+1}–${Math.min(r.total,UQ.page*UQ.size)} из ${r.total}</span><select data-psz aria-label="Строк на странице">${[15,30,60].map(n=>`<option${n==UQ.size?' selected':''}>${n}</option>`).join('')}</select><button class="ia" data-pg="-1" ${UQ.page>1?'':'disabled'} aria-label="Назад">${ic('chevronLeft')}</button><button class="ia" data-pg="1" ${UQ.page<pages?'':'disabled'} aria-label="Вперёд">${ic('chevronRight')}</button></div>`:`<div class="empty"><b>Никого не найдено</b><span>Измените поиск или фильтр, либо создайте пользователя.</span><button class="btn sm" data-nu>${ic('plus')}Создать</button></div>`;
  drawBulk();
}
function drawBulk(){const b=$('#bulk'),n=UQ.sel.size;if(!b)return;b.classList.toggle('on',n>0&&cur=='users');if(!n){b.innerHTML='';return}b.innerHTML=`<b style="padding:0 .5rem">Выбрано ${n}</b>${UIDS.length>n?`<button class="gh sm" data-bk="all">Выбрать все ${UIDS.length}</button>`:''}<button class="gh sm" data-bk="on">Включить</button><button class="gh sm" data-bk="off">Отключить</button><button class="gh sm" data-bk="reset">Сбросить трафик</button><button class="gh sm" data-bk="ext">${ic('calendar')}Продлить…</button><button class="gh sm" data-bk="sq">В сквад</button><button class="dg sm" data-bk="del">${ic('trash')}Удалить</button><button class="ia" data-bk="clr" aria-label="Снять выбор">${ic('x')}</button>`;decorateButtonIcons(b)}
// Deterministic, high-variation Telegram-inspired gradients (no color flicker).
// Spread avatar hues across known users, preventing near-identical neighbors.
function userAvatarHue(u){
  const key=String(u?.id??u?.username??'unknown');
  const ids=(DB?.users||[]).map(x=>String(x.id??x.username??'unknown')).sort();
  const index=ids.indexOf(key);
  if(index>=0)return (24+index*137.507764)%360;
  return (hs(key)*137.507764)%360;
}
function userAvatarStyle(u){
  const hue=userAvatarHue(u);
  const key=String(u?.id??u?.username??'unknown'),hash=hs(key);
  const secondary=(hue+32+(hash%30))%360;
  const angle=125+(hash%90);
  // Deep saturated gradients keep white initials legible on every avatar.
  return 'background-color:hsl('+hue+' 73% 40%);'+
    'background-image:linear-gradient('+angle+'deg,'+
    'hsl('+hue+' 77% 53%) 0%,'+
    'hsl('+((hue+18)%360)+' 78% 43%) 52%,'+
    'hsl('+secondary+' 75% 31%) 100%);'+
    'color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.48)';
}
const uid=s=>{let h=hs(s),x='';for(let i=0;i<32;i++){h=(h*1664525+1013904223)>>>0;x+=(h>>>24&15).toString(16)}return x.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5')};
let UT='ov';
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
// Stable, varied server accents; neighboring nodes are not restricted to a short palette.
function userServerColor(id){
  const key=String(id??'unknown');let h=2166136261;
  for(const c of key)h=Math.imul(h^c.codePointAt(0),16777619)>>>0;
  const hue=h%360,sat=68+((h>>>12)%20),light=53+((h>>>20)%11);
  return 'hsl('+hue+' '+sat+'% '+light+'%)';
}
function userServerGradient(id){
  const key=String(id??'unknown');let h=2166136261;
  for(const c of key)h=Math.imul(h^c.codePointAt(0),16777619)>>>0;
  const hue=h%360,other=(hue+30+((h>>>8)%75))%360;
  return 'linear-gradient('+(120+h%100)+'deg,hsl('+hue+' 86% 70%),hsl('+other+' 79% 48%))';
}
function userServerSegments(servers){
  const sum=servers.reduce((n,r)=>n+Math.max(0,+r.uplinkBytes + +r.downlinkBytes),0);
  if(!sum)return 'conic-gradient(var(--ln) 0% 100%)';
  let cursor=0;
  return 'conic-gradient('+servers.map(r=>{
    const end=cursor+Math.max(0,+r.uplinkBytes + +r.downlinkBytes)/sum*100;
    const piece=userServerColor(r.nodeId)+' '+cursor.toFixed(4)+'% '+end.toFixed(4)+'%';
    cursor=end;return piece;
  }).join(',')+')';
}
function userTrafficDonutsMarkup(payload){
  const servers=Array.isArray(payload?.servers)?payload.servers.filter(r=>
    r&&Number.isFinite(+r.nodeId)&&Number.isFinite(+r.uplinkBytes)&&Number.isFinite(+r.downlinkBytes)
    &&+r.uplinkBytes>=0&&+r.downlinkBytes>=0):[];
  if(!servers.length){
    const collectors=Array.isArray(payload?.collectors)?payload.collectors:[];
    const now=Date.now();
    const current=collectors.filter(r=>Number.isFinite(+r.sampledAtMs)&&now-(+r.sampledAtMs)<90000);
    const ready=current.filter(r=>r.status==='verified'||r.status==='direct');
    const failed=current.filter(r=>r.status==='unavailable');
    const names=failed.slice(0,3).map(r=>esc(r.name||'Узел #'+r.nodeId)).join(', ');
    const title=ready.length?'Счётчики работают, но трафика пользователя пока нет':
      failed.length?'Сбор трафика Xray на нодах недоступен':
      'Нет подтверждённых пользовательских счётчиков';
    const help=ready.length?'Проверьте, что пользователь подключается именно с этим Xray ID и входит в назначенный сквад. Первое измерение создаёт базовую отметку; далее новые байты учитываются автоматически.':
      failed.length?'Агент отправляет сетевые метрики VPS, но не получает статистику Xray. Проверьте xmesh-node-user-meter.timer, docker exec xmesh-managed-xray xray api statsquery и журналы служб на нодах'+(names?' ('+names+')':'')+'.':
      'Ноды не прислали свежую подтверждённую статистику Xray. Проверьте таймер xmesh-node-user-meter и службу xmesh-node-metrics на подключённых нодах.';
    return '<div class="user-chart-empty"><div class="user-chart-empty-ring" aria-hidden="true"><span>—</span></div><div class="user-chart-empty-copy"><b>'+title+'</b><p>'+help+'</p><small>Статус подтверждён подписанными метриками. Общий трафик VPS не считается трафиком пользователя.</small></div></div>';
  }
  const up=servers.reduce((sum,r)=>sum+Number(r.uplinkBytes),0);
  const down=servers.reduce((sum,r)=>sum+Number(r.downlinkBytes),0);
  const total=up+down;
  const cards=servers.map(r=>{
    const amount=Number(r.uplinkBytes)+Number(r.downlinkBytes);
    const share=total?Math.min(100,Math.max(0,amount/total*100)):0;
    const percent=total?fmt(share,share<1?1:0):'0';
    const seen=Number.isFinite(+r.updatedAtMs)?new Date(+r.updatedAtMs).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
    return '<article class="user-server-item"><div class="user-server-donut" style="--traffic-share:'+share.toFixed(3)+'%;--server-color:'+userServerColor(r.nodeId)+'" role="img" aria-label="'+esc(String(r.name||'Узел #'+r.nodeId))+': '+percent+'% пользовательского трафика"><span>'+percent+'%</span></div><div class="user-server-details"><b title="'+esc(r.name||'Узел #'+r.nodeId)+'">'+esc(r.name||'Узел #'+r.nodeId)+'</b><strong>'+userTrafficBytes(amount)+'</strong><small>↑ '+userTrafficBytes(r.uplinkBytes)+' · ↓ '+userTrafficBytes(r.downlinkBytes)+'</small><span class="user-server-updated">Срез '+esc(seen)+'</span></div></article>';
  }).join('');
  const downloadShare=total?down/total*100:0;
  const chart='<div class="user-traffic-visual"><div class="user-traffic-main-donut" style="--server-gradient:'+userServerSegments(servers)+'" role="img" aria-label="Скачано '+userTrafficBytes(down)+', загружено '+userTrafficBytes(up)+'"><div><small>Всего</small><strong>'+userTrafficBytes(total)+'</strong></div></div><div class="user-traffic-legend"><div><span class="user-legend-dot is-down"></span><span>Скачано</span><b>'+userTrafficBytes(down)+'</b></div><div><span class="user-legend-dot is-up"></span><span>Отправлено</span><b>'+userTrafficBytes(up)+'</b></div><small>Серверов с данными: '+servers.length+'</small></div></div>';
  return chart+(total===0?'<p class="user-server-pending">Счётчики подключены, но трафик пока не зарегистрирован.</p>':'')+'<div class="user-server-grid">'+cards+'</div><small class="user-server-source">Данные только из персональных счётчиков Xray. Общий трафик VPS не используется.</small>';
}
function userInboundTrafficMarkup(payload){
 const rows=Array.isArray(payload?.inbounds)?payload.inbounds.filter(r=>r&&typeof r.inboundTag==='string'&&Number.isFinite(+r.uplinkBytes)&&Number.isFinite(+r.downlinkBytes)): [];
 if(!rows.length)return '<section class="user-inbound-stats"><h4>Трафик по inbound</h4><p class="note">Пока нет персональных счётчиков по inbound. Обычный Xray StatsService отдаёт пользователя и inbound отдельно; эти общие значения нельзя перемножать или распределять искусственно. Требуется агент, передающий реальные счётчики userInboundTraffic.</p></section>';
 const cards=rows.map(r=>'<div class="user-inbound-item"><div><b>'+esc(r.inboundTag)+'</b><small>'+esc(r.nodeName||'Узел #'+r.nodeId)+'</small></div><div><b>'+userTrafficBytes(+r.uplinkBytes + +r.downlinkBytes)+'</b><small>↑ '+userTrafficBytes(r.uplinkBytes)+' · ↓ '+userTrafficBytes(r.downlinkBytes)+'</small></div></div>').join('');
 return '<section class="user-inbound-stats"><h4>Трафик по inbound</h4><div class="user-inbound-grid">'+cards+'</div><small class="user-server-source">Только фактические подписанные измерения узлов; не прибавляются повторно к общему трафику пользователя.</small></section>';
}
let userTrafficAutoGeneration=0;
function startUserTrafficAutoRefresh(userId){
  const generation=++userTrafficAutoGeneration;
  const tick=async()=>{
    if(generation!==userTrafficAutoGeneration||!dlg.open||
       !dlg.querySelector('[data-user-traffic-id="'+userId+'"]'))return;
    await loadUserTrafficStats(userId);
    if(generation===userTrafficAutoGeneration&&dlg.open&&
       dlg.querySelector('[data-user-traffic-id="'+userId+'"]'))
      setTimeout(tick,15000);
  };
  setTimeout(tick,15000);
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
      // The header must reflect the same signed meter as the graphs, without
      // waiting for another full panel bootstrap (and without double counting).
      const used=Number(payload?.effectiveUsedGb);
      const u=DB.users.find(item=>item.id===userId);
      if(u&&Number.isFinite(used)&&used>=0&&payload?.effectiveUsedGb!=null){
        u.used=used;
        const value=dlg.querySelector('.user-usage-line>strong');
        if(value)value.textContent=gb(used);
        const track=dlg.querySelector('.user-usage-track');
        if(track&&u.limit>0){
          const percent=Math.min(100,Math.max(0,used/u.limit*100));
          track.style.setProperty('--usage',percent+'%');
          track.setAttribute('aria-valuenow',String(Math.round(percent)));
        }
      }
    }
  }catch(error){
    if(dlg.open&&container.isConnected&&dlg.contains(container)){
      container.innerHTML='<div class="user-traffic-empty">'+ic('activity')+'<div><b>Не удалось получить статистику</b><p>'+esc(error.message||'Ошибка загрузки метрик')+'</p><button type="button" class="gh sm" data-user-traffic-refresh="'+userId+'">Повторить</button></div></div>';
    }
  }
}
function userRemainingLabel(expireAt){
  if(expireAt==null||expireAt===''||Number(expireAt)===0)return 'Бессрочно';
  const expiry=Number(expireAt);
  if(!Number.isFinite(expiry))return '—';
  const remaining=expiry-Date.now();
  if(remaining<=0)return 'Срок истёк';
  const days=Math.ceil(remaining/86400000);
  return days+' '+(days%10===1&&days%100!==11?'день':days%10>=2&&days%10<=4&&(days%100<12||days%100>14)?'дня':'дней');
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
      <div class="who"><span class="av" style="${userAvatarStyle(u)}">${esc((u.username||'?')[0].toUpperCase())}</span><div><h2>${esc(u.username)}</h2>${chip(label,statusColor)} <span class="dot" data-user-presence-id="${u.id}" style="${isOn(u)?'':'display:none'}"></span></div></div>
      <div class="user-head-actions"><button type="button" class="gh sm" data-a="tog" data-u="${u.id}">${ic(u.disabled?'play':'pause')}${u.disabled?'Включить':'Отключить'}</button><button type="button" class="ia user-remove" data-a="del" data-u="${u.id}" aria-label="Удалить пользователя" title="Удалить пользователя">${ic('trash')}</button><button type="button" class="ia" data-x aria-label="Закрыть">${ic('x')}</button></div>
    </header>
    <div class="user-overview-band">
      <div class="user-usage-line"><span>Трафик</span><strong>${gb(u.used)}</strong><small>${u.limit?'из '+u.limit+' ГБ':'без лимита'}</small><button type="button" class="user-action-text" data-a="rst" data-u="${u.id}" title="Обнулить использованный трафик">${ic('redo')} Сбросить</button><span class="user-expiry-summary" data-user-expiry-summary >${ic('calendar')} <span>Осталось</span> <strong>${userRemainingLabel(u.expireAt)}</strong></span></div>
      ${u.limit?`<div class="user-usage-track" style="--usage:${Math.min(100,Math.max(0,usageRatio*100))}%" role="progressbar" aria-label="Использование трафика" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100,Math.max(0,usageRatio*100)))}"><i></i></div>`:''}
      <div class="user-identity-row"><span>Xray ID</span>${viewerMode() ? '<code class="user-id-masked" aria-label="Xray ID скрыт">••••••••-••••-••••-••••-••••••••••••</code>' : `<code class="user-id-value">${esc(u.xrayId || "—")}</code><button type="button" class="user-id-copy" data-copy-xray-id="${u.id}" aria-label="Копировать Xray ID" title="Копировать Xray ID">${ic("copy")}</button>`}</div>
    </div>
    <div class="user-canvas-grid">
      <section class="user-pane user-pane-settings" aria-label="Настройки пользователя">
        <div class="user-pane-heading"><div><h3>Настройки</h3><p>Все поля доступны сразу</p></div></div>
        <form data-k="uedit" data-id="${u.id}" method="dialog" class="user-inline-editor">
          <div class="user-edit-fields">
            ${field(FE.find(f=>f.k==='username'),u.username)}
            ${field(FE.find(f=>f.k==='limit'),u.limit)}
            ${userDateField(u)}
            ${field(FE.find(f=>f.k==='strategy'),u.strategy)}
            ${FE.filter(f=>!['username','limit','expireAt','strategy','desc'].includes(f.k)).map(f=>field(f,u[f.k])).join('')}
            <label class="f user-notes-field"><span>Заметка</span><textarea name="desc" rows="4" spellcheck="true" placeholder="Дополнительная информация о пользователе…" data-user-note>${esc(u.desc||'')}</textarea><small class="user-note-meta"><span>Внутренняя заметка администратора</span><span data-user-note-count>${Array.from(u.desc||'').length} символов</span></small></label>
          </div>
          <p class="er" id="fe" role="status"></p>
          <div class="user-editor-actions"><span class="user-edit-dirty" data-user-edit-dirty role="status" aria-live="polite"></span><button type="submit" class="btn user-save-button">${ic('check')} Сохранить изменения</button></div>
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
        <p class="user-sub-note">Постоянная ссылка на подписку. Домен, путь, оформление и приложения управляются в SUBSCRIPTION STUDIO.</p>
        <div class="user-subscription-state" data-user-sub-state="${u.id}" role="status" aria-live="polite"><span class="user-canvas-muted">Загружаем ссылку…</span></div>
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
  startUserTrafficAutoRefresh(u.id);
  if(!viewerMode())void loadUserSubscription(u.id);
}
async function loadUserSubscription(id){
  const target=$('[data-user-sub-state="'+id+'"]');
  if(!target)return;
  try{
    const result=await backendRequest('/api/v1/users/'+encodeURIComponent(id)+'/subscription');
    // A response from an older dialog must not overwrite a newer one.
    if(!target.isConnected)return;
    if(result.token&&result.url){
      const url=new URL(result.url,location.origin).href;
      const label=panelIsEnglish()?'Subscription link':'Ссылка подписки';
      target.innerHTML='<div class="user-sub-link-card"><div class="user-sub-link-head"><span class="user-sub-link-label">'+label+'</span><span class="user-sub-link-status"><span class="user-sub-status-dot"></span>'+(panelIsEnglish()?'Issued':'Выпущена')+'</span></div>'+
        '<div class="user-sub-link-row"><input type="text" class="user-subscription-url" aria-label="'+label+'" value="'+esc(url)+'" readonly spellcheck="false" autocomplete="off" title="'+esc(url)+'">'+
        '<button type="button" class="btn sm user-sub-copy-main" data-user-sub-copy="'+id+'" title="'+(panelIsEnglish()?'Copy subscription link':'Скопировать ссылку')+'">'+ic('copy')+(panelIsEnglish()?'Copy':'Копировать')+'</button></div>'+
        '<div class="user-sub-actions"><button type="button" class="gh sm" data-user-sub-open="'+id+'">'+ic('external-link')+(panelIsEnglish()?'Open subscription':'Открыть')+'</button>'+
        '<button type="button" class="gh sm" data-user-sub-create="'+id+'">'+ic('refresh-cw')+(panelIsEnglish()?'Rotate':'Перевыпустить')+'</button>'+
        '<button type="button" class="gh sm user-sub-revoke" data-user-sub-revoke="'+id+'">'+ic('shield-off')+(panelIsEnglish()?'Revoke':'Отозвать')+'</button></div></div>';
    }else{
      const message=result.legacy?(panelIsEnglish()?'Old link remains active, but its secret cannot be recovered. Rotate it once to enable persistent display.':'Старая ссылка продолжает действовать, но её секрет нельзя восстановить из хеша. Один раз перевыпустите её для постоянного отображения.'):(panelIsEnglish()?'No subscription has been issued yet.':'Подписка ещё не создана.');
      target.innerHTML='<p class="user-sub-note">'+esc(message)+'</p><div class="act"><button type="button" class="btn sm" data-user-sub-create="'+id+'">'+ic('link')+(result.legacy?(panelIsEnglish()?'Rotate legacy link':'Перевыпустить старую ссылку'):(panelIsEnglish()?'Create subscription':'Создать подписку'))+'</button>'+
        (result.legacy?'<button type="button" class="gh sm" data-user-sub-revoke="'+id+'">'+ic('shield-off')+(panelIsEnglish()?'Revoke':'Отозвать')+'</button>':'')+'</div>';
    }
  }catch(error){
    if(!target.isConnected)return;
    target.textContent=(panelIsEnglish()?'Subscription loading error: ':'Ошибка загрузки подписки: ')+(error.message||'API');
  }
}
// Usernames: cryptographically random, readable and comfortably below 32 chars.
const USERNAME_ADJECTIVES=['silent','cosmic','silver','hidden','rapid','midnight','stellar','shadow','gentle','arctic','velvet','lunar','mystic','amber','crystal','steady','bright','frozen','swift','nebula'];
const USERNAME_NOUNS=['ninja','falcon','voyager','comet','raven','panda','tiger','orbit','phoenix','fox','otter','dragon','sparrow','pilot','meteor','cipher','pioneer','wolf','echo','nebula'];
function randomUsername(){
  if(!globalThis.crypto?.getRandomValues)throw new Error('Безопасная генерация недоступна: требуется HTTPS.');
  const words=new Uint32Array(2);
  crypto.getRandomValues(words);
  const bytes=new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const suffix=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return (USERNAME_ADJECTIVES[words[0]%USERNAME_ADJECTIVES.length]+'_'+USERNAME_NOUNS[words[1]%USERNAME_NOUNS.length]+'_'+suffix).slice(0,32);
}
function generateAvailableUsername(current=''){
  const taken=new Set(DB.users.map(user=>String(user.username||'').toLowerCase()));
  for(let attempt=0;attempt<30;attempt++){
    const name=randomUsername();
    if(name!==current&& !taken.has(name.toLowerCase()))return name;
  }
  throw new Error('Не удалось подобрать уникальное имя. Повторите попытку.');
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-generate-username]');
  if(!button)return;
  const form=button.closest('form[data-k="user"]');
  const input=form?.querySelector('[name="username"]');
  if(!input)return;
  event.preventDefault();
  try{
    input.value=generateAvailableUsername(input.value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.focus();
    input.setSelectionRange(input.value.length,input.value.length);
    const error=form.querySelector('#fe');
    if(error)error.textContent='';
  }catch(error){toast(error.message||'Не удалось сгенерировать имя')}
});
function userNew(){
  if(!DB.squads.length){modal(`<div class="box"><h2>Сначала создайте сквад</h2><p class="note">Пользователю нужно назначить группу доступа. Создайте сквад, а затем вернитесь к созданию пользователя.</p><div class="act"><button class="gh" data-x>Отмена</button><button class="btn" data-ne="squads">${ic('plus')}Создать сквад</button></div></div>`);return}
  const fs=FU;modal(`<form class="box" data-k="user" method="dialog"><h2>Новый пользователь</h2><label class="f"><span>Шаблон</span><select id="tplsel"><option value="">Без шаблона</option>${DB.tpls.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><small>При необходимости подставит параметры из сохранённого шаблона</small></label>${fs.map(f=>{const markup=field(f,{limit:0,days:0,strategy:'NO_RESET',hwid:0,squads:[]}[f.k]);return f.k==='username'?markup.replace('<span>Имя пользователя</span>','<span style="display:flex;align-items:center;justify-content:space-between;gap:.6rem">Имя пользователя <button type="button" class="gh sm" data-generate-username title="Сгенерировать случайное уникальное имя" aria-label="Сгенерировать имя пользователя" style="display:inline-flex;align-items:center;gap:.35rem">'+ic('redo')+' Сгенерировать</button></span>'):markup}).join('')}<p class="er" id="fe"></p><div class="act"><button type="button" class="gh" data-x>Отмена</button><button class="btn">Создать</button></div></form>`,'wide');
  setTimeout(()=>$('[name=username]')?.focus(),60);
}
async function exportCsv(){
  if(!await panelConfirm(panelIsEnglish()?'CSV may include secret subscription links. Export to a trusted device?':'CSV может содержать секретные ссылки подписок. Экспортировать на доверенное устройство?'))return;
  const users=UIDS.map(id=>DB.users.find(u=>u.id==id)).filter(Boolean);
  const links=[];
  for(let i=0;i<users.length;i+=10){
    const batch=await Promise.all(users.slice(i,i+10).map(async u=>{
      try{
        const result=await backendRequest('/api/v1/users/'+encodeURIComponent(u.id)+'/subscription');
        return result.url?new URL(result.url,location.origin).href:'';
      }catch{return ''}
    }));
    links.push(...batch);
  }
  const rows=[['username','status','used_gb','limit_gb','expire','tag','telegram','email','squads','sub_url']]
    .concat(users.map((u,i)=>[u.username,st(u),u.used,u.limit,u.expireAt?new Date(u.expireAt).toISOString().slice(0,10):'',u.tag,u.tg,u.email,u.squads.map(id=>DB.squads.find(s=>s.id==id)?.name).join('|'),links[i]]));
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(c=>'"'+String(c??'').replace(/"/g,'""')+'"').join(',')).join('\n')],{type:'text/csv'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='users.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  toast((panelIsEnglish()?'Exported: ':'Экспортировано: ')+users.length);
}

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
 return {log:{loglevel:v('loglevel')||'warning'},stats:{},policy:{levels:{'0':{statsUserUplink:true,statsUserDownlink:true}}},inbounds:[inbound],outbounds:[{protocol:'freedom',tag:'direct'},{protocol:'blackhole',tag:'blocked'}],routing:{rules:[{type:'field',outboundTag:'direct',inboundTag:[tag]}]}};
}
async function syncXrayUserToProfile(user){
 const profile=DB.profiles.find(p=>String(p.id)===String(user.xrayProfileId));
 if(!profile)throw new Error('Выбранный Xray-профиль не найден.');
 const config=typeof profile.config==='string'?JSON.parse(profile.config):structuredClone(profile.config||{});
 if(!Array.isArray(config.inbounds))throw new Error('В профиле отсутствует массив inbounds.');
 let changed=0,skipped=[];
 for(const inbound of config.inbounds){
  inbound.settings=inbound.settings||{};
  // Xray counts per email. Encode both the numeric user and inbound tag
  // into the Xray stats identity, so each inbound gets an independent user counter.
  // Do not guess this intersection from separate aggregate counters.
  const email='xmesh-u'+Number(user.id)+'--'+encodeURIComponent(String(inbound.tag||''));
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
const xrayClientLocalDefaults=()=>({
 dns:{queryStrategy:'UseIPv4',servers:['1.1.1.1']},
 inbounds:[
  {listen:'127.0.0.1',port:10808,protocol:'socks',settings:{auth:'noauth',udp:true},sniffing:{enabled:true,destOverride:['http','tls','quic']},tag:'socks'},
  {listen:'127.0.0.1',port:10809,protocol:'http',settings:{},sniffing:{enabled:true,destOverride:['http','tls','quic']},tag:'http'}
 ]
});
// Public client endpoints originate only from configured Hosts/Nodes. Never
// derive them from window.location (the panel domain may not serve the VPN).
// A Host is an explicit client-facing endpoint and outranks a node's management
// address. Ambiguous mappings must be selected rather than guessed.
function xrayStudioEndpointOptions(db,tag){
 const records=[],nodes=Array.isArray(db?.nodes)?db.nodes:[],hosts=Array.isArray(db?.hosts)?db.hosts:[],profiles=Array.isArray(db?.profiles)?db.profiles:[];
 const cleanAddress=value=>{
  const v=String(value||'').trim();
  if(!v||v==='0.0.0.0'||v==='::'||v==='127.0.0.1'||v==='localhost'||v==='[::1]'||/\s|[/?#@\\]/.test(v))return '';
  // Management-only addresses are never advertised as client endpoints.
  if(/^(?:10\.|127\.|169\.254\.|192\.168\.|0\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)/.test(v)||/^\[?(?:fc|fd|fe80|::1)/i.test(v))return '';
  // URL schemes or port suffixes are not valid addresses in Xray outbound.
  if(v.includes('://')||(/^\[[^\]]+\]:\d+$/.test(v))||(/^[^:]+:\d+$/.test(v)))return '';
  return v;
 };
 const validPort=value=>Number.isSafeInteger(+value)&&+value>0&&+value<=65535?+value:null;
 const selectedTag=String(tag||'').trim();
 const hostMatches=hosts.filter(h=>!h.disabled&&String(h.tag||'').trim()===selectedTag);
 for(const h of hostMatches){
  const address=cleanAddress(h.externalAddress||h.address);
  if(!address)continue;
  // A host without an explicit node restriction is a shared public endpoint
  // for this inbound tag, not a cue to infer the panel domain.
  records.push({key:'host:'+h.id,kind:'host',address,port:validPort(h.externalPort||h.port),name:String(h.remark||h.address),sni:String(h.sni||'').trim(),host:String(h.host||'').trim(),path:String(h.path||'').trim()});
 }
 const profileMatches=new Set(profiles.filter(p=>{
  try{return (typeof p.config==='string'?JSON.parse(p.config):p.config)?.inbounds?.some(i=>i.tag===selectedTag)}catch{return false}
 }).map(p=>Number(p.id)));
 for(const n of nodes){
  if(profileMatches.size&&!profileMatches.has(Number(n.profileId)))continue;
  const address=cleanAddress(n.externalAddress||n.publicAddress||n.addr);
  if(!address)continue;
  records.push({key:'node:'+n.id,kind:'node',address,port:null,name:String(n.name||n.addr),sni:'',host:'',path:''});
 }
 return records;
}
function xrayStudioAutoEndpoint(candidates){
 const hosts=candidates.filter(c=>c.kind==='host');
 if(hosts.length===1)return hosts[0];
 if(hosts.length>1)return null; // Multiple CDN hosts: explicitly choose.
 const nodes=candidates.filter(c=>c.kind==='node');
 return nodes.length===1?nodes[0]:null;
}
function xrayClientSample(){
 const v=id=>$('#xpb-'+id)?.value||'';
 const protocol=v('protocol')||'vless';
 const network=protocol==='hysteria'?'hysteria':protocol==='masque'?'masque':v('network')||'raw';
 const security=['tun','wireguard'].includes(protocol)?'none':['hysteria','masque'].includes(protocol)?'tls':v('security')||'none';
 const endpoint=window.xrayStudioSelectedEndpoint||null;
 const sni=endpoint?.sni||v('sni').trim()||'example.com';
 const address=v('server-address').trim()||'SERVER_ADDRESS';
 const port=protocol==='tun'?0:(endpoint?.port||cl(+v('port')||443,1,65535));
 const path=endpoint?.path||v('path')||'/';
 const host=endpoint?.host||v('host')||sni;
 const uuid=v('uuid')||'REPLACE_WITH_USER_UUID';
 const flow=protocol==='vless'&&['tls','reality'].includes(security)&&network==='raw'?v('flow'):'';
 const vlessEncMode=v('vlessenc-mode')||'off';
 const vlessEncRequired=protocol==='vless'&&(network==='xdrive'||vlessEncMode!=='off');
 let outProtocol=protocol,settings;
 if(['dokodemo-door','tunnel','tun'].includes(protocol))return {...xrayClientLocalDefaults(),remarks:$('#xpb-name')?.value.trim()||'XRAY STUDIO client',note:'Для этого inbound нет прямого одноимённого клиентского outbound. Используйте совместимый клиентский протокол или полный JSON-режим.',outbounds:[]};
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
  ...xrayClientLocalDefaults(),
  remarks:$('#xpb-name')?.value.trim()||'XRAY STUDIO client',
  ...window.XMeshClientConfig.base(outbound)
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
 if(!window.XMeshStudioV4?.view||!window.XMeshStudioV4?.mount)throw new Error('XRAY STUDIO не загрузился: проверьте /xray-studio-v4.js');
 return [window.XMeshStudioV4.view(),()=>{
   const root=document.getElementById('xm-studio-v4');
   if(root)window.XMeshStudioV4.mount(root,{
     DB,api,render:()=>render(1),toast,
     realityKeys:()=>generateRealityKeyPair(),
     apiRequest:(path,options)=>backendRequest(path,options)
   });
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
/* Host = client-facing endpoint, not a second Xray server configuration.
   Resolve inherited values for preview only; never expose server privateKey. */
function hostProfile(profileId){return DB.profiles.find(p=>String(p.id)===String(profileId))}
function hostInbound(profileId,tag){return inbs(hostProfile(profileId)||{}).find(i=>i.tag===tag)}
// Client-only X25519 public-key derivation: never export a REALITY private key
// from the host record or send it to a remote key-generation endpoint.
async function hostDeriveRealityPublic(form){
  if(!form?.isConnected||!globalThis.crypto?.subtle)return;
  const profileId=form.elements.namedItem('profileId')?.value,tag=form.elements.namedItem('tag')?.value;
  const inbound=hostInbound(profileId,tag),reality=inbound?.streamSettings?.realitySettings;
  const field=form.elements.namedItem('publicKey');
  if(!field||String(field.value||'').trim()||!reality?.privateKey)return;
  try{
    const encoded=String(reality.privateKey).replace(/-/g,'+').replace(/_/g,'/');
    const raw=Uint8Array.from(atob(encoded+'='.repeat((4-encoded.length%4)%4)),c=>c.charCodeAt(0));
    if(raw.length!==32)return;
    // RFC 8410 PKCS#8 X25519 private seed (32 bytes).
    const prefix=Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x6e,0x04,0x22,0x04,0x20]);
    const der=new Uint8Array(prefix.length+raw.length);
    der.set(prefix);der.set(raw,prefix.length);
    const key=await crypto.subtle.importKey('pkcs8',der,{name:'X25519'},true,['deriveBits']);
    const exported=await crypto.subtle.exportKey('jwk',key);
    if(!exported.x||!form.isConnected||form.elements.namedItem('profileId')?.value!==String(profileId)
       ||form.elements.namedItem('tag')?.value!==tag||String(field.value||'').trim())return;
    field.value=exported.x;
    field.dataset.hostAutoPublic='1';
    hostEditorRefresh(form);
  }catch(_){
    // Not all browsers support X25519 WebCrypto. Keep the explicit validation
    // warning rather than silently publishing an unusable subscription.
  }
}
function hostEditorRefresh(form,changedProfile=false){
  if(!form||form.dataset.ent!=='hosts')return;
  const get=k=>form.elements.namedItem(k);
  const draft=!!get('disabled')?.checked;
  for(const name of ['remark','address']){
    const input=get(name);
    if(input)input.required=!draft;
  }
  const profile=hostProfile(get('profileId')?.value);
  const inboundSelect=get('tag');
  const candidates=profile?inbs(profile):[];
  const previous=inboundSelect?.value;
  if(inboundSelect && (changedProfile||![...inboundSelect.options].every((o,i)=>i<candidates.length&&o.value===candidates[i].tag))){
    inboundSelect.innerHTML=candidates.map(i=>'<option value="'+esc(i.tag)+'">'+esc(i.tag+' · '+(i.protocol||'?')+' · '+(i.streamSettings?.network||'tcp'))+'</option>').join('');
    if(candidates.some(i=>i.tag===previous))inboundSelect.value=previous;
  }
  // On a fresh Host, choose the unique compatible node automatically.
  const selectedNodes=[...form.querySelectorAll('[name="nodes"]:checked')];
  if(!selectedNodes.length && profile && !form.dataset.id){
    const compatible=DB.nodes.filter(n=>!n.disabled&&String(n.profileId)===String(profile.id));
    if(compatible.length===1){
      const node=compatible[0];
      form.querySelectorAll('[name="nodes"]').forEach(input=>{input.checked=String(input.value)===String(node.id)});
      for(const [key,value] of [['address',node.addr||''],['port',node.port||443],['remark',node.name||'']]){
        const input=form.elements.namedItem(key);
        if(input&&(key==='port'||!String(input.value||'').trim()))input.value=String(value);
      }
    }
  }
  const inbound=candidates.find(i=>i.tag===inboundSelect?.value);
  const stream=inbound?.streamSettings||{};
  const security=stream.security||'none';
  const reality=stream.realitySettings||{};
  const tls=stream.tlsSettings||{};
  // Show only client overrides relevant to the selected transport/security.
  for(const [name,show] of Object.entries({
    sni:security==='reality'||security==='tls',
    host:['ws','xhttp'].includes(stream.network),
    path:['ws','xhttp'].includes(stream.network),
    fp:['reality','tls'].includes(security),
    publicKey:security==='reality',shortId:security==='reality',spiderX:security==='reality',
    alpn:security==='tls',serviceName:stream.network==='grpc',
    clientEncryption:inbound?.protocol==='vless'
  })){
    const input=form.elements.namedItem(name);
    const wrapper=input?.closest('.f');
    if(wrapper)wrapper.hidden=!show;
  }
  const xhttp=stream.xhttpSettings||{};
  const val=k=>String(get(k)?.value||'').trim();
  const securityName=security==='reality'?'REALITY':security==='tls'?'TLS':security;
  const sni=val('sni')||reality.serverNames?.[0]||tls.serverName||'';
  const inheritedKey=reality.publicKey||inbound?.publicKey||'';
  const realityKey=val('publicKey')||inheritedKey;
  const shortId=val('shortId')||reality.shortIds?.[0]||'';
  const requiredNodes=[...form.querySelectorAll('[name="nodes"]:checked')].map(el=>DB.nodes.find(n=>String(n.id)===el.value));
  const mismatched=requiredNodes.filter(n=>!n||n.disabled||!profile||String(n.profileId)!==String(profile.id));
  const show=(label,value)=>'<div class="host-resolved-line"><span>'+esc(label)+'</span><b>'+esc(String(value||'—'))+'</b></div>';
  const preview=form.querySelector('[data-host-resolved]');
  if(preview){
    preview.innerHTML=
      show('Название в Happ',val('remark')||'Введите название слева')+
      show('XRAY STUDIO',profile?.name||'Не выбран')+
      show('Inbound',inbound?.tag||'Не выбран')+
      show('Протокол / транспорт',inbound?(inbound.protocol+' / '+(stream.network||'tcp')):'—')+
      show('Защита',securityName)+
      show('Страна (ISO)',val('countryCode').toUpperCase()||'Авто из названия / ZZ')+
      show('Публичный endpoint',val('address')?val('address')+':'+(val('port')||'443'):'Выберите ноду')+
      show('SNI',sni)+
      show('Путь',val('path')||xhttp.path||stream.wsSettings?.path||'—')+
      show('REALITY publicKey',security==='reality'?(realityKey?'Задан':'Отсутствует'):'Не требуется')+
      show('ShortID',security==='reality'?(shortId?'Задан':'Не задан'):'Не требуется');
  }
  const warnings=[];
  if(!profile)warnings.push('Выберите XRAY-профиль.');
  else if(!inbound)warnings.push('У профиля нет выбранного inbound.');
  else if(inbound.protocol!=='vless')warnings.push('Для подписок сейчас поддерживается только VLESS.');
  if(requiredNodes.length===0)warnings.push('Выберите ноду с действующим профилем XRAY STUDIO, иначе хост не будет выдан в подписке.');
  if(val('countryCode')&&!/^[A-Za-z]{2}$/.test(val('countryCode')))warnings.push('Код страны должен состоять из двух латинских букв, например NL.');
  if(mismatched.length)warnings.push('Несовместимые ноды: '+mismatched.map(n=>!n?'нода удалена':n.name+' (ID '+n.id+': '+(n.disabled?'отключена':hostProfile(n.profileId)?'назначен профиль «'+hostProfile(n.profileId).name+'»':'профиль ID '+(n.profileId||'не назначен')+' отсутствует')+')').join(', ')+'. Назначьте нодам существующий XRAY-профиль и только затем сохраняйте хост.');
  if(security==='reality'&&!realityKey)warnings.push('REALITY publicKey отсутствует: укажите публичную часть ключа в расширенных настройках. Приватный ключ сюда не вставляйте.');
  if(security==='reality'&&!sni)warnings.push('Не указан SNI для REALITY.');
  const warning=form.querySelector('[data-host-warnings]');
  if(warning){warning.textContent=warnings.join(' ');warning.hidden=!warnings.length;}
  const repair=form.querySelector('[data-host-repair]');
  if(repair){
    const target=mismatched.find(n=>n&&(!hostProfile(n.profileId)||String(n.profileId)!==String(profile?.id)));
    repair.hidden=!target;
    if(target){repair.dataset.hostRepair=String(target.id);repair.textContent='Изменить профиль ноды «'+target.name+'»';}
  }
  const link=form.querySelector('[data-host-link-profile]');
  if(link){const target=mismatched.find(n=>n&&!n.disabled&&profile);
    link.hidden=!target;
    if(target){link.dataset.hostLinkProfile=String(target.id);link.textContent='Назначить «'+profile.name+'» ноде «'+target.name+'»';}
  }
  const runtimeStatus=form.querySelector('[data-host-runtime]');
  if(runtimeStatus){
    const ids=requiredNodes.filter(Boolean).map(n=>String(n.id)).sort();
    const key=ids.join(',');
    if(runtimeStatus.dataset.probeKey!==key){
      runtimeStatus.dataset.probeKey=key;
      runtimeStatus.textContent=ids.length?'Проверяю агент и Xray на выбранных нодах…':'Состояние Xray: выберите ноду.';
      if(ids.length)void Promise.all(ids.map(async id=>{
        const node=DB.nodes.find(n=>String(n.id)===id);
        try {
          const state=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/runtime');
          if(!state.connected)return (node?.name||id)+': нет свежей связи с агентом';
          if(state.xrayRunning===false)return (node?.name||id)+': агент онлайн, Xray остановлен';
          if(state.routerRunning===false)return (node?.name||id)+': агент онлайн, маршрутизатор остановлен';
          return (node?.name||id)+': агент онлайн'+(state.xrayRunning===true?', Xray запущен':'')+'; применённый профиль не подтверждён';
        }catch(_){return (node?.name||id)+': состояние агента неизвестно'}
      })).then(states=>{
        if(form.isConnected&&runtimeStatus.dataset.probeKey===key)
          runtimeStatus.textContent='Статус нод: '+states.join(' • ');
      });
    }
  }
  const count=form.querySelector('[data-host-count]');
  if(count)count.textContent=requiredNodes.length+' нод привязано';
}
function hostEditorMarkup(o,e){
  const fromTag=DB.profiles.find(p=>inbs(p).some(i=>i.tag===o.tag));
  const selectedProfile=hostProfile(o.profileId)||fromTag||DB.profiles[0];
  const fields=e.fs;
  const f=k=>fields.find(x=>x.k===k);
  const preset='<label class="f"><span>Быстро заполнить из ноды</span><select data-host-node-preset><option value="">Выберите сервер…</option>'+DB.nodes.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.name)+' · '+esc(n.addr||'')+' · '+esc(n.port||443)+(hostProfile(n.profileId)?'':' · ⚠ Профиль отсутствует')+'</option>').join('')+'</select></label>';
  const p=field(f('profileId'),selectedProfile?.id||'');
  const inboundOptions=selectedProfile?inbs(selectedProfile).map(i=>[i.tag,i.tag+' · '+i.protocol]):[];
  const tag=field({...f('tag'),o:inboundOptions},o.tag||inboundOptions[0]?.[0]||'');
  const basic=['remark','address','port','countryCode'].map(k=>field(f(k),o[k])).join('');
  const nodes=field(f('nodes'),o.nodes||[])+field(f('disabled'),!!o.disabled);
  const advanced=['sni','host','path','fp','publicKey','shortId','spiderX','alpn','serviceName','clientEncryption'].map(k=>field(f(k),o[k]??'')).join('');
  // Three permanent, side-by-side editing zones. Keep all input names and
  // actions unchanged so the existing save and live-preview logic still work.
  return '<div class="host-editor-layout">'+
    '<section class="host-editor-main host-primary-panel" aria-label="Подключение и назначение">'+
    '<div class="node-form-section-title">Подключение</div>'+
    '<div class="host-connect-fields">'+preset+p+tag+'</div>'+
    '<div class="node-form-section-title">Публичная точка</div>'+
    '<div class="host-public-fields">'+basic+'</div>'+
    '<div class="node-form-section-title">Назначение</div>'+
    '<div class="host-assignment-fields">'+nodes+'</div>'+
    '<small class="note" data-host-count></small></section>'+
    '<section class="host-advanced host-advanced-panel" aria-label="Расширенные переопределения">'+
    '<div class="host-advanced-heading"><div class="node-form-section-title">Расширенные переопределения</div>'+
    '<p class="node-ip-hint">Пустые поля наследуются из XRAY STUDIO.</p></div>'+
    '<div class="host-advanced-fields">'+advanced+'</div>'+
    '<div class="host-advanced-actions"><button type="button" class="gh sm" data-host-clear-overrides>'+ic('rotate-ccw')+'Сбросить переопределения</button></div></section>'+
    '<section class="host-editor-side" aria-label="Клиентское подключение">'+
    '<div class="node-form-section-title">Клиентское подключение</div>'+
    '<p class="node-ip-hint">Предпросмотр из XRAY STUDIO. Приватные ключи не экспортируются.</p>'+
    '<div class="host-resolved" data-host-resolved></div>'+
    '<p class="node-ip-hint" data-host-runtime role="status" aria-live="polite"></p>'+
    '<p class="host-validation" data-host-warnings role="status" hidden></p>'+
    '<button type="button" class="gh sm" data-host-repair hidden></button>'+
    '<button type="button" class="gh sm" data-host-link-profile hidden></button>'+
    '<p class="node-ip-hint host-preview-disclaimer">Предпросмотр не подтверждает применение профиля, добавление UUID или доступность порта.</p></section></div>';
}

/* Squad editor: expose the actual access graph, without introducing fake
   per-squad limits or changing the existing persisted {name,desc,inb} model. */
function squadEditorMarkup(o,e){
  const saved=Array.isArray(o.inb)?o.inb.map(String):[];
  const byTag=new Map();
  for(const profile of DB.profiles){
    for(const inbound of inbs(profile)){
      const tag=String(inbound?.tag||'').trim();
      if(!tag)continue;
      if(!byTag.has(tag))byTag.set(tag,{tag,meta:[]});
      byTag.get(tag).meta.push({
        profile:String(profile.name||'XRAY STUDIO'),
        protocol:String(inbound.protocol||'—'),
        network:String(inbound.streamSettings?.network||'tcp')
      });
    }
  }
  for(const tag of saved){
    if(!byTag.has(tag))byTag.set(tag,{tag,meta:[]});
  }
  const rows=[...byTag.values()].sort((a,b)=>a.tag.localeCompare(b.tag,'ru')).map(item=>{
    const missing=!item.meta.length;
    const profileNames=[...new Set(item.meta.map(m=>m.profile))];
    const details=missing?'Отсутствует в XRAY STUDIO — сохранённая привязка':
      [...new Set(item.meta.map(m=>m.protocol+' / '+m.network))].join(', ')+
      ' · '+profileNames.join(', ');
    const count=DB.hosts.filter(h=>!h.disabled&&String(h.tag)===item.tag).length;
    return '<label class="squad-inbound-row'+(missing?' is-missing':'')+'" data-squad-option data-squad-filter="'+esc(item.tag+' '+details)+'">'+
      '<input type="checkbox" name="inb" value="'+esc(item.tag)+'"'+(saved.includes(item.tag)?' checked':'')+(missing?' data-squad-missing':'')+'>'+
      '<span class="squad-inbound-copy"><b>'+esc(item.tag)+'</b><small>'+esc(details)+'</small></span>'+
      '<span class="squad-inbound-hosts">'+(missing?'Нет профиля':count+' хост.')+'</span></label>';
  }).join('');
  return '<div class="squad-editor-layout">'+
    '<section class="squad-editor-main" aria-label="Параметры сквада">'+
      '<div class="node-form-section-title">Основное</div>'+
      '<div class="squad-editor-fields">'+field(e.fs.find(x=>x.k==='name'),o.name||'')+field(e.fs.find(x=>x.k==='desc'),o.desc||'')+'</div>'+
      '</section><section class="squad-editor-connections" aria-label="Подключения сквада">'+
      '<div class="node-form-section-title">Подключения</div>'+
      '<div class="squad-section-heading"><div><b>Inbound из XRAY STUDIO</b></div><span class="squad-selected-count" data-squad-selected>0 выбрано</span></div>'+
      '<div class="squad-editor-toolbar">'+
        '<label class="search squad-inbound-search">'+ic('search')+'<input type="search" data-squad-search placeholder="Найти inbound или профиль…" autocomplete="off" aria-label="Поиск inbound"></label>'+
        '<button type="button" class="gh sm" data-squad-select="all">Выбрать все</button>'+
        '<button type="button" class="gh sm" data-squad-select="clear">Очистить</button>'+
      '</div>'+
      '<div class="squad-inbound-list">'+(rows||'<div class="squad-inbound-empty">В XRAY STUDIO пока нет inbound. Создайте профиль, чтобы назначить доступ.</div>')+'</div>'+
      '<p class="squad-inbound-empty" data-squad-no-results hidden>Ничего не найдено</p>'+
      '<p class="squad-help">Повторяющиеся теги объединяются. Конфигурация Xray не изменяется.</p>'+
    '</section>'+
    '<section class="squad-editor-side" aria-label="Предпросмотр и влияние">'+
      '<div class="node-form-section-title">Влияние на подписки</div>'+
      ''+
      '<div data-squad-preview role="status" aria-live="polite"></div>'+
    '</section>'+
  '</div>';
}
function squadEditorRefresh(form){
  if(!form||form.dataset.ent!=='squads')return;
  const checked=[...form.querySelectorAll('input[name="inb"]:checked')].map(input=>input.value);
  const selected=[...new Set(checked)];
  const known=new Set(DB.profiles.flatMap(p=>inbs(p).map(i=>String(i.tag||''))).filter(Boolean));
  const missing=selected.filter(tag=>!known.has(tag));
  const hosts=DB.hosts.filter(h=>!h.disabled&&selected.includes(String(h.tag)));
  const hostTags=new Set(hosts.map(h=>String(h.tag)));
  const uncovered=selected.filter(tag=>!hostTags.has(tag)&&known.has(tag));
  const nodeIds=new Set(hosts.flatMap(h=>Array.isArray(h.nodes)?h.nodes:[]).map(String));
  const users=DB.users.filter(u=>Array.isArray(u.squads)&&u.squads.some(id=>String(id)===form.dataset.id));
  const count=form.querySelector('[data-squad-selected]');
  if(count)count.textContent=selected.length+' выбрано';
  const preview=form.querySelector('[data-squad-preview]');
  if(!preview)return;
  const stats=[
    ['Inbound',selected.length],
    ['Хосты',hosts.length],
    ['Назначенные ноды',nodeIds.size],
    ['Пользователи',users.length]
  ].map(([label,value])=>'<div class="squad-preview-stat"><b>'+value+'</b><small>'+label+'</small></div>').join('');
  const hostList=hosts.length?hosts.slice(0,8).map(h=>
    '<div class="squad-preview-line"><b>'+esc(h.remark||h.tag||'Хост')+'</b><small>'+esc(h.address||'Адрес не задан')+' · '+esc(h.tag||'Без тега')+' · '+(Array.isArray(h.nodes)?h.nodes.length:0)+' нод</small></div>'
  ).join('')+(hosts.length>8?'<small class="squad-help">И ещё '+(hosts.length-8)+' хост.</small>':''):
    '<p class="squad-help">Для выбранных inbound нет включённых хостов.</p>';
  const userList=users.length?users.slice(0,12).map(u=>'<span class="squad-user-chip">'+esc(u.username)+'</span>').join('')+
    (users.length>12?'<span class="squad-user-chip">+'+(users.length-12)+'</span>':''):
    '<span class="squad-help">Пользователи ещё не назначены.</span>';
  const warnings=[];
  if(!selected.length)warnings.push('Не выбраны inbound: сквад не предоставит подключения.');
  if(missing.length)warnings.push('Отсутствуют в XRAY STUDIO: '+missing.join(', '));
  if(uncovered.length)warnings.push('Нет включённых хостов для: '+uncovered.join(', '));
  if(hosts.some(h=>!Array.isArray(h.nodes)||!h.nodes.length))warnings.push('У некоторых хостов не назначены ноды.');
  const assignedNodes=[...nodeIds].map(id=>DB.nodes.find(n=>String(n.id)===id)).filter(Boolean);
  const nodeList=assignedNodes.length?assignedNodes.slice(0,8).map(n=>'<span class="squad-user-chip">'+esc(n.name||n.addr||String(n.id))+'</span>').join(''):'<span class="squad-help">Нет назначенных нод</span>';
  preview.innerHTML='<div class="squad-preview-stats">'+stats+'</div>'+
    '<div class="squad-preview-section"><b>Хосты, соответствующие выбору</b><div class="squad-preview-list">'+hostList+'</div></div>'+
    '<div class="squad-preview-section"><b>Затронутые пользователи</b><div class="squad-user-list">'+userList+'</div></div>'+
    '<div class="squad-preview-section squad-preview-nodes"><b>Связанные ноды</b><div class="squad-user-list">'+nodeList+'</div></div>'+
    (warnings.length?'<div class="squad-preview-warnings" role="note">'+warnings.map(w=>'<p>'+ic('alert-triangle')+esc(w)+'</p>').join('')+'</div>':'<p class="squad-preview-ready">'+ic('check')+'Связи в панели найдены. Доступность серверов проверяется отдельно.</p>');
}
document.addEventListener('input',event=>{
  const input=event.target;
  if(!input.matches?.('form[data-ent="squads"] [data-squad-search]'))return;
  const form=input.closest('form');
  const term=input.value.trim().toLocaleLowerCase('ru');
  let visible=0;
  for(const row of form.querySelectorAll('[data-squad-option]')){
    row.hidden=!String(row.dataset.squadFilter||'').toLocaleLowerCase('ru').includes(term);
    if(!row.hidden)visible++;
  }
  const empty=form.querySelector('[data-squad-no-results]');
  if(empty)empty.hidden=visible>0;
});
document.addEventListener('change',event=>{
  if(event.target.matches?.('form[data-ent="squads"] input[name="inb"]'))squadEditorRefresh(event.target.closest('form'));
});
document.addEventListener('click',event=>{
  const button=event.target.closest?.('form[data-ent="squads"] [data-squad-select]');
  if(!button)return;
  event.preventDefault();
  const form=button.closest('form');
  for(const input of form.querySelectorAll('input[name="inb"]')){
    if(button.dataset.squadSelect==='clear')input.checked=false;
    else if(!input.hasAttribute('data-squad-missing')&&!input.closest('[data-squad-option]').hidden)input.checked=true;
  }
  squadEditorRefresh(form);
});

function entForm(k,id,seed){const e=ENT[k],o=seed||(id?DB[k].find(x=>String(x.id)===String(id)):e.def?e.def():{});
  const standardFields=e.fs.map(f=>field(f,k==='admins'&&f.k==='password'?'':o[f.k])).join('');
  const rotationFields=e.fs.filter(f=>['rotationEnabled','rotationIntervalHours','rotationIps'].includes(f.k)).map(f=>field(f,f.k==='rotationIntervalHours'?(o[f.k]??24):o[f.k])).join('');
  const billingFields=e.fs.filter(f=>f.k.startsWith('billing')).map(f=>f.k==='billingDueDate'
    ?'<div class="f node-date-field"><span>Оплачено до</span><button type="button" class="user-date-trigger" data-node-date-open aria-expanded="false">'+ic('calendar')+'<span data-node-date-label>'+esc(o.billingDueDate?userDateLabel(o.billingDueDate):'Выберите дату')+'</span>'+ic('chevronRight')+'</button><input type="hidden" name="billingDueDate" value="'+esc(o.billingDueDate||'')+'"><div class="user-date-calendar" data-node-date-calendar hidden></div></div>'
    :field(f,o[f.k])).join('');
  const nodeCoreFields=e.fs.filter(f=>!f.k.startsWith('billing')&&!f.k.startsWith('geo')&&!['rotationEnabled','rotationIntervalHours','rotationIps'].includes(f.k));
  // GeoData belongs to its own node service dialog, never the general editor.
  // Keep tab / screen-reader order in sync with the wide four-column layout.
  // New fields remain supported and follow the explicitly grouped core fields.
  const nodeCoreOrder=['name','hosting','flag','profileId','addr','port','xrayLocalPort','mult','limit','resetDay'];
  const arrangedNodeCoreFields=k==='nodes'
    ?[...nodeCoreFields].sort((a,b)=>{
      const ia=nodeCoreOrder.indexOf(a.k),ib=nodeCoreOrder.indexOf(b.k);
      return (ia<0?nodeCoreOrder.length:ia)-(ib<0?nodeCoreOrder.length:ib);
    }):nodeCoreFields;
  const nodeMainFields=arrangedNodeCoreFields.map(f=>f.k==='addr'
    ?'<div class="node-address-port">'+field(f,o[f.k])+field(nodeCoreFields.find(x=>x.k==='port'),o.port)+'</div>'
    :f.k==='port'?'':field(f,o[f.k])).join('');
  const nodeResetAction=id?'<div class="node-reset-action"><div class="node-reset-copy"><strong>Счётчик трафика</strong><span>Обнулить расход ноды. Xray не перезапускается.</span></div><button type="button" class="gh sm node-traffic-reset-button" data-node-reset-traffic="'+esc(String(id))+'" title="">'+ic('redo')+'Обнулить</button><output class="node-traffic-reset-status" data-node-reset-feedback aria-live="polite"></output></div>':'';
  const userOptions=DB.users.filter(u=>st(u)==='ACTIVE').map(u=>`<option value="${u.id}">${esc(u.username)}</option>`).join('');
  const rotationProbe=id&&o.rotationEnabled
    ?`<div class="node-rotation-probe"><label class="f"><span>Проверка на пользователе</span><select data-node-rotation-user>${userOptions||'<option value="">Нет активных пользователей</option>'}</select></label><button type="button" class="gh sm" data-node-rotation-probe="${id}" ${userOptions?'':'disabled'}>${ic('redo')}Получить следующий IP</button><output data-node-rotation-result aria-live="polite"></output><small>Тест переключает адрес выбранного пользователя. Публичная подписка использует закреплённый IP до следующего интервала ротации.</small></div>`
    :'';
  const hostWizard=k==='hosts'?'<div class="host-quick"><label class="f"><span>Быстро заполнить из узла</span><select data-host-node-preset><option value="">Выберите сервер…</option>'+DB.nodes.map(n=>'<option value="'+esc(String(n.id))+'">'+esc(n.name)+' · '+esc(n.addr||'')+'</option>').join('')+'</select></label><p class="note">Подставит адрес, порт и привязку. Остальные поля сохранятся.</p></div>':'';
  const fields=k==='squads'?squadEditorMarkup(o,e):k==='hosts'?hostEditorMarkup(o,e):k==='nodes'
    ?'<div class="node-form-layout"><section class="node-main-section"><div class="node-form-section-title">Основные параметры</div><p class="node-section-intro">Подключение, профиль Xray и ограничения узла</p><div class="node-form-grid">'+nodeMainFields+'</div>'+nodeResetAction+'</section>'+`<section class="node-ip-section"><div class="node-form-section-title">IP-пул и ротация</div><div class="node-ip-hint">Адреса должны принадлежать этому VPS и быть доступны извне.</div><div class="node-rotation-editor-body">${rotationFields}<div class="node-pool-toolbar"><span data-node-pool-count>Адресов: ${nodeRotationIPs(o).length} / 256</span><button type="button" class="gh sm" data-node-pool-normalize>Убрать повторы</button><button type="button" class="gh sm" data-node-pool-clear>Очистить</button></div><output data-node-pool-feedback aria-live="polite"></output>${rotationProbe}</div></section><section class="node-billing-section"><div class="node-form-section-title">Инфрабиллинг</div><p class="node-ip-hint">Стоимость, аренда и напоминания</p><div class="node-billing-fields">${billingFields}</div></section></div>`
    :standardFields;
  modal(`<form class="box" data-k="ent" data-ent="${k}" data-id="${id||''}" method="dialog"><h2>${id?'Изменить':'Новый'}: ${e.nw.toLowerCase()}</h2>${fields}<p class="er" id="fe"></p><div class="act">${id?`<button type="button" class="dg" data-del="${k}:${id}" style="margin-right:auto">${ic('trash')}Удалить</button>`:''}${k==='hosts'&&id?`<button type="button" class="gh" data-host-duplicate="${id}">${ic('copy')}Дублировать</button>`:''}<button type="button" class="gh" data-x>Отмена</button><button class="btn">Сохранить</button></div></form>`,k==='nodes'?'node-wide':k==='hosts'?'host-wide':k==='squads'?'squad-wide':k=='profiles'||k=='subs'?'wide':'');
  if(k==='squads')squadEditorRefresh(dlg.querySelector('form[data-ent="squads"]'));
  if(k==='hosts'){
    const form=dlg.querySelector('form[data-ent="hosts"]');
    hostEditorRefresh(form);
    void hostDeriveRealityPublic(form);
  }
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
// Render independent runtime and Xray health badges. Only fresh, authenticated
// agent heartbeats can mark a node as active; a configured node is not online.
const nodeRuntimeState=(node,runtime)=>{
  if(node.disabled){
    if(!runtime?.connected)return {label:'Остановка не подтверждена',kind:'offline'};
    if(runtime.xrayRunning!==false)return {label:'Остановка ожидается',kind:'offline'};
    return {label:(node.disabled&&node.disabledReason==='traffic_limit')?'Лимит исчерпан · Xray остановлен':'Отключена · Xray остановлен',kind:'disabled'};
  }
  if(!runtime?.connected)return {label:runtime?.lastSeenAt?'Нет связи':'Не подключена',kind:'offline'};
  if(runtime.xrayRunning===true&&runtime.routerRunning===true)return {label:'Активна',kind:'online'};
  if(runtime.xrayRunning===false)return {label:'Xray остановлен',kind:'offline'};
  if(runtime.routerRunning===false)return {label:'Маршрутизатор остановлен',kind:'offline'};
  return {label:'Состояние неизвестно',kind:'unknown'};
};
const nodeAgentUpdating=new Set();
const nodeXrayUpdating=new Set();
function renderNodeAgentVersion(nodeId,runtime){
  if(nodeAgentUpdating.has(Number(nodeId))){
    return '<span class="node-agent-spinner" aria-hidden="true"></span><span>Agent обновляется</span>';
  }
  const version=String(runtime?.version||'');
  return /^control-v[0-9]+\.[0-9]+\.[0-9]+$/.test(version)
    ?'Agent '+esc(version.replace(/^control-v/,'v')):'Agent —';
}
function paintNodeAgentUpdate(nodeId,updating){
  const card=document.querySelector('[data-node-card-id="'+nodeId+'"]');
  const badge=card?.querySelector('[data-node-agent-version]');
  if(!badge)return;
  badge.classList.toggle('node-agent-updating',updating);
  if(updating){
    badge.setAttribute('role','status');
    badge.setAttribute('aria-label','Agent обновляется');
    badge.title='Ожидается подтверждение установки новой версии';
    badge.innerHTML=renderNodeAgentVersion(nodeId,null);
  }else{
    badge.removeAttribute('role');
    badge.removeAttribute('aria-label');
  }
}
function renderNodeXrayVersion(nodeId,runtime){
  if(nodeXrayUpdating.has(Number(nodeId))){
    return '<span class="node-agent-spinner" aria-hidden="true"></span><span>Xray обновляется</span>';
  }
  return runtime?.xrayVersion?'Xray '+esc(runtime.xrayVersion):'Xray —';
}
function paintNodeXrayUpdate(nodeId){
  const badge=document.querySelector('[data-node-card-id="'+nodeId+'"] [data-node-xray-version]');
  if(!badge)return;
  const updating=nodeXrayUpdating.has(Number(nodeId));
  badge.classList.toggle('node-agent-updating',updating);
  if(updating){
    badge.setAttribute('role','status');
    badge.setAttribute('aria-label','Xray обновляется');
    badge.title='Ожидается подтверждение обновления Xray';
    badge.innerHTML=renderNodeXrayVersion(nodeId,null);
  }else{
    badge.removeAttribute('role');
    badge.removeAttribute('aria-label');
  }
}
const PROFILE_CHECK_LABELS={
  policy_missing:'Нет сохранённой подписанной политики',
  active_config_missing:'Нет управляемой конфигурации',
  guard_unavailable:'Проверяющий модуль недоступен',
  policy_invalid:'Ошибка проверки подписи политики',
  revision_invalid:'Некорректная ревизия',
  policy_hash_mismatch:'Не совпадает хеш подписанной политики',
  active_config_invalid:'Некорректный активный JSON',
  active_config_mismatch:'Рабочая конфигурация отличается от политики',
  xray_stopped:'Xray не запущен',
  mount_mismatch:'Xray использует другой файл конфигурации',
  container_unavailable:'Нет доступа к контейнеру Xray',
  helper_missing:'Проверка профиля не установлена',
  helper_error:'Ошибка проверки профиля'
};
function nodeProfileStatus(runtime){
  if(!runtime?.connected)return 'Нет свежего подтверждения от агента';
  const status=runtime.profileApplicationStatus;
  if(status==='applied')return 'Профиль применён';
  if(status==='stopped')return 'Xray не запущен';
  if(status==='pending')return 'Ожидает применения новой конфигурации';
  const detail=PROFILE_CHECK_LABELS[runtime.profileCheck];
  if(detail)return detail;
  if(runtime.profileCheck==='verified'){
    if(runtime.desiredRevisionSource==='invalid_configuration')
      return 'Проверен на ноде · '+({
        invalid_local_port:'Укажите локальный порт Xray',
        missing_profile_assignment:'Не назначен XRAY STUDIO профиль',
        profile_not_found:'Не найден назначенный профиль',
        missing_profile_json:'В профиле отсутствует JSON',
        invalid_profile_json:'Ошибка формата JSON профиля',
        missing_inbounds:'Нет inbound в профиле',
        unsupported_inbound_count:'Нужен один управляемый inbound',
        invalid_inbound:'Ошибка inbound в профиле',
        missing_inbound_tag:'Отсутствует тег inbound',
        invalid_inbound_settings:'Нет настроек inbound',
        conflicting_stats_api:'Конфликт StatsService API',
        node_disabled:'Нода отключена',
        geodata_validation:'Проверьте GeoData',
        routing_validation:'Проверьте маршрутизацию',
        serialization:'Не удалось сформировать JSON',
        compile_failed:'Ошибка подготовки профиля'
      }[runtime.profileCompileError]||'Не удалось подготовить профиль панели');
    if(runtime.desiredRevisionSource==='missing')
      return 'Проверен на ноде · панель ещё не получила ревизию';
    return 'Проверен на ноде · нет совпадающей ревизии панели';
  }
  return 'Нет подтверждения от агента';
}
const updateNodeRuntimeBadges=(node,runtime)=>{
  const card=$('[data-node-card-id="'+node.id+'"]');
  if(!card)return;
  const pill=card.querySelector('[data-node-runtime-state]');
  const version=card.querySelector('[data-node-xray-version]');
  const status=nodeRuntimeState(node,runtime);
  if(pill){pill.className='node-runtime-pill node-runtime-'+status.kind;pill.replaceChildren();
    const dot=document.createElement('span');dot.className='node-runtime-dot';dot.setAttribute('aria-hidden','true');
    pill.append(dot,document.createTextNode(status.label));
  }
  if(version){
    if(nodeXrayUpdating.has(Number(node.id))){
      paintNodeXrayUpdate(node.id);
    }else{
      paintNodeXrayUpdate(node.id);
      version.textContent=runtime?.xrayVersion?'Xray '+runtime.xrayVersion:'Xray —';
      version.title=runtime?.xrayVersion?'Версия Xray по последнему heartbeat':'Версия Xray пока не получена';
    }
  }
  const profileStatus=card.querySelector('[data-node-profile-status]');
  if(profileStatus){
    profileStatus.textContent=nodeProfileStatus(runtime);
    profileStatus.title=runtime?.desiredRevisionSource==='current'
      ?'Ожидаемая ревизия вычислена из актуальных настроек панели; совпадение проверено по подписанному heartbeat'
      :'Сравнение актуальной конфигурации панели с подписанным подтверждением агента';
  }
  const agent=card.querySelector('[data-node-agent-version]');
  if(agent){
    if(nodeAgentUpdating.has(Number(node.id))){
      paintNodeAgentUpdate(node.id,true);
    }else{
      agent.classList.remove('node-agent-updating');
      agent.removeAttribute('role');
      agent.removeAttribute('aria-label');
      agent.textContent=renderNodeAgentVersion(node.id,runtime);
      agent.title=runtime?.connected?'Версия управляющего агента по подтверждённому heartbeat':
        'Нет свежего подтверждения подключения управляющего агента';
    }
  }
};
async function nodesP(){
  const [r,s,overview]=await Promise.all([api.list('nodes',{sort:'id'}),api.stats(),backendRequest('/api/v1/statistics/overview').catch(()=>null)]);ST=s;
  const latestMetrics=new Map((overview?.nodes||[]).map(n=>[Number(n.id),n.latest&&!n.latest.stale?n.latest:null]));
  const networkTotals=new Map((overview?.nodes||[]).map(n=>[Number(n.id),n]));
  const runtime=new Map(await Promise.all(r.items.map(async n=>{
    try{return [n.id,await backendRequest('/api/v1/nodes/'+encodeURIComponent(n.id)+'/runtime')]}catch(_){return [n.id,null]}
  })));
  const cards=r.items.map(n=>{
    const ss=nstat(n),p=DB.profiles.find(x=>x.id==n.profileId),m=latestMetrics.get(Number(n.id));
    const geoRuntime=runtime.get(n.id);
    const geoStatus=geoRuntime?.connected?geoRuntime?.geoData:null;
    const geoLabels={current:'файлы актуальны',pending:'применяется',error:'ошибка обновления',rolled_back:'откат'};
    const geoLabel=geoStatus?.state?geoLabels[geoStatus.state]||'статус неизвестен':'ожидает агента';
    const geoFileCount=geoStatus?.files&&typeof geoStatus.files==='object'?Object.keys(geoStatus.files).length:0;
    const numberOrNull=v=>v===null||v===undefined?null:Number(v);
    const cpu=numberOrNull(m?.cpuPercent),ramUsed=numberOrNull(m?.ramUsedBytes),ramTotal=numberOrNull(m?.ramTotalBytes);
    const rx=numberOrNull(m?.rxBytesPerSec),tx=numberOrNull(m?.txBytesPerSec);
    const l={cpu:Number.isFinite(cpu)?cpu:null,ram:Number.isFinite(ramUsed)&&Number.isFinite(ramTotal)&&ramTotal>0?ramUsed/ramTotal*100:null,mbps:Number.isFinite(rx)&&Number.isFinite(tx)?(rx+tx)*8/1e6:null};
    // Keep the live gauge cache consistent with the TimescaleDB data used
    // by the Statistics page. drawNodeLive() must not wipe fresh gauges.
    const totalNode=networkTotals.get(Number(n.id));
    const rxTotal=totalNode?.networkRxBytes,txTotal=totalNode?.networkTxBytes;
    const bytes=rxTotal===null||rxTotal===undefined||txTotal===null||txTotal===undefined?null:
      Math.max(0,Number(rxTotal)+Number(txTotal));
    l.networkTotalBytes=Number.isFinite(bytes)?bytes:null;
    LV[n.id]=l;
    const trafficGb=l.networkTotalBytes===null?null:l.networkTotalBytes*nodeTrafficFactor(n)/1073741824;
    const k=n.limit&&trafficGb!==null?cl(trafficGb/n.limit,0,1):0,tc=k>.9?'--er':k>.75?'--wr':'--c3';
    return `<div class="card nc${n.disabled?' off':''}" data-node-card-id="${n.id}"><div class="h"><span class="fg">${flagView(n.flag)}</span><div class="node-identity"><b>${esc(n.name)}</b><br><small class="mu">${viewerMode()?'Адрес скрыт':esc(n.addr||'—')+(n.port?':'+esc(n.port):'')}</small>${n.hosting?.trim()?`<span class="node-hosting" title="Хостинг">${ic('building-2')}${esc(n.hosting.trim())}</span>`:''}</div><div class="node-live-badges"><span class="node-xray-version" data-node-xray-version title="Версия по последнему heartbeat">${renderNodeXrayVersion(n.id,runtime.get(n.id))}</span><span class="node-agent-version" data-node-agent-version title="Версия управляющего агента">${renderNodeAgentVersion(n.id,runtime.get(n.id))}</span><span data-node-runtime-state class="node-runtime-pill node-runtime-${nodeRuntimeState(n,runtime.get(n.id)).kind}"><span class="node-runtime-dot" aria-hidden="true"></span>${esc(nodeRuntimeState(n,runtime.get(n.id)).label)}</span></div></div>
      <div class="kvg"><div><span title="Пользователи с активным доступом через inbound этой ноды, не число текущих подключений">Активные пользователи</span><b>${s.nodeOn[n.id]??0}</b><div class="node-online-clients" title="Онлайн-клиенты по свежей телеметрии агента ноды"><span>Пользователи онлайн</span><b>${m?.onlineClients!=null&&Number.isFinite(Number(m.onlineClients))?Math.max(0,Math.trunc(Number(m.onlineClients))):"—"}</b></div></div><div><span>XRAY STUDIO</span>${p?esc(p.name)+'<br><small class="mu" data-node-profile-status="'+esc(n.id)+'" title="Проверка подписанной политики и реально используемой конфигурации Xray">'+esc(nodeProfileStatus(runtime.get(n.id)))+'</small>':n.profileId?'<span class="er">Профиль ID '+esc(n.profileId)+' не найден</span>':'—'}</div></div>
      ${n.geoEnabled?`<div class="node-ip-rotation active" title="${esc(geoStatus?.lastError||'Подтверждение от управляющего агента, не проверка фактической блокировки рекламы')}"><span class="node-ip-indicator" aria-hidden="true"></span><span>GeoData · ${esc(geoLabel)}${geoFileCount?' · '+geoFileCount+' файла(ов)':''}</span></div>`:''}
      ${n.rotationEnabled?`<div class="node-ip-rotation active" aria-label="Пул IP-ротации"><span class="node-ip-indicator" aria-hidden="true"></span><span>IP-пул · ${nodeRotationIPs(n).length} адресов</span></div>`:''}
      <div class="node-gauges">
        ${nodeGauge(n,'cpu-'+n.id,'CPU',Number.isFinite(l.cpu)?l.cpu:0,Number.isFinite(l.cpu)?Math.round(l.cpu)+'%':'—',Number.isFinite(l.cpu)?'загрузка':'нет данных','--a')}
        ${nodeGauge(n,'ram-'+n.id,'RAM',Number.isFinite(l.ram)?l.ram:0,Number.isFinite(l.ram)?Math.round(l.ram)+'%':'—',Number.isFinite(l.ram)?'занято':'нет данных','--b')}
        ${nodeGauge(n,'traffic-'+n.id,'Трафик сети',n.limit?k*100:0,trafficGb===null?'—':n.limit?Math.round(k*100)+'%':'∞',trafficGb===null?'нет данных':(n.limit?`${gb(trafficGb)} / ${gb(n.limit)}`:`${gb(trafficGb)} · без лимита`)+(nodeTrafficFactor(n)!==1?` · ×${nodeTrafficFactor(n)} (учётный)`:''),tc)}
      </div>
      <div class="mb node-speed"><div><span>Текущая скорость</span><b id="nm${n.id}">${Number.isFinite(l.mbps)?fmt(l.mbps)+' Мбит/с':'—'}</b></div><div class="pb f" style="--w:${Number.isFinite(l.mbps)?cl(l.mbps/240*100,0,100):0}%" id="npm${n.id}"><i></i></div></div>
      <div class="acts"><button class="gh sm" data-node-bootstrap="${n.id}">${ic('link')}Подключить агент ноды</button><button class="gh sm" data-nr="${n.id}" ${n.disabled?'disabled title="Сначала включите узел после восстановления лимита"':''}>${ic('redo')}Перезапуск</button><button class="gh sm" data-xray-update="${n.id}">${ic('upload')}Обновить Xray</button><button class="gh sm" data-agent-update="${n.id}" title="Обновить управляющий Agent через подтверждённую команду ноде">${ic("refresh-cw")}Обновить Agent</button><button type="button" class="gh sm node-geodata-open" data-node-geodata="${n.id}" title="Настройки GeoData и ручное обновление файлов на этом узле">${ic("globe")}Обновить GeoData</button><button type="button" class="gh sm node-routing-open" data-node-routing="${n.id}" title="Направление трафика по GeoSite, GeoIP и через другие ноды">${ic("git-branch")}Маршрутизация</button><button class="gh sm" data-nt="${n.id}">${ic(n.disabled?'play':'pause')}${n.disabled?'Включить':'Отключить'}</button><button class="gh sm" data-ne="nodes:${n.id}">${ic('pen')}Изменить</button><button class="gh sm" data-node-create-host="${n.id}">${ic('globe')}Создать хост</button></div></div>`;
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
async function refreshNodeMetrics(){
  try{
    const overview=await backendRequest('/api/v1/statistics/overview');
    if(cur!=='nodes')return;
    const metrics=new Map((overview?.nodes||[]).map(n=>[Number(n.id),n.latest&&!n.latest.stale?n.latest:null]));
    const totals=new Map((overview?.nodes||[]).map(n=>[Number(n.id),n]));
    DB.nodes.forEach(n=>{
      const m=metrics.get(Number(n.id));
      const t=totals.get(Number(n.id));
      const val=v=>v===null||v===undefined?null:Number(v);
      const cpu=val(m?.cpuPercent),used=val(m?.ramUsedBytes),total=val(m?.ramTotalBytes);
      const rx=val(m?.rxBytesPerSec),tx=val(m?.txBytesPerSec);
      LV[n.id]={
        cpu:Number.isFinite(cpu)?cpu:null,
        ram:Number.isFinite(used)&&Number.isFinite(total)&&total>0?used/total*100:null,
        mbps:Number.isFinite(rx)&&Number.isFinite(tx)?(rx+tx)*8/1e6:null,
        networkTotalBytes:t?.networkRxBytes===null||t?.networkRxBytes===undefined||
          t?.networkTxBytes===null||t?.networkTxBytes===undefined?null:
          Math.max(0,Number(t.networkRxBytes)+Number(t.networkTxBytes))
      };
    });
    updateNodeGauges();
  }catch(error){console.warn('Could not refresh node metrics',error)}
}
async function refreshNodeRuntime(){
  if(cur!=='nodes')return;
  const nodes=DB.nodes.filter(n=>document.querySelector('[data-node-card-id="'+n.id+'"]'));
  await Promise.all(nodes.map(async n=>{
    try{
      const runtime=await backendRequest('/api/v1/nodes/'+encodeURIComponent(n.id)+'/runtime');
      if(cur==='nodes')updateNodeRuntimeBadges(n,runtime);
    }catch(error){
      // A failed status request is not evidence that the node is online.
      if(cur==='nodes')updateNodeRuntimeBadges(n,null);
      console.warn('Node runtime status unavailable',n.id,error);
    }
  }));
}
function drawNodeLive(){
  updateNodeGauges();
  let busy=false;
  const poll=async()=>{
    if(cur!=='nodes'||document.hidden||busy)return;
    busy=true;
    try{await Promise.all([refreshNodeMetrics(),refreshNodeRuntime()])}finally{busy=false}
  };
  void poll();
  T.push(setInterval(()=>{void poll()},5000));
}
function updateNodeGauges(){DB.nodes.forEach(n=>{
  const l=LV[n.id]||{cpu:null,ram:null,mbps:null};
  const metrics=[['cpu-'+n.id,l.cpu,'загрузка'],['ram-'+n.id,l.ram,'занято']];
  metrics.forEach(([key,value,detail])=>setNodeGauge(key,Number.isFinite(value)?value:0,Number.isFinite(value)?Math.round(value)+'%':'—',Number.isFinite(value)?detail:'нет данных'));
  const total=l.networkTotalBytes;
  const trafficGb=Number.isFinite(total)?total*nodeTrafficFactor(n)/1073741824:null;
  const traffic=n.limit&&trafficGb!==null?cl(trafficGb/n.limit*100,0,100):0,tc=traffic>90?'--er':traffic>75?'--wr':'--c3';
  setNodeGauge('traffic-'+n.id,traffic,trafficGb===null?'—':n.limit?Math.round(traffic)+'%':'∞',
    trafficGb===null?'нет данных':n.limit?`${gb(trafficGb)} / ${gb(n.limit)}`:`${gb(trafficGb)} · без лимита`);
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
  return [`<div class="security-workspace security-center">
    <header class="security-overview">
      <div><p class="note">XMESH NEXUS / SECURITY CENTER</p><h2>Центр безопасности</h2>
      <p>Управление входом, защищёнными сессиями и доступом к панели.</p></div>
    </header>
    <nav class="security-center-tabs" aria-label="Разделы безопасности" role="tablist">
      <button type="button" role="tab" id="security-tab-auth" aria-selected="true" aria-controls="security-pane-auth" data-security-tab="auth"><span>◈</span> Авторизация и 2FA</button>
      <button type="button" role="tab" id="security-tab-access" aria-selected="false" aria-controls="security-pane-access" data-security-tab="access" tabindex="-1"><span>▣</span> Сессии и доступ</button>
      <button type="button" role="tab" id="security-tab-audit" aria-selected="false" aria-controls="security-pane-audit" data-security-tab="audit" tabindex="-1"><span>◎</span> Мониторинг</button>
      <button type="button" role="tab" id="security-tab-infra" aria-selected="false" aria-controls="security-pane-infra" data-security-tab="infra" tabindex="-1"><span>◇</span> Инфраструктура</button>
    </nav>
    <div class="security-center-pane" id="security-pane-auth" role="tabpanel" aria-labelledby="security-tab-auth" data-security-pane="auth">${factor}</div>
    <div class="security-center-pane" id="security-pane-access" role="tabpanel" aria-labelledby="security-tab-access" data-security-pane="access" hidden>${window.XMeshSecurity?.panel()||''}</div>
    <div class="security-center-pane" id="security-pane-audit" role="tabpanel" aria-labelledby="security-tab-audit" data-security-pane="audit" hidden>
      <section class="card security-center-information security-audit"><header class="security-audit-head"><div><h3>Журнал безопасности</h3><p>Последние 100 записей серверного аудита. Доступно только владельцу панели.</p></div><button class="gh" type="button" data-security-audit-refresh>Обновить</button></header><label class="security-audit-search">Поиск по действию и администратору <input type="search" data-security-audit-search placeholder="Например, security.session"></label><div class="security-audit-list" id="security-audit-list" role="status" aria-live="polite">Откройте вкладку, чтобы загрузить журнал.</div></section>
    </div>
    <div class="security-center-pane" id="security-pane-infra" role="tabpanel" aria-labelledby="security-tab-infra" data-security-pane="infra" hidden>
      <section class="card security-center-information"><h3>Защита инфраструктуры</h3><p>Для безопасного управления токенами, сетевыми ограничениями и настройками TLS необходимы серверные проверки и контроль прав. Неактивные механизмы не показываются как включённые.</p><div class="security-future-list"><span>IP allowlist для админов <em>Требует API</em></span><span>Политика API-токенов <em>Требует API</em></span><span>Проверка HTTPS и заголовков <em>Требует API</em></span></div></section>
    </div>
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
      <div class="setting-row"><div class="setting-copy"><b>Шрифт</b><small>16 вариантов шрифта с поддержкой кириллицы. Выбор применяется ко всей панели и сохраняется в настройках</small></div><div class="setting-control">${choices('font',[['onest','Manrope'],['inter','Inter'],['golos','Golos Text'],['rubik','Rubik'],['nunito','Nunito Sans'],['plex','IBM Plex Sans'],['roboto','Roboto'],['pt','PT Sans'],['montserrat','Montserrat'],['ubuntu','Ubuntu'],['opensans','Open Sans'],['source','Source Sans 3'],['fira','Fira Sans'],['jost','Jost'],['system','Системный'],['mono','Моно']])}</div></div>
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
document.addEventListener('input',e=>{
  const form=e.target.closest('form[data-k="uedit"]');
  if(!form)return;
  if(e.target.matches('[data-user-note]')){
    const count=form.querySelector('[data-user-note-count]');
    if(count)count.textContent=Array.from(e.target.value).length+' символов';
  }
  const dirty=form.querySelector('[data-user-edit-dirty]');
  if(dirty)dirty.textContent='Есть несохранённые изменения';
});
document.addEventListener('input',e=>{
  if(e.target.closest('form[data-ent="hosts"]')&&['remark','address','port','sni','host','path','fp','publicKey','shortId','alpn','serviceName','clientEncryption'].includes(e.target.name)){
    hostEditorRefresh(e.target.closest('form'));return;
  }
  if(!e.target.matches('form[data-ent="nodes"] [name="rotationIps"]'))return;
  const form=e.target.closest('form'),count=form?.querySelector('[data-node-pool-count]'),feedback=form?.querySelector('[data-node-pool-feedback]');
  const ips=String(e.target.value).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(count)count.textContent='Адресов: '+ips.length+' / 256';
  if(feedback)feedback.textContent=ips.length>256?'Превышен лимит 256 адресов.':new Set(ips).size!==ips.length?'В пуле есть повторяющиеся адреса.':ips.some(ip=>!nodeIpValid(ip))?'Некорректный IPv4/IPv6: указывайте адреса без портов и доменов.':'';
});
document.addEventListener('click',async e=>{
  const g=s=>e.target.closest(s);let b;
  if(b=g('[data-node-routing]')){
    e.preventDefault();
    const node=DB.nodes.find(item=>Number(item.id)===Number(b.dataset.nodeRouting));
    if(!node){toast('Узел не найден.');return}
    if(!window.XMeshNodeRouting?.open){
      toast('Окно маршрутизации не загружено. Проверьте сборку панели.');
      return;
    }
    window.XMeshNodeRouting.open({
      node,nodes:DB.nodes,hosts:DB.hosts,profiles:DB.profiles,
      modal,apiRequest:backendRequest,
      updateNode:(patch)=>api.update('nodes',node.id,patch),
      notify:toast,
      afterSave:()=>{if(cur==='nodes')void render(1);}
    });
    return;
  }
  if(b=g('[data-node-geodata]')){
    e.preventDefault();
    const node=DB.nodes.find(item=>Number(item.id)===Number(b.dataset.nodeGeodata));
    if(!node){toast('Узел не найден.');return}
    if(!window.XMeshNodeGeoData?.open){toast('Не удалось загрузить окно GeoData. Обновите панель.');return}
    window.XMeshNodeGeoData.open({
      node, modal, apiRequest:backendRequest,
      updateNode:(patch)=>api.update('nodes',node.id,patch),
      notify:toast,
      afterSave:()=>{if(cur==='nodes')void render(1);}
    });
    return;
  }
  if(b=g('[data-row-sub-copy]')){
    e.preventDefault();
    const id=Number(b.dataset.rowSubCopy);b.disabled=true;
    try{
      const subscription=await backendRequest('/api/v1/users/'+encodeURIComponent(id)+'/subscription');
      if(!subscription.url||!subscription.token)throw Error(subscription.legacy?'Старая ссылка не может быть восстановлена; перевыпустите её в карточке пользователя.':'У пользователя пока нет ссылки подписки.');
      const url=new URL(subscription.url,location.origin).href;
      await navigator.clipboard.writeText(url);
      toast('Ссылка подписки скопирована');
    }catch(error){toast('Не удалось скопировать ссылку: '+(error.message||'API'))}
    finally{b.disabled=false}
    return;
  }
  if(b=g('[data-row-delete]')){
    e.preventDefault();
    const id=Number(b.dataset.rowDelete),user=DB.users.find(u=>u.id===id);
    if(!user)return;
    confirmBox('Удалить пользователя «'+user.username+'»? Подписка будет отозвана, а действие необратимо.','Удалить',()=>delUsers(new Set([id])));
    return;
  }
  if(b=g('[data-node-reset-traffic]')){
    e.preventDefault();
    const id=Number(b.dataset.nodeResetTraffic);
    const node=DB.nodes.find(n=>Number(n.id)===id);
    if(!Number.isSafeInteger(id)||id<=0||!node)return;
    const approved=await panelConfirm(
      'Сбросить накопленный RX + TX узла «'+node.name+'»? Текущие счётчики интерфейса сохранятся как новая точка отсчёта. История графиков и пользовательский трафик не затрагиваются. Отключённая нода останется отключённой.',
      {title:'Сбросить трафик узла?',confirmLabel:'Сбросить трафик',danger:true}
    );
    if(!approved)return;
    b.disabled=true;
    const feedback=b.closest('form')?.querySelector('[data-node-reset-feedback]');
    try{
      const result=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/traffic/reset',{method:'POST'});
      const latest=await backendRequest('/api/v1/collections/nodes');
      if(Array.isArray(latest?.items))DB.nodes=latest.items;
      if(!LV[id])LV[id]={cpu:null,ram:null,mbps:null};
      LV[id].networkTotalBytes=0;
      if(cur==='nodes')updateNodeGauges();
      if(feedback)feedback.textContent='Счётчик сброшен. Новые байты считаются с момента сброса.';
      toast(result.disabled?'Трафик обнулён. Нода остаётся отключённой.':'Трафик ноды сброшен');
    }catch(error){
      if(feedback)feedback.textContent='Ошибка сброса: '+(error.message||'backend API');
      toast('Не удалось сбросить трафик: '+(error.message||'ошибка'));
    }finally{b.disabled=false}
    return;
  }
  if(b=g('[data-node-pool-normalize]')){
    e.preventDefault();
    const form=b.closest('form'),field=form?.querySelector('[name="rotationIps"]');
    if(field){field.value=[...new Set(String(field.value).split(/\r?\n/).map(x=>x.trim()).filter(Boolean))].join('\n');field.dispatchEvent(new Event('input',{bubbles:true}));toast('Повторы удалены');}
    return;
  }
  if(b=g('[data-node-pool-clear]')){
    e.preventDefault();
    const field=b.closest('form')?.querySelector('[name="rotationIps"]');
    if(field&&(!field.value.trim()||await panelConfirm('Очистить весь IP-пул? Изменение применится после сохранения узла.',{danger:true,title:'Очистка IP-пула',confirmLabel:'Очистить'}))){field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));}
    return;
  }
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
  if(b=g('[data-users-refresh]')){
    if(b.disabled)return;
    b.disabled=true;
    b.setAttribute('aria-busy','true');
    const original=b.innerHTML;
    b.innerHTML=ic('redo')+'<span>Обновление</span>';
    b.classList.add('is-refreshing');
    try{
      const response=await fetch('/api/v1/bootstrap',{credentials:'same-origin',cache:'no-store'});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||'Не удалось обновить пользователей.');
      const collections=payload.collections||{};
      for(const key of ['users','nodes','profiles','hosts','squads','tpls','subs','admins','tokens','srh']){
        if(Array.isArray(collections[key]))DB[key]=collections[key];
      }
      UQ.sel.clear();
      if(cur==='users')await render(1);
      toast('Список пользователей обновлён');
    }catch(error){
      toast(error?.message||'Ошибка обновления пользователей');
    }finally{
      if(b.isConnected){b.disabled=false;b.removeAttribute('aria-busy');b.classList.remove('is-refreshing');b.innerHTML=original;}
    }
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
  else if(b=g('[data-node-date-open],[data-node-date-calendar] [data-user-date-nav],[data-node-date-calendar] [data-user-date-day],[data-node-date-calendar] [data-user-date-today],[data-node-date-calendar] [data-user-date-clear]')){
    e.preventDefault();
    const picker=b.closest('.node-date-field'),cal=picker?.querySelector('[data-node-date-calendar]'),input=picker?.querySelector('[name="billingDueDate"]'),trigger=picker?.querySelector('[data-node-date-open]');
    if(!cal||!input)return;
    const renderMonth=date=>{
      const month=new Date(date.getFullYear(),date.getMonth(),1);
      cal.dataset.month=userYmd(month);
      cal.innerHTML=userCalendarMarkup(month.getFullYear(),month.getMonth(),input.value);
    };
    if(b.hasAttribute('data-node-date-open')){
      if(cal.hidden){renderMonth(userDateFromYmd(input.value)||new Date());cal.hidden=false;trigger.setAttribute('aria-expanded','true')}
      else{cal.hidden=true;trigger.setAttribute('aria-expanded','false')}
    }else if(b.hasAttribute('data-user-date-nav')){
      const current=userDateFromYmd(cal.dataset.month)||new Date();
      renderMonth(new Date(current.getFullYear(),current.getMonth()+Number(b.dataset.userDateNav),1));
    }else{
      const value=b.hasAttribute('data-user-date-clear')?'':b.hasAttribute('data-user-date-today')?userYmd(new Date()):b.dataset.userDateDay;
      input.value=value;
      picker.querySelector('[data-node-date-label]').textContent=value?userDateLabel(value):'Выберите дату';
      cal.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();
    }
  }
  else if(b=g('[data-user-date-open],[data-user-date-nav],[data-user-date-day],[data-user-date-today],[data-user-date-clear]')){e.preventDefault();handleUserCalendarAction(b)}
  else if(b=g('[data-user-renew-apply]')){e.preventDefault();handleUserRenewalAction(b)}
  else if(b=g('[data-user-sub-create]')){
    const id=Number(b.dataset.userSubCreate);
    const existing=$('[data-user-sub-state="'+id+'"] .user-subscription-url');
    if(existing&&!await panelConfirm(panelIsEnglish()?'Rotate this link? The old subscription will stop working.':'Перевыпустить ссылку? Прежняя подписка сразу перестанет работать.'))return;
    if(!existing&&b.textContent.includes('старую')&&!await panelConfirm('Старая ссылка перестанет работать. Продолжить?',{danger:true,title:'Перевыпуск ссылки'}))return;
    b.disabled=true;
    try{
      const result=await backendRequest('/api/v1/users/'+encodeURIComponent(id)+'/subscription',{method:'POST'});
      await loadUserSubscription(id);
      if(result.readiness?.ready===false){
        toast((panelIsEnglish()?'Link created, but connections are not ready: ':'Ссылка создана, но подключения не готовы: ')+(result.readiness.warning||'Проверьте XRAY STUDIO и сквады.'));
      }else{
        toast(panelIsEnglish()?'Subscription saved':'Подписка сохранена');
      }
    }catch(error){toast('Ошибка подписки: '+(error.message||'API'))}
    finally{b.disabled=false}
  }
  else if(b=g('[data-user-sub-copy]')){
    const el=$('[data-user-sub-state="'+b.dataset.userSubCopy+'"] .user-subscription-url');
    if(el){try{await navigator.clipboard.writeText(el.value);toast(panelIsEnglish()?'Link copied':'Ссылка скопирована')}catch(_){el.focus();el.select();document.execCommand('copy');toast('Ссылка выделена')}}
  }
  else if(b=g('[data-user-sub-open]')){
    const el=$('[data-user-sub-state="'+b.dataset.userSubOpen+'"] .user-subscription-url');
    if(el){const url=new URL(el.value);if(url.protocol==='https:'||url.origin===location.origin)window.open(url.href,'_blank','noopener,noreferrer')}
  }
  else if(b=g('[data-user-sub-revoke]')){
    const id=Number(b.dataset.userSubRevoke);
    if(!await panelConfirm(panelIsEnglish()?'Revoke this subscription? Its URL will stop working.':'Отозвать подписку? Ссылка сразу перестанет работать.'))return;
    b.disabled=true;
    try{await backendRequest('/api/v1/users/'+encodeURIComponent(id)+'/subscription',{method:'DELETE'});await loadUserSubscription(id);toast(panelIsEnglish()?'Subscription revoked':'Подписка отозвана')}
    catch(error){toast('Ошибка: '+(error.message||'API'))}finally{b.disabled=false}
  }
  else if(b=g('[data-user-client-json]')){
    e.preventDefault();
    const user=DB.users.find(u=>u.id===Number(b.dataset.userClientJson));
    if(!user)return;
    b.disabled=true;
    try{
      const config=await backendRequest('/api/v1/users/'+encodeURIComponent(user.id)+'/client-json');
      window.xmeshGeneratedClientJson=config;
      modal('<div class="box"><div class="bar2"><div><h2>Клиентский Xray JSON · '+esc(user.username)+'</h2><p class="note">Конфигурация из единого серверного JSON Engine с настройками SUBSCRIPTION STUDIO.</p></div><button type="button" class="ia" data-x aria-label="Закрыть">'+ic('x')+'</button></div>'+
        '<textarea id="xmesh-generated-client-json" spellcheck="false" readonly rows="20" style="width:100%;font-family:monospace;min-height:400px;resize:vertical">'+esc(JSON.stringify(config,null,2))+'</textarea>'+
        '<div class="act"><button type="button" class="btn" data-user-client-json-copy>'+ic('copy')+' Копировать JSON</button><button type="button" class="gh" data-user-client-json-download>'+ic('download')+' Скачать JSON</button></div></div>','wide');
    }catch(error){toast('Ошибка Client JSON: '+(error.message||'API'))}
    finally{b.disabled=false}
  }
  else if(b=g('[data-user-client-json-copy]')){
    const config=window.xmeshGeneratedClientJson;
    if(config){try{await navigator.clipboard.writeText(JSON.stringify(config,null,2));toast('Client JSON скопирован')}catch(error){toast('Не удалось скопировать JSON')}}
  }
  else if(b=g('[data-user-client-json-download]')){
    const config=window.xmeshGeneratedClientJson;
    if(config){
      const blob=new Blob([JSON.stringify(config,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='xmesh-client.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
    }
  }
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
  else if(b=g('[data-host-clear-overrides]')){
    const form=b.closest('form');
    if(form){['sni','host','path','publicKey','shortId','spiderX','alpn','serviceName','clientEncryption','fp'].forEach(key=>{const input=form.elements.namedItem(key);if(input)input.value='';});hostEditorRefresh(form);toast('Переопределения сброшены — применятся настройки XRAY STUDIO после сохранения');}
  }
  else if(b=g('[data-node-create-host]')){
    const node=DB.nodes.find(n=>String(n.id)===b.dataset.nodeCreateHost);
    if(node){
      const profile=hostProfile(node.profileId),inbound=profile?inbs(profile).find(i=>i.protocol==='vless'):null;
      entForm('hosts',null,{remark:node.name||'Новый хост',address:node.addr||'',port:node.port||443,
        profileId:profile?.id||DB.profiles[0]?.id||0,tag:inbound?.tag||'',nodes:[node.id],fp:'',order:DB.hosts.length+1});
    }
  }
  else if(b=g('[data-host-link-profile]')){
    const form=b.closest('form[data-ent="hosts"]'),node=DB.nodes.find(n=>String(n.id)===b.dataset.hostLinkProfile),profile=hostProfile(form?.elements.namedItem('profileId')?.value);
    if(node&&profile){
      const ok=await window.XMeshStudioDialogs?.confirm?.({title:'Изменить XRAY-профиль ноды?',description:'Ноде «'+node.name+'» будет назначен профиль «'+profile.name+'». Это меняет серверную привязку, а не только хост. Проверьте совместимость конфигурации с нодой.',confirmLabel:'Назначить профиль',cancelLabel:'Отмена',danger:false});
      if(ok){try{await api.update('nodes',node.id,{profileId:profile.id});hostEditorRefresh(form);toast('Профиль ноды обновлён. Проверьте применение Xray-конфигурации на сервере.')}catch(error){toast('Не удалось изменить профиль ноды: '+error.message)}}
    }
  }
  else if(b=g('[data-host-repair]')){const node=DB.nodes.find(n=>String(n.id)===b.dataset.hostRepair);if(node){toast('Откройте настройки ноды и назначьте нужный XRAY-профиль. Несохранённые поля хоста не сохраняются.');entForm('nodes',node.id);}}
  else if(b=g('[data-host-duplicate]')){const host=DB.hosts.find(h=>String(h.id)===b.dataset.hostDuplicate);if(host){const {id,...copy}=host;entForm('hosts',null,{...copy,remark:(copy.remark||'Хост')+' · копия',order:DB.hosts.length+1});}}
  else if(b=g('[data-ne]')){const [k,id]=b.dataset.ne.split(':');entForm(k,id)}
  else if(b=g('tr[data-e]')){const [k,id]=b.dataset.e.split(':');entForm(k,id)}
  else if(b=g('[data-mv]')){const [k,id,d]=b.dataset.mv.split(':'),a=[...DB[k]].sort((x,y)=>x.order-y.order),i=a.findIndex(x=>x.id==id),j=i+ +d;if(a[j]){const o=a[i].order;await api.update(k,a[i].id,{order:a[j].order});await api.update(k,a[j].id,{order:o});render(1)}}
  else if(b=g('[data-del]')){const [k,id]=b.dataset.del.split(':'),e=ENT[k],r=DB[k].find(x=>String(x.id)===id),m=e?.guard?.(r);if(m){const error=$('#fe');if(error)error.textContent=m;else toast(m);return}if(!r){toast('Запись уже удалена или не найдена.');return}const linked=k==='nodes'?DB.hosts.filter(h=>Array.isArray(h.nodes)&&h.nodes.some(nodeId=>String(nodeId)===String(id))):[];const question=linked.length?`Удалить узел «${r.name}»? Он будет отвязан от ${linked.length} хост(ов). Хосты без других привязанных узлов будут отключены. Самих хостов не удаляем.`:`Удалить «${e?.t||k}»?`;confirmBox(question,'Удалить',async()=>{try{await api.remove(k,id);toast('Запись удалена');await render(1)}catch(err){toast('Не удалось удалить: '+(err.message||'ошибка backend'))}})}
  else if(b=g('[data-node-bootstrap]')){
    const id=Number(b.dataset.nodeBootstrap);
    if(location.protocol!=='https:'){toast('Для подключения требуется HTTPS');return}
    b.disabled=true;
    try{
      const issued=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/enrollment',{method:'POST'});
      const url='https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/6f8919ef5314bed2a16fd2137aa37c11730c9797/bootstrap.sh';
      const command='curl --proto "=https" --tlsv1.2 -H "Cache-Control: no-cache" -fsSLo /tmp/xmesh-bootstrap.sh '+url+' && grep -q "Installing Docker Engine and Compose from Docker" /tmp/xmesh-bootstrap.sh && sudo bash /tmp/xmesh-bootstrap.sh '+location.origin+' '+id+' '+(Number(DB.nodes.find(node=>Number(node.id)===id)?.port)||8443);
      modal('<div class="box node-setup"><div class="bar2 node-setup-head"><div><h2>Подключение узла</h2><p>Два шага для установки XMesh Node</p></div><button class="ia" data-x aria-label="Закрыть">'+ic('x')+'</button></div>'+
        '<section class="node-setup-step"><div class="node-setup-step-title"><span class="node-setup-number">1</span><div><h3>Команда для VPS</h3><p>Скопируйте и запустите в терминале сервера.</p></div></div><textarea id="node-bootstrap-command" readonly spellcheck="false" rows="4" aria-label="Команда установки">'+esc(command)+'</textarea><button type="button" class="btn node-setup-copy" data-copy-node-bootstrap>'+ic('copy')+'Скопировать команду</button></section>'+
        '<section class="node-setup-step"><div class="node-setup-step-title"><span class="node-setup-number">2</span><div><h3>Токен подключения</h3><p>Вставьте его, когда установщик запросит токен.</p></div></div><input id="node-bootstrap-token" type="password" readonly autocomplete="off" aria-label="Одноразовый токен подключения" value="'+esc(issued.token)+'"><div class="node-setup-token-actions"><span>Действует 10 минут · не передавайте другим</span><button type="button" class="gh" data-copy-node-token>'+ic('copy')+'Скопировать токен</button></div></section></div>','wide');
    }catch(error){toast('Ошибка выдачи команды: '+(error.message||'API'))}
    finally{b.disabled=false}
  }
  else if(b=g('[data-copy-node-token]')){
    const el=$('#node-bootstrap-token');if(el){try{await navigator.clipboard.writeText(el.value);toast('Токен скопирован')}catch(_){toast('Не удалось скопировать токен')}}
  }
  else if(b=g('[data-copy-node-bootstrap]')){
    const el=$('#node-bootstrap-command');if(el){try{await navigator.clipboard.writeText(el.value);toast('Команда скопирована')}catch(_){el.select();document.execCommand('copy');toast('Команда скопирована')}}
  }
  else if(b=g('[data-node-metrics]')){
    const id=Number(b.dataset.nodeMetrics),node=DB.nodes.find(n=>Number(n.id)===id);
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
    if(!await panelConfirm('Активировать Ed25519 для узла '+id+'? Если ключ уже существует, предыдущий ключ перестанет работать.'))return;
    b.disabled=true;
    try{
      await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/metrics-key',{method:'POST',body:JSON.stringify({publicKey})});
      toast('Ed25519 активирован. Подписанные запросы разрешены.');$('#metrics-public-key').value='';
    }catch(error){toast('Не удалось зарегистрировать ключ: '+(error.message||'ошибка API'))}
    finally{b.disabled=false}
  }
  else if(b=g('[data-node-key-revoke]')){
    const id=Number(b.dataset.nodeKeyRevoke);
    if(!await panelConfirm('Отозвать ВСЕ учётные данные узла '+id+'? Отправка метрик остановится до регистрации нового ключа.'))return;
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
    const editor=b.closest('.node-ip-section');
    const userId=Number(editor?.querySelector('[data-node-rotation-user]')?.value);
    const result=editor?.querySelector('[data-node-rotation-result]');
    if(!Number.isSafeInteger(userId)||userId<1){toast('Выберите активного пользователя для проверки.');return}
    b.disabled=true;
    if(result)result.textContent='Получение адреса…';
    try{
      const r=await backendRequest('/api/v1/nodes/'+encodeURIComponent(nodeId)+'/rotation/next',{method:'POST',body:JSON.stringify({userId})});
      if(result)result.textContent=r.address;
    }catch(error){if(result)result.textContent=error.message||'Не удалось получить адрес.'}
    finally{b.disabled=false}
  }
  else if(b=g('[data-agent-update]')){
    const id=Number(b.dataset.agentUpdate),node=DB.nodes.find(n=>Number(n.id)===id);
    if(!node){toast('Узел не найден.');return}
    if(b.dataset.loading==='1')return;
    b.dataset.loading='1';b.disabled=true;
    const original=b.innerHTML;
    try{
      const runtime=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/runtime');
      if(!runtime.connected)throw new Error('Нет свежей связи с управляющим агентом. Проверьте подключение ноды.');
      if(!/^control-v4[.]/.test(String(runtime.version||''))){
        throw new Error('Agent '+(runtime.version||'неизвестной версии')+' не поддерживает дистанционное самообновление. Требуется один раз установить Agent v4 штатным скриптом на ноде; затем SSH больше не нужен.');
      }
      const confirmed=await panelConfirm(
        'Обновить управляющий Agent на «'+node.name+'»? Нода самостоятельно загрузит фиксированные компоненты XMesh из официальных репозиториев и проверит установку. Ed25519-ключ и настройки останутся на месте.',
        {title:'Обновить Agent · '+node.name,confirmLabel:'Обновить Agent'}
      );
      if(!confirmed)return;
      nodeAgentUpdating.add(id);
      paintNodeAgentUpdate(id,true);
      b.innerHTML=ic('refresh-cw')+'Agent обновляется…';
      const request=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/agent-update',{
        method:'POST',body:JSON.stringify({})
      });
      toast('Команда обновления Agent отправлена ноде.');
      const deadline=Date.now()+180000;
      let status=null;
      while(Date.now()<deadline){
        await new Promise(resolve=>setTimeout(resolve,3000));
        status=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/restart');
        if(status.id!==request.id)throw new Error('Очередь команд ноды изменилась.');
        if(status.state==='succeeded')break;
        if(status.state==='failed')throw new Error(status.result||'Agent не смог завершить обновление.');
      }
      if(status?.state!=='succeeded')throw new Error('Agent не подтвердил установку в течение трёх минут.');
      let observed=null;
      for(let attempt=0;attempt<8;attempt++){
        observed=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/runtime');
        if(observed.connected&&observed.version===request.targetVersion)break;
        await new Promise(resolve=>setTimeout(resolve,2500));
      }
      toast(node.name+': '+(status.result||'Agent успешно обновлён')+
        (observed?.version!==request.targetVersion?' · ожидается новый heartbeat':''));
      if(cur==='nodes')updateNodeRuntimeBadges(node,observed);
    }catch(error){toast('Обновление Agent: '+(error.message||'ошибка API'))}
    finally{
      nodeAgentUpdating.delete(id);
      if(cur==='nodes'){
        try{
          const fresh=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/runtime');
          updateNodeRuntimeBadges(node,fresh);
        }catch(_){
          paintNodeAgentUpdate(id,false);
          const badge=document.querySelector('[data-node-card-id="'+id+'"] [data-node-agent-version]');
          if(badge)badge.textContent='Agent —';
        }
      }
      delete b.dataset.loading;
      if(b.isConnected){b.disabled=false;b.innerHTML=original}
    }
  }
  else if(b=g('[data-xray-update]')){
    const id=Number(b.dataset.xrayUpdate),node=DB.nodes.find(n=>Number(n.id)===id);
    if(!node){toast('Узел не найден.');return}
    if(b.dataset.loading==='1')return;
    b.dataset.loading='1';b.disabled=true;
    const original=b.innerHTML;
    try{
      const version=await selectNodeXrayRelease(node,async()=>{
        const runtime=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/runtime');
        if(!runtime.connected||!/^control-v(?:3|4)[.]/.test(String(runtime.version||''))){
          throw new Error('Для выбора версии требуется управляющий агент control-v3. Обновите агент ноды.');
        }
        const catalog=await backendRequest('/api/v1/nodes/xray-releases');
        return {installed:runtime.xrayVersion,releases:Array.isArray(catalog.items)?catalog.items:[]};
      });
      if(!version)return;
      const confirmed=await panelConfirm(
        'Установить Xray '+version+' на «'+node.name+'»? Управляемый Docker-агент проверит конфигурацию и при ошибке попытается восстановить предыдущий образ. Активные подключения могут прерваться.',
        {title:'Подтвердить установку Xray '+version,confirmLabel:'Установить '+version}
      );
      if(!confirmed)return;
      nodeXrayUpdating.add(id);
      paintNodeXrayUpdate(id);
      b.innerHTML='<span class="node-agent-spinner" aria-hidden="true"></span><span>Xray обновляется…</span>';
      b.setAttribute('aria-label','Xray обновляется');
      const request=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/xray-update',{
        method:'POST',body:JSON.stringify({version})
      });
      toast('Обновление поставлено в очередь. Ожидаем результат узла.');
      const deadline=Date.now()+180000;
      let status=null;
      while(Date.now()<deadline){
        await new Promise(resolve=>setTimeout(resolve,3000));
        status=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/restart');
        if(status.id!==request.id)throw new Error('Очередь команд изменилась.');
        if(status.state==='succeeded')break;
        if(status.state==='failed')throw new Error(status.result||'Ошибка обновления');
      }
      if(status?.state!=='succeeded')throw new Error('Узел не подтвердил обновление за три минуты.');
      toast(node.name+': '+(status.result||'обновление успешно'));
      if(cur==='nodes')render(1);
    }catch(error){toast('Обновление Xray: '+(error.message||'ошибка API'))}
    finally{
      nodeXrayUpdating.delete(id);
      if(cur==='nodes'){
        try{
          const fresh=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/runtime');
          updateNodeRuntimeBadges(node,fresh);
        }catch(_){
          paintNodeXrayUpdate(id);
          const badge=document.querySelector('[data-node-card-id="'+id+'"] [data-node-xray-version]');
          if(badge)badge.textContent='Xray —';
        }
      }
      b.removeAttribute('aria-label');
      if(b.isConnected){b.innerHTML=original;b.disabled=false}
      delete b.dataset.loading;
    }
  }
  else if(b=g('[data-nr]')){
     const id=Number(b.dataset.nr),node=DB.nodes.find(n=>Number(n.id)===id);
     if(!node){toast('Нода больше не существует. Обновите список.');return}
     if(b.dataset.loading==='1')return;
     b.dataset.loading='1';b.disabled=true;
     try{
       const state=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/runtime');
       if(!state.connected||!/^control-v[1-9]/.test(String(state.version||''))){
         throw new Error('Нет управляющего агента. Агент метрик не выполняет перезапуск: обновите его через «Подключить агент ноды».');
       }
       const confirmed=await panelConfirm(
         'Перезапустить Xray на ноде «'+node.name+'»? Подключения клиентов кратковременно прервутся.',
         {title:'Перезапуск Xray',confirmLabel:'Перезапустить'}
       );
       if(!confirmed)return;
       const request=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/restart',{
         method:'POST',body:JSON.stringify({})
       });
       toast('Команда отправлена. Ожидаем подтверждения агента ноды.');
       const deadline=Date.now()+180000;
       let result=null;
       while(Date.now()<deadline){
         await new Promise(resolve=>setTimeout(resolve,2500));
         result=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/restart');
         if(result.id!==request.id)throw new Error('Состояние команды изменилось. Обновите раздел узлов.');
         if(result.state==='succeeded')break;
         if(result.state==='failed')throw new Error(result.result||'Перезапуск не подтверждён.');
       }
       if(result?.state!=='succeeded')throw new Error('Агент не подтвердил перезапуск в течение трёх минут.');
       toast(node.name+': Xray перезапущен и проверен управляющим агентом.');
       if(cur==='nodes')render(1);
     }catch(error){toast('Не удалось перезапустить Xray: '+(error.message||'ошибка API'))}
     finally{delete b.dataset.loading;if(b.isConnected)b.disabled=false}
   }
  else if(b=g('[data-nt]')){const n=DB.nodes.find(x=>x.id==b.dataset.nt);await api.update('nodes',n.id,{disabled:!n.disabled});toast(`${n.name}: ${n.disabled?'отключён':'включён'}`);render(1)}
  else if(b=g('[data-tt]')){TP.tab=b.dataset.tt;TP.q='';TP.f='';render(1)}
  else if(b=g('[data-lv]')){}
  else if(b=g('[data-th]')){C.theme=b.dataset.th;apply();syncSubscriptionTheme();$$('#th button').forEach(x=>x.classList.toggle('on',x==b))}
  else if(b=g('[data-ac]')){C.accent=b.dataset.ac;apply();syncSubscriptionTheme();$$('[data-ac]').forEach(x=>{const active=x===b;x.classList.toggle('on',active);x.setAttribute('aria-pressed',String(active))})}
   else if(g('#palette-apply')){C.customA=paletteDraft.a;C.customB=paletteDraft.b;C.hue=paletteDraft.h;C.sat=paletteDraft.s;C.lum=paletteDraft.l;C.accent='custom';apply();syncSubscriptionTheme();render(1);toast('Палитра применена')}
   else if(g('#palette-cancel')){resetPaletteDraft();render(1)}
  else if(b=g('[data-ui]')){const prop=b.dataset.ui,value=b.dataset.value;if(prop&&value&&(prop!=='surface'||['solid','glass','raised'].includes(value))){C[prop]=value;apply();if(prop==='font'||prop==='surface')syncSubscriptionTheme();document.querySelectorAll(`[data-ui="${prop}"]`).forEach(x=>{const active=x.dataset.value===value;x.classList.toggle('on',active);x.setAttribute('aria-pressed',String(active))})}}
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
    if(!await panelConfirm('Обновить XMesh Nexus из origin/main? Сначала резервная копия PostgreSQL, затем пересборка Docker и перезапуск. Продолжить?'))return;
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
 const dropdown=picker.querySelector('.country-dropdown');if(dropdown)dropdown.hidden=false;
 const trigger=picker.querySelector('[data-country-trigger]');if(trigger)trigger.setAttribute('aria-expanded','true');
 input.setAttribute('aria-expanded','true');
}
function closeCountryOptions(picker){
 const input=picker?.querySelector('[data-country-search]'),options=picker?.querySelector('.country-options');
 if(options)options.hidden=true;
 const dropdown=picker?.querySelector('.country-dropdown');if(dropdown)dropdown.hidden=true;
 const trigger=picker?.querySelector('[data-country-trigger]');if(trigger)trigger.setAttribute('aria-expanded','false');
 if(input)input.setAttribute('aria-expanded','false');
}
document.addEventListener('click',e=>{
 const trigger=e.target.closest('[data-country-trigger]');
 if(trigger){const picker=trigger.closest('.country-picker');const dropdown=picker?.querySelector('.country-dropdown');if(!dropdown)return;const opened=!dropdown.hidden;if(opened){closeCountryOptions(picker)}else{renderCountryOptions(picker,'');const input=picker.querySelector('[data-country-search]');if(input){input.value='';input.focus()}}return}
 if(!e.target.closest('.country-picker'))document.querySelectorAll('.country-picker-dropdown').forEach(closeCountryOptions);
});
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
  if(t.matches('[data-host-node-preset]')){
    const node=DB.nodes.find(n=>String(n.id)===t.value),form=t.closest('form');
    if(node&&form){
      const address=form.elements.namedItem('address'),port=form.elements.namedItem('port'),
        remark=form.elements.namedItem('remark'),profile=form.elements.namedItem('profileId');
      if(address)address.value=node.addr||'';
      if(port)port.value=node.port||443;
      if(remark&&!remark.value.trim())remark.value=node.name||'';
      if(profile&&hostProfile(node.profileId)&&String(profile.value)!==String(node.profileId)){
        profile.value=String(node.profileId);
        const key=form.elements.namedItem('publicKey');if(key){key.value='';delete key.dataset.hostAutoPublic}
      }
      form.querySelectorAll('[name="nodes"]').forEach(input=>{input.checked=String(input.value)===String(node.id)});
      hostEditorRefresh(form,true);void hostDeriveRealityPublic(form);
      const warning=form.querySelector('[data-host-warnings]');
      if(!hostProfile(node.profileId) && warning){
        warning.hidden=false;
        warning.textContent='Нода «'+node.name+'» ссылается на отсутствующий XRAY-профиль ID '+node.profileId+'. Назначьте ей существующий профиль в разделе «Узлы».';
      }
    }
    return;
  }
  if(t.closest('form[data-ent="hosts"]')){
    const form=t.closest('form');
    if(t.name==='profileId'){
      const key=form.elements.namedItem('publicKey');
      if(key){key.value='';delete key.dataset.hostAutoPublic}
      hostEditorRefresh(form,true);void hostDeriveRealityPublic(form);
    }
    else hostEditorRefresh(form);
    return;
  }

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
    const u={username:d.username,disabled:false,hold:d.hold,holdDays:d.days||30,created:Date.now(),expireAt:d.hold||!d.days?null:Date.now()+d.days*DAY,limit:d.limit,used:0,strategy:d.strategy,tag:d.tag,tg:'',email:'',desc:d.desc,hwid:d.hwid,squads:d.squads,onlineAt:0,adminId:DB.admins.find(a=>a.role==='owner')?.id||null,short:Math.floor(Math.random()*2**40).toString(36).padStart(8,'a'),xrayId:crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=crypto.getRandomValues(new Uint8Array(1))[0]&15;return(c==='x'?r:(r&3|8)).toString(16)}),xrayProfileId:d.xrayProfileId||null,devices:[]};
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
  else if(k=='ent'){e.preventDefault();const key=f.dataset.ent,e2=ENT[key],d=read(key==='nodes'?e2.fs.filter(field=>!field.k.startsWith('geo')):e2.fs,f),id=f.dataset.id,m=e2.chk?.(d,+id);if(m)return er(m);
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
// Notifications must not depend on the local "runtime" variable inside nodesP().
// Fetch live statuses on demand and render an immediately responsive dialog.
const nodeNotificationTitle=node=>flagView(node.flag,'notification-country-flag')+
  '<span class="notification-node-label">'+esc(node.name||'Узел')+
  (node.hosting?.trim()?'<small>'+esc(node.hosting.trim())+'</small>':'')+'</span>';
const notificationKey='xmesh-notifications-v1';
const notificationState=(()=>{try{return JSON.parse(localStorage.getItem(notificationKey)||'{}')}catch{return {}}})();
const saveNotifications=()=>{try{localStorage.setItem(notificationKey,JSON.stringify(notificationState))}catch{}};
const notificationId=item=>[item.group,item.node?.id??item.title??'',item.group==='Аренда серверов'?'rent':item.group==='Лимиты трафика'?'quota':item.message?.split(' · ')[0]].join('|');
const notificationDate=ms=>new Date(ms).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
$('#bell').onclick=()=>{
 const button=$('#bell');
 modal('<div class="box notification-workspace">'+
  '<div class="bar2 notification-header"><div class="notification-heading"><h2>Уведомления</h2><small>События инфраструктуры</small></div>'+
  '<button type="button" class="gh sm" data-notifications-clear title="Очистить все уведомления">'+ic('trash')+' Очистить все</button>'+ 
  '<button type="button" class="gh sm" data-notifications-refresh aria-label="Обновить уведомления" title="Обновить">'+ic('redo')+'</button>'+
  '<button type="button" class="ia" data-x aria-label="Закрыть">'+ic('x')+'</button></div>'+
  '<div class="notification-sections" data-notifications-content role="status" aria-live="polite">'+
  '<p class="note">Загружаем события и проверяем состояние нод…</p></div></div>','pop');
 button.setAttribute('aria-expanded','true');
 const workspace=dlg.querySelector('.notification-workspace');
 const output=workspace?.querySelector('[data-notifications-content]');
 const refresh=workspace?.querySelector('[data-notifications-refresh]');
 if(!workspace||!output||!refresh)return;
 let busy=false;
 async function updateNotifications(){
  if(busy)return;
  busy=true;refresh.disabled=true;
  output.innerHTML='<p class="note">Проверяем состояние нод и уведомления…</p>';
  let freshNodes=DB.nodes;
  try{
   const list=await backendRequest('/api/v1/collections/nodes');
   if(Array.isArray(list?.items)){freshNodes=list.items;DB.nodes=list.items}
  }catch(error){console.warn('Node notification refresh failed',error)}
  const nodes=[...freshNodes],users=[...DB.users],today=Date.now();
  // A missing heartbeat means "unknown", not that Xray is definitely offline.
  // Failed API requests are reported as unavailable, never a fake disconnected state.
  const statuses=new Map(await Promise.all(nodes.filter(n=>!n.disabled||(n.disabled&&n.disabledReason==='traffic_limit')).map(async n=>{
   try{
    return [String(n.id),{data:await backendRequest('/api/v1/nodes/'+encodeURIComponent(n.id)+'/runtime')}];
   }catch(error){
    return [String(n.id),{error:true}];
   }
  })));
  if(!workspace.isConnected||!dlg.open||!dlg.contains(workspace))return;
  const rent=nodes.flatMap(n=>{
   if(!n.billingDueDate||!/^\d{4}-\d{2}-\d{2}$/.test(n.billingDueDate))return [];
   const due=Date.parse(n.billingDueDate+'T23:59:59Z');
   const remind=Math.max(0,Number(n.billingRemindDays)||0);
   if(!Number.isFinite(due))return [];
   const days=Math.max(0,Math.ceil((due-today)/DAY));
   if(due>today&&days>remind)return [];
   const date=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(due));
   return [{group:'Аренда серверов',severity:due<today?'critical':'warning',node:n,
    message:(due<today?'Аренда просрочена':'До окончания аренды '+days+' дн.')+' · '+date+' · '+(Number(n.billingPrice)||0)+' '+(n.billingCurrency||'EUR')}];
  });
  const quotas=nodes.flatMap(n=>{
   if((!n.disabled||n.disabledReason!=='traffic_limit'))return [];
   const limit=Number(n.limit)||0;
   const runtime=statuses.get(String(n.id))?.data;
   const confirmed=runtime?.connected&&runtime?.xrayRunning===false;
   return [{group:'Лимиты трафика',severity:'critical',node:n,
    message:'Лимит '+(limit?fmt(limit,2)+' ГБ':'исчерпан')+
      (confirmed?' · Xray остановлен':' · ОСТАНОВКА XRAY НЕ ПОДТВЕРЖДЕНА')+
      (n.trafficLimitReachedAt?' · '+new Date(n.trafficLimitReachedAt.replace(' ','T')).toLocaleString('ru-RU'):'')+
      '. Нода заблокирована до увеличения лимита и ручного включения.'}];
  });
  const infrastructure=nodes.flatMap(n=>{
   if(n.disabled)return [];
   const status=statuses.get(String(n.id));
   if(status?.error||!status)return [{group:'Состояние инфраструктуры',severity:'neutral',node:n,message:'Не удалось получить состояние агента. Проверьте соединение с API.'}];
   const observed=status.data;
   if(!observed?.connected){
    if(observed?.lastSeenAt)return [{group:'Состояние инфраструктуры',severity:'critical',node:n,message:'Агент не отвечает · последнее соединение '+new Date(observed.lastSeenAt).toLocaleString('ru-RU')}];
    return [{group:'Состояние инфраструктуры',severity:'neutral',node:n,message:'Агент ещё не подключён · состояние Xray неизвестно'}];
   }
   if(observed.xrayRunning===false)return [{group:'Состояние инфраструктуры',severity:'critical',node:n,message:'Агент онлайн, но Xray остановлен'}];
   if(observed.routerRunning===false)return [{group:'Состояние инфраструктуры',severity:'critical',node:n,message:'Агент онлайн, но маршрутизатор остановлен'}];
   return [];
  });
  const expiringUsers=users.flatMap(u=>{
   if(st(u)!=='ACTIVE')return [];
   if(u.limit&&u.used/u.limit>.9)return [{group:'Пользователи',severity:'warning',title:u.username,message:'Использовано '+Math.round(u.used/u.limit*100)+'% трафика'}];
   if(u.expireAt&&u.expireAt>today&&u.expireAt-today<2*DAY)return [{group:'Пользователи',severity:'warning',title:u.username,message:'Подписка скоро истечёт · '+left(u.expireAt)}];
   return [];
  });
  const current=[...quotas,...rent,...infrastructure,...expiringUsers];
  const active=new Set(current.map(notificationId));
  for(const key of Object.keys(notificationState))if(!active.has(key))delete notificationState[key];
  for(const item of current){
   const key=notificationId(item);
   if(!notificationState[key])notificationState[key]={at:today,hidden:false};
  }
  saveNotifications();
  const items=current.filter(item=>!notificationState[notificationId(item)]?.hidden);
  const groups=['Лимиты трафика','Состояние инфраструктуры','Аренда серверов','Пользователи'];
  const body=groups.map(group=>{
   const entries=items.filter(item=>item.group===group);
   if(!entries.length)return '';
   return '<section class="notification-group"><h3>'+esc(group)+' <span>'+entries.length+'</span></h3>'+
    entries.map(item=>'<div class="notification-item notification-'+item.severity+'">'+
     '<span class="notification-status-dot" aria-hidden="true"></span><div>'+
     (item.node?'<div class="notification-title">'+nodeNotificationTitle(item.node)+'</div>':'<b>'+esc(item.title||'Уведомление')+'</b>')+
     '<p>'+esc(item.message)+'</p><small class="notification-when">Когда: '+esc(notificationDate(notificationState[notificationId(item)].at))+'</small></div>'+
     '<button type="button" class="ia notification-dismiss" data-notification-dismiss="'+esc(notificationId(item))+'" aria-label="Удалить уведомление" title="Удалить">'+ic('x')+'</button></div>').join('')+'</section>';
  }).join('');
  output.innerHTML=body||'<p class="note notification-empty">Новых уведомлений нет. Доступные ноды не сообщают об ошибках.</p>';
  if(typeof showNodeQuotaBell==='function')showNodeQuotaBell();
  busy=false;refresh.disabled=false;
 }
 output.addEventListener('click',event=>{
  const button=event.target.closest('[data-notification-dismiss]');
  if(!button)return;
  const key=button.dataset.notificationDismiss;
  if(notificationState[key])notificationState[key].hidden=true;
  saveNotifications();
  showNodeQuotaBell();
  button.closest('.notification-item')?.remove();
  for(const group of output.querySelectorAll('.notification-group')){
   const count=group.querySelectorAll('.notification-item').length;
   if(!count)group.remove();
   else {const label=group.querySelector('h3 span');if(label)label.textContent=String(count)}
  }
  if(!output.querySelector('.notification-item'))output.innerHTML='<p class="note notification-empty">Уведомления очищены.</p>';
 });
 workspace.querySelector('[data-notifications-clear]')?.addEventListener('click',()=>{
  for(const item of output.querySelectorAll('[data-notification-dismiss]')){
   const key=item.dataset.notificationDismiss;
   if(notificationState[key])notificationState[key].hidden=true;
  }
  saveNotifications();
  showNodeQuotaBell();
  output.innerHTML='<p class="note notification-empty">Уведомления очищены.</p>';
 });
 refresh.addEventListener('click',()=>{void updateNotifications()});
 void updateNotifications();
};
dlg.addEventListener('close',()=>{$('#bell')?.setAttribute('aria-expanded','false')});
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
// Persistent quota notifications are read from PostgreSQL, not a transient
// browser timer or client-only threshold. Polling discovers events even if
// another administrator is editing a node on a different device.
let nodeQuotaPoller=null,nodeQuotaBusy=false;
let acknowledgedQuotaEvents=new Set();
function showNodeQuotaBell(){
 const bell=$('#bell');
 if(!bell)return;
 const pending=DB.nodes.some(n=>{
  if((!n.disabled||n.disabledReason!=='traffic_limit'))return false;
  const key=notificationId({group:'Лимиты трафика',node:n});
  return !notificationState[key]?.hidden;
 });
 bell.title=pending?'Есть непрочитанные критические уведомления':'Уведомления';
 bell.setAttribute('aria-label',bell.title);
 if(pending&&!bell.querySelector('.pip')){
  const dot=document.createElement('span');dot.className='pip';
  dot.setAttribute('aria-label','Есть критические уведомления');
  bell.append(dot);
 }
 if(!pending)bell.querySelector('.pip')?.remove();
}
function startNodeQuotaNotifications(){
 if(nodeQuotaPoller!==null)clearInterval(nodeQuotaPoller);
 acknowledgedQuotaEvents=new Set(DB.nodes.filter(n=>(n.disabled&&n.disabledReason==='traffic_limit'))
  .map(n=>String(n.id)+':'+String(n.trafficLimitReachedAt||'')));
 showNodeQuotaBell();
 nodeQuotaPoller=setInterval(async()=>{
  if(!backendReady||nodeQuotaBusy)return;
  nodeQuotaBusy=true;
  try{
   const result=await backendRequest('/api/v1/collections/nodes');
   if(!Array.isArray(result?.items))return;
   for(const node of result.items){
    if((!node.disabled||node.disabledReason!=='traffic_limit'))continue;
    const key=String(node.id)+':'+String(node.trafficLimitReachedAt||'');
    if(!acknowledgedQuotaEvents.has(key)){
     acknowledgedQuotaEvents.add(key);
     toast('КРИТИЧНО: '+(node.name||'Узел')+
      ' — лимит трафика исчерпан, запрошена остановка Xray');
    }
   }
   DB.nodes=result.items;
   showNodeQuotaBell();
   if(cur==='nodes'){
    // Update the disabled state without erasing live gauge data.
    for(const node of result.items){
     const status=$('[data-node-card-id="'+node.id+'"] [data-node-runtime-state]');
     if(status&&(node.disabled&&node.disabledReason==='traffic_limit')){
      status.className='node-runtime-pill node-runtime-offline';
      status.textContent='Лимит исчерпан';
     }
    }
   }
  }catch(error){console.warn('Traffic cutoff notification check unavailable',error)}
  finally{nodeQuotaBusy=false}
 },10000);
}
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
  startNodeQuotaNotifications();
}
async function bootPanel(){
  try{
    const response=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('Backend API не отвечает.');
    const session=await response.json();
    if(!session.authenticated){location.replace(location.pathname);return}
    sessionUser=session.user||null;
    document.documentElement.dataset.accessRole=viewerMode()?'viewer':sessionUser.role;
    if(viewerMode()){
      const allowed=new Set(['#home','#statistics','#users','#nodes']);
      document.querySelectorAll('#nav a[href^="#"]').forEach(a=>{
        if(!allowed.has(a.getAttribute('href')))a.remove();
      });
      document.querySelectorAll('#nav .g').forEach(group=>{
        let next=group.nextElementSibling,hasLink=false;
        while(next&&!next.classList.contains('g')){
          if(next.matches('a'))hasLink=true;
          next=next.nextElementSibling;
        }
        if(!hasLink)group.remove();
      });
      document.querySelector('#more')?.remove();
      if(!allowed.has(location.hash))location.hash='#home';
    }
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

