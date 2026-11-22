#!/usr/bin/env python3
"""Disposable PostgreSQL regression for immutable ZERO-SPEND successor state.

This tests the real migration without granting traffic. Deliberately does NOT
pretend SQL can verify the Nexus Ed25519 signature or a live Xray runtime.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import psycopg


def must_refuse(connection, statement, params=(), states=None):
    try:
        with connection.transaction():
            connection.execute(statement, params)
    except psycopg.Error as error:
        # Reject only the intended constraints/immutability guards. Syntax,
        # missing relations or programming mistakes are test failures.
        assert error.sqlstate in (states or {"22023", "23505", "23503", "23514"}), (
            "unexpected SQL failure instead of an immutability denial",
            error.sqlstate,
        )
        return
    raise AssertionError("immutable successor SQL accepted forbidden write")


def main():
    with psycopg.connect(os.environ["QUOTA_TEST_DSN"], autocommit=True) as db:
        user = 8700000000 + uuid.uuid4().int % 1000000000
        node = 8700000000 + uuid.uuid4().int % 1000000000
        epoch, meter, predecessor = (uuid.uuid4() for _ in range(3))
        next_meter, next_reservation = (uuid.uuid4() for _ in range(2))
        issued = int(datetime.now(timezone.utc).timestamp() * 1000)
        sample = (b'{"algorithm":"Ed25519","payload":{"kind":'
                  b'"xmesh.quota-v2.calendar-successor-prepared",'
                  b'"authorizedBytes":0,"canSpend":false,"canStart":false,'
                  b'"canResume":false,"finalMeterVerified":false,'
                  b'"refundableBytes":0},"signature":"' + b"0" * 128 + b'"}')
        db.execute(
            "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) VALUES(%s,%s,1000)",
            (user, epoch))
        boundary = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.execute(
            "INSERT INTO quota_v2_reservations "
            "(user_id,epoch,node_id,meter_epoch,reservation_id,valid_until) "
            "VALUES(%s,%s,%s,%s,%s,%s)",
            (user, epoch, node, meter, predecessor, boundary))
        cols = (
            "predecessor_id,node_id,user_id,request_challenge,signer_public_key,"
            "account_epoch,predecessor_runtime_id,policy_sha256,"
            "candidate_meter_epoch,candidate_reservation_id,"
            "issued_at_ms,valid_until_ms,signed_envelope"
        )
        row = (predecessor, node, user, "a" * 64, "b" * 64, epoch,
               "c" * 64, "d" * 64, next_meter, next_reservation,
               issued, issued + 60000, sample)
        insert = ("INSERT INTO quota_v2_calendar_successor_preparations "
                  f"({cols}) VALUES ({','.join(['%s'] * 13)})")
        # The SQL stage must refuse an identity without a committed
        # observation of the old calendar boundary.
        must_refuse(db, insert, row, {"23514"})
        db.execute(
            "INSERT INTO quota_v2_calendar_closures "
            "(reservation_id,boundary_at,observed_at) VALUES(%s,%s,%s)",
            (predecessor, boundary, datetime.now(timezone.utc)))
        def altered(index, value):
            copy = list(row)
            copy[index] = value
            return tuple(copy)
        for invalid in (
            altered(1, node + 1),  # foreign Node
            altered(2, user + 1),  # foreign user
            altered(5, uuid.uuid4()),  # wrong account epoch
            altered(8, meter),  # reuse old WAL meter epoch
            altered(9, meter),  # reuse meter epoch as candidate reservation
        ):
            must_refuse(db, insert, invalid, {"23514"})
        # Keep a perfectly valid 60-second lifetime: rejection must be
        # caused by the CLOSED window, not an unrelated lifetime CHECK.
        too_early = list(row)
        too_early[10] = int(boundary.timestamp() * 1000) - 1
        too_early[11] = too_early[10] + 60_000
        must_refuse(db, insert, tuple(too_early), {"23514"})
        from_the_future = list(row)
        from_the_future[10] = issued + 3_600_000
        from_the_future[11] = from_the_future[10] + 60_000
        must_refuse(db, insert, tuple(from_the_future), {"23514"})
        db.execute(insert, row)
        saved = db.execute(
            "SELECT signed_envelope FROM quota_v2_calendar_successor_preparations "
            "WHERE predecessor_id=%s", (predecessor,)).fetchone()
        assert saved == (sample,), "immutable signed bytes changed"
        must_refuse(db, insert, row)
        must_refuse(db, insert, (uuid.uuid4(),) + row[1:])
        must_refuse(db,
                    "UPDATE quota_v2_calendar_successor_preparations "
                    "SET request_challenge=request_challenge WHERE predecessor_id=%s",
                    (predecessor,))
        must_refuse(db,
                    "DELETE FROM quota_v2_calendar_successor_preparations "
                    "WHERE predecessor_id=%s", (predecessor,))
        must_refuse(db, "TRUNCATE quota_v2_calendar_successor_preparations")
        assert db.execute(
            "SELECT count(*) FROM quota_v2_calendar_successor_preparations "
            "WHERE predecessor_id=%s", (predecessor,)).fetchone() == (1,)
        # The new staging journal cannot independently issue a spendable cap.
        assert db.execute(
            "SELECT count(*) FROM quota_v2_signed_first_cap_outbox "
            "WHERE reservation_id=%s", (next_reservation,)).fetchone() == (0,)
        # A signed zero-spend preparation cannot confer an isolated runtime.
        empty_sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        cols = (
            "predecessor_id,node_id,user_id,account_epoch,"
            "candidate_meter_epoch,candidate_reservation_id,"
            "fresh_runtime_id,fresh_container_id,fresh_started_at,fresh_host_pid,"
            "fresh_executable_sha256,fresh_config_sha256,fresh_wal_inventory_sha256,"
            "zero_initial_raw_counters,isolated_new_wal_root,"
            "authorized_bytes,can_spend,can_start,can_resume,"
            "final_meter_verified,refundable_bytes"
        )
        statement = (
            "INSERT INTO quota_v2_calendar_successor_meter_preflights "
            f"({cols}) VALUES({','.join(['%s'] * 21)})"
        )
        fresh = (
            predecessor, node, user, epoch,
            next_meter, next_reservation, "e" * 64, "f" * 64,
            datetime.now(timezone.utc), 912345, "1" * 64, "2" * 64,
            empty_sha, True, True, 0, False, False, False, False, 0,
        )
        def altered_fresh(index, value):
            args = list(fresh)
            args[index] = value
            return tuple(args)
        for bad in (
            altered_fresh(0, uuid.uuid4()),
            altered_fresh(1, node + 1),
            altered_fresh(2, user + 1),
            altered_fresh(3, uuid.uuid4()),
            altered_fresh(4, meter),
            altered_fresh(4, uuid.uuid4()),
            altered_fresh(5, uuid.uuid4()),
            altered_fresh(6, "c" * 64),
            altered_fresh(7, "0" * 64),
            altered_fresh(8, datetime(1960, 1, 1, tzinfo=timezone.utc)),
            altered_fresh(8, datetime.now(timezone.utc) + timedelta(hours=1)),
            altered_fresh(9, 0),
            altered_fresh(10, "0" * 64),
            altered_fresh(11, "0" * 64),
            altered_fresh(12, "3" * 64),
            altered_fresh(13, False),
            altered_fresh(14, False),
            altered_fresh(15, 1),
            altered_fresh(16, True),
            altered_fresh(17, True),
            altered_fresh(18, True),
            altered_fresh(19, True),
            altered_fresh(20, 1),
        ):
            must_refuse(db, statement, bad, {"23514", "23503"})
        db.execute(statement, fresh)
        saved = db.execute(
            "SELECT candidate_meter_epoch,candidate_reservation_id,"
            "fresh_runtime_id,authorized_bytes,can_spend,can_start,can_resume "
            "FROM quota_v2_calendar_successor_meter_preflights "
            "WHERE predecessor_id=%s", (predecessor,)).fetchone()
        assert saved == (next_meter, next_reservation, "e" * 64, 0,
                         False, False, False)
        must_refuse(db, statement, fresh, {"23505"})
        must_refuse(db,
                    "UPDATE quota_v2_calendar_successor_meter_preflights "
                    "SET fresh_host_pid=fresh_host_pid WHERE predecessor_id=%s",
                    (predecessor,), {"22023"})
        must_refuse(db,
                    "DELETE FROM quota_v2_calendar_successor_meter_preflights "
                    "WHERE predecessor_id=%s", (predecessor,), {"22023"})
        must_refuse(db, "TRUNCATE quota_v2_calendar_successor_meter_preflights",
                    (), {"22023"})
        assert db.execute(
            "SELECT count(*) FROM quota_v2_reservations "
            "WHERE reservation_id=%s OR meter_epoch=%s",
            (next_reservation, next_meter)).fetchone() == (0,)
        must_refuse(db,
                    "INSERT INTO quota_v2_signed_first_cap_outbox "
                    "(reservation_id) VALUES (%s)", (next_reservation,),
                    {"23514"})
        must_refuse(db,
                    "INSERT INTO quota_v2_cap_renewals "
                    "(reservation_id,revision,nonce,grant_bytes,signed_envelope) "
                    "VALUES (%s,1,%s,1,%s)",
                    (next_reservation, "0" * 64, b"0" * 200), {"23514"})
        # Two independent users may enter ONE newly isolated Xray process.
        # Per-user predecessor/reservation/WAL identities must stay distinct.
        user2 = user + 1
        epoch2, meter2, predecessor2 = (uuid.uuid4() for _ in range(3))
        candidate_meter2, candidate_reservation2 = (uuid.uuid4() for _ in range(2))
        db.execute(
            "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) "
            "VALUES(%s,%s,1000)", (user2, epoch2))
        db.execute(
            "INSERT INTO quota_v2_reservations "
            "(user_id,epoch,node_id,meter_epoch,reservation_id,valid_until) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (user2, epoch2, node, meter2, predecessor2, boundary))
        db.execute(
            "INSERT INTO quota_v2_calendar_closures "
            "(reservation_id,boundary_at,observed_at) VALUES(%s,%s,%s)",
            (predecessor2, boundary, datetime.now(timezone.utc)))
        second_prepared = (
            predecessor2, node, user2, "9" * 64, "b" * 64, epoch2,
            "c" * 64, "d" * 64, candidate_meter2, candidate_reservation2,
            issued, issued + 60000, sample,
        )
        db.execute(insert, second_prepared)
        second_fresh = list(fresh)
        for index, val in (
            (0, predecessor2), (2, user2), (3, epoch2),
            (4, candidate_meter2), (5, candidate_reservation2),
            (8, fresh[8]),
        ):
            second_fresh[index] = val
        inconsistent = list(second_fresh)
        inconsistent[8] = datetime.now(timezone.utc)
        must_refuse(db, statement, tuple(inconsistent), {"23514"})
        inconsistent = list(second_fresh)
        inconsistent[11] = "3" * 64
        must_refuse(db, statement, tuple(inconsistent), {"23514"})
        db.execute(statement, tuple(second_fresh))
        assert db.execute(
            "SELECT count(*) FROM quota_v2_calendar_successor_meter_preflights "
            "WHERE node_id=%s AND fresh_runtime_id=%s AND fresh_container_id=%s",
            (node, "e" * 64, "f" * 64)).fetchone() == (2,)
        assert db.execute(
            "SELECT count(*) FROM quota_v2_reservations WHERE "
            "reservation_id IN (%s,%s)",
            (next_reservation, candidate_reservation2)).fetchone() == (0,)
    print("PASS: zero-spend calendar successor and immutable fresh-meter candidate only")


if __name__ == "__main__":
    main()
