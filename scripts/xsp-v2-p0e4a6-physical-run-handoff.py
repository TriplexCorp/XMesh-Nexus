#!/usr/bin/env python3
"""P0-E4a6 physical-lab handoff.

This tool NEVER controls power and NEVER marks physical power-loss qualification
complete. `prepare` freezes the inputs that must exist before a real lab run.
`verify` reuses the existing P0-E4a3 verifier and additionally binds the final
evidence to separately preserved arm/controller/post-boot/review records.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import ModuleType
from typing import Any

SCHEMA = "xsp2-p0e4a6-physical-run-handoff-1"
PREFLIGHT_SCHEMA = "xsp2-p0e4a-storage-preflight-1"
CHECKPOINT_SCHEMA = "xsp2-owner-offhost-recovery-checkpoint-1"
PINNED_NODE_SOURCE = "50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e"
PINNED_NODE_RUNNER = "7bf8cc92950f396e33891c8744c1f6855414154b"
PINNED_NEXUS_LAB = "a34d0999ca519e2a81e68d92ec7136cd606518d4"
POINTS = (
    "after-previous",
    "after-floor",
    "after-active",
    "after-recovery-abort",
    "after-recovery-active",
)
TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{7,63}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
MAX_JSON = 128 * 1024
MAX_RAW = 1024 * 1024


class HandoffError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise HandoffError(message)


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
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            fail(f"duplicate JSON field: {key}")
        out[key] = value
    return out


def load_json(path: Path, limit: int = MAX_JSON) -> tuple[dict[str, Any], bytes]:
    raw = read_regular(path, limit)
    try:
        value = json.loads(raw, object_pairs_hook=unique_object)
    except json.JSONDecodeError as exc:
        raise HandoffError(f"invalid JSON in {path}") from exc
    if not isinstance(value, dict):
        fail(f"{path} must contain one JSON object")
    return value, raw


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def token(value: Any, label: str) -> str:
    if not isinstance(value, str) or not TOKEN.fullmatch(value):
        fail(f"invalid {label}")
    return value


def sha64(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA64.fullmatch(value) or set(value) == {"0"}:
        fail(f"invalid {label}")
    return value


def positive(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        fail(f"invalid {label}")
    return value


def exact_fields(value: dict[str, Any], fields: set[str], label: str) -> None:
    if set(value) != fields:
        fail(f"{label} has unexpected or missing fields")


def validate_rotation(rotation: dict[str, Any]) -> tuple[int, int]:
    exact_fields(rotation, {
        "fromEpoch", "toEpoch", "fromEdKeyId", "fromPQKeyId", "toEdKeyId", "toPQKeyId"
    }, "rotation")
    from_epoch = positive(rotation["fromEpoch"], "fromEpoch")
    to_epoch = positive(rotation["toEpoch"], "toEpoch")
    if to_epoch != from_epoch + 1:
        fail("rotation epochs must be adjacent")
    for field in ("fromEdKeyId", "fromPQKeyId", "toEdKeyId", "toPQKeyId"):
        token(rotation[field], field)
    if rotation["fromEdKeyId"] == rotation["toEdKeyId"]:
        fail("Ed25519 identity did not rotate")
    if rotation["fromPQKeyId"] == rotation["toPQKeyId"]:
        fail("ML-DSA-65 identity did not rotate")
    return from_epoch, to_epoch


def validate_preflight(path: Path, role: str) -> tuple[str, dict[str, Any]]:
    report, raw = load_json(path)
    if report.get("schema") != PREFLIGHT_SCHEMA or report.get("role") != role:
        fail(f"wrong {role} preflight schema/role")
    if report.get("baselineEligible") is not True:
        fail(f"{role} preflight is not baseline eligible")
    if report.get("physicalPowerLossQualified") is not False:
        fail(f"{role} preflight illegally claims physical qualification")
    return digest(raw), report


def validate_offhost(path: Path, node_id: int, from_epoch: int) -> dict[str, Any]:
    checkpoint, raw = load_json(path)
    exact_fields(checkpoint, {
        "schema", "nodeId", "minimumEpoch", "receiptSha256Hex", "signedReceiptBase64"
    }, "off-host checkpoint")
    if checkpoint["schema"] != CHECKPOINT_SCHEMA:
        fail("wrong off-host checkpoint schema")
    if positive(checkpoint["nodeId"], "off-host Node ID") != node_id:
        fail("off-host checkpoint belongs to another Node")
    minimum = positive(checkpoint["minimumEpoch"], "off-host minimum epoch")
    if minimum > from_epoch:
        fail("off-host recovery floor is newer than the pre-cut rotation state")
    receipt = sha64(checkpoint["receiptSha256Hex"], "off-host receipt digest")
    if not isinstance(checkpoint["signedReceiptBase64"], str) or not checkpoint["signedReceiptBase64"]:
        fail("off-host checkpoint is missing signed receipt bytes")
    return {
        "checkpointSha256Hex": digest(raw),
        "nodeId": node_id,
        "minimumEpoch": minimum,
        "receiptSha256Hex": receipt,
    }


def load_e4a3() -> ModuleType:
    verifier = Path(__file__).with_name("xsp-v2-p0e4a3-powercut-evidence.py")
    spec = importlib.util.spec_from_file_location("xsp_v2_p0e4a3_powercut_evidence", verifier)
    if spec is None or spec.loader is None:
        fail("cannot load the existing P0-E4a3 verifier")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_new(path: Path, value: dict[str, Any]) -> None:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode() + b"\n"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=True) as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        try:
            path.unlink()
        except OSError:
            pass
        raise
    parent_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(parent_fd)
    finally:
        os.close(parent_fd)


def prepare(args: argparse.Namespace) -> dict[str, Any]:
    checkpoint = args.checkpoint
    if checkpoint not in POINTS:
        fail("unsupported physical durability checkpoint")
    run_id = token(args.run_id, "run ID")
    controller_id = token(args.controller_id, "controller ID")
    boot_before = token(args.boot_before_id, "pre-cut boot ID")
    node_id = positive(args.node_id, "Node ID")

    rotation, _ = load_json(Path(args.rotation))
    from_epoch, _ = validate_rotation(rotation)
    agent_sha, _ = validate_preflight(Path(args.agent_preflight), "agent-state")
    pg_sha, _ = validate_preflight(Path(args.postgres_preflight), "nexus-postgres")
    witness = validate_offhost(Path(args.offhost_checkpoint), node_id, from_epoch)
    binary_raw = read_regular(Path(args.lab_binary), MAX_RAW * 256)
    binary_sha = digest(binary_raw)

    plan = {
        "schema": SCHEMA,
        "runId": run_id,
        "checkpoint": checkpoint,
        "nodeSourceRevision": PINNED_NODE_SOURCE,
        "labRunnerRevision": PINNED_NODE_RUNNER,
        "nexusSourceRevision": PINNED_NEXUS_LAB,
        "labBinarySha256Hex": binary_sha,
        "nodeId": node_id,
        "rotation": rotation,
        "bootBeforeId": boot_before,
        "controllerId": controller_id,
        "storageEvidence": {
            "agentPreflightSha256Hex": agent_sha,
            "postgresPreflightSha256Hex": pg_sha,
            "reviewedProfileId": token(args.storage_profile_id, "storage profile ID"),
            "plpEvidenceId": token(args.plp_evidence_id, "PLP evidence ID"),
        },
        "offhostWitness": witness,
        "requiredArmMarker": f"XSP2-POWERCUT-ARMED-V1 run={run_id} point={checkpoint}",
        "externalPowerControllerRequired": True,
        "physicalPowerLossQualified": False,
        "productionActivation": False,
        "strictPQEnabled": False,
    }
    out = Path(args.out)
    if not out.parent.is_dir():
        fail("output parent directory does not exist")
    write_new(out, plan)
    return {
        "status": "physical-run-handoff-prepared",
        "planSha256Hex": digest(read_regular(out)),
        "runId": run_id,
        "checkpoint": checkpoint,
        "labBinarySha256Hex": binary_sha,
        "physicalPowerLossQualified": False,
    }


def compare_plan(plan: dict[str, Any], evidence: dict[str, Any]) -> None:
    pairs = (
        ("runId", "runId"),
        ("checkpoint", "checkpoint"),
        ("nodeSourceRevision", "nodeSourceRevision"),
        ("nexusSourceRevision", "nexusSourceRevision"),
        ("labBinarySha256Hex", "labBinarySha256Hex"),
        ("nodeId", "nodeId"),
        ("rotation", "rotation"),
        ("bootBeforeId", "bootBeforeId"),
        ("storageEvidence", "storageEvidence"),
        ("offhostWitness", "offhostWitness"),
    )
    for plan_key, evidence_key in pairs:
        if plan.get(plan_key) != evidence.get(evidence_key):
            fail(f"final evidence differs from prepared handoff field {plan_key}")
    if evidence.get("controllerEvent", {}).get("controllerId") != plan.get("controllerId"):
        fail("final evidence uses a different external controller")
    if evidence.get("arm", {}).get("marker") != plan.get("requiredArmMarker"):
        fail("final evidence does not contain the prepared arm marker")


def verify(args: argparse.Namespace) -> dict[str, Any]:
    plan, plan_raw = load_json(Path(args.plan))
    exact_fields(plan, {
        "schema", "runId", "checkpoint", "nodeSourceRevision", "labRunnerRevision", "nexusSourceRevision",
        "labBinarySha256Hex", "nodeId", "rotation", "bootBeforeId", "controllerId", "storageEvidence",
        "offhostWitness", "requiredArmMarker", "externalPowerControllerRequired", "physicalPowerLossQualified",
        "productionActivation", "strictPQEnabled"
    }, "handoff plan")
    if plan["schema"] != SCHEMA:
        fail("unsupported handoff schema")
    if plan["nodeSourceRevision"] != PINNED_NODE_SOURCE or plan["labRunnerRevision"] != PINNED_NODE_RUNNER:
        fail("handoff plan does not use the pinned Node revisions")
    if plan["nexusSourceRevision"] != PINNED_NEXUS_LAB:
        fail("handoff plan does not use the reviewed Nexus lab contract revision")
    if plan["externalPowerControllerRequired"] is not True or plan["physicalPowerLossQualified"] is not False:
        fail("handoff plan weakens the physical-controller/qualification boundary")
    if plan["productionActivation"] is not False or plan["strictPQEnabled"] is not False:
        fail("handoff plan attempts production activation")

    e4a3 = load_e4a3()
    e4a3_result = e4a3.verify(
        Path(args.evidence), Path(args.agent_preflight), Path(args.postgres_preflight)
    )
    evidence, evidence_raw = e4a3.load_json(Path(args.evidence))
    compare_plan(plan, evidence)

    arm, _ = load_json(Path(args.arm_observation))
    exact_fields(arm, {"marker", "observedAtMs"}, "arm observation")
    if arm != evidence["arm"]:
        fail("preserved arm observation differs from final evidence")

    controller_meta, _ = load_json(Path(args.controller_meta))
    exact_fields(controller_meta, {"controllerId", "eventId", "action", "observedAtMs"}, "controller metadata")
    expected_controller = dict(controller_meta)
    controller_raw = read_regular(Path(args.controller_raw), MAX_RAW)
    expected_controller["rawEventSha256Hex"] = digest(controller_raw)
    if expected_controller != evidence["controllerEvent"]:
        fail("raw external controller record/metadata differs from final evidence")

    post_boot, _ = load_json(Path(args.post_boot_agent))
    if post_boot != evidence["postBoot"]:
        fail("preserved post-boot Agent record differs from final evidence")
    postgres, _ = load_json(Path(args.postgres_recovery))
    if postgres != evidence["postgresRecovery"]:
        fail("preserved PostgreSQL recovery record differs from final evidence")

    notes_raw = read_regular(Path(args.review_notes), MAX_RAW)
    if digest(notes_raw) != evidence["review"]["notesSha256Hex"]:
        fail("review notes digest differs from final evidence")

    if e4a3_result.get("physicalPowerLossQualified") is not False:
        fail("E4a3 verifier returned an impossible qualification claim")
    return {
        "status": "physical-run-handoff-verified-for-independent-review",
        "runId": plan["runId"],
        "checkpoint": plan["checkpoint"],
        "planSha256Hex": digest(plan_raw),
        "evidenceSha256Hex": digest(evidence_raw),
        "controllerEventSha256Hex": digest(controller_raw),
        "physicalPowerLossQualified": False,
        "scope": "one real-run evidence set is bound for independent review; five-run matrix and reviewer conclusion remain required",
    }


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    sub = root.add_subparsers(dest="command", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--checkpoint", required=True, choices=POINTS)
    prep.add_argument("--run-id", required=True)
    prep.add_argument("--node-id", required=True, type=int)
    prep.add_argument("--rotation", required=True)
    prep.add_argument("--lab-binary", required=True)
    prep.add_argument("--agent-preflight", required=True)
    prep.add_argument("--postgres-preflight", required=True)
    prep.add_argument("--offhost-checkpoint", required=True)
    prep.add_argument("--storage-profile-id", required=True)
    prep.add_argument("--plp-evidence-id", required=True)
    prep.add_argument("--controller-id", required=True)
    prep.add_argument("--boot-before-id", required=True)
    prep.add_argument("--out", required=True)

    check = sub.add_parser("verify")
    check.add_argument("--plan", required=True)
    check.add_argument("--evidence", required=True)
    check.add_argument("--agent-preflight", required=True)
    check.add_argument("--postgres-preflight", required=True)
    check.add_argument("--arm-observation", required=True)
    check.add_argument("--controller-meta", required=True)
    check.add_argument("--controller-raw", required=True)
    check.add_argument("--post-boot-agent", required=True)
    check.add_argument("--postgres-recovery", required=True)
    check.add_argument("--review-notes", required=True)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        result = prepare(args) if args.command == "prepare" else verify(args)
    except (HandoffError, OSError, RuntimeError, KeyError, TypeError, ValueError) as exc:
        print(f"P0-E4a6 handoff rejected: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
