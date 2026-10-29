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

# The fixed upgrade command is installed before the managed Xray sync worker.
# It is NOT executed during initial enrollment.
UPGRADER_TMP="$(mktemp)"
trap 'rm -f "$AGENT_TMP" "$COLLECTOR_TMP" "$UPGRADER_TMP"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 "$RAW_BASE/update-node-control-agent.sh" -o "$UPGRADER_TMP"
bash -n "$UPGRADER_TMP"
grep -q 'xmesh-node-agent-upgrade.service' "$UPGRADER_TMP" || {
  echo "Invalid remote agent updater" >&2; exit 1;
}
install -o root -g root -m 0700 "$UPGRADER_TMP" /usr/local/sbin/.xmesh-update-agent.new
mv -f /usr/local/sbin/.xmesh-update-agent.new /usr/local/sbin/xmesh-update-agent

# Install the fixed, non-enabled staged Go Agent package executor. It is inert
# until an authenticated manifest-bound `update_agent` command selects it.
STAGER_TMP="$(mktemp)"
STAGER_UNIT_TMP="$(mktemp)"
trap 'rm -f "$AGENT_TMP" "$COLLECTOR_TMP" "$UPGRADER_TMP" "$STAGER_TMP" "$STAGER_UNIT_TMP"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 "$RAW_BASE/xsp-v2-agent-staged-apply.sh" -o "$STAGER_TMP"
bash -n "$STAGER_TMP"
grep -Fq '/var/lib/xmesh-agent' "$STAGER_TMP" || { echo "Invalid staged Agent helper" >&2; exit 1; }
grep -Fq 'artifactVersion' "$STAGER_TMP" || { echo "Invalid staged Agent helper" >&2; exit 1; }
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 "$RAW_BASE/xmesh-xsp-v2-agent-stage.service" -o "$STAGER_UNIT_TMP"
grep -Fxq 'ExecStart=/usr/local/libexec/xmesh-xsp-v2-agent-staged-apply' "$STAGER_UNIT_TMP" || {
  echo "Invalid staged Agent service" >&2; exit 1;
}
grep -Fxq 'ReadWritePaths=/run /var/lib/xmesh-agent' "$STAGER_UNIT_TMP" || {
  echo "Invalid staged Agent service sandbox" >&2; exit 1;
}
install -o root -g root -m 0700 "$STAGER_TMP" /usr/local/libexec/.xmesh-xsp-v2-agent-staged-apply.new
mv -f /usr/local/libexec/.xmesh-xsp-v2-agent-staged-apply.new /usr/local/libexec/xmesh-xsp-v2-agent-staged-apply
install -o root -g root -m 0644 "$STAGER_UNIT_TMP" /etc/systemd/system/.xmesh-xsp-v2-agent-stage.service.new
mv -f /etc/systemd/system/.xmesh-xsp-v2-agent-stage.service.new /etc/systemd/system/xmesh-xsp-v2-agent-stage.service

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

# The privileged control worker is separate from unprivileged metrics.
# It accepts only fixed hard-coded actions from a signed polling API; no
# arbitrary command strings or SSH keys are delivered by the panel.
CONTROL_TMP="$(mktemp)"
trap 'rm -f "$AGENT_TMP" "$COLLECTOR_TMP" "$CONTROL_TMP"' EXIT
curl --fail --silent --show-error --location "$RAW_BASE/node-control-agent.sh" -o "$CONTROL_TMP"
bash -n "$CONTROL_TMP"
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

# Install the root-only per-user sampler without giving Docker privileges
# to the signed, unprivileged network metrics agent.
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

# A control-v4+ node may run this local, audited, fixed legacy upgrade service.
# The privileged updater is separate from the strongly confined command poller.
cat >/etc/systemd/system/xmesh-node-agent-upgrade.service <<'EOF'
[Unit]
Description=XMesh node agent verified self-update
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
ReadWritePaths=/usr/local/sbin /usr/local/libexec /etc/systemd/system /var/lib/xmesh-node-control /var/lib/xmesh-xray-sync /run
EOF

systemctl daemon-reload
systemctl enable xmesh-node-control.timer
systemctl restart xmesh-node-control.timer

# Restart an existing timer so upgrades immediately pick up the new cadence.
systemctl enable xmesh-node-metrics.timer
systemctl restart xmesh-node-metrics.timer
# The policy guard is installed by managed-node enrollment; activate sampling
# only once that verifier exists.
if [[ -r /usr/local/libexec/xmesh-policy-guard.py ]]; then
  systemctl enable xmesh-node-user-meter.timer
  systemctl restart xmesh-node-user-meter.timer
fi

echo "XMesh node metrics agent installed."
echo "Node ID: $NODE_ID"
echo "Network interface: $INTERFACE (auto detects the default-route interface)"
echo "The first run saves a baseline. The first real rate sample arrives after the next timer interval."
echo "Check with: systemctl status xmesh-node-metrics.timer xmesh-node-control.timer"
echo "Logs: journalctl -u xmesh-node-metrics.service -u xmesh-node-control.service -n 30 --no-pager"
echo "Control: this agent accepts only fixed signed actions; staged Go Agent migration remains default-disabled."
echo "If your Xray uses another unit, set XMESH_XRAY_UNIT in /etc/xmesh-node-metrics.env and restart the control timer."
echo "Ed25519 public key (for troubleshooting only):"
echo "$public_key"
echo "With one-time-token bootstrap, the public key is registered automatically during enrollment."
echo "The private key stays on the node (root:xmesh-metrics, mode 0640)."
