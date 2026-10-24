/* XMesh client routing — reusable templates assigned to nodes or specific hosts.
 * This workspace edits only the owner's server-side validated settings.
 * Never copies server XRAY STUDIO credentials into a client routing profile.
 */
(function(global){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'}[c]));
const clone=v=>JSON.parse(JSON.stringify(v));
const labels={
 geosite:'GeoSite',geoip:'GeoIP',domain:'Домен',ip:'IP / CIDR',port:'Порт',
 proxy:'Через выбранный сервер',direct:'Напрямую',block:'Блокировать',
 server:'Через другой сервер'
};
function create(db,saveSettings,toast){
 const nodes=(db.nodes||[]).filter(n=>!n.disabled);
 const hosts=(db.hosts||[]).filter(h=>!h.disabled);
 const assignments=[
   ...nodes.filter(n=>Number.isSafeInteger(Number(n.id))&&Number(n.id)>0).map(n=>({
    key:'node:'+n.id,title:n.name||'Узел #'+n.id,detail:'Вся нода · хосты наследуют, если привязаны только к ней'
   })),
   ...hosts.filter(h=>Number.isSafeInteger(Number(h.id))&&Number(h.id)>0).map(h=>({
    key:'host:'+h.id,title:h.remark||h.name||h.address||'Хост #'+h.id,
    detail:'Отдельный публичный хост · '+(h.tag||'без inbound')
   }))
 ];
 const targets=[
  ...hosts.filter(h=>Number.isSafeInteger(Number(h.id))&&Number(h.id)>0).map(h=>({
   key:'host:'+h.id,label:(h.remark||h.name||h.address||'Хост #'+h.id)+' · '+(h.tag||'')
  })),
  ...nodes.flatMap(n=>{
   const p=(db.profiles||[]).find(p=>String(p.id)===String(n.profileId));
   let config;try{config=typeof p?.config==='string'?JSON.parse(p.config):p?.config}catch(_){}
   return (config?.inbounds||[]).filter(x=>x.tag&&
    !hosts.some(h=>h.tag===x.tag&&(!h.profileId||String(h.profileId)===String(p.id))))
    .map(x=>({key:'node:'+n.id+':'+x.tag,label:(n.name||'Узел #'+n.id)+' · '+x.tag}));
  })
 ];
 let draft=clone(Array.isArray(db.set?.clientRoutingProfiles)?db.set.clientRoutingProfiles:[]);
 const jsonEditors=new Set();
 const route=(match='geosite',value='',action='proxy',server='')=>({match,value,action,...(server?{server}:{})});
 const root='<section class="client-routing-workspace" id="client-route-root">'+
  '<div class="client-route-main-card">'+
  '<header class="client-route-main-head">'+
   '<div><h2>Клиентская маршрутизация</h2><p>Шаблоны правил для серверов Xray JSON. Один шаблон — несколько нод и хостов.</p></div>'+
   '<div class="client-route-head-actions"><span data-cr-counter class="client-route-counter">0 шаблонов</span>'+
   '<button type="button" class="btn client-route-create" data-cr-add>Новый шаблон</button></div>'+
  '</header>'+
  '<div class="client-route-main-body"><div data-cr-list class="client-route-list"></div></div>'+
  '<footer class="client-route-savebar"><div class="client-route-summary"><strong data-cr-status>0 шаблонов · 0 назначений</strong>'+
  '<span>Изменения вступят в силу при получении клиентами новой конфигурации</span></div>'+
  '<div class="client-route-saveactions"><button type="button" class="gh" data-cr-reset hidden>Отменить изменения</button>'+
  '<button type="button" class="btn" data-cr-save disabled>Сохранить изменения</button></div></footer></div></section>';
 const valueOptions=(entries,value)=>entries.map(([v,label])=>
  '<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(label)+'</option>').join('');
 const selectedSources=items=>new Set(items||[]);
 const render=()=>{
  const list=document.querySelector('#client-route-root [data-cr-list]');
  if(!list)return;
  list.innerHTML=draft.length?draft.map((p,index)=>{
   const keys=selectedSources(p.servers);
   const missing=[...keys].filter(key=>!assignments.some(x=>x.key===key));
   const candidateList=[...assignments,...missing.map(key=>({key,title:key,detail:'Недоступный сервер · сохранённая привязка'}))];
   const assigned=candidateList.map(c=>
    '<label class="client-route-source"><input type="checkbox" data-cr-source="'+esc(c.key)+'"'+(keys.has(c.key)?' checked':'')+'>'+
    '<span><strong>'+esc(c.title)+'</strong><small>'+esc(c.detail)+'</small></span></label>').join('');
   const rules=(p.rules||[]).map((rule,n)=>{
    const target=rule.server||'';
    const available=[...targets,...(target&&!targets.some(t=>t.key===target)?[{key:target,label:'Недоступный · '+target}]:[])];
    return '<div class="client-route-rule" data-cr-rule="'+n+'">'+
     '<span class="client-route-order">'+(n+1)+'</span>'+
     '<label><span>Условие</span><select data-cr-field="match">'+valueOptions(
      [['geosite','GeoSite'],['geoip','GeoIP'],['domain','Домен'],['ip','IP / CIDR'],['port','Порт']],rule.match)+'</select></label>'+
     '<label><span>Значение</span><input data-cr-field="value" value="'+esc(rule.value||'')+'" placeholder="'+
      esc({geosite:'category-ru',geoip:'ru',domain:'example.com',ip:'203.0.113.0/24',port:'443'}[rule.match]||'')+
      '" maxlength="200" spellcheck="false"></label>'+
     '<label><span>Действие</span><select data-cr-field="action">'+valueOptions(
      Object.entries(labels).filter(([key])=>['proxy','direct','block','server'].includes(key)),rule.action)+'</select></label>'+
     '<label class="client-route-target"'+(rule.action==='server'?'':' hidden')+'><span>Целевой сервер</span><select data-cr-field="server">'+
      '<option value="">Выберите сервер</option>'+available.map(t=>'<option value="'+esc(t.key)+'"'+
       (target===t.key?' selected':'')+'>'+esc(t.label)+'</option>').join('')+'</select></label>'+
     '<div class="client-route-rule-actions"><button type="button" class="gh sm" data-cr-up="'+n+'" aria-label="Вверх" title="Повысить приоритет">↑</button>'+
     '<button type="button" class="gh sm" data-cr-down="'+n+'" aria-label="Вниз" title="Понизить приоритет">↓</button>'+
     '<button type="button" class="gh sm" data-cr-rule-delete="'+n+'" aria-label="Удалить правило" title="Удалить правило">×</button></div>'+
     '</div>';
   }).join('');
   return '<article class="client-route-profile" data-cr-profile="'+index+'">'+
    '<header class="client-route-profile-head"><div class="client-route-heading"><span class="client-route-count">'+(index+1)+'</span>'+
    '<label><span>Название шаблона</span><input data-cr-name value="'+esc(p.name||'')+'" maxlength="100" placeholder="Например: RU через Польшу"></label></div>'+
    '<div class="client-route-actions"><label class="client-route-toggle"><input type="checkbox" data-cr-enabled'+(p.enabled!==false?' checked':'')+'> Включён</label>'+
    '<button type="button" class="gh sm" data-cr-json="'+index+'" aria-pressed="'+jsonEditors.has(p.id)+'">'+(jsonEditors.has(p.id)?'Конструктор':'{ } JSON')+'</button>'+ 
    '<button type="button" class="gh sm" data-cr-duplicate="'+index+'">Копировать</button>'+
    '<button type="button" class="gh sm" data-cr-delete="'+index+'">Удалить</button></div></header>'+
    (jsonEditors.has(p.id)?'<section class="client-route-json-block"><div class="client-route-json-head"><div><h3>JSON шаблона</h3><p>Редактируйте правила и назначения. Применение не сохраняет изменения на сервере.</p></div><div class="client-route-json-actions"><button type="button" class="gh sm" data-cr-json-format>Форматировать</button><button type="button" class="btn" data-cr-json-apply>Применить JSON</button></div></div><textarea data-cr-json-text spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="JSON шаблона">'+esc(JSON.stringify(p,null,2))+'</textarea><p class="client-route-json-error" data-cr-json-error role="alert" hidden></p></section>':'')+
    '<div'+(jsonEditors.has(p.id)?' hidden':'')+' class="client-route-form-blocks">'+
    '<section class="client-route-block"><div class="client-route-section-heading"><div><h3>Назначения</h3>'+
    '<p>Выберите серверы, на которых будет действовать этот шаблон.</p></div>'+
    '<span>'+keys.size+' выбрано</span></div>'+
    '<div class="client-route-sources">'+(assigned||'<p class="note">Сначала добавьте ноды или хосты.</p>')+'</div></section>'+
    '<section class="client-route-block"><div class="client-route-section-heading"><div><h3>Правила маршрутизации</h3>'+
    '<p>Правила применяются по порядку сверху вниз.</p></div>'+
    '<button type="button" class="gh sm" data-cr-rule-add="'+index+'">Добавить правило</button></div>'+
    '<div class="client-route-rules">'+(rules||'<div class="client-route-rules-empty">Дополнительных правил пока нет. Используется стандартная маршрутизация.</div>')+'</div></section>'+
    '</div></article>';
  }).join(''):'<div class="client-route-empty">'+
   '<div class="client-route-empty-icon" aria-hidden="true">⇄</div>'+
   '<h3>Шаблонов маршрутизации пока нет</h3>'+
   '<p>Создайте набор правил и назначьте его нодам или хостам. Настройки не придётся дублировать для каждого сервера.</p>'+
   '<button type="button" class="btn" data-cr-add>Создать первый шаблон</button>'+
   '<div class="client-route-empty-hint">Правила хоста имеют приоритет над правилами ноды</div></div>';
  const status=document.querySelector('#client-route-root [data-cr-status]');
  if(status)status.textContent=draft.length+' шаблон(ов) · '+draft.reduce((n,p)=>n+(p.servers||[]).length,0)+' назначений';
  const counter=document.querySelector('#client-route-root [data-cr-counter]');
  if(counter)counter.textContent=draft.length+' шаблон(ов)';
 };
 let saved=JSON.stringify(draft);
 const syncDirty=()=>{
  const root=document.querySelector('#client-route-root');
  if(!root)return;
  const dirty=JSON.stringify(read())!==saved;
  const save=root.querySelector('[data-cr-save]');
  const reset=root.querySelector('[data-cr-reset]');
  if(save)save.disabled=!dirty;
  if(reset)reset.hidden=!dirty;
 };
 const read=()=>{
  const root=document.querySelector('#client-route-root');
  if(!root)return clone(draft);
  return [...root.querySelectorAll('[data-cr-profile]')].map((element,index)=>{
   const saved=draft[index];
   if(jsonEditors.has(saved.id))return clone(saved);
   const rules=[...element.querySelectorAll('[data-cr-rule]')].map(row=>{
    const get=k=>row.querySelector('[data-cr-field="'+k+'"]').value.trim();
    return route(get('match'),get('value'),get('action'),get('action')==='server'?get('server'):'');
   });
   return {...saved,name:element.querySelector('[data-cr-name]').value.trim(),
    enabled:element.querySelector('[data-cr-enabled]').checked,
    servers:[...element.querySelectorAll('[data-cr-source]:checked')].map(el=>el.dataset.crSource),
    rules};
  });
 };
 function validate(data){
  const seen=new Set();
  for(const profile of data){
   if(!profile.name)return 'Укажите название каждого шаблона.';
   if(profile.rules.length>64)return 'В одном шаблоне не более 64 правил.';
   for(const source of profile.servers){
    if(seen.has(source))return 'Сервер '+source+' назначен сразу нескольким шаблонам. Выберите один.';
    seen.add(source);
   }
   for(const rule of profile.rules){
    if(!rule||typeof rule!=='object'||!['geosite','geoip','domain','ip','port'].includes(rule.match)||typeof rule.value!=='string'||!rule.value.trim())return 'Укажите корректный тип и значение каждого правила.';
    if(!['proxy','direct','block','server'].includes(rule.action))return 'Некорректное действие правила.';
    if(rule.action==='server'&&!rule.server)return 'Выберите целевой сервер для правила.';
   }
  }
  return '';
 }
 function mount(){
  const root=document.getElementById('client-route-root');
  if(!root)return;
  render();
  root.addEventListener('change',event=>{
   const el=event.target;
   if(el.matches('[data-cr-field="action"]')){
    const row=el.closest('[data-cr-rule]');
    if(row)row.querySelector('.client-route-target').hidden=el.value!=='server';
   }
  });
  root.addEventListener('click',async event=>{
   const button=event.target.closest('button');if(!button)return;
   if(button.hasAttribute('data-cr-save')){
    const pending=[...root.querySelectorAll('[data-cr-json-text]')].some(editor=>{
     const card=editor.closest('[data-cr-profile]');
     const profile=draft[Number(card.dataset.crProfile)];
     try{return JSON.stringify(JSON.parse(editor.value))!==JSON.stringify(profile)}catch(_){return true}
    });
    if(pending){toast('Сначала нажмите «Применить JSON» в редакторе шаблона.');return}
    const data=read(),error=validate(data);
    if(error){toast(error);return}
    button.disabled=true;button.textContent='Сохраняем…';
    try{
     await saveSettings({clientRoutingProfiles:data});
     draft=clone(data);
     saved=JSON.stringify(draft);
     toast('Клиентская маршрутизация сохранена');
     render();syncDirty();
    }catch(err){toast('Не удалось сохранить: '+(err.message||'API'))}
    finally{button.disabled=false;button.textContent='Сохранить изменения'}
    return;
   }
   if(button.hasAttribute('data-cr-reset')){
    jsonEditors.clear();
    draft=JSON.parse(saved);render();syncDirty();return;
   }
   if(button.hasAttribute('data-cr-add')){
    draft=read();
    const id='route_'+Array.from(crypto.getRandomValues(new Uint8Array(6)),
      n=>n.toString(16).padStart(2,'0')).join('');
    draft.push({id,name:'Новый шаблон',enabled:true,servers:[],rules:[]});
    render();
    syncDirty();
    root.querySelector('[data-cr-profile]:last-child [data-cr-name]')?.focus();
    return;
   }
   const card=button.closest('[data-cr-profile]');if(!card)return;
   const index=Number(card.dataset.crProfile);
   draft=read();
   if(button.hasAttribute('data-cr-json')){
    const id=draft[index].id;
    if(jsonEditors.has(id))jsonEditors.delete(id);else jsonEditors.add(id);
    render();syncDirty();return;
   }
   if(button.hasAttribute('data-cr-json-format')||button.hasAttribute('data-cr-json-apply')){
    const editor=card.querySelector('[data-cr-json-text]');
    const errorBox=card.querySelector('[data-cr-json-error]');
    try{
     const parsed=JSON.parse(editor.value);
     if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw Error('Ожидается JSON-объект шаблона');
     if(parsed.id!==draft[index].id)throw Error('ID шаблона менять нельзя');
     if(typeof parsed.name!=='string'||!parsed.name.trim())throw Error('Укажите название шаблона');
     if(parsed.enabled!==undefined&&typeof parsed.enabled!=='boolean')throw Error('enabled должен быть true или false');
     if(!Array.isArray(parsed.servers)||!parsed.servers.every(v=>typeof v==='string'))throw Error('servers должен быть массивом ID серверов');
     if(!Array.isArray(parsed.rules))throw Error('rules должен быть массивом правил');
     if(Object.keys(parsed).some(k=>!['id','name','enabled','servers','rules'].includes(k)))throw Error('В шаблоне есть неизвестные поля');
     const issue=validate([...draft.slice(0,index),parsed,...draft.slice(index+1)]);
     if(issue)throw Error(issue);
     if(button.hasAttribute('data-cr-json-format')){
      editor.value=JSON.stringify(parsed,null,2);errorBox.hidden=true;return;
     }
     draft[index]=parsed;
     errorBox.hidden=true;render();syncDirty();toast('JSON применён. Сохраните изменения.');
    }catch(e){errorBox.textContent='Ошибка JSON: '+e.message;errorBox.hidden=false;}
    return;
   }
   if(button.hasAttribute('data-cr-duplicate')){
    const copy=clone(draft[index]);
    copy.id='route_'+Array.from(crypto.getRandomValues(new Uint8Array(6)),
      n=>n.toString(16).padStart(2,'0')).join('');
    copy.name+=' · копия';copy.servers=[];
    draft.splice(index+1,0,copy);
   }else if(button.hasAttribute('data-cr-delete')){
    if(button.dataset.confirm!=='yes'){
     button.dataset.confirm='yes';button.textContent='Подтвердить удаление';
     return;
    }
    jsonEditors.delete(draft[index].id);
    draft.splice(index,1);
   }else if(button.hasAttribute('data-cr-rule-add')){
    draft[index].rules.push(route());
   }else if(button.hasAttribute('data-cr-rule-delete')){
    draft[index].rules.splice(Number(button.dataset.crRuleDelete),1);
   }else if(button.hasAttribute('data-cr-up')){
    const n=Number(button.dataset.crUp);
    if(n>0)[draft[index].rules[n-1],draft[index].rules[n]]=
      [draft[index].rules[n],draft[index].rules[n-1]];
   }else if(button.hasAttribute('data-cr-down')){
    const n=Number(button.dataset.crDown);
    if(n<draft[index].rules.length-1)
     [draft[index].rules[n+1],draft[index].rules[n]]=
      [draft[index].rules[n],draft[index].rules[n+1]];
   }else return;
   render();syncDirty();
  });
  root.addEventListener('input',event=>{if(!event.target.matches('[data-cr-json-text]'))syncDirty()});
  root.addEventListener('change',syncDirty);
  syncDirty();
 }
 return [root,mount];
}
global.XMeshClientRouting={create};
})(window);
