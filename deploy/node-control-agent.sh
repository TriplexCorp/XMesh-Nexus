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
UNIT="${XMESH_XRAY_UNIT:-xray.service}"
# Only root-owned local configuration can choose a unit. Remote responses never do.
[[ "$UNIT" =~ ^[A-Za-z0-9_.@-]+\.service$ ]] || { echo "Invalid systemd unit" >&2; exit 2; }
[[ -r "$KEY" ]] || { echo "XMesh Ed25519 key unavailable" >&2; exit 2; }
command -v flock >/dev/null && command -v python3 >/dev/null || exit 2
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
 curl --proto '=https' --tlsv1.2 --fail --silent --show-error --max-time 12 \
   -X POST "$XMESH_API_URL$path" \
   -H "X-XMesh-Timestamp: $timestamp" \
   -H "X-XMesh-Nonce: $nonce" \
   -H "X-XMesh-Signature: $signature" \
   -H "Content-Type: application/json" --data-binary "$payload"
}
# Report the actual runtime, whether native systemd or the XMesh-managed container.
xray_running(){
 if docker inspect -f '{{.State.Running}}' xmesh-managed-xray 2>/dev/null | grep -qx true; then return 0; fi
 systemctl is-active --quiet "$UNIT"
}
heartbeat(){
 local xr=false version='' raw=''
 if xray_running;then xr=true;fi
 if docker inspect -f '{{.State.Running}}' xmesh-managed-xray 2>/dev/null | grep -qx true;then
  raw="$(timeout 5 docker exec xmesh-managed-xray xray version 2>/dev/null || true)"
 elif command -v xray >/dev/null 2>&1;then
  raw="$(timeout 5 xray version 2>/dev/null || true)"
 fi
 version="$(printf '%s\n' "$raw" | awk 'NR==1 && $1=="Xray" {print $2}')"
 [[ "$version" =~ ^[A-Za-z0-9._+-]{1,40}$ ]] || version=''
 signed_post '/api/v1/node/heartbeat' "{\"node_id\":$XMESH_NODE_ID,\"version\":\"control-v3.0\",\"xray_version\":\"$version\",\"xray_running\":$xr,\"router_running\":$xr}" >/dev/null
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
 local old_image new_image
 old_image="$(docker inspect -f '{{.Image}}' "$name")" || return 1
 [[ "$old_image" =~ ^sha256:[0-9a-f]{64}$ ]] || { detail='Invalid previous image identity';return 1; }
 if ! timeout 75 docker pull "$image" >/dev/null;then
  detail='Xray image download failed';return 1
 fi
 new_image="$(docker image inspect -f '{{.Id}}' "$image")" || return 1
 [[ "$new_image" =~ ^sha256:[0-9a-f]{64}$ ]] || { detail='Invalid new image identity';return 1; }
 if [[ "$old_image" == "$new_image" ]];then
  detail="Xray $version already installed";return 0
 fi
 if ! timeout 25 docker run --rm --network none --user 0:0 --cap-drop ALL \
  --security-opt no-new-privileges --entrypoint xray \
  -v "$config:/etc/xray/config.json:ro" "$new_image" \
  run -test -config /etc/xray/config.json >/dev/null;then
  detail='New Xray image failed config validation';return 1
 fi
 docker rm -f "$name" >/dev/null || { detail='Could not stop previous Xray';return 1; }
 if docker run -d --name "$name" --restart unless-stopped --network host \
  --user 0:0 --read-only --security-opt no-new-privileges --cap-drop ALL \
  -v "$config:/etc/xray/config.json:ro" "$new_image" \
  run -config /etc/xray/config.json >/dev/null;then
   sleep 3
   if docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -qx true;then
    detail="Xray $version installed and running";return 0
   fi
 fi
 docker rm -f "$name" >/dev/null 2>&1 || true
 # Roll back to the exact locally cached prior image, never a moving tag.
 if docker run -d --name "$name" --restart unless-stopped --network host \
  --user 0:0 --read-only --security-opt no-new-privileges --cap-drop ALL \
  -v "$config:/etc/xray/config.json:ro" "$old_image" \
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
stop_xray(){
 mkdir -p "$STATE_DIR"
 chmod 700 "$STATE_DIR"
 if docker inspect xmesh-managed-xray >/dev/null 2>&1;then
  # Prevent Docker from automatically starting the container after reboot.
  timeout 15 docker update --restart=no xmesh-managed-xray >/dev/null || return 1
  timeout 30 docker stop xmesh-managed-xray >/dev/null || return 1
  printf 'docker\n' > "$MARKER"
 else
  # systemd units must stay disabled across reboots until the panel allows
  # traffic again. Never stop arbitrary remote-specified services.
  timeout 30 systemctl disable --now "$UNIT" >/dev/null || return 1
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
# A stop directive is evaluated before any queued action. The agent never
# invents a shutdown from a failed HTTP request or malformed JSON response.
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
 # Only an authenticated control-plane response with enforceStop=false
 # authorizes restoring a locally quota-stopped Xray.
 resume_xray || { echo "Xray reactivation failed" >&2;exit 1; }
 heartbeat
fi
command_info="$(printf '%s' "$reply" | python3 -c '
import json,sys
obj=json.load(sys.stdin)
cmd=obj.get("command")
if not cmd:sys.exit(0)
action=cmd.get("action")
if action not in ("restart_xray","update_xray"):sys.exit(2)
value=cmd.get("id")
if not isinstance(value,int) or isinstance(value,bool) or value<=0:sys.exit(2)
version=cmd.get("targetVersion")
if action=="update_xray":
 if not isinstance(version,str) or not __import__("re").fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,63}",version):sys.exit(2)
else:
 version="-"
print(str(value)+" "+action+" "+version)
')"
[[ -n "$command_info" ]] || exit 0
read -r command_id action target_version <<< "$command_info"
[[ "$command_id" =~ ^[1-9][0-9]*$ ]] || exit 2
success=false
detail='Command failed'
if [[ "$action" == update_xray ]];then
 if update_managed_xray "$target_version";then success=true;fi
elif [[ "$action" == restart_xray ]];then
 if restart_xray;then
  success=true
  detail='Xray restart confirmed'
 else
  detail='Xray restart failed or runtime missing'
 fi
else
 exit 2
fi
signed_post '/api/v1/node/restart/ack' \
 "{\"node_id\":$XMESH_NODE_ID,\"command_id\":$command_id,\"success\":$success,\"detail\":\"$detail\"}" >/dev/null
heartbeat
