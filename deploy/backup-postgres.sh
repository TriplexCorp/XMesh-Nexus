#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/xmesh-$stamp.dump"
tmp_file="$backup_file.partial"
trap 'rm -f "$tmp_file"' EXIT

docker compose exec -T db pg_dump -U postgres -d xmesh --format=custom > "$tmp_file"
test -s "$tmp_file"
docker compose exec -T db pg_restore --list < "$tmp_file" >/dev/null
mv "$tmp_file" "$backup_file"
trap - EXIT

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'xmesh-*.dump' -mtime +"$RETENTION_DAYS" -delete
chmod 600 "$backup_file"
printf 'PostgreSQL backup created and verified: %s\n' "$backup_file"
