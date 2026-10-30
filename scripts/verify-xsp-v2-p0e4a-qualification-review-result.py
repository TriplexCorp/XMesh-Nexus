#!/usr/bin/env python3
"""Validate the returned independent P0-E4a qualification review result.

This verifier binds an external reviewer conclusion to the existing E4a4
five-run matrix output and the five E4a6 per-run handoff verification outputs.
It NEVER sets physicalPowerLossQualified=true and NEVER closes issue #138.
A successful qualification recommendation is only input to a later explicit
reviewed checkpoint after the real physical-lab evidence has been inspected.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime
import hashlib
import json
from pathlib import Path
import re
import stat
import sys
from typing import Any, NoReturn

DEFAULT_CONTRACT = Path("deploy/xsp-v2-p0e4a-qualification-review-result.contract.json")
MAX_JSON = 256 * 1024
SHA64 = re.compile(r"^[0-9a-f]{64}$")
FINDING_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class ValidationError(ValueError):
    pass


def fail(message: str) -> NoReturn:
    raise ValidationError(message)


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail(f"duplicate JSON field: {key}")
        result[key] = value
    return result


def read_regular(path: Path, where: str) -> bytes:
    try:
        info = path.lstat()
    except OSError as exc:
        fail(f"cannot stat {where}: {exc}")
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        fail(f"{where} must be a regular non-symlink file")
    if info.st_size <= 0 or info.st_size > MAX_JSON:
        fail(f"{where} has invalid size")
    try:
        raw = path.read_bytes()
    except OSError as exc:
        fail(f"cannot read {where}: {exc}")
    if len(raw) != info.st_size:
        fail(f"{where} changed while reading")
    return raw


def load_json(path: Path, where: str) -> tuple[dict[str, Any], bytes]:
    raw = read_regular(path, where)
    try:
        value = json.loads(raw, object_pairs_hook=unique_object)
    except json.JSONDecodeError as exc:
        fail(f"invalid JSON in {where}: {exc}")
    if not isinstance(value, dict):
        fail(f"{where} must contain one JSON object")
    return value, raw


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


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


def require_sha64(value: Any, where: str) -> str:
    text = nonempty_string(value, where)
    if not SHA64.fullmatch(text):
        fail(f"{where} must be lowercase SHA-256 hex")
    return text


def string_list(value: Any, where: str, *, nonempty: bool = True) -> list[str]:
    items = require_list(value, where)
    if nonempty and not items:
        fail(f"{where} must not be empty")
    result = [nonempty_string(item, f"{where}[{index}]") for index, item in enumerate(items)]
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


def validate_contract(contract: dict[str, Any]) -> None:
    if contract.get("schema") != "xsp2-p0e4a-qualification-review-result-contract-1":
        fail("unsupported qualification-review contract schema")
    if contract.get("resultSchema") != "xsp2-p0e4a-qualification-review-result-1":
        fail("unsupported qualification-review result schema")
    if contract.get("verificationSchema") != "xsp2-p0e4a-qualification-review-verification-1":
        fail("unsupported qualification-review verification schema")
    checkpoints = string_list(contract.get("requiredCheckpoints"), "contract.requiredCheckpoints")
    if len(checkpoints) != 5:
        fail("contract must define exactly five checkpoints")
    expected = require_dict(contract.get("expectedOutcomes"), "contract.expectedOutcomes")
    if set(expected) != set(checkpoints):
        fail("contract expectedOutcomes/checkpoints mismatch")
    if contract.get("independentReviewerRequired") is not True:
        fail("contract must require an independent reviewer")
    if contract.get("automaticPhysicalQualification") is not False:
        fail("contract must forbid automatic physical qualification")
    if contract.get("automaticIssueClosure") is not False:
        fail("contract must forbid automatic issue closure")


def validate_matrix(
    matrix: dict[str, Any], matrix_raw: bytes, contract: dict[str, Any]
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    exact_keys(
        matrix,
        {
            "schema",
            "status",
            "physicalPowerLossQualified",
            "nodeId",
            "nodeSourceRevision",
            "nexusSourceRevision",
            "labBinarySha256Hex",
            "reviewedProfileId",
            "plpEvidenceId",
            "matrixSha256Hex",
            "runs",
            "scope",
        },
        "matrix",
    )
    matrix_contract = require_dict(contract["matrixContract"], "contract.matrixContract")
    if matrix["schema"] != matrix_contract["schema"]:
        fail("matrix uses the wrong schema")
    if matrix["status"] != matrix_contract["status"]:
        fail("matrix is not complete for independent review")
    if matrix["physicalPowerLossQualified"] is not False:
        fail("matrix makes an impossible physical qualification claim")
    if not isinstance(matrix["nodeId"], int) or isinstance(matrix["nodeId"], bool) or matrix["nodeId"] <= 0:
        fail("matrix.nodeId must be a positive integer")

    sources = require_dict(contract["reviewedSources"], "contract.reviewedSources")
    if matrix["nodeSourceRevision"] != sources["nodePowercutSourceRevision"]:
        fail("matrix does not use the reviewed Node power-cut source")
    if matrix["nexusSourceRevision"] != sources["nexusE4a5Merge"]:
        fail("matrix does not use the reviewed E4a5 Nexus lab/source contract")
    require_sha64(matrix["labBinarySha256Hex"], "matrix.labBinarySha256Hex")
    nonempty_string(matrix["reviewedProfileId"], "matrix.reviewedProfileId")
    nonempty_string(matrix["plpEvidenceId"], "matrix.plpEvidenceId")
    require_sha64(matrix["matrixSha256Hex"], "matrix.matrixSha256Hex")
    nonempty_string(matrix["scope"], "matrix.scope")

    checkpoints = string_list(contract["requiredCheckpoints"], "contract.requiredCheckpoints")
    outcomes = require_dict(contract["expectedOutcomes"], "contract.expectedOutcomes")
    rows = require_list(matrix["runs"], "matrix.runs")
    if len(rows) != len(checkpoints):
        fail("matrix must contain exactly five run rows")

    by_checkpoint: dict[str, dict[str, Any]] = {}
    run_ids: set[str] = set()
    event_ids: set[str] = set()
    evidence_digests: set[str] = set()
    for index, raw in enumerate(rows):
        row = require_dict(raw, f"matrix.runs[{index}]")
        exact_keys(
            row,
            {
                "checkpoint",
                "runId",
                "controllerEventId",
                "evidenceSha256Hex",
                "expectedOutcome",
                "postBootEpoch",
            },
            f"matrix.runs[{index}]",
        )
        checkpoint = nonempty_string(row["checkpoint"], f"matrix.runs[{index}].checkpoint")
        if checkpoint not in checkpoints:
            fail(f"unknown matrix checkpoint: {checkpoint}")
        if checkpoint in by_checkpoint:
            fail(f"duplicate matrix checkpoint: {checkpoint}")
        run_id = nonempty_string(row["runId"], f"matrix.runs[{index}].runId")
        event_id = nonempty_string(row["controllerEventId"], f"matrix.runs[{index}].controllerEventId")
        evidence_digest = require_sha64(
            row["evidenceSha256Hex"], f"matrix.runs[{index}].evidenceSha256Hex"
        )
        if run_id in run_ids:
            fail("matrix reuses a run ID")
        if event_id in event_ids:
            fail("matrix reuses a controller event ID")
        if evidence_digest in evidence_digests:
            fail("matrix reuses an evidence digest")
        run_ids.add(run_id)
        event_ids.add(event_id)
        evidence_digests.add(evidence_digest)
        if row["expectedOutcome"] != outcomes[checkpoint]:
            fail(f"matrix expected outcome mismatch for {checkpoint}")
        if not isinstance(row["postBootEpoch"], int) or isinstance(row["postBootEpoch"], bool) or row["postBootEpoch"] < 0:
            fail(f"matrix postBootEpoch is invalid for {checkpoint}")
        by_checkpoint[checkpoint] = row

    if list(by_checkpoint) != checkpoints:
        fail("matrix checkpoint order differs from the reviewed five-point order")

    scope = {
        "nodeId": matrix["nodeId"],
        "nodeSourceRevision": matrix["nodeSourceRevision"],
        "labRunnerRevision": sources["nodeLabRunnerRevision"],
        "nexusSourceRevision": matrix["nexusSourceRevision"],
        "labBinarySha256Hex": matrix["labBinarySha256Hex"],
        "reviewedProfileId": matrix["reviewedProfileId"],
        "plpEvidenceId": matrix["plpEvidenceId"],
        "matrixSha256Hex": matrix["matrixSha256Hex"],
        "matrixResultSha256Hex": sha256(matrix_raw),
    }
    return by_checkpoint, scope


def validate_handoffs(
    directory: Path,
    matrix_rows: dict[str, dict[str, Any]],
    contract: dict[str, Any],
) -> dict[str, str]:
    if not directory.is_dir():
        fail("handoff results directory is missing")
    checkpoints = string_list(contract["requiredCheckpoints"], "contract.requiredCheckpoints")
    expected_names = {f"{checkpoint}.json" for checkpoint in checkpoints}
    actual_names = {entry.name for entry in directory.iterdir()}
    if actual_names != expected_names:
        fail("handoff results directory must contain exactly the five checkpoint JSON files")

    result_contract = require_dict(
        contract["handoffResultContract"], "contract.handoffResultContract"
    )
    digests: dict[str, str] = {}
    plan_digests: set[str] = set()
    controller_digests: set[str] = set()
    for checkpoint in checkpoints:
        path = directory / f"{checkpoint}.json"
        result, raw = load_json(path, f"handoff result {checkpoint}")
        exact_keys(
            result,
            {
                "status",
                "runId",
                "checkpoint",
                "planSha256Hex",
                "evidenceSha256Hex",
                "controllerEventSha256Hex",
                "physicalPowerLossQualified",
                "scope",
            },
            f"handoff result {checkpoint}",
        )
        if result["status"] != result_contract["status"]:
            fail(f"handoff result {checkpoint} has the wrong status")
        if result["physicalPowerLossQualified"] is not False:
            fail(f"handoff result {checkpoint} makes an impossible qualification claim")
        if result["checkpoint"] != checkpoint:
            fail(f"handoff result filename/checkpoint mismatch for {checkpoint}")
        row = matrix_rows[checkpoint]
        if result["runId"] != row["runId"]:
            fail(f"handoff/matrix run ID mismatch for {checkpoint}")
        if result["evidenceSha256Hex"] != row["evidenceSha256Hex"]:
            fail(f"handoff/matrix evidence digest mismatch for {checkpoint}")
        plan_digest = require_sha64(
            result["planSha256Hex"], f"handoff result {checkpoint}.planSha256Hex"
        )
        require_sha64(
            result["evidenceSha256Hex"], f"handoff result {checkpoint}.evidenceSha256Hex"
        )
        controller_digest = require_sha64(
            result["controllerEventSha256Hex"],
            f"handoff result {checkpoint}.controllerEventSha256Hex",
        )
        if plan_digest in plan_digests:
            fail("handoff results reuse a plan digest")
        if controller_digest in controller_digests:
            fail("handoff results reuse a controller-event digest")
        plan_digests.add(plan_digest)
        controller_digests.add(controller_digest)
        nonempty_string(result["scope"], f"handoff result {checkpoint}.scope")
        digests[checkpoint] = sha256(raw)
    return digests


def validate_reviewer(result: dict[str, Any]) -> tuple[str, str]:
    reviewer = require_dict(result["reviewer"], "result.reviewer")
    exact_keys(reviewer, {"name", "organization", "independent"}, "result.reviewer")
    name = nonempty_string(reviewer["name"], "result.reviewer.name")
    organization = nonempty_string(reviewer["organization"], "result.reviewer.organization")
    if reviewer["independent"] is not True:
        fail("result.reviewer.independent must be true")
    parse_date(result["reviewDate"], "result.reviewDate")
    return name, organization


def validate_attestations(result: dict[str, Any], contract: dict[str, Any]) -> dict[str, bool]:
    required = string_list(
        contract["requiredEvidenceAttestations"], "contract.requiredEvidenceAttestations"
    )
    attestations = require_dict(result["evidenceAttestations"], "result.evidenceAttestations")
    exact_keys(attestations, set(required), "result.evidenceAttestations")
    normalized: dict[str, bool] = {}
    for key in required:
        value = attestations[key]
        if not isinstance(value, bool):
            fail(f"result.evidenceAttestations.{key} must be boolean")
        normalized[key] = value
    return normalized


def validate_findings(
    result: dict[str, Any], contract: dict[str, Any]
) -> tuple[int, bool, bool]:
    allowed_severities = set(
        string_list(contract["findingSeverities"], "contract.findingSeverities")
    )
    allowed_statuses = set(
        string_list(contract["findingStatuses"], "contract.findingStatuses")
    )
    findings = require_list(result["findings"], "result.findings")
    seen: set[str] = set()
    unresolved_release_blocker = False
    scope_changed = False
    for index, raw in enumerate(findings):
        finding = require_dict(raw, f"result.findings[{index}]")
        exact_keys(
            finding,
            {
                "id",
                "severity",
                "status",
                "releaseBlocking",
                "qualificationScopeChanged",
                "title",
                "evidence",
                "disposition",
            },
            f"result.findings[{index}]",
        )
        finding_id = nonempty_string(finding["id"], f"result.findings[{index}].id")
        if not FINDING_ID.fullmatch(finding_id):
            fail(f"invalid finding id: {finding_id}")
        if finding_id in seen:
            fail(f"duplicate finding id: {finding_id}")
        seen.add(finding_id)
        severity = nonempty_string(finding["severity"], f"result.findings[{index}].severity")
        status = nonempty_string(finding["status"], f"result.findings[{index}].status")
        if severity not in allowed_severities:
            fail(f"unsupported finding severity for {finding_id}: {severity}")
        if status not in allowed_statuses:
            fail(f"unsupported finding status for {finding_id}: {status}")
        if not isinstance(finding["releaseBlocking"], bool):
            fail(f"result.findings[{index}].releaseBlocking must be boolean")
        if not isinstance(finding["qualificationScopeChanged"], bool):
            fail(f"result.findings[{index}].qualificationScopeChanged must be boolean")
        nonempty_string(finding["title"], f"result.findings[{index}].title")
        string_list(finding["evidence"], f"result.findings[{index}].evidence")
        nonempty_string(finding["disposition"], f"result.findings[{index}].disposition")
        if finding["releaseBlocking"] and status != "remediated":
            unresolved_release_blocker = True
        if finding["qualificationScopeChanged"]:
            scope_changed = True
    return len(findings), unresolved_release_blocker, scope_changed


def validate_signoff(
    result: dict[str, Any], contract: dict[str, Any], reviewer_name: str, reviewer_org: str
) -> str:
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
    signer_name = nonempty_string(signoff["signerName"], "result.signoff.signerName")
    signer_org = nonempty_string(
        signoff["signerOrganization"], "result.signoff.signerOrganization"
    )
    if signer_name != reviewer_name or signer_org != reviewer_org:
        fail("signoff identity must match the attributable reviewer identity")
    parse_timestamp(signoff["signedAt"], "result.signoff.signedAt")
    return decision


def validate_claims(result: dict[str, Any], contract: dict[str, Any]) -> None:
    required_false = string_list(contract["requiredFalseClaims"], "contract.requiredFalseClaims")
    claims = require_dict(result["claims"], "result.claims")
    exact_keys(claims, set(required_false), "result.claims")
    for key in required_false:
        if claims[key] is not False:
            fail(f"result.claims.{key} must be false")


def evaluate(
    result: dict[str, Any],
    matrix: dict[str, Any],
    matrix_raw: bytes,
    handoff_dir: Path,
    contract: dict[str, Any],
) -> dict[str, Any]:
    exact_keys(
        result,
        {
            "schema",
            "qualificationScope",
            "handoffResultSha256ByCheckpoint",
            "reviewer",
            "reviewDate",
            "evidenceAttestations",
            "externalReport",
            "findings",
            "signoff",
            "claims",
        },
        "result",
    )
    if result["schema"] != contract["resultSchema"]:
        fail("result.schema does not match contract.resultSchema")

    matrix_rows, expected_scope = validate_matrix(matrix, matrix_raw, contract)
    handoff_digests = validate_handoffs(handoff_dir, matrix_rows, contract)

    scope = require_dict(result["qualificationScope"], "result.qualificationScope")
    exact_keys(scope, set(expected_scope), "result.qualificationScope")
    if scope != expected_scope:
        fail("result.qualificationScope does not match the reviewed matrix/source scope")

    claimed_handoff = require_dict(
        result["handoffResultSha256ByCheckpoint"],
        "result.handoffResultSha256ByCheckpoint",
    )
    exact_keys(
        claimed_handoff,
        set(handoff_digests),
        "result.handoffResultSha256ByCheckpoint",
    )
    for checkpoint, expected_digest in handoff_digests.items():
        actual = require_sha64(
            claimed_handoff[checkpoint],
            f"result.handoffResultSha256ByCheckpoint.{checkpoint}",
        )
        if actual != expected_digest:
            fail(f"result handoff digest mismatch for {checkpoint}")

    reviewer_name, reviewer_org = validate_reviewer(result)
    attestations = validate_attestations(result, contract)

    external_report = require_dict(result["externalReport"], "result.externalReport")
    exact_keys(external_report, {"sha256Hex", "references"}, "result.externalReport")
    require_sha64(external_report["sha256Hex"], "result.externalReport.sha256Hex")
    string_list(external_report["references"], "result.externalReport.references")

    finding_count, unresolved_blocker, scope_changed = validate_findings(result, contract)
    decision = validate_signoff(result, contract, reviewer_name, reviewer_org)
    validate_claims(result, contract)

    policy = require_dict(contract["recommendationPolicy"], "contract.recommendationPolicy")
    eligible_decisions = set(
        string_list(policy["eligibleDecisions"], "contract.recommendationPolicy.eligibleDecisions")
    )
    reasons: list[str] = []
    if decision not in eligible_decisions:
        reasons.append(f"signoff decision {decision!r} is not a qualification recommendation")
    if policy.get("allEvidenceAttestationsMustBeTrue") is True:
        false_attestations = sorted(key for key, value in attestations.items() if not value)
        if false_attestations:
            reasons.append(f"required evidence attestations are false: {false_attestations}")
    if policy.get("releaseBlockingFindingsMustBeRemediated") is True and unresolved_blocker:
        reasons.append("one or more release-blocking findings are not remediated")
    if policy.get("qualificationScopeChangeRequiresNewFiveRunMatrix") is True and scope_changed:
        reasons.append("a finding changed the qualification scope; a new five-run physical matrix is required")

    return {
        "schema": contract["verificationSchema"],
        "validReviewResult": True,
        "reviewerRecommendsQualification": not reasons,
        "recommendationIneligibilityReasons": reasons,
        "requiresNewFiveRunMatrix": scope_changed,
        "requiresExplicitReviewedCheckpoint": True,
        "physicalPowerLossQualified": False,
        "decision": decision,
        "findingCount": finding_count,
        "reviewedCheckpointCount": len(matrix_rows),
        "handoffResultCount": len(handoff_digests),
        "matrixSha256Hex": matrix["matrixSha256Hex"],
        "matrixResultSha256Hex": sha256(matrix_raw),
        "qualificationScope": expected_scope,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--matrix-result", type=Path, required=True)
    parser.add_argument("--handoff-results-dir", type=Path, required=True)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--require-qualification-recommendation", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        contract, _ = load_json(args.contract, "contract")
        validate_contract(contract)
        result, _ = load_json(args.result, "result")
        matrix, matrix_raw = load_json(args.matrix_result, "matrix result")
        verification = evaluate(result, matrix, matrix_raw, args.handoff_results_dir, contract)
    except (ValidationError, OSError) as exc:
        print(json.dumps({"validReviewResult": False, "error": str(exc)}, sort_keys=True))
        return 1

    print(json.dumps(verification, indent=2, sort_keys=True))
    if args.require_qualification_recommendation and not verification["reviewerRecommendsQualification"]:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
