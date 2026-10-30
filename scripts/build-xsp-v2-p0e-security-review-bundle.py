#!/usr/bin/env python3
"""Build a deterministic, read-only review bundle for the frozen XSP-v2 P0-E target.

This helper never mutates either reviewed repository. It consumes the current
handoff contract as control metadata, verifies the exact frozen Git revisions,
archives both repositories, copies the indexed Nexus evidence, and emits
content-addressed review metadata.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Iterable

CONTRACT_PATH = Path("deploy/xsp-v2-p0e-security-review-handoff.contract.json")
HANDOFF_PATH = Path("docs/XSP_V2_P0E_SECURITY_REVIEW_HANDOFF.md")
MANIFEST_SCHEMA = "xsp2-p0e-security-review-bundle-manifest-1"


def fail(message: str) -> "NoReturn":
    raise SystemExit(message)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_head(root: Path) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return result.stdout.strip()


def git_archive(root: Path, revision: str, destination: Path, prefix: str) -> None:
    subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "archive",
            "--format=tar",
            f"--prefix={prefix}/",
            "HEAD",
            "-o",
            str(destination),
        ],
        check=True,
    )
    if not destination.is_file() or destination.stat().st_size == 0:
        fail(f"archive was not created: {destination}")
    if git_head(root) != revision:
        fail(f"repository changed while archiving: {root}")


def require_regular_file(root: Path, relative: str) -> Path:
    candidate = root / relative
    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError:
        fail(f"missing required review evidence: {relative}")
    resolved_root = root.resolve(strict=True)
    if resolved != resolved_root and resolved_root not in resolved.parents:
        fail(f"evidence escapes repository root: {relative}")
    if not resolved.is_file():
        fail(f"review evidence is not a regular file: {relative}")
    return resolved


def unique_ordered(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            fail(f"duplicate review evidence path: {value}")
        seen.add(value)
        result.append(value)
    return result


def copy_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def iter_payload_files(root: Path) -> list[Path]:
    return sorted(
        (path for path in root.rglob("*") if path.is_file()),
        key=lambda path: path.relative_to(root).as_posix(),
    )


def build_scope_markdown(contract: dict) -> str:
    domains = "\n".join(f"- {domain}" for domain in contract["requiredReviewDomains"])
    blockers = "\n".join(f"- {blocker}" for blocker in contract["requiredExternalBlockers"])
    return f"""# XSP-v2 P0-E frozen security-review bundle\n\nThis bundle is convenience packaging for independent review. It does **not** perform the review, qualify physical power-loss durability, enable `strict-pq`, or authorize production rollout.\n\n## Exact frozen source target\n\n- XMesh-Nexus: `{contract['nexus']['sourceRevision']}`\n- XMesh-Node: `{contract['node']['sourceRevision']}`\n\n## Mandatory review domains\n\n{domains}\n\n## External blockers that remain open\n\n{blockers}\n\n## Non-claims\n\n- `independentSecurityReviewComplete=false`\n- `physicalPowerLossQualified=false`\n- `productionActivation=false`\n- `strictPQEnabled=false`\n\nThe source archives are generated from the exact frozen Git revisions. The control handoff contract/guide are packaging metadata from the branch that generated this bundle and are kept separate from the frozen source archives.\n"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--control-root", type=Path, default=Path("."))
    parser.add_argument("--nexus-root", type=Path, required=True)
    parser.add_argument("--node-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    control_root = args.control_root.resolve(strict=True)
    nexus_root = args.nexus_root.resolve(strict=True)
    node_root = args.node_root.resolve(strict=True)
    output = args.output.resolve()

    contract_file = require_regular_file(control_root, CONTRACT_PATH.as_posix())
    handoff_file = require_regular_file(control_root, HANDOFF_PATH.as_posix())
    contract_bytes = contract_file.read_bytes()
    contract = json.loads(contract_bytes)

    if contract.get("schema") != "xsp2-p0e-security-review-handoff-contract-3":
        fail("unsupported or stale handoff contract schema")
    if contract.get("reviewPackageFrozen") is not True:
        fail("review package is not marked frozen")
    for key in (
        "independentSecurityReviewComplete",
        "physicalPowerLossQualified",
        "productionActivation",
        "strictPQEnabled",
    ):
        if contract.get(key) is not False:
            fail(f"handoff contract unexpectedly claims {key}")

    nexus_revision = contract["nexus"]["sourceRevision"]
    node_revision = contract["node"]["sourceRevision"]
    if git_head(nexus_root) != nexus_revision:
        fail("Nexus checkout does not match frozen sourceRevision")
    if git_head(node_root) != node_revision:
        fail("Node checkout does not match frozen sourceRevision")

    evidence = unique_ordered(
        contract["requiredEvidenceDocuments"]
        + contract["requiredMachineContracts"]
        + contract["requiredImplementationEvidence"]
    )

    if output == Path("/") or output in (control_root, nexus_root, node_root):
        fail("unsafe output directory")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    control_dir = output / "control"
    copy_file(contract_file, control_dir / CONTRACT_PATH.name)
    copy_file(handoff_file, control_dir / HANDOFF_PATH.name)

    evidence_dir = output / "evidence" / "nexus"
    for relative in evidence:
        source = require_regular_file(nexus_root, relative)
        copy_file(source, evidence_dir / relative)

    source_dir = output / "source"
    source_dir.mkdir(parents=True)
    nexus_archive = source_dir / f"XMesh-Nexus-{nexus_revision}.tar"
    node_archive = source_dir / f"XMesh-Node-{node_revision}.tar"
    git_archive(nexus_root, nexus_revision, nexus_archive, f"XMesh-Nexus-{nexus_revision}")
    git_archive(node_root, node_revision, node_archive, f"XMesh-Node-{node_revision}")

    scope_file = output / "REVIEW_SCOPE.md"
    scope_file.write_text(build_scope_markdown(contract), encoding="utf-8", newline="\n")

    payload_files = iter_payload_files(output)
    records = []
    for path in payload_files:
        relative = path.relative_to(output).as_posix()
        records.append(
            {
                "path": relative,
                "sha256": sha256_file(path),
                "size": path.stat().st_size,
            }
        )

    sums_text = "".join(f"{record['sha256']}  {record['path']}\n" for record in records)
    sums_file = output / "SHA256SUMS"
    sums_file.write_text(sums_text, encoding="utf-8", newline="\n")
    package_digest = sha256_bytes(sums_text.encode("utf-8"))

    manifest = {
        "schema": MANIFEST_SCHEMA,
        "controlContractSha256": sha256_bytes(contract_bytes),
        "nexus": contract["nexus"],
        "node": contract["node"],
        "reviewPackageFrozen": True,
        "independentSecurityReviewComplete": False,
        "physicalPowerLossQualified": False,
        "productionActivation": False,
        "strictPQEnabled": False,
        "requiredReviewDomains": contract["requiredReviewDomains"],
        "requiredExternalBlockers": contract["requiredExternalBlockers"],
        "payloadSha256": package_digest,
        "files": records,
    }
    manifest_file = output / "MANIFEST.json"
    manifest_file.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    print(f"bundle={output}")
    print(f"nexus={nexus_revision}")
    print(f"node={node_revision}")
    print(f"payloadSha256={package_digest}")
    print(f"files={len(records)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
