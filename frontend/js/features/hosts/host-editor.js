'use strict';
// Hosts presentation and Node → Host presets. The caller owns current state,
// field rendering, runtime validation, event handlers and form submission.
// Getters read the live collections; this module never keeps a second DB.
window.XMeshHostEditor=(() => {
  function create({getProfiles,getNodes,findProfile:hostProfile,inbounds:inbs,
    renderField:field,escapeHtml:esc,icon:ic,countryCodes:COUNTRY_CODES,
    countries:COUNTRIES,countryFlag}){
    // Node country has two independent representations:
    // - ISO alpha-2 (PL): subscription grouping/routing in countryCode
    // - flag emoji (🇵🇱): client-visible host Remark, including Happ.
    // Never use the ISO letters as the visible fallback when a valid flag exists.
    function hostNodeCountryCode(node){
      for(const value of [node?.countryCode,node?.flag]){
        const code=String(value||'').trim().toUpperCase();
        if(COUNTRY_CODES.includes(code))return code;
        const match=COUNTRIES.find(country=>country.flag===value);
        if(match)return match.code;
      }
      return '';
    }
    function hostNodeCountryRemark(node){
      const code=hostNodeCountryCode(node);
      const name=String(node?.name||'').trim();
      const flag=code?countryFlag(code):'';
      return flag&&name?`${flag} ${name}`:flag||name;
    }
    function hostAutofillNodeFields(form,node,force=false){
      const code=hostNodeCountryCode(node);
      const remark=form.elements.namedItem('remark');
      const country=form.elements.namedItem('countryCode');
      if(remark && (force || !String(remark.value||'').trim())){
        remark.value=hostNodeCountryRemark(node);
        if(typeof remark.dispatchEvent==='function')remark.dispatchEvent(new Event('input',{bubbles:true}));
      }
      if(country && (force || !String(country.value||'').trim()))country.value=code;
    }

    function hostEditorMarkup(o,fields){
      const fromTag=getProfiles().find(p=>inbs(p).some(i=>i.tag===o.tag));
      const selectedProfile=hostProfile(o.profileId)||fromTag||getProfiles()[0];
      const f=k=>fields.find(x=>x.k===k);
      const preset='<label class="f"><span>Быстро заполнить из ноды</span><select data-host-node-preset><option value="">Выберите сервер…</option>'+getNodes().map(n=>'<option value="'+esc(n.id)+'">'+esc(n.name)+' · '+esc(n.addr||'')+' · '+esc(n.port||443)+(hostProfile(n.profileId)?'':' · ⚠ Профиль отсутствует')+'</option>').join('')+'</select></label>';
      const p=field(f('profileId'),selectedProfile?.id||'');
      const inboundOptions=selectedProfile?inbs(selectedProfile).map(i=>[i.tag,i.tag+' · '+i.protocol]):[];
      const tag=field({...f('tag'),o:inboundOptions},o.tag||inboundOptions[0]?.[0]||'');
      const basic=['remark','serverDescription','address','port','countryCode'].filter(k=>f(k)).map(k=>field(f(k),o[k])).join('');
      const nodes=field(f('nodes'),o.nodes||[])+field(f('disabled'),!!o.disabled);
      // Keep all overrides in the same form; tabs must never split a draft.
      const advancedField=k=>{
        if(!f(k))return '';
        const value=k==='tlsVerification'?(o.clientTlsSettings?.allowInsecure===true?'insecure':o.clientTlsSettings?.allowInsecure===false?'verify':''):k==='xhttpMode'?(o.clientXhttpSettings?.mode||''):o[k]??'';
        const spec=k==='alpn'&&value&&!f(k).o.some(([key])=>key===value)?{...f(k),o:[...f(k).o,[value,value]]}:k==='clientEncryption'?{...f(k),l:'VLESS Encryption'}:f(k);
        const hint=k==='securityLayer'?'Если перед нодой стоит промежуточный сервер, выберите защиту публичного подключения.':k==='tlsVerification'?'Проверка сертификата применяется только к TLS-подключению клиента.':'';
        const markup=field(spec,value);
        return hint?markup.replace('<span>'+spec.l+'</span>','<span>'+spec.l+' <span class="host-field-help" tabindex="0" role="img" title="'+esc(hint)+'" aria-label="'+esc(hint)+'">ⓘ</span></span>'):markup;
      };
      const transportAdvanced=['sni','host','path','xhttpMode','useSniAsHost','serviceName'].map(advancedField).join('');
      const securityAdvanced=['securityLayer','alpn','fp','tlsVerification','publicKey','shortId','spiderX','clientEncryption'].map(advancedField).join('');
      const clientFields=['clientXhttpSettings','clientHeaders','clientTlsSettings','clientMasqueSettings'].filter(k=>f(k)).map(k=>field(f(k),typeof o[k]==='object'&&o[k]!==null?JSON.stringify(o[k],null,2):o[k]||'')).join('');
      const tabs=[['connection','Подключение','link'],['client','Параметры клиента','sliders'],['preview','Предпросмотр','globe']];
      const panel=(key,body)=>'<div id="host-panel-'+key+'" role="tabpanel" aria-labelledby="host-tab-'+key+'" data-host-editor-pane="'+key+'" data-active="'+(key==='connection')+'" aria-hidden="'+(key!=='connection')+'"'+(key==='connection'?'':' inert')+'>'+body+'</div>';
      return '<div class="host-editor-layout">'+
        '<nav class="host-editor-tabs" role="tablist" aria-label="Настройки хоста">'+tabs.map(([key,label,icon],index)=>'<button type="button" role="tab" id="host-tab-'+key+'" aria-controls="host-panel-'+key+'" aria-selected="'+(index===0)+'" tabindex="'+(index===0?'0':'-1')+'" data-host-editor-tab="'+key+'">'+ic(icon)+'<span>'+label+'</span></button>').join('')+'</nav>'+
        '<div class="host-editor-panes">'+
        panel('connection','<div class="host-connection-workspace"><section class="host-editor-main host-primary-panel" aria-label="Подключение и назначение">'+
          '<div class="node-form-section-title">'+ic('link')+'<span>Подключение</span></div>'+
          '<div class="host-connect-fields">'+preset+p+tag+'</div>'+
          '<div class="node-form-section-title">Публичная точка</div><div class="host-public-fields">'+basic+'</div><small class="host-description-hint">Описание сервера показывается под названием в Happ. Поле необязательное, максимум 30 символов.</small>'+ (window.XMeshRemarkPicker?.markup()||'')+'</section>'+
          '<section class="host-assignment-panel"><div class="node-form-section-title">'+ic('server')+'<span>Назначение</span></div>'+
          '<div class="host-assignment-fields">'+nodes+'</div><small class="note" data-host-count></small></section></div>')+
        panel('client','<section class="host-advanced host-advanced-panel" aria-label="Параметры клиента">'+
          '<div class="host-advanced-heading"><div class="node-form-section-title">'+ic('sliders')+'<span>Параметры клиента</span></div>'+
          '<p class="node-ip-hint">Пустые поля наследуются из XRAY STUDIO.</p></div>'+
          '<div class="host-advanced-groups">'+
          '<section class="host-client-group" aria-label="Транспорт"><h3 class="host-client-group-heading">'+ic('link')+'<span>Транспорт</span></h3><div class="host-advanced-fields">'+transportAdvanced+'</div></section>'+
          '<section class="host-client-group" aria-label="Защита подключения"><h3 class="host-client-group-heading">'+ic('shield')+'<span>Защита подключения</span></h3><div class="host-advanced-fields">'+securityAdvanced+'</div></section></div>'+
          '<div class="host-advanced-actions"><button type="button" class="gh sm" data-host-clear-overrides>'+ic('rotate-ccw')+'Сбросить переопределения</button>'+
          '<details class="host-client-settings"><summary>Экспертные настройки JSON</summary><p class="node-ip-hint">JSON-объект. Пустое поле наследует настройки профиля. Применяется только к клиентской конфигурации.</p>'+clientFields+'</details></div></section>')+
        panel('preview','<section class="host-editor-side" aria-label="Клиентское подключение">'+
          '<div class="node-form-section-title">'+ic('globe')+'<span>Клиентское подключение</span></div>'+
          '<p class="node-ip-hint">Предпросмотр из XRAY STUDIO. Приватные ключи не экспортируются.</p>'+
          '<div class="host-preview-workspace"><div class="host-resolved" data-host-resolved></div><div class="host-preview-status">'+
          '<p class="node-ip-hint" data-host-runtime role="status" aria-live="polite"></p>'+
          '<p class="host-validation" data-host-warnings role="status" hidden></p>'+
          '<button type="button" class="gh sm" data-host-repair hidden></button>'+
          '<button type="button" class="gh sm" data-host-link-profile hidden></button>'+
          '<p class="node-ip-hint host-preview-disclaimer">Предпросмотр не подтверждает применение профиля, добавление UUID или доступность порта.</p></div></div></section>')+
        '</div></div>';
    }
    function bindHostEditor(form){
      if(!form||form.dataset.hostTabsBound)return;
      form.dataset.hostTabsBound='true';
      window.XMeshRemarkPicker?.bind(form,'[name="remark"]');
      // Prepare themed selects before measuring the shared intrinsic task frame.
      // Inactive tasks stay visually hidden throughout this synchronous setup.
      for(const pane of form.querySelectorAll('[data-host-editor-pane]'))pane.inert=false;
      window.XMeshSelects?.refresh(form);
      for(const pane of form.querySelectorAll('[data-host-editor-pane]'))pane.inert=pane.dataset.active!=='true';
      const keys=['connection','client','preview'];
      const activate=(key,focus=false)=>{
        for(const tab of form.querySelectorAll('[data-host-editor-tab]')){
          const selected=tab.dataset.hostEditorTab===key;
          tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
          if(selected&&focus)tab.focus();
        }
        for(const pane of form.querySelectorAll('[data-host-editor-pane]')){
          const active=pane.dataset.hostEditorPane===key;
          pane.dataset.active=String(active);pane.inert=!active;pane.setAttribute('aria-hidden',String(!active));
        }
        const pane=form.querySelector('[data-host-editor-pane="'+key+'"]');
        window.XMeshSelects?.refresh(pane);
        const body=form.querySelector('.host-editor-panes');if(body)body.scrollTop=0;
      };
      form.addEventListener('click',event=>{
        const tab=event.target.closest('[data-host-editor-tab]');
        if(tab)activate(tab.dataset.hostEditorTab);
      });
      form.addEventListener('keydown',event=>{
        const tab=event.target.closest('[data-host-editor-tab]');
        if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();
        const index=keys.indexOf(tab.dataset.hostEditorTab);
        activate(keys[event.key==='Home'?0:event.key==='End'?keys.length-1:(index+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length],true);
      });
      let revealing=false;
      form.addEventListener('invalid',event=>{
        if(revealing)return;
        const pane=event.target.closest('[data-host-editor-pane]');
        if(pane){revealing=true;activate(pane.dataset.hostEditorPane);setTimeout(()=>{revealing=false},0);}
      },true);
      form.addEventListener('submit',()=>{
        for(const key of ['clientXhttpSettings','clientHeaders','clientTlsSettings','clientMasqueSettings']){
          const raw=form.elements.namedItem(key)?.value.trim();
          if(!raw)continue;
          try{const value=JSON.parse(raw);if(value&&typeof value==='object'&&!Array.isArray(value))continue;}catch(_){}
          activate('client');const details=form.querySelector('.host-client-settings');if(details)details.open=true;break;
        }
      },true);
    }

    return Object.freeze({hostEditorMarkup,hostNodeCountryCode,hostNodeCountryRemark,hostAutofillNodeFields,bindHostEditor});
  }
  return Object.freeze({create});
})();
