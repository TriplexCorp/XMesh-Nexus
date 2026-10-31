'use strict';
/* Public endpoints live inside XRAY STUDIO. PostgreSQL collection "hosts"
 * stays as the storage contract for existing users and subscription URLs. */
window.XMeshStudioHosts=(()=>{
  const field=(label,key,placeholder='',type='text')=>
   '<label class="sv-field"><span>'+label+'</span><input data-endpoint="'+key+'" type="'+type+'" placeholder="'+placeholder+'" autocomplete="off" spellcheck="false"></label>';
  function view(){
    return '<section class="sv-public-endpoints" data-endpoints-panel aria-label="Публичные подключения">'+
     '<header class="sv-endpoints-head"><div><h4>Публичные подключения</h4><p>Адреса для выдачи подписок. Защита и транспорт задаются в inbound.</p></div><button type="button" data-endpoint-action="add">+ Подключение</button></header>'+
     '<div class="sv-endpoint-list" data-endpoint-list role="list"></div>'+
     '<div class="sv-endpoint-editor" data-endpoint-editor hidden>'+
     '<header><b data-endpoint-title>Новое подключение</b><button type="button" data-endpoint-action="cancel" aria-label="Закрыть">✕</button></header>'+
     '<div class="sv-two">'+field('Название','remark','🇵🇱 Польша-1')+field('Публичный адрес','address','vpn.example.com')+'</div>'+
     '<div class="sv-two">'+field('Внешний порт','port','443','number')+
       '<label class="sv-field"><span>Статус</span><select data-endpoint="enabled"><option value="yes">Включено</option><option value="no">Отключено</option></select></label></div>'+
     '<details class="sv-advanced"><summary>Клиентские переопределения</summary><p class="sv-muted">Укажите только отличия от настроек inbound. Transport и Security не дублируются.</p>'+
     '<div class="sv-two">'+field('Внешний SNI','sni','vpn.example.com')+field('Host','host','cdn.example.com')+'</div>'+
     '<div class="sv-two">'+field('Path','path','/xhttp')+
      '<label class="sv-field"><span>Fingerprint</span><select data-endpoint="fp"><option value="chrome">Chrome (по умолчанию)</option><option value="firefox">Firefox</option><option value="safari">Safari</option><option value="ios">iOS</option></select></label></div>'+
     '<div class="sv-two">'+field('ALPN','alpn','h2,http/1.1')+field('gRPC Service Name','serviceName','service')+'</div>'+
     '<div class="sv-two">'+field('REALITY Public Key','publicKey')+field('REALITY Short ID','shortId')+'</div>'+
     '<div class="sv-two">'+field('REALITY Spider X','spiderX','/')+field('Код страны','countryCode','DE')+'</div>'+
     '<div class="sv-two">'+field('VLESS Encryption клиента','clientEncryption','Пусто — наследовать из inbound')+'</div>'+
     '<p class="sv-muted">Пустые значения наследуются от inbound. Клиентский VLESS Encryption не равен серверному decryption.</p></details>'+
     '<div class="sv-endpoint-nodes"><b>Доступные узлы</b><p>Без выбора — все узлы текущего профиля.</p><div data-endpoint-nodes></div></div>'+
     '<footer><button type="button" class="sv-primary" data-endpoint-action="save">Сохранить подключение</button><button type="button" data-endpoint-action="cancel">Отмена</button></footer></div></section>';
  }
  function mount(root,ctx){
    const qs=s=>root.querySelector(s);
    const text=(type,cls,content)=>{const el=document.createElement(type);el.className=cls;if(content!=null)el.textContent=String(content);return el;};
    const value=k=>qs('[data-endpoint="'+k+'"]')?.value?.trim()||'';
    const set=(k,v)=>{const el=qs('[data-endpoint="'+k+'"]');if(el)el.value=v==null?'':v;};
    let editing=null;
    function close(){editing=null;qs('[data-endpoint-editor]').hidden=true;}
    const profile=()=>ctx.profileId();
    const tag=()=>ctx.inboundTag();
    const connected=()=>Array.isArray(ctx.DB.nodes)?ctx.DB.nodes.filter(n=>String(n.profileId)===String(profile())):[];
    const hosts=()=>Array.isArray(ctx.DB.hosts)?ctx.DB.hosts.filter(h=>h.tag===tag()&&
      (h.profileId==null||String(h.profileId)===String(profile()))):[];
    function render(){
      const list=qs('[data-endpoint-list]');if(!list)return;
      list.replaceChildren();
      if(profile()==null||!tag()){
        list.append(text('p','sv-muted','Сохраните профиль и выберите inbound для добавления подключений.'));return;
      }
      const rows=[...hosts()].sort((a,b)=>Number(a.order||0)-Number(b.order||0));
      if(!rows.length)list.append(text('p','sv-muted','Публичных подключений пока нет. Добавьте адрес для подписок.'));
      for(const h of rows){
        const card=text('article','sv-endpoint-card'+(h.disabled?' is-disabled':''));card.setAttribute('role','listitem');
        const details=text('div','sv-endpoint-info');
        details.append(text('strong','',h.remark||h.address||'Подключение'),
          text('span','',String(h.address||'—')+':'+String(h.port||443)),
          text('small','',Array.isArray(h.nodes)&&h.nodes.length?
           'Узлы: '+h.nodes.map(id=>ctx.DB.nodes.find(n=>String(n.id)===String(id))?.name||'#'+id).join(', '):
           'Все узлы профиля'));
        const status=text('span','sv-endpoint-status',h.disabled?'Отключено':'Включено');
        const actions=text('div','sv-endpoint-actions');
        for(const [op,label] of [['edit','Изменить'],['toggle',h.disabled?'Включить':'Отключить'],['delete','Удалить']]){
          const button=text('button','',label);button.type='button';button.dataset.endpointAction=op;button.dataset.hostId=String(h.id);actions.append(button);
        }
        card.append(details,status,actions);list.append(card);
      }
    }
    function open(h){
      if(profile()==null||!tag()){ctx.notify('Сначала сохраните профиль и выберите inbound.');return}
      editing=h?.id??null;
      qs('[data-endpoint-title]').textContent=h?'Изменить подключение':'Новое подключение';
      for(const k of ['remark','address','sni','host','path','publicKey','shortId','alpn','serviceName','spiderX','countryCode','clientEncryption'])set(k,h?.[k]||'');
      set('fp',h?.fp||'chrome');
      set('port',h?.port||443);set('enabled',h?.disabled?'no':'yes');
      const nodes=qs('[data-endpoint-nodes]');nodes.replaceChildren();
      for(const n of connected()){
        const label=text('label','sv-endpoint-node');
        const check=document.createElement('input');check.type='checkbox';check.value=String(n.id);
        check.checked=Array.isArray(h?.nodes)&&h.nodes.map(String).includes(String(n.id));
        label.append(check,text('span','',n.name||'Узел '+n.id));nodes.append(label);
      }
      const missingPins=(h?.nodes||[]).filter(id=>!connected().some(n=>String(n.id)===String(id)));
      if(missingPins.length){
        nodes.append(text('p','sv-endpoint-warning','Сохранены привязки к другим узлам: '+missingPins.join(', ')+'. Они не будут сброшены автоматически.'));
      }
      if(!connected().length)nodes.append(text('p','sv-muted','Узлы пока не привязаны к профилю.'));
      qs('[data-endpoint-editor]').hidden=false;
      qs('[data-endpoint-editor]').scrollIntoView?.({behavior:'smooth',block:'nearest'});
    }
    async function save(){
      const remark=value('remark'),address=value('address'),port=Number(value('port'));
      if(profile()==null||!tag())return ctx.notify('Сначала сохраните профиль.');
      if(!remark||!address)return ctx.notify('Укажите название и публичный адрес.');
      if(!Number.isInteger(port)||port<1||port>65535)return ctx.notify('Некорректный внешний порт.');
      if([...address].some(c=>' /@?#'.includes(c)||c==='\\')||address.length>253)return ctx.notify('Некорректный адрес сервера.');
      if(value('countryCode')&&!/^[A-Za-z]{2}$/.test(value('countryCode')))return ctx.notify('Страна: укажите двухбуквенный код, например DE.');
      if(value('alpn')&&!value('alpn').split(',').every(x=>/^[a-zA-Z0-9/._-]{1,32}$/.test(x.trim())))return ctx.notify('ALPN: неверный формат.');
      const nodeIds=[...qs('[data-endpoint-nodes]').querySelectorAll('input:checked')].map(x=>Number(x.value));
      const old=editing==null?null:hosts().find(h=>String(h.id)===String(editing));
      // A legacy host may be pinned to nodes no longer in this profile.
      // Do not silently broaden its access by discarding those associations.
      for(const savedId of old?.nodes||[]){
        if(!connected().some(node=>String(node.id)===String(savedId)) &&
           !nodeIds.some(id=>String(id)===String(savedId))) nodeIds.push(savedId);
      }
      if(editing!=null&&!old)return ctx.notify('Подключение не найдено.');
      const data={remark,address,port,tag:tag(),profileId:profile(),
        sni:value('sni'),host:value('host'),path:value('path'),fp:value('fp')||'chrome',
        publicKey:value('publicKey'),shortId:value('shortId'),
        alpn:value('alpn'),serviceName:value('serviceName'),spiderX:value('spiderX'),
        countryCode:value('countryCode').toUpperCase(),clientEncryption:value('clientEncryption'),
        nodes:nodeIds,disabled:value('enabled')==='no'};
      try{
        if(old)await ctx.api.update('hosts',old.id,data);
        else await ctx.api.create('hosts',{...data,order:(ctx.DB.hosts||[]).length+1});
        close();render();ctx.notify('Подключение сохранено');
      }catch(err){ctx.notify('Не удалось сохранить: '+err.message)}
    }
    async function action(button){
      const op=button.dataset.endpointAction;
      if(op==='add')return open(null);
      if(op==='cancel')return close();
      if(op==='save')return save();
      const h=hosts().find(x=>String(x.id)===button.dataset.hostId);
      if(!h)return ctx.notify('Подключение не найдено.');
      if(op==='edit')return open(h);
      if(op==='toggle'){
        try{await ctx.api.update('hosts',h.id,{disabled:!h.disabled});render();ctx.notify('Статус подключения изменён')}
        catch(e){ctx.notify('Не удалось изменить: '+e.message)}return;
      }
      if(op==='delete'){
        const ok=await ctx.confirm({title:'Удалить публичное подключение?',
         description:'Удалить «'+(h.remark||h.address)+'» из всех клиентских подписок?',
         confirmLabel:'Удалить',cancelLabel:'Отмена',danger:true});
        if(!ok)return;
        try{await ctx.api.remove('hosts',h.id);close();render();ctx.notify('Подключение удалено')}
        catch(e){ctx.notify('Не удалось удалить: '+e.message)}
      }
    }
    root.addEventListener('click',e=>{
      const button=e.target.closest('[data-endpoint-action]');
      if(button&&root.contains(button)){e.preventDefault();e.stopPropagation();void Promise.resolve(action(button)).catch(err=>ctx.notify(err.message))}
    });
    render();
    return {render,close};
  }
  return {view,mount};
})();
