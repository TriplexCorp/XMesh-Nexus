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
  const decorate=(key,value=defaults[key],extra='')=>{
    const markup=field(spec(key),value);
    return markup.replace('class="f"',`class="f user-create-field ${extra}`.trim());
  };

  userNew=function userNewRedesigned(){
    if(!DB.squads.length){
      modal(`<div class="box"><h2>Сначала создайте сквад</h2><p class="note">Пользователю нужно назначить группу доступа. Создайте сквад, а затем вернитесь к созданию пользователя.</p><div class="act"><button class="gh" data-x>Отмена</button><button class="btn" data-ne="squads">${ic('plus')}Создать сквад</button></div></div>`);
      return;
    }

    const username=decorate('username','', 'user-create-username');
    const xrayProfile=decorate('xrayProfileId','', 'user-create-xray');
    const limit=decorate('limit',0,'user-create-limit');
    const days=decorate('days',0,'user-create-days');
    const strategy=decorate('strategy','NO_RESET','user-create-strategy');
    const hwid=decorate('hwid',0,'user-create-hwid');
    const tag=decorate('tag','', 'user-create-tag');
    const squads=decorate('squads',[], 'user-create-squads');
    const hold=decorate('hold',false,'user-create-hold');

    modal(`<form class="box user-create-dialog" data-k="user" method="dialog">
      <header class="user-create-head">
        <div class="user-create-title-wrap">
          <span class="user-create-title-icon">${ic('users')}</span>
          <div><h2>Новый пользователь</h2><p>Создайте пользователя и задайте параметры доступа</p></div>
        </div>
        <button type="button" class="user-create-close" data-x aria-label="Закрыть">${ic('x')}</button>
      </header>

      <div class="user-create-body">
        <section class="user-create-section user-create-section-main">
          <div class="user-create-section-head">
            <span class="user-create-section-icon">${ic('layers')}</span>
            <div><h3>Основные настройки</h3><p>Базовые параметры пользователя</p></div>
          </div>
          <div class="user-create-main-grid">
            <label class="f user-create-field user-create-template">
              <span>Шаблон</span>
              <select id="tplsel"><option value="">Без шаблона</option>${DB.tpls.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
              <small>При необходимости подставит параметры из сохранённого шаблона</small>
            </label>
            <div class="user-create-username-row">
              ${username}
              <button type="button" class="gh user-create-generate" data-generate-username title="Сгенерировать случайное уникальное имя" aria-label="Сгенерировать имя пользователя">${ic('redo')}<span>Сгенерировать</span></button>
            </div>
            ${xrayProfile}
          </div>
        </section>

        <section class="user-create-section user-create-section-limits">
          <div class="user-create-section-head">
            <span class="user-create-section-icon">${ic('activity')}</span>
            <div><h3>Ограничения</h3><p>Лимиты и срок действия</p></div>
          </div>
          <div class="user-create-limits-grid">${limit}${days}${strategy}${hwid}</div>
        </section>

        <section class="user-create-section user-create-section-extra">
          <div class="user-create-section-head">
            <span class="user-create-section-icon">${ic('sliders')}</span>
            <div><h3>Дополнительно</h3><p>Опции и служебная информация</p></div>
          </div>
          <div class="user-create-extra-grid">
            ${tag}
            ${squads}
            ${hold}
            <label class="f user-create-field user-create-desc">
              <span>Заметка</span>
              <textarea name="desc" rows="3" placeholder="Добавьте заметку (необязательно)" autocomplete="off"></textarea>
            </label>
          </div>
        </section>

        <p class="er user-create-error" id="fe"></p>
      </div>

      <footer class="user-create-footer">
        <button type="button" class="gh user-create-cancel" data-x>Отмена</button>
        <button class="btn user-create-submit">${ic('plus')}<span>Создать пользователя</span></button>
      </footer>
    </form>`,'user-create-modal');

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

  async function updateAgent(button){
    const id=Number(button.dataset.agentUpdate);
    const node=DB.nodes.find(item=>Number(item.id)===id);
    if(!node){toast('Узел не найден.');return}
    if(button.dataset.loading==='1')return;

    const original=button.innerHTML;
    button.dataset.loading='1';
    button.disabled=true;
    try{
      const runtime=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/runtime');
      if(!runtime.connected){
        throw new Error('Нет свежей связи с управляющим агентом. Проверьте подключение ноды.');
      }
      const version=String(runtime.version||'неизвестная версия');
      const confirmed=await panelConfirm(
        'Обновить управляющий Agent на «'+node.name+'»? Сейчас нода сообщает '+version+'. Поддержку безопасного самообновления автоматически проверит backend перед постановкой фиксированной команды. Ключи и настройки ноды не перевыпускаются.',
        {title:'Обновить Agent · '+node.name,confirmLabel:'Обновить Agent'}
      );
      if(!confirmed)return;

      if(typeof nodeAgentUpdating!=='undefined')nodeAgentUpdating.add(id);
      if(typeof paintNodeAgentUpdate==='function')paintNodeAgentUpdate(id,true);
      button.innerHTML=ic('refresh-cw')+'Проверка и обновление…';

      // No client-side version allow-list. The authenticated endpoint is the
      // single source of truth for whether this exact live Agent may self-update.
      const request=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/agent-update',{
        method:'POST',body:JSON.stringify({})
      });
      toast(node.name+': backend подтвердил возможность обновления, команда отправлена.');

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

      let observed=null;
      for(let attempt=0;attempt<8;attempt++){
        observed=await backendRequest('/api/v1/nodes/'+encodeURIComponent(id)+'/runtime');
        if(observed.connected&&observed.version===request.targetVersion)break;
        await sleep(2500);
      }
      toast(node.name+': '+(status.result||'Agent успешно обновлён')+
        (observed?.version!==request.targetVersion?' · ожидается новый heartbeat':''));
      if(typeof updateNodeRuntimeBadges==='function')updateNodeRuntimeBadges(node,observed);
    }catch(error){
      toast('Обновление Agent: '+(error?.message||'ошибка API'));
    }finally{
      if(typeof nodeAgentUpdating!=='undefined')nodeAgentUpdating.delete(id);
      if(typeof paintNodeAgentUpdate==='function')paintNodeAgentUpdate(id,false);
      button.dataset.loading='';
      button.disabled=false;
      button.innerHTML=original;
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
