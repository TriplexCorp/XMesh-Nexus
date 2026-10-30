#!/usr/bin/env python3
"""Validate a bounded KVM-VPS strict-PQ activation approval.

This verifier never enables strict-PQ or contacts a host. It validates that a
later execution would be authorized only for the KVM deployment class and only
after the KVM-specific durability evidence and remaining release evidence exist.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any, NoReturn

DEFAULT_CONTRACT = Path("deploy/xsp-v2-kvm-vps-strict-pq-activation-approval.contract.json")
MAX_JSON = 256 * 1024
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
NODE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class ValidationError(ValueError):
    pass


def fail(message: str) -> NoReturn:
    raise ValidationError(message)


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out: fail(f"duplicate JSON field: {key}")
        out[key] = value
    return out


def load(path: Path, where: str) -> tuple[dict[str, Any], bytes]:
    raw = path.read_bytes()
    if not raw or len(raw) > MAX_JSON: fail(f"{where} size must be 1..{MAX_JSON} bytes")
    try: value = json.loads(raw, object_pairs_hook=unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc: fail(f"invalid JSON in {where}: {exc}")
    if not isinstance(value, dict): fail(f"{where} must be an object")
    return value, raw


def exact(value: dict[str, Any], keys: set[str], where: str) -> None:
    if set(value) != keys: fail(f"{where} key mismatch: missing={sorted(keys-set(value))}, unknown={sorted(set(value)-keys)}")


def nonempty(value: Any, where: str, max_len: int = 4096) -> str:
    if not isinstance(value, str) or not value.strip(): fail(f"{where} must be a non-empty string")
    text=value.strip()
    if len(text)>max_len: fail(f"{where} too long")
    return text


def sha(value: Any, where: str, width: int=64) -> str:
    text=nonempty(value,where,width)
    pattern=SHA64 if width==64 else SHA40
    if not pattern.fullmatch(text) or set(text)=={"0"}: fail(f"{where} must be non-zero lowercase {width}-hex")
    return text


def boolean(value: Any, where: str) -> bool:
    if not isinstance(value,bool): fail(f"{where} must be boolean")
    return value


def parse_time(value: Any, where: str) -> datetime:
    text=nonempty(value,where,64); normalized=text[:-1]+"+00:00" if text.endswith("Z") else text
    try: parsed=datetime.fromisoformat(normalized)
    except ValueError as exc: fail(f"{where} must be ISO-8601: {exc}")
    if parsed.tzinfo is None: fail(f"{where} must include timezone")
    return parsed.astimezone(timezone.utc)


def validate(approval_path: Path, contract_path: Path) -> dict[str, Any]:
    contract,_=load(contract_path,"contract")
    approval,raw=load(approval_path,"approval")
    if contract.get("schema")!="xsp2-kvm-vps-strict-pq-activation-approval-contract-1": fail("unsupported contract schema")
    exact(approval,{"schema","deploymentClass","releaseCandidate","evidence","scope","transportPolicy","decision","approval","claims"},"approval")
    if approval["schema"]!=contract["approvalSchema"]: fail("unsupported approval schema")
    if approval["deploymentClass"]!="kvm-vps": fail("approval is not for deploymentClass=kvm-vps")

    candidate=approval["releaseCandidate"]
    if not isinstance(candidate,dict): fail("approval.releaseCandidate must be an object")
    exact(candidate,{"nexusRuntimeRevision","nodeRevision","nexusImageSha256","agentArtifactSha256"},"approval.releaseCandidate")
    sha(candidate["nexusRuntimeRevision"],"approval.releaseCandidate.nexusRuntimeRevision",40)
    sha(candidate["nodeRevision"],"approval.releaseCandidate.nodeRevision",40)
    if {"nexusRuntimeRevision":candidate["nexusRuntimeRevision"],"nodeRevision":candidate["nodeRevision"]}!=contract["requiredRuntimeTarget"]:
        fail("release candidate runtime target differs from qualified KVM target")
    image=nonempty(candidate["nexusImageSha256"],"approval.releaseCandidate.nexusImageSha256",71)
    if not image.startswith("sha256:") or not SHA64.fullmatch(image[7:]): fail("nexusImageSha256 must be sha256:<64 hex>")
    sha(candidate["agentArtifactSha256"],"approval.releaseCandidate.agentArtifactSha256")

    evidence=approval["evidence"]
    if not isinstance(evidence,dict): fail("approval.evidence must be an object")
    exact(evidence,{
        "independentSecurityReviewAccepted","independentSecurityReviewResultSha256",
        "kvmVpsDurabilityQualificationAccepted","kvmVpsDurabilityResultSha256",
        "providerStorageRiskAccepted","finalCanaryPassed","finalCanaryResultSha256",
        "rolloutPlanReviewed","rolloutPlanSha256","rolloutPlanReviewSha256"
    },"approval.evidence")
    required_bools=(
        "independentSecurityReviewAccepted","kvmVpsDurabilityQualificationAccepted",
        "providerStorageRiskAccepted","finalCanaryPassed","rolloutPlanReviewed"
    )
    for field in required_bools:
        if boolean(evidence[field],f"approval.evidence.{field}") is not True: fail(f"approval.evidence.{field} must be true")
    for field in ("independentSecurityReviewResultSha256","kvmVpsDurabilityResultSha256","finalCanaryResultSha256","rolloutPlanSha256","rolloutPlanReviewSha256"):
        sha(evidence[field],f"approval.evidence.{field}")

    scope=approval["scope"]
    if not isinstance(scope,dict): fail("approval.scope must be an object")
    exact(scope,{"mode","nodes","validFrom","validUntil"},"approval.scope")
    if scope["mode"] not in contract["allowedScopeModes"]: fail("unsupported approval scope mode")
    nodes=scope["nodes"]
    if not isinstance(nodes,list) or not 1<=len(nodes)<=contract["maxNodesPerApproval"]: fail("approval.scope.nodes must contain 1..50 named Nodes")
    seen=set()
    for i,node in enumerate(nodes):
        text=nonempty(node,f"approval.scope.nodes[{i}]",128)
        if not NODE_ID.fullmatch(text) or text in seen: fail("Node scope must contain unique bounded identifiers")
        seen.add(text)
    start=parse_time(scope["validFrom"],"approval.scope.validFrom"); end=parse_time(scope["validUntil"],"approval.scope.validUntil")
    seconds=(end-start).total_seconds()
    if seconds<=0 or seconds>contract["maxApprovalWindowSeconds"]: fail("approval window must be >0 and <=24h")

    policy=approval["transportPolicy"]
    if policy!=contract["requiredTransportPolicy"]: fail("required strict-PQ transport policy was weakened")
    if approval["decision"]!=contract["requiredDecision"]: fail("required strict-PQ/XMESH1 decision changed")

    auth=approval["approval"]
    if not isinstance(auth,dict): fail("approval.approval must be an object")
    exact(auth,{"authority","approvedBy","approvedAt","statement"},"approval.approval")
    if auth["authority"]!=contract["requiredApprovalAuthority"]: fail("wrong approval authority")
    nonempty(auth["approvedBy"],"approval.approval.approvedBy",128)
    approved_at=parse_time(auth["approvedAt"],"approval.approval.approvedAt")
    if approved_at<start or approved_at>end: fail("approval timestamp must fall inside approval window")
    nonempty(auth["statement"],"approval.approval.statement",2048)

    claims=approval["claims"]
    if claims!=contract["requiredFalseClaimsBeforeExecution"]: fail("pre-execution claims must remain false, including physicalPowerLossQualified")

    return {
        "status":"kvm-vps-strict-pq-approval-eligible",
        "deploymentClass":"kvm-vps",
        "approvalSha256":hashlib.sha256(raw).hexdigest(),
        "nodeCount":len(nodes),
        "validWindowSeconds":int(seconds),
        "strictPqAction":"enable",
        "legacyXMESH1Action":"retain",
        "physicalPowerLossQualified":False,
        "productionActivation":False,
        "strictPQEnabled":False,
        "legacyXMESH1Retired":False,
        "requiresSeparateExecution":True,
    }


def main() -> int:
    p=argparse.ArgumentParser(); p.add_argument("--approval",required=True); p.add_argument("--contract",default=str(DEFAULT_CONTRACT)); args=p.parse_args()
    try: out=validate(Path(args.approval),Path(args.contract))
    except (ValidationError,OSError) as exc:
        print(f"KVM VPS strict-PQ approval rejected: {exc}",file=sys.stderr); return 2
    print(json.dumps(out,sort_keys=True,separators=(",",":"))); return 0

if __name__=="__main__": raise SystemExit(main())
