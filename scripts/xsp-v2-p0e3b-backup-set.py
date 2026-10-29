#!/usr/bin/env python3
"""P0-E3b offline backup-set inventory verifier.

This verifier does not restore, mutate, contact, enroll, regenerate, or reset any
security state. It proves that a recovery bundle is complete, internally bound
to one Node/epoch/receipt generation, and byte-for-byte matches its manifest.
The owner/off-host E3a checkpoint remains a separate independently verified
trust input and is never stored inside this backup set.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys

SCHEMA = "xsp2-coordinated-backup-set-1"
REQUIRED = {
    "postgres": "postgres.dump",
    "agentState": "agent-state.tar",
    "signerKeys": "signer-keys.tar",
    "panelPin": "panel-pin.json",
    "mtlsIdentity": "mtls-identity.tar",
}
MAX_MANIFEST = 64 * 1024
MAX_COMPONENT = 4 * 1024**3


def fail(message: str) -> None:
    raise ValueError(message)


def strict_hex(value: object, size: int, label: str) -> str:
    if not isinstance(value, str) or len(value) != size * 2:
        fail(f"{label} has invalid length")
    try:
        raw = bytes.fromhex(value)
    except ValueError as exc:
        raise ValueError(f"{label} is not hex") from exc
    if raw.hex() != value or not any(raw):
        fail(f"{label} is not canonical non-zero lowercase hex")
    return value


def safe_name(value: object, expected: str) -> str:
    if value != expected:
        fail(f"backup component path must be exactly {expected}")
    pure = PurePosixPath(str(value))
    if pure.is_absolute() or len(pure.parts) != 1 or pure.parts[0] in {".", ".."}:
        fail("unsafe backup component path")
    return str(value)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path, limit: int) -> dict[str, object]:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size <= 0 or info.st_size > limit:
        fail(f"unsafe or invalid file: {path.name}")
    raw = path.read_bytes()
    if len(raw) != info.st_size:
        fail(f"file changed while reading: {path.name}")
    value = json.loads(raw)
    if not isinstance(value, dict):
        fail(f"JSON object required: {path.name}")
    return value


def verify_component(root: Path, name: str, expected_path: str, row: object) -> dict[str, object]:
    if not isinstance(row, dict) or set(row) != {"path", "sha256Hex", "size"}:
        fail(f"component {name} has invalid manifest fields")
    rel = safe_name(row["path"], expected_path)
    digest = strict_hex(row["sha256Hex"], 32, f"{name} digest")
    size = row["size"]
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0 or size > MAX_COMPONENT:
        fail(f"component {name} has invalid size")
    path = root / rel
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        fail(f"component {name} must be a regular non-symlink file")
    if info.st_size != size:
        fail(f"component {name} size differs from manifest")
    if sha256_file(path) != digest:
        fail(f"component {name} digest differs from manifest")
    return {"path": rel, "sha256Hex": digest, "size": size}


def verify_manifest(root: Path, manifest_path: Path) -> dict[str, object]:
    manifest = load_json(manifest_path, MAX_MANIFEST)
    expected_fields = {
        "schema",
        "nodeId",
        "keyEpoch",
        "authoritativeReceiptSha256Hex",
        "components",
    }
    if set(manifest) != expected_fields or manifest["schema"] != SCHEMA:
        fail("unsupported or malformed backup-set manifest")
    node_id = manifest["nodeId"]
    epoch = manifest["keyEpoch"]
    if not isinstance(node_id, int) or isinstance(node_id, bool) or node_id <= 0:
        fail("invalid backup-set Node identity")
    if not isinstance(epoch, int) or isinstance(epoch, bool) or epoch <= 0:
        fail("invalid backup-set key epoch")
    receipt = strict_hex(
        manifest["authoritativeReceiptSha256Hex"], 32, "authoritative receipt digest"
    )
    components = manifest["components"]
    if not isinstance(components, dict) or set(components) != set(REQUIRED):
        fail("backup set is missing or adds security components")
    checked = {
        name: verify_component(root, name, filename, components[name])
        for name, filename in REQUIRED.items()
    }
    return {
        "schema": SCHEMA,
        "nodeId": node_id,
        "keyEpoch": epoch,
        "authoritativeReceiptSha256Hex": receipt,
        "components": checked,
    }


def compare_checkpoint(manifest: dict[str, object], checkpoint_path: Path) -> None:
    checkpoint = load_json(checkpoint_path, MAX_MANIFEST)
    required = {
        "schema",
        "nodeId",
        "minimumEpoch",
        "receiptSha256Hex",
        "signedReceiptBase64",
    }
    if set(checkpoint) != required or checkpoint["schema"] != "xsp2-owner-offhost-recovery-checkpoint-1":
        fail("invalid E3a checkpoint envelope")
    node = checkpoint["nodeId"]
    floor = checkpoint["minimumEpoch"]
    if not isinstance(node, int) or isinstance(node, bool) or node <= 0:
        fail("invalid checkpoint Node identity")
    if not isinstance(floor, int) or isinstance(floor, bool) or floor <= 0:
        fail("invalid checkpoint recovery floor")
    receipt = strict_hex(checkpoint["receiptSha256Hex"], 32, "checkpoint receipt digest")
    if manifest["nodeId"] != node:
        fail("backup set belongs to a different Node than the off-host checkpoint")
    if manifest["keyEpoch"] < floor:
        fail("coordinated rollback detected: backup-set epoch is below off-host recovery floor")
    if manifest["keyEpoch"] == floor and manifest["authoritativeReceiptSha256Hex"] != receipt:
        fail("same-epoch backup set has a different authoritative receipt")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--manifest", default="manifest.json")
    parser.add_argument("--checkpoint")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    if not root.is_dir():
        fail("backup root is not a directory")
    manifest_path = root / args.manifest
    verified = verify_manifest(root, manifest_path)
    if args.checkpoint:
        compare_checkpoint(verified, Path(args.checkpoint).resolve())
    print(json.dumps({
        "status": "verified",
        "nodeId": verified["nodeId"],
        "keyEpoch": verified["keyEpoch"],
        "authoritativeReceiptSha256Hex": verified["authoritativeReceiptSha256Hex"],
    }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"P0-E3b backup-set verification failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
