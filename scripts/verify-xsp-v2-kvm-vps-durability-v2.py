#!/usr/bin/env python3
"""Validate versioned KVM VPS guest crash-consistency qualification evidence.

Version 2 keeps the reviewed production runtime target separate from the later,
qualification-only Node tooling revision used to arm/inspect real crash runs.
It never treats guest failure as physical host/storage power-loss evidence.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any, NoReturn

DEFAULT_CONTRACT = Path("deploy/xsp-v2-kvm-vps-durability-qualification-v2.contract.json")
MAX_JSON = 512 * 1024
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


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


def load(path: Path, where: str) -> tuple[dict[str, Any], bytes]:
    raw = path.read_bytes()
    if not raw or len(raw) > MAX_JSON:
        fail(f"{where} size must be 1..{MAX_JSON} bytes")
    try:
        value = json.loads(raw, object_pairs_hook=unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"invalid JSON in {where}: {exc}")
    if not isinstance(value, dict):
        fail(f"{where} must be an object")
    return value, raw


def exact(value: dict[str, Any], keys: set[str], where: str) -> None:
    if set(value) != keys:
        fail(f"{where} key mismatch: missing={sorted(keys-set(value))}, unknown={sorted(set(value)-keys)}")


def nonempty(value: Any, where: str, max_len: int = 4096) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{where} must be a non-empty string")
    text = value.strip()
    if len(text) > max_len:
        fail(f"{where} is too long")
    return text


def token(value: Any, where: str) -> str:
    text = nonempty(value, where, 128)
    if not TOKEN.fullmatch(text):
        fail(f"{where} is not a bounded token")
    return text


def sha(value: Any, where: str, width: int = 64) -> str:
    text = nonempty(value, where, width)
    pattern = SHA64 if width == 64 else SHA40
    if not pattern.fullmatch(text) or set(text) == {"0"}:
        fail(f"{where} must be non-zero lowercase {width}-hex")
    return text


def boolean(value: Any, where: str) -> bool:
    if not isinstance(value, bool):
        fail(f"{where} must be boolean")
    return value


def positive(value: Any, where: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        fail(f"{where} must be a positive integer")
    return value


def timestamp(value: Any, where: str) -> str:
    text = nonempty(value, where, 64)
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        fail(f"{where} must be ISO-8601: {exc}")
    if parsed.tzinfo is None:
        fail(f"{where} must include timezone")
    return text


def validate_rotation(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{where} must be an object")
    exact(value, {"fromEpoch","toEpoch","fromEdKeyId","fromPQKeyId","toEdKeyId","toPQKeyId"}, where)
    from_epoch = positive(value["fromEpoch"], f"{where}.fromEpoch")
    to_epoch = positive(value["toEpoch"], f"{where}.toEpoch")
    if to_epoch != from_epoch + 1:
        fail(f"{where} epochs must be adjacent")
    for field in ("fromEdKeyId","fromPQKeyId","toEdKeyId","toPQKeyId"):
        token(value[field], f"{where}.{field}")
    if value["fromEdKeyId"] == value["toEdKeyId"] or value["fromPQKeyId"] == value["toPQKeyId"]:
        fail(f"{where} must rotate both key identities")
    return value


def validate_run(run: Any, index: int, contract: dict[str, Any], subject_node_id: int) -> tuple[str, str, str]:
    where = f"result.runs[{index}]"
    if not isinstance(run, dict):
        fail(f"{where} must be an object")
    exact(run, {
        "runId","checkpoint","crashMethod","crashEvidenceSha256","bootBeforeId","bootAfterId",
        "nodeId","rotation","postBoot","postgresRecovery","offhostWitness"
    }, where)
    run_id = token(run["runId"], f"{where}.runId")
    point = nonempty(run["checkpoint"], f"{where}.checkpoint", 64)
    expected_map = contract["expectedOutcomes"]
    if point not in expected_map:
        fail(f"{where}.checkpoint is not required")
    method = nonempty(run["crashMethod"], f"{where}.crashMethod", 64)
    if method not in contract["allowedCrashMethods"]:
        fail(f"{where}.crashMethod is unsupported")
    crash_hash = sha(run["crashEvidenceSha256"], f"{where}.crashEvidenceSha256")
    before = token(run["bootBeforeId"], f"{where}.bootBeforeId")
    after = token(run["bootAfterId"], f"{where}.bootAfterId")
    if before == after:
        fail(f"{where} did not cross a reboot boundary")
    if positive(run["nodeId"], f"{where}.nodeId") != subject_node_id:
        fail(f"{where}.nodeId does not match result.subjectNodeId")
    rotation = validate_rotation(run["rotation"], f"{where}.rotation")

    post = run["postBoot"]
    if not isinstance(post, dict):
        fail(f"{where}.postBoot must be an object")
    exact(post, {"classification","keyEpoch","activeEdKeyId","activePQKeyId","securityStateSha256","networkAttemptedBeforeValidation"}, f"{where}.postBoot")
    classification = nonempty(post["classification"], f"{where}.postBoot.classification", 64)
    if classification != expected_map[point]:
        fail(f"{where} expected {expected_map[point]}, got {classification}")
    epoch = positive(post["keyEpoch"], f"{where}.postBoot.keyEpoch")
    token(post["activeEdKeyId"], f"{where}.postBoot.activeEdKeyId")
    token(post["activePQKeyId"], f"{where}.postBoot.activePQKeyId")
    sha(post["securityStateSha256"], f"{where}.postBoot.securityStateSha256")
    if boolean(post["networkAttemptedBeforeValidation"], f"{where}.postBoot.networkAttemptedBeforeValidation"):
        fail(f"{where} attempted network before local recovery validation")
    previous = classification == "previous-complete"
    expected_epoch = rotation["fromEpoch"] if previous else rotation["toEpoch"]
    expected_ed = rotation["fromEdKeyId"] if previous else rotation["toEdKeyId"]
    expected_pq = rotation["fromPQKeyId"] if previous else rotation["toPQKeyId"]
    if epoch != expected_epoch or post["activeEdKeyId"] != expected_ed or post["activePQKeyId"] != expected_pq:
        fail(f"{where}.postBoot does not match the complete expected identity")

    pg = run["postgresRecovery"]
    if not isinstance(pg, dict):
        fail(f"{where}.postgresRecovery must be an object")
    exact(pg, {"recoveryObserved","integrityChecksPassed","fsync","fullPageWrites","synchronousCommit","walSyncMethod","securityTupleSha256"}, f"{where}.postgresRecovery")
    if boolean(pg["recoveryObserved"], f"{where}.postgresRecovery.recoveryObserved") is not True:
        fail(f"{where} lacks PostgreSQL recovery evidence")
    if boolean(pg["integrityChecksPassed"], f"{where}.postgresRecovery.integrityChecksPassed") is not True:
        fail(f"{where} PostgreSQL integrity checks failed")
    if pg["fsync"] != "on" or pg["fullPageWrites"] != "on":
        fail(f"{where} PostgreSQL durability settings are invalid")
    if pg["synchronousCommit"] not in {"on","remote_apply","remote_write"}:
        fail(f"{where} synchronousCommit is unsupported")
    nonempty(pg["walSyncMethod"], f"{where}.postgresRecovery.walSyncMethod", 64)
    sha(pg["securityTupleSha256"], f"{where}.postgresRecovery.securityTupleSha256")

    witness = run["offhostWitness"]
    if not isinstance(witness, dict):
        fail(f"{where}.offhostWitness must be an object")
    exact(witness, {"checkpointSha256","minimumEpoch","receiptSha256"}, f"{where}.offhostWitness")
    sha(witness["checkpointSha256"], f"{where}.offhostWitness.checkpointSha256")
    floor = positive(witness["minimumEpoch"], f"{where}.offhostWitness.minimumEpoch")
    sha(witness["receiptSha256"], f"{where}.offhostWitness.receiptSha256")
    if floor > rotation["fromEpoch"] or epoch < floor:
        fail(f"{where} violates off-host monotonic floor")
    return point, run_id, crash_hash


def verify(result_path: Path, contract_path: Path) -> dict[str, Any]:
    contract, _ = load(contract_path, "contract")
    result, raw = load(result_path, "result")
    if contract.get("schema") != "xsp2-kvm-vps-durability-qualification-contract-2":
        fail("unsupported contract schema")
    exact(result, {
        "schema","deploymentClass","target","qualificationTooling","subjectNodeId",
        "evidenceBundle","providerStorage","runs","claims"
    }, "result")
    if result["schema"] != contract["resultSchema"]:
        fail("unsupported result schema")
    if result["deploymentClass"] != contract["deploymentClass"]:
        fail("wrong deploymentClass")

    target = result["target"]
    if not isinstance(target, dict):
        fail("result.target must be an object")
    exact(target, {"nexusRevision","nodeRevision"}, "result.target")
    sha(target["nexusRevision"], "result.target.nexusRevision", 40)
    sha(target["nodeRevision"], "result.target.nodeRevision", 40)
    if target != contract["runtimeTarget"]:
        fail("result is bound to the wrong runtime target")

    expected_tool = contract["qualificationTooling"]
    tool = result["qualificationTooling"]
    if not isinstance(tool, dict):
        fail("result.qualificationTooling must be an object")
    exact(tool, {"nodeRevision","runtimeBaseRevision","runnerPath","buildTag","binarySha256"}, "result.qualificationTooling")
    sha(tool["nodeRevision"], "result.qualificationTooling.nodeRevision", 40)
    sha(tool["runtimeBaseRevision"], "result.qualificationTooling.runtimeBaseRevision", 40)
    sha(tool["binarySha256"], "result.qualificationTooling.binarySha256")
    if tool["nodeRevision"] != expected_tool["nodeRevision"]:
        fail("wrong qualification tooling Node revision")
    if tool["runtimeBaseRevision"] != expected_tool["runtimeBaseRevision"] or tool["runtimeBaseRevision"] != target["nodeRevision"]:
        fail("qualification tooling is not bound to the runtime Node base revision")
    if tool["runnerPath"] != expected_tool["runnerPath"]:
        fail("wrong qualification runner path")
    if tool["buildTag"] != expected_tool["requiredBuildTag"]:
        fail("wrong qualification build tag")
    if expected_tool.get("productionAgentExcludesQualificationControls") is not True:
        fail("contract does not preserve the production Agent qualification-control boundary")

    subject_node_id = positive(result["subjectNodeId"], "result.subjectNodeId")

    bundle = result["evidenceBundle"]
    if not isinstance(bundle, dict):
        fail("result.evidenceBundle must be an object")
    exact(bundle, {"archiveName","archiveSha256"}, "result.evidenceBundle")
    token(bundle["archiveName"], "result.evidenceBundle.archiveName")
    archive_sha = sha(bundle["archiveSha256"], "result.evidenceBundle.archiveSha256")

    provider = result["providerStorage"]
    if not isinstance(provider, dict):
        fail("result.providerStorage must be an object")
    exact(provider, {"provider","storageClass","storageTrustBoundary","providerStorageDurabilityAssumed","riskAcceptedBy","riskAcceptedAt","riskStatement"}, "result.providerStorage")
    nonempty(provider["provider"], "result.providerStorage.provider", 128)
    nonempty(provider["storageClass"], "result.providerStorage.storageClass", 128)
    if provider["storageTrustBoundary"] != contract["providerStorageBoundary"]["storageTrustBoundary"]:
        fail("wrong storage trust boundary")
    if boolean(provider["providerStorageDurabilityAssumed"], "result.providerStorage.providerStorageDurabilityAssumed") is not True:
        fail("provider storage durability assumption must be explicit")
    nonempty(provider["riskAcceptedBy"], "result.providerStorage.riskAcceptedBy", 128)
    timestamp(provider["riskAcceptedAt"], "result.providerStorage.riskAcceptedAt")
    nonempty(provider["riskStatement"], "result.providerStorage.riskStatement", 2048)

    runs = result["runs"]
    if not isinstance(runs, list) or len(runs) != len(contract["requiredCheckpoints"]):
        fail("result.runs must contain exactly five runs")
    points: list[str] = []
    run_ids: list[str] = []
    crash_hashes: list[str] = []
    for i, run in enumerate(runs):
        point, run_id, crash_hash = validate_run(run, i, contract, subject_node_id)
        points.append(point)
        run_ids.append(run_id)
        crash_hashes.append(crash_hash)
    if set(points) != set(contract["requiredCheckpoints"]) or len(points) != len(set(points)):
        fail("required checkpoints must appear exactly once")
    if len(run_ids) != len(set(run_ids)):
        fail("run IDs must be unique")
    if len(crash_hashes) != len(set(crash_hashes)):
        fail("crash evidence hashes must be unique")

    claims = result["claims"]
    if not isinstance(claims, dict):
        fail("result.claims must be an object")
    exact(claims, set(contract["requiredClaims"]), "result.claims")
    if claims != contract["requiredClaims"]:
        fail("result.claims must match the KVM qualification boundary exactly")

    return {
        "status": "kvm-vps-durability-qualified-for-release-gate",
        "deploymentClass": "kvm-vps",
        "runCount": len(runs),
        "subjectNodeId": subject_node_id,
        "runtimeNodeRevision": target["nodeRevision"],
        "qualificationToolingRevision": tool["nodeRevision"],
        "evidenceArchiveSha256": archive_sha,
        "matrixSha256": hashlib.sha256(raw).hexdigest(),
        "guestCrashConsistencyQualified": True,
        "providerStorageDurabilityAssumed": True,
        "physicalPowerLossQualified": False,
        "productionDurabilityGateEligible": True,
        "productionActivation": False,
        "strictPQEnabled": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", required=True)
    parser.add_argument("--contract", default=str(DEFAULT_CONTRACT))
    args = parser.parse_args()
    try:
        out = verify(Path(args.result), Path(args.contract))
    except (ValidationError, OSError) as exc:
        print(f"KVM VPS durability qualification v2 rejected: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(out, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
