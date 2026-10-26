#!/usr/bin/env bash
# Offline installer contracts: no apt, Docker, network or root required.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
host=deploy/install-panel-host.sh
bash -n install.sh
bash -n "$host"
for valid in panel.example.org billing.example.net sub-domain.example.com; do
  bash "$host" validate-domain "$valid"
done
for invalid in '' example localhost '*.example.org' 'https://example.org' \
  'example.org:443' '-bad.example.org' 'bad..example.org' 'site.test' \
  'bad;rm -rf /' 'evil$(true).com'; do
  if bash "$host" validate-domain "$invalid" >/dev/null 2>&1; then
    echo "Unsafe domain accepted: $invalid" >&2
    exit 1
  fi
done
config="$(bash "$host" render-nginx panel.example.org 8080)"
grep -Fq 'server_name panel.example.org;' <<< "$config"
grep -Fq 'ssl_certificate     /etc/letsencrypt/live/panel.example.org/fullchain.pem;' <<< "$config"
grep -Fq 'ssl_certificate_key /etc/letsencrypt/live/panel.example.org/privkey.pem;' <<< "$config"
grep -Fq 'proxy_pass http://127.0.0.1:8080;' <<< "$config"
grep -Fq 'proxy_set_header Host $host;' <<< "$config"
grep -Fq 'return 301 https://$host$request_uri;' <<< "$config"
if bash "$host" render-nginx panel.example.org '8080;return 200' >/dev/null 2>&1; then
  echo 'Unsafe upstream port accepted' >&2; exit 1
fi
# Host setup must be opt-in for full install, never for updater --prepare-only.
grep -Fq 'if [[ "$prepare_only" == 0 ]]; then' install.sh
grep -Fq 'bash deploy/install-panel-host.sh deps' install.sh
grep -Fq 'bash deploy/install-panel-host.sh domain "$PWD/.env"' install.sh
grep -Fq 'bash deploy/install-panel-host.sh activate "$PWD/.env"' install.sh
grep -Fq 'docker compose up -d --build --wait --wait-timeout' install.sh
echo 'Panel host installer: syntax, hostname validation, nginx template and integration contracts OK.'
