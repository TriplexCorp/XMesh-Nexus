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
        qrLabel:'Subscription QR code'
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
        qrLabel:'QR-код подписки'
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
      card.hidden = false;
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
    const target = document.getElementById('subscription-devices');
    if (!target) return;
    target.hidden = !target.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!target.hidden));
  });
})();
