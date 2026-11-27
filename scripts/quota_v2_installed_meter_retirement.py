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

from quota_v2_retirement_evidence import (
    LEDGER_DIR, RECORD_DIR, read_private, verify_ledger, verify_record,
)

REV = "86a541a90ce7a4f1b50671ed6fde00c15a60bb68"
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
                           "settlementEligible", "canResume", "refundableBytes",
                           "schemaVersion", "nodeId", "retiredLedgerSha256",
                           "deliveredBytesVerified", "nodeSignatureVerified",
                           "canServePublic", "canStart"}
    assert (result["kind"], result["runtimeId"], result["containerId"], result["startedAt"],
            result["inventorySha256"], result["committedChargeHeadsSha256"]) == (
        "xmesh.quota-v2.nonfinal-first-meter-retirement", expected_runtime,
        expected_container, expected_started, inventory, manifest)
    assert HASH.fullmatch(result["signedWalReadbackSha256"])
    assert set(result["durableUserDenials"]) == {str(uid) for uid in users}
    assert all(HASH.fullmatch(value) for value in result["durableUserDenials"].values())
    assert result["originalMeterPidfdExited"] is True and result["lifetimeLockReleased"] is True
    for flag in ("finalMeterVerified", "settlementEligible", "canResume", "canStart",
                 "canServePublic", "deliveredBytesVerified", "nodeSignatureVerified"):
        assert result[flag] is False
    assert type(result["schemaVersion"]) is int and result["schemaVersion"] == 1
    assert type(result["nodeId"]) is int and result["nodeId"] > 0
    assert HASH.fullmatch(result["retiredLedgerSha256"])
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

    clock = "SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT"
    earliest, = db.execute(clock).fetchone()
    results = parallel(retire, pair)
    latest, = db.execute(clock).fetchone()
    challenges = set()
    for guest, result, original in zip(pair, results, initial):
        container, started, pid, runtime = original
        anchors = db.execute(
            "SELECT inventory_sequence,inventory_sha256,inventory_tail_digest,inventory_bytes "
            "FROM quota_v2_external_wal_birth_anchors "
            "WHERE node_id=%s ORDER BY inventory_sequence DESC LIMIT 1",
            (guest.node,)).fetchall()
        assert len(anchors) == 1
        seq, inventory_hash, tail, inventory = anchors[0]
        assert seq == 2 and hashlib.sha256(inventory).hexdigest() == inventory_hash
        manifest = committed_manifest(db, guest.node)
        verify_result(result, runtime, container, started, users, inventory_hash, manifest)
        assert result["nodeId"] == guest.node
        scope = db.execute(
            "SELECT activation_sha256,genesis_policy_sha256,profile_revision,cap_roster_sha256,runtime_id "
            "FROM quota_v2_public_tls_authority_outbox WHERE node_id=%s", (guest.node,)).fetchall()
        assert len(scope) == 1
        activation, genesis, profile, roster, sql_runtime = scope[0]
        assert sql_runtime == runtime
        expected = dict(nodeId=guest.node, userId=next(iter(users)), runtimeId=runtime,
                        activationReceiptSha256=activation, genesisPolicySha256=genesis,
                        profileRevision=profile, capRosterSha256=roster, containerId=container,
                        hostPid=pid, startedAt=started, inventorySequence=seq,
                        inventorySha256=inventory_hash, inventoryTailDigest=tail,
                        committedChargeStreamCount=seq, committedChargeHeadsSha256=manifest)
        record = read_private(guest, RECORD_DIR)
        name = "retired-" + runtime + ".json"
        assert set(record) == {name}, "extra or pending retirement records"
        witness = verify_record(record[name], result, expected, earliest, latest)
        assert witness["challenge"] not in challenges
        challenges.add(witness["challenge"])
        caps = {uid: bytes(raw) for uid, raw in db.execute(
            "SELECT user_id,signed_envelope FROM quota_v2_signed_first_cap_outbox "
            "WHERE node_id=%s ORDER BY user_id", (guest.node,))}
        assert set(caps) == set(users)
        # Reconstruct every committed raw stream from its exact immutable
        # SQL batches, not just the latest digest or a claimed byte count.
        streams, cursors = {}, {}
        for filename, first, last, journal in db.execute(
                "SELECT c.filename,c.first_sequence,c.last_sequence,c.journal "
                "FROM quota_v2_wal_charges c JOIN quota_v2_reservations r USING(reservation_id) "
                "WHERE r.node_id=%s ORDER BY c.filename,c.first_sequence", (guest.node,)):
            assert first == cursors.get(filename, 0) + 1 and last >= first
            raw = bytes(journal)
            assert raw.endswith(b"\n") and len(raw.splitlines()) == last - first + 1
            streams[filename] = streams.get(filename, b"") + raw
            cursors[filename] = last
        assert len(streams) == seq
        verify_ledger(read_private(guest, LEDGER_DIR), caps, streams, bytes(inventory),
                      result, guest.node, runtime)
        stopped = json.loads(guest.exec("docker", "inspect", "--type", "container",
                                        "--format", "{{json .}}", container))
        state = stopped["State"]
        assert stopped["Id"] == container and state["StartedAt"] == started
        assert state["Running"] is False and state["Restarting"] is False
        assert type(state["Pid"]) is int and state["Pid"] == 0 and state["ExitCode"] == 137
        assert stopped["HostConfig"]["NetworkMode"] == "none"
        assert stopped["HostConfig"]["RestartPolicy"]["Name"] == "no"
        assert not guest.exec("ss", "-Hltnp", "sport", "=", ":443").strip()
        assert not guest.exec("ss", "-Hltnp", "sport", "=", ":28401").strip()
    assert sql_snapshot(db) == before, "historical exit must not refund or issue spend authority"
    from quota_v2_retired_meter_recovery import verify_recovery_pair
    verify_recovery_pair(pair, panel, initial, lab)
    assert sql_snapshot(db) == before, "retired-meter recovery must not release or recreate authority"
    print("PASS: both exact original installed meter pidfds exited under durable complete "
          "signed-roster denial, unchanged committed WAL tails and SQL reserve; "
          "independent raw SQL-to-disk reconstruction and pinned Nexus signature matched "
          "each immutable private unsigned retirement record; no terminal settlement, "
          "delivery or refund authority.", flush=True)
