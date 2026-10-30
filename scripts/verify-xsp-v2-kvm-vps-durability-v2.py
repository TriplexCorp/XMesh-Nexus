#!/usr/bin/env python3
"""Validate topology-aware KVM VPS durability qualification evidence.

Version 2 keeps the reviewed production runtime target separate from the later,
qualification-only Node tooling revision. It also models the deployed topology:
XMesh-Node and Nexus/PostgreSQL are separate failure domains. The five real Node
crash runs therefore qualify the isolated Node keyring implementation on the
subject host, while PostgreSQL crash recovery and the production off-host
recovery floor are independently evidenced and composed at the release gate.

This verifier never treats guest failure as physical host/storage power-loss
evidence and never enables production strict-pq.
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


def validate_node_run(run: Any, index: int, contract: dict[str, Any], subject_node_id: int) -> tuple[str, str, str]:
    where = f"result.nodeRuns[{index}]"
    if not isinstance(run, dict):
        fail(f"{where} must be an object")
    exact(run, {
        "runId","checkpoint","crashMethod","crashEvidenceSha256","bootBeforeId","bootAfterId",
        "nodeId","rotation","postBoot"
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
    return point, run_id, crash_hash


def validate_storage(value: Any, where: str, contract: dict[str, Any]) -> None:
    if not isinstance(value, dict):
        fail(f"{where} must be an object")
    exact(value, {
        "provider","storageClass","storageTrustBoundary","providerStorageDurabilityAssumed",
        "riskAcceptedBy","riskAcceptedAt","riskStatement"
    }, where)
    nonempty(value["provider"], f"{where}.provider", 128)
    nonempty(value["storageClass"], f"{where}.storageClass", 128)
    if value["storageTrustBoundary"] != contract["providerStorageBoundary"]["storageTrustBoundary"]:
        fail(f"{where}.storageTrustBoundary is wrong")
    if boolean(value["providerStorageDurabilityAssumed"], f"{where}.providerStorageDurabilityAssumed") is not True:
        fail(f"{where} must explicitly accept provider storage durability")
    nonempty(value["riskAcceptedBy"], f"{where}.riskAcceptedBy", 128)
    timestamp(value["riskAcceptedAt"], f"{where}.riskAcceptedAt")
    nonempty(value["riskStatement"], f"{where}.riskStatement", 2048)


def validate_postgres(value: Any, contract: dict[str, Any], subject_node_id: int, node_crash_hashes: set[str]) -> str:
    where = "result.postgresCrashRecovery"
    if not isinstance(value, dict):
        fail(f"{where} must be an object")
    exact(value, {
        "subjectNodeId","crashMethod","crashEvidenceSha256","evidenceSha256",
        "bootBeforeId","bootAfterId","recoveryObserved","integrityChecksPassed",
        "fsync","fullPageWrites","synchronousCommit","walSyncMethod",
        "securityTupleBeforeSha256","securityTupleAfterSha256"
    }, where)
    if positive(value["subjectNodeId"], f"{where}.subjectNodeId") != subject_node_id:
        fail(f"{where}.subjectNodeId does not match result.subjectNodeId")
    method = nonempty(value["crashMethod"], f"{where}.crashMethod", 64)
    if method not in contract["allowedCrashMethods"]:
        fail(f"{where}.crashMethod is unsupported")
    crash_hash = sha(value["crashEvidenceSha256"], f"{where}.crashEvidenceSha256")
    if crash_hash in node_crash_hashes:
        fail("PostgreSQL crash evidence must identify an independent failure-domain event")
    sha(value["evidenceSha256"], f"{where}.evidenceSha256")
    before = token(value["bootBeforeId"], f"{where}.bootBeforeId")
    after = token(value["bootAfterId"], f"{where}.bootAfterId")
    if before == after:
        fail("PostgreSQL evidence did not cross a reboot boundary")
    if boolean(value["recoveryObserved"], f"{where}.recoveryObserved") is not True:
        fail("PostgreSQL recovery was not observed")
    if boolean(value["integrityChecksPassed"], f"{where}.integrityChecksPassed") is not True:
        fail("PostgreSQL integrity checks did not pass")
    if value["fsync"] != "on" or value["fullPageWrites"] != "on":
        fail("PostgreSQL durability settings are invalid")
    if value["synchronousCommit"] not in {"on","remote_apply","remote_write"}:
        fail("PostgreSQL synchronousCommit is unsupported")
    nonempty(value["walSyncMethod"], f"{where}.walSyncMethod", 64)
    before_tuple = sha(value["securityTupleBeforeSha256"], f"{where}.securityTupleBeforeSha256")
    after_tuple = sha(value["securityTupleAfterSha256"], f"{where}.securityTupleAfterSha256")
    if before_tuple != after_tuple:
        fail("PostgreSQL subject security tuple changed across crash recovery")
    return crash_hash


def validate_offhost(value: Any, subject_node_id: int) -> None:
    where = "result.offhostProductionWitness"
    if not isinstance(value, dict):
        fail(f"{where} must be an object")
    exact(value, {
        "nodeId","checkpointSha256","receiptSha256","verificationResultSha256",
        "verificationStatus","minimumEpoch","localEpoch"
    }, where)
    if positive(value["nodeId"], f"{where}.nodeId") != subject_node_id:
        fail(f"{where}.nodeId does not match result.subjectNodeId")
    sha(value["checkpointSha256"], f"{where}.checkpointSha256")
    sha(value["receiptSha256"], f"{where}.receiptSha256")
    sha(value["verificationResultSha256"], f"{where}.verificationResultSha256")
    if value["verificationStatus"] != "verified":
        fail(f"{where}.verificationStatus must be verified")
    floor = positive(value["minimumEpoch"], f"{where}.minimumEpoch")
    local = positive(value["localEpoch"], f"{where}.localEpoch")
    if local < floor:
        fail("production local epoch is below the independently verified off-host floor")


def verify(result_path: Path, contract_path: Path) -> dict[str, Any]:
    contract, _ = load(contract_path, "contract")
    result, raw = load(result_path, "result")
    if contract.get("schema") != "xsp2-kvm-vps-durability-qualification-contract-2":
        fail("unsupported contract schema")
    exact(result, {
        "schema","deploymentClass","topology","target","qualificationTooling","subjectNodeId",
        "evidenceBundle","providerStorage","nodeRuns","postgresCrashRecovery",
        "offhostProductionWitness","claims"
    }, "result")
    if result["schema"] != contract["resultSchema"]:
        fail("unsupported result schema")
    if result["deploymentClass"] != contract["deploymentClass"]:
        fail("wrong deploymentClass")

    topology = result["topology"]
    if not isinstance(topology, dict):
        fail("result.topology must be an object")
    exact(topology, {"nodeStateScope","nodeFailureDomain","nexusPostgresFailureDomain","separateFailureDomains"}, "result.topology")
    requirements = contract["topologyRequirements"]
    if topology["nodeStateScope"] != requirements["nodeStateScope"]:
        fail("wrong Node state scope")
    if boolean(topology["separateFailureDomains"], "result.topology.separateFailureDomains") is not True:
        fail("Node and Nexus/PostgreSQL must be represented as separate failure domains")
    node_domain = token(topology["nodeFailureDomain"], "result.topology.nodeFailureDomain")
    pg_domain = token(topology["nexusPostgresFailureDomain"], "result.topology.nexusPostgresFailureDomain")
    if node_domain == pg_domain:
        fail("Node and Nexus/PostgreSQL failure-domain identifiers must differ")
    if requirements.get("nodeAndNexusPostgresSeparateFailureDomains") is not True:
        fail("contract does not require the deployed separate-domain topology")

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
    binary_sha = sha(tool["binarySha256"], "result.qualificationTooling.binarySha256")
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
    exact(provider, {"node","nexusPostgres"}, "result.providerStorage")
    validate_storage(provider["node"], "result.providerStorage.node", contract)
    validate_storage(provider["nexusPostgres"], "result.providerStorage.nexusPostgres", contract)

    runs = result["nodeRuns"]
    if not isinstance(runs, list) or len(runs) != len(contract["requiredCheckpoints"]):
        fail("result.nodeRuns must contain exactly five runs")
    points: list[str] = []
    run_ids: list[str] = []
    crash_hashes: list[str] = []
    for i, run in enumerate(runs):
        point, run_id, crash_hash = validate_node_run(run, i, contract, subject_node_id)
        points.append(point)
        run_ids.append(run_id)
        crash_hashes.append(crash_hash)
    if set(points) != set(contract["requiredCheckpoints"]) or len(points) != len(set(points)):
        fail("required Node checkpoints must appear exactly once")
    if len(run_ids) != len(set(run_ids)):
        fail("Node run IDs must be unique")
    if len(crash_hashes) != len(set(crash_hashes)):
        fail("Node crash evidence hashes must be unique")

    if requirements.get("independentPostgresCrashRecoveryRequired") is not True:
        fail("contract does not require independent PostgreSQL crash recovery evidence")
    postgres_crash_hash = validate_postgres(result["postgresCrashRecovery"], contract, subject_node_id, set(crash_hashes))

    if requirements.get("independentOffhostProductionWitnessRequired") is not True:
        fail("contract does not require an independent production off-host witness")
    validate_offhost(result["offhostProductionWitness"], subject_node_id)

    claims = result["claims"]
    if not isinstance(claims, dict):
        fail("result.claims must be an object")
    exact(claims, set(contract["requiredClaims"]), "result.claims")
    if claims != contract["requiredClaims"]:
        fail("result.claims must match the KVM qualification boundary exactly")

    return {
        "status": "kvm-vps-durability-qualified-for-release-gate",
        "deploymentClass": "kvm-vps",
        "topologyAware": True,
        "nodeStateScope": topology["nodeStateScope"],
        "nodeRunCount": len(runs),
        "nodeCrashMatrixQualified": True,
        "postgresCrashRecoveryQualified": True,
        "offhostProductionWitnessVerified": True,
        "subjectNodeId": subject_node_id,
        "runtimeNodeRevision": target["nodeRevision"],
        "qualificationToolingRevision": tool["nodeRevision"],
        "qualificationBinarySha256": binary_sha,
        "postgresCrashEvidenceSha256": postgres_crash_hash,
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
        print(f"KVM VPS durability qualification rejected: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(out, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
