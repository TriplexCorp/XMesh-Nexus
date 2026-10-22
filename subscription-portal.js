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

  document.getElementById('copy-link')?.addEventListener('click', async event => {
    try {
      await navigator.clipboard.writeText(input.value);
      event.currentTarget.textContent = language === 'en' ? 'Copied!' : 'Скопировано!';
    } catch {
      // Old browsers may need the native text selection fallback.
      const temporary = document.createElement('textarea');
      temporary.value = input.value;
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      document.body.append(temporary);
      temporary.select();
      const copied = document.execCommand('copy');
      temporary.remove();
      event.currentTarget.textContent = copied
        ? (language === 'en' ? 'Copied!' : 'Скопировано!')
        : (language === 'en' ? 'Copy not available' : 'Не удалось скопировать');
    }
  });

  function showQr(target) {
    if (target.dataset.ready === 'yes') return;
    if (!window.qrgen?.QrCode) throw new Error('QR library is unavailable');
    const qr = window.qrgen.QrCode.encodeText(input.value, window.qrgen.QrCode.Ecc.MEDIUM);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + qr.size + ' ' + qr.size);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', language === 'en' ? 'Subscription QR code' : 'QR-код подписки');
    const base = document.createElementNS(ns, 'rect');
    base.setAttribute('width', String(qr.size));
    base.setAttribute('height', String(qr.size));
    base.setAttribute('fill', '#fff');
    svg.append(base);
    let pathData = '';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) pathData += 'M' + x + ',' + y + 'h1v1h-1z';
      }
    }
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', '#101923');
    path.setAttribute('d', pathData);
    svg.append(path);
    target.append(svg);
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
