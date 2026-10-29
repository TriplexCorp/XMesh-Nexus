#!/usr/bin/env python3
"""Read-only P0-E4a storage durability preflight.

This tool deliberately does NOT claim physical power-loss qualification. It
checks whether a host/storage configuration is eligible to enter a separately
controlled abrupt-power test. A green result means only "baseline eligible".
Physical power-cut/controller-cache evidence remains mandatory and external.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

SCHEMA = "xsp2-p0e4a-storage-preflight-1"
ROLE_AGENT = "agent-state"
ROLE_POSTGRES = "nexus-postgres"
SUPPORTED_FS = {"ext4", "xfs"}
REJECTED_FS = {
    "aufs", "btrfs", "ceph", "cifs", "ecryptfs", "fuse", "fuseblk", "glusterfs",
    "nfs", "nfs4", "overlay", "overlay2", "smb3", "tmpfs", "zfs",
}
SAFE_PG_SYNC = {"on", "remote_apply", "remote_write"}
CONTAINER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


class PreflightError(RuntimeError):
    pass


def command(*args: str, timeout: int = 15) -> str:
    result = subprocess.run(
        args,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        env={"PATH": os.environ.get("PATH", "")},
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()[-1200:]
        raise PreflightError(f"{args[0]} failed ({result.returncode}): {detail}")
    return result.stdout.strip()


def canonical_target(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute() or str(path) != os.path.normpath(value):
        raise PreflightError("target path must be canonical and absolute")
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise PreflightError(f"target path is unavailable: {exc}") from exc
    if resolved != path:
        raise PreflightError("target path must not traverse symlinks")
    if not path.is_dir():
        raise PreflightError("target path must be a directory")
    return path


def parse_findmnt(raw: str) -> dict[str, str]:
    try:
        payload = json.loads(raw)
        filesystems = payload["filesystems"]
        if len(filesystems) != 1:
            raise ValueError("expected one filesystem")
        item = filesystems[0]
        return {
            "source": str(item["source"]),
            "fstype": str(item["fstype"]),
            "options": str(item.get("options", "")),
            "target": str(item["target"]),
        }
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise PreflightError("unexpected findmnt JSON") from exc


def mount_for(path: Path) -> dict[str, str]:
    raw = command("findmnt", "-J", "-T", str(path), "-o", "SOURCE,FSTYPE,OPTIONS,TARGET")
    return parse_findmnt(raw)


def base_device(source: str) -> str:
    if not source.startswith("/dev/"):
        raise PreflightError("filesystem source is not a directly inspectable block device")
    pkname = command("lsblk", "-ndo", "PKNAME", source).strip()
    name = pkname or command("lsblk", "-ndo", "KNAME", source).strip()
    if not name or "/" in name:
        raise PreflightError("could not resolve backing block device")
    return name


def sysfs_text(path: Path) -> str:
    try:
        raw = path.read_text().strip()
    except OSError as exc:
        raise PreflightError(f"cannot read {path}: {exc}") from exc
    if not raw:
        raise PreflightError(f"empty storage attribute: {path}")
    return raw


def device_facts(device: str) -> dict[str, str]:
    queue = Path("/sys/class/block") / device / "queue"
    return {
        "device": device,
        "writeCache": sysfs_text(queue / "write_cache"),
        "rotational": sysfs_text(queue / "rotational"),
        "fua": sysfs_text(queue / "fua") if (queue / "fua").exists() else "unknown",
    }


def postgres_settings(container: str) -> dict[str, str]:
    if not CONTAINER_RE.fullmatch(container):
        raise PreflightError("invalid PostgreSQL container name")
    sql = (
        "SELECT name||'='||setting FROM pg_settings "
        "WHERE name IN ('fsync','full_page_writes','synchronous_commit','wal_sync_method') "
        "ORDER BY name;"
    )
    raw = command(
        "docker", "exec", "-i", container,
        "psql", "-X", "-qAt", "-U", "postgres", "-d", "xmesh", "-c", sql,
        timeout=20,
    )
    settings: dict[str, str] = {}
    for line in raw.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        settings[key] = value
    expected = {"fsync", "full_page_writes", "synchronous_commit", "wal_sync_method"}
    if set(settings) != expected:
        raise PreflightError("PostgreSQL durability settings are incomplete")
    return settings


def evaluate(role: str, mount: dict[str, str], device: dict[str, str], pg: dict[str, str] | None) -> tuple[list[str], list[str]]:
    failures: list[str] = []
    requirements: list[str] = []
    fstype = mount["fstype"].lower()
    options = {part.strip() for part in mount["options"].split(",") if part.strip()}

    if fstype in REJECTED_FS or fstype not in SUPPORTED_FS:
        failures.append(f"filesystem {fstype!r} is not in the reviewed ext4/xfs qualification set")
    if "ro" in options:
        failures.append("target filesystem is read-only")
    if "sync" in options:
        requirements.append("mount uses sync; still require real abrupt-power qualification")

    cache = device["writeCache"].lower()
    if "write back" in cache:
        requirements.append("write-back cache detected: independent controller/device power-loss-protection evidence is mandatory")
    elif "write through" in cache:
        requirements.append("write-through reported: still verify the virtualization/controller path with real abrupt-power tests")
    else:
        requirements.append(f"unrecognized write-cache mode {device['writeCache']!r}: physical qualification is mandatory")

    if role == ROLE_POSTGRES:
        if pg is None:
            failures.append("PostgreSQL settings were not supplied")
        else:
            if pg.get("fsync") != "on":
                failures.append("PostgreSQL fsync must be on")
            if pg.get("full_page_writes") != "on":
                failures.append("PostgreSQL full_page_writes must be on")
            if pg.get("synchronous_commit") not in SAFE_PG_SYNC:
                failures.append("PostgreSQL synchronous_commit is not durable enough for this qualification")
            if not pg.get("wal_sync_method"):
                failures.append("PostgreSQL wal_sync_method is unavailable")

    requirements.extend([
        "perform controlled abrupt host/power removal at every critical XSP-v2 durability checkpoint",
        "after each restart prove state is previous-complete or next-complete, never torn/lowered/fabricated",
        "retain the newest independent P0-E3a off-host checkpoint/pins outside the tested rollback domain",
    ])
    return failures, requirements


def inspect(role: str, target: Path, container: str | None) -> dict[str, Any]:
    mount = mount_for(target)
    device = device_facts(base_device(mount["source"]))
    pg = None
    if role == ROLE_POSTGRES:
        if not container:
            raise PreflightError("--postgres-container is required for nexus-postgres")
        pg = postgres_settings(container)
    failures, requirements = evaluate(role, mount, device, pg)
    return {
        "schema": SCHEMA,
        "role": role,
        "target": str(target),
        "kernel": command("uname", "-sr"),
        "mount": mount,
        "device": device,
        "postgres": pg,
        "baselineEligible": not failures,
        "physicalPowerLossQualified": False,
        "failures": failures,
        "requiredNextEvidence": requirements,
        "scope": "read-only baseline preflight; not physical power-loss qualification",
    }


def write_report(path: str, report: dict[str, Any]) -> None:
    out = Path(path)
    if not out.is_absolute() or str(out) != os.path.normpath(path):
        raise PreflightError("output path must be canonical and absolute")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(out, flags, 0o600)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(report, handle, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        try:
            out.unlink()
        except OSError:
            pass
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--role", required=True, choices=[ROLE_AGENT, ROLE_POSTGRES])
    parser.add_argument("--target", required=True)
    parser.add_argument("--postgres-container")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    try:
        if args.role == ROLE_AGENT and args.postgres_container:
            raise PreflightError("--postgres-container is invalid for agent-state")
        report = inspect(args.role, canonical_target(args.target), args.postgres_container)
        write_report(args.out, report)
    except (PreflightError, OSError, subprocess.SubprocessError) as exc:
        print(f"P0-E4a storage preflight failed closed: {exc}", file=sys.stderr)
        return 2

    print(json.dumps({
        "status": "baseline-eligible" if report["baselineEligible"] else "not-eligible",
        "physicalPowerLossQualified": False,
        "report": args.out,
    }, separators=(",", ":")))
    return 0 if report["baselineEligible"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
