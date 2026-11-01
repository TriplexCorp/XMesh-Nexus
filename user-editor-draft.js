(()=>{
  'use strict';

  const EDIT_FORM='form[data-k="uedit"]';
  const ACCESS_DRAFT='[data-hw],[data-usq]';

  const canvasFor=node=>node?.closest?.('.user-canvas')||null;
  const setDirty=node=>{
    const canvas=canvasFor(node);
    if(!canvas)return;
    const status=canvas.querySelector('[data-user-edit-dirty]');
    if(status)status.textContent=panelIsEnglish()?'Unsaved changes':'Есть несохранённые изменения';
  };
  const setError=(form,message)=>{
    const target=form.querySelector('#fe');
    if(target)target.textContent=message||'';
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

  // One authoritative Save: settings + squads + device limit go through a single
  // users update request. Explicit action buttons (reset traffic, revoke, etc.)
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
      deviceLimit?.focus();
      return;
    }

    data.hwid=hwid;
    data.squads=[...canvas.querySelectorAll(`[data-usq^="${id}:"]`)]
      .filter(input=>input.checked)
      .map(input=>Number(String(input.dataset.usq).split(':')[1]))
      .filter(Number.isFinite);

    const button=form.querySelector('[type="submit"]');
    const dirty=form.querySelector('[data-user-edit-dirty]');
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
