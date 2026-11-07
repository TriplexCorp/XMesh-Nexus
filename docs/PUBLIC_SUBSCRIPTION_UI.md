# Public subscription account

The single page prioritizes four account blocks: identity/status, actual usage,
expiry, and access management. On desktop they form a two-column dashboard;
on phones, copy and QR follow the status immediately. A single import hint lives beside the copy/QR actions; there is no repeated step guide. The application catalog is a native collapsed disclosure,
with automatic platform detection and manual filters. There are no section tabs.

Used/remaining values come from numeric server-rendered GiB attributes. Remaining
quota is clamped at zero, and finite-plan percentages at 100. Unlimited plans show
no invented percentage or expiry progress. The combined server-rendered usage
label remains a fallback when JavaScript is unavailable.

One copy action and QR share the canonical URL; revealing the private URL requires
an explicit action. Inactive subscriptions hide setup and the import guide.
Optional traffic, expiry, applications, devices and support respect Studio settings.
Studio previews the same composition and stylesheet, including owner-selected
branding, colors, fonts, radius and materials. Motion respects reduced-motion.

`node scripts/test-public-subscription-browser.cjs` checks the real template and
assets with disposable data at 320/390/768/1440/1920 px in RU/EN and dark/light,
including ordering, collapsed apps, usage, copy/QR, keyboard and visibility states.
