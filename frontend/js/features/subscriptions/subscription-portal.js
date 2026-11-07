'use strict';
// The live customer portal and SUBSCRIPTION STUDIO share the same
// subscription-preview component and design tokens.
(() => {
  function actionInk(color){
    const rgb=String(color).trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if(!rgb)return '#101820';
    const [r,g,b]=rgb.slice(1).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const luminance=.2126*r+.7152*g+.0722*b;
    return 1.05/(luminance+.05)>(luminance+.05)/.0587?'#ffffff':'#101820';
  }
  const previewRoot=document.querySelector('.subscription-preview');
  if(previewRoot)previewRoot.style.setProperty('--portal-action-ink',actionInk(getComputedStyle(previewRoot).getPropertyValue('--portal-accent')));
  const language = document.documentElement.lang === 'en' ? 'en' : 'ru';
  document.querySelector('.subscription-preview-languages')?.setAttribute('aria-label',language==='en'?'Language':'Язык');
  const copy = language === 'en'
    ? {
        brandNote:'Your subscription',copyAction:'Copy',trafficLabel:'Data used',
        linkLabel:'Your subscription link',
        linkNote:'Paste this link into your connection app. Keep it private.',
        endpointLabel:'Connect',
        endpointNote:'In your VPN app, choose “Add subscription” or scan the QR code.',
        statusLabel:'Subscription status',
        statusNote:'Traffic, expiry and service availability.',
        copied:'Copied',
        copyUnavailable:'Copy not available',
        qrUnavailable:'QR unavailable',
        qrLabel:'Subscription QR code',
        showLink:'Show private link',
        hideLink:'Hide private link'
      }
    : {
        brandNote:'Ваша подписка',copyAction:'Копировать',trafficLabel:'Использовано трафика',
        linkLabel:'Ссылка на подписку',
        linkNote:'Добавьте ссылку в приложение для подключения. Не передавайте её посторонним.',
        endpointLabel:'Подключение',
        endpointNote:'В VPN-приложении выберите «Добавить подписку» или отсканируйте QR-код.',
        statusLabel:'Статус подписки',
        statusNote:'Трафик, срок действия и доступность сервиса.',
        copied:'Скопировано',
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

  const dashboard = language === 'en' ? {
    'portal-quickstart-title':'Connect in three steps',
    'portal-guide-copy':'Copy your link above',
    'portal-guide-app':'Open your VPN app',
    'portal-guide-import':'Import the link',
    'portal-guide-finish':'Once imported, turn on the connection in your app.',
    'portal-app-disclosure-label':'Need to install an app?'
  } : {
    'portal-quickstart-title':'Подключение в три шага',
    'portal-guide-copy':'Скопируйте ссылку выше',
    'portal-guide-app':'Откройте VPN-приложение',
    'portal-guide-import':'Добавьте подписку по ссылке',
    'portal-guide-finish':'После добавления включите подключение в приложении.',
    'portal-app-disclosure-label':'Нужно установить приложение?'
  };
  Object.entries(dashboard).forEach(([id,text])=>{const el=document.getElementById(id);if(el)el.textContent=text});

  document.querySelectorAll('[data-subscription-traffic]').forEach(metric=>{
    let servers=[];
    try{servers=JSON.parse(metric.dataset.trafficServers||'[]')}catch{ /* Keep factual total if breakdown is unavailable. */ }
    window.XMeshSubscriptionTraffic?.mount(metric,{used:Number(metric.dataset.usedGib)||0,limit:Number(metric.dataset.limitGib)||0,servers,language});
  });
  document.getElementById('toggle-link')?.remove();
  document.getElementById('subscription-link-card')?.remove();
  const info=document.querySelector('.subscription-public-info-panel');
  if(info)info.hidden=!document.querySelector('[data-subscription-metrics]');
  const primaryCopy=document.getElementById('connect-link');
  if(primaryCopy&&['Connect','Подключиться'].includes(primaryCopy.textContent.trim()))primaryCopy.textContent=copy.copyAction;
  const qrButton=document.getElementById('toggle-qr');
  if(qrButton){qrButton.textContent=language==='en'?'QR code':'QR-код';document.querySelector('.subscription-public-primary-action')?.append(qrButton);}

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
    featureEyebrow:'YOUR ACCESS',featureHeading:'Let’s connect your device',
    featureNote:'A few simple steps. Start by choosing an app for your phone or computer.',
    start:'Connect a device',findApp:'I already have an app',
    stepsEyebrow:'How it works',
    steps:['Choose your app','Add your subscription','Enable the connection'],
    notes:['Install an app for your phone or computer','Copy your link from this page into the app','Tap Connect in the app. You’re ready to go.'],
    guideTitle:'What to do next',guideDescription:'After adding the subscription, choose a server in your app and tap Connect. Return here whenever you need your link.',
    guideHint:'Your personal link grants access to the subscription. Never share it.',
    appsKicker:'CLIENT LIBRARY',appsHeading:'Choose an app',
    appsNote:'Choose your device. Tap an app to install it.',
    appsSearch:'Search applications…',appsEmpty:'No applications match these filters.',
    devicesKicker:'YOUR DEVICES',devicesHeading:'Connected devices',
    devicesNote:'Your registered device count and allowance.',
    supportKicker:'HELP CENTER',supportHeading:'Need a hand?',
    supportNote:'If something isn’t working, contact support. They can help you get connected.',
    nextNote:'Install an app, then return to this page.',next:'Next: add subscription',all:'All',navLabel:'Account sections',platformLabel:'Filter by platform'
  } : {
    kicker:'МОЙ КАБИНЕТ / VPN ACCESS',
    tabs:['Обзор','Подключение','Приложения','Устройства','Поддержка'],
    featureEyebrow:'ВАШ ДОСТУП',featureHeading:'Подключим ваше устройство',
    featureNote:'Несколько простых шагов. Начните с приложения для телефона или компьютера.',
    start:'Подключить устройство',findApp:'Приложение уже есть',
    stepsEyebrow:'Как подключиться',
    steps:['Выберите приложение','Добавьте подписку','Включите подключение'],
    notes:['Установите приложение на телефон или компьютер','Скопируйте ссылку с этой страницы в приложение','Нажмите кнопку подключения в приложении. Готово!'],
    guideTitle:'Что делать дальше',guideDescription:'После добавления подписки выберите сервер в приложении и включите подключение. Ссылка всегда будет на этой странице.',
    guideHint:'Персональная ссылка открывает доступ к подписке. Не передавайте её посторонним.',
    appsKicker:'КАТАЛОГ',appsHeading:'Выберите приложение',
    appsNote:'Выберите устройство. Нажмите на приложение, чтобы установить его.',
    appsSearch:'Найти приложение…',appsEmpty:'По вашему запросу приложений не найдено.',
    devicesKicker:'ВАШИ УСТРОЙСТВА',devicesHeading:'Подключённые устройства',
    devicesNote:'Количество зарегистрированных устройств и лимит.',
    supportKicker:'ПОМОЩЬ',supportHeading:'Нужна помощь?',
    supportNote:'Если что-то не получается, напишите в поддержку. Вам помогут подключиться.',
    nextNote:'Установите приложение и вернитесь на эту страницу.',next:'Далее: добавить подписку',all:'Все',navLabel:'Разделы личного кабинета',platformLabel:'Фильтр платформ'
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
    'portal-app-next-note':'nextNote','portal-app-next':'next','cabinet-feature-heading':'featureHeading',
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
  if (appHeading) appHeading.hidden=true;
  const search = document.getElementById('cabinet-app-search');
  if (search) {search.placeholder=cabinetText.appsSearch;search.setAttribute('aria-label',cabinetText.appsSearch)}
  setCabinetCopy('cabinet-apps-empty',cabinetText.appsEmpty);
  const allFilter=document.querySelector('[data-app-filter="all"]');
  if (allFilter) allFilter.textContent=cabinetText.all;
  document.getElementById('cabinet-platform-filters')?.setAttribute('aria-label',cabinetText.platformLabel);
  document.getElementById('cabinet-tabs')?.setAttribute('aria-label',cabinetText.navLabel);

  // Every available task stays on the same page; optional features disappear.
  const available={connect:!!input,apps:!!input&&!!document.querySelector('.subscription-preview-app'),devices:!!document.getElementById('subscription-devices'),support:!!document.querySelector('.subscription-preview-support')};
  document.querySelectorAll('[data-setup-section]').forEach(section=>{section.hidden=!available[section.dataset.setupSection]});
  const devices=document.getElementById('subscription-devices');if(devices)devices.hidden=false;
  document.getElementById('copy-link')?.remove();
  document.getElementById('toggle-devices')?.remove();
  const heading=document.querySelector('.subscription-preview-hero h1');
  if(heading&&/^(Подписка (не)?активна|Subscription (in)?active)$/i.test(heading.textContent.trim()))heading.textContent=copy.brandNote;
  const guide=document.querySelector('.portal-quickstart');if(guide)guide.hidden=!available.connect;
  const description=document.querySelector('.subscription-preview-hero p');
  if(description&&['Настройки подключения и информация о подписке.','Connection setup and subscription information.'].includes(description.textContent.trim()))description.hidden=true;
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
  const ua=navigator.userAgent;
  const detected=/iphone|ipad|ipod/i.test(ua)?'ios':/android/i.test(ua)?'android':/windows/i.test(ua)?'windows':/macintosh|mac os/i.test(ua)?'macos':/linux/i.test(ua)?'linux':'all';
  if(appTiles.some(tile=>(tile.querySelector('small')?.textContent||'').toLowerCase().includes(detected))){
    selectedPlatform=detected;
    document.querySelectorAll('[data-app-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.appFilter===detected)));
    searchApps();
  }
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
    button.setAttribute('aria-live','polite');
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
    setActionStatus(copied ? '' : message);
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
    target.setAttribute('aria-label',copy.qrLabel);
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
    document.querySelector('[data-setup-section="devices"]')?.scrollIntoView({block:'nearest'});
    event.currentTarget.setAttribute('aria-expanded','true');
  });
})();
