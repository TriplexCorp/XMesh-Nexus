/* XMesh Nexus — Client Routing / Card Workspace v2
 * Independent, reusable JSON-routing templates. The backend schema and
 * subscription generator are deliberately unchanged.
 */
(function (global) {
  'use strict';

  const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const clone = v => JSON.parse(JSON.stringify(v));
  const kinds = {geosite:'GeoSite',geoip:'GeoIP',domain:'Домен',ip:'IP / CIDR',port:'Порт'};
  const actions = {proxy:'Через выбранный сервер',direct:'Напрямую',block:'Блокировать',server:'Через другой сервер'};
  const flagPatterns = [
    [/нидерланд|голланд|netherland|(?:^|[\s_-])nl(?:$|[\s_-])/i,'nl'],
    [/польш|poland|(?:^|[\s_-])pl(?:$|[\s_-])/i,'pl'],
    [/герман|germany|deutsch|(?:^|[\s_-])de(?:$|[\s_-])/i,'de'],
    [/росси|russia|(?:^|[\s_-])ru(?:$|[\s_-])/i,'ru'],
    [/швеци|sweden|(?:^|[\s_-])(?:se|swe)(?:$|[\s_-])/i,'se'],
    [/эстони|estonia|(?:^|[\s_-])ee(?:$|[\s_-])/i,'ee'],
    [/финлян|finland|(?:^|[\s_-])fi(?:$|[\s_-])/i,'fi'],
    [/франци|france|(?:^|[\s_-])fr(?:$|[\s_-])/i,'fr'],
    [/сша|usa|united states|(?:^|[\s_-])us(?:$|[\s_-])/i,'us'],
    [/испан|spain|(?:^|[\s_-])es(?:$|[\s_-])/i,'es']
  ];
  function countryCode(...parts) {
    const name = parts.filter(Boolean).join(' ');
    const explicit = parts.find(p => typeof p === 'string' && /^(nl|pl|de|ru|se|swe|ee|fi|fr|us|es)$/i.test(p.trim()));
    if (explicit) return explicit.toLowerCase() === 'swe' ? 'se' : explicit.toLowerCase();
    return flagPatterns.find(([pattern]) => pattern.test(name))?.[1] || '';
  }
  function flag(code) {
    const start = '<svg class="crx-flag" width="29" height="22" viewBox="0 0 32 24" aria-hidden="true" focusable="false"><defs><clipPath id="crx-flag-clip"><rect x="1" y="1" width="30" height="22" rx="4"/></clipPath></defs><g clip-path="url(#crx-flag-clip)">';
    const end = '</g><rect x="1" y="1" width="30" height="22" rx="4" fill="none" stroke="currentColor" stroke-opacity=".14"/></svg>';
    const rect = (color,x,y,w,h) => '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+color+'"/>';
    const stripes = colors => colors.map((c,i) => rect(c,1,1+i*22/colors.length,30,22/colors.length+0.3)).join('');
    let shape = '';
    if (code === 'nl') shape = stripes(['#ae1c28','#fff','#21468b']);
    else if (code === 'pl') shape = stripes(['#fff','#dc143c']);
    else if (code === 'de') shape = stripes(['#111','#dd0000','#ffce00']);
    else if (code === 'ru') shape = stripes(['#fff','#0039a6','#d52b1e']);
    else if (code === 'ee') shape = stripes(['#4891d9','#111','#fff']);
    else if (code === 'fr') shape = ['#0055a4','#fff','#ef4135'].map((c,i)=>rect(c,1+10*i,1,10.2,22)).join('');
    else if (code === 'fi') shape = rect('#fff',1,1,30,22)+rect('#003580',10,1,5,22)+rect('#003580',1,10,30,5);
    else if (code === 'se') shape = rect('#006aa7',1,1,30,22)+rect('#fecc00',10,1,5,22)+rect('#fecc00',1,10,30,5);
    else if (code === 'es') shape = rect('#aa151b',1,1,30,22)+rect('#f1bf00',1,6,30,12);
    else if (code === 'us') shape = stripes(['#b22234','#fff','#b22234','#fff','#b22234','#fff','#b22234'])+rect('#3c3b6e',1,1,14,12);
    else return '<span class="crx-globe" aria-hidden="true">◎</span>';
    return start+shape+end;
  }
  function icon(name) {
    const paths = {
      route:'<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 5h5a5 5 0 0 1 0 10H9a4 4 0 0 0 0 8"/>',
      plus:'<path d="M12 5v14M5 12h14"/>',
      chevron:'<path d="m9 18 6-6-6-6"/>',
      close:'<path d="M18 6 6 18M6 6l12 12"/>',
      copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
      trash:'<path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6M10 10v7m4-7v7"/>',
      save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h9V3M7 21v-8h10v8"/>',
      settings:'<path d="M4 7h16M4 17h16M9 4v6M15 14v6"/>',
      search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      arrowup:'<path d="m6 14 6-6 6 6"/>',
      arrowdown:'<path d="m6 10 6 6 6-6"/>',
      code:'<path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-12-2 16"/>',
      check:'<path d="m5 12 4 4L19 6"/>',
      server:'<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
      shield:'<path d="m12 22 7-4V5l-7-3-7 3v13l7 4z"/><path d="m9 12 2 2 4-4"/>',
      globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>'
    };
    return '<svg class="crx-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.route)+'</svg>';
  }
  function optionList(values, selected) {
    return values.map(([value,label])=>'<option value="'+escapeHTML(value)+'"'+(value===selected?' selected':'')+'>'+escapeHTML(label)+'</option>').join('');
  }

  const CSS_VERSION = '20261024-routing-clean-v1';
  function ensureStylesheet() {
    const file = 'client-routing.css';
    const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .find(link => {
        try { return new URL(link.href, location.href).pathname.endsWith('/' + file); }
        catch (_) { return false; }
      });
    // /dashboard/<secret-path> is not the static asset root. A matching
    // filename/version at that location may be a 404 HTML response.
    if (existing) {
      const url = new URL(existing.href, location.href);
      if (url.origin === location.origin && url.pathname === '/' + file &&
          url.searchParams.get('v') === CSS_VERSION) return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/' + file + '?v=' + CSS_VERSION;
    link.dataset.clientRoutingStyles = CSS_VERSION;
    document.head.appendChild(link);
    if (existing) existing.remove();
  }
  // Fail-safe: SVGs must never occupy the viewport if the optional CSS asset fails.
  // One CSS owner: client-routing.css. No competing inline fallback rules.
  function ensureCriticalStyles() {}

  function create(db, saveSettings, toast) {
    const nodes = (db.nodes||[]).filter(n=>!n.disabled);
    const hosts = (db.hosts||[]).filter(h=>!h.disabled);
    const sources = [
      ...nodes.filter(n=>Number.isSafeInteger(Number(n.id))&&Number(n.id)>0).map(n=>({
        key:'node:'+n.id, title:n.name||'Узел #'+n.id, kind:'Вся нода',
        detail:'Правила для всех её серверов', code:countryCode(n.countryCode,n.country,n.name)
      })),
      ...hosts.filter(h=>Number.isSafeInteger(Number(h.id))&&Number(h.id)>0).map(h=>({
        key:'host:'+h.id, title:h.remark||h.name||h.address||'Хост #'+h.id, kind:'Публичный хост',
        detail:h.tag||'Без inbound', code:countryCode(h.countryCode,h.country,h.remark,h.name,h.address)
      }))
    ];
    const targets = [
      ...hosts.filter(h=>Number.isSafeInteger(Number(h.id))&&Number(h.id)>0).map(h=>({
        key:'host:'+h.id, label:(h.remark||h.name||h.address||'Хост #'+h.id)+' · '+(h.tag||'')
      })),
      ...nodes.flatMap(n=>{
        const p=(db.profiles||[]).find(p=>String(p.id)===String(n.profileId));
        let config;
        try { config=typeof p?.config==='string'?JSON.parse(p.config):p?.config; } catch (_) {}
        return (config?.inbounds||[]).filter(x=>x.tag&&
          !hosts.some(h=>h.tag===x.tag&&(!h.profileId||String(h.profileId)===String(p.id))))
          .map(x=>({key:'node:'+n.id+':'+x.tag,label:(n.name||'Узел #'+n.id)+' · '+x.tag}));
      })
    ];
    const sourceByKey=new Map(sources.map(s=>[s.key,s]));
    let draft=clone(Array.isArray(db.set?.clientRoutingProfiles)?db.set.clientRoutingProfiles:[]);
    let saved=JSON.stringify(draft);
    let activeId=null, activeTab='sources', search='', jsonValue='', jsonError='', saveBusy=false, confirmDelete='';
    const makeRule=()=>({match:'geosite',value:'',action:'proxy'});

    const rootMarkup='<section class="crx" id="client-route-root" aria-label="Клиентская маршрутизация">'+
      '<header class="crx-page-head"><div class="crx-page-copy"><span class="crx-eyebrow">'+icon('route')+' КЛИЕНТСКАЯ МАРШРУТИЗАЦИЯ</span>'+
      '<h2>Правила подключения</h2><p>Один шаблон — несколько серверов. Управляйте направлениями трафика в Xray JSON.</p></div>'+
      '<div class="crx-page-actions"><span class="crx-total" data-cr-counter></span><button type="button" class="crx-btn crx-btn-primary" data-cr-add>'+icon('plus')+' Новый шаблон</button></div></header>'+
      '<div class="crx-list" data-cr-list></div>'+
      '<div class="crx-bottom" data-cr-bottom><div><strong data-cr-status></strong><span>Изменения попадут в клиентскую подписку при следующем обновлении</span></div>'+
      '<div class="crx-bottom-actions"><button type="button" class="crx-btn crx-btn-ghost" data-cr-reset hidden>Отменить изменения</button>'+
      '<button type="button" class="crx-btn crx-btn-primary" data-cr-save disabled>'+icon('save')+' Сохранить изменения</button></div></div>'+
      '<div data-cr-modal-host></div></section>';

    function current(){return draft.find(p=>p.id===activeId);}
    function dirty(){return JSON.stringify(draft)!==saved;}
    function countInfo(){return draft.reduce((n,p)=>n+(p.servers||[]).length,0);}
    function status(){
      const el=document.getElementById('client-route-root');if(!el)return;
      el.querySelector('[data-cr-counter]').textContent=draft.length+' шаблон'+(draft.length===1?'':'ов');
      el.querySelector('[data-cr-status]').textContent=draft.length+' шаблонов · '+countInfo()+' назначений';
      el.querySelector('[data-cr-reset]').hidden=!dirty();
      el.querySelector('[data-cr-save]').disabled=saveBusy||!dirty();
      el.querySelector('[data-cr-save]').innerHTML=saveBusy?'Сохраняем…':icon('save')+' Сохранить изменения';
      el.querySelector('[data-cr-bottom]').classList.toggle('is-dirty',dirty());
    }
    function sourceSummary(p){
      const assigned=p.servers||[];
      const flags=assigned.slice(0,5).map(key=>{
        const item=sourceByKey.get(key);
        return '<span title="'+escapeHTML(item?.title||key)+'">'+flag(item?.code)+'</span>';
      }).join('');
      return flags+'<span class="crx-flags-count">'+assigned.length+' сервер'+(assigned.length===1?'':'ов')+'</span>';
    }
    function card(p) {
      const rulePreview=(p.rules||[]).slice(0,2).map(rule=>
        '<span class="crx-rule-chip"><b>'+escapeHTML(kinds[rule.match]||rule.match)+'</b> '+escapeHTML(rule.value||'—')+
        ' <em>→ '+escapeHTML(actions[rule.action]||rule.action)+'</em></span>').join('');
      return '<article class="crx-card'+(p.enabled===false?' is-disabled':'')+'" data-cr-profile="'+escapeHTML(p.id)+'">'+
        '<div class="crx-card-top"><div class="crx-card-symbol">'+icon('route')+'</div>'+
        '<span class="crx-state'+(p.enabled===false?' is-off':'')+'"><i></i>'+(p.enabled===false?'Выключен':'Активен')+'</span></div>'+
        '<div class="crx-card-title">'+escapeHTML(p.name||'Без названия')+'</div>'+
        '<div class="crx-card-desc">Маршрутизация Xray JSON</div>'+
        '<div class="crx-card-divider"></div>'+
        '<div class="crx-card-stats"><span>'+icon('server')+' '+(p.servers||[]).length+' назначений</span>'+
        '<span>'+icon('settings')+' '+(p.rules||[]).length+' правил</span></div>'+
        '<div class="crx-card-flags">'+sourceSummary(p)+'</div>'+
        '<div class="crx-card-rules">'+(rulePreview||'<span class="crx-card-no-rules">Дополнительных правил пока нет</span>')+'</div>'+
        '<div class="crx-card-footer"><button type="button" class="crx-btn crx-btn-outline" data-cr-open="'+escapeHTML(p.id)+'">'+
          'Настроить '+icon('chevron')+'</button>'+
        '<button type="button" class="crx-icon-btn" data-cr-duplicate="'+escapeHTML(p.id)+'" title="Копировать шаблон" aria-label="Копировать шаблон">'+icon('copy')+'</button></div>'+
      '</article>';
    }
    function editorSource(key,p){
      const s=sourceByKey.get(key)||{key,title:key,kind:'Недоступный сервер',detail:'Привязка сохранена',code:''};
      const checked=(p.servers||[]).includes(key);
      return '<label class="crx-source'+(checked?' is-selected':'')+'" data-cr-source-card="'+escapeHTML(key)+'">'+
        '<span class="crx-source-flag">'+flag(s.code)+'</span>'+
        '<span class="crx-source-info"><strong>'+escapeHTML(s.title)+'</strong><small>'+escapeHTML(s.kind)+' · '+escapeHTML(s.detail)+'</small></span>'+
        '<input type="checkbox" data-cr-source="'+escapeHTML(key)+'"'+(checked?' checked':'')+' aria-label="Назначить '+escapeHTML(s.title)+'">'+
      '</label>';
    }
    function editorRule(r,i){
      const selected=r.server||'';
      const options=[...targets,...(selected&&!targets.some(x=>x.key===selected)?[{key:selected,label:'Недоступный · '+selected}]:[])];
      return '<div class="crx-rule" data-cr-rule="'+i+'"><div class="crx-rule-n">'+String(i+1).padStart(2,'0')+'</div>'+
        '<div class="crx-rule-fields">'+
        '<label><span>Условие</span><select data-cr-field="match">'+optionList(Object.entries(kinds),r.match)+'</select></label>'+
        '<label class="crx-rule-value"><span>Значение</span><input type="text" data-cr-field="value" spellcheck="false" maxlength="200" value="'+escapeHTML(r.value||'')+'" placeholder="'+escapeHTML(({geosite:'category-ru',geoip:'ru',domain:'example.org',ip:'203.0.113.0/24',port:'443'})[r.match]||'')+'"></label>'+
        '<label><span>Действие</span><select data-cr-field="action">'+optionList(Object.entries(actions),r.action)+'</select></label>'+
        '<label class="crx-rule-target"'+(r.action==='server'?'':' hidden')+'><span>Целевой сервер</span><select data-cr-field="server">'+
          '<option value="">Выберите сервер</option>'+options.map(t=>'<option value="'+escapeHTML(t.key)+'"'+(t.key===selected?' selected':'')+'>'+escapeHTML(t.label)+'</option>').join('')+'</select></label>'+
        '<label class="crx-rule-network"><span>Сеть</span><select data-cr-field="network">'+optionList([['','TCP + UDP'],['tcp','TCP'],['udp','UDP']],r.network==='tcp,udp'?'':(r.network||''))+'</select></label>'+
        '</div><div class="crx-rule-actions">'+
        '<button type="button" class="crx-icon-btn" data-cr-up="'+i+'" title="Поднять правило" aria-label="Поднять правило"'+(i===0?' disabled':'')+'>'+icon('arrowup')+'</button>'+
        '<button type="button" class="crx-icon-btn" data-cr-down="'+i+'" title="Опустить правило" aria-label="Опустить правило">'+icon('arrowdown')+'</button>'+
        '<button type="button" class="crx-icon-btn is-danger" data-cr-rule-delete="'+i+'" title="Удалить правило" aria-label="Удалить правило">'+icon('trash')+'</button>'+
        '</div></div>';
    }
    function renderEditor(){
      const host=document.querySelector('#client-route-root [data-cr-modal-host]');if(!host)return;
      const p=current();
      if(!p){host.innerHTML='';return;}
      
      const missing=(p.servers||[]).filter(key=>!sourceByKey.has(key));
      const all=[...sources,...missing.map(key=>({key,title:key,kind:'Недоступный сервер',detail:'Сохранённая привязка',code:''}))];
      const matching=all.filter(s=>(s.title+' '+s.kind+' '+s.detail).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
      host.innerHTML='<div class="crx-overlay" data-cr-overlay><div class="crx-dialog" role="dialog" aria-modal="true" aria-labelledby="crx-dialog-title">'+
        '<header class="crx-dialog-header"><div class="crx-dialog-identity"><div class="crx-dialog-mark">'+icon('route')+'</div>'+
        '<div><span class="crx-dialog-kicker">РЕДАКТОР МАРШРУТИЗАЦИИ</span><h2 id="crx-dialog-title">'+escapeHTML(p.name||'Новый шаблон')+'</h2></div></div>'+
        '<button type="button" class="crx-icon-btn crx-close" data-cr-close title="Закрыть" aria-label="Закрыть">'+icon('close')+'</button></header>'+
        '<nav class="crx-tabs" aria-label="Разделы маршрутизации">'+
          [['sources','Назначения','server'],['rules','Правила','settings'],['json','JSON','code']].map(([id,label,symbol])=>
          '<button type="button" data-cr-tab="'+id+'" class="'+(activeTab===id?'is-current':'')+'" aria-current="'+(activeTab===id?'page':'false')+'" aria-pressed="'+(activeTab===id?'true':'false')+'">'+
          icon(symbol)+'<span class="crx-tab-label">'+label+'</span>'+(id==='sources'?'<span class="crx-tab-count">'+(p.servers||[]).length+'</span>':id==='rules'?'<span class="crx-tab-count">'+(p.rules||[]).length+'</span>':'')+'</button>').join('')+
        '</nav><main class="crx-dialog-body">'+
        (activeTab==='sources'?
          '<div class="crx-section-head"><div><h3>Назначить серверам</h3><p>Выберите ноды и публичные хосты. Привязки хостов имеют приоритет над нодами.</p></div>'+
          '<div class="crx-source-tools"><button type="button" class="crx-btn crx-btn-ghost" data-cr-select-all>Выбрать все</button>'+
          '<button type="button" class="crx-btn crx-btn-ghost" data-cr-select-none>Снять выбор</button></div></div>'+
          '<label class="crx-search">'+icon('search')+'<input type="search" data-cr-search placeholder="Поиск серверов и хостов…" value="'+escapeHTML(search)+'"></label>'+
          '<div class="crx-source-grid" data-cr-source-grid>'+matching.map(s=>editorSource(s.key,p)).join('')+'</div>'+
          (!matching.length?'<p class="crx-empty-inline">Серверы не найдены.</p>':'')
        :activeTab==='rules'?
          '<div class="crx-section-head"><div><h3>Правила маршрутизации</h3><p>Правила проверяются сверху вниз. Первое совпадение определяет выход.</p></div>'+
          '<button type="button" class="crx-btn crx-btn-primary" data-cr-rule-add>'+icon('plus')+' Добавить правило</button></div>'+
          '<div class="crx-rules">'+(p.rules||[]).map(editorRule).join('')+'</div>'+
          (!(p.rules||[]).length?'<div class="crx-empty-inline">Правил пока нет. Трафик использует настройки маршрутизации подписки.</div>':'')
        :'<div class="crx-section-head"><div><h3>JSON шаблона</h3><p>Это формат шаблона XMesh, не полный Xray config. Проверьте и примените перед сохранением.</p></div>'+
          '<div class="crx-source-tools"><button type="button" class="crx-btn crx-btn-ghost" data-cr-json-format>Форматировать</button>'+
          '<button type="button" class="crx-btn crx-btn-primary" data-cr-json-apply>'+icon('check')+' Применить JSON</button></div></div>'+
          '<textarea class="crx-json" data-cr-json-text spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="JSON шаблона">'+escapeHTML(jsonValue)+'</textarea>'+
          '<p class="crx-json-error" data-cr-json-error'+(jsonError?'':' hidden')+'>'+escapeHTML(jsonError)+'</p>')+
        '</main><footer class="crx-dialog-footer"><div class="crx-dialog-summary">'+
        '<span>'+(p.servers||[]).length+' назначений · '+(p.rules||[]).length+' правил</span><small>Настройки применяются к следующим JSON-подпискам</small></div>'+
        '<div class="crx-dialog-footer-actions"><button type="button" class="crx-btn crx-btn-ghost" data-cr-close>Закрыть</button>'+
        '<button type="button" class="crx-btn crx-btn-primary" data-cr-save'+(saveBusy?' disabled':'')+'>'+icon('save')+' Сохранить изменения</button></div></footer>'+
        '<div class="crx-settings"><div class="crx-settings-fields"><label>Название шаблона<input data-cr-name maxlength="100" value="'+escapeHTML(p.name||'')+'"></label>'+
        '<label class="crx-toggle"><input type="checkbox" data-cr-enabled'+(p.enabled!==false?' checked':'')+'><span>Шаблон включён</span></label></div>'+
        '<div class="crx-settings-actions"><button type="button" class="crx-btn crx-btn-ghost" data-cr-duplicate="'+escapeHTML(p.id)+'">'+icon('copy')+' Копировать</button>'+
        '<button type="button" class="crx-btn crx-btn-danger" data-cr-delete="'+escapeHTML(p.id)+'">'+icon('trash')+' '+(confirmDelete===p.id?'Подтвердить удаление':'Удалить')+'</button></div></div>'+
        '</div></div>';
    }
    function render(){
      const list=document.querySelector('#client-route-root [data-cr-list]');if(!list)return;
      list.innerHTML=draft.length?draft.map(card).join(''):
        '<div class="crx-empty"><span>'+icon('route')+'</span><h3>Пока нет маршрутизаций</h3>'+
        '<p>Создайте шаблон и назначьте его нужным нодам или хостам.</p>'+
        '<button type="button" class="crx-btn crx-btn-primary" data-cr-add>'+icon('plus')+' Создать шаблон</button></div>';
      renderEditor();status();
    }
    function notify(text){if(typeof toast==='function')toast(text);}
    function validate(data){
      if(!Array.isArray(data)||data.length>64)return 'Допускается не более 64 шаблонов.';
      const ids=new Set(), assigned=new Set();
      for(const p of data){
        if(!p||typeof p!=='object'||typeof p.id!=='string'||!(/^[a-zA-Z0-9_-]{3,64}$/).test(p.id)||ids.has(p.id))
          return 'Некорректный или повторяющийся ID шаблона.';
        ids.add(p.id);
        if(typeof p.name!=='string'||!p.name.trim()||p.name.length>100)return 'Укажите название шаблона (до 100 символов).';
        if(p.enabled!==undefined&&typeof p.enabled!=='boolean')return 'Некорректное состояние шаблона.';
        if(!Array.isArray(p.servers)||p.servers.length>256)return 'В шаблоне не более 256 назначений.';
        for(const key of p.servers){
          if(typeof key!=='string'||assigned.has(key))return 'Сервер назначен нескольким шаблонам: '+key;
          assigned.add(key);
        }
        if(!Array.isArray(p.rules)||p.rules.length>64)return 'В шаблоне не более 64 правил.';
        for(const r of p.rules){
          if(!r||!kinds[r.match]||typeof r.value!=='string'||!r.value.trim()||!actions[r.action])
            return 'Заполните тип, значение и действие каждого правила.';
          if(r.action==='server'&&(!r.server||typeof r.server!=='string'))return 'Выберите сервер назначения.';
          if(r.network&&!['tcp','udp','tcp,udp'].includes(r.network))return 'Недопустимое значение сети.';
        }
      }
      return '';
    }
    function pendingJSON(){
      if(!current()||activeTab!=='json')return false;
      try{return JSON.stringify(JSON.parse(jsonValue))!==JSON.stringify(current());}
      catch(_){return true;}
    }
    function checkPending(){
      if(pendingJSON()){notify('Сначала нажмите «Применить JSON», чтобы не потерять изменения.');return true;}
      return false;
    }
    function editorRefresh(keepScroll=true){
      const body=document.querySelector('#client-route-root .crx-dialog-body');
      const position=keepScroll&&body?body.scrollTop:0;
      render();
      const after=document.querySelector('#client-route-root .crx-dialog-body');
      if(after)after.scrollTop=position;
    }
    async function save(){
      if(checkPending())return;
      const error=validate(draft);if(error){notify(error);return;}
      if(!dirty()){notify('Изменений для сохранения нет.');return;}
      if(saveBusy)return;
      saveBusy=true;status();
      try{
        await saveSettings({clientRoutingProfiles:clone(draft)});
        saved=JSON.stringify(draft);
        notify('Клиентская маршрутизация сохранена');
      }catch(e){notify('Ошибка сохранения: '+(e?.message||'API'));}
      finally{saveBusy=false;render();}
    }
    function open(id){
      activeId=id;activeTab='sources';search='';jsonError='';confirmDelete='';
      jsonValue=JSON.stringify(current(),null,2);render();
      document.querySelector('#client-route-root .crx-close')?.focus();
    }
    function close(){
      if(checkPending())return;
      activeId=null;confirmDelete='';render();
    }
    function applyJSON(formatOnly){
      let parsed;
      try{parsed=JSON.parse(jsonValue);}
      catch(e){jsonError='Синтаксическая ошибка: '+e.message;editorRefresh();return;}
      if(!parsed||Array.isArray(parsed)||typeof parsed!=='object'){jsonError='Ожидается JSON-объект шаблона.';editorRefresh();return;}
      if(parsed.id!==activeId){jsonError='ID шаблона менять нельзя.';editorRefresh();return;}
      if(Object.keys(parsed).some(k=>!['id','name','enabled','servers','rules'].includes(k))){jsonError='JSON содержит неизвестные поля.';editorRefresh();return;}
      const proposed=draft.map(p=>p.id===activeId?parsed:p);
      const error=validate(proposed);
      if(error){jsonError=error;editorRefresh();return;}
      jsonValue=JSON.stringify(parsed,null,2);jsonError='';
      if(!formatOnly){draft=proposed;notify('JSON применён. Сохраните изменения.');}
      editorRefresh();
    }
    function modifySource(key,checked){
      const p=current();if(!p)return;
      const set=new Set(p.servers||[]);
      if(checked)set.add(key);else set.delete(key);
      p.servers=[...set];editorRefresh();
    }
    function duplicate(id){
      if(checkPending())return;
      const p=draft.find(p=>p.id===id);if(!p)return;
      const bytes=Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>n.toString(16).padStart(2,'0')).join('');
      const copy=clone(p);copy.id='route_'+bytes;copy.name=(copy.name+' · копия').slice(0,100);copy.servers=[];
      draft.push(copy);open(copy.id);
    }
    function wire(){
      ensureCriticalStyles();
      ensureStylesheet();
      const root=document.getElementById('client-route-root');if(!root)return;
      render();
      root.addEventListener('click',async event=>{
        const el=event.target.closest('button');if(!el||!root.contains(el))return;
        if(el.hasAttribute('data-cr-add')){
          if(checkPending())return;
          const id='route_'+Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>n.toString(16).padStart(2,'0')).join('');
          draft.push({id,name:'Новый шаблон',enabled:true,servers:[],rules:[]});open(id);return;
        }
        if(el.hasAttribute('data-cr-save')){await save();return;}
        if(el.hasAttribute('data-cr-reset')){
          if(checkPending())return;draft=JSON.parse(saved);activeId=null;render();return;
        }
        if(el.hasAttribute('data-cr-open')){if(checkPending())return;open(el.dataset.crOpen);return;}
        if(el.hasAttribute('data-cr-close')){close();return;}
        if(el.hasAttribute('data-cr-duplicate')){duplicate(el.dataset.crDuplicate);return;}
        if(el.hasAttribute('data-cr-delete')){
          const id=el.dataset.crDelete;
          if(confirmDelete!==id){confirmDelete=id;editorRefresh();return;}
          if(checkPending())return;
          draft=draft.filter(p=>p.id!==id);activeId=null;confirmDelete='';render();return;
        }
        if(el.hasAttribute('data-cr-tab')){
          if(checkPending())return;
          activeTab=el.dataset.crTab;
          if(activeTab==='json')jsonValue=JSON.stringify(current(),null,2);
          jsonError='';editorRefresh(false);return;
        }
        if(el.hasAttribute('data-cr-select-all')||el.hasAttribute('data-cr-select-none')){
          const p=current();if(!p)return;
          const available=sources.filter(s=>(s.title+' '+s.kind+' '+s.detail).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
          const next=new Set(p.servers||[]);for(const s of available){
            if(el.hasAttribute('data-cr-select-all'))next.add(s.key);else next.delete(s.key);
          }
          p.servers=[...next];editorRefresh();return;
        }
        if(el.hasAttribute('data-cr-rule-add')){
          const p=current();if(!p)return;
          p.rules.push(makeRule());editorRefresh();return;
        }
        if(el.hasAttribute('data-cr-up')||el.hasAttribute('data-cr-down')||el.hasAttribute('data-cr-rule-delete')){
          const p=current(),rules=p?.rules;if(!Array.isArray(rules))return;
          const idx=Number(el.dataset.crUp??el.dataset.crDown??el.dataset.crRuleDelete);
          if(el.hasAttribute('data-cr-rule-delete'))rules.splice(idx,1);
          else{
            const adjacent=idx+(el.hasAttribute('data-cr-up')?-1:1);
            if(adjacent>=0&&adjacent<rules.length)[rules[idx],rules[adjacent]]=[rules[adjacent],rules[idx]];
          }
          editorRefresh();return;
        }
        if(el.hasAttribute('data-cr-json-format')){applyJSON(true);return;}
        if(el.hasAttribute('data-cr-json-apply')){applyJSON(false);return;}
      });
      root.addEventListener('input',event=>{
        const t=event.target,p=current();
        if(t.hasAttribute('data-cr-search')){
          search=t.value;
          root.querySelectorAll('[data-cr-source-card]').forEach(card=>{
            const key=card.dataset.crSourceCard,s=sourceByKey.get(key);
            const text=(s?.title||key)+' '+(s?.detail||'')+' '+(s?.kind||'');
            card.hidden=!text.toLocaleLowerCase().includes(search.toLocaleLowerCase());
          });return;
        }
        if(t.hasAttribute('data-cr-json-text')){jsonValue=t.value;return;}
        if(!p)return;
        if(t.hasAttribute('data-cr-name')){
          p.name=t.value;root.querySelector('#crx-dialog-title').textContent=t.value||'Новый шаблон';status();return;
        }
        if(t.hasAttribute('data-cr-field')&&t.dataset.crField==='value'){
          const row=t.closest('[data-cr-rule]');
          const r=p.rules[Number(row.dataset.crRule)];if(r)r.value=t.value;
          status();
        }
      });
      root.addEventListener('change',event=>{
        const t=event.target,p=current();if(!p)return;
        if(t.hasAttribute('data-cr-enabled')){p.enabled=t.checked;status();return;}
        if(t.hasAttribute('data-cr-source')){modifySource(t.dataset.crSource,t.checked);return;}
        if(t.hasAttribute('data-cr-field')){
          const row=t.closest('[data-cr-rule]');if(!row)return;
          const r=p.rules[Number(row.dataset.crRule)];if(!r)return;
          const key=t.dataset.crField;
          if(key==='network'){if(t.value)r.network=t.value;else delete r.network;}
          else if(key==='action'){
            r.action=t.value;
            if(r.action!=='server')delete r.server;
          }else if(key==='server'){
            if(t.value)r.server=t.value;else delete r.server;
          }else r[key]=t.value;
          editorRefresh();
        }
      });
      root.addEventListener('keydown',event=>{
        if(event.key==='Escape'&&activeId){event.preventDefault();close();}
        if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){
          event.preventDefault();save();
        }
      });
    }
    return [rootMarkup,wire];
  }
  global.XMeshClientRouting={create};
})(window);
