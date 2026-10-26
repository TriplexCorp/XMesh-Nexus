#!/usr/bin/env bash
# XMesh Nexus host bootstrap. Never infer customer domains from source code.
set -Eeuo pipefail
umask 077
die() { printf 'XMesh Nexus host setup: %s\n' "$*" >&2; exit 1; }
root_only() { [[ "$(id -u)" == 0 ]] || die 'Run: sudo ./install.sh'; }
valid_domain() {
 local domain="$1" label
 [[ ${#domain} -le 253 && "$domain" == *.* && "$domain" == "${domain,,}" ]] || return 1
 [[ "$domain" != *..* && "$domain" != .* && "$domain" != *. ]] || return 1
 local -a labels
 IFS='.' read -ra labels <<< "$domain"
 for label in "${labels[@]}"; do
  [[ ${#label} -ge 1 && ${#label} -le 63 && "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || return 1
 done
 case "$domain" in *.localhost|*.local|*.test|*.example|*.invalid) return 1;; esac
}
valid_email() {
 local value="$1" host
 [[ ${#value} -le 254 && "$value" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]] || return 1
 host="${value##*@}"
 valid_domain "${host,,}"
}
get_setting() { sed -n "s/^${1}=//p" "$2" | tail -n 1; }
add_setting() {
 [[ -f "$3" && ! -L "$3" ]] || die 'Unsafe .env path'
 printf '%s=%s\n' "$1" "$2" >> "$3"
 chmod 600 "$3"
}
install_deps() {
 root_only
 [[ -r /etc/os-release ]] || die 'Cannot detect host OS'
 . /etc/os-release
 [[ "$ID" == ubuntu && "$VERSION_CODENAME" =~ ^(jammy|noble)$ ]] ||
  die 'Automated host installation supports Ubuntu 22.04/24.04 LTS'
 export DEBIAN_FRONTEND=noninteractive
 apt-get update
 apt-get install -y ca-certificates curl gnupg lsb-release ubuntu-keyring openssl git iproute2
 install -d -m 0755 /etc/apt/keyrings
 curl --proto '=https' --tlsv1.2 -fsSLo /etc/apt/keyrings/docker.asc https://download.docker.com/linux/ubuntu/gpg
 chmod 0644 /etc/apt/keyrings/docker.asc
 printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$(dpkg --print-architecture)" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
 local key_tmp
 key_tmp="$(mktemp)"
 if ! curl --proto '=https' --tlsv1.2 -fsSLo "$key_tmp" https://nginx.org/keys/nginx_signing.key ||
    ! gpg --batch --yes --dearmor -o /usr/share/keyrings/nginx-archive-keyring.gpg "$key_tmp"; then
  rm -f "$key_tmp"
  die 'Unable to install official Nginx signing key'
 fi
 rm -f "$key_tmp"
 chmod 0644 /usr/share/keyrings/nginx-archive-keyring.gpg
 printf 'deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] https://nginx.org/packages/mainline/ubuntu %s nginx\n' \
  "$VERSION_CODENAME" > /etc/apt/sources.list.d/nginx.list
 cat > /etc/apt/preferences.d/99-xmesh-nginx <<'PIN'
Package: nginx
Pin: origin nginx.org
Pin-Priority: 900
PIN
 apt-get update
 apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin nginx certbot
 systemctl enable --now docker
 systemctl enable nginx
 # Certbot's standalone HTTP-01 temporarily owns TCP/80.
 systemctl start nginx || printf 'Nginx is not running; inspect the TCP/80 listener.\n' >&2
 docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin not available'
}
configure_domain() {
 root_only
 local file="$1" domain email existing_domain existing_email
 [[ -f "$file" && ! -L "$file" ]] || die 'Missing safe .env'
 existing_domain="$(get_setting PANEL_DOMAIN "$file")"
 existing_email="$(get_setting PANEL_ACME_EMAIL "$file")"
 domain="${PANEL_DOMAIN:-$existing_domain}"
 if [[ -z "$domain" ]]; then
  [[ -t 0 ]] || die 'Set PANEL_DOMAIN and PANEL_ACME_EMAIL in non-interactive mode'
  IFS= read -r -p 'Введите домен панели (panel.example.org): ' domain || die 'Domain input cancelled'
 fi
 domain="${domain,,}"
 valid_domain "$domain" || die 'Invalid domain. Provide a public FQDN only (no scheme, port or wildcard)'
 email="${PANEL_ACME_EMAIL:-$existing_email}"
 if [[ -z "$email" ]]; then
  [[ -t 0 ]] || die 'Set PANEL_ACME_EMAIL in non-interactive mode'
  IFS= read -r -p "Email для Let's Encrypt: " email || die 'Email input cancelled'
 fi
 valid_email "$email" || die 'Invalid email for ACME'
 [[ -z "$existing_domain" || "$existing_domain" == "$domain" ]] ||
  die "Panel domain is already $existing_domain. Update .env explicitly for a planned migration."
 [[ -z "$existing_email" || "$existing_email" == "$email" ]] ||
  die 'An ACME email is already configured. Update .env explicitly to change it.'
 [[ -n "$existing_domain" ]] || add_setting PANEL_DOMAIN "$domain" "$file"
 [[ -n "$existing_email" ]] || add_setting PANEL_ACME_EMAIL "$email" "$file"
 printf 'Panel domain configured: %s\n' "$domain"
}
render_nginx() {
 local domain="$1" port="$2"
 valid_domain "$domain" || die 'Invalid Nginx domain'
 [[ "$port" =~ ^[0-9]{1,5}$ ]] && (( 10#$port >= 1 && 10#$port <= 65535 )) || die 'Invalid local panel port'
 cat <<EOF
# XMesh Nexus — managed vhost. The application is bound to loopback only.
server {
    listen 80;
    listen [::]:80;
    server_name $domain;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $domain;
    ssl_certificate     /etc/letsencrypt/live/$domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:XMESH_NEXUS_SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    server_tokens off;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 2m;
    location / {
        proxy_pass http://127.0.0.1:$port;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port 443;
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_buffering off;
    }
}
EOF
}
activate() {
 root_only
 local file="$1" domain email port bind cert key site other old tmp
 [[ -f "$file" && ! -L "$file" ]] || die 'Missing safe .env'
 domain="$(get_setting PANEL_DOMAIN "$file")"
 email="$(get_setting PANEL_ACME_EMAIL "$file")"
 port="$(get_setting APP_PORT "$file")"
 bind="$(get_setting APP_BIND "$file")"
 port="${port:-8080}"; bind="${bind:-127.0.0.1}"
 valid_domain "$domain" || die 'Invalid PANEL_DOMAIN'
 valid_email "$email" || die 'Invalid PANEL_ACME_EMAIL'
 [[ "$bind" == 127.0.0.1 ]] || die 'APP_BIND must be 127.0.0.1 for public HTTPS'
 [[ "$port" =~ ^[0-9]{1,5}$ ]] && (( 10#$port >= 1 && 10#$port <= 65535 )) || die 'Invalid APP_PORT'
 cert="/etc/letsencrypt/live/$domain/fullchain.pem"
 key="/etc/letsencrypt/live/$domain/privkey.pem"
 if [[ ! -s "$cert" || ! -s "$key" ]] ||
    ! openssl x509 -in "$cert" -noout -checkend 2592000 >/dev/null 2>&1 ||
    ! openssl x509 -in "$cert" -noout -checkhost "$domain" >/dev/null 2>&1; then
  echo "Requesting trusted TLS certificate for $domain using HTTP-01 on TCP/80..."
  if ! certbot certonly --standalone --preferred-challenges http --non-interactive --agree-tos \
    --email "$email" -d "$domain" --cert-name "$domain" \
    --pre-hook 'systemctl stop nginx' --post-hook 'systemctl start nginx'; then
   systemctl start nginx || true
   die 'ACME failed. Check DNS A/AAAA, inbound TCP/80 and existing port listeners.'
  fi
 fi
 [[ -s "$cert" && -s "$key" ]] || die 'TLS certificate/key missing after ACME'
 openssl x509 -in "$cert" -noout -checkhost "$domain" >/dev/null 2>&1 ||
  die 'Issued TLS certificate does not match the panel FQDN'
 site=/etc/nginx/conf.d/xmesh-nexus.conf
 # Do not shadow a pre-existing Nginx virtual host for the same domain.
 for other in /etc/nginx/conf.d/*.conf /etc/nginx/nginx.conf; do
  [[ -f "$other" && "$other" != "$site" ]] || continue
  if grep -Eq "^[[:space:]]*server_name[[:space:]].*(^|[[:space:]])${domain//./\\.}([[:space:];]|$)" "$other"; then
   die "Another Nginx site already owns $domain: $other"
  fi
 done
 if [[ -e "$site" ]]; then
  [[ -f "$site" && ! -L "$site" ]] || die 'Refusing to overwrite non-regular Nginx config'
 fi
 old="$(mktemp)"
 if [[ -f "$site" ]]; then cp -p "$site" "$old"; else : > "$old"; fi
 tmp="$(mktemp /etc/nginx/conf.d/.xmesh-nexus.XXXXXXXX)"
 render_nginx "$domain" "$port" > "$tmp"
 chmod 0644 "$tmp"
 mv -f "$tmp" "$site"
 if ! nginx -t || ! systemctl reload nginx; then
  if [[ -s "$old" ]]; then cp -p "$old" "$site"; else rm -f "$site"; fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  rm -f "$old"
  die 'Nginx verification failed; previous site configuration restored'
 fi
 rm -f "$old"
 systemctl enable --now nginx
 printf 'Panel HTTPS endpoint: https://%s\n' "$domain"
}
case "${1:-}" in
 deps) install_deps ;;
 domain) [[ $# == 2 ]] || die 'Usage: ... domain .env'; configure_domain "$2" ;;
 activate) [[ $# == 2 ]] || die 'Usage: ... activate .env'; activate "$2" ;;
 validate-domain) [[ $# == 2 ]] || die 'Usage: ... validate-domain FQDN'; valid_domain "$2" ;;
 render-nginx) [[ $# == 3 ]] || die 'Usage: ... render-nginx FQDN PORT'; render_nginx "$2" "$3" ;;
 *) die 'Usage: install-panel-host.sh {deps|domain|activate|validate-domain|render-nginx}' ;;
esac
