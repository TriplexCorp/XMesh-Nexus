#!/usr/bin/env bash
# XMesh Nexus v6 POSTQUANTUM foundation provisioning.
# Idempotent and non-rotating: existing cryptographic identity is preserved.
# This prepares the panel for strict-PQ per-node activation; it does NOT claim
# a node is activated before a verified per-node receipt/finalization exists.
set -Eeuo pipefail
umask 077
export LC_ALL=C

[[ "${EUID}" -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
[[ -f VERSION && ! -L VERSION ]] || { echo "VERSION is missing" >&2; exit 1; }
[[ "$(tr -d '\r\n' < VERSION)" == "6.0.0" ]] || { echo "This provisioner requires XMesh Nexus v6.0.0" >&2; exit 1; }
[[ -f .env && ! -L .env ]] || { echo ".env is missing; run ./install.sh first" >&2; exit 1; }
for cmd in docker python3 install sha256sum base64; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "$cmd is required" >&2; exit 1; }
done
docker compose version >/dev/null
docker info >/dev/null 2>&1 || { echo "Docker daemon unavailable" >&2; exit 1; }

SIGNER_DIR="${XSP_V2_SIGNER_KEYS_DIR:-/etc/xmesh-nexus/xsp-v2-signer}"
PUBLIC_DIR="${XSP_V2_PUBLIC_DIR:-/etc/xmesh-nexus/xsp-v2-public}"
INGRESS_DIR="${XSP_V2_INGRESS_CERTS_DIR:-/etc/xmesh-nexus/xsp-v2-ingress}"
STATE_DIR="${XSP_V2_V6_FOUNDATION_STATE_DIR:-/var/lib/xmesh-nexus/xsp-v2-v6}"
RUNTIME_DIR="${XSP_V2_STRICT_PQ_RUNTIME_DIR:-/run/xmesh-nexus/xsp-v2-strict-pq}"
OPENSSL_IMAGE="${XSP_V2_OPENSSL_IMAGE:-debian:trixie-slim}"

ensure_pair_state(){
  local a="$1" b="$2" label="$3"
  if [[ -e "$a" || -L "$a" || -e "$b" || -L "$b" ]]; then
    [[ -f "$a" && ! -L "$a" && -f "$b" && ! -L "$b" ]] || {
      echo "Partial $label material detected; refusing automatic replacement" >&2
      exit 1
    }
    return 0
  fi
  return 1
}

append_env(){
  local name="$1" value="$2" current
  if grep -q "^${name}=" .env; then
    current="$(sed -n "s/^${name}=//p" .env | tail -n 1)"
    [[ "$current" == "$value" ]] || {
      echo "$name already exists with a different value; refusing silent rotation" >&2
      exit 1
    }
  else
    printf '%s=%s\n' "$name" "$value" >> .env
  fi
}

ensure_hex_secret(){
  local name="$1" value
  value="$(sed -n "s/^${name}=//p" .env | tail -n 1)"
  if [[ -z "$value" ]]; then
    value="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
    printf '%s=%s\n' "$name" "$value" >> .env
  fi
  [[ "$value" =~ ^[0-9a-f]{64}$ ]] || { echo "$name must be 64 lowercase hex characters" >&2; exit 1; }
  printf '%s' "$value"
}

run_openssl35(){
  docker run --rm --network none -v "$1:/work" "$OPENSSL_IMAGE" \
    sh -ec 'apt-get update >/dev/null && apt-get install -y --no-install-recommends openssl ca-certificates >/dev/null && shift && exec "$@"' sh "${@:2}"
}

install -d -o root -g 10001 -m 0750 "$SIGNER_DIR" "$PUBLIC_DIR"
install -d -o root -g 10003 -m 0750 "$INGRESS_DIR"
install -d -o root -g root -m 0700 "$STATE_DIR"

# ----- Panel response signer identity -----
if ! ensure_pair_state "$SIGNER_DIR/panel-ed25519.pem" "$SIGNER_DIR/panel-mldsa65.pem" "panel signer"; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  run_openssl35 "$tmp" openssl genpkey -algorithm ED25519 -out /work/panel-ed25519.pem
  run_openssl35 "$tmp" openssl genpkey -algorithm ML-DSA-65 -out /work/panel-mldsa65.pem
  install -o root -g 10001 -m 0440 "$tmp/panel-ed25519.pem" "$SIGNER_DIR/panel-ed25519.pem"
  install -o root -g 10001 -m 0440 "$tmp/panel-mldsa65.pem" "$SIGNER_DIR/panel-mldsa65.pem"
  rm -rf "$tmp"; trap - EXIT
fi
chown root:10001 "$SIGNER_DIR/panel-ed25519.pem" "$SIGNER_DIR/panel-mldsa65.pem"
chmod 0440 "$SIGNER_DIR/panel-ed25519.pem" "$SIGNER_DIR/panel-mldsa65.pem"

pubtmp="$(mktemp -d)"; trap 'rm -rf "$pubtmp"' EXIT
cp "$SIGNER_DIR/panel-ed25519.pem" "$pubtmp/ed.pem"
cp "$SIGNER_DIR/panel-mldsa65.pem" "$pubtmp/pq.pem"
run_openssl35 "$pubtmp" openssl pkey -in /work/ed.pem -pubout -outform DER -out /work/ed.der
run_openssl35 "$pubtmp" openssl pkey -in /work/pq.pem -pubout -outform DER -out /work/pq.der
python3 - "$pubtmp/ed.der" "$pubtmp/pq.der" "$PUBLIC_DIR/panel-pin.json" <<'PY'
import base64,hashlib,json,os,sys,tempfile
ed=open(sys.argv[1],'rb').read()[-32:]
pq=open(sys.argv[2],'rb').read()[-1952:]
if len(ed)!=32 or len(pq)!=1952: raise SystemExit('unexpected signer public-key length')
value={
 'issuerId':'xmesh-nexus-panel',
 'ed25519KeyId':'ed-'+hashlib.sha256(ed).digest()[:12].hex(),
 'mldsa65KeyId':'pq-'+hashlib.sha256(pq).digest()[:12].hex(),
 'ed25519PublicB64':base64.b64encode(ed).decode(),
 'mldsa65PublicB64':base64.b64encode(pq).decode(),
}
path=sys.argv[3]; os.makedirs(os.path.dirname(path),exist_ok=True)
if os.path.exists(path):
 old=json.load(open(path,encoding='utf-8'))
 if old!=value: raise SystemExit('existing panel pin does not match signer keys; refusing rotation')
else:
 fd,tmp=tempfile.mkstemp(prefix='.panel-pin.',dir=os.path.dirname(path),text=True)
 with os.fdopen(fd,'w',encoding='utf-8') as f:
  json.dump(value,f,separators=(',',':'));f.write('\n');f.flush();os.fsync(f.fileno())
 os.chmod(tmp,0o640);os.replace(tmp,path)
print(value['ed25519KeyId']);print(value['mldsa65KeyId'])
PY
mapfile -t PANEL_IDS < <(python3 - "$PUBLIC_DIR/panel-pin.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]));print(v['ed25519KeyId']);print(v['mldsa65KeyId'])
PY
)
rm -rf "$pubtmp"; trap - EXIT
chown root:10001 "$PUBLIC_DIR/panel-pin.json"; chmod 0640 "$PUBLIC_DIR/panel-pin.json"
append_env XSP_V2_SIGNER_ISSUER_ID xmesh-nexus-panel
append_env XSP_V2_SIGNER_EXPECTED_ED_KEY_ID "${PANEL_IDS[0]}"
append_env XSP_V2_SIGNER_EXPECTED_PQ_KEY_ID "${PANEL_IDS[1]}"
append_env XSP_V2_SIGNER_KEYS_DIR "$SIGNER_DIR"
append_env XSP_V2_PANEL_PIN_FILE "$PUBLIC_DIR/panel-pin.json"
append_env XSP_V2_INGRESS_CERTS_DIR "$INGRESS_DIR"
append_env XSP_V2_STRICT_PQ_RUNTIME_DIR "$RUNTIME_DIR"

# ----- Least-privilege DB roles -----
SIGNER_PASSWORD="$(ensure_hex_secret XSP_V2_SIGNER_DB_PASSWORD)"
C2C_PASSWORD="$(ensure_hex_secret XSP_V2_C2C_DB_PASSWORD)"
append_env XSP_V2_SIGNER_DATABASE_URL "postgresql://xmesh_signer_reader:${SIGNER_PASSWORD}@db:5432/xmesh"
append_env XSP_V2_C2C_DATABASE_URL "postgresql://xmesh_c2c_writer:${C2C_PASSWORD}@db:5432/xmesh"
chmod 0600 .env

for service in db; do
  docker compose ps --status running --services | grep -qx "$service" || { echo "Base PostgreSQL service is not running" >&2; exit 1; }
done
signer_sql="$(mktemp)"; c2c_sql="$(mktemp)"
trap 'rm -f "$signer_sql" "$c2c_sql"' EXIT
chmod 0600 "$signer_sql" "$c2c_sql"
{ printf '\\set signer_password %s\n' "$SIGNER_PASSWORD"; cat deploy/postgres/20-create-xsp-v2-signer-role.sql; } > "$signer_sql"
{ printf '\\set c2c_password %s\n' "$C2C_PASSWORD"; cat deploy/postgres/21-create-xsp-v2-c2c-role.sql; } > "$c2c_sql"
docker compose exec -T db psql -U postgres -d xmesh -v ON_ERROR_STOP=1 < "$signer_sql"
docker compose exec -T db psql -U postgres -d xmesh -v ON_ERROR_STOP=1 < "$c2c_sql"
rm -f "$signer_sql" "$c2c_sql"; trap - EXIT

# ----- TLS 1.3 hybrid ingress server material + ML-DSA client CA -----
server_complete=false
if [[ -f "$INGRESS_DIR/fullchain.pem" && ! -L "$INGRESS_DIR/fullchain.pem" &&
      -f "$INGRESS_DIR/privkey.pem" && ! -L "$INGRESS_DIR/privkey.pem" &&
      -f "$INGRESS_DIR/server-ca.pem" && ! -L "$INGRESS_DIR/server-ca.pem" &&
      -f "$INGRESS_DIR/server-ca-key.pem" && ! -L "$INGRESS_DIR/server-ca-key.pem" ]]; then
  server_complete=true
elif [[ -e "$INGRESS_DIR/fullchain.pem" || -e "$INGRESS_DIR/privkey.pem" || -e "$INGRESS_DIR/server-ca.pem" || -e "$INGRESS_DIR/server-ca-key.pem" ]]; then
  echo "Partial ingress server certificate material detected; refusing automatic replacement" >&2
  exit 1
fi

client_ca_present=false
client_ca_key_present=false
[[ -f "$INGRESS_DIR/client-ca.pem" && ! -L "$INGRESS_DIR/client-ca.pem" ]] && client_ca_present=true
[[ -f "$INGRESS_DIR/client-ca-key.pem" && ! -L "$INGRESS_DIR/client-ca-key.pem" ]] && client_ca_key_present=true
if [[ "$client_ca_key_present" == true && "$client_ca_present" != true ]]; then
  echo "Client CA private key exists without its certificate; refusing unsafe repair" >&2
  exit 1
fi

if [[ "$server_complete" != true || "$client_ca_present" != true ]]; then
  certtmp="$(mktemp -d)"; trap 'rm -rf "$certtmp"' EXIT
  if [[ "$server_complete" != true ]]; then
    run_openssl35 "$certtmp" openssl genpkey -algorithm ED25519 -out /work/server-ca-key.pem
    run_openssl35 "$certtmp" openssl req -x509 -new -key /work/server-ca-key.pem -out /work/server-ca.pem -days 3650 -subj '/CN=XMesh v6 XSP-v2 Ingress CA'
    run_openssl35 "$certtmp" openssl genpkey -algorithm ED25519 -out /work/privkey.pem
    run_openssl35 "$certtmp" openssl req -new -key /work/privkey.pem -out /work/server.csr -subj '/CN=node-ingress.xsp.invalid' -addext 'subjectAltName=DNS:node-ingress.xsp.invalid'
    printf 'subjectAltName=DNS:node-ingress.xsp.invalid\nextendedKeyUsage=serverAuth\n' > "$certtmp/server.ext"
    run_openssl35 "$certtmp" openssl x509 -req -in /work/server.csr -CA /work/server-ca.pem -CAkey /work/server-ca-key.pem -CAcreateserial -out /work/fullchain.pem -days 825 -extfile /work/server.ext
    install -o root -g root -m 0600 "$certtmp/server-ca-key.pem" "$INGRESS_DIR/server-ca-key.pem"
    install -o root -g root -m 0644 "$certtmp/server-ca.pem" "$INGRESS_DIR/server-ca.pem"
    install -o root -g 10003 -m 0640 "$certtmp/privkey.pem" "$INGRESS_DIR/privkey.pem"
    install -o root -g 10003 -m 0640 "$certtmp/fullchain.pem" "$INGRESS_DIR/fullchain.pem"
  fi
  if [[ "$client_ca_present" != true ]]; then
    run_openssl35 "$certtmp" openssl genpkey -algorithm ML-DSA-65 -out /work/client-ca-key.pem
    run_openssl35 "$certtmp" openssl req -x509 -new -key /work/client-ca-key.pem -out /work/client-ca.pem -days 3650 -subj '/CN=XMesh v6 ML-DSA-65 Client CA'
    install -o root -g root -m 0600 "$certtmp/client-ca-key.pem" "$INGRESS_DIR/client-ca-key.pem"
    install -o root -g 10003 -m 0640 "$certtmp/client-ca.pem" "$INGRESS_DIR/client-ca.pem"
    client_ca_key_present=true
  fi
  rm -rf "$certtmp"; trap - EXIT
fi

chown root:10003 "$INGRESS_DIR" "$INGRESS_DIR/fullchain.pem" "$INGRESS_DIR/privkey.pem" "$INGRESS_DIR/client-ca.pem"
chmod 0750 "$INGRESS_DIR"
chmod 0640 "$INGRESS_DIR/fullchain.pem" "$INGRESS_DIR/privkey.pem" "$INGRESS_DIR/client-ca.pem"
chown root:root "$INGRESS_DIR/server-ca.pem" "$INGRESS_DIR/server-ca-key.pem"
chmod 0644 "$INGRESS_DIR/server-ca.pem"; chmod 0600 "$INGRESS_DIR/server-ca-key.pem"
if [[ -f "$INGRESS_DIR/client-ca-key.pem" ]]; then chown root:root "$INGRESS_DIR/client-ca-key.pem"; chmod 0600 "$INGRESS_DIR/client-ca-key.pem"; fi

issuance_ready=false
[[ -f "$INGRESS_DIR/client-ca-key.pem" && ! -L "$INGRESS_DIR/client-ca-key.pem" ]] && issuance_ready=true
python3 - "$STATE_DIR/foundation.json" "$issuance_ready" "${PANEL_IDS[0]}" "${PANEL_IDS[1]}" <<'PY'
import json,os,sys,tempfile,time
path=sys.argv[1]
value={
 'schema':'xmesh-v6-postquantum-foundation-1',
 'panelVersion':'6.0.0',
 'strictPQFoundationReady':True,
 'newClientIssuanceReady':sys.argv[2]=='true',
 'signerEd25519KeyId':sys.argv[3],
 'signerMLDSA65KeyId':sys.argv[4],
 'tlsPolicy':'TLS1.3+X25519MLKEM768',
 'messageSuite':'Ed25519+ML-DSA-65',
 'automaticClassicalFallback':False,
 'productionActivationRequiresPerNodeApproval':True,
 'recordedAt':int(time.time()),
}
os.makedirs(os.path.dirname(path),exist_ok=True)
fd,tmp=tempfile.mkstemp(prefix='.foundation.',dir=os.path.dirname(path),text=True)
try:
 with os.fdopen(fd,'w',encoding='utf-8') as f:
  json.dump(value,f,separators=(',',':'));f.write('\n');f.flush();os.fsync(f.fileno())
 os.chmod(tmp,0o600);os.replace(tmp,path)
 d=os.open(os.path.dirname(path),os.O_RDONLY)
 try: os.fsync(d)
 finally: os.close(d)
finally:
 try: os.unlink(tmp)
 except FileNotFoundError: pass
print(json.dumps(value,separators=(',',':')))
PY
chmod 0600 "$STATE_DIR/foundation.json"

echo "XMesh Nexus v6.0.0 POSTQUANTUM foundation provisioned without rotating existing identity."
if [[ "$issuance_ready" == true ]]; then
  echo "New per-node ML-DSA client certificate issuance is ready."
else
  echo "Existing legacy client CA was preserved without its signing key; current trust remains intact, but new client issuance requires an explicit CA transition." >&2
fi
