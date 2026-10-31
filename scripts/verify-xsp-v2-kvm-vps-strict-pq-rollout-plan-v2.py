#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path
import re
import sys
from typing import Any, NoReturn

DEFAULT_CONTRACT = Path("deploy/xsp-v2-kvm-vps-strict-pq-rollout-plan-v2.contract.json")
MAX_JSON = 256 * 1024
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")

class ValidationError(ValueError): pass

def fail(message: str) -> NoReturn: raise ValidationError(message)

def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out={}
    for k,v in pairs:
        if k in out: fail(f"duplicate JSON field: {k}")
        out[k]=v
    return out

def load(path: Path, where: str) -> tuple[dict[str, Any], bytes]:
    raw=path.read_bytes()
    if not raw or len(raw)>MAX_JSON: fail(f"{where} size invalid")
    try: value=json.loads(raw,object_pairs_hook=unique_object)
    except json.JSONDecodeError as exc: fail(f"invalid {where}: {exc}")
    if not isinstance(value,dict): fail(f"{where} must be object")
    return value,raw

def exact(value: dict[str,Any], keys:set[str], where:str):
    if set(value)!=keys: fail(f"{where} key mismatch: missing={sorted(keys-set(value))}, unknown={sorted(set(value)-keys)}")

def text(v:Any,w:str)->str:
    if not isinstance(v,str) or not v.strip(): fail(f"{w} must be non-empty string")
    return v.strip()

def sha64(v:Any,w:str)->str:
    v=text(v,w)
    if not SHA64.fullmatch(v) or set(v)=={'0'}: fail(f"{w} must be nonzero lowercase SHA-256")
    return v

def sha40(v:Any,w:str)->str:
    v=text(v,w)
    if not SHA40.fullmatch(v): fail(f"{w} must be lowercase 40-hex")
    return v

def boolv(v:Any,w:str)->bool:
    if not isinstance(v,bool): fail(f"{w} must be boolean")
    return v

def timestamp(v:Any,w:str)->str:
    v=text(v,w); normalized=v[:-1]+"+00:00" if v.endswith('Z') else v
    try: p=datetime.fromisoformat(normalized)
    except ValueError as exc: fail(f"{w} invalid timestamp: {exc}")
    if p.tzinfo is None: fail(f"{w} must have timezone")
    return v

def validate(plan_path:Path,contract_path:Path)->dict[str,Any]:
    contract,_=load(contract_path,'contract'); plan,raw=load(plan_path,'plan')
    if contract.get('schema')!='xsp2-kvm-vps-strict-pq-rollout-plan-contract-2': fail('unsupported contract schema')
    exact(plan,{'schema','deploymentClass','releaseCandidate','evidence','scope','topology','transportPolicy','execution','rollback','review','claims'},'plan')
    if plan['schema']!=contract['planSchema'] or plan['deploymentClass']!='kvm-vps': fail('plan schema/deployment mismatch')
    candidate=plan['releaseCandidate']; exact(candidate,{'nexusRevision','nodeRevision','nexusImageSha256','agentArtifactSha256','finalCanaryResultSha256'},'plan.releaseCandidate')
    sha40(candidate['nexusRevision'],'candidate.nexusRevision');sha40(candidate['nodeRevision'],'candidate.nodeRevision')
    if {'nexusRevision':candidate['nexusRevision'],'nodeRevision':candidate['nodeRevision']}!=contract['requiredRuntimeTarget']: fail('release target mismatch')
    image=text(candidate['nexusImageSha256'],'candidate.nexusImageSha256')
    if not image.startswith('sha256:') or not SHA64.fullmatch(image[7:]): fail('candidate.nexusImageSha256 invalid')
    sha64(candidate['agentArtifactSha256'],'candidate.agentArtifactSha256');sha64(candidate['finalCanaryResultSha256'],'candidate.finalCanaryResultSha256')
    evidence=plan['evidence']; exact(evidence,{'aiAssistedSecurityReviewResultSha256','kvmVpsDurabilityResultSha256','durabilityCarryForwardSha256','providerStorageRiskAcceptanceSha256'},'plan.evidence')
    for k,v in evidence.items(): sha64(v,f'plan.evidence.{k}')
    if plan['scope']!=contract['requiredScope']: fail('plan scope must be limited to node-13')
    topology=plan['topology']; exact(topology,{'strictIngressDedicated','onlyStrictIngressPubliclyExposed','databaseHostPublished','redisHostPublished','runtimeEndpointMaterialProvisionedAtExecution','signerKeysProvisionedOutOfRepo','clientCertificateProvisionedOutOfRepo'},'plan.topology')
    required_topology={'strictIngressDedicated':True,'onlyStrictIngressPubliclyExposed':True,'databaseHostPublished':False,'redisHostPublished':False,'runtimeEndpointMaterialProvisionedAtExecution':True,'signerKeysProvisionedOutOfRepo':True,'clientCertificateProvisionedOutOfRepo':True}
    if topology!=required_topology: fail('production topology weakened')
    if plan['transportPolicy']!=contract['requiredTransportPolicy']: fail('transport policy weakened')
    if plan['execution']!=contract['requiredExecution']: fail('execution mapping changed')
    if plan['rollback']!=contract['requiredRollback']: fail('rollback/no-fallback policy changed')
    review=plan['review']; exact(review,{'reviewed','reviewedBy','reviewedAt','statement'},'plan.review')
    if boolv(review['reviewed'],'plan.review.reviewed') is not True: fail('rollout plan must be reviewed')
    text(review['reviewedBy'],'plan.review.reviewedBy');timestamp(review['reviewedAt'],'plan.review.reviewedAt');text(review['statement'],'plan.review.statement')
    if plan['claims']!=contract['requiredFalseClaimsBeforeExecution']: fail('pre-execution claims must remain false')
    return {'status':'kvm-vps-strict-pq-rollout-plan-reviewed','planSha256':hashlib.sha256(raw).hexdigest(),'rolloutPlanReviewed':True,'nodeCount':1,'strictPqAction':'enable','legacyXMESH1Action':'retain','automaticFallback':False,'productionActivation':False,'strictPQEnabled':False}

def main()->int:
    p=argparse.ArgumentParser();p.add_argument('--plan',required=True);p.add_argument('--contract',default=str(DEFAULT_CONTRACT));a=p.parse_args()
    try: out=validate(Path(a.plan),Path(a.contract))
    except (ValidationError,OSError) as exc:
        print(f"KVM strict-PQ rollout plan rejected: {exc}",file=sys.stderr);return 2
    print(json.dumps(out,sort_keys=True,separators=(',',':')));return 0

if __name__=='__main__': raise SystemExit(main())
