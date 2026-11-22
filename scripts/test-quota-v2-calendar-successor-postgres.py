#!/usr/bin/env python3
"""Disposable PostgreSQL regression for immutable ZERO-SPEND successor state.

This tests the real migration without granting traffic. Deliberately does NOT
pretend SQL can verify the Nexus Ed25519 signature or a live Xray runtime.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import psycopg


def must_refuse(connection, statement, params=()):
    try:
        with connection.transaction():
            connection.execute(statement, params)
    except psycopg.Error as error:
        # Reject only the intended constraints/immutability guards. Syntax,
        # missing relations or programming mistakes are test failures.
        assert error.sqlstate in {"22023", "23505", "23503", "23514"}, (
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
        issued = 1800000000000
        sample = (b'{"algorithm":"Ed25519","payload":{"kind":'
                  b'"xmesh.quota-v2.calendar-successor-prepared",'
                  b'"authorizedBytes":0,"canSpend":false,"canStart":false,'
                  b'"canResume":false,"finalMeterVerified":false,'
                  b'"refundableBytes":0},"signature":"' + b"0" * 128 + b'"}')
        db.execute(
            "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) VALUES(%s,%s,1000)",
            (user, epoch))
        db.execute(
            "INSERT INTO quota_v2_reservations "
            "(user_id,epoch,node_id,meter_epoch,reservation_id,valid_until) "
            "VALUES(%s,%s,%s,%s,%s,%s)",
            (user, epoch, node, meter, predecessor,
             datetime.now(timezone.utc) + timedelta(days=1)))
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
    print("PASS: successor planning is immutable, owner-bound and zero-spend")


if __name__ == "__main__":
    main()
