#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

: "${XMESH_API_URL:?XMESH_API_URL is required}"
: "${XMESH_NODE_ID:?XMESH_NODE_ID is required}"
# Signed Ed25519 requests are mandatory for every telemetry node.
XMESH_METRICS_PRIVATE_KEY="${XMESH_METRICS_PRIVATE_KEY:-/etc/xmesh-node-metrics/node.key}"
XMESH_API_URL="${XMESH_API_URL%/}"
XMESH_INTERFACE="${XMESH_INTERFACE:-auto}"

[[ "$XMESH_NODE_ID" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid XMESH_NODE_ID" >&2; exit 2; }
[[ "$XMESH_API_URL" == https://* ]] || { echo "XMESH_API_URL must use HTTPS" >&2; exit 2; }

if [[ "$XMESH_INTERFACE" == "auto" ]]; then
  if command -v ip >/dev/null 2>&1; then
    XMESH_INTERFACE="$(ip -o route show default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"
  fi
  if [[ -z "$XMESH_INTERFACE" ]]; then
    for candidate in /sys/class/net/*; do
      candidate="${candidate##*/}"
      [[ "$candidate" == "lo" ]] && continue
      XMESH_INTERFACE="$candidate"
      break
    done
  fi
fi
[[ "$XMESH_INTERFACE" =~ ^[A-Za-z0-9_.:-]+$ ]] || { echo "Could not determine a valid network interface" >&2; exit 2; }

counter_file="/sys/class/net/$XMESH_INTERFACE/statistics"
[[ -r "$counter_file/rx_bytes" && -r "$counter_file/tx_bytes" ]] || {
  echo "Network interface $XMESH_INTERFACE is missing or has no readable counters" >&2
  exit 1
}
rx_now="$(cat "$counter_file/rx_bytes")"
tx_now="$(cat "$counter_file/tx_bytes")"
now="$(date +%s)"
read -r _ cpu_user cpu_nice cpu_system cpu_idle cpu_iowait cpu_irq cpu_softirq cpu_steal _ < /proc/stat
cpu_total_now=$((cpu_user + cpu_nice + cpu_system + cpu_idle + cpu_iowait + cpu_irq + cpu_softirq + cpu_steal))
cpu_idle_now=$((cpu_idle + cpu_iowait))

state_dir="/var/lib/xmesh-node-metrics"
state_file="$state_dir/state"
mkdir -p "$state_dir"
chmod 700 "$state_dir"

if [[ ! -r "$state_file" ]]; then
  tmp_state="$state_file.$$"
  printf '%s %s %s %s %s %s\n' "$now" "$rx_now" "$tx_now" "$cpu_total_now" "$cpu_idle_now" "$cpu_steal" > "$tmp_state"
  chmod 600 "$tmp_state"
  mv "$tmp_state" "$state_file"
  echo "Baseline saved; the first rate sample will be sent after the next timer run."
  exit 0
fi

read -r last_time last_rx last_tx last_cpu_total last_cpu_idle last_cpu_steal < "$state_file"
elapsed=$((now - last_time))
if (( elapsed < 1 )); then
  echo "Skipping sample: elapsed interval is too short."
  exit 0
fi

# If interface counters reset (e.g. reboot/interface recreation), establish a new baseline
# rather than inventing a zero-rate sample.
if (( rx_now < last_rx || tx_now < last_tx )); then
  tmp_state="$state_file.$$"
  printf '%s %s %s %s %s %s\n' "$now" "$rx_now" "$tx_now" "$cpu_total_now" "$cpu_idle_now" "$cpu_steal" > "$tmp_state"
  chmod 600 "$tmp_state"
  mv "$tmp_state" "$state_file"
  echo "Network counters reset; baseline refreshed."
  exit 0
fi

rx_rate=$(((rx_now - last_rx) / elapsed))
tx_rate=$(((tx_now - last_tx) / elapsed))
cpu_total_delta=$((cpu_total_now - last_cpu_total))
cpu_idle_delta=$((cpu_idle_now - last_cpu_idle))
cpu_pct="null"
steal_pct="null"
# Old five-column state files are upgraded without making up a steal baseline.
if [[ "${last_cpu_steal:-}" =~ ^[0-9]+$ ]] && (( cpu_total_delta > 0 && cpu_steal >= last_cpu_steal )); then
  steal_pct="$(awk -v total="$cpu_total_delta" -v steal="$((cpu_steal-last_cpu_steal))" 'BEGIN {value=steal*100/total; if(value<0)value=0; if(value>100)value=100; printf "%.2f",value}')"
fi
if (( cpu_total_delta > 0 )); then
  cpu_pct="$(awk -v total="$cpu_total_delta" -v idle="$cpu_idle_delta" 'BEGIN { value=(total-idle)*100/total; if(value<0)value=0; if(value>100)value=100; printf "%.2f", value }')"
fi

mem_total_kb="$(awk '$1=="MemTotal:"{print $2; exit}' /proc/meminfo)"
mem_available_kb="$(awk '$1=="MemAvailable:"{print $2; exit}' /proc/meminfo)"
mem_total_bytes=$((${mem_total_kb:-0} * 1024))
mem_available_bytes=$((${mem_available_kb:-0} * 1024))
mem_used_bytes=$((mem_total_bytes - mem_available_bytes))
read -r disk_total_bytes disk_used_bytes < <(df -B1 -P / | awk 'NR==2{print $2, $3}')
active_connections=0
if command -v ss >/dev/null 2>&1; then
  active_connections="$(ss -Htan state established 2>/dev/null | wc -l | tr -d ' ')"
fi
[[ "$active_connections" =~ ^[0-9]+$ ]] || active_connections=0

payload="$(printf '{"node_id":%s,"cpu_percent":%s,"cpu_steal_percent":%s,"ram_used_bytes":%s,"ram_total_bytes":%s,"disk_used_bytes":%s,"disk_total_bytes":%s,"rx_bytes_per_sec":%s,"tx_bytes_per_sec":%s,"active_connections":%s,"metrics":{"interface":"%s","rateIntervalSeconds":%s,"rxTotalBytes":%s,"txTotalBytes":%s}}' \
  "$XMESH_NODE_ID" "$cpu_pct" "$steal_pct" "$mem_used_bytes" "$mem_total_bytes" "${disk_used_bytes:-0}" "${disk_total_bytes:-0}" "$rx_rate" "$tx_rate" "$active_connections" "$XMESH_INTERFACE" "$elapsed" "$rx_now" "$tx_now")"

# Prefer durable counters published by the root-owned policy guard.
# The unprivileged metrics collector never receives Docker socket access.
SNAPSHOT=/run/xmesh-node-user-metrics.json
SNAPSHOT_LOADED=false
USER_STATS_STATUS=unavailable
USER_STATS_AT_MS=null
if [[ -r "$SNAPSHOT" ]];then
  if snapshot_fragment="$(python3 - "$SNAPSHOT" "$XMESH_NODE_ID" <<'PY'
import json,sys,time
try:
 with open(sys.argv[1],encoding="utf-8") as stream:data=json.load(stream)
 now=int(time.time()*1000)
 assert type(data.get("nodeId")) is int and data["nodeId"]==int(sys.argv[2])
 stamp=data.get("sampledAtMs")
 assert type(stamp) is int and 0<=now-stamp<=30000
 users=data.get("userTraffic")
 inbounds=data.get("userInboundTraffic")
 assert isinstance(users,list) and len(users)<=4096
 assert isinstance(inbounds,list) and len(inbounds)<=4096
 for item in users:
  assert type(item.get("userId")) is int and item["userId"]>0
  assert all(type(item.get(k)) is int and 0<=item[k]<2**63 for k in ("uplinkBytes","downlinkBytes"))
 for item in inbounds:
  assert type(item.get("userId")) is int and item["userId"]>0
  assert isinstance(item.get("inboundTag"),str) and 0<len(item["inboundTag"])<=128
  assert all(type(item.get(k)) is int and 0<=item[k]<2**63 for k in ("uplinkBytes","downlinkBytes"))
 print(str(stamp))
 print(',"userTraffic":'+json.dumps(users,separators=(",",":"))+
       ',"userInboundTraffic":'+json.dumps(inbounds,separators=(",",":")))
except (AssertionError,ValueError,TypeError,KeyError,OSError):
 sys.exit(1)
PY
)";then
    # Propagate the producer's verified sample time, not the later upload time.
    # The backend uses it to reject duplicates and out-of-order snapshots.
    snapshot_timestamp="${snapshot_fragment%%
  fi
fi
if [[ "$SNAPSHOT_LOADED" != true ]];then
# Optional Xray StatsService counters. Missing Xray CLI or inaccessible API
# must never be reported as successful per-user traffic collection.
XRAY_API_ADDRESS="${XMESH_XRAY_API_ADDRESS:-127.0.0.1:10085}"
if [[ "$XRAY_API_ADDRESS" =~ ^127\.0\.0\.1:[0-9]{1,5}$ ]] &&
   command -v python3 >/dev/null 2>&1 &&
   [[ -r /usr/local/libexec/xmesh-xray-stats-collector.py ]]; then
  XRAY_CLI="$(command -v xray || true)"
  if [[ -z "$XRAY_CLI" ]]; then
    for candidate in /usr/local/bin/xray /usr/bin/xray /usr/local/xray/xray /opt/xray/xray /usr/local/bin/xray-core; do
      if [[ -x "$candidate" ]]; then XRAY_CLI="$candidate"; break; fi
    done
  fi
  if [[ -z "$XRAY_CLI" ]]; then
    echo "XMesh: per-user traffic unavailable: Xray CLI not installed on host (possibly containerized)." >&2
  else
    stats_error="$(mktemp)"
    if stats_json="$(timeout 6 "$XRAY_CLI" api statsquery --server="$XRAY_API_ADDRESS" -pattern 'user>>>xmesh-u' 2>"$stats_error")"; then
      if stats_fragment="$(printf '%s' "$stats_json" | python3 /usr/local/libexec/xmesh-xray-stats-collector.py)"; then
        if [[ "$stats_fragment" == ,* ]]; then
          payload="${payload%\}}$stats_fragment}"
          USER_STATS_STATUS=direct
          USER_STATS_AT_MS="$(date +%s%3N)"
        fi
      else
        echo "XMesh: Xray user stats response could not be parsed." >&2
      fi
    else
      echo "XMesh: Xray Stats API unavailable at $XRAY_API_ADDRESS (check API listener and service)." >&2
    fi
    rm -f "$stats_error"
  fi
else
  echo "XMesh: Xray StatsService collection is not configured." >&2
fi
fi # End fallback for missing root-owned metrics snapshot.

# Approximate distinct users with Xray traffic in the last 120 seconds.
# No counters / first baseline / reset -> unknown or zero only after a valid baseline.
online_count=""
if [[ "$USER_STATS_STATUS" == verified || "$USER_STATS_STATUS" == direct ]]; then
  online_count="$(printf '%s' "$payload" | python3 -c '
import json,sys,time,os,tempfile
path=sys.argv[1]
now=int(time.time())
data=json.load(sys.stdin)
rows=data.get("userTraffic")
if not isinstance(rows,list) or len(rows)>4096:sys.exit(1)
current={}
for row in rows:
    uid=row.get("userId")
    up=row.get("uplinkBytes")
    down=row.get("downlinkBytes")
    if type(uid)!=int or uid<=0 or type(up)!=int or type(down)!=int or min(up,down)<0:sys.exit(1)
    if uid in current:sys.exit(1)
    current[uid]=[up,down]
try:
    with open(path,encoding="utf-8") as f:previous=json.load(f)
except (OSError,ValueError):
    previous={}
old=previous.get("users",{})
if not isinstance(old,dict):old={}
seen={}
for uid,counters in current.items():
    key=str(uid)
    prior=old.get(key,{})
    previous_counters=prior.get("bytes") if isinstance(prior,dict) else None
    last=prior.get("last") if isinstance(prior,dict) else None
    if isinstance(previous_counters,list) and len(previous_counters)==2 and all(type(v)==int for v in previous_counters):
        if all(a>=b for a,b in zip(counters,previous_counters)) and any(a>b for a,b in zip(counters,previous_counters)):
            last=now
        elif any(a<b for a,b in zip(counters,previous_counters)):
            last=None
    if type(last)!=int or last>now or now-last>120:last=None
    seen[key]={"bytes":counters,"last":last}
# First sample only establishes baselines; no online count is asserted.
count=sum(v["last"] is not None for v in seen.values())
fd,tmp=tempfile.mkstemp(prefix=".online-",dir=os.path.dirname(path))
try:
    with os.fdopen(fd,"w",encoding="utf-8") as f:
        json.dump({"users":seen},f,separators=(",",":"))
        f.flush()
        os.fchmod(f.fileno(),0o600)
    os.replace(tmp,path)
finally:
    if os.path.exists(tmp):os.unlink(tmp)
print(count if isinstance(previous.get("users"),dict) else "null")
' "$state_dir/online-users.json")" || online_count=""
fi
if [[ "$online_count" =~ ^[0-9]+$ ]]; then
  payload="${payload%\}},\"online_clients\":$online_count}"
fi

payload="${payload%\}},\"userStatsStatus\":\"$USER_STATS_STATUS\",\"userStatsAtMs\":$USER_STATS_AT_MS}"

[[ -r "$XMESH_METRICS_PRIVATE_KEY" ]] || { echo "Missing readable Ed25519 private key." >&2; exit 1; }
command -v openssl >/dev/null || { echo "OpenSSL is required for signed metrics" >&2; exit 1; }
timestamp="$(date +%s)"
nonce="$(openssl rand -hex 16)"
payload_hash="$(printf '%s' "$payload" | openssl dgst -sha256 -r | awk '{print $1}')"
signed_file="$(mktemp "$state_dir/sign.XXXXXXXX")"
trap 'rm -f "$signed_file"' EXIT
printf 'XMESH1\nPOST\n/api/v1/metrics/ingest\n%s\n%s\n%s\n%s\n' \
  "$XMESH_NODE_ID" "$timestamp" "$nonce" "$payload_hash" > "$signed_file"
signature="$(openssl pkeyutl -sign -rawin -inkey "$XMESH_METRICS_PRIVATE_KEY" \
  -in "$signed_file" | od -An -tx1 -v | tr -d ' \n')"
[[ "${#signature}" -eq 128 ]] || { echo "Ed25519 signing failed" >&2; exit 1; }
curl --fail --silent --show-error --max-time 12 \
  -X POST "$XMESH_API_URL/api/v1/metrics/ingest" \
  -H "X-XMesh-Timestamp: $timestamp" \
  -H "X-XMesh-Nonce: $nonce" \
  -H "X-XMesh-Signature: $signature" \
  -H "Content-Type: application/json" \
  --data-binary "$payload" >/dev/null
tmp_state="$state_file.$$"
printf '%s %s %s %s %s %s\n' "$now" "$rx_now" "$tx_now" "$cpu_total_now" "$cpu_idle_now" "$cpu_steal" > "$tmp_state"
chmod 600 "$tmp_state"
mv "$tmp_state" "$state_file"
\n'*}"
    snapshot_json="${snapshot_fragment#*
  fi
fi
if [[ "$SNAPSHOT_LOADED" != true ]];then
# Optional Xray StatsService counters. Missing Xray CLI or inaccessible API
# must never be reported as successful per-user traffic collection.
XRAY_API_ADDRESS="${XMESH_XRAY_API_ADDRESS:-127.0.0.1:10085}"
if [[ "$XRAY_API_ADDRESS" =~ ^127\.0\.0\.1:[0-9]{1,5}$ ]] &&
   command -v python3 >/dev/null 2>&1 &&
   [[ -r /usr/local/libexec/xmesh-xray-stats-collector.py ]]; then
  XRAY_CLI="$(command -v xray || true)"
  if [[ -z "$XRAY_CLI" ]]; then
    for candidate in /usr/local/bin/xray /usr/bin/xray /usr/local/xray/xray /opt/xray/xray /usr/local/bin/xray-core; do
      if [[ -x "$candidate" ]]; then XRAY_CLI="$candidate"; break; fi
    done
  fi
  if [[ -z "$XRAY_CLI" ]]; then
    echo "XMesh: per-user traffic unavailable: Xray CLI not installed on host (possibly containerized)." >&2
  else
    stats_error="$(mktemp)"
    if stats_json="$(timeout 6 "$XRAY_CLI" api statsquery --server="$XRAY_API_ADDRESS" -pattern 'user>>>xmesh-u' 2>"$stats_error")"; then
      if stats_fragment="$(printf '%s' "$stats_json" | python3 /usr/local/libexec/xmesh-xray-stats-collector.py)"; then
        if [[ "$stats_fragment" == ,* ]]; then
          payload="${payload%\}}$stats_fragment}"
          USER_STATS_STATUS=direct
          USER_STATS_AT_MS="$(date +%s%3N)"
        fi
      else
        echo "XMesh: Xray user stats response could not be parsed." >&2
      fi
    else
      echo "XMesh: Xray Stats API unavailable at $XRAY_API_ADDRESS (check API listener and service)." >&2
    fi
    rm -f "$stats_error"
  fi
else
  echo "XMesh: Xray StatsService collection is not configured." >&2
fi
fi # End fallback for missing root-owned metrics snapshot.

# Approximate distinct users with Xray traffic in the last 120 seconds.
# No counters / first baseline / reset -> unknown or zero only after a valid baseline.
online_count=""
if [[ "$USER_STATS_STATUS" == verified || "$USER_STATS_STATUS" == direct ]]; then
  online_count="$(printf '%s' "$payload" | python3 -c '
import json,sys,time,os,tempfile
path=sys.argv[1]
now=int(time.time())
data=json.load(sys.stdin)
rows=data.get("userTraffic")
if not isinstance(rows,list) or len(rows)>4096:sys.exit(1)
current={}
for row in rows:
    uid=row.get("userId")
    up=row.get("uplinkBytes")
    down=row.get("downlinkBytes")
    if type(uid)!=int or uid<=0 or type(up)!=int or type(down)!=int or min(up,down)<0:sys.exit(1)
    if uid in current:sys.exit(1)
    current[uid]=[up,down]
try:
    with open(path,encoding="utf-8") as f:previous=json.load(f)
except (OSError,ValueError):
    previous={}
old=previous.get("users",{})
if not isinstance(old,dict):old={}
seen={}
for uid,counters in current.items():
    key=str(uid)
    prior=old.get(key,{})
    previous_counters=prior.get("bytes") if isinstance(prior,dict) else None
    last=prior.get("last") if isinstance(prior,dict) else None
    if isinstance(previous_counters,list) and len(previous_counters)==2 and all(type(v)==int for v in previous_counters):
        if all(a>=b for a,b in zip(counters,previous_counters)) and any(a>b for a,b in zip(counters,previous_counters)):
            last=now
        elif any(a<b for a,b in zip(counters,previous_counters)):
            last=None
    if type(last)!=int or last>now or now-last>120:last=None
    seen[key]={"bytes":counters,"last":last}
# First sample only establishes baselines; no online count is asserted.
count=sum(v["last"] is not None for v in seen.values())
fd,tmp=tempfile.mkstemp(prefix=".online-",dir=os.path.dirname(path))
try:
    with os.fdopen(fd,"w",encoding="utf-8") as f:
        json.dump({"users":seen},f,separators=(",",":"))
        f.flush()
        os.fchmod(f.fileno(),0o600)
    os.replace(tmp,path)
finally:
    if os.path.exists(tmp):os.unlink(tmp)
print(count if isinstance(previous.get("users"),dict) else "null")
' "$state_dir/online-users.json")" || online_count=""
fi
if [[ "$online_count" =~ ^[0-9]+$ ]]; then
  payload="${payload%\}},\"online_clients\":$online_count}"
fi

payload="${payload%\}},\"userStatsStatus\":\"$USER_STATS_STATUS\",\"userStatsAtMs\":$USER_STATS_AT_MS}"

[[ -r "$XMESH_METRICS_PRIVATE_KEY" ]] || { echo "Missing readable Ed25519 private key." >&2; exit 1; }
command -v openssl >/dev/null || { echo "OpenSSL is required for signed metrics" >&2; exit 1; }
timestamp="$(date +%s)"
nonce="$(openssl rand -hex 16)"
payload_hash="$(printf '%s' "$payload" | openssl dgst -sha256 -r | awk '{print $1}')"
signed_file="$(mktemp "$state_dir/sign.XXXXXXXX")"
trap 'rm -f "$signed_file"' EXIT
printf 'XMESH1\nPOST\n/api/v1/metrics/ingest\n%s\n%s\n%s\n%s\n' \
  "$XMESH_NODE_ID" "$timestamp" "$nonce" "$payload_hash" > "$signed_file"
signature="$(openssl pkeyutl -sign -rawin -inkey "$XMESH_METRICS_PRIVATE_KEY" \
  -in "$signed_file" | od -An -tx1 -v | tr -d ' \n')"
[[ "${#signature}" -eq 128 ]] || { echo "Ed25519 signing failed" >&2; exit 1; }
curl --fail --silent --show-error --max-time 12 \
  -X POST "$XMESH_API_URL/api/v1/metrics/ingest" \
  -H "X-XMesh-Timestamp: $timestamp" \
  -H "X-XMesh-Nonce: $nonce" \
  -H "X-XMesh-Signature: $signature" \
  -H "Content-Type: application/json" \
  --data-binary "$payload" >/dev/null
tmp_state="$state_file.$$"
printf '%s %s %s %s %s %s\n' "$now" "$rx_now" "$tx_now" "$cpu_total_now" "$cpu_idle_now" "$cpu_steal" > "$tmp_state"
chmod 600 "$tmp_state"
mv "$tmp_state" "$state_file"
\n'}"
    if [[ "$snapshot_timestamp" =~ ^[0-9]{13}$ && "$snapshot_json" == ,* ]]; then
      payload="${payload%\}}$snapshot_json}"
      SNAPSHOT_LOADED=true
      USER_STATS_STATUS=verified
      USER_STATS_AT_MS="$snapshot_timestamp"
    fi
  fi
fi
if [[ "$SNAPSHOT_LOADED" != true ]];then
# Optional Xray StatsService counters. Missing Xray CLI or inaccessible API
# must never be reported as successful per-user traffic collection.
XRAY_API_ADDRESS="${XMESH_XRAY_API_ADDRESS:-127.0.0.1:10085}"
if [[ "$XRAY_API_ADDRESS" =~ ^127\.0\.0\.1:[0-9]{1,5}$ ]] &&
   command -v python3 >/dev/null 2>&1 &&
   [[ -r /usr/local/libexec/xmesh-xray-stats-collector.py ]]; then
  XRAY_CLI="$(command -v xray || true)"
  if [[ -z "$XRAY_CLI" ]]; then
    for candidate in /usr/local/bin/xray /usr/bin/xray /usr/local/xray/xray /opt/xray/xray /usr/local/bin/xray-core; do
      if [[ -x "$candidate" ]]; then XRAY_CLI="$candidate"; break; fi
    done
  fi
  if [[ -z "$XRAY_CLI" ]]; then
    echo "XMesh: per-user traffic unavailable: Xray CLI not installed on host (possibly containerized)." >&2
  else
    stats_error="$(mktemp)"
    if stats_json="$(timeout 6 "$XRAY_CLI" api statsquery --server="$XRAY_API_ADDRESS" -pattern 'user>>>xmesh-u' 2>"$stats_error")"; then
      if stats_fragment="$(printf '%s' "$stats_json" | python3 /usr/local/libexec/xmesh-xray-stats-collector.py)"; then
        if [[ "$stats_fragment" == ,* ]]; then
          payload="${payload%\}}$stats_fragment}"
          USER_STATS_STATUS=direct
          USER_STATS_AT_MS="$(date +%s%3N)"
        fi
      else
        echo "XMesh: Xray user stats response could not be parsed." >&2
      fi
    else
      echo "XMesh: Xray Stats API unavailable at $XRAY_API_ADDRESS (check API listener and service)." >&2
    fi
    rm -f "$stats_error"
  fi
else
  echo "XMesh: Xray StatsService collection is not configured." >&2
fi
fi # End fallback for missing root-owned metrics snapshot.

# Approximate distinct users with Xray traffic in the last 120 seconds.
# No counters / first baseline / reset -> unknown or zero only after a valid baseline.
online_count=""
if [[ "$USER_STATS_STATUS" == verified || "$USER_STATS_STATUS" == direct ]]; then
  online_count="$(printf '%s' "$payload" | python3 -c '
import json,sys,time,os,tempfile
path=sys.argv[1]
now=int(time.time())
data=json.load(sys.stdin)
rows=data.get("userTraffic")
if not isinstance(rows,list) or len(rows)>4096:sys.exit(1)
current={}
for row in rows:
    uid=row.get("userId")
    up=row.get("uplinkBytes")
    down=row.get("downlinkBytes")
    if type(uid)!=int or uid<=0 or type(up)!=int or type(down)!=int or min(up,down)<0:sys.exit(1)
    if uid in current:sys.exit(1)
    current[uid]=[up,down]
try:
    with open(path,encoding="utf-8") as f:previous=json.load(f)
except (OSError,ValueError):
    previous={}
old=previous.get("users",{})
if not isinstance(old,dict):old={}
seen={}
for uid,counters in current.items():
    key=str(uid)
    prior=old.get(key,{})
    previous_counters=prior.get("bytes") if isinstance(prior,dict) else None
    last=prior.get("last") if isinstance(prior,dict) else None
    if isinstance(previous_counters,list) and len(previous_counters)==2 and all(type(v)==int for v in previous_counters):
        if all(a>=b for a,b in zip(counters,previous_counters)) and any(a>b for a,b in zip(counters,previous_counters)):
            last=now
        elif any(a<b for a,b in zip(counters,previous_counters)):
            last=None
    if type(last)!=int or last>now or now-last>120:last=None
    seen[key]={"bytes":counters,"last":last}
# First sample only establishes baselines; no online count is asserted.
count=sum(v["last"] is not None for v in seen.values())
fd,tmp=tempfile.mkstemp(prefix=".online-",dir=os.path.dirname(path))
try:
    with os.fdopen(fd,"w",encoding="utf-8") as f:
        json.dump({"users":seen},f,separators=(",",":"))
        f.flush()
        os.fchmod(f.fileno(),0o600)
    os.replace(tmp,path)
finally:
    if os.path.exists(tmp):os.unlink(tmp)
print(count if isinstance(previous.get("users"),dict) else "null")
' "$state_dir/online-users.json")" || online_count=""
fi
if [[ "$online_count" =~ ^[0-9]+$ ]]; then
  payload="${payload%\}},\"online_clients\":$online_count}"
fi

payload="${payload%\}},\"userStatsStatus\":\"$USER_STATS_STATUS\",\"userStatsAtMs\":$USER_STATS_AT_MS}"

[[ -r "$XMESH_METRICS_PRIVATE_KEY" ]] || { echo "Missing readable Ed25519 private key." >&2; exit 1; }
command -v openssl >/dev/null || { echo "OpenSSL is required for signed metrics" >&2; exit 1; }
timestamp="$(date +%s)"
nonce="$(openssl rand -hex 16)"
payload_hash="$(printf '%s' "$payload" | openssl dgst -sha256 -r | awk '{print $1}')"
signed_file="$(mktemp "$state_dir/sign.XXXXXXXX")"
trap 'rm -f "$signed_file"' EXIT
printf 'XMESH1\nPOST\n/api/v1/metrics/ingest\n%s\n%s\n%s\n%s\n' \
  "$XMESH_NODE_ID" "$timestamp" "$nonce" "$payload_hash" > "$signed_file"
signature="$(openssl pkeyutl -sign -rawin -inkey "$XMESH_METRICS_PRIVATE_KEY" \
  -in "$signed_file" | od -An -tx1 -v | tr -d ' \n')"
[[ "${#signature}" -eq 128 ]] || { echo "Ed25519 signing failed" >&2; exit 1; }
curl --fail --silent --show-error --max-time 12 \
  -X POST "$XMESH_API_URL/api/v1/metrics/ingest" \
  -H "X-XMesh-Timestamp: $timestamp" \
  -H "X-XMesh-Nonce: $nonce" \
  -H "X-XMesh-Signature: $signature" \
  -H "Content-Type: application/json" \
  --data-binary "$payload" >/dev/null
tmp_state="$state_file.$$"
printf '%s %s %s %s %s %s\n' "$now" "$rx_now" "$tx_now" "$cpu_total_now" "$cpu_idle_now" "$cpu_steal" > "$tmp_state"
chmod 600 "$tmp_state"
mv "$tmp_state" "$state_file"
