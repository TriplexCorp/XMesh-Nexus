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
const tbGlyphs={"bot":"<rect x=\"4\" y=\"7\" width=\"16\" height=\"12\" rx=\"4\"/><path d=\"M12 3v4M9 13h.01M15 13h.01M9 17h6\"/>","users":"<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6\"/>","link":"<path d=\"m10 13 4-4M8.5 16.5H7a4 4 0 0 1 0-8h3M14 8.5h3a4 4 0 0 1 0 8h-3\"/>","shield":"<path d=\"M12 2 20 6v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z\"/><path d=\"m9 12 2 2 4-4\"/>","search":"<circle cx=\"10.5\" cy=\"10.5\" r=\"6.5\"/><path d=\"m16 16 5 5\"/>","chart":"<path d=\"M4 20h16M7 16v-5m5 5V6m5 10v-8\"/>","lock":"<rect x=\"5\" y=\"10\" width=\"14\" height=\"11\" rx=\"2\"/><path d=\"M8 10V7a4 4 0 1 1 8 0v3M12 14v3\"/>","settings":"<path d=\"M4 7h16M4 17h16M8 4v6m8 4v6\"/>","check":"<path d=\"m4 12 5 5L20 6\"/>","refresh":"<path d=\"M20 7v5h-5M4 17v-5h5\"/><path d=\"M5.5 9a7 7 0 0 1 12-2l2.5 5M18.5 15a7 7 0 0 1-12 2L4 12\"/>","trash":"<path d=\"M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7M10 11v6m4-6v6\"/>","info":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 10v7m0-10h.01\"/>","lightning":"<path d=\"m13 2-9 12h7l-1 8 10-13h-7z\"/>"};
const tbGlyph=name=>'<svg class="tb-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+tbGlyphs[name]+'</svg>';
const card=()=>String.raw`
<section class="tb-workspace" aria-label="Управление Telegram-ботом">
  <header class="tb-banner">
    <div class="tb-banner-copy">
      <span class="tb-eyebrow"><span class="tb-status-pulse"></span> XMESH · CONTROL BOT</span>
      <h2>Встроенное администрирование в Telegram</h2>
      <p>Отдельный административный бот для управления XMesh Nexus. Укажите токен BotFather и доверенных администраторов — дополнительных серверов не требуется.</p>
      <div class="tb-banner-bottom">
        <a class="tb-help-link" href="#tb-capabilities">${tbGlyph('info')} Подробнее о боте</a>
        <span class="tb-pill" id="tb-live-status" role="status" aria-live="polite">Проверка…</span>
        <span id="tb-username" class="tb-bot-handle" translate="no"></span>
        <a id="tb-open-bot" class="tb-open-link" target="_blank" rel="noopener noreferrer" hidden>Открыть бота ↗</a>
      </div>
    </div>
    <div class="tb-banner-art" aria-hidden="true"><div class="tb-art-orbit"></div><div class="tb-art-circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg></div><span>CONTROL PLANE</span></div>
  </header>
  <div class="tb-status-grid" aria-label="Текущий статус">
    <div class="tb-metric"><span class="tb-metric-icon">${tbGlyph('bot')}</span><span>Статус бота</span><strong id="tb-metric-state">—</strong></div>
    <div class="tb-metric"><span class="tb-metric-icon">${tbGlyph('users')}</span><span>Администраторы</span><strong id="tb-metric-admins">—</strong></div>
    <div class="tb-metric"><span class="tb-metric-icon">${tbGlyph('link')}</span><span>Последнее подключение</span><strong id="tb-metric-check">—</strong></div>
  </div>
  <div class="tb-columns">
    <section class="tb-panel">
      <div class="tb-panel-head"><span class="tb-heading-icon">${tbGlyph('link')}</span><div><h3>Подключение и настройки</h3><p>Подключение Telegram-бота к панели и права доступа.</p></div></div>
      <form id="tb-config-form" autocomplete="off" novalidate>
        <label class="tb-field-label" for="tb-token">Токен BotFather</label>
        <div class="tb-token-field">
          <input id="tb-token" type="password" placeholder="Вставьте токен нового бота" autocomplete="new-password" spellcheck="false" maxlength="128" aria-describedby="tb-token-note"/>
          <button type="button" class="tb-minor" id="tb-token-visibility" aria-label="Показать или скрыть токен">Показать</button>
        </div>
        <p class="tb-field-help" id="tb-token-note">Токен создаётся в @BotFather. После сохранения он шифруется и не отображается повторно.</p>
        <div class="tb-field-head"><label class="tb-field-label" for="tb-admins">Telegram ID администраторов</label><span id="tb-admins-count" aria-live="polite">0 / 50</span></div>
        <textarea id="tb-admins" rows="3" placeholder="123456789&#10;987654321" spellcheck="false" aria-describedby="tb-admins-note"></textarea>
        <p class="tb-field-help" id="tb-admins-note">По одному ID на строке. Бот отвечает только указанным администраторам в личных чатах.</p>
        <div class="tb-enable-row">
          <span class="tb-enable-icon">${tbGlyph('settings')}</span>
          <div><strong>Встроенный бот</strong><small>Автозапуск и переподключение при сбое</small></div>
          <label class="tb-toggle" aria-label="Включить или выключить бота">
            <input type="checkbox" id="tb-enabled" role="switch"><span class="tb-toggle-track"></span>
          </label>
        </div>
        <div class="tb-form-actions">
          <button class="tb-primary" type="submit" id="tb-save">${tbGlyph('check')} Сохранить и применить</button>
          <button class="tb-secondary" type="button" id="tb-refresh">${tbGlyph('refresh')} Проверить статус</button>
          <button class="tb-danger" type="button" id="tb-clear">${tbGlyph('trash')} Удалить токен</button>
        </div>
        <p id="tb-feedback" class="tb-feedback" aria-live="polite"></p>
      </form>
    </section>
    <div class="tb-side">
      <section class="tb-panel tb-features" id="tb-capabilities">
        <div class="tb-panel-head"><span class="tb-heading-icon">${tbGlyph('lightning')}</span><div><h3>Возможности бота</h3><p>Что умеет Telegram-бот в XMesh Nexus.</p></div></div>
        <div class="tb-feature"><span class="tb-feature-icon">${tbGlyph('users')}</span><div><strong>Пользователи</strong><p>Карточки, продление, персональные ссылки и удаление с подтверждением.</p></div></div>
        <div class="tb-feature"><span class="tb-feature-icon">${tbGlyph('search')}</span><div><strong>Поиск</strong><p>По имени или идентификатору пользователя.</p></div></div>
        <div class="tb-feature"><span class="tb-feature-icon">${tbGlyph('chart')}</span><div><strong>Сводка</strong><p>Состояние пользователей и нод.</p></div></div>
        <div class="tb-feature"><span class="tb-feature-icon">${tbGlyph('lock')}</span><div><strong>Управление доступом</strong><p>Включение, отключение и удаление с одноразовым подтверждением.</p></div></div>
      </section>
      <section class="tb-note-card">
        <span class="tb-heading-icon">${tbGlyph('shield')}</span><div><strong>Защита по умолчанию</strong>
        <p>Только личный чат, доверенные Telegram ID, лимиты запросов и аудит. Удаление требует одноразового подтверждения на 60 секунд. Персональные ссылки являются секретами.</p></div>
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
    syncAdminCount();
    $('tb-enabled').checked=next.enabled===true || !next.tokenConfigured;
   }
   return next;
  };
  $('tb-admins').value=(initial.adminIds||[]).join('\n');
  $('tb-enabled').checked=initial.enabled===true || !initial.tokenConfigured;
  const syncAdminCount=()=>{
   const count=$('tb-admins').value.split(/[\s,;]+/).filter(Boolean).length;
   $('tb-admins-count').textContent=count+' / 50';
   $('tb-admins-count').classList.toggle('tb-over-limit',count>50);
  };
  syncAdminCount();
  $('tb-admins').addEventListener('input',()=>{modified=true;syncAdminCount();});
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
