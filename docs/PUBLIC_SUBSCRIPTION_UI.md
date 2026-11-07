# Single-page subscription setup

One page shows status/usage, compatible applications, the private-link copy action,
and optional device/support information. There are no tabs, overview CTAs or
separate instructions repeating these steps. The browser suggests its platform
locally when compatible apps exist; visitors can select any other platform.

One copy action uses the canonical URL. Link reveal and QR remain explicit.
Inactive subscriptions hide setup controls. Studio uses the same one-page markup
and public stylesheet. Branding, materials, fonts, radius and visibility settings
remain configurable. The usage meter uses actual server-provided percentages;
unlimited plans have no percentage graphic. Reduced motion is respected.

Run `node scripts/test-public-subscription-browser.cjs` to verify the real template
and assets with disposable data across phones/tablets/desktops, RU/EN, optional
capabilities, copy/QR, contrast, keyboard order and reduced motion.
