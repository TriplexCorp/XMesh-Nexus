#!/usr/bin/env bash
# Update only the metrics collector on an existing enrolled XMesh node.
# Preserve the Ed25519 identity, environment and all other systemd units.
set -Eeuo pipefail
[[ "${EUID}" -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemctl is required" >&2; exit 1; }
[[ -f /etc/xmesh-node-metrics.env && -r /etc/xmesh-node-metrics/node.key ]] || {
 echo "Existing signed XMesh metrics enrollment not found; no changes made." >&2
 exit 1
}
[[ -f /etc/systemd/system/xmesh-node-metrics.service ]] || {
 echo "Existing XMesh metrics service not found; no changes made." >&2; exit 1
}
src="https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/node-metrics-agent.sh"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --max-time 30 "$src" -o "$tmp"
bash -n "$tmp"
grep -q 'rxTotalBytes' "$tmp" || { echo "Downloaded agent lacks cumulative network counters" >&2; exit 1; }
if [[ -f /usr/local/sbin/xmesh-node-metrics ]]; then
 cp -p /usr/local/sbin/xmesh-node-metrics "/usr/local/sbin/xmesh-node-metrics.bak"
fi
install -o root -g root -m 0755 "$tmp" /usr/local/sbin/xmesh-node-metrics
systemctl daemon-reload
systemctl restart xmesh-node-metrics.timer
systemctl start xmesh-node-metrics.service || {
 echo "Collector execution failed; check journalctl -u xmesh-node-metrics.service" >&2
 exit 1
}
echo "Node metrics agent updated. RX/TX accounting starts from its next accepted baseline."
