#!/usr/bin/env python3
"""Aggregate five independently collected P0-E4a3 lab evidence bundles.

This is review-preparation tooling only. It reuses the exact E4a3 verifier and
can never mark physical power-loss qualification complete.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from types import ModuleType
from typing import Any

POINTS = (
    "after-previous",
    "after-floor",
    "after-active",
    "after-recovery-abort",
    "after-recovery-active",
)
MATRIX_SCHEMA = "xsp2-p0e4a4-powercut-matrix-1"


class MatrixError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise MatrixError(message)


def load_e3a3() -> ModuleType:
    verifier_path = Path(__file__).with_name("xsp-v2-p0e4a3-powercut-evidence.py")
    spec = importlib.util.spec_from_file_location("xsp_v2_p0e4a3_powercut_evidence", verifier_path)
    if spec is None or spec.loader is None:
        fail("cannot load the pinned P0-E4a3 evidence verifier")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def same(value: Any, expected: Any, label: str) -> None:
    if value != expected:
        fail(f"matrix mixes different {label}")


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def verify_matrix(evidence_dir: Path, agent_preflight: Path, postgres_preflight: Path) -> dict[str, Any]:
    e4a3 = load_e3a3()
    if not evidence_dir.is_dir():
        fail("evidence directory is missing")

    rows: list[dict[str, Any]] = []
    run_ids: set[str] = set()
    event_ids: set[str] = set()
    event_digests: set[str] = set()
    boot_pairs: set[tuple[str, str]] = set()
    matrix_hash = hashlib.sha256()
    baseline: dict[str, Any] | None = None

    for point in POINTS:
        path = evidence_dir / f"{point}.json"
        result = e4a3.verify(path, agent_preflight, postgres_preflight)
        if result.get("physicalPowerLossQualified") is not False:
            fail("E4a3 verifier returned an impossible qualification claim")
        evidence, raw = e4a3.load_json(path)
        if evidence.get("checkpoint") != point:
            fail(f"evidence filename/checkpoint mismatch for {point}")

        controller = evidence["controllerEvent"]
        post_boot = evidence["postBoot"]
        storage = evidence["storageEvidence"]
        witness = evidence["offhostWitness"]
        consistency = {
            "nodeSourceRevision": evidence["nodeSourceRevision"],
            "nexusSourceRevision": evidence["nexusSourceRevision"],
            "labBinarySha256Hex": evidence["labBinarySha256Hex"],
            "nodeId": evidence["nodeId"],
            "rotation": evidence["rotation"],
            "controllerId": controller["controllerId"],
            "reviewedProfileId": storage["reviewedProfileId"],
            "plpEvidenceId": storage["plpEvidenceId"],
            "agentPreflightSha256Hex": storage["agentPreflightSha256Hex"],
            "postgresPreflightSha256Hex": storage["postgresPreflightSha256Hex"],
            "offhostCheckpointSha256Hex": witness["checkpointSha256Hex"],
            "offhostMinimumEpoch": witness["minimumEpoch"],
            "offhostReceiptSha256Hex": witness["receiptSha256Hex"],
        }
        if baseline is None:
            baseline = consistency
        else:
            for key, value in consistency.items():
                same(value, baseline[key], key)

        run_id = evidence["runId"]
        event_id = controller["eventId"]
        event_digest = controller["rawEventSha256Hex"]
        boot_pair = (evidence["bootBeforeId"], post_boot["bootId"])
        if run_id in run_ids:
            fail("matrix reuses a run ID")
        if event_id in event_ids:
            fail("matrix reuses an external controller event ID")
        if event_digest in event_digests:
            fail("matrix reuses an external controller event record")
        if boot_pair in boot_pairs:
            fail("matrix reuses the same pre/post boot identity pair")
        run_ids.add(run_id)
        event_ids.add(event_id)
        event_digests.add(event_digest)
        boot_pairs.add(boot_pair)

        raw_digest = sha256(raw)
        matrix_hash.update(point.encode("ascii"))
        matrix_hash.update(b"\0")
        matrix_hash.update(bytes.fromhex(raw_digest))
        rows.append({
            "checkpoint": point,
            "runId": run_id,
            "controllerEventId": event_id,
            "evidenceSha256Hex": raw_digest,
            "expectedOutcome": result["expectedOutcome"],
            "postBootEpoch": result["postBootEpoch"],
        })

    assert baseline is not None
    return {
        "schema": MATRIX_SCHEMA,
        "status": "matrix-complete-for-independent-review",
        "physicalPowerLossQualified": False,
        "nodeId": baseline["nodeId"],
        "nodeSourceRevision": baseline["nodeSourceRevision"],
        "nexusSourceRevision": baseline["nexusSourceRevision"],
        "labBinarySha256Hex": baseline["labBinarySha256Hex"],
        "reviewedProfileId": baseline["reviewedProfileId"],
        "plpEvidenceId": baseline["plpEvidenceId"],
        "matrixSha256Hex": matrix_hash.hexdigest(),
        "runs": rows,
        "scope": "five evidence bundles structurally converge; independent physical-lab review remains required",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-dir", required=True)
    parser.add_argument("--agent-preflight", required=True)
    parser.add_argument("--postgres-preflight", required=True)
    args = parser.parse_args()
    try:
        result = verify_matrix(
            Path(args.evidence_dir),
            Path(args.agent_preflight),
            Path(args.postgres_preflight),
        )
    except (MatrixError, OSError, RuntimeError, KeyError, TypeError, ValueError) as exc:
        print(f"P0-E4a4 matrix rejected: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
