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


def verify_monthly_cdn(db, dsn):
    mib = 1024 * 1024
    user = 2_637_315_401
    epoch = uuid4()
    total = 150 * mib
    db.execute("INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) VALUES (%s,%s,%s)",
               (user, epoch, (1 << 63) - 1))
    db.execute("INSERT INTO user_inbound_traffic_monthly VALUES "
               "(date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC')::date,%s,%s,0)",
               (user, 20 * mib))

    def remaining(tx, at=None):
        return tx.execute(
            "SELECT quota_v2_cdn_calendar_remaining(%s,%s,COALESCE(%s,statement_timestamp()))",
            (user, total, at),
        ).fetchone()[0]

    def reserve(node, scope, target, *, monthly=False, mixed_hold=0):
        reservation, meter = uuid4(), uuid4()
        with psycopg.connect(dsn) as tx:
            tx.execute("SELECT pg_advisory_xact_lock(%s)", (user ^ 0x51_4D_45_53_48,))
            until, = tx.execute(
                "SELECT LEAST(statement_timestamp()+interval '1 hour',"
                "upper(quota_v2_calendar_window('monthly',statement_timestamp())))"
            ).fetchone()
            if monthly:
                tx.execute(
                    "INSERT INTO quota_v2_cdn_calendar_bindings VALUES "
                    "(%s,'monthly',quota_v2_calendar_window('monthly',statement_timestamp()))",
                    (reservation,),
                )
            ids = (user, epoch, node, meter, reservation)
            tx.execute("SELECT quota_v2_reserve(%s,%s,%s,%s,%s,0,0,%s)", (*ids, until))
            if scope is not None:
                tx.execute("INSERT INTO quota_v2_reservation_classes VALUES (%s,%s,%s,%s)",
                           (reservation, user, node, scope))
            tx.execute("UPDATE quota_v2_reservations SET node_confirmed=true WHERE reservation_id=%s",
                       (reservation,))
            if scope == "cdn" and monthly:
                target = min(target, max(0, remaining(tx)))
            issued, = tx.execute(
                "SELECT ceiling_bytes FROM quota_v2_reserve(%s,%s,%s,%s,%s,%s,0,%s)",
                (*ids, target, until),
            ).fetchone()
            if mixed_hold:
                tx.execute("INSERT INTO quota_v2_mixed_cdn_holds VALUES (%s,%s,%s,%s)",
                           (reservation, user, node, mixed_hold))
            return issued

    assert reserve(10_381, None, 15 * mib) == 15 * mib
    assert reserve(10_382, "main", 64 * mib) == 64 * mib
    assert reserve(10_383, "mixed", 48 * mib, monthly=True, mixed_hold=15 * mib) == 48 * mib
    with ThreadPoolExecutor(max_workers=2) as workers:
        granted = list(workers.map(lambda node: reserve(node, "cdn", 64 * mib, monthly=True),
                                   (10_384, 10_385)))
    assert sorted(granted) == [36 * mib, 64 * mib], granted
    assert remaining(db) == 0
    assert reserve(10_386, "main", 64 * mib) == 64 * mib
    boundary, = db.execute(
        "SELECT upper(quota_v2_calendar_window('monthly',statement_timestamp()))"
    ).fetchone()
    assert remaining(db, boundary - timedelta(milliseconds=1)) == 0
    assert remaining(db, boundary) == 135 * mib  # Unbound reserve remains held.
    assert db.execute("SELECT SUM(ceiling_bytes) FROM quota_v2_reservations WHERE user_id=%s",
                      (user,)).fetchone() == (291 * mib,)
    print("PASS: 150 MiB monthly CDN pool conserves competing leases and mixed holds; MAIN stays independent")


def verify_shared_budget(db, dsn):
    mib = 1024 * 1024
    user = 2_637_315_402
    epoch = uuid4()
    budget = 1000 * mib
    db.execute("INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) VALUES (%s,%s,%s)",
               (user, epoch, budget))

    def spend_windows(node):
        ids = (user, epoch, node, uuid4(), uuid4())
        acknowledged = 0
        with psycopg.connect(dsn) as tx:
            with tx.transaction():
                tx.execute(
                    "SELECT quota_v2_reserve(%s,%s,%s,%s,%s,0,0,now()+interval '1 hour')", ids,
                )
                tx.execute("UPDATE quota_v2_reservations SET node_confirmed=true WHERE reservation_id=%s",
                           (ids[-1],))
            for _ in range(8):
                with tx.transaction():
                    request = (*ids, 64 * mib, acknowledged)
                    sql = ("SELECT ceiling_bytes FROM quota_v2_reserve"
                           "(%s,%s,%s,%s,%s,%s,%s,now()+interval '1 hour')")
                    ceiling, = tx.execute(sql, request).fetchone()
                    assert 0 <= ceiling - acknowledged <= 64 * mib
                    assert tx.execute(sql, request).fetchone() == (ceiling,)
                    for _ in range(2):
                        tx.execute("SELECT quota_v2_ack(%s,%s,%s,%s,%s,%s)", (*ids, ceiling))
                    acknowledged = ceiling
        return acknowledged

    with ThreadPoolExecutor(max_workers=2) as workers:
        assert sum(workers.map(spend_windows, (10_387, 10_388))) == budget
    assert db.execute("SELECT settled_bytes FROM quota_v2_accounts WHERE user_id=%s",
                      (user,)).fetchone() == (budget,)
    print("PASS: two competing Nodes settle an exact shared 1000 MiB SQL budget through retries")


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
        verify_monthly_cdn(db, dsn)
        verify_shared_budget(db, dsn)


if __name__ == "__main__":
    main()
