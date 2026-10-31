#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export LC_ALL=C

APPROVAL="${1:-}"
NODE_RESULT="${2:-}"
RUNTIME_DIR="${XSP_V2_STRICT_PQ_RUNTIME_DIR:-/run/xmesh-nexus/xsp-v2-strict-pq}"
STATE_DIR="${XSP_V2_STRICT_PQ_STATE_DIR:-/var/lib/xmesh-nexus/xsp-v2}"
[[ "${EUID}" -eq 0 ]] || { echo 'strict-PQ finalization requires root' >&2; exit 1; }
[[ -f "$APPROVAL" && ! -L "$APPROVAL" && -f "$NODE_RESULT" && ! -L "$NODE_RESULT" ]] || { echo 'usage: finalize.sh approval.json node-result.json' >&2; exit 2; }
[[ -f "$RUNTIME_DIR/stack-ready.json" && ! -L "$RUNTIME_DIR/stack-ready.json" ]] || { echo 'production stack readiness record missing' >&2; exit 1; }

install -d -o root -g root -m 0700 "$STATE_DIR"
python3 - "$APPROVAL" "$NODE_RESULT" "$RUNTIME_DIR/stack-ready.json" "$STATE_DIR/production-activation.json" <<'PY'
import hashlib,json,os,re,sys,tempfile,time
approval_path,result_path,ready_path,out=sys.argv[1:]
def load(path):
    with open(path,'rb') as f: raw=f.read()
    return json.loads(raw),raw
approval,approval_raw=load(approval_path)
result,result_raw=load(result_path)
ready,_=load(ready_path)
sha=lambda raw: hashlib.sha256(raw).hexdigest()
approval_sha=sha(approval_raw)
if ready != {
    'schema':'xsp2-strict-pq-production-stack-ready-1',
    'approvalSha256':approval_sha,
    'nodeId':result.get('nodeId'),
    'recordedAt':ready.get('recordedAt'),
    'productionStackReady':True,
    'strictPQEnabled':False,
    'legacyXMESH1Retired':False,
}:
    raise SystemExit('stack readiness record does not bind this approval/Node')
required={'status','mode','nodeId','approvalSha256','receiptBindingSha256','minimumEpoch','strictPQEnabled','legacyXMESH1Retired'}
if set(result)!=required:
    raise SystemExit('unexpected Node activation result fields')
if result['status']!='strict-pq-node-cutover-receipt-verified' or result['mode'] not in ('activate','recover'):
    raise SystemExit('Node did not return a verified strict-PQ receipt result')
if result['approvalSha256']!=approval_sha:
    raise SystemExit('Node result is bound to a different approval')
if not isinstance(result['nodeId'],int) or result['nodeId']<=0 or not isinstance(result['minimumEpoch'],int) or result['minimumEpoch']<=0:
    raise SystemExit('invalid Node/epoch in activation result')
if not isinstance(result['receiptBindingSha256'],str) or not re.fullmatch(r'[0-9a-f]{64}',result['receiptBindingSha256']) or set(result['receiptBindingSha256'])=={'0'}:
    raise SystemExit('invalid verified receipt binding')
if result['strictPQEnabled'] is not True or result['legacyXMESH1Retired'] is not False:
    raise SystemExit('activation result claims are not the approved strict-PQ/retain-XMESH1 state')
value={
  'schema':'xsp2-strict-pq-production-activation-1',
  'approvalSha256':approval_sha,
  'nodeResultSha256':sha(result_raw),
  'receiptBindingSha256':result['receiptBindingSha256'],
  'nodeId':result['nodeId'],
  'minimumEpoch':result['minimumEpoch'],
  'activatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
  'productionActivation':True,
  'strictPQEnabled':True,
  'legacyXMESH1Retired':False,
  'physicalPowerLossQualified':False,
}
fd,tmp=tempfile.mkstemp(prefix='.activation.',dir=os.path.dirname(out),text=True)
with os.fdopen(fd,'w',encoding='utf-8') as f:
    json.dump(value,f,separators=(',',':'));f.write('\n');f.flush();os.fsync(f.fileno())
os.chmod(tmp,0o600);os.replace(tmp,out)
with open(os.path.dirname(out),os.O_RDONLY) as d: os.fsync(d.fileno())
print(json.dumps(value,separators=(',',':')))
PY
