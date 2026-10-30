#!/usr/bin/env python3
"""Build deterministic v5 KVM-VPS P0-E independent-review bundle contents."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

CONTRACT = Path("deploy/xsp-v2-p0e-security-review-handoff-v5.contract.json")
HANDOFF = Path("docs/XSP_V2_P0E_SECURITY_REVIEW_HANDOFF_V5.md")
SCHEMA = "xsp2-p0e-security-review-bundle-manifest-2"


def fail(message: str) -> None:
    raise SystemExit(message)


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest_file(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def require(root: Path, relative: str) -> Path:
    root=root.resolve(strict=True); p=(root/relative).resolve(strict=True)
    if root!=p and root not in p.parents: fail(f"path escapes root: {relative}")
    if not p.is_file() or p.stat().st_size<=0: fail(f"missing/empty evidence: {relative}")
    return p


def git_head(root: Path) -> str:
    return subprocess.run(['git','-C',str(root),'rev-parse','HEAD'],check=True,text=True,stdout=subprocess.PIPE).stdout.strip()


def archive(root: Path, revision: str, out: Path, prefix: str) -> None:
    if git_head(root)!=revision: fail(f"wrong checkout revision: {root}")
    subprocess.run(['git','-C',str(root),'archive','--format=tar',f'--prefix={prefix}/','HEAD','-o',str(out)],check=True)
    if not out.is_file() or out.stat().st_size<=0: fail(f"archive not created: {out}")


def copy(source: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(source,dest)


def main() -> int:
    p=argparse.ArgumentParser(); p.add_argument('--control-root',type=Path,default=Path('.')); p.add_argument('--nexus-root',type=Path,required=True); p.add_argument('--node-root',type=Path,required=True); p.add_argument('--output',type=Path,required=True); a=p.parse_args()
    control=a.control_root.resolve(strict=True); nexus=a.nexus_root.resolve(strict=True); node=a.node_root.resolve(strict=True); out=a.output.resolve()
    cfile=require(control,CONTRACT.as_posix()); hfile=require(control,HANDOFF.as_posix()); raw=cfile.read_bytes(); c=json.loads(raw)
    if c.get('schema')!='xsp2-p0e-security-review-handoff-contract-4' or c.get('reviewVersion')!='v5-kvm-vps': fail('stale v5 contract')
    if c.get('reviewPackageFrozen') is not True or c.get('deploymentClass')!='kvm-vps': fail('v5 package is not frozen for kvm-vps')
    for key in ('independentSecurityReviewComplete','guestCrashConsistencyQualified','providerStorageDurabilityAssumed','physicalPowerLossQualified','productionActivation','strictPQEnabled'):
        if c.get(key) is not False: fail(f"contract unexpectedly claims {key}")
    nr=c['nexus']['sourceRevision']; dr=c['node']['sourceRevision']
    if git_head(nexus)!=nr or git_head(node)!=dr: fail('source checkout does not match v5 frozen runtime target')
    if out.exists(): shutil.rmtree(out)
    out.mkdir(parents=True)
    copy(cfile,out/'control'/CONTRACT.name); copy(hfile,out/'control'/HANDOFF.name)
    for rel in c['requiredSourceEvidence']:
        copy(require(nexus,rel),out/'evidence'/'runtime-nexus'/rel)
    for rel in c['requiredControlEvidence']:
        copy(require(control,rel),out/'evidence'/'post-runtime-control'/rel)
    source=out/'source'; source.mkdir(parents=True)
    archive(nexus,nr,source/f'XMesh-Nexus-{nr}.tar',f'XMesh-Nexus-{nr}')
    archive(node,dr,source/f'XMesh-Node-{dr}.tar',f'XMesh-Node-{dr}')
    scope=(
      '# XSP-v2 P0-E v5 KVM VPS review bundle\n\n'
      f'- Nexus runtime: `{nr}`\n- Node runtime: `{dr}`\n- deploymentClass: `kvm-vps`\n\n'
      'Runtime source is unchanged from v4. The material v5 delta is release-control policy: KVM guest crash-consistency qualification, provider-managed storage trust acceptance, and a KVM-specific strict-PQ approval path.\n\n'
      'Non-claims: independent review incomplete; guest crash qualification incomplete; physical power-loss qualification false; production activation false; strict-PQ disabled.\n'
    )
    (out/'REVIEW_SCOPE.md').write_text(scope,encoding='utf-8',newline='\n')
    files=sorted((x for x in out.rglob('*') if x.is_file()),key=lambda x:x.relative_to(out).as_posix())
    records=[{'path':x.relative_to(out).as_posix(),'sha256':digest_file(x),'size':x.stat().st_size} for x in files]
    sums=''.join(f"{r['sha256']}  {r['path']}\n" for r in records); (out/'SHA256SUMS').write_text(sums,encoding='utf-8',newline='\n')
    manifest={'schema':SCHEMA,'reviewVersion':'v5-kvm-vps','controlContractSha256':digest_bytes(raw),'nexus':c['nexus'],'node':c['node'],'deploymentClass':'kvm-vps','requiredReviewDomains':c['requiredReviewDomains'],'requiredExternalBlockers':c['requiredExternalBlockers'],'independentSecurityReviewComplete':False,'guestCrashConsistencyQualified':False,'providerStorageDurabilityAssumed':False,'physicalPowerLossQualified':False,'productionActivation':False,'strictPQEnabled':False,'payloadSha256':digest_bytes(sums.encode()),'files':records}
    (out/'MANIFEST.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n',encoding='utf-8',newline='\n')
    print(f"bundle={out}"); print(f"nexus={nr}"); print(f"node={dr}"); print(f"payloadSha256={manifest['payloadSha256']}"); print(f"files={len(records)}")
    return 0

if __name__=='__main__': sys.exit(main())
