/* XMesh Nexus advanced security workspace. All policy writes are server enforced. */
(()=>{
'use strict';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(path,method='GET',data)=>{
 const res=await fetch('/api/v1/security/'+path,{method,credentials:'same-origin',cache:'no-store',
  headers:data===undefined?{}:{'Content-Type':'application/json'},
  ...(data===undefined?{}:{body:JSON.stringify(data)})});
 const value=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(value.error||'Не удалось выполнить операцию.');
 return value;
};
const number=(id,title,description,min,max,value,unit)=>'<label class="sec-setting" for="sec-'+id+'">'+
 '<span class="sec-setting-heading"><strong>'+title+'</strong><small>'+description+'</small></span>'+
 '<span class="sec-value-field"><input id="sec-'+id+'" name="'+id+'" type="number" min="'+min+'" max="'+max+
 '" step="1" value="'+value+'" required><span>'+unit+'</span></span></label>';
const card=(title,desc,items)=>'<section class="card sec-policy-group"><div class="sec-group-heading"><h3>'+title+'</h3>'+
 '<p>'+desc+'</p></div><div class="sec-setting-list">'+items+'</div></section>';
const formatTime=ms=>ms?new Date(ms).toLocaleString(document.documentElement.lang==='en'?'en-US':'ru-RU'):'—';
const copyLink=()=>location.origin+document.querySelector('#sec-dashboardPath')?.value;
async function mount(root){
 const form=root.querySelector('#sec-policy-form'),sessionsRoot=root.querySelector('#sec-sessions-list');
 if(!form||!sessionsRoot)return;
 const message=root.querySelector('#sec-policy-message');
 const setMessage=(text,bad=false)=>{if(message){message.textContent=text;message.dataset.error=bad?'true':'false'}};
 let editable=false;
 try{
  const result=await api('policy');
  const p=result.policy;
  editable=!!result.canEdit;
  form.innerHTML=
   '<div class="sec-policy-grid">'+
    card('Срок действия доступа','Автоматическое завершение авторизованных сессий.',
     number('sessionHours','Время сессии','Абсолютный срок с момента входа. От 1 до 168 часов.',1,168,p.sessionHours,'ч')+
     number('idleMinutes','Бездействие','0 отключает таймаут простоя. До 1440 минут.',0,1440,p.idleMinutes,'мин')+
     number('maxSessions','Одновременные сессии','При новом входе самые старые лишние сессии отзываются.',1,20,p.maxSessions,'шт'))+
    card('Защита от перебора','Ограничения входа действуют через API, а не только в браузере.',
     number('loginAttempts','Неудачные попытки','Количество ошибок до временной блокировки.',3,15,p.loginAttempts,'раз')+
     number('lockoutMinutes','Окно и блокировка','Время подсчёта попыток и длительность блокировки.',5,120,p.lockoutMinutes,'мин'))+
    '<section class="card sec-policy-group sec-access-group"><div class="sec-group-heading"><h3>Адрес дашборда</h3>'+
      '<p>Дополнительная ссылка в формате /dashboard/имя. Применяется сразу после сохранения.</p></div>'+
      '<label class="sec-path-label" for="sec-dashboardPath">Путь входа в панель</label>'+
      '<div class="sec-path-controls"><input id="sec-dashboardPath" name="dashboardPath" type="text" autocomplete="off" spellcheck="false" '+
       'minlength="15" maxlength="75" pattern="/dashboard/[A-Za-z0-9_-]{4,64}" value="'+esc(p.dashboardPath)+'" required>'+
       '<button class="gh" type="button" id="sec-copy-path">Копировать ссылку</button></div>'+
      '<p class="sec-help">Основной адрес <code>/</code> сохраняется для восстановления доступа. Путь не заменяет HTTPS, авторизацию и ограничения на обратном прокси.</p>'+
     '</section></div>'+
    '<div class="sec-savebar"><span class="sec-save-note">'+(editable?'Менять политику может только владелец панели.':'Доступен просмотр. Изменять глобальную политику может только владелец.')+
    '</span>'+(editable?'<button class="btn" type="submit">Сохранить политику</button>':'')+'</div>';
  if(!editable)form.querySelectorAll('input').forEach(input=>input.disabled=true);
  form.querySelector('#sec-copy-path')?.addEventListener('click',async()=>{
   try{await navigator.clipboard.writeText(copyLink());setMessage('Ссылка скопирована.');}
   catch{setMessage('Не удалось скопировать ссылку.',true);}
  });
 }catch(error){setMessage(error.message,true);form.innerHTML='<div class="sec-error-state">Не удалось загрузить политику безопасности. Обновите страницу и проверьте API.</div>'; }
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(!editable)return;
  const button=form.querySelector('[type=submit]');
  if(!form.reportValidity())return;
  const p={};
  for(const k of ['sessionHours','idleMinutes','maxSessions','loginAttempts','lockoutMinutes']){
   const value=Number(form.elements.namedItem(k)?.value);
   if(!Number.isSafeInteger(value)){setMessage('Введите целые числовые значения.',true);return;}
   p[k]=value;
  }
  p.dashboardPath=form.elements.namedItem('dashboardPath')?.value.trim()||'';
  if(button)button.disabled=true;
  try{await api('policy','PATCH',p);setMessage('Политика сохранена и применяется сервером. Изменение длительности может завершить старые сессии.');}
  catch(err){setMessage(err.message,true);}
  finally{if(button?.isConnected)button.disabled=false;}
 });
 const renderSessions=async()=>{
  if(!sessionsRoot.isConnected)return;
  try{
   const data=await api('sessions');
   const items=data.sessions||[];
   sessionsRoot.innerHTML=items.length?'<div class="sec-session-rows">'+items.map(s=>
    '<div class="sec-session-row" data-id="'+s.id+'"><div class="sec-session-icon" aria-hidden="true">◈</div>'+
     '<div class="sec-session-details"><strong>'+ (s.current?'Текущая сессия':'Активная сессия')+'</strong>'+
     '<span>Создана: '+esc(formatTime(s.createdAt))+' · Активность: '+esc(formatTime(s.lastActivity))+'</span>'+
     '<small>Истекает: '+esc(formatTime(s.expiresAt))+'</small></div>'+
     '<button class="gh" type="button" data-sec-revoke="'+s.id+'">'+(s.current?'Завершить':'Отозвать')+'</button></div>'
    ).join('')+'</div>':
    '<p class="sec-help">Активных сессий пока нет.</p>';
  }catch(err){sessionsRoot.innerHTML='<p class="sec-error-state">'+esc(err.message)+'</p>';}
 };
 await renderSessions();
 root.querySelector('#sec-refresh-sessions')?.addEventListener('click',renderSessions);
 sessionsRoot.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-sec-revoke]');if(!btn)return;
  if(!confirm('Завершить выбранную сессию? Доступ в ней будет отозван.'))return;
  btn.disabled=true;
  try{const v=await api('sessions/'+encodeURIComponent(btn.dataset.secRevoke),'DELETE');
   if(v.current){location.replace('/login');return;}await renderSessions();
  }catch(err){btn.disabled=false;setMessage(err.message,true);}
 });
 root.querySelector('#sec-revoke-others')?.addEventListener('click',async e=>{
  if(!confirm('Завершить все остальные сессии вашего аккаунта?'))return;
  const b=e.currentTarget;b.disabled=true;
  try{const result=await api('sessions/others','POST');setMessage('Завершено других сессий: '+result.revokedCount);await renderSessions();}
  catch(err){setMessage(err.message,true);}
  finally{if(b.isConnected)b.disabled=false;}
 });
}
const panel=()=>'<div class="sec-extra">'+
 '<header class="sec-extra-title"><span>ПОЛИТИКА ДОСТУПА</span><h2>Расширенная безопасность</h2><p>Настройки применяются к аутентификации и сессиям на стороне сервера.</p></header>'+
 '<form id="sec-policy-form" class="sec-policy-form"><div class="sec-loading">Загрузка настроек…</div></form>'+
 '<p class="sec-feedback" id="sec-policy-message" role="status" aria-live="polite"></p>'+
 '<section class="card sec-sessions-card"><div class="sec-group-heading sec-sessions-head"><div><h3>Активные сессии</h3>'+
 '<p>Просмотр и отзыв входов только вашей учётной записи.</p></div>'+
 '<div class="sec-session-actions"><button class="gh" id="sec-refresh-sessions" type="button">Обновить</button>'+
 '<button class="gh" id="sec-revoke-others" type="button">Завершить остальные</button></div></div>'+
 '<div id="sec-sessions-list" aria-live="polite"><p class="sec-help">Загрузка списка…</p></div></section>'+
 '<section class="card sec-baseline"><div><h3>Постоянные механизмы защиты</h3>'+
 '<p>Эти функции работают автоматически и не отключаются из интерфейса.</p></div>'+
 '<div class="sec-baseline-grid"><span>Шифрование паролей <b>Argon2</b></span>'+
 '<span>Cookie сессий <b>HttpOnly · SameSite=Strict</b></span>'+
 '<span>Проверка запросов <b>Origin / CSRF</b></span>'+
 '<span>Права администраторов <b>Owner / Admin / Viewer</b></span></div></section>'+
 '</div>';
window.XMeshSecurity={panel,mount};
})();
