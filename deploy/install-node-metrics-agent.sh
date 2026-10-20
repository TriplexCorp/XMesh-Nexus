#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0 <https-panel-origin> <node-id> <token> [interface]" >&2
  exit 1
fi
if [[ "$#" -lt 3 || "$#" -gt 4 ]]; then
  echo "Usage: $0 <https-panel-origin> <node-id> <token> [interface]" >&2
  exit 2
fi

API_URL="${1%/}"
NODE_ID="$2"
TOKEN="$3"
INTERFACE="${4:-auto}"

[[ "$API_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || {
  echo "Panel URL must be an HTTPS origin, e.g. https://panel.example.com" >&2
  exit 2
}
[[ "$NODE_ID" =~ ^[1-9][0-9]*$ ]] || { echo "Node ID must be a positive integer" >&2; exit 2; }
[[ "$TOKEN" =~ ^xm_[0-9a-f]{64}$ ]] || { echo "Metrics token format is invalid. Generate a token in the XMesh panel." >&2; exit 2; }
[[ "$INTERFACE" == "auto" || "$INTERFACE" =~ ^[A-Za-z0-9_.:-]+$ ]] || { echo "Invalid network interface name" >&2; exit 2; }

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "systemd is required" >&2; exit 1; }

RAW_BASE="https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy"
AGENT_TMP="$(mktemp)"
trap 'rm -f "$AGENT_TMP"' EXIT
curl --fail --silent --show-error --location "$RAW_BASE/node-metrics-agent.sh" -o "$AGENT_TMP"
bash -n "$AGENT_TMP"
install -m 0750 "$AGENT_TMP" /usr/local/sbin/xmesh-node-metrics

install -d -m 0700 /etc/xmesh-node-metrics
install -d -m 0700 /var/lib/xmesh-node-metrics
cat > /etc/xmesh-node-metrics.env <<EOF
XMESH_API_URL=$API_URL
XMESH_NODE_ID=$NODE_ID
XMESH_METRICS_TOKEN=$TOKEN
XMESH_INTERFACE=$INTERFACE
EOF
chmod 0600 /etc/xmesh-node-metrics.env

cat > /etc/systemd/system/xmesh-node-metrics.service <<'EOF'
[Unit]
Description=XMesh Nexus node network and system metrics
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/xmesh-node-metrics.env
ExecStart=/usr/local/sbin/xmesh-node-metrics
User=root
Group=root
UMask=0077
NoNewPrivileges=true
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
echo "The bearer token is stored in /etc/xmesh-node-metrics.env (root-only permissions)."
