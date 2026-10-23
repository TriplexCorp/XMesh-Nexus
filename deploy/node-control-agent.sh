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
# Heartbeat verifies actual service state; the telemetry daemon is separate.
if systemctl is-active --quiet "$UNIT"; then xr=true;else xr=false;fi
heartbeat="{\"node_id\":$XMESH_NODE_ID,\"version\":\"control-v1.0\",\"xray_running\":$xr,\"router_running\":$xr}"
signed_post '/api/v1/node/heartbeat' "$heartbeat" >/dev/null

reply="$(signed_post '/api/v1/node/restart/poll' "{\"node_id\":$XMESH_NODE_ID}")"
# Parse untrusted JSON, never source it or execute any response string.
command_id="$(printf '%s' "$reply" | python3 -c '
import json,sys
obj=json.load(sys.stdin)
cmd=obj.get("command")
if not cmd:sys.exit(0)
if cmd.get("action")!="restart_xray":sys.exit(2)
value=cmd.get("id")
if not isinstance(value,int) or isinstance(value,bool) or value<=0:sys.exit(2)
print(value)
')"
[[ -n "$command_id" ]] || exit 0
[[ "$command_id" =~ ^[1-9][0-9]*$ ]] || exit 2

success=false
detail='systemd restart failed'
if timeout 35 systemctl restart "$UNIT" && systemctl is-active --quiet "$UNIT"; then
 success=true
 detail='systemd confirmed Xray active'
elif ! systemctl cat "$UNIT" >/dev/null 2>&1;then
 detail='Xray systemd unit missing'
fi
signed_post '/api/v1/node/restart/ack' \
 "{\"node_id\":$XMESH_NODE_ID,\"command_id\":$command_id,\"success\":$success,\"detail\":\"$detail\"}" >/dev/null
if systemctl is-active --quiet "$UNIT";then xr=true;else xr=false;fi
heartbeat="{\"node_id\":$XMESH_NODE_ID,\"version\":\"control-v1.0\",\"xray_running\":$xr,\"router_running\":$xr}"
signed_post '/api/v1/node/heartbeat' "$heartbeat" >/dev/null
