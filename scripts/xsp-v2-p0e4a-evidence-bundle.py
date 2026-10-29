#!/usr/bin/env python3
"""Fail-closed P0-E4a lab evidence-bundle verifier.

This tool verifies completeness, integrity and cross-binding of evidence files
produced around a separately controlled physical power-cut experiment. It does
NOT attest that physical power was actually removed and cannot change
`physicalPowerLossQualified` to true. Human/independent lab review remains the
authority for the external controller/storage facts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from typing import Any

SCHEMA = "xsp2-p0e4a-evidence-bundle-1"
PREFLIGHT_SCHEMA = "xsp2-p0e4a-storage-preflight-1"
CHECKPOINT_SCHEMA = "xsp2-owner-offhost-recovery-checkpoint-1"
ARM_SCHEMA = "xsp2-p0e4a-arm-marker-1"
CONTROLLER_SCHEMA = "xsp2-p0e4a-external-controller-event-1"
POSTBOOT_AGENT_SCHEMA = "xsp2-p0e4a-postboot-agent-state-1"
POSTBOOT_POSTGRES_SCHEMA = "xsp2-p0e4a-postboot-postgres-state-1"

MAX_MANIFEST = 32 * 1024
MAX_COMPONENT = 256 * 1024
RUN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{7,63}$")
HEX40_RE = re.compile(r"^[0-9a-f]{40}$")
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
CHECKPOINTS = {
    "after-previous",
    "after-floor",
    "after-active",
    "after-recovery-abort",
    "after-recovery-active",
}
COMPONENTS = {
    "agentPreflight",
    "postgresPreflight",
    "offhostCheckpoint",
    "panelPin",
    "armMarker",
    "controllerEvent",
    "postbootAgent",
    "postbootPostgres",
}


class EvidenceError(RuntimeError):
    pass


def strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise EvidenceError(f"duplicate JSON field {key!r}")
        result[key] = value
    return result


def read_regular(path: Path, limit: int) -> bytes:
    try:
        info = path.lstat()
    except OSError as exc:
        raise EvidenceError(f"cannot stat {path}: {exc}") from exc
    if path.is_symlink() or not info.is_file():
        raise EvidenceError(f"{path} is not a non-symlink regular file")
    if info.st_size <= 0 or info.st_size > limit:
        raise EvidenceError(f"{path} has invalid size")
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise EvidenceError(f"cannot read {path}: {exc}") from exc
    if len(raw) != info.st_size:
        raise EvidenceError(f"{path} changed while reading")
    return raw


def parse_json_bytes(raw: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=strict_object)
    except (UnicodeDecodeError, json.JSONDecodeError, EvidenceError) as exc:
        raise EvidenceError(f"invalid {label} JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise EvidenceError(f"{label} must be a JSON object")
    return value


def exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    got = set(value)
    if got != expected:
        raise EvidenceError(f"{label} fields mismatch: missing={sorted(expected-got)} extra={sorted(got-expected)}")


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def require_hex(value: Any, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise EvidenceError(f"{label} is not canonical lowercase hex")
    return value


def require_positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise EvidenceError(f"{label} must be a positive integer")
    return value


def require_bool(value: Any, expected: bool, label: str) -> None:
    if value is not expected:
        raise EvidenceError(f"{label} must be {str(expected).lower()}")


def component_path(root: Path, item: dict[str, Any], label: str) -> tuple[Path, bytes]:
    exact_keys(item, {"file", "sha256"}, f"component {label}")
    filename = item["file"]
    if not isinstance(filename, str) or not FILE_RE.fullmatch(filename):
        raise EvidenceError(f"component {label} has unsafe filename")
    expected = require_hex(item["sha256"], HEX64_RE, f"component {label} sha256")
    path = root / filename
    raw = read_regular(path, MAX_COMPONENT)
    actual = sha256(raw)
    if actual != expected:
        raise EvidenceError(f"component {label} digest mismatch")
    return path, raw


def validate_preflight(raw: bytes, role: str) -> dict[str, Any]:
    value = parse_json_bytes(raw, f"{role} preflight")
    required = {
        "schema", "role", "target", "kernel", "mount", "device", "postgres",
        "baselineEligible", "physicalPowerLossQualified", "failures",
        "requiredNextEvidence", "scope",
    }
    exact_keys(value, required, f"{role} preflight")
    if value["schema"] != PREFLIGHT_SCHEMA or value["role"] != role:
        raise EvidenceError(f"{role} preflight schema/role mismatch")
    require_bool(value["baselineEligible"], True, f"{role} baselineEligible")
    require_bool(value["physicalPowerLossQualified"], False, f"{role} physicalPowerLossQualified")
    if value["failures"] != []:
        raise EvidenceError(f"{role} preflight contains failures")
    if not isinstance(value["requiredNextEvidence"], list) or not value["requiredNextEvidence"]:
        raise EvidenceError(f"{role} preflight has no required next evidence")
    return value


def validate_checkpoint(raw: bytes, node_id: int) -> dict[str, Any]:
    value = parse_json_bytes(raw, "off-host checkpoint")
    exact_keys(value, {"schema", "nodeId", "minimumEpoch", "receiptSha256Hex", "signedReceiptBase64"}, "off-host checkpoint")
    if value["schema"] != CHECKPOINT_SCHEMA:
        raise EvidenceError("off-host checkpoint schema mismatch")
    if require_positive_int(value["nodeId"], "checkpoint nodeId") != node_id:
        raise EvidenceError("off-host checkpoint Node mismatch")
    require_positive_int(value["minimumEpoch"], "checkpoint minimumEpoch")
    require_hex(value["receiptSha256Hex"], HEX64_RE, "checkpoint receiptSha256Hex")
    if not isinstance(value["signedReceiptBase64"], str) or not value["signedReceiptBase64"]:
        raise EvidenceError("checkpoint signed receipt is missing")
    return value


def validate_arm(raw: bytes, run_id: str, checkpoint: str) -> None:
    value = parse_json_bytes(raw, "arm marker")
    exact_keys(value, {"schema", "runId", "checkpoint", "marker"}, "arm marker")
    if value != {
        "schema": ARM_SCHEMA,
        "runId": run_id,
        "checkpoint": checkpoint,
        "marker": f"XSP2-POWERCUT-ARMED-V1 run={run_id} point={checkpoint}",
    }:
        raise EvidenceError("arm marker does not exactly bind run/checkpoint")


def validate_controller(raw: bytes, run_id: str, checkpoint: str) -> None:
    value = parse_json_bytes(raw, "controller event")
    exact_keys(value, {"schema", "runId", "checkpoint", "event", "independentController", "observedArmMarker", "eventTimeUnixMs", "evidenceReference"}, "controller event")
    if value["schema"] != CONTROLLER_SCHEMA or value["runId"] != run_id or value["checkpoint"] != checkpoint:
        raise EvidenceError("controller event is not bound to run/checkpoint")
    if value["event"] != "abrupt-power-loss":
        raise EvidenceError("controller event is not an abrupt-power-loss record")
    require_bool(value["independentController"], True, "controller independentController")
    expected_marker = f"XSP2-POWERCUT-ARMED-V1 run={run_id} point={checkpoint}"
    if value["observedArmMarker"] != expected_marker:
        raise EvidenceError("controller did not record the exact arm marker")
    require_positive_int(value["eventTimeUnixMs"], "controller eventTimeUnixMs")
    ref = value["evidenceReference"]
    if not isinstance(ref, str) or len(ref) < 8 or len(ref) > 256 or any(ord(ch) < 32 for ch in ref):
        raise EvidenceError("controller evidenceReference is invalid")


def validate_postboot_agent(raw: bytes, run_id: str, node_id: int, checkpoint_doc: dict[str, Any]) -> None:
    value = parse_json_bytes(raw, "post-boot Agent state")
    exact_keys(value, {"schema", "runId", "nodeId", "keyEpoch", "stateClass", "currentReceiptSha256Hex", "networkUsedDuringValidation"}, "post-boot Agent state")
    if value["schema"] != POSTBOOT_AGENT_SCHEMA or value["runId"] != run_id:
        raise EvidenceError("post-boot Agent state is not bound to run")
    if require_positive_int(value["nodeId"], "post-boot Agent nodeId") != node_id:
        raise EvidenceError("post-boot Agent Node mismatch")
    epoch = require_positive_int(value["keyEpoch"], "post-boot Agent keyEpoch")
    floor = checkpoint_doc["minimumEpoch"]
    if epoch < floor:
        raise EvidenceError("post-boot Agent state is below off-host monotonic floor")
    if value["stateClass"] not in {"previous-complete", "next-complete"}:
        raise EvidenceError("post-boot Agent state is neither previous-complete nor next-complete")
    digest = value["currentReceiptSha256Hex"]
    if digest is not None:
        require_hex(digest, HEX64_RE, "post-boot Agent receipt digest")
    if epoch == floor and digest != checkpoint_doc["receiptSha256Hex"]:
        raise EvidenceError("same-epoch post-boot Agent receipt differs from off-host witness")
    require_bool(value["networkUsedDuringValidation"], False, "post-boot Agent networkUsedDuringValidation")


def validate_postboot_postgres(raw: bytes, run_id: str, node_id: int, checkpoint_doc: dict[str, Any]) -> None:
    value = parse_json_bytes(raw, "post-boot PostgreSQL state")
    exact_keys(value, {"schema", "runId", "nodeId", "keyEpoch", "receiptSha256Hex", "fsync", "fullPageWrites", "recoveryCompleted", "securityTupleMutatedByValidation"}, "post-boot PostgreSQL state")
    if value["schema"] != POSTBOOT_POSTGRES_SCHEMA or value["runId"] != run_id:
        raise EvidenceError("post-boot PostgreSQL state is not bound to run")
    if require_positive_int(value["nodeId"], "post-boot PostgreSQL nodeId") != node_id:
        raise EvidenceError("post-boot PostgreSQL Node mismatch")
    epoch = require_positive_int(value["keyEpoch"], "post-boot PostgreSQL keyEpoch")
    if epoch < checkpoint_doc["minimumEpoch"]:
        raise EvidenceError("post-boot PostgreSQL state is below off-host monotonic floor")
    digest = value["receiptSha256Hex"]
    if digest is not None:
        require_hex(digest, HEX64_RE, "post-boot PostgreSQL receipt digest")
    if epoch == checkpoint_doc["minimumEpoch"] and digest != checkpoint_doc["receiptSha256Hex"]:
        raise EvidenceError("same-epoch PostgreSQL receipt differs from off-host witness")
    if value["fsync"] != "on" or value["fullPageWrites"] != "on":
        raise EvidenceError("post-boot PostgreSQL durability settings are not preserved")
    require_bool(value["recoveryCompleted"], True, "post-boot PostgreSQL recoveryCompleted")
    require_bool(value["securityTupleMutatedByValidation"], False, "post-boot PostgreSQL securityTupleMutatedByValidation")


def verify(manifest_path: Path, root: Path) -> dict[str, Any]:
    manifest = parse_json_bytes(read_regular(manifest_path, MAX_MANIFEST), "evidence manifest")
    exact_keys(manifest, {"schema", "runId", "checkpoint", "nodeId", "nexusRevision", "nodeRevision", "qualificationBinarySha256", "physicalPowerLossQualified", "components"}, "evidence manifest")
    if manifest["schema"] != SCHEMA:
        raise EvidenceError("evidence manifest schema mismatch")
    run_id = manifest["runId"]
    if not isinstance(run_id, str) or not RUN_RE.fullmatch(run_id):
        raise EvidenceError("invalid evidence runId")
    checkpoint = manifest["checkpoint"]
    if checkpoint not in CHECKPOINTS:
        raise EvidenceError("invalid evidence checkpoint")
    node_id = require_positive_int(manifest["nodeId"], "evidence nodeId")
    require_hex(manifest["nexusRevision"], HEX40_RE, "Nexus revision")
    require_hex(manifest["nodeRevision"], HEX40_RE, "Node revision")
    require_hex(manifest["qualificationBinarySha256"], HEX64_RE, "qualification binary digest")
    require_bool(manifest["physicalPowerLossQualified"], False, "evidence physicalPowerLossQualified")

    components = manifest["components"]
    if not isinstance(components, dict):
        raise EvidenceError("components must be an object")
    exact_keys(components, COMPONENTS, "components")
    loaded: dict[str, bytes] = {}
    filenames: set[str] = set()
    for name in sorted(COMPONENTS):
        item = components[name]
        if not isinstance(item, dict):
            raise EvidenceError(f"component {name} must be an object")
        path, raw = component_path(root, item, name)
        if path.name in filenames:
            raise EvidenceError("two evidence components resolve to the same file")
        filenames.add(path.name)
        loaded[name] = raw

    validate_preflight(loaded["agentPreflight"], "agent-state")
    validate_preflight(loaded["postgresPreflight"], "nexus-postgres")
    checkpoint_doc = validate_checkpoint(loaded["offhostCheckpoint"], node_id)
    # The panel pin bytes are integrity-bound here, but cryptographic validation
    # belongs to the existing P0-E3a verifier. Requiring a non-empty strict JSON
    # object prevents accidental omission without inventing a second verifier.
    pin = parse_json_bytes(loaded["panelPin"], "panel pin")
    if not pin:
        raise EvidenceError("panel pin is empty")
    validate_arm(loaded["armMarker"], run_id, checkpoint)
    validate_controller(loaded["controllerEvent"], run_id, checkpoint)
    validate_postboot_agent(loaded["postbootAgent"], run_id, node_id, checkpoint_doc)
    validate_postboot_postgres(loaded["postbootPostgres"], run_id, node_id, checkpoint_doc)

    return {
        "status": "evidence-bundle-consistent",
        "runId": run_id,
        "checkpoint": checkpoint,
        "nodeId": node_id,
        "minimumEpoch": checkpoint_doc["minimumEpoch"],
        "physicalPowerLossQualified": False,
        "scope": "integrity/cross-binding only; independent review must establish physical power-loss truth",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    manifest = Path(args.manifest)
    root = Path(args.root)
    try:
        root_info = root.lstat()
        if root.is_symlink() or not root_info.is_dir():
            raise EvidenceError("evidence root must be a non-symlink directory")
        result = verify(manifest, root)
    except (EvidenceError, OSError) as exc:
        print(f"P0-E4a evidence bundle rejected: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
