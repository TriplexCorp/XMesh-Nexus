#!/usr/bin/env bash
# Upgrade existing signed control agent without changing node enrollment keys.
set -Eeuo pipefail
[[ "$EUID" -eq 0 ]] || { echo "Run as root" >&2;exit 1; }
[[ -r /etc/xmesh-node-metrics/node.key && -f /etc/xmesh-node-metrics.env ]] || {
 echo "Node enrollment missing" >&2;exit 1;
}
command -v curl >/dev/null && command -v systemctl >/dev/null || exit 1
[[ -f /etc/systemd/system/xmesh-node-control.service ]] || {
 echo "Control service missing, enroll node first" >&2;exit 1;
}
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 \
 https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/node-control-agent.sh -o "$tmp"
bash -n "$tmp"
grep -q 'enforceStop' "$tmp" || { echo "Downloaded agent is missing traffic cutoff support" >&2;exit 1; }
if [[ -f /usr/local/sbin/xmesh-node-control ]];then
 cp -p /usr/local/sbin/xmesh-node-control /usr/local/sbin/xmesh-node-control.bak
fi
install -o root -g root -m 0700 "$tmp" /usr/local/sbin/xmesh-node-control
install -d -o root -g root -m 0700 /var/lib/xmesh-node-control
# Existing hardened systemd service must be allowed to persist the shutdown
# marker; no relaxation of ProtectSystem for any other directory.
install -d -o root -g root -m 0755 /etc/systemd/system/xmesh-node-control.service.d
cat >/etc/systemd/system/xmesh-node-control.service.d/quota-stop.conf <<'EOF'
[Service]
ReadWritePaths=/var/lib/xmesh-node-control
EOF
cat >/etc/systemd/system/xmesh-node-control.timer <<'EOF'
[Unit]
Description=Poll signed XMesh node control and traffic-limit shutdowns

[Timer]
OnBootSec=5s
OnUnitInactiveSec=5s
AccuracySec=1s
Unit=xmesh-node-control.service

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable xmesh-node-control.timer
systemctl restart xmesh-node-control.timer
systemctl start xmesh-node-control.service
echo "Signed XMesh quota shutdown agent installed; polls every 5 seconds."
