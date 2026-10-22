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
const panel=()=>'<section class="card mfa-security-card" id="mfa-panel">'+
 '<div class="hd mfa-security-heading"><div class="mfa-security-title">'+
 '<span class="mfa-security-icon" aria-hidden="true"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg></span>'+
 '<div><h3>Двухфакторная аутентификация</h3><p>Подтверждение входа одноразовым кодом · TOTP</p></div></div>'+
 '<span class="chip" id="mfa-state" aria-live="polite">Проверка…</span></div>'+
 '<div class="mfa-security-content"><p class="note">Дополнительная защита учётной записи. После включения понадобится код приложения-аутентификатора; сохраните резервные коды для восстановления доступа.</p>'+
 '<div id="mfa-body"></div><p class="er" id="mfa-error" role="alert" aria-live="polite"></p></div></section>';
async function mount(root){
 const card=root.querySelector('#mfa-panel');if(!card)return;
 const body=card.querySelector('#mfa-body'),state=card.querySelector('#mfa-state'),error=card.querySelector('#mfa-error');
 const setError=text=>{error.textContent=text||''};
 const display=async()=>{
  const status=await call('status');
  state.textContent=!status.available?'Нужна настройка':status.enabled?'Включена':'Выключена';
  state.dataset.status=!status.available?'unavailable':status.enabled?'enabled':'disabled';
  if(!status.available){
   body.innerHTML='<div class="mfa-unavailable">'+
    '<div class="mfa-unavailable-heading"><h4>Защита ожидает настройки сервера</h4>'+
    '<p>Панель пока не получила постоянный ключ шифрования TOTP. Из браузера включить 2FA небезопасно: ключ должен храниться только на сервере.</p></div>'+
    '<div class="mfa-unavailable-actions"><div><span class="mfa-step-number">01</span><p>Откройте терминал VPS и перейдите в каталог XMesh Nexus.</p></div>'+
    '<div><span class="mfa-step-number">02</span><p>Запустите терминальное меню панели и выберите <strong>пункт 9 — «Проверить и включить 2FA»</strong>.</p></div></div>'+
    '<div class="mfa-terminal"><code>bash xmeshctl</code><button class="gh sm" type="button" data-mfa-copy="repair">Копировать</button></div>'+
    '<p class="mfa-repair-hint">После проверки ключа панель будет пересоздана с правильной конфигурацией. Обновите эту страницу и включите 2FA, подтвердив код в приложении.</p>'+
    '<details class="mfa-key-warning"><summary>Уже использовали 2FA раньше?</summary>'+
    '<p>Если прежний ключ TOTP_ENCRYPTION_KEY был утрачен, восстановите <strong>именно оригинальный</strong> ключ из резервной копии .env. Новый ключ не сможет расшифровать существующие TOTP-секреты. Не публикуйте .env и ключи в поддержке или GitHub.</p></details>'+
    '</div>';
  }else if(status.enabled){
   body.innerHTML='<details class="mfa-details"><summary>Отключить 2FA</summary><form id="mfa-disable" class="sg"><label class="f"><span>Текущий пароль</span><input type="password" name="password" autocomplete="current-password" maxlength="1024" required></label><label class="f"><span>Код приложения или резервный код</span><input name="code" autocomplete="one-time-code" maxlength="40" required></label><button class="gh" type="submit">Подтвердить отключение</button></form></details>';
  }else{
   body.innerHTML='<div class="mfa-setup-intro"><h4>Подключить 2FA</h4><p class="note">Подтвердите пароль, затем добавьте аккаунт в приложение-аутентификатор.</p></div><form id="mfa-start" class="sg"><label class="f"><span>Подтвердите текущий пароль</span><input type="password" name="password" autocomplete="current-password" maxlength="1024" required></label><button class="btn" type="submit">Начать подключение</button></form>';
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
    // The provisioning URI and TOTP secret remain in the browser; no external QR service.
    card.dataset.uri=data.otpauth;
    body.innerHTML='<div class="mfa-enrollment">'+
      '<div class="mfa-qr-column"><div class="mfa-qr-frame" id="mfa-qr" role="img" aria-label="QR-код для Google Authenticator"></div>'+
      '<span class="mfa-qr-caption">1. Откройте Google Authenticator, нажмите «+» и выберите «Сканировать QR-код».</span></div>'+
      '<div class="mfa-qr-instructions"><h4>Подключение приложения</h4>'+
      '<p class="note">Отсканируйте QR-код камерой телефона. Также поддерживаются 2FAS, Aegis и другие приложения TOTP.</p>'+
      '<details class="mfa-manual"><summary>Не получается сканировать? Ввести ключ вручную</summary>'+
      '<label class="f"><span>Секретный ключ</span><input id="mfa-secret" readonly value="'+escapeHtml(data.secret)+'" autocomplete="off"></label>'+
      '<div class="act"><button class="gh sm" type="button" data-mfa-copy="secret">Копировать ключ</button>'+
      '<button class="gh sm" type="button" data-mfa-copy="uri">Копировать ссылку импорта</button></div></details>'+
      '<form id="mfa-confirm" class="sg"><label class="f"><span>2. Код из Google Authenticator</span>'+
      '<input name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="000000"></label>'+
      '<button class="btn" type="submit">Включить 2FA</button></form>'+
      '<p class="note">2FA включится только после подтверждения кода. На подтверждение есть 10 минут.</p></div></div>';
    try{
      const Qr=window.qrcodegen?.QrCode;
      if(!Qr)throw new Error('QR generator unavailable');
      const qr=Qr.encodeText(data.otpauth,Qr.Ecc.MEDIUM),pad=4,modules=[];
      for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++){
        if(qr.getModule(x,y))modules.push('M'+(x+pad)+','+(y+pad)+'h1v1h-1z');
      }
      const size=qr.size+pad*2;
      body.querySelector('#mfa-qr').innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" shape-rendering="crispEdges" aria-hidden="true" focusable="false">'+
       '<rect width="100%" height="100%" fill="#fff"/><path d="'+modules.join('')+'" fill="#101010"/></svg>';
    }catch(ex){
      body.querySelector('#mfa-qr').textContent='QR-код недоступен — используйте ручной ввод.';
      body.querySelector('.mfa-manual').open=true;
    }
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
  const val=type==='repair'?'bash xmeshctl':type==='secret'?body.querySelector('#mfa-secret')?.value:type==='uri'?card.dataset.uri:body.querySelector('#mfa-recovery-codes')?.value;
  if(!val)return;
  try{await navigator.clipboard.writeText(val);copy.textContent='Скопировано';}
  catch{setError('Не удалось скопировать. Выделите и скопируйте текст вручную.');}
 });
 try{await display();}catch(ex){state.textContent='Ошибка';setError(ex.message);}
}
window.XMeshMfa={panel,mount};
})();