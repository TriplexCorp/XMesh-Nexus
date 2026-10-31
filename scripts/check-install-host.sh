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
grep -Fq 'listen 127.0.0.1:8443 ssl;' <<< "$config"
! grep -Fq 'listen 443 ssl;' <<< "$config"
grep -Fq 'ssl_certificate     /etc/letsencrypt/live/panel.example.org/fullchain.pem;' <<< "$config"
grep -Fq 'ssl_certificate_key /etc/letsencrypt/live/panel.example.org/privkey.pem;' <<< "$config"
grep -Fq 'proxy_pass http://127.0.0.1:8080;' <<< "$config"
grep -Fq 'proxy_set_header Host $host;' <<< "$config"
grep -Fq 'return 301 https://$host$request_uri;' <<< "$config"
[[ "$(grep -c 'access_log off;' <<< "$config")" == 2 ]] || { echo 'Both vhosts must suppress bearer URL access logs' >&2; exit 1; }
[[ "$(grep -c 'error_log /var/log/nginx/xmesh-nexus-error.log crit;' <<< "$config")" == 2 ]] || { echo 'Nginx URI-bearing error diagnostics must be minimized' >&2; exit 1; }

mux="$(bash "$host" render-haproxy)"
grep -Fq 'bind 0.0.0.0:443' <<< "$mux"
grep -Fq 'bind [::]:443 v6only' <<< "$mux"
grep -Fq 'req_ssl_sni -i node-ingress.xsp.invalid' <<< "$mux"
grep -Fq 'server panel 127.0.0.1:8443' <<< "$mux"
grep -Fq 'server strict_pq 127.0.0.1:8444' <<< "$mux"

grep -Fq 'XSP_V2_PRODUCT_PUBLIC_ADDRESS: ${PANEL_DOMAIN:?Run ./install.sh first}:443' compose.yaml
grep -Fq '127.0.0.1:8444:8444' compose.yaml
! grep -Fq '0.0.0.0:8444:8444' compose.yaml
python3 - <<'PY'
from pathlib import Path
import re

compose = Path('compose.yaml').read_text()
match = re.search(r'^  xsp-v2-product-ingress:\n(?P<body>.*?)(?=^  [A-Za-z0-9_.-]+:\n|\Z)', compose, re.M | re.S)
if not match:
    raise SystemExit('xsp-v2-product-ingress service is missing from compose.yaml')
body = match.group('body')
if '      context: .\n' not in body:
    raise SystemExit('xsp-v2-product-ingress must build from repository root so Dockerfile COPY paths exist')
if '      dockerfile: deploy/xsp-v2-ingress/Dockerfile\n' not in body:
    raise SystemExit('xsp-v2-product-ingress must use the repo-root-relative ingress Dockerfile path')
if '      target: runtime-c2b\n' not in body:
    raise SystemExit('xsp-v2-product-ingress must keep the reviewed runtime-c2b target')
PY
grep -Fq 'docker port "$ingress_id" 8444/tcp' "$host"
grep -Fq "expected 127.0.0.1:8444" "$host"
grep -Fq 'ExecStart=/usr/sbin/haproxy -W -db -f /etc/xmesh-nexus/haproxy-443.cfg' "$host"
! grep -Fq '/run/xmesh-https-mux.pid' "$host"
grep -Fq 'TCP/8444 must remain closed externally' "$host"
grep -Fq 'bash deploy/ensure-subscription-key.sh .env' install.sh
if bash "$host" render-nginx panel.example.org '8080;return 200' >/dev/null 2>&1; then
  echo 'Unsafe upstream port accepted' >&2; exit 1
fi
# Host setup must be opt-in for full install, never for updater --prepare-only.
grep -Fq 'if [[ "$prepare_only" == 0 ]]; then' install.sh
grep -Fq 'bash deploy/install-panel-host.sh deps' install.sh
grep -Fq 'bash deploy/install-panel-host.sh domain "$PWD/.env"' install.sh
grep -Fq 'bash deploy/install-panel-host.sh activate "$PWD/.env"' install.sh
grep -Fq 'docker compose up -d --build --wait --wait-timeout' install.sh
# PQ provisioning may atomically replace mounted key files. The product runtime
# must not reuse an unhealthy/backed-off container created before that migration.
grep -Fq 'docker compose --profile xsp-v2-product up -d --build --force-recreate --wait --wait-timeout 180' install.sh
echo 'Panel host installer: single public 443 mux, loopback TLS backends, repo-root product ingress build context, post-key-migration runtime recreation and integration contracts OK.'
