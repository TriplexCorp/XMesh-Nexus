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
 for label in "${labels[@]}"; do [[ ${#label} -ge 1 && ${#label} -le 63 && "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || return 1; done
 case "$domain" in *.localhost|*.local|*.test|*.example|*.invalid) return 1;; esac
}
valid_email() { local value="$1" host; [[ ${#value} -le 254 && "$value" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]] || return 1; host="${value##*@}"; valid_domain "${host,,}"; }
get_setting() { sed -n "s/^${1}=//p" "$2" | tail -n 1; }
add_setting() { [[ -f "$3" && ! -L "$3" ]] || die 'Unsafe .env path'; printf '%s=%s\n' "$1" "$2" >> "$3"; chmod 600 "$3"; }
install_deps() {
 root_only
 local had_haproxy=0
 [[ -r /etc/os-release ]] || die 'Cannot detect host OS'; . /etc/os-release
 [[ "$ID" == ubuntu && "$VERSION_CODENAME" =~ ^(jammy|noble)$ ]] || die 'Automated host installation supports Ubuntu 22.04/24.04 LTS'
 if dpkg-query -W -f='${Status}' haproxy 2>/dev/null | grep -q 'ok installed'; then had_haproxy=1; fi
 export DEBIAN_FRONTEND=noninteractive
 apt-get update
 apt-get install -y ca-certificates curl gnupg lsb-release ubuntu-keyring openssl git iproute2
 install -d -m 0755 /etc/apt/keyrings
 curl --proto '=https' --tlsv1.2 -fsSLo /etc/apt/keyrings/docker.asc https://download.docker.com/linux/ubuntu/gpg
 chmod 0644 /etc/apt/keyrings/docker.asc
 printf 'deb [arch=%s signed-by=%s] https://download.docker.com/linux/ubuntu %s stable\n' "$(dpkg --print-architecture)" /etc/apt/keyrings/docker.asc "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
 local key_tmp; key_tmp="$(mktemp)"
 if ! curl --proto '=https' --tlsv1.2 -fsSLo "$key_tmp" https://nginx.org/keys/nginx_signing.key || ! gpg --batch --yes --dearmor -o /usr/share/keyrings/nginx-archive-keyring.gpg "$key_tmp"; then rm -f "$key_tmp"; die 'Unable to install official Nginx signing key'; fi
 rm -f "$key_tmp"; chmod 0644 /usr/share/keyrings/nginx-archive-keyring.gpg
 printf 'deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] https://nginx.org/packages/mainline/ubuntu %s nginx\n' "$VERSION_CODENAME" > /etc/apt/sources.list.d/nginx.list
 cat > /etc/apt/preferences.d/99-xmesh-nginx <<'PIN'
Package: nginx
Pin: origin nginx.org
Pin-Priority: 900
PIN
 apt-get update
 apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin nginx certbot haproxy
 systemctl enable --now docker
 if (( had_haproxy == 1 )) && systemctl is-active --quiet haproxy.service && ! systemctl is-active --quiet xmesh-https-mux.service 2>/dev/null; then
  die 'An existing operator-managed HAProxy service is active. Use a dedicated host or migrate that TCP/443 configuration explicitly.'
 fi
 # On a clean installation the distro HAProxy service may be auto-started by
 # package installation. XMesh owns a separate, generated systemd unit instead.
 if ! systemctl is-active --quiet xmesh-https-mux.service 2>/dev/null; then systemctl disable --now haproxy.service >/dev/null 2>&1 || true; fi
 systemctl enable nginx; systemctl start nginx || printf 'Nginx is not running; inspect the TCP/80 listener.\n' >&2
 docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin not available'
}
configure_domain() {
 root_only
 local file="$1" domain email existing_domain existing_email
 [[ -f "$file" && ! -L "$file" ]] || die 'Missing safe .env'
 existing_domain="$(get_setting PANEL_DOMAIN "$file")"; existing_email="$(get_setting PANEL_ACME_EMAIL "$file")"; domain="${PANEL_DOMAIN:-$existing_domain}"
 if [[ -z "$domain" ]]; then [[ -t 0 ]] || die 'Set PANEL_DOMAIN and PANEL_ACME_EMAIL in non-interactive mode'; IFS= read -r -p 'Enter panel domain (panel.example.org): ' domain || die 'Domain input cancelled'; fi
 domain="${domain,,}"; valid_domain "$domain" || die 'Invalid domain. Provide a public FQDN only (no scheme, port or wildcard)'
 email="${PANEL_ACME_EMAIL:-$existing_email}"
 if [[ -z "$email" ]]; then [[ -t 0 ]] || die 'Set PANEL_DOMAIN and PANEL_ACME_EMAIL in non-interactive mode'; IFS= read -r -p "Let's Encrypt contact email: " email || die 'Email input cancelled'; fi
 valid_email "$email" || die 'Invalid email for ACME'
 [[ -z "$existing_domain" || "$existing_domain" == "$domain" ]] || die "Panel domain is already $existing_domain. Update .env explicitly for a planned migration."
 [[ -z "$existing_email" || "$existing_email" == "$email" ]] || die 'An ACME email is already configured. Update .env explicitly to change it.'
 [[ -n "$existing_domain" ]] || add_setting PANEL_DOMAIN "$domain" "$file"; [[ -n "$existing_email" ]] || add_setting PANEL_ACME_EMAIL "$email" "$file"
 printf 'Panel domain configured: %s\n' "$domain"
}
render_nginx() {
 local domain="$1" port="$2"
 valid_domain "$domain" || die 'Invalid Nginx domain'
 [[ "$port" =~ ^[0-9]{1,5}$ ]] && (( 10#$port >= 1 && 10#$port <= 65535 )) || die 'Invalid local panel port'
 cat <<EOF
# XMesh Nexus v6 — HTTP/80 redirects publicly; HTTPS terminates on loopback
# after the public TCP/443 SNI multiplexer selects the classical panel path.
server {
    listen 80;
    listen [::]:80;
    server_name $domain;
    access_log off;
    error_log /var/log/nginx/xmesh-nexus-error.log crit;
    return 301 https://\$host\$request_uri;
}
server {
    listen 127.0.0.1:8443 ssl;
    http2 on;
    server_name $domain;
    access_log off;
    error_log /var/log/nginx/xmesh-nexus-error.log crit;
    ssl_certificate     /etc/letsencrypt/live/$domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:XMESH_NEXUS_SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    server_tokens off;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 2m;

    # Classical HTTPS is permitted only for the single-use owner-authorized
    # enrollment exchange. It cannot carry operational node traffic.
    location = /api/v2/product/enroll {
        limit_except POST { deny all; }
        proxy_pass http://127.0.0.1:8082/enroll;
        proxy_http_version 1.1;
        proxy_set_header Host strict-pq-enrollment;
        proxy_set_header Content-Type application/json;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 10s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
        proxy_buffering off;
    }

    # v6 security invariant: these classical paths remain unavailable. The
    # operational Node channel shares public TCP/443 but is selected by SNI
    # before TLS termination and reaches the separate strict-PQ ingress.
    location = /api/v1/metrics/ingest { return 404; }
    location ^~ /api/v1/node/ { return 404; }

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
render_haproxy() {
 cat <<'EOF'
# XMesh Nexus v6 managed public TCP/443 multiplexer.
# TLS is not terminated here. SNI only chooses the isolated TLS endpoint.
global
    maxconn 4096

defaults
    mode tcp
    timeout connect 10s
    timeout client  60s
    timeout server  60s

frontend xmesh_public_https
    bind 0.0.0.0:443
    bind [::]:443 v6only
    mode tcp
    tcp-request inspect-delay 5s
    tcp-request content accept if { req_ssl_hello_type 1 }
    acl xmesh_strict_pq req_ssl_sni -i node-ingress.xsp.invalid
    use_backend xmesh_strict_pq if xmesh_strict_pq
    default_backend xmesh_panel_tls

backend xmesh_panel_tls
    mode tcp
    server panel 127.0.0.1:8443

backend xmesh_strict_pq
    mode tcp
    server strict_pq 127.0.0.1:8444
EOF
}
ensure_mux_runtime() {
 root_only
 local file="$1" repo mux_dir mux_cfg mux_unit tmp_cfg ingress_id ingress_mapping
 repo="$(cd -- "$(dirname -- "$file")" && pwd -P)"
 [[ -f "$repo/compose.yaml" ]] || die 'compose.yaml not found next to .env'
 if ! command -v haproxy >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y haproxy
  systemctl disable --now haproxy.service >/dev/null 2>&1 || true
 elif systemctl is-active --quiet haproxy.service && ! systemctl is-active --quiet xmesh-https-mux.service; then
  die 'Existing system HAProxy service is active. Free TCP/443 or migrate it before enabling the XMesh 443 multiplexer.'
 fi

 # Recreate the product gateway/ingress from the current Compose definition so
 # upgrades cannot leave the old public :8444 mapping or enrollment address.
 (cd "$repo" && docker compose --profile xsp-v2-product up -d --build --wait --wait-timeout 180 xsp-v2-product-gateway xsp-v2-product-ingress) \
  || die 'Unable to start the v6 strict-PQ product gateway/ingress'

 # Docker port publication is the authoritative exposure check even when the
 # daemon runs without userland-proxy and therefore has no visible host socket.
 ingress_id="$(cd "$repo" && docker compose --profile xsp-v2-product ps -q xsp-v2-product-ingress)"
 [[ -n "$ingress_id" ]] || die 'Unable to identify the strict-PQ ingress container'
 ingress_mapping="$(docker port "$ingress_id" 8444/tcp 2>/dev/null || true)"
 [[ "$ingress_mapping" == '127.0.0.1:8444' ]] || die "Unsafe strict-PQ ingress publication: ${ingress_mapping:-none}; expected 127.0.0.1:8444"

 # Also reject an unexpected non-Docker listener on the same port.
 if ss -H -ltn '( sport = :8444 )' 2>/dev/null | awk '{print $4}' | grep -Evq '^(127\.0\.0\.1|\[::1\]):8444$'; then
  die 'TCP/8444 is still publicly bound; expected loopback-only strict-PQ ingress'
 fi

 mux_dir=/etc/xmesh-nexus
 mux_cfg="$mux_dir/haproxy-443.cfg"
 mux_unit=/etc/systemd/system/xmesh-https-mux.service
 install -d -o root -g root -m 0755 "$mux_dir"
 tmp_cfg="$(mktemp "$mux_dir/.haproxy-443.XXXXXXXX")"
 render_haproxy > "$tmp_cfg"
 chmod 0644 "$tmp_cfg"
 haproxy -c -f "$tmp_cfg" >/dev/null || { rm -f "$tmp_cfg"; die 'HAProxy TCP/443 multiplexer configuration is invalid'; }
 mv -f "$tmp_cfg" "$mux_cfg"
 cat > "$mux_unit" <<'EOF'
[Unit]
Description=XMesh Nexus public TCP/443 SNI multiplexer
After=network-online.target docker.service nginx.service
Wants=network-online.target
Requires=nginx.service

[Service]
Type=simple
ExecStart=/usr/sbin/haproxy -W -db -f /etc/xmesh-nexus/haproxy-443.cfg
ExecReload=/bin/kill -USR2 $MAINPID
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
 chmod 0644 "$mux_unit"
 systemctl daemon-reload
}
activate() {
 root_only
 local file="$1" domain email port bind cert key site other old tmp ingress_id ingress_mapping
 [[ -f "$file" && ! -L "$file" ]] || die 'Missing safe .env'
 domain="$(get_setting PANEL_DOMAIN "$file")"; email="$(get_setting PANEL_ACME_EMAIL "$file")"; port="$(get_setting APP_PORT "$file")"; bind="$(get_setting APP_BIND "$file")"; port="${port:-8080}"; bind="${bind:-127.0.0.1}"
 valid_domain "$domain" || die 'Invalid PANEL_DOMAIN'; valid_email "$email" || die 'Invalid PANEL_ACME_EMAIL'; [[ "$bind" == 127.0.0.1 ]] || die 'APP_BIND must be 127.0.0.1 for public HTTPS'
 [[ "$port" =~ ^[0-9]{1,5}$ ]] && (( 10#$port >= 1 && 10#$port <= 65535 )) || die 'Invalid APP_PORT'
 cert="/etc/letsencrypt/live/$domain/fullchain.pem"; key="/etc/letsencrypt/live/$domain/privkey.pem"
 if [[ ! -s "$cert" || ! -s "$key" ]] || ! openssl x509 -in "$cert" -noout -checkend 2592000 >/dev/null 2>&1 || ! openssl x509 -in "$cert" -noout -checkhost "$domain" >/dev/null 2>&1; then
  echo "Requesting trusted TLS certificate for $domain using HTTP-01 on TCP/80..."
  if ! certbot certonly --standalone --preferred-challenges http --non-interactive --agree-tos --email "$email" -d "$domain" --cert-name "$domain" --pre-hook 'systemctl stop nginx' --post-hook 'systemctl start nginx'; then systemctl start nginx || true; die 'ACME failed. Check DNS A/AAAA, inbound TCP/80 and existing port listeners.'; fi
 fi
 [[ -s "$cert" && -s "$key" ]] || die 'TLS certificate/key missing after ACME'; openssl x509 -in "$cert" -noout -checkhost "$domain" >/dev/null 2>&1 || die 'Issued TLS certificate does not match the panel FQDN'

 ensure_mux_runtime "$file"

 site=/etc/nginx/conf.d/xmesh-nexus.conf
 for other in /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/* /etc/nginx/nginx.conf; do
  [[ -f "$other" && "$other" != "$site" ]] || continue
  if awk -v domain="$domain" '/^[[:space:]]*server_name[[:space:]]+/ {sub(/;.*/, "");for (i=2;i<=NF;i++) if ($i==domain){found=1;exit}} END {exit !found}' "$other"; then die "Another Nginx site already owns $domain: $other"; fi
 done
 if [[ -e "$site" ]]; then [[ -f "$site" && ! -L "$site" ]] || die 'Refusing to overwrite non-regular Nginx config'; fi
 old="$(mktemp)"; if [[ -f "$site" ]]; then cp -p "$site" "$old"; else : > "$old"; fi
 tmp="$(mktemp /etc/nginx/conf.d/.xmesh-nexus.XXXXXXXX)"; render_nginx "$domain" "$port" > "$tmp"; chmod 0644 "$tmp"; mv -f "$tmp" "$site"
 if ! nginx -t; then if [[ -s "$old" ]]; then cp -p "$old" "$site"; else rm -f "$site"; fi; rm -f "$old"; die 'Nginx verification failed; previous site configuration restored'; fi

 # Switch the classical TLS listener from public :443 to loopback :8443 first,
 # then let the SNI multiplexer become the only public owner of TCP/443.
 if ! systemctl reload nginx; then
  if [[ -s "$old" ]]; then cp -p "$old" "$site"; else rm -f "$site"; fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  rm -f "$old"
  die 'Nginx reload failed; previous site configuration restored'
 fi
 if ! systemctl enable --now xmesh-https-mux.service || ! systemctl restart xmesh-https-mux.service; then
  systemctl stop xmesh-https-mux.service >/dev/null 2>&1 || true
  if [[ -s "$old" ]]; then cp -p "$old" "$site"; else rm -f "$site"; fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  rm -f "$old"
  die 'TCP/443 multiplexer failed; previous Nginx public endpoint restored'
 fi
 rm -f "$old"
 systemctl enable --now nginx

 ss -H -ltn '( sport = :443 )' | grep -q . || die 'Public TCP/443 is not listening after activation'
 ingress_id="$(cd "$(dirname -- "$file")" && docker compose --profile xsp-v2-product ps -q xsp-v2-product-ingress)"
 ingress_mapping="$(docker port "$ingress_id" 8444/tcp 2>/dev/null || true)"
 [[ "$ingress_mapping" == '127.0.0.1:8444' ]] || die 'Security invariant failed: strict-PQ ingress is not loopback-only after activation'
 if ss -H -ltn '( sport = :8444 )' 2>/dev/null | awk '{print $4}' | grep -Evq '^(127\.0\.0\.1|\[::1\]):8444$'; then
  die 'Security invariant failed: TCP/8444 became public after activation'
 fi
 printf 'Panel HTTPS endpoint: https://%s\n' "$domain"
 printf 'v6 strict-PQ Node control plane: %s:443 (SNI node-ingress.xsp.invalid)\n' "$domain"
 printf 'Public firewall requirement: TCP/80 and TCP/443 only; TCP/8444 must remain closed externally.\n'
}
case "${1:-}" in
 deps) install_deps ;;
 domain) [[ $# == 2 ]] || die 'Usage: ... domain .env'; configure_domain "$2" ;;
 activate) [[ $# == 2 ]] || die 'Usage: ... activate .env'; activate "$2" ;;
 validate-domain) [[ $# == 2 ]] || die 'Usage: ... validate-domain FQDN'; valid_domain "$2" ;;
 render-nginx) [[ $# == 3 ]] || die 'Usage: ... render-nginx FQDN PORT'; render_nginx "$2" "$3" ;;
 render-haproxy) [[ $# == 1 ]] || die 'Usage: ... render-haproxy'; render_haproxy ;;
 *) die 'Usage: install-panel-host.sh {deps|domain|activate|validate-domain|render-nginx|render-haproxy}' ;;
esac
