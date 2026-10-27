# XMesh Nexus

## XSP-v2 status — 27 October 2026

**Documentation reconciled in `main`:** [PR #58](https://github.com/TriplexCorp/XMesh-Nexus/pull/58) and [PR #59](https://github.com/TriplexCorp/XMesh-Nexus/pull/59) are merged; old [#56](https://github.com/TriplexCorp/XMesh-Nexus/pull/56) was closed **without merging** after its unique details were preserved. The verified documentation merge checkpoint is `5fb33264e85cf6e461b02722f934a7010f2b583a`; [Backend CI #40544716962](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40544716962) succeeded pre-merge for #59. Post-merge CI for that exact SHA has not been independently confirmed. Older SHAs below are historical snapshots.

**Implemented in isolated staging:** Nexus [#54](https://github.com/TriplexCorp/XMesh-Nexus/pull/54) dual Ed25519 **AND** ML-DSA-65 signed commit receipt; [#55](https://github.com/TriplexCorp/XMesh-Nexus/pull/55) immutable PostgreSQL exact-byte receipt outbox and idempotent retries without repeating epoch CAS. Node [#23](https://github.com/TriplexCorp/XMesh-Node/pull/23) PQ-only TLS 1.3 `X25519MLKEM768` dialer; [#24](https://github.com/TriplexCorp/XMesh-Node/pull/24) dual-signature receipt verifier; [#25](https://github.com/TriplexCorp/XMesh-Node/pull/25) fsynced receipt journal; [#26](https://github.com/TriplexCorp/XMesh-Node/pull/26) HTTPS exchange of saved signed ACK for verified, durably persisted receipt tested against a **local TLS server**, not an actual Nexus API.

**Next P0:** separately protected `panel_response` signer with independently pinned trust/owner approval, authenticated Nexus `POST /api/v2/node/keys/rotation/ack` and verified PQ-only ingress, real Nexus ↔ Node ACK/commit/receipt/retry E2E and integration into the production Agent; followed by crash/rollback testing, independent security review and disposable canary. The protected signer, actual Nexus ACK route and production PQ-only Agent are **not complete**. `strict-pq` **OFF**; existing legacy `XMESH1` and Xray VPN data plane are unchanged. [Roadmap](docs/ENTERPRISE_ROADMAP.md) · [handoff](docs/XSP_V2_NEW_CHAT_HANDOFF.md).

## Resume development in a new chat — read this first (27 October 2026)

**Next development session:** read the [XSP-v2 handoff](docs/XSP_V2_NEW_CHAT_HANDOFF.md) and [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md), then independently verify both repositories' current `main`, open PRs and Actions. Latest verified milestones are merged Nexus [#55](https://github.com/TriplexCorp/XMesh-Nexus/pull/55) and Node [#26](https://github.com/TriplexCorp/XMesh-Node/pull/26); historical stages below are not current TODOs.

- **Nexus `main`:** `7507437102df59c3bbd4682170c1b81300fdd565`. Post-merge [Backend #40536860094](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40536860094), [OpenSSL 3.5 Crypto #40536860140](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40536860140), [User Presence #40536860723](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40536860723), and [GeoData #40536860386](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40536860386) **all passed** on that SHA.
- **Node `main`:** `d2f916bfef36f7093de0cf0d57744f8f40c423cb`. Post-merge [Node CI #40531422490](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40531422490) and [Go 1.27 PQ Crypto #40531422433](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40531422433) **both passed**.
- **Staging components implemented:** dual Ed25519 **AND** ML-DSA-65 signed permit, ACK and Nexus commit receipt ([Nexus #54](https://github.com/TriplexCorp/XMesh-Nexus/pull/54), [Node #24](https://github.com/TriplexCorp/XMesh-Node/pull/24)); durable Node receipt journal ([#25](https://github.com/TriplexCorp/XMesh-Node/pull/25)); PQ-only TLS HTTP ACK → receipt client with local e2e tests ([#26](https://github.com/TriplexCorp/XMesh-Node/pull/26)); DB-backed committed ACK readback ([Nexus #50](https://github.com/TriplexCorp/XMesh-Nexus/pull/50)); immutable server-side receipt outbox and migration `0105` with signed Rust→PostgreSQL integration ([Nexus #55](https://github.com/TriplexCorp/XMesh-Nexus/pull/55)).
- **Next P0:** separately protected `panel_response` signer and authorized Nexus `POST /api/v2/node/keys/rotation/ack` behind genuinely hybrid TLS 1.3 `X25519MLKEM768`, bound to the existing verified ACK and immutable receipt outbox. Then production Agent integration, real Nexus↔Node e2e, crash/rollback tests and independent security review. **The Nexus HTTP route, protected signer and deployed Agent integration do not exist yet**; GitHub CI is not a deployment verification.

- **Mandatory future XSP-v2 policy:** **PQ-only**, with no UI/CLI/config choice. The Node establishes a control-plane connection only with verified TLS 1.3 `X25519MLKEM768` **and** Ed25519 **AND** ML-DSA-65 authenticated messages. Missing PQ/trust/keys means **no connection**, never fallback to `XMESH1` or classical X25519. Currently running legacy nodes have **not** been migrated or disconnected by this document. [Binding security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md).
- **Not live:** normal Nexus routes do not invoke these staging helpers; Go 1.27 Node research code is not the production agent. `XMESH1`/Ed25519 still runs; `strict-pq` **OFF**. **Xray** handles user VPN encryption; this work protects the Nexus ↔ Node control plane. A GitHub merge alone does not deploy to a VPS.

## Fully automated installation — Docker, Nginx and HTTPS included

**You do not need to install Docker, Docker Compose, Nginx or Certbot by hand.** On a clean **Ubuntu 22.04/24.04 LTS** VPS, install Git, point a public DNS A/AAAA record for the panel domain to the VPS and allow inbound TCP/80 and TCP/443. Then:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
bash install.sh
```

The installer requests your domain and Let's Encrypt email (or accepts `PANEL_DOMAIN`/`PANEL_ACME_EMAIL`), installs **Docker Engine + Buildx/Compose, official Nginx Mainline and Certbot**, generates secrets and the initial admin account, runs PostgreSQL/TimescaleDB, Redis and the API, waits for readiness, issues a trusted TLS certificate and configures the HTTP → HTTPS reverse proxy. The API binds only to **`127.0.0.1:8080`**; the public entrypoint is Nginx on your domain. DNS/firewall and secure storage of credentials are still your responsibility. [Full setup and updates](#install-the-panel).

**Managed node bootstrap is automated, too:** use **Nodes → Connect node and metrics** inside Nexus and run the generated token-free bootstrap command on an Ubuntu node VPS. It installs Docker/Compose if needed and provisions the router, Ed25519 enrollment and metrics/control timers. [Node onboarding](https://github.com/TriplexCorp/XMesh-Node#быстрое-подключение-из-xmesh-nexus-docker--метрики). Standalone installation of the router is a separate option.

## Recover an existing Node enrollment (HTTP 409, October 27, 2026)

A bootstrap `POST /api/v1/node/enroll` response of **HTTP 409** means that this Node ID already has a *different* registered Ed25519 public key. This differs from the normal `202 awaiting_profile` state and has nothing to do with XSP-v2. Fixes are merged into `main`: [Nexus PR #26](https://github.com/TriplexCorp/XMesh-Nexus/pull/26) and [Node PR #7](https://github.com/TriplexCorp/XMesh-Node/pull/7).

**To reconnect:** first deploy the current Nexus panel using **Settings → Update XMesh Nexus → Update panel** and verify completion. Then select the existing Node → **Connect node agent**. An owner must explicitly approve replacing the registered identity. Nexus issues a dedicated 10-minute single-use recovery token via `POST /api/v1/nodes/{id}/enrollment/reissue`. The bootstrap preserves its local Ed25519 private key and proves possession; Nexus retains the old trusted key **until** the new proof is verified and the replacement is committed atomically in PostgreSQL. After successful replacement, the old agent loses authorization. Never share the token, private key, or `.env`.

**If both VPS instances must remain active, create a separate Node ID instead of recovering the old one.** Additive migration `0101_node_enrollment_owner_recovery.sql` defaults key replacement to denied; the owner-scoped flow applies to **legacy Ed25519**, not experimental PQ rotation. [Nexus PostgreSQL/API integration passed on PR #26](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40449358858); [Node `main` CI passed after #7](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40448354429). Merging does not automatically update a running VPS.

## Fix missing Node profile verification helper (October 27, 2026)

A running Xray container and an active Node Agent can still report **"Profile verification not installed"**. This reflects a genuine signed `profileCheck=helper_missing` heartbeat: the original managed bootstrap installed policy guard and Xray sync but omitted `/usr/local/libexec/xmesh-profile-attest.py`. [Node PR #9](https://github.com/TriplexCorp/XMesh-Node/pull/9) now installs the pinned, syntax-checked helper **before** first sync.

**Existing nodes:** deploy the updated Nexus panel and click **Nodes → Update Agent**. Nexus requests `control-v5.1.3`, whose fixed updater installs the independent profile-attestation module and refreshes the control heartbeat. It does **not** rotate your Ed25519 identity or disable signed policy checks. A successful `profileCheck=verified` must result from checking the signed policy, configuration digest and actual read-only Xray container mount; missing or invalid evidence still returns a distinct error status. If the update fails, inspect `sudo python3 /usr/local/libexec/xmesh-profile-attest.py --json` and `sudo journalctl -u xmesh-node-agent-upgrade.service -n 80 --no-pager` on the VPS. No PQ/strict production activation is involved.

**Poland-2 operational live acceptance (Node 13, October 27, 2026):** operator-shared VPS diagnostics confirmed Agent `control-v5.1.3`, local attestation `verified`, and Nexus `GET /api/v1/nodes/13/runtime` with `profileApplicationStatus=applied` and matching `appliedRevision=desiredRevision` (`17fe9dee…dcf8d6bfecf`). Actual transport is **VLESS + XHTTP + TLS + ALPN `h3`**, **not Hysteria2**. The Node forwards UDP/443 to Xray `127.0.0.1:12431`; Let's Encrypt TLS status was `valid` through January 25, 2027. The operator confirmed a real client connection and operation after controlled Docker restarts of Xray/router; local attestation stayed `verified`. Separate disaster recovery, actual ACME renewal, and disposable-node HTTP 409 recovery remain open. This is operator evidence for a single live VPS, not independent security review or XSP-v2 activation. [Acceptance boundaries](docs/ENTERPRISE_ROADMAP.md).

**New staging rotation preparation:** owner-approved PUBLIC pending keyset in migration `0102`, ten-minute challenge and two-signature PoP from `keytool prove-prepared` under a rotation-only domain binding old/new epochs. Server records verified proof only; **no active epoch change, old-key revocation, signed cutover ACK or strict-PQ activation**. [Research boundaries](docs/XSP_V2_STAGING_ROTATION_PREPARE.md). [Nexus Backend/PostgreSQL CI passed](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40456461465) and [real Go→Rust dual-signature proof passed](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40456461449). A signed Node ACK **was missing at the prepare/prove milestone**; subsequent staging [Nexus #44](https://github.com/TriplexCorp/XMesh-Nexus/pull/44) verifies an authenticated new-key ACK and [#46](https://github.com/TriplexCorp/XMesh-Nexus/pull/46) adds an atomic DB commit helper. These components still do **not** activate production rotation.

**Historical P0 (at the prepare/prove stage):** the staging `prepare → dual proof` delivered in [Nexus #30](https://github.com/TriplexCorp/XMesh-Nexus/pull/30) / [Node #10](https://github.com/TriplexCorp/XMesh-Node/pull/10) **does not authorize key activation**. Freeze the wire/trust contract, implement a *trusted signed* Nexus→Node cutover permit, and require a dual-signed Node ACK proving durable applied state before atomic trust switch/old-key retirement. Deployed nodes still use `XMESH1`; `strict-pq` remains OFF.

## XSP-v2 — current P0: hybrid post-quantum control-plane security (October 27, 2026)

**Status: experimental staging and isolated CI only. XSP-v2 is NOT enabled on live nodes.** The existing automatic Docker/Nginx/HTTPS installer, `XMESH1`/Ed25519 control plane, Xray data plane and Go 1.23 production Node remain unchanged. **`strict-pq` is OFF**, and normal Nexus Docker builds do not compile the optional v2 API routes.

| Area | Implemented and testable | Still required before production |
| --- | --- | --- |
| **PR01/PR02 — wire format and cryptography** | Shared [wire vectors](docs/XSP_V2_WIRE_SPEC.md), Rust ↔ Go Ed25519 **AND** ML-DSA-65 interoperability with tamper/replay-format negative tests | Protocol freeze, external FIPS 204 known-answer tests, fuzzing and independent review |
| **Node key protection** | Isolated Go 1.27.3 AES-256-GCM vault with local `prepare-rotation`, `prove-prepared`, `activate-rotation`, `recover-rotation`, retaining encrypted previous keys ([Node PR #5](https://github.com/TriplexCorp/XMesh-Node/pull/5), [#6](https://github.com/TriplexCorp/XMesh-Node/pull/6)) | Production KMS/backup, independently rollback-protected floor, and signed Nexus cutover ACK |
| **Owner-approved initial enrollment** | Staging-only exact first public keyset (epoch 1), 10-minute one-use challenge, Ed25519 **AND** ML-DSA-65 PoP and additive migrations `0099`/`0100`; [Nexus PR #24](https://github.com/TriplexCorp/XMesh-Nexus/pull/24) blocks unsafe one-shot rekey | Owner UX and a separately authenticated two-phase server transition with Node ACK and audited revocation |
| **Experimental heartbeat** | Optional `POST /api/v2/node/heartbeat` verifies **both** signatures using registered keys and atomically records replay nonces; returns **unsigned HTTP 204** without changing config or Xray | Signed Nexus → Node responses, verified command/config ACKs and complete v2 control plane |
| **PR07 — TLS** | Isolated Go/OpenSSL and real test Nginx prove TLS 1.3 negotiated `X25519MLKEM768`, valid CA/SNI and rejection of classical downgrade; loopback ingress intentionally returns **404** | Deployed dedicated node-only TLS endpoint, trusted DNS/ACME and evidence from every required TLS hop on a disposable VPS |

**Initial enrollment only (staging):** an owner approves exact epoch-1 public keys and challenge → offline Go `keytool prove` signs with **Ed25519 AND ML-DSA-65** → Rust verifies both and atomically registers the **first** Node keyset in `dual_enrolled` phase. The old claim endpoint now **rejects subsequent rotations**, instead of revoking an active key before a Node ACK. This does **not** enable `strict` or change the production bootstrap.

**Staging Node reply verifier:** [Node PR #4](https://github.com/TriplexCorp/XMesh-Node/pull/4) added an isolated Go 1.27 verifier for `node.desired-config.response`, requiring pinned `panel_response` Ed25519 **AND** ML-DSA-65 public keys and exact node/epoch/request/payload binding. It is **not** a live Nexus signer, durable replay/ACK system, or production XSP-v2 activation.

**Verified CI for the current staging implementation (October 27):** Nexus [PR #30 `fb334b5`, full Backend CI #40456461465 — success](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40456461465) (Rustfmt, strict Clippy, Docker, PostgreSQL/API migration `0102`) and [Rust/OpenSSL Crypto #40456461449 — success](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40456461449), including real Go→Rust dual-signature verification; Node [`main` `4714307`, CI #40455937718 — success](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40455937718) and [Go Crypto #40455937695 — success](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40455937695). Nexus `main` `5e3db55` also passed [full Backend CI #40457374564](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40457374564) after merging #30/#31, including PostgreSQL/API integration. **Next gates:** Poland-2 live operational acceptance is confirmed by operator evidence (VLESS/XHTTP/H3, verified/applied, controlled restart). Disaster recovery remains a separate gate; the next engineering P0 is **separately authenticated Nexus→Node cutover permission and signed Node-applied ACK**, with safe old-key retirement. [Acceptance criteria and current status](docs/ENTERPRISE_ROADMAP.md). CI is not proof of live VPS operation.

**Historical CI evidence by SHA:** [Nexus full Backend CI on `main` `f5f3e06` passed](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40444076259), including strict Clippy, Docker build and PostgreSQL/API integration for migrations `0099`/`0100`; [Nexus Crypto PoC on the same SHA passed](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40444076298). [Node CI on `main` `ba6013d` passed](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40443828379) and [Node Go Crypto CI passed](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40443828424). This proves build/test gates on the named commits, **not live strict-PQ operation**.

**Next P0 gates:** the Node staging vault can prepare, prove, activate and recover local next keys, and Nexus fails closed on the unsafe old rekey path. Still required: owner-authorized **server-side two-phase cutover and signed Node ACK**, protected `panel_response` signer, signed policy/command responses, durable replay state, KMS-backed recovery, real hybrid TLS canary, review and per-node no-downgrade activation.

More detail: [owner key enrollment](docs/XSP_V2_OWNER_KEY_ENROLLMENT.md) · [experimental API and vault](docs/XSP_V2_EXPERIMENTAL_GATEWAY.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [complete implementation plan](docs/HYBRID_POST_QUANTUM_SECURITY_IMPLEMENTATION_PLAN.md).

## Shadowsocks 2022 JSON subscription delivery (October 26, 2026)

Fixed a missing Shadowsocks 2022 outbound cause: node policies and subscription generation required a per-user `ssPassword` that regular user creation did not provision. New users now receive persistent cryptographically random PSKs; older accounts are conditionally backfilled in PostgreSQL before subscription or node-policy reads, without rotating existing keys. `2022-blake3-aes-128-gcm` uses a separate 16-byte `ssPassword128`, while 256-bit methods use the 32-byte `ssPassword`. Client JSON contains `ServerPSK:UserPSK`; the corresponding key must also reach the Xray node. Invalid or missing credentials still fail closed. **Verify the new node policy and actual client connectivity after upgrading.**


## FinalMask: complete catalog and wide dialog (October 26, 2026)

**XRAY STUDIO → FinalMask** now offers the **complete 16-entry TCP/UDP/QUIC catalog**, alongside **Advanced JSON** and **Reset**, rather than the original four guided presets:

| Direction | Available catalog entries |
| --- | --- |
| **TCP** | Sudoku, Header Custom, Fragment, XMC (Minecraft), Filter |
| **UDP** | Salamander / Gecko, Sudoku, Header Custom, mKCP Legacy, Noise, Port Hopping (`udphop`), XDNS, XICMP, Realm, Filter |
| **QUIC** | Client Params (`quicParams`: congestion control, windows, timeouts and UDP hopping) |

**All choices remain visible.** Choices incompatible with the selected inbound transport are **disabled with a reason**: XDNS requires mKCP; client QUIC params require QUIC/H3. Gecko is enabled through `salamander.packetSize` on QUIC, **not** a separate `gecko` layer. `filter` is inbound-only; `fragment`, `xmc`, `noise`, `xdns`, `xicmp`, `realm`, `udphop` and client `quicParams` use an explicit `xmesh.clientFinalmask` override. Required symmetric server layers must remain present and ordered in client configuration.

The guided Sudoku and Salamander recipes generate 256-bit shared secrets with the browser cryptographic RNG. More specialized recipes edit the **individual layer settings JSON**; Advanced JSON remains available for full custom server/client chains. Client-side `udphop` must come last. Consult the [FinalMask compatibility matrix](docs/FINALMASK_COMPATIBILITY.md).

**Dialog width fix:** the app-wide `dialog:not(...)` rule in `styles.css` was more specific than the original `.xm-studio-modal--cards` width declaration and constrained the three-column catalog to a narrow dialog. The `main` branch now uses `dialog.xm-studio-modal.xm-studio-modal--cards` with a maximum **84rem width**, responsive **4/3/2/1 columns**, bounded vertical scrolling and a cache-busted stylesheet. `scripts/check-xray-tool-actions.js` includes a regression assertion. See [PR #21](https://github.com/TriplexCorp/XMesh-Nexus/pull/21), [CSS fix](https://github.com/TriplexCorp/XMesh-Nexus/commit/c918fecb334679bcf6050ef66077795d9f1b4d9f) and [regression guard](https://github.com/TriplexCorp/XMesh-Nexus/commit/150978cc203b0d6b463c1c0031151b6f89349a80).

**Verification boundary:** a visible preset, saved JSON or passing source-level test does not prove that the node applied the mask or that a given Xray-core/client version supports it. Validate real transports, permissions, DNS/NAT/firewall dependencies and browser responsiveness before production use.

## XRAY STUDIO: transport-aware TLS templates (October 26, 2026)

The configuration composer now populates `tlsSettings.alpn` by transport: XHTTP/RAW → `h2,http/1.1`, gRPC → `h2`, WebSocket/HTTPUpgrade → `http/1.1`, and Hysteria/MASQUE → `h3`. ALPN can be edited manually; `certificateFile` and `keyFile` fields refer to paths **visible to the Xray process**. The composer warns about missing certificate files, empty user lists and loopback-only listeners, and rejects mismatched TLS file pairs or gRPC ALPN without `h2`.

The generator does not invent DNS names, certificate files, private keys, users or reverse-proxy topology. Verify the resulting JSON with the installed Xray-core. [Official TLS/ALPN reference](https://xtls.github.io/en/config/transports/tls.html).


## Build and CI stabilization — October 26, 2026

- Fixed Rust `E0505` in client FinalMask projection without cloning the JSON value.
- Added translations for page navigation, the agent installation timeout and the expanded FinalMask catalog. Existing English translation debt is still tracked in `scripts/english-coverage-baseline.json`; this is not complete localization.
- Updated the user-presence regression guard to check a versioned `app.js` entry point without pinning an obsolete cache-busting revision; corrected a follow-up regex escaping error.
- Applied **61 Rustfmt changes from the CI diff** across `main.rs`, `node_runtime.rs`, `subscription_finalmask.rs`, `subscription_transport.rs`, and `user_subscriptions.rs`.
- **Verification (October 26):** [Backend CI #40304117546](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40304117546) **completed successfully** for code commit `150978cc`. Passed jobs: `cli`, `rust` (frontend, Rustfmt, Rust tests, strict Clippy, Docker build), `subscription-build` and `API authentication integration`. This confirms CI for that revision, **not** browser or live-node VPN end-to-end validation.


**Documentation:** [Русский](README.md) · **English**

**XMesh Nexus** is a self-hosted Xray-core infrastructure management panel for users, nodes, hosts, squads, XRAY STUDIO, subscriptions, monitoring and administration. The API is built with **Rust (Tokio/Axum)**, persistent data uses **PostgreSQL 18 + TimescaleDB**, ephemeral state uses **Redis 7**, and the panel is deployed with Docker Compose.

> **Source-code status as of October 27, 2026:** this is an actively developed project. The repository **does** include public subscription endpoints, native Xray client JSON generation, managed-node integration and Xray-derived user traffic accounting. Running VPN traffic still requires a separately installed [XMesh-Node](https://github.com/TriplexCorp/XMesh-Node) runtime on each VPS, working Xray configuration and correct networking. A feature existing in the code or UI does not prove that a particular node has applied it successfully.

## FinalMask: TCP, UDP and QUIC (October 26, 2026)

XRAY STUDIO now separates server FinalMask from xmesh.clientFinalmask metadata. Native Xray JSON subscriptions automatically inherit only compatible symmetric layers (TCP Sudoku/header-custom; UDP Salamander/Gecko, Sudoku, mkcp-legacy, header-custom). Directional features such as fragment, noise, xmc, xdns, xicmp, realm, udphop and endpoint-specific QUIC parameters use explicit client configuration. Mismatched or incomplete layers are not silently exported. See the [complete FinalMask compatibility matrix](docs/FINALMASK_COMPATIBILITY.md). Source and regression tests are committed; real-client connectivity still requires deployment and integration testing.

## Implementation status

| Area | Implemented | Prerequisites / limits |
| --- | --- | --- |
| **Control plane** | Web panel, Rust API, server-side storage of users, nodes, hosts, squads and settings | A saved panel state is not proof of applied node state |
| **XRAY STUDIO** | Editable Xray JSON, full transport-aware FinalMask preset catalog, profile tools and inbound/host/node associations | The public subscription generator does not support every protocol offered by the editor |
| **Managed nodes** | Ed25519 enrollment, signed requests, heartbeats, desired configuration, restart/update commands | Node-side execution is provided by [XMesh-Node](https://github.com/TriplexCorp/XMesh-Node) |
| **Subscriptions** | Token issuing/revocation, public URL, HTML portal, native Xray JSON, RU/EN, User-Agent device negotiation | Rust outbound generation supports VLESS, VMess, Trojan, Shadowsocks (including SS2022), Hysteria2 and MASQUE, subject to valid protocol/transport settings and client support |
| **SUBSCRIPTION STUDIO** | Domain/name, portal appearance, client-app catalog, JSON and balancer settings | The panel domain gets automated Nginx/HTTPS from `install.sh`; custom subscription domains, DNS and external proxy routing need correct operator configuration |
| **Statistics** | Node RX/TX and system metrics; per-user/per-inbound traffic counters and diagnostic pages | Xray StatsService and up-to-date agents must report real samples |
| **Security** | Server-enforced owner/admin/viewer roles, Argon2, sessions, rate limiting, TOTP, audit log | This is not a claim of a complete penetration test or guaranteed vulnerability-free deployment |
| **IP pools** | Up to **256 addresses**, validation and persisted per-node/per-user round-robin cursor | Public native JSON uses sticky per-user/per-node IP rotation for unambiguous direct endpoints |

## Architecture and responsibilities

- **XMesh Nexus (this repository):** management UI, API, PostgreSQL records, public subscription handlers and signed desired-state policies.
- **[XMesh-Node](https://github.com/TriplexCorp/XMesh-Node):** node-side Xray runtime, desired-configuration reconciliation, signed-policy validation and local enforcement.
- **Metrics/control agents:** contact the panel over outbound HTTPS with Ed25519-signed requests; no inbound administrative port is required on the node.
- **PostgreSQL with TimescaleDB:** one database for business records and time-series data. **Redis:** temporary state and login throttling.
- **Xray-core on the VPS nodes** handles VPN traffic. A core binary managed within the panel container is **not** itself a running VPN listener.

### Saved settings are not the same as applied changes

The panel provides `POST /api/v1/node/desired-config` with a desired Xray configuration, revision and signed policy. A separate node worker validates, tests and applies this data. **Managed profiles accept either one proxy inbound or a TCP proxy + Hysteria2 pair.** For two inbounds, Nexus assigns loopback ports `xrayLocalPort` and `xrayLocalPort + 1` in JSON order; port 10085 is reserved for StatsService. The TCP profile must not also request QUIC/H3. XMesh-Node forwards the public TCP port and public UDP port independently. This is not generic multi-inbound/QUIC multiplexing: update the node agent and verify both backends before production rollout.

Restart and update requests are asynchronous. A successfully queued request is not a verified restart: inspect agent heartbeat, operation status and the actual Xray process. See [autonomous nodes and signed policies](docs/AUTONOMOUS_NODES.md).

## Install the panel

**Supported host automation: Ubuntu 22.04/24.04 LTS.** Start with a root/sudo-capable VPS, a public FQDN that resolves to it (including any AAAA record), and reachable **TCP/80 and TCP/443**. **Git is the only package you need to install first**:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
bash install.sh
```

`install.sh` requests sudo when necessary and **automatically provisions**:

1. Docker Engine/CLI, Buildx and the Docker Compose plugin from Docker's signed Ubuntu repository; Nginx Mainline from nginx.org's signed repository; Certbot and required host packages.
2. Secure `.env` permissions, randomly generated PostgreSQL/Redis/admin secrets, stable MFA/subscription keys and a unique dashboard URL path; on re-install, existing credentials and volumes are preserved.
3. PostgreSQL/TimescaleDB, private Redis and Rust API containers through Compose, with readiness checks **before** publishing HTTPS.
4. A Let's Encrypt **HTTP-01** certificate via Certbot and the managed `/etc/nginx/conf.d/xmesh-nexus.conf` vhost with HTTP → HTTPS redirect and reverse proxy to `127.0.0.1:8080`. Nginx is temporarily stopped for standalone certificate validation; on config failure, the previous managed vhost is restored.
5. Root-owned systemd watchers for dashboard-path synchronization and owner-requested panel updates.

For non-interactive deployment supply your own real domain/email:

```bash
sudo PANEL_DOMAIN=panel.example.org PANEL_ACME_EMAIL=ops@example.org bash install.sh
```

**Operator prerequisites remain:** working DNS pointing at this VPS, valid inbound firewall/NAT rules for 80/443, access to your admin password in the private `.env` and a secure backup. The installer does **not** register DNS, open a cloud firewall, overwrite other domains' Nginx vhosts or publish PostgreSQL/Redis ports. The API stays on loopback. Keep `COOKIE_SECURE=true`, never share `.env` or subscription tokens, and avoid `docker compose down -v` (removes persistent volumes).

Operational diagnostics:

```bash
docker compose ps
docker compose logs --tail=100 panel
docker compose logs --tail=100 db
sudo bash xmeshctl
```

### Update

**Preferred supported path:** **Settings → Update XMesh Nexus → Update panel** (owner-only) or the interactive CLI menu:

```bash
sudo bash xmeshctl
```

The UI request is handled by a separate root-owned `xmesh-panel-update.path/.service` worker installed during setup; the web API has no Docker socket. `xmeshctl` backs up PostgreSQL, checks local Git changes, fast-forwards the configured upstream, preserves existing credentials, rebuilds the Docker image, and can refresh the managed Nginx vhost when run as root. A **queued** update means accepted, **not finished**; inspect `running/success/failed` and `/var/log/xmesh-nexus/update.log`.

For a manual, operator-controlled update **after creating a backup**:

```bash
git pull --ff-only origin main
docker compose up -d --build
```

A `git pull` alone does **not** replace the running image's bundled frontend assets. Panel updates do **not** automatically update every node runtime: use **Nodes → Update Agent** separately and confirm heartbeat, profile application and Xray process state. See [panel update and telemetry](docs/PANEL_UPDATE_AND_TELEMETRY.md).

### Backup and persistent secrets

```bash
bash deploy/backup-postgres.sh
```

Keep tested copies **off-host**. PostgreSQL backups do **not** include `TOTP_ENCRYPTION_KEY` from `.env` or the panel's separate node-policy signing key. Back up these keys securely and preserve them across upgrades. Losing them can affect TOTP access, stored subscription-link decryption or trust by enrolled nodes.

## Public subscriptions and client JSON

Implemented Rust APIs include:

- Create/read/revoke a user subscription: `/api/v1/users/{id}/subscription` (authenticated).
- **`GET /api/v1/sub/{token}`**: publicly accessible native Xray JSON, gated by the subscription token and user status.
- **`GET /api/v1/portal/{token}`**: HTML subscription portal. A configured public portal path is also supported.
- Client **User-Agent** detection for transport/device profiles, including iOS and Windows, with optional explicit device override.
- Outbound assembly from **user → squads → XRAY STUDIO inbound → host/node**, including optional native Xray JSON balancers.
- A user whose subscription is not active cannot retrieve an active client JSON feed.

**Current implementation:** the public outbound assembler in `user_subscriptions.rs` handles **VLESS, VMess, Trojan, Shadowsocks (including SS2022), Hysteria2 and MASQUE**, provided that the inbound, host, user credentials and transport satisfy the corresponding checks. `subscription_transport.rs` separately projects allowed client-side settings instead of copying server secrets. **A supported code path or passing unit test is not proof that every protocol/transport combination works in a particular Xray release or client app.** The feed only serves native Xray JSON, not URI/base64/Clash/Sing-box subscription formats.

A newly issued token may exist before any usable endpoint is configured: the API reports readiness separately. Publishing the URL requires working DNS, a trusted TLS certificate and reverse-proxy routes. A link being present does **not** prove VPN connectivity.

### SUBSCRIPTION STUDIO

The studio customizes the **implemented** portal: independent branding, RU/EN content, colors, optional logo, status/traffic/expiry cards, QR and copy-link, support links and built-in/custom client apps. Public HTML and JavaScript portal components are included in this repository. The editor preview is still a preview; the deployed view depends on saved settings and a reachable runtime endpoint.

## Nodes, enforcement and telemetry

**Node policies:** the control plane issues a signed envelope containing the Xray configuration digest. XMesh-Node validates it and keeps the last successfully applied state. Its local guard can enforce subscription expiration and bounded traffic usage while the panel is unavailable. This is **not an exact global quota guarantee across multiple disconnected nodes**: offline budgets are conservative and reconciliation can lag. Verify traffic blocking on a disposable test UUID; do not mistake a disabled UI label for confirmed disconnection.

**Node metrics:** the Linux agent reports CPU, memory, disk and network RX/TX to TimescaleDB. Network-interface counters may include SSH or other services and must **not** be used as per-user VPN usage.

**User traffic:** separately reported Xray StatsService counters are attributed to user, inbound and node. This requires a functioning managed Xray, local StatsService and updated collectors/agents. The first trusted sample becomes the baseline; earlier unobserved traffic is not reconstructed. Missing counters are not proof of zero usage.

Guides: [autonomous nodes](docs/AUTONOMOUS_NODES.md), [panel updates and per-user accounting](docs/PANEL_UPDATE_AND_TELEMETRY.md), [Ed25519 node identity](docs/SECURITY_NODE_IDENTITY.md).

### Per-node IP pool and rotation

The editor accepts **2–256 distinct public IPv4/IPv6 addresses** when rotation is enabled. Addresses must already exist on the VPS and serve the intended VPN endpoint; the panel does not provision them. The backend accepts **16,384 bytes** of pool text, including up to 256 full-length IPv6 addresses.

A PostgreSQL round-robin cursor is maintained per `(node_id, user_id)`. An authorized test endpoint exists at `POST /api/v1/nodes/{id}/rotation/next`. The public native Xray JSON handler uses a **sticky per-user/per-node address lease**. The default interval is **24 hours**, configurable from 1 to 720 hours in the node editor. Refreshes within the interval reuse the previous IP; after expiry, a transactional row lock advances the pool. Creating the token and generating an administrator preview never advance rotation. Only unambiguous direct-node host IPs or node-based fallback endpoints are rewritten; CDN domains, external proxies and ambiguous host mappings are intentionally left unchanged. Existing sessions are not interrupted.

## Administration and security

- **Owner / admin / viewer**, enforced by the Rust API.
- Argon2 password hashing, HttpOnly/SameSite sessions, login-attempt throttling and an audit trail.
- Optional **TOTP MFA** with standard authenticator apps and one-time recovery codes.
- Session lifetime, idle timeout and concurrent-session controls.
- A configured `/dashboard/...` login path; **a hidden path is not an authorization boundary**, nor a replacement for network access controls.
- **Ed25519-signed node requests** with anti-replay protections.

**Not guaranteed:** zero vulnerabilities, a complete infrastructure penetration test, perfectly strict cross-node offline quotas, or public-client support for every Xray protocol.

See [security audit and remaining risks](docs/SECURITY_AUDIT_2026-10-22.md) and [technical debt](docs/TECH_DEBT_AUDIT.md).

## Frontend and developer checks

The panel has RU/EN localization, light/dark themes, color customization, animation and layout controls. These primarily affect **presentation**, not the deployed Xray runtime.

Use **Node.js 24** for local frontend checks (the production backend is Rust; browser assets do not require a Node.js server):

```bash
node --check app.js
node scripts/check-node-ip-rotation.js
node scripts/check-node-editor-layout.js
node scripts/check-subscription-studio.js
node scripts/check-static-assets.js
node scripts/check-xray-tool-actions.js
node scripts/check-english-coverage.js
cargo test --manifest-path backend/Cargo.toml
cargo clippy --manifest-path backend/Cargo.toml --all-targets --all-features -- -D warnings -D clippy::pedantic -D clippy::nursery -F unsafe-code
```

Principal directories/files: `app.js`, `styles.css`, `xray-studio-v4.js`, `subscription-studio.js`, `backend/src/`, `deploy/`, `scripts/`. CI and unit checks cover only part of the product; they do **not** replace testing real node deployments and VPN clients.

## Release maturity and verification

Tracked improvement plan: **[Enterprise hardening roadmap](docs/ENTERPRISE_ROADMAP.md)** — seven workstreams with acceptance criteria and current status.

XMesh Nexus is under **active development**. Unit tests, cryptographic signatures, and administration features **are not a claim of certified enterprise or high-availability readiness**. `compose.yaml` deploys one API, one PostgreSQL/TimescaleDB instance and one Redis instance, without automatic database failover. Redis disk persistence is disabled (`appendonly no`, `save ""`): treat it as ephemeral and verify that temporary-state loss cannot undermine policy enforcement.

Before production use and after every update:

1. Review [GitHub Actions](https://github.com/TriplexCorp/XMesh-Nexus/actions) for frontend checks, Rust unit tests, Clippy (`-D warnings`), Docker build and API integration. **Passing individual test suites does not establish an entirely green CI run.**
2. On a disposable node, verify that disabling a user actually stops VPN traffic at Xray, not merely in the dashboard.
3. Verify local expiration and traffic enforcement during control-plane disconnection and reconciliation after reconnection.
4. Test off-host recovery of PostgreSQL **together with** node-policy signing keys and subscription/TOTP encryption secrets.
5. Exercise generated JSON in real client applications for each enabled protocol, security and transport combination.

Some static assertions under `scripts/` depend on source text and can fail after harmless refactors. Prefer behavioral validation and do not weaken runtime checks simply to make CI green.

## Known limitations at a glance

1. **Managed VPN nodes require XMesh-Node, real Xray and correctly configured VPS networking.** Panel settings alone are not applied-state confirmation.
2. **Public subscriptions produce native Xray JSON only.** Several protocols are implemented, but not every editor, transport and client-app combination has end-to-end verification.
3. **IP rotation is integrated into the public native JSON feed for unambiguous direct-node endpoints only.** CDN and external proxy hostnames are intentionally excluded.
4. **Per-user offline enforcement is bounded, not a strict global quota guarantee across disconnected nodes.**
5. **Operators must configure DNS, VPS firewall/addressing and any custom external proxy.** Standard Nginx HTTPS for the panel is already automated by `install.sh`; independently deployed nodes and their traffic still require validation.
6. **Network-interface RX/TX is not the same as Xray per-user accounting.**

---

[Русская документация](README.md) · [Autonomous node guide](docs/AUTONOMOUS_NODES.md) · [GitHub: XMesh-Node](https://github.com/TriplexCorp/XMesh-Node)
