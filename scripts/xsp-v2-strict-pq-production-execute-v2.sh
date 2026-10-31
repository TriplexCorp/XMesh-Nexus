#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
APPROVAL="${1:-}"
[[ -n "$APPROVAL" && -f "$APPROVAL" && ! -L "$APPROVAL" ]] || { echo 'usage: xsp-v2-strict-pq-production-execute-v2.sh approval.json' >&2; exit 2; }
command -v git >/dev/null; command -v python3 >/dev/null

RUNTIME_REVISION=a1267ae186f74d5e21561e3b64fc7375d499132e
NODE_REVISION=64709ce8f5f0ce80e2c0bab59b4476347825e57c
PINNED_VERIFIER="$ROOT/scripts/verify-xsp-v2-kvm-vps-strict-pq-activation-approval-v2-pinned.py"
[[ -f "$PINNED_VERIFIER" ]] || { echo 'pinned strict-PQ approval verifier missing' >&2; exit 1; }

cd "$ROOT"
python3 "$PINNED_VERIFIER" --approval "$APPROVAL" --require-current-window --require-node 13 >/dev/null

git cat-file -e "$RUNTIME_REVISION^{commit}"
# Later release-control/tooling commits are allowed, but production runtime
# source/build inputs must remain byte-identical to the frozen target.
git diff --quiet "$RUNTIME_REVISION" -- \
  backend/Dockerfile.xsp-signer \
  backend/Dockerfile.xsp-c2c \
  backend/src/xsp_v2_signer.rs \
  backend/src/bin/xsp_v2_c2c.rs \
  deploy/xsp-v2-ingress \
  deploy/xsp-v2-production/compose.strict-pq.yaml

EXPECTED="$(python3 - "$APPROVAL" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
print(x['releaseCandidate']['nexusImageSha256'])
PY
)"
ACTUAL="$(python3 - "$ROOT" "$RUNTIME_REVISION" "$NODE_REVISION" <<'PY'
import hashlib,json,os,sys
root,nexus,node=sys.argv[1:]
files=['backend/Dockerfile.xsp-signer','backend/Dockerfile.xsp-c2c','deploy/xsp-v2-ingress/Dockerfile','deploy/xsp-v2-ingress/nginx-c2b.conf','deploy/xsp-v2-production/compose.strict-pq.yaml']
hashes={p:hashlib.sha256(open(os.path.join(root,p),'rb').read()).hexdigest() for p in files}
manifest={'schema':'xsp2-production-runtime-build-manifest-1','nexusRevision':nexus,'nodeRevision':node,'builds':[{'service':'strict-signer','dockerfile':'backend/Dockerfile.xsp-signer','target':'default'},{'service':'strict-c2c','dockerfile':'backend/Dockerfile.xsp-c2c','target':'runtime'},{'service':'strict-origin','dockerfile':'deploy/xsp-v2-ingress/Dockerfile','target':'origin-ack-gate'},{'service':'strict-ingress','dockerfile':'deploy/xsp-v2-ingress/Dockerfile','target':'runtime-c2b'}],'sourceFileSha256':hashes}
raw=(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n').encode()
print('sha256:'+hashlib.sha256(raw).hexdigest())
PY
)"
[[ "$EXPECTED" = "$ACTUAL" ]] || { echo "runtime bundle mismatch: approval=$EXPECTED local=$ACTUAL" >&2; exit 1; }

# Invoke through bash so checkout executable bits cannot block a valid,
# already-verified production execution path.
exec bash "$ROOT/scripts/xsp-v2-strict-pq-production-execute.sh" "$APPROVAL"
