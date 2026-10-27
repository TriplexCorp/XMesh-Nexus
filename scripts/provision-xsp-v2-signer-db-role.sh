#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo ".env is missing; run ./install.sh first." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine and the Docker Compose plugin are required." >&2
  exit 1
fi
if ! grep -q '^XSP_V2_SIGNER_DB_PASSWORD=' .env; then
  password="$(openssl rand -hex 32)"
  printf '\nXSP_V2_SIGNER_DB_PASSWORD=%s\n' "$password" >> .env
  chmod 600 .env
fi
password="$(sed -n 's/^XSP_V2_SIGNER_DB_PASSWORD=//p' .env | tail -n 1)"
if [[ ! "$password" =~ ^[0-9a-f]{64}$ ]]; then
  echo "XSP_V2_SIGNER_DB_PASSWORD must be a 64-character lowercase hex secret." >&2
  exit 1
fi
database_url="postgresql://xmesh_signer_reader:${password}@db:5432/xmesh"
if grep -q '^XSP_V2_SIGNER_DATABASE_URL=' .env; then
  current_url="$(sed -n 's/^XSP_V2_SIGNER_DATABASE_URL=//p' .env | tail -n 1)"
  if [[ "$current_url" != "$database_url" ]]; then
    echo "Existing XSP_V2_SIGNER_DATABASE_URL differs; inspect it before rotating the signer DB password." >&2
    exit 1
  fi
else
  printf 'XSP_V2_SIGNER_DATABASE_URL=%s\n' "$database_url" >> .env
  chmod 600 .env
fi

echo "Creating/refreshing the SELECT-only xmesh_signer_reader database role..."
docker compose exec -T db psql \
  --username postgres \
  --dbname xmesh \
  --set=ON_ERROR_STOP=1 \
  --set=signer_password="$password" \
  < deploy/postgres/20-create-xsp-v2-signer-role.sql

echo "Signer DB role provisioned. The signer stays disabled unless the xsp-v2-staging profile is explicitly enabled."
