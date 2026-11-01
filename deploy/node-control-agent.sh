#!/usr/bin/env bash
# Dedicated fixed-action XMesh control worker. Does not evaluate scripts or
# commands received from the panel. Root is necessary only for systemd restart.
set -Eeuo pipefail
umask 077
export LC_ALL=C

: "${XMESH_API_URL:?Missing panel URL}"
: "${XMESH_NODE_ID:?Missing node ID}"
[[ "$XMESH_NODE_ID" =~ ^[1-9][0-9]*$ ]] || exit 2
[[ "$XMESH_API_URL" == https://* ]] || exit 2
XMESH_API_URL="${XMESH_API_URL%/}"
KEY="${XMESH_METRICS_PRIVATE_KEY:-/etc/xmesh-node-metrics/node.key}"
AGENT_VERSION="control-v6.0.6"
UNIT="${XMESH_XRAY_UNIT:-xray.service}"
# Only root-owned local configuration can choose a unit. Remote responses never do.
[[ "$UNIT" =~ ^[A-Za-z0-9_.@-]+\.service$ ]] || { echo "Invalid systemd unit" >&2; exit 2; }
[[ -r "$KEY" ]] || { echo "XMesh Ed25519 key unavailable" >&2; exit 2; }
for required in curl flock python3 sha256sum readlink systemd-run timeout; do
 command -v "$required" >/dev/null 2>&1 || exit 2
done
exec 9>/run/xmesh-node-control.lock
flock -n 9 || exit 0

signed_post(){
 local path="$1" payload="$2" timestamp nonce digest signfile signature
 timestamp="$(date +%s)"
 nonce="$(openssl rand -hex 16)"
 digest="$(printf '%s' "$payload" | openssl dgst -sha256 -r | awk '{print $1}')"
 signfile="$(mktemp)"
 printf 'XMESH1\nPOST\n%s\n%s\n%s\n%s\n%s\n' "$path" "$XMESH_NODE_ID" "$timestamp" "$nonce" "$digest" > "$signfile"
 signature="$(openssl pkeyutl -sign -rawin -inkey "$KEY" -in "$signfile" | od -An -tx1 -v | tr -d ' \n')"
 rm -f "$signfile"
 [[ "${#signature}" == 128 ]] || return 1
 # Report the failed endpoint and status, never credentials or payload.
 # A failed signed control request MUST remain a failure: do not silently
 # treat HTTP 500 as a successful heartbeat or an allow-to-run directive.
 local response status
 response="$(mktemp)"
 status="$(curl --proto '=https' --tlsv1.2 --silent --show-error --max-time 12 \
   --output "$response" --write-out '%{http_code}' \
   -X POST "$XMESH_API_URL$path" \
   -H "X-XMesh-Timestamp: $timestamp" \
   -H "X-XMesh-Nonce: $nonce" \
   -H "X-XMesh-Signature: $signature" \
   -H "Content-Type: application/json" --data-binary "$payload")" || {
     rm -f "$response"
     echo "XMesh control request failed: POST $path (transport error)" >&2
     return 1
   }
 if [[ ! "$status" =~ ^2[0-9][0-9]$ ]];then
   rm -f "$response"
   echo "XMesh control request failed: POST $path (HTTP $status)" >&2
   return 1
 fi
 cat "$response"
 rm -f "$response"
}
# Report the actual runtime, whether native systemd or the XMesh-managed container.
xray_running(){
 if docker inspect -f '{{.State.Running}}' xmesh-managed-xray 2>/dev/null | grep -qx true; then return 0; fi
 systemctl is-active --quiet "$UNIT"
}
router_running(){
 # The edge router and managed Xray are independent processes: report each
 # one's actual state rather than pretending Xray health implies router health.
 if docker inspect -f '{{.State.Running}}' xmesh-node 2>/dev/null | grep -qx true;then return 0;fi
 systemctl is-active --quiet xmesh-node.service
}
heartbeat(){
 local xr=false router=false version='' raw=''
 if xray_running;then xr=true;fi
 if router_running;then router=true;fi
 if docker inspect -f '{{.State.Running}}' xmesh-managed-xray 2>/dev/null | grep -qx true;then
  raw="$(timeout 5 docker exec xmesh-managed-xray xray version 2>/dev/null || true)"
 elif command -v xray >/dev/null 2>&1;then
  raw="$(timeout 5 xray version 2>/dev/null || true)"
 fi
 version="$(printf '%s\n' "$raw" | awk 'NR==1 && $1=="Xray" {print $2}')"
 [[ "$version" =~ ^[A-Za-z0-9._+-]{1,40}$ ]] || version=''
 local geo_data='null'
 if [[ -r /var/lib/xmesh-xray-sync/geo-status.json ]];then
  geo_data="$(python3 - /var/lib/xmesh-xray-sync/geo-status.json <<'PY'
import json,sys
try:
 with open(sys.argv[1],encoding="utf-8") as stream: data=json.load(stream)
 if not isinstance(data,dict):raise ValueError("Not an object")
 result={key:data.get(key) for key in ("state","checkedAt","files","lastError","refreshRevision")}
 print(json.dumps(result,separators=(",",":")))
except (OSError,ValueError,TypeError):
 print("null")
PY
)"
 fi
 local tls_status='null'
 if [[ -r /usr/local/libexec/xmesh-tls-status.py ]];then
  tls_status="$(timeout 7 python3 /usr/local/libexec/xmesh-tls-status.py 2>/dev/null || printf 'null')"
  [[ "$tls_status" == \{*\} ]] || tls_status='null'
 fi
 local revision_json='null' profile_check='helper_missing' report=''
 if [[ "$xr" == false ]];then
  profile_check='xray_stopped'
 elif [[ -r /usr/local/libexec/xmesh-profile-attest.py ]];then
  report="$(timeout 8 python3 /usr/local/libexec/xmesh-profile-attest.py --json 2>/dev/null || true)"
  local parsed
  parsed="$(printf '%s' "$report" | python3 -c '
import json,sys,re
try:
 d=json.load(sys.stdin)
 status=d.get("status")
 allowed={"verified","policy_missing","active_config_missing","guard_unavailable","policy_invalid","revision_invalid","policy_hash_mismatch","active_config_invalid","active_config_mismatch","xray_stopped","mount_mismatch","container_unavailable"}
 if status not in allowed:raise ValueError()
 rev=d.get("revision")
 if status=="verified" and isinstance(rev,str) and re.fullmatch(r"[a-f0-9]{64}",rev):
  print(status+" "+rev)
 else:
  print(status+" -")
except (ValueError,TypeError,KeyError):
 print("helper_error -")
')"
  read -r profile_check parsed_revision <<< "$parsed"
  if [[ "$parsed_revision" =~ ^[a-f0-9]{64}$ ]];then revision_json="\"$parsed_revision\"";fi
 fi
 local ack=''
 ack="$(signed_post '/api/v1/node/heartbeat' "{\"node_id\":$XMESH_NODE_ID,\"version\":\"$AGENT_VERSION\",\"xray_version\":\"$version\",\"xray_running\":$xr,\"router_running\":$router,\"geoData\":$geo_data,\"tlsStatus\":$tls_status,\"appliedRevision\":$revision_json,\"profileCheck\":\"$profile_check\"}")"
 # Reconcile missing desired-state records without treating a node-supplied
 # digest as authoritative. Rate-limit even when the panel requests repeatedly.
 if [[ "$xr" == true && -f /etc/systemd/system/xmesh-xray-sync.service ]] &&
    printf '%s' "$ack" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("accepted") is True and d.get("reconcileDesired") is True else 1)' ;then
  local stamp=/var/lib/xmesh-node-control/desired-reconcile-at now last=0
  now="$(date +%s)"
  if [[ -r "$stamp" ]];then read -r last < "$stamp" || last=0;fi
  [[ "$last" =~ ^[0-9]+$ ]] || last=0
  if (( now-last >= 300 ));then
   install -d -m 0700 /var/lib/xmesh-node-control
   printf '%s\n' "$now" > "$stamp"
   chmod 600 "$stamp"
   systemctl start --no-block xmesh-xray-sync.service || true
  fi
 fi
}
restart_xray(){
 if docker inspect xmesh-managed-xray >/dev/null 2>&1;then
  timeout 35 docker restart xmesh-managed-xray >/dev/null &&
   docker inspect -f '{{.State.Running}}' xmesh-managed-xray | grep -qx true
 else
  timeout 35 systemctl restart "$UNIT" && systemctl is-active --quiet "$UNIT"
 fi
}
# Only the specifically managed container may be upgraded. A non-managed
# Xray, arbitrary Docker container or remote-selected image is never modified.
persist_pinned_xray_image(){
 local image="$1"
 [[ "$image" =~ ^ghcr[.]io/xtls/xray-core:[0-9]+[.][0-9]+[.][0-9]+([._+-][A-Za-z0-9._+-]+)?$ ]] || return 1
 local state=/var/lib/xmesh-xray-sync
 local tmp
 tmp="$(mktemp "$state/pin.XXXXXXXX")" || return 1
 printf '%s\n' "$image" > "$tmp"
 chmod 600 "$tmp"
 mv -f "$tmp" "$state/pinned-image"
}
update_managed_xray(){
 local version="${1:?Pinned Xray version required}"
 [[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$ ]] || {
  detail='Invalid pinned release version';return 1
 }
 command -v docker >/dev/null || { detail='Docker not installed';return 1; }
 local name=xmesh-managed-xray
 # Official GitHub tags are v26.x.y; GHCR uses 26.x.y (without v).
 local image_tag="${version#v}"
 [[ "$image_tag" =~ ^[0-9]+[.][0-9]+[.][0-9]+([._+-][A-Za-z0-9._+-]+)?$ ]] || {
  detail='Release tag has no compatible official GHCR image';return 1
 }
 local image="ghcr.io/xtls/xray-core:$image_tag"
 local config=/var/lib/xmesh-xray-sync/config.json
 # The reconciliation worker uses this same lock. Never race deployments.
 [[ -d /var/lib/xmesh-xray-sync ]] || { detail='Managed Xray state missing';return 1; }
 exec 8>/var/lib/xmesh-xray-sync/lock
 flock -w 10 8 || { detail='Xray configuration sync currently busy';return 1; }
 if ! docker inspect "$name" >/dev/null 2>&1;then
  detail='Managed Xray container not found';return 1
 fi
 [[ -f "$config" ]] || { detail='Managed Xray config not found';return 1; }
 local geo_mount=()
 if compgen -G "/var/lib/xmesh-xray-sync/assets/*.dat" >/dev/null;then
  geo_mount=(-e XRAY_LOCATION_ASSET=/usr/local/share/xray -v /var/lib/xmesh-xray-sync/assets:/usr/local/share/xray:ro)
 fi
 local old_image new_image
 old_image="$(docker inspect -f '{{.Image}}' "$name")" || return 1
 [[ "$old_image" =~ ^sha256:[0-9a-f]{64}$ ]] || { detail='Invalid previous image identity';return 1; }
 if ! timeout 75 docker pull "$image" >/dev/null;then
  detail='Xray image download failed';return 1
 fi
 new_image="$(docker image inspect -f '{{.Id}}' "$image")" || return 1
 [[ "$new_image" =~ ^sha256:[0-9a-f]{64}$ ]] || { detail='Invalid new image identity';return 1; }
 if [[ "$old_image" == "$new_image" ]];then
  persist_pinned_xray_image "$image" || { detail='Failed to persist image pin';return 1; }
  detail="Xray $version already installed";return 0
 fi
 if ! timeout 25 docker run --rm --network none --user 0:0 --cap-drop ALL \
  --security-opt no-new-privileges --entrypoint xray \
  -v "$config:/etc/xray/config.json:ro" "${geo_mount[@]}" "$new_image" \
  run -test -config /etc/xray/config.json >/dev/null;then
  detail='New Xray image failed config validation';return 1
 fi
 docker rm -f "$name" >/dev/null || { detail='Could not stop previous Xray';return 1; }
 if docker run -d --name "$name" --restart unless-stopped --network host \
  --user 0:0 --read-only --security-opt no-new-privileges --cap-drop ALL \
  -v "$config:/etc/xray/config.json:ro" "${geo_mount[@]}" "$new_image" \
  run -config /etc/xray/config.json >/dev/null;then
   sleep 3
   if docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -qx true;then
    if ! persist_pinned_xray_image "$image";then
     detail='Xray installed but image pin could not be persisted';return 1
    fi
    detail="Xray $version installed and running";return 0
   fi
 fi
 docker rm -f "$name" >/dev/null 2>&1 || true
 # Roll back to the exact locally cached prior image, never a moving tag.
 if docker run -d --name "$name" --restart unless-stopped --network host \
  --user 0:0 --read-only --security-opt no-new-privileges --cap-drop ALL \
  -v "$config:/etc/xray/config.json:ro" "${geo_mount[@]}" "$old_image" \
  run -config /etc/xray/config.json >/dev/null;then
   detail='New image failed health check; previous image restored'
 else
   detail='New image failed; automatic rollback also failed'
 fi
 return 1
}
# Persistent quota/manual shutdown marker. Prevent systemd reboot activation and
# docker restart after a denied node is stopped.
STATE_DIR=/var/lib/xmesh-node-control
MARKER="$STATE_DIR/forced-stop"
RELEASE_IDENTITY_FILE=/run/xmesh-node-control/agent-release-identity.json
stage_agent_release_identity(){
 local version="$1" revision="$2" digest="$3" tmp
 [[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$ ]] || return 1
 [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || return 1
 [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
 install -d -m 0700 /run/xmesh-node-control
 tmp="$(mktemp /run/xmesh-node-control/release.XXXXXXXX)" || return 1
 printf '{"version":"%s","sourceRevision":"%s","artifactSha256":"%s"}\n' \
  "$version" "$revision" "$digest" > "$tmp"
 chmod 600 "$tmp"
 mv -f "$tmp" "$RELEASE_IDENTITY_FILE"
}
clear_agent_release_identity(){
 rm -f "$RELEASE_IDENTITY_FILE"
}
verify_staged_agent_package(){
 local version="$1" revision="$2" digest="$3" base=/var/lib/xmesh-agent target package binary actual identity
 [[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$ ]] || return 1
 [[ "$revision" =~ ^[0-9a-f]{40}$ && "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
 [[ -L "$base/current" ]] || return 1
 target="$(readlink "$base/current")"
 [[ "$target" == "releases/$digest" ]] || return 1
 package="$base/$target"
 binary="$package/xmesh-agent-xspv2"
 [[ -d "$package" && ! -L "$package" && -f "$binary" && ! -L "$binary" && -x "$binary" ]] || return 1
 [[ -f "$package/identity.json" && ! -L "$package/identity.json" ]] || return 1
 [[ -f "$base/active.json" && ! -L "$base/active.json" ]] || return 1
 actual="$(sha256sum "$binary" | awk '{print $1}')" || return 1
 [[ "$actual" == "$digest" ]] || return 1
 identity="$(timeout 10 "$binary" --identity 2>/dev/null)" || return 1
 python3 - "$identity" "$version" "$revision" "$package/identity.json" "$base/active.json" "$digest" <<'PY'
import json,sys
runtime=json.loads(sys.argv[1])
expected_runtime={'version':sys.argv[2],'sourceRevision':sys.argv[3]}
if runtime != expected_runtime: raise SystemExit(1)
expected_full={**expected_runtime,'artifactSha256':sys.argv[6]}
for path in sys.argv[4:6]:
 with open(path,encoding='utf-8') as stream: value=json.load(stream)
 if value != expected_full: raise SystemExit(1)
PY
 timeout 20 "$binary" --check-state "$base/xsp-v2" >/dev/null
}
UPDATER_RESULT_UNIT=xmesh-node-agent-upgrade.service
UPDATER_ERROR=''
run_agent_updater(){
 local expected_version="${1:-}" static_unit=xmesh-node-agent-upgrade.service transient_unit=xmesh-node-agent-upgrade-repair
 local updater=/usr/local/sbin/xmesh-update-agent bootstrap='' rc=0
 UPDATER_ERROR=''
 [[ "$expected_version" =~ ^control-v6\.[0-9]+\.[0-9]+$ ]] || { UPDATER_ERROR='Invalid expected Agent target version'; return 1; }
 if systemctl cat "$static_unit" >/dev/null 2>&1 && [[ -f "$updater" && ! -L "$updater" && -x "$updater" ]];then
  UPDATER_RESULT_UNIT="$static_unit"
  timeout 650 systemctl start --wait "$static_unit"
  return $?
 fi
 install -d -m 0700 /run/xmesh-node-control || { UPDATER_ERROR='Cannot prepare Agent updater repair state';return 1; }
 if [[ ! -f "$updater" || -L "$updater" || ! -x "$updater" ]];then
  bootstrap=/run/xmesh-node-control/update-node-control-agent.bootstrap
  rm -f "$bootstrap"
  if ! curl --proto '=https' --tlsv1.2 -fsSL --max-time 30 https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/update-node-control-agent.sh -o "$bootstrap";then
   UPDATER_ERROR='Agent updater missing and verified bootstrap download failed';return 1
  fi
  if ! bash -n "$bootstrap" || ! grep -Fq "AGENT_VERSION=\"$expected_version\"" "$bootstrap" || ! grep -Fq 'xmesh-node-agent-upgrade.service' "$bootstrap";then
   rm -f "$bootstrap";UPDATER_ERROR='Downloaded Agent updater failed bootstrap validation';return 1
  fi
  chmod 0700 "$bootstrap"
  updater="$bootstrap"
 fi
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
  "$updater" --remote;then
  rc=0
 else
  rc=$?
  UPDATER_ERROR='Agent updater repair service failed; inspect xmesh-node-agent-upgrade-repair'
 fi
 [[ -z "$bootstrap" ]] || rm -f "$bootstrap"
 return "$rc"
}
stop_xray(){
 mkdir -p "$STATE_DIR"
 chmod 700 "$STATE_DIR"
 if docker inspect xmesh-managed-xray >/dev/null 2>&1;then
  timeout 15 docker update --restart=no xmesh-managed-xray >/dev/null || return 1
  timeout 30 docker stop xmesh-managed-xray >/dev/null || return 1
  [[ "$(docker inspect -f '{{.State.Running}}' xmesh-managed-xray)" == false ]] || { echo "CRITICAL: Xray container still running after stop" >&2;return 1; }
  printf 'docker\n' > "$MARKER"
 else
  timeout 30 systemctl disable --now "$UNIT" >/dev/null || return 1
  if systemctl is-active --quiet "$UNIT";then echo "CRITICAL: systemd Xray still active after stop" >&2; return 1; fi
  printf 'systemd\n' > "$MARKER"
 fi
 chmod 600 "$MARKER"
 return 0
}
resume_xray(){
 [[ -f "$MARKER" ]] || return 0
 local mode
 mode="$(cat "$MARKER")"
 if [[ "$mode" == docker ]];then
  timeout 15 docker update --restart=unless-stopped xmesh-managed-xray >/dev/null || return 1
  timeout 35 docker start xmesh-managed-xray >/dev/null || return 1
  docker inspect -f '{{.State.Running}}' xmesh-managed-xray | grep -qx true || return 1
 elif [[ "$mode" == systemd ]];then
  timeout 35 systemctl enable --now "$UNIT" >/dev/null || return 1
  systemctl is-active --quiet "$UNIT" || return 1
 else
  echo "Invalid local Xray shutdown marker" >&2
  return 1
 fi
 rm -f "$MARKER"
}
heartbeat
reply="$(signed_post '/api/v1/node/restart/poll' "{\"node_id\":$XMESH_NODE_ID}")"
enforce_stop="$(printf '%s' "$reply" | python3 -c '
import json,sys
data=json.load(sys.stdin)
flag=data.get("enforceStop")
if not isinstance(flag,bool):sys.exit(2)
print("true" if flag else "false")
')"
if [[ "$enforce_stop" == true ]];then
 if ! stop_xray;then echo "CRITICAL: Xray shutdown failed" >&2;exit 1;fi
 heartbeat
 exit 0
fi
if [[ -f "$MARKER" ]];then
 resume_xray || { echo "Xray reactivation failed" >&2;exit 1; }
 heartbeat
fi
command_info="$(printf '%s' "$reply" | python3 -c '
import json,re,sys
obj=json.load(sys.stdin)
cmd=obj.get("command")
if not cmd:sys.exit(0)
if not isinstance(cmd,dict):sys.exit(2)
action=cmd.get("action")
if action not in ("restart_xray","update_xray","update_agent"):sys.exit(2)
value=cmd.get("id")
if not isinstance(value,int) or isinstance(value,bool) or value<=0:sys.exit(2)
version=cmd.get("targetVersion")
identity=cmd.get("releaseIdentity")
release_version=source_revision=artifact_sha256="-"
if action=="update_xray":
 if identity is not None:sys.exit(2)
 if not isinstance(version,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,63}",version):sys.exit(2)
elif action=="update_agent":
 if not isinstance(version,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,63}",version):sys.exit(2)
 if identity is not None:
  if not isinstance(identity,dict) or set(identity)!={"version","sourceRevision","artifactSha256"}:sys.exit(2)
  release_version=identity.get("version");source_revision=identity.get("sourceRevision");artifact_sha256=identity.get("artifactSha256")
  if release_version!=version:sys.exit(2)
  if not isinstance(release_version,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,63}",release_version):sys.exit(2)
  if not isinstance(source_revision,str) or not re.fullmatch(r"[0-9a-f]{40}",source_revision):sys.exit(2)
  if not isinstance(artifact_sha256,str) or not re.fullmatch(r"[0-9a-f]{64}",artifact_sha256):sys.exit(2)
else:
 if identity is not None:sys.exit(2)
 version="-"
print(" ".join((str(value),action,version,release_version,source_revision,artifact_sha256)))
')"
[[ -n "$command_info" ]] || exit 0
read -r command_id action target_version release_version source_revision artifact_sha256 <<< "$command_info"
[[ "$command_id" =~ ^[1-9][0-9]*$ ]] || exit 2
success=false
detail='Command failed'
if [[ "$action" == update_xray ]];then
 if update_managed_xray "$target_version";then success=true;fi
elif [[ "$action" == update_agent ]];then
 clear_agent_release_identity
 if [[ "$release_version" != - ]];then
  if ! stage_agent_release_identity "$release_version" "$source_revision" "$artifact_sha256";then
   detail='Invalid or unstorable Agent release identity'
  elif run_agent_updater "$release_version" && verify_staged_agent_package "$release_version" "$source_revision" "$artifact_sha256";then
   success=true;detail='Staged Agent package activated and exact release identity verified'
  else
   if [[ -n "$UPDATER_ERROR" ]];then
    detail="$UPDATER_ERROR"
   else
    unit_result="$(systemctl show --property=Result --value "$UPDATER_RESULT_UNIT" 2>/dev/null || true)";[[ "$unit_result" =~ ^[a-zA-Z0-9_-]{1,40}$ ]] || unit_result=unknown
    detail="Staged Agent apply failed (systemd: $unit_result); previous package remains/restored"
   fi
  fi
 else
  if run_agent_updater "$target_version" && grep -Fxq "AGENT_VERSION=\"$target_version\"" /usr/local/sbin/xmesh-node-control;then
   success=true;detail='Agent installed and version verified'
  else
   if [[ -n "$UPDATER_ERROR" ]];then
    detail="$UPDATER_ERROR"
   else
    unit_result="$(systemctl show --property=Result --value "$UPDATER_RESULT_UNIT" 2>/dev/null || true)";[[ "$unit_result" =~ ^[a-zA-Z0-9_-]{1,40}$ ]] || unit_result=unknown
    detail="Agent update failed (systemd: $unit_result); inspect $UPDATER_RESULT_UNIT"
   fi
  fi
 fi
elif [[ "$action" == restart_xray ]];then
 if restart_xray;then success=true;detail='Xray restart confirmed';else detail='Xray restart failed or runtime missing';fi
else
 exit 2
fi
ack_identity=''
if [[ "$release_version" != - ]];then ack_identity=",\"releaseIdentity\":{\"version\":\"$release_version\",\"sourceRevision\":\"$source_revision\",\"artifactSha256\":\"$artifact_sha256\"}";fi
ack_payload="{\"node_id\":$XMESH_NODE_ID,\"command_id\":$command_id,\"success\":$success,\"detail\":\"$detail\"$ack_identity}"
if signed_post '/api/v1/node/restart/ack' "$ack_payload" >/dev/null;then
 if [[ "$release_version" != - ]];then clear_agent_release_identity;fi
else
 exit 1
fi
heartbeat