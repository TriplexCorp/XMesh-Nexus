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
    // - flag emoji (🇵🇱): client-visible host remark in subscription clients.
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
      const preset='<label class="f host-icon-field"><span>Быстро заполнить из ноды</span><select data-host-node-preset><option value="">Выберите сервер…</option>'+getNodes().map(n=>'<option value="'+esc(n.id)+'">'+esc(n.name)+' · '+esc(n.addr||'')+' · '+esc(n.port||443)+(hostProfile(n.profileId)?'':' · ⚠ Профиль отсутствует')+'</option>').join('')+'</select><span class="host-control-glyph" aria-hidden="true">'+ic('server')+'</span></label>';
      // Field-level icons use the same safe, bundled SVG glyphs as the panel.
      // Decorate only ordinary controls: checkbox lists, hidden JSON, and
      // country-picker adapters keep their existing accessible DOM structure.
      const withIcon=(markup,iconName)=>{
        if(!markup||!iconName||!/^<label class="f">/.test(markup))return markup;
        return markup.replace('<label class="f">','<label class="f host-icon-field">')
          .replace('</label>','<span class="host-control-glyph" aria-hidden="true">'+ic(iconName)+'</span></label>');
      };
      const fieldIcon=(name,value,iconName)=>withIcon(field(f(name),value),iconName);
      const inputIcons={remark:'layers',address:'link',port:'terminal',countryCode:'globe',
        serverDescription:'file',host:'globe',path:'sliders',xhttpMode:'layers',
        securityLayer:'shield',clientEncryption:'lock',sni:'globe',
        serviceName:'server',alpn:'link',fp:'shield',tlsVerification:'shield',
        publicKey:'key',shortId:'key',spiderX:'link'};
      const p=fieldIcon('profileId',selectedProfile?.id||'','layers');
      const inboundOptions=selectedProfile?inbs(selectedProfile).map(i=>[i.tag,i.tag+' · '+i.protocol]):[];
      const tag=withIcon(field({...f('tag'),o:inboundOptions},o.tag||inboundOptions[0]?.[0]||''),'sliders');
      const basic=['remark','address','port','countryCode','serverDescription'].filter(k=>f(k)).map(k=>fieldIcon(k,o[k],inputIcons[k])).join('');
      const nodes=field(f('nodes'),o.nodes||[])+field(f('disabled'),!!o.disabled);
      // Every field lives in one editor; less common overrides are disclosed
      // in place instead of being moved to a separate tab or removed.
      const advancedField=k=>{
        if(!f(k))return '';
        const value=k==='tlsVerification'?(o.clientTlsSettings?.allowInsecure===true?'insecure':o.clientTlsSettings?.allowInsecure===false?'verify':''):k==='xhttpMode'?(o.clientXhttpSettings?.mode||''):o[k]??'';
        const spec=k==='alpn'&&value&&!f(k).o.some(([key])=>key===value)?{...f(k),o:[...f(k).o,[value,value]]}:k==='clientEncryption'?{...f(k),l:'VLESS Encryption'}:f(k);
        const hint=k==='securityLayer'?'Если перед нодой стоит промежуточный сервер, выберите защиту публичного подключения.':k==='tlsVerification'?'Проверка сертификата применяется только к TLS-подключению клиента.':'';
        const markup=withIcon(field(spec,value),inputIcons[k]);
        return hint?markup.replace('<span>'+spec.l+'</span>','<span>'+spec.l+' <span class="host-field-help" tabindex="0" role="img" title="'+esc(hint)+'" aria-label="'+esc(hint)+'">ⓘ</span></span>'):markup;
      };
      const essentialClient=['host','path','xhttpMode','useSniAsHost','securityLayer','clientEncryption','sni'].map(advancedField).join('');
      const extraClient=['serviceName','alpn','fp','tlsVerification','publicKey','shortId','spiderX'].map(advancedField).join('');
      const clientFields=['clientXhttpSettings','clientHeaders','clientTlsSettings','clientMasqueSettings'].filter(k=>f(k)).map(k=>field(f(k),typeof o[k]==='object'&&o[k]!==null?JSON.stringify(o[k],null,2):o[k]||'')).join('');
      return '<div class="host-editor-layout" data-host-single-page>'+
          '<div class="host-editor-column host-editor-column-primary">'+
          '<section class="host-editor-card host-primary-panel" aria-label="Подключение">'+
            '<div class="node-form-section-title"><span class="host-section-icon" aria-hidden="true">'+ic('link')+'</span><span>Подключение</span></div>'+
            '<div class="host-connect-fields">'+preset+p+tag+'</div>'+
          '</section>'+
          '<section class="host-editor-card host-advanced host-advanced-panel" aria-label="Параметры клиента">'+
            '<div class="host-advanced-heading"><div class="node-form-section-title"><span class="host-section-icon" aria-hidden="true">'+ic('sliders')+'</span><span>Параметры клиента</span></div>'+
              '<p class="node-ip-hint">Пустые поля наследуются из XRAY STUDIO.</p></div>'+
            '<div class="host-advanced-fields">'+essentialClient+'</div>'+
            '<div class="host-advanced-actions">'+
              '<button type="button" class="gh sm" data-host-clear-overrides>'+ic('rotate-ccw')+'Сбросить переопределения</button>'+
              '<details class="host-extra-settings"><summary>'+ic('settings')+'Дополнительные параметры подключения</summary>'+
                '<div class="host-extra-fields">'+extraClient+'</div></details>'+
              '<details class="host-client-settings"><summary>'+ic('code')+'Экспертные настройки JSON</summary>'+
                '<p class="node-ip-hint">JSON-объект. Пустое поле наследует настройки профиля. Применяется только к клиентской конфигурации.</p>'+clientFields+'</details>'+
            '</div>'+
          '</section>'+
          '</div><div class="host-editor-column host-editor-column-middle">'+
          '<section class="host-editor-card host-assignment-panel">'+
            '<div class="node-form-section-title"><span class="host-section-icon" aria-hidden="true">'+ic('server')+'</span><span>Назначение</span></div>'+
            '<div class="host-assignment-fields">'+nodes+'</div><small class="note" data-host-count></small>'+
          '</section>'+
          '<section class="host-editor-card host-public-panel" aria-label="Публичная точка">'+
            '<div class="node-form-section-title"><span class="host-section-icon" aria-hidden="true">'+ic('globe')+'</span><span>Публичная точка</span></div>'+
            '<div class="host-public-fields">'+basic+'</div>'+(window.XMeshRemarkPicker?.markup()||'')+
          '</section>'+
          '</div><div class="host-editor-column host-editor-column-preview">'+
          '<section class="host-editor-card host-health-panel">'+
            '<div class="node-form-section-title"><span class="host-section-icon" aria-hidden="true">'+ic('activity')+'</span><span>Статус / Проверка</span></div>'+
            '<div class="host-preview-status">'+
              '<p class="node-ip-hint" data-host-runtime role="status" aria-live="polite"></p>'+
              '<p class="host-validation" data-host-warnings role="status" hidden></p>'+
              '<button type="button" class="gh sm" data-host-repair hidden></button>'+
              '<button type="button" class="gh sm" data-host-link-profile hidden></button>'+
            '</div>'+
          '</section>'+
          '<section class="host-editor-card host-editor-side" aria-label="Предпросмотр клиентского подключения">'+
            '<div class="node-form-section-title"><span class="host-section-icon" aria-hidden="true">'+ic('globe')+'</span><span>Предпросмотр</span></div>'+
            '<div class="host-resolved" data-host-resolved></div>'+
            '<p class="node-ip-hint host-preview-disclaimer">Предпросмотр не подтверждает применение профиля, добавление UUID или доступность порта.</p>'+
          '</section>'+
          '</div></div>';
    }
    function bindHostEditor(form){
      if(!form||form.dataset.hostEditorBound)return;
      form.dataset.hostEditorBound='true';
      window.XMeshRemarkPicker?.bind(form,'[name="remark"]');
      window.XMeshSelects?.refresh(form);
      // Native form validation focuses the actual input. If an optional
      // disclosure contains that input, open it instead of switching pages.
      form.addEventListener('invalid',event=>{
        const details=event.target.closest('.host-extra-settings,.host-client-settings');
        if(details)details.open=true;
      },true);
      form.addEventListener('submit',()=>{
        for(const key of ['clientXhttpSettings','clientHeaders','clientTlsSettings','clientMasqueSettings']){
          const raw=form.elements.namedItem(key)?.value.trim();
          if(!raw)continue;
          try{
            const value=JSON.parse(raw);
            if(value&&typeof value==='object'&&!Array.isArray(value))continue;
          }catch(_){}
          const details=form.querySelector('.host-client-settings');
          if(details)details.open=true;
          form.elements.namedItem(key)?.focus();
          break;
        }
      },true);
    }

    return Object.freeze({hostEditorMarkup,hostNodeCountryCode,hostNodeCountryRemark,hostAutofillNodeFields,bindHostEditor});
  }
  return Object.freeze({create});
})();
