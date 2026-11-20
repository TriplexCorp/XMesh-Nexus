#!/usr/bin/env python3
"""CI-only independent Nexus validator and PostgreSQL WAL-birth registrar.

This registers signed FULL old-Xray WAL birth indexes *outside* the Node host.
It is NOT wired to production transport, quota settlement, or Xray admission.
A stored Node-signed index cannot prove final meter bytes, completed outbound
writes, or durable availability of a separate Nexus-signed recovery receipt.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

DOMAIN = b"XMESH_QUOTA_V2_OFFHOST_WAL_BIRTH_WITNESS_V1\x00"
KIND = "xmesh.quota-v2.offhost-wal-birth-witness"
MAX_INDEX = 4 << 20
MAX_WITNESS = 4096
MAX_ENTRIES = 4096
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
HEX128 = re.compile(r"[0-9a-f]{128}\Z")
EMAIL = re.compile(r"xmesh-u([1-9][0-9]{0,18})--([^\x00-\x20>]{1,128})\Z")
INDEX_FIELDS = ("schemaVersion", "sequence", "filename", "runtimeId",
                "email", "direction", "firstWalDigest", "previousDigest",
                "digest")
PAYLOAD_FIELDS = (
    "schemaVersion", "kind", "nodeId", "oldContainerId", "oldStartedAt",
    "inventorySequence", "inventorySha256", "inventoryTailDigest",
    "indexedWalCount", "localBirthsIndependentlyChecked", "nexusPersisted",
    "carryforwardApplied", "canResume", "finalMeterVerified",
    "refundableBytes",
)
INSERT = """SELECT * FROM quota_v2_register_offhost_birth_witness(
    %s,%s,%s,%s,%s,%s,%s,%s,%s)"""


def _unique(pairs):
    out = {}
    for key, val in pairs:
        if key in out:
            raise ValueError("duplicate WAL birth JSON key")
        out[key] = val
    return out


def _json(raw):
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique,
                          parse_constant=lambda _: (_ for _ in ()).throw(
                              ValueError("non-finite WAL inventory JSON")))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid WAL birth JSON") from exc


def _canonical(value, *, sort=True):
    return json.dumps(value, sort_keys=sort, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _hex64(value):
    return isinstance(value, str) and HEX64.fullmatch(value) is not None


def validate_index(raw):
    """Independently validate exact Go-ordered complete inventory, not WALs.

    Node must independently verify original WALs before signing; Nexus cannot
    inspect historical local WAL bytes from the signed index alone.
    """
    if (not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_INDEX or
            not raw.endswith(b"\n")):
        raise ValueError("missing complete off-host WAL index")
    lines = raw[:-1].split(b"\n")
    if not 0 < len(lines) <= MAX_ENTRIES:
        raise ValueError("unbounded Xray WAL births")
    previous = "0" * 64
    names = set()
    for count, line in enumerate(lines, 1):
        if not 0 < len(line) <= 1024:
            raise ValueError("oversized Xray birth entry")
        step = _json(line)
        if (not isinstance(step, dict) or tuple(step) != INDEX_FIELDS or
                _canonical(step, sort=False) != line or
                type(step["schemaVersion"]) is not int or
                step["schemaVersion"] != 1 or
                type(step["sequence"]) is not int or
                step["sequence"] != count or
                step["previousDigest"] != previous):
            raise ValueError("noncanonical or discontinuous Xray index")
        runtime = step["runtimeId"]
        email = step["email"]
        direction = step["direction"]
        if (not _hex64(runtime) or not isinstance(email, str) or
                not EMAIL.fullmatch(email) or any(c in email for c in "<>&") or
                direction not in ("uplink", "downlink") or
                not _hex64(step["firstWalDigest"]) or
                not _hex64(step["digest"])):
            raise ValueError("invalid Xray birth identity")
        filename = "meter-" + hashlib.sha256(
            (runtime + "\x00" + email + "\x00" + direction).encode("utf-8")
        ).hexdigest() + ".jsonl"
        if step["filename"] != filename or filename in names:
            raise ValueError("replayed or substituted Xray birth filename")
        names.add(filename)
        no_digest = dict(step)
        no_digest["digest"] = ""
        if hashlib.sha256(_canonical(no_digest, sort=False) + b"\n").hexdigest() != step["digest"]:
            raise ValueError("invalid old-Xray birth index chain digest")
        previous = step["digest"]
    return len(lines), previous


def _trusted_public_key(path):
    """Bind verification and DB key fingerprint to the exact same PEM bytes."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        mode = os.fstat(fd)
        if (not stat.S_ISREG(mode.st_mode) or mode.st_nlink != 1 or
                mode.st_mode & 0o022 or not 0 < mode.st_size <= 8192):
            raise ValueError("unsafe independently enrolled Node public key")
        data = os.read(fd, 8193)
        if len(data) != mode.st_size:
            raise ValueError("Node public key changed while reading")
        return data
    finally:
        os.close(fd)


def verify_node_birth(raw_witness, raw_index, expected_node, enrolled_public_key):
    if (not isinstance(raw_witness, bytes) or
            not 0 < len(raw_witness) <= MAX_WITNESS or
            not raw_witness.endswith(b"\n") or
            type(expected_node) is not int or expected_node <= 0):
        raise ValueError("invalid Node WAL-birth witness")
    envelope = _json(raw_witness)
    if (not isinstance(envelope, dict) or
            set(envelope) != {"payload", "algorithm", "signature"} or
            _canonical(envelope) + b"\n" != raw_witness or
            envelope["algorithm"] != "Ed25519" or
            not isinstance(envelope["signature"], str) or
            not HEX128.fullmatch(envelope["signature"])):
        raise ValueError("unsigned or noncanonical Node WAL witness")
    p = envelope["payload"]
    if (not isinstance(p, dict) or set(p) != set(PAYLOAD_FIELDS) or
            type(p["schemaVersion"]) is not int or p["schemaVersion"] != 1 or
            p["kind"] != KIND or type(p["nodeId"]) is not int or
            p["nodeId"] != expected_node or
            type(p["inventorySequence"]) is not int or
            type(p["indexedWalCount"]) is not int or
            p["indexedWalCount"] != p["inventorySequence"] or
            p["localBirthsIndependentlyChecked"] is not True or
            any(p[k] is not False for k in (
                "nexusPersisted", "carryforwardApplied", "canResume",
                "finalMeterVerified")) or
            type(p["refundableBytes"]) is not int or p["refundableBytes"] != 0 or
            not _hex64(p["oldContainerId"]) or
            not _hex64(p["inventorySha256"]) or
            not _hex64(p["inventoryTailDigest"]) or
            not isinstance(p["oldStartedAt"], str) or
            not 15 <= len(p["oldStartedAt"]) <= 64 or
            "T" not in p["oldStartedAt"]):
        raise ValueError("Node WAL witness claims unauthorized finality")
    sequence, tail = validate_index(raw_index)
    if (sequence != p["inventorySequence"] or
            tail != p["inventoryTailDigest"] or
            hashlib.sha256(raw_index).hexdigest() != p["inventorySha256"]):
        raise ValueError("Node witness does not commit to this exact index")
    pem = _trusted_public_key(enrolled_public_key)
    with tempfile.TemporaryDirectory(prefix="nexus-offhost-wal-") as directory:
        root = Path(directory)
        (root / "pub.pem").write_bytes(pem)
        (root / "message").write_bytes(DOMAIN + _canonical(p))
        (root / "signature").write_bytes(bytes.fromhex(envelope["signature"]))
        try:
            proc = subprocess.run([
                "openssl", "pkeyutl", "-verify", "-rawin", "-in",
                str(root / "message"), "-pubin", "-inkey",
                str(root / "pub.pem"), "-sigfile", str(root / "signature")],
                capture_output=True, timeout=10, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError("independent Node verifier unavailable") from exc
        if proc.returncode:
            raise ValueError("foreign or tampered Node WAL witness signature")
    return {
        "node_id": expected_node,
        "sequence": sequence,
        "inventory_sha256": p["inventorySha256"],
        "tail": tail,
        "public_key_sha256": hashlib.sha256(pem).hexdigest(),
        "old_container_id": p["oldContainerId"],
        "old_started_at": p["oldStartedAt"],
        "inventory": raw_index,
        "witness": raw_witness,
    }


def register_verified(conn, raw_witness, raw_index, trusted_node_id, trusted_node_key):
    """Return SQL row within caller transaction; caller MUST COMMIT separately.

    This function intentionally does not issue a signed Nexus ACK or tell the
    Node that an uncommitted transaction is remotely durable. A production
    authenticated admission/recovery path is NOT yet implemented.
    """
    p = verify_node_birth(raw_witness, raw_index, trusted_node_id, trusted_node_key)
    args = (p["node_id"], p["sequence"], p["inventory_sha256"], p["tail"],
            p["public_key_sha256"], p["old_container_id"], p["old_started_at"],
            p["inventory"], p["witness"])
    return conn.execute(INSERT, args).fetchone()


def verify_remote_recovery_blocker(conn, trusted_node_id, local_index,
                                   trusted_node_key):
    """CI-only evidence: current local Xray birth index extends Nexus row.

    Missing external row, missing local registry, or a shorter local prefix
    rejects recovery. Passing NEVER authorizes user re-admission or a refund.
    """
    row = conn.execute(
        "SELECT full_inventory,signed_node_witness FROM "
        "quota_v2_offhost_birth_witnesses WHERE node_id=%s "
        "ORDER BY inventory_sequence DESC LIMIT 1", (trusted_node_id,)
    ).fetchone()
    if row is None:
        raise ValueError("no independently committed offhost WAL history")
    remote_index, signed = row
    remote = verify_node_birth(signed, bytes(remote_index),
                               trusted_node_id, trusted_node_key)
    validate_index(local_index)
    if not local_index.startswith(remote["inventory"]):
        raise ValueError("local Xray WAL birth index rolled back behind Nexus")
    return {
        "externalBirthPrefixVerified": True,
        "localBirthIndexExtendsExternal": True,
        "xrayBytesFinal": False,
        "canResume": False,
        "refundableBytes": 0,
    }
