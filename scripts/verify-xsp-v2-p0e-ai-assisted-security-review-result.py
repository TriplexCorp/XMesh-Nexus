#!/usr/bin/env python3
"""Validate the AI-assisted P0-E security review plus release-owner risk acceptance.

This verifier deliberately does NOT claim organizational independence. It binds a
complete internal review to the frozen runtime target and v5 review bundle, and
requires explicit release-owner acceptance of the reduced assurance model before
issue #137 can be considered closure-eligible under the replacement policy.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any, NoReturn

DEFAULT_CONTRACT = Path("deploy/xsp-v2-p0e-ai-assisted-security-review-result.contract.json")
MAX_JSON = 512 * 1024
HEX64 = re.compile(r"^[0-9a-f]{64}$")


class ValidationError(ValueError):
    pass


def fail(message: str) -> NoReturn:
    raise ValidationError(message)


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
    if actual != expected:
        fail(f"{where} key mismatch: missing={sorted(expected-actual)}, unknown={sorted(actual-expected)}")


def nonempty(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{where} must be a non-empty string")
    return value.strip()


def bool_value(value: Any, where: str) -> bool:
    if not isinstance(value, bool):
        fail(f"{where} must be boolean")
    return value


def parse_date(value: Any, where: str) -> str:
    text = nonempty(value, where)
    try:
        date.fromisoformat(text)
    except ValueError as exc:
        fail(f"{where} must be ISO YYYY-MM-DD: {exc}")
    return text


def parse_time(value: Any, where: str) -> str:
    text = nonempty(value, where)
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        fail(f"{where} must be ISO-8601: {exc}")
    if parsed.tzinfo is None:
        fail(f"{where} must include timezone")
    return text


def sha64(value: Any, where: str) -> str:
    text = nonempty(value, where)
    if not HEX64.fullmatch(text):
        fail(f"{where} must be lowercase 64-hex SHA-256")
    return text


def load(path: Path, where: str) -> tuple[dict[str, Any], bytes]:
    raw = path.read_bytes()
    if not raw or len(raw) > MAX_JSON:
        fail(f"{where} size must be 1..{MAX_JSON}")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"invalid {where}: {exc}")
    return require_dict(value, where), raw


def validate(result: dict[str, Any], contract: dict[str, Any], raw: bytes) -> dict[str, Any]:
    exact_keys(result, {
        "schema", "assuranceModel", "target", "reviewBundle", "reviewer",
        "reviewDate", "reviewDomains", "findings", "signoff",
        "releaseOwnerRiskAcceptance", "claims"
    }, "result")
    if result["schema"] != contract["resultSchema"]:
        fail("result.schema mismatch")
    if result["assuranceModel"] != contract["assuranceModel"]:
        fail("result.assuranceModel mismatch")

    target = require_dict(result["target"], "result.target")
    if target != contract["frozenTarget"]:
        fail("result.target does not match frozen target")
    bundle = require_dict(result["reviewBundle"], "result.reviewBundle")
    if bundle != contract["reviewBundle"]:
        fail("result.reviewBundle does not match authoritative v5 bundle")

    reviewer = require_dict(result["reviewer"], "result.reviewer")
    exact_keys(reviewer, {"name", "role", "independent"}, "result.reviewer")
    nonempty(reviewer["name"], "result.reviewer.name")
    nonempty(reviewer["role"], "result.reviewer.role")
    if reviewer["independent"] is not False:
        fail("result.reviewer.independent must be false; do not misrepresent this review as external/independent")
    parse_date(result["reviewDate"], "result.reviewDate")

    expected_domains = list(contract["requiredReviewDomains"])
    allowed_dispositions = set(contract["domainDispositions"])
    rows = require_list(result["reviewDomains"], "result.reviewDomains")
    if len(rows) != len(expected_domains):
        fail(f"result.reviewDomains must contain exactly {len(expected_domains)} domains")
    dispositions: dict[str, str] = {}
    for i, raw_row in enumerate(rows):
        row = require_dict(raw_row, f"result.reviewDomains[{i}]")
        exact_keys(row, {"domain", "disposition", "summary", "evidence"}, f"result.reviewDomains[{i}]")
        domain = nonempty(row["domain"], f"result.reviewDomains[{i}].domain")
        if domain not in expected_domains or domain in dispositions:
            fail(f"unknown or duplicate review domain: {domain}")
        disposition = nonempty(row["disposition"], f"result.reviewDomains[{i}].disposition")
        if disposition not in allowed_dispositions:
            fail(f"unsupported disposition for {domain}: {disposition}")
        nonempty(row["summary"], f"result.reviewDomains[{i}].summary")
        evidence = require_list(row["evidence"], f"result.reviewDomains[{i}].evidence")
        if not evidence:
            fail(f"result.reviewDomains[{i}].evidence must not be empty")
        for j, item in enumerate(evidence):
            nonempty(item, f"result.reviewDomains[{i}].evidence[{j}]")
        dispositions[domain] = disposition
    if set(dispositions) != set(expected_domains):
        fail("review domains do not exactly match contract")

    allowed_severities = set(contract["findingSeverities"])
    allowed_statuses = set(contract["findingStatuses"])
    findings = require_list(result["findings"], "result.findings")
    seen: set[str] = set()
    unresolved_blocker = False
    requires_refreeze = False
    for i, raw_finding in enumerate(findings):
        f = require_dict(raw_finding, f"result.findings[{i}]")
        exact_keys(f, {
            "id", "severity", "status", "releaseBlocking", "securityRelevantCodeChange",
            "title", "domains", "evidence", "disposition"
        }, f"result.findings[{i}]")
        ident = nonempty(f["id"], f"result.findings[{i}].id")
        if ident in seen or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", ident):
            fail(f"invalid or duplicate finding id: {ident}")
        seen.add(ident)
        if f["severity"] not in allowed_severities:
            fail(f"unsupported severity for {ident}")
        if f["status"] not in allowed_statuses:
            fail(f"unsupported status for {ident}")
        release_blocking = bool_value(f["releaseBlocking"], f"result.findings[{i}].releaseBlocking")
        code_change = bool_value(f["securityRelevantCodeChange"], f"result.findings[{i}].securityRelevantCodeChange")
        nonempty(f["title"], f"result.findings[{i}].title")
        domains = require_list(f["domains"], f"result.findings[{i}].domains")
        if not domains or any(nonempty(d, "finding domain") not in expected_domains for d in domains):
            fail(f"finding {ident} references invalid domains")
        evidence = require_list(f["evidence"], f"result.findings[{i}].evidence")
        if not evidence:
            fail(f"finding {ident} must include evidence")
        for item in evidence:
            nonempty(item, f"finding {ident} evidence")
        nonempty(f["disposition"], f"result.findings[{i}].disposition")
        if release_blocking and f["status"] != "remediated":
            unresolved_blocker = True
        if code_change:
            requires_refreeze = True

    signoff = require_dict(result["signoff"], "result.signoff")
    exact_keys(signoff, {"decision", "statement", "signedAt"}, "result.signoff")
    decision = nonempty(signoff["decision"], "result.signoff.decision")
    if decision not in contract["signoffDecisions"]:
        fail("unsupported signoff decision")
    nonempty(signoff["statement"], "result.signoff.statement")
    parse_time(signoff["signedAt"], "result.signoff.signedAt")

    acceptance = require_dict(result["releaseOwnerRiskAcceptance"], "result.releaseOwnerRiskAcceptance")
    exact_keys(acceptance, {"accepted", "acceptedBy", "acceptedAt", "statement"}, "result.releaseOwnerRiskAcceptance")
    accepted = bool_value(acceptance["accepted"], "result.releaseOwnerRiskAcceptance.accepted")
    nonempty(acceptance["acceptedBy"], "result.releaseOwnerRiskAcceptance.acceptedBy")
    parse_time(acceptance["acceptedAt"], "result.releaseOwnerRiskAcceptance.acceptedAt")
    nonempty(acceptance["statement"], "result.releaseOwnerRiskAcceptance.statement")

    claims = require_dict(result["claims"], "result.claims")
    exact_keys(claims, set(contract["requiredFalseClaims"]), "result.claims")
    for key in contract["requiredFalseClaims"]:
        if claims[key] is not False:
            fail(f"result.claims.{key} must be false")

    reasons: list[str] = []
    policy = contract["closurePolicy"]
    if decision not in policy["eligibleDecisions"]:
        reasons.append(f"decision {decision!r} is not closure-eligible")
    if policy["allDomainsMustAvoidFail"]:
        failed = sorted(k for k, v in dispositions.items() if v == "fail")
        if failed:
            reasons.append(f"failed domains: {failed}")
    if policy["releaseBlockingFindingsMustBeRemediated"] and unresolved_blocker:
        reasons.append("unresolved release-blocking finding exists")
    if policy["securityRelevantCodeChangeRequiresRefreeze"] and requires_refreeze:
        reasons.append("review result records a security-relevant code change after this frozen target; refreeze required")
    if policy["releaseOwnerRiskAcceptanceRequired"] and not accepted:
        reasons.append("release-owner risk acceptance is required")

    return {
        "schema": "xsp2-p0e-ai-assisted-security-review-verification-1",
        "validReviewResult": True,
        "closureEligible": not reasons,
        "closureIneligibilityReasons": reasons,
        "assuranceModel": contract["assuranceModel"],
        "externalIndependentReviewRequired": False,
        "reviewerIndependent": False,
        "decision": decision,
        "reviewedDomainCount": len(dispositions),
        "findingCount": len(findings),
        "releaseOwnerRiskAccepted": accepted,
        "requiresRefreeze": requires_refreeze,
        "resultSha256": hashlib.sha256(raw).hexdigest(),
        "target": target,
        "physicalPowerLossQualified": False,
        "productionActivation": False,
        "strictPQEnabled": False
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--result", type=Path, required=True)
    p.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    p.add_argument("--require-closure-eligible", action="store_true")
    args = p.parse_args()
    try:
        contract, _ = load(args.contract, "contract")
        if contract.get("schema") != "xsp2-p0e-ai-assisted-security-review-result-contract-1":
            fail("unsupported contract schema")
        result, raw = load(args.result, "result")
        out = validate(result, contract, raw)
    except (ValidationError, OSError) as exc:
        print(json.dumps({"validReviewResult": False, "error": str(exc)}, sort_keys=True))
        return 1
    print(json.dumps(out, sort_keys=True, separators=(",", ":")))
    if args.require_closure_eligible and not out["closureEligible"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
