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
| **Users** | CRUD, status, expiry, traffic limits, access state, detailed card, subscription access and individual fingerprint override | Per-user fingerprint can inherit from host |
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
