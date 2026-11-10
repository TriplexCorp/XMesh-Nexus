'use strict';
// Compact per-user node quota editor. Reads only server-calculated, signed usage;
// saves policy changes via normal user PATCH and never submits usage counters.
window.XMeshNodeQuotas=(()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
  const fmt=bytes=>{
    if(bytes===null||bytes===undefined)return '∞';
    const number=Number(bytes);
    if(!Number.isFinite(number))return '—';
    if(number>0&&number<5_000_000)return '<0.01 ГБ';
    return (Math.max(0,number)/1e9).toLocaleString(window.XMeshI18n?.getLocale?.()||'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ГБ';
  };
  const txt=(ru,en)=>window.XMeshI18n?.getLanguage?.()==='en'?en:ru;
  const periodLabel=p=>p==='lifetime'?txt('За всё время','Lifetime'):txt('Ежемесячно','Monthly');
  const isEditable=editor=>!editor.readOnly;
  function markup(editor){
    const data=editor.items,configured=data.filter(x=>x.limitGb!==null).length;
    const rows=data.map((node,index)=>{
      const id=String(node.nodeId),name=String(node.name||(
        node.missing?txt('Удалённая нода','Deleted node')+' #'+id:
        txt('Нода','Node')+' #'+id));
      const bounded=node.limitGb!==null,used=Number(node.usedBytes||0);
      const total=bounded?Number(node.limitGb)*1e9:0;
      const percent=bounded&&total>0?Math.min(100,Math.max(0,Math.round(used/total*100))):0;
      const state=node.missing?txt('Отсутствует','Missing'):node.disabled?txt('Выключена','Disabled'):
        node.exhausted?txt('Исчерпана','Exhausted'):bounded?txt('Лимит','Limited'):txt('Безлимит','Unlimited');
      return '<div class="user-node-quota-row" data-node-quota-row="'+esc(id)+'" data-quota-name="'+esc(name.toLocaleLowerCase())+'"'+
        (index>=8?' hidden':'')+'>'+
        '<div class="user-node-quota-identity"><span class="user-node-quota-bullet'+(node.exhausted?' is-exhausted':'')+'"></span>'+
        '<div class="user-node-quota-name"><strong>'+esc(name)+'</strong><small>#'+esc(id)+' · '+esc(state)+
        (node.countryCode?' · '+esc(node.countryCode):'')+'</small></div></div>'+
        '<div class="user-node-quota-usage"><span>'+txt('Расход','Used')+': <b data-node-quota-used>'+fmt(used)+'</b></span>'+
        '<div class="user-node-quota-track"><i style="width:'+percent+'%"></i></div>'+
        '<small data-node-quota-balance>'+txt('Остаток','Remaining')+': '+fmt(node.remainingBytes)+'</small></div>'+
        '<label class="user-node-quota-input"><span>'+txt('Лимит, ГБ','Limit, GB')+'</span>'+
        '<input type="number" data-node-quota-limit min="0" max="1000000" step="any" inputmode="decimal" '+
        'aria-label="'+txt('Лимит для','Limit for')+' '+esc(name)+'" '+
        'placeholder="∞" value="'+(bounded?esc(node.limitGb):'')+'"'+
        (isEditable(editor)?'':' disabled')+'></label>'+
        '<label class="user-node-quota-select"><span>'+txt('Период','Period')+'</span>'+
        '<select data-node-quota-period'+(isEditable(editor)?'':' disabled')+'>'+
        '<option value="monthly"'+(node.period==='monthly'?' selected':'')+'>'+periodLabel('monthly')+'</option>'+
        '<option value="lifetime"'+(node.period==='lifetime'?' selected':'')+'>'+periodLabel('lifetime')+'</option>'+
        '</select></label></div>';
    }).join('');
    return '<section class="user-node-quota-editor" data-user-node-quota-editor>'+
      '<div class="user-node-quota-heading"><div><h3>'+txt('Индивидуальные квоты нод','Per-node quotas')+'</h3>'+
      '<p>'+txt('Независимые лимиты одного пользователя по серверам','Independent limits for this user on each server')+'</p></div>'+
      '<span class="user-node-quota-counter">'+configured+' / '+data.length+'</span></div>'+
      '<div class="user-node-quota-toolbar"><label class="user-node-quota-search">'+
      '<span>⌕</span><input type="search" data-node-quota-search placeholder="'+txt('Поиск нод…','Search nodes…')+'" aria-label="'+txt('Поиск нод','Search nodes')+'"></label>'+
      '<label class="user-node-quota-filter"><input type="checkbox" data-node-quota-limited-only> '+txt('Только с лимитами','Limited only')+'</label></div>'+
      '<div class="user-node-quota-list" data-node-quota-list>'+rows+'</div>'+
      '<div class="user-node-quota-actions">'+(data.length>8?'<button type="button" class="gh sm" data-node-quota-expand>'+txt('Показать все','Show all')+'</button>':'')+
      (isEditable(editor)?'<button type="button" class="btn sm" data-node-quota-save disabled>'+txt('Сохранить квоты','Save quotas')+'</button>':'')+
      '<span class="user-node-quota-message" data-node-quota-message role="status" aria-live="polite"></span></div>'+
      '<p class="user-node-quota-note">'+txt('0 или пусто — без ограничения на этой ноде. Лимит действует только для данного пользователя. Доступ изменится после синхронизации ноды.',
      'Zero or blank means unlimited on that node. This limit applies to this user only. Access updates after node synchronization.')+'</p>'+
      '</section>';
  }
  function updateVisibility(editor){
    const root=editor.root,search=(root.querySelector('[data-node-quota-search]')?.value||'').trim().toLocaleLowerCase();
    const only=root.querySelector('[data-node-quota-limited-only]')?.checked;
    let hits=0,visible=0;
    root.querySelectorAll('[data-node-quota-row]').forEach(row=>{
      const match=!search||row.dataset.quotaName.includes(search)||row.dataset.nodeQuotaRow.includes(search);
      const input=row.querySelector('[data-node-quota-limit]');
      const hasLimit=String(input?.value||'').trim()!==''&&Number(input.value)>0;
      if(match&&(!only||hasLimit)){
        hits++;
        const show=editor.expanded||Boolean(search)||Boolean(only)||visible<8;
        row.hidden=!show;
        if(show)visible++;
      }else row.hidden=true;
    });
    const expand=root.querySelector('[data-node-quota-expand]');
    if(expand){
      expand.hidden=Boolean(search)||Boolean(only)||hits<=8;
      expand.textContent=editor.expanded?txt('Свернуть','Collapse'):txt('Показать все','Show all');
    }
  }
  function readPolicies(editor){
    const policies={};
    for(const row of editor.root.querySelectorAll('[data-node-quota-row]')){
      const raw=row.querySelector('[data-node-quota-limit]').value.trim();
      const id=row.dataset.nodeQuotaRow;
      if(!raw||Number(raw)===0)continue;
      const amount=Number(raw);
      if(!Number.isFinite(amount)||amount<=0||amount>1000000||amount*1e9<1){
        throw Error(txt('Лимит должен быть положительным числом до 1 000 000 ГБ.','The limit must be a positive number up to 1,000,000 GB.'));
      }
      const period=row.querySelector('[data-node-quota-period]').value;
      if(!['monthly','lifetime'].includes(period))throw Error(txt('Некорректный период.','Invalid period.'));
      policies[id]={limitGb:amount,period};
    }
    return policies;
  }
  async function mount(root,{user,request,save,readOnly=false,notify}){
    if(!root)return;
    const editor={root,user,readOnly,expanded:false,items:[]};
    root.textContent=txt('Загружаем индивидуальные квоты…','Loading per-node quotas…');
    try{
      const result=await request('/api/v1/users/'+encodeURIComponent(user.id)+'/node-quotas');
      if(!root.isConnected||!Array.isArray(result.items))return;
      editor.items=result.items;
      root.innerHTML=markup(editor);
      root.addEventListener('input',event=>{
        if(event.target.matches('[data-node-quota-search]')){
          updateVisibility(editor);
        }else if(event.target.closest('[data-node-quota-row]')){
          const button=root.querySelector('[data-node-quota-save]');
          if(button)button.disabled=false;
          updateVisibility(editor);
        }
      });
      root.addEventListener('change',event=>{
        if(event.target.matches('[data-node-quota-limited-only]')){
          updateVisibility(editor);
        }else if(event.target.closest('[data-node-quota-row]')){
          const button=root.querySelector('[data-node-quota-save]');
          if(button)button.disabled=false;
          updateVisibility(editor);
        }
      });
      root.addEventListener('click',async event=>{
        if(event.target.closest('[data-node-quota-expand]')){
          editor.expanded=!editor.expanded;updateVisibility(editor);return;
        }
        const button=event.target.closest('[data-node-quota-save]');
        if(!button||readOnly)return;
        const status=root.querySelector('[data-node-quota-message]');
        let policies;
        try{policies=readPolicies(editor)}
        catch(e){if(status)status.textContent=e.message;return}
        button.disabled=true;
        if(status)status.textContent=txt('Сохраняем…','Saving…');
        try{
          await save({nodeTrafficLimits:policies});
          user.nodeTrafficLimits=policies;
          const updated=await request('/api/v1/users/'+encodeURIComponent(user.id)+'/node-quotas');
          if(!root.isConnected)return;
          editor.items=updated.items;
          editor.expanded=true;
          root.innerHTML=markup(editor);
          updateVisibility(editor);
          if(notify)notify(txt('Индивидуальные квоты сохранены','Per-node quotas saved'));
          const fresh=root.querySelector('[data-node-quota-message]');
          if(fresh)fresh.textContent=txt('Сохранено. Синхронизация нод применит ограничения.','Saved. Node synchronization will apply the limits.');
        }catch(e){
          if(status)status.textContent=txt('Ошибка: ','Error: ')+(e.message||'API');
          button.disabled=false;
        }
      });
      updateVisibility(editor);
    }catch(e){
      if(root.isConnected)root.textContent=txt('Не удалось загрузить квоты: ','Could not load quotas: ')+(e.message||'API');
    }
  }
  return Object.freeze({mount});
})();