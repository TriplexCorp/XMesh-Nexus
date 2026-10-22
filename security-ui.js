(()=>{
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const announce=(message,kind='success')=>{
 let box=document.getElementById('xmesh-action-feedback');
 if(!box){
  box=document.createElement('div');box.id='xmesh-action-feedback';
  box.setAttribute('role','status');box.setAttribute('aria-live','polite');
  document.body.appendChild(box);
 }
 box.className='xmesh-action-feedback '+(kind==='error'?'is-error':'is-success');
 box.textContent=message;box.classList.add('visible');
 if(announce.timer)clearTimeout(announce.timer);
 announce.timer=setTimeout(()=>box.classList.remove('visible'),4200);
};
window.XMeshFeedback=announce;
const defaults={sessionHours:1,idleMinutes:15,maxSessions:1,loginAttempts:3,lockoutMinutes:15,dashboardPath:''};
const request=async(path,options={})=>{
 const r=await fetch('/api/v1/security/'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(j.error||'Ошибка настроек безопасности');
 return j;
};
const setting=(name,title,detail,min,max,unit,policy,disabled)=>'<label class="security-setting"><span><b>'+title+'</b><small>'+detail+'</small></span><span class="security-number"><input name="'+name+'" type="number" min="'+min+'" max="'+max+'" step="1" value="'+esc(policy[name])+'" '+(disabled?'disabled':'')+' required><em>'+unit+'</em></span></label>';
const panel=()=>'<section class="card" id="security-advanced"><div class="hd"><div><h3>Политика входа</h3><p>Время сессии, ограничения входа и защищённый адрес</p></div></div><div id="security-advanced-body" class="security-loading">Загрузка политик безопасности…</div><p id="security-advanced-error" class="er" role="alert" aria-live="polite"></p></section><section class="card" id="security-sessions-panel"><div class="hd"><div><h3>Активные сессии</h3><p>Управление входами и устройствами</p></div></div><div id="security-sessions-body"></div></section>';
async function mount(root){
 const host=root.querySelector('#security-advanced');if(!host)return;
 const body=host.querySelector('#security-advanced-body'),error=host.querySelector('#security-advanced-error');
 const fail=e=>{error.textContent=e?.message||String(e);announce(error.textContent,'error')};
 const load=async()=>{
  const [res,sessionRes]=await Promise.all([request('policy'),request('sessions')]);
  const p={...defaults,...res.policy},readonly=!res.canEdit;
  const fields=[
    ['sessionHours','Срок действия сессии','Максимальное время входа. Применяется к новым сессиям.',1,168,'час.'],
    ['idleMinutes','Таймаут бездействия','0 — не завершать сессию из-за бездействия.',0,1440,'мин.'],
    ['maxSessions','Сессий на администратора','Ограничение количества одновременно действующих входов.',1,20,'шт.'],
    ['loginAttempts','Попыток входа','После этого числа ошибок вход временно блокируется.',3,15,'раз'],
    ['lockoutMinutes','Время блокировки','Период ограничения после превышения попыток.',5,120,'мин.']
  ];
  body.innerHTML='<div class="security-subheading"><h4>Политика авторизации</h4><p>Управляется владельцем панели. Значения сохраняются в PostgreSQL и проверяются API.</p></div>'+
  '<form id="security-policy-form"><div class="security-settings-grid">'+fields.map(f=>setting(...f,p,readonly)).join('')+
  '<label class="security-setting security-url-setting"><span><b>Путь входа в панель</b><small>Единственная точка входа в интерфейс. После сохранения старый адрес перестаёт работать. Путь не заменяет HTTPS и авторизацию.</small></span><span class="security-path-controls"><input name="dashboardPath" type="text" minlength="15" maxlength="75" pattern="/dashboard/[A-Za-z0-9_-]{4,64}" value="'+esc(p.dashboardPath)+'" '+(readonly?'disabled':'')+' required><button type="button" class="gh" data-security-copy-path>Копировать ссылку</button></span></label></div>'+
  (readonly?'<p class="note">Редактирование доступно только владельцу (owner).</p>':'<div class="security-policy-actions"><button type="submit" class="btn">Сохранить политику</button><button type="button" class="gh" data-security-reset>Вернуть значения по умолчанию</button></div>')+'</form>'+
  '<div class="security-subheading"><h4>Мои активные сессии</h4><p>При необходимости завершите другие входы в панель.</p></div>'+
  '<div class="security-sessions">'+(sessionRes.sessions||[]).map(s=>'<div class="security-session"><span><b>'+(s.current?'Текущая сессия':'Сессия №'+esc(s.id))+'</b><small>Последняя активность: '+esc(new Date(s.lastActivity).toLocaleString())+' · Истекает: '+esc(new Date(s.expiresAt).toLocaleString())+'</small></span><button type="button" class="gh sm" data-security-revoke="'+esc(s.id)+'">'+(s.current?'Завершить':'Отозвать')+'</button></div>').join('')+
  '<div class="security-policy-actions"><button type="button" class="gh" data-security-revoke-others>Завершить все другие сессии</button></div></div>'+
  '<div class="security-policy-footnote">Адрес снижает обнаруживаемость страницы входа, но не является паролем. API должен оставаться защищённым независимо от URL. Используйте длинный непредсказуемый путь и HTTPS.</div>';
  const sessionsBody=root.querySelector('#security-sessions-body');
  const sessionHeading=[...body.querySelectorAll('.security-subheading')].find(el=>el.querySelector('h4')?.textContent==='Мои активные сессии');
  const sessionList=body.querySelector('.security-sessions');
  if(sessionsBody&&sessionList){
    sessionsBody.replaceChildren();
    if(sessionHeading)sessionHeading.remove();
    sessionsBody.append(sessionList);
  }
 };
 try{await load()}catch(e){fail(e);body.innerHTML='<button class="gh" type="button" data-security-retry>Повторить загрузку</button>'}
 root.addEventListener('click',async e=>{
  const btn=e.target.closest('button');if(!btn)return;
  try{
   if(btn.matches('[data-security-copy-path]')){
    const value=host.querySelector('[name="dashboardPath"]')?.value.trim();
    if(!value)return;
    await navigator.clipboard.writeText(location.origin+value);
    error.textContent='';announce('Ссылка на панель скопирована.');
   }
   else if(btn.matches('[data-security-retry]')){error.textContent='';await load()}
   else if(btn.matches('[data-security-reset]')){
    const form=host.querySelector('#security-policy-form');if(!form)return;
    for(const [key,value] of Object.entries(defaults))if(key!=='dashboardPath'&&form.elements.namedItem(key))form.elements.namedItem(key).value=value;
    announce('Значения по умолчанию подставлены. Нажмите «Сохранить политику» для применения.');
   }else if(btn.matches('[data-security-revoke-others]')){
    if(!confirm('Завершить все остальные сессии вашей учётной записи?'))return;
    await request('sessions/others',{method:'POST'});await load();announce('Остальные сессии завершены.');
   }else if(btn.matches('[data-security-revoke]')){
    if(!confirm('Завершить выбранную сессию?'))return;
    const id=btn.dataset.securityRevoke;
    const out=await request('sessions/'+encodeURIComponent(id),{method:'DELETE'});
    if(out.current){location.replace(location.pathname);return}
    await load();announce('Сессия отозвана.');
   }
  }catch(ex){fail(ex)}
 });
 host.addEventListener('submit',async e=>{
  if(e.target.id!=='security-policy-form')return;
  e.preventDefault();error.textContent='';
  const form=e.target,patch={};
  for(const key of Object.keys(defaults)){const el=form.elements.namedItem(key);patch[key]=key==='dashboardPath'?el.value.trim():Number(el.value)}
  if(!form.reportValidity())return;
  const btn=form.querySelector('[type=submit]');if(btn)btn.disabled=true;
  try{
   await request('policy',{method:'PATCH',body:JSON.stringify(patch)});
   announce('Настройки безопасности успешно сохранены.');
   if(location.pathname!==patch.dashboardPath){
    announce('Настройки сохранены. Открываем новый адрес панели.');
    location.replace(patch.dashboardPath);return;
   }
   await load();
  }catch(ex){fail(ex)}finally{if(btn?.isConnected)btn.disabled=false}
 });
}
window.XMeshSecurity={panel,mount};
})();