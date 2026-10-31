#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

IMAGE="${XSP_V2_OPENSSL_RUNTIME_IMAGE:-xmesh-nexus-openssl35:key-format-test}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build --pull -t "$IMAGE" - <<'DOCKER'
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["openssl"]
DOCKER
fi

ossl(){ docker run --rm --network none -v "$work:/work" "$IMAGE" "$@"; }

# Reproduce the format produced by the old provisioner: seed + expanded key.
ossl genpkey -algorithm ML-DSA-65 -out /work/legacy.pem
ossl pkey -in /work/legacy.pem -pubout -outform DER -out /work/legacy.pub.der

# The migration must preserve the identity while emitting the Go/x509-compatible
# seed-only PKCS#8 representation.
ossl pkey -in /work/legacy.pem \
  -provparam ml-dsa.output_formats=seed-only \
  -out /work/migrated.pem
ossl pkey -in /work/migrated.pem -pubout -outform DER -out /work/migrated.pub.der
cmp -s "$work/legacy.pub.der" "$work/migrated.pub.der"

# Fresh generation must already use the same seed-only representation.
ossl genpkey \
  -provparam ml-dsa.output_formats=seed-only \
  -algorithm ML-DSA-65 \
  -out /work/fresh.pem

cat > "$work/check.go" <<'GO'
package main

import (
    "crypto/mldsa"
    "crypto/x509"
    "encoding/pem"
    "fmt"
    "os"
)

func main() {
    if len(os.Args) != 2 { panic("usage: check key.pem") }
    raw, err := os.ReadFile(os.Args[1])
    if err != nil { panic(err) }
    block, rest := pem.Decode(raw)
    if block == nil || len(rest) != 0 || block.Type != "PRIVATE KEY" { panic("invalid PEM") }
    key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
    if err != nil { panic(err) }
    if _, ok := key.(*mldsa.PrivateKey); !ok { panic(fmt.Sprintf("unexpected key type %T", key)) }
}
GO

docker run --rm --network none -v "$work:/work" -w /work golang:1.27.3-trixie \
  go run ./check.go /work/migrated.pem
docker run --rm --network none -v "$work:/work" -w /work golang:1.27.3-trixie \
  go run ./check.go /work/fresh.pem

echo "XSP-v2 ML-DSA seed-only compatibility: ok"
