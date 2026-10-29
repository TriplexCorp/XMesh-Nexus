#!/usr/bin/env bash
# P0-D staged Go Agent package lifecycle. This script does not replace the
# production shell control Agent. It verifies one immutable manifest-bound
# package, atomically moves the side-by-side `current` package pointer, and
# rolls that package pointer back on any post-switch verification failure.
set -Eeuo pipefail
umask 077
export LC_ALL=C

IDENTITY_FILE="${XMESH_AGENT_RELEASE_IDENTITY_FILE:-/run/xmesh-node-control/agent-release-identity.json}"
ENV_FILE="${XMESH_NODE_ENV_FILE:-/etc/xmesh-node-metrics.env}"
BASE="${XMESH_XSP_V2_AGENT_BASE:-/var/lib/xmesh-agent}"
RELEASES="$BASE/releases"
STATE_ROOT="$BASE/xsp-v2"
CURRENT="$BASE/current"
ACTIVE="$BASE/active.json"
LAST_GOOD="$BASE/last-known-good.json"

[[ "${EUID}" -eq 0 ]] || { echo 'staged Agent apply requires root' >&2; exit 1; }
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || { echo 'node environment is unavailable' >&2; exit 1; }
[[ -f "$IDENTITY_FILE" && ! -L "$IDENTITY_FILE" ]] || { echo 'release identity is unavailable' >&2; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${XMESH_API_URL:?Missing panel URL}"
: "${XMESH_NODE_ID:?Missing node ID}"
[[ "$XMESH_API_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || { echo 'invalid panel origin' >&2; exit 2; }
[[ "$XMESH_NODE_ID" =~ ^[1-9][0-9]*$ ]] || { echo 'invalid node id' >&2; exit 2; }
KEY="${XMESH_METRICS_PRIVATE_KEY:-/etc/xmesh-node-metrics/node.key}"
[[ -f "$KEY" && ! -L "$KEY" && -r "$KEY" ]] || { echo 'node signing key unavailable' >&2; exit 1; }
for command_name in curl openssl python3 sha256sum install mv ln readlink timeout awk chmod; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "$command_name is required" >&2; exit 1; }
done

readarray -t release_identity < <(python3 - "$IDENTITY_FILE" <<'PY'
import json,re,sys
path=sys.argv[1]
with open(path,encoding='utf-8') as stream:
    value=json.load(stream)
if set(value) != {'version','sourceRevision','artifactSha256'}:
    raise SystemExit('invalid release identity keys')
version=value['version']; revision=value['sourceRevision']; digest=value['artifactSha256']
if not isinstance(version,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]{0,63}',version):
    raise SystemExit('invalid release version')
if not isinstance(revision,str) or not re.fullmatch(r'[0-9a-f]{40}',revision):
    raise SystemExit('invalid source revision')
if not isinstance(digest,str) or not re.fullmatch(r'[0-9a-f]{64}',digest):
    raise SystemExit('invalid artifact digest')
print(version)
print(revision)
print(digest)
PY
)
[[ "${#release_identity[@]}" -eq 3 ]] || { echo 'invalid release identity' >&2; exit 1; }
VERSION="${release_identity[0]}"
SOURCE_REVISION="${release_identity[1]}"
ARTIFACT_SHA256="${release_identity[2]}"

ensure_real_directory(){
  local path="$1" mode="$2"
  [[ ! -L "$path" ]] || { echo "symlink directory rejected: $path" >&2; return 1; }
  if [[ -e "$path" ]]; then
    [[ -d "$path" ]] || { echo "non-directory path rejected: $path" >&2; return 1; }
    chmod "$mode" "$path"
  else
    install -d -o root -g root -m "$mode" "$path"
  fi
}
ensure_real_directory "$BASE" 0700
ensure_real_directory "$RELEASES" 0700
ensure_real_directory "$STATE_ROOT" 0700

signed_download(){
  local output="$1" path='/api/v1/node/restart/poll' payload timestamp nonce digest signfile signature status
  payload="$(python3 - "$XMESH_NODE_ID" "$VERSION" <<'PY'
import json,sys
print(json.dumps({'node_id':int(sys.argv[1]),'artifactVersion':sys.argv[2]},separators=(',',':')))
PY
)"
  timestamp="$(date +%s)"
  nonce="$(openssl rand -hex 16)"
  digest="$(printf '%s' "$payload" | openssl dgst -sha256 -r | awk '{print $1}')"
  signfile="$(mktemp)"
  printf 'XMESH1\nPOST\n%s\n%s\n%s\n%s\n%s\n' "$path" "$XMESH_NODE_ID" "$timestamp" "$nonce" "$digest" > "$signfile"
  signature="$(openssl pkeyutl -sign -rawin -inkey "$KEY" -in "$signfile" | od -An -tx1 -v | tr -d ' \n')"
  rm -f "$signfile"
  [[ "${#signature}" -eq 128 ]] || return 1
  status="$(curl --proto '=https' --tlsv1.2 --silent --show-error --max-time 90 \
    --output "$output" --write-out '%{http_code}' -X POST "$XMESH_API_URL$path" \
    -H "X-XMesh-Timestamp: $timestamp" \
    -H "X-XMesh-Nonce: $nonce" \
    -H "X-XMesh-Signature: $signature" \
    -H 'Content-Type: application/json' --data-binary "$payload")" || return 1
  [[ "$status" =~ ^2[0-9][0-9]$ ]] || { echo "artifact download failed: HTTP $status" >&2; return 1; }
}

identity_matches(){
  local binary="$1" output
  [[ -f "$binary" && ! -L "$binary" && -x "$binary" ]] || return 1
  output="$(timeout 10 "$binary" --identity 2>/dev/null)" || return 1
  python3 - "$output" "$VERSION" "$SOURCE_REVISION" <<'PY'
import json,sys
expected={'version':sys.argv[2],'sourceRevision':sys.argv[3]}
try:
    value=json.loads(sys.argv[1])
except (json.JSONDecodeError,UnicodeDecodeError):
    raise SystemExit(1)
if value != expected:
    raise SystemExit(1)
PY
}

verify_package(){
  local package_dir="$1" binary="$package_dir/xmesh-agent-xspv2" actual identity_file="$package_dir/identity.json"
  [[ -d "$package_dir" && ! -L "$package_dir" ]] || return 1
  [[ -f "$binary" && ! -L "$binary" && -x "$binary" ]] || return 1
  [[ -f "$identity_file" && ! -L "$identity_file" ]] || return 1
  actual="$(sha256sum "$binary" | awk '{print $1}')" || return 1
  [[ "$actual" == "$ARTIFACT_SHA256" ]] || return 1
  identity_matches "$binary" || return 1
  timeout 20 "$binary" --check-state "$STATE_ROOT" >/dev/null || return 1
  python3 - "$identity_file" "$VERSION" "$SOURCE_REVISION" "$ARTIFACT_SHA256" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf-8') as stream:
    value=json.load(stream)
expected={'version':sys.argv[2],'sourceRevision':sys.argv[3],'artifactSha256':sys.argv[4]}
if value != expected:
    raise SystemExit(1)
PY
}

write_identity(){
  local destination="$1"
  python3 - "$destination" "$VERSION" "$SOURCE_REVISION" "$ARTIFACT_SHA256" <<'PY'
import json,os,sys,tempfile
path=sys.argv[1]
value={'version':sys.argv[2],'sourceRevision':sys.argv[3],'artifactSha256':sys.argv[4]}
dirname=os.path.dirname(path)
fd,tmp=tempfile.mkstemp(prefix='.identity.',dir=dirname,text=True)
try:
    with os.fdopen(fd,'w',encoding='utf-8') as stream:
        json.dump(value,stream,separators=(',',':'))
        stream.write('\n');stream.flush();os.fsync(stream.fileno())
    os.chmod(tmp,0o600);os.replace(tmp,path)
finally:
    try: os.unlink(tmp)
    except FileNotFoundError: pass
PY
}

write_last_good_shell(){
  local shell_version='unknown'
  if [[ -f /usr/local/sbin/xmesh-node-control && ! -L /usr/local/sbin/xmesh-node-control ]];then
    shell_version="$(awk -F'"' '/^AGENT_VERSION="[A-Za-z0-9._+-]+"$/ {print $2; exit}' /usr/local/sbin/xmesh-node-control)"
    [[ "$shell_version" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$ ]] || shell_version='unknown'
  fi
  python3 - "$LAST_GOOD" "$shell_version" "$STATE_ROOT" <<'PY'
import json,os,sys,tempfile,time
path,version,state_root=sys.argv[1:]
value={
  'kind':'deployed-shell-control-agent',
  'controlAuthority':'xmesh-node-control.service',
  'executable':'/usr/local/sbin/xmesh-node-control',
  'version':version,
  'stateRoot':state_root,
  'recordedAt':int(time.time())
}
fd,tmp=tempfile.mkstemp(prefix='.last-good.',dir=os.path.dirname(path),text=True)
try:
    with os.fdopen(fd,'w',encoding='utf-8') as stream:
        json.dump(value,stream,separators=(',',':'));stream.write('\n');stream.flush();os.fsync(stream.fileno())
    os.chmod(tmp,0o600);os.replace(tmp,path)
finally:
    try: os.unlink(tmp)
    except FileNotFoundError: pass
PY
}

write_last_good_package(){
  local target="$1" package_dir="$BASE/$target" identity_file="$package_dir/identity.json"
  [[ -f "$identity_file" && ! -L "$identity_file" ]] || return 1
  python3 - "$LAST_GOOD" "$target" "$identity_file" "$STATE_ROOT" <<'PY'
import json,os,re,sys,tempfile,time
path,target,identity_path,state_root=sys.argv[1:]
if not re.fullmatch(r'releases/[0-9a-f]{64}',target):
    raise SystemExit('invalid last-known-good target')
with open(identity_path,encoding='utf-8') as stream:
    identity=json.load(stream)
if set(identity) != {'version','sourceRevision','artifactSha256'}:
    raise SystemExit('invalid last-known-good identity')
if identity['artifactSha256'] != target.split('/',1)[1]:
    raise SystemExit('last-known-good digest/target mismatch')
value={
  'kind':'go-agent-package',
  'target':target,
  'identity':identity,
  'controlAuthority':'xmesh-node-control.service',
  'activationMode':'side-by-side-package-pointer',
  'stateRoot':state_root,
  'recordedAt':int(time.time())
}
fd,tmp=tempfile.mkstemp(prefix='.last-good.',dir=os.path.dirname(path),text=True)
try:
    with os.fdopen(fd,'w',encoding='utf-8') as stream:
        json.dump(value,stream,separators=(',',':'));stream.write('\n');stream.flush();os.fsync(stream.fileno())
    os.chmod(tmp,0o600);os.replace(tmp,path)
finally:
    try: os.unlink(tmp)
    except FileNotFoundError: pass
PY
}

old_target=''
if [[ -e "$CURRENT" || -L "$CURRENT" ]]; then
  [[ -L "$CURRENT" ]] || { echo 'active Agent package pointer is not a symlink' >&2; exit 1; }
  old_target="$(readlink "$CURRENT")"
  [[ "$old_target" =~ ^releases/[0-9a-f]{64}$ ]] || { echo 'active Agent package pointer escaped releases' >&2; exit 1; }
  old_dir="$BASE/$old_target"
  [[ -d "$old_dir" && ! -L "$old_dir" ]] || { echo 'last-known-good package is unavailable' >&2; exit 1; }
  write_last_good_package "$old_target"
else
  # First side-by-side Go package still has the deployed shell Agent as the
  # authoritative last-known-good control implementation.
  write_last_good_shell
fi

package_rel="releases/$ARTIFACT_SHA256"
package_dir="$BASE/$package_rel"
if [[ -e "$package_dir" || -L "$package_dir" ]]; then
  verify_package "$package_dir" || { echo 'existing content-addressed package is invalid' >&2; exit 1; }
else
  stage="$RELEASES/.staging-$ARTIFACT_SHA256-$$"
  trap 'rm -rf -- "$stage"' EXIT
  ensure_real_directory "$stage" 0700
  binary="$stage/xmesh-agent-xspv2"
  signed_download "$binary" || { echo 'signed Agent artifact download failed' >&2; exit 1; }
  chmod 0755 "$binary"
  actual="$(sha256sum "$binary" | awk '{print $1}')"
  [[ "$actual" == "$ARTIFACT_SHA256" ]] || { echo 'downloaded Agent artifact digest mismatch' >&2; exit 1; }
  identity_matches "$binary" || { echo 'downloaded Agent embedded identity mismatch' >&2; exit 1; }
  timeout 20 "$binary" --check-state "$STATE_ROOT" >/dev/null || { echo 'downloaded Agent self-check failed' >&2; exit 1; }
  write_identity "$stage/identity.json"
  chmod 0600 "$stage/identity.json"
  mv "$stage" "$package_dir"
  trap - EXIT
fi

new_link="$BASE/.current.$$"
rm -f "$new_link"
ln -s "$package_rel" "$new_link"
mv -Tf "$new_link" "$CURRENT"

rollback(){
  rm -f "$new_link"
  if [[ -n "$old_target" ]]; then
    ln -s "$old_target" "$new_link"
    mv -Tf "$new_link" "$CURRENT"
  else
    rm -f "$CURRENT"
  fi
}

if ! verify_package "$package_dir"; then
  rollback
  echo 'post-activation Agent package verification failed; package pointer rolled back' >&2
  exit 1
fi

# Confirm the active symlink still resolves to the exact package just verified.
[[ -L "$CURRENT" && "$(readlink "$CURRENT")" == "$package_rel" ]] || {
  rollback
  echo 'active Agent package pointer changed during verification' >&2
  exit 1
}
write_identity "$ACTIVE"
chmod 0600 "$ACTIVE"
echo "staged Agent package active: $VERSION $SOURCE_REVISION $ARTIFACT_SHA256"
