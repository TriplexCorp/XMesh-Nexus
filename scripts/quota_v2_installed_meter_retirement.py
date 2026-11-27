"""Hosted-only extension to the already-qualified actual native TLS scenario.

After real signed revocation stopped native TLS, and after the original
nonempty WAL has been charged/read back, prove the original *meter* is
physically gone under durable full-roster denial. No release evidence,
positive issuer, refund or successor is generated.
"""
import hashlib
import json
import os
from pathlib import Path
import re

from quota_v2_installed_genesis_lease import canonical, parallel
from quota_v2_installed_namespace_candidate import PROOF, file_digest, reviewed_checkout
from quota_v2_installed_native_live import ENV, require_live

REV = "1b483a7dd12ef71e62db0ffd96af7bbcc99105c5"
MODULES = ("public_tls_wal_watch.py", "public_tls_meter_retirement.py")
SCRIPT = Path(__file__).with_name("quota_v2_meter_retirement_guest.py")
HASH = re.compile(r"[0-9a-f]{64}\Z")
TABLES = ("quota_v2_accounts", "quota_v2_reservations", "quota_v2_wal_charges",
          "quota_v2_external_wal_birth_anchors", "quota_v2_signed_first_cap_outbox",
          "quota_v2_public_tls_authority_outbox", "quota_v2_terminal_settlements")


def copy_retirement(guest, lab):
    require_live()
    source = reviewed_checkout("XMESH_RETIREMENT_SOURCE", REV)
    modules = source / "experiments/quota-v2-physical-stop"
    for item in [*(modules / name for name in MODULES), SCRIPT]:
        target = PROOF + "/" + item.name
        guest.exec("test", "!", "-e", target)
        lab.docker("cp", str(item), f"{guest.name}:{target}")
        guest.exec("chown", "0:0", target)
        guest.exec("chmod", "0600", target)
        assert guest.exec("sha256sum", target).split()[0].decode() == file_digest(item)


def sql_snapshot(db):
    require_live()
    # These are fixed tables from the actual disposable DB, not caller input.
    return {table: db.execute(
        "SELECT to_jsonb(t) FROM " + table + " t ORDER BY to_jsonb(t)::text").fetchall()
        for table in TABLES}


def committed_manifest(db, node):
    rows = db.execute(
        "SELECT DISTINCT ON(c.filename) c.filename,c.reservation_id::text,r.user_id,"
        "c.last_sequence,c.last_digest,c.stream_bytes,c.is_cdn "
        "FROM quota_v2_wal_charges c JOIN quota_v2_reservations r USING(reservation_id) "
        "WHERE r.node_id=%s ORDER BY c.filename,c.first_sequence DESC", (node,)).fetchall()
    assert len(rows) == 2 and len({row[0] for row in rows}) == 2
    fields = ("filename", "reservationId", "userId", "lastSequence",
              "lastDigest", "streamBytes", "isCdn")
    return hashlib.sha256(canonical([dict(zip(fields, row)) for row in rows])).hexdigest()


def verify_result(result, expected_runtime, expected_container, expected_started, users,
                  inventory, manifest):
    assert set(result) == {"kind", "runtimeId", "containerId", "startedAt", "signedWalReadbackSha256",
                           "inventorySha256", "committedChargeHeadsSha256", "durableUserDenials",
                           "originalMeterPidfdExited", "lifetimeLockReleased", "finalMeterVerified",
                           "settlementEligible", "canResume", "refundableBytes"}
    assert (result["kind"], result["runtimeId"], result["containerId"], result["startedAt"],
            result["inventorySha256"], result["committedChargeHeadsSha256"]) == (
        "xmesh.quota-v2.nonfinal-first-meter-retirement", expected_runtime,
        expected_container, expected_started, inventory, manifest)
    assert HASH.fullmatch(result["signedWalReadbackSha256"])
    assert set(result["durableUserDenials"]) == {str(uid) for uid in users}
    assert all(HASH.fullmatch(value) for value in result["durableUserDenials"].values())
    assert result["originalMeterPidfdExited"] is True and result["lifetimeLockReleased"] is True
    for flag in ("finalMeterVerified", "settlementEligible", "canResume"):
        assert result[flag] is False
    assert type(result["refundableBytes"]) is int and result["refundableBytes"] == 0


def retire_pair(pair, users, panel, db, lab, initial):
    require_live()
    before = sql_snapshot(db)
    assert before["quota_v2_terminal_settlements"] == []
    parallel(lambda guest: copy_retirement(guest, lab), pair)
    # Neither a TLS port closure nor caller's historical runtime ID is
    # sufficient. The guest independently remeasures its installed Xray.
    def retire(guest):
        result = guest.exec(*ENV, "XMESH_DISPOSABLE_FIRST_METER_RETIREMENT=1",
                            "python3", "-I", "-B", PROOF + "/" + SCRIPT.name,
                            panel, str(guest.node), str(next(iter(users))), timeout=60)
        return json.loads(result)

    results = parallel(retire, pair)
    for guest, result, original in zip(pair, results, initial):
        container, started, _pid, runtime = original
        anchors = db.execute(
            "SELECT inventory_sha256 FROM quota_v2_external_wal_birth_anchors "
            "WHERE node_id=%s ORDER BY inventory_sequence DESC LIMIT 1",
            (guest.node,)).fetchall()
        assert len(anchors) == 1
        verify_result(result, runtime, container, started, users, anchors[0][0],
                      committed_manifest(db, guest.node))
        assert not guest.exec("ss", "-Hltnp", "sport", "=", ":443").strip()
        assert not guest.exec("ss", "-Hltnp", "sport", "=", ":28401").strip()
    assert sql_snapshot(db) == before, "historical exit must not refund or issue spend authority"
    print("PASS: both exact original installed meter pidfds exited under durable complete "
          "signed-roster denial, unchanged committed WAL tails and SQL reserve; "
          "no terminal settlement, delivery or refund authority.", flush=True)
