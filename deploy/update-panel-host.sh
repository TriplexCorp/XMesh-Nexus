#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$(id -u)" -eq 0 && $# -eq 1 ]] || exit 2
repo="$1"
[[ -d "$repo/.git" && -f "$repo/compose.yaml" ]] || exit 2
cd "$repo"
request="$repo/deploy/runtime/panel-update-request"
status="$repo/deploy/runtime/panel-update-status"
[[ -f "$request" && ! -L "$request" && -f "$status" && ! -L "$status" ]] || exit 1
exec 9>/run/lock/xmesh-panel-update.lock
flock -n 9 || exit 0
IFS= read -r action < "$request" || true
[[ "$action" == "update" ]] || exit 0
printf 'idle\n' > "$request"
chown 10001:10001 "$request"
chmod 600 "$request"
write_status() {
  printf '%s\n' "$1" > "$status"
  chown 10001:10001 "$status"
  chmod 600 "$status"
}
write_status running
mkdir -p /var/log/xmesh-nexus
chmod 700 /var/log/xmesh-nexus
log="/var/log/xmesh-nexus/update.log"
if bash "$repo/xmeshctl" --web-update > "$log" 2>&1; then
  write_status success
else
  write_status failed
  exit 1
fi
