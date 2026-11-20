#!/usr/bin/env python3
"""CI-only Nexus Ed25519 ACK for a COMMITTED off-host WAL-birth registration.

Always commit and independently re-read PostgreSQL BEFORE signing. This
ACK is NONFINAL: not an authorization to re-admit an Xray user, apply byte
carryforward, release reservation or refund usage. Production sender, Node
recovery transport and externally provisioned keys are deliberately absent.
"""
import hashlib
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

import psycopg
from psycopg.rows import dict_row

import quota_v2_offhost_wal_registration as births

DOMAIN = b"XMESH_QUOTA_V2_OFFHOST_WAL_BIRTH_RECORDED_V1\x00"
KIND = "xmesh.quota-v2.offhost-wal-birth-recorded"
MAX_RECEIPT = 4096
RECEIPT_FIELDS = (
    "schemaVersion", "kind", "nodeId", "inventorySequence",
    "inventorySha256", "inventoryTailDigest", "oldContainerId",
    "oldStartedAt", "nodePublicKeySha256", "originalNodeWitnessSha256",
    "previousInventorySha256", "committedAt", "nexusRegistrationCommitted",
    "nodeBirthIndexIndependentlyValidated", "allOutboundWritersFinal",
    "carryforwardApplied", "canResume", "finalMeterVerified", "refundableBytes",
)
QUERY = """SELECT node_id,inventory_sequence,inventory_sha256,
 inventory_tail_digest,node_public_key_sha256,old_container_id,
 old_started_at,full_inventory,signed_node_witness,
 previous_inventory_sha256,committed_at
 FROM quota_v2_offhost_birth_witnesses
 WHERE node_id=%s AND inventory_sequence=%s"""


def _read_registered(conn, node, sequence):
    return conn.execute(QUERY, (node, sequence)).fetchone()


def _exact_row(row, source):
    """Compare independently committed full bytes and every signed identity."""
    if row is None:
        raise ValueError("Nexus has no committed off-host WAL birth witness")
    for col, want in (
        ("node_id", source["node_id"]),
        ("inventory_sequence", source["sequence"]),
        ("inventory_sha256", source["inventory_sha256"]),
        ("inventory_tail_digest", source["tail"]),
        ("node_public_key_sha256", source["public_key_sha256"]),
        ("old_container_id", source["old_container_id"]),
        ("old_started_at", source["old_started_at"]),
        ("full_inventory", source["inventory"]),
        ("signed_node_witness", source["witness"]),
    ):
        if row[col] != want:
            raise ValueError("stored Nexus WAL birth differs from verified Node source")
    previous = row["previous_inventory_sha256"]
    if previous is not None and not births._hex64(previous):
        raise ValueError("corrupted off-host WAL prefix parent hash")
    return row


def _payload(row, source):
    return {
        "schemaVersion": 1, "kind": KIND,
        "nodeId": source["node_id"], "inventorySequence": source["sequence"],
        "inventorySha256": source["inventory_sha256"],
        "inventoryTailDigest": source["tail"],
        "oldContainerId": source["old_container_id"],
        "oldStartedAt": source["old_started_at"],
        "nodePublicKeySha256": source["public_key_sha256"],
        "originalNodeWitnessSha256": hashlib.sha256(source["witness"]).hexdigest(),
        "previousInventorySha256": row["previous_inventory_sha256"] or "",
        "committedAt": row["committed_at"].isoformat(),
        "nexusRegistrationCommitted": True,
        "nodeBirthIndexIndependentlyValidated": True,
        "allOutboundWritersFinal": False,
        "carryforwardApplied": False,
        "canResume": False,
        "finalMeterVerified": False,
        "refundableBytes": 0,
    }


def _validate(p):
    if (not isinstance(p, dict) or set(p) != set(RECEIPT_FIELDS) or
            type(p["schemaVersion"]) is not int or p["schemaVersion"] != 1 or
            p["kind"] != KIND or type(p["nodeId"]) is not int or
            p["nodeId"] <= 0 or type(p["inventorySequence"]) is not int or
            not 1 <= p["inventorySequence"] <= births.MAX_ENTRIES or
            p["nexusRegistrationCommitted"] is not True or
            p["nodeBirthIndexIndependentlyValidated"] is not True or
            any(p[name] is not False for name in (
                "allOutboundWritersFinal", "carryforwardApplied",
                "canResume", "finalMeterVerified")) or
            type(p["refundableBytes"]) is not int or p["refundableBytes"] != 0):
        raise ValueError("Nexus offhost birth receipt may not authorize user/bytes")
    for name in ("inventorySha256", "inventoryTailDigest", "oldContainerId",
                 "nodePublicKeySha256", "originalNodeWitnessSha256"):
        if not births._hex64(p[name]):
            raise ValueError("Nexus offhost receipt invalid original byte digest")
    prev = p["previousInventorySha256"]
    if prev != "" and not births._hex64(prev):
        raise ValueError("invalid previous independently persisted WAL prefix")
    if (not isinstance(p["oldStartedAt"], str) or
            not 15 <= len(p["oldStartedAt"]) <= 64 or "T" not in p["oldStartedAt"] or
            not isinstance(p["committedAt"], str) or
            not 15 <= len(p["committedAt"]) <= 64 or "T" not in p["committedAt"]):
        raise ValueError("invalid recorded Xray/Nexus time identity")
    return p


def _sign(private_key_path, payload):
    """Use one owner-private, single-linked, NOFOLLOW Nexus Ed25519 key."""
    fd = os.open(private_key_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or
                info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600):
            raise ValueError("unsafe private Nexus offhost receipt signer")
        with tempfile.TemporaryDirectory(prefix="nexus-offhost-sign-") as directory:
            message = Path(directory) / "message"
            message.write_bytes(DOMAIN + births._canonical(payload))
            try:
                output = subprocess.run([
                    "openssl", "pkeyutl", "-sign", "-rawin",
                    "-in", str(message), "-inkey", "/proc/self/fd/" + str(fd)],
                    pass_fds=(fd,), capture_output=True, timeout=10, check=False)
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise ValueError("Nexus offhost receipt signer unavailable") from exc
            if output.returncode or len(output.stdout) != 64:
                raise ValueError("Nexus offhost receipt Ed25519 sign failed")
            return output.stdout.hex()
    finally:
        os.close(fd)


def register_commit_then_sign(dsn, exact_node_witness, complete_index,
                              trusted_node_id, enrolled_node_public_key,
                              trusted_nexus_private_key):
    """The DB COMMIT precedes any signed ACK: no uncommitted success receipt.

    Use a separately configured, trusted database DSN and identities. A
    production API/transport is NOT provided by this fixture.
    """
    source = births.verify_node_birth(
        exact_node_witness, complete_index, trusted_node_id,
        enrolled_node_public_key)
    with psycopg.connect(dsn) as connection:
        births.register_verified(connection, exact_node_witness, complete_index,
                                 trusted_node_id, enrolled_node_public_key)
    # Exiting the context succeeded: PostgreSQL acknowledged COMMIT.
    # Reconnect and reread from the independent DB, not a caller-supplied
    # signed data claim or uncommitted in-memory row.
    with psycopg.connect(dsn, row_factory=dict_row) as connection:
        row = _exact_row(
            _read_registered(connection, trusted_node_id, source["sequence"]), source)
        payload = _validate(_payload(row, source))
    envelope = {"algorithm": "Ed25519", "payload": payload,
                "signature": _sign(trusted_nexus_private_key, payload)}
    raw = births._canonical(envelope) + b"\n"
    if len(raw) > MAX_RECEIPT:
        raise ValueError("Nexus offhost receipt exceeds signed record limit")
    return raw


def verify_receipt(raw_receipt, raw_node_witness, complete_index,
                   trusted_node_id, enrolled_node_public_key,
                   enrolled_nexus_public_key):
    source = births.verify_node_birth(raw_node_witness, complete_index,
                                      trusted_node_id, enrolled_node_public_key)
    if (not isinstance(raw_receipt, bytes) or
            not 0 < len(raw_receipt) <= MAX_RECEIPT or
            not raw_receipt.endswith(b"\n")):
        raise ValueError("missing canonical Nexus off-host birth ACK")
    doc = births._json(raw_receipt)
    if (not isinstance(doc, dict) or
            set(doc) != {"algorithm", "payload", "signature"} or
            births._canonical(doc) + b"\n" != raw_receipt or
            doc["algorithm"] != "Ed25519" or
            not isinstance(doc["signature"], str) or
            births.HEX128.fullmatch(doc["signature"]) is None):
        raise ValueError("unsigned or noncanonical Nexus offhost ACK")
    p = _validate(doc["payload"])
    expected = {
        "nodeId": source["node_id"],
        "inventorySequence": source["sequence"],
        "inventorySha256": source["inventory_sha256"],
        "inventoryTailDigest": source["tail"],
        "oldContainerId": source["old_container_id"],
        "oldStartedAt": source["old_started_at"],
        "nodePublicKeySha256": source["public_key_sha256"],
        "originalNodeWitnessSha256": hashlib.sha256(source["witness"]).hexdigest(),
    }
    for name, want in expected.items():
        if p[name] != want or type(p[name]) is not type(want):
            raise ValueError("replayed or substituted Nexus offhost birth ACK")
    pem = births._trusted_public_key(enrolled_nexus_public_key)
    with tempfile.TemporaryDirectory(prefix="nexus-offhost-verify-") as directory:
        root = Path(directory)
        (root / "pub.pem").write_bytes(pem)
        (root / "message").write_bytes(DOMAIN + births._canonical(p))
        (root / "signature").write_bytes(bytes.fromhex(doc["signature"]))
        try:
            result = subprocess.run([
                "openssl", "pkeyutl", "-verify", "-rawin", "-in",
                str(root / "message"), "-pubin", "-inkey", str(root / "pub.pem"),
                "-sigfile", str(root / "signature")],
                capture_output=True, timeout=10, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError("independent Nexus public key verifier unavailable") from exc
        if result.returncode:
            raise ValueError("Nexus offhost signed receipt authentication failed")
    return p


def verify_receipt_against_committed_db(connection, raw_receipt,
                                        raw_node_witness, complete_index,
                                        trusted_node_id, enrolled_node_public_key,
                                        enrolled_nexus_public_key):
    """Require authenticated Nexus ACK AND the still-present actual DB row."""
    p = verify_receipt(raw_receipt, raw_node_witness, complete_index,
                       trusted_node_id, enrolled_node_public_key,
                       enrolled_nexus_public_key)
    src = births.verify_node_birth(raw_node_witness, complete_index,
                                   trusted_node_id, enrolled_node_public_key)
    with connection.cursor(row_factory=dict_row) as cursor:
        row = _exact_row(cursor.execute(
            QUERY, (trusted_node_id, src["sequence"])).fetchone(), src)
    if _payload(row, src) != p:
        raise ValueError("Nexus signed ACK differs from current immutable DB row")
    return {
        "nexusSignatureVerified": True,
        "nodeSignatureVerified": True,
        "originalIndexStillOffhost": True,
        "canResume": False,
        "allOutboundWritersFinal": False,
        "refundableBytes": 0,
    }
