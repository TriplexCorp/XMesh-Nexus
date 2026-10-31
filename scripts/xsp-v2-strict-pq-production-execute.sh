#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
APPROVAL="${1:-}"
VERIFIER="$ROOT/scripts/verify-xsp-v2-kvm-vps-strict-pq-activation-approval-v2.py"
OVERLAY="$ROOT/deploy/xsp-v2-production/compose.strict-pq.yaml"
RUNTIME_DIR="${XSP_V2_STRICT_PQ_RUNTIME_DIR:-/run/xmesh-nexus/xsp-v2-strict-pq}"

[[ "${EUID}" -eq 0 ]] || { echo 'strict-PQ production execution requires root' >&2; exit 1; }
[[ -n "$APPROVAL" && -f "$APPROVAL" && ! -L "$APPROVAL" ]] || { echo 'usage: xsp-v2-strict-pq-production-execute.sh /path/to/approval.json' >&2; exit 2; }
[[ -f "$VERIFIER" && -f "$OVERLAY" ]] || { echo 'production approval verifier/overlay missing' >&2; exit 1; }
for cmd in python3 docker install stat sha256sum; do command -v "$cmd" >/dev/null || { echo "$cmd is required" >&2; exit 1; }; done
docker compose version >/dev/null

# Disposable E2E fault injection is categorically forbidden in production.
[[ -z "${XSP_V2_C2D_TEST_FAULT:-}" ]] || { echo 'XSP_V2_C2D_TEST_FAULT must be unset' >&2; exit 1; }

: "${XSP_V2_STRICT_PQ_NODE_ID:?missing bounded Node ID}"
: "${XSP_V2_STRICT_PQ_CLIENT_SPKI_SHA256:?missing approved Node client SPKI}"
: "${XSP_V2_SIGNER_DATABASE_URL:?missing isolated signer DB URL}"
: "${XSP_V2_C2C_DATABASE_URL:?missing isolated C2-C DB URL}"
: "${XSP_V2_SIGNER_KEYS_DIR:?missing signer keys directory}"
: "${XSP_V2_PANEL_PIN_FILE:?missing panel pin file}"
: "${XSP_V2_INGRESS_CERTS_DIR:?missing ingress certificate directory}"

[[ "$XSP_V2_STRICT_PQ_NODE_ID" =~ ^[1-9][0-9]*$ ]] || { echo 'invalid bounded Node ID' >&2; exit 1; }
[[ "$XSP_V2_STRICT_PQ_CLIENT_SPKI_SHA256" =~ ^[0-9a-f]{64}$ && "$XSP_V2_STRICT_PQ_CLIENT_SPKI_SHA256" != "$(printf '0%.0s' {1..64})" ]] || { echo 'invalid Node client SPKI SHA-256' >&2; exit 1; }

check_real_file(){
  local path="$1" label="$2"
  [[ -f "$path" && ! -L "$path" && -r "$path" ]] || { echo "$label must be a readable regular non-symlink file: $path" >&2; exit 1; }
  local mode
  mode="$(stat -c '%a' "$path")"
  (( (8#$mode & 8#022) == 0 )) || { echo "$label is group/world writable: $path" >&2; exit 1; }
}
check_real_dir(){
  local path="$1" label="$2"
  [[ -d "$path" && ! -L "$path" ]] || { echo "$label must be a real directory: $path" >&2; exit 1; }
  local mode
  mode="$(stat -c '%a' "$path")"
  (( (8#$mode & 8#002) == 0 )) || { echo "$label must not be world writable: $path" >&2; exit 1; }
}

check_real_file "$APPROVAL" approval
check_real_file "$XSP_V2_PANEL_PIN_FILE" 'panel pin'
check_real_dir "$XSP_V2_SIGNER_KEYS_DIR" 'signer keys directory'
check_real_dir "$XSP_V2_INGRESS_CERTS_DIR" 'ingress certificates directory'
for file in panel-ed25519.pem panel-mldsa65.pem; do check_real_file "$XSP_V2_SIGNER_KEYS_DIR/$file" "signer key $file"; done
for file in fullchain.pem privkey.pem client-ca.pem; do check_real_file "$XSP_V2_INGRESS_CERTS_DIR/$file" "ingress certificate material $file"; done

VERIFY_JSON="$(python3 "$VERIFIER" --approval "$APPROVAL" --require-current-window --require-node "$XSP_V2_STRICT_PQ_NODE_ID")"
python3 - "$VERIFY_JSON" <<'PY'
import json,sys
v=json.loads(sys.argv[1])
assert v['status']=='kvm-vps-strict-pq-approval-eligible'
assert v['strictPqAction']=='enable'
assert v['legacyXMESH1Action']=='retain'
assert v['productionActivation'] is False
assert v['strictPQEnabled'] is False
assert v['requiresSeparateExecution'] is True
PY

# Numeric ownership is part of the reviewed UDS peer-credential boundary.
# Keep the top-level runtime directory traversable, while each sensitive
# material directory is readable only by the exact container GID that needs it.
install -d -o root -g root -m 0755 "$RUNTIME_DIR"
install -d -o 10002 -g 10001 -m 0750 "$RUNTIME_DIR/signer"
install -d -o 10001 -g 10003 -m 2750 "$RUNTIME_DIR/c2c"
install -d -o 10004 -g 10003 -m 2750 "$RUNTIME_DIR/origin"

# Stage public panel pin and ingress TLS material into runtime-owned paths.
# This avoids relying on operator source-directory ownership while preserving
# least privilege for the fixed container identities (C2-C gid 10001,
# ingress gid 10003). Source files remain unchanged.
install -d -o root -g 10001 -m 0750 "$RUNTIME_DIR/c2c-public"
install -o root -g 10001 -m 0640 "$XSP_V2_PANEL_PIN_FILE" "$RUNTIME_DIR/c2c-public/panel-pin.json"
install -d -o root -g 10003 -m 0750 "$RUNTIME_DIR/ingress-certs"
for file in fullchain.pem privkey.pem client-ca.pem; do
  install -o root -g 10003 -m 0640 "$XSP_V2_INGRESS_CERTS_DIR/$file" "$RUNTIME_DIR/ingress-certs/$file"
done

export XSP_V2_STRICT_PQ_RUNTIME_DIR="$RUNTIME_DIR"
export XSP_V2_PANEL_PIN_FILE="$RUNTIME_DIR/c2c-public/panel-pin.json"
export XSP_V2_INGRESS_CERTS_DIR="$RUNTIME_DIR/ingress-certs"

cd "$ROOT"
COMPOSE=(docker compose -f compose.yaml -f "$OVERLAY" --profile xsp-v2-strict-pq)
"${COMPOSE[@]}" config >/dev/null
"${COMPOSE[@]}" up -d --build \
  xsp-v2-strict-signer xsp-v2-strict-c2c xsp-v2-strict-origin xsp-v2-strict-ingress

# Compose service_started is not enough for production readiness: a process may
# already be restart-looping because a bind-mounted file is unreadable. Require
# all four bounded services to remain in running/non-restarting state before
# emitting stack-ready evidence.
services=(xsp-v2-strict-signer xsp-v2-strict-c2c xsp-v2-strict-origin xsp-v2-strict-ingress)
all_running=0
for _ in {1..10}; do
  all_running=1
  for service in "${services[@]}"; do
    cid="$("${COMPOSE[@]}" ps -q "$service")"
    if [[ -z "$cid" || "$(docker inspect -f '{{.State.Status}}:{{.State.Restarting}}' "$cid")" != 'running:false' ]]; then
      all_running=0
      break
    fi
  done
  (( all_running == 1 )) && break
  sleep 1
done
(( all_running == 1 )) || {
  "${COMPOSE[@]}" ps >&2 || true
  echo 'strict-PQ production services did not reach stable running state' >&2
  exit 1
}
INGRESS_ID="$("${COMPOSE[@]}" ps -q xsp-v2-strict-ingress)"
[[ -n "$(docker port "$INGRESS_ID" 8444/tcp 2>/dev/null)" ]] || { echo 'strict-PQ ingress port 8444 is not published' >&2; exit 1; }

# A ready stack is readiness for the bounded Node execution, not proof that
# the Node completed the signed cutover. strictPQEnabled stays false until the
# Node's activation binary returns a verified immutable receipt binding.
APPROVAL_SHA="$(sha256sum "$APPROVAL" | awk '{print $1}')"
python3 - "$RUNTIME_DIR/stack-ready.json" "$APPROVAL_SHA" "$XSP_V2_STRICT_PQ_NODE_ID" <<'PY'
import json,os,sys,tempfile,time
path,approval,node=sys.argv[1:]
value={
  'schema':'xsp2-strict-pq-production-stack-ready-1',
  'approvalSha256':approval,
  'nodeId':int(node),
  'recordedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
  'productionStackReady':True,
  'strictPQEnabled':False,
  'legacyXMESH1Retired':False,
}
fd,tmp=tempfile.mkstemp(prefix='.stack-ready.',dir=os.path.dirname(path),text=True)
with os.fdopen(fd,'w',encoding='utf-8') as f:
    json.dump(value,f,separators=(',',':'));f.write('\n');f.flush();os.fsync(f.fileno())
os.chmod(tmp,0o600);os.replace(tmp,path)
d=os.open(os.path.dirname(path),os.O_RDONLY)
try:
    os.fsync(d)
finally:
    os.close(d)
print(json.dumps(value,separators=(',',':')))
PY
