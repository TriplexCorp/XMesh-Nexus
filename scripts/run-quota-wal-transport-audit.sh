#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${QUOTA_TEST_DSN:?Disposable PostgreSQL DSN required}"
: "${REDIS_URL:?Disposable Redis URL required}"
[[ "${XMESH_AUDIT_DISPOSABLE:-}" == 1 &&
   "$QUOTA_TEST_DSN" == postgresql://quota_test:*@127.0.0.1:* &&
   "$REDIS_URL" == redis://127.0.0.1:* ]] || exit 2
[[ $# -ge 1 && $# -le 2 && -x "$1" ]] || exit 2
[[ $# == 1 || "$2" == --with-reconcile || "$2" == --with-product || "$2" == --with-installed ]] || exit 2

run="$(mktemp -d)"
server=""
cleanup() {
    if [[ -n "$server" ]]; then
        kill "$server" 2>/dev/null || true
        wait "$server" 2>/dev/null || true
    fi
    rm -rf -- "$run"
}
trap cleanup EXIT
export DATABASE_URL="$QUOTA_TEST_DSN"
export APP_ADDR=127.0.0.1:38081
export XMESH_TEST_URL="http://$APP_ADDR"
export ADMIN_USERNAME=wal-audit
export ADMIN_PASSWORD="$(openssl rand -hex 24)"
export SUBSCRIPTION_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export XSP_V2_PRODUCT_INTERNAL_TOKEN="$(openssl rand -hex 32)"
export XMESH_QUOTA_V2_ENABLED=0
export XMESH_QUOTA_V2_XRAY_GENESIS_STAGING=0
if [[ "${2:-}" == --with-installed ]]; then
    export XMESH_QUOTA_V2_XRAY_GENESIS_STAGING=1
fi
if [[ "${XMESH_INSTALLED_GENESIS_LEASE:-0}" == 1 ]]; then
    [[ "${2:-}" == --with-installed &&
       "${GITHUB_ACTIONS:-}" == true &&
       "${RUNNER_ENVIRONMENT:-}" == github-hosted &&
       "$QUOTA_TEST_DSN" == */quota_wal_installed ]] || exit 2
    # ONLY the clean, disposable real installed two-Node rehearsal.
    export XMESH_QUOTA_V2_ENABLED=1
    export XMESH_QUOTA_V2_GENESIS_QUARANTINE_STAGING=1
    export XMESH_QUOTA_V2_GENESIS_RESERVATION_STAGING=1
fi
export CORE_DATA_DIR="$run/core"
export XMESH_TEST_POLICY_PUBLIC_KEY="$run/node-policy.pem"

start() {
    XMESH_QUOTA_V2_WAL_TRANSPORT="$1" "$2" >"$run/nexus.log" 2>&1 &
    server=$!
    for ((attempt=0; attempt<100; attempt++)); do
        if curl -fsS "$XMESH_TEST_URL/api/v1/health/ready" >/dev/null 2>&1; then return; fi
        if ! kill -0 "$server" 2>/dev/null; then break; fi
        sleep .2
    done
    cat "$run/nexus.log" >&2
    return 1
}

start 0 "$1"
status="$(curl -sS -X POST -H "X-XMesh-Signature: disabled-test" \
    -H 'Content-Type: application/json' -d '{}' -o /dev/null -w '%{http_code}' \
    "$XMESH_TEST_URL/api/v1/node/quota-v2/wal")"
[[ "$status" == 404 ]]
echo "PASS: WAL transport is disabled with the feature gate off"
kill "$server"
wait "$server"
server=""

start 1 "$1"
python3 -c 'import sys; from pathlib import Path; sys.stdout.buffer.write(bytes.fromhex("302e020100300506032b657004220420") + Path(sys.argv[1]).read_bytes())' "$CORE_DATA_DIR/node-policy-ed25519.key" |
    openssl pkey -inform DER -pubout -out "$XMESH_TEST_POLICY_PUBLIC_KEY"
if [[ "${2:-}" == --with-product ]]; then
    python3 scripts/test-quota-wal-product-tunnel.py
elif [[ "${2:-}" == --with-installed ]]; then
    python3 scripts/test-quota-wal-installed.py
else
    python3 scripts/test-quota-wal-transport.py
    if [[ "${2:-}" == --with-reconcile ]]; then
        python3 scripts/test-quota-wal-reconcile.py
    fi
fi
