#!/usr/bin/env python3
"""Validate an explicit XSP-v2 strict-PQ production activation approval.

This tool is intentionally non-executing. It validates one bounded approval
artifact against exact release-candidate/evidence identities and emits whether
that artifact is eligible to authorize a later, separate execution step.
It never changes configuration, enables strict-PQ, retires XMESH1, contacts a
host, or claims that production activation has occurred.
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

DEFAULT_CONTRACT = Path("deploy/xsp-v2-strict-pq-activation-approval.contract.json")
MAX_JSON = 256 * 1024
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
NODE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
FQDN = re.compile(
    r"^(?=.{1,253}\.?$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}\.?$"
)
PRIVATE_MATERIAL = re.compile(
    r"-----BEGIN (?:ENCRYPTED |RSA |EC |OPENSSH )?PRIVATE KEY-----", re.IGNORECASE
)


class ValidationError(ValueError):
    pass


def fail(message: str) -> NoReturn:
    raise ValidationError(message)


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            fail(f"duplicate JSON field: {key}")
        out[key] = value
    return out


def load_json(path: Path, where: str) -> tuple[dict[str, Any], bytes]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        fail(f"cannot read {where}: {exc}")
    if not raw or len(raw) > MAX_JSON:
        fail(f"{where} size must be 1..{MAX_JSON} bytes")
    try:
        value = json.loads(raw, object_pairs_hook=unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"invalid JSON in {where}: {exc}")
    if not isinstance(value, dict):
        fail(f"{where} must be an object")
    return value, raw


def require_dict(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{where} must be an object")
    return value


def require_list(value: Any, where: str) -> list[Any]:
    if not isinstance(value, list):
        fail(f"{where} must be an array")
    return value


def exact_keys(value: dict[str, Any], expected: set[str], where: str) -> None:
    actual = set(value)
    missing = sorted(expected - actual)
    unknown = sorted(actual - expected)
    if missing or unknown:
        fail(f"{where} key mismatch: missing={missing}, unknown={unknown}")


def nonempty(value: Any, where: str, *, max_len: int = 4096) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{where} must be a non-empty string")
    text = value.strip()
    if len(text) > max_len:
        fail(f"{where} exceeds {max_len} characters")
    return text


def bool_value(value: Any, where: str) -> bool:
    if not isinstance(value, bool):
        fail(f"{where} must be boolean")
    return value


def sha40(value: Any, where: str) -> str:
    text = nonempty(value, where)
    if not SHA40.fullmatch(text):
        fail(f"{where} must be a lowercase 40-hex revision")
    return text


def sha64(value: Any, where: str) -> str:
    text = nonempty(value, where)
    if not SHA64.fullmatch(text):
        fail(f"{where} must be lowercase 64-hex SHA-256")
    return text


def sha256_prefixed(value: Any, where: str) -> str:
    text = nonempty(value, where)
    if not text.startswith("sha256:") or not SHA64.fullmatch(text[7:]):
        fail(f"{where} must be sha256:<64 lowercase hex>")
    return text


def parse_timestamp(value: Any, where: str) -> datetime:
    text = nonempty(value, where, max_len=64)
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        fail(f"{where} must be ISO-8601: {exc}")
    if parsed.tzinfo is None:
        fail(f"{where} must include timezone")
    return parsed.astimezone(timezone.utc)


def fqdn(value: Any, where: str) -> str:
    text = nonempty(value, where, max_len=253).lower().rstrip(".")
    if not FQDN.fullmatch(text):
        fail(f"{where} must be a DNS FQDN")
    return text


def port(value: Any, where: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 65535:
        fail(f"{where} must be integer 1..65535")
    return value


def optional_hash(value: Any, where: str, *, required: bool) -> str | None:
    if value is None:
        if required:
            fail(f"{where} is required when its evidence is accepted")
        return None
    if not required:
        fail(f"{where} must be null while its evidence is not accepted")
    return sha64(value, where)


def scan_for_forbidden_material(value: Any, contract: dict[str, Any], where: str = "approval") -> None:
    forbidden = {
        nonempty(item, "contract.forbiddenFieldNames[]", max_len=64).lower()
        for item in require_list(contract["forbiddenFieldNames"], "contract.forbiddenFieldNames")
    }
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in forbidden:
                fail(f"{where}.{key} is a forbidden field name")
            scan_for_forbidden_material(child, contract, f"{where}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            scan_for_forbidden_material(child, contract, f"{where}[{index}]")
    elif isinstance(value, str) and PRIVATE_MATERIAL.search(value):
        fail(f"{where} contains private key material")


def validate_contract(contract: dict[str, Any]) -> None:
    exact_keys(
        contract,
        {
            "schema",
            "approvalSchema",
            "verifierResultSchema",
            "allowedScopeModes",
            "maxNodesPerApproval",
            "maxApprovalWindowSeconds",
            "requiredApprovalAuthority",
            "requiredTransportPolicy",
            "requiredDecision",
            "requiredFalseClaimsBeforeExecution",
            "requiredEvidence",
            "forbiddenFieldNames",
        },
        "contract",
    )
    if contract["schema"] != "xsp2-strict-pq-activation-approval-contract-1":
        fail("unsupported contract schema")
    if contract["approvalSchema"] != "xsp2-strict-pq-activation-approval-1":
        fail("unsupported approval schema")
    if contract["verifierResultSchema"] != "xsp2-strict-pq-activation-approval-verifier-1":
        fail("unsupported verifier result schema")
    modes = require_list(contract["allowedScopeModes"], "contract.allowedScopeModes")
    if modes != ["limited-canary", "phased"]:
        fail("contract.allowedScopeModes must remain limited-canary, phased")
    max_nodes = contract["maxNodesPerApproval"]
    max_window = contract["maxApprovalWindowSeconds"]
    if max_nodes != 50:
        fail("contract.maxNodesPerApproval must remain exactly 50")
    if max_window != 86400:
        fail("contract.maxApprovalWindowSeconds must remain exactly 86400")
    if contract["requiredApprovalAuthority"] != "release-owner":
        fail("contract.requiredApprovalAuthority must remain release-owner")
    policy = require_dict(contract["requiredTransportPolicy"], "contract.requiredTransportPolicy")
    exact_keys(
        policy,
        {
            "tlsProtocols",
            "keyExchange",
            "clientIdentity",
            "criticalMessageSignatures",
            "automaticFallback",
            "classicalOnlyAllowed",
        },
        "contract.requiredTransportPolicy",
    )
    if policy != {
        "tlsProtocols": ["TLSv1.3"],
        "keyExchange": "X25519MLKEM768",
        "clientIdentity": "ML-DSA-65",
        "criticalMessageSignatures": ["Ed25519", "ML-DSA-65"],
        "automaticFallback": False,
        "classicalOnlyAllowed": False,
    }:
        fail("contract.requiredTransportPolicy was weakened")
    decision = require_dict(contract["requiredDecision"], "contract.requiredDecision")
    if decision != {"strictPqAction": "enable", "legacyXMESH1Action": "retain"}:
        fail("contract.requiredDecision was weakened")
    if contract["requiredFalseClaimsBeforeExecution"] != [
        "productionActivation",
        "strictPQEnabled",
        "legacyXMESH1Retired",
    ]:
        fail("contract.requiredFalseClaimsBeforeExecution changed")
    if contract["requiredEvidence"] != [
        "p0EComplete",
        "independentSecurityReviewAccepted",
        "physicalPowerQualificationAccepted",
        "finalCanaryPassed",
        "rolloutPlanEligible",
    ]:
        fail("contract.requiredEvidence changed")
    if contract["forbiddenFieldNames"] != [
        "command",
        "commands",
        "script",
        "scripts",
        "shell",
        "privateKey",
        "privateKeyPem",
        "secret",
        "secrets",
        "password",
        "token",
        "credential",
        "credentials",
        "url",
        "urls",
    ]:
        fail("contract.forbiddenFieldNames changed")


def validate_release_candidate(value: Any) -> dict[str, str]:
    candidate = require_dict(value, "approval.releaseCandidate")
    exact_keys(
        candidate,
        {
            "nexusRevision",
            "nodeRevision",
            "nexusImageSha256",
            "agentArtifactSha256",
            "finalCanaryResultSha256",
            "rolloutPlanSha256",
        },
        "approval.releaseCandidate",
    )
    return {
        "nexusRevision": sha40(candidate["nexusRevision"], "approval.releaseCandidate.nexusRevision"),
        "nodeRevision": sha40(candidate["nodeRevision"], "approval.releaseCandidate.nodeRevision"),
        "nexusImageSha256": sha256_prefixed(candidate["nexusImageSha256"], "approval.releaseCandidate.nexusImageSha256"),
        "agentArtifactSha256": sha64(candidate["agentArtifactSha256"], "approval.releaseCandidate.agentArtifactSha256"),
        "finalCanaryResultSha256": sha64(candidate["finalCanaryResultSha256"], "approval.releaseCandidate.finalCanaryResultSha256"),
        "rolloutPlanSha256": sha64(candidate["rolloutPlanSha256"], "approval.releaseCandidate.rolloutPlanSha256"),
    }


def validate_evidence(value: Any) -> dict[str, Any]:
    evidence = require_dict(value, "approval.evidence")
    exact_keys(
        evidence,
        {
            "p0EComplete",
            "independentSecurityReviewAccepted",
            "independentSecurityReviewResultSha256",
            "physicalPowerQualificationAccepted",
            "physicalPowerQualificationResultSha256",
            "finalCanaryPassed",
            "rolloutPlanEligible",
            "rolloutPlanVerifierResultSha256",
        },
        "approval.evidence",
    )
    p0e = bool_value(evidence["p0EComplete"], "approval.evidence.p0EComplete")
    review = bool_value(
        evidence["independentSecurityReviewAccepted"],
        "approval.evidence.independentSecurityReviewAccepted",
    )
    power = bool_value(
        evidence["physicalPowerQualificationAccepted"],
        "approval.evidence.physicalPowerQualificationAccepted",
    )
    canary = bool_value(evidence["finalCanaryPassed"], "approval.evidence.finalCanaryPassed")
    rollout = bool_value(evidence["rolloutPlanEligible"], "approval.evidence.rolloutPlanEligible")
    review_hash = optional_hash(
        evidence["independentSecurityReviewResultSha256"],
        "approval.evidence.independentSecurityReviewResultSha256",
        required=review,
    )
    power_hash = optional_hash(
        evidence["physicalPowerQualificationResultSha256"],
        "approval.evidence.physicalPowerQualificationResultSha256",
        required=power,
    )
    rollout_hash = optional_hash(
        evidence["rolloutPlanVerifierResultSha256"],
        "approval.evidence.rolloutPlanVerifierResultSha256",
        required=rollout,
    )
    if p0e and not (review and power):
        fail("p0EComplete=true requires accepted security review and physical qualification")
    if canary and not p0e:
        fail("finalCanaryPassed=true requires p0EComplete=true")
    if rollout and not canary:
        fail("rolloutPlanEligible=true requires finalCanaryPassed=true")
    return {
        "p0EComplete": p0e,
        "independentSecurityReviewAccepted": review,
        "independentSecurityReviewResultSha256": review_hash,
        "physicalPowerQualificationAccepted": power,
        "physicalPowerQualificationResultSha256": power_hash,
        "finalCanaryPassed": canary,
        "rolloutPlanEligible": rollout,
        "rolloutPlanVerifierResultSha256": rollout_hash,
    }


def validate_scope(value: Any, contract: dict[str, Any]) -> dict[str, Any]:
    scope = require_dict(value, "approval.scope")
    exact_keys(
        scope,
        {"mode", "rolloutId", "nodeIds", "panelFqdn", "xspIngressFqdn", "xspIngressPort"},
        "approval.scope",
    )
    mode = nonempty(scope["mode"], "approval.scope.mode", max_len=32)
    if mode not in contract["allowedScopeModes"]:
        fail(f"approval.scope.mode is not allowed: {mode}")
    rollout_id = nonempty(scope["rolloutId"], "approval.scope.rolloutId", max_len=128)
    if not TOKEN.fullmatch(rollout_id):
        fail("approval.scope.rolloutId has invalid characters")
    rows = require_list(scope["nodeIds"], "approval.scope.nodeIds")
    if not rows:
        fail("approval.scope.nodeIds must not be empty")
    if len(rows) > contract["maxNodesPerApproval"]:
        fail("approval.scope.nodeIds exceeds maxNodesPerApproval")
    node_ids: list[str] = []
    for index, raw in enumerate(rows):
        node_id = nonempty(raw, f"approval.scope.nodeIds[{index}]", max_len=128)
        if not NODE_ID.fullmatch(node_id) or "*" in node_id:
            fail(f"invalid node id in activation scope: {node_id}")
        node_ids.append(node_id)
    if len(node_ids) != len(set(node_ids)):
        fail("approval.scope.nodeIds contains duplicates")
    return {
        "mode": mode,
        "rolloutId": rollout_id,
        "nodeIds": node_ids,
        "panelFqdn": fqdn(scope["panelFqdn"], "approval.scope.panelFqdn"),
        "xspIngressFqdn": fqdn(scope["xspIngressFqdn"], "approval.scope.xspIngressFqdn"),
        "xspIngressPort": port(scope["xspIngressPort"], "approval.scope.xspIngressPort"),
    }


def validate_policy(value: Any, contract: dict[str, Any]) -> dict[str, Any]:
    policy = require_dict(value, "approval.policy")
    exact_keys(
        policy,
        {
            "tlsProtocols",
            "keyExchange",
            "clientIdentity",
            "criticalMessageSignatures",
            "automaticFallback",
            "classicalOnlyAllowed",
            "strictPqAction",
            "legacyXMESH1Action",
        },
        "approval.policy",
    )
    required_transport = contract["requiredTransportPolicy"]
    for field in (
        "tlsProtocols",
        "keyExchange",
        "clientIdentity",
        "criticalMessageSignatures",
        "automaticFallback",
        "classicalOnlyAllowed",
    ):
        if policy[field] != required_transport[field]:
            fail(f"approval.policy.{field} does not match mandatory strict-PQ policy")
    required_decision = contract["requiredDecision"]
    if policy["strictPqAction"] != required_decision["strictPqAction"]:
        fail("approval.policy.strictPqAction must be enable")
    if policy["legacyXMESH1Action"] != required_decision["legacyXMESH1Action"]:
        fail("approval.policy.legacyXMESH1Action must remain retain in this gate")
    return policy


def validate_approval_record(value: Any, contract: dict[str, Any]) -> dict[str, Any]:
    record = require_dict(value, "approval.approval")
    exact_keys(
        record,
        {"approver", "authority", "approved", "approvedAt", "approvalRecordSha256", "rationale"},
        "approval.approval",
    )
    approver = nonempty(record["approver"], "approval.approval.approver", max_len=200)
    authority = nonempty(record["authority"], "approval.approval.authority", max_len=64)
    if authority != contract["requiredApprovalAuthority"]:
        fail("approval.approval.authority must be release-owner")
    approved = bool_value(record["approved"], "approval.approval.approved")
    if approved:
        if record["approvedAt"] is None:
            fail("approval.approval.approvedAt is required when approved=true")
        approved_at = parse_timestamp(record["approvedAt"], "approval.approval.approvedAt")
        approval_hash = optional_hash(
            record["approvalRecordSha256"],
            "approval.approval.approvalRecordSha256",
            required=True,
        )
    else:
        if record["approvedAt"] is not None:
            fail("approval.approval.approvedAt must be null when approved=false")
        approved_at = None
        approval_hash = optional_hash(
            record["approvalRecordSha256"],
            "approval.approval.approvalRecordSha256",
            required=False,
        )
    rationale = nonempty(record["rationale"], "approval.approval.rationale", max_len=2000)
    return {
        "approver": approver,
        "authority": authority,
        "approved": approved,
        "approvedAt": approved_at,
        "approvalRecordSha256": approval_hash,
        "rationale": rationale,
    }


def validate_claims(value: Any, contract: dict[str, Any]) -> None:
    claims = require_dict(value, "approval.claims")
    exact_keys(
        claims,
        {"productionActivation", "strictPQEnabled", "legacyXMESH1Retired"},
        "approval.claims",
    )
    for name in contract["requiredFalseClaimsBeforeExecution"]:
        if bool_value(claims[name], f"approval.claims.{name}") is not False:
            fail(f"approval.claims.{name} must remain false before separate execution")


def expect_equal(actual: str, expected: str | None, where: str) -> None:
    if expected is not None and actual != expected:
        fail(f"{where} does not match expected exact candidate")


def validate(
    approval: dict[str, Any],
    raw: bytes,
    contract: dict[str, Any],
    args: argparse.Namespace,
) -> dict[str, Any]:
    exact_keys(
        approval,
        {
            "schema",
            "decisionId",
            "createdAt",
            "expiresAt",
            "releaseCandidate",
            "evidence",
            "scope",
            "policy",
            "approval",
            "claims",
        },
        "approval",
    )
    if approval["schema"] != contract["approvalSchema"]:
        fail("approval.schema does not match contract")
    decision_id = nonempty(approval["decisionId"], "approval.decisionId", max_len=128)
    if not TOKEN.fullmatch(decision_id):
        fail("approval.decisionId has invalid characters")
    created_at = parse_timestamp(approval["createdAt"], "approval.createdAt")
    expires_at = parse_timestamp(approval["expiresAt"], "approval.expiresAt")
    if expires_at <= created_at:
        fail("approval.expiresAt must be after createdAt")
    window_seconds = int((expires_at - created_at).total_seconds())
    if window_seconds > contract["maxApprovalWindowSeconds"]:
        fail("approval window exceeds contract.maxApprovalWindowSeconds")

    scan_for_forbidden_material(approval, contract)
    candidate = validate_release_candidate(approval["releaseCandidate"])
    evidence = validate_evidence(approval["evidence"])
    scope = validate_scope(approval["scope"], contract)
    validate_policy(approval["policy"], contract)
    approval_record = validate_approval_record(approval["approval"], contract)
    validate_claims(approval["claims"], contract)

    if approval_record["approvedAt"] is not None:
        approved_at = approval_record["approvedAt"]
        if approved_at < created_at or approved_at > expires_at:
            fail("approval.approval.approvedAt must fall within the approval window")

    expect_equal(candidate["nexusRevision"], args.expected_nexus_revision, "releaseCandidate.nexusRevision")
    expect_equal(candidate["nodeRevision"], args.expected_node_revision, "releaseCandidate.nodeRevision")
    expect_equal(candidate["nexusImageSha256"], args.expected_nexus_image_sha256, "releaseCandidate.nexusImageSha256")
    expect_equal(candidate["agentArtifactSha256"], args.expected_agent_artifact_sha256, "releaseCandidate.agentArtifactSha256")
    expect_equal(candidate["finalCanaryResultSha256"], args.expected_final_canary_sha256, "releaseCandidate.finalCanaryResultSha256")
    expect_equal(candidate["rolloutPlanSha256"], args.expected_rollout_plan_sha256, "releaseCandidate.rolloutPlanSha256")

    evidence_ready = all(
        evidence[name]
        for name in (
            "p0EComplete",
            "independentSecurityReviewAccepted",
            "physicalPowerQualificationAccepted",
            "finalCanaryPassed",
            "rolloutPlanEligible",
        )
    )
    approved = approval_record["approved"]

    now = parse_timestamp(args.now, "--now") if args.now is not None else datetime.now(timezone.utc)
    within_window = created_at <= now <= expires_at
    eligible = evidence_ready and approved and within_window

    if args.require_eligible:
        missing_expected = [
            name
            for name, value in (
                ("--expected-nexus-revision", args.expected_nexus_revision),
                ("--expected-node-revision", args.expected_node_revision),
                ("--expected-nexus-image-sha256", args.expected_nexus_image_sha256),
                ("--expected-agent-artifact-sha256", args.expected_agent_artifact_sha256),
                ("--expected-final-canary-sha256", args.expected_final_canary_sha256),
                ("--expected-rollout-plan-sha256", args.expected_rollout_plan_sha256),
            )
            if value is None
        ]
        if missing_expected:
            fail(f"--require-eligible requires exact expected candidate arguments: {', '.join(missing_expected)}")
        if not evidence_ready:
            fail("activation approval is not eligible: required release evidence is incomplete")
        if not approved:
            fail("activation approval is not eligible: explicit release-owner approval is absent")
        if not within_window:
            fail("activation approval is not eligible: approval window is not current")

    return {
        "schema": contract["verifierResultSchema"],
        "approvalSha256": hashlib.sha256(raw).hexdigest(),
        "decisionId": decision_id,
        "releaseCandidate": candidate,
        "scope": {
            "mode": scope["mode"],
            "rolloutId": scope["rolloutId"],
            "nodeCount": len(scope["nodeIds"]),
            "nodeIds": scope["nodeIds"],
            "panelFqdn": scope["panelFqdn"],
            "xspIngressFqdn": scope["xspIngressFqdn"],
            "xspIngressPort": scope["xspIngressPort"],
        },
        "evidenceReady": evidence_ready,
        "releaseOwnerApproved": approved,
        "approvalWindowCurrent": within_window,
        "activationApprovalEligible": eligible,
        "strictPQEnabled": False,
        "productionActivation": False,
        "legacyXMESH1Retired": False,
        "requiresSeparateExecution": True,
        "requiresSeparateXMESH1RetirementDecision": True,
    }


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--approval", required=True, type=Path)
    p.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    p.add_argument("--require-eligible", action="store_true")
    p.add_argument("--expected-nexus-revision")
    p.add_argument("--expected-node-revision")
    p.add_argument("--expected-nexus-image-sha256")
    p.add_argument("--expected-agent-artifact-sha256")
    p.add_argument("--expected-final-canary-sha256")
    p.add_argument("--expected-rollout-plan-sha256")
    p.add_argument("--now", help="ISO-8601 verification time; defaults to current UTC")
    return p


def main() -> int:
    args = parser().parse_args()
    try:
        contract, _ = load_json(args.contract, "contract")
        validate_contract(contract)
        approval, raw = load_json(args.approval, "approval")
        result = validate(approval, raw, contract, args)
    except ValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
