'use strict';
// The live customer portal and SUBSCRIPTION STUDIO share the same
// subscription-preview component and design tokens.
(() => {
  const language = document.documentElement.lang === 'en' ? 'en' : 'ru';
  const copy = language === 'en'
    ? {
        brandNote:'Secure access workspace',
        linkLabel:'Personal HTTPS link',
        linkNote:'Use this address in a compatible client. Keep it private.',
        endpointLabel:'Secure endpoint',
        endpointNote:'The complete address includes this portal origin and your private token.',
        statusLabel:'Subscription status',
        statusNote:'Traffic, expiry and service availability.',
        copied:'HTTPS link copied!',
        copyUnavailable:'Copy not available',
        qrUnavailable:'QR unavailable',
        qrLabel:'Subscription QR code',
        showLink:'Show private link',
        hideLink:'Hide private link'
      }
    : {
        brandNote:'Центр безопасного подключения',
        linkLabel:'Персональная HTTPS-ссылка',
        linkNote:'Добавьте этот адрес в совместимое приложение. Не передавайте его посторонним.',
        endpointLabel:'Защищённая точка подключения',
        endpointNote:'Полный адрес включает домен этого портала и ваш приватный токен.',
        statusLabel:'Статус подписки',
        statusNote:'Трафик, срок действия и доступность сервиса.',
        copied:'HTTPS-ссылка скопирована!',
        copyUnavailable:'Не удалось скопировать',
        qrUnavailable:'QR недоступен',
        qrLabel:'QR-код подписки',
        showLink:'Показать ссылку',
        hideLink:'Скрыть ссылку'
      };

  for (const el of document.querySelectorAll('[data-expiry]')) {
    const timestamp = Number(el.dataset.expiry);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      const date = new Date(timestamp);
      if (!Number.isNaN(date.getTime())) {
        el.textContent = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ru-RU', {dateStyle:'medium'}).format(date);
      }
    }
  }

  const input = document.getElementById('subscription-link');
  const card = document.getElementById('subscription-link-card');
  const display = document.getElementById('subscription-link-display');
  const label = document.getElementById('subscription-link-label');
  const note = document.getElementById('subscription-link-note');
  const brandNote = document.getElementById('subscription-brand-note');
  const endpointLabel = document.getElementById('subscription-endpoint-label');
  const endpointNote = document.getElementById('subscription-endpoint-note');
  const actionStatus = document.getElementById('subscription-action-status');
  const statusLabel = document.getElementById('subscription-status-label');
  const statusNote = document.getElementById('subscription-status-note');

  if (brandNote) brandNote.textContent = copy.brandNote;
  if (statusLabel) statusLabel.textContent = copy.statusLabel;
  if (statusNote) statusNote.textContent = copy.statusNote;
  if (endpointLabel) endpointLabel.textContent = copy.endpointLabel;
  if (endpointNote) endpointNote.textContent = copy.endpointNote;

  // One navigation contract for all visitor pages. Missing optional capabilities
  // never appear as dead tabs; inactive subscriptions keep an overview.
  const cabinetText = language === 'en' ? {
    kicker:'MY ACCOUNT / VPN ACCESS',
    tabs:['Overview','Connect','Applications','Devices','Support'],
    featureEyebrow:'YOUR ACCESS',featureHeading:'Everything you need, in one place.',
    featureNote:'Your connection and compatible apps are always close at hand.',
    start:'Set up connection',findApp:'Choose an app',
    stepsEyebrow:'GET STARTED',
    steps:['Choose your app','Add your subscription','Enable the connection'],
    notes:['A compatible client for your device','Using your link or QR code','Connect inside your app'],
    guideTitle:'Quick setup',guideDescription:'Open your app and import your access.',
    guideHint:'Your personal link grants access to the subscription. Never share it.',
    appsKicker:'CLIENT LIBRARY',appsHeading:'Connection apps',
    appsNote:'Find a compatible client for your platform.',
    appsSearch:'Search applications…',appsEmpty:'No applications match these filters.',
    devicesKicker:'YOUR DEVICES',devicesHeading:'Connected devices',
    devicesNote:'Your registered device count and allowance.',
    supportKicker:'HELP CENTER',supportHeading:'Need a hand?',
    supportNote:'Contact support using the configured channel.',
    all:'All',navLabel:'Account sections',platformLabel:'Filter by platform'
  } : {
    kicker:'МОЙ КАБИНЕТ / VPN ACCESS',
    tabs:['Обзор','Подключение','Приложения','Устройства','Поддержка'],
    featureEyebrow:'ВАШ ДОСТУП',featureHeading:'Всё для подключения. В одном месте.',
    featureNote:'Личные настройки и приложения всегда под рукой.',
    start:'Настроить подключение',findApp:'Выбрать приложение',
    stepsEyebrow:'КАК НАЧАТЬ',
    steps:['Выберите приложение','Добавьте подписку','Включите подключение'],
    notes:['Совместимый клиент для вашего устройства','По личной ссылке или QR-коду','Активируйте доступ в приложении'],
    guideTitle:'Быстрое подключение',guideDescription:'Откройте приложение и импортируйте ваш доступ.',
    guideHint:'Персональная ссылка открывает доступ к подписке. Не передавайте её посторонним.',
    appsKicker:'КАТАЛОГ',appsHeading:'Приложения для подключения',
    appsNote:'Выберите клиент для своей платформы.',
    appsSearch:'Найти приложение…',appsEmpty:'По вашему запросу приложений не найдено.',
    devicesKicker:'ВАШИ УСТРОЙСТВА',devicesHeading:'Подключённые устройства',
    devicesNote:'Количество зарегистрированных устройств и лимит.',
    supportKicker:'ПОМОЩЬ',supportHeading:'Нужна помощь?',
    supportNote:'Свяжитесь с поддержкой по указанному каналу.',
    all:'Все',navLabel:'Разделы личного кабинета',platformLabel:'Фильтр платформ'
  };
  const setCabinetCopy = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };
  setCabinetCopy('cabinet-kicker',cabinetText.kicker);
  ['overview','connect','apps','devices','support'].forEach((key,i) =>
    setCabinetCopy('cabinet-tab-'+key+'-label',cabinetText.tabs[i])
  );
  const phrases={
    'cabinet-feature-eyebrow':'featureEyebrow','cabinet-feature-heading':'featureHeading',
    'cabinet-feature-note':'featureNote','cabinet-start':'start','cabinet-find-app':'findApp',
    'cabinet-steps-eyebrow':'stepsEyebrow','cabinet-guide-title':'guideTitle',
    'cabinet-guide-description':'guideDescription','cabinet-guide-hint':'guideHint',
    'cabinet-apps-kicker':'appsKicker','cabinet-apps-heading':'appsHeading',
    'cabinet-apps-note':'appsNote','cabinet-apps-empty':'appsEmpty',
    'cabinet-devices-kicker':'devicesKicker','cabinet-devices-heading':'devicesHeading',
    'cabinet-devices-note':'devicesNote','cabinet-support-kicker':'supportKicker',
    'cabinet-support-heading':'supportHeading','cabinet-support-note':'supportNote'
  };
  Object.entries(phrases).forEach(([id,key])=>setCabinetCopy(id,cabinetText[key]));
  cabinetText.steps.forEach((v,i)=>setCabinetCopy(['cabinet-step-one','cabinet-step-two','cabinet-step-three'][i],v));
  cabinetText.notes.forEach((v,i)=>setCabinetCopy(['cabinet-step-one-note','cabinet-step-two-note','cabinet-step-three-note'][i],v));
  const appHeading = document.querySelector('.subscription-preview-apps>header');
  if (appHeading) setCabinetCopy('cabinet-apps-heading',appHeading.textContent);
  const search = document.getElementById('cabinet-app-search');
  if (search) {search.placeholder=cabinetText.appsSearch;search.setAttribute('aria-label',cabinetText.appsSearch)}
  setCabinetCopy('cabinet-apps-empty',cabinetText.appsEmpty);
  const allFilter=document.querySelector('[data-app-filter="all"]');
  if (allFilter) allFilter.textContent=cabinetText.all;
  document.getElementById('cabinet-platform-filters')?.setAttribute('aria-label',cabinetText.platformLabel);
  document.getElementById('cabinet-tabs')?.setAttribute('aria-label',cabinetText.navLabel);

  const tabButtons=[...document.querySelectorAll('[data-cabinet-tab]')];
  const tabPanels=[...document.querySelectorAll('[data-cabinet-panel]')];
  const available={
    overview:true,
    connect:!!input,
    apps:!!document.querySelector('.subscription-preview-app'),
    devices:!!document.getElementById('subscription-devices'),
    support:!!document.querySelector('.subscription-preview-support')
  };
  for(const button of tabButtons)button.hidden=!available[button.dataset.cabinetTab];
  for(const button of document.querySelectorAll('[data-cabinet-open]')) {
    button.hidden=!available[button.dataset.cabinetOpen];
  }
  function selectCabinetTab(key,{focus=false}={}) {
    const name=available[key]?key:'overview';
    tabButtons.forEach(button=>{
      const selected=button.dataset.cabinetTab===name;
      button.setAttribute('aria-selected',String(selected));
      button.tabIndex=selected?0:-1;
      if(selected&&focus)button.focus();
    });
    tabPanels.forEach(panel=>{panel.hidden=panel.dataset.cabinetPanel!==name});
    if(name==='devices'){
      const deviceSummary=document.getElementById('subscription-devices');
      if(deviceSummary)deviceSummary.hidden=false;
    }
  }
  const tabList=document.getElementById('cabinet-tabs');
  tabList?.addEventListener('click',event=>{
    const button=event.target.closest('[data-cabinet-tab]');
    if(button&&!button.hidden)selectCabinetTab(button.dataset.cabinetTab);
  });
  tabList?.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const visible=tabButtons.filter(button=>!button.hidden);
    const index=visible.indexOf(document.activeElement);
    if(index<0)return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?visible.length-1:
      (index+(event.key==='ArrowRight'?1:-1)+visible.length)%visible.length;
    selectCabinetTab(visible[next].dataset.cabinetTab,{focus:true});
  });
  document.querySelectorAll('[data-cabinet-open]').forEach(button=>{
    button.addEventListener('click',()=>selectCabinetTab(button.dataset.cabinetOpen,{focus:true}));
  });
  selectCabinetTab('overview');

  let selectedPlatform='all';
  const appTiles=[...document.querySelectorAll('.subscription-preview-app')];
  const searchApps=()=>{
    const needle=(search?.value||'').trim().toLocaleLowerCase(language);
    let count=0;
    appTiles.forEach(tile=>{
      const platform=tile.querySelector('small')?.textContent?.toLocaleLowerCase('en')||'';
      const name=tile.querySelector('b')?.textContent?.toLocaleLowerCase(language)||'';
      const matchesPlatform=selectedPlatform==='all'||platform.includes(selectedPlatform);
      const visible=matchesPlatform&&(!needle||name.includes(needle)||platform.includes(needle));
      tile.hidden=!visible;
      if(visible)count++;
    });
    const empty=document.getElementById('cabinet-apps-empty');
    if(empty)empty.hidden=count>0;
  };
  document.getElementById('cabinet-platform-filters')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-app-filter]');
    if(!button)return;
    selectedPlatform=button.dataset.appFilter;
    document.querySelectorAll('[data-app-filter]').forEach(item=>{
      item.setAttribute('aria-pressed',String(item===button));
    });
    searchApps();
  });
  search?.addEventListener('input',searchApps);

  if (!input) return;

  function absoluteSubscriptionUrl() {
    const raw = String(input.value || '').trim();
    if (!raw) throw new Error('Subscription link is empty');
    let resolved;
    if (/^https:\/\//i.test(raw)) {
      resolved = new URL(raw);
    } else if (raw.startsWith('/')) {
      resolved = new URL(raw, window.location.origin);
    } else {
      throw new Error('Subscription link must be HTTPS or an absolute path');
    }
    if (!['https:','http:'].includes(resolved.protocol)) {
      throw new Error('Unsupported subscription protocol');
    }
    return resolved.href;
  }

  function compactSubscriptionUrl(value) {
    const url = new URL(value);
    const parts = url.pathname.split('/');
    const token = parts.at(-1) || '';
    if (token.length > 20) parts[parts.length - 1] = token.slice(0, 7) + '…' + token.slice(-6);
    return url.origin + parts.join('/') + url.search;
  }

  let subscriptionUrl;
  try {
    subscriptionUrl = absoluteSubscriptionUrl();
    // Keep every action on one canonical value. A relative backend URL is
    // upgraded to the origin the visitor actually used to open the portal.
    input.value = subscriptionUrl;
    if (card && display) {
      // A bearer link is a secret: only expose it after an explicit visitor action.
      card.hidden = true;
      if (label) label.textContent = copy.linkLabel;
      if (note) note.textContent = copy.linkNote;
      display.textContent = compactSubscriptionUrl(subscriptionUrl);
    }
  } catch {
    if (card) card.hidden = true;
    return;
  }

  function setActionStatus(message) {
    if (actionStatus) actionStatus.textContent = message;
  }

  function flashButton(button, message) {
    if (!button) return;
    if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent || '';
    button.textContent = message;
    window.setTimeout(() => {
      if (button.isConnected && button.dataset.defaultLabel) button.textContent = button.dataset.defaultLabel;
    }, 1800);
  }

  async function copySubscription(button) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(subscriptionUrl);
      copied = true;
    } catch {
      const temporary = document.createElement('textarea');
      temporary.value = subscriptionUrl;
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      temporary.setAttribute('aria-hidden', 'true');
      document.body.append(temporary);
      temporary.select();
      copied = document.execCommand('copy');
      temporary.remove();
    }
    const message = copied ? copy.copied : copy.copyUnavailable;
    flashButton(button, message);
    setActionStatus(message);
  }

  document.getElementById('connect-link')?.addEventListener('click', event => {
    void copySubscription(event.currentTarget);
  });
  document.getElementById('copy-link')?.addEventListener('click', event => {
    void copySubscription(event.currentTarget);
  });

  document.getElementById('toggle-link')?.addEventListener('click', event => {
    if (!card) return;
    card.hidden = !card.hidden;
    const expanded = !card.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(expanded));
    event.currentTarget.textContent = expanded ? copy.hideLink : copy.showLink;
  });

  function showQr(target) {
    if (target.dataset.ready === 'yes') return;
    const Qr = window.qrcodegen?.QrCode;
    if (!Qr) throw new Error('QR library is unavailable');
    const qr = Qr.encodeText(subscriptionUrl, Qr.Ecc.MEDIUM);
    const quiet = 4;
    const canvas = qr.size + quiet * 2;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + canvas + ' ' + canvas);
    svg.setAttribute('role', 'img');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('aria-label', copy.qrLabel);
    const base = document.createElementNS(ns, 'rect');
    base.setAttribute('width', String(canvas));
    base.setAttribute('height', String(canvas));
    base.setAttribute('fill', '#fff');
    svg.append(base);
    let pathData = '';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) pathData += 'M' + (x + quiet) + ',' + (y + quiet) + 'h1v1h-1z';
      }
    }
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', '#101923');
    path.setAttribute('d', pathData);
    svg.append(path);
    target.replaceChildren(svg);
    target.dataset.ready = 'yes';
  }

  document.getElementById('toggle-qr')?.addEventListener('click', event => {
    const target = document.getElementById('subscription-qr');
    if (!target) return;
    const opening = target.hidden;
    if (opening) {
      try { showQr(target); }
      catch {
        flashButton(event.currentTarget, copy.qrUnavailable);
        setActionStatus(copy.qrUnavailable);
        return;
      }
    }
    target.hidden = !opening;
    event.currentTarget.setAttribute('aria-expanded', String(opening));
  });

  document.getElementById('toggle-devices')?.addEventListener('click', event => {
    selectCabinetTab('devices',{focus:true});
    event.currentTarget.setAttribute('aria-expanded','true');
  });
})();
