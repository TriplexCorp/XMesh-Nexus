# XMesh Nexus — Product Guide

This is the canonical product-level guide to what XMesh Nexus does. It complements the implementation-specific documents in `docs/` and is intentionally broader than the README.

## What XMesh Nexus is

XMesh Nexus is a self-hosted control plane for operating Xray-based VPN infrastructure across multiple VPS nodes.

The product joins four jobs that are usually split across scripts, SSH sessions and independent dashboards:

1. **Infrastructure control** — nodes, versions, runtime state, metrics and operational actions.
2. **Xray configuration** — profiles, transports, TLS/REALITY, routing, GeoData, FinalMask and advanced JSON.
3. **Subscriber management** — users, squads, limits, expiry, subscriptions and client configuration.
4. **Security and operations** — RBAC, MFA, sessions, signed node identity, updates, audit boundaries and the v6 strict-PQ control plane.

XMesh Nexus does not proxy user VPN traffic through the panel. Xray-core on managed nodes is the data plane.

---

## Functional map

| Area | What the panel provides | Operational note |
| --- | --- | --- |
| **Dashboard** | Infrastructure overview, node/user state and operational signals | Displayed state depends on real API/agent telemetry |
| **Nodes** | Enrollment, bootstrap, health, Agent/Xray versions, configuration assignment, restart/update operations, Xray update, metrics, network traffic, quotas and diagnostics | Queued operations must be verified from runtime state |
| **Users** | CRUD, status, expiry, traffic limits, access state, detailed card, subscription access and individual fingerprint override and personal client routing rules (inheriting global templates by default) | Per-user fingerprint can inherit from host |
| **Squads** | Grouping/assignment of users and policy-oriented administration | Exact behavior depends on current panel policy model |
| **Hosts / endpoints** | Public endpoint metadata, domain/address/port, TLS/REALITY/client parameters, fingerprint and mapping to infrastructure | Host fingerprint defaults to Chrome |
| **XRAY STUDIO** | Composer, form editor, manual JSON, diagnostics, profile assignment, transports, security, XHTTP, FinalMask, routing-related config and advanced settings | Explicit `security` is authoritative |
| **XHTTP constructor** | Mode presets, path/host, headers, padding, session/sequence placement, uplink layout, tuning, XMUX, H2/download settings and randomized profile generation | Built from current SplitHTTP/XHTTP schema; custom JSON still available |
| **FinalMask** | Server/client mask layers, compatibility filtering, cryptographic secret generators and randomized basic presets | Compatibility differs by transport and client |
| **SUBSCRIPTION STUDIO** | Public subscription portal, native Xray JSON, branding, RU/EN content, QR/copy, support links, client apps and subscription behavior | Not every Xray/client combination can be projected universally |
| **Routing** | Managed node routing plus client-routing projection | GeoData and transport support matter |
| **GeoData** | GeoIP/GeoSite source configuration and operational visibility | External sources remain operator dependencies |
| **Statistics** | Node/system metrics, network RX/TX, Xray/user/inbound traffic and historical observations | Depends on reporting Agents and Xray StatsService |
| **Security** | RBAC, observer least privilege, TOTP MFA, recovery, sessions, throttling, security boundaries and signed node identity | Do not bypass runtime verification for convenience |
| **Updates** | Panel update workflow, Agent update, Xray update and version reporting | Updates are authorized operations, not arbitrary remote shell |
| **XSP-v2 / v6** | Dedicated strict-PQ control-plane product path and bounded activation evidence | Per-node activation remains evidence-bound |

---

## 1. Node management

### Enrollment and bootstrap

The panel provides node onboarding instead of requiring an operator to assemble the Agent stack manually. The supported bootstrap flow installs/updates the required node-side components and establishes a distinct node identity.

Each simultaneously operating VPS should have its own Node record and identity. Reusing one identity for multiple concurrently active machines destroys trustworthy runtime attribution and must be avoided.

### Runtime visibility

Node views can expose data such as:

- online/offline presence;
- Agent version and update state;
- actual Xray version/status;
- desired vs applied configuration revision;
- profile attestation/application status where available;
- system and network telemetry;
- TLS/certificate and GeoData-related status where reported;
- operation errors and diagnostic state.

### Operational actions

Depending on the installed Agent/runtime, operators can request actions such as:

- synchronize/apply configuration;
- restart managed runtime;
- update Agent;
- update Xray-core;
- rotate/update relevant operational metadata;
- reset traffic counters through guarded operations;
- enforce node quota/cutoff behavior.

An accepted command is only confirmation that the control plane accepted/queued the request. The result must be checked against fresh Agent/runtime evidence.

### Fleet UX

The node area includes search/pagination and density/responsive behavior intended to remain usable beyond a handful of servers.

See:

- `AUTONOMOUS_NODES.md`
- `PANEL_UPDATE_AND_TELEMETRY.md`
- `SECURITY_NODE_IDENTITY.md`
- `NODE_ROUTING.md`

---

## 2. Users, squads and access

The control plane stores user business state and translates it into Xray/subscription behavior.

Typical user controls include:

- create/edit/delete;
- enabled/disabled state;
- expiry date/time;
- traffic quota and traffic accounting;
- squad/group assignment;
- subscription/token access;
- detailed traffic/runtime presentation;
- individual client fingerprint override.

### Per-user fingerprint

The user card provides a fingerprint selector with **Default** as the first option.

Effective behavior:

```text
user override → host fingerprint → chrome
```

Default means live inheritance. It should not copy the current host value into the user record.

---

## 3. Hosts and public endpoints

Hosts represent client-facing endpoint configuration rather than the physical node alone. This separation is useful when infrastructure, DNS and exported client identity should evolve independently.

**Publish rule:** client-facing subscriptions and exported Client JSON contain only enabled, authorized Host records that match the selected XRAY STUDIO profile, inbound and node binding. A Node is never automatically exported as a replacement Host, even when the Hosts collection is empty. Deleting/disabling the last publishable Host therefore produces **zero** client servers without changing the Node runtime or its signed configuration. The authenticated active-user subscription endpoint returns a successful empty JSON array (`[]`) with `Cache-Control: no-store, private`, so clients can discard previously downloaded endpoints on refresh; clients may retain historical local entries until their own refresh/removal behavior runs. Invalid tokens and inactive subscriptions remain denied independently of this empty-feed behavior.

Host configuration can include the endpoint/addressing data and client-visible transport/security metadata used when subscriptions are generated.

### Host fingerprint

The host/default uTLS fingerprint is `chrome` when no custom value has been selected. The UI and stored behavior are intentionally aligned so there is no invisible difference between a label that says Chrome and an empty underlying value.

---

## 4. XRAY STUDIO

XRAY STUDIO is the main configuration workspace. It combines guided construction with direct JSON access.

### Editor model

The Studio provides:

- guided form/composer workflows;
- manual Xray JSON editing;
- syntax and semantic diagnostics;
- safe helpers/hot fixes for known problems;
- inbound selection and profile tools;
- mapping to the rest of Nexus infrastructure;
- advanced editors for transport-specific settings.

The goal is not to hide Xray JSON. The goal is to make common and advanced configuration safer without preventing experts from editing the real configuration.

### Protocols and transports

The repository includes configuration/export support around multiple Xray protocol families, including VLESS, VMess, Trojan, Shadowsocks/SS2022 and newer transport/profile combinations such as Hysteria2/MASQUE where implemented.

The Studio exposes transport families including RAW/TCP, XHTTP, WebSocket, gRPC, HTTPUpgrade and additional advanced transports supported by the current implementation.

Always verify the current Xray-core schema before assuming a field remains valid across versions.

### Security selector

The Studio deliberately does **not** guess TLS from protocol/transport.

```text
TLS     → certificate TLS active
REALITY → Reality selected, certificate TLS inactive
NONE    → certificate TLS inactive
```

This allows advanced profiles such as VLESS + XHTTP + NONE when the operator intentionally uses VLESS Encryption or another valid construction.

### TLS and Reality

The Studio exposes TLS/Reality-specific configuration and validation instead of silently inventing domains or certificate material.

For TLS, certificate/key paths refer to paths visible inside the Xray runtime environment. The control plane can assist with managed infrastructure certificates, but arbitrary Xray certificate references remain explicit configuration.

---

## 5. Full XHTTP constructor

The XHTTP menu uses the same wide card-oriented interaction model as FinalMask.

### Modes

- `auto`
- `packet-up`
- `stream-up`
- `stream-one`

### Path generation

New XHTTP profiles receive a cryptographically random URL-safe Path instead of a universal `/xhttp` marker.

Existing custom paths remain stable unless the operator explicitly rotates/rebuilds them.

### Headers

Operators can use browser-oriented presets or a custom header map. The constructor can create Firefox/Chrome-style starting profiles while still allowing full manual control.

### Padding and disguise

The UI covers fields such as:

- `xPaddingBytes`
- `xPaddingObfsMode`
- `xPaddingKey`
- `xPaddingHeader`
- `xPaddingPlacement`
- `xPaddingMethod`
- `noGRPCHeader`
- `noSSEHeader`

### Session and sequence

- `sessionIDPlacement`
- `sessionIDKey`
- `sessionIDTable`
- `sessionIDLength`
- `seqPlacement`
- `seqKey`

### Uplink layout

- `uplinkHTTPMethod`
- `uplinkDataPlacement`
- `uplinkDataKey`
- `uplinkChunkSize`

### Tuning

- `scMaxEachPostBytes`
- `scMinPostsIntervalMs`
- `scMaxBufferedPosts`
- `scStreamUpServerSecs`
- `serverMaxHeaderBytes`

### XMUX

- `maxConcurrency`
- `maxConnections`
- `cMaxReuseTimes`
- `hMaxRequestTimes`
- `hMaxReusableSecs`
- `hKeepAlivePeriod`

The Studio validates known Xray constraints rather than knowingly generating incompatible combinations.

### Advanced objects

`downloadSettings`, `h2Params` and full XHTTP JSON remain available for configurations beyond the guided forms.

### Randomized profile generator

The full randomized profile generator can produce a rich starting point with browser headers, padding, Session ID/sequence behavior, uplink and XMUX ranges. It is presented for operator review before being applied.

Detailed implementation contract: `XRAY_STUDIO_GUIDE.md`.

---

## 6. FinalMask

FinalMask tooling is designed around the fact that masks differ by direction and transport.

### Catalog

TCP families include:

- Sudoku
- Header Custom
- Fragment
- XMC
- Filter

UDP/QUIC-related families include:

- Salamander / Gecko
- Sudoku
- Header Custom
- mKCP Legacy
- Noise
- `udphop`
- XDNS
- XICMP
- Realm
- Filter
- QUIC client parameters

### Server vs client configuration

The Studio distinguishes server `finalmask` from explicit client `xmesh.clientFinalmask`. Some layers are symmetric; others are server-only or require explicit client-side projection.

### Randomization

New simple presets use cryptographically/randomly generated values instead of identical example strings across every deployment.

See `FINALMASK_COMPATIBILITY.md` for the compatibility matrix.

---

## 7. Subscription system

### First-connection subscription start (ON_HOLD)

The **start counting after first connection** option creates a user with
`hold=true`, a finite `holdDays` duration and no initial expiry date.
A valid waiting subscriber **may import their private HTTPS subscription
into Happ** or another supported client: the public feed returns HTTP 200
and the signed Xray desired configuration contains their authorized account.
Downloading the feed, opening the portal or showing its QR code does not
start the countdown.

The backend starts the duration only on **accepted, authenticated, positive,
per-user Xray traffic evidence**. A newly created waiting account can start
on its first nonzero signed observation; a zero-only baseline, unchanged counter,
stale/replayed report, disabled account or
exhausted quota does not activate an account. The transition is atomic and
one-shot: `hold=false`, `firstConnectedAt` and `expireAt` are written
together from the verified timestamp. Further updates never reset this
starting point. Before activation, the node does not receive an offline
spending allowance for the waiting subscriber: signed online telemetry is
required to begin their access.

Disabled, expired, over-quota and invalid-duration subscriptions still
return HTTP 403. If a waiting subscription has no publishable Hosts,
the valid feed is HTTP 200 with an empty native JSON array (`[]`) — the
administrator must publish Hosts and synchronize node configuration.



The subscription subsystem converts managed state into client-consumable output.

### Token lifecycle

Subscription access uses independent tokens that can be issued/revoked without exposing panel credentials.

### Native Xray JSON

The server can generate native Xray JSON for supported protocol/transport combinations. Projection is intentionally validation-aware: missing keys or incompatible settings should fail closed rather than silently fabricating a broken client profile.

### Public portal

SUBSCRIPTION STUDIO controls the implemented public portal, including:

- product/name/domain presentation;
- colors and branding;
- optional logo;
- RU/EN text;
- subscription status;
- traffic and expiry cards;
- QR display;
- copy-link behavior;
- support links;
- built-in or custom client applications.

### Client/device handling

The subscription layer can negotiate output/portal behavior from request/User-Agent information where the implementation supports it.

### Supported outbound families

Current Rust projection includes VLESS, VMess, Trojan, Shadowsocks including SS2022, Hysteria2 and MASQUE subject to valid settings and client support.

See `SUBSCRIPTION_SECURITY.md` and `XRAY_CLIENT_EXPORT_MATRIX.md` for security/export specifics.

---

## 8. Routing and GeoData

### Node routing

Node-side routing is part of the Xray policy delivered to managed servers.

### Client routing

The panel also has a separate client-routing workspace for configuration intended to travel with client JSON where supported.

### GeoData

GeoIP/GeoSite files and their sources are part of the routing dependency chain. The product exposes update/source state rather than pretending geographic rules are static.

Relevant documentation:

- `NODE_ROUTING.md`
- `CLIENT_ROUTING.md`
- `GEODATA_ROUTING.md`

---

## 9. Monitoring and analytics

Nexus collects and presents both infrastructure and Xray-oriented telemetry.

Depending on node/runtime capabilities, this includes:

- node network RX/TX;
- CPU/load/memory/disk-oriented metrics;
- Xray process/runtime status;
- per-user traffic;
- per-inbound traffic;
- historical samples;
- quota-related counters and state.

Traffic counters must be treated as signed/authoritative data from the node pipeline where that contract applies; UI rendering is not the source of truth.

See `PANEL_UPDATE_AND_TELEMETRY.md`.

---

## 10. Administrative security

### Authentication and authorization

The panel includes role-aware access control and an observer/read-only boundary intended to prevent privileged data leakage.

### MFA

TOTP MFA includes persistent encrypted key handling and recovery controls. The encryption key in `.env` is persistent installation state and must not be casually rotated while MFA data exists.

### Sessions

Administrative security includes session/revocation controls and shared login throttling through Redis.

### Dashboard path

Each installation receives a random dashboard path stored in mode-600 state. It is an additional exposure-reduction measure, not a substitute for authentication.

### Node trust

Nodes use signed identity/policy/command mechanisms. Operational UI must not downgrade these checks merely to make a failed node appear healthy.

---

## 11. v6 strict-PQ control plane

XMesh Nexus v6 includes the production XSP-v2 strict-PQ runtime in normal install/update packaging.

The product separates ordinary public HTTPS from operational node control. The normal web vhost does not expose legacy operational node APIs; v6 operational control uses the dedicated product ingress.

The current project evidence documents a bounded real strict-PQ activation/finalization on Node 13. That is strong evidence for that bounded target, not a blanket statement that every installation/node is already activated.

Read:

- `XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md`
- `XSP_V2_PQ_ONLY_SECURITY_POLICY.md`
- `ENTERPRISE_ROADMAP.md`
- `../P0E_CHECKPOINT.md`

---

## 12. Updates and maintenance

### Panel updates

The installed panel contains an authenticated owner-triggered update flow backed by host-side systemd path/service handling. Updates preserve persistent state and run the installer preparation path before rebuilding the running stack.

### Agent updates

Managed nodes can receive authorized Agent updates from the panel. Version state should be confirmed by subsequent Agent reporting.

### Xray updates

The panel includes controlled Xray update handling rather than treating arbitrary binaries as trusted. Release/source verification remains part of the safety boundary.

### Backups

PostgreSQL is persistent product state and must be backed up. `.env`, strict-PQ signer/ingress identity material and other persistent secrets are equally critical recovery inputs. Do not treat a database dump alone as a complete cryptographic recovery plan.

See installation/operations documentation and the XSP-v2 recovery evidence for stricter recovery requirements.

---

## 13. Honest limits

XMesh Nexus is powerful, but a professional operator should understand what the product does **not** magically solve:

- it does not provide VPS capacity by itself;
- it does not make closed firewall ports or incorrect DNS work;
- it does not guarantee every experimental Xray option works in every third-party client;
- a green CI run does not prove a particular VPS was updated;
- saving a profile does not prove the node applied it;
- a UI preview does not prove a public subscription URL is reachable from the Internet;
- a bounded strict-PQ production activation is not a claim that all nodes have been migrated;
- root access to the Nexus host remains a high-trust position.

Those boundaries are intentional. The project aims to make state and evidence explicit instead of hiding operational uncertainty.

---

## Integration API v1 contract (RFC; not yet implemented)

**Purpose:** XMesh Nexus is a universal VPN control plane, not a shop, payment
processor, Telegram bot, or subscription reseller. Any trusted external client
(Telegram bot, self-service website, automation) uses the *same* stable,
versioned API. Marzban/RemnaWave compatibility may be offered through adapters,
but must not define Nexus's internal data model.

**Implementation status (2026-11-13):** This section describes the desired
contract, **not live endpoints**. The existing administrator API is available at
`/api/v1/collections/*`, `/api/v1/users/{id}/subscription` and related routes.
Those routes use an interactive, cookie-authenticated administrator session.
There is no general-purpose integration Bearer token, idempotent entitlement
grant, verified Telegram linking, or production event-delivery outbox yet.
The legacy `tokens` collection is explicitly disabled. Do not give a bot an
owner's username, password, or browser session cookie.

### Product ownership: one source of truth per kind of data

| Nexus owns | External client owns |
| --- | --- |
| VPN user identity, immutable Xray credentials, access state | Payment processors, checkout, price lists and promotions |
| Expiry, activation on first *verified VPN connection*, quota policies | Telegram conversations, buttons, support threads |
| Per-user and per-node traffic from authenticated counters | Orders, invoices, receipts, refunds and buyer-facing payment history |
| Subscription URLs, client configs, token revocation and rotation | Customer CRM, bot campaigns and referrals |
| Node/squad selection, delivery readiness, audit | Sending customer-facing notifications |

Nexus MUST NOT learn payment amounts or be responsible for an external payment
provider's webhook correctness. The external client passes an opaque operation
reference only, to make a requested entitlement grant idempotent.

### Namespace and separation

All *new* integration endpoints live beneath `/api/v1/integrations/`. Existing
administrative and node-agent endpoints continue working unchanged and are
**not** exposed with integration credentials by default. A dedicated token
administration UI/API, accessible to the **owner** via normal MFA/session, will
manage the integration credentials. Every new API release requires an
OpenAPI 3.1 schema generated or checked against actual registered handlers;
schema-first design does **not** imply a route already exists.

The v1 integration API must be feature-complete for ordinary subscription
lifecycle operations before being designated stable. Contract changes within
v1 are additive; breaking field/behavior changes require a new version.

### Identity, authorization and security

- Unique, 256-bit CSPRNG service tokens, shown only once on creation;
  store only a SHA-256 digest, token ID, name, exact scopes, issue/expiry
  times, and last-used metadata. Revocation takes effect on the next call.
- Bearer authentication is permitted **only** on integration routes.
  Reject cookie-authenticated integration requests; never treat browser
  sessions as service principals or bypass CSRF checks for cookies.
- Allow least-privilege scopes: `users:read`, `users:write`,
  `subscriptions:read`, `subscriptions:manage`, `traffic:read`,
  `entitlements:grant`, `identities:read`, `identities:write`, `events:read`. No wildcard
  privilege by default, no inherited admin/owner credentials, no Xray
  private-key access.
- IP allowlisting and per-key rate limiting may be added as additional
  controls; failures must not silently weaken authentication.
- External Telegram identifiers are **not** account proof on their own.
  Linking requires a verified one-time challenge or explicitly authorized
  enrollment; a `tg` field previously entered in an admin form is unverified.
  Binding is unique across active users; transfers are explicit and audited.
- Every mutation is auditable: service token ID, scope, action, user ID,
  request ID, idempotency key, redacted result. No subscription bearer token,
  raw Authorization header, credential, or payment reference in logs.
- Public subscription URLs remain bearer secrets; never return them from
  ordinary `users:read` or profile list responses. Credential rotation and
  subscription-token reissuance must be separate, explicit operations.

### Proposed route surface (not registered yet)

| HTTP | Path beneath /api/v1/integrations | Scope | Behavior |
| --- | --- | --- | --- |
| GET | /capabilities | valid token | Contract version and granted scopes |
| GET | /users?cursor=&limit= | users:read | Paginated safe user projection |
| POST | /users | users:write | Create VPN identity, optionally activation-on-first-use |
| GET | /users/{id} | users:read | Effective state, expiry and limits |
| PATCH | /users/{id} | users:write | Typed allowlisted fields only; never raw credential/usage resets |
| POST | /users/{id}/enable | users:write | Enable account, without resetting usage or expiry |
| POST | /users/{id}/disable | users:write | Disable account, without changing credentials |
| POST | /users/{id}/entitlements/grant | entitlements:grant | Atomic, idempotent renewal / additional days |
| GET | /users/{id}/traffic | traffic:read | Signed traffic totals, units and timestamps |
| GET | /users/{id}/quotas | traffic:read | Main, CDN and node-scoped remaining amounts |
| GET | /users/{id}/subscription | subscriptions:read | Existing link and delivery readiness; **never rotate on GET** |
| POST | /users/{id}/subscription/reissue | subscriptions:manage | Explicit token reissuance; invalidate previous link |
| POST | /users/{id}/credentials/rotate | dedicated elevated scope | Explicit destructive rotation, with node-sync warning |
| POST | /identities/telegram/verify | identities:write | Verify one-time code and claim unique binding |
| GET | /identities/telegram/{id} | users:read + identities:read | Resolve only verified binding |
| GET | /events?cursor= | events:read | Poll persistent event outbox with replay cursor |

Administrative node actions and global Xray configuration edits MUST NOT be
included in normal bot scopes. If needed, they require a separate, explicitly
reviewed service role.

### Account state and grant semantics

- Nexus server time is authoritative, represented in UTC. Existing
  `expireAt` is milliseconds since Unix epoch; adapters never infer seconds
  from a bot's local timezone. Durations use integer days (86,400 seconds
  each) and validated bounds; bytes are integer values, and GB means decimal
  1,000,000,000 bytes.
- `enabled`/`disabled` and expiry are distinct: disabling an account does
  not delete it, rotate credentials, reset traffic, or alter paid days.
  Deletion is separate and high-risk.
- `POST /users/{id}/entitlements/grant` consumes a required UUID-like
  `Idempotency-Key` plus `days` (1..3650). If the user has finite active
  expiry, grant from max(current expiry, server now). Do not shorten time.
- For activation-on-first-verified-connection users, grant increases their
  deferred entitlement according to an explicit activation policy; never
  start countdown on a feed/QR retrieval. Define this branch in handler
  tests before enabling production writes.
- Existing unlimited subscriptions must have an explicit documented
  transition to time-limited access; a plain "extend" must not silently
  replace unlimited access.
- Record the grant and update user state **within one PostgreSQL transaction**.
  Store the operation ID, service principal, canonical request digest, result,
  and created-at. Replaying same ID/body returns original result; same ID
  with different body is HTTP 409. Concurrent duplicate requests cannot
  credit twice. On retry, a completed grant must remain recognizable even
  after a worker/network crash.
- A successful payment confirmation belongs to the bot, not Nexus. Never
  claim a payment is paid based solely on an entitlement-grant response.
- Mutations to quota policy cannot write signed accounting or derived
  `cdnUsedBytes`. Use dedicated, auditable actions for manual traffic
  adjustments and explicit period resets, not generic user PATCH.
- Credentials are generated and persisted by Nexus; API clients never
  supply their own Xray UUID, REALITY private key or subscription token.

### Responses, errors and pagination

Success carries `data` and `meta.requestId`/`meta.apiVersion`. Lists also return
`meta.nextCursor` and bounded `meta.limit`; avoid dumping the whole database.
Errors carry a stable machine code, a safe human-readable message, and request
ID. Minimum codes: `validation_error` (400), `unauthorized` (401),
`insufficient_scope` (403), `not_found` (404), `conflict` (409),
`rate_limited` (429), `temporarily_unavailable` (503). Never reveal whether
another customer's Telegram ID or secret exists in a public-facing error.
Respect `Retry-After`, bounded request bodies, and no-store for sensitive
responses.

### Events and delivery

Implement a transactional Postgres outbox for `user.created`,
`user.first_connected`, `user.expired`, `user.expires_in_24_hours`,
`user.limited` and `user.bandwidth_usage_threshold_reached`. Persist each
event *with* the source state transition; multiple event consumers can
replay by cursor. An optional signed webhook dispatcher uses HMAC-SHA256
with explicit key ID, timestamp and delivery ID, retries with backoff and
bounded retention. The current panel setting named `hooks` is only
configuration/validation and **must not** be presented as real delivery
until this pipeline exists. Sending Telegram notifications is the bot's job.

### Rollout gates (implementation order)

1. **Integration security:** migration for hashed scoped service tokens,
   owner-only create/list/revoke, strict Bearer middleware, audit, rate limiting,
   authorization/CSRF/expired-token tests, and OpenAPI security schemes.
2. **Read-side parity:** safe user lookup, verified identity binding, user
   status, subscription retrieval, quotas, node meter reporting, cursor
   pagination; no secrets through `users:read`.
3. **Write-side parity:** user creation and typed patches, enable/disable,
   explicit subscription operations, idempotent grants, concurrent request
   tests and first-connection activation preservation.
4. **Reliable events:** outbox, replay, signed delivery, retry and dedupe.
5. **Adapter proving:** one sample Telegram bot client and one generic CLI,
   with integration tests against the real Rust API/Postgres/Redis stack,
   generated OpenAPI artifacts and version compatibility checks.

**Acceptance criterion:** a bot with minimal scopes can create, look up,
extend, block and show a subscriber's access and traffic, without a browser
login, direct PostgreSQL writes, payment-specific tables in Nexus, or any
privileged access to node secrets. Every operation must be retry-safe and
covered by a documented contract and integration test.
