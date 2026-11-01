#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then echo "Run with sudo: sudo bash $0 <https-panel-origin> <node-id> [interface]" >&2; exit 1; fi
if [[ "$#" -lt 2 || "$#" -gt 3 ]]; then echo "Usage: $0 <https-panel-origin> <node-id> [interface]" >&2; exit 2; fi
API_URL="${1%/}"; NODE_ID="$2"; INTERFACE="${3:-auto}"
[[ "$API_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || { echo "Panel URL must be an HTTPS origin, e.g. https://panel.example.com" >&2; exit 2; }
[[ "$NODE_ID" =~ ^[1-9][0-9]*$ ]] || { echo "Node ID must be a positive integer" >&2; exit 2; }
[[ "$INTERFACE" == "auto" || "$INTERFACE" =~ ^[A-Za-z0-9_.:-]+$ ]] || { echo "Invalid network interface name" >&2; exit 2; }
for cmd in curl openssl python3 systemctl docker git; do command -v "$cmd" >/dev/null 2>&1 || { echo "$cmd is required" >&2; exit 1; }; done

RAW_BASE="https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy"
AGENT_TMP="$(mktemp)"; COLLECTOR_TMP="$(mktemp)"; UPGRADER_TMP="$(mktemp)"; STAGER_TMP="$(mktemp)"; STAGER_UNIT_TMP="$(mktemp)"; CONTROL_TMP="$(mktemp)"
trap 'rm -f "$AGENT_TMP" "$COLLECTOR_TMP" "$UPGRADER_TMP" "$STAGER_TMP" "$STAGER_UNIT_TMP" "$CONTROL_TMP"' EXIT
curl --fail --silent --show-error --location "$RAW_BASE/node-metrics-agent.sh" -o "$AGENT_TMP"
bash -n "$AGENT_TMP"; install -o root -g root -m 0755 "$AGENT_TMP" /usr/local/sbin/xmesh-node-metrics
curl --fail --silent --show-error --location "$RAW_BASE/xray-stats-collector.py" -o "$COLLECTOR_TMP"
python3 -m py_compile "$COLLECTOR_TMP"; install -d -o root -g root -m 0755 /usr/local/libexec; install -o root -g root -m 0755 "$COLLECTOR_TMP" /usr/local/libexec/xmesh-xray-stats-collector.py

# Fixed updater is installed before the managed sync worker; it is not executed here.
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 "$RAW_BASE/update-node-control-agent.sh" -o "$UPGRADER_TMP"
bash -n "$UPGRADER_TMP"; grep -q 'xmesh-node-agent-upgrade.service' "$UPGRADER_TMP" || { echo "Invalid remote agent updater" >&2; exit 1; }
install -o root -g root -m 0700 "$UPGRADER_TMP" /usr/local/sbin/.xmesh-update-agent.new; mv -f /usr/local/sbin/.xmesh-update-agent.new /usr/local/sbin/xmesh-update-agent

curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 "$RAW_BASE/xsp-v2-agent-staged-apply.sh" -o "$STAGER_TMP"
bash -n "$STAGER_TMP"; grep -Fq '/var/lib/xmesh-agent' "$STAGER_TMP" && grep -Fq 'artifactVersion' "$STAGER_TMP" || { echo "Invalid staged Agent helper" >&2; exit 1; }
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 "$RAW_BASE/xmesh-xsp-v2-agent-stage.service" -o "$STAGER_UNIT_TMP"
grep -Fxq 'ExecStart=/usr/local/libexec/xmesh-xsp-v2-agent-staged-apply' "$STAGER_UNIT_TMP" && grep -Fxq 'ReadWritePaths=/run /var/lib/xmesh-agent' "$STAGER_UNIT_TMP" || { echo "Invalid staged Agent service" >&2; exit 1; }
install -o root -g root -m 0700 "$STAGER_TMP" /usr/local/libexec/.xmesh-xsp-v2-agent-staged-apply.new; mv -f /usr/local/libexec/.xmesh-xsp-v2-agent-staged-apply.new /usr/local/libexec/xmesh-xsp-v2-agent-staged-apply
install -o root -g root -m 0644 "$STAGER_UNIT_TMP" /etc/systemd/system/.xmesh-xsp-v2-agent-stage.service.new; mv -f /etc/systemd/system/.xmesh-xsp-v2-agent-stage.service.new /etc/systemd/system/xmesh-xsp-v2-agent-stage.service

if ! getent group xmesh-metrics >/dev/null; then groupadd --system xmesh-metrics; fi
if ! id -u xmesh-metrics >/dev/null 2>&1; then useradd --system --no-create-home --shell /usr/sbin/nologin --gid xmesh-metrics xmesh-metrics; fi
install -d -o root -g xmesh-metrics -m 0750 /etc/xmesh-node-metrics
install -d -o xmesh-metrics -g xmesh-metrics -m 0700 /var/lib/xmesh-node-metrics
install -d -o root -g root -m 0700 /var/lib/xmesh-node-control
cat > /etc/xmesh-node-metrics.env <<EOF
XMESH_API_URL=$API_URL
XMESH_NODE_ID=$NODE_ID
XMESH_METRICS_PRIVATE_KEY=/etc/xmesh-node-metrics/node.key
XMESH_INTERFACE=$INTERFACE
XMESH_XRAY_API_ADDRESS=127.0.0.1:10085
XMESH_XRAY_UNIT=xray.service
EOF
chmod 0600 /etc/xmesh-node-metrics.env

private_key=/etc/xmesh-node-metrics/node.key
if [[ ! -e "$private_key" ]]; then
  tmp_key="$(mktemp /etc/xmesh-node-metrics/.key.XXXXXXXX)"; trap 'rm -f "$tmp_key"' RETURN
  openssl genpkey -algorithm Ed25519 -out "$tmp_key"; chmod 0600 "$tmp_key"; mv -n "$tmp_key" "$private_key"
fi
chown root:xmesh-metrics "$private_key"; chmod 0640 "$private_key"
public_key="$(openssl pkey -in "$private_key" -pubout -outform DER | tail -c 32 | od -An -tx1 -v | tr -d '[:space:]')"
[[ "${#public_key}" -eq 64 && "$public_key" =~ ^[0-9a-f]+$ ]] || { echo "Cannot extract Ed25519 public key" >&2; exit 1; }

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
Description=Send XMesh node metrics every five seconds
[Timer]
OnBootSec=5s
OnUnitInactiveSec=5s
AccuracySec=1s
Persistent=true
Unit=xmesh-node-metrics.service
[Install]
WantedBy=timers.target
EOF

curl --fail --silent --show-error --location "$RAW_BASE/node-control-agent.sh" -o "$CONTROL_TMP"
bash -n "$CONTROL_TMP"; grep -Fxq 'AGENT_VERSION="control-v6.0.4"' "$CONTROL_TMP" || { echo "Nexus main does not expose Agent v6.0.4" >&2; exit 1; }
install -o root -g root -m 0700 "$CONTROL_TMP" /usr/local/sbin/xmesh-node-control
cat > /etc/systemd/system/xmesh-node-control.service <<'EOF'
[Unit]
Description=XMesh Nexus signed Xray service controller
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
EnvironmentFile=/etc/xmesh-node-metrics.env
ExecStart=/usr/local/sbin/xmesh-node-control
User=root
Group=root
UMask=0077
TimeoutStartSec=175s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectHostname=true
ProtectKernelModules=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=/run -/var/lib/xmesh-xray-sync /var/lib/xmesh-node-control
EOF
cat > /etc/systemd/system/xmesh-node-control.timer <<'EOF'
[Unit]
Description=Poll XMesh restart commands with signed node identity
[Timer]
OnBootSec=5s
OnUnitInactiveSec=5s
AccuracySec=1s
Persistent=true
Unit=xmesh-node-control.service
[Install]
WantedBy=timers.target
EOF

cat >/etc/systemd/system/xmesh-node-user-meter.service <<'EOF'
[Unit]
Description=XMesh verified per-user Xray traffic sampler
After=docker.service
Wants=docker.service
[Service]
Type=oneshot
EnvironmentFile=/etc/xmesh-node-metrics.env
ExecStart=/usr/bin/python3 /usr/local/libexec/xmesh-policy-guard.py sample --state /var/lib/xmesh-xray-sync --node-id ${XMESH_NODE_ID}
User=root
Group=root
UMask=0077
TimeoutStartSec=20s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectHostname=true
ProtectKernelModules=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=/run /var/lib/xmesh-xray-sync
EOF
cat >/etc/systemd/system/xmesh-node-user-meter.timer <<'EOF'
[Unit]
Description=Sample Xray per-user traffic every ten seconds
[Timer]
OnBootSec=10s
OnUnitInactiveSec=10s
AccuracySec=1s
Unit=xmesh-node-user-meter.service
[Install]
WantedBy=timers.target
EOF

cat >/etc/systemd/system/xmesh-node-agent-upgrade.service <<'EOF'
[Unit]
Description=XMesh node Agent v6 verified self-update
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/xmesh-update-agent --remote
User=root
Group=root
UMask=0077
TimeoutStartSec=650s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelModules=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=/usr/local/sbin /usr/local/bin /usr/local/libexec /etc/systemd/system /var/lib/xmesh-node-control /var/lib/xmesh-xray-sync /var/lib/xmesh-agent -/opt/xmesh-node -/root/XMesh-Node /run
EOF

# Fresh v6 enrollment must leave a real production PQ binary on disk, not just
# a v6 badge. Resolve the official XMesh-Node checkout from the router config
# mount and build the exact checked-out revision with the reviewed Go toolchain.
install_v6_pq_runtime(){
  local mounted dir revision identity
  mounted="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/xmesh-node/config.json"}}{{.Source}}{{end}}{{end}}' xmesh-node 2>/dev/null)" || return 1
  [[ -f "$mounted" ]] || { echo "Cannot resolve XMesh-Node checkout for PQ runtime" >&2; return 1; }
  dir="$(dirname "$mounted")"
  [[ -d "$dir/.git" && -f "$dir/VERSION" && "$(tr -d '\r\n' < "$dir/VERSION")" == "6.0.0" ]] || { echo "Fresh enrollment source is not XMesh-Node v6.0.0" >&2; return 1; }
  [[ -f "$dir/AGENT_VERSION" && "$(tr -d '\r\n' < "$dir/AGENT_VERSION")" == "control-v6.0.4" ]] || { echo "Fresh enrollment source does not expose Agent control-v6.0.4" >&2; return 1; }
  [[ -f "$dir/deploy/install-xsp-v2-production-agent.sh" && ! -L "$dir/deploy/install-xsp-v2-production-agent.sh" ]] || { echo "v6 PQ runtime installer missing" >&2; return 1; }
  revision="$(git -C "$dir" rev-parse HEAD)"; [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || return 1
  bash "$dir/deploy/install-xsp-v2-production-agent.sh" "$revision" || return 1
  identity="$(/usr/local/bin/xmesh-agent-xspv2-activate --identity)" || return 1
  python3 - "$identity" "$revision" <<'PY'
import json,sys
v=json.loads(sys.argv[1]); assert v.get('version')=='control-v6.0.4',v; assert v.get('sourceRevision')==sys.argv[2],v; assert len(v.get('artifactSha256',''))==64,v
PY
}
install_v6_pq_runtime || { echo "POSTQUANTUM v6 runtime installation failed; refusing incomplete node enrollment" >&2; exit 1; }

systemctl daemon-reload
systemctl enable xmesh-node-control.timer; systemctl restart xmesh-node-control.timer
systemctl enable xmesh-node-metrics.timer; systemctl restart xmesh-node-metrics.timer
if [[ -r /usr/local/libexec/xmesh-policy-guard.py ]]; then systemctl enable xmesh-node-user-meter.timer; systemctl restart xmesh-node-user-meter.timer; fi

echo "XMesh Agent v6.0.4 POSTQUANTUM installed."
echo "Node ID: $NODE_ID"
echo "Network interface: $INTERFACE (auto detects the default-route interface)"
echo "Control Agent and strict-PQ production binary are both installed and identity-verified."
echo "Check with: systemctl status xmesh-node-metrics.timer xmesh-node-control.timer"
echo "Ed25519 public key (for troubleshooting only):"
echo "$public_key"
echo "The private enrollment key stays on the node (root:xmesh-metrics, mode 0640)."