'use strict';
// Studio settings are used by the live subscription portal and URL issuer.
// Separate-server placement remains an architecture plan until a reverse proxy is configured.
window.XMeshSubscriptionStudio = (() => {
  const defaults = {
    subscriptionDomain:'', subscriptionPath:'/s',
    subscriptionBrand:'', subscriptionAnnouncement:'', subscriptionAnnouncementRotationHours:24, subscriptionUpdateInterval:24, subscriptionDescription:'Настройки подключения и информация о подписке.',
    subscriptionDescriptionEn:'', subscriptionFooter:'',subscriptionFooterEn:'', subscriptionAccent:'#e8bb78',subscriptionSecondaryAccent:'#c6e985', subscriptionSyncPanelTheme:true, subscriptionLanguage:'ru', subscriptionTheme:'dark',
    subscriptionShowTraffic:true, subscriptionShowExpiry:true,
    subscriptionPlacement:'a', nodePlacement:'a', deploymentServerB:'', deploymentServerC:'',
    subscriptionBackground:'#0c131b',subscriptionCardColor:'#15212b',subscriptionTextColor:'#ecf3f6',
    subscriptionLayout:'standard',subscriptionCardStyle:'soft',subscriptionFont:'system',subscriptionRadius:16,
    subscriptionHero:'',subscriptionHeroEn:'',subscriptionCta:'',subscriptionCtaEn:'',subscriptionLogoUrl:'',subscriptionSupportLabel:'Поддержка',subscriptionSupportLabelEn:'',
    subscriptionSupportUrl:'',subscriptionClientLayout:'grid',
    subscriptionJson:{dns:'cloudflare',queryStrategy:'UseIPv4',routingStrategy:'IPIfNonMatch',
      balance:'leastPing',smart:false,sniffing:true,dnsRouting:false,socksPort:10808,httpPort:10809},
    subscriptionAppsTitle:'',subscriptionAppsTitleEn:'',subscriptionCustomClients:[],
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
  // The live portal renders only enabled clients with validated HTTPS download links.
  const maxCustomClients=32;
  const appsHeading = lang => lang==='en'?'Connection apps':'Приложения для подключения';
  const nextCustomClientId = clients => {
    const used=new Set(clients.map(x=>x.id));
    let n=1;
    while(used.has('custom-'+n))n++;
    return 'custom-'+n;
  };
  const renderCustomClient = (client,open=false) => {
    const name=String(client.name||'');
    const platforms=String(client.platforms||'');
    const url=String(client.url||'');
    return '<div class="subscription-client-row subscription-client-custom" data-custom-client-row data-custom-client-id="'+esc(client.id)+'">'+
      '<div class="subscription-custom-header"><label class="subscription-client-toggle" title="Показывать приложение">'+
      '<input type="checkbox" data-custom-field="enabled" aria-label="Показывать приложение"'+(client.enabled?' checked':'')+'>'+
      '<span class="subscription-client-symbol" data-custom-client-symbol>'+esc((name||'APP').slice(0,2))+'</span></label>'+
      '<label class="f subscription-field subscription-custom-name"><span>Название приложения</span>'+
      '<input type="text" data-custom-field="name" maxlength="80" required value="'+esc(name)+'" placeholder="Мой клиент" autocomplete="off" spellcheck="false"></label>'+
      '<button type="button" class="gh sm subscription-custom-remove" data-custom-client-remove aria-label="Удалить приложение">Удалить</button></div>'+
      '<details class="subscription-client-details"'+(open?' open':'')+'><summary>Платформы и ссылка</summary>'+
      '<div class="subscription-custom-details">'+
      '<label class="f subscription-field"><span>Платформы</span><input data-custom-field="platforms" type="text" maxlength="120" value="'+esc(platforms)+'" placeholder="iOS · Android · Windows" autocomplete="off" spellcheck="false"></label>'+
      '<label class="f subscription-field"><span>HTTPS-адрес установки</span><input data-custom-field="url" type="url" maxlength="512" value="'+esc(url)+'" placeholder="https://example.com/app" autocomplete="off" spellcheck="false"><small>Необязательно. Ссылка показывается на реальной странице подписки.</small></label>'+
      '</div></details></div>';
  };
  const validHttps = value => {
    if(!value)return true;
    if(value.length>512||/[^\x21-\x7e]/.test(value)||value.includes('\\')||
       value.includes('#')||!value.startsWith('https://'))return false;
    const authority=value.slice(8).split(/[/?]/,1)[0];
    if(!authority||/[:@]/.test(authority))return false;
    return authority.split('.').every(s=>s.length<=63&&/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/i.test(s));
  };
  const themeColors = {
    dark:{subscriptionBackground:'#0c131b',subscriptionCardColor:'#15212b',subscriptionTextColor:'#ecf3f6'},
    light:{subscriptionBackground:'#f5f6f8',subscriptionCardColor:'#ffffff',subscriptionTextColor:'#19232d'}
  };
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hostnameOK = v => !v || (v.length <= 253 && /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)*$/i.test(v));
  const pathOK = v => v.length <= 64 && v.split('/').length <= 9 && /^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(v) && !/^\/(?:api|login|dashboard)(?:\/|$)/i.test(v);
  const field = (name,label,value,help,opts) => '<label class="f subscription-field"><span>'+label+'</span>'+
    (opts && opts.area ? '<textarea name="'+name+'" rows="2" maxlength="'+(opts.max||240)+'">'+esc(value)+'</textarea>' :
     '<input name="'+name+'" type="'+(opts && opts.color?'color':opts && opts.type==='number'?'number':'text')+'" '+(opts&&opts.max?'maxlength="'+opts.max+'"':'')+
      ' value="'+esc(value)+'" placeholder="'+esc((opts&&opts.placeholder)||'')+'" autocomplete="off" spellcheck="false">')+
    (help?'<small>'+help+'</small>':'')+'</label>';
  const choice = (name,selected,choices) => '<label class="f subscription-field"><span>'+
    (name==='subscriptionLanguage'?'Язык портала по умолчанию':'Размещение')+'</span><select name="'+name+'">'+
    choices.map(x=>'<option value="'+x[0]+'"'+(selected===x[0]?' selected':'')+'>'+x[1]+'</option>').join('')+
    '</select></label>';
  const slot = [['a','Сервер A'],['b','Сервер B'],['c','Сервер C']];
  const locale = {
    ru:['Подписка активна','Трафик','Действует до','Настройка подключения','Скопировать ссылку'],
    en:['Subscription active','Traffic','Expires','Connection settings','Copy link']

  };
  const input = (form,name) => form.elements.namedItem(name);
  function create(settings,save,notify,counts,getPanelTheme) {
    const data = {...defaults,...settings};
    data.subscriptionJson={...defaults.subscriptionJson,...(settings?.subscriptionJson||{})};
    if(!['ru','en'].includes(data.subscriptionLanguage))data.subscriptionLanguage='ru';
    const panelTheme=()=>typeof getPanelTheme==='function'?getPanelTheme():null;
    if(data.subscriptionSyncPanelTheme!==false&&panelTheme())Object.assign(data,panelTheme());
    const currentPalette=themeColors[data.subscriptionTheme]||themeColors.dark;
    for(const key of Object.keys(currentPalette))if(settings?.[key]===undefined&&data.subscriptionSyncPanelTheme===false)data[key]=currentPalette[key];
    data.subscriptionRadius=Math.max(1,Math.min(36,Math.round(Number(data.subscriptionRadius)||16)));
    data.subscriptionClients={...defaultClients,...(settings?.subscriptionClients||{})};
    data.subscriptionClientLinks={...(settings?.subscriptionClientLinks||{})};
    data.subscriptionCustomClients=Array.isArray(settings?.subscriptionCustomClients)?settings.subscriptionCustomClients.slice(0,maxCustomClients):[];

    if(!slot.some(([id])=>id===data.subscriptionPlacement)) data.subscriptionPlacement='a';
    if(!slot.some(([id])=>id===data.nodePlacement)) data.nodePlacement='a';
    const markup = [
      '<div class="subscription-studio">',
      '<header class="subscription-studio-intro"><div><span class="subscription-studio-kicker">XMESH NEXUS / DELIVERY</span><h2>SUBSCRIPTION STUDIO</h2>',
      '<p>Оформление действующей страницы подписки, её публичный URL и каталог приложений.</p></div>',
      '<button type="submit" form="subscription-studio-form" class="btn">'+
        '<span aria-hidden="true">✓</span> Сохранить настройки</button></header>',
      '<form id="subscription-studio-form" class="subscription-studio-layout">',
      '<div class="subscription-studio-main">',
      '<section class="card subscription-studio-section">',
      '<div class="subscription-studio-heading"><span>01</span><div><h3>Адрес выдачи</h3><p>Отдельно от домена панели и адресов VPN-узлов.</p></div></div>',
      '<div class="subscription-studio-pair">',
      field('subscriptionDomain','Домен подписки',data.subscriptionDomain,'Публичный адрес подписок.',{placeholder:'sub.example.com',max:253}),
      field('subscriptionPath','Публичный путь',data.subscriptionPath,'Например /s или /subscription.',{placeholder:'/s',max:64}),
      '</div>',
      '<div class="subscription-studio-url"><span>Формат персональной ссылки</span><code data-subscription-link>Укажите домен подписки</code></div>',
      '</section>',
      '<section class="card subscription-studio-section">',
      '<div class="subscription-studio-heading"><span>02</span><div><h3>Архитектура LEGO</h3><p>Три роли, три условных сервера. Можно разместить всё вместе или разнести.</p></div></div>',
      '<div class="subscription-roles">',
      '<div class="subscription-role"><span class="subscription-role-icon">▦</span><div><b>Панель управления</b><small>Control plane • XMesh Nexus</small></div><strong>Сервер A</strong></div>',
      '<div class="subscription-role"><span class="subscription-role-icon">↗</span><div><b>Сервис подписок</b><small>Публичная выдача через XMesh Nexus</small></div>',
      choice('subscriptionPlacement',data.subscriptionPlacement,slot),'</div>',
      '<div class="subscription-role"><span class="subscription-role-icon">⌘</span><div><b>VPN-ноды</b><small>Пример топологии; реальные ноды задаются в «Узлах»</small></div>',
      choice('nodePlacement',data.nodePlacement,slot),'</div>',
      '</div>',
      '<div class="subscription-studio-pair">',
      field('deploymentServerB','Сервер B · адрес / заметка',data.deploymentServerB,'Необязательно, для планирования.',{placeholder:'server-b.example.com',max:253}),
      field('deploymentServerC','Сервер C · адрес / заметка',data.deploymentServerC,'Необязательно, для планирования.',{placeholder:'server-c.example.com',max:253}),
      '</div>',
      '<div class="subscription-topology" data-subscription-topology aria-live="polite"></div>',
      '<div class="subscription-studio-toolbar"><button type="button" class="gh sm" data-subscription-export>Экспорт схемы JSON</button><small>Сохранить схему размещения в формате JSON.</small></div>',
      '</section>',
      '<section class="card subscription-studio-section">',
      '<div class="subscription-studio-heading"><span>03</span><div><h3>Клиентский портал</h3><p>Синхронизация с темой панели или отдельная палитра.</p></div></div>',
      field('subscriptionBrand','Название подписки',data.subscriptionBrand,'Пустое значение — использовать бренд панели.',{placeholder:'Название вашего сервиса',max:80}),
      field('subscriptionAnnouncement','Анонсы для VPN-клиентов',data.subscriptionAnnouncement,'Разделяйте объявления отдельной строкой --- . Сообщения чередуются с заданной ниже периодичностью.',{area:true,max:4000}),
      field('subscriptionAnnouncementRotationHours','Ротация анонсов (ч)',data.subscriptionAnnouncementRotationHours,'От 1 до 720 часов. По умолчанию 24 часа. Период отсчитывается по UTC.',{type:'number',min:1,max:720}),
      field('subscriptionUpdateInterval','Интервал обновления подписки (ч)',data.subscriptionUpdateInterval,'Подсказка для поддерживающих клиентов: от 1 до 168 часов.',{type:'number',min:1,max:168}),
      field('subscriptionDescription','Описание (RU)',data.subscriptionDescription,'Текст на русском.',{area:true,max:240}),
      field('subscriptionDescriptionEn','Описание (EN)',data.subscriptionDescriptionEn,'Английский текст; пустое поле — стандартное описание на английском.',{area:true,max:240}),
      '<label class="subscription-theme-sync"><input type="checkbox" name="subscriptionSyncPanelTheme"'+(data.subscriptionSyncPanelTheme!==false?' checked':'')+'> <span><b>Синхронизировать с темой панели</b><small>Акцент, светлый/тёмный режим, фон, карточки и цвет текста. Выключите для своего оформления.</small></span></label>',
      '<div class="subscription-studio-pair">',
      field('subscriptionAccent','Акцентный цвет',data.subscriptionAccent,'Цвет кнопок и индикаторов.',{color:true}),
      field('subscriptionSecondaryAccent','Дополнительный цвет',data.subscriptionSecondaryAccent,'Второй цвет палитры панели.',{color:true}),
      choice('subscriptionLanguage',data.subscriptionLanguage,[['ru','Русский'],['en','English']]),
      '</div><div class="subscription-studio-pair">',
      '<label class="f subscription-field"><span>Тема клиентского портала</span><select name="subscriptionTheme"><option value="dark"'+(data.subscriptionTheme!=='light'?' selected':'')+'>Тёмная</option><option value="light"'+(data.subscriptionTheme==='light'?' selected':'')+'>Светлая</option></select></label>',
      '</div>',
      field('subscriptionFooter','Нижняя подпись (RU)',data.subscriptionFooter,'Например, адрес поддержки.',{placeholder:'Поддержка: @yourbot',max:160}),
      field('subscriptionFooterEn','Нижняя подпись (EN)',data.subscriptionFooterEn,'Отдельная подпись для английского языка.',{max:160}),
      '<div class="subscription-display-options">',
      '<label><input type="checkbox" name="subscriptionShowTraffic"'+(data.subscriptionShowTraffic?' checked':'')+'> Показывать трафик</label>',
      '<label><input type="checkbox" name="subscriptionShowExpiry"'+(data.subscriptionShowExpiry?' checked':'')+'> Показывать срок доступа</label>',
      '</div></section>',
      '<section class="card subscription-studio-section">',
      '<div class="subscription-studio-heading"><span>04</span><div><h3>Дизайн и композиция</h3><p>Настройка каждой детали клиентской страницы без кода.</p></div></div>',
      '<div class="subscription-studio-pair">',
      '<label class="f subscription-field"><span>Компоновка</span><select name="subscriptionLayout"><option value="standard"'+(data.subscriptionLayout==='standard'?' selected':'')+'>Классическая</option><option value="centered"'+(data.subscriptionLayout==='centered'?' selected':'')+'>По центру</option><option value="compact"'+(data.subscriptionLayout==='compact'?' selected':'')+'>Компактная</option></select></label>',
      '<label class="f subscription-field"><span>Карточки</span><select name="subscriptionCardStyle"><option value="soft"'+(data.subscriptionCardStyle==='soft'?' selected':'')+'>Мягкие</option><option value="outline"'+(data.subscriptionCardStyle==='outline'?' selected':'')+'>С контуром</option><option value="flat"'+(data.subscriptionCardStyle==='flat'?' selected':'')+'>Без фона</option><option value="glass"'+(data.subscriptionCardStyle==='glass'?' selected':'')+'>Стекло</option><option value="raised"'+(data.subscriptionCardStyle==='raised'?' selected':'')+'>Объёмные</option></select></label>',
      '</div><div class="subscription-studio-pair">',
      '<label class="f subscription-field"><span>Шрифт</span><select name="subscriptionFont"><option value="onest"'+(data.subscriptionFont==='onest'?' selected':'')+'>Onest</option><option value="inter"'+(data.subscriptionFont==='inter'?' selected':'')+'>Inter</option><option value="golos"'+(data.subscriptionFont==='golos'?' selected':'')+'>Golos Text</option><option value="rubik"'+(data.subscriptionFont==='rubik'?' selected':'')+'>Rubik</option><option value="nunito"'+(data.subscriptionFont==='nunito'?' selected':'')+'>Nunito Sans</option><option value="plex"'+(data.subscriptionFont==='plex'?' selected':'')+'>IBM Plex Sans</option><option value="roboto"'+(data.subscriptionFont==='roboto'?' selected':'')+'>Roboto</option><option value="pt"'+(data.subscriptionFont==='pt'?' selected':'')+'>PT Sans</option><option value="montserrat"'+(data.subscriptionFont==='montserrat'?' selected':'')+'>Montserrat</option><option value="ubuntu"'+(data.subscriptionFont==='ubuntu'?' selected':'')+'>Ubuntu</option><option value="opensans"'+(data.subscriptionFont==='opensans'?' selected':'')+'>Open Sans</option><option value="source"'+(data.subscriptionFont==='source'?' selected':'')+'>Source Sans 3</option><option value="fira"'+(data.subscriptionFont==='fira'?' selected':'')+'>Fira Sans</option><option value="jost"'+(data.subscriptionFont==='jost'?' selected':'')+'>Jost</option><option value="manrope"'+(data.subscriptionFont==='manrope'?' selected':'')+'>Manrope</option><option value="system"'+(data.subscriptionFont==='system'?' selected':'')+'>Системный</option><option value="mono"'+(data.subscriptionFont==='mono'?' selected':'')+'>Моноширинный</option></select></label>',
      '<label class="f subscription-field"><span>Скругление: <output data-subscription-radius>'+Number(data.subscriptionRadius)+'</output> px</span><input type="range" name="subscriptionRadius" min="1" max="36" step="1" value="'+Number(data.subscriptionRadius)+'"></label>',
      '</div>',
      '<div class="subscription-studio-pair subscription-color-grid">',
      field('subscriptionBackground','Фон портала',data.subscriptionBackground,'Основной цвет страницы.',{color:true}),
      field('subscriptionCardColor','Цвет карточек',data.subscriptionCardColor,'Фон информационных блоков.',{color:true}),
      field('subscriptionTextColor','Цвет текста',data.subscriptionTextColor,'Основной цвет надписей.',{color:true}),
      '</div>',
      '<div class="subscription-studio-heading subscription-studio-subheading"><span>✦</span><div><h3>Персонализация</h3><p>Свой логотип, заголовки и контакты.</p></div></div>',
      field('subscriptionLogoUrl','URL логотипа',data.subscriptionLogoUrl,'Только HTTPS. Оставьте пустым для стандартной пиктограммы.',{placeholder:'https://example.com/logo.png',max:512}),
      field('subscriptionHero','Заголовок статуса (RU)',data.subscriptionHero,'Оставьте пустым для стандартного текста.',{placeholder:'Ваша подписка активна',max:100}),
      field('subscriptionHeroEn','Заголовок статуса (EN)',data.subscriptionHeroEn,'Английский вариант. Оставьте пустым для стандартного текста.',{max:100}),
      field('subscriptionCta','Текст подключения (RU)',data.subscriptionCta,'Пустое поле — стандартный перевод.',{placeholder:'Подключить устройство',max:80}),
      field('subscriptionCtaEn','Кнопка подключения (EN)',data.subscriptionCtaEn,'Английский текст подключения.',{max:80}),
      '<div class="subscription-studio-pair">',
      field('subscriptionSupportLabel','Название поддержки (RU)',data.subscriptionSupportLabel,'Например, Связаться с нами.',{placeholder:'Поддержка',max:80}),
      field('subscriptionSupportLabelEn','Название поддержки (EN)',data.subscriptionSupportLabelEn,'Английское название поддержки.',{max:80}),
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
      '<div class="subscription-studio-heading"><span>05</span><div><h3>XRAY JSON ENGINE</h3><p>Клиентский JSON, DNS и локальные подключения. Балансировка настраивается отдельно.</p></div></div>',
      '<div class="subscription-studio-pair">',
      '<label class="f subscription-field"><span>DNS</span><select name="json_dns">'+
        [['cloudflare','Cloudflare · 1.1.1.1 (надёжный режим)'],['cloudflare_doh','Cloudflare · DoH по IP (расширенный)'],['yandex','Yandex · DoH'],['system','Системный DNS']].map(([key,title])=>'<option value="'+key+'"'+(data.subscriptionJson.dns===key?' selected':'')+'>'+title+'</option>').join('')+'</select></label>',
      '<label class="f subscription-field"><span>DNS Query Strategy</span><select name="json_queryStrategy">'+
        [['UseIPv4','IPv4'],['UseIPv6','IPv6'],['UseIP','IPv4 + IPv6']].map(([key,title])=>'<option value="'+key+'"'+(data.subscriptionJson.queryStrategy===key?' selected':'')+'>'+title+'</option>').join('')+'</select></label>',
      '</div><div class="subscription-studio-pair">',
      '<label class="f subscription-field"><span>Маршрутизация доменов</span><select name="json_routingStrategy">'+
        [['IPIfNonMatch','IPIfNonMatch'],['AsIs','AsIs'],['IPOnDemand','IPOnDemand']].map(([key,title])=>'<option value="'+key+'"'+(data.subscriptionJson.routingStrategy===key?' selected':'')+'>'+title+'</option>').join('')+'</select></label>',
      '</div><div class="subscription-studio-pair">',
      '<label class="f subscription-field"><span>SOCKS-порт</span><input type="number" name="json_socksPort" min="1024" max="65535" step="1" value="'+data.subscriptionJson.socksPort+'"></label>',
      '<label class="f subscription-field"><span>HTTP-порт</span><input type="number" name="json_httpPort" min="1024" max="65535" step="1" value="'+data.subscriptionJson.httpPort+'"></label>',
      '</div>',
      '<div class="subscription-display-options subscription-visibility">',
      '<label><input type="checkbox" name="json_sniffing"'+(data.subscriptionJson.sniffing?' checked':'')+'> Sniffing</label>',
      '<label><input type="checkbox" name="json_dnsRouting"'+(data.subscriptionJson.dnsRouting?' checked':'')+'> Перехватывать DNS-запросы (расширенный режим)</label>',
      '</div><p class="note">По умолчанию DNS — 1.1.1.1 без дополнительного DNS outbound. '+
      'Обычный интернет-трафик по-прежнему направляется через VLESS, а не напрямую. '+
      'Перехват DNS:53 в отдельный DNS outbound включайте только если он действительно необходим. '+
      'Незащищённые подключения не публикуются. Серверы с одинаковым IP сохраняются.</p>',
      '</section>',
      '<section class="card subscription-studio-section">',
      '<div class="subscription-studio-heading"><span>06</span><div><h3>Клиентские приложения</h3><p>Выбирайте, какие программы показать пользователю, и задавайте собственные ссылки на установку.</p></div></div>',
      field('subscriptionAppsTitle','Заголовок приложений (RU)',data.subscriptionAppsTitle,'Пустое значение — перевод по умолчанию.',{placeholder:'Приложения для подключения',max:80}),
      field('subscriptionAppsTitleEn','Заголовок приложений (EN)',data.subscriptionAppsTitleEn,'Английский заголовок раздела.',{max:80}),
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
      '<div class="subscription-custom-toolbar"><div><b>Свои приложения</b><small>Собственные названия, платформы и адреса установки</small></div><button type="button" class="gh sm" data-custom-client-add>+ Добавить приложение</button></div>',
      '<div class="subscription-client-editor" data-custom-client-editor>'+data.subscriptionCustomClients.map(client=>renderCustomClient(client)).join('')+'</div>',
      '<p class="subscription-preview-caption">Указанные приложения и ссылки отображаются на странице подписки.</p>',
      '</section></div>',
      '<aside class="subscription-studio-side">',
      '<div class="subscription-preview-label"><b>Предпросмотр</b></div>',
      '<div class="subscription-preview" data-subscription-preview>',
      '<div class="subscription-preview-brand"><span data-subscription-logo-symbol>✦</span><img data-subscription-logo alt="" hidden><b data-subscription-brand></b><div class="subscription-preview-languages" role="group" aria-label="Language / Язык"><button type="button" data-portal-language="ru" aria-pressed="true" lang="ru">RU</button><button type="button" data-portal-language="en" aria-pressed="false" lang="en">EN</button></div></div>',
      '<div class="subscription-preview-hero"><span class="subscription-preview-ok" data-subscription-ok>●</span><h3 data-subscription-active></h3><p data-subscription-description></p></div>',
      '<div class="subscription-preview-meta" data-subscription-metrics>',
      '<div data-subscription-traffic><small data-subscription-traffic-label></small><b>12.4 / 100 ГБ</b><div class="subscription-preview-progress"><i></i></div></div>',
      '<div data-subscription-expiry><small data-subscription-expiry-label></small><b>31.12.2026</b></div>',
      '</div>',
      '<div class="subscription-preview-cta" data-subscription-connect></div>',
      '<div class="subscription-preview-quick" data-subscription-quick><span data-subscription-copy>Копировать ссылку</span><span data-subscription-qr>QR</span><span data-subscription-devices>Устройства</span></div>',
      '<section class="subscription-preview-apps" data-subscription-apps><header data-subscription-apps-title>Приложения для подключения</header><div data-subscription-app-list></div></section>',
      '<div class="subscription-preview-support" data-subscription-support></div>',
      '<footer data-subscription-footer></footer></div>',
      '<div class="subscription-studio-stats"><div><small>Пользователей</small><b>'+esc(counts.users)+'</b></div><div><small>Узлов</small><b>'+esc(counts.nodes)+'</b></div></div>',
      '</aside></form></div>'
    ].join('');
    const mount = () => {
      const form=document.getElementById('subscription-studio-form');
      if(!form)return;
      const $ = s=>form.querySelector(s);
      const customRows=()=>[...form.querySelectorAll('[data-custom-client-row]')];
      const readCustomClients=()=>customRows().map(row=>({
        id:row.dataset.customClientId,
        name:row.querySelector('[data-custom-field="name"]').value.trim(),
        platforms:row.querySelector('[data-custom-field="platforms"]').value.trim(),
        url:row.querySelector('[data-custom-field="url"]').value.trim(),
        enabled:row.querySelector('[data-custom-field="enabled"]').checked
      }));
      const applyPanelTheme=()=>{
        const linked=input(form,'subscriptionSyncPanelTheme').checked;
        if(linked){
          const theme=panelTheme();
          if(theme)for(const [key,value] of Object.entries(theme)){
            const field=input(form,key);
            if(field)field.value=value;
          }
        }
        for(const key of ['subscriptionAccent','subscriptionSecondaryAccent','subscriptionTheme','subscriptionBackground','subscriptionCardColor','subscriptionTextColor','subscriptionFont','subscriptionRadius','subscriptionCardStyle']){
          const field=input(form,key);
          if(field)field.disabled=linked;
        }
      };
      const read = () => ({
        subscriptionJson:{
          dns:input(form,'json_dns').value,queryStrategy:input(form,'json_queryStrategy').value,
          routingStrategy:input(form,'json_routingStrategy').value,
          balance:data.subscriptionJson.balance,
          smart:data.subscriptionJson.smart,sniffing:input(form,'json_sniffing').checked,
          dnsRouting:input(form,'json_dnsRouting').checked,
          socksPort:Number(input(form,'json_socksPort').value),
          httpPort:Number(input(form,'json_httpPort').value)
        },
        subscriptionDomain:input(form,'subscriptionDomain').value.trim().toLowerCase(),
        subscriptionPath:input(form,'subscriptionPath').value.trim(),
        subscriptionBrand:input(form,'subscriptionBrand').value.trim(),
        subscriptionAnnouncement:input(form,'subscriptionAnnouncement').value.trim(),
        subscriptionAnnouncementRotationHours:Number(input(form,'subscriptionAnnouncementRotationHours').value),
        subscriptionUpdateInterval:Number(input(form,'subscriptionUpdateInterval').value),
        subscriptionDescription:input(form,'subscriptionDescription').value.trim(),
        subscriptionDescriptionEn:input(form,'subscriptionDescriptionEn').value.trim(),
        subscriptionFooter:input(form,'subscriptionFooter').value.trim(),
        subscriptionFooterEn:input(form,'subscriptionFooterEn').value.trim(),
        subscriptionAccent:input(form,'subscriptionAccent').value,
        subscriptionSecondaryAccent:input(form,'subscriptionSecondaryAccent').value,
        subscriptionSyncPanelTheme:input(form,'subscriptionSyncPanelTheme').checked,
        subscriptionLanguage:input(form,'subscriptionLanguage').value,
        subscriptionTheme:input(form,'subscriptionTheme').value,
        subscriptionShowTraffic:input(form,'subscriptionShowTraffic').checked,
        subscriptionShowExpiry:input(form,'subscriptionShowExpiry').checked,
        subscriptionPlacement:input(form,'subscriptionPlacement').value,
        nodePlacement:input(form,'nodePlacement').value,
        deploymentServerB:input(form,'deploymentServerB').value.trim(),
        deploymentServerC:input(form,'deploymentServerC').value.trim(),
        subscriptionBackground:input(form,'subscriptionBackground').value,
        subscriptionCardColor:input(form,'subscriptionCardColor').value,
        subscriptionTextColor:input(form,'subscriptionTextColor').value,
        subscriptionLayout:input(form,'subscriptionLayout').value,
        subscriptionCardStyle:input(form,'subscriptionCardStyle').value,
        subscriptionFont:input(form,'subscriptionFont').value,
        subscriptionRadius:Number(input(form,'subscriptionRadius').value),
        subscriptionHero:input(form,'subscriptionHero').value.trim(),
        subscriptionHeroEn:input(form,'subscriptionHeroEn').value.trim(),
        subscriptionCta:input(form,'subscriptionCta').value.trim(),
        subscriptionCtaEn:input(form,'subscriptionCtaEn').value.trim(),
        subscriptionLogoUrl:input(form,'subscriptionLogoUrl').value.trim(),
        subscriptionSupportLabel:input(form,'subscriptionSupportLabel').value.trim(),
        subscriptionSupportLabelEn:input(form,'subscriptionSupportLabelEn').value.trim(),
        subscriptionSupportUrl:input(form,'subscriptionSupportUrl').value.trim(),
        subscriptionClientLayout:input(form,'subscriptionClientLayout').value,
        subscriptionAppsTitle:input(form,'subscriptionAppsTitle').value.trim(),
        subscriptionAppsTitleEn:input(form,'subscriptionAppsTitleEn').value.trim(),
        subscriptionCustomClients:readCustomClients(),
        subscriptionShowStatus:input(form,'subscriptionShowStatus').checked,
        subscriptionShowApps:input(form,'subscriptionShowApps').checked,
        subscriptionShowQr:input(form,'subscriptionShowQr').checked,
        subscriptionShowCopy:input(form,'subscriptionShowCopy').checked,
        subscriptionShowSupport:input(form,'subscriptionShowSupport').checked,
        subscriptionShowDevices:input(form,'subscriptionShowDevices').checked,
        subscriptionClients:Object.fromEntries(clientCatalog.map(([id])=>[id,input(form,'subClient_'+id).checked])),
        subscriptionClientLinks:Object.fromEntries(clientCatalog.map(([id])=>[id,input(form,'subClientLink_'+id).value.trim()]).filter(([,url])=>url))
      });
      let previewLanguage=data.subscriptionLanguage;
      const draw = () => {
        applyPanelTheme();
        const d=read();
        if(!['ru','en'].includes(previewLanguage))previewLanguage='ru';
        const lang=previewLanguage,english=lang==='en',copy=locale[lang];
        const previewRoot=$('[data-subscription-preview]');
        previewRoot.lang=lang;
        form.querySelectorAll('[data-portal-language]').forEach(button=>{
          const active=button.dataset.portalLanguage===lang;
          button.setAttribute('aria-pressed',String(active));
          button.classList.toggle('on',active);
        });
        $('[data-subscription-link]').textContent=d.subscriptionDomain && pathOK(d.subscriptionPath)
          ? 'https://'+d.subscriptionDomain+d.subscriptionPath+'/<token>':'Укажите домен и путь';
        const preview=$('[data-subscription-preview]');
        preview.style.setProperty('--portal-accent',d.subscriptionAccent);
        preview.style.setProperty('--portal-secondary',d.subscriptionSecondaryAccent);
        preview.style.setProperty('--portal-bg',d.subscriptionBackground);
        preview.style.setProperty('--portal-card',d.subscriptionCardColor);
        preview.style.setProperty('--portal-text',d.subscriptionTextColor);
        preview.style.setProperty('--portal-radius',d.subscriptionRadius+'px');
        preview.dataset.portalTheme=d.subscriptionTheme;
        preview.dataset.portalLayout=d.subscriptionLayout;
        preview.dataset.portalCards=d.subscriptionCardStyle;
        preview.dataset.portalFont=d.subscriptionFont;
        $('[data-subscription-radius]').textContent=d.subscriptionRadius;
        $('[data-subscription-brand]').textContent=d.subscriptionBrand||settings.brand||'VPN';
        const logo=$('[data-subscription-logo]'),symbol=$('[data-subscription-logo-symbol]');
        const logoUrl=validHttps(d.subscriptionLogoUrl)?d.subscriptionLogoUrl:'';
        if(logoUrl){
          if(logo.getAttribute('src')!==logoUrl)logo.src=logoUrl;
          logo.hidden=false;symbol.hidden=true;
        }else{
          logo.hidden=true;logo.removeAttribute('src');symbol.hidden=false;
        }
        $('[data-subscription-active]').textContent=(english?d.subscriptionHeroEn:d.subscriptionHero)||copy[0];
        $('[data-subscription-description]').textContent=(english?d.subscriptionDescriptionEn:d.subscriptionDescription)||(english?'Connection setup and subscription information.':'Настройки подключения и информация о подписке.');
        $('[data-subscription-traffic-label]').textContent=copy[1];
        $('[data-subscription-expiry-label]').textContent=copy[2];
        const sampleUsage=$('[data-subscription-traffic] b');
        const sampleDate=$('[data-subscription-expiry] b');
        if(sampleUsage)sampleUsage.textContent=english?'12.4 / 100 GB':'12.4 / 100 ГБ';
        if(sampleDate)sampleDate.textContent=english?'Dec 31, 2026':'31.12.2026';
        $('[data-subscription-connect]').textContent=(english?d.subscriptionCtaEn:d.subscriptionCta)||copy[3];
        $('[data-subscription-footer]').textContent=english?d.subscriptionFooterEn:d.subscriptionFooter;
        $('[data-subscription-traffic]').hidden=!d.subscriptionShowTraffic;
        $('[data-subscription-expiry]').hidden=!d.subscriptionShowExpiry;
        $('[data-subscription-ok]').hidden=!d.subscriptionShowStatus;
        $('[data-subscription-active]').hidden=!d.subscriptionShowStatus;
        const quick=$('[data-subscription-quick]');
        $('[data-subscription-copy]').textContent=copy[4];
        $('[data-subscription-devices]').textContent=english?'Devices':'Устройства';
        $('[data-subscription-copy]').hidden=!d.subscriptionShowCopy;
        $('[data-subscription-qr]').hidden=!d.subscriptionShowQr;
        $('[data-subscription-devices]').hidden=!d.subscriptionShowDevices;
        quick.hidden=!(d.subscriptionShowCopy||d.subscriptionShowQr||d.subscriptionShowDevices);
        const enabled=clientCatalog.filter(([id])=>d.subscriptionClients[id]);
        const customEnabled=d.subscriptionCustomClients.filter(client=>client.enabled&&client.name);
        const allEnabled=[...enabled,...customEnabled.map(client=>[client.id,client.name,client.platforms])];
        $('[data-subscription-client-count]').textContent='Активно: '+allEnabled.length+' из '+(clientCatalog.length+d.subscriptionCustomClients.length);
        const apps=$('[data-subscription-apps]');
        apps.hidden=!d.subscriptionShowApps||!allEnabled.length;
        $('[data-subscription-apps-title]').textContent=(english?d.subscriptionAppsTitleEn:d.subscriptionAppsTitle)||appsHeading(lang);
        apps.dataset.clientLayout=d.subscriptionClientLayout;
        $('[data-subscription-app-list]').innerHTML=allEnabled.map(([id,label,platform])=>
          '<div class="subscription-preview-app"><span>'+esc(label.slice(0,2))+'</span><div><b>'+esc(label)+'</b><small>'+esc(platform)+'</small></div></div>'
        ).join('');
        const support=$('[data-subscription-support]');
        support.textContent=(english?d.subscriptionSupportLabelEn:d.subscriptionSupportLabel)||(english?'Support':'Поддержка');
        support.hidden=!d.subscriptionShowSupport;
        const labels={a:'Панель',b:'',c:''};
        labels[d.subscriptionPlacement]+=(labels[d.subscriptionPlacement]?' + ':'')+'Подписки';
        labels[d.nodePlacement]+=(labels[d.nodePlacement]?' + ':'')+'VPN-ноды';
        const names={a:settings.domain||'Локальная панель',b:d.deploymentServerB||'Сервер B',c:d.deploymentServerC||'Сервер C'};
        $('[data-subscription-topology]').innerHTML=slot.filter(([id])=>labels[id]).map(([id])=>
          '<div class="subscription-topology-item"><span>'+esc('SERVER '+id.toUpperCase())+'</span><b>'+esc(labels[id])+'</b><small>'+esc(names[id])+'</small></div>'
        ).join('');
      };
      form.addEventListener('click',event=>{
        const button=event.target.closest('[data-portal-language]');
        if(!button || !form.contains(button))return;
        const next=button.dataset.portalLanguage;
        if(next!=='ru'&&next!=='en')return;
        previewLanguage=next;
        draw();
      });
      form.addEventListener('input',draw);
      form.addEventListener('change',event=>{
        if(event.target.name==='subscriptionLanguage' && ['ru','en'].includes(event.target.value))previewLanguage=event.target.value;
        if(event.target.name==='subscriptionTheme'&&!input(form,'subscriptionSyncPanelTheme').checked){
          const from=themeColors[event.target.value==='light'?'dark':'light'];
          const to=themeColors[event.target.value]||themeColors.dark;
          for(const key of Object.keys(to)){
            const target=input(form,key);
            if(target.value.toLowerCase()===from[key])target.value=to[key];
          }
        }
        draw();
      });
      $('[data-custom-client-add]').addEventListener('click',()=>{
        const current=readCustomClients();
        if(current.length>=maxCustomClients){notify('Можно добавить не более 32 своих приложений.');return;}
        const client={id:nextCustomClientId(current),name:'',platforms:'',url:'',enabled:true};
        const editor=$('[data-custom-client-editor]');
        editor.insertAdjacentHTML('beforeend',renderCustomClient(client,true));
        const added=editor.lastElementChild;
        added.querySelector('[data-custom-field="name"]').focus();
        draw();
      });
      $('[data-custom-client-editor]').addEventListener('click',event=>{
        const button=event.target.closest('[data-custom-client-remove]');
        if(!button)return;
        button.closest('[data-custom-client-row]').remove();
        draw();
      });
      $('[data-custom-client-editor]').addEventListener('input',event=>{
        if(!event.target.matches('[data-custom-field="name"]'))return;
        const row=event.target.closest('[data-custom-client-row]');
        row.querySelector('[data-custom-client-symbol]').textContent=(event.target.value||'APP').slice(0,2);
      });
      form.querySelectorAll('[data-client-preset]').forEach(button=>button.addEventListener('click',()=>{
        const mode=button.dataset.clientPreset;
        for(const [id] of clientCatalog){
          input(form,'subClient_'+id).checked=mode==='all'||(mode==='default'&&defaultClients[id]);
        }
        if(mode!=='default')customRows().forEach(row=>{
          row.querySelector('[data-custom-field="enabled"]').checked=mode==='all';
        });
        draw();
      }));
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        applyPanelTheme();
        const draft=read();
        if(!hostnameOK(draft.subscriptionDomain)){notify('Некорректный домен подписки');return;}
        if(!pathOK(draft.subscriptionPath)){notify('Некорректный путь подписки');return;}
        if(![draft.subscriptionJson.socksPort,draft.subscriptionJson.httpPort].every(p=>Number.isInteger(p)&&p>=1024&&p<=65535)||draft.subscriptionJson.socksPort===draft.subscriptionJson.httpPort){notify('Укажите разные локальные порты в диапазоне 1024–65535');return;}
        for(const key of ['deploymentServerB','deploymentServerC'])
          if(draft[key] && (draft[key].length>253 || /[\u0000-\u001f\u007f]/.test(draft[key]))) {notify('Некорректное описание сервера');return;}
        if(!Number.isInteger(draft.subscriptionUpdateInterval)||draft.subscriptionUpdateInterval<1||draft.subscriptionUpdateInterval>168){notify('Интервал обновления должен быть от 1 до 168 часов.');return;}
        for(const key of ['subscriptionLogoUrl','subscriptionSupportUrl']){
          if(!validHttps(draft[key])){notify('Укажите корректную HTTPS-ссылку без логина и порта.');return;}
        }
        for(const [id,url] of Object.entries(draft.subscriptionClientLinks)){
          if(!validHttps(url)){notify('Некорректная ссылка для '+id+'. Используйте HTTPS.');return;}
        }
        if(draft.subscriptionAppsTitle.length>80||/[\u0000-\u001f\u007f]/.test(draft.subscriptionAppsTitle)){
          notify('Заголовок приложений должен быть короче 80 символов.');return;
        }
        if(draft.subscriptionCustomClients.length>maxCustomClients){
          notify('Не более 32 своих приложений.');return;
        }
        for(const client of draft.subscriptionCustomClients){
          if(!client.name||[...client.name].length>80||[...client.platforms].length>120||
             /[\u0000-\u001f\u007f]/.test(client.name+client.platforms)){
            notify('Заполните название приложения (до 80 символов) и проверьте платформы.');return;
          }
          if(!validHttps(client.url)){notify('Некорректная HTTPS-ссылка для '+client.name);return;}
        }
        for(const key of ['subscriptionHero','subscriptionHeroEn','subscriptionCta','subscriptionCtaEn','subscriptionSupportLabel','subscriptionSupportLabelEn','subscriptionDescriptionEn','subscriptionFooterEn','subscriptionAppsTitleEn']){
          if(/[\u0000-\u001f\u007f]/.test(draft[key])){notify('Заголовки не должны содержать управляющих символов.');return;}
        }
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
  return {create,defaults,hostnameOK,pathOK,clientCatalog,validHttps,renderCustomClient,nextCustomClientId,maxCustomClients,appsHeading};
})();
