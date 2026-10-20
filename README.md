# XMesh Nexus

**XMesh Nexus** — self-hosted Xray VPN control panel. The stack uses Rust, Tokio/Axum and PostgreSQL, and runs with Docker Compose.

## Current scope

- Rust API service and PostgreSQL persistence for panel collections: users, nodes, Xray profiles, hosts, squads, templates, administrators, tokens and settings.
- Persistent records and settings in PostgreSQL (not browser-only \`localStorage\`).
- Administrator sign-in with Argon2 password hashing, a 12-hour HttpOnly/SameSite session cookie, and an audit log for mutations.
- Xray-core version manager in **Settings → Xray-core**. The default target is \`latest\`; the service reads official release metadata from the XTLS/Xray-core GitHub project, downloads the expected Linux archive for the container architecture, verifies an advertised SHA-256 digest when GitHub supplies one, runs \`xray version\` to check the executable, and switches the active version atomically.
- API/database readiness probes, Rust CI, and a non-root/read-only application container.

**This first iteration is panel + API + Xray-core binary management only.** It does not start Xray as a VPN traffic service, configure listeners, or install/run agents on remote nodes. CPU/RAM/throughput, node health and client online status are not real telemetry until those integrations are added.

## Installation

Prerequisites: a Linux VPS with Docker Engine, the Docker Compose plugin, Git and OpenSSL.

\`\`\`bash
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
chmod +x install.sh
./install.sh
\`\`\`

The script creates a restricted \`.env\` with random database and administrator secrets if one does not already exist, validates the Compose configuration, builds the Rust image and starts the stack. On first install it prints the initial administrator credentials once; save them. The file is kept with mode \`0600\`.

The app listens on \`127.0.0.1:8080\` by default. Keep it private and configure your HTTPS reverse proxy to forward requests there. The session cookie is Secure by default because the production deployment is expected to use HTTPS. For temporary local-only testing without HTTPS, set \`COOKIE_SECURE=false\` in \`.env\` and restart the panel.

Useful operations:

\`\`\`bash
docker compose ps
docker compose logs -f panel
docker compose logs -f db
docker compose restart panel
docker compose down
\`\`\`

Database backup (writes a SQL dump in the current directory):

\`\`\`bash
docker compose exec -T db pg_dump -U postgres -d xmesh > xmesh-backup.sql
\`\`\`

Do not delete the \`postgres_data\` or \`core_data\` volumes during routine updates.

## Xray-core version management

The stored default is \`latest\`. On startup the API attempts to install/update the selected version without preventing the panel API from starting if GitHub is unavailable. In **Settings → Xray-core**, you can also select a specific tag and press **Install / update**. The selected version is stored in PostgreSQL.

The selector lists recent GitHub releases; pinning is limited to the latest 30 entries returned by the GitHub API. Only Linux x86_64, ARM64 and ARM32 binaries are handled. The executable and its data files live in the persistent \`core_data\` volume. Updating the binary does not launch the VPN process.

## API overview

- \`GET /api/v1/health/live\` — process liveness.
- \`GET /api/v1/health/ready\` — database readiness.
- \`GET /api/v1/auth/session\`, \`POST /api/v1/auth/login\`, \`POST /api/v1/auth/logout\` — admin session.
- \`GET /api/v1/bootstrap\` — panel collections and settings (authenticated).
- \`/api/v1/collections/{collection}\` — authenticated record CRUD.
- \`GET /api/v1/core\`, \`GET /api/v1/core/releases\`, \`POST /api/v1/core/update\` — core version management (authenticated).

## Frontend and design

- \`index.html\` — application shell.
- \`styles.css\` — responsive Obsidian / Champagne design system and themes.
- \`app.js\` — panel UI, authenticated API client and Xray-core controls.

The UI intentionally avoids presenting generated node telemetry as live operational data.
