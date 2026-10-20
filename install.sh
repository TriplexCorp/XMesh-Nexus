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
  admin_password="$(openssl rand -hex 32)"
  cat > .env <<EOF
POSTGRES_PASSWORD=${db_password}
APP_DB_PASSWORD=${app_password}
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${admin_password}
COOKIE_SECURE=true
APP_BIND=127.0.0.1
APP_PORT=8080
EOF
  chmod 600 .env
  created_env=1
fi

docker compose config --quiet
docker compose up -d --build

echo
echo "XMesh Nexus panel containers are starting."
echo "Panel is bound to 127.0.0.1:8080 by default; put it behind your HTTPS reverse proxy."
if [[ "$created_env" == "1" ]]; then
  printf 'Initial administrator: %s\n' "admin"
  printf 'Initial password: %s\n' "$admin_password"
  echo "Credentials are stored in .env (permissions 600). Save the password now."
else
  echo "Existing .env was kept unchanged. Administrator credentials were not reset."
fi
echo
docker compose ps
