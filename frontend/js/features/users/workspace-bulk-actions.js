'use strict';

/* One selection/operations contract for inventory workspaces. No hidden
 * server-side bulk endpoint: every change uses the existing validated API. */
(()=>{
 const specs=[
  {kind:'nodes',root:'.nodes-page',toolbar:'.nodes-toolbar',cards:'[data-node-card-id]',key:'data-node-card-id',actions:['enable','disable','agent-update','delete']},
  {kind:'hosts',root:'.host-directory',toolbar:'.host-directory-toolbar',cards:'[data-host-card-id]',key:'data-host-card-id',actions:['enable','disable','delete']},
  {kind:'squads',root:'.squad-directory',toolbar:'.squad-directory-toolbar',cards:'[data-squad-card]',key:'data-squad-card',actions:['delete']},
  {kind:'tpls',root:'[data-template-section="tpls"]',toolbar:'.template-section-tools',cards:'[data-template-card^="tpls:"]',key:'data-template-card',actions:['delete']},
  {kind:'subs',root:'[data-template-section="subs"]',toolbar:'.template-section-tools',cards:'[data-template-card^="subs:"]',key:'data-template-card',actions:['delete']},
  {kind:'balancers',root:'.balancer-workspace',toolbar:'.balancer-toolbar',cards:'[data-balancer-index]',key:'data-balancer-index',actions:['enable','disable','delete'],draft:true}
 ];
 const state=new Map(),bound=new WeakSet(),draftHandlers=new WeakMap();
 const trans=(ru,en)=>typeof panelIsEnglish==='function'&&panelIsEnglish()?en:ru;
 const selection=kind=>{
  if(!state.has(kind))state.set(kind,{mode:false,ids:new Set(),busy:false,batch:null});
  return state.get(kind);
 };
 const keyOf=(card,spec)=>{
  const value=card.getAttribute(spec.key)||'';
  return spec.kind==='tpls'||spec.kind==='subs'?value.slice(value.indexOf(':')+1):value;
 };
 const cardsFor=(root,spec)=>[...root.querySelectorAll(spec.cards)];
 const visibleCards=(root,spec)=>cardsFor(root,spec).filter(card=>!card.hidden&&card.getClientRects().length>0);
 const actionText=action=>({
  enable:trans('Включить','Enable'),disable:trans('Отключить','Disable'),
  delete:trans('Удалить','Delete'),
  'agent-update':trans('Обновить Agent','Update Agent')
 })[action];
 const bulkIcon=(name,label)=>ic(name)+'<span class="nx-bulk-action-label">'+label+'</span>';
 const actionIcon=action=>({enable:'play',disable:'pause',delete:'trash','agent-update':'refresh-cw'})[action]||'sliders';
 const cardName=(kind,id)=>{
  if(kind==='balancers')return '#'+id;
  const record=(DB[kind]||[]).find(row=>String(row.id)===String(id));
  return String(record?.name||record?.remark||record?.username||id);
 };
 function mount(root=document,config={}){
  if(typeof viewerMode==='function'&&viewerMode())return;
  for(const spec of specs){
   const contexts=[];
   if(root.matches?.(spec.root))contexts.push(root);
   contexts.push(...root.querySelectorAll?.(spec.root)||[]);
   for(const area of contexts){
    const toolbar=area.querySelector(spec.toolbar);
    if(!toolbar)continue;
    if(spec.draft&&typeof config.handleDraft==='function')draftHandlers.set(area,config.handleDraft);
    if(!toolbar.querySelector('[data-bulk-toolbar]')){
     const group=document.createElement('div');
     group.className='nx-bulk-toolbar';
     group.dataset.bulkToolbar=spec.kind;
     group.setAttribute('role','toolbar');
     group.setAttribute('aria-label',trans('Массовые операции','Bulk operations'));
     // The entry point belongs to the action cluster, immediately before
     // density controls (not to the leading search or a floating row).
     const actions=toolbar.querySelector('.node-grid-controls,.nx-workspace-grid-controls,.nx-workspace-actions,.node-create-action,.nx-workspace-create');
     toolbar.insertBefore(group,actions||null);
    }
    // A single framed toolbar owns every batch action. Never create an
    // extra floating selection toolbar between controls and cards.
    area.querySelector(':scope > .nx-bulk-context')?.remove();
    if(!bound.has(area)){
     bound.add(area);
     area.addEventListener('change',event=>{
      const input=event.target.closest('[data-bulk-check]');
      if(!input||!area.contains(input))return;
      const st=selection(spec.kind),id=input.dataset.bulkCheck;
      input.checked?st.ids.add(id):st.ids.delete(id);
      update(area,spec);
     });
     // Selection must not activate the parent card's open/edit handler.
     area.addEventListener('click',event=>{
      if(event.target.closest('.nx-bulk-check'))event.stopPropagation();
      const button=event.target.closest('[data-bulk-action]');
      if(!button||!area.contains(button))return;
      event.preventDefault();event.stopPropagation();
      if(selection(spec.kind).busy)return;
      const action=button.dataset.bulkAction,st=selection(spec.kind);
      if(action==='mode'){
       st.mode=!st.mode;
       if(st.mode&&st.batch)st.batch=null;
       if(!st.mode){st.ids.clear();st.batch=null;}
       update(area,spec);
      }else if(action==='all'){
       for(const card of visibleCards(area,spec))st.ids.add(keyOf(card,spec));
       update(area,spec);
      }else if(action==='clear'){
       st.ids.clear();update(area,spec);
      }else if(spec.actions.includes(action)){
       void execute(area,spec,action);
      }
     });
    }
    update(area,spec);
   }
  }
 }
 function update(area,spec){
  const bar=area.querySelector('[data-bulk-toolbar]'),st=selection(spec.kind);
  if(!bar)return;
  const records=spec.draft?null:new Set((DB[spec.kind]||[]).map(x=>String(x.id)));
  for(const id of st.ids){
   if(records&&!records.has(id))st.ids.delete(id);
  }
  const cards=cardsFor(area,spec);
  for(const card of cards){
   const id=keyOf(card,spec);
   let input=card.querySelector(':scope > .nx-bulk-check, :scope > header > .nx-bulk-check');
   if(!input){
    const heading=card.querySelector(':scope > header')||card;
    const label=document.createElement('label');
    label.className='nx-bulk-check';
    const box=document.createElement('input');
    box.type='checkbox';box.dataset.bulkCheck=id;
    box.setAttribute('aria-label',trans('Выбрать ','Select ')+cardName(spec.kind,id));
    const face=document.createElement('span');face.className='nx-bulk-check-face';
    label.append(box,face);
    heading.insertBefore(label,heading.firstChild);
    input=label;
   }
   const box=input.querySelector('input');
   box.dataset.bulkCheck=id;box.checked=st.ids.has(id);
   card.classList.toggle('nx-bulk-selected',st.mode&&box.checked);
  }
  area.classList.toggle('nx-bulk-selecting',st.mode);
  const n=st.ids.size,show=cards.length>0;
  bar.hidden=!show;
  if(!show)return;
  const reportOpen=bar.querySelector('details.nx-bulk-report')?.open||false;
  const menuOpen=bar.querySelector('details.nx-bulk-actions')?.open||false;
  bar.classList.toggle('is-selecting',st.mode);
  const modeLabel=st.mode?trans('Завершить выбор','Finish selection'):trans('Массовые действия','Bulk actions');
  bar.innerHTML='<button type="button" class="gh sm nx-bulk-mode" data-bulk-action="mode" aria-pressed="'+st.mode+'"'+(st.busy?' disabled':'')+
    ' title="'+modeLabel+'">'+bulkIcon(st.mode?'check':'layers',modeLabel)+'</button>'+
    (st.mode?'<div class="nx-bulk-inline-controls">'+
      '<span class="nx-bulk-count" aria-live="polite">'+ic('check')+trans('Выбрано: ','Selected: ')+n+'</span>'+
      '<button type="button" class="gh sm nx-bulk-select-all" data-bulk-action="all" aria-label="'+trans('Все видимые','All visible')+'" title="'+trans('Все видимые','All visible')+'"'+(st.busy?' disabled':'')+'>'+bulkIcon('check',trans('Все видимые','All visible'))+'</button>'+
      '<button type="button" class="gh sm nx-bulk-clear" data-bulk-action="clear" aria-label="'+trans('Снять выбор','Clear')+'" title="'+trans('Снять выбор','Clear')+'"'+(!n||st.busy?' disabled':'')+'>'+bulkIcon('x',trans('Снять выбор','Clear'))+'</button>'+
      '<details class="nx-bulk-actions"'+(menuOpen&&n&&!st.busy?' open':'')+'><summary class="gh sm" aria-label="'+trans('Массовые операции','Bulk operations')+'"'+(!n||st.busy?' aria-disabled="true"':'')+'>'+bulkIcon('sliders',trans('Действия','Actions'))+ic('down')+'</summary>'+
      '<div class="nx-bulk-actions-menu">'+spec.actions.map(action=>'<button type="button" data-bulk-action="'+action+'" class="'+(action==='delete'?'is-danger':'')+'"'+(st.busy||!n?' disabled':'')+'>'+bulkIcon(actionIcon(action),actionText(action))+'</button>').join('')+'</div></details>'+
      (spec.draft?'<span class="nx-bulk-draft">'+trans('Применяется после сохранения','Save to apply')+'</span>':'')+
    '</div>':'');
  if(st.batch){
    const report=document.createElement('details');
    report.className='nx-bulk-report';report.open=reportOpen;
    report.setAttribute('aria-label',trans('Ход обновления Agent','Agent update progress'));
    const total=st.batch.items.length,done=st.batch.items.filter(item=>['success','error'].includes(item.status)).length;
    const failed=st.batch.items.filter(item=>item.status==='error').length;
    const title=document.createElement('summary');
    title.className='nx-bulk-report-summary';
    title.innerHTML=ic('refresh-cw');
    const titleText=document.createElement('span');
    titleText.textContent=trans('Обновление Agent: ','Agent update: ')+done+' / '+total+
      (failed?' · '+trans('ошибок: ','failed: ')+failed:'');
    title.append(titleText);
    const list=document.createElement('div');
    list.className='nx-bulk-report-list';
    for(const item of st.batch.items){
      const row=document.createElement('div');
      row.className='nx-bulk-report-row is-'+item.status;
      const name=document.createElement('b');name.textContent=item.name;
      const status=document.createElement('span');status.textContent=item.message||trans('Ожидает','Pending');
      row.append(name,status);list.append(row);
    }
    report.append(title,list);bar.append(report);
  }
  if(st.busy)bar.setAttribute('aria-busy','true');
  else bar.removeAttribute('aria-busy');
 }
 async function updateNodeAgents(area,spec,eligible){
  const st=selection(spec.kind);
  const ops=window.XMeshNodeAgentOps;
  if(!ops||typeof ops.updateOne!=='function'){
   st.busy=false;update(area,spec);
   toast(trans('Обновление Agent недоступно. Обновите страницу.','Agent update is unavailable. Reload the page.'));
   return;
  }
  const items=eligible.map(id=>({
   id,name:cardName('nodes',id),status:'pending',message:trans('Ожидает','Pending')
  }));
  st.batch={items};
  update(area,spec);
  let cursor=0;
  const stageLabels={
   checking:trans('Проверка связи','Checking connection'),
   sending:trans('Отправка команды','Sending command'),
   installing:trans('Установка Agent','Installing Agent'),
   verifying:trans('Проверка версии','Verifying version')
  };
  // A maximum of two live commands. Per-node in-flight locking also
  // prevents a repeated single-card update while a fleet job is running.
  const worker=async()=>{
   while(cursor<items.length){
    const item=items[cursor++];
    item.status='running';item.message=stageLabels.checking;update(area,spec);
    try{
     const result=await ops.updateOne(Number(item.id),{
      onStage:stage=>{
       item.message=stageLabels[stage]||stageLabels.checking;
       update(area,spec);
      }
     });
     item.status='success';
     item.message=result.warning
      ?trans('Команда выполнена, ожидается heartbeat','Command succeeded, awaiting heartbeat')
      :trans('Agent обновлён','Agent updated');
     st.ids.delete(item.id);
    }catch(error){
     item.status='error';
     item.message=String(error?.message||error||trans('Ошибка обновления','Update failed'));
    }
    update(area,spec);
   }
  };
  try{
   await Promise.all(Array.from({length:Math.min(2,items.length)},()=>worker()));
  }finally{
   // A fully successful upgrade exits selection automatically; retain its
   // collapsed result summary so the user can inspect all four outcomes.
   if(items.length&&items.every(item=>item.status==='success')){
    st.mode=false;st.ids.clear();
   }
   st.busy=false;
   update(area,spec);
  }
  const succeeded=items.filter(item=>item.status==='success').length,failed=items.length-succeeded;
  toast(trans('Обновление Agent завершено: ','Agent update finished: ')+
   succeeded+'/'+items.length+(failed?' · '+trans('ошибок: ','failed: ')+failed:''));
 }
 async function execute(area,spec,action){
  const st=selection(spec.kind),ids=[...st.ids];
  if(!ids.length||st.busy||typeof viewerMode==='function'&&viewerMode())return;
  const records=spec.draft?null:DB[spec.kind]||[];
  const eligible=ids.filter(id=>!records||records.some(row=>String(row.id)===String(id)));
  if(!eligible.length){st.ids.clear();update(area,spec);return}
  let warning=trans('Применить действие «','Apply “')+actionText(action)+trans('» к ','” to ')+eligible.length+trans(' элементам?',' items?');
  if(action==='delete'&&spec.kind==='nodes'){
   const linked=DB.hosts.filter(host=>(host.nodes||[]).some(id=>eligible.includes(String(id)))).length;
   if(linked)warning+=' '+trans('Связанные хосты: ','Linked hosts: ')+linked+'. '+trans('Они не будут удалены, но привязки могут измениться.','They will not be deleted, but node assignments may change.');
  }
  if(action==='delete'&&spec.kind==='squads'){
   warning+=' '+trans('Доступ пользователей, связанных со сквадами, может измениться.','Users linked to these squads may lose access.');
  }
  if(action==='agent-update'){
   warning+=' '+trans('Обновления выполняются не более чем на двух нодах одновременно. Доступность и поддержку самообновления проверит сервер.',
     'Updates run on at most two nodes at a time. The server checks connectivity and update eligibility.');
  }
  st.busy=true;update(area,spec);
  let ok=false;
  try{ok=await panelConfirm(warning,{
   title:trans('Массовые операции','Bulk operations'),
   confirmLabel:actionText(action),
   danger:action==='delete'||action==='disable'
  });}catch(error){
   toast(trans('Ошибка подтверждения: ','Confirmation failed: ')+(error.message||error));
  }
  if(!ok){st.busy=false;update(area,spec);return}
  if(action==='agent-update'){
   await updateNodeAgents(area,spec,eligible);
   return;
  }
  st.batch=null;update(area,spec);
  if(spec.draft){
   const handler=draftHandlers.get(area);
   try{
    if(typeof handler!=='function')throw Error(trans('Редактор не готов','Editor is not ready'));
    await handler(action,eligible);
    st.ids.clear();
    toast(trans('Черновик изменён. Нажмите «Сохранить».','Draft changed. Click Save to apply.'));
   }catch(error){toast(trans('Ошибка массовой операции: ','Bulk action failed: ')+(error.message||error))}
   finally{st.busy=false;update(area,spec);}
   return;
  }
  const errors=[];let done=0;
  for(const id of eligible){
   const record=records.find(row=>String(row.id)===String(id));
   if(!record)continue;
   try{
    if(action==='delete'){
     const blocked=ENT[spec.kind]?.guard?.(record);
     if(blocked)throw Error(blocked);
     await api.remove(spec.kind,record.id);
    }else if(action==='enable'||action==='disable'){
     const disabled=action==='disable';
     if(!!record.disabled!==disabled)await api.update(spec.kind,record.id,{disabled});
    }
    done++;
    st.ids.delete(id);
   }catch(error){errors.push(cardName(spec.kind,id)+': '+(error.message||String(error)))}
  }
  st.busy=false;
  try{await render(1);}catch(error){errors.push(String(error.message||error))}
  const summary=trans('Обработано: ','Completed: ')+done+'/'+eligible.length;
  toast(summary+(errors.length?'. '+trans('Ошибок: ','Failed: ')+errors.length+'. '+errors.slice(0,2).join('; '):''));
 }
 window.XMeshBulk=Object.freeze({mount});
})();