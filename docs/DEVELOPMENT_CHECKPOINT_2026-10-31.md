# XMesh Nexus — development checkpoint

**Date:** 2026-10-31  
**Source baseline before this documentation work:** `ddbd7164d323f4db020b985c3c43035b0f7e2233`  
**Purpose:** preserve product and implementation decisions that must survive README rewrites, new chats, refactors and future UI work.

This document is a **development handoff**, not marketing copy. When implementation and this file disagree, inspect current `main`, tests and the relevant subsystem documentation before changing behavior.

## 1. Product boundary

XMesh Nexus is a self-hosted **control plane** for Xray-powered VPN infrastructure.

- Nexus owns the web panel, Rust API, persistent business state, users, hosts, squads, node inventory, subscriptions, configuration intent, telemetry and security state.
- XMesh Node is the managed node/agent side. It applies signed policy and operates Xray on VPS nodes.
- Xray-core remains the user VPN **data plane**. XSP-v2 is a control-plane security protocol and must never be presented as a replacement for the Xray traffic plane.
- A state saved in Nexus is not, by itself, proof that a node applied it. Runtime/attestation/heartbeat state is authoritative for applied-node claims.

## 2. Installation and runtime invariants

The supported automated panel installation target is **Ubuntu 22.04/24.04 LTS**.

`install.sh` is the canonical installer. On a normal full installation it:

1. obtains root via `sudo` when needed;
2. installs Docker Engine, Docker Compose/Buildx, Nginx mainline, Certbot and required host packages;
3. generates persistent random service secrets into mode-600 `.env` without resetting an existing installation;
4. generates a unique secret dashboard path;
5. starts PostgreSQL/TimescaleDB, Redis and the Rust panel through Docker Compose;
6. provisions the v6 strict-PQ foundation;
7. starts the mandatory v6 product gateway/ingress profile;
8. requests a trusted Let's Encrypt certificate and configures public Nginx HTTPS;
9. keeps the ordinary panel application bound to loopback while Nginx is the public web endpoint.

Network expectations for a normal v6 deployment:

- TCP/80: ACME HTTP-01 and HTTP→HTTPS redirect;
- TCP/443: administrator/public web and subscription endpoint via Nginx;
- TCP/8444: strict-PQ operational node control-plane ingress in v6;
- the panel container itself is published only on `${APP_BIND:-127.0.0.1}:${APP_PORT:-8080}`.

Do not document manual `.env` secret generation as the primary installation flow. The installer is designed to generate and preserve those values.

## 3. XRAY STUDIO security rule — explicit security is authoritative

This is a deliberate design decision introduced after the first automatic TLS policy proved too opinionated.

`streamSettings.security` is the **single source of truth**:

- `security: "tls"` → TLS certificate mode is active and `tlsSettings` is made available/preserved;
- `security: "reality"` → certificate TLS is not activated;
- `security: "none"` → certificate TLS is not activated.

**Never infer or silently rewrite security from protocol or transport.**

Examples that must remain possible:

- VLESS + XHTTP + `none` (for advanced VLESS Encryption scenarios);
- VLESS + XHTTP + `tls`;
- VLESS + XHTTP + `reality` where supported;
- custom advanced profiles whose validity should be handled by validation rather than silent policy rewriting.

Dormant `tlsSettings` may remain in JSON when security changes away from TLS so certificate paths are not destroyed. Xray only activates them when the selected security is TLS.

## 4. Fingerprint ownership and inheritance

Fingerprint behavior has two levels.

### Host default

- A newly created host/endpoint defaults to `fp: "chrome"`.
- Old empty host fingerprint records should be presented as Chrome in the editor and saved as `chrome` when persisted.

### Per-user override

The user card contains an individual uTLS fingerprint selector.

- First UI option is **«По умолчанию»** / **Default**.
- The explanatory text must make inheritance explicit: the default value inherits the host fingerprint; if the host has no usable fingerprint, `chrome` is used.
- The inherited value should not be copied into the user record. Inheritance must stay live so changing the host later affects users that remain on Default.
- Effective priority: **user override → host fingerprint → chrome**.
- The override affects only that user's generated TLS/REALITY client configuration; it must not mutate the host.

## 5. XHTTP generation and constructor

### Random Path

A new/generated XHTTP profile must not use the fixed `/xhttp` path.

- Generate a cryptographically random URL-safe path with a leading `/` and a 64-character token.
- Generate it when XHTTP is newly created or when a profile is explicitly rebuilt through the Composer.
- An existing custom path must be preserved on unrelated edits.
- A legacy saved `/xhttp` path must **not** silently rotate just because another field changed.
- The XHTTP menu provides an explicit action to generate a fresh random Path.

### Full constructor

The XHTTP tool uses the same wide card-dialog presentation family as FinalMask and is intended to expose the real SplitHTTP/XHTTP surface rather than forcing operators into raw JSON.

Current cards / groups include:

- mode presets: `auto`, `packet-up`, `stream-up`, `stream-one`;
- basic Path / Host / Mode;
- random Path rotation;
- browser headers and custom headers JSON;
- padding/disguise;
- Session ID and sequence placement;
- uplink layout;
- packet-up tuning;
- stream-up keepalive;
- XMUX;
- server/download/H2 advanced settings;
- full randomized profile preview;
- complete advanced JSON fallback;
- advanced reset while preserving outer Path/Host/Mode.

Supported exposed fields include, as applicable:

`headers`, `host`, `mode`, `path`, `noGRPCHeader`, `noSSEHeader`, `xPaddingBytes`, `xPaddingObfsMode`, `xPaddingKey`, `xPaddingHeader`, `xPaddingPlacement`, `xPaddingMethod`, `uplinkHTTPMethod`, `sessionIDPlacement`, `sessionIDKey`, `sessionIDTable`, `sessionIDLength`, `seqPlacement`, `seqKey`, `uplinkDataPlacement`, `uplinkDataKey`, `uplinkChunkSize`, `scMaxEachPostBytes`, `scMinPostsIntervalMs`, `scMaxBufferedPosts`, `scStreamUpServerSecs`, `serverMaxHeaderBytes`, `xmux`, `downloadSettings`, `h2Params`.

Constructor validation should follow Xray-core behavior. Important examples:

- `uplinkHTTPMethod=GET` is valid only for `packet-up`;
- `uplinkDataPlacement=cookie|header` is restricted to `packet-up`;
- `xmux.maxConnections` and `xmux.maxConcurrency` must not both be active;
- header maps must not smuggle the `Host` field when Xray requires `host` separately;
- range fields must remain valid integer/range values.

Security selection is independent from this XHTTP constructor. Opening or applying XHTTP settings must not rewrite TLS/REALITY/NONE.

### Full randomized profile

The randomized profile is a convenience generator, not a hidden mandatory policy. It may generate realistic browser headers, padding, session/sequence placement, uplink layout and XMUX ranges, then shows the resulting JSON for review before application.

## 6. FinalMask generation

XRAY STUDIO exposes a broad FinalMask catalog and keeps server/client concerns explicit.

Current catalog families include:

- TCP: Sudoku, Header Custom, Fragment, XMC, Filter;
- UDP: Salamander/Gecko, Sudoku, Header Custom, mKCP Legacy, Noise, Port Hopping (`udphop`), XDNS, XICMP, Realm, Filter;
- QUIC: client `quicParams`.

Compatibility matters. Unsupported combinations should remain visible but disabled with a reason where the UI supports it.

Randomization rule for newly generated basic presets:

- Fragment ranges are randomized;
- Noise ranges/delays are randomized;
- TCP Header Custom payloads are randomized instead of fixed `HELLO/WELCOME`;
- UDP Header Custom hex payloads are randomized instead of a fixed sample;
- Sudoku and Salamander secrets use the browser cryptographic RNG.

Existing custom FinalMask configuration must not be randomly rewritten on unrelated edits.

See `docs/FINALMASK_COMPATIBILITY.md` for the detailed client/server compatibility matrix.

## 7. Subscription behavior

Nexus owns public subscription tokens, token revocation, the public portal and native Xray JSON projection.

Product behavior to preserve:

- independent public subscription token lifecycle;
- native Xray JSON output;
- HTML subscription portal;
- RU/EN portal content;
- QR and copy-link UX;
- status, traffic and expiration presentation;
- built-in/custom client application catalog and support links;
- device/User-Agent aware negotiation where implemented;
- host-level fingerprint with per-user override described above;
- transport and FinalMask projection that remains fail-closed when required client material is incomplete.

The subscription exporter supports the protocols currently implemented in Rust (including VLESS, VMess, Trojan, Shadowsocks/SS2022, Hysteria2 and MASQUE), subject to valid transport/security configuration and client support. Do not claim universal compatibility with every Xray feature or every client application.

## 8. Node management and runtime truth

Node management includes enrollment/bootstrap, signed identity, configuration delivery, runtime status, telemetry, traffic accounting, updates and operational commands.

Important invariants:

- each concurrently operating VPS needs its own Node identity/record;
- update/restart request acceptance is not the same as verified completion;
- the UI should distinguish desired state, reported runtime state and verified/attested state;
- version display should come from actual reported Agent/Xray state when available;
- managed updates remain signed/authorized and should fail closed on missing identity or invalid evidence;
- traffic quota enforcement and manual reset operations must preserve signed accounting semantics;
- node search/pagination and fleet UX should continue to work for larger inventories.

Relevant documents: `docs/AUTONOMOUS_NODES.md`, `docs/PANEL_UPDATE_AND_TELEMETRY.md`, `docs/SECURITY_NODE_IDENTITY.md`, `docs/NODE_ROUTING.md`.

## 9. Routing, GeoData and traffic

The project contains both node-side routing and client routing surfaces. GeoSite/GeoIP data and routing rules are configuration dependencies, not decorative metadata.

- Node routing governs traffic on managed Xray nodes.
- Client routing can be projected into client JSON where supported.
- GeoData sources and update state are operator-visible.
- Real user traffic accounting depends on Xray StatsService/agent telemetry, not a browser-side estimate.
- System/network metrics and Xray counters should remain distinguishable from derived presentation data.

Relevant documents: `docs/NODE_ROUTING.md`, `docs/CLIENT_ROUTING.md`, `docs/GEODATA_ROUTING.md`, `docs/PANEL_UPDATE_AND_TELEMETRY.md`.

## 10. Administrative security

Existing product security includes, among other controls:

- RBAC and least-privilege observer behavior;
- TOTP MFA and recovery handling;
- encrypted persistent MFA/subscription secrets;
- session management/revocation controls;
- Redis-backed shared login throttling;
- security/audit boundaries in the API;
- secure cookie operation behind HTTPS;
- a per-installation secret dashboard path;
- signed Node identity/policies/commands;
- dedicated strict-PQ v6 node control-plane path.

Do not describe the project as externally audited unless a real independent audit has actually occurred. Existing governance evidence explicitly uses AI-assisted internal review plus release-owner risk acceptance.

## 11. XSP-v2 / v6 POSTQUANTUM status

The v6 release packages the production strict-PQ control-plane runtime into normal install/update paths.

The bounded production evidence already records a real activation/finalization on Node 13. The canonical evidence remains in:

- `docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md`;
- `docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md`;
- `docs/ENTERPRISE_ROADMAP.md`;
- `P0E_CHECKPOINT.md`.

Key policy properties include TLS 1.3 `X25519MLKEM768`, ML-DSA-65 identity/signing material and no automatic classical fallback for the strict-PQ operational path.

Do not turn a bounded activation claim into an unqualified claim that every node is already strict-PQ. Wider rollout remains per-node and evidence-bound. `legacyXMESH1Retired=false` and `physicalPowerLossQualified=false` are deliberate, documented claims.

## 12. Recent UI/product commits captured by this checkpoint

The following changes immediately precede this documentation checkpoint and are easy to lose during future refactors:

- PR #195 — first protocol TLS automation attempt;
- PR #196 — transport-aware TLS experiment;
- PR #197 — final policy: explicit Security selector is authoritative;
- PR #198 — host fingerprint actually defaults to Chrome rather than an empty value with only a visual hint;
- PR #199 — per-user fingerprint override restored with live host inheritance;
- PR #200 — randomized XHTTP paths and randomized basic FinalMask preset parameters;
- PR #201 — FinalMask-style XHTTP card menu;
- PR #202 — full XHTTP settings surface and reviewed randomized profile generator.

The current behavior is the **result after #202**, not the behavior of the earlier experimental TLS PRs.

## 13. Checklist for future development

Before changing XRAY STUDIO or subscription projection:

1. verify the current Xray-core field schema instead of relying on old examples;
2. preserve explicit `security` selection;
3. distinguish server-only, client-only and symmetric fields;
4. avoid rewriting existing custom configuration during unrelated edits;
5. keep generated secrets/paths cryptographically random;
6. update source regression checks when a product contract changes intentionally;
7. verify subscription projection as well as the Studio JSON surface;
8. run full Backend CI, including strict Clippy, Docker build and disposable PostgreSQL/Redis integration;
9. never describe a queued command, saved JSON or green CI as proof of a live VPS outcome without runtime evidence.

Before changing installation/security:

1. preserve existing `.env` secrets and signer/CA identity on upgrades;
2. keep normal panel HTTP bound to loopback;
3. keep the public Nginx endpoint separate from operational node control APIs;
4. keep strict-PQ activation claims evidence-bound;
5. document new ports, host dependencies and recovery implications.
