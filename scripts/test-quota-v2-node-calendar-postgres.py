"""Disposable test of the real calendar binding and serialized quota allocator."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
import os
from urllib.parse import urlsplit
from uuid import uuid4

import psycopg


def verify_boundaries(db):
    now = "2028-03-01T00:25:00+01:00"  # February 29 in UTC, despite the input's offset.
    db.execute("SET TIME ZONE 'America/New_York'")
    for period, start, end in (
        ("daily", "2028-02-29", "2028-03-01"),
        ("weekly", "2028-02-28", "2028-03-06"),
        ("monthly", "2028-02-01", "2028-03-01"),
    ):
        row = db.execute(
            "SELECT lower(w)=((%s::date)::timestamp AT TIME ZONE 'UTC'), "
            "upper(w)=((%s::date)::timestamp AT TIME ZONE 'UTC'), "
            "NOT w @> upper(w) FROM (SELECT quota_v2_calendar_window(%s,%s) w) bounds",
            (start, end, period, now),
        ).fetchone()
        assert row == (True, True, True), (period, row)


def main():
    dsn = os.environ["QUOTA_TEST_DSN"]
    assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
    assert urlsplit(dsn).hostname == "127.0.0.1"
    user = 2_637_315_400
    nodes = (10_371, 10_372)
    epoch = uuid4()
    with psycopg.connect(dsn, autocommit=True) as db:
        verify_boundaries(db)
        db.execute("INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) VALUES (%s,%s,150)",
                   (user, epoch))
        for node in nodes:
            db.execute(
                "INSERT INTO user_node_quota_daily(day_start,node_id,user_id,uplink_bytes,downlink_bytes) "
                "VALUES ((statement_timestamp() AT TIME ZONE 'UTC')::date,%s,%s,2,3)",
                (node, user),
            )

        def allocate(node):
            reservation, meter = uuid4(), uuid4()
            with psycopg.connect(dsn) as tx:
                tx.execute("SELECT pg_advisory_xact_lock(%s)", (user ^ 0x51_4D_45_53_48,))
                until, = tx.execute(
                    "INSERT INTO quota_v2_node_calendar_bindings(reservation_id,period,calendar_window) "
                    "VALUES (%s,'daily',quota_v2_calendar_window('daily',statement_timestamp())) "
                    "RETURNING upper(calendar_window)", (reservation,),
                ).fetchone()
                tx.execute("SELECT quota_v2_reserve(%s,%s,%s,%s,%s,0,0,%s)",
                           (user, epoch, node, meter, reservation, until))
                tx.execute("UPDATE quota_v2_reservations SET node_confirmed=true WHERE reservation_id=%s",
                           (reservation,))
                free, = tx.execute(
                    "SELECT quota_v2_node_calendar_remaining(%s,%s,'daily',90,statement_timestamp())",
                    (user, node),
                ).fetchone()
                cap, = tx.execute("SELECT ceiling_bytes FROM quota_v2_reserve(%s,%s,%s,%s,%s,%s,0,%s)",
                                  (user, epoch, node, meter, reservation, free, until)).fetchone()
                return node, reservation, meter, until, cap

        with ThreadPoolExecutor(max_workers=2) as workers:
            grants = list(workers.map(allocate, nodes))
        assert sorted(row[-1] for row in grants) == [65, 85], grants
        db.execute("UPDATE quota_v2_accounts SET closed=true WHERE user_id=%s", (user,))
        for node, reservation, meter, until, cap in grants:
            for delta, expected in (
                (timedelta(milliseconds=-1), 85 - cap),
                (timedelta(), 90),
            ):
                actual, = db.execute("SELECT quota_v2_node_calendar_remaining(%s,%s,'daily',90,%s)",
                                     (user, node, until + delta)).fetchone()
                assert actual == expected, (node, actual, expected)
            overlap, = db.execute(
                "SELECT quota_v2_node_calendar_remaining(%s,%s,'monthly',90,%s)",
                (user, node, until - timedelta(milliseconds=1)),
            ).fetchone()
            assert overlap == 90 - cap
            try:
                db.execute("UPDATE quota_v2_reservations SET valid_until=%s"
                           " WHERE reservation_id=%s", (until + timedelta(seconds=1), reservation))
            except psycopg.errors.CheckViolation:
                pass
            else:
                raise AssertionError("old reservation crossed its period boundary")
            database_ms, = db.execute(
                "SELECT (extract(epoch FROM statement_timestamp())*1000)::bigint"
            ).fetchone()
            expiry_ms = int(until.timestamp()) * 1000
            raw = json.dumps({
                "payload": {"issuedAtMs": database_ms, "validUntilMs": expiry_ms + 1},
                # Exercise SQL field checks independently of Ed25519 signing.
                "signature": "a" * 128,
            }).encode()
            try:
                db.execute("INSERT INTO quota_v2_cap_renewals "
                           "(reservation_id,revision,nonce,grant_bytes,signed_envelope) "
                           "VALUES (%s,10,%s,%s,%s)", (reservation, "b" * 64, cap, raw))
            except psycopg.errors.CheckViolation:
                pass
            else:
                raise AssertionError("outbox accepted a cross-period signed deadline")
            db.execute("SELECT quota_v2_ack(%s,%s,%s,%s,%s,%s)",
                       (user, epoch, node, meter, reservation, cap))
        assert db.execute("SELECT settled_bytes,closed FROM quota_v2_accounts WHERE user_id=%s",
                          (user,)).fetchone() == (150, True)
        assert db.execute("SELECT count(*) FROM quota_v2_node_calendar_bindings WHERE reservation_id=ANY(%s)",
                          ([row[1] for row in grants],)).fetchone() == (2,)
        print("PASS: UTC boundaries, concurrent Node funding, immutable deadlines and historical debt")


if __name__ == "__main__":
    main()
