'use strict';

// The shared panel confirmation is deliberately non-destructive and resolves
// through its existing Cancel button. Add a visual close control without
// bypassing that contract: clicking X delegates to the same cancel action.
(()=>{
  const closeIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function enhance(dialog){
    if(!(dialog instanceof HTMLDialogElement))return;
    if(!dialog.matches('dialog.xm-action-confirm'))return;
    if(!dialog.querySelector('.xm-action-confirm-icon'))return;
    if(dialog.querySelector('[data-node-confirm-close]'))return;
    const box=dialog.querySelector('.xm-action-confirm-box');
    if(!box)return;

    const close=document.createElement('button');
    close.type='button';
    close.className='xm-action-confirm-close';
    close.dataset.nodeConfirmClose='';
    close.setAttribute('aria-label','Закрыть');
    close.innerHTML=closeIcon;
    close.addEventListener('click',()=>{
      const cancel=dialog.querySelector('.xm-action-confirm-actions .gh');
      if(cancel instanceof HTMLButtonElement)cancel.click();
      else dialog.close();
    });
    box.append(close);
  }

  function scan(root=document){
    if(root instanceof HTMLDialogElement)enhance(root);
    root.querySelectorAll?.('dialog.xm-action-confirm').forEach(enhance);
  }

  scan();
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
    if(node.nodeType===1)scan(node);
  }))).observe(document.documentElement,{childList:true,subtree:true});
})();

// The new-user dialog is composed here rather than changing the generic field
// renderer. Existing submit/template/generator handlers remain authoritative;
// only the visual grouping and dialog surface change.
(()=>{
  const defaults={limit:0,days:0,strategy:'NO_RESET',hwid:0,squads:[]};
  const spec=key=>FU.find(item=>item.k===key);

  const inputGlyph=key=>{
    if(key==='tg')return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></svg>';
    if(key==='email')return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>';
    if(key==='tag')return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m20 13-7 7a2 2 0 0 1-2.83 0L3 12.83V4h8.83L20 12.17a2 2 0 0 1 0 2.83Z"/><circle cx="8" cy="8.5" r="1"/></svg>';
    const name={limit:'activity',cdnLimitGb:'globe',hwid:'monitor'}[key];
    return name?ic(name):'';
  };
  const decorate=(key,value=defaults[key],extra='')=>{
    const markup=field(spec(key),value);
    // Keep the generated HTML valid. The previous replacement accidentally
    // dropped the closing quote of class="...", causing every following select
    // and section to be reparsed as broken markup by the browser.
    const decorated=markup.replace('class="f"',`class="f user-create-field ${extra}"`.trim());
    if(key==='hold')return decorated.replace('<span>Отсчёт',`<span class="user-create-hold-caption">${ic('calendar')}Отсчёт`);
    const glyph=inputGlyph(key);
    return glyph?decorated.replace(/(<input\b[^>]*>)/,`<span class="user-create-input-wrap"><span class="user-create-input-icon" aria-hidden="true">${glyph}</span>$1</span>`):decorated;
  };

  userNew=function userNewRedesigned(){
    if(!DB.squads.length){
      modal(`<div class="box"><h2>Сначала создайте сквад</h2><p class="note">Пользователю нужно назначить группу доступа. Создайте сквад, а затем вернитесь к созданию пользователя.</p><div class="act"><button class="gh" data-x>Отмена</button><button class="btn" data-ne="squads">${ic('plus')}Создать сквад</button></div></div>`);
      return;
    }

    const username=decorate('username','', 'user-create-username').replace('name="username"','name="username" placeholder="Введите имя пользователя"');
    const xrayProfile=decorate('xrayProfileId','', 'user-create-xray');
    const telegram=decorate('tg','', 'user-create-tg');
    const email=decorate('email','', 'user-create-email');
    const limit=decorate('limit',0,'user-create-limit');
    const cdnLimit=decorate('cdnLimitGb',0,'user-create-cdn-limit');
    const days=decorate('days',0,'user-create-days');
    const strategy=decorate('strategy','NO_RESET','user-create-strategy');
    const hwid=decorate('hwid',0,'user-create-hwid');
    const tag=decorate('tag','', 'user-create-tag');
    const squads=decorate('squads',[], 'user-create-squads');
    const hold=decorate('hold',false,'user-create-hold');
    const nodeQuotas=window.XMeshNodeQuotas.createMarkup(DB.nodes);

    modal(`<form class="box user-create-dialog" data-k="user" method="dialog">
      <header class="user-create-head">
        <div class="user-create-title-wrap">
          <span class="user-create-title-icon">${ic('users')}</span>
          <div><span class="user-create-eyebrow">IDENTITY / ACCESS</span><h2>Новый пользователь</h2><p>Создайте учётную запись с нужным уровнем доступа и ограничениями.</p></div>
        </div>
        <button type="button" class="user-create-close" data-x aria-label="Закрыть">×</button>
      </header>

      <div class="user-create-body">
        <div class="user-create-workspace">
          <section class="user-create-section user-create-section-main">
            <div class="user-create-section-head">
              <span class="user-create-section-icon">${ic('layers')}</span>
              <div><span class="user-create-section-kicker">IDENTITY & ACCESS</span><h3>Профиль доступа</h3><p>Основные параметры учётной записи.</p></div>
            </div>
            <div class="user-create-main-grid">
              <div class="user-create-username-row">
                ${username}
                <button type="button" class="gh user-create-generate" data-generate-username title="Сгенерировать случайное уникальное имя" aria-label="Сгенерировать имя пользователя">${ic('redo')}<span>Сгенерировать</span></button>
              </div>
              <label class="f user-create-field user-create-template">
                <span>Шаблон</span>
                <select id="tplsel"><option value="">Без шаблона</option>${DB.tpls.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
                <small>Можно быстро подставить сохранённые параметры.</small>
              </label>
              ${xrayProfile}
              <div class="user-create-contacts">
                <div class="user-create-contact-label"><span>Контактные данные</span><small>Необязательно</small></div>
                <div class="user-create-contact-grid">${telegram}${email}</div>
              </div>
            </div>
          </section>

          <section class="user-create-section user-create-section-limits">
            <div class="user-create-section-head">
              <span class="user-create-section-icon">${ic('activity')}</span>
              <div><span class="user-create-section-kicker">POLICY</span><h3>Ограничения</h3><p>Доступ, трафик и устройства.</p></div>
            </div>
            <div class="user-create-limits-grid">${limit}${cdnLimit}${days}${strategy}${hwid}
              <div class="user-create-policy-note"><span>${ic('shield')}</span><p><b>Умный лимит устройств</b><small>Автоматический контроль при лимите больше 0.</small></p><label class="user-create-smart-switch" title="Включить или отключить лимит устройств"><input type="checkbox" data-user-create-hwid-switch aria-label="Ограничивать число устройств"><span></span></label></div>
            </div>
          </section>

          ${nodeQuotas}

          <section class="user-create-section user-create-section-extra">
            <div class="user-create-section-head">
              <span class="user-create-section-icon">${ic('sliders')}</span>
              <div><span class="user-create-section-kicker">METADATA</span><h3>Дополнительно</h3><p>Дополнительные параметры доступа и учётной записи.</p></div>
            </div>
            <div class="user-create-extra-grid">
              ${squads}
              ${tag}
              ${hold}
              <label class="f user-create-field user-create-desc">
                <span>Заметка</span>
                <textarea name="desc" rows="3" placeholder="Комментарий для администраторов (необязательно)" autocomplete="off"></textarea>
              </label>
            </div>
          </section>
        </div>

        <p class="er user-create-error" id="fe"></p>
      </div>

      <footer class="user-create-footer">
        <div class="user-create-footer-copy"><b>Новая учётная запись</b><span>Параметры можно изменить после создания.</span></div>
        <div class="user-create-footer-actions">
          <button type="button" class="gh user-create-cancel" data-x>Отмена</button>
          <button class="btn user-create-submit">${ic('plus')}<span>Создать пользователя</span></button>
        </div>
      </footer>
    </form>`,'user-create-modal');

    // Dynamic selects are enhanced synchronously after the complete valid form
    // exists, avoiding a one-frame native/fallback flash inside the modal.
    window.XMeshSelects?.refresh?.(dlg);
    window.XMeshNodeQuotas.bindCreate(dlg.querySelector('form[data-k="user"]'));
    // The switch controls the existing server-enforced hwid limit:
    // off = 0; on = the previous positive value or 1.
    const deviceLimitInput=dlg.querySelector('input[name="hwid"]');
    const smartSwitch=dlg.querySelector('[data-user-create-hwid-switch]');
    if(deviceLimitInput&&smartSwitch){
      let previousPositiveLimit=1;
      const syncSmartSwitch=()=>{
        const value=Math.max(0,Number(deviceLimitInput.value)||0);
        if(value>0)previousPositiveLimit=value;
        smartSwitch.checked=value>0;
      };
      deviceLimitInput.addEventListener('input',syncSmartSwitch);
      smartSwitch.addEventListener('change',()=>{
        deviceLimitInput.value=smartSwitch.checked?String(previousPositiveLimit):'0';
        deviceLimitInput.dispatchEvent(new Event('input',{bubbles:true}));
      });
      dlg.querySelector('#tplsel')?.addEventListener('change',()=>setTimeout(syncSmartSwitch,0));
      syncSmartSwitch();
    }
    setTimeout(()=>$('[name=username]')?.focus(),60);
  };
})();

// Agent self-update capability belongs to the authenticated backend, not to a
// frontend version whitelist. This capture handler intentionally supersedes the
// historical app.js handler, which hard-coded only control-v4/v5 and therefore
// rejected a healthy control-v6 agent. Future Agent majors are accepted or
// rejected by the server-side command gate without another UI regex edit.
(()=>{
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  // No client-side version allow-list. Single-card and fleet Agent upgrades
  // use the exact same authenticated backend command. The server determines
  // eligibility from the live signed heartbeat.
  const pendingAgentUpdates=new Set();
  async function updateOneAgent(id,{confirm=true,notify=true,onStage=()=>{}}={}){
    id=Number(id);
    const node=DB.nodes.find(item=>Number(item.id)===id);
    if(!node)throw new Error('Узел не найден.');
    if(!Number.isSafeInteger(id)||id<1||pendingAgentUpdates.has(id)||
       (typeof nodeAgentUpdating!=='undefined'&&nodeAgentUpdating.has(id))){
      throw new Error('Обновление Agent уже выполняется для этой ноды.');
    }
    pendingAgentUpdates.add(id);
    let started=false,observed=null;
    const stage=value=>{try{onStage(value)}catch(_){/* progress UI may be closed */}};
    try{
      stage('checking');
      const runtime=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/runtime');
      if(!runtime.connected){
        throw new Error('Нет свежей связи с управляющим агентом. Проверьте подключение ноды.');
      }
      const version=String(runtime.version||'неизвестная версия');
      if(confirm){
        const accepted=await panelConfirm(
          'Обновить управляющий Agent на «'+node.name+'»? Сейчас нода сообщает '+version+'. Поддержку безопасного самообновления автоматически проверит backend перед постановкой фиксированной команды. Ключи и настройки ноды не перевыпускаются.',
          {title:'Обновить Agent · '+node.name,confirmLabel:'Обновить Agent'}
        );
        if(!accepted)return {cancelled:true};
      }
      if(typeof nodeAgentUpdating!=='undefined')nodeAgentUpdating.add(id);
      started=true;
      if(typeof paintNodeAgentUpdate==='function')paintNodeAgentUpdate(id,true);
      stage('sending');
      const request=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/agent-update',{
        method:'POST',body:JSON.stringify({})
      });
      if(notify)toast(node.name+': backend подтвердил возможность обновления, команда отправлена.');
      stage('installing');
      const deadline=Date.now()+900000;
      let status=null;
      while(Date.now()<deadline){
        await sleep(3000);
        status=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/restart');
        if(status.id!==request.id)throw new Error('Очередь команд ноды изменилась.');
        if(status.state==='succeeded')break;
        if(status.state==='failed')throw new Error(status.result||'Agent не смог завершить обновление.');
      }
      if(status?.state!=='succeeded')throw new Error('Agent не подтвердил установку в течение 15 минут.');
      stage('verifying');
      for(let attempt=0;attempt<8;attempt++){
        observed=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/runtime');
        if(observed.connected&&observed.version===request.targetVersion)break;
        await sleep(2500);
      }
      const warning=observed?.version!==request.targetVersion;
      if(notify)toast(node.name+': '+(status.result||'Agent успешно обновлён')+
        (warning?' · ожидается новый heartbeat':''));
      return {id,name:node.name,targetVersion:request.targetVersion,warning,
        message:status.result||'Agent успешно обновлён'};
    }finally{
      pendingAgentUpdates.delete(id);
      if(started){
        if(typeof nodeAgentUpdating!=='undefined')nodeAgentUpdating.delete(id);
        if(typeof paintNodeAgentUpdate==='function')paintNodeAgentUpdate(id,false);
        if(observed&&typeof updateNodeRuntimeBadges==='function')updateNodeRuntimeBadges(node,observed);
      }
    }
  }

  window.XMeshNodeAgentOps=Object.freeze({
    updateOne:(id,options)=>updateOneAgent(id,{...options,confirm:false,notify:false}),
    isUpdating:id=>pendingAgentUpdates.has(Number(id))
  });

  async function updateAgent(button){
    const id=Number(button.dataset.agentUpdate);
    if(button.dataset.loading==='1')return;
    const original=button.innerHTML;
    button.dataset.loading='1';button.disabled=true;
    try{
      await updateOneAgent(id,{onStage:step=>{
        if(step==='sending'||step==='installing'||step==='verifying'){
          button.innerHTML=ic('refresh-cw')+'Проверка и обновление…';
        }
      }});
    }catch(error){
      toast('Обновление Agent: '+(error?.message||'ошибка API'));
    }finally{
      delete button.dataset.loading;
      if(button.isConnected){button.disabled=false;button.innerHTML=original}
    }
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-agent-update]');
    if(!button)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void updateAgent(button);
  },true);
})();
