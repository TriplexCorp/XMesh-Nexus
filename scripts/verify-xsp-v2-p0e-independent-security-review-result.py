#!/usr/bin/env python3
"""Validate an attributable independent P0-E security-review result.

The verifier checks result completeness and binding to the already-frozen
Nexus/Node revisions. A structurally valid rejection is still a valid review
result; use --require-closure-eligible when checking whether the result can
satisfy the repo-side issue #137 sign-off gate.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime
import json
from pathlib import Path
import re
import sys
from typing import Any, NoReturn

DEFAULT_CONTRACT = Path("deploy/xsp-v2-p0e-independent-security-review-result.contract.json")


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
    missing = sorted(expected - actual)
    unknown = sorted(actual - expected)
    if missing or unknown:
        fail(f"{where} key mismatch: missing={missing}, unknown={unknown}")


def nonempty_string(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{where} must be a non-empty string")
    return value.strip()


def string_list(value: Any, where: str, *, nonempty: bool = True) -> list[str]:
    items = require_list(value, where)
    if nonempty and not items:
        fail(f"{where} must not be empty")
    result: list[str] = []
    for index, item in enumerate(items):
        result.append(nonempty_string(item, f"{where}[{index}]"))
    if len(result) != len(set(result)):
        fail(f"{where} must not contain duplicates")
    return result


def parse_date(value: Any, where: str) -> str:
    text = nonempty_string(value, where)
    try:
        date.fromisoformat(text)
    except ValueError as exc:
        fail(f"{where} must be ISO YYYY-MM-DD: {exc}")
    return text


def parse_timestamp(value: Any, where: str) -> str:
    text = nonempty_string(value, where)
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        fail(f"{where} must be an ISO-8601 timestamp: {exc}")
    if parsed.tzinfo is None:
        fail(f"{where} must include an explicit timezone")
    return text


def load_json(path: Path, where: str) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read {where}: {exc}")
    return require_dict(data, where)


def validate_target(result: dict[str, Any], contract: dict[str, Any]) -> None:
    target = require_dict(result["target"], "result.target")
    exact_keys(target, {"nexus", "node"}, "result.target")
    for side in ("nexus", "node"):
        actual = require_dict(target[side], f"result.target.{side}")
        expected = require_dict(contract["frozenTarget"][side], f"contract.frozenTarget.{side}")
        exact_keys(actual, {"repository", "sourceRevision"}, f"result.target.{side}")
        if actual != expected:
            fail(
                f"result.target.{side} does not match frozen target: "
                f"expected={expected!r}, actual={actual!r}"
            )


def validate_reviewer(result: dict[str, Any]) -> None:
    reviewer = require_dict(result["reviewer"], "result.reviewer")
    exact_keys(reviewer, {"name", "organization", "independent"}, "result.reviewer")
    nonempty_string(reviewer["name"], "result.reviewer.name")
    nonempty_string(reviewer["organization"], "result.reviewer.organization")
    if reviewer["independent"] is not True:
        fail("result.reviewer.independent must be true")
    parse_date(result["reviewDate"], "result.reviewDate")


def validate_domains(result: dict[str, Any], contract: dict[str, Any]) -> dict[str, str]:
    expected_domains = string_list(
        contract["requiredReviewDomains"], "contract.requiredReviewDomains"
    )
    allowed_dispositions = set(
        string_list(contract["domainDispositions"], "contract.domainDispositions")
    )
    rows = require_list(result["reviewDomains"], "result.reviewDomains")
    if len(rows) != len(expected_domains):
        fail(
            f"result.reviewDomains must contain exactly {len(expected_domains)} domains"
        )

    dispositions: dict[str, str] = {}
    for index, raw in enumerate(rows):
        row = require_dict(raw, f"result.reviewDomains[{index}]")
        exact_keys(
            row,
            {"domain", "disposition", "summary", "evidence"},
            f"result.reviewDomains[{index}]",
        )
        domain = nonempty_string(row["domain"], f"result.reviewDomains[{index}].domain")
        if domain not in expected_domains:
            fail(f"unknown review domain: {domain}")
        if domain in dispositions:
            fail(f"duplicate review domain: {domain}")
        disposition = nonempty_string(
            row["disposition"], f"result.reviewDomains[{index}].disposition"
        )
        if disposition not in allowed_dispositions:
            fail(f"unsupported disposition for {domain}: {disposition}")
        nonempty_string(row["summary"], f"result.reviewDomains[{index}].summary")
        string_list(row["evidence"], f"result.reviewDomains[{index}].evidence")
        dispositions[domain] = disposition

    if set(dispositions) != set(expected_domains):
        missing = sorted(set(expected_domains) - set(dispositions))
        fail(f"missing review domains: {missing}")
    return dispositions


def validate_findings(
    result: dict[str, Any], contract: dict[str, Any]
) -> tuple[list[dict[str, Any]], bool, bool]:
    known_domains = set(
        string_list(contract["requiredReviewDomains"], "contract.requiredReviewDomains")
    )
    allowed_severities = set(
        string_list(contract["findingSeverities"], "contract.findingSeverities")
    )
    allowed_statuses = set(
        string_list(contract["findingStatuses"], "contract.findingStatuses")
    )
    findings = require_list(result["findings"], "result.findings")
    seen_ids: set[str] = set()
    normalized: list[dict[str, Any]] = []
    has_unresolved_release_blocker = False
    has_security_relevant_code_change = False

    for index, raw in enumerate(findings):
        finding = require_dict(raw, f"result.findings[{index}]")
        exact_keys(
            finding,
            {
                "id",
                "severity",
                "status",
                "releaseBlocking",
                "securityRelevantCodeChange",
                "title",
                "domains",
                "evidence",
                "disposition",
            },
            f"result.findings[{index}]",
        )
        finding_id = nonempty_string(finding["id"], f"result.findings[{index}].id")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", finding_id):
            fail(f"invalid finding id: {finding_id}")
        if finding_id in seen_ids:
            fail(f"duplicate finding id: {finding_id}")
        seen_ids.add(finding_id)

        severity = nonempty_string(
            finding["severity"], f"result.findings[{index}].severity"
        )
        status = nonempty_string(finding["status"], f"result.findings[{index}].status")
        if severity not in allowed_severities:
            fail(f"unsupported severity for {finding_id}: {severity}")
        if status not in allowed_statuses:
            fail(f"unsupported status for {finding_id}: {status}")
        if not isinstance(finding["releaseBlocking"], bool):
            fail(f"result.findings[{index}].releaseBlocking must be boolean")
        if not isinstance(finding["securityRelevantCodeChange"], bool):
            fail(f"result.findings[{index}].securityRelevantCodeChange must be boolean")
        nonempty_string(finding["title"], f"result.findings[{index}].title")
        domains = string_list(finding["domains"], f"result.findings[{index}].domains")
        unknown_domains = sorted(set(domains) - known_domains)
        if unknown_domains:
            fail(f"finding {finding_id} references unknown domains: {unknown_domains}")
        string_list(finding["evidence"], f"result.findings[{index}].evidence")
        nonempty_string(finding["disposition"], f"result.findings[{index}].disposition")

        if finding["releaseBlocking"] and status != "remediated":
            has_unresolved_release_blocker = True
        if finding["securityRelevantCodeChange"]:
            has_security_relevant_code_change = True
        normalized.append(finding)

    return normalized, has_unresolved_release_blocker, has_security_relevant_code_change


def validate_signoff(result: dict[str, Any], contract: dict[str, Any]) -> str:
    signoff = require_dict(result["signoff"], "result.signoff")
    exact_keys(
        signoff,
        {"decision", "statement", "signerName", "signerOrganization", "signedAt"},
        "result.signoff",
    )
    decision = nonempty_string(signoff["decision"], "result.signoff.decision")
    allowed = set(string_list(contract["signoffDecisions"], "contract.signoffDecisions"))
    if decision not in allowed:
        fail(f"unsupported signoff decision: {decision}")
    nonempty_string(signoff["statement"], "result.signoff.statement")
    nonempty_string(signoff["signerName"], "result.signoff.signerName")
    nonempty_string(signoff["signerOrganization"], "result.signoff.signerOrganization")
    parse_timestamp(signoff["signedAt"], "result.signoff.signedAt")
    return decision


def validate_claims(result: dict[str, Any], contract: dict[str, Any]) -> None:
    required_false = string_list(
        contract["requiredFalseClaims"], "contract.requiredFalseClaims"
    )
    claims = require_dict(result["claims"], "result.claims")
    exact_keys(claims, set(required_false), "result.claims")
    for key in required_false:
        if claims[key] is not False:
            fail(f"result.claims.{key} must be false")


def evaluate(result: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any]:
    exact_keys(
        result,
        {
            "schema",
            "target",
            "reviewer",
            "reviewDate",
            "reviewDomains",
            "findings",
            "signoff",
            "claims",
        },
        "result",
    )
    if result["schema"] != contract["resultSchema"]:
        fail("result.schema does not match contract.resultSchema")

    validate_target(result, contract)
    validate_reviewer(result)
    dispositions = validate_domains(result, contract)
    findings, unresolved_blocker, code_change = validate_findings(result, contract)
    decision = validate_signoff(result, contract)
    validate_claims(result, contract)

    closure_policy = require_dict(contract["closurePolicy"], "contract.closurePolicy")
    eligible_decisions = set(
        string_list(closure_policy["eligibleDecisions"], "contract.closurePolicy.eligibleDecisions")
    )
    reasons: list[str] = []
    if decision not in eligible_decisions:
        reasons.append(f"signoff decision {decision!r} is not closure-eligible")
    if closure_policy.get("allDomainsMustAvoidFail") is True:
        failed = sorted(domain for domain, value in dispositions.items() if value == "fail")
        if failed:
            reasons.append(f"failed review domains: {failed}")
    if closure_policy.get("releaseBlockingFindingsMustBeRemediated") is True and unresolved_blocker:
        reasons.append("one or more release-blocking findings are not remediated")
    if closure_policy.get("securityRelevantCodeChangeRequiresRefreeze") is True and code_change:
        reasons.append("security-relevant code remediation requires a new frozen target and re-review")

    return {
        "schema": "xsp2-p0e-independent-security-review-verification-1",
        "validReviewResult": True,
        "closureEligible": not reasons,
        "closureIneligibilityReasons": reasons,
        "decision": decision,
        "findingCount": len(findings),
        "reviewedDomainCount": len(dispositions),
        "requiresRefreeze": code_change,
        "target": result["target"],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--require-closure-eligible", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        contract = load_json(args.contract, "contract")
        if contract.get("schema") != "xsp2-p0e-independent-security-review-result-contract-1":
            fail("unsupported independent-review result contract schema")
        result = load_json(args.result, "result")
        verification = evaluate(result, contract)
    except ValidationError as exc:
        print(json.dumps({"validReviewResult": False, "error": str(exc)}, sort_keys=True))
        return 1

    print(json.dumps(verification, indent=2, sort_keys=True))
    if args.require_closure_eligible and not verification["closureEligible"]:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
