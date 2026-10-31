#!/usr/bin/env bash
# XMesh Nexus v6 POSTQUANTUM foundation provisioning.
# Fresh installs get a complete PQ-ready foundation. Reinstalls preserve every
# existing signer/CA identity and never silently rotate legacy DB credentials.
set -Eeuo pipefail
umask 077
export LC_ALL=C

[[ "${EUID}" -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
[[ -f VERSION && ! -L VERSION ]] || { echo "VERSION is missing" >&2; exit 1; }
[[ "$(tr -d '\r\n' < VERSION)" == "6.0.0" ]] || { echo "This provisioner requires XMesh Nexus v6.0.0" >&2; exit 1; }
[[ -f .env && ! -L .env ]] || { echo ".env is missing; run ./install.sh first" >&2; exit 1; }
for cmd in docker python3 install sha256sum; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "$cmd is required" >&2; exit 1; }
done
docker compose version >/dev/null
docker info >/dev/null 2>&1 || { echo "Docker daemon unavailable" >&2; exit 1; }

SIGNER_DIR="${XSP_V2_SIGNER_KEYS_DIR:-/etc/xmesh-nexus/xsp-v2-signer}"
PUBLIC_DIR="${XSP_V2_PUBLIC_DIR:-/etc/xmesh-nexus/xsp-v2-public}"
INGRESS_DIR="${XSP_V2_INGRESS_CERTS_DIR:-/etc/xmesh-nexus/xsp-v2-ingress}"
STATE_DIR="${XSP_V2_V6_FOUNDATION_STATE_DIR:-/var/lib/xmesh-nexus/xsp-v2-v6}"
RUNTIME_DIR="${XSP_V2_STRICT_PQ_RUNTIME_DIR:-/run/xmesh-nexus/xsp-v2-strict-pq}"
OPENSSL_RUNTIME_IMAGE="${XSP_V2_OPENSSL_RUNTIME_IMAGE:-xmesh-nexus-openssl35:v6}"

append_env(){
  local name="$1" value="$2" current
  if grep -q "^${name}=" .env; then
    current="$(sed -n "s/^${name}=//p" .env | tail -n 1)"
    [[ "$current" == "$value" ]] || {
      echo "$name already has a different value; refusing silent identity/credential replacement" >&2
      exit 1
    }
  else
    printf '%s=%s\n' "$name" "$value" >> .env
  fi
}

env_value(){ sed -n "s/^$1=//p" .env | tail -n 1; }
role_exists(){
  docker compose exec -T db psql -U postgres -d xmesh -Atqc \
    "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='$1')" | grep -qx t
}

build_openssl35_image(){
  if docker image inspect "$OPENSSL_RUNTIME_IMAGE" >/dev/null 2>&1; then return 0; fi
  echo "Building local OpenSSL 3.5 helper image once..."
  docker build --pull -t "$OPENSSL_RUNTIME_IMAGE" - <<'DOCKER'
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["openssl"]
DOCKER
  local version
  version="$(docker run --rm --network none "$OPENSSL_RUNTIME_IMAGE" version)"
  [[ "$version" == "OpenSSL 3.5."* || "$version" == "OpenSSL 3.6."* ]] || {
    echo "PQ helper image did not provide OpenSSL 3.5+ ($version)" >&2; exit 1;
  }
}

ossl(){ local work="$1"; shift; docker run --rm --network none -v "$work:/work" "$OPENSSL_RUNTIME_IMAGE" "$@"; }

write_secret_if_missing(){
  local name="$1" value
  value="$(env_value "$name")"
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

regular_pair_or_absent(){
  local a="$1" b="$2" label="$3"
  if [[ -e "$a" || -L "$a" || -e "$b" || -L "$b" ]]; then
    [[ -f "$a" && ! -L "$a" && -f "$b" && ! -L "$b" ]] || {
      echo "Partial $label material detected; refusing automatic replacement" >&2; exit 1;
    }
    return 0
  fi
  return 1
}

build_openssl35_image
install -d -o root -g 10001 -m 0750 "$SIGNER_DIR" "$PUBLIC_DIR"
install -d -o root -g 10003 -m 0750 "$INGRESS_DIR"
install -d -o root -g root -m 0700 "$STATE_DIR"

# ----- Panel dual-signature identity -----
if ! regular_pair_or_absent "$SIGNER_DIR/panel-ed25519.pem" "$SIGNER_DIR/panel-mldsa65.pem" "panel signer"; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  ossl "$tmp" genpkey -algorithm ED25519 -out /work/panel-ed25519.pem
  ossl "$tmp" genpkey -algorithm ML-DSA-65 -out /work/panel-mldsa65.pem
  install -o root -g 10001 -m 0440 "$tmp/panel-ed25519.pem" "$SIGNER_DIR/panel-ed25519.pem"
  install -o root -g 10001 -m 0440 "$tmp/panel-mldsa65.pem" "$SIGNER_DIR/panel-mldsa65.pem"
  rm -rf "$tmp"; trap - EXIT
fi
chown root:10001 "$SIGNER_DIR/panel-ed25519.pem" "$SIGNER_DIR/panel-mldsa65.pem"
chmod 0440 "$SIGNER_DIR/panel-ed25519.pem" "$SIGNER_DIR/panel-mldsa65.pem"

pubtmp="$(mktemp -d)"; trap 'rm -rf "$pubtmp"' EXIT
cp "$SIGNER_DIR/panel-ed25519.pem" "$pubtmp/ed.pem"
cp "$SIGNER_DIR/panel-mldsa65.pem" "$pubtmp/pq.pem"
ossl "$pubtmp" pkey -in /work/ed.pem -pubout -outform DER -out /work/ed.der
ossl "$pubtmp" pkey -in /work/pq.pem -pubout -outform DER -out /work/pq.der
python3 - "$pubtmp/ed.der" "$pubtmp/pq.der" "$PUBLIC_DIR/panel-pin.json" <<'PY'
import base64,hashlib,json,os,sys,tempfile
ed=open(sys.argv[1],'rb').read()[-32:]
pq=open(sys.argv[2],'rb').read()[-1952:]
if len(ed)!=32 or len(pq)!=1952: raise SystemExit('unexpected signer public-key length')
value={'issuerId':'xmesh-nexus-panel','ed25519KeyId':'ed-'+hashlib.sha256(ed).digest()[:12].hex(),'mldsa65KeyId':'pq-'+hashlib.sha256(pq).digest()[:12].hex(),'ed25519PublicB64':base64.b64encode(ed).decode(),'mldsa65PublicB64':base64.b64encode(pq).decode()}
path=sys.argv[3]
if os.path.exists(path):
    if os.path.islink(path): raise SystemExit('panel pin must not be a symlink')
    if json.load(open(path,encoding='utf-8'))!=value: raise SystemExit('existing panel pin does not match signer keys; refusing rotation')
else:
    fd,tmp=tempfile.mkstemp(prefix='.panel-pin.',dir=os.path.dirname(path),text=True)
    with os.fdopen(fd,'w',encoding='utf-8') as f: json.dump(value,f,separators=(',',':'));f.write('\n');f.flush();os.fsync(f.fileno())
    os.chmod(tmp,0o640);os.replace(tmp,path)
print(value['ed25519KeyId']);print(value['mldsa65KeyId'])
PY
mapfile -t PANEL_IDS < <(python3 - "$PUBLIC_DIR/panel-pin.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1],encoding='utf-8'));print(v['ed25519KeyId']);print(v['mldsa65KeyId'])
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

# ----- Least-privilege PostgreSQL roles -----
db_managed=true
signer_exists=false; c2c_exists=false
role_exists xmesh_signer_reader && signer_exists=true || true
role_exists xmesh_c2c_writer && c2c_exists=true || true
SIGNER_PASSWORD="$(env_value XSP_V2_SIGNER_DB_PASSWORD)"
C2C_PASSWORD="$(env_value XSP_V2_C2C_DB_PASSWORD)"
if [[ "$signer_exists" == true && -z "$SIGNER_PASSWORD" ]]; then
  db_managed=false; echo "Existing signer DB role has legacy credentials; preserving it without rotation." >&2
else
  SIGNER_PASSWORD="$(write_secret_if_missing XSP_V2_SIGNER_DB_PASSWORD)"
  append_env XSP_V2_SIGNER_DATABASE_URL "postgresql://xmesh_signer_reader:${SIGNER_PASSWORD}@db:5432/xmesh"
  signer_sql="$(mktemp)"; chmod 0600 "$signer_sql"
  { printf '\\set signer_password %s\n' "$SIGNER_PASSWORD"; cat deploy/postgres/20-create-xsp-v2-signer-role.sql; } > "$signer_sql"
  docker compose exec -T db psql -U postgres -d xmesh -v ON_ERROR_STOP=1 < "$signer_sql"; rm -f "$signer_sql"
fi
if [[ "$c2c_exists" == true && -z "$C2C_PASSWORD" ]]; then
  db_managed=false; echo "Existing C2-C DB role has legacy credentials; preserving it without rotation." >&2
else
  C2C_PASSWORD="$(write_secret_if_missing XSP_V2_C2C_DB_PASSWORD)"
  append_env XSP_V2_C2C_DATABASE_URL "postgresql://xmesh_c2c_writer:${C2C_PASSWORD}@db:5432/xmesh"
  c2c_sql="$(mktemp)"; chmod 0600 "$c2c_sql"
  { printf '\\set c2c_password %s\n' "$C2C_PASSWORD"; cat deploy/postgres/21-create-xsp-v2-c2c-role.sql; } > "$c2c_sql"
  docker compose exec -T db psql -U postgres -d xmesh -v ON_ERROR_STOP=1 < "$c2c_sql"; rm -f "$c2c_sql"
fi
chmod 0600 .env

# ----- TLS 1.3 hybrid ingress identity -----
server_complete=false
if [[ -f "$INGRESS_DIR/fullchain.pem" && ! -L "$INGRESS_DIR/fullchain.pem" && -f "$INGRESS_DIR/privkey.pem" && ! -L "$INGRESS_DIR/privkey.pem" && -f "$INGRESS_DIR/server-ca.pem" && ! -L "$INGRESS_DIR/server-ca.pem" && -f "$INGRESS_DIR/server-ca-key.pem" && ! -L "$INGRESS_DIR/server-ca-key.pem" ]]; then
  server_complete=true
elif [[ -e "$INGRESS_DIR/fullchain.pem" || -e "$INGRESS_DIR/privkey.pem" || -e "$INGRESS_DIR/server-ca.pem" || -e "$INGRESS_DIR/server-ca-key.pem" ]]; then
  echo "Partial ingress server certificate material detected; refusing automatic replacement" >&2; exit 1
fi
client_ca_present=false; client_ca_key_present=false
[[ -f "$INGRESS_DIR/client-ca.pem" && ! -L "$INGRESS_DIR/client-ca.pem" ]] && client_ca_present=true
[[ -f "$INGRESS_DIR/client-ca-key.pem" && ! -L "$INGRESS_DIR/client-ca-key.pem" ]] && client_ca_key_present=true
if [[ "$client_ca_key_present" == true && "$client_ca_present" != true ]]; then echo "Client CA key exists without its certificate; refusing unsafe repair" >&2; exit 1; fi

certtmp=""
if [[ "$server_complete" != true || "$client_ca_present" != true ]]; then certtmp="$(mktemp -d)"; trap 'rm -rf "$certtmp"' EXIT; fi
if [[ "$server_complete" != true ]]; then
  ossl "$certtmp" genpkey -algorithm ED25519 -out /work/server-ca-key.pem
  ossl "$certtmp" req -x509 -new -key /work/server-ca-key.pem -out /work/server-ca.pem -days 3650 -subj '/CN=XMesh v6 XSP-v2 Ingress CA'
  ossl "$certtmp" genpkey -algorithm ED25519 -out /work/privkey.pem
  ossl "$certtmp" req -new -key /work/privkey.pem -out /work/server.csr -subj '/CN=node-ingress.xsp.invalid' -addext 'subjectAltName=DNS:node-ingress.xsp.invalid'
  printf 'subjectAltName=DNS:node-ingress.xsp.invalid\nextendedKeyUsage=serverAuth\n' > "$certtmp/server.ext"
  ossl "$certtmp" x509 -req -in /work/server.csr -CA /work/server-ca.pem -CAkey /work/server-ca-key.pem -CAcreateserial -out /work/fullchain.pem -days 825 -extfile /work/server.ext
  install -o root -g root -m 0600 "$certtmp/server-ca-key.pem" "$INGRESS_DIR/server-ca-key.pem"
  install -o root -g root -m 0644 "$certtmp/server-ca.pem" "$INGRESS_DIR/server-ca.pem"
  install -o root -g 10003 -m 0640 "$certtmp/privkey.pem" "$INGRESS_DIR/privkey.pem"
  install -o root -g 10003 -m 0640 "$certtmp/fullchain.pem" "$INGRESS_DIR/fullchain.pem"
fi
if [[ "$client_ca_present" != true ]]; then
  ossl "$certtmp" genpkey -algorithm ML-DSA-65 -out /work/client-ca-key.pem
  ossl "$certtmp" req -x509 -new -key /work/client-ca-key.pem -out /work/client-ca.pem -days 3650 -subj '/CN=XMesh v6 ML-DSA-65 Client CA'
  install -o root -g root -m 0600 "$certtmp/client-ca-key.pem" "$INGRESS_DIR/client-ca-key.pem"
  install -o root -g 10003 -m 0640 "$certtmp/client-ca.pem" "$INGRESS_DIR/client-ca.pem"
  client_ca_key_present=true
fi
if [[ -n "$certtmp" ]]; then rm -rf "$certtmp"; trap - EXIT; fi

chown root:10003 "$INGRESS_DIR" "$INGRESS_DIR/fullchain.pem" "$INGRESS_DIR/privkey.pem" "$INGRESS_DIR/client-ca.pem"; chmod 0750 "$INGRESS_DIR"; chmod 0640 "$INGRESS_DIR/fullchain.pem" "$INGRESS_DIR/privkey.pem" "$INGRESS_DIR/client-ca.pem"
chown root:root "$INGRESS_DIR/server-ca.pem" "$INGRESS_DIR/server-ca-key.pem"; chmod 0644 "$INGRESS_DIR/server-ca.pem"; chmod 0600 "$INGRESS_DIR/server-ca-key.pem"
if [[ -f "$INGRESS_DIR/client-ca-key.pem" && ! -L "$INGRESS_DIR/client-ca-key.pem" ]]; then chown root:root "$INGRESS_DIR/client-ca-key.pem"; chmod 0600 "$INGRESS_DIR/client-ca-key.pem"; client_ca_key_present=true; fi

issuance_ready=false; [[ "$client_ca_key_present" == true ]] && issuance_ready=true
python3 - "$STATE_DIR/foundation.json" "$issuance_ready" "$db_managed" "${PANEL_IDS[0]}" "${PANEL_IDS[1]}" <<'PY'
import json,os,sys,tempfile,time
path=sys.argv[1]
value={'schema':'xmesh-v6-postquantum-foundation-1','panelVersion':'6.0.0','strictPQFoundationReady':True,'newClientIssuanceReady':sys.argv[2]=='true','managedDbCredentialsReady':sys.argv[3]=='true','signerEd25519KeyId':sys.argv[4],'signerMLDSA65KeyId':sys.argv[5],'tlsPolicy':'TLS1.3+X25519MLKEM768','messageSuite':'Ed25519+ML-DSA-65','automaticClassicalFallback':False,'productionActivationRequiresPerNodeApproval':True,'recordedAt':int(time.time())}
os.makedirs(os.path.dirname(path),exist_ok=True);fd,tmp=tempfile.mkstemp(prefix='.foundation.',dir=os.path.dirname(path),text=True)
try:
    with os.fdopen(fd,'w',encoding='utf-8') as f: json.dump(value,f,separators=(',',':'));f.write('\n');f.flush();os.fsync(f.fileno())
    os.chmod(tmp,0o600);os.replace(tmp,path);d=os.open(os.path.dirname(path),os.O_RDONLY)
    try: os.fsync(d)
    finally: os.close(d)
finally:
    try: os.unlink(tmp)
    except FileNotFoundError: pass
print(json.dumps(value,separators=(',',':')))
PY
chmod 0600 "$STATE_DIR/foundation.json"
echo "XMesh Nexus v6.0.0 POSTQUANTUM foundation provisioned without rotating existing identity."
if [[ "$issuance_ready" == true ]]; then echo "New per-node ML-DSA client certificate issuance is ready."; else echo "Legacy client CA was preserved without its signing key; current trust remains intact, but new client issuance requires an explicit CA transition." >&2; fi
if [[ "$db_managed" != true ]]; then echo "Legacy XSP-v2 DB credentials were preserved; import them into v6 .env deliberately before automated stack launch." >&2; fi
