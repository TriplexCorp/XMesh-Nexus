#!/usr/bin/env bash
# Build the transition package from an already reviewed bridge artifact.
# Distribute the resulting package only through the trusted signed package
# repository. The updater cannot authorize a new package source on its own.
set -euo pipefail
umask 022
export LC_ALL=C
[[ $# == 3 && "$2" =~ ^[a-f0-9]{64}$ ]] || {
 echo "Usage: $0 BRIDGE_BINARY APPROVED_SHA256 OUTPUT_DEB" >&2; exit 2;
}
[[ -f "$1" && ! -L "$1" ]] || exit 2
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
# Make archive timestamps depend only on the reviewed source revision.
export SOURCE_DATE_EPOCH="$(git -C "$root" show -s --format=%ct HEAD)"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
archive="$work/package"
install -d -m 0755 "$archive/DEBIAN" "$archive/etc/systemd/system/xmesh-node-control.service.d" "$archive/usr/local/libexec"
install -m 0755 "$1" "$archive/usr/local/libexec/xmesh-agent-release-bridge"
read -r digest _ < <(sha256sum "$archive/usr/local/libexec/xmesh-agent-release-bridge")
[[ "$digest" == "$2" ]] || { echo "Bridge artifact digest mismatch" >&2; exit 1; }
(umask 077; printf '%s\n' "$digest" > "$archive/etc/xmesh-agent-release-bridge.sha256")
install -m 0700 "$root/deploy/node-control-agent.sh" "$archive/usr/local/libexec/xmesh-node-control-bridge"
install -m 0700 "$root/deploy/update-node-control-agent.sh" "$archive/usr/local/libexec/xmesh-update-agent-bridge"
install -m 0755 "$root/deploy/xmesh-product-upgrade-coordinator.py" "$archive/usr/local/libexec/"
install -m 0644 "$root/deploy/xmesh-product-agent-upgrade.service" "$root/deploy/xmesh-product-agent-upgrade.timer" "$archive/etc/systemd/system/"
cat > "$archive/etc/systemd/system/xmesh-node-control.service.d/40-product-bridge.conf" <<'DROPIN'
[Service]
ExecStart=
ExecStart=/usr/local/libexec/xmesh-node-control-bridge
DROPIN
cat > "$archive/DEBIAN/control" <<'CONTROL'
Package: xmesh-agent-release-bridge
Version: 6.0.24+bridge1
Architecture: amd64
Maintainer: XMesh Release Engineering
Depends: python3, systemd
Description: XMesh strict-PQ Agent transition supervisor
CONTROL
cat > "$archive/DEBIAN/preinst" <<'PREINST'
#!/bin/sh
set -eu
# Refuse before dpkg writes any package files if the original active release
# is absent. The verified product still owns its existing activation state.
product=/usr/local/bin/xmesh-agent-xspv2-product
set -- $(python3 -I - <<'PY'
import hashlib,json,os,re,stat
def read_private(path, mode, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as file:
        st = os.fstat(file.fileno())
        assert stat.S_ISREG(st.st_mode) and stat.S_IMODE(st.st_mode) == mode
        assert st.st_uid == 0 and st.st_nlink == 1 and 0 < st.st_size <= maximum
        raw = file.read(maximum + 1)
        assert len(raw) == st.st_size
        return raw
data = json.loads(read_private("/var/lib/xmesh-agent/product/config.json", 0o600, 65536))
assert data["releaseIdentity"]["version"] == "control-v6.0.24"
product = read_private("/usr/local/bin/xmesh-agent-xspv2-product", 0o755, 64 << 20)
assert hashlib.sha256(product).hexdigest() == data["releaseIdentity"]["artifactSha256"]
assert re.fullmatch(r"https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?", data["panelUrl"])
assert type(data["nodeId"]) is int and data["nodeId"] > 0
print(data["panelUrl"], data["nodeId"])
PY
)
[ "$#" = 2 ] && [ -f "$product" ] && [ ! -L "$product" ]
"$product" verify-active --panel "$1" --node-id "$2"
PREINST
cat > "$archive/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -eu
if [ "$1" = configure ]; then
 /usr/bin/python3 -I /usr/local/libexec/xmesh-product-upgrade-coordinator.py ready
 systemctl daemon-reload
 systemctl enable --now xmesh-product-agent-upgrade.timer
fi
POSTINST
cat > "$archive/DEBIAN/prerm" <<'PRERM'
#!/bin/sh
set -eu
if [ "$1" = remove ]; then
 pending=/var/lib/xmesh-node-control/product-upgrade/command.json
 if [ -e "$pending" ] || [ -L "$pending" ]; then
  echo "Finish the pending product update before removing its bridge" >&2
  exit 1
 fi
 systemctl disable --now xmesh-product-agent-upgrade.timer
fi
PRERM
cat > "$archive/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -eu
case "$1" in
 remove|purge) systemctl daemon-reload ;;
esac
POSTRM
chmod 0755 "$archive/DEBIAN/preinst" "$archive/DEBIAN/postinst" "$archive/DEBIAN/prerm" "$archive/DEBIAN/postrm"
dpkg-deb --root-owner-group --build "$archive" "$3"
