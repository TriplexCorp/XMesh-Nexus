# Public subscription page

The customer portal prioritizes getting connected: a visible setup action opens
the application catalog, followed by adding the private subscription link to the
installed app. Existing app users can go directly to the link. Copy feedback
confirms a clipboard action; it never claims that the VPN is connected.

The live template and Subscription Studio's isolated ShadowRoot preview use the
same public stylesheet, layout, wording and actions. Admin branding, fonts, card
materials, radius, app catalog/list mode and visibility settings still apply.
With the app catalog disabled, setup opens the connection tools directly.

Body copy uses readable sizes and controls have at least 44 px touch targets.
Container queries handle narrow public pages and Studio previews. Tabs support
keyboard navigation. Subtle entrance/progress transitions respect reduced motion.
Accent button text switches between light/dark ink for custom brand colors.

The traffic meter uses the percentage already provided by the server. Unlimited
subscriptions show their actual usage without a percentage meter; no historical
traffic, connection quality or online status is invented. Private links and QR
codes remain hidden until requested.

`node scripts/test-public-subscription-browser.cjs` serves the real template and
assets with disposable data, then exercises small phones through large desktops,
RU/EN, copy/QR, app filters, keyboard tabs, disabled capabilities, expiry/usage,
custom-color contrast and reduced motion. CI retains screenshots with the other
browser artifacts. This fixture test complements existing backend subscription
and security tests; it does not contact a production subscription endpoint.
