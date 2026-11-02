#!/usr/bin/env python3
from pathlib import Path


def read(path):
    return Path(path).read_text()


def write(path, value):
    Path(path).write_text(value)


def replace_required(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing replacement anchor: {label}")
    return text.replace(old, new)


# Release-wide target bump. AGENT_VERSION was already bumped on this branch.
for path in [
    "backend/src/node_runtime.rs",
    "deploy/install-node-metrics-agent.sh",
    "deploy/node-control-agent.sh",
    "deploy/update-node-control-agent.sh",
    "docs/AGENT_RELEASE_POLICY.md",
    "scripts/check-agent-update-base.js",
    "scripts/check-agent-update.js",
]:
    text = read(path).replace("control-v6.0.6", "control-v6.0.7")
    write(path, text)

# Rolling gateway window: target 6.0.7, immediately previous 6.0.6.
path = "deploy/xsp-v2-product-gateway/main.go"
text = read(path)
text = replace_required(
    text,
    'targetAgentVersion     = "control-v6.0.6"\n\tpreviousAgentVersion   = "control-v6.0.5"',
    'targetAgentVersion     = "control-v6.0.7"\n\tpreviousAgentVersion   = "control-v6.0.6"',
    "gateway rolling versions",
)
write(path, text)

path = "deploy/install-node-metrics-agent.sh"
text = read(path).replace(
    "Nexus main does not expose Agent v6.0.5",
    "Nexus main does not expose Agent v6.0.7",
)
write(path, text)

# Mark the freshly downloaded updater with a stable capability marker.
path = "deploy/update-node-control-agent.sh"
text = read(path)
text = replace_required(
    text,
    'set -Eeuo pipefail\nMODE="${1:-manual}"',
    'set -Eeuo pipefail\n# Stable marker consumed by the signed control worker before executing a freshly downloaded updater.\nXMESH_TARGET_AWARE_UPDATER=1\nMODE="${1:-manual}"',
    "target-aware updater marker",
)
text = text.replace(
    "XMesh Agent v6.0.5 POSTQUANTUM installed",
    "XMesh Agent v6.0.7 POSTQUANTUM installed",
)
write(path, text)

# The signed control path must never blindly execute the updater installed by the
# previous release. It always downloads a fresh updater, validates it against the
# authenticated targetVersion, and executes it in a hardened transient unit.
path = "deploy/node-control-agent.sh"
text = read(path)
start = text.index("UPDATER_RESULT_UNIT=xmesh-node-agent-upgrade.service")
end = text.index("stop_xray(){", start)
block = r'''UPDATER_RESULT_UNIT=xmesh-node-agent-upgrade-repair
UPDATER_ERROR=''
sanitize_updater_error(){
 local log="${1:-}" result=''
 [[ -f "$log" && ! -L "$log" ]] || return 0
 result="$(python3 - "$log" <<'PYERR'
import re,sys
try:
    raw=open(sys.argv[1],encoding='utf-8',errors='replace').read()[-8192:]
except OSError:
    raise SystemExit(0)
lines=[line.strip() for line in raw.splitlines() if line.strip()]
if not lines:
    raise SystemExit(0)
value=re.sub(r'[^A-Za-z0-9 .,:;_+/@()=\-]', ' ', lines[-1])
value=re.sub(r'\s+',' ',value).strip()[:220]
print(value)
PYERR
)"
 printf '%s' "$result"
}
verify_agent_install(){
 local expected_version="${1:-}" binary identity
 [[ "$expected_version" =~ ^control-v6\.[0-9]+\.[0-9]+$ ]] || return 1
 [[ -f /usr/local/sbin/xmesh-node-control && ! -L /usr/local/sbin/xmesh-node-control ]] || return 1
 grep -Fxq "AGENT_VERSION=\"$expected_version\"" /usr/local/sbin/xmesh-node-control || return 1
 [[ -f /usr/local/sbin/xmesh-update-agent && ! -L /usr/local/sbin/xmesh-update-agent && -x /usr/local/sbin/xmesh-update-agent ]] || return 1
 grep -Fq 'XMESH_TARGET_AWARE_UPDATER=1' /usr/local/sbin/xmesh-update-agent || return 1
 systemctl cat xmesh-node-agent-upgrade.service >/dev/null 2>&1 || return 1
 for binary in /usr/local/bin/xmesh-agent-xspv2-activate /usr/local/bin/xmesh-agent-xspv2-product;do
  [[ -f "$binary" && ! -L "$binary" && -x "$binary" ]] || return 1
  identity="$(timeout 10 "$binary" --identity 2>/dev/null)" || return 1
  python3 - "$identity" "$expected_version" <<'PYID'
import json,sys
try:
    value=json.loads(sys.argv[1])
except (json.JSONDecodeError,TypeError):
    raise SystemExit(1)
if value.get('version') != sys.argv[2]: raise SystemExit(1)
if not isinstance(value.get('sourceRevision'),str) or len(value['sourceRevision']) != 40: raise SystemExit(1)
if not isinstance(value.get('artifactSha256'),str) or len(value['artifactSha256']) != 64: raise SystemExit(1)
PYID
 done
 router_running
}
run_agent_updater(){
 local expected_version="${1:-}" transient_unit=xmesh-node-agent-upgrade-repair
 local bootstrap=/run/xmesh-node-control/update-node-control-agent.bootstrap
 local log=/run/xmesh-node-control/agent-update-output.log rc=0 reason=''
 UPDATER_ERROR=''
 [[ "$expected_version" =~ ^control-v6\.[0-9]+\.[0-9]+$ ]] || { UPDATER_ERROR='Invalid expected Agent target version'; return 1; }
 install -d -m 0700 /run/xmesh-node-control || { UPDATER_ERROR='Cannot prepare Agent updater state';return 1; }
 rm -f "$bootstrap" "$log"
 if ! curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/update-node-control-agent.sh -o "$bootstrap";then
  UPDATER_ERROR='Fresh Agent updater download failed';return 1
 fi
 if ! bash -n "$bootstrap" || ! grep -Fq 'XMESH_TARGET_AWARE_UPDATER=1' "$bootstrap" || ! grep -Fq "AGENT_VERSION=\"$expected_version\"" "$bootstrap" || ! grep -Fq 'xmesh-node-agent-upgrade.service' "$bootstrap";then
  rm -f "$bootstrap";UPDATER_ERROR='Fresh Agent updater failed target validation';return 1
 fi
 chmod 0700 "$bootstrap"
 UPDATER_RESULT_UNIT="$transient_unit"
 systemctl reset-failed "$transient_unit" >/dev/null 2>&1 || true
 if timeout 650 systemd-run --quiet --wait --collect --pipe --unit="$transient_unit" \
  --property=Type=oneshot --property=TimeoutStartSec=650s \
  --property=NoNewPrivileges=true --property=PrivateTmp=true \
  --property=ProtectSystem=strict --property=ProtectHome=true \
  --property=ProtectKernelModules=true --property=ProtectKernelTunables=true \
  --property=ProtectControlGroups=true --property=RestrictSUIDSGID=true \
  --property=LockPersonality=true \
  --property=ReadWritePaths=/usr/local/sbin --property=ReadWritePaths=/usr/local/bin \
  --property=ReadWritePaths=/usr/local/libexec --property=ReadWritePaths=/etc/systemd/system \
  --property=ReadWritePaths=/var/lib/xmesh-node-control --property=ReadWritePaths=/var/lib/xmesh-xray-sync \
  --property=ReadWritePaths=/var/lib/xmesh-agent --property=ReadWritePaths=-/opt/xmesh-node \
  --property=ReadWritePaths=-/root/XMesh-Node --property=ReadWritePaths=/run \
  "$bootstrap" --remote >"$log" 2>&1;then
  rc=0
 else
  rc=$?
  reason="$(sanitize_updater_error "$log")"
  if [[ -n "$reason" ]];then UPDATER_ERROR="Agent update failed: $reason";else UPDATER_ERROR='Agent updater transient service failed';fi
 fi
 rm -f "$bootstrap"
 return "$rc"
}
'''
text = text[:start] + block + text[end:]

old = '''if run_agent_updater "$target_version" && grep -Fxq "AGENT_VERSION=\\\"$target_version\\\"" /usr/local/sbin/xmesh-node-control;then
   success=true;detail='Agent installed and version verified' '''.rstrip()
new = '''if run_agent_updater "$target_version" && verify_agent_install "$target_version";then
   success=true;detail='Agent installed and full runtime verified' '''.rstrip()
text = replace_required(text, old, new, "legacy update post-install verification")
write(path, text)

# Policy: fresh target-bound updater is mandatory for both repair and normal path.
path = "docs/AGENT_RELEASE_POLICY.md"
text = read(path)
anchor = "Updater self-repair must validate a downloaded bootstrap against the **commanded target Agent version** from the authenticated/signed update request. It must never pin repair validation to a literal version embedded in the older running Agent; otherwise a missing updater unit could deadlock the next release."
addition = anchor + "\n\nThe normal signed update path follows the same rule: it must execute a **fresh target-validated updater bootstrap**, not blindly start the updater executable installed by the previous release. The installed static updater service is an emergency/local fallback and must never become the authority that decides whether N can update to N+1. Failure ACKs should carry a bounded sanitized updater reason so operators are not left with only `systemd: exit-code`."
text = replace_required(text, anchor, addition, "release policy fresh updater rule")
write(path, text)

# CI regression guards.
path = "scripts/check-agent-update.js"
text = read(path)
text = text.replace(
    'assert.match(gateway,/previousAgentVersion\\s*=\\s*"control-v6[.]0[.]5"/',
    'assert.match(gateway,/previousAgentVersion\\s*=\\s*"control-v6[.]0[.]6"/',
)
anchor = "assert.doesNotMatch(controlAgent,/grep -Fq ['\\\"]AGENT_VERSION=\\\\\\\"control-v6[.]0[.]7\\\\\\\"['\\\"] \\\"\\$bootstrap\\\"/,\n  'repair bootstrap must never pin validation to the running Agent release literal');"
extra = anchor + "\nassert.match(controlAgent,/update-node-control-agent[.]sh -o \\\"\\$bootstrap\\\"/,\n  'signed update path must fetch a fresh updater bootstrap for every target release');\nassert.match(controlAgent,/grep -Fq 'XMESH_TARGET_AWARE_UPDATER=1' \\\"\\$bootstrap\\\"/,\n  'fresh updater bootstrap must advertise the target-aware contract');\nassert.doesNotMatch(controlAgent,/systemctl start --wait \\\"\\$static_unit\\\"/,\n  'signed updates must never blindly execute the updater frozen into the previous release');\nassert.match(controlAgent,/verify_agent_install \\\"\\$target_version\\\"/,\n  'legacy update success must require the full post-install runtime self-test');\nassert.match(controlAgent,/sanitize_updater_error/,\n  'failed updates must return a bounded sanitized updater reason instead of a generic systemd exit code');"
text = replace_required(text, anchor, extra, "dynamic updater regression assertions")
write(path, text)

path = "scripts/check-agent-update-base.js"
text = read(path)
anchor = 'assert.match(updater,/MODE=\\"\\$\\{1:-manual\\}\\"/);'
extra = anchor + "\nassert.match(updater,/XMESH_TARGET_AWARE_UPDATER=1/,'Updater must expose stable target-aware marker');\nassert.match(agent,/sanitize_updater_error/,'Control Agent must preserve safe updater failure context');\nassert.doesNotMatch(agent,/systemctl start --wait \\\"\\$static_unit\\\"/,'Signed path must not execute stale static updater');"
text = replace_required(text, anchor, extra, "baseline updater regression assertions")
write(path, text)

assert read("AGENT_VERSION").strip() == "control-v6.0.7"
for path in [
    "deploy/node-control-agent.sh",
    "deploy/update-node-control-agent.sh",
    "deploy/install-node-metrics-agent.sh",
]:
    if "control-v6.0.6" in read(path):
        raise SystemExit(f"stale target in {path}")
