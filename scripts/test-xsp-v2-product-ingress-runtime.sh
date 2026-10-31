#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

image="xmesh-nexus-xsp-v2-product-ingress:runtime-test"
name="xmesh-xsp-v2-product-ingress-runtime-test-$$"
tmp="$(mktemp -d)"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

mkdir -p "$tmp/certs"
openssl genpkey -algorithm ED25519 -out "$tmp/certs/server-key.pem" >/dev/null 2>&1
openssl req -x509 -new -key "$tmp/certs/server-key.pem" -out "$tmp/certs/fullchain.pem" \
  -days 1 -subj '/CN=node-ingress.xsp.invalid' >/dev/null 2>&1
cp "$tmp/certs/server-key.pem" "$tmp/certs/privkey.pem"
openssl genpkey -algorithm ED25519 -out "$tmp/certs/client-ca-key.pem" >/dev/null 2>&1
openssl req -x509 -new -key "$tmp/certs/client-ca-key.pem" -out "$tmp/certs/client-ca.pem" \
  -days 1 -subj '/CN=XMesh runtime-test client CA' >/dev/null 2>&1
chmod 0644 "$tmp/certs"/*.pem

docker build --target runtime-c2b -t "$image" -f deploy/xsp-v2-ingress/Dockerfile . >/dev/null

docker run -d --name "$name" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m,mode=1777 \
  --tmpfs /var/cache/nginx:rw,noexec,nosuid,size=16m,mode=0755 \
  --tmpfs /run:rw,noexec,nosuid,size=4m,mode=0755 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --add-host xsp-v2-product-gateway:127.0.0.1 \
  -v "$PWD/deploy/xsp-v2-ingress/nginx-product.conf:/etc/nginx/nginx.conf:ro" \
  -v "$tmp/certs:/run/xmesh-ingress-certs:ro" \
  -p 127.0.0.1::8444 \
  "$image" >/dev/null

for _ in $(seq 1 15); do
  if [[ "$(docker inspect -f '{{.State.Status}}' "$name")" == running ]]; then
    sleep 2
    if [[ "$(docker inspect -f '{{.State.Status}}' "$name")" == running ]]; then
      docker exec "$name" nginx -t -q
      mapping="$(docker port "$name" 8444/tcp)"
      [[ "$mapping" == 127.0.0.1:* ]] || { echo "unexpected runtime test port mapping: $mapping" >&2; exit 1; }
      echo "Product strict-PQ ingress runtime stayed up under read-only/non-root constraints: $mapping"
      exit 0
    fi
  fi
  sleep 1
done

echo 'Product strict-PQ ingress did not remain running.' >&2
docker logs "$name" >&2 || true
exit 1
