# XMesh Nexus

**Documentation:** [Русский](README.md) · **English**

**XMesh Nexus** is a self-hosted control plane for managing Xray-oriented VPN infrastructure. It provides a Rust/Axum API, a responsive web panel, PostgreSQL 18 + TimescaleDB, Redis 7, and Docker Compose deployment.

> **Project status:** The repository currently implements the management/control plane, not a ready-to-run VPN traffic service or public subscription server. See [Scope and limitations](#current-scope) and [Subscription Studio](#subscription-studio--control-plane-only) before deploying.

## Architecture and data ownership

- **PostgreSQL / TimescaleDB** share one PostgreSQL engine and one database. Regular PostgreSQL tables own business data: panel collections, users, nodes, Xray profiles, hosts, squads, settings, administrators, sessions and durable audit records.
- **TimescaleDB hypertables** store high-volume time-series data: server metric samples and operational event history. Migration 0004 creates `server_metric_samples` and `panel_events`. The dashboard's RX/TX chart reads the hypertable directly and supports 1-hour/24-hour ranges plus node/squad filters. Install the optional per-node Linux metrics agent from **Nodes → Agent metrics** to start populating the chart. Without an agent, the graph shows an explicit empty state; it never fabricates traffic.
- **Redis** provides shared login throttling and is reserved for cache, short-lived state and coordination. It is private to the Compose network, password-protected, memory-limited to 128 MiB and intentionally ephemeral. Durable panel data never depends on Redis persistence.
- PostgreSQL connection pool limits are configurable through DB_MAX_CONNECTIONS (default 20). Readiness checks verify PostgreSQL and Redis; SQL migrations enable TimescaleDB as part of application startup.
- PostgreSQL custom-format backups include both regular tables and TimescaleDB data. Store copies off-host and test restores before production changes.

## Current scope

- Rust API service and PostgreSQL persistence for panel collections: users, nodes, Xray profiles, hosts, squads, templates, administrators, tokens and settings.
- Persistent records, settings, administrator sessions and audit log in PostgreSQL (not browser-only localStorage).
- Redis-backed shared login throttling across panel instances, with PostgreSQL retaining the durable rate-limit fallback.
- Administrator sign-in with Argon2 password hashing, a dedicated /login page, a 12-hour HttpOnly/SameSite session cookie, and an audit log for mutations.
- Real SQL-backed administrator accounts with owner/admin/viewer roles. The server, not the UI, checks permissions on every write, core update and settings change. The owner may create accounts, change passwords/roles, or disable accounts. Such changes revoke existing sessions; the last active owner cannot be removed. Existing authenticated accounts migrate to owner to preserve access.
- Server-side guard for the panel entry point, same-origin validation for state-changing API requests, and persistent account-based login throttling (8 failed attempts within 15 minutes trigger a 15-minute cooldown).
- Optional administrator TOTP two-factor authentication is supported. Enabled accounts must provide an authenticator or one-time recovery code after password verification, before a panel session is issued.
- Xray-core version manager in **Settings → Xray-core**. The default target is latest; the service reads official release metadata from the XTLS/Xray-core GitHub project, downloads the expected Linux archive for the container architecture, verifies an advertised SHA-256 digest when GitHub supplies one, runs xray version to check the executable, and switches the active version atomically.
- API/database readiness probes, Rust CI, and a non-root/read-only application container.

**Runtime scope:** XMesh Nexus manages panel data and Xray-core binaries; it still does not start Xray as a VPN traffic service or configure active listeners. The optional Linux node metrics agent collects OS-level CPU/RAM/disk and network-interface RX/TX rates plus established TCP connection count. Interface traffic can include SSH, web-server and other services on the same NIC; it is not per-user accounting or guaranteed Xray-only traffic. Node health and online VPN-client counts are not yet inferred from these samples. No synthetic metrics are generated.

## Administration hardening — first phase

The **Administrators** section now manages actual `panel_auth_users` login accounts,
not the old decorative `panel_records('admins')` entries. After the
`0008_admin_rbac.sql` migration, existing sign-in accounts are retained as
**owner**. Historical placeholder records in `panel_records('admins')` are
intentionally *not* promoted to login accounts. The owner must issue a new
password for each real account. Existing sessions remain valid until they
expire, but roles are read from PostgreSQL on every request.

Server authorization:
- **Owner** — all panel CRUD, admin account creation/update/deletion, branding,
  settings, Xray-core installation and node metrics-token issuance.
- **Admin** — operational collection CRUD, VLESS Encryption generation and
  authorized IP rotation tests. Cannot change global settings, manage
  authentication accounts, or issue node credentials.
- **Viewer** — read-only panel data and metrics. All mutations are denied by
  the Rust API, irrespective of hidden or enabled browser controls.

The last active owner is protected. Changing an account's role, password,
or active state revokes that account's sessions. Account password hashes are
never returned to the frontend or audit log. Account creation requires a
16–1024-character password. An owner cannot delete or demote their own account.

**Not yet implemented:** real API bearer tokens for integrations,
granular per-collection permissions,
per-admin user quotas, and full browser/integration penetration testing.
Former settings UI generated a fake token string; it has been replaced with
an explicit disabled-state notice, and the legacy `tokens` collection is
blocked by the API. Never use legacy token-like strings as credentials.

The HTTP API sends a restrictive Content Security Policy (CSP), rejects
cross-origin mutation requests using Fetch Metadata and Origin/Host checks,
and refuses missing or expired sessions. TLS is still provided by the
operator's reverse proxy. Do not publicly expose a panel without HTTPS and
a properly secured proxy configuration.

## Administrator two-factor authentication (TOTP)

From **System → Security**, an administrator can enroll their
own account after re-entering their current password. Scan the QR code using Google Authenticator, 2FAS, Aegis, or another compatible
TOTP app. If you cannot scan it, use the manual Base32 key instead.
The QR is generated locally with a bundled MIT-licensed encoder without external
image requests. Confirm a six-digit code to finish enrollment. Only after successful confirmation
does the account require a second factor at login. The 10 high-entropy recovery
codes are shown once, and each code can be used for a single login (or to
disable the second factor along with the password). Save them offline.

Security properties:
- Each 20-byte TOTP secret is encrypted at rest using AES-256-GCM with an
  independent persistent `TOTP_ENCRYPTION_KEY`. Authentication fails closed for
  enabled accounts if the key is missing or wrong. PostgreSQL backups do NOT
  include this key; back it up securely and separately.
- TOTP uses RFC 6238 HMAC-SHA1, six digits, 30-second periods and a ±1 window.
  Accepted time steps cannot be reused. Use NTP on the host for correct time.
- Password-only requests create short-lived (5 minute), bounded-attempt MFA
  challenges, never authenticated sessions. Recovery codes are stored only as
  hashes. Enrollment is valid for 10 minutes and requires a valid code.
- Enabling and disabling MFA revoke other active sessions. Disabling requires
  the current password AND a TOTP or unused recovery code. Repeated wrong
  attempts are rate-limited via Redis and PostgreSQL.
- API endpoints: `GET /api/v1/auth/mfa/status`, `POST .../setup`,
  `POST .../confirm`, `POST .../disable` (all session-protected);
  `POST .../verify` (challenge + factor before session issuance).

**Deployment and upgrades:** fresh `./install.sh` installs a random
`TOTP_ENCRYPTION_KEY` in the mode-0600 `.env`. On existing installations
**run `./install.sh` once** to add the key without resetting previous passwords
or database volumes. For manual Compose upgrades, generate the key with
`openssl rand -hex 32` and append `TOTP_ENCRYPTION_KEY=<value>` to `.env`
before restarting. Keep this value unchanged when rebuilding containers,
restoring backups or moving hosts. Losing the key makes existing enabled
TOTP accounts inaccessible until the original key is restored; there is no
password-only bypass. Never commit the key to GitHub.

## Installation

Prerequisites: a Linux VPS with Docker Engine, the Docker Compose plugin, Git and OpenSSL.

~~~bash
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
chmod +x install.sh
./install.sh
~~~

The script creates a restricted .env with random database and administrator secrets if one does not already exist, validates the Compose configuration, builds the Rust image and starts the stack. On first install it prints the initial administrator credentials once; save them. The file is kept with mode 0600.

The app listens on 127.0.0.1:8080 by default. Keep it private and configure your HTTPS reverse proxy to forward requests there. The session cookie is Secure by default because the production deployment is expected to use HTTPS. For temporary local-only testing without HTTPS, set COOKIE_SECURE=false in .env and restart the panel.

Useful operations:

~~~bash
docker compose ps
docker compose logs -f panel
docker compose logs -f db
docker compose logs -f redis
docker compose restart panel
docker compose down
~~~

### Interactive terminal CLI

The `xmeshctl` menu lets you check service status, follow logs, restart the panel or stack, create a database backup, check readiness, start/stop services, and update the application from its tracked GitHub branch.

~~~bash
bash xmeshctl
~~~

The update action refuses to run with uncommitted local changes, creates a PostgreSQL backup first, fetches GitHub, applies only a fast-forward update, validates Compose configuration, and rebuilds/restarts the stack. It does not delete Docker volumes or reset credentials. If the backup fails or the branch has diverged, the update is stopped so you can investigate safely. Keep off-host copies of backups for disaster recovery.

Create and verify a PostgreSQL custom-format backup, with 14-day local retention:

~~~bash
bash deploy/backup-postgres.sh
~~~

The script writes a permission-restricted dump to ./backups. Copy backups off the VPS as well; a local backup does not protect against loss of the server or its disk. To change retention or destination, set BACKUP_RETENTION_DAYS or BACKUP_DIR for the script process.

Do not delete the postgres_data or core_data volumes during routine updates. Redis is intentionally ephemeral: its rate-limit counter can reset after a Redis restart, while the PostgreSQL-backed limit remains as a fallback.

**Existing installations:** the database image has changed from vanilla PostgreSQL to TimescaleDB on the same PostgreSQL 18 major version. Take and verify a backup before deploying, keep the existing postgres_data volume, and do not run docker compose down -v. The migration enables the extension and creates additional time-series tables; it does not convert existing business tables into hypertables.

## Node metrics agent and RX/TX dashboard

On the home screen, the TimescaleDB RX/TX chart supports the last hour (1-minute buckets) and last 24 hours (15-minute buckets), with optional node and squad filters. Samples are stored in `server_metric_samples`.

To start collecting real data, open **Nodes**, click **Agent metrics** on a node, and copy the displayed command. Run that command on the corresponding Linux node with root privileges. The panel issues an individual high-entropy token per node; only the SHA-256 hash is stored in PostgreSQL. The plaintext token is displayed once, stored on the node in `/etc/xmesh-node-metrics.env` with root-only permissions, and can be revoked by issuing a replacement token. Deleting the node also removes its token.

The installer enables a systemd timer that samples once per minute. The first run records a baseline; the next run sends the first valid RX/TX rate. The agent automatically detects the network interface used by the default route; pass an optional interface name to the installer to choose another NIC. Use HTTPS for the panel URL. Check the agent on a node with:

~~~bash
systemctl status xmesh-node-metrics.timer
journalctl -u xmesh-node-metrics.service -n 30 --no-pager
~~~

To stop and remove the agent on a node:

~~~bash
sudo systemctl disable --now xmesh-node-metrics.timer
sudo rm -f /etc/systemd/system/xmesh-node-metrics.timer /etc/systemd/system/xmesh-node-metrics.service /usr/local/sbin/xmesh-node-metrics /etc/xmesh-node-metrics.env
sudo rm -rf /var/lib/xmesh-node-metrics
sudo systemctl daemon-reload
~~~

The ingest endpoint rejects invalid or revoked node tokens and validates metric bounds. It accepts no browser cookies and only bypasses the panel's same-origin check for a bearer-authenticated request without an Origin header. Treat the bearer token as a secret; rotate it if the node is compromised.

## Xray-core version management

The stored default is latest. On startup the API attempts to install/update the selected version without preventing the panel API from starting if GitHub is unavailable. In **Settings → Xray-core**, you can also select a specific tag and press **Install / update**. The selected version is stored in PostgreSQL.

The selector lists recent GitHub releases; pinning is limited to the latest 30 entries returned by the GitHub API. Only Linux x86_64, ARM64 and ARM32 binaries are handled. The executable and its data files live in the persistent core_data volume. Updating the binary does not launch the VPN process.

## API overview

- GET /api/v1/health/live — process liveness.
- GET /api/v1/health/ready — PostgreSQL and Redis readiness.
- GET /api/v1/auth/session, POST /api/v1/auth/login, POST /api/v1/auth/logout — admin session.
- GET /api/v1/bootstrap — panel collections and settings (authenticated).
- /api/v1/collections/{collection} — authenticated record CRUD.
- GET /api/v1/core, GET /api/v1/core/releases, POST /api/v1/core/update — core version management (authenticated).
- GET /api/v1/metrics/traffic?range=1h|24h&node_id=ID&squad_id=ID — authenticated RX/TX history aggregated from `server_metric_samples` (1-minute buckets for 1h; 15-minute buckets for 24h). `node_id` in the hypertable must be the text form of the panel node record ID. Squad filtering selects nodes whose assigned profile shares at least one inbound tag with the squad.
- POST /api/v1/nodes/{id}/metrics-token — authenticated token issue/rotation for a node (plaintext returned once).
- POST /api/v1/metrics/ingest — node-agent bearer authentication; persists a validated sample to TimescaleDB.

## Frontend and design


## Interface customization

Appearance settings support curated accent palettes, editable HEX colors,
dark/light mode, three card treatments (Classic, Glass and Raised), responsive
workspace width (720–3000 px), motion preferences and shared control/card
corner radius. **The radius range is 1–36 px with a permanent 1 px step**,
so values such as 29 px are available regardless of other slider precision
settings. Text/UI scale is 90–200%, and the main sliders provide direct
numeric input alongside 1/10 precision modes.

The panel and Subscription Studio may share colors through the optional theme
sync. This sync updates the **saved subscription blueprint** via authenticated
API; the public portal remains a separately implemented service.

- index.html — application shell.
- styles.css — responsive design system, accent palettes, motion and shared corner-radius controls.
- app.js — panel UI, authenticated API client and Xray-core controls.

The UI intentionally avoids presenting generated node telemetry as live operational data.

### RU / EN panel localization

Choose the **Languages icon in the top toolbar** and select Русский or English to switch the
administrator interface (navigation, Settings, login, editable fields,
Subscription Studio, and common XRAY STUDIO labels). The choice is stored in
this browser under `xmeshNexusLanguage`; it does not change other
administrators' preferences or the panel's database records. The portal's
`subscriptionLanguage` is configured independently in **SUBSCRIPTION
STUDIO** and accepts only `ru` or `en`.

The shared `i18n.js` dictionary translates presentation strings at render
time, including late-added dialogs and tooltips. JSON source, textareas,
subscription demo preview with its own language, user-entered values, and
record identifiers are left unchanged. To add or improve translations,
extend the dictionary and the `scripts/check-i18n.js` regression test. The
bundles are shipped as static browser assets; Node.js is not needed on the
production panel server.

### JavaScript tooling (Node.js 24)

The XMesh Nexus backend is written in **Rust** and the frontend runs in the **browser**.
Node.js is needed **only for local frontend checks and GitHub Actions**, not by the
running panel container or a VPN node. The supported tooling version is declared
in `.node-version` (`24`) and enforced in CI using `actions/setup-node@v7`.
Use a Node.js version manager or a local Node.js 24 installation to run tests:

```bash
node --version
node --check app.js
node --check subscription-studio.js
node scripts/check-subscription-studio.js
node scripts/check-node-grid-layout.js
```

There is no `package.json`, npm dependency install or Node.js runtime in the
Rust/Debian production Docker image; the Node.js version does not affect Xray.



## Per-node IP pools and per-user address rotation

Open **Nodes → Edit → IP-ротация**. Enable the feature and enter one public IPv4 or IPv6
address per line (2–64 unique addresses). The primary node address remains unchanged.
All addresses must actually be routed to that VM and serve the same VPN inbound
(port, TLS/Reality, and credentials); the panel does **not** provision extra network
addresses or change OS networking.

The Rust backend stores a separate round-robin cursor for each `(node_id, user_id)`
in PostgreSQL (migration `0007_node_ip_rotation.sql`). It uses a transaction and
row lock to prevent duplicate allocations under concurrent refreshes. Each call
skips the last issued address when the pool has changed; disabling rotation
falls back to the node's primary address. The cursor survives restarts.

Authenticated test/integration endpoint (admin cookie + same-origin POST required):

```http
POST /api/v1/nodes/123/rotation/next
Content-Type: application/json

{"userId":456}
```

Response: `{"nodeId":123,"userId":456,"address":"203.0.113.4","rotationEnabled":true,"poolSize":10}`.
This endpoint requires an active user and a non-disabled node and is **not** an
unauthenticated subscription endpoint. The IPs in examples are documentation-only.

**Integration status:** The current XMesh Nexus repository does not yet generate
public client subscriptions (`subUrl` is still a placeholder). The rotation
engine, settings, validation, persisted cursor, and authenticated test endpoint
are implemented; **a client's subscription refresh will not rotate its
address until a real subscription generator calls
`node_rotation::resolve_address` exactly once per node and user per refresh**.
The generator must substitute only the outbound address, retain the intended
SNI/Host/Reality fields, properly format IPv6 URLs, and disable caching
(`Cache-Control: no-store`). Refreshes, not live established connections,
are the rotation boundary; client apps can also cache subscriptions.

## SUBSCRIPTION STUDIO — control-plane only

Open **SUBSCRIPTION STUDIO** in the management navigation. Configure a separate
subscription hostname/path, portal brand, description, language (RU/EN),
accent, footer, and visibility of traffic/expiration. Settings are validated
by the Rust API and stored centrally in PostgreSQL. **Settings → Brand and
domains** also has independent fields for the panel and subscription domains.

The **LEGO topology builder** is a deployment blueprint, not a provisioning
wizard. Server A hosts the management panel; assign future subscription service
and node roles independently to A, B, or C. Thus one VPS, shared VPS groups,
and three separate servers are all expressible. The selected node role is a
planning example; actual nodes stay managed individually under **Nodes**.
Optional descriptions of servers B/C and the complete blueprint can be exported
as JSON for later integration.

The **portal designer** supports independent layout, card treatment, font,
corner radius (1–36 px), background/card/text colors, optional HTTPS logo, heading/CTA
copy, support link, and switches for status, applications, QR placeholder,
copy-link button, devices and support blocks. Changes appear in a **demo-only
live preview** before saving. **Sync with panel theme** is enabled by default
and copies the current panel's accent, dark/light mode, background, card and
text colors into centrally saved subscription settings. Disable this option
to preserve an independent portal palette. This setting does **not**
automatically deploy a separate public subscription website.

**Application directory:** The admin may independently enable/disable Happ,
Incy, v2rayTun, v2rayN, v2rayNG, Streisand, Hiddify, NekoBox, Shadowrocket,
FlClash, Stash, sing-box, V2Box, Loon, Mihomo Party, and Clash Verge Rev.
Admins can also create up to **32 custom client applications** in the same
Subscription Studio section, specifying a display name, platforms, an optional
HTTPS installation URL, and whether to show the app. Custom entries can be
edited or removed without touching the 16 built-in clients. The list heading
(`subscriptionAppsTitle`) can be replaced with a service-specific caption,
such as "Supported clients"; leave it empty for a language-aware default.
All entries are stored under `subscriptionCustomClients` in PostgreSQL.
The Rust API validates unique IDs, text lengths, boolean flags and HTTPS links,
and the live preview renders all enabled apps with HTML escaping.

Optional per-app HTTPS installation links are stored in PostgreSQL with the
portal blueprint; the panel does not hardcode vendor URLs, download packages,
execute deep links, or assert that an app supports every transport. An empty
selection is allowed and hides the preview directory. Future subscription
runtime implementations should consume these settings through authenticated
integration, validate links on their side, and implement client-specific
subscription formats separately.

**Repository boundaries:** This repository contains the control plane only.
The public subscription service (with token verification, subscription output,
client-side portal, and future per-user IP rotation integration) and the
remote node runtime/agent will be implemented in **separate repositories**.
Configuring a domain does not serve a subscription, issue a usable link,
deploy a reverse proxy, configure a remote host, or start Xray. In particular,
the existing subscription URL field remains empty until the separate service
and its authenticated integration are implemented. No public subscription
API has been added to the panel.

### Updating frontend assets

The dashboard CSS and JavaScript are baked into the `panel` Docker image via `backend/Dockerfile`. Running `git pull` alone does **not** update the UI served by an existing container. After pulling changes, rebuild and recreate the panel:

```bash
git pull --ff-only origin main
docker compose up -d --build panel
```

Preserve database volumes. A hard browser refresh may still be needed after the container is recreated. CI verifies that every HTML-referenced local CSS/JS asset is included in the runtime image.
