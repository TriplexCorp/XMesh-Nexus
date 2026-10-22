#!/usr/bin/env bash
set -Eeuo pipefail
[[ $# == 1 ]] || exit 2
cd "$1"
umask 077
[[ -f .env && -f deploy/runtime/dashboard-path ]] || exit 1
IFS= read -r path < deploy/runtime/dashboard-path || true
[[ "$path" =~ ^/dashboard/[a-zA-Z0-9_-]{4,64}$ ]] || { echo 'Invalid dashboard path' >&2; exit 1; }
# Avoid touching any unrelated variable and preserve mode 600.
tmp="$(mktemp .env.XXXXXXXX)"
trap 'rm -f "$tmp"' EXIT
awk -v value="$path" 'BEGIN{found=0} /^DASHBOARD_PATH=/{if(!found){print "DASHBOARD_PATH=" value; found=1};next} {print} END{if(!found)print "DASHBOARD_PATH=" value}' .env > "$tmp"
chmod 600 "$tmp"
chown --reference=.env "$tmp"
mv -f "$tmp" .env
