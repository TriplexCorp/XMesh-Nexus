'use strict';
// Personal client-routing overrides share the global rule schema and destination
// catalogue. Editing is staged until the user card's existing Save action.
(()=>{
  const instances=new WeakMap();
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));
  const english=()=>window.XMeshI18n?.getLanguage?.()==='en';
  const tr=(ru,en)=>english()?en:ru;
  const matches=[
    ['geosite','GeoSite'],['geoip','GeoIP'],['domain',tr('Домен','Domain')],
    ['ip','IP / CIDR'],['port',tr('Порт','Port')]
  ];
  const actions=[
    ['proxy',tr('Основной сервер','Primary server')],
    ['server',tr('Другой сервер','Another server')],
    ['direct',tr('Напрямую','Direct')],
    ['block',tr('Блокировать','Block')]
  ];
  const networks=[
    ['tcp,udp','TCP + UDP'],['tcp','TCP'],['udp','UDP']
  ];
  const defaultRule=()=>({match:'geosite',value:'',action:'server',server:'',network:'tcp,udp'});
  const option=(value,label,current)=>'<option value="'+escapeHTML(value)+'"'+(value===current?' selected':'')+'>'+escapeHTML(label)+'</option>';
  const options=(values,current)=>values.map(([value,label])=>option(value,label,current)).join('');

  function mount(canvas,user,db){
    const root=canvas?.querySelector('[data-user-client-routing-root]');
    if(!root||instances.has(root))return;
    const original=user?.clientRouting;
    const mode=original?.mode==='custom'?'custom':'inherit';
    const rules=Array.isArray(original?.rules)?original.rules.map(rule=>({...rule})):[];
    const state={mode,rules,targets:window.XMeshClientRouting?.destinations?.(db)||[],readonly:canvas.closest('.viewer-readonly')!==null};
    instances.set(root,state);
    const markDirty=()=>{
      const label=canvas.querySelector('[data-user-edit-dirty]');
      if(label)label.textContent=tr('Есть несохранённые изменения','Unsaved changes');
    };
    const targetChoices=rule=>{
      let choices=state.targets.map(row=>option(row.key,row.label,rule.server)).join('');
      if(rule.server&&!state.targets.some(row=>row.key===rule.server)){
        choices=option(rule.server,tr('Недоступен: ','Unavailable: ')+rule.server,rule.server)+choices;
      }
      return option('',tr('Выберите подключение','Select an endpoint'),rule.server)+choices;
    };
    const rowMarkup=(rule,index)=>
      '<article class="user-route-rule" data-user-route-row="'+index+'">'+
        '<div class="user-route-rule-head"><strong>'+tr('Правило ','Rule ')+(index+1)+'</strong>'+
          '<div class="user-route-rule-actions">'+
            '<button type="button" data-user-route-move="up" data-index="'+index+'" title="'+tr('Выше','Move up')+'"'+(index===0?' disabled':'')+'>↑</button>'+
            '<button type="button" data-user-route-move="down" data-index="'+index+'" title="'+tr('Ниже','Move down')+'"'+(index===state.rules.length-1?' disabled':'')+'>↓</button>'+
            '<button type="button" data-user-route-remove="'+index+'" class="user-route-remove">'+tr('Удалить','Remove')+'</button>'+
          '</div></div>'+
        '<div class="user-route-rule-fields">'+
          '<label><span>'+tr('Условие','Match')+'</span><select data-user-route-field="match" data-index="'+index+'">'+options(matches,rule.match)+'</select></label>'+
          '<label><span>'+tr('Значение','Value')+'</span><input type="text" data-user-route-field="value" data-index="'+index+'" maxlength="200" value="'+escapeHTML(rule.value)+'" placeholder="youtube"></label>'+
          '<label><span>'+tr('Действие','Action')+'</span><select data-user-route-field="action" data-index="'+index+'">'+options(actions,rule.action)+'</select></label>'+
          '<label><span>'+tr('Сеть','Network')+'</span><select data-user-route-field="network" data-index="'+index+'">'+options(networks,rule.network||'tcp,udp')+'</select></label>'+
          (rule.action==='server'?'<label class="user-route-target"><span>'+tr('Целевое подключение','Destination')+'</span><select data-user-route-field="server" data-index="'+index+'" data-no-translate>'+targetChoices(rule)+'</select></label>':'')+
        '</div></article>';
    const paint=()=>{
      root.innerHTML=
        '<div class="user-route-intro"><div><h3>'+tr('Индивидуальный клиентский рутинг','Personal client routing')+'</h3>'+
          '<p>'+tr('Персональные правила имеют приоритет над глобальными только для этого пользователя. Остальная маршрутизация наследуется.','Personal rules take priority over global rules only for this user. All other routing is inherited.')+'</p></div>'+
          '<span class="user-route-count">'+state.rules.length+' '+tr('правил','rules')+'</span></div>'+
        '<div class="user-route-mode" role="group" aria-label="'+tr('Режим маршрутизации','Routing mode')+'">'+
          '<label class="'+(state.mode==='inherit'?'active':'')+'"><input type="radio" name="user-route-mode" value="inherit"'+(state.mode==='inherit'?' checked':'')+'><span><b>'+tr('Наследовать глобальные','Inherit global rules')+'</b><small>'+tr('Без изменений для пользователя','No per-user changes')+'</small></span></label>'+
          '<label class="'+(state.mode==='custom'?'active':'')+'"><input type="radio" name="user-route-mode" value="custom"'+(state.mode==='custom'?' checked':'')+'><span><b>'+tr('Индивидуальные правила','Personal rules')+'</b><small>'+tr('Исключения поверх глобальных','Overrides above global rules')+'</small></span></label>'+
        '</div>'+
        (state.mode==='custom'?
          '<div class="user-route-rules">'+
            (state.rules.length?state.rules.map(rowMarkup).join(''):'<p class="user-route-empty">'+tr('Правил пока нет. Глобальная маршрутизация продолжает действовать.','No personal rules yet. Global routing is still active.')+'</p>')+
            '<button type="button" class="user-route-add" data-user-route-add>+ '+tr('Добавить правило','Add rule')+'</button>'+
          '</div>':'')+
        '<p class="user-route-warning">'+tr('Целевой сервер должен входить в подписку пользователя. Недоступный сервер безопасно блокируется. Правила действуют в клиентском Xray JSON после обновления подписки.','A destination must be in this user’s subscription. Unavailable destinations are safely blocked. Rules apply in client Xray JSON after subscription refresh.')+'</p>';
      if(state.readonly)root.querySelectorAll('input,select,button').forEach(input=>input.disabled=true);
      window.XMeshSelects?.refresh(root);
    };
    root.addEventListener('click',event=>{
      if(state.readonly)return;
      const add=event.target.closest('[data-user-route-add]');
      const remove=event.target.closest('[data-user-route-remove]');
      const move=event.target.closest('[data-user-route-move]');
      if(add){
        if(state.rules.length>=32)return;
        state.rules.push(defaultRule());paint();markDirty();
      }else if(remove){
        state.rules.splice(Number(remove.dataset.userRouteRemove),1);paint();markDirty();
      }else if(move){
        const index=Number(move.dataset.index),other=index+(move.dataset.userRouteMove==='up'?-1:1);
        if(other<0||other>=state.rules.length)return;
        [state.rules[index],state.rules[other]]=[state.rules[other],state.rules[index]];
        paint();markDirty();
      }
    });
    root.addEventListener('input',event=>{
      if(state.readonly)return;
      const el=event.target;
      if(!el.matches('[data-user-route-field="value"]'))return;
      const rule=state.rules[Number(el.dataset.index)];
      if(rule){rule.value=el.value;markDirty();}
    });
    root.addEventListener('change',event=>{
      if(state.readonly)return;
      const el=event.target;
      if(el.name==='user-route-mode'){
        state.mode=el.value==='custom'?'custom':'inherit';paint();markDirty();return;
      }
      if(!el.matches('[data-user-route-field]'))return;
      const rule=state.rules[Number(el.dataset.index)];
      if(!rule)return;
      const field=el.dataset.userRouteField;
      if(!['match','value','action','server','network'].includes(field))return;
      rule[field]=el.value;
      if(field==='action'&&el.value!=='server')delete rule.server;
      if(field==='action'||field==='match')paint();
      markDirty();
    });
    paint();
  }
  function serialize(canvas){
    const root=canvas?.querySelector('[data-user-client-routing-root]');
    const state=instances.get(root);
    if(!state)return null;
    if(state.mode==='custom'){
      for(const rule of state.rules){
        if(!String(rule.value||'').trim()||rule.value.length>200)
          throw Object.assign(new Error(tr('Укажите значение каждого правила.','Enter a value for every rule.')),{tab:'routing'});
        if(rule.action==='server'&&!rule.server)
          throw Object.assign(new Error(tr('Выберите целевой сервер для каждого правила.','Select a destination for each server rule.')),{tab:'routing'});
      }
    }
    return {mode:state.mode,rules:state.rules.map(rule=>{
      const entry={match:rule.match,value:String(rule.value||'').trim(),action:rule.action,network:rule.network||'tcp,udp'};
      if(rule.action==='server')entry.server=rule.server||'';
      return entry;
    })};
  }
  window.XMeshUserClientRouting=Object.freeze({mount,serialize});
})();
