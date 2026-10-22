'use strict';
// Standalone subscription portal: no external scripts, no telemetry,
// no secrets in localStorage, URLs or network requests other than the feed.
(() => {
  const input = document.getElementById('subscription-link');
  const button = document.getElementById('copy-link');
  const qrTarget = document.getElementById('subscription-qr');
  if (!input) return;
  if (button) button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      button.textContent = document.documentElement.lang === 'en' ? 'Copied!' : 'Скопировано!';
    } catch {
      input.focus();
      input.select();
      button.textContent = document.documentElement.lang === 'en' ? 'Select and copy the link' : 'Выделите и скопируйте ссылку';
    }
  });
  if (!qrTarget || !window.qrgen?.QrCode) return;
  try {
    const qr = window.qrgen.QrCode.encodeText(input.value, window.qrgen.QrCode.Ecc.MEDIUM);
    const size = qr.size;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', document.documentElement.lang === 'en' ? 'Subscription QR code' : 'QR-код подписки');
    const background = document.createElementNS(ns, 'rect');
    background.setAttribute('width', String(size));
    background.setAttribute('height', String(size));
    background.setAttribute('fill', 'white');
    svg.append(background);
    let d = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.getModule(x, y)) d += 'M' + x + ',' + y + 'h1v1h-1z';
      }
    }
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#101923');
    svg.append(path);
    qrTarget.append(svg);
  } catch {
    qrTarget.hidden = true;
  }
  document.querySelectorAll('[data-expiry]').forEach(el => {
    const ms = Number(el.dataset.expiry);
    if (Number.isFinite(ms) && ms > 0) {
      el.textContent = new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en-GB' : 'ru-RU', {dateStyle:'medium'}).format(new Date(ms));
    }
  });
})();
