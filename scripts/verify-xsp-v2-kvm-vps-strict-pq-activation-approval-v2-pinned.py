#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

DEFAULT_CONTRACT = Path("deploy/xsp-v2-kvm-vps-strict-pq-activation-approval-v2.contract.json")
BASE_VERIFIER = Path(__file__).with_name("verify-xsp-v2-kvm-vps-strict-pq-activation-approval-v2.py")


def fail(message: str) -> int:
    print(f"Pinned KVM strict-PQ approval rejected: {message}", file=sys.stderr)
    return 2


def load(path: Path, where: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read {where}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{where} must be an object")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--approval", required=True)
    parser.add_argument("--contract", default=str(DEFAULT_CONTRACT))
    parser.add_argument("--require-current-window", action="store_true")
    parser.add_argument("--require-node")
    args = parser.parse_args()

    approval_path = Path(args.approval)
    contract_path = Path(args.contract)
    try:
        approval = load(approval_path, "approval")
        contract = load(contract_path, "contract")
        candidate = approval.get("releaseCandidate")
        evidence = approval.get("evidence")
        if not isinstance(candidate, dict) or not isinstance(evidence, dict):
            return fail("approval candidate/evidence missing")
        required_candidate = contract.get("requiredCandidateBindings")
        required_evidence = contract.get("requiredEvidenceHashes")
        if not isinstance(required_candidate, dict) or not isinstance(required_evidence, dict):
            return fail("contract does not pin candidate/evidence hashes")
        for field, expected in required_candidate.items():
            if candidate.get(field) != expected:
                return fail(f"releaseCandidate.{field} differs from pinned exact candidate")
        for field, expected in required_evidence.items():
            if evidence.get(field) != expected:
                return fail(f"evidence.{field} differs from pinned release evidence")
    except ValueError as exc:
        return fail(str(exc))

    command = [
        sys.executable,
        str(BASE_VERIFIER),
        "--approval", str(approval_path),
        "--contract", str(contract_path),
    ]
    if args.require_current_window:
        command.append("--require-current-window")
    if args.require_node is not None:
        command.extend(["--require-node", args.require_node])
    completed = subprocess.run(command, check=False)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
