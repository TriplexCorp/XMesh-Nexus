# XMesh Nexus

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

## XSP-v2 — hybrid post-quantum security status (October 27, 2026)

**Laboratory implementation exists; protection is not deployed to live nodes.** PR01 provides a draft [domain-separated wire specification](docs/XSP_V2_WIRE_SPEC.md) with identical Node/Nexus test vectors. PR02 contains isolated Rust/OpenSSL 3.5 and Go 1.27.3 **Ed25519 AND ML-DSA-65** implementations; direct **Go → Rust and Rust → Go** signed-message interchange rejects missing/corrupted signatures, key substitution and tampered messages. [Crypto PoC and gates](docs/XSP_V2_CRYPTO_POC.md) · [Nexus crypto CI (passed)](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40431220079).

**PR07 laboratory TLS probe:** an isolated Go 1.27.3 diagnostic client and OpenSSL 3.5 test terminator demonstrate a real TLS 1.3 full handshake with the **negotiated** `X25519MLKEM768` group, validated certificate chain and hostname, and fail-closed behavior against TLS 1.2, X25519-only TLS 1.3, invalid CA/name and resumptions. [Technical probe and deployment prerequisites](docs/XSP_V2_TLS_PROBE.md) · [TLS CI (passed)](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40432661499) · [Node CI (passed)](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40433732915) · [Nexus Backend CI (passed at `918d42fa`)](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40432809267). CI results are scoped to those specific commits, not to subsequent documentation edits.

**P0 foundation (October 27):** Node now has an isolated **test-only strict envelope decoder** (duplicate-key rejection, canonical Base64, fixed endpoint registry, signed-byte vectors) and **in-memory ephemeral** Ed25519 + ML-DSA-65 key generation. Nexus has additive tables holding **PUBLIC** keys, key epochs, suite-floor state and replay nonces plus a non-installed **loopback-only** Nginx TLS 1.3/X25519MLKEM768 template that returns 404 for every HTTP path. This is a scaffold, **not** deployed signature verification, protected private-key persistence or an operational node-only API. [Foundation deliverables, tests and blocking security gates](docs/XSP_V2_P0_FOUNDATION.md).

**P0 staging-only experiments (October 27):** A Cargo feature-gated Rust `POST /api/v2/node/heartbeat` verifies **Ed25519 AND ML-DSA-65** over identical signed bytes against registered database public keys, then atomically reserves a nonce. It exists only with `xsp-v2-experimental` and requires the explicit `XSP_V2_EXPERIMENTAL_HEARTBEAT=staging-only` runtime flag. It returns an **unsigned 204** without config, commands, or ACK. Standard Docker builds do not contain this route or the OpenSSL dependency.

An isolated Go 1.27.3 **AES-256-GCM research vault** provides root-protected private-key encryption, external wrapping-key file, and epoch-controlled rotation. The separate lab CI starts **real Nginx**, validates TLS1.3/X25519MLKEM768, trusted hostname, downgrade refusal and 404-only HTTP routing. Neither tool is deployed on live Nodes. [Security scope and remaining acceptance gates](docs/XSP_V2_EXPERIMENTAL_GATEWAY.md).
**Production boundary:** none of these PoCs changes the running `XMESH1`/Ed25519 authentication, Node Go 1.23 runtime, Nginx public TLS setup, Xray data plane or API. No Node or panel has been claimed to use strict-PQ. There is no deployed two-signature endpoint, persistent `minimumSuite`, key lifecycle, or proven TLS negotiation across every CDN/LB → origin hop. **Next:** protocol/security review, external FIPS 204 KATs and fuzzing, approved node-only TLS terminator, disposable-canary evidence and staged enrollment/recovery before any strict activation. Track this in the [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) and [full security implementation plan](docs/HYBRID_POST_QUANTUM_SECURITY_IMPLEMENTATION_PLAN.md).

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
