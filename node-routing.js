/* Separate node-routing workspace. GeoData management is intentionally elsewhere.
   A node label alone is never treated as a working Xray proxy outbound. */
(function(){
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types=[
 ['geosite','GeoSite','category-ru','Домены из geosite.dat'],
 ['geoip','GeoIP','ru','IP-адреса из geoip.dat'],
 ['domain','Домен','example.ru','Суффикс домена'],
 ['ip','IP / CIDR','203.0.113.0/24','IP или подсеть'],
 ['extDomain','Свой GeoSite','custom.dat:list','Категория из собственного .dat'],
 ['extIp','Свой GeoIP','custom-ip.dat:ru','IP-категория из .dat']
];
const targets=[
 ['direct','Напрямую','Свободный выход с текущей ноды'],
 ['block','Блокировать','Xray blackhole'],
 ['outbound','Outbound','Уже созданный исходящий канал XRAY STUDIO'],
 ['node','Другая нода','Реальный прокси-переход через выбранный сервер']
];
const geoMatch=m=>['geosite','geoip','extDomain','extIp'].includes(m);
const validId=n=>Number.isSafeInteger(Number(n))&&Number(n)>0;
const clone=v=>JSON.parse(JSON.stringify(v));
const ident=(kind,value)=>({matcher:kind,value,enabled:true,target:'direct',nodeId:0,outboundTag:''});
const opt=(value,label,selected)=>'<option value="'+esc(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+esc(label)+'</option>';
function profileOutbounds(node,profiles){
 const profile=(profiles||[]).find(p=>String(p.id)===String(node.profileId));
 let config;
 try{config=typeof profile?.config==='string'?JSON.parse(profile.config):profile?.config||{}}catch(_){config={}}
 return (Array.isArray(config.outbounds)?config.outbounds:[]).filter(out=>
  typeof out?.tag==='string'&&out.tag!=='xmesh_stats_api').map(out=>({
   tag:out.tag,protocol:out.protocol||'Xray'
  }));
}
function legacyRules(node){
 const migrated=[];
 if(node.geoEnabled&&node.geoBlockAds!==false){
  migrated.push({...ident('geosite','category-ads-all'),target:'block'});
 }
 for(const line of String(node.geoCustomRules||'').split(/\r?\n/)){
  const parsed=line.trim().match(/^(geosite|geoip|ext):([A-Za-z0-9_:.-]+)\s*=>\s*(block|direct)$/);
  if(!parsed)continue;
  const kind=parsed[1]==='ext'?'extDomain':parsed[1];
  migrated.push({...ident(kind,parsed[2]),target:parsed[3]});
 }
 return migrated;
}
function nameFor(node){return (node?.flag?String(node.flag)+' ':'')+String(node?.name||node?.addr||'Узел');}
function open({node,nodes,hosts,profiles,modal,updateNode,apiRequest,notify,afterSave}){
 const otherNodes=(nodes||[]).filter(n=>Number(n.id)!==Number(node.id)&&!n.disabled).sort((a,b)=>nameFor(a).localeCompare(nameFor(b),'ru'));
 const knownOutbounds=profileOutbounds(node,profiles);
 const hasSaved=Array.isArray(node.routingRules);
 const initialRules=hasSaved?clone(node.routingRules):legacyRules(node);
 const legacy=!hasSaved&&initialRules.length>0;
 const draft={
  enabled:typeof node.routingEnabled==='boolean'?node.routingEnabled:(legacy&&!!node.geoEnabled),
  strategy:node.routingDomainStrategy||'AsIs',
  rules:initialRules,
  relays:new Map((Array.isArray(node.routingRelays)?node.routingRelays:[])
   .filter(x=>validId(x.nodeId)).map(x=>[String(x.nodeId),JSON.stringify(x.outbound||{},null,2)])),
  activeTab:'rules',
  selectedExit:null,
  dirty:false
 };
 const html='<form class="box route-workspace" data-routing-editor method="dialog">'+
 '<header class="route-header"><div class="route-header-icon">⇄</div><div class="route-heading">'+
 '<span class="route-kicker">XMESH NEXUS / УЗЛЫ / '+esc(node.name||node.id)+'</span>'+
 '<h2>Маршрутизация</h2><p>Куда направлять трафик после подключения к этой ноде</p></div>'+
 '<button type="button" class="gh sm route-close" data-x aria-label="Закрыть">✕</button></header>'+
 '<div class="route-toolbar"><div class="route-status"><span class="route-dot"></span><strong data-route-activation></strong>'+
 '<span class="route-status-caption">Правила применяются сверху вниз, первое совпадение выигрывает</span></div>'+
 '<label class="route-power"><input type="checkbox" data-route-enabled><span>Включить маршрутизацию</span></label></div>'+
 '<div class="route-tabs" role="tablist" aria-label="Разделы маршрутизации">'+
 '<button type="button" role="tab" data-route-tab="rules">Правила <span data-route-count></span></button>'+
 '<button type="button" role="tab" data-route-tab="exits">Выходные соединения <span data-exit-count></span></button></div>'+
 '<div class="route-body" data-route-body></div>'+
 '<footer class="route-footer"><div class="route-footnote"><span data-route-save-status>Изменения будут переданы ноде при следующей синхронизации.</span></div>'+
 '<div class="route-footer-actions"><button type="button" class="gh" data-route-check>Проверить</button>'+
 '<button type="submit" class="btn" data-route-save>Сохранить маршруты</button></div></footer></form>';
 modal(html,'node-routing-modal');
 const dialog=document.getElementById('dlg');
 const form=dialog?.querySelector('[data-routing-editor]');
 if(!form)return;
 const body=form.querySelector('[data-route-body]');
 const note=form.querySelector('[data-route-save-status]');
 const save=form.querySelector('[data-route-save]');
 const check=form.querySelector('[data-route-check]');
 const selectedNode=id=>otherNodes.find(n=>String(n.id)===String(id));
 const usedExits=()=>[...new Set(draft.rules.filter(r=>r.enabled!==false&&r.target==='node'&&validId(r.nodeId)).map(r=>String(r.nodeId)))];
 const ruleDestination=r=>{
  if(r.target==='node')return nameFor(selectedNode(r.nodeId))||'Не выбрана нода';
  if(r.target==='outbound')return r.outboundTag||'Выберите outbound';
  return r.target==='block'?'Блокировка':'Прямое подключение';
 };
 const status=message=>{note.textContent=message;};
 function markDirty(){
  draft.dirty=true;
  status('Есть несохранённые изменения.');
 }
 function ruleMarkup(rule,i){
  const type=types.find(t=>t[0]===rule.matcher)||types[0];
  const nodeSelector=rule.target==='node'?'<label class="route-inline-parameter"><span>Выходная нода</span><select data-rule-field="nodeId">'+
   opt('','Выберите сервер…',rule.nodeId)+otherNodes.map(n=>opt(n.id,nameFor(n),rule.nodeId)).join('')+
   '</select></label>':'';
  const outboundSelector=rule.target==='outbound'?'<label class="route-inline-parameter"><span>Outbound из профиля</span><select data-rule-field="outboundTag">'+
   opt('','Выберите outbound…',rule.outboundTag)+knownOutbounds.map(o=>opt(o.tag,o.tag+' · '+o.protocol,rule.outboundTag)).join('')+
   '</select></label>':'';
  const missingExit=rule.target==='node'&&validId(rule.nodeId)&&!String(draft.relays.get(String(rule.nodeId))||'').trim();
  const matchDisplay=rule.matcher==='extDomain'||rule.matcher==='extIp'?'ext:':rule.matcher==='domain'?'domain:':rule.matcher==='ip'?'':rule.matcher+':';
  return '<section class="route-rule'+(rule.enabled===false?' route-rule-muted':'')+'" data-rule-index="'+i+'">'+
   '<div class="route-rule-heading"><span class="route-rule-counter">'+String(i+1).padStart(2,'0')+'</span>'+
   '<strong>'+esc(type[1])+' <span class="route-arrow">→</span> '+esc(ruleDestination(rule))+'</strong>'+
   (missingExit?'<span class="route-tag-warning">Нужен выход</span>':'')+
   '<div class="route-rule-actions"><button type="button" class="route-icon-btn" data-route-move="-1" '+(i===0?'disabled':'')+' aria-label="Переместить выше" title="Выше">↑</button>'+
   '<button type="button" class="route-icon-btn" data-route-move="1" '+(i===draft.rules.length-1?'disabled':'')+' aria-label="Переместить ниже" title="Ниже">↓</button>'+
   '<label class="route-mini-check" title="Включено"><input type="checkbox" data-rule-field="enabled" '+(rule.enabled!==false?'checked':'')+'></label>'+
   '<button type="button" class="route-icon-btn route-remove" data-route-remove title="Удалить правило" aria-label="Удалить правило">✕</button></div></div>'+
   '<div class="route-rule-grid"><label class="route-input"><span>Тип совпадения</span><select data-rule-field="matcher">'+
   types.map(t=>opt(t[0],t[1],rule.matcher)).join('')+'</select></label>'+
   '<label class="route-input route-match"><span>Категория / адрес</span><div class="route-prefixed"><span>'+esc(matchDisplay)+'</span>'+
   '<input data-rule-field="value" value="'+esc(rule.value||'')+'" placeholder="'+esc(type[2])+'" spellcheck="false"></div></label>'+
   '<label class="route-input"><span>Действие</span><select data-rule-field="target">'+
   targets.map(t=>opt(t[0],t[1],rule.target)).join('')+'</select></label></div>'+
   (nodeSelector||outboundSelector?'<div class="route-rule-extra">'+nodeSelector+outboundSelector+
   (missingExit?'<button class="gh sm" type="button" data-route-configure="'+esc(rule.nodeId)+'">Настроить соединение →</button>':'')+'</div>':'')+
   '</section>';
 }
 function rulesMarkup(){
  const enabledRules=draft.rules.filter(r=>r.enabled!==false);
  const requiresGeo=enabledRules.some(r=>geoMatch(r.matcher));
  const ru=enabledRules.filter(r=>r.target==='node').length;
  return '<div class="route-rules-layout"><section class="route-rules-pane">'+
   '<div class="route-section-intro"><div><span>ПРАВИЛА УЗЛА</span><h3>Куда направлять трафик</h3>'+
   '<p>Разные GeoSite, GeoIP и домены могут использовать разные выходы.</p></div>'+
   '<button type="button" class="btn sm route-add" data-route-add>＋ Правило</button></div>'+
   '<div class="route-presets"><span>БЫСТРО ДОБАВИТЬ</span>'+
   '<button type="button" data-route-preset="ru">🇷🇺 Сайты RU → другая нода</button>'+
   '<button type="button" data-route-preset="ads">⊘ Реклама → блокировать</button>'+
   '<button type="button" data-route-preset="ru-ip">🇷🇺 IP России → другая нода</button></div>'+
   '<div class="route-rule-list">'+(draft.rules.length?draft.rules.map(ruleMarkup).join(''):
   '<div class="route-empty"><strong>Пока нет правил</strong><p>Добавьте первое правило и выберите действие. По умолчанию остаётся маршрутизация XRAY STUDIO.</p></div>')+'</div></section>'+
   '<aside class="route-aside"><div class="route-aside-title">КОНТЕКСТ</div><h3>Как пойдёт трафик</h3>'+
   '<div class="route-path"><div><span class="route-path-dot">1</span><strong>'+esc(nameFor(node))+'</strong><small>Исходная нода</small></div>'+
   '<span class="route-path-line"></span><div><span class="route-path-dot">2</span><strong>Правила маршрутизации</strong>'+
   '<small>'+enabledRules.length+' активно · '+ru+' через другие ноды</small></div>'+
   '<span class="route-path-line"></span><div><span class="route-path-dot">3</span><strong>Выбранный outbound</strong>'+
   '<small>Прокси-нода, прямой выход или блокировка</small></div></div>'+
   '<div class="route-separator"></div>'+
   '<label class="route-input"><span>Стратегия DNS для IP-правил</span><select data-route-strategy>'+
   [['AsIs','AsIs · без резолвинга'],['IPIfNonMatch','IPIfNonMatch · если нет совпадения'],['IPOnDemand','IPOnDemand · по необходимости']].map(x=>opt(x[0],x[1],draft.strategy)).join('')+'</select></label>'+
   '<div class="route-advice">'+(requiresGeo&&!node.geoEnabled?
    'GeoData на этой ноде выключена. При сохранении будет включена автоматически, иначе категории не смогут работать.':
    requiresGeo?'Используются GeoData-файлы, которые нода скачивает в отдельном разделе «GeoData».':
    'Для правил по домену GeoData не требуется. Правила по GeoIP/GeoSite потребуют файлов на ноде.')+'</div>'+
   '<button type="button" class="gh route-manage-geo" data-route-open-geodata>Открыть GeoData →</button>'+
   '</aside></div>';
 }
 function exitMarkup(id){
  const target=selectedNode(id);
  if(!target)return '<div class="route-exit-warning">Выбранная нода недоступна или отключена. Проверьте правило.</div>';
  const raw=draft.relays.get(String(id))||'';
  const active=draft.selectedExit===null?usedExits()[0]===String(id):draft.selectedExit===String(id);
  const relatedHosts=(hosts||[]).filter(h=>!h.disabled&&Array.isArray(h.nodes)&&h.nodes.some(x=>String(x)===String(id)));
  const endpointList=[[target.addr,target.port],...relatedHosts.map(h=>[h.address||h.externalAddress,h.externalPort||h.port])]
   .filter(([addr,port])=>addr&&port).map(([addr,port])=>esc(addr+':'+port)).join(', ');
  return '<section class="route-exit-card '+(active?'is-active':'')+'" data-exit-id="'+esc(id)+'">'+
   '<button type="button" class="route-exit-header" data-route-exit-toggle="'+esc(id)+'"><span class="route-exit-avatar">⇥</span>'+
   '<span class="route-exit-identity"><strong>'+esc(nameFor(target))+'</strong>'+
   '<small>'+(raw.trim()?'Подключение сохранено в редакторе':'Требуется действующий Xray outbound')+'</small></span>'+
   '<span class="route-exit-status '+(raw.trim()?'is-ready':'')+'">'+(raw.trim()?'Задано':'Нет конфигурации')+'</span>'+
   '<span class="route-exit-chevron">'+(active?'−':'+')+'</span></button>'+
   (active?'<div class="route-exit-details"><div class="route-endpoints"><span>РАЗРЕШЁННЫЕ ПУБЛИЧНЫЕ АДРЕСА</span><p>'+
     (endpointList||'Привяжите Host к выходной ноде или укажите её публичный адрес и порт.')+'</p></div>'+
   '<label class="route-input"><span>Настоящий Xray outbound для '+esc(target.name||'ноды')+'</span>'+
   '<textarea data-route-relay="'+esc(id)+'" spellcheck="false" placeholder="{&#10;  &quot;protocol&quot;: &quot;vless&quot;,&#10;  &quot;settings&quot;: { &quot;vnext&quot;: [...] },&#10;  &quot;streamSettings&quot;: {...}&#10;}">'+esc(raw)+'</textarea></label>'+
   '<p class="route-exit-help">Вставьте рабочий outbound с реальным UUID/ключами и транспортом для Host этой ноды. Поле <code>tag</code> добавляется автоматически. Просто выбрать сервер недостаточно для соединения.</p>'+
   '<button type="button" class="gh sm" data-route-remove-relay="'+esc(id)+'">Очистить соединение</button>'+
   '</div>':'')+'</section>';
 }
 function exitsMarkup(){
  const ids=usedExits();
  return '<div class="route-exits-layout"><div class="route-exits-pane">'+
   '<div class="route-section-intro"><div><span>МЕЖСЕРВЕРНЫЕ СОЕДИНЕНИЯ</span><h3>Выходные ноды</h3>'+
   '<p>Прокси-каналы, которыми будут пользоваться правила маршрутизации.</p></div></div>'+
   '<div class="route-exit-list">'+(ids.length?ids.map(exitMarkup).join(''):
    '<div class="route-empty"><strong>Выходные ноды не выбраны</strong><p>В правилах укажите действие «Другая нода», затем здесь появится её подключение.</p></div>')+
   '</div></div><aside class="route-aside"><div class="route-aside-title">ВАЖНО</div><h3>Это реальные соединения</h3>'+
   '<p class="route-aside-text">Xray на исходной ноде должен подключиться к inbound целевой ноды по действующему протоколу. Нужны корректный адрес Host, транспорт, параметры REALITY/TLS и отдельные учётные данные.</p>'+
   '<div class="route-separator"></div><p class="route-aside-text">Панель сопоставляет адрес с выбранной нодой и её Host, добавляет исходящий канал и проверяет конфигурацию. Никакого фиктивного перенаправления по названию ноды.</p>'+
   '<p class="route-aside-text">На выходной ноде при необходимости настройте отдельное правило прямого выхода, чтобы не создавать петлю.</p>'+
   '<button type="button" class="gh route-manage-geo" data-route-go-rules>← Вернуться к правилам</button></aside></div>';
 }
 function render(){
  form.querySelector('[data-route-enabled]').checked=!!draft.enabled;
  form.querySelector('[data-route-activation]').textContent=draft.enabled?'Маршрутизация включена':'Маршрутизация выключена';
  form.querySelector('.route-dot').classList.toggle('is-on',!!draft.enabled);
  form.querySelector('[data-route-count]').textContent=String(draft.rules.filter(r=>r.enabled!==false).length);
  form.querySelector('[data-exit-count]').textContent=String(usedExits().length);
  for(const button of form.querySelectorAll('[data-route-tab]')){
   const active=button.dataset.routeTab===draft.activeTab;
   button.classList.toggle('is-selected',active);
   button.setAttribute('aria-selected',active?'true':'false');
  }
  body.innerHTML=draft.activeTab==='rules'?rulesMarkup():exitsMarkup();
 }
 function saveRuleChange(element){
  const parent=element.closest('[data-rule-index]');
  if(!parent)return false;
  const rule=draft.rules[Number(parent.dataset.ruleIndex)];
  if(!rule)return false;
  const key=element.dataset.ruleField;
  if(!key)return false;
  rule[key]=key==='enabled'?element.checked:key==='nodeId'?(Number(element.value)||0):element.value;
  if(key==='matcher'){
   const previous=types.find(t=>t[0]===rule.matcher);
   if(!rule.value&&previous)rule.value=previous[2];
  }
  markDirty();
  return true;
 }
 function addRule(kind='geosite',value='',target='direct'){
  const rule=ident(kind,value);
  rule.target=target;
  if(target==='node')rule.nodeId=0;
  draft.rules.push(rule);
  draft.activeTab='rules';
  markDirty();render();
  body.querySelector('.route-rule:last-child [data-rule-field="value"]')?.focus();
 }
 function checkLocal(){
  if(draft.rules.length>64)throw Error('Не более 64 правил на ноду.');
  const exits=usedExits();
  if(exits.length>16)throw Error('Не более 16 выходных нод.');
  if(draft.enabled){
   for(const [i,r] of draft.rules.entries()){
    if(r.enabled===false)continue;
    if(!r.value||!r.value.trim())throw Error('Правило №'+(i+1)+': заполните категорию или адрес.');
    if(!types.some(t=>t[0]===r.matcher))throw Error('Правило №'+(i+1)+': неизвестный тип совпадения.');
    if(!targets.some(t=>t[0]===r.target))throw Error('Правило №'+(i+1)+': выберите действие.');
    if(r.target==='outbound'&&!knownOutbounds.some(out=>out.tag===r.outboundTag))
      throw Error('Правило №'+(i+1)+': выберите существующий Xray outbound.');
    if(r.target==='node'&&!selectedNode(r.nodeId))
      throw Error('Правило №'+(i+1)+': выберите действующую выходную ноду.');
   }
  }
  const relays=[];
  for(const id of exits){
   const raw=String(draft.relays.get(id)||'').trim();
   if(!raw)throw Error('У ноды «'+nameFor(selectedNode(id))+'» не заполнена конфигурация выхода. Откройте вкладку «Выходные соединения».');
   let outbound;
   try{outbound=JSON.parse(raw)}catch(e){throw Error('Неверный JSON для '+nameFor(selectedNode(id))+': '+e.message)}
   if(!outbound||Array.isArray(outbound)||typeof outbound!=='object'||!outbound.protocol||!outbound.settings)
    throw Error('Для '+nameFor(selectedNode(id))+' нужен Xray outbound с protocol и settings.');
   if('tag' in outbound)throw Error('Не добавляйте tag вручную — панель назначит его сама.');
   relays.push({nodeId:Number(id),outbound});
  }
  const geoNeeded=draft.enabled&&draft.rules.some(r=>r.enabled!==false&&geoMatch(r.matcher));
  const patch={
   routingEnabled:!!draft.enabled,
   routingDomainStrategy:draft.strategy,
   routingRules:draft.rules.map(r=>({
    enabled:r.enabled!==false,matcher:r.matcher,value:String(r.value||'').trim(),
    target:r.target,outboundTag:String(r.outboundTag||''),nodeId:Number(r.nodeId)||0
   })),
   routingRelays:relays
  };
  if(geoNeeded&&!node.geoEnabled)patch.geoEnabled=true;
  if(legacy){patch.geoBlockAds=false;patch.geoCustomRules='';}
  return patch;
 }
 async function persist(preview=false){
  const button=preview?check:save;
  try{
   const patch=checkLocal();
   button.disabled=true;check.disabled=true;save.disabled=true;
   status(preview?'Проверяем исходящую конфигурацию…':'Сохраняем правила…');
   if(preview){
    const result=await apiRequest('/api/v1/nodes/'+encodeURIComponent(node.id)+'/routing/preview',
      {method:'POST',body:JSON.stringify(patch)});
    status('Проверено: '+String(result?.rules||0)+' правил. Конфигурация собрана; применение на сервере не подтверждено.');
   }else{
    // Validate before changing the node record; never accept routes which can
    // only fail when the remote agent next asks for desired-config.
    await apiRequest('/api/v1/nodes/'+encodeURIComponent(node.id)+'/routing/preview',
      {method:'POST',body:JSON.stringify(patch)});
    await updateNode(patch);
    Object.assign(node,patch);
    draft.dirty=false;
    status('Настройки сохранены. Нода применит их при следующей подписанной синхронизации.');
    notify?.('Маршрутизация сохранена');
    afterSave?.();
   }
  }catch(error){
   status(error?.message||'Не удалось проверить маршрутизацию.');
   if(/подключение|выходн|outbound|JSON/.test(error?.message||''))draft.activeTab='exits';
   if(draft.activeTab==='exits')render();
  }finally{button.disabled=false;check.disabled=false;save.disabled=false}
 }
 form.addEventListener('submit',e=>{e.preventDefault();void persist(false)});
 form.addEventListener('change',e=>{
  const el=e.target;
  if(el.matches('[data-route-enabled]')){draft.enabled=el.checked;markDirty();render();return}
  if(el.matches('[data-route-strategy]')){draft.strategy=el.value;markDirty();return}
  if(el.matches('[data-rule-field]')&&saveRuleChange(el)){render();return}
 });
 form.addEventListener('input',e=>{
  const el=e.target;
  if(el.matches('[data-rule-field="value"]')){saveRuleChange(el);return}
  if(el.matches('[data-route-relay]')){draft.relays.set(el.dataset.routeRelay,el.value);markDirty()}
 });
 form.addEventListener('click',e=>{
  const button=e.target.closest('button');
  if(!button)return;
  if(button.dataset.routeTab){draft.activeTab=button.dataset.routeTab;render();return}
  if(button.hasAttribute('data-route-go-rules')){draft.activeTab='rules';render();return}
  if(button.hasAttribute('data-route-add')){addRule('geosite','','direct');return}
  if(button.dataset.routePreset==='ads'){addRule('geosite','category-ads-all','block');return}
  if(button.dataset.routePreset==='ru'){addRule('geosite','category-ru','node');return}
  if(button.dataset.routePreset==='ru-ip'){addRule('geoip','ru','node');return}
  if(button.dataset.routeMove){
   const row=button.closest('[data-rule-index]');if(!row)return;
   const i=Number(row.dataset.ruleIndex),j=i+Number(button.dataset.routeMove);
   if(j<0||j>=draft.rules.length)return;
   [draft.rules[i],draft.rules[j]]=[draft.rules[j],draft.rules[i]];
   markDirty();render();return;
  }
  if(button.hasAttribute('data-route-remove')){
   const i=Number(button.closest('[data-rule-index]')?.dataset.ruleIndex);
   if(!Number.isInteger(i))return;
   draft.rules.splice(i,1);markDirty();render();return;
  }
  if(button.dataset.routeConfigure){
   draft.activeTab='exits';draft.selectedExit=String(button.dataset.routeConfigure);render();return;
  }
  if(button.dataset.routeExitToggle){
   draft.selectedExit=draft.selectedExit===String(button.dataset.routeExitToggle)?'':String(button.dataset.routeExitToggle);
   render();return;
  }
  if(button.dataset.routeRemoveRelay){
   draft.relays.delete(String(button.dataset.routeRemoveRelay));markDirty();render();return;
  }
  if(button.hasAttribute('data-route-check')){void persist(true);return}
  if(button.hasAttribute('data-route-open-geodata')){
   // Do not silently discard draft changes when opening another service editor.
   if(draft.dirty){status('Сначала сохраните маршруты, затем откройте GeoData из карточки узла.');return}
   status('Файлы GeoData управляются отдельной кнопкой на карточке узла.');
  }
 });
 render();
}
window.XMeshNodeRouting={open};
})();