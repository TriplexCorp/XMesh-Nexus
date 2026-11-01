'use strict';
// The live customer portal and SUBSCRIPTION STUDIO share the same
// subscription-preview component and design tokens.
(() => {
  const language = document.documentElement.lang === 'en' ? 'en' : 'ru';
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
  if (!input) return;

  async function copySubscription(button) {
    try {
      await navigator.clipboard.writeText(input.value);
      button.textContent = language === 'en' ? 'HTTPS link copied!' : 'HTTPS-ссылка скопирована!';
    } catch {
      const temporary = document.createElement('textarea');
      temporary.value = input.value;
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      document.body.append(temporary);
      temporary.select();
      const copied = document.execCommand('copy');
      temporary.remove();
      button.textContent = copied
        ? (language === 'en' ? 'HTTPS link copied!' : 'HTTPS-ссылка скопирована!')
        : (language === 'en' ? 'Copy not available' : 'Не удалось скопировать');
    }
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
    const value = String(input.value || '').trim();
    if (!value) throw new Error('Subscription link is empty');
    const qr = Qr.encodeText(value, Qr.Ecc.MEDIUM);
    const quiet = 4;
    const canvas = qr.size + quiet * 2;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + canvas + ' ' + canvas);
    svg.setAttribute('role', 'img');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('aria-label', language === 'en' ? 'Subscription QR code' : 'QR-код подписки');
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
      catch { event.currentTarget.textContent = language === 'en' ? 'QR unavailable' : 'QR недоступен'; return; }
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
