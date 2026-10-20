# XMesh Nexus

**XMesh Nexus** — self-hosted Xray VPN control panel. The stack uses Rust, Tokio/Axum, TimescaleDB on PostgreSQL 18, and Redis 7, and runs with Docker Compose.

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
- Server-side guard for the panel entry point, same-origin validation for state-changing API requests, and persistent account-based login throttling (8 failed attempts within 15 minutes trigger a 15-minute cooldown).
- TOTP-based two-factor authentication is not part of this patch and remains a recommended next step before exposing the panel to untrusted networks.
- Xray-core version manager in **Settings → Xray-core**. The default target is latest; the service reads official release metadata from the XTLS/Xray-core GitHub project, downloads the expected Linux archive for the container architecture, verifies an advertised SHA-256 digest when GitHub supplies one, runs xray version to check the executable, and switches the active version atomically.
- API/database readiness probes, Rust CI, and a non-root/read-only application container.

**Runtime scope:** XMesh Nexus manages panel data and Xray-core binaries; it still does not start Xray as a VPN traffic service or configure active listeners. The optional Linux node metrics agent collects OS-level CPU/RAM/disk and network-interface RX/TX rates plus established TCP connection count. Interface traffic can include SSH, web-server and other services on the same NIC; it is not per-user accounting or guaranteed Xray-only traffic. Node health and online VPN-client counts are not yet inferred from these samples. No synthetic metrics are generated.

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

- index.html — application shell.
- styles.css — responsive Obsidian / Champagne design system and themes.
- app.js — panel UI, authenticated API client and Xray-core controls.

The UI intentionally avoids presenting generated node telemetry as live operational data.
