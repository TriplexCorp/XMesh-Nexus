#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this provisioning script with sudo/root." >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo ".env is missing; run ./install.sh first." >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  echo "OpenSSL and Python 3 are required." >&2
  exit 1
fi

target="${XSP_V2_SIGNER_KEYS_DIR:-/etc/xmesh-nexus/xsp-v2-signer}"
if [[ -e "$target/panel-ed25519.pem" || -L "$target/panel-ed25519.pem" \
   || -e "$target/panel-mldsa65.pem" || -L "$target/panel-mldsa65.pem" ]]; then
  echo "Signer keys already exist; refusing to overwrite or rotate them automatically." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
umask 077
openssl genpkey -algorithm ED25519 -out "$tmp/panel-ed25519.pem"
if ! openssl genpkey -algorithm ML-DSA-65 -out "$tmp/panel-mldsa65.pem"; then
  echo "This host OpenSSL provider cannot generate ML-DSA-65. No keys were installed." >&2
  exit 1
fi
openssl pkey -in "$tmp/panel-ed25519.pem" -pubout -outform DER -out "$tmp/panel-ed25519.pub.der"
openssl pkey -in "$tmp/panel-mldsa65.pem" -pubout -outform DER -out "$tmp/panel-mldsa65.pub.der"

readarray -t key_ids < <(python3 - "$tmp/panel-ed25519.pub.der" "$tmp/panel-mldsa65.pub.der" <<'PY'
import hashlib
import pathlib
import sys

ed_der = pathlib.Path(sys.argv[1]).read_bytes()
pq_der = pathlib.Path(sys.argv[2]).read_bytes()
if len(ed_der) < 32 or len(pq_der) < 1952:
    raise SystemExit("OpenSSL returned an unexpected public-key DER length")
ed_raw = ed_der[-32:]
pq_raw = pq_der[-1952:]
print("ed-" + hashlib.sha256(ed_raw).digest()[:12].hex())
print("pq-" + hashlib.sha256(pq_raw).digest()[:12].hex())
PY
)
ed_pin="${key_ids[0]}"
pq_pin="${key_ids[1]}"

check_pin() {
  local name="$1" expected="$2"
  if grep -q "^$name=" .env; then
    local current
    current="$(sed -n "s/^$name=//p" .env | tail -n 1)"
    if [[ "$current" != "$expected" ]]; then
      echo "$name already has a different value; refusing silent signer key rotation." >&2
      exit 1
    fi
  fi
}
check_pin XSP_V2_SIGNER_EXPECTED_ED_KEY_ID "$ed_pin"
check_pin XSP_V2_SIGNER_EXPECTED_PQ_KEY_ID "$pq_pin"
check_pin XSP_V2_SIGNER_ISSUER_ID xmesh-nexus-panel

echo
echo "New XSP-v2 signer public identity:"
printf '  XSP_V2_SIGNER_ISSUER_ID=xmesh-nexus-panel\n'
printf '  XSP_V2_SIGNER_EXPECTED_ED_KEY_ID=%s\n' "$ed_pin"
printf '  XSP_V2_SIGNER_EXPECTED_PQ_KEY_ID=%s\n' "$pq_pin"
echo
echo "These IDs are public metadata; private keys will remain under $target."
if [[ ! -t 0 ]]; then
  echo "Interactive owner approval is required; run this script from a terminal." >&2
  exit 1
fi
read -r -p "Approve this as the initial panel signer identity and install it? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Cancelled. No keys or pins were installed."
  exit 1
fi

install -d -o 0 -g 10001 -m 0750 "$target"
install -o 0 -g 10001 -m 0440 "$tmp/panel-ed25519.pem" "$target/panel-ed25519.pem"
install -o 0 -g 10001 -m 0440 "$tmp/panel-mldsa65.pem" "$target/panel-mldsa65.pem"

append_env() {
  local name="$1" value="$2"
  if ! grep -q "^$name=" .env; then
    printf '%s=%s\n' "$name" "$value" >> .env
  fi
}
append_env XSP_V2_SIGNER_ISSUER_ID xmesh-nexus-panel
append_env XSP_V2_SIGNER_EXPECTED_ED_KEY_ID "$ed_pin"
append_env XSP_V2_SIGNER_EXPECTED_PQ_KEY_ID "$pq_pin"
chmod 600 .env

echo "Signer keys and initial public-key ID pins installed."
echo "Do not enable the xsp-v2-staging profile until the read-only signer DB role and CI/security review are complete."
