(()=>{
'use strict';
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function call(action,body){
 const response=await fetch('/api/v1/auth/mfa/'+action,{
  method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
  headers:body===undefined?{}:{'Content-Type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(result.error||'Ошибка двухфакторной защиты.');
 return result;
}
const panel=()=>'<section class="card" id="mfa-panel"><div class="hd"><div><h3>Двухфакторная аутентификация</h3><p>Дополнительная защита входа · TOTP</p></div><span class="chip" id="mfa-state">Загрузка…</span></div><p class="note">Для входа потребуется код приложения-аутентификатора. Сохраните резервные коды на случай потери телефона.</p><div id="mfa-body"></div><p class="er" id="mfa-error" role="alert" aria-live="polite"></p></section>';
async function mount(root){
 const card=root.querySelector('#mfa-panel');if(!card)return;
 const body=card.querySelector('#mfa-body'),state=card.querySelector('#mfa-state'),error=card.querySelector('#mfa-error');
 const setError=text=>{error.textContent=text||''};
 const display=async()=>{
  const status=await call('status');
  state.textContent=status.enabled?'Включена':'Выключена';
  if(!status.available){
   body.textContent='Добавьте постоянный TOTP_ENCRYPTION_KEY в .env и перезапустите панель.';
  }else if(status.enabled){
   body.innerHTML='<details class="mfa-details"><summary>Отключить 2FA</summary><form id="mfa-disable" class="sg"><label class="f"><span>Текущий пароль</span><input type="password" name="password" autocomplete="current-password" maxlength="1024" required></label><label class="f"><span>Код приложения или резервный код</span><input name="code" autocomplete="one-time-code" maxlength="40" required></label><button class="gh" type="submit">Подтвердить отключение</button></form></details>';
  }else{
   body.innerHTML='<details class="mfa-details"><summary>Настроить 2FA</summary><form id="mfa-start" class="sg"><label class="f"><span>Подтвердите текущий пароль</span><input type="password" name="password" autocomplete="current-password" maxlength="1024" required></label><button class="btn" type="submit">Начать подключение</button></form></details>';
  }
 };
 async function submit(form,path,values,onSuccess){
  const button=form.querySelector('[type=submit]');
  if(button)button.disabled=true;
  setError('');
  try{await onSuccess(await call(path,values));}catch(ex){setError(ex.message);}
  finally{if(button?.isConnected)button.disabled=false;}
 }
 card.addEventListener('submit',event=>{
  const form=event.target;
  if(!form.matches('#mfa-start,#mfa-confirm,#mfa-disable'))return;
  event.preventDefault();
  const value=name=>form.elements.namedItem(name)?.value.trim()||'';
  if(form.id==='mfa-start'){
   submit(form,'setup',{password:value('password')},data=>{
    body.innerHTML='<div class="sg mfa-setup"><p class="note">Добавьте запись в Google Authenticator, 2FAS или Aegis. Секрет показывается только сейчас.</p><label class="f"><span>Секрет TOTP</span><input id="mfa-secret" readonly value="'+escapeHtml(data.secret)+'"></label><div class="act"><button class="gh sm" type="button" data-mfa-copy="secret">Копировать секрет</button><button class="gh sm" type="button" data-mfa-copy="uri">Копировать ссылку импорта</button></div><form id="mfa-confirm" class="sg"><label class="f"><span>Код приложения</span><input name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label><button class="btn" type="submit">Включить 2FA</button></form><p class="note">Подтвердите код в течение 10 минут. До этого 2FA не включена.</p></div>';
    card.dataset.uri=data.otpauth;
    body.querySelector('[name=code]').focus();
   });
  }else if(form.id==='mfa-confirm'){
   submit(form,'confirm',{code:value('code')},data=>{
    state.textContent='Включена';delete card.dataset.uri;
    body.innerHTML='<div class="sg"><h3>Сохраните резервные коды</h3><p class="note">Каждый код работает только один раз. После закрытия этого блока восстановить их нельзя. Храните отдельно от телефона.</p><textarea id="mfa-recovery-codes" rows="7" readonly spellcheck="false"></textarea><div class="act"><button class="gh" type="button" data-mfa-copy="recovery">Копировать коды</button><button class="btn" type="button" data-mfa-done>Я сохранил коды</button></div></div>';
    body.querySelector('#mfa-recovery-codes').value=(data.recoveryCodes||[]).join('\n');
   });
  }else{
   submit(form,'disable',{password:value('password'),code:value('code')},display);
  }
 });
 card.addEventListener('click',async event=>{
  if(event.target.closest('[data-mfa-done]')){await display();return;}
  const copy=event.target.closest('[data-mfa-copy]');
  if(!copy)return;
  const type=copy.dataset.mfaCopy;
  const val=type==='secret'?body.querySelector('#mfa-secret')?.value:type==='uri'?card.dataset.uri:body.querySelector('#mfa-recovery-codes')?.value;
  if(!val)return;
  try{await navigator.clipboard.writeText(val);copy.textContent='Скопировано';}
  catch{setError('Не удалось скопировать. Выделите и скопируйте текст вручную.');}
 });
 try{await display();}catch(ex){state.textContent='Ошибка';setError(ex.message);}
}
window.XMeshMfa={panel,mount};
})();