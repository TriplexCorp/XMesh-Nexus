'use strict';
// Admin-only subscription delivery blueprint. Public serving is intentionally
// NOT part of XMesh Nexus; the subscription service lives in another repository.
window.XMeshSubscriptionStudio = (() => {
  const defaults = {
    subscriptionDomain:'', subscriptionPath:'/s',
    subscriptionBrand:'', subscriptionDescription:'Настройки подключения и информация о подписке.',
    subscriptionFooter:'', subscriptionAccent:'#e8bb78', subscriptionLanguage:'ru', subscriptionTheme:'dark',
    subscriptionShowTraffic:true, subscriptionShowExpiry:true,
    subscriptionPlacement:'a', nodePlacement:'a', deploymentServerB:'', deploymentServerC:'',
    subscriptionBackground:'#0c131b',subscriptionCardColor:'#15212b',subscriptionTextColor:'#ecf3f6',
    subscriptionLayout:'standard',subscriptionCardStyle:'soft',subscriptionFont:'system',subscriptionRadius:16,
    subscriptionHero:'',subscriptionCta:'',subscriptionLogoUrl:'',subscriptionSupportLabel:'Поддержка',
    subscriptionSupportUrl:'',subscriptionClientLayout:'grid',
    subscriptionShowStatus:true,subscriptionShowApps:true,subscriptionShowQr:true,
    subscriptionShowCopy:true,subscriptionShowSupport:false,subscriptionShowDevices:false
  };
  const clientCatalog = Object.freeze([
    ['happ','Happ','iOS · Android · Windows · macOS','Универсальные'],
    ['incy','Incy','iOS · Android','Универсальные'],
    ['v2raytun','v2rayTun','iOS · Android','Мобильные'],
    ['v2rayn','v2rayN','Windows · Linux · macOS','Компьютер'],
    ['v2rayng','v2rayNG','Android','Мобильные'],
    ['streisand','Streisand','iOS','Мобильные'],
    ['hiddify','Hiddify','iOS · Android · Windows · macOS · Linux','Универсальные'],
    ['nekobox','NekoBox','Android','Мобильные'],
    ['shadowrocket','Shadowrocket','iOS','Мобильные'],
    ['flclash','FlClash','Windows · macOS · Linux · Android','Универсальные'],
    ['stash','Stash','iOS','Мобильные'],
    ['singbox','sing-box','iOS · Android · Desktop','Универсальные'],
    ['v2box','V2Box','iOS · Android','Мобильные'],
    ['loon','Loon','iOS','Мобильные'],
    ['mihomo','Mihomo Party','Desktop','Компьютер'],
    ['clashverge','Clash Verge Rev','Windows · macOS · Linux','Компьютер']
  ]);
  const defaultClients = Object.freeze(Object.fromEntries(clientCatalog.map(([key],index)=>[key,index<7])));
  const validHttps = value => {
    if(!value)return true;
    if(value.length>512||/[\s\\]/.test(value)||!value.startsWith('https://'))return false;
    try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&
      u.hostname && !u.hash && !u.hostname.includes(':') && !u.hostname.endsWith('.') &&
      u.hostname.split('.').every(s=>/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/i.test(s));
    }catch(_){return false}
  };
  const themeColors = {
    dark:{subscriptionBackground:'#0c131b',subscriptionCardColor:'#15212b',subscriptionTextColor:'#ecf3f6'},
    light:{subscriptionBackground:'#f5f6f8',subscriptionCardColor:'#ffffff',subscriptionTextColor:'#19232d'}
  };
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hostnameOK = v => !v || (v.length <= 253 && /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)*$/i.test(v));
  const pathOK = v => v.length <= 64 && /^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(v) && !/^\/(?:api|login)(?:\/|$)/i.test(v);
  const field = (name,label,value,help,opts) => '<label class="f subscription-field"><span>'+label+'</span>'+
    (opts && opts.area ? '<textarea name="'+name+'" rows="2" maxlength="'+(opts.max||240)+'">'+esc(value)+'</textarea>' :
     '<input name="'+name+'" type="'+(opts && opts.color?'color':'text')+'" '+(opts&&opts.max?'maxlength="'+opts.max+'"':'')+
      ' value="'+esc(value)+'" placeholder="'+esc((opts&&opts.placeholder)||'')+'" autocomplete="off" spellcheck="false">')+
    (help?'<small>'+help+'</small>':'')+'</label>';
  const choice = (name,selected,choices) => '<label class="f subscription-field"><span>'+
    (name==='subscriptionLanguage'?'Язык портала по умолчанию':'Размещение')+'</span><select name="'+name+'">'+
    choices.map(x=>'<option value="'+x[0]+'"'+(selected===x[0]?' selected':'')+'>'+x[1]+'</option>').join('')+
    '</select></label>';
  const slot = [['a','Сервер A'],['b','Сервер B'],['c','Сервер C']];
  const locale = {
    ru:['Подписка активна','Трафик','Действует до','Настройка подключения','Скопировать ссылку'],
    en:['Subscription active','Traffic','Expires','Connection settings','Copy link'],
    tr:['Abonelik aktif','Trafik','Bitiş','Bağlantı ayarları','Bağlantıyı kopyala'],
    vi:['Gói đăng ký đang hoạt động','Lưu lượng','Ngày hết hạn','Cài đặt kết nối','Sao chép liên kết']
  };
  const input = (form,name) => form.elements.namedItem(name);
  function create(settings,save,notify,counts) {
    const data = {...defaults,...settings};
    const currentPalette=themeColors[data.subscriptionTheme]||themeColors.dark;
    for(const key of Object.keys(currentPalette))if(settings?.[key]===undefined)data[key]=currentPalette[key];
    data.subscriptionClients={...defaultClients,...(settings?.subscriptionClients||{})};
    data.subscriptionClientLinks={...(settings?.subscriptionClientLinks||{})};

    if(!slot.some(([id])=>id===data.subscriptionPlacement)) data.subscriptionPlacement='a';
    if(!slot.some(([id])=>id===data.nodePlacement)) data.nodePlacement='a';
    const markup = [
      '<div class="subscription-studio">',
      '<header class="subscription-studio-intro"><div><span class="subscription-studio-kicker">XMESH NEXUS / DELIVERY</span><h2>SUBSCRIPTION STUDIO</h2>',
      '<p>Управление дизайном, доменом и схемой размещения будущего сервиса подписок.</p></div>',
      '<button type="submit" form="subscription-studio-form" class="btn">'+
        '<span aria-hidden="true">✓</span> Сохранить настройки</button></header>',
      '<p class="subscription-studio-notice"><b>Конструктор управления</b> · Публичный сервис подписок и серверные ноды будут разработаны отдельно. Сохранение здесь не запускает сервер и не публикует ссылки.</p>',
      '<form id="subscription-studio-form" class="subscription-studio-layout">',
      '<div class="subscription-studio-main">',
      '<section class="card subscription-studio-section">',
      '<div class="subscription-studio-heading"><span>01</span><div><h3>Адрес выдачи</h3><p>Отдельно от домена панели и адресов VPN-узлов.</p></div></div>',
      '<div class="subscription-studio-pair">',
      field('subscriptionDomain','Домен подписки',data.subscriptionDomain,'HTTPS и DNS настраиваются на сервере выдачи.',{placeholder:'sub.example.com',max:253}),
      field('subscriptionPath','Публичный путь',data.subscriptionPath,'Например /s или /subscription.',{placeholder:'/s',max:64}),
      '</div>',
      '<div class="subscription-studio-url"><span>Будущий формат ссылки</span><code data-subscription-link>Укажите домен подписки</code></div>',
      '</section>',
      '<section class="card subscription-studio-section">',
      '<div class="subscription-studio-heading"><span>02</span><div><h3>Архитектура LEGO</h3><p>Три роли, три условных сервера. Можно разместить всё вместе или разнести.</p></div></div>',
      '<div class="subscription-roles">',
      '<div class="subscription-role"><span class="subscription-role-icon">▦</span><div><b>Панель управления</b><small>Control plane • XMesh Nexus</small></div><strong>Сервер A</strong></div>',
      '<div class="subscription-role"><span class="subscription-role-icon">↗</span><div><b>Сервис подписок</b><small>Отдельный будущий репозиторий</small></div>',
      choice('subscriptionPlacement',data.subscriptionPlacement,slot),'</div>',
      '<div class="subscription-role"><span class="subscription-role-icon">⌘</span><div><b>VPN-ноды</b><small>Пример топологии; реальные ноды задаются в «Узлах»</small></div>',
      choice('nodePlacement',data.nodePlacement,slot),'</div>',
      '</div>',
      '<div class="subscription-studio-pair">',
      field('deploymentServerB','Сервер B · адрес / заметка',data.deploymentServerB,'Необязательно, для планирования.',{placeholder:'server-b.example.com',max:253}),
      field('deploymentServerC','Сервер C · адрес / заметка',data.deploymentServerC,'Необязательно, для планирования.',{placeholder:'server-c.example.com',max:253}),
      '</div>',
      '<div class="subscription-topology" data-subscription-topology aria-live="polite"></div>',
      '<div class="subscription-studio-toolbar"><button type="button" class="gh sm" data-subscription-export>Экспорт схемы JSON</button><small>Схема — описание архитектуры, не автоустановка серверов.</small></div>',
      '</section>',
      '<section class="card subscription-studio-section">',
      '<div class="subscription-studio-heading"><span>03</span><div><h3>Клиентский портал</h3><p>Собственная тема, независимая от внешнего вида панели.</p></div></div>',
      field('subscriptionBrand','Название сервиса',data.subscriptionBrand,'Пустое значение — использовать бренд панели.',{placeholder:'Название вашего сервиса',max:80}),
      field('subscriptionDescription','Описание',data.subscriptionDescription,'Короткий текст на главной странице.',{area:true,max:240}),
      '<div class="subscription-studio-pair">',
      field('subscriptionAccent','Акцентный цвет',data.subscriptionAccent,'Цвет кнопок и индикаторов.',{color:true}),
      choice('subscriptionLanguage',data.subscriptionLanguage,[['ru','Русский'],['en','English'],['tr','Türkçe'],['vi','Tiếng Việt']]),
      '</div><div class="subscription-studio-pair">',
      '<label class="f subscription-field"><span>Тема клиентского портала</span><select name="subscriptionTheme"><option value="dark"'+(data.subscriptionTheme!=='light'?' selected':'')+'>Тёмная</option><option value="light"'+(data.subscriptionTheme==='light'?' selected':'')+'>Светлая</option></select></label>',
      '</div>',
      field('subscriptionFooter','Нижняя подпись',data.subscriptionFooter,'Например, адрес поддержки.',{placeholder:'Поддержка: @yourbot',max:160}),
      '<div class="subscription-display-options">',
      '<label><input type="checkbox" name="subscriptionShowTraffic"'+(data.subscriptionShowTraffic?' checked':'')+'> Показывать трафик</label>',
      '<label><input type="checkbox" name="subscriptionShowExpiry"'+(data.subscriptionShowExpiry?' checked':'')+'> Показывать срок доступа</label>',
      '</div></section>',
      '<section class="card subscription-studio-section">',
      '<div class="subscription-studio-heading"><span>04</span><div><h3>Дизайн и композиция</h3><p>Настройка каждой детали клиентской страницы без кода.</p></div></div>',
      '<div class="subscription-studio-pair">',
      '<label class="f subscription-field"><span>Компоновка</span><select name="subscriptionLayout"><option value="standard"'+(data.subscriptionLayout==='standard'?' selected':'')+'>Классическая</option><option value="centered"'+(data.subscriptionLayout==='centered'?' selected':'')+'>По центру</option><option value="compact"'+(data.subscriptionLayout==='compact'?' selected':'')+'>Компактная</option></select></label>',
      '<label class="f subscription-field"><span>Карточки</span><select name="subscriptionCardStyle"><option value="soft"'+(data.subscriptionCardStyle==='soft'?' selected':'')+'>Мягкие</option><option value="outline"'+(data.subscriptionCardStyle==='outline'?' selected':'')+'>С контуром</option><option value="flat"'+(data.subscriptionCardStyle==='flat'?' selected':'')+'>Без фона</option></select></label>',
      '</div><div class="subscription-studio-pair">',
      '<label class="f subscription-field"><span>Шрифт</span><select name="subscriptionFont"><option value="system"'+(data.subscriptionFont==='system'?' selected':'')+'>Системный</option><option value="manrope"'+(data.subscriptionFont==='manrope'?' selected':'')+'>Manrope</option><option value="mono"'+(data.subscriptionFont==='mono'?' selected':'')+'>Моноширинный</option></select></label>',
      '<label class="f subscription-field"><span>Скругление: <output data-subscription-radius>'+Number(data.subscriptionRadius)+'</output> px</span><input type="range" name="subscriptionRadius" min="0" max="32" step="2" value="'+Number(data.subscriptionRadius)+'"></label>',
      '</div>',
      '<div class="subscription-studio-pair subscription-color-grid">',
      field('subscriptionBackground','Фон портала',data.subscriptionBackground,'Основной цвет страницы.',{color:true}),
      field('subscriptionCardColor','Цвет карточек',data.subscriptionCardColor,'Фон информационных блоков.',{color:true}),
      field('subscriptionTextColor','Цвет текста',data.subscriptionTextColor,'Основной цвет надписей.',{color:true}),
      '</div>',
      '<div class="subscription-studio-heading subscription-studio-subheading"><span>✦</span><div><h3>Персонализация</h3><p>Свой логотип, заголовки и контакты.</p></div></div>',
      field('subscriptionLogoUrl','URL логотипа',data.subscriptionLogoUrl,'Только HTTPS. Оставьте пустым для стандартной пиктограммы.',{placeholder:'https://example.com/logo.png',max:512}),
      field('subscriptionHero','Свой заголовок статуса',data.subscriptionHero,'Пустое поле — стандартный текст выбранного языка.',{placeholder:'Ваша подписка активна',max:100}),
      field('subscriptionCta','Текст кнопки подключения',data.subscriptionCta,'Пустое поле — стандартный перевод.',{placeholder:'Подключить устройство',max:80}),
      '<div class="subscription-studio-pair">',
      field('subscriptionSupportLabel','Название поддержки',data.subscriptionSupportLabel,'Например, Связаться с нами.',{placeholder:'Поддержка',max:80}),
      field('subscriptionSupportUrl','Ссылка поддержки',data.subscriptionSupportUrl,'HTTPS-ссылка на сайт или чат.',{placeholder:'https://example.com/help',max:512}),
      '</div>',
      '<div class="subscription-studio-heading subscription-studio-subheading"><span>◈</span><div><h3>Блоки страницы</h3><p>Каждый элемент включается независимо.</p></div></div>',
      '<div class="subscription-display-options subscription-visibility">',
      '<label><input type="checkbox" name="subscriptionShowStatus"'+(data.subscriptionShowStatus?' checked':'')+'> Статус подписки</label>',
      '<label><input type="checkbox" name="subscriptionShowApps"'+(data.subscriptionShowApps?' checked':'')+'> Каталог приложений</label>',
      '<label><input type="checkbox" name="subscriptionShowQr"'+(data.subscriptionShowQr?' checked':'')+'> QR-код</label>',
      '<label><input type="checkbox" name="subscriptionShowCopy"'+(data.subscriptionShowCopy?' checked':'')+'> Копирование ссылки</label>',
      '<label><input type="checkbox" name="subscriptionShowDevices"'+(data.subscriptionShowDevices?' checked':'')+'> Устройства</label>',
      '<label><input type="checkbox" name="subscriptionShowSupport"'+(data.subscriptionShowSupport?' checked':'')+'> Кнопка поддержки</label>',
      '</div></section>',
      '<section class="card subscription-studio-section">',
      '<div class="subscription-studio-heading"><span>05</span><div><h3>Клиентские приложения</h3><p>Выбирайте, какие программы показать пользователю, и задавайте собственные ссылки на установку.</p></div></div>',
      '<div class="subscription-studio-toolbar"><span class="subscription-client-counter" data-subscription-client-count>—</span><div class="subscription-client-actions">',
      '<button type="button" class="gh sm" data-client-preset="all">Включить все</button>',
      '<button type="button" class="gh sm" data-client-preset="none">Отключить все</button>',
      '<button type="button" class="gh sm" data-client-preset="default">По умолчанию</button>',
      '</div></div>',
      '<label class="f subscription-field"><span>Вид списка приложений</span><select name="subscriptionClientLayout"><option value="grid"'+(data.subscriptionClientLayout!=='list'?' selected':'')+'>Плитки</option><option value="list"'+(data.subscriptionClientLayout==='list'?' selected':'')+'>Список</option></select></label>',
      '<div class="subscription-client-editor">'+clientCatalog.map(([key,label,platform,group])=>
        '<div class="subscription-client-row" data-client-row="'+key+'"><label class="subscription-client-toggle"><input type="checkbox" name="subClient_'+key+'"'+(data.subscriptionClients[key]?' checked':'')+'><span class="subscription-client-symbol">'+esc(label.slice(0,2))+'</span><span class="subscription-client-name"><b>'+esc(label)+'</b><small>'+esc(platform)+'</small></span></label>'+
        '<details class="subscription-client-details"><summary>Ссылка</summary><label class="f subscription-field"><span>HTTPS-адрес установки</span><input name="subClientLink_'+key+'" type="url" maxlength="512" value="'+esc(data.subscriptionClientLinks[key]||'')+'" placeholder="https://example.com/app" autocomplete="off" spellcheck="false"><small>Необязательно. Адрес не подставляется автоматически.</small></label></details></div>'
      ).join('')+'</div>',
      '<p class="subscription-preview-caption">Это настройки каталога для будущего отдельного Subscription Service. Включение приложения не гарантирует совместимость конкретного формата конфигурации — она будет определяться генератором подписок.</p>',
      '</section></div>',
      '<aside class="subscription-studio-side">',
      '<div class="subscription-preview-label"><b>Предпросмотр</b><span>Демо-контент</span></div>',
      '<div class="subscription-preview" data-subscription-preview>',
      '<div class="subscription-preview-brand"><span data-subscription-logo-symbol>✦</span><img data-subscription-logo alt="" hidden><b data-subscription-brand></b></div>',
      '<div class="subscription-preview-hero"><span class="subscription-preview-ok" data-subscription-ok>●</span><h3 data-subscription-active></h3><p data-subscription-description></p></div>',
      '<div class="subscription-preview-meta" data-subscription-metrics>',
      '<div data-subscription-traffic><small data-subscription-traffic-label></small><b>12,4 / 100 ГБ</b><div class="subscription-preview-progress"><i></i></div></div>',
      '<div data-subscription-expiry><small data-subscription-expiry-label></small><b>31.12.2026</b></div>',
      '</div>',
      '<div class="subscription-preview-cta" data-subscription-connect></div>',
      '<div class="subscription-preview-quick" data-subscription-quick><span data-subscription-copy>Копировать ссылку</span><span data-subscription-qr>QR</span><span data-subscription-devices>Устройства</span></div>',
      '<section class="subscription-preview-apps" data-subscription-apps><header>Приложения для подключения</header><div data-subscription-app-list></div></section>',
      '<div class="subscription-preview-support" data-subscription-support></div>',
      '<footer data-subscription-footer></footer></div>',
      '<div class="subscription-studio-stats"><div><small>Пользователей</small><b>'+esc(counts.users)+'</b></div><div><small>Узлов</small><b>'+esc(counts.nodes)+'</b></div></div>',
      '<p class="subscription-preview-caption">Макет без пользовательских данных. Реальные конфигурации, персональные токены и публичный портал появятся в отдельном сервисе.</p>',
      '</aside></form></div>'
    ].join('');
    const mount = () => {
      const form=document.getElementById('subscription-studio-form');
      if(!form)return;
      const $ = s=>form.querySelector(s);
      const read = () => ({
        subscriptionDomain:input(form,'subscriptionDomain').value.trim().toLowerCase(),
        subscriptionPath:input(form,'subscriptionPath').value.trim(),
        subscriptionBrand:input(form,'subscriptionBrand').value.trim(),
        subscriptionDescription:input(form,'subscriptionDescription').value.trim(),
        subscriptionFooter:input(form,'subscriptionFooter').value.trim(),
        subscriptionAccent:input(form,'subscriptionAccent').value,
        subscriptionLanguage:input(form,'subscriptionLanguage').value,
        subscriptionTheme:input(form,'subscriptionTheme').value,
        subscriptionShowTraffic:input(form,'subscriptionShowTraffic').checked,
        subscriptionShowExpiry:input(form,'subscriptionShowExpiry').checked,
        subscriptionPlacement:input(form,'subscriptionPlacement').value,
        nodePlacement:input(form,'nodePlacement').value,
        deploymentServerB:input(form,'deploymentServerB').value.trim(),
        deploymentServerC:input(form,'deploymentServerC').value.trim()
      });
      const draw = () => {
        const d=read(),copy=locale[d.subscriptionLanguage]||locale.ru;
        $('[data-subscription-link]').textContent=d.subscriptionDomain && pathOK(d.subscriptionPath)
          ? 'https://'+d.subscriptionDomain+d.subscriptionPath+'/<token>':'Укажите домен и путь';
        const preview=$('[data-subscription-preview]');
        preview.style.setProperty('--portal-accent',d.subscriptionAccent);
        preview.dataset.portalTheme=d.subscriptionTheme;
        $('[data-subscription-brand]').textContent=d.subscriptionBrand||settings.brand||'VPN';
        $('[data-subscription-active]').textContent=copy[0];
        $('[data-subscription-description]').textContent=d.subscriptionDescription;
        $('[data-subscription-traffic-label]').textContent=copy[1];
        $('[data-subscription-expiry-label]').textContent=copy[2];
        $('[data-subscription-connect]').textContent=copy[3];
        $('[data-subscription-footer]').textContent=d.subscriptionFooter;
        $('[data-subscription-traffic]').hidden=!d.subscriptionShowTraffic;
        $('[data-subscription-expiry]').hidden=!d.subscriptionShowExpiry;
        const labels={a:'Панель',b:'',c:''};
        labels[d.subscriptionPlacement]+=(labels[d.subscriptionPlacement]?' + ':'')+'Подписки';
        labels[d.nodePlacement]+=(labels[d.nodePlacement]?' + ':'')+'VPN-ноды';
        const names={a:settings.domain||'Локальная панель',b:d.deploymentServerB||'Сервер B',c:d.deploymentServerC||'Сервер C'};
        $('[data-subscription-topology]').innerHTML=slot.filter(([id])=>labels[id]).map(([id])=>
          '<div class="subscription-topology-item"><span>'+esc('SERVER '+id.toUpperCase())+'</span><b>'+esc(labels[id])+'</b><small>'+esc(names[id])+'</small></div>'
        ).join('');
      };
      form.addEventListener('input',draw);
      form.addEventListener('change',draw);
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        const draft=read();
        if(!hostnameOK(draft.subscriptionDomain)){notify('Некорректный домен подписки');return;}
        if(!pathOK(draft.subscriptionPath)){notify('Некорректный путь подписки');return;}
        for(const key of ['deploymentServerB','deploymentServerC'])
          if(draft[key] && (draft[key].length>253 || /[\u0000-\u001f\u007f]/.test(draft[key]))) {notify('Некорректное описание сервера');return;}
        const button=form.closest('.subscription-studio').querySelector('.subscription-studio-intro button');
        button.disabled=true;
        try {await save(draft);notify('Настройки SUBSCRIPTION STUDIO сохранены');}
        catch(err){notify('Не удалось сохранить: '+(err.message||'ошибка API'));}
        finally{button.disabled=false;}
      });
      $('[data-subscription-export]').addEventListener('click',()=>{
        const json=JSON.stringify({schema:'xmesh-subscription-blueprint/v1',panel:{domain:settings.domain||'',role:'control-plane'},
          placement:{panel:'a',subscription:read().subscriptionPlacement,nodes:read().nodePlacement,
            serverB:read().deploymentServerB,serverC:read().deploymentServerC},
          portal:{...read()}},null,2);
        const blob=new Blob([json],{type:'application/json'});
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');a.href=url;a.download='xmesh-subscription-blueprint.json';document.body.appendChild(a);a.click();a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
      });
      draw();
    };
    return [markup,mount];
  }
  return {create,defaults,hostnameOK,pathOK};
})();
