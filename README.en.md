# XMesh Nexus

**Documentation:** [Русский](README.md) · **English**

**XMesh Nexus** is a self-hosted Xray-core infrastructure management panel for users, nodes, hosts, squads, XRAY STUDIO, subscriptions, monitoring and administration. The API is built with **Rust (Tokio/Axum)**, persistent data uses **PostgreSQL 18 + TimescaleDB**, ephemeral state uses **Redis 7**, and the panel is deployed with Docker Compose.

> **Source-code status as of October 23, 2026:** this is an actively developed project. The repository **does** include public subscription endpoints, native Xray client JSON generation, managed-node integration and Xray-derived user traffic accounting. Running VPN traffic still requires a separately installed [XMesh-Node](https://github.com/TriplexCorp/XMesh-Node) runtime on each VPS, working Xray configuration and correct networking. A feature existing in the code or UI does not prove that a particular node has applied it successfully.

## Implementation status

| Area | Implemented | Prerequisites / limits |
| --- | --- | --- |
| **Control plane** | Web panel, Rust API, server-side storage of users, nodes, hosts, squads and settings | A saved panel state is not proof of applied node state |
| **XRAY STUDIO** | Editable and validated Xray JSON, profile tools, inbound/host/node associations | The public subscription generator does not support every protocol offered by the editor |
| **Managed nodes** | Ed25519 enrollment, signed requests, heartbeats, desired configuration, restart/update commands | Node-side execution is provided by [XMesh-Node](https://github.com/TriplexCorp/XMesh-Node) |
| **Subscriptions** | Token issuing/revocation, public URL, HTML portal, native Xray JSON, RU/EN, User-Agent device negotiation | Public outbound generation is currently **VLESS-oriented** and needs valid user, squad, profile and endpoint data |
| **SUBSCRIPTION STUDIO** | Domain/name, portal appearance, client-app catalog, JSON and balancer settings | DNS, HTTPS and reverse-proxy routing are operator responsibilities |
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

The panel provides `POST /api/v1/node/desired-config` with a desired Xray configuration, revision and signed policy. A separate node worker validates, tests and applies this data. **Automatic local-port mapping currently requires exactly one inbound in the assigned XRAY STUDIO profile**; do not assume arbitrary multi-inbound profiles work through that path.

Restart and update requests are asynchronous. A successfully queued request is not a verified restart: inspect agent heartbeat, operation status and the actual Xray process. See [autonomous nodes and signed policies](docs/AUTONOMOUS_NODES.md).

## Install the panel

Requirements: Linux, Docker Engine, Docker Compose plugin, Git and OpenSSL.

```bash
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
chmod +x install.sh
./install.sh
```

The installer provisions `.env`, secrets, the initial administrator and a dashboard entry path. Store the credentials and keys securely. Never commit `.env` or subscription tokens.

By default, the host exposes the panel on **`127.0.0.1:8080`**. Put an **HTTPS reverse proxy** in front of it, keep the admin API private and do not expose PostgreSQL or Redis to the internet. Keep `COOKIE_SECURE=true` in production.

```bash
docker compose ps
docker compose logs --tail=100 panel
docker compose logs --tail=100 db
bash xmeshctl
```

The `xmeshctl` helper supports operational checks, logs, backups and updates. **Do not use `docker compose down -v` for routine upgrades**: it deletes persistent volumes.

### Update

Frontend assets are baked into the panel image. A `git pull` alone does not refresh the running container:

```bash
git pull --ff-only origin main
docker compose up -d --build
```

Back up first, then check panel logs and node health. Updating the control plane **does not automatically prove that every node runtime is current**. See [panel updates and telemetry](docs/PANEL_UPDATE_AND_TELEMETRY.md).

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

**Current protocol scope:** the public outbound assembler in `user_subscriptions.rs` builds **VLESS** client connections. VMess, Trojan, Shadowsocks and other protocol editors existing in XRAY STUDIO **do not imply those protocols are supported by the public subscription endpoint**. This endpoint outputs native Xray JSON; it is not a general URI/base64/Clash/Sing-box subscription-format service.

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
cargo test --manifest-path backend/Cargo.toml
```

Principal directories/files: `app.js`, `styles.css`, `xray-studio-v4.js`, `subscription-studio.js`, `backend/src/`, `deploy/`, `scripts/`. CI and unit checks cover only part of the product; they do **not** replace testing real node deployments and VPN clients.

## Known limitations at a glance

1. **Managed VPN nodes require XMesh-Node, real Xray and correctly configured VPS networking.** Panel settings alone are not applied-state confirmation.
2. **Public subscriptions exist, but client assembly is currently VLESS-focused and native-Xray-JSON-only.**
3. **IP rotation is integrated into the public native JSON feed for unambiguous direct-node endpoints only.** CDN and external proxy hostnames are intentionally excluded.
4. **Per-user offline enforcement is bounded, not a strict global quota guarantee across disconnected nodes.**
5. **Operators must configure DNS, HTTPS reverse proxy, VPS addresses and agent updates.**
6. **Network-interface RX/TX is not the same as Xray per-user accounting.**

---

[Русская документация](README.md) · [Autonomous node guide](docs/AUTONOMOUS_NODES.md) · [GitHub: XMesh-Node](https://github.com/TriplexCorp/XMesh-Node)
