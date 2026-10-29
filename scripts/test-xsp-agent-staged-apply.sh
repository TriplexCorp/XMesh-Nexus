#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/deploy/xsp-v2-agent-staged-apply.sh"
[[ -f "$HELPER" ]] || { echo 'staged helper missing' >&2; exit 1; }
bash -n "$HELPER"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="$TMP/agent"
FAKEBIN="$TMP/bin"
mkdir -p "$FAKEBIN"
KEY="$TMP/node.key"
ENV_FILE="$TMP/node.env"
IDENTITY="$TMP/identity.json"
openssl genpkey -algorithm Ed25519 -out "$KEY" >/dev/null 2>&1
chmod 600 "$KEY"
cat > "$ENV_FILE" <<EOF
XMESH_API_URL=https://panel.example.test
XMESH_NODE_ID=7
XMESH_METRICS_PRIVATE_KEY=$KEY
EOF
chmod 600 "$ENV_FILE"

cat > "$FAKEBIN/curl" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
out=''
while (($#)); do
  case "$1" in
    --output) out="$2"; shift 2 ;;
    --write-out) shift 2 ;;
    *) shift ;;
  esac
done
[[ -n "$out" && -f "${FAKE_ARTIFACT_SOURCE:?}" ]] || exit 2
cp -- "$FAKE_ARTIFACT_SOURCE" "$out"
printf '200'
SH
chmod 755 "$FAKEBIN/curl"

make_fixture(){
  local path="$1" version="$2" revision="$3" fail_after_switch="${4:-false}" counter="$TMP/counter-$(basename "$path")"
  cat > "$path" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
case "\${1:-}" in
  --identity)
    printf '%s\n' '{"version":"$version","sourceRevision":"$revision"}'
    ;;
  --check-state)
    [[ -n "\${2:-}" && "\${2:0:1}" == / ]] || exit 2
    if [[ "$fail_after_switch" == true ]]; then
      n=0
      [[ -r "$counter" ]] && read -r n < "$counter"
      n=\$((n+1)); printf '%s\n' "\$n" > "$counter"
      (( n == 1 )) || exit 42
    fi
    ;;
  *) exit 2 ;;
esac
EOF
  chmod 755 "$path"
}

write_identity(){
  local version="$1" revision="$2" digest="$3"
  printf '{"version":"%s","sourceRevision":"%s","artifactSha256":"%s"}\n' \
    "$version" "$revision" "$digest" > "$IDENTITY"
  chmod 600 "$IDENTITY"
}

run_apply(){
  local source="$1"
  sudo env \
    "PATH=$FAKEBIN:$PATH" \
    "FAKE_ARTIFACT_SOURCE=$source" \
    "XMESH_NODE_ENV_FILE=$ENV_FILE" \
    "XMESH_AGENT_RELEASE_IDENTITY_FILE=$IDENTITY" \
    "XMESH_XSP_V2_AGENT_BASE=$BASE" \
    bash "$HELPER"
}

assert_active(){
  local version="$1" revision="$2" digest="$3"
  [[ -L "$BASE/current" ]]
  [[ "$(readlink "$BASE/current")" == "releases/$digest" ]]
  [[ "$(sha256sum "$BASE/releases/$digest/xmesh-agent-xspv2" | awk '{print $1}')" == "$digest" ]]
  python3 - "$BASE/active.json" "$version" "$revision" "$digest" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf-8') as f: value=json.load(f)
assert value == {'version':sys.argv[2],'sourceRevision':sys.argv[3],'artifactSha256':sys.argv[4]}, value
PY
}

V1='p0d2-test-1'
R1='1111111111111111111111111111111111111111'
F1="$TMP/agent-1"
make_fixture "$F1" "$V1" "$R1"
D1="$(sha256sum "$F1" | awk '{print $1}')"
write_identity "$V1" "$R1" "$D1"
run_apply "$F1"
assert_active "$V1" "$R1" "$D1"
python3 - "$BASE/last-known-good.json" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf-8') as f: value=json.load(f)
assert value['kind']=='deployed-shell-control-agent', value
assert value['controlAuthority']=='xmesh-node-control.service', value
PY

V2='p0d2-test-2'
R2='2222222222222222222222222222222222222222'
F2="$TMP/agent-2"
make_fixture "$F2" "$V2" "$R2"
D2="$(sha256sum "$F2" | awk '{print $1}')"
write_identity "$V2" "$R2" "$D2"
run_apply "$F2"
assert_active "$V2" "$R2" "$D2"
python3 - "$BASE/last-known-good.json" "$D1" "$V1" "$R1" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf-8') as f: value=json.load(f)
assert value['kind']=='go-agent-package', value
assert value['target']=='releases/'+sys.argv[2], value
assert value['identity']=={'version':sys.argv[3],'sourceRevision':sys.argv[4],'artifactSha256':sys.argv[2]}, value
assert value['controlAuthority']=='xmesh-node-control.service', value
PY

# Wrong immutable digest must fail before the active package pointer moves.
BAD='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
write_identity 'p0d2-bad-digest' '3333333333333333333333333333333333333333' "$BAD"
if run_apply "$F2"; then
  echo 'digest mismatch unexpectedly succeeded' >&2
  exit 1
fi
assert_active "$V2" "$R2" "$D2"

# A package that passes the pre-switch self-check but fails the post-switch
# self-check must roll the active pointer back to the exact previous package.
V3='p0d2-test-rollback'
R3='4444444444444444444444444444444444444444'
F3="$TMP/agent-rollback"
make_fixture "$F3" "$V3" "$R3" true
D3="$(sha256sum "$F3" | awk '{print $1}')"
write_identity "$V3" "$R3" "$D3"
if run_apply "$F3"; then
  echo 'post-switch self-check failure unexpectedly succeeded' >&2
  exit 1
fi
assert_active "$V2" "$R2" "$D2"
[[ "$(readlink "$BASE/current")" == "releases/$D2" ]]

# The durable security-state root is shared across package slots and must never
# be replaced by rollback.
[[ -d "$BASE/xsp-v2" && ! -L "$BASE/xsp-v2" ]]
[[ "$(stat -c '%a' "$BASE/xsp-v2")" == 700 ]]

echo 'staged Agent package apply/rollback lifecycle: OK'
