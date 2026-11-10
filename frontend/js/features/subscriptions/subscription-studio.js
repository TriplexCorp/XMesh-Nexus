'use strict';
// Studio settings are used by the live subscription portal and URL issuer.
// Separate-server placement remains an architecture plan until a reverse proxy is configured.
window.XMeshSubscriptionStudio = (() => {
  function actionInk(color){
    const rgb=String(color).trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if(!rgb)return '#101820';
    const [r,g,b]=rgb.slice(1).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const luminance=.2126*r+.7152*g+.0722*b;
    return 1.05/(luminance+.05)>(luminance+.05)/.0587?'#ffffff':'#101820';
  }
  const defaults = {
    subscriptionDomain:'', subscriptionPath:'/s',
    subscriptionBrand:'', subscriptionAnnouncement:'', subscriptionAnnouncementRotationHours:24, subscriptionUpdateInterval:24, subscriptionDescription:'Настройки подключения и информация о подписке.',
    subscriptionDescriptionEn:'', subscriptionFooter:'',subscriptionFooterEn:'', subscriptionAccent:'#e8bb78',subscriptionSecondaryAccent:'#c6e985', subscriptionSyncPanelTheme:true, subscriptionLanguage:'ru', subscriptionTheme:'dark',
    subscriptionShowTraffic:true, subscriptionShowExpiry:true,
    subscriptionStatusEmojis:{ACTIVE:'✅',ON_HOLD:'⌛️',LIMITED:'🪫',EXPIRED:'❌',DISABLED:'🔌'},
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
  const remarkStatuses=Object.freeze([
    ['ACTIVE','Активная'],['ON_HOLD','Ожидает подключения'],
    ['LIMITED','Трафик исчерпан'],['EXPIRED','Срок истёк'],['DISABLED','Отключена']
  ]);
  // Announcements have user and global CDN context but no single Host/node.
  // Keep this list sourced from the same Remark variable catalog and intentionally
  // exclude SERVER_IP, PROTOCOL, NODE_DATA_LEFT and TRAFFIC_LEFT.
  const announcementFields=Object.freeze([
    'USERNAME','DATA_USAGE','DATA_LEFT','DATA_LIMIT','CDN_DATA_LEFT',
    'DAYS_LEFT','TIME_LEFT','EXPIRE_DATE','JALALI_EXPIRE_DATE',
    'STATUS_TEXT','STATUS_EMOJI'
  ]);
  const announcementFallback=Object.freeze([
    ['USERNAME','Имя пользователя'],['DATA_USAGE','Израсходованный трафик'],
    ['DATA_LEFT','Остаток общего трафика'],['DATA_LIMIT','Лимит трафика'],
    ['CDN_DATA_LEFT','Остаток LTE / CDN'],['DAYS_LEFT','Осталось дней'],
    ['TIME_LEFT','Осталось времени'],['EXPIRE_DATE','Дата окончания'],
    ['JALALI_EXPIRE_DATE','Дата по календарю Джалали'],
    ['STATUS_TEXT','Статус подписки'],['STATUS_EMOJI','Эмодзи статуса']
  ]);
  const announcementTokens=()=>((window.XMeshRemarkPicker?.variables)||announcementFallback)
    .filter(([key])=>announcementFields.includes(key));
  const announcementExamples=Object.freeze({
    USERNAME:'alice',DATA_USAGE:'1.75 ГБ',DATA_LEFT:'∞',
    DATA_LIMIT:'∞',CDN_DATA_LEFT:'3.25 ГБ',DAYS_LEFT:'24',
    TIME_LEFT:'24 д. 3 ч. 0 мин.',EXPIRE_DATE:'2026-12-05',
    JALALI_EXPIRE_DATE:'1405-09-14',STATUS_TEXT:'Активна',STATUS_EMOJI:'✅'
  });
  const demoAnnouncement=text=>{
    const selected=String(text||'').split('\n---\n').map(x=>x.trim()).find(Boolean)||'';
    return selected.replace(/\{([A-Z_]+)\}/g,(full,key)=>
      Object.prototype.hasOwnProperty.call(announcementExamples,key)?announcementExamples[key]:full);
  };
  // Preserve the position inside a multiline notice. This is intentionally
  // different from the append-only Host/Remark server-name picker.
  const insertAnnouncementToken=(field,key)=>{
    if(!announcementFields.includes(key))return false;
    const token='{'+key+'}';
    const start=Number.isInteger(field.selectionStart)?field.selectionStart:field.value.length;
    const end=Number.isInteger(field.selectionEnd)?field.selectionEnd:start;
    if(field.maxLength>=0 && field.value.length-(end-start)+token.length>field.maxLength)return false;
    field.setRangeText(token,start,end,'end');
    field.focus();
    field.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  };
  const announcementHelp=()=>'<div class="subscription-announcement-tools">'+
    '<details class="subscription-announcement-variables"><summary>Переменные для анонсов <small>Вставить в текст</small></summary>'+
    '<div class="subscription-announcement-token-grid">'+
    announcementTokens().map(([key,description])=>
      '<button type="button" class="subscription-announcement-token" data-announcement-token="'+key+
      '" title="'+esc(description)+'"><code>{'+key+'}</code><small>'+esc(description)+'</small></button>').join('')+
    '</div><p>Подстановка выполняется персонально при обновлении подписки. Для отдельной ноды используйте Remark: у анонса нет привязки к одной ноде.</p></details>'+
    '<div class="subscription-announcement-demo"><small>Предпросмотр · демо-пользователь</small>'+
    '<output data-announcement-demo>—</output></div></div>';
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
    (opts && opts.area ? '<textarea name="'+name+'" rows="'+(opts.rows||2)+'" maxlength="'+(opts.max||240)+'"'+(opts.placeholder?' placeholder="'+esc(opts.placeholder)+'"':'')+'>'+esc(value)+'</textarea>' :
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
    data.subscriptionStatusEmojis={...defaults.subscriptionStatusEmojis,...(settings?.subscriptionStatusEmojis||{})};
    data.subscriptionClientLinks={...(settings?.subscriptionClientLinks||{})};
    data.subscriptionCustomClients=Array.isArray(settings?.subscriptionCustomClients)?settings.subscriptionCustomClients.slice(0,maxCustomClients):[];

    if(!slot.some(([id])=>id===data.subscriptionPlacement)) data.subscriptionPlacement='a';
    if(!slot.some(([id])=>id===data.nodePlacement)) data.nodePlacement='a';
    const markup = [
      '<div class="subscription-studio">',
      '<header class="subscription-studio-intro"><div><h2>SUBSCRIPTION STUDIO</h2>',
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
      field('subscriptionAnnouncement','Анонсы для VPN-клиентов',data.subscriptionAnnouncement,'Разделяйте объявления отдельной строкой --- . Сообщения чередуются с заданной ниже периодичностью.',{area:true,rows:3,max:4000,placeholder:'Пользователь: {USERNAME}\nОсталось LTE: {CDN_DATA_LEFT}'}),
      announcementHelp(),
      field('subscriptionAnnouncementRotationHours','Ротация анонсов (ч)',data.subscriptionAnnouncementRotationHours,'От 1 до 720 часов. По умолчанию 24 часа. Период отсчитывается по UTC.',{type:'number',min:1,max:720}),
      field('subscriptionUpdateInterval','Интервал обновления подписки (ч)',data.subscriptionUpdateInterval,'Подсказка для поддерживающих клиентов: от 1 до 168 часов.',{type:'number',min:1,max:168}),
      '<details class="subscription-status-emojis"><summary>Эмодзи статусов в Remark <small>Настраиваемые</small></summary>',
      '<p class="subscription-emoji-hint">Используйте <code>{STATUS_EMOJI}</code> в названии публичного подключения. Значок автоматически зависит от статуса пользователя при обновлении подписки.</p>',
      '<div class="subscription-studio-pair">',
      ...remarkStatuses.map(([status,label])=>field('remarkEmoji_'+status,label,data.subscriptionStatusEmojis[status],null,{max:32})),
      '</div></details>',
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
      '<div class="subscription-preview-label"><b>Предпросмотр публичной страницы</b><span>Адаптивный вид · демоданные</span></div>',
      '<div class="subscription-studio-preview subscription-public" data-subscription-preview-frame="">',
      '<main class="subscription-public-shell">',
      '<div class="subscription-preview" data-subscription-preview="">',
      '<header class="subscription-preview-brand">',
      '<div class="subscription-public-brand-identity">',
      '<span data-subscription-logo-symbol="">✦</span>',
      '<img data-subscription-logo="" alt="" hidden="">',
      '<div class="subscription-public-brand-copy">',
      '<b data-subscription-brand="">',
      '</b>',
      '<small data-subscription-brand-note="">',
      '</small>',
      '</div>',
      '</div>',
      '<div class="subscription-preview-languages" role="group" aria-label="Language / Язык">',
      '<button type="button" data-portal-language="ru" aria-pressed="true" lang="ru">RU</button>',
      '<button type="button" data-portal-language="en" aria-pressed="false" lang="en">EN</button>',
      '</div>',
      '</header>',
      '<div class="subscription-public-overview">',
      '<section class="subscription-preview-hero">',
      '<div class="subscription-preview-hero-copy">',
      '<span class="subscription-preview-ok" data-subscription-ok="">● Активна</span>',
      '<h1 data-subscription-active="">Подписка активна</h1>',
      '<p data-subscription-description="">Настройки подключения</p>',
      '</div>',
      '<svg class="portal-orbit" viewBox="0 0 260 260" aria-hidden="true">',
      '<circle cx="130" cy="130" r="95">',
      '</circle>',
      '<ellipse cx="130" cy="130" rx="116" ry="42" transform="rotate(38 130 130)">',
      '</ellipse>',
      '<ellipse cx="130" cy="130" rx="116" ry="42" transform="rotate(-52 130 130)">',
      '</ellipse>',
      '<circle class="portal-orbit-dot" cx="202" cy="67" r="4">',
      '</circle>',
      '<circle class="portal-orbit-dot" cx="64" cy="181" r="3">',
      '</circle>',
      '</svg>',
      '</section>',
      '<aside class="subscription-public-info-panel">',
      '<header class="subscription-public-panel-title">',
      '<span class="subscription-public-panel-icon is-status" aria-hidden="true">',
      '</span>',
      '<div>',
      '<b data-preview-status-label="">',
      '</b>',
      '<small data-preview-status-note="">',
      '</small>',
      '</div>',
      '</header>',
      '<div class="subscription-public-status-stack">',
      '<div class="subscription-preview-meta" data-subscription-metrics="">',
      '<div data-subscription-traffic="">',
      '<small data-subscription-traffic-label="">Трафик</small>',
      '<b class="portal-usage-total">12.4%</b>',
      '<div class="subscription-preview-progress">',
      '<i style="width:12.4%">',
      '</i>',
      '</div>',
      '<p class="portal-usage-allowance" data-preview-allowance=""></p>',
      '<div class="portal-usage-breakdown"><div><small data-preview-used-label=""></small><b data-preview-used=""></b></div><div><small data-preview-remaining-label=""></small><b data-preview-remaining=""></b></div></div>',
      '</div>',
      '<div data-subscription-expiry="">',
      '<small data-subscription-expiry-label="">Действует до</small>',
      '<b data-expiry="1798675200000">31.12.2026</b>',
      '</div>',
      '</div>',
      '</div>',
      '</aside>',
      '<section class="subscription-cabinet-panel" id="cabinet-panel-connect" data-setup-section="connect">',
      '<div class="subscription-cabinet-connect-grid">',
      '<section class="subscription-public-access-panel">',
      '<header class="subscription-public-panel-title">',
      '<span class="subscription-public-panel-icon is-access" aria-hidden="true">',
      '</span>',
      '<div>',
      '<b data-preview-endpoint-label="">',
      '</b>',
      '<small data-preview-endpoint-note="">',
      '</small>',
      '</div>',
      '</header>',
      '<div class="subscription-public-primary-action">',
      '<div class="subscription-preview-cta" data-subscription-connect="">Подключиться</div>',
      '</div>',
      '<div class="subscription-preview-quick" data-subscription-quick="">',
      '<button type="button" data-subscription-copy="">Копировать ссылку</button>',
      '<button type="button" data-subscription-qr="" aria-expanded="false">QR</button>',
      '<button type="button" data-subscription-reveal="" aria-expanded="false">Показать ссылку</button>',
      '<button type="button" data-subscription-devices="">Устройства</button>',
      '</div>',
      '<section class="subscription-public-link-card" data-preview-link-card="" hidden="">',
      '<div class="subscription-public-link-card-head">',
      '<div>',
      '<b data-preview-link-label="">',
      '</b>',
      '<small data-preview-link-note="">',
      '</small>',
      '</div>',
      '<em>HTTPS</em>',
      '</div>',
      '<code data-preview-demo-link="">',
      '</code>',
      '</section>',
      '<p class="subscription-public-action-status" id="subscription-action-status" aria-live="polite">',
      '</p>',
      '<div class="subscription-public-secondary-surfaces" data-portal-qr-slot="">',
      '<div class="subscription-preview-qr" data-preview-qr="" hidden="">',
      '</div>',
      '</div>',
      '</section>',
      '</div>',
      '</section>',
      '</div>',
      '<div class="subscription-public-workspace">',
      '<section class="subscription-cabinet-panel" id="cabinet-panel-apps" data-setup-section="apps">',
      '<details class="portal-app-disclosure">',
      '<summary id="portal-app-disclosure-label">Нужно установить приложение?</summary>',
      '<div class="subscription-cabinet-app-tools">',
      '<div class="subscription-cabinet-filters" role="group" aria-label="Фильтр платформ" data-preview-platform-filters="">',
      '<button type="button" data-app-filter="all" aria-pressed="true">Все</button>',
      '<button type="button" data-app-filter="ios" aria-pressed="false">iOS</button>',
      '<button type="button" data-app-filter="android" aria-pressed="false">Android</button>',
      '<button type="button" data-app-filter="windows" aria-pressed="false">Windows</button>',
      '<button type="button" data-app-filter="macos" aria-pressed="false">macOS</button>',
      '<button type="button" data-app-filter="linux" aria-pressed="false">Linux</button>',
      '</div>',
      '</div>',
      '<div class="subscription-public-catalog">',
      '<section class="subscription-preview-apps" data-subscription-apps="">',
      '<header data-subscription-apps-title="">Приложения для подключения</header>',
      '<div data-subscription-app-list="">',
      '</div>',
      '</section>',
      '</div>',
      '<p class="subscription-cabinet-no-apps" id="cabinet-apps-empty" hidden="">По вашему запросу приложений не найдено.</p>',
      '</details>',
      '</section>',
      '<section class="subscription-cabinet-panel" id="cabinet-panel-devices" data-setup-section="devices">',
      '<header class="subscription-cabinet-section-heading">',
      '<div>',
      '<h2 id="cabinet-devices-heading">Управление подключениями</h2>',
      '<p id="cabinet-devices-note">Число привязанных устройств и доступный лимит.</p>',
      '</div>',
      '</header>',
      '<div class="subscription-cabinet-device-card">',
      '<span class="cabinet-device-emblem" aria-hidden="true">▣</span>',
      '<div class="subscription-public-devices" data-preview-devices="" hidden="">Зарегистрировано устройств: 2 · Лимит: 5</div>',
      '</div>',
      '</section>',
      '<section class="subscription-cabinet-panel" id="cabinet-panel-support" data-setup-section="support">',
      '<header class="subscription-cabinet-section-heading">',
      '<div>',
      '<h2 id="cabinet-support-heading">Мы рядом, когда нужна помощь</h2>',
      '<p id="cabinet-support-note">Свяжитесь со службой поддержки по указанному каналу.</p>',
      '</div>',
      '</header>',
      '<div class="subscription-cabinet-support-card">',
      '<span class="cabinet-support-emblem" aria-hidden="true">✳</span>',
      '<span class="subscription-preview-support" data-subscription-support="">Поддержка</span>',
      '</div>',
      '</section>',
      '</div>',
      '<footer>',
      '<span data-subscription-footer="">',
      '</span>',
      '</footer>',
      '</div>',
      '</main>',
      '</div>',
      '<div class="subscription-studio-stats"><div><small>Пользователей</small><b>'+esc(counts.users)+'</b></div><div><small>Узлов</small><b>'+esc(counts.nodes)+'</b></div></div>',
      '</aside></form></div>'
    ].join('');
    const mount = () => {
      const form=document.getElementById('subscription-studio-form');
      if(!form)return;
      // The visitor portal stylesheet is deliberately forbidden in the panel's
      // global CSS graph. Mount the real public markup inside a ShadowRoot,
      // then load the production CSS only there: no auth-panel style leakage.
      const previewHost=form.querySelector('[data-subscription-preview-frame]');
      const previewShadow=previewHost.attachShadow({mode:'open'});
      const previewBody=document.createElement('div');
      previewBody.className='subscription-studio-preview subscription-public';
      while(previewHost.firstChild)previewBody.appendChild(previewHost.firstChild);
      for(const href of [
        '/subscription-studio.css?v=6fc2d828fd52',
        '/subscription-surface.css?v=0a79377d5733',
        '/subscription-public.css?v=6a55fffe32d1'
      ]){
        const link=document.createElement('link');
        link.rel='stylesheet';link.href=href;previewShadow.appendChild(link);
      }
      previewShadow.appendChild(previewBody);
      const $=s=>form.querySelector(s)||previewShadow.querySelector(s);
      const announcementInput=input(form,'subscriptionAnnouncement');
      const updateAnnouncementPreview=()=>{
        const output=form.querySelector('[data-announcement-demo]');
        if(output)output.textContent=demoAnnouncement(announcementInput.value)||'—';
      };
      form.addEventListener('click',event=>{
        const button=event.target.closest('[data-announcement-token]');
        if(!button||!form.contains(button))return;
        event.preventDefault();
        if(insertAnnouncementToken(announcementInput,button.dataset.announcementToken)){
          updateAnnouncementPreview();
        }
      });
      announcementInput.addEventListener('input',updateAnnouncementPreview);
      updateAnnouncementPreview();

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
        subscriptionStatusEmojis:Object.fromEntries(remarkStatuses.map(([status])=>[status,input(form,'remarkEmoji_'+status).value.trim()])),
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
      let previewPlatform='all';
      const syncPreviewSections=()=>{
        const enabled={apps:!previewShadow.querySelector('[data-subscription-apps]')?.hidden,connect:true,devices:!!input(form,'subscriptionShowDevices')?.checked,support:!!input(form,'subscriptionShowSupport')?.checked};
        previewShadow.querySelectorAll('[data-setup-section]').forEach(section=>{section.hidden=!enabled[section.dataset.setupSection]});
        const devices=previewShadow.querySelector('[data-preview-devices]');if(devices)devices.hidden=!enabled.devices;
        previewShadow.querySelector('[data-subscription-copy]')?.setAttribute('hidden','');
        previewShadow.querySelector('[data-subscription-devices]')?.setAttribute('hidden','');
      };
      const applyPreviewFilter=()=>{
        const needle=(previewShadow.querySelector('[data-preview-app-search]')?.value||'').trim().toLocaleLowerCase(previewLanguage);
        let count=0;
        previewShadow.querySelectorAll('.subscription-preview-app').forEach(tile=>{
          const platform=tile.querySelector('small')?.textContent?.toLocaleLowerCase('en')||'';
          const name=tile.querySelector('b')?.textContent?.toLocaleLowerCase(previewLanguage)||'';
          const match=(previewPlatform==='all'||platform.includes(previewPlatform))&&
            (!needle||name.includes(needle)||platform.includes(needle));
          tile.hidden=!match;
          if(match)count++;
        });
        const empty=previewShadow.querySelector('#cabinet-apps-empty');
        if(empty)empty.hidden=count>0;
      };
      const previewQr=previewShadow.querySelector('[data-subscription-qr]');
      previewShadow.querySelector('.subscription-public-primary-action')?.append(previewQr);
      const draw = () => {
        applyPanelTheme();
        const d=read();
        if(!['ru','en'].includes(previewLanguage))previewLanguage='ru';
        const lang=previewLanguage,english=lang==='en',copy=locale[lang];
        const previewRoot=$('[data-subscription-preview]');
        previewRoot.lang=lang;
        previewShadow.querySelector('.subscription-preview-languages').setAttribute('aria-label',english?'Language':'Язык');
        const local=english?{
          tabs:['Overview','Connect','Applications','Devices','Support'],
          kicker:'MY ACCOUNT / VPN ACCESS',featureEyebrow:'YOUR ACCESS',
          featureHeading:'Let’s connect your device',
          featureNote:'A few simple steps. Start by choosing an app for your phone or computer.',
          start:'Connect a device',findApp:'I already have an app',stepsEyebrow:'How it works',
          steps:['Choose your app','Add your subscription','Enable the connection'],
          notes:['Install an app for your phone or computer','Copy your link from this page into the app','Tap Connect in the app. You’re ready to go.'],
          guideTitle:'What to do next',guideDescription:'After adding the subscription, choose a server in your app and tap Connect. Return here whenever you need your link.',
          guideHint:'Your personal link grants access to the subscription. Never share it.',
          appsKicker:'CLIENT LIBRARY',appsNote:'Choose your device. Tap an app to install it.',
          appsSearch:'Search applications…',appsEmpty:'No applications match these filters.',
          devicesKicker:'YOUR DEVICES',devicesHeading:'Connected devices',
          devicesNote:'Your registered device count and allowance.',
          supportKicker:'HELP CENTER',supportHeading:'Need a hand?',
          supportNote:'If something isn’t working, contact support. They can help you get connected.',nextNote:'Install an app, then return to this page.',next:'Next: add subscription',all:'All',
          devicesSample:'Registered devices: 2 · Limit: 5'
        }:{
          tabs:['Обзор','Подключение','Приложения','Устройства','Поддержка'],
          kicker:'МОЙ КАБИНЕТ / VPN ACCESS',featureEyebrow:'ВАШ ДОСТУП',
          featureHeading:'Подключим ваше устройство',
          featureNote:'Несколько простых шагов. Начните с приложения для телефона или компьютера.',
          start:'Подключить устройство',findApp:'Приложение уже есть',stepsEyebrow:'Как подключиться',
          steps:['Выберите приложение','Добавьте подписку','Включите подключение'],
          notes:['Установите приложение на телефон или компьютер','Скопируйте ссылку с этой страницы в приложение','Нажмите кнопку подключения в приложении. Готово!'],
          guideTitle:'Что делать дальше',
          guideDescription:'После добавления подписки выберите сервер в приложении и включите подключение. Ссылка всегда будет на этой странице.',
          guideHint:'Персональная ссылка открывает доступ к подписке. Не передавайте её посторонним.',
          appsKicker:'КАТАЛОГ',appsNote:'Выберите устройство. Нажмите на приложение, чтобы установить его.',
          appsSearch:'Найти приложение…',appsEmpty:'По вашему запросу приложений не найдено.',
          devicesKicker:'ВАШИ УСТРОЙСТВА',devicesHeading:'Подключённые устройства',
          devicesNote:'Количество зарегистрированных устройств и лимит.',
          supportKicker:'ПОМОЩЬ',supportHeading:'Нужна помощь?',
          supportNote:'Если что-то не получается, напишите в поддержку. Вам помогут подключиться.',nextNote:'Установите приложение и вернитесь на эту страницу.',next:'Далее: добавить подписку',all:'Все',
          devicesSample:'Зарегистрировано устройств: 2 · Лимит: 5'
        };
        const setText=(id,text)=>{const node=previewShadow.getElementById(id);if(node)node.textContent=text;};
        ['overview','connect','apps','devices','support'].forEach((key,i)=>setText('cabinet-tab-'+key+'-label',local.tabs[i]));
        const keys={
          'cabinet-kicker':'kicker','portal-app-next-note':'nextNote','portal-app-next':'next',
          'cabinet-feature-heading':'featureHeading','cabinet-feature-note':'featureNote',
          'cabinet-start':'start','cabinet-find-app':'findApp',
          'cabinet-steps-eyebrow':'stepsEyebrow','cabinet-guide-title':'guideTitle',
          'cabinet-guide-description':'guideDescription','cabinet-guide-hint':'guideHint',
          'cabinet-apps-kicker':'appsKicker','cabinet-apps-note':'appsNote',
          'cabinet-apps-empty':'appsEmpty','cabinet-devices-kicker':'devicesKicker',
          'cabinet-devices-heading':'devicesHeading','cabinet-devices-note':'devicesNote',
          'cabinet-support-kicker':'supportKicker','cabinet-support-heading':'supportHeading',
          'cabinet-support-note':'supportNote'
        };
        Object.entries(keys).forEach(([id,key])=>setText(id,local[key]));
        local.steps.forEach((v,i)=>setText(['cabinet-step-one','cabinet-step-two','cabinet-step-three'][i],v));
        local.notes.forEach((v,i)=>setText(['cabinet-step-one-note','cabinet-step-two-note','cabinet-step-three-note'][i],v));
        const findApps=previewShadow.querySelector('[data-preview-app-search]');
        if(findApps){findApps.placeholder=local.appsSearch;findApps.setAttribute('aria-label',local.appsSearch)}
        setText('cabinet-apps-heading',english?'Choose an app':'Выберите приложение');
        const allFilter=previewShadow.querySelector('[data-app-filter="all"]');
        if(allFilter)allFilter.textContent=local.all;
        const deviceSample=previewShadow.querySelector('[data-preview-devices]');
        if(deviceSample)deviceSample.textContent=local.devicesSample;
        previewShadow.querySelectorAll('[data-portal-language]').forEach(button=>{
          const active=button.dataset.portalLanguage===lang;
          button.setAttribute('aria-pressed',String(active));
          button.classList.toggle('on',active);
        });
        $('[data-subscription-link]').textContent=d.subscriptionDomain && pathOK(d.subscriptionPath)
          ? 'https://'+d.subscriptionDomain+d.subscriptionPath+'/<token>':'Укажите домен и путь';
        const preview=$('[data-subscription-preview]');
        preview.style.setProperty('--portal-accent',d.subscriptionAccent);
        preview.style.setProperty('--portal-action-ink',actionInk(d.subscriptionAccent));
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
        $('[data-subscription-brand-note]').textContent=english?'Your subscription':'Ваша подписка';
        const dashboard=english?{
          'portal-quickstart-title':'Connect in three steps','portal-guide-copy':'Copy your link above',
          'portal-guide-app':'Open your VPN app','portal-guide-import':'Import the link',
          'portal-guide-finish':'Once imported, turn on the connection in your app.',
          'portal-app-disclosure-label':'Need to install an app?'
        }:{
          'portal-quickstart-title':'Подключение в три шага','portal-guide-copy':'Скопируйте ссылку выше',
          'portal-guide-app':'Откройте VPN-приложение','portal-guide-import':'Добавьте подписку по ссылке',
          'portal-guide-finish':'После добавления включите подключение в приложении.',
          'portal-app-disclosure-label':'Нужно установить приложение?'
        };
        Object.entries(dashboard).forEach(([id,text])=>setText(id,text));
        $('[data-preview-allowance]').textContent=english?'Limit: 100 GB':'Лимит: 100 ГБ';
        $('[data-preview-used-label]').textContent=english?'Used':'Использовано';
        $('[data-preview-remaining-label]').textContent=english?'Remaining':'Осталось';
        $('[data-preview-used]').textContent=english?'12.4 GB':'12,4 ГБ';
        $('[data-preview-remaining]').textContent=english?'87.6 GB':'87,6 ГБ';
        $('[data-preview-endpoint-label]').textContent=english?'Connect':'Подключение';
        $('[data-preview-endpoint-note]').textContent=english?'In your VPN app, choose “Add subscription” or scan the QR code.':'В VPN-приложении выберите «Добавить подписку» или отсканируйте QR-код.';
        $('[data-preview-status-label]').textContent=english?'Subscription status':'Статус подписки';
        $('[data-preview-status-note]').textContent=english?'Traffic and validity':'Трафик и срок действия';
        $('[data-subscription-ok]').textContent=english?'● Active':'● Активна';
        $('[data-subscription-reveal]').hidden=true;
        $('[data-subscription-reveal]').textContent=$('[data-preview-link-card]').hidden ? (english?'Show private link':'Показать ссылку') : (english?'Hide private link':'Скрыть ссылку');
        $('[data-preview-link-label]').textContent=english?'Your subscription link':'Ссылка на подписку';
        $('[data-preview-link-note]').textContent=english?'Sample URL — not a real access token':'Демонстрационный адрес, без настоящего токена';
        $('[data-preview-demo-link]').textContent=d.subscriptionDomain && pathOK(d.subscriptionPath)
          ? 'https://'+d.subscriptionDomain+d.subscriptionPath+'/example-token'
          : 'https://sub.example.com/s/example-token';
        $('[data-subscription-active]').textContent=(english?d.subscriptionHeroEn:d.subscriptionHero)||copy[0];
        if(/^(Подписка (не)?активна|Subscription (in)?active)$/i.test($('[data-subscription-active]').textContent.trim()))$('[data-subscription-active]').textContent=english?'Your subscription':'Ваша подписка';
        $('[data-subscription-description]').textContent=(english?d.subscriptionDescriptionEn:d.subscriptionDescription)||'';
        $('[data-subscription-traffic-label]').textContent=copy[1];
        $('[data-subscription-expiry-label]').textContent=copy[2];
        const sampleUsage=$('[data-subscription-traffic] b');
        const sampleDate=$('[data-subscription-expiry] b');
        if(sampleUsage)sampleUsage.textContent=english?'12.4%':'12,4%';
        window.XMeshSubscriptionTraffic?.mount($('[data-subscription-traffic]'),{used:12.4,limit:100,servers:[{name:english?'Server 1':'Сервер 1',gib:8,upload:2,download:6},{name:english?'Server 2':'Сервер 2',gib:4.4,upload:1,download:3.4}],language:lang});
        if(sampleDate)sampleDate.textContent=english?'Dec 31, 2026':'31.12.2026';
        $('[data-subscription-connect]').textContent=(english?d.subscriptionCtaEn:d.subscriptionCta)||copy[3];
        if(['Connect','Подключиться'].includes($('[data-subscription-connect]').textContent.trim()))$('[data-subscription-connect]').textContent=english?'Copy':'Копировать';
        $('[data-subscription-qr]').textContent=english?'QR code':'QR-код';
        $('[data-subscription-footer]').textContent=english?d.subscriptionFooterEn:d.subscriptionFooter;
        $('[data-subscription-traffic]').hidden=!d.subscriptionShowTraffic;
        $('[data-subscription-expiry]').hidden=!d.subscriptionShowExpiry;
        previewShadow.querySelector('.subscription-public-info-panel').hidden=!d.subscriptionShowTraffic&&!d.subscriptionShowExpiry;
        $('[data-subscription-ok]').hidden=!d.subscriptionShowStatus;
        $('[data-subscription-active]').hidden=!d.subscriptionShowStatus;
        const quick=$('[data-subscription-quick]');
        $('[data-subscription-copy]').textContent=copy[4];
        $('[data-subscription-devices]').textContent=english?'Devices':'Устройства';
        $('[data-subscription-copy]').hidden=!d.subscriptionShowCopy;
        $('[data-subscription-qr]').hidden=!d.subscriptionShowQr;
        $('[data-subscription-devices]').hidden=!d.subscriptionShowDevices;
        // Revealing the personal address is a separate, always-available action.
        quick.hidden=false;
        const enabled=clientCatalog.filter(([id])=>d.subscriptionClients[id]);
        const customEnabled=d.subscriptionCustomClients.filter(client=>client.enabled&&client.name);
        const allEnabled=[...enabled,...customEnabled.map(client=>[client.id,client.name,client.platforms])];
        $('[data-subscription-client-count]').textContent='Активно: '+allEnabled.length+' из '+(clientCatalog.length+d.subscriptionCustomClients.length);
        const apps=$('[data-subscription-apps]');
        apps.hidden=!d.subscriptionShowApps||!allEnabled.length;
        $('[data-subscription-apps-title]').textContent=(english?d.subscriptionAppsTitleEn:d.subscriptionAppsTitle)||appsHeading(lang);
        apps.dataset.clientLayout=d.subscriptionClientLayout;
        $('[data-subscription-app-list]').innerHTML=allEnabled.map(([id,label,platform])=>
          '<div class="subscription-preview-app" data-client-id="'+esc(id)+'" data-install-url="'+esc(customEnabled.find(client=>client.id===id)?.url||d.subscriptionClientLinks[id]||'')+'"><span>'+esc(label.slice(0,2))+'</span><div><b>'+esc(label)+'</b><small>'+esc(platform)+'</small></div></div>'
        ).join('');
        syncPreviewSections();
        applyPreviewFilter();
        window.XMeshSubscriptionExperience?.mount(previewRoot,{language:lang,startLabel:english?d.subscriptionCtaEn:d.subscriptionCta,url:$('[data-preview-demo-link]').textContent,copyButton:$('[data-subscription-connect]'),copy:async()=>{}});

        const support=$('[data-subscription-support]');
        support.textContent=(english?d.subscriptionSupportLabelEn:d.subscriptionSupportLabel)||(english?'Support':'Поддержка');
        support.hidden=!d.subscriptionShowSupport;
        syncPreviewSections();
        const labels={a:'Панель',b:'',c:''};
        labels[d.subscriptionPlacement]+=(labels[d.subscriptionPlacement]?' + ':'')+'Подписки';
        labels[d.nodePlacement]+=(labels[d.nodePlacement]?' + ':'')+'VPN-ноды';
        const names={a:settings.domain||'Локальная панель',b:d.deploymentServerB||'Сервер B',c:d.deploymentServerC||'Сервер C'};
        $('[data-subscription-topology]').innerHTML=slot.filter(([id])=>labels[id]).map(([id])=>
          '<div class="subscription-topology-item"><span>'+esc('SERVER '+id.toUpperCase())+'</span><b>'+esc(labels[id])+'</b><small>'+esc(names[id])+'</small></div>'
        ).join('');
      };
      previewShadow.addEventListener('click',event=>{
        const filter=event.target.closest('[data-app-filter]');
        if(filter&&previewShadow.contains(filter)){
          previewPlatform=filter.dataset.appFilter;
          previewShadow.querySelectorAll('[data-app-filter]').forEach(button=>{
            button.setAttribute('aria-pressed',String(button===filter));
          });
          applyPreviewFilter();


          return;
        }
        const qrButton=event.target.closest('[data-subscription-qr]');
        if(qrButton&&previewShadow.contains(qrButton)){
          const target=previewShadow.querySelector('[data-preview-qr]');
          if(!target)return;
          target.hidden=!target.hidden;
          qrButton.setAttribute('aria-expanded',String(!target.hidden));
          if(!target.hidden&&!target.firstChild){
            const url=previewShadow.querySelector('[data-preview-demo-link]')?.textContent||'https://sub.example.com/s/example-token';
            const Qr=window.qrcodegen?.QrCode;
            if(Qr){
              const qr=Qr.encodeText(url,Qr.Ecc.MEDIUM),quiet=4;
              const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
              svg.setAttribute('viewBox','0 0 '+(qr.size+quiet*2)+' '+(qr.size+quiet*2));
              svg.setAttribute('aria-label','Sample QR');
              const bg=document.createElementNS(ns,'rect');bg.setAttribute('width','100%');bg.setAttribute('height','100%');bg.setAttribute('fill','#fff');svg.append(bg);
              let data='';
              for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))data+='M'+(x+quiet)+','+(y+quiet)+'h1v1h-1z';
              const path=document.createElementNS(ns,'path');path.setAttribute('d',data);path.setAttribute('fill','#101923');svg.append(path);
              target.replaceChildren(svg);
            }
          }
          return;
        }
        const reveal=event.target.closest('[data-subscription-reveal]');
        if(reveal&&previewShadow.contains(reveal)){
          const card=previewShadow.querySelector('[data-preview-link-card]');
          card.hidden=!card.hidden;
          reveal.setAttribute('aria-expanded',String(!card.hidden));
          reveal.textContent=card.hidden?(previewLanguage==='en'?'Show private link':'Показать ссылку'):(previewLanguage==='en'?'Hide private link':'Скрыть ссылку');
          return;
        }
        const button=event.target.closest('[data-portal-language]');
        if(!button || !previewShadow.contains(button))return;
        const next=button.dataset.portalLanguage;
        if(next!=='ru'&&next!=='en')return;
        previewLanguage=next;
        draw();
      });
      previewShadow.querySelector('[data-preview-app-search]')?.addEventListener('input',applyPreviewFilter);
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
        if(Object.values(draft.subscriptionStatusEmojis).some(emoji=>!emoji||[...emoji].length>16||/[\u0000-\u001f\u007f]/.test(emoji))){
          notify('Эмодзи статуса должен содержать от 1 до 16 символов.');return;
        }
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
  return {create,defaults,hostnameOK,pathOK,clientCatalog,validHttps,renderCustomClient,nextCustomClientId,maxCustomClients,appsHeading,announcementPreview:demoAnnouncement,insertAnnouncementToken};
})();
