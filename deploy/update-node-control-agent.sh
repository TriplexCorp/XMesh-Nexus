#!/usr/bin/env bash
# Upgrade existing signed control agent without changing node enrollment keys.
set -Eeuo pipefail
MODE="${1:-manual}"
[[ "$MODE" == manual || "$MODE" == --remote ]] || { echo "Unknown update mode" >&2; exit 2; }
[[ "$EUID" -eq 0 ]] || { echo "Run as root" >&2;exit 1; }
[[ -r /etc/xmesh-node-metrics/node.key && -f /etc/xmesh-node-metrics.env ]] || { echo "Node enrollment missing" >&2;exit 1; }
command -v curl >/dev/null && command -v systemctl >/dev/null || exit 1
[[ -f /etc/systemd/system/xmesh-node-control.service ]] || { echo "Control service missing, enroll node first" >&2;exit 1; }

RELEASE_IDENTITY_FILE=/run/xmesh-node-control/agent-release-identity.json
if [[ "$MODE" == --remote && -e "$RELEASE_IDENTITY_FILE" ]];then
 [[ -f "$RELEASE_IDENTITY_FILE" && ! -L "$RELEASE_IDENTITY_FILE" ]] || { echo "Bound Agent release identity is not a regular file" >&2;exit 1; }
 [[ -x /usr/local/libexec/xmesh-xsp-v2-agent-staged-apply ]] || { echo "Staged Agent executor is not installed" >&2;exit 1; }
 [[ -f /etc/systemd/system/xmesh-xsp-v2-agent-stage.service && ! -L /etc/systemd/system/xmesh-xsp-v2-agent-stage.service ]] || { echo "Staged Agent service is not installed" >&2;exit 1; }
 if ! timeout 210 systemctl start --wait xmesh-xsp-v2-agent-stage.service;then echo "Staged Agent package apply failed" >&2;exit 1;fi
 [[ "$(systemctl show --property=Result --value xmesh-xsp-v2-agent-stage.service 2>/dev/null)" == success ]] || { echo "Staged Agent service did not complete successfully" >&2;exit 1; }
 exit 0
fi

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/node-control-agent.sh -o "$tmp"
bash -n "$tmp"
grep -Fxq 'AGENT_VERSION="control-v6.0.1"' "$tmp" || { echo "Downloaded Agent is not the current v6 POSTQUANTUM patch" >&2;exit 1; }
grep -q 'enforceStop' "$tmp" || { echo "Downloaded agent is missing traffic cutoff support" >&2;exit 1; }
grep -q 'pinned-image' "$tmp" || { echo "Downloaded agent does not support pinned Xray versions" >&2;exit 1; }

sync_tmp="$(mktemp)"; policy_tmp="$(mktemp)"; hot_tmp="$(mktemp)"; geo_tmp="$(mktemp)"; metrics_tmp="$(mktemp)"; profile_tmp="$(mktemp)"; tls_tmp="$(mktemp)"; tls_status_tmp="$(mktemp)"; renew_tmp="$(mktemp)"; stage_tmp="$(mktemp)"; stage_service_tmp="$(mktemp)"; self_tmp="$(mktemp)"; router_helper="$(mktemp)"
trap 'rm -f "$tmp" "$sync_tmp" "$policy_tmp" "$hot_tmp" "$geo_tmp" "$metrics_tmp" "$profile_tmp" "$tls_tmp" "$tls_status_tmp" "$renew_tmp" "$stage_tmp" "$stage_service_tmp" "$self_tmp" "$router_helper"' EXIT

[[ -f /usr/local/sbin/xmesh-xray-sync ]] || { echo "Managed Xray synchronizer not found. The node must be enrolled first." >&2;exit 1; }
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/main/deploy/xmesh-xray-sync.sh -o "$sync_tmp"
bash -n "$sync_tmp"; grep -q 'pinned-image' "$sync_tmp" || { echo "Downloaded sync worker lacks image pin support" >&2;exit 1; }; grep -q 'xmesh-policy-guard.py' "$sync_tmp" || { echo "Sync worker cannot enforce offline policy" >&2;exit 1; }
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/main/deploy/xmesh-policy-guard.py -o "$policy_tmp"
python3 -m py_compile "$policy_tmp"; grep -q 'check_signature' "$policy_tmp" || { echo "Policy verifier lacks Ed25519 verification" >&2;exit 1; }
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/main/deploy/xmesh-hot-user-reconcile.py -o "$hot_tmp"
python3 -m py_compile "$hot_tmp"; grep -q 'HandlerService' "$hot_tmp" || { echo "Hot user reconciler lacks HandlerService contract" >&2;exit 1; }
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/main/deploy/xmesh-geodata-sync.py -o "$geo_tmp"
python3 -m py_compile "$geo_tmp"; grep -q 'MAX_FILE_BYTES' "$geo_tmp" || { echo "GeoData synchronizer lacks size bounds" >&2;exit 1; }
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/node-metrics-agent.sh -o "$metrics_tmp"
bash -n "$metrics_tmp"; grep -q 'xmesh-node-user-metrics.json' "$metrics_tmp" || { echo "Metrics agent cannot read autonomous counters" >&2;exit 1; }
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/main/deploy/xmesh-profile-attest.py -o "$profile_tmp"
python3 -m py_compile "$profile_tmp"; grep -q 'xmesh-managed-xray' "$profile_tmp" && grep -q 'verify_envelope' "$profile_tmp" || { echo "Invalid signed profile attestation helper" >&2;exit 1; }
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/main/deploy/xmesh-tls-provision.py -o "$tls_tmp"
python3 -m py_compile "$tls_tmp"; grep -q 'letsencrypt-http01' "$tls_tmp" || { echo "TLS worker missing signed ACME contract support" >&2;exit 1; }
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/main/deploy/xmesh-tls-status.py -o "$tls_status_tmp"
python3 -m py_compile "$tls_status_tmp"; grep -q 'certificate_file_missing' "$tls_status_tmp" || { echo "TLS health helper validation failed" >&2;exit 1; }
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/main/deploy/xmesh-tls-renew-hook.sh -o "$renew_tmp"
bash -n "$renew_tmp"
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/xsp-v2-agent-staged-apply.sh -o "$stage_tmp"
bash -n "$stage_tmp"; grep -q "artifactVersion" "$stage_tmp" && grep -q -- "--identity" "$stage_tmp" && grep -q "last-known-good.json" "$stage_tmp" || { echo "Invalid staged Agent executor" >&2;exit 1; }
curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/xmesh-xsp-v2-agent-stage.service -o "$stage_service_tmp"
grep -Fq 'ExecStart=/usr/local/libexec/xmesh-xsp-v2-agent-staged-apply' "$stage_service_tmp" && grep -Fq 'ReadWritePaths=/run /var/lib/xmesh-agent' "$stage_service_tmp" || { echo "Invalid staged Agent systemd unit" >&2;exit 1; }

update_router() {
 command -v docker >/dev/null && command -v git >/dev/null || { echo "Docker/git missing for router upgrade" >&2; return 1; }
 export HOME=/run/xmesh-node-router-upgrade DOCKER_CONFIG=/run/xmesh-node-router-upgrade/.docker BUILDX_CONFIG=/run/xmesh-node-router-upgrade/.buildx XDG_CONFIG_HOME=/run/xmesh-node-router-upgrade/.config XDG_CACHE_HOME=/run/xmesh-node-router-upgrade/.cache TMPDIR=/run/xmesh-node-router-upgrade/tmp
 install -d -m 0700 "$HOME" "$DOCKER_CONFIG" "$BUILDX_CONFIG" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$TMPDIR" || return 1
 docker --config "$DOCKER_CONFIG" compose version >/dev/null 2>&1 || { echo "Docker Compose missing" >&2; return 1; }
 local mounted dir previous new_revision identity
 mounted="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/xmesh-node/config.json"}}{{.Source}}{{end}}{{end}}' xmesh-node 2>/dev/null)" || return 1
 [[ -f "$mounted" ]] || { echo "Router config mount missing" >&2; return 1; }
 dir="$(dirname "$mounted")"
 [[ -f "$dir/compose.yaml" || -f "$dir/docker-compose.yml" || -f "$dir/docker-compose.yaml" ]] || { echo "Router compose file missing in $dir" >&2; return 1; }
 [[ "$(git -C "$dir" remote get-url origin)" == "https://github.com/TriplexCorp/XMesh-Node.git" || "$(git -C "$dir" remote get-url origin)" == "git@github.com:TriplexCorp/XMesh-Node.git" ]] || { echo "Router source origin is not XMesh-Node; refusing automatic upgrade" >&2; return 1; }
 [[ -z "$(git -C "$dir" status --porcelain --untracked-files=no)" ]] || { echo "Router source has local changes; refusing automatic upgrade" >&2; return 1; }
 previous="$(git -C "$dir" rev-parse HEAD)" || return 1
 if [[ "$(git -C "$dir" rev-parse --is-shallow-repository)" == true ]];then git -C "$dir" fetch --unshallow origin main || return 1; else git -C "$dir" fetch origin main || return 1; fi
 git -C "$dir" merge-base --is-ancestor "$previous" FETCH_HEAD || { echo "Router repository cannot fast-forward safely" >&2; return 1; }
 git -C "$dir" merge --ff-only FETCH_HEAD || return 1
 new_revision="$(git -C "$dir" rev-parse HEAD)" || return 1
 [[ "$new_revision" =~ ^[0-9a-f]{40}$ ]] || return 1
 [[ -f "$dir/VERSION" && "$(tr -d '\r\n' < "$dir/VERSION")" == "6.0.0" ]] || { echo "XMesh-Node main is not v6.0.0" >&2; return 1; }
 [[ -f "$dir/AGENT_VERSION" && "$(tr -d '\r\n' < "$dir/AGENT_VERSION")" == "control-v6.0.1" ]] || { echo "XMesh-Node main does not expose Agent control-v6.0.1" >&2; return 1; }
 [[ -f "$dir/deploy/install-xsp-v2-production-agent.sh" && ! -L "$dir/deploy/install-xsp-v2-production-agent.sh" ]] || { echo "v6 PQ Agent installer is missing" >&2; return 1; }
 if (cd "$dir" && docker --config "$DOCKER_CONFIG" compose build xmesh-node && docker --config "$DOCKER_CONFIG" compose run --rm --no-deps xmesh-node -check -config /etc/xmesh-node/config.json && docker --config "$DOCKER_CONFIG" compose up -d --no-deps --force-recreate xmesh-node && [[ "$(docker inspect -f '{{.State.Running}}' xmesh-node)" == true ]] && bash deploy/install-xsp-v2-production-agent.sh "$new_revision");then
  identity="$(/usr/local/bin/xmesh-agent-xspv2-activate --identity)" || return 1
  python3 - "$identity" "$new_revision" <<'PY'
import json,sys
v=json.loads(sys.argv[1])
assert v.get('version')=='control-v6.0.1',v
assert v.get('sourceRevision')==sys.argv[2],v
assert isinstance(v.get('artifactSha256'),str) and len(v['artifactSha256'])==64,v
PY
  echo "Router and v6 strict-PQ production Agent upgraded and verified."
  return 0
 fi
 echo "v6 node upgrade failed; restoring previous router source/container." >&2
 git -C "$dir" reset --hard "$previous" || return 1
 (cd "$dir" && docker --config "$DOCKER_CONFIG" compose build xmesh-node && docker --config "$DOCKER_CONFIG" compose up -d --no-deps --force-recreate xmesh-node) || return 1
 [[ "$(docker inspect -f '{{.State.Running}}' xmesh-node)" == true ]]
 return 1
}

curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/update-node-control-agent.sh -o "$self_tmp"
bash -n "$self_tmp"; grep -q 'xmesh-node-agent-upgrade.service' "$self_tmp" || { echo "Invalid agent updater" >&2; exit 1; }
{
 printf '%s\n' '#!/usr/bin/env bash' 'set -Eeuo pipefail'; declare -f update_router; printf '%s\n' 'update_router'
} > "$router_helper"
bash -n "$router_helper"; install -o root -g root -m 0700 "$router_helper" /usr/local/sbin/.xmesh-router-upgrade.new
if ! systemd-run --quiet --wait --collect --pipe --unit=xmesh-node-router-upgrade --property=Type=oneshot --property=TimeoutStartSec=650s --property=ProtectSystem=strict --property=ProtectHome=true --property=ReadWritePaths=/opt/xmesh-node --property=ReadWritePaths=/run --property=ReadWritePaths=/usr/local/bin --property=ReadWritePaths=/var/lib/xmesh-agent /usr/local/sbin/.xmesh-router-upgrade.new;then
 echo "v6 router/PQ update failed; full Agent upgrade is NOT successful. Check journalctl -u xmesh-node-router-upgrade." >&2; rm -f /usr/local/sbin/.xmesh-router-upgrade.new; exit 1
fi
rm -f /usr/local/sbin/.xmesh-router-upgrade.new

if [[ -f /usr/local/sbin/xmesh-node-control ]];then cp -p /usr/local/sbin/xmesh-node-control /usr/local/sbin/xmesh-node-control.bak;fi
cp -p /usr/local/sbin/xmesh-xray-sync /usr/local/sbin/xmesh-xray-sync.bak
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0700 "$stage_tmp" /usr/local/libexec/.xmesh-xsp-v2-agent-staged-apply.new; mv -f /usr/local/libexec/.xmesh-xsp-v2-agent-staged-apply.new /usr/local/libexec/xmesh-xsp-v2-agent-staged-apply
install -o root -g root -m 0700 "$profile_tmp" /usr/local/libexec/.xmesh-profile-attest.new; mv -f /usr/local/libexec/.xmesh-profile-attest.new /usr/local/libexec/xmesh-profile-attest.py
install -o root -g root -m 0700 "$policy_tmp" /usr/local/libexec/.xmesh-policy-guard.new; mv -f /usr/local/libexec/.xmesh-policy-guard.new /usr/local/libexec/xmesh-policy-guard.py
install -o root -g root -m 0700 "$hot_tmp" /usr/local/libexec/.xmesh-hot-user-reconcile.new; mv -f /usr/local/libexec/.xmesh-hot-user-reconcile.new /usr/local/libexec/xmesh-hot-user-reconcile.py
install -o root -g root -m 0700 "$geo_tmp" /usr/local/libexec/.xmesh-geodata-sync.new; mv -f /usr/local/libexec/.xmesh-geodata-sync.new /usr/local/libexec/xmesh-geodata-sync.py
install -o root -g root -m 0700 "$tls_status_tmp" /usr/local/libexec/.xmesh-tls-status.new; mv -f /usr/local/libexec/.xmesh-tls-status.new /usr/local/libexec/xmesh-tls-status.py
install -o root -g root -m 0700 "$tls_tmp" /usr/local/libexec/.xmesh-tls-provision.new; mv -f /usr/local/libexec/.xmesh-tls-provision.new /usr/local/libexec/xmesh-tls-provision.py
install -o root -g root -m 0700 "$renew_tmp" /usr/local/sbin/.xmesh-tls-renew-hook.new; mv -f /usr/local/sbin/.xmesh-tls-renew-hook.new /usr/local/sbin/xmesh-tls-renew-hook
install -o root -g root -m 0700 "$sync_tmp" /usr/local/sbin/.xmesh-xray-sync.new; mv -f /usr/local/sbin/.xmesh-xray-sync.new /usr/local/sbin/xmesh-xray-sync
install -d -o root -g root -m 0700 /var/lib/xmesh-xray-sync
install -o root -g root -m 0700 "$tmp" /usr/local/sbin/.xmesh-node-control.new; mv -f /usr/local/sbin/.xmesh-node-control.new /usr/local/sbin/xmesh-node-control
install -o root -g root -m 0755 "$metrics_tmp" /usr/local/sbin/.xmesh-node-metrics.new; mv -f /usr/local/sbin/.xmesh-node-metrics.new /usr/local/sbin/xmesh-node-metrics
install -d -o root -g root -m 0700 /var/lib/xmesh-node-control
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
ReadWritePaths=/usr/local/sbin /usr/local/bin /usr/local/libexec /etc/systemd/system /var/lib/xmesh-node-control /var/lib/xmesh-xray-sync /var/lib/xmesh-agent -/opt/xmesh-node -/root/XMesh-Node /run
EOF
install -o root -g root -m 0644 "$stage_service_tmp" /etc/systemd/system/.xmesh-xsp-v2-agent-stage.service.new; mv -f /etc/systemd/system/.xmesh-xsp-v2-agent-stage.service.new /etc/systemd/system/xmesh-xsp-v2-agent-stage.service
systemctl daemon-reload
if [[ -f /etc/systemd/system/xmesh-xray-sync.timer && -f /etc/systemd/system/xmesh-xray-sync.service ]];then systemctl enable xmesh-xray-sync.timer; systemctl restart xmesh-xray-sync.timer; else echo "WARNING: Xray sync timer is absent; offline policy enforcement is not active." >&2;fi
systemctl enable xmesh-node-control.timer; systemctl restart xmesh-node-control.timer; systemctl restart xmesh-node-metrics.timer; systemctl enable xmesh-node-user-meter.timer; systemctl restart xmesh-node-user-meter.timer
if ! systemctl start xmesh-node-user-meter.service; then echo "WARNING: Xray user sampler is not ready. Check: journalctl -u xmesh-node-user-meter.service -n 50 --no-pager" >&2;fi
install -o root -g root -m 0700 "$self_tmp" /usr/local/sbin/.xmesh-update-agent.new; mv -f /usr/local/sbin/.xmesh-update-agent.new /usr/local/sbin/xmesh-update-agent
if systemctl list-unit-files xmesh-xray-sync.service --no-legend 2>/dev/null | grep -q '^xmesh-xray-sync.service'; then systemctl start --no-block xmesh-xray-sync.service || echo "WARNING: Unable to queue immediate Xray reconciliation; timer will retry." >&2;fi
if [[ "$MODE" != --remote ]]; then systemctl start xmesh-node-control.service;fi
grep -Fxq 'AGENT_VERSION="control-v6.0.1"' /usr/local/sbin/xmesh-node-control || { echo "v6 Agent version verification failed" >&2; exit 1; }
/usr/local/bin/xmesh-agent-xspv2-activate --identity | python3 -c 'import json,sys;v=json.load(sys.stdin);assert v["version"]=="control-v6.0.1" and len(v["artifactSha256"])==64'
echo "XMesh Agent v6.0.1 POSTQUANTUM installed: signed control, verified PQ runtime, offline policy and pinned Xray synchronizer are active."