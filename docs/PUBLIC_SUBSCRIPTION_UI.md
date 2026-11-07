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

Traffic now uses a shared SVG donut in the live portal and Studio. Bearer resolution
precedes a user-scoped SQL read of authenticated per-node counters; only display
names and GiB enter an HTML-escaped data attribute. No admin API is exposed.
Hover/focus previews a server; click/Enter selects it; Escape or All servers resets.
Touch users can choose the matching legend button. Empty counters show no segments;
legacy unassigned consumption is explicitly unattributed. Link reveal is removed
from the live UI; copy and QR still share the canonical bearer URL.
