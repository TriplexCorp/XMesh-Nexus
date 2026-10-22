#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0 <https-panel-origin> <node-id> [interface]" >&2
  exit 1
fi
if [[ "$#" -lt 2 || "$#" -gt 3 ]]; then
  echo "Usage: $0 <https-panel-origin> <node-id> [interface]" >&2
  exit 2
fi

API_URL="${1%/}"
NODE_ID="$2"
INTERFACE="${3:-auto}"

[[ "$API_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || {
  echo "Panel URL must be an HTTPS origin, e.g. https://panel.example.com" >&2
  exit 2
}
[[ "$NODE_ID" =~ ^[1-9][0-9]*$ ]] || { echo "Node ID must be a positive integer" >&2; exit 2; }
[[ "$INTERFACE" == "auto" || "$INTERFACE" =~ ^[A-Za-z0-9_.:-]+$ ]] || { echo "Invalid network interface name" >&2; exit 2; }

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "OpenSSL is required for Ed25519 signing" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Python 3 is required for verified Xray StatsService parsing" >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "systemd is required" >&2; exit 1; }

RAW_BASE="https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy"
AGENT_TMP="$(mktemp)"
trap 'rm -f "$AGENT_TMP"' EXIT
curl --fail --silent --show-error --location "$RAW_BASE/node-metrics-agent.sh" -o "$AGENT_TMP"
bash -n "$AGENT_TMP"
install -o root -g root -m 0755 "$AGENT_TMP" /usr/local/sbin/xmesh-node-metrics
# Versioned collector is installed as a root-owned read-only program. It has
# no network privileges and runs only as the dedicated xmesh-metrics user.
COLLECTOR_TMP="$(mktemp)"
trap 'rm -f "$AGENT_TMP" "$COLLECTOR_TMP"' EXIT
curl --fail --silent --show-error --location "$RAW_BASE/xray-stats-collector.py" -o "$COLLECTOR_TMP"
python3 -m py_compile "$COLLECTOR_TMP"
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 "$COLLECTOR_TMP" /usr/local/libexec/xmesh-xray-stats-collector.py

# Run telemetry as a dedicated unprivileged account, not root.
if ! getent group xmesh-metrics >/dev/null; then
  groupadd --system xmesh-metrics
fi
if ! id -u xmesh-metrics >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin \
    --gid xmesh-metrics xmesh-metrics
fi
install -d -o root -g xmesh-metrics -m 0750 /etc/xmesh-node-metrics
install -d -o xmesh-metrics -g xmesh-metrics -m 0700 /var/lib/xmesh-node-metrics
cat > /etc/xmesh-node-metrics.env <<EOF
XMESH_API_URL=$API_URL
XMESH_NODE_ID=$NODE_ID
XMESH_METRICS_PRIVATE_KEY=/etc/xmesh-node-metrics/node.key
XMESH_INTERFACE=$INTERFACE
XMESH_XRAY_API_ADDRESS=127.0.0.1:10085
EOF
chmod 0600 /etc/xmesh-node-metrics.env

# The private signing key never leaves the node and is never passed as an argv
# argument or persisted in the control plane. Never rotate it implicitly.
private_key=/etc/xmesh-node-metrics/node.key
if [[ ! -e "$private_key" ]]; then
  tmp_key="$(mktemp /etc/xmesh-node-metrics/.key.XXXXXXXX)"
  trap 'rm -f "$AGENT_TMP" "$tmp_key"' EXIT
  openssl genpkey -algorithm Ed25519 -out "$tmp_key"
  chmod 0600 "$tmp_key"
  mv -n "$tmp_key" "$private_key"
fi
chown root:xmesh-metrics "$private_key"
chmod 0640 "$private_key"
public_key="$(openssl pkey -in "$private_key" -pubout -outform DER | tail -c 32 | od -An -tx1 -v | tr -d '[:space:]')"
[[ "${#public_key}" -eq 64 && "$public_key" =~ ^[0-9a-f]+$ ]] || {
  echo "Cannot extract Ed25519 public key" >&2; exit 1;
}

cat > /etc/systemd/system/xmesh-node-metrics.service <<'EOF'
[Unit]
Description=XMesh Nexus node network and system metrics
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/xmesh-node-metrics.env
ExecStart=/usr/local/sbin/xmesh-node-metrics
User=xmesh-metrics
Group=xmesh-metrics
UMask=0077
NoNewPrivileges=true
CapabilityBoundingSet=
AmbientCapabilities=
RestrictSUIDSGID=true
LockPersonality=true
ProtectClock=true
ProtectHostname=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ReadWritePaths=/var/lib/xmesh-node-metrics
EOF

cat > /etc/systemd/system/xmesh-node-metrics.timer <<'EOF'
[Unit]
Description=Send XMesh node metrics once per minute

[Timer]
OnBootSec=20s
OnUnitActiveSec=60s
AccuracySec=5s
Persistent=true
Unit=xmesh-node-metrics.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now xmesh-node-metrics.timer

echo "XMesh node metrics agent installed."
echo "Node ID: $NODE_ID"
echo "Network interface: $INTERFACE (auto detects the default-route interface)"
echo "The first run saves a baseline. The first real rate sample arrives after the next timer interval."
echo "Check with: systemctl status xmesh-node-metrics.timer"
echo "Logs: journalctl -u xmesh-node-metrics.service -n 20 --no-pager"
echo "Ed25519 public key (register on the node in XMesh Nexus):"
echo "$public_key"
echo "Until you register it in the panel, signed requests will be rejected (401)."
echo "The private key stays on the node (root:xmesh-metrics, mode 0640)."
