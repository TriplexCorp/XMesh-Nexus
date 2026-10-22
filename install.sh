#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine and the Compose plugin first." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required (docker compose)." >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate secrets." >&2
  exit 1
fi

prepare_only=0
if [[ "${1:-}" == "--prepare-only" ]]; then prepare_only=1; fi
created_env=0
# The URL slug is 192 random bits, generated once and preserved on reinstall.
new_dashboard_path="/dashboard/$(openssl rand -hex 24)"
if [[ ! -f .env ]]; then
  umask 077
  db_password="$(openssl rand -hex 32)"
  app_password="$(openssl rand -hex 32)"
  redis_password="$(openssl rand -hex 32)"
  admin_password="$(openssl rand -hex 32)"
  totp_key="$(openssl rand -hex 32)"
  cat > .env <<EOF
POSTGRES_PASSWORD=${db_password}
APP_DB_PASSWORD=${app_password}
REDIS_PASSWORD=${redis_password}
DB_MAX_CONNECTIONS=20
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${admin_password}
TOTP_ENCRYPTION_KEY=${totp_key}
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
  if ! grep -q '^DB_MAX_CONNECTIONS=' .env; then
    printf 'DB_MAX_CONNECTIONS=20\n' >> .env
  fi
  if ! grep -q '^DASHBOARD_PATH=' .env; then
    printf 'DASHBOARD_PATH=%s\n' "$new_dashboard_path" >> .env
    echo 'Created a unique dashboard path for this installation.'
  fi
  chmod 600 .env
fi

# Read the current key without executing .env as shell code.
dashboard_path="$(sed -n 's/^DASHBOARD_PATH=//p' .env | tail -n 1)"
if [[ ! "$dashboard_path" =~ ^/dashboard/[a-zA-Z0-9_-]{4,64}$ ]]; then
  echo 'Invalid DASHBOARD_PATH in .env' >&2
  exit 1
fi
# The unprivileged panel can write only this dedicated path mirror, never .env.
mkdir -p deploy/runtime
if [[ ! -e deploy/runtime/dashboard-path ]]; then
  printf '%s\n' "$dashboard_path" > deploy/runtime/dashboard-path
fi
chmod 600 deploy/runtime/dashboard-path
if [[ "$(id -u)" == 0 ]]; then
  chown 10001:10001 deploy/runtime/dashboard-path
fi

# Existing installations may contain an empty TOTP_ENCRYPTION_KEY.
# Verify without replacing a nonempty key (which is required to decrypt existing TOTP secrets).
bash deploy/ensure-totp-key.sh .env

# Configure a root-owned host-only watcher to atomically synchronize the path into .env.
if [[ "$(id -u)" == 0 ]] && command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  repo_dir="$(pwd -P)"
  # Install a root-owned copy outside the Git checkout. The privileged
  # systemd service must never execute mutable code from the repository.
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
  systemctl daemon-reload
  systemctl enable --now xmesh-dashboard-env.path
else
  echo 'Warning: automatic .env synchronization requires root and systemd on the host.' >&2
fi

if [[ "$prepare_only" == "1" ]]; then
  echo "Installer environment settings prepared."
  exit 0
fi

docker compose config --quiet
docker compose up -d --build

echo
echo "XMesh Nexus panel containers are starting."
echo "PostgreSQL stores persistent panel data; Redis provides shared login throttling."
echo "Redis is private to the Compose network and is not published on a host port."
echo "Panel is bound to 127.0.0.1:8080 by default; put it behind your HTTPS reverse proxy."
printf 'Dashboard entrypoint: %s\n' "$dashboard_path"
echo 'This path is stored in .env (mode 600). Save your full HTTPS URL.'
if [[ "$created_env" == "1" ]]; then
  printf 'Initial administrator: %s\n' "admin"
  printf 'Initial password: %s\n' "$admin_password"
  echo "Credentials are stored in .env (permissions 600). Save the password now."
else
  echo "Existing .env was preserved; missing service settings were repaired safely."
  echo "Administrator credentials were not reset."
fi
echo
docker compose ps
