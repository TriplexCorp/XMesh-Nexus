#!/usr/bin/env python3
"""Verify the staging-only protected permit tooling source/binary binding.

This gate deliberately keeps the reviewed Nexus production runtime revision
separate from the later qualification-only permit issuer/operator tooling.
It does not authorize strict-PQ or production activation.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import json
import re
import sys
from typing import Any, NoReturn

DEFAULT_CONTRACT = Path("deploy/xsp-v2-p0e-permit-tooling-binding.contract.json")
MAX_JSON = 64 * 1024
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")


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


def load(path: Path, where: str) -> dict[str, Any]:
    raw = path.read_bytes()
    if not raw or len(raw) > MAX_JSON:
        fail(f"{where} size must be 1..{MAX_JSON} bytes")
    try:
        value = json.loads(raw, object_pairs_hook=unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"invalid JSON in {where}: {exc}")
    if not isinstance(value, dict):
        fail(f"{where} must be an object")
    return value


def exact(value: dict[str, Any], keys: set[str], where: str) -> None:
    if set(value) != keys:
        fail(
            f"{where} key mismatch: "
            f"missing={sorted(keys-set(value))}, unknown={sorted(set(value)-keys)}"
        )


def sha40(value: Any, where: str) -> str:
    if not isinstance(value, str) or not SHA40.fullmatch(value) or set(value) == {"0"}:
        fail(f"{where} must be non-zero lowercase 40-hex")
    return value


def sha64(value: Any, where: str) -> str:
    if not isinstance(value, str) or not SHA64.fullmatch(value) or set(value) == {"0"}:
        fail(f"{where} must be non-zero lowercase 64-hex")
    return value


def verify(result_path: Path, contract_path: Path) -> dict[str, Any]:
    contract = load(contract_path, "contract")
    result = load(result_path, "result")

    exact(
        contract,
        {"schema", "resultSchema", "productionRuntimeTarget", "tooling", "requiredClaims"},
        "contract",
    )
    if contract["schema"] != "xsp2-p0e-permit-tooling-binding-contract-1":
        fail("unsupported contract schema")

    exact(
        result,
        {"schema", "productionRuntimeTarget", "tooling", "claims"},
        "result",
    )
    if result["schema"] != contract["resultSchema"]:
        fail("unsupported result schema")

    runtime = result["productionRuntimeTarget"]
    if not isinstance(runtime, dict):
        fail("result.productionRuntimeTarget must be an object")
    exact(runtime, {"nexusRevision"}, "result.productionRuntimeTarget")
    sha40(runtime["nexusRevision"], "result.productionRuntimeTarget.nexusRevision")
    if runtime != contract["productionRuntimeTarget"]:
        fail("result is bound to the wrong Nexus production runtime")

    expected = contract["tooling"]
    if not isinstance(expected, dict):
        fail("contract.tooling must be an object")
    exact(
        expected,
        {
            "revision", "toolingBaseRevision", "runtimeBaseRevision", "manifestPath",
            "signerPath", "operatorPath", "dockerfilePath", "requiredFeature",
            "issuerGate", "operatorGate", "productionPanelExcludesPermitTargets",
            "allowedDeltaPaths",
        },
        "contract.tooling",
    )
    for field in ("revision", "toolingBaseRevision", "runtimeBaseRevision"):
        sha40(expected[field], f"contract.tooling.{field}")
    if expected["runtimeBaseRevision"] != runtime["nexusRevision"]:
        fail("permit tooling runtime base is not the reviewed Nexus runtime")
    if expected["productionPanelExcludesPermitTargets"] is not True:
        fail("contract does not preserve the production panel/tooling boundary")
    if not isinstance(expected["allowedDeltaPaths"], list) or not expected["allowedDeltaPaths"]:
        fail("contract.tooling.allowedDeltaPaths must be a non-empty list")
    if len(expected["allowedDeltaPaths"]) != len(set(expected["allowedDeltaPaths"])):
        fail("contract.tooling.allowedDeltaPaths contains duplicates")

    tooling = result["tooling"]
    if not isinstance(tooling, dict):
        fail("result.tooling must be an object")
    exact(
        tooling,
        {
            "revision", "toolingBaseRevision", "runtimeBaseRevision",
            "permitSignerBinarySha256", "permitOperatorBinarySha256",
            "buildEvidenceSha256",
        },
        "result.tooling",
    )
    for field in ("revision", "toolingBaseRevision", "runtimeBaseRevision"):
        sha40(tooling[field], f"result.tooling.{field}")
        if tooling[field] != expected[field]:
            fail(f"wrong permit tooling {field}")
    signer_sha = sha64(tooling["permitSignerBinarySha256"], "result.tooling.permitSignerBinarySha256")
    operator_sha = sha64(tooling["permitOperatorBinarySha256"], "result.tooling.permitOperatorBinarySha256")
    evidence_sha = sha64(tooling["buildEvidenceSha256"], "result.tooling.buildEvidenceSha256")
    if signer_sha == operator_sha:
        fail("permit signer/operator binary digests must differ")

    claims = result["claims"]
    if not isinstance(claims, dict):
        fail("result.claims must be an object")
    exact(claims, set(contract["requiredClaims"]), "result.claims")
    if claims != contract["requiredClaims"]:
        fail("result.claims do not match the non-activating tooling boundary")

    return {
        "status": "p0-e-permit-tooling-bound",
        "permitToolingBound": True,
        "productionRuntimeNexusRevision": runtime["nexusRevision"],
        "permitToolingRevision": tooling["revision"],
        "permitSignerBinarySha256": signer_sha,
        "permitOperatorBinarySha256": operator_sha,
        "buildEvidenceSha256": evidence_sha,
        "stagingOnly": True,
        "strictPQEnabled": False,
        "productionActivation": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", required=True)
    parser.add_argument("--contract", default=str(DEFAULT_CONTRACT))
    args = parser.parse_args()
    try:
        out = verify(Path(args.result), Path(args.contract))
    except (ValidationError, OSError) as exc:
        print(f"P0-E permit tooling binding rejected: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(out, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
