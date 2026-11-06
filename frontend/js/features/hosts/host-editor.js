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
      if(remark && (force || !String(remark.value||'').trim()))remark.value=hostNodeCountryRemark(node);
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
      const basic=['remark','address','port','countryCode'].map(k=>field(f(k),o[k])).join('');
      const nodes=field(f('nodes'),o.nodes||[])+field(f('disabled'),!!o.disabled);
      const advanced=['sni','host','path','securityLayer','alpn','fp','xhttpMode','tlsVerification','useSniAsHost','serviceName','publicKey','shortId','spiderX','clientEncryption'].filter(k=>f(k)).map(k=>{
        const value=k==='tlsVerification'?(o.clientTlsSettings?.allowInsecure===true?'insecure':o.clientTlsSettings?.allowInsecure===false?'verify':''):k==='xhttpMode'?(o.clientXhttpSettings?.mode||''):o[k]??'';
        const spec=k==='alpn'&&value&&!f(k).o.some(([key])=>key===value)?{...f(k),o:[...f(k).o,[value,value]]}:f(k);
        const hint=k==='securityLayer'?'Если перед нодой стоит промежуточный сервер, выберите защиту публичного подключения.':k==='tlsVerification'?'Проверка сертификата применяется только к TLS-подключению клиента.':'';
        const markup=field(spec,value);
        return hint?markup.replace('<span>'+spec.l+'</span>','<span>'+spec.l+' <span class="host-field-help" tabindex="0" role="img" title="'+esc(hint)+'" aria-label="'+esc(hint)+'">ⓘ</span></span>'):markup;
      }).join('');
      const clientFields=['clientXhttpSettings','clientHeaders','clientTlsSettings','clientMasqueSettings'].filter(k=>f(k)).map(k=>field(f(k),typeof o[k]==='object'&&o[k]!==null?JSON.stringify(o[k],null,2):o[k]||'')).join('');
      // Three permanent, side-by-side editing zones. Keep all input names and
      // actions unchanged so the existing save and live-preview logic still work.
      return '<div class="host-editor-layout">'+
        '<section class="host-editor-main host-primary-panel" aria-label="Подключение и назначение">'+
        '<div class="node-form-section-title">'+ic('link')+'<span>Подключение</span></div>'+
        '<div class="host-connect-fields">'+preset+p+tag+'</div>'+
        '<div class="node-form-section-title">Публичная точка</div>'+
        '<div class="host-public-fields">'+basic+'</div>'+
        '</section>'+
        '<div class="host-assignment-panel"><div class="node-form-section-title">'+ic('server')+'<span>Назначение</span></div>'+
        '<div class="host-assignment-fields">'+nodes+'</div>'+
        '<small class="note" data-host-count></small></div>'+
        '<section class="host-advanced host-advanced-panel" aria-label="Расширенные переопределения">'+
        '<div class="host-advanced-heading"><div class="node-form-section-title">'+ic('sliders')+'<span>Расширенные переопределения</span></div>'+
        '<p class="node-ip-hint">Пустые поля наследуются из XRAY STUDIO.</p></div>'+
        '<div class="host-advanced-fields">'+advanced+'</div>'+
        '<div class="host-advanced-actions"><button type="button" class="gh sm" data-host-clear-overrides>'+ic('rotate-ccw')+'Сбросить переопределения</button>'+
        '<details class="host-client-settings"><summary>Экспертные настройки JSON</summary><p class="node-ip-hint">JSON-объект. Пустое поле наследует настройки профиля. Применяется только к клиентской конфигурации.</p>'+clientFields+'</details></div></section>'+
        '<section class="host-editor-side" aria-label="Клиентское подключение">'+
        '<div class="node-form-section-title">'+ic('globe')+'<span>Клиентское подключение</span></div>'+
        '<p class="node-ip-hint">Предпросмотр из XRAY STUDIO. Приватные ключи не экспортируются.</p>'+
        '<div class="host-resolved" data-host-resolved></div>'+
        '<p class="node-ip-hint" data-host-runtime role="status" aria-live="polite"></p>'+
        '<p class="host-validation" data-host-warnings role="status" hidden></p>'+
        '<button type="button" class="gh sm" data-host-repair hidden></button>'+
        '<button type="button" class="gh sm" data-host-link-profile hidden></button>'+
        '<p class="node-ip-hint host-preview-disclaimer">Предпросмотр не подтверждает применение профиля, добавление UUID или доступность порта.</p></section></div>';
    }
    return Object.freeze({hostEditorMarkup,hostNodeCountryCode,hostNodeCountryRemark,hostAutofillNodeFields});
  }
  return Object.freeze({create});
})();
