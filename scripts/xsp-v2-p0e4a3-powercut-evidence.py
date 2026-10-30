#!/usr/bin/env python3
"""Offline P0-E4a3 external power-cut evidence contract verifier.

This tool NEVER performs a power operation and NEVER claims that CI is physical
power-loss evidence. It validates a lab-produced evidence bundle after a
physically independent controller has already removed power.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import sys
from typing import Any

SCHEMA = "xsp2-p0e4a3-powercut-evidence-1"
PREFLIGHT_SCHEMA = "xsp2-p0e4a-storage-preflight-1"
PINNED_NODE_SHA = "34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb"
MAX_JSON = 128 * 1024
MAX_EVENT_DELAY_MS = 120_000
TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{7,63}$")
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
EXPECTED_OUTCOME = {
    "after-previous": "previous-complete",
    "after-floor": "next-complete",
    "after-active": "next-complete",
    "after-recovery-abort": "previous-complete",
    "after-recovery-active": "next-complete",
}


class EvidenceError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise EvidenceError(message)


def read_regular(path: Path, limit: int = MAX_JSON) -> bytes:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        fail(f"{path} must be a regular non-symlink file")
    if info.st_size <= 0 or info.st_size > limit:
        fail(f"{path} has invalid size")
    raw = path.read_bytes()
    if len(raw) != info.st_size:
        fail(f"{path} changed while reading")
    return raw


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail(f"duplicate JSON field: {key}")
        result[key] = value
    return result


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = read_regular(path)
    try:
        value = json.loads(raw, object_pairs_hook=unique_object)
    except json.JSONDecodeError as exc:
        raise EvidenceError(f"invalid JSON in {path}") from exc
    if not isinstance(value, dict):
        fail(f"{path} must contain one JSON object")
    return value, raw


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def exact_fields(value: dict[str, Any], fields: set[str], label: str) -> None:
    if set(value) != fields:
        fail(f"{label} has unexpected or missing fields")


def token(value: Any, label: str) -> str:
    if not isinstance(value, str) or not TOKEN.fullmatch(value):
        fail(f"invalid {label}")
    return value


def sha64(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA64.fullmatch(value) or set(value) == {"0"}:
        fail(f"invalid {label}")
    return value


def positive_int(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        fail(f"invalid {label}")
    return value


def validate_preflight(report: dict[str, Any], role: str, raw: bytes, expected_sha: str) -> None:
    if digest(raw) != expected_sha:
        fail(f"{role} preflight digest mismatch")
    if report.get("schema") != PREFLIGHT_SCHEMA or report.get("role") != role:
        fail(f"wrong {role} preflight schema/role")
    if report.get("baselineEligible") is not True:
        fail(f"{role} storage was not baseline eligible before the lab run")
    if report.get("physicalPowerLossQualified") is not False:
        fail(f"{role} preflight illegally claims physical qualification")
    if not isinstance(report.get("mount"), dict) or not isinstance(report.get("device"), dict):
        fail(f"{role} preflight storage facts are incomplete")
    if role == "nexus-postgres" and not isinstance(report.get("postgres"), dict):
        fail("PostgreSQL preflight settings are incomplete")


def validate_rotation(rotation: dict[str, Any]) -> tuple[int, int]:
    exact_fields(rotation, {
        "fromEpoch", "toEpoch", "fromEdKeyId", "fromPQKeyId", "toEdKeyId", "toPQKeyId"
    }, "rotation")
    from_epoch = positive_int(rotation["fromEpoch"], "fromEpoch")
    to_epoch = positive_int(rotation["toEpoch"], "toEpoch")
    if to_epoch != from_epoch + 1:
        fail("rotation epochs are not adjacent")
    for name in ["fromEdKeyId", "fromPQKeyId", "toEdKeyId", "toPQKeyId"]:
        token(rotation[name], name)
    if rotation["fromEdKeyId"] == rotation["toEdKeyId"] or rotation["fromPQKeyId"] == rotation["toPQKeyId"]:
        fail("rotation did not change both key identities")
    return from_epoch, to_epoch


def validate_post_boot(post: dict[str, Any], point: str, rotation: dict[str, Any]) -> int:
    exact_fields(post, {
        "bootId", "recoveredAtMs", "classification", "keyEpoch", "activeEdKeyId", "activePQKeyId",
        "securityStateSha256Hex", "networkAttemptedBeforeValidation"
    }, "postBoot")
    token(post["bootId"], "post-boot ID")
    positive_int(post["recoveredAtMs"], "post-boot recovery time")
    classification = post["classification"]
    expected = EXPECTED_OUTCOME[point]
    if classification != expected:
        fail(f"checkpoint {point} requires {expected}, got {classification!r}")
    epoch = positive_int(post["keyEpoch"], "post-boot key epoch")
    sha64(post["securityStateSha256Hex"], "post-boot security-state digest")
    if post["networkAttemptedBeforeValidation"] is not False:
        fail("post-boot recovery attempted network before local evidence validation")
    if expected == "previous-complete":
        if epoch != rotation["fromEpoch"] or post["activeEdKeyId"] != rotation["fromEdKeyId"] or post["activePQKeyId"] != rotation["fromPQKeyId"]:
            fail("previous-complete state does not match the exact prior identity")
    else:
        if epoch != rotation["toEpoch"] or post["activeEdKeyId"] != rotation["toEdKeyId"] or post["activePQKeyId"] != rotation["toPQKeyId"]:
            fail("next-complete state does not match the exact candidate identity")
    return epoch


def validate_postgres(pg: dict[str, Any], controller_at: int) -> None:
    exact_fields(pg, {
        "recoveryObserved", "readyAtMs", "fsync", "fullPageWrites", "synchronousCommit",
        "walSyncMethod", "securityTupleSha256Hex", "integrityChecksPassed"
    }, "postgresRecovery")
    if pg["recoveryObserved"] is not True or pg["integrityChecksPassed"] is not True:
        fail("PostgreSQL abrupt-power recovery/integrity evidence is incomplete")
    ready = positive_int(pg["readyAtMs"], "PostgreSQL recovery time")
    if ready <= controller_at:
        fail("PostgreSQL recovery timestamp predates external power event")
    if pg["fsync"] != "on" or pg["fullPageWrites"] != "on":
        fail("PostgreSQL durable settings were not preserved")
    if pg["synchronousCommit"] not in {"on", "remote_apply", "remote_write"}:
        fail("PostgreSQL synchronous_commit is not accepted")
    if not isinstance(pg["walSyncMethod"], str) or not pg["walSyncMethod"]:
        fail("PostgreSQL wal_sync_method missing")
    sha64(pg["securityTupleSha256Hex"], "PostgreSQL security-tuple digest")


def verify(evidence_path: Path, agent_preflight_path: Path, pg_preflight_path: Path) -> dict[str, Any]:
    evidence, _ = load_json(evidence_path)
    agent_preflight, agent_raw = load_json(agent_preflight_path)
    pg_preflight, pg_raw = load_json(pg_preflight_path)
    exact_fields(evidence, {
        "schema", "runId", "checkpoint", "nodeSourceRevision", "nexusSourceRevision", "labBinarySha256Hex",
        "nodeId", "rotation", "arm", "controllerEvent", "bootBeforeId", "postBoot", "postgresRecovery",
        "offhostWitness", "storageEvidence", "review"
    }, "evidence")
    if evidence["schema"] != SCHEMA:
        fail("unsupported P0-E4a3 evidence schema")
    run_id = token(evidence["runId"], "run ID")
    point = evidence["checkpoint"]
    if point not in EXPECTED_OUTCOME:
        fail("unrecognized durability checkpoint")
    if evidence["nodeSourceRevision"] != PINNED_NODE_SHA:
        fail("lab run does not use the pinned Node power-cut source revision")
    if not isinstance(evidence["nexusSourceRevision"], str) or not SHA40.fullmatch(evidence["nexusSourceRevision"]):
        fail("invalid Nexus source revision")
    sha64(evidence["labBinarySha256Hex"], "lab binary digest")
    node_id = positive_int(evidence["nodeId"], "Node ID")
    from_epoch, _ = validate_rotation(evidence["rotation"])

    arm = evidence["arm"]
    exact_fields(arm, {"marker", "observedAtMs"}, "arm")
    expected_marker = f"XSP2-POWERCUT-ARMED-V1 run={run_id} point={point}"
    if arm["marker"] != expected_marker:
        fail("arm marker does not bind exact run/checkpoint")
    arm_at = positive_int(arm["observedAtMs"], "arm observation time")

    controller = evidence["controllerEvent"]
    exact_fields(controller, {"controllerId", "eventId", "action", "observedAtMs", "rawEventSha256Hex"}, "controllerEvent")
    token(controller["controllerId"], "controller ID")
    token(controller["eventId"], "controller event ID")
    if controller["action"] != "power-off":
        fail("controller event is not an external power-off")
    controller_at = positive_int(controller["observedAtMs"], "controller event time")
    sha64(controller["rawEventSha256Hex"], "controller raw-event digest")
    if controller_at < arm_at or controller_at - arm_at > MAX_EVENT_DELAY_MS:
        fail("external power event is not temporally bound to the observed arm marker")

    boot_before = token(evidence["bootBeforeId"], "pre-cut boot ID")
    post_epoch = validate_post_boot(evidence["postBoot"], point, evidence["rotation"])
    if evidence["postBoot"]["bootId"] == boot_before:
        fail("boot ID did not change across the claimed physical power cycle")
    if evidence["postBoot"]["recoveredAtMs"] <= controller_at:
        fail("post-boot recovery timestamp predates the power event")

    witness = evidence["offhostWitness"]
    exact_fields(witness, {"checkpointSha256Hex", "nodeId", "minimumEpoch", "receiptSha256Hex"}, "offhostWitness")
    sha64(witness["checkpointSha256Hex"], "off-host checkpoint digest")
    sha64(witness["receiptSha256Hex"], "off-host receipt digest")
    if positive_int(witness["nodeId"], "witness Node ID") != node_id:
        fail("off-host witness belongs to a different Node")
    floor = positive_int(witness["minimumEpoch"], "off-host minimum epoch")
    if floor > from_epoch or post_epoch < floor:
        fail("post-boot state violates the independent off-host monotonic floor")

    storage = evidence["storageEvidence"]
    exact_fields(storage, {
        "agentPreflightSha256Hex", "postgresPreflightSha256Hex", "reviewedProfileId", "plpEvidenceId"
    }, "storageEvidence")
    agent_sha = sha64(storage["agentPreflightSha256Hex"], "Agent preflight digest")
    pg_sha = sha64(storage["postgresPreflightSha256Hex"], "PostgreSQL preflight digest")
    token(storage["reviewedProfileId"], "reviewed storage profile ID")
    token(storage["plpEvidenceId"], "PLP/controller evidence ID")
    validate_preflight(agent_preflight, "agent-state", agent_raw, agent_sha)
    validate_preflight(pg_preflight, "nexus-postgres", pg_raw, pg_sha)

    validate_postgres(evidence["postgresRecovery"], controller_at)

    review = evidence["review"]
    exact_fields(review, {"operator", "reviewedAtMs", "notesSha256Hex"}, "review")
    token(review["operator"], "review operator")
    if positive_int(review["reviewedAtMs"], "review timestamp") <= evidence["postBoot"]["recoveredAtMs"]:
        fail("review timestamp does not follow post-boot evidence collection")
    sha64(review["notesSha256Hex"], "review notes digest")

    return {
        "status": "evidence-contract-valid",
        "physicalPowerLossQualified": False,
        "runId": run_id,
        "checkpoint": point,
        "expectedOutcome": EXPECTED_OUTCOME[point],
        "postBootEpoch": post_epoch,
        "nodeSourceRevision": PINNED_NODE_SHA,
        "scope": "lab evidence structurally validated; independent review is still required before qualification",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--agent-preflight", required=True)
    parser.add_argument("--postgres-preflight", required=True)
    args = parser.parse_args()
    try:
        result = verify(Path(args.evidence), Path(args.agent_preflight), Path(args.postgres_preflight))
    except (EvidenceError, OSError) as exc:
        print(f"P0-E4a3 evidence rejected: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
