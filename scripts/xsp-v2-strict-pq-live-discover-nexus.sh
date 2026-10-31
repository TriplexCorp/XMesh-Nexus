#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
APPROVAL="$ROOT/deploy/xsp-v2-kvm-vps-strict-pq-activation-approval-v2.json"
PINNED="$ROOT/scripts/verify-xsp-v2-kvm-vps-strict-pq-activation-approval-v2-pinned.py"

echo '=== XSP-v2 strict-PQ Nexus live discovery ==='
echo "repo=$ROOT"
echo "head=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
echo

if [[ -f "$APPROVAL" && -f "$PINNED" ]]; then
  echo '--- approval ---'
  python3 "$PINNED" --approval "$APPROVAL" --require-current-window --require-node 13 || true
  sha256sum "$APPROVAL"
else
  echo 'approval/verifier: MISSING'
fi

echo
echo '--- known evidence/public metadata files ---'
for p in \
  /root/node13-panel-pin.json \
  /root/node13-recovery-panel-pin.json \
  /root/node13-commit-receipt.json \
  /root/node13-production-recovery-checkpoint.json \
  /root/node13-production-recovery-verification.json \
  /root/xspv2-provider-storage-acceptance.json \
  /root/xspv2-postgres-crash-recovery-node13.json; do
  if [[ -f "$p" && ! -L "$p" ]]; then
    printf 'FOUND %s mode=%s owner=%s:%s size=%s sha256=' "$p" "$(stat -c %a "$p")" "$(stat -c %U "$p")" "$(stat -c %G "$p")" "$(stat -c %s "$p")"
    sha256sum "$p" | awk '{print $1}'
  else
    echo "MISS  $p"
  fi
done

echo
echo '--- candidate signer/certificate material (CONTENTS NOT PRINTED) ---'
python3 - <<'PY'
import os, stat
roots=['/root','/etc','/var/lib']
names={'panel-ed25519.pem','panel-mldsa65.pem','fullchain.pem','privkey.pem','client-ca.pem'}
seen=set()
for root in roots:
    if not os.path.isdir(root): continue
    for base,dirs,files in os.walk(root):
        rel=os.path.relpath(base,root)
        depth=0 if rel=='.' else rel.count(os.sep)+1
        if depth>=5:
            dirs[:]=[]
        dirs[:]=[d for d in dirs if d not in {'.git','target','node_modules','proc','sys','dev'}]
        for name in files:
            if name not in names: continue
            p=os.path.join(base,name)
            if p in seen or os.path.islink(p): continue
            seen.add(p)
            try:
                st=os.stat(p)
                print(f'FOUND {p} mode={oct(stat.S_IMODE(st.st_mode))[2:]} uid={st.st_uid} gid={st.st_gid} size={st.st_size}')
            except OSError as e:
                print(f'ERR   {p}: {e}')
if not seen: print('NONE')
PY

echo
echo '--- existing public XSP env bindings (passwords/URLs suppressed) ---'
python3 - <<'PY'
import os,re
wanted={
 'XSP_V2_SIGNER_EXPECTED_ED_KEY_ID','XSP_V2_SIGNER_EXPECTED_PQ_KEY_ID',
 'XSP_V2_SIGNER_ISSUER_ID','XSP_V2_STRICT_PQ_NODE_ID',
 'XSP_V2_STRICT_PQ_CLIENT_SPKI_SHA256','XSP_EXPECTED_CLIENT_SPKI_SHA256',
 'XSP_EXPECTED_NODE_ID','XSP_V2_STRICT_PQ_BIND','XSP_V2_STRICT_PQ_PORT'
}
roots=['/root','/etc']
seen=set()
for root in roots:
    if not os.path.isdir(root): continue
    for base,dirs,files in os.walk(root):
        rel=os.path.relpath(base,root); depth=0 if rel=='.' else rel.count(os.sep)+1
        if depth>=4: dirs[:]=[]
        dirs[:]=[d for d in dirs if d not in {'.git','target','node_modules'}]
        for name in files:
            if not (name.endswith('.env') or name.endswith('.conf') or name.endswith('.service') or name.endswith('.json')): continue
            p=os.path.join(base,name)
            try:
                if os.path.getsize(p)>512*1024: continue
                text=open(p,encoding='utf-8',errors='ignore').read()
            except OSError: continue
            for line in text.splitlines():
                m=re.match(r'\s*([A-Z0-9_]+)\s*[=:]\s*["\']?([^"\'\s,}]+)',line)
                if m and m.group(1) in wanted:
                    key,val=m.groups(); token=(key,val,p)
                    if token not in seen:
                        seen.add(token); print(f'{key}={val} source={p}')
if not seen: print('NONE')
PY

echo
echo '--- PostgreSQL security roles (NO PASSWORDS) ---'
if command -v docker >/dev/null 2>&1 && docker compose -f "$ROOT/compose.yaml" ps --status running --services 2>/dev/null | grep -qx db; then
  docker compose -f "$ROOT/compose.yaml" exec -T db sh -lc '
    psql -X -A -F "|" -t -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
      SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolinherit, rolbypassrls
      FROM pg_roles
      WHERE rolname IN ('"'"'xmesh_signer_reader'"'"','"'"'xmesh_c2c_writer'"'"','"'"'xmesh_permit_signer_reader'"'"')
      ORDER BY rolname;"'
else
  echo 'db container not running / docker compose unavailable'
fi

echo
echo '--- production state records ---'
for p in /run/xmesh-nexus/xsp-v2-strict-pq/stack-ready.json /var/lib/xmesh-nexus/xsp-v2/production-activation.json /var/lib/xmesh-nexus/xsp-v2/production-rollback.json; do
  if [[ -f "$p" ]]; then echo "FOUND $p"; else echo "MISS  $p"; fi
done

echo
echo 'PASS: Nexus discovery complete (no private key/password contents printed)'
