#!/usr/bin/env bash
# Upgrade existing signed control agent without changing node enrollment keys.
set -Eeuo pipefail
MODE="${1:-manual}"
[[ "$MODE" == manual || "$MODE" == --remote ]] || { echo "Unknown update mode" >&2; exit 2; }
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
grep -q 'pinned-image' "$tmp" || { echo "Downloaded agent does not support pinned Xray versions" >&2;exit 1; }
sync_tmp="$(mktemp)"
trap 'rm -f "$tmp" "$sync_tmp"' EXIT
# Updating both sides is mandatory: an old reconciliation worker would replace
# an administrator-selected release with ghcr.io/xtls/xray-core:latest.
[[ -f /usr/local/sbin/xmesh-xray-sync ]] || {
 echo "Managed Xray synchronizer not found. The node must be enrolled first." >&2;exit 1;
}
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 \
 https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/main/deploy/xmesh-xray-sync.sh -o "$sync_tmp"
bash -n "$sync_tmp"
grep -q 'pinned-image' "$sync_tmp" || { echo "Downloaded sync worker lacks image pin support" >&2;exit 1; }
grep -q 'xmesh-policy-guard.py' "$sync_tmp" || { echo "Sync worker cannot enforce offline policy" >&2;exit 1; }
policy_tmp="$(mktemp)"
trap 'rm -f "$tmp" "$sync_tmp" "$policy_tmp"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 \
 https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/main/deploy/xmesh-policy-guard.py -o "$policy_tmp"
python3 -m py_compile "$policy_tmp"
grep -q 'check_signature' "$policy_tmp" || { echo "Policy verifier lacks Ed25519 verification" >&2;exit 1; }
geo_tmp="$(mktemp)"
trap 'rm -f "$tmp" "$sync_tmp" "$policy_tmp" "$geo_tmp"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 \
 https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/main/deploy/xmesh-geodata-sync.py -o "$geo_tmp"
python3 -m py_compile "$geo_tmp"
grep -q 'MAX_FILE_BYTES' "$geo_tmp" || { echo "GeoData synchronizer lacks size bounds" >&2;exit 1; }
metrics_tmp="$(mktemp)"
trap 'rm -f "$tmp" "$sync_tmp" "$policy_tmp" "$geo_tmp" "$metrics_tmp"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 \
 https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/node-metrics-agent.sh -o "$metrics_tmp"
bash -n "$metrics_tmp"
grep -q 'xmesh-node-user-metrics.json' "$metrics_tmp" || { echo "Metrics agent cannot read autonomous counters" >&2;exit 1; }
profile_tmp="$(mktemp)"
trap 'rm -f "$tmp" "$sync_tmp" "$policy_tmp" "$geo_tmp" "$metrics_tmp" "$profile_tmp"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 \
 https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/main/deploy/xmesh-profile-attest.py -o "$profile_tmp"
python3 -m py_compile "$profile_tmp"
grep -q 'xmesh-managed-xray' "$profile_tmp" || { echo "Invalid profile attestation helper" >&2;exit 1; }
# Update the Docker router as part of the same node release. Resolve the
# installation from the container's config bind rather than guessing /root.
update_router() {
 command -v docker >/dev/null && command -v git >/dev/null || { echo "Docker/git missing for router upgrade" >&2; return 1; }
 docker compose version >/dev/null 2>&1 || { echo "Docker Compose missing" >&2; return 1; }
 local mounted dir previous
 mounted="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/xmesh-node/config.json"}}{{.Source}}{{end}}{{end}}' xmesh-node 2>/dev/null)" || return 1
 [[ -f "$mounted" ]] || { echo "Router config mount missing" >&2; return 1; }
 dir="$(dirname "$mounted")"
 [[ -f "$dir/compose.yaml" || -f "$dir/docker-compose.yml" || -f "$dir/docker-compose.yaml" ]] || {
  echo "Router compose file missing in $dir" >&2; return 1;
 }
 [[ "$(git -C "$dir" remote get-url origin)" == "https://github.com/TriplexCorp/XMesh-Node.git" ||
    "$(git -C "$dir" remote get-url origin)" == "git@github.com:TriplexCorp/XMesh-Node.git" ]] || {
  echo "Router source origin is not XMesh-Node; refusing automatic upgrade" >&2; return 1;
 }
 [[ -z "$(git -C "$dir" status --porcelain --untracked-files=no)" ]] || {
  echo "Router source has local changes; refusing automatic upgrade" >&2; return 1;
 }
 previous="$(git -C "$dir" rev-parse HEAD)" || return 1
 git -C "$dir" fetch origin main || return 1
 if [[ "$previous" == "$(git -C "$dir" rev-parse FETCH_HEAD)" ]];then
  echo "Router source already current."
  return 0
 fi
 # Refuse rewritten history; never silently discard administrator changes.
 git -C "$dir" merge-base --is-ancestor "$previous" FETCH_HEAD || {
  echo "Router repository cannot fast-forward safely" >&2; return 1;
 }
 git -C "$dir" merge --ff-only FETCH_HEAD || return 1
 if (cd "$dir" && docker compose build xmesh-node &&
     docker compose run --rm --no-deps xmesh-node -check -config /etc/xmesh-node/config.json &&
     docker compose up -d --no-deps --force-recreate xmesh-node &&
     [[ "$(docker inspect -f '{{.State.Running}}' xmesh-node)" == true ]]);then
  echo "Router upgraded and running."
  return 0
 fi
 echo "Router upgrade failed; restoring previous source and container." >&2
 git -C "$dir" reset --hard "$previous" || return 1
 (cd "$dir" && docker compose build xmesh-node &&
  docker compose up -d --no-deps --force-recreate xmesh-node) || return 1
 [[ "$(docker inspect -f '{{.State.Running}}' xmesh-node)" == true ]]
 return 1
}
# Validate the updater itself before changing any installed components.
self_tmp="$(mktemp)"
trap 'rm -f "$tmp" "$sync_tmp" "$policy_tmp" "$geo_tmp" "$metrics_tmp" "$profile_tmp" "$self_tmp"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 \
 https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/update-node-control-agent.sh -o "$self_tmp"
bash -n "$self_tmp"
grep -q 'xmesh-node-agent-upgrade.service' "$self_tmp" || { echo "Invalid agent updater" >&2; exit 1; }
if [[ -f /usr/local/sbin/xmesh-node-control ]];then
 cp -p /usr/local/sbin/xmesh-node-control /usr/local/sbin/xmesh-node-control.bak
fi
cp -p /usr/local/sbin/xmesh-xray-sync /usr/local/sbin/xmesh-xray-sync.bak
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0700 "$profile_tmp" /usr/local/libexec/.xmesh-profile-attest.new
mv -f /usr/local/libexec/.xmesh-profile-attest.new /usr/local/libexec/xmesh-profile-attest.py
install -o root -g root -m 0700 "$policy_tmp" /usr/local/libexec/.xmesh-policy-guard.new
mv -f /usr/local/libexec/.xmesh-policy-guard.new /usr/local/libexec/xmesh-policy-guard.py
install -o root -g root -m 0700 "$geo_tmp" /usr/local/libexec/.xmesh-geodata-sync.new
mv -f /usr/local/libexec/.xmesh-geodata-sync.new /usr/local/libexec/xmesh-geodata-sync.py
install -o root -g root -m 0700 "$sync_tmp" /usr/local/sbin/.xmesh-xray-sync.new
mv -f /usr/local/sbin/.xmesh-xray-sync.new /usr/local/sbin/xmesh-xray-sync
install -d -o root -g root -m 0700 /var/lib/xmesh-xray-sync
install -o root -g root -m 0700 "$tmp" /usr/local/sbin/.xmesh-node-control.new
mv -f /usr/local/sbin/.xmesh-node-control.new /usr/local/sbin/xmesh-node-control
install -o root -g root -m 0755 "$metrics_tmp" /usr/local/sbin/.xmesh-node-metrics.new
mv -f /usr/local/sbin/.xmesh-node-metrics.new /usr/local/sbin/xmesh-node-metrics
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
# The signed Xray counters are sampled independently of slow configuration
# reconciliation. This service does not need the node signing key or API access;
# it only reads the running managed Xray and publishes a root-owned snapshot.
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
# Install an isolated, fixed updater service. A signed control action invokes
# this unit; the control worker never runs a URL or script from the API.
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
ReadWritePaths=/usr/local/sbin /usr/local/libexec /etc/systemd/system /var/lib/xmesh-node-control /var/lib/xmesh-xray-sync -/opt/xmesh-node -/root/XMesh-Node /run
EOF
systemctl daemon-reload
# The autonomous policy guard only takes effect while the reconciliation timer
# runs. Upgrading an existing node must reactivate an inactive sync timer.
if [[ -f /etc/systemd/system/xmesh-xray-sync.timer &&
      -f /etc/systemd/system/xmesh-xray-sync.service ]];then
 systemctl enable xmesh-xray-sync.timer
 systemctl restart xmesh-xray-sync.timer
else
 echo "WARNING: Xray sync timer is absent; offline policy enforcement is not active." >&2
fi
systemctl enable xmesh-node-control.timer
systemctl restart xmesh-node-control.timer
systemctl restart xmesh-node-metrics.timer
systemctl enable xmesh-node-user-meter.timer
systemctl restart xmesh-node-user-meter.timer
if ! systemctl start xmesh-node-user-meter.service; then
  echo "WARNING: Xray user sampler is not ready. Check: journalctl -u xmesh-node-user-meter.service -n 50 --no-pager" >&2
fi
if ! update_router;then
 echo "Router update failed; full node upgrade is NOT successful." >&2
 exit 1
fi
# Keep the fixed updater script current for the next panel-driven upgrade.
# Replace atomically because this script can itself be executing.
install -o root -g root -m 0700 "$self_tmp" /usr/local/sbin/.xmesh-update-agent.new
mv -f /usr/local/sbin/.xmesh-update-agent.new /usr/local/sbin/xmesh-update-agent
if [[ "$MODE" != --remote ]]; then
 systemctl start xmesh-node-control.service
fi
echo "Signed node control, offline policy verifier and pinned Xray synchronizer installed."
echo "Check reconciliation: systemctl start xmesh-xray-sync.service && journalctl -u xmesh-xray-sync.service -n 30 --no-pager"
