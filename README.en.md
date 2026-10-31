# XMesh Nexus

<p align="center">
  <strong>A professional self-hosted control plane for Xray infrastructure.</strong><br>
  Nodes, users, subscriptions, XRAY STUDIO, XHTTP, FinalMask, routing, analytics, updates and a protected control plane — in one product.
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-6.0.0-6f42c1?style=for-the-badge">
  <img alt="Backend" src="https://img.shields.io/badge/backend-Rust%20%2F%20Axum-111827?style=for-the-badge">
  <img alt="Data plane" src="https://img.shields.io/badge/data%20plane-Xray--core-2563eb?style=for-the-badge">
  <img alt="Deploy" src="https://img.shields.io/badge/deploy-Docker%20Compose-2496ed?style=for-the-badge">
  <img alt="Languages" src="https://img.shields.io/badge/UI-RU%20%2F%20EN-16a34a?style=for-the-badge">
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick start</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="docs/README.md"><strong>Documentation</strong></a> ·
  <a href="docs/ENTERPRISE_ROADMAP.md"><strong>Roadmap</strong></a> ·
  <a href="README.md"><strong>Русский</strong></a>
</p>

---

## Operate infrastructure instead of operating every VPS by hand

**XMesh Nexus** turns separate Xray servers into managed infrastructure with a single control plane.

Instead of maintaining SSH procedures, JSON files, user scripts, certificates, monitoring and updates separately, an operator gets one panel for:

- enrolling and operating Xray nodes;
- managing users, groups, expiry and traffic limits;
- building advanced Xray profiles in **XRAY STUDIO**;
- configuring XHTTP, TLS, REALITY, FinalMask and routing;
- publishing subscriptions and native Xray JSON;
- observing actual runtime versions, traffic and telemetry;
- managing panel, Agent and Xray updates;
- protecting administrative and node-control workflows with RBAC, MFA, signed identity and the v6 strict-PQ control path.

> **Important:** XMesh Nexus is the **control plane**, not the VPN data plane. User VPN traffic is handled by **Xray-core on your VPS nodes**. This is self-hosted infrastructure: servers, DNS and network policy remain under your control.

---

## Why XMesh Nexus

| Manual operations | XMesh Nexus |
| --- | --- |
| Configure Xray separately on each VPS | **XRAY STUDIO**, reusable profiles and managed configuration delivery |
| SSH for every update | Managed **Agent / Xray / panel updates** with operation state |
| Users and quotas in custom scripts | Users, squads, expiry, quotas, traffic and subscriptions in one model |
| Same `/xhttp` and sample values everywhere | Cryptographically random XHTTP paths and randomized generation helpers |
| Advanced XHTTP requires raw JSON | Full card-based **XHTTP constructor** with Session ID, padding, uplink and XMUX |
| TLS/REALITY can be broken by over-aggressive automation | **Security is explicit:** TLS / REALITY / NONE is chosen by the operator |
| Client configuration assembled manually | **SUBSCRIPTION STUDIO**, native Xray JSON and a public portal |
| Client/server masks mixed together | Separate `finalmask` / `xmesh.clientFinalmask` with compatibility-aware tools |
| Scattered counters and logs | Node/system telemetry, Xray counters, user/inbound traffic and history |
| Application exposed directly | Loopback backend + Nginx HTTPS + random dashboard path |
| Simple bearer-style node control | Signed Node identity/operations + v6 strict-PQ operational path |

---

## Features

### Functional matrix

| Area | What XMesh Nexus provides |
| --- | --- |
| **Dashboard** | Infrastructure, user, node and operational overview |
| **Nodes** | Bootstrap/enrollment, online state, Agent/Xray versions, desired/applied state, Agent/Xray updates, restart/operations, traffic/quota, diagnostics and telemetry |
| **Users** | CRUD, enabled/disabled, expiry, traffic limits, subscriptions, detailed user card and per-user uTLS fingerprint |
| **Squads** | User grouping and centralized assignments |
| **Hosts** | Public endpoint address/domain/port, TLS/REALITY client metadata, fingerprint and infrastructure mapping |
| **XRAY STUDIO** | Composer, forms, raw JSON, diagnostics, profiles, transport/security configuration and advanced tools |
| **XHTTP** | `auto/packet-up/stream-up/stream-one`, random Path, headers, padding, Session ID, sequence, uplink, tuning, XMUX, H2/download settings and randomized profiles |
| **FinalMask** | TCP/UDP/QUIC catalog, client/server separation, compatibility filtering and randomized secrets/ranges/payloads |
| **Routing** | Separate node-routing and client-routing surfaces with GeoIP/GeoSite integration |
| **Subscriptions** | Independent tokens/revocation, public HTML portal, native Xray JSON, QR/copy, RU/EN, client apps, support links and User-Agent negotiation |
| **Analytics** | Node RX/TX, system metrics, Xray runtime, per-user/per-inbound traffic and historical measurements |
| **Security** | RBAC, observer least privilege, TOTP MFA/recovery, sessions, Redis login throttling, security boundaries and signed node identity |
| **Updates** | Owner-authorized panel update, managed Agent update, managed Xray update and runtime version confirmation |
| **v6 POSTQUANTUM** | Dedicated XSP-v2 strict-PQ Nexus↔Agent operational path with fail-closed policy and evidence-bound activation |

---

## XRAY STUDIO

XRAY STUDIO is designed for both guided profile construction and expert work with real Xray JSON.

It provides:

- Composer and structured editing;
- raw JSON editing;
- syntax/semantic diagnostics and targeted fixes;
- multi-inbound configuration;
- transport-aware settings;
- TLS and REALITY;
- full XHTTP constructor;
- FinalMask tooling;
- advanced client-side configuration;
- validation for known incompatible combinations.

### Security is operator-controlled

The panel does **not** infer TLS from protocol or transport.

| `streamSettings.security` | Behavior |
| --- | --- |
| `tls` | TLS certificate mode is active and `tlsSettings` are exposed/preserved |
| `reality` | REALITY is selected; certificate TLS is not auto-enabled |
| `none` | stream certificate TLS is disabled |

This preserves advanced profiles such as **VLESS + XHTTP + NONE**, including cases where the operator intentionally uses VLESS Encryption.

Read the full [XRAY STUDIO Operator Guide](docs/XRAY_STUDIO_GUIDE.md).

---

## Full XHTTP constructor

The XHTTP tool exposes much more than `path` and `mode`.

The FinalMask-style card menu covers:

- `auto`, `packet-up`, `stream-up`, `stream-one`;
- Path / Host / Mode;
- **cryptographically random Path** instead of a universal `/xhttp` value;
- browser header profiles and custom headers JSON;
- XPadding bytes/placement/method/key/header and obfuscation;
- `noGRPCHeader` / `noSSEHeader`;
- Session ID placement/key/table/length;
- sequence placement/key;
- uplink method/data placement/key/chunk size;
- packet-up and stream-up tuning;
- the full XMUX field set;
- `serverMaxHeaderBytes`;
- `downloadSettings` and `h2Params`;
- a **Full randomized profile** with preview before apply;
- complete Advanced JSON for uncommon scenarios.

Existing custom paths are preserved during unrelated edits.

---

## FinalMask — TCP, UDP and QUIC

XRAY STUDIO exposes a broad FinalMask catalog while keeping server and client configuration distinct.

| Direction | Families |
| --- | --- |
| **TCP** | Sudoku, Header Custom, Fragment, XMC, Filter |
| **UDP** | Salamander/Gecko, Sudoku, Header Custom, mKCP Legacy, Noise, `udphop`, XDNS, XICMP, Realm, Filter |
| **QUIC** | client `quicParams` |

Incompatible choices can remain discoverable while being disabled with an explanation. New basic presets no longer reuse identical samples everywhere: Fragment, Noise and Header Custom receive randomized values, while Sudoku/Salamander use cryptographic secrets.

See [FINALMASK_COMPATIBILITY.md](docs/FINALMASK_COMPATIBILITY.md).

---

## Users, Hosts and per-user fingerprint

Fingerprint inheritance has two levels:

```text
individual user fingerprint
          ↓
     host fingerprint
          ↓
        chrome
```

- New Hosts really store/use Chrome as the default rather than an empty value with only a UI hint.
- The user card provides an individual override.
- **Default** means live inheritance from the Host.
- If the Host fingerprint changes later, users still on Default inherit the new value.
- A custom user fingerprint changes only that user's exported client configuration.

---

## SUBSCRIPTION STUDIO

Nexus is both an infrastructure control plane and a client-configuration delivery system.

### Public portal

SUBSCRIPTION STUDIO controls the actual public portal, including:

- name/branding;
- colors;
- optional logo;
- RU/EN content;
- subscription status;
- traffic and expiry cards;
- QR code;
- copy-link UX;
- support links;
- built-in and custom client applications.

### Native Xray JSON

The Rust exporter builds client configurations for implemented protocol families including VLESS, VMess, Trojan, Shadowsocks/SS2022, Hysteria2 and MASQUE, subject to valid transport/security settings and client support.

XMesh intentionally does not claim universal compatibility with every Xray feature and every third-party client. Unsupported or incomplete combinations should fail closed.

See [SUBSCRIPTION_SECURITY.md](docs/SUBSCRIPTION_SECURITY.md) and [XRAY_CLIENT_EXPORT_MATRIX.md](docs/XRAY_CLIENT_EXPORT_MATRIX.md).

---

## Node runtime and evidence

A Node is more than an IP address in a table.

Nexus can track:

- distinct VPS identity;
- bootstrap/enrollment;
- Agent heartbeat and version;
- Xray version/process state;
- desired vs applied revisions;
- profile/application attestation where available;
- system/network telemetry;
- traffic accounting and quota state;
- managed Agent/Xray updates;
- operational errors and diagnostics.

**Queued is not completed.** An accepted update/restart/config request must be followed by fresh runtime/heartbeat evidence before the operation is considered successful.

---

## Routing, GeoData and analytics

- **Node Routing** manages routing on the Xray VPS.
- **Client Routing** manages rules that may be projected into client JSON.
- **GeoData** manages GeoIP/GeoSite source/update state.
- **Statistics** cover node RX/TX, system metrics, Xray/user/inbound counters and historical data.

Docs: [NODE_ROUTING.md](docs/NODE_ROUTING.md) · [CLIENT_ROUTING.md](docs/CLIENT_ROUTING.md) · [GEODATA_ROUTING.md](docs/GEODATA_ROUTING.md).

---

## Security architecture

### Administrative plane

- RBAC;
- read-only observer boundary;
- TOTP MFA and recovery controls;
- session management/revocation;
- Redis-backed login throttling;
- secure cookies;
- encrypted persistent MFA/subscription secrets;
- per-install random dashboard path;
- panel backend bound to loopback behind Nginx HTTPS.

### Node trust

- signed node identity;
- signed/authorized policy and operations;
- runtime verification rather than trusting a UI click;
- fail-closed handling of missing or invalid security evidence.

### v6 strict-PQ control plane

XMesh Nexus v6 includes the production XSP-v2 runtime in the standard install/update lifecycle. Operational node control is separated from ordinary panel HTTPS and uses a dedicated strict-PQ ingress.

The policy includes TLS 1.3 `X25519MLKEM768`, ML-DSA-65 material and no automatic classical fallback on the strict-PQ operational path.

The repository contains **real bounded production activation/finalization evidence for Node 13**. This is deliberately not marketed as “every node is already post-quantum.”

Evidence: [production activation](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) · [PQ-only security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [P0-E checkpoint](P0E_CHECKPOINT.md).

---

# Quick start

## Requirements

- **Ubuntu 22.04 or 24.04 LTS**;
- public panel domain;
- DNS A/AAAA pointing to the VPS;
- inbound **TCP/80**;
- inbound **TCP/443**;
- inbound **TCP/8444** for the v6 operational node control plane;
- root/sudo;
- outbound Internet access.

Docker, Docker Compose, Nginx and Certbot do not need to be preinstalled.

## 1. Install

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
bash install.sh
```

The installer asks for the panel domain and Let's Encrypt email.

Non-interactive example:

```bash
PANEL_DOMAIN=panel.example.org \
PANEL_ACME_EMAIL=admin@example.org \
bash install.sh
```

## 2. What the installer configures

`install.sh`:

- installs Docker Engine + Compose/Buildx;
- installs Nginx mainline and Certbot;
- generates `.env` and independent secrets;
- generates a random `DASHBOARD_PATH`;
- starts PostgreSQL/TimescaleDB and Redis;
- builds/starts the Rust panel;
- provisions the v6 strict-PQ foundation;
- starts the mandatory product gateway/ingress;
- obtains a Let's Encrypt certificate;
- enables HTTP→HTTPS;
- keeps the Rust backend on `127.0.0.1`;
- installs host-side update helpers.

## 3. Read the initial URL and credentials

On the server:

```bash
sudo grep -E '^(ADMIN_USERNAME|ADMIN_PASSWORD|DASHBOARD_PATH)=' .env
```

Open:

```text
https://<your-domain><DASHBOARD_PATH>
```

Never paste `.env` contents into public issues, logs or support chats.

## 4. Verify services

```bash
docker compose --profile xsp-v2-product ps
sudo nginx -t
```

## 5. Add the first Node

1. Open **Nodes**.
2. Create a separate Node record.
3. Use **Connect node and metrics**.
4. Run the generated bootstrap command on the target VPS.
5. Wait for a fresh heartbeat.
6. Verify Agent/Xray versions and runtime state.

## 6. Build the first profile

1. Open **XRAY STUDIO**.
2. Choose protocol/transport.
3. Explicitly select Security: TLS / REALITY / NONE.
4. Configure XHTTP/FinalMask if required.
5. Save and assign the profile to the Node.
6. Wait for confirmed applied state.
7. Create a Host and User.
8. Validate the resulting subscription/client JSON with a real client.

Full installation/troubleshooting: [docs/INSTALLATION.md](docs/INSTALLATION.md).

---

## Architecture

```text
                       ┌─────────────────────────────┐
                       │         Administrator       │
                       └──────────────┬──────────────┘
                                      │ HTTPS :443
                                      ▼
                       ┌─────────────────────────────┐
                       │      Nginx + Let's Encrypt  │
                       └──────────────┬──────────────┘
                                      │ loopback
                                      ▼
┌────────────────┐      ┌─────────────────────────────┐      ┌────────────────┐
│ PostgreSQL /   │◄────►│  XMesh Nexus · Rust/Axum    │◄────►│     Redis      │
│ TimescaleDB    │      │  users · nodes · configs    │      │ auth/throttle  │
└────────────────┘      └──────────────┬──────────────┘      └────────────────┘
                                      │ strict-PQ v6 :8444
                                      ▼
                       ┌─────────────────────────────┐
                       │       XMesh Node / Agent    │
                       └──────────────┬──────────────┘
                                      │ manages
                                      ▼
                       ┌─────────────────────────────┐
                       │          Xray-core          │
                       │  TLS/REALITY · routing      │
                       │  XHTTP · FinalMask · stats  │
                       └──────────────┬──────────────┘
                                      │ VPN traffic
                                      ▼
                               Client devices
```

---

## Updates

Installed panels support an **owner-authorized web update** path. The API does not receive the Docker socket or execute arbitrary shell; it writes a fixed request marker and a root-owned systemd worker runs `xmeshctl --web-update` with locking and a PostgreSQL backup before pull/rebuild.

`queued` / HTTP `202` means request acceptance only. Verify the final status and actual running version after the update.

See [PANEL_UPDATE_AND_TELEMETRY.md](docs/PANEL_UPDATE_AND_TELEMETRY.md).

---

# Documentation

The README is the product landing page. Detailed engineering and operator material lives under `docs/`.

| Document | Purpose |
| --- | --- |
| **[Documentation Index](docs/README.md)** | Entry point for all current documentation |
| **[Product Guide](docs/PRODUCT_GUIDE.md)** | Full feature set and subsystem boundaries |
| **[Installation & Operations](docs/INSTALLATION.md)** | Installation, ports, HTTPS, updates, backup and troubleshooting |
| **[XRAY STUDIO Guide](docs/XRAY_STUDIO_GUIDE.md)** | Security semantics, XHTTP, FinalMask, fingerprint and client projection |
| **[Development Checkpoint](docs/DEVELOPMENT_CHECKPOINT_2026-10-31.md)** | Critical implementation contracts for future development |
| [FinalMask Compatibility](docs/FINALMASK_COMPATIBILITY.md) | Server/client/transport compatibility |
| [Client Export Matrix](docs/XRAY_CLIENT_EXPORT_MATRIX.md) | Client JSON projection support |
| [Autonomous Nodes](docs/AUTONOMOUS_NODES.md) | Agent/node operation model |
| [Panel Update & Telemetry](docs/PANEL_UPDATE_AND_TELEMETRY.md) | Update workflow and telemetry/accounting |
| [Node Identity Security](docs/SECURITY_NODE_IDENTITY.md) | Signed node trust |
| [Subscription Security](docs/SUBSCRIPTION_SECURITY.md) | Public subscription security |
| [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) | Engineering/release readiness |
| [Strict-PQ Production Evidence](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) | Bounded production activation evidence |

---

## Technology

| Layer | Stack |
| --- | --- |
| Backend | Rust · Tokio · Axum |
| Persistent data | PostgreSQL 18 · TimescaleDB |
| Temporary/auth state | Redis 7 |
| VPN data plane | Xray-core |
| Node control | XMesh Node / Agent |
| Deployment | Docker Engine · Docker Compose |
| Public web | Nginx · Let's Encrypt / Certbot |
| Control-plane PQ | XSP-v2 · TLS 1.3 hybrid ingress · ML-DSA-65 |
| Frontend | Browser-native HTML/CSS/JavaScript · RU/EN |

---

## Honest limitations

A professional control plane should make boundaries explicit.

- XMesh does not provide VPS capacity automatically.
- DNS, firewall, NAT and open ports still have to be correct.
- Editor support does not guarantee every combination works in every third-party client.
- Saved JSON is not proof that a Node applied the configuration.
- Green CI is not proof that a specific production VPS updated successfully.
- SUBSCRIPTION STUDIO preview is not proof that the public URL is Internet-reachable.
- Strict-PQ activation evidence is bounded to the rollout/evidence actually verified, not automatically every Node.
- Root access to the Nexus host remains a high-trust role; this is not an HSM boundary.

XMesh is built around **explicit state, verifiable operations and fail-closed behavior** rather than hiding these limits.

---

## Development status

XMesh Nexus is under active development. Core feature paths are exercised by a large Backend CI suite covering frontend regressions, Rust formatting/tests, strict Clippy, Docker build and disposable PostgreSQL/Redis API integration.

Current release gates and unfinished work are tracked in the [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md). Current UX/implementation invariants are preserved in the [Development Checkpoint](docs/DEVELOPMENT_CHECKPOINT_2026-10-31.md).

---

<p align="center">
  <strong>XMesh Nexus — one control plane for infrastructure that would otherwise be assembled from SSH, JSON, scripts and separate dashboards.</strong>
</p>
