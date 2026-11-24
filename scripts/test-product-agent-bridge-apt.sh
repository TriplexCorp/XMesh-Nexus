#!/usr/bin/env bash
# Disposable local repository. The trusted public key is provisioned
# independently before APT sees the repository. Never use these lab keys
# outside this process.
set -euo pipefail
[[ $# == 1 && -f "$1" ]] || { echo "Usage: $0 BRIDGE_DEB" >&2; exit 2; }
[[ "$(id -u)" != 0 ]] || { echo "Run without root; this test never installs packages" >&2; exit 2; }
umask 022
export LC_ALL=C
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
mkdir -m 0700 "$work/trusted-signing" "$work/foreign-signing"
repo="$work/repository"
mkdir -p "$repo" "$work/download"
package=xmesh-agent-release-bridge_6.0.24+bridge1_amd64.deb
cp -- "$1" "$repo/$package"
for identity in trusted foreign; do
 if [[ "${XMESH_APT_LAB_SIGNER:-gpg}" == sq ]]; then
  sq --home "$work/$identity-signing" --batch key generate --own-key --without-password \
    --email "$identity@example.invalid" --expiration 1d >/dev/null 2>&1
  continue
 fi
 gpg --homedir "$work/$identity-signing" --batch --pinentry-mode loopback --passphrase '' \
   --quick-generate-key "$identity release lab <${identity}@example.invalid>" ed25519 sign 1d >/dev/null 2>&1
done
if [[ "${XMESH_APT_LAB_SIGNER:-gpg}" == sq ]]; then
 sq --home "$work/trusted-signing" cert export --cert-email trusted@example.invalid |
   gpg --batch --dearmor > "$work/preprovisioned.gpg"
else
 gpg --homedir "$work/trusted-signing" --batch --export > "$work/preprovisioned.gpg"
fi
printf 'deb [signed-by=%s arch=amd64] file:%s ./\n' "$work/preprovisioned.gpg" "$repo" > "$work/sources.list"
(cd "$repo" && dpkg-scanpackages . /dev/null) > "$repo/Packages"
{
 printf 'Date: %s\nValid-Until: %s\n' "$(date -Ru)" "$(date -Ru -d '+1 day')"
 printf 'SHA256:\n %s %s Packages\n' "$(sha256sum "$repo/Packages" | cut -d ' ' -f1)" "$(wc -c < "$repo/Packages")"
} > "$repo/Release"

apt_isolated() {
 local state="$1"
 shift
 mkdir -p "$state/lists/partial" "$state/cache/archives/partial"
 apt-get -o "Dir::Etc::sourcelist=$work/sources.list" -o Dir::Etc::sourceparts=- \
   -o "Dir::State=$state" -o "Dir::State::status=$state/status" \
   -o "Dir::Cache=$state/cache" -o "Debug::NoLocking=true" \
   -o "Acquire::AllowInsecureRepositories=false" -o "APT::Get::AllowUnauthenticated=false" \
   -o APT::Architecture=amd64 -o APT::Update::Error-Mode=any "$@"
}
sign_index() {
 if [[ "${XMESH_APT_LAB_SIGNER:-gpg}" == sq ]]; then
  sq --home "$work/$1-signing" --overwrite sign --signer-email "$1@example.invalid" \
    --cleartext --output "$repo/InRelease" "$repo/Release"
 else
  gpg --homedir "$work/$1-signing" --batch --yes --clearsign --output "$repo/InRelease" "$repo/Release"
 fi
}

sign_index foreign
if apt_isolated "$work/foreign-state" update > "$work/foreign.log" 2>&1; then
 echo "APT accepted metadata signed by an untrusted release key" >&2
 exit 1
fi
grep -Eqi 'no_pubkey|missing key|public key|not signed' "$work/foreign.log"

cp "$repo/Release" "$work/fresh-release"
sed -i "s/^Valid-Until:.*/Valid-Until: $(date -Ru -d 'yesterday')/" "$repo/Release"
sign_index trusted
if apt_isolated "$work/expired-state" update > "$work/expired.log" 2>&1; then
 echo "APT accepted expired signed release metadata" >&2
 exit 1
fi
grep -Eqi 'expired' "$work/expired.log"
cp "$work/fresh-release" "$repo/Release"

sign_index trusted
apt_isolated "$work/trusted-state" update
(cd "$work/download" && apt_isolated "$work/trusted-state" download xmesh-agent-release-bridge=6.0.24+bridge1)
cmp "$1" "$work/download/$package"

# Preserve size but change bytes after the signed Packages index was generated.
python3 - "$repo/$package" <<'PY'
import sys
with open(sys.argv[1], "r+b") as file:
    original = file.read(1)
    file.seek(0)
    file.write(bytes([original[0] ^ 1]))
PY
rm -- "$work/download/$package"
if (cd "$work/download" && apt_isolated "$work/trusted-state" download xmesh-agent-release-bridge=6.0.24+bridge1) > "$work/tampered.log" 2>&1; then
 echo "APT accepted a package that disagreed with signed metadata" >&2
 exit 1
fi
grep -Eqi 'hash sum mismatch|hashes of expected file' "$work/tampered.log"
echo 'APT accepted only the independently pinned signature and exact package bytes.'
