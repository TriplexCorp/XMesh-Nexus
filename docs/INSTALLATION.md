# XMesh Nexus — Installation and Operations

This document describes the supported panel installation path for XMesh Nexus v6 and the operational checks that should follow it.

## Supported host

Automated installation supports:

- **Ubuntu 22.04 LTS (jammy)**
- **Ubuntu 24.04 LTS (noble)**

The installer expects root privileges (directly or through `sudo`).

## Before installation

Prepare:

1. a clean or dedicated Ubuntu VPS;
2. a public FQDN such as `panel.example.org`;
3. DNS A/AAAA records pointing that FQDN to the VPS;
4. inbound TCP/80 and TCP/443 for web/ACME;
5. inbound TCP/8444 for the v6 strict-PQ operational node ingress;
6. outbound Internet access for package installation, ACME and image/source retrieval;
7. an email address for Let's Encrypt notifications.

The automated installer installs Docker Engine, Docker Compose/Buildx, Nginx mainline and Certbot. Only Git must be installed before cloning the repository.

## Quick installation

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
bash install.sh
```

`install.sh` elevates through `sudo` automatically when a full install is started by a non-root user.

The installer asks for:

- panel domain;
- Let's Encrypt contact email.

For non-interactive automation, provide them in the environment:

```bash
PANEL_DOMAIN=panel.example.org \
PANEL_ACME_EMAIL=admin@example.org \
bash install.sh
```

## What the installer does

A normal full installation:

1. verifies Ubuntu 22.04/24.04;
2. installs host dependencies and official Docker/Nginx repositories;
3. installs Docker Engine, Compose/Buildx, Nginx and Certbot;
4. creates `.env` with mode `600` if it does not exist;
5. generates independent random PostgreSQL, application DB, Redis, administrator, TOTP, subscription and product-gateway secrets;
6. creates a random dashboard path such as `/dashboard/<random-token>`;
7. starts PostgreSQL/TimescaleDB, Redis and the Rust panel through Docker Compose;
8. waits for healthy services instead of returning immediately after container creation;
9. provisions the v6 POSTQUANTUM foundation and persistent identities;
10. starts the mandatory `xsp-v2-product` gateway/ingress services;
11. obtains a Let's Encrypt certificate using HTTP-01;
12. configures Nginx on TCP/443 and HTTP→HTTPS redirect on TCP/80;
13. keeps the panel backend on loopback;
14. installs host-side systemd helpers used for dashboard-path synchronization and authorized panel updates.

Existing `.env` state is preserved. Missing installer-managed values may be added, but existing administrator credentials and persistent cryptographic keys are not intentionally reset by a normal reinstall/update.

## Network model

| Port | Exposure | Purpose |
| ---: | --- | --- |
| `80/tcp` | Public | ACME HTTP-01 and HTTP→HTTPS redirect |
| `443/tcp` | Public | Panel, login and public subscription HTTPS through Nginx |
| `8444/tcp` | Public to managed nodes | v6 strict-PQ operational control-plane ingress |
| `8080/tcp` by default | Loopback only | Rust panel container behind Nginx |
| `8082/tcp` | Loopback only | Internal product enrollment/gateway path |
| PostgreSQL/Redis | Docker network only | Persistent DB / temporary auth state |

Do not publish PostgreSQL or Redis directly to the Internet.

## DNS and ACME checklist

Before running the installer, verify:

```bash
getent ahosts panel.example.org
```

The address should resolve to the intended VPS.

If ACME fails:

- verify TCP/80 is reachable from the Internet;
- verify no unrelated process/site owns the same domain;
- verify A/AAAA records are correct;
- if an AAAA record exists, make sure IPv6 routing actually reaches the VPS;
- inspect Nginx/system logs before retrying.

The installer validates the requested certificate against the configured hostname before activating the final Nginx site.

## First login

On a fresh installation:

- username defaults to `admin`;
- the initial password is generated into `.env`;
- the dashboard path is generated into `.env` and mirrored into `deploy/runtime/dashboard-path`.

Read them locally on the server rather than posting credentials into chat/logs:

```bash
sudo grep -E '^(ADMIN_USERNAME|ADMIN_PASSWORD|DASHBOARD_PATH)=' .env
```

Then open:

```text
https://<PANEL_DOMAIN><DASHBOARD_PATH>
```

The random dashboard path is an extra exposure-reduction layer, **not** a replacement for authentication or MFA.

## Confirm the stack

```bash
docker compose --profile xsp-v2-product ps
```

For the ordinary product install, expect the panel database/runtime plus the v6 product gateway/ingress to be healthy/running.

Useful checks:

```bash
docker compose logs --tail=100 panel
docker compose --profile xsp-v2-product logs --tail=100 xsp-v2-product-gateway xsp-v2-product-ingress
sudo nginx -t
sudo systemctl status nginx --no-pager
```

## Adding a managed node

Use the panel workflow instead of manually inventing Agent credentials:

1. open **Nodes / Узлы**;
2. choose the node onboarding action (for example **Connect node and metrics / Подключить ноду и метрики**);
3. create a distinct Node record for that VPS;
4. execute the generated bootstrap command on the target VPS;
5. wait for a fresh Agent heartbeat;
6. verify Agent version, Xray status/version and configuration/application state in Nexus.

Do not reuse the same Node identity for two simultaneously active VPS machines.

## Updating Nexus

### Recommended: panel update action

The installed product has an owner-authorized update path.

The API does **not** receive a Docker socket or execute arbitrary shell. Instead it writes a fixed update request marker; a root-owned systemd service invokes:

```text
xmeshctl --web-update
```

The updater uses locking, creates a PostgreSQL backup before source/rebuild work and runs the installer preparation path so newly required settings/foundation state can be added without resetting existing credentials.

A `202`/queued status means only that the update request was accepted. Watch the update state until `success`, then confirm the running version/services.

See `PANEL_UPDATE_AND_TELEMETRY.md`.

### Manual maintenance

If the web updater is unavailable, operate from the server with the repository's own tooling rather than manually recreating Compose state. Before any manual update:

1. back up PostgreSQL;
2. back up `.env`;
3. back up persistent XSP-v2 signer/ingress identity material and any other host-held secrets;
4. inspect local Git modifications;
5. run the repository update/install tooling;
6. verify services and runtime versions afterward.

A database dump alone is **not** a complete recovery set for a security-sensitive v6 installation.

## Backups

At minimum preserve:

- PostgreSQL data/dumps;
- `.env`;
- the configured XSP-v2 signer key directory (default `/etc/xmesh-nexus/xsp-v2-signer` where applicable);
- XSP-v2 ingress certificate/identity state (default `/etc/xmesh-nexus/xsp-v2-ingress` where applicable);
- any external DNS/TLS information required to restore the public endpoint;
- operational records required by your own disaster-recovery process.

The repository includes `deploy/backup-postgres.sh` and deeper XSP-v2 durability/recovery evidence. For strict-PQ state, follow the dedicated recovery/security documents rather than assuming a generic DB restore is sufficient.

## Safe `.env` handling

`.env` contains high-value secrets. Keep mode `600` and do not commit it.

Important persistent values include:

- `POSTGRES_PASSWORD`
- `APP_DB_PASSWORD`
- `REDIS_PASSWORD`
- `ADMIN_PASSWORD`
- `TOTP_ENCRYPTION_KEY`
- `SUBSCRIPTION_ENCRYPTION_KEY`
- `XSP_V2_PRODUCT_INTERNAL_TOKEN`
- `DASHBOARD_PATH`
- `PANEL_DOMAIN`
- `PANEL_ACME_EMAIL`

`TOTP_ENCRYPTION_KEY` and `SUBSCRIPTION_ENCRYPTION_KEY` are persistent encryption keys. Treat casual replacement as data-loss/security-impacting maintenance, not as a password reset.

## Panel TLS vs Xray TLS

These are separate layers:

- **Panel HTTPS:** Nginx + Certbot on the Nexus host, managed by `install.sh`.
- **Xray client TLS/REALITY:** configured in XRAY STUDIO/managed node profiles and used by VPN clients on Xray nodes.

Changing an Xray inbound TLS certificate does not replace the panel certificate, and vice versa.

## Troubleshooting

### Port 8080 already occupied

The installer checks the loopback application port before starting the panel. Inspect:

```bash
sudo ss -ltnp '( sport = :8080 )'
```

If another service owns it, choose a free `APP_PORT` and keep `APP_BIND=127.0.0.1` for the standard public HTTPS topology.

### Panel container not healthy

```bash
docker compose ps
docker compose logs --tail=120 panel
```

Also inspect Docker DNS/network state if database/Redis hostnames cannot be resolved.

### Strict-PQ product services not ready

```bash
docker compose --profile xsp-v2-product ps
docker compose --profile xsp-v2-product logs --tail=150 xsp-v2-product-gateway xsp-v2-product-ingress
```

The v6 installer fails closed rather than declaring the installation operational when the mandatory product control-plane services cannot start.

### Nginx failure

```bash
sudo nginx -t
sudo journalctl -u nginx -n 100 --no-pager
```

The installer attempts to restore the previous site configuration when validation/reload of the generated site fails.

### Node action shows queued but nothing changed

Treat the queue response as request acceptance only. Check:

- latest heartbeat;
- Agent version;
- Xray version/process status;
- desired/applied revision;
- operation status/error;
- node-side systemd/container logs when necessary.

## Related documentation

- `PRODUCT_GUIDE.md` — product features and component responsibilities
- `XRAY_STUDIO_GUIDE.md` — Xray configuration workspace
- `AUTONOMOUS_NODES.md` — node behavior and signed operations
- `PANEL_UPDATE_AND_TELEMETRY.md` — update path and telemetry
- `SECURITY_NODE_IDENTITY.md` — node identity security
- `SUBSCRIPTION_SECURITY.md` — subscription security model
- `XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md` — bounded strict-PQ production evidence
- `DEVELOPMENT_CHECKPOINT_2026-10-31.md` — current implementation decisions for future development
