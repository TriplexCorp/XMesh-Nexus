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

## Manage infrastructure instead of managing dozens of VPS servers by hand

**XMesh Nexus** turns independent Xray servers into one managed infrastructure control plane.

Instead of permanent SSH sessions, hand-edited JSON and separate scripts for users, certificates, telemetry and updates, operators can:

- enroll and operate Xray nodes;
- manage users, groups, expiry and traffic limits;
- build advanced Xray profiles with **XRAY STUDIO**;
- configure XHTTP, TLS, REALITY, FinalMask and routing;
- publish subscriptions and native Xray JSON;
- inspect real runtime versions, traffic and telemetry;
- manage panel, Agent and Xray updates;
- protect administration and node control with RBAC, MFA, signed identity and the v6 strict-PQ transport.

> **Important:** XMesh Nexus is the **control plane**, not the VPN data plane. User VPN traffic is handled by **Xray-core on your VPS nodes**. Servers, DNS and networking remain under your control.

---

## Why XMesh Nexus

| Manual operations | XMesh Nexus |
| --- | --- |
| Configure Xray separately on every VPS | **XRAY STUDIO**, profiles and managed configuration delivery |
| SSH for every update | Managed **Agent / Xray / panel updates** with operation state |
| Custom scripts for users and limits | Users, squads, expiry, quotas, traffic and subscriptions in one model |
| Identical `/xhttp` templates everywhere | Cryptographically random XHTTP paths and randomized helpers |
| Hand-written advanced XHTTP | Full card-based **XHTTP constructor** with Session ID, padding, uplink and XMUX |
| Ambiguous TLS/REALITY automation | Explicit Security selection: TLS / REALITY / NONE |
| Hand-built client configs | **SUBSCRIPTION STUDIO** + native Xray JSON + public portal |
| Server/client masking settings mixed together | Separate `finalmask` / `xmesh.clientFinalmask` with compatibility-aware UI |
| Fragmented counters and logs | Node/system telemetry, Xray counters, user/inbound traffic and history |
| Different public ports for web and service APIs | **One public TCP/443:** an SNI multiplexer separates web and strict-PQ control traffic |
| Simple bearer-style node trust | Signed Node identity/commands + v6 strict-PQ operational control path |

---

## Features

| Subsystem | What XMesh Nexus provides |
| --- | --- |
| **Dashboard** | Infrastructure, user, node and operational state overview |
| **Nodes** | Bootstrap/enrollment, online state, Agent/Xray versions, desired/applied state, updates, operations, traffic/quota, diagnostics and telemetry |
| **Users** | CRUD, enabled/disabled, expiry, traffic limits, subscription access, detailed user view and per-user uTLS fingerprint |
| **Squads** | User grouping and centralized assignment management |
| **Hosts** | Public endpoint address/domain/port, TLS/REALITY client metadata, fingerprint and infrastructure association |
| **XRAY STUDIO** | Composer, forms, raw JSON, diagnostics, profiles, transport/security settings and advanced tooling |
| **XHTTP** | `auto/packet-up/stream-up/stream-one`, random Path, headers, padding, Session ID, sequence, uplink, tuning, XMUX, H2/download settings and randomized profiles |
| **FinalMask** | TCP/UDP/QUIC catalog, server/client separation, compatibility filtering and random secrets/ranges/payloads |
| **Routing** | Separate node-routing and client-routing surfaces plus GeoIP/GeoSite integration |
| **Subscriptions** | Independent tokens, revoke, public HTML portal, native Xray JSON, QR/copy, RU/EN, client apps, support links and User-Agent negotiation |
| **Analytics** | Node RX/TX, system metrics, Xray runtime, per-user/per-inbound traffic and historical measurements |
| **Security** | RBAC, observer least privilege, TOTP MFA/recovery, sessions, Redis login throttling, audit boundaries and signed node identity |
| **Updates** | Owner-authorized panel update, managed Agent update, managed Xray update and runtime version confirmation |
| **v6 POSTQUANTUM** | XSP-v2 strict-PQ Nexus↔Agent operational path with fail-closed policy and evidence-bound activation |

---

## XRAY STUDIO

XRAY STUDIO combines a structured composer with direct access to real Xray JSON.

It includes:

- structured editing and raw JSON;
- syntax/semantic diagnostics and targeted fixes;
- multiple inbounds;
- transport-aware settings;
- TLS and REALITY;
- the XHTTP constructor;
- FinalMask;
- advanced client-side parameters;
- checks for known incompatible combinations.

### Operator-controlled security

| `streamSettings.security` | Behavior |
| --- | --- |
| `tls` | TLS certificate mode and `tlsSettings` are active |
| `reality` | REALITY is used |
| `none` | Stream TLS is disabled |

Guide: [XRAY STUDIO Operator Guide](docs/XRAY_STUDIO_GUIDE.md).

---

## XHTTP constructor

The XHTTP workspace covers:

- `auto`, `packet-up`, `stream-up`, `stream-one`;
- Path / Host / Mode;
- cryptographically random Path generation;
- browser/custom headers;
- `xPaddingBytes`, placement/method/key/header and obfuscation;
- `noGRPCHeader` / `noSSEHeader`;
- Session ID placement/key/table/length;
- sequence placement/key;
- uplink method/data placement/key/chunk size;
- packet-up and stream-up tuning;
- full XMUX;
- `serverMaxHeaderBytes`;
- `downloadSettings` and `h2Params`;
- Full randomized profile preview;
- Advanced JSON for rare scenarios.

Existing custom paths are not silently replaced during ordinary editing.

---

## FinalMask — TCP, UDP and QUIC

| Direction | Families |
| --- | --- |
| **TCP** | Sudoku, Header Custom, Fragment, XMC, Filter |
| **UDP** | Salamander/Gecko, Sudoku, Header Custom, mKCP Legacy, Noise, `udphop`, XDNS, XICMP, Realm, Filter |
| **QUIC** | client `quicParams` |

Incompatible choices are disabled with a reason. New base presets use randomized values where appropriate; Sudoku/Salamander use cryptographic secrets.

Matrix: [FINALMASK_COMPATIBILITY.md](docs/FINALMASK_COMPATIBILITY.md).

---

## Users, Hosts and fingerprints

Fingerprint resolution is:

```text
individual user fingerprint
          ↓
     host fingerprint
          ↓
        chrome
```

A user can inherit the Host value or override it without changing the Host itself.

---

## SUBSCRIPTION STUDIO

The public portal supports branding, RU/EN content, colors, optional logo, subscription status, traffic/expiry, QR, copy-link, support links and built-in/custom client applications.

Native Xray JSON generation covers implemented protocol families including VLESS, VMess, Trojan, Shadowsocks/SS2022, Hysteria2 and MASQUE when transport/security settings are valid and the target client supports them.

Docs: [SUBSCRIPTION_SECURITY.md](docs/SUBSCRIPTION_SECURITY.md) · [XRAY_CLIENT_EXPORT_MATRIX.md](docs/XRAY_CLIENT_EXPORT_MATRIX.md).

---

## Nodes: bootstrap to runtime evidence

Nexus tracks distinct VPS identity, enrollment, Agent heartbeat/version, Xray version/process state, desired/applied revisions, profile attestation where available, telemetry, traffic/quota, managed updates and operation errors.

**Queued ≠ completed.** Request acceptance is not proof that a runtime operation succeeded; final state must come from fresh runtime/heartbeat evidence.

---

## Routing, GeoData and analytics

- **Node Routing** — Xray routing on managed VPS nodes.
- **Client Routing** — rules projected into client JSON where supported.
- **GeoData** — GeoIP/GeoSite sources and operational state.
- **Statistics** — node RX/TX, system metrics, Xray/user/inbound counters and history.

Docs: [NODE_ROUTING.md](docs/NODE_ROUTING.md) · [CLIENT_ROUTING.md](docs/CLIENT_ROUTING.md) · [GEODATA_ROUTING.md](docs/GEODATA_ROUTING.md).

---

## Security and the v6 control plane

Administrative security includes RBAC, observer boundaries, TOTP MFA/recovery, session controls, Redis-backed login throttling, secure cookies, persistent encrypted secrets and a random dashboard path. The Rust application remains on loopback.

Node trust uses signed identity/operations, runtime verification and fail-closed handling of missing or invalid evidence.

### v6 strict-PQ control plane also uses public TCP/443

Operational node control **does not require a second public port**.

A single external `TCP/443` accepts both connection classes. A host-side SNI multiplexer **does not terminate TLS**; it only routes the ClientHello:

- the normal panel FQDN → loopback Nginx TLS for web/admin/subscriptions;
- `node-ingress.xsp.invalid` → the separate loopback strict-PQ ingress.

The web panel and operational control path therefore share one public port without sharing one TLS security boundary. The strict-PQ ingress still independently requires TLS 1.3 `X25519MLKEM768`, ML-DSA-65 client identity and fail-closed policy.

Port `8444` is only an internal loopback backend between the public 443 multiplexer and the strict-PQ ingress. **Do not open TCP/8444 in the firewall.**

Evidence: [XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) · [PQ-only policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [P0-E checkpoint](P0E_CHECKPOINT.md).

---

# Quick start

## Requirements

- **Ubuntu 22.04 or 24.04 LTS**;
- a public panel FQDN and correct DNS A/AAAA;
- public **TCP/80** for ACME/redirect;
- public **TCP/443** for the panel, subscriptions and v6 operational node control;
- root/sudo;
- outbound Internet access.

**No public TCP/8444 is required. It must remain closed externally.**

Docker, Docker Compose, Nginx, HAProxy and Certbot are installed by the installer.

## Install

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
bash install.sh
```

Non-interactive:

```bash
PANEL_DOMAIN=panel.example.org \
PANEL_ACME_EMAIL=admin@example.org \
bash install.sh
```

The installer creates secrets and a random dashboard path, starts PostgreSQL/TimescaleDB and Redis, builds the Rust panel, provisions the v6 strict-PQ foundation, starts the product gateway/ingress, obtains the Let's Encrypt certificate and configures the single public TCP/443 topology.

Internally:

- panel TLS terminates on loopback `127.0.0.1:8443`;
- strict-PQ ingress listens through loopback `127.0.0.1:8444`;
- HAProxy owns public TCP/443 and routes by SNI without terminating TLS;
- the Rust backend remains loopback-only.

Get initial access values:

```bash
sudo grep -E '^(ADMIN_USERNAME|ADMIN_PASSWORD|DASHBOARD_PATH)=' .env
```

Open:

```text
https://<your-domain><DASHBOARD_PATH>
```

Verify:

```bash
docker compose --profile xsp-v2-product ps
sudo nginx -t
sudo systemctl status xmesh-https-mux --no-pager
sudo ss -ltnp '( sport = :443 or sport = :8444 )'
```

Expected: `443` is public; `8444` is bound only to `127.0.0.1`.

Full operations guide: [docs/INSTALLATION.md](docs/INSTALLATION.md).

---

## Architecture

```text
 Internet
    │
    │ TCP/443 — only public HTTPS/control port
    ▼
┌──────────────────────────────────────────────┐
│ HAProxy SNI multiplexer (TLS passthrough)    │
│                                              │
│ panel.example.org ───────┐                   │
│ node-ingress.xsp.invalid ├──────────────┐    │
└──────────────────────────┼──────────────┼────┘
                           │              │
                 loopback  │              │ loopback
                           ▼              ▼
                  Nginx TLS :8443   strict-PQ ingress :8444
                           │              │
                           ▼              │ XSP-v2
                    XMesh Nexus           │
                    Rust / Axum           │
                           │              │
                PostgreSQL / Redis        ▼
                                      XMesh Agent
                                           │
                                           ▼
                                       Xray-core
```

Ports `8443` and `8444` are internal loopback ports, not firewall requirements.

---

## Updates

### Manual CLI update

The supported operator-facing terminal update path is:

```bash
cd /path/to/XMesh-Nexus
sudo bash xmeshctl
```

Then choose:

```text
4) Обновить из GitHub и пересобрать
```

The CLI asks for confirmation, creates a PostgreSQL backup, fetches and fast-forwards the configured upstream branch, runs installer preparation, validates Docker Compose and rebuilds the stack. On a managed host when run as root, it also reapplies the host-side single-public-443 topology.

`xmeshctl --web-update` is the internal non-interactive entrypoint used by the owner-authorized web/systemd updater; operators should normally use `sudo bash xmeshctl` for manual updates.

### Web update

The owner-authorized web update path does not give the API a Docker socket or arbitrary shell. A root-owned worker runs `xmeshctl --web-update` with locking and a PostgreSQL backup.

The host installer reapplies the single-443 topology during upgrade and recreates the current v6 product gateway/ingress so an old public `:8444` mapping cannot survive an upgrade.

More: [CLI update](docs/CLI_UPDATE.md) · [Panel Update & Telemetry](docs/PANEL_UPDATE_AND_TELEMETRY.md).

---

## Documentation

| Document | Purpose |
| --- | --- |
| **[Documentation Index](docs/README.md)** | Entry point for current documentation |
| **[Product Guide](docs/PRODUCT_GUIDE.md)** | Full product feature set and subsystem boundaries |
| **[Installation & Operations](docs/INSTALLATION.md)** | Installation, public 80/443 topology, updates, backup and troubleshooting |
| **[CLI Update](docs/CLI_UPDATE.md)** | Manual panel update through `sudo bash xmeshctl` |
| **[XRAY STUDIO Guide](docs/XRAY_STUDIO_GUIDE.md)** | Security semantics, XHTTP, FinalMask, fingerprint and client projection |
| **[Development Checkpoint](docs/DEVELOPMENT_CHECKPOINT_2026-10-31.md)** | Critical contracts for future development |
| [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) | Engineering and release readiness |
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
| Public TCP/443 | HAProxy SNI passthrough |
| Panel TLS | Nginx · Let's Encrypt / Certbot |
| Control-plane PQ | XSP-v2 · TLS 1.3 hybrid ingress · ML-DSA-65 |
| Frontend | Browser-native HTML/CSS/JavaScript · RU/EN |

---

## Operational limits

- XMesh does not provide VPS infrastructure automatically.
- DNS, firewall and NAT remain operator responsibilities.
- Standard v6 requires public **80/tcp and 443/tcp only; 8444/tcp must stay externally closed**.
- Editor support is not a guarantee for every third-party client combination.
- Saved JSON is not proof that a Node applied it.
- Green CI is not proof that a production VPS updated.
- Strict-PQ evidence applies to its bounded rollout, not automatically to every Node.
- Root on the Nexus host remains a high-trust role; this is not an HSM boundary.

XMesh is built around **explicit state, verifiable operations and fail-closed behavior**.