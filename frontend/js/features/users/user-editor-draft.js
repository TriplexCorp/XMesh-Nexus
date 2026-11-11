(()=>{
  'use strict';

  // Panels stay mounted so settings and access remain one unsaved draft.
  const select=(canvas,key,focus=false)=>{
    if(!canvas||!['ov','acc','routing','traffic','dev'].includes(key))return;
    UT=key;
    for(const tab of canvas.querySelectorAll('[data-user-editor-tab]')){
      const active=tab.dataset.userEditorTab===key;
      tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
      if(active&&focus)tab.focus();
    }
    for(const pane of canvas.querySelectorAll('[data-user-editor-pane]')){
      const active=pane.dataset.userEditorPane===key;
      pane.dataset.active=String(active);pane.inert=!active;pane.setAttribute('aria-hidden',String(!active));
    }
    const body=canvas.querySelector('.user-canvas-grid');
    if(body)body.scrollTop=0;
    window.XMeshSelects?.refresh(canvas.querySelector('[data-user-editor-pane][data-active="true"]'));
  };
  window.XMeshUserTabs=Object.freeze({select});
  document.addEventListener('click',event=>{
    const tab=event.target.closest?.('[data-user-editor-tab]');
    if(tab)select(tab.closest('.user-canvas'),tab.dataset.userEditorTab);
  });
  document.addEventListener('keydown',event=>{
    const tab=event.target.closest?.('[data-user-editor-tab]');
    if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const canvas=tab.closest('.user-canvas'),tabs=[...canvas.querySelectorAll('[data-user-editor-tab]')],index=tabs.indexOf(tab);
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    select(canvas,tabs[next].dataset.userEditorTab,true);
  });
  document.addEventListener('invalid',event=>{
    const pane=event.target.closest?.('[data-user-editor-pane]');
    if(pane)select(pane.closest('.user-canvas'),pane.dataset.userEditorPane);
  },true);

  const EDIT_FORM='form[data-k="uedit"]';
  const ACCESS_DRAFT='[data-hw],[data-usq]';

  const canvasFor=node=>node?.closest?.('.user-canvas')||null;
  const setDirty=node=>{
    const canvas=canvasFor(node);
    if(!canvas)return;
    const status=canvas.querySelector('[data-user-edit-dirty]');
    if(status)status.textContent=panelIsEnglish()?'Unsaved changes':'Есть несохранённые изменения';
  };
  const setError=(form,message,tab='ov')=>{
    const target=canvasFor(form)?.querySelector('#fe');
    if(target)target.textContent=message||'';
    if(message)select(canvasFor(form),tab);
  };

  // Access controls belong to the same draft as the main settings form.
  // Capture them before the legacy bubbling handler can persist them immediately.
  document.addEventListener('change',event=>{
    const target=event.target;
    if(!target?.matches?.(ACCESS_DRAFT)||!canvasFor(target))return;
    event.stopImmediatePropagation();
    setDirty(target);
  },true);

  // The device limit should become visibly dirty while typing, not only on blur.
  document.addEventListener('input',event=>{
    const target=event.target;
    if(!target?.matches?.('[data-hw]')||!canvasFor(target))return;
    setDirty(target);
  },true);

  // One authoritative Save: settings, squads, device limit and edited node quotas
  // go through one atomic user PATCH. Explicit actions (reset traffic, revoke, etc.)
  // remain separate intentional actions.
  document.addEventListener('submit',async event=>{
    const form=event.target?.matches?.(EDIT_FORM)?event.target:null;
    if(!form)return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if(form.dataset.saving==='1')return;

    const id=Number(form.dataset.id);
    const canvas=canvasFor(form);
    if(!Number.isFinite(id)||!canvas)return;

    const data=read(FE,form);
    if(DB.users.some(user=>user.username.toLowerCase()===data.username.toLowerCase()&&Number(user.id)!==id)){
      setError(form,panelIsEnglish()?'This username already exists.':'Такое имя уже есть.');
      return;
    }

    const deviceLimit=canvas.querySelector(`[data-hw="${id}"]`);
    const rawLimit=String(deviceLimit?.value??'0').trim();
    const hwid=rawLimit===''?0:Number(rawLimit);
    if(!Number.isInteger(hwid)||hwid<0){
      setError(form,panelIsEnglish()?'Device limit must be a non-negative integer.':'Лимит устройств должен быть целым числом от 0.');
      select(canvas,'acc');
      deviceLimit?.focus();
      return;
    }

    try{
      const personal=window.XMeshUserClientRouting?.serialize(canvas);
      if(personal)data.clientRouting=personal;
    }catch(error){
      setError(form,error?.message||'Invalid personal routing');
      select(canvas,error?.tab||'routing');
      return;
    }

    // An unedited (or still-loading) quota panel must never clear existing
    // policies. Edited quota fields join the same user PATCH as all other tabs.
    try{
      const policies=window.XMeshNodeQuotas?.readDraft?.(canvas.querySelector('[data-user-node-quotas]'));
      if(policies!==null&&policies!==undefined)data.nodeTrafficLimits=policies;
    }catch(error){
      setError(form,error?.message||'Invalid node quotas','traffic');
      error?.field?.focus?.();
      return;
    }

    data.hwid=hwid;
    data.squads=[...canvas.querySelectorAll(`[data-usq^="${id}:"]`)]
      .filter(input=>input.checked)
      .map(input=>Number(String(input.dataset.usq).split(':')[1]))
      .filter(Number.isFinite);

    const button=canvas.querySelector('.user-save-button');
    const dirty=canvas.querySelector('[data-user-edit-dirty]');
    setError(form,'');
    form.dataset.saving='1';
    if(button)button.disabled=true;
    if(dirty)dirty.textContent=panelIsEnglish()?'Saving…':'Сохраняем…';

    try{
      await api.update('users',id,data);
      if(dlg.open&&dlg.contains(form))dlg.close();
      toast(panelIsEnglish()?'Changes saved':'Изменения сохранены');
      render(1);
    }catch(error){
      setError(form,(panelIsEnglish()?'Could not save user: ':'Не удалось сохранить пользователя: ')+(error?.message||'API error'));
      if(dirty)dirty.textContent=panelIsEnglish()?'Unsaved changes':'Есть несохранённые изменения';
    }finally{
      delete form.dataset.saving;
      if(button?.isConnected)button.disabled=false;
    }
  },true);
})();
