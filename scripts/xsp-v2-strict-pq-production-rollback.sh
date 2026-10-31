#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
OVERLAY="$ROOT/deploy/xsp-v2-production/compose.strict-pq.yaml"
RUNTIME_DIR="${XSP_V2_STRICT_PQ_RUNTIME_DIR:-/run/xmesh-nexus/xsp-v2-strict-pq}"
STATE_DIR="${XSP_V2_STRICT_PQ_STATE_DIR:-/var/lib/xmesh-nexus/xsp-v2}"
REASON="${1:-}"

[[ "${EUID}" -eq 0 ]] || { echo 'strict-PQ rollback requires root' >&2; exit 1; }
[[ -n "$REASON" ]] || { echo 'usage: xsp-v2-strict-pq-production-rollback.sh "operator reason"' >&2; exit 2; }
[[ -f "$OVERLAY" ]] || { echo 'strict-PQ compose overlay missing' >&2; exit 1; }
[[ -f "$STATE_DIR/production-activation.json" && ! -L "$STATE_DIR/production-activation.json" ]] || { echo 'no finalized production activation record' >&2; exit 1; }

export XSP_V2_STRICT_PQ_RUNTIME_DIR="$RUNTIME_DIR"
cd "$ROOT"
# Manual rollback only. It stops the dedicated XSP-v2 ingress/origin/C2-C/signer
# profile. It does not mutate Node key state, lower an epoch/floor, delete the
# verified receipt, or retire/restore XMESH1. There is no automatic fallback.
docker compose -f compose.yaml -f "$OVERLAY" --profile xsp-v2-strict-pq stop \
  xsp-v2-strict-ingress xsp-v2-strict-origin xsp-v2-strict-c2c xsp-v2-strict-signer

python3 - "$STATE_DIR/production-activation.json" "$STATE_DIR/production-rollback.json" "$REASON" <<'PY'
import hashlib,json,os,sys,tempfile,time
activation_path,out,reason=sys.argv[1:]
with open(activation_path,'rb') as f: raw=f.read()
activation=json.loads(raw)
if activation.get('schema')!='xsp2-strict-pq-production-activation-1' or activation.get('strictPQEnabled') is not True:
    raise SystemExit('invalid activation record')
value={
  'schema':'xsp2-strict-pq-production-rollback-1',
  'activationRecordSha256':hashlib.sha256(raw).hexdigest(),
  'approvalSha256':activation['approvalSha256'],
  'nodeId':activation['nodeId'],
  'rolledBackAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
  'reason':reason,
  'strictPQIngressStopped':True,
  'nodeSecurityStatePreserved':True,
  'legacyXMESH1Retired':False,
  'automaticFallback':False,
}
fd,tmp=tempfile.mkstemp(prefix='.rollback.',dir=os.path.dirname(out),text=True)
with os.fdopen(fd,'w',encoding='utf-8') as f:
    json.dump(value,f,separators=(',',':'));f.write('\n');f.flush();os.fsync(f.fileno())
os.chmod(tmp,0o600);os.replace(tmp,out)
with open(os.path.dirname(out),os.O_RDONLY) as d: os.fsync(d.fileno())
print(json.dumps(value,separators=(',',':')))
PY
