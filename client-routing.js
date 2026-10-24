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
 const route=(match='geosite',value='',action='proxy',server='')=>({match,value,action,...(server?{server}:{})});
 const root='<section class="client-routing-workspace" id="client-route-root">'+
  '<header class="client-route-intro"><div><span class="client-route-eyebrow">CLIENT ROUTING / XRAY JSON</span>'+
  '<h2>Маршрутизация клиентов</h2><p>Создавайте общие шаблоны правил и назначайте их нескольким нодам или отдельным хостам. Каждая подписка получает собственную маршрутизацию.</p>'+
  '</div><button type="button" class="btn" data-cr-add>Новый шаблон</button></header>'+
  '<div class="client-route-help"><b>Приоритет:</b> индивидуальный хост → назначенная нода → стандартный маршрут. Правила обрабатываются сверху вниз. Балансировщики остаются самостоятельными профилями.</div>'+
  '<div data-cr-list class="client-route-list"></div>'+
  '<footer class="client-route-savebar"><span data-cr-status>Ничего не изменено</span>'+
  '<button type="button" class="btn" data-cr-save>Сохранить маршрутизацию</button></footer></section>';
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
   return '<article class="card client-route-profile" data-cr-profile="'+index+'">'+
    '<div class="client-route-profile-head"><div class="client-route-heading"><span class="client-route-count">'+(index+1)+'</span>'+
    '<label><span>Название шаблона</span><input data-cr-name value="'+esc(p.name||'')+'" maxlength="100" placeholder="Например: RU через Варшаву"></label></div>'+
    '<div class="client-route-actions"><label class="client-route-toggle"><input type="checkbox" data-cr-enabled'+(p.enabled!==false?' checked':'')+'> Включён</label>'+
    '<button type="button" class="gh sm" data-cr-duplicate="'+index+'">Копировать</button>'+
    '<button type="button" class="gh sm" data-cr-delete="'+index+'">Удалить шаблон</button></div></div>'+
    '<div class="client-route-block"><div class="client-route-section-heading"><div><h3>Назначить серверам</h3>'+
    '<p>Один шаблон можно назначить сразу нескольким узлам и хостам. Не нужно копировать правила.</p></div>'+
    '<span>'+keys.size+' назначений</span></div>'+
    '<div class="client-route-sources">'+(assigned||'<p class="note">Сначала добавьте ноды или хосты.</p>')+'</div></div>'+
    '<div class="client-route-block"><div class="client-route-section-heading"><div><h3>Правила</h3>'+
    '<p>Приоритет сверху вниз. Если целевой сервер недоступен пользователю, правило блокирует совпадающий трафик.</p></div>'+
    '<button type="button" class="gh sm" data-cr-rule-add="'+index+'">Добавить правило</button></div>'+
    '<div class="client-route-rules">'+(rules||'<p class="note">Нет дополнительных правил — используется стандартная маршрутизация.</p>')+'</div></div>'+
    '</article>';
  }).join(''):'<div class="card client-route-empty"><h3>Пока нет шаблонов маршрутизации</h3><p>Создайте один шаблон, добавьте правила и отметьте все серверы, которым он нужен.</p></div>';
  const status=document.querySelector('#client-route-root [data-cr-status]');
  if(status)status.textContent=draft.length+' шаблон(ов) · '+draft.reduce((n,p)=>n+(p.servers||[]).length,0)+' назначений';
 };
 const read=()=>{
  const root=document.querySelector('#client-route-root');
  if(!root)return clone(draft);
  return [...root.querySelectorAll('[data-cr-profile]')].map((element,index)=>{
   const saved=draft[index];
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
    if(!rule.value)return 'Укажите значение каждого правила.';
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
    const data=read(),error=validate(data);
    if(error){toast(error);return}
    button.disabled=true;button.textContent='Сохраняем…';
    try{
     await saveSettings({clientRoutingProfiles:data});
     draft=clone(data);
     toast('Клиентская маршрутизация сохранена');
     render();
    }catch(err){toast('Не удалось сохранить: '+(err.message||'API'))}
    finally{button.disabled=false;button.textContent='Сохранить маршрутизацию'}
    return;
   }
   if(button.hasAttribute('data-cr-add')){
    draft=read();
    const id='route_'+Array.from(crypto.getRandomValues(new Uint8Array(6)),
      n=>n.toString(16).padStart(2,'0')).join('');
    draft.push({id,name:'Новый шаблон',enabled:true,servers:[],rules:[]});
    render();
    root.querySelector('[data-cr-profile]:last-child [data-cr-name]')?.focus();
    return;
   }
   const card=button.closest('[data-cr-profile]');if(!card)return;
   const index=Number(card.dataset.crProfile);
   draft=read();
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
   render();
  });
 }
 return [root,mount];
}
global.XMeshClientRouting={create};
})(window);
