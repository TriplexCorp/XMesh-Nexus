#!/usr/bin/env bash
set -Eeuo pipefail
# Generate a stable standalone encryption key once, never replace existing keys.
file="${1:-.env}"
[[ -f "$file" && ! -L "$file" ]] || { echo 'Missing .env' >&2; exit 1; }
umask 077
lines="$(grep -c '^SUBSCRIPTION_ENCRYPTION_KEY=' "$file" || true)"
[[ "$lines" == 0 || "$lines" == 1 ]] || { echo 'Duplicate subscription keys' >&2; exit 1; }
if [[ "$lines" == 1 ]];then
 current="$(sed -n 's/^SUBSCRIPTION_ENCRYPTION_KEY=//p' "$file")"
 [[ "$current" =~ ^[[:xdigit:]]{64}$ ]] || { echo 'Invalid subscription encryption key' >&2; exit 1; }
 chmod 600 "$file"
 exit 0
fi
key="$(openssl rand -hex 32)"
printf 'SUBSCRIPTION_ENCRYPTION_KEY=%s\n' "$key" >> "$file"
chmod 600 "$file"
echo 'Persistent subscription key prepared; existing keys untouched.'
