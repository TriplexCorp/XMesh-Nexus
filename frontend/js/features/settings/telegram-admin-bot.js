(()=>{
'use strict';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const API='/api/v1/telegram-bot';
const stateText={
 telegram_token_invalid:'Токен отклонён Telegram. Проверьте значение BotFather.',
 network_unavailable:'Не удалось подключиться к Telegram API. Проверьте исходящий HTTPS-доступ сервера.',
 telegram_api_unavailable:'Telegram API временно недоступен или токен используется другим сервисом.',
 database_unavailable:'Недоступна база данных XMesh Nexus.',
 decrypt_failed:'Не удалось расшифровать сохранённый токен. Проверьте серверный ключ.'
};
const meta=status=>{
 if(!status.enabled)return ['Отключён','off'];
 if(!status.tokenConfigured)return ['Не настроен','off'];
 if(status.connected)return ['Подключён','online'];
 return ['Подключение…','connecting'];
};
const subtitle=value=>{
 if(!value)return 'Бот ещё не подключался.';
 try{return new Date(value).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
 catch(_){return '—';}
};
const parseAdmins=raw=>{
 const fields=raw.split(/[\s,;]+/).map(t=>t.trim()).filter(Boolean);
 if(fields.length>50)throw Error('Можно добавить не более 50 Telegram ID.');
 const ids=fields.map(id=>{
  if(!/^[1-9][0-9]{0,18}$/.test(id))throw Error('Telegram ID должен состоять только из цифр.');
  const value=Number(id);
  if(!Number.isSafeInteger(value)||value<=0)throw Error('Недопустимый Telegram ID.');
  return value;
 });
 if(new Set(ids).size!==ids.length)throw Error('Telegram ID повторяются.');
 return ids;
};
const card=()=>String.raw`
<section class="tb-workspace">
  <div class="tb-banner">
    <div class="tb-banner-copy">
      <span class="tb-eyebrow"><span class="tb-status-pulse"></span> XMESH · CONTROL BOT</span>
      <h2>Управление из Telegram</h2>
      <p>Отдельный административный бот. Укажите токен BotFather и тех, кому разрешено управлять панелью. Никаких дополнительных серверов и ручных команд.</p>
      <div class="tb-banner-bottom">
        <span class="tb-pill" id="tb-live-status" role="status" aria-live="polite">Проверка…</span>
        <span id="tb-username" class="tb-bot-handle" translate="no"></span>
        <a id="tb-open-bot" class="tb-open-link" target="_blank" rel="noopener noreferrer" hidden>Открыть бота ↗</a>
      </div>
    </div>
    <div class="tb-banner-art" aria-hidden="true"><div class="tb-art-circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg></div><span>CONTROL PLANE</span></div>
  </div>
  <div class="tb-status-grid">
    <div class="tb-metric"><span class="tb-metric-icon">◉</span><span>Состояние</span><strong id="tb-metric-state">—</strong></div>
    <div class="tb-metric"><span class="tb-metric-icon">◈</span><span>Администраторы</span><strong id="tb-metric-admins">—</strong></div>
    <div class="tb-metric"><span class="tb-metric-icon">⌁</span><span>Последнее соединение</span><strong id="tb-metric-check">—</strong></div>
  </div>
  <div class="tb-columns">
    <section class="tb-panel">
      <div class="tb-panel-head"><div><h3>Подключение</h3><p>Панель подключается автоматически после сохранения.</p></div><span class="tb-step">01</span></div>
      <form id="tb-config-form" autocomplete="off" novalidate>
        <label class="tb-field-label" for="tb-token">Токен BotFather</label>
        <div class="tb-token-field">
          <input id="tb-token" type="password" placeholder="Вставьте токен нового бота" autocomplete="new-password" spellcheck="false" maxlength="128" aria-describedby="tb-token-note"/>
          <button type="button" class="tb-minor" id="tb-token-visibility" aria-label="Показать или скрыть токен">Показать</button>
        </div>
        <p class="tb-field-help" id="tb-token-note">Токен хранится зашифрованным и никогда не показывается повторно. Для замены вставьте новый.</p>
        <div class="tb-field-head"><label class="tb-field-label" for="tb-admins">Telegram ID администраторов</label><span>до 50</span></div>
        <textarea id="tb-admins" rows="5" placeholder="123456789&#10;987654321" spellcheck="false" aria-describedby="tb-admins-note"></textarea>
        <p class="tb-field-help" id="tb-admins-note">По одному ID на строку. Бот отвечает только этим аккаунтам в личном чате. ID группы не подходят.</p>
        <div class="tb-enable-row">
          <div><strong>Встроенный бот</strong><small>Автозапуск и переподключение при сбое</small></div>
          <label class="tb-toggle" aria-label="Включить или выключить бота">
            <input type="checkbox" id="tb-enabled"><span class="tb-toggle-track"></span>
          </label>
        </div>
        <div class="tb-form-actions">
          <button class="tb-primary" type="submit" id="tb-save">Сохранить и применить</button>
          <button class="tb-secondary" type="button" id="tb-refresh">Обновить статус</button>
          <button class="tb-danger" type="button" id="tb-clear">Удалить токен</button>
        </div>
        <p id="tb-feedback" class="tb-feedback" aria-live="polite"></p>
      </form>
    </section>
    <div class="tb-side">
      <section class="tb-panel tb-features">
        <div class="tb-panel-head"><div><h3>Что умеет бот</h3><p>Понятный интерфейс прямо в Telegram.</p></div><span class="tb-step">02</span></div>
        <div class="tb-feature"><span>👥</span><div><strong>Пользователи</strong><p>Быстрый список и карточки подписок.</p></div></div>
        <div class="tb-feature"><span>⌕</span><div><strong>Поиск</strong><p>По имени или идентификатору пользователя.</p></div></div>
        <div class="tb-feature"><span>📊</span><div><strong>Сводка</strong><p>Состояние пользователей и нод.</p></div></div>
        <div class="tb-feature"><span>🔒</span><div><strong>Управление доступом</strong><p>Включение и отключение с одноразовым подтверждением.</p></div></div>
      </section>
      <section class="tb-note-card">
        <strong>Защита по умолчанию</strong>
        <p>Только личный чат, строгий список ID, лимит запросов, аудит и одноразовые подтверждения на 60 секунд. Используйте отдельного Telegram-бота, не занятого другим сервисом.</p>
      </section>
      <section class="tb-panel tb-health" id="tb-connection-panel" hidden>
        <strong>Диагностика подключения</strong><p id="tb-connection-detail"></p>
      </section>
    </div>
  </div>
</section>`;
async function page({owner,request,toast,confirm,schedule}){
 if(!owner)return [`<section class="tb-workspace"><div class="tb-panel"><h3>Telegram-бот</h3><p>Настройка доступна только владельцу панели.</p></div></section>`,()=>{}];
 const initial=await request(API);
 return [card(),()=>{
  const $=id=>document.getElementById(id);
  let config=initial,modified=false;
  const status=async()=>{
   if(!$('tb-config-form'))return;
   const next=await request(API);
   config=next;
   const [label,klass]=meta(next);
   const pill=$('tb-live-status');
   pill.textContent=label;pill.className='tb-pill tb-'+klass;
   $('tb-metric-state').textContent=label;
   $('tb-metric-admins').textContent=String(next.adminIds?.length||0);
   $('tb-metric-check').textContent=subtitle(next.lastConnectedAtMs);
   const handle=next.botUsername&&/^[a-z0-9_]{5,32}$/i.test(next.botUsername)?next.botUsername:'';
   $('tb-username').textContent=handle?'@'+handle:'';
   const link=$('tb-open-bot');
   link.hidden=!handle;if(handle)link.href='https://t.me/'+handle;
   const details=$('tb-connection-panel');
   details.hidden=!next.lastError;
   $('tb-connection-detail').textContent=stateText[next.lastError]||'Подключение не установлено. Проверьте доступ к Telegram API.';
   $('tb-token').placeholder=next.tokenConfigured?'Токен сохранён ••••••••':'Вставьте токен нового бота';
   if(!modified){
    $('tb-admins').value=(next.adminIds||[]).join('\n');
    $('tb-enabled').checked=next.enabled===true;
   }
   return next;
  };
  $('tb-admins').value=(initial.adminIds||[]).join('\n');
  $('tb-enabled').checked=initial.enabled===true;
  $('tb-admins').addEventListener('input',()=>{modified=true;});
  $('tb-enabled').addEventListener('change',()=>{modified=true;});
  $('tb-token').addEventListener('input',()=>{modified=true;});
  $('tb-token-visibility').addEventListener('click',()=>{
   const input=$('tb-token');
   input.type=input.type==='password'?'text':'password';
   $('tb-token-visibility').textContent=input.type==='text'?'Скрыть':'Показать';
  });
  const feedback=(msg,error=false)=>{
   const element=$('tb-feedback');if(!element)return;
   element.textContent=msg;element.className='tb-feedback'+(error?' tb-error':'');
  };
  $('tb-config-form').addEventListener('submit',async event=>{
   event.preventDefault();
   const save=$('tb-save');save.disabled=true;
   feedback('Сохранение параметров…');
   try{
    const ids=parseAdmins($('tb-admins').value);
    const token=$('tb-token').value.trim();
    const body={enabled:$('tb-enabled').checked,adminIds:ids};
    if(token)body.token=token;
    const result=await request(API,{method:'PUT',body:JSON.stringify(body)});
    $('tb-token').value='';$('tb-token').type='password';
    $('tb-token-visibility').textContent='Показать';
    modified=false;
    feedback(result.enabled?'Сохранено. Бот подключается автоматически.':'Настройки сохранены. Бот выключен.');
    await status();
    toast('Настройки Telegram-бота сохранены');
   }catch(e){feedback(e.message||'Не удалось сохранить настройки.',true)}
   finally{save.disabled=false;}
  });
  $('tb-refresh').addEventListener('click',async()=>{
   try{await status();feedback('Статус обновлён.')}catch(e){feedback(e.message||'Ошибка соединения.',true);}
  });
  $('tb-clear').addEventListener('click',async()=>{
   if(!config.tokenConfigured)return feedback('Токен ещё не задан.');
   const approved=await confirm('Удалить токен и отключить Telegram-бота? Все администраторы останутся в списке.',{
    title:'Удалить токен бота',confirmLabel:'Удалить токен'
   });
   if(!approved)return;
   try{
    await request(API,{method:'PUT',body:JSON.stringify({
      enabled:false,adminIds:parseAdmins($('tb-admins').value),clearToken:true
    })});
    $('tb-token').value='';modified=false;
    await status();feedback('Токен удалён, бот отключён.');
   }catch(e){feedback(e.message||'Не удалось удалить токен.',true);}
  });
  const timer=setInterval(()=>{if(!$('tb-config-form'))return;status().catch(()=>{})},9000);
  schedule(timer);
  void status().catch(()=>{});
 }];
}
window.XMeshTelegramBot={page};
})();
