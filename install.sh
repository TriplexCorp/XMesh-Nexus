#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"

prepare_only=0
if [[ "${1:-}" == "--prepare-only" ]]; then prepare_only=1; fi
if [[ "$prepare_only" == 0 ]]; then
  if [[ "$EUID" -ne 0 ]]; then
    if ! command -v sudo >/dev/null 2>&1; then
      echo "Full installation requires root privileges (sudo not found)." >&2
      exit 1
    fi
    exec sudo --preserve-env=PANEL_DOMAIN,PANEL_ACME_EMAIL bash "$PWD/install.sh" "$@"
  fi
  bash deploy/install-panel-host.sh deps
fi

if ! command -v docker >/dev/null 2>&1; then echo "Docker is required. Install Docker Engine and the Compose plugin first." >&2; exit 1; fi
if ! docker compose version >/dev/null 2>&1; then echo "Docker Compose plugin is required (docker compose)." >&2; exit 1; fi
if ! command -v openssl >/dev/null 2>&1; then echo "openssl is required to generate secrets." >&2; exit 1; fi

created_env=0
new_dashboard_path="/dashboard/$(openssl rand -hex 24)"
if [[ ! -f .env ]]; then
  umask 077
  db_password="$(openssl rand -hex 32)"
  app_password="$(openssl rand -hex 32)"
  redis_password="$(openssl rand -hex 32)"
  admin_password="$(openssl rand -hex 32)"
  totp_key="$(openssl rand -hex 32)"
  subscription_key="$(openssl rand -hex 32)"
  product_internal_token="$(openssl rand -hex 32)"
  cat > .env <<EOF
POSTGRES_PASSWORD=${db_password}
APP_DB_PASSWORD=${app_password}
REDIS_PASSWORD=${redis_password}
DB_MAX_CONNECTIONS=20
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${admin_password}
TOTP_ENCRYPTION_KEY=${totp_key}
SUBSCRIPTION_ENCRYPTION_KEY=${subscription_key}
XSP_V2_PRODUCT_INTERNAL_TOKEN=${product_internal_token}
COOKIE_SECURE=true
APP_BIND=127.0.0.1
APP_PORT=8080
DASHBOARD_PATH=${new_dashboard_path}
EOF
  chmod 600 .env
  created_env=1
else
  if ! grep -q '^REDIS_PASSWORD=' .env; then
    printf '\nREDIS_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> .env
    echo "Generated REDIS_PASSWORD for the Redis service."
  fi
  if ! grep -q '^DB_MAX_CONNECTIONS=' .env; then printf 'DB_MAX_CONNECTIONS=20\n' >> .env; fi
  if ! grep -q '^DASHBOARD_PATH=' .env; then
    printf 'DASHBOARD_PATH=%s\n' "$new_dashboard_path" >> .env
    echo 'Created a unique dashboard path for this installation.'
  fi
  if ! grep -q '^XSP_V2_PRODUCT_INTERNAL_TOKEN=' .env; then
    printf 'XSP_V2_PRODUCT_INTERNAL_TOKEN=%s\n' "$(openssl rand -hex 32)" >> .env
    echo 'Created the private strict-PQ gateway authorization secret.'
  fi
  chmod 600 .env
fi

product_internal_token="$(sed -n 's/^XSP_V2_PRODUCT_INTERNAL_TOKEN=//p' .env | tail -n 1)"
if [[ ! "$product_internal_token" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'Invalid XSP_V2_PRODUCT_INTERNAL_TOKEN in .env; expected 64 lowercase hex characters.' >&2
  exit 1
fi

dashboard_path="$(sed -n 's/^DASHBOARD_PATH=//p' .env | tail -n 1)"
if [[ ! "$dashboard_path" =~ ^/dashboard/[a-zA-Z0-9_-]{4,64}$ ]]; then echo 'Invalid DASHBOARD_PATH in .env' >&2; exit 1; fi
mkdir -p deploy/runtime
if [[ ! -e deploy/runtime/dashboard-path ]]; then printf '%s\n' "$dashboard_path" > deploy/runtime/dashboard-path; fi
chmod 600 deploy/runtime/dashboard-path
if [[ "$(id -u)" == 0 ]]; then chown 10001:10001 deploy/runtime/dashboard-path; fi
for marker in panel-update-request panel-update-status; do
  if [[ ! -f "deploy/runtime/$marker" ]]; then printf 'idle\n' > "deploy/runtime/$marker"; fi
  if [[ "$(id -u)" == 0 ]]; then chown 10001:10001 "deploy/runtime/$marker"; fi
  chmod 600 "deploy/runtime/$marker"
done
bash deploy/ensure-totp-key.sh .env
bash deploy/ensure-subscription-key.sh .env
if [[ "$prepare_only" == 0 ]]; then bash deploy/install-panel-host.sh domain "$PWD/.env"; fi

if [[ "$(id -u)" == 0 ]] && command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  repo_dir="$(pwd -P)"
  install -d -o root -g root -m 0755 /usr/local/libexec
  install -o root -g root -m 0750 deploy/sync-dashboard-env.sh /usr/local/libexec/xmesh-sync-dashboard-env
  cat > /etc/systemd/system/xmesh-dashboard-env.service <<EOF
[Unit]
Description=Synchronize XMesh dashboard URL into .env
[Service]
Type=oneshot
ExecStart=/usr/local/libexec/xmesh-sync-dashboard-env ${repo_dir}
EOF
  cat > /etc/systemd/system/xmesh-dashboard-env.path <<EOF
[Unit]
Description=Watch XMesh dashboard URL changes
[Path]
PathChanged=${repo_dir}/deploy/runtime/dashboard-path
Unit=xmesh-dashboard-env.service
[Install]
WantedBy=multi-user.target
EOF
  install -o root -g root -m 0750 deploy/update-panel-host.sh /usr/local/libexec/xmesh-update-panel
  cat > /etc/systemd/system/xmesh-panel-update.service <<EOF
[Unit]
Description=Update XMesh Nexus after authenticated owner request
After=docker.service
[Service]
Type=oneshot
TimeoutStartSec=0
ExecStart=/usr/local/libexec/xmesh-update-panel ${repo_dir}
EOF
  cat > /etc/systemd/system/xmesh-panel-update.path <<EOF
[Unit]
Description=Watch owner-authorized XMesh update requests
[Path]
PathChanged=${repo_dir}/deploy/runtime/panel-update-request
Unit=xmesh-panel-update.service
[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now xmesh-dashboard-env.path xmesh-panel-update.path
else
  echo 'Warning: automatic .env synchronization requires root and systemd on the host.' >&2
fi

if [[ "$prepare_only" == "1" ]]; then
  # Web updater runs prepare-only after pulling the new source while the old DB
  # is still healthy. v6 uses that window to migrate the persistent PQ
  # foundation before rebuilding the panel. Non-root/offline CI remains inert.
  if [[ "$EUID" -eq 0 ]] && docker compose ps --status running --services 2>/dev/null | grep -qx db; then
    echo "Migrating XMesh Nexus v6 POSTQUANTUM foundation..."
    bash scripts/provision-xsp-v2-v6-foundation.sh
  fi
  echo "Installer environment settings prepared."
  exit 0
fi

docker compose config --quiet
panel_bind="${APP_BIND:-$(sed -n 's/^APP_BIND=//p' .env | tail -n 1)}"
panel_port="${APP_PORT:-$(sed -n 's/^APP_PORT=//p' .env | tail -n 1)}"
panel_bind="${panel_bind:-127.0.0.1}"
panel_port="${panel_port:-8080}"
if [[ ! "$panel_port" =~ ^[0-9]{1,5}$ ]] || (( 10#$panel_port < 1 || 10#$panel_port > 65535 )); then
  echo "Invalid APP_PORT: expected 1-65535." >&2
  exit 1
fi
if command -v ss >/dev/null 2>&1 && ss -H -ltn "( sport = :$panel_port )" | grep -q .; then
  existing_panel="$(docker compose ps -a -q panel 2>/dev/null || true)"
  existing_mapping=""
  if [[ -n "$existing_panel" ]]; then existing_mapping="$(docker port "$existing_panel" 8080/tcp 2>/dev/null || true)"; fi
  if ! printf '%s\n' "$existing_mapping" | grep -Eq "(^|:)${panel_port}$"; then
    echo "ERROR: Host TCP/$panel_port is already occupied; panel cannot bind to $panel_bind:$panel_port." >&2
    echo "Inspect: ss -ltnp '( sport = :$panel_port )'" >&2
    echo "Use a free loopback APP_PORT in .env, or adjust the reverse proxy to listen on 80/443 and proxy to APP_BIND:APP_PORT." >&2
    echo "No database volumes or existing panel credentials were changed." >&2
    exit 1
  fi
fi
if ! docker compose up -d --build --wait --wait-timeout 180; then
  echo "ERROR: Panel was not healthy after Compose startup." >&2
  docker compose ps >&2 || true
  echo "Inspect: docker compose logs --tail=80 panel" >&2
  echo "Check Docker DNS/network: docker network inspect xmesh-nexus_default" >&2
  echo "Existing PostgreSQL and Redis volumes have been preserved." >&2
  exit 1
fi

echo "Provisioning XMesh Nexus v6 POSTQUANTUM foundation..."
bash scripts/provision-xsp-v2-v6-foundation.sh

# Product control plane is not optional in v6. It starts only after its ML-DSA
# issuer material exists, and install fails closed if the hybrid ingress or
# gateway cannot become ready. The classical panel remains bound to loopback.
echo "Starting XMesh v6 strict-PQ product control plane..."
if ! docker compose --profile xsp-v2-product up -d --build --wait --wait-timeout 180; then
  echo "ERROR: strict-PQ product gateway/ingress failed to become ready; installation is not operational." >&2
  docker compose --profile xsp-v2-product ps >&2 || true
  docker compose --profile xsp-v2-product logs --tail=100 xsp-v2-product-gateway xsp-v2-product-ingress >&2 || true
  exit 1
fi

docker compose --profile xsp-v2-product ps xsp-v2-product-gateway xsp-v2-product-ingress
bash deploy/install-panel-host.sh activate "$PWD/.env"

echo
echo "XMesh Nexus v6.0.0 POSTQUANTUM panel is healthy and ready."
echo "PostgreSQL stores persistent panel data; Redis provides shared login throttling."
echo "Redis is private to the Compose network and is not published on a host port."
echo "Panel stays on loopback; Nginx terminates TLS for PANEL_DOMAIN."
echo "Strict-PQ product gateway is mandatory; operational node APIs are not exposed on classical HTTPS."
printf 'Dashboard entrypoint: %s\n' "$dashboard_path"
echo 'This path is stored in .env (mode 600). Save your full HTTPS URL.'
if [[ "$created_env" == "1" ]]; then
  printf 'Initial administrator: %s\n' "admin"
  echo "Initial password is stored securely in .env (mode 600); do not paste credentials into logs or support chats."
else
  echo "Existing .env was preserved; missing service settings were repaired safely."
  echo "Administrator credentials were not reset."
fi
echo
docker compose --profile xsp-v2-product ps
