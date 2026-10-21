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

created_env=0
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
EOF
  chmod 600 .env
  created_env=1
else
  if ! grep -q '^REDIS_PASSWORD=' .env; then
    printf '\nREDIS_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> .env
    echo "Generated REDIS_PASSWORD for the Redis service."
  fi
  if ! grep -q '^TOTP_ENCRYPTION_KEY=' .env; then
    printf 'TOTP_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
    echo "Generated a persistent MFA encryption key. Back up this key securely."
  fi
  if ! grep -q '^DB_MAX_CONNECTIONS=' .env; then
    printf 'DB_MAX_CONNECTIONS=20\n' >> .env
  fi
  chmod 600 .env
fi

docker compose config --quiet
docker compose up -d --build

echo
echo "XMesh Nexus panel containers are starting."
echo "PostgreSQL stores persistent panel data; Redis provides shared login throttling."
echo "Redis is private to the Compose network and is not published on a host port."
echo "Panel is bound to 127.0.0.1:8080 by default; put it behind your HTTPS reverse proxy."
if [[ "$created_env" == "1" ]]; then
  printf 'Initial administrator: %s\n' "admin"
  printf 'Initial password: %s\n' "$admin_password"
  echo "Credentials are stored in .env (permissions 600). Save the password now."
else
  echo "Existing .env was kept; only missing Redis/database tuning settings were added."
  echo "Administrator credentials were not reset."
fi
echo
docker compose ps
