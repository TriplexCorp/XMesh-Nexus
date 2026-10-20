
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const cl=(v,a,b)=>Math.min(b,Math.max(a,v));
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hs=s=>[...String(s)].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7);
const fmt=(v,d=0)=>(+v).toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});
const gb=v=>v>=1024?fmt(v/1024,2)+' ТБ':v>=10?fmt(v,1)+' ГБ':v>=1?fmt(v,2)+' ГБ':fmt(v*1024)+' МБ';
const ago=t=>{if(!t)return'никогда';const s=(Date.now()-t)/1e3;return s<60?'только что':s<3600?(s/60|0)+' мин назад':s<86400?(s/3600|0)+' ч назад':(s/86400|0)+' дн назад'};
const DAY=864e5,left=t=>{if(!t)return'бессрочно';const d=Math.ceil((t-Date.now())/DAY);return d>0?d+' дн':d==0?'истёк сегодня':'истёк '+(-d)+' дн назад'};
const chip=(t,c)=>`<span class="chip" style="--c:var(${c})">${t}</span>`;
const smooth=p=>{let d=`M${p[0]}`;for(let i=0;i<p.length-1;i++){const a=p[i-1]||p[i],b=p[i],c=p[i+1],e=p[i+2]||c;d+=`C${b[0]+(c[0]-a[0])/6},${b[1]+(c[1]-a[1])/6},${c[0]-(e[0]-b[0])/6},${c[1]-(e[1]-b[1])/6},${c}`}return d};
const P={home:'<rect x="3" y="3" width="7" height="9" rx="1.500"/><rect x="14" y="3" width="7" height="5" rx="1.500"/><rect x="14" y="12" width="7" height="9" rx="1.500"/><rect x="3" y="16" width="7" height="5" rx="1.500"/>',users:'<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20c.6-3.600 3.200-5.500 6.500-5.500s5.900 1.900 6.500 5.500M16 4.600a3.500 3.500 0 0 1 0 6.800M18.500 14.800c1.700.7 2.700 2.300 3 4.700"/>',layers:'<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/>',link:'<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/>',server:'<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.500h.01M7 16.500h.01"/>',file:'<path d="M7 3h7l5 5v13H7V3Z"/><path d="M14 3v5h5"/>',code:'<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.500 5l-3 14"/>',tool:'<path d="M14 7a4 4 0 0 1 5.500-3.500L16 7l1 3 3 1 3.500-3.500A4 4 0 0 1 14 13l-8 8a2 2 0 0 1-3-3l8-8"/>',shield:'<path d="M12 3 4 6v6c0 4.500 3.400 8 8 9 4.600-1 8-4.500 8-9V6l-8-3Z"/>',sliders:'<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.200"/><circle cx="8" cy="17" r="2.200"/>',bell:'<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.500 2h-15L6 16ZM10 21h4"/>',search:'<circle cx="11" cy="11" r="6.500"/><path d="m16 16 4.500 4.500"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2.500v2M12 19.500v2M2.500 12h2M19.500 12h2M5.300 5.300l1.400 1.400M17.300 17.300l1.400 1.400M5.300 18.700l1.400-1.400M17.300 6.700l1.400-1.400"/>',moon:'<path d="M20 14.500A8 8 0 1 1 9.500 4a6.500 6.500 0 0 0 10.500 10.500Z"/>',redo:'<path d="M20 11a8 8 0 1 0-2.300 5.700M20 4v7h-7"/>',plus:'<path d="M12 5v14M5 12h14"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',pause:'<path d="M8 5v14M16 5v14"/>',play:'<path d="M7 4.500v15l12-7.500L7 4.500Z"/>',up:'<path d="m6 15 6-6 6 6"/>',down:'<path d="m6 9 6 6 6-6"/>',more:'<circle cx="5" cy="12" r="1.500"/><circle cx="12" cy="12" r="1.500"/><circle cx="19" cy="12" r="1.500"/>',dl:'<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',pen:'<path d="M4 20h4L19 9a2.800 2.800 0 0 0-4-4L4 16v4Z"/>'};
const ic=n=>`<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;

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
let sv,backendReady=false;const save=()=>{if(backendReady)return;clearTimeout(sv);sv=setTimeout(()=>{try{localStorage.setItem('xmeshNexusDB',JSON.stringify(DB))}catch(e){}},120)};
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
  async create(c,o){await lat();let row;if(backendReady){row=await backendRequest('/api/v1/collections/'+encodeURIComponent(c),{method:'POST',body:JSON.stringify(o)})}else{o.id=DB[c].reduce((m,x)=>Math.max(m,x.id),0)+1;row=o}DB[c].push(row);save();return row},
  async update(c,id,p){await lat();const x=DB[c].find(y=>y.id==id);if(!x)throw new Error('Запись не найдена в локальном кеше.');const row=backendReady?await backendRequest('/api/v1/collections/'+encodeURIComponent(c)+'/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(p)}):{...x,...p};Object.assign(x,row);save();return x},
  async remove(c,id){await lat();const i=DB[c].findIndex(x=>x.id==id);if(i<0)return null;const old=DB[c][i];if(backendReady)await backendRequest('/api/v1/collections/'+encodeURIComponent(c)+'/'+encodeURIComponent(id),{method:'DELETE'});DB[c].splice(i,1);save();return old},
  async bulk(c,ids,fn){await lat();for(const x of [...(DB[c]||[])].filter(item=>ids.has(item.id))){fn(x);await this.update(c,x.id,{...x})}save()},
  async saveSettings(patch){const saved=await backendRequest('/api/v1/settings',{method:'PATCH',body:JSON.stringify(patch)});DB.set={...DB.set,...saved,hooks:{...DB.set.hooks,...(saved.hooks||{})}};return DB.set},
  async stats(){await lat();const U=DB.users,by={};U.forEach(u=>{const status=st(u);by[status]=(by[status]||0)+1});const on=U.filter(isOn),live=DB.nodes.filter(n=>n.state==='ONLINE'&&!n.disabled),nodeOn={};live.forEach(n=>nodeOn[n.id]=0);return{by,total:U.length,online:on.length,conn:null,nodeOn,nOn:live.length,nAll:DB.nodes.length};}
};

/* ================= МЕТАДАННЫЕ ================= */
const STM={ACTIVE:['Активен','--ok'],DISABLED:['Отключён','--mu'],LIMITED:['Лимит','--wr'],EXPIRED:['Истёк','--er'],ON_HOLD:['Ожидает','--c3']};
const NS={ONLINE:['Онлайн','--ok'],OFFLINE:['Не отвечает','--er'],CONNECTING:['Подключение','--wr'],DISABLED:['Отключён','--mu']};
const STRAT=[['NO_RESET','Не сбрасывать'],['DAY','Каждый день'],['WEEK','Каждую неделю'],['MONTH','Каждый месяц']];
const nstat=n=>n.disabled?'DISABLED':n.state;
const NAV=[['Обзор',[['home','home','Дашборд',1]]],['Управление',[['users','users','Пользователи',1],['squads','layers','Сквады'],['hosts','link','Хосты',1],['nodes','server','Узлы',1],['templates','file','Шаблоны'],['profiles','code','Профили Xray']]],['Инструменты',[['tools','tool','Диагностика']]],['Система',[['admins','shield','Админы'],['set','sliders','Настройки']]]];
const FLAT=NAV.flatMap(g=>g[1]);
const swc=k=>r=>`<label class="sw"><input type="checkbox" data-tg="${k}:${r.id}" ${r.disabled?'':'checked'} aria-label="Включено"><span></span></label>`;
const ENT={
  squads:{t:'Сквады',n:'Набор инбаундов: что именно получает пользователь в подписке.',s:'id',nw:'Сквад',fs:[{k:'name',l:'Название',req:1},{k:'desc',l:'Описание'},{k:'inb',l:'Инбаунды (из профилей Xray)',t:'multi',o:tags}],
    cols:[['Название',r=>`<b>${esc(r.name)}</b><br><span class="mu">${esc(r.desc)}</span>`],['Инбаунды',r=>r.inb.map(t=>chip(esc(t),tcol(t))).join(' ')||'—'],['Пользователей',r=>DB.users.filter(u=>u.squads.includes(r.id)).length]],
    guard:r=>DB.users.some(u=>u.squads.includes(r.id))?'В скваде есть пользователи. Сначала переведите их в другой сквад.':''},
  hosts:{t:'Хосты',n:'Точки входа, которые попадают в подписку. Порядок определяет приоритет.',s:'order',nw:'Хост',mv:1,fs:[{k:'remark',l:'Название (remark)',req:1},{k:'address',l:'Адрес',req:1},{k:'port',l:'Порт',t:'num'},{k:'tag',l:'Инбаунд',t:'sel',o:tags},{k:'sni',l:'SNI'},{k:'path',l:'Path'},{k:'sec',l:'Безопасность',t:'sel',o:['reality','tls','none']},{k:'fp',l:'Fingerprint',t:'sel',o:['chrome','firefox','safari','random']},{k:'nodes',l:'Только на узлах',t:'multi',o:()=>DB.nodes.map(n=>[n.id,n.flag+' '+n.name]),h:'Ничего не выбрано — на всех узлах'}],
    def:()=>({port:443,sec:'reality',fp:'chrome',order:DB.hosts.length+1,nodes:[]}),
    cols:[['Название',r=>`<b>${esc(r.remark)}</b>`],['Адрес',r=>`${esc(r.address)}:${r.port}`],['Инбаунд',r=>chip(esc(r.tag),tcol(r.tag))],['SNI',r=>esc(r.sni||'—')],['Узлы',r=>r.nodes.length?r.nodes.map(i=>DB.nodes.find(n=>n.id==i)?.flag).join(' '):'все'],['Вкл.',swc('hosts')]]},
  nodes:{t:'Узлы',nw:'Узел',s:'id',fs:[{k:'name',l:'Название',req:1},{k:'flag',l:'Флаг (эмодзи)',ph:'🇩🇪'},{k:'addr',l:'Адрес',req:1},{k:'port',l:'Порт ноды',t:'num',req:1},{k:'profileId',l:'Профиль Xray',t:'sel',o:()=>DB.profiles.map(p=>[p.id,p.name])},{k:'mult',l:'Коэффициент трафика',t:'num',h:'1 — без изменений, 2 — считать вдвое'},{k:'limit',l:'Лимит трафика, ГБ',t:'num',h:'0 — без лимита'},{k:'resetDay',l:'День сброса счётчика',t:'num'}],def:()=>({flag:'',mult:1,limit:0,resetDay:1}),
    guard:r=>DB.hosts.some(h=>h.nodes.includes(r.id))?'Узел указан в хостах. Уберите его оттуда.':''},
  tpls:{t:'Шаблоны пользователей',n:'Готовые тарифы: выбираются при создании и подставляют лимиты, срок и доступ.',s:'id',nw:'Шаблон',fs:[{k:'name',l:'Название',req:1},{k:'limit',l:'Лимит, ГБ',t:'num',h:'0 — без лимита'},{k:'days',l:'Срок, дней',t:'num',h:'0 — бессрочно'},{k:'strategy',l:'Сброс трафика',t:'sel',o:STRAT},{k:'hwid',l:'Лимит устройств',t:'num'},{k:'squads',l:'Сквады',t:'multi',o:()=>DB.squads.map(s=>[s.id,s.name])},{k:'hold',l:'Отсчёт срока с первого подключения',t:'bool'}],def:()=>({strategy:'NO_RESET',hwid:2,squads:[]}),
    cols:[['Название',r=>`<b>${esc(r.name)}</b>`],['Трафик',r=>r.limit?r.limit+' ГБ':'∞'],['Срок',r=>r.days?r.days+' дн':'∞'],['Устройств',r=>r.hwid],['Сквады',r=>r.squads.map(i=>chip(esc(DB.squads.find(s=>s.id==i)?.name||'?'),'--b')).join(' ')],['Режим',r=>r.hold?chip('on hold','--c3'):'—']]},
  subs:{t:'Шаблоны подписки',n:'Что получает клиентское приложение: формат и содержимое конфигурации.',s:'id',nw:'Шаблон',fs:[{k:'name',l:'Название',req:1},{k:'fmt',l:'Формат',t:'sel',o:FMT},{k:'content',l:'Содержимое',t:'area',rows:9}],def:()=>({fmt:'XRAY_JSON',content:'{}'}),
    cols:[['Название',r=>`<b>${esc(r.name)}</b>`],['Формат',r=>chip(r.fmt,'--c3')],['Размер',r=>r.content.length+' симв.']]},
  profiles:{t:'Профили Xray',n:'Конфигурации ядра. Инбаунды из профиля становятся доступны в сквадах и хостах.',s:'id',nw:'Профиль',fs:[{k:'name',l:'Название',req:1},{k:'config',l:'Конфигурация (JSON)',t:'area',rows:16,h:'Вставьте полный конфиг Xray. В нём должен быть хотя бы один inbound.'}],def:()=>({config:''}),
    chk:(d,id)=>{let j;try{j=JSON.parse(d.config)}catch(e){return'Некорректный JSON: '+e.message}if(!Array.isArray(j.inbounds)||!j.inbounds.length)return'В конфиге нет массива inbounds.';const t=j.inbounds.map(i=>i.tag);if(t.some(x=>!x))return'У каждого инбаунда должен быть tag.';if(new Set(t).size!=t.length)return'Теги инбаундов должны быть уникальными.';const ot=DB.profiles.filter(p=>p.id!=id).flatMap(p=>inbs(p).map(i=>i.tag));if(t.some(x=>ot.includes(x)))return'Тег уже используется в другом профиле.'},
    cols:[['Название',r=>`<b>${esc(r.name)}</b>`],['Инбаунды',r=>inbs(r).map(i=>chip(esc(i.tag)+' · '+i.port,tcol(i.tag))).join(' ')||'—'],['Узлов',r=>DB.nodes.filter(n=>n.profileId==r.id).length]],
    guard:r=>DB.nodes.some(n=>n.profileId==r.id)?'Профиль назначен узлам. Сначала смените профиль у этих узлов.':''},
  admins:{t:'Администраторы',n:'Роли ограничивают действия. Лимиты считаются по пользователям, созданным администратором.',s:'id',nw:'Админ',fs:[{k:'username',l:'Логин',req:1,pat:'[A-Za-z0-9_.\\-]{3,24}'},{k:'role',l:'Роль',t:'sel',o:[['owner','Владелец'],['admin','Админ'],['viewer','Наблюдатель']]},{k:'maxUsers',l:'Максимум пользователей',t:'num',h:'0 — без ограничений'},{k:'maxGB',l:'Максимум трафика, ГБ',t:'num'},{k:'tg',l:'Telegram'}],def:()=>({role:'admin',maxUsers:100,maxGB:0}),
    chk:(d,id)=>DB.admins.some(a=>a.username.toLowerCase()==d.username.toLowerCase()&&a.id!=id)?'Такой логин уже есть.':'',
    cols:[['Логин',r=>`<b>${esc(r.username)}</b>`],['Роль',r=>chip({owner:'Владелец',admin:'Админ',viewer:'Наблюдатель'}[r.role],{owner:'--c4',admin:'--a',viewer:'--mu'}[r.role])],['Пользователей',r=>{const n=DB.users.filter(u=>u.adminId==r.id).length;return n+(r.maxUsers?' / '+r.maxUsers:'')}],['Трафик',r=>gb(DB.users.filter(u=>u.adminId==r.id).reduce((a,u)=>a+u.used,0))],['Вход',r=>ago(r.last)],['Вкл.',swc('admins')]],
    guard:r=>r.role=='owner'?'Владельца удалить нельзя.':DB.users.some(u=>u.adminId==r.id)?'За администратором закреплены пользователи.':''},
  tokens:{t:'API-токены',n:'Для интеграций: бот оплаты, мониторинг, скрипты.',s:'id',nw:'Токен',fs:[{k:'name',l:'Название',req:1},{k:'scope',l:'Права',t:'sel',o:[['read','Только чтение'],['write','Чтение и запись']]}],def:()=>({scope:'read'}),
    cols:[['Название',r=>`<b>${esc(r.name)}</b>`],['Права',r=>chip(r.scope=='read'?'чтение':'запись',r.scope=='read'?'--c3':'--wr')],['Создан',r=>ago(r.created)],['Использован',r=>ago(r.last)]],
    after:o=>{const s='lm_'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);modal(`<div class="box"><h2>Токен создан</h2><p class="note">Скопируйте его сейчас: позже показать его снова будет нельзя.</p><div class="lk"><input id="lk" readonly value="${s}" aria-label="Токен"><button class="gh" data-copy>${ic('copy')}</button></div><div class="act"><button class="btn" data-x>Готово</button></div></div>`);return 1}}
};
const FU=[{k:'username',l:'Имя пользователя',req:1,pat:'[A-Za-z0-9_.\\-]{3,32}',h:'3–32 символа: латиница, цифры, _ . -'},{k:'limit',l:'Лимит трафика, ГБ',t:'num',h:'0 — без лимита'},{k:'days',l:'Срок, дней',t:'num',h:'0 — бессрочно'},{k:'strategy',l:'Сброс трафика',t:'sel',o:STRAT},{k:'hwid',l:'Лимит устройств',t:'num'},{k:'tag',l:'Тег',ph:'например, vip'},{k:'squads',l:'Сквады',t:'multi',o:()=>DB.squads.map(s=>[s.id,s.name])},{k:'hold',l:'Отсчёт срока с первого подключения (on hold)',t:'bool'},{k:'desc',l:'Заметка'}];
const FE=[{k:'username',l:'Имя пользователя',req:1,pat:'[A-Za-z0-9_.\\-]{3,32}'},{k:'limit',l:'Лимит, ГБ',t:'num',h:'0 — без лимита'},{k:'expireAt',l:'Действует до',t:'date',h:'Пусто — бессрочно'},{k:'strategy',l:'Сброс трафика',t:'sel',o:STRAT},{k:'tag',l:'Тег'},{k:'tg',l:'Telegram ID'},{k:'email',l:'Email'},{k:'desc',l:'Заметка'}];

/* ================= ФОРМЫ ================= */
const opt=o=>(typeof o=='function'?o():o).map(x=>Array.isArray(x)?x:[x,x]);
function field(f,v){
  let i;const t=f.t||'text';
  if(t=='sel')i=`<select name="${f.k}">${opt(f.o).map(([a,b])=>`<option value="${esc(a)}"${a==v?' selected':''}>${esc(b)}</option>`).join('')}</select>`;
  else if(t=='multi')i=`<div class="ms">${opt(f.o).map(([a,b])=>`<label class="ck"><input type="checkbox" name="${f.k}" value="${esc(a)}"${(v||[]).map(String).includes(String(a))?' checked':''}><span>${esc(b)}</span></label>`).join('')||'<span class="mu">Нет вариантов</span>'}</div>`;
  else if(t=='area')i=`<textarea name="${f.k}" rows="${f.rows||8}" spellcheck="false">${esc(v)}</textarea>`;
  else if(t=='bool')i=`<span class="sw"><input type="checkbox" name="${f.k}"${v?' checked':''}><span></span></span>`;
  else i=`<input name="${f.k}" type="${t=='num'?'number':t=='date'?'date':'text'}"${t=='num'?' min="0" step="any"':''}${f.req?' required':''}${f.pat?` pattern="${f.pat}"`:''} value="${esc(t=='date'&&v?new Date(v).toLocaleDateString('sv'):v)}" placeholder="${esc(f.ph||'')}" autocomplete="off">`;
  const g=t=='multi'?'div':'label';return `<${g} class="f"><span>${f.l}</span>${i}${f.h?`<small>${f.h}</small>`:''}</${g}>`;
}
function read(fs,form){const d={};fs.forEach(f=>{const e=$$(`[name="${f.k}"]`,form);if(f.t=='multi')d[f.k]=e.filter(x=>x.checked).map(x=>isNaN(+x.value)?x.value:+x.value);else if(f.t=='bool')d[f.k]=e[0].checked;else if(f.t=='num')d[f.k]=+e[0].value||0;else if(f.t=='date')d[f.k]=e[0].value?new Date(e[0].value+'T23:59:59').getTime():null;else if(f.t=='sel')d[f.k]=isNaN(+e[0].value)?e[0].value:+e[0].value;else d[f.k]=e[0].value.trim()});return d}

/* ================= ОБОЛОЧКА ================= */
const dlg=$('#dlg');let CF;
const modal=(h,c='')=>{dlg.className=c;dlg.innerHTML=h;if(!dlg.open)dlg.showModal()};
dlg.addEventListener('click',e=>{if(e.target==dlg||e.target.closest('[data-x]'))dlg.close()});
const confirmBox=(h,ok,fn)=>{CF=fn;modal(`<div class="box"><h2>${h}</h2><div class="act"><button class="gh" data-x>Отмена</button><button class="btn" data-cf>${ok}</button></div></div>`)};
let tt;const toast=(m,al,fn)=>{const t=$('#toast');t.innerHTML=`<span>${esc(m)}</span>${al?`<button id="ta">${al}</button>`:''}`;if(al)$('#ta').onclick=()=>{fn();t.classList.remove('show')};t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),al?6000:2400)};
const CDEFAULT={theme:'dark',accent:'emerald',customA:'#60d6a2',customB:'#c3e879',hue:151,sat:62,lum:61,ts:1,motion:1,density:'comfortable',surface:'solid',glow:'normal',font:'onest',radius:16,borders:'soft',sidebar:'standard'};
let C={...CDEFAULT};try{Object.assign(C,JSON.parse(localStorage.xmeshNexusSettings||'{}'))}catch(e){}if(C.accent==='mint')C.accent='emerald';
const hslHex=(h,s,l)=>{s/=100;l/=100;const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>{const c=(k(n)+12)%12;return l-a*Math.max(-1,Math.min(c-3,9-c,1))};return '#'+[f(0),f(8),f(4)].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('')};
const apply=()=>{const r=document.documentElement;r.dataset.theme=C.theme=='auto'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):C.theme;r.dataset.accent=C.accent;r.style.setProperty('--custom-a',C.customA||hslHex(+C.hue||151,+C.sat||62,+C.lum||61));r.style.setProperty('--custom-b',C.customB||'#c3e879');if(C.accent==='custom'){const rgb=(C.customA||'#60d6a2').match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16)/255);const linear=rgb.map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));const lum=.2126*linear[0]+.7152*linear[1]+.0722*linear[2];r.style.setProperty('--btn-text',lum>.42?'#082b1d':'#ffffff')}else r.style.setProperty('--btn-text',r.dataset.theme==='light'?'#ffffff':'#082b1d');r.dataset.density=C.density||CDEFAULT.density;r.dataset.surface=C.surface||CDEFAULT.surface;r.dataset.glow=C.glow||CDEFAULT.glow;r.dataset.font=C.font||CDEFAULT.font;r.dataset.borders=C.borders||CDEFAULT.borders;r.dataset.sidebar=C.sidebar||CDEFAULT.sidebar;r.style.setProperty('--ts',cl(+C.ts||1,.9,1.3));const radius=cl(+C.radius||16,4,24);r.style.setProperty('--ui-radius',radius+'px');r.style.setProperty('--ui-control-radius',Math.max(5,radius*.72)+'px');r.dataset.motion=C.motion?'on':'off';try{localStorage.xmeshNexusSettings=JSON.stringify(C)}catch(e){}};
const brand=()=>{$('#bn').textContent=DB.set.brand;$('#lg').textContent=(DB.set.brand[0]||'L').toUpperCase()};

let T=[],cur='',RT=0;
const pages={home:['Дашборд',homeP],users:['Пользователи',usersP],squads:['Сквады',()=>simple(['squads'])],hosts:['Хосты',()=>simple(['hosts'])],nodes:['Узлы',nodesP],templates:['Шаблоны',()=>simple(['tpls','subs'])],profiles:['Профили Xray',profilesP],tools:['Диагностика',toolsP],admins:['Администраторы',()=>simple(['admins'])],set:['Настройки',setP]};
const skel=()=>`<div class="sk" style="height:7rem"></div><div class="sk" style="height:18rem"></div><div class="sk" style="height:12rem"></div>`;
$('#nav').innerHTML=NAV.map(([g,a])=>`<div class="g">${g}</div>`+a.map(([k,i,l,p])=>`<a href="#${k}" class="${p?'':'sec'}">${ic(i)}<span class="lbl">${l}</span>${k=='users'?'<em id="unb"></em>':''}</a>`).join('')).join('')+`<button class="more" id="more">${ic('more')}<span class="lbl">Ещё</span></button>`;
async function render(soft){
  T.forEach(clearInterval);T=[];cur=location.hash.slice(1);if(!pages[cur])cur='home';const rt=++RT,[t,f]=pages[cur],v=$('#view');
  $('#title').textContent=t;document.title=t+' — '+DB.set.brand;$$('#nav a').forEach(a=>a.classList.toggle('on',a.getAttribute('href')=='#'+cur));
  if(!soft){v.classList.remove('still');v.innerHTML=skel();scrollTo(0,0)}
  const [h,i]=await f();if(rt!=RT)return;v.classList.toggle('still',!!soft);v.innerHTML=h;i&&i();$('#unb').textContent=DB.users.length;drawBulk();
}

/* ================= ДАШБОРД ================= */
const LV={};DB.nodes.forEach(n=>LV[n.id]={cpu:null,ram:null,mbps:null});
let ST;
async function homeP(){
  const stats=ST=await api.stats();
  const totalItems=DB.nodes.length+DB.users.length+DB.profiles.length+DB.hosts.length+DB.squads.length+DB.tpls.length+DB.subs.length+DB.admins.length;
  const firstRun=totalItems===0;
  const counts=[['Узлы',DB.nodes.length],['Пользователи',DB.users.length],['Профили Xray',DB.profiles.length],['Хосты',DB.hosts.length]];
  const setup=[
    ['01','Профиль Xray','Добавьте свой конфиг Xray с нужными inbound.','Профиль','profiles'],
    ['02','Узел','Укажите адрес сервера и назначьте профиль.','Добавить узел','nodes'],
    ['03','Хост','Опишите адреса и параметры подключения, которые будут доступны клиентам.','Добавить хост','hosts'],
    ['04','Сквад','Объедините inbound в группы доступа.','Создать сквад','squads']
  ];
  const setupHtml=setup.map(([num,title,desc,btn,key])=>`<article class="setup-step"><span class="stepnum">ШАГ ${num}</span><h3>${title}</h3><p>${desc}</p><button class="gh sm" data-ne="${key}">${ic('plus')}${btn}</button></article>`).join('');
  const nodeRows=DB.nodes.length?DB.nodes.slice(0,6).map(n=>`<div class="rowi"><span class="fg" style="font-size:1.25rem">${esc(n.flag||'')}</span><div><b>${esc(n.name)}</b><br><small class="mu">${esc(n.addr)}${n.port?':'+esc(n.port):''}</small></div>${chip(NS[nstat(n)]?.[0]||'Не проверен',NS[nstat(n)]?.[1]||'--mu')}</div>`).join(''):'<div class="empty"><b>Узлов пока нет</b><span>Добавьте первый сервер, чтобы начать настройку.</span><button class="btn sm" data-ne="nodes">'+ic('plus')+'Добавить узел</button></div>';
  const userRows=DB.users.length?DB.users.slice(0,6).map(u=>`<div class="rowi"><button class="who" data-uo="${u.id}"><span class="av" style="background:linear-gradient(135deg,var(--b),var(--a))">${esc((u.username||'?')[0].toUpperCase())}</span><span>${esc(u.username)}</span></button>${chip(STM[st(u)]?.[0]||st(u),'--mu')}</div>`).join(''):'<div class="empty"><b>Пользователей пока нет</b><span>Создайте сквад перед добавлением первого пользователя.</span><button class="gh sm" data-ne="squads">'+ic('plus')+'Создать сквад</button></div>';
  return [`<section class="card"><div class="hd"><div><p class="note">ОБЗОР</p><h3 style="font-size:1.35rem;margin-top:.2rem">${firstRun?'Панель готова к настройке':'Обзор инфраструктуры'}</h3><p>${firstRun?'Добавьте свои серверы и конфигурации. Демонстрационных пользователей, узлов и фиктивной телеметрии здесь нет.':'Сводка по объектам, которые вы добавили в панель.'}</p></div><div class="setting-control"><a class="gh sm" href="#set" style="text-decoration:none;color:inherit">${ic('sliders')}Внешний вид</a></div></div><div class="home-counts">${counts.map(([label,value])=>`<div class="home-count"><b>${value}</b><span>${label}</span></div>`).join('')}</div></section>
  ${firstRun?`<section class="card"><div class="hd"><div><h3>Первый запуск</h3><p>Создайте свои объекты — примеры не подставляются автоматически.</p></div></div><div class="setup-grid">${setupHtml}</div></section>`:`<div class="two"><section class="card"><div class="hd"><div><h3>Узлы</h3><p>${DB.nodes.length} настроено</p></div><button class="gh sm" data-ne="nodes">${ic('plus')}Добавить</button></div>${nodeRows}</section><section class="card"><div class="hd"><div><h3>Пользователи</h3><p>${DB.users.length} создано</p></div><a class="gh sm" href="#users" style="text-decoration:none;color:inherit">Все</a></div>${userRows}</section></div>`}`,()=>{}];
}
/* ================= ПОЛЬЗОВАТЕЛИ ================= */
const UQ={q:'',st:'all',sq:'',page:1,size:15,sort:'created',dir:'desc',sel:new Set()};let UIDS=[];
async function usersP(){
  return [`<div class="card users-panel"><div class="bar2 users-statusbar"><div class="fl" id="uf"></div></div><div class="users-toolbar">
    <div class="users-search-wrap"><label class="search users-search-field" style="cursor:text">${ic('search')}<input id="uq" placeholder="Поиск пользователей" value="${esc(UQ.q)}" aria-label="Поиск по имени, тегу, email, ссылке или Telegram ID"></label><span class="users-search-hint">Поиск по имени · тегу · email · ссылке · Telegram ID</span></div>
    <select id="usq" aria-label="Сквад"><option value="">Все сквады</option>${DB.squads.map(s=>`<option value="${s.id}"${UQ.sq==s.id?' selected':''}>${esc(s.name)}</option>`).join('')}</select>
    <div class="users-toolbar-actions"><button class="gh" data-exp>${ic('dl')}Экспорт CSV</button><button class="btn" data-nu>${ic('plus')}Пользователь</button></div>
  </div><div id="ut"></div></div>`,()=>{drawUsers();let h;$('#uq').oninput=e=>{clearTimeout(h);h=setTimeout(()=>{UQ.q=e.target.value.trim().toLowerCase();UQ.page=1;drawUsers()},200)};$('#usq').onchange=e=>{UQ.sq=e.target.value;UQ.page=1;drawUsers()}}];
}
const uf=u=>(UQ.st=='all'||(UQ.st=='ONLINE'?isOn(u):st(u)==UQ.st))&&(!UQ.sq||u.squads.includes(+UQ.sq))&&(!UQ.q||[u.username,u.tag,u.email,u.desc,u.tg,u.short].join(' ').toLowerCase().includes(UQ.q));
async function drawUsers(){
  const [r,s]=await Promise.all([api.list('users',{f:uf,sort:UQ.sort,dir:UQ.dir,page:UQ.page,size:UQ.size}),api.stats()]);if(!$('#ut'))return;
  const pages=Math.max(1,Math.ceil(r.total/UQ.size));if(UQ.page>pages){UQ.page=pages;return drawUsers()}UIDS=r.ids;
  $('#uf').innerHTML=[['all','Все',s.total],['ONLINE','Онлайн',s.online],['ACTIVE','Активные',s.by.ACTIVE||0],['ON_HOLD','Ожидают',s.by.ON_HOLD||0],['LIMITED','Лимит',s.by.LIMITED||0],['EXPIRED','Истёк',s.by.EXPIRED||0],['DISABLED','Отключены',s.by.DISABLED||0]].map(([k,l,n])=>`<button data-uf="${k}" class="${UQ.st==k?'on':''}">${l}<b>${n}</b></button>`).join('');
  const th=(k,l)=>`<th><button data-s="${k}">${l}${UQ.sort==k?(UQ.dir=='asc'?' ↑':' ↓'):''}</button></th>`;
  const all=r.items.length&&r.items.every(u=>UQ.sel.has(u.id));
  $('#ut').innerHTML=r.total?`<div class="tw"><table class="tb"><thead><tr><th class="c1"><input type="checkbox" data-sela ${all?'checked':''} aria-label="Выбрать все на странице"></th>${th('username','Пользователь')}${th('status','Статус')}${th('used','Трафик')}${th('expireAt','Срок')}<th>Доступ</th>${th('onlineAt','Был в сети')}</tr></thead><tbody>${r.items.map(u=>{const [sl,sc]=STM[st(u)],k=u.limit?u.used/u.limit:0,h=hs(u.username)%360,on=isOn(u);return `<tr data-id="${u.id}" class="${UQ.sel.has(u.id)?'sel':''}"><td class="c1"><input type="checkbox" data-sel="${u.id}" ${UQ.sel.has(u.id)?'checked':''} aria-label="Выбрать ${esc(u.username)}"></td><td data-l=""><div class="who"><span class="av" style="background:linear-gradient(135deg,hsl(${h} 55% 70%),hsl(${(h+45)%360} 55% 64%))">${esc(u.username[0].toUpperCase())}</span><div>${esc(u.username)} ${u.tag?chip(esc(u.tag),'--c3'):''}${u.desc?`<small class="mu">${esc(u.desc)}</small>`:''}</div></div></td><td data-l="Статус">${chip(sl,sc)}</td><td data-l="Трафик"><div class="tr">${u.limit?`<div class="pb${k>=1?' er':k>.85?' wr':''}" style="--w:${Math.min(100,k*100)}%"><i></i></div>`:''}<small>${gb(u.used)} / ${u.limit?u.limit+' ГБ':'∞'}</small></div></td><td data-l="Срок"${u.expireAt&&u.expireAt<Date.now()+3*DAY?' class="er"':''}>${u.hold?u.holdDays+' дн после подключения':left(u.expireAt)}</td><td data-l="Доступ">${u.squads.map(i=>chip(esc(DB.squads.find(x=>x.id==i)?.name||'?'),'--b')).join(' ')}</td><td data-l="Был в сети">${on?'<span class="dot"></span> онлайн':ago(u.onlineAt)}</td></tr>`}).join('')}</tbody></table></div><div class="pg"><span>${(UQ.page-1)*UQ.size+1}–${Math.min(r.total,UQ.page*UQ.size)} из ${r.total}</span><select data-psz aria-label="Строк на странице">${[15,30,60].map(n=>`<option${n==UQ.size?' selected':''}>${n}</option>`).join('')}</select><button class="ia" data-pg="-1" ${UQ.page>1?'':'disabled'} aria-label="Назад">${ic('up').replace('<svg','<svg style="transform:rotate(-90deg)"')}</button><button class="ia" data-pg="1" ${UQ.page<pages?'':'disabled'} aria-label="Вперёд">${ic('up').replace('<svg','<svg style="transform:rotate(90deg)"')}</button></div>`:`<div class="empty"><b>Никого не найдено</b><span>Измените поиск или фильтр, либо создайте пользователя.</span><button class="btn sm" data-nu>${ic('plus')}Создать</button></div>`;
  drawBulk();
}
function drawBulk(){const b=$('#bulk'),n=UQ.sel.size;b.classList.toggle('on',n>0&&cur=='users');if(!n)return;b.innerHTML=`<b style="padding:0 .5rem">Выбрано ${n}</b>${UIDS.length>n?`<button class="gh sm" data-bk="all">Выбрать все ${UIDS.length}</button>`:''}<button class="gh sm" data-bk="on">Включить</button><button class="gh sm" data-bk="off">Отключить</button><button class="gh sm" data-bk="reset">Сбросить трафик</button><button class="gh sm" data-bk="ext">+30 дней</button><button class="gh sm" data-bk="sq">В сквад</button><button class="dg sm" data-bk="del">${ic('trash')}Удалить</button><button class="ia" data-bk="clr" aria-label="Снять выбор">${ic('x')}</button>`}
const uid=s=>{let h=hs(s),x='';for(let i=0;i<32;i++){h=(h*1664525+1013904223)>>>0;x+=(h>>>24&15).toString(16)}return x.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5')};
let UT='ov';const subUrl=u=>'';
function userDrawer(id,tab){
  const u=DB.users.find(x=>x.id==id);if(!u)return dlg.close();UT=tab||(dlg.open&&dlg.classList.contains('user-modal')?UT:'ov');
  const [sl,sc]=STM[st(u)],k=u.limit?u.used/u.limit:0,h=hs(u.username)%360;
  const tabs=[['ov','Обзор'],['acc','Доступ'],['sub','Подписка'],['dev','Устройства '+u.devices.length+'/'+u.hwid]];
  const body={
    ov:`<div class="bar2"><span class="mu">Использовано</span><b style="margin-left:auto">${gb(u.used)} / ${u.limit?u.limit+' ГБ':'∞'}</b></div>${u.limit?`<div class="pb f${k>=1?' er':k>.85?' wr':''}" style="--w:${Math.min(100,k*100)}%"><i></i></div>`:''}<div class="history-placeholder">История расхода за период будет отображаться после подключения сбора статистики. Текущие значения не заменяются расчётной симуляцией.</div>
    <form data-k="uedit" data-id="${u.id}" method="dialog" class="sg" style="gap:.9rem"><div class="r2" style="display:grid;border:0;padding:0">${FE.slice(0,4).map(f=>field(f,f.k=='expireAt'?u.expireAt:u[f.k])).join('')}</div><div class="r2" style="display:grid;border:0;padding:0">${FE.slice(4).map(f=>field(f,u[f.k])).join('')}</div><p class="er" id="fe" style="border:0;padding:0"></p><div style="border:0;padding:0"><button class="btn" style="width:100%">Сохранить</button></div></form>
    <div class="mu">Создан ${new Date(u.created).toLocaleDateString('ru-RU')} · Админ: ${esc(DB.admins.find(a=>a.id==u.adminId)?.username||'—')}</div>`,
    acc:`<p class="note">Отметьте сквады: доступ меняется сразу.</p><div class="ms">${DB.squads.map(s=>`<label class="ck"><input type="checkbox" data-usq="${u.id}:${s.id}" ${u.squads.includes(s.id)?'checked':''}><span>${esc(s.name)}</span></label>`).join('')}</div><div><span class="mu">Итоговые инбаунды</span><div style="margin-top:.5rem">${uin(u).map(t=>chip(esc(t),tcol(t))).join(' ')||'<span class="mu">Нет доступа</span>'}</div></div><div><span class="mu">Хосты в подписке</span><div style="margin-top:.5rem">${DB.hosts.filter(x=>!x.disabled&&uin(u).includes(x.tag)).map(x=>`<div class="rowi">${esc(x.remark)}<small class="mu" style="margin-left:auto">${esc(x.address)}:${x.port}</small></div>`).join('')||'<span class="mu">Нет подходящих хостов</span>'}</div></div><label class="f"><span>Лимит устройств</span><input type="number" min="0" value="${u.hwid}" data-hw="${u.id}"></label>`,
    sub:`<div class="history-placeholder"><b style="display:block;color:var(--tx);margin-bottom:.35rem">Подписка ещё не подключена</b>В этой HTML-версии не настроен API, который выпускает рабочие ссылки подписки и QR-коды. Поэтому здесь не показывается фиктивная ссылка.</div><a class="gh" href="#set" style="text-decoration:none;color:inherit;justify-self:start">${ic('sliders')}Настроить домен</a>`,
    dev:u.devices.length?u.devices.map(d=>`<div class="rowi"><div><b>${esc(d.model)}</b> ${chip(d.plat,'--c3')}<br><small class="mu">${esc(d.app)} · был ${ago(d.last)}</small></div><button class="ia" data-dd="${u.id}:${d.id}" aria-label="Удалить устройство">${ic('trash')}</button></div>`).join('')+(u.devices.length>u.hwid?`<p class="er">Устройств больше лимита (${u.hwid}).</p>`:''):'<div class="empty">Устройства ещё не подключались</div>'}[UT];
  modal(`<div class="box"><div class="bar2"><div class="who"><span class="av" style="background:hsl(${h} 55% 68%)">${esc(u.username[0].toUpperCase())}</span><div><h2>${esc(u.username)}</h2>${chip(sl,sc)} ${isOn(u)?'<span class="dot"></span>':''}</div></div><button class="ia" data-x style="margin-left:auto" aria-label="Закрыть">${ic('x')}</button></div>
  <div class="acts"><button class="gh sm" data-a="tog" data-u="${u.id}">${u.disabled?'Включить':'Отключить'}</button><button class="gh sm" data-a="rst" data-u="${u.id}">Сбросить трафик</button><button class="gh sm" data-a="ext" data-u="${u.id}">+30 дней</button><button class="dg sm" data-a="del" data-u="${u.id}">${ic('trash')}Удалить</button></div>
  <div class="seg" id="dt">${tabs.map(([k,l])=>`<button data-dt="${k}" class="${UT==k?'on':''}">${l}</button>`).join('')}</div>${body}</div>`,'user-modal');
}
function userNew(){
  if(!DB.squads.length){modal(`<div class="box"><h2>Сначала создайте сквад</h2><p class="note">Пользователю нужно назначить группу доступа. Создайте сквад, а затем вернитесь к созданию пользователя.</p><div class="act"><button class="gh" data-x>Отмена</button><button class="btn" data-ne="squads">${ic('plus')}Создать сквад</button></div></div>`);return}
  const fs=FU;modal(`<form class="box" data-k="user" method="dialog"><h2>Новый пользователь</h2><label class="f"><span>Шаблон</span><select id="tplsel"><option value="">Без шаблона</option>${DB.tpls.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><small>При необходимости подставит параметры из сохранённого шаблона</small></label>${fs.map(f=>field(f,{limit:0,days:0,strategy:'NO_RESET',hwid:0,squads:[]}[f.k])).join('')}<p class="er" id="fe"></p><div class="act"><button type="button" class="gh" data-x>Отмена</button><button class="btn">Создать</button></div></form>`,'wide');
  setTimeout(()=>$('[name=username]')?.focus(),60);
}
function exportCsv(){const rows=[['username','status','used_gb','limit_gb','expire','tag','telegram','email','squads','sub_url']].concat(UIDS.map(id=>DB.users.find(u=>u.id==id)).map(u=>[u.username,st(u),u.used,u.limit,u.expireAt?new Date(u.expireAt).toISOString().slice(0,10):'',u.tag,u.tg,u.email,u.squads.map(i=>DB.squads.find(s=>s.id==i)?.name).join('|'),subUrl(u)]));
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')],{type:'text/csv'}));a.download='users.csv';a.click();toast(`Экспортировано: ${UIDS.length}`)}

/* ================= БЫСТРЫЙ КОНСТРУКТОР ПРОФИЛЯ XRAY ================= */
function xrayBuilderConfig(){
  const protocol=$('#xpb-protocol').value,network=$('#xpb-network').value,security=$('#xpb-security').value;
  const tag=$('#xpb-tag').value.trim()||'inbound-1',port=cl(+$('#xpb-port').value||443,1,65535);
  const sni=$('#xpb-sni').value.trim()||'example.com',dest=$('#xpb-dest').value.trim()||sni+':443',path=$('#xpb-path').value.trim()||'/';
  const settings=protocol==='vless'?{clients:[],decryption:''}:protocol==='trojan'?{clients:[]}:{clients:[],network:'tcp,udp',method:'chacha20-ietf-poly1305'};
  const inbound={tag,listen:'0.0.0.0',port,protocol,settings,streamSettings:{network,security}};
  if(network==='ws')inbound.streamSettings.wsSettings={path};
  if(network==='xhttp')inbound.streamSettings.xhttpSettings={path};
  if(network==='grpc')inbound.streamSettings.grpcSettings={serviceName:path.replace(/^\//,'')||'grpc'};
  if(security==='tls')inbound.streamSettings.tlsSettings={serverName:sni,alpn:['h2','http/1.1'],certificates:[{certificateFile:'/etc/ssl/xray/fullchain.pem',keyFile:'/etc/ssl/xray/privkey.pem'}]};
  if(security==='reality')inbound.streamSettings.realitySettings={show:false,dest,xver:0,serverNames:[sni],privateKey:'REPLACE_WITH_XRAY_PRIVATE_KEY',shortIds:['0123456789abcdef']};
  return {log:{loglevel:'warning'},inbounds:[inbound],outbounds:[{protocol:'freedom',tag:'direct'},{protocol:'blackhole',tag:'blocked'}],routing:{rules:[{type:'field',outboundTag:'direct',inboundTag:[tag]}]}};
}
async function profilesP(){
  const saved=await crudCard('profiles');
  const builderHtml=`<section class="card xray-builder"><div class="hd"><div><h3>Быстрый конструктор Xray</h3><p>Соберите стартовый профиль без ручного набора JSON. Перед запуском замените шаблонные ключи и сертификаты.</p></div><span class="chip" style="--c:var(--a)">JSON builder</span></div>
  <div class="xray-builder-grid">
    <label class="f"><span>Название профиля</span><input id="xpb-name" value="Новый Xray профиль" maxlength="80"></label>
    <label class="f"><span>Тег inbound</span><input id="xpb-tag" value="inbound-1" maxlength="64"></label>
    <label class="f"><span>Порт</span><input id="xpb-port" type="number" min="1" max="65535" value="443"></label>
    <label class="f"><span>Протокол</span><select id="xpb-protocol"><option value="vless">VLESS</option><option value="trojan">Trojan</option><option value="shadowsocks">Shadowsocks</option></select></label>
    <label class="f"><span>Транспорт</span><select id="xpb-network"><option value="tcp">TCP</option><option value="xhttp">XHTTP</option><option value="ws">WebSocket</option><option value="grpc">gRPC</option></select></label>
    <label class="f"><span>Защита транспорта</span><select id="xpb-security"><option value="reality">Reality</option><option value="tls">TLS</option><option value="none">Без TLS/Reality</option></select></label>
    <label class="f"><span>SNI / Server name</span><input id="xpb-sni" value="example.com"></label>
    <label class="f"><span>Reality destination</span><input id="xpb-dest" value="example.com:443"></label>
    <label class="f"><span>Path / gRPC service</span><input id="xpb-path" value="/" placeholder="/path"></label>
  </div>
  <p class="note">Клиенты намеренно пустые. Reality private key и TLS-сертификаты — шаблонные значения: настройте их под свой сервер. Конструктор создаёт конфигурацию, но сам не меняет запущенный Xray.</p>
  <label class="f"><span>Предпросмотр JSON</span><textarea id="xpb-preview" class="xray-preview" spellcheck="false" readonly></textarea></label>
  <div class="act"><button type="button" class="gh" id="xpb-download">Скачать JSON</button><button type="button" class="gh" id="xpb-copy">Копировать JSON</button><button type="button" class="btn" id="xpb-save">Сохранить профиль</button></div><p class="er" id="xpb-error" role="status"></p></section>`;
  return [builderHtml+saved,()=>{
    const updatePreview=()=>{try{$('#xpb-preview').value=JSON.stringify(xrayBuilderConfig(),null,2);$('#xpb-error').textContent=''}catch(e){$('#xpb-error').textContent=e.message}};
    ['xpb-tag','xpb-port','xpb-protocol','xpb-network','xpb-security','xpb-sni','xpb-dest','xpb-path'].forEach(id=>$('#'+id).addEventListener('input',updatePreview));
    updatePreview();
    $('#xpb-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#xpb-preview').value);toast('JSON скопирован')}catch(e){$('#xpb-preview').select();document.execCommand('copy');toast('JSON скопирован')}};
    $('#xpb-download').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([$('#xpb-preview').value],{type:'application/json'}));a.download=(($('#xpb-name').value||'xray-profile').trim().replace(/[^a-z0-9_-]+/gi,'-')||'xray-profile')+'.json';a.click();URL.revokeObjectURL(a.href)};
    $('#xpb-save').onclick=async()=>{const name=$('#xpb-name').value.trim();if(!name){$('#xpb-error').textContent='Укажите название профиля.';return}try{const config=$('#xpb-preview').value,data=JSON.parse(config),tags=data.inbounds.map(i=>i.tag);if(!data.inbounds.length||tags.some(t=>!t))throw new Error('У inbound должен быть тег.');if(new Set(tags).size!==tags.length)throw new Error('Теги inbound должны быть уникальными.');if(DB.profiles.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw new Error('Профиль с таким названием уже существует.');const used=DB.profiles.flatMap(inbs).map(i=>i.tag);if(tags.some(t=>used.includes(t)))throw new Error('Такой тег уже используется в другом профиле.');await api.create('profiles',{name,config});toast('Профиль Xray сохранён');await render(1)}catch(e){$('#xpb-error').textContent=e.message||'Не удалось сохранить профиль.'}};
  }];
}

/* ================= CRUD-страницы ================= */
async function crudCard(k){
  const e=ENT[k],{items}=await api.list(k,{sort:e.s});
  const emptyLabel={nodes:'Узлов пока нет',profiles:'Профилей Xray пока нет',squads:'Сквадов пока нет',hosts:'Хостов пока нет',tpls:'Шаблонов пока нет',subs:'Шаблонов подписки пока нет',admins:'Администраторов пока нет',tokens:'API-токенов пока нет'}[k]||'Пока пусто';
  const emptyHint={nodes:'Добавьте первый сервер и назначьте ему профиль.',profiles:'Добавьте собственную конфигурацию Xray с inbound.',squads:'Создайте группу доступа на основе inbound.',hosts:'Добавьте адреса подключения, которые должны видеть клиенты.',tpls:'Сохраните тарифные параметры для повторного использования.',subs:'Настройте формат выдачи подписки после подключения API.',admins:'Список заполнится после добавления администраторов.',tokens:'Создайте токен для внешней интеграции.'}[k]||'Добавьте первую запись.';
  return `<div class="card"><div class="hd"><div><h3>${e.t}</h3><p>${e.n||''}</p></div><button class="btn sm" data-ne="${k}">${ic('plus')}${e.nw}</button></div>${items.length?`<div class="tw"><table class="tb"><thead><tr>${e.cols.map(c=>`<th>${c[0]}</th>`).join('')}${e.mv?'<th></th>':''}</tr></thead><tbody>${items.map((r,i)=>`<tr data-e="${k}:${r.id}">${e.cols.map(c=>`<td data-l="${c[0]}">${c[1](r)}</td>`).join('')}${e.mv?`<td data-l="Порядок"><button class="ia" data-mv="${k}:${r.id}:-1" ${i?'':'disabled'} aria-label="Выше">${ic('up')}</button><button class="ia" data-mv="${k}:${r.id}:1" ${i<items.length-1?'':'disabled'} aria-label="Ниже">${ic('down')}</button></td>`:''}</tr>`).join('')}</tbody></table></div>`:`<div class="empty"><b>${emptyLabel}</b><span>${emptyHint}</span><button class="gh sm" data-ne="${k}">${ic('plus')}${e.nw}</button></div>`}</div>`
}
async function simple(ks){const h=await Promise.all(ks.map(crudCard));return [h.join('')]}
function entForm(k,id){const e=ENT[k],o=id?DB[k].find(x=>x.id==id):e.def?e.def():{};
  modal(`<form class="box" data-k="ent" data-ent="${k}" data-id="${id||''}" method="dialog"><h2>${id?'Изменить':'Новый'}: ${e.nw.toLowerCase()}</h2>${e.fs.map(f=>field(f,o[f.k])).join('')}<p class="er" id="fe"></p><div class="act">${id?`<button type="button" class="dg" data-del="${k}:${id}" style="margin-right:auto">${ic('trash')}Удалить</button>`:''}<button type="button" class="gh" data-x>Отмена</button><button class="btn">Сохранить</button></div></form>`,k=='profiles'||k=='subs'?'wide':'')}

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
    return `<div class="card nc${n.disabled?' off':''}"><div class="h"><span class="fg">${esc(n.flag||'')}</span><div><b>${esc(n.name)}</b><br><small class="mu">${esc(n.addr)}${n.port?':'+esc(n.port):''}</small></div>${chip(NS[ss]?.[0]||'Не проверен',NS[ss]?.[1]||'--mu')}</div>
      <div class="kvg"><div><span>Активные пользователи</span><b>${s.nodeOn[n.id]??0}</b></div><div><span>Профиль Xray</span>${esc(p?.name||'—')}</div></div>
      <div class="node-gauges">
        ${nodeGauge(n,'cpu-'+n.id,'CPU',Number.isFinite(l.cpu)?l.cpu:0,Number.isFinite(l.cpu)?Math.round(l.cpu)+'%':'—',Number.isFinite(l.cpu)?'загрузка':'нет данных','--a')}
        ${nodeGauge(n,'ram-'+n.id,'RAM',Number.isFinite(l.ram)?l.ram:0,Number.isFinite(l.ram)?Math.round(l.ram)+'%':'—',Number.isFinite(l.ram)?'занято':'нет данных','--b')}
        ${nodeGauge(n,'traffic-'+n.id,'Трафик',n.limit?k*100:0,n.limit?Math.round(k*100)+'%':'∞',n.limit?`${gb(n.used)} / ${gb(n.limit)}`:`${gb(n.used)} · без лимита`,tc)}
      </div>
      <div class="mb node-speed"><div><span>Текущая скорость</span><b id="nm${n.id}">${Number.isFinite(l.mbps)?fmt(l.mbps)+' Мбит/с':'—'}</b></div><div class="pb f" style="--w:${Number.isFinite(l.mbps)?cl(l.mbps/240*100,0,100):0}%" id="npm${n.id}"><i></i></div></div>
      <div class="acts"><button class="gh sm" data-nr="${n.id}">${ic('redo')}Перезапуск</button><button class="gh sm" data-nt="${n.id}">${n.disabled?'Включить':'Отключить'}</button><button class="gh sm" data-ne="nodes:${n.id}">${ic('pen')}Изменить</button></div></div>`;
  }).join('');
  const empty=`<div class="card empty"><b>Узлов пока нет</b><span>Список начнёт заполняться после добавления ваших серверов.</span><button class="btn sm" data-ne="nodes">${ic('plus')}Добавить узел</button></div>`;
  const gridMode=getNodeGridMode();
  return [`<div class="bar2"><p class="note">${s.nAll} узлов настроено. CPU, RAM и скорость требуют подключённого мониторинга.</p><div class="node-grid-controls"><span class="note">Сетка</span><div class="seg" role="group" aria-label="Плотность сетки"><button type="button" data-node-grid-mode="compact" aria-pressed="${gridMode==='compact'?'true':'false'}" class="${gridMode==='compact'?'on':''}">Плотно</button><button type="button" data-node-grid-mode="standard" aria-pressed="${gridMode==='standard'?'true':'false'}" class="${gridMode==='standard'?'on':''}">Стандарт</button><button type="button" data-node-grid-mode="spacious" aria-pressed="${gridMode==='spacious'?'true':'false'}" class="${gridMode==='spacious'?'on':''}">Крупно</button></div></div><button class="btn" data-ne="nodes">${ic('plus')}Узел</button></div>${r.items.length?`<div class="nodes" data-grid-mode="${gridMode}">${cards}</div>`:empty}`,drawNodeLive]
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

/* ================= НАСТРОЙКИ ================= */
async function setP(){
  const sw=[
    ['emerald','#60d6a2','#c3e879','Изумруд'],['ocean','#7fb3e8','#6fd8c3','Океан'],['amber','#ebbd7a','#f0899a','Янтарь'],['rose','#f0a0c4','#a0a2f6','Роза'],
    ['violet','#b7a1ff','#83d9ed','Фиолетовый'],['cyan','#63dff2','#7fa8ff','Циан'],['ruby','#ff8aa7','#d4a1ff','Рубин'],['custom',C.customA||'#60d6a2',C.customB||'#c3e879','Своя тема']
  ];
  const choices=(key,items)=>`<div class="seg choice" role="group" aria-label="${key}">${items.map(([v,l])=>`<button type="button" data-ui="${key}" data-value="${v}" class="${(C[key]||CDEFAULT[key])==v?'on':''}">${l}</button>`).join('')}</div>`;
  const tk=await crudCard('tokens');
  let coreView={desired_version:'latest',installed_version:null,latest_version:null,status:'unknown',progress:null,last_error:null,architecture:'unknown'};
  try{coreView=await backendRequest('/api/v1/core')}catch(e){coreView.last_error=e.message}
  const coreLabel=coreView.status=='updating'?'Обновляется':coreView.status=='ready'?'Установлено':coreView.status=='error'?'Ошибка':'Не установлено';
  return [`<div class="appearance-grid">
    <section class="card sg"><div><h3>Цвет и тема</h3><small>Основная палитра интерфейса и брендовые акценты</small></div>
      <div class="setting-row"><div class="setting-copy"><b>Тема</b><small>Автоматически — по настройкам ОС</small></div><div class="setting-control"><div class="seg choice" id="th">${[['dark','Тёмная'],['light','Светлая'],['auto','Авто']].map(([k,l])=>`<button type="button" data-th="${k}" class="${C.theme==k?'on':''}">${l}</button>`).join('')}</div></div></div>
      <div class="setting-row"><div class="setting-copy"><b>Акцентный цвет</b><small>Влияет на кнопки, графики и активные элементы</small></div><div class="setting-control" style="gap:.85rem;max-width:18rem">${sw.map(([k,x,y,l])=>`<button class="palette-swatch ${C.accent==k?'on':''}" style="--x:${x};--y:${y}" data-ac="${k}" title="${l}" aria-label="${l}"></button>`).join('')}</div></div>
      <div class="setting-row"><div class="setting-copy"><b>Своя палитра</b><small>Цветовые «бублики» открывают выбор цвета; ползунки позволяют точно настроить оттенок, насыщенность и яркость.</small></div><div class="setting-control"><div class="color-bubbles"><label class="color-bubble-wrap"><span class="color-bubble"><input type="color" id="custom-a" value="${C.customA||'#60d6a2'}" aria-label="Основной цвет"></span>Основной</label><label class="color-bubble-wrap"><span class="color-bubble"><input type="color" id="custom-b" value="${C.customB||'#c3e879'}" aria-label="Вторичный цвет"></span>Вторичный</label></div></div></div>
      <div class="color-slider-grid"><label for="hue">Оттенок</label><input type="range" id="hue" min="0" max="360" value="${C.hue??151}"><output id="huev">${C.hue??151}°</output></div><div class="color-slider-grid"><label for="sat">Насыщенность</label><input type="range" id="sat" min="0" max="100" value="${C.sat??62}"><output id="satv">${C.sat??62}%</output></div><div class="color-slider-grid"><label for="lum">Яркость</label><input type="range" id="lum" min="15" max="85" value="${C.lum??61}"><output id="lumv">${C.lum??61}%</output></div>
      <div class="setting-row"><div class="setting-copy"><b>Размер текста</b><small>Можно увеличить интерфейс для большого монитора или уменьшить плотность текста</small></div><div class="setting-control slider-control"><input type="range" id="ts" min="0.9" max="1.3" step="0.05" value="${C.ts}" aria-label="Размер текста"><b id="tsv">${Math.round(C.ts*100)}%</b></div></div>
      <div class="setting-row"><div class="setting-copy"><b>Шрифт</b><small>Выберите нейтральный системный или моноширинный стиль</small></div><div class="setting-control">${choices('font',[['onest','Manrope'],['system','Системный'],['mono','Моно']])}</div></div>
    </section>
    <section class="card sg"><div><h3>Композиция</h3><small>Плотность, радиусы и вид карточек</small></div>
      <div class="setting-row"><div class="setting-copy"><b>Плотность</b><small>От компактной таблицы до просторных карточек</small></div><div class="setting-control">${choices('density',[['compact','Компактно'],['comfortable','Стандарт'],['spacious','Свободно']])}</div></div>
      <div class="setting-row"><div class="setting-copy"><b>Стиль карточек</b><small>Выберите плоский, стеклянный или объёмный вид</small></div><div class="setting-control">${choices('surface',[['flat','Плоский'],['solid','Классика'],['glass','Glass'],['raised','Объём']])}</div></div>
      <div class="setting-row"><div class="setting-copy"><b>Скругление</b><small>От почти прямых углов до мягких округлых форм</small></div><div class="setting-control slider-control"><input type="range" id="radius" min="4" max="24" step="2" value="${cl(+C.radius||16,4,24)}" aria-label="Скругление углов"><b id="rv">${cl(+C.radius||16,4,24)} px</b></div></div>
      <div class="setting-row"><div class="setting-copy"><b>Границы карточек</b><small>Можно убрать линии или сделать их заметнее</small></div><div class="setting-control">${choices('borders',[['off','Без линий'],['soft','Мягкие'],['strong','Яркие']])}</div></div>
      <div class="setting-row"><div class="setting-copy"><b>Боковая панель</b><small>Компактный режим оставляет в основном только иконки</small></div><div class="setting-control">${choices('sidebar',[['standard','Обычная'],['compact','Компактная']])}</div></div>
    </section>
    <section class="card sg"><div><h3>Эффекты и движение</h3><small>Настройка фона и анимаций без изменения данных</small></div>
      <div class="setting-row"><div class="setting-copy"><b>Подсветка фона</b><small>Мягкое цветное свечение за панелью</small></div><div class="setting-control">${choices('glow',[['off','Выкл.'],['subtle','Мягкая'],['normal','Средняя'],['rich','Яркая']])}</div></div>
      <div class="setting-row"><div class="setting-copy"><b>Анимации</b><small>Отключите движение и переходы, если они отвлекают</small></div><label class="sw"><input type="checkbox" id="mo" ${C.motion?'checked':''} aria-label="Анимации"><span></span></label></div>
      <div class="setting-row"><div class="setting-copy"><b>Сохранение</b><small>Параметры оформления сохраняются в localStorage этого браузера</small></div><button class="gh sm" id="rs">Сбросить оформление</button></div>
    </section>
  </div>
  <div class="card"><div class="hd"><div><h3>Бренд и домен</h3><p>Имя в меню и домен в ссылках подписки</p></div></div><form data-k="brand" method="dialog" class="sg" style="gap:1rem"><div class="r2" style="display:grid;border:0;padding:0">${field({k:'brand',l:'Название панели',req:1},DB.set.brand)}${field({k:'domain',l:'Домен панели',req:1,ph:'panel.example.com'},DB.set.domain)}</div><div style="border:0;padding:0"><button class="btn">Сохранить</button></div></form></div>
  <div class="card"><div class="hd"><div><h3>Вебхуки</h3><p>События, о которых панель сообщает во внешние сервисы</p></div></div>${Object.entries(DB.set.hooks).map(([k,v])=>`<div class="rowi"><div>${k}</div><label class="sw"><input type="checkbox" data-hk="${k}" ${v?'checked':''} aria-label="${k}"><span></span></label></div>`).join('')}</div>${tk}
  <div class="card" id="core-panel"><div class="hd"><div><h3>Xray-core</h3><p>Установка и обновление бинарника ядра на сервере панели</p></div><span class="chip" id="core-state">${esc(coreLabel)}</span></div>
    <div class="setting-row"><div class="setting-copy"><b>Установленная версия</b><small id="core-installed">${coreView.installed_version?esc(coreView.installed_version):'Ещё не установлена'}</small></div><div class="setting-copy"><b>Архитектура</b><small id="core-architecture">${esc(coreView.architecture||'—')}</small></div></div>
    <div class="sg" style="gap:.6rem"><label class="f"><span>Версия для установки</span><input id="core-target" value="${esc(coreView.desired_version||'latest')}" placeholder="latest или v26.10.10" autocomplete="off"><small>Значение latest выбирает самый свежий опубликованный релиз GitHub. По умолчанию используется latest.</small></label></div>
    <div class="act"><button class="gh" type="button" data-core-refresh>Проверить статус</button><button class="btn" type="button" data-core-update>Установить / обновить</button></div>
    <div class="history-placeholder" id="core-message">${esc(coreView.last_error||coreView.progress||'Обновление ядра выполняется отдельно от запуска VPN-трафика.')}</div>
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
const delUsers=async ids=>{const gone=DB.users.filter(u=>ids.has(u.id));for(const id of ids)await api.remove('users',id);ids.forEach(i=>UQ.sel.delete(i));toast(`Удалено: ${gone.length}`,'Отменить',async()=>{try{if(backendReady){for(const user of gone)await api.create('users',user)}else{DB.users.push(...gone);save()}render(1);toast('Пользователи восстановлены')}catch(error){toast('Не удалось восстановить: '+error.message)}});dlg.close();render(1)};
document.addEventListener('click',async e=>{
  const g=s=>e.target.closest(s);let b;
  if(g('.sw')||g('[data-sel]')&&0)return;
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
    else{await api.bulk('users',ids,u=>{if(a=='on')u.disabled=false;if(a=='off')u.disabled=true;if(a=='reset')u.used=0;if(a=='ext')u.expireAt=Math.max(now,u.expireAt||now)+30*DAY});toast({on:'Включены',off:'Отключены',reset:'Трафик сброшен',ext:'Продлено на 30 дней'}[a]+`: ${n}`);render(1)}}
  else if(b=g('[data-dt]')){userDrawer(+$('[data-a]').dataset.u,b.dataset.dt)}
  else if(b=g('tr[data-id]'))userDrawer(+b.dataset.id,'ov');
  else if(b=g('[data-uo]'))userDrawer(+b.dataset.uo,'dev');
  else if(g('[data-copy]'))copyT($('#lk').value);
  else if(b=g('[data-a]')){const id=+b.dataset.u,u=DB.users.find(x=>x.id==id),a=b.dataset.a;if(!u)return;
    if(a=='del'){if(!b.dataset.s){b.dataset.s=1;b.textContent='Нажмите ещё раз';return}return delUsers(new Set([id]))}
    const p=a=='tog'?{disabled:!u.disabled}:a=='rst'?{used:0}:a=='ext'?{expireAt:Math.max(Date.now(),u.expireAt||Date.now())+30*DAY}:{short:Math.floor(Math.random()*2**40).toString(36).padStart(8,'a'),devices:[]};
    await api.update('users',id,p);toast({tog:'Статус изменён',rst:'Трафик сброшен',ext:'Продлено на 30 дней',rev:'Ссылка перевыпущена'}[a]);render(1);userDrawer(id,a=='rev'?'sub':UT)}
  else if(b=g('[data-dd]')){const [ui,di]=b.dataset.dd.split(':').map(Number),u=DB.users.find(x=>x.id==ui);await api.update('users',ui,{devices:u.devices.filter(d=>d.id!=di)});toast('Устройство удалено');if(cur=='tools')drawTools();else userDrawer(ui,'dev')}
  else if(b=g('[data-qx]')){const u=DB.users.find(x=>x.id==b.dataset.qx);await api.update('users',u.id,{expireAt:Math.max(Date.now(),u.expireAt||Date.now())+30*DAY});toast(`${u.username}: продлено на 30 дней`);render(1)}
  else if(b=g('[data-qr]')){await api.update('users',+b.dataset.qr,{used:0});toast('Трафик сброшен');render(1)}
  else if(b=g('[data-ne]')){const [k,id]=b.dataset.ne.split(':');entForm(k,id)}
  else if(b=g('tr[data-e]')){const [k,id]=b.dataset.e.split(':');entForm(k,id)}
  else if(b=g('[data-mv]')){const [k,id,d]=b.dataset.mv.split(':'),a=[...DB[k]].sort((x,y)=>x.order-y.order),i=a.findIndex(x=>x.id==id),j=i+ +d;if(a[j]){const o=a[i].order;await api.update(k,a[i].id,{order:a[j].order});await api.update(k,a[j].id,{order:o});render(1)}}
  else if(b=g('[data-del]')){const [k,id]=b.dataset.del.split(':'),e=ENT[k],r=DB[k].find(x=>x.id==id),m=e.guard?.(r);if(m)return $('#fe').textContent=m;if(!b.dataset.s){b.dataset.s=1;b.lastChild.textContent='Точно удалить?';return}await api.remove(k,id);dlg.close();toast('Удалено');render(1)}
  else if(b=g('[data-nr]')){toast('Перезапуск требует подключённого backend/API Xray. В автономном HTML он не выполняется.')}
  else if(b=g('[data-nt]')){const n=DB.nodes.find(x=>x.id==b.dataset.nt);await api.update('nodes',n.id,{disabled:!n.disabled});toast(`${n.name}: ${n.disabled?'отключён':'включён'}`);render(1)}
  else if(b=g('[data-tt]')){TP.tab=b.dataset.tt;TP.q='';TP.f='';render(1)}
  else if(b=g('[data-lv]')){}
  else if(b=g('[data-th]')){C.theme=b.dataset.th;apply();$$('#th button').forEach(x=>x.classList.toggle('on',x==b))}
  else if(b=g('[data-ac]')){C.accent=b.dataset.ac;apply();$$('[data-ac]').forEach(x=>x.classList.toggle('on',x==b))}
  else if(b=g('[data-ui]')){const prop=b.dataset.ui,value=b.dataset.value;if(prop&&value){C[prop]=value;apply();$$(`[data-ui="${prop}"]`).forEach(x=>x.classList.toggle('on',x==b))}}
  else if(g('#rs')){C={...CDEFAULT};apply();render(1);toast('Оформление сброшено')}
  else if(g('#gx')){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(DB,null,2)],{type:'application/json'}));a.download='xmesh-nexus-backup.json';a.click()}
  else if(b=g('[data-cf]')){dlg.close();CF&&CF()}
  else if(b=g('[data-core-refresh]')){try{await refreshCoreStatus(true)}catch(err){toast(err.message)}}
  else if(b=g('[data-core-update]')){const target=$('#core-target')?.value.trim()||'latest';b.disabled=true;try{const result=await backendRequest('/api/v1/core/update',{method:'POST',body:JSON.stringify({version:target})});$('#core-message').textContent=result.message||'Обновление запущено';await refreshCoreStatus();setTimeout(()=>refreshCoreStatus().catch(()=>{}),1800)}catch(err){$('#core-message').textContent=err.message;toast(err.message)}finally{b.disabled=false}}
  else if(b=g('[data-pi]')){const x=PI[+b.dataset.pi];if(x){dlg.close();x.r()}}
  else if(g('#more'))modal(`<div class="box"><h2>Разделы</h2>${FLAT.map(([k,i,l])=>`<button class="pi" data-go="${k}">${ic(i)}<span>${l}</span></button>`).join('')}</div>`);
  else if(b=g('[data-go]')){dlg.close();location.hash=b.dataset.go}
  else if(g('#pal'))palette();
});
document.addEventListener('change',async e=>{const t=e.target;
  if(t.id==='custom-a'||t.id==='custom-b'){if(t.id==='custom-a')C.customA=t.value;else C.customB=t.value;C.accent='custom';if(t.id==='custom-a'){const rgb=t.value.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16)/255);const max=Math.max(...rgb),min=Math.min(...rgb),d=max-min;let h=0,s=0,l=(max+min)/2;if(d){s=d/(1-Math.abs(2*l-1));if(max===rgb[0])h=60*(((rgb[1]-rgb[2])/d)%6);else if(max===rgb[1])h=60*((rgb[2]-rgb[0])/d+2);else h=60*((rgb[0]-rgb[1])/d+4);if(h<0)h+=360}C.hue=Math.round(h);C.sat=Math.round(s*100);C.lum=Math.round(l*100);if($('#hue'))$('#hue').value=C.hue;if($('#sat'))$('#sat').value=C.sat;if($('#lum'))$('#lum').value=C.lum;if($('#huev'))$('#huev').textContent=C.hue+'°';if($('#satv'))$('#satv').textContent=C.sat+'%';if($('#lumv'))$('#lumv').textContent=C.lum+'%'}apply();$('[data-ac]').forEach(x=>x.classList.toggle('on',x.dataset.ac==='custom'));return}
  if(t.dataset.tg){const [k,id]=t.dataset.tg.split(':');await api.update(k,id,{disabled:!t.checked});toast(t.checked?'Включено':'Отключено')}
  else if(t.dataset.usq){const [ui,si]=t.dataset.usq.split(':').map(Number),u=DB.users.find(x=>x.id==ui);await api.update('users',ui,{squads:t.checked?[...new Set([...u.squads,si])]:u.squads.filter(x=>x!=si)});toast('Доступ обновлён');render(1);userDrawer(ui,'acc')}
  else if(t.dataset.hw){await api.update('users',+t.dataset.hw,{hwid:+t.value||0});toast('Лимит устройств сохранён');render(1);userDrawer(+t.dataset.hw,'acc')}
  else if(t.dataset.hk){const old=DB.set.hooks[t.dataset.hk];DB.set.hooks[t.dataset.hk]=t.checked?1:0;try{await api.saveSettings({hooks:{...DB.set.hooks}});toast(t.checked?'Событие включено':'Событие отключено')}catch(err){DB.set.hooks[t.dataset.hk]=old;t.checked=!!old;toast(err.message)}}
  else if(t.dataset.psz){UQ.size=+t.value;UQ.page=1;drawUsers()}
  else if(t.id=='mo'){C.motion=t.checked?1:0;apply()}
  else if(t.id=='tplsel'){const p=DB.tpls.find(x=>x.id==t.value);if(!p)return;const f=$('form[data-k=user]');const set=(k,v)=>{const el=$(`[name=${k}]`,f);if(el)el.value=v};set('limit',p.limit);set('days',p.days);set('strategy',p.strategy);set('hwid',p.hwid);$('[name=hold]',f).checked=p.hold;$$('[name=squads]',f).forEach(c=>c.checked=p.squads.includes(+c.value))}});
document.addEventListener('input',e=>{if(['hue','sat','lum'].includes(e.target.id)){C.hue=+$('#hue').value;C.sat=+$('#sat').value;C.lum=+$('#lum').value;C.customA=hslHex(C.hue,C.sat,C.lum);C.accent='custom';$('#custom-a').value=C.customA;$('#huev').textContent=C.hue+'°';$('#satv').textContent=C.sat+'%';$('#lumv').textContent=C.lum+'%';apply();$('[data-ac]').forEach(x=>x.classList.toggle('on',x.dataset.ac==='custom'))}else if(e.target.id=='ts'){C.ts=+e.target.value;$('#tsv').textContent=Math.round(C.ts*100)+'%';apply()}else if(e.target.id=='radius'){C.radius=+e.target.value;$('#rv').textContent=C.radius+' px';apply()}if(e.target.id=='pq')pdraw(e.target.value)});
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()=='k'){e.preventDefault();palette();return}
  if(e.target.id=='pq'){if(e.key=='ArrowDown'||e.key=='ArrowUp'){e.preventDefault();const n=Math.min(PI.length,12);PX=(PX+(e.key=='ArrowDown'?1:n-1))%Math.max(n,1);$$('.pi').forEach((x,i)=>x.classList.toggle('on',i==PX));$('.pi.on')?.scrollIntoView({block:'nearest'})}if(e.key=='Enter'){e.preventDefault();const x=PI[PX];if(x){dlg.close();x.r()}}return}
  if(e.key=='/'&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)){e.preventDefault();cur=='users'?$('#uq').focus():palette()}});
document.addEventListener('submit',async e=>{const f=e.target,k=f.dataset.k;if(!k)return;const er=m=>{e.preventDefault();$('#fe')&&($('#fe').textContent=m)};
  if(k=='user'){const d=read(FU,f);if(DB.users.some(u=>u.username.toLowerCase()==d.username.toLowerCase()))return er('Такое имя уже есть. Выберите другое.');if(!d.squads.length)return er('Выберите хотя бы один сквад.');
    const u={username:d.username,disabled:false,hold:d.hold,holdDays:d.days||30,created:Date.now(),expireAt:d.hold||!d.days?null:Date.now()+d.days*DAY,limit:d.limit,used:0,strategy:d.strategy,tag:d.tag,tg:'',email:'',desc:d.desc,hwid:d.hwid,squads:d.squads,onlineAt:0,adminId:DB.admins.find(a=>a.role==='owner')?.id||null,short:Math.floor(Math.random()*2**40).toString(36).padStart(8,'a'),devices:[]};
    const c=await api.create('users',u);UQ.q='';UQ.st='all';UQ.sort='created';UQ.dir='desc';toast(`Пользователь ${c.username} создан`);location.hash=='#users'?render(1):location.hash='users';setTimeout(()=>userDrawer(c.id,'sub'),350)}
  else if(k=='uedit'){e.preventDefault();const d=read(FE,f),id=+f.dataset.id;if(DB.users.some(u=>u.username.toLowerCase()==d.username.toLowerCase()&&u.id!=id))return er('Такое имя уже есть.');await api.update('users',id,d);toast('Сохранено');render(1);userDrawer(id,'ov')}
  else if(k=='ent'){const key=f.dataset.ent,e2=ENT[key],d=read(e2.fs,f),id=f.dataset.id,m=e2.chk?.(d,+id);if(m)return er(m);
    if(id){await api.update(key,id,d);toast('Сохранено')}else{const o=Object.assign({disabled:false,order:DB[key].length+1,created:Date.now(),last:0,used:0,state:'OFFLINE'},d);const c=await api.create(key,o);toast('Создано');if(e2.after?.(c)){render(1);return}}render(1)}
  else if(k=='bsq'){const d=read([{k:'squads',t:'multi'}],f),ids=new Set(UQ.sel);await api.bulk('users',ids,u=>u.squads=[...new Set([...u.squads,...d.squads])]);toast('Сквады добавлены');render(1)}
  else if(k=='brand'){e.preventDefault();const d=read([{k:'brand'},{k:'domain'}],f);try{await api.saveSettings({brand:d.brand,domain:d.domain});brand();toast('Сохранено')}catch(err){return er(err.message)}}});
const acts2=ok=>`<div class="act"><button type="button" class="gh" data-x>Отмена</button><button class="btn">${ok}</button></div>`;
$('#theme').onclick=()=>{C.theme=document.documentElement.dataset.theme=='dark'?'light':'dark';apply();if(cur=='set')render(1)};
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
$('#bell').innerHTML=ic('bell');$('#addb').innerHTML=ic('plus')+'<span class="bt">Пользователь</span>';
$('#logout').onclick=async()=>{const button=$('#logout');button.disabled=true;try{await fetch('/api/v1/auth/logout',{method:'POST',credentials:'same-origin',cache:'no-store'});}catch(_){}backendReady=false;location.replace('/login')};$('#restart').setAttribute('aria-label','Настройки Xray-core');$('#restart').innerHTML=ic('code')+'<span class="lbl">Версия</span>';
apply();matchMedia('(prefers-color-scheme: light)').addEventListener('change',apply);
addEventListener('hashchange',()=>{if(backendReady)render()});
function showAuthGate(){
  backendReady=false;
  location.replace('/login');
}
async function initializePanel(){
  const response=await fetch('/api/v1/bootstrap',{credentials:'same-origin',cache:'no-store'});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error||'Не удалось загрузить данные backend.');
  const collections=payload.collections||{};
  for(const key of ['users','nodes','profiles','hosts','squads','tpls','subs','admins','tokens','srh'])DB[key]=Array.isArray(collections[key])?collections[key]:[];
  DB.set={...DB.set,...(payload.settings||{}),hooks:{...DB.set.hooks,...(payload.settings?.hooks||{})}};
  backendReady=true;
  $('#xmesh-auth')?.remove();
  brand();render();
  refreshCoreStatus().catch(()=>{});
}
async function bootPanel(){
  try{
    const response=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('Backend API не отвечает.');
    const session=await response.json();
    if(!session.authenticated){location.replace('/login');return}
    await initializePanel();
  }catch(err){location.replace('/login?unavailable=1')}
}
function coreStateLabel(status){
  return status==='updating'?'Обновляется':status==='ready'?'Установлено':status==='error'?'Ошибка':'Не установлено';
}
function syncCoreBadge(state){
  const el=$('#cs'),dot=$('#cd');
  if(el)el.textContent=state.status==='updating'?'Установка Xray-core…':state.installed_version?('Версия '+state.installed_version):state.status==='error'?'Ошибка установки':'Ядро не установлено';
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
bootPanel().catch(err=>showAuthGate(err.message||'Ошибка запуска панели'));
