'use strict';

/* One selection/operations contract for inventory workspaces. No hidden
 * server-side bulk endpoint: every change uses the existing validated API. */
(()=>{
 const specs=[
  {kind:'nodes',root:'.nodes-page',toolbar:'.nodes-toolbar',cards:'[data-node-card-id]',key:'data-node-card-id',actions:['enable','disable','delete']},
  {kind:'hosts',root:'.host-directory',toolbar:'.host-directory-toolbar',cards:'[data-host-card-id]',key:'data-host-card-id',actions:['enable','disable','delete']},
  {kind:'squads',root:'.squad-directory',toolbar:'.squad-directory-toolbar',cards:'[data-squad-card]',key:'data-squad-card',actions:['delete']},
  {kind:'tpls',root:'[data-template-section="tpls"]',toolbar:'.template-section-tools',cards:'[data-template-card^="tpls:"]',key:'data-template-card',actions:['delete']},
  {kind:'subs',root:'[data-template-section="subs"]',toolbar:'.template-section-tools',cards:'[data-template-card^="subs:"]',key:'data-template-card',actions:['delete']},
  {kind:'balancers',root:'.balancer-workspace',toolbar:'.balancer-toolbar',cards:'[data-balancer-index]',key:'data-balancer-index',actions:['enable','disable','delete'],draft:true}
 ];
 const state=new Map(),bound=new WeakSet(),draftHandlers=new WeakMap();
 const trans=(ru,en)=>typeof panelIsEnglish==='function'&&panelIsEnglish()?en:ru;
 const selection=kind=>{
  if(!state.has(kind))state.set(kind,{mode:false,ids:new Set(),busy:false});
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
  delete:trans('Удалить','Delete')
 })[action];
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
     const target=toolbar.querySelector('.nx-workspace-actions,.node-grid-controls,.nx-workspace-grid-controls,.node-create-action');
     toolbar.insertBefore(group,target||null);
    }
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
       if(!st.mode)st.ids.clear();
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
  const n=st.ids.size;
  const show=cards.length>0;
  bar.hidden=!show;
  if(!show)return;
  bar.innerHTML='<button type="button" class="gh sm nx-bulk-mode" data-bulk-action="mode" aria-pressed="'+st.mode+'"'+(st.busy?' disabled':'')+'>'+
   (st.mode?trans('Готово','Done'):trans('Выбрать','Select'))+'</button>'+
   (st.mode?'<span class="nx-bulk-count" aria-live="polite">'+trans('Выбрано: ','Selected: ')+n+'</span>'+
    '<button type="button" class="gh sm nx-bulk-select-all" data-bulk-action="all"'+(st.busy?' disabled':'')+'>'+trans('Все видимые','All visible')+'</button>'+
    '<button type="button" class="gh sm nx-bulk-clear" data-bulk-action="clear"'+(!n||st.busy?' disabled':'')+'>'+trans('Снять выбор','Clear')+'</button>'+
    '<details class="nx-bulk-actions"><summary class="gh sm" aria-label="'+trans('Массовые операции','Bulk operations')+'"'+(!n||st.busy?' aria-disabled="true"':'')+'>'+trans('Действия','Actions')+' <span aria-hidden="true">▾</span></summary>'+
    '<div class="nx-bulk-actions-menu">'+spec.actions.map(action=>'<button type="button" data-bulk-action="'+action+'" class="'+(action==='delete'?'is-danger':'')+'"'+(st.busy||!n?' disabled':'')+'>'+actionText(action)+'</button>').join('')+'</div></details>'+
    (spec.draft?'<span class="nx-bulk-draft">'+trans('Применяется после сохранения','Save to apply')+'</span>':''):'');
  if(st.busy)bar.setAttribute('aria-busy','true');else bar.removeAttribute('aria-busy');
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
  const ok=await panelConfirm(warning,{
   title:trans('Массовые операции','Bulk operations'),
   confirmLabel:actionText(action),
   danger:action==='delete'||action==='disable'
  });
  if(!ok)return;
  st.busy=true;update(area,spec);
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