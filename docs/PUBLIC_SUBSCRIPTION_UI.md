# Public subscription experience 2.0

The primary task is connecting a device. A broad connection card sits beside a
combined expiry and traffic rail. Below it, real shortcuts open instructions and
registered-device information or navigate to usage and support. Quick setup keeps
platform selection on the page and opens the same application guide. Phones show
connection before the combined account rail. Branding, colors, fonts, radius,
materials, application visibility, custom clients and configured URLs remain owned
by Subscription Studio. The authenticated panel remains isolated from public CSS.

The browser uses the existing server-rendered template; there is no new SPA or
public data API. Studio and the public portal share `subscription-experience.js`,
`subscription-traffic.js` and the public stylesheet. Configured CTA text belongs to
the primary setup action; the secondary action always describes copying.

## Connection flow

Connect VPN opens a native dialog with an automatically suggested platform, a
manual platform override and the configured application catalog. Selecting an app
shows its installation/import actions before detailed instructions. Platform
instructions explain the relevant system permission, without claiming that the
website can establish or detect the VPN connection itself.

Only the documented Happ `happ://add/<url>` action is offered for native app
launch. Other applications use manual import with one existing bearer token and an
allowlisted `?format=` override in the copied URL. Configured install URLs
take precedence; verified publisher pages are fallbacks for built-in Happ,
v2rayN, v2rayNG and Hiddify. Custom names do not acquire an app URI scheme merely
by resembling a known app name.

The browser cannot reliably detect whether an application is installed. The page
therefore never reports a successful app launch: install and copy alternatives
remain visible. Native dialog support falls back to inline content on older
browsers. Dialogs have accessible names, Escape handling, visible focus, focus
restoration and locally generated QR codes with a four-module quiet zone.

## Data and states

Bearer resolution precedes the user-scoped SQL read of authenticated Xray counters.
Only display names and measured GiB enter an HTML-escaped attribute. Names are
rendered with textContent. Missing aliases use public ordinals, not internal IDs.
The donut shows distribution by server, never the percentage of a quota consumed.
Unattributed historical consumption remains explicitly unattributed. Upload and
download appear only when both directions are measured; they are labeled as
measured server traffic if a legacy unassigned baseline also exists.

Unlimited plans show an amount and an unlimited label without a fictitious quota
progress bar. Real server distribution is shown in the lower analytics card. Finite plans show the real allowance and remaining amount.
No history, speed, plan name or statistics period is invented. Device counts are
registered slots, not a count of live VPN connections; absent tracking is distinct
from zero. Missing/invalid expiry is distinct from an explicit zero (unlimited).

Expired, quota-exhausted, disabled and waiting subscriptions have distinct copy.
Backend access decisions remain authoritative. A waiting account that cannot
connect never gets a misleading ready message. HTML backend failures return HTTP
503 with retry and no fake zero usage; client feed errors retain JSON behavior.
Server rendering supplies real initial values, so there is no artificial loading
delay or client fetch requiring a decorative skeleton.

## Content negotiation and security

`subscription_user_agent.rs` determines HTML or a client feed from User-Agent
and the explicit `?format=` override. The unchanged canonical link and bearer token
can deliver Xray JSON (`xray`, native Happ default), plaintext VLESS/VMess/Trojan/classic Shadowsocks URI
(`links`), standard Base64 encoded URI lines (`base64`), Mihomo YAML
(`mihomo`), or upstream sing-box JSON (`singbox`). Invalid formats fail with
HTTP 400. Unsupported credentials/transports in alternate representations are
never downgraded: they are skipped with `X-Subscription-Skipped` or yield 422 when
none can be exported, rather than silently route through DIRECT. In particular
upstream sing-box cannot use Xray XHTTP, and Xray-specific VLESS encryption
may require the native feed.

The original Xray feed builder still handles per-user routing and SMART
balancers unchanged; the other formats provide a portable selector of
independently publishable endpoints. Existing signed credentials, device
enforcement, Host allowlisting, public subscriptions and accounting remain
authoritative. Browser and User-Agent matrices are covered by Rust and
disposable real-API tests, but physical application versions and exotic
transports require live interoperability verification.

Copy and QR use the same canonical bearer URL. No external QR or redirect service,
analytics, link shortener or launch-detection tracking is used. Clipboard denial
and fallback exceptions clean up temporary DOM fields and report failure safely.

## Validation and limits

- Browser suite: 37 viewport/locale/state cases at 320, 375, 390, 430, 768, 1024, 1440 and 1920 px; RU/EN; dark/light;
  copy, QR, focus, platform/app selection, terminal/waiting states, unlimited,
  empty traffic, hidden capabilities and reduced motion.
- Rust: missing/unlimited/waiting expiry and browser/client Accept matrices, plus
  the existing native feed and authorization tests.
- Real API regression: browser HTML and nine VPN User-Agent JSON responses from
  the same disposable bearer URL.
- Real data plane: `scripts/test-subscription-loopback.cjs` validates generated
  client JSON with pinned Xray v26.10.31, transfers HTTP through VLESS/TLS, then
  proves that stopping the server breaks the tunnel. The temporary server permits
  only the local test destination, and pins its ephemeral leaf certificate.
  Endpoint/routing substitutions are confined to the isolated test.

Physical iOS/Android devices and installed third-party GUI apps are not present in
this environment. Browser emulation and a real Xray tunnel do not claim to test
those apps' OS prompts or every protocol/transport combination. No production node,
agent or user credentials are used for testing.

## Research references

- [Remnawave subscription page](https://github.com/remnawave/subscription-page),
  [panel documentation](https://docs.rw/learn-en/quick-start/): configurable
  applications and separation of browser presentation from client delivery.
- [Orion](https://github.com/legiz-ru/Orion): platform selection and progressive
  installation instructions. Its MIT license and Remnawave's AGPL were inspected;
  no implementation code or assets were copied.
- [Happ setup documentation](https://www.happ.su/main/faq/adding-configuration-subscription)
  and [Remnawave's Happ template](https://github.com/remnawave/templates/blob/main/by-unknown/subscription-page/happ-only.json)
  document import/clipboard/QR behavior and the Happ URI shape.
- [Hiddify URI documentation](https://hiddify.com/app/URL-Scheme/): the existence of
  an import scheme alone does not establish support for this repository's feed.
- [Linear](https://linear.app), [Vercel](https://vercel.com),
  [Stripe](https://stripe.com): visual references for hierarchy, restraint and
  numerical clarity, not sources of copied branding or layout code.

## Dashboard reference follow-up

The new composition follows the supplied visual reference: framed header, accent
connection card, combined account rail, functional shortcut bar, platform tiles
and a support banner. Decorative waves are local inline SVG and inherit the owner
accent; no external images or tracking are added. Light/dark, material and radius
settings remain supported in both the portal and Studio.

The reference's Pro tier, priority benefits, auto-renew switch, recommended servers
and latency values have no authoritative source in this portal and are not
fabricated. The lower-right panel explicitly shows measured usage by server.
Device information describes registered slots, not active VPN sessions.
The expired/paused/quota-exhausted states retain this composition without enabling
connection controls.

[Desktop](checkpoints/subscription-dashboard-reference/desktop.png) ·
[Mobile](checkpoints/subscription-dashboard-reference/mobile.png)
