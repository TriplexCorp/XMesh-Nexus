#!/usr/bin/env python3
"""Disposable PostgreSQL lifetime Node/CDN ledger invariants.

This independently tests immutable classification, conservative historic
liability, and two concurrently reserved CDN Nodes. It complements (does
not replace) the installed Agent/Xray/VLESS end-to-end acceptance.
"""
import concurrent.futures
import os
from pathlib import Path
import re
import unittest
import uuid

import psycopg

if os.getenv("XMESH_AUDIT_DISPOSABLE") != "1":
    raise SystemExit("refusing to run outside disposable PostgreSQL CI")

DSN = os.environ["QUOTA_TEST_DSN"]
USER = 82497031
EPOCH = uuid.UUID("dddddddd-aaaa-4bbb-8ccc-000000000001")
CDN_LIMIT = 1_500_000
BASELINE = 500_000
ACCOUNT_LIMIT = 4_000_000


def production_cdn_issued_sql():
    source = (Path(__file__).resolve().parents[1]
              / "backend/src/quota_v2_cdn_lifetime.rs").read_text()
    headroom = source.split("pub async fn headroom(", 1)[1].split(
        "pub async fn bounded_target(", 1)[0]
    match = re.search(
        r'let issued: i64 = sqlx::query_scalar\(\s*"([^"]+)"',
        headroom, re.DOTALL,
    )
    if match is None:
        raise AssertionError("production CDN liability SQL was not found")
    return match.group(1)


def locked_grant(node, amount):
    with psycopg.connect(DSN) as db:
        db.execute("SELECT pg_advisory_xact_lock(%s)", (USER ^ 0x51_4D_45_53_48,))
        account = db.execute(
            "SELECT limit_bytes FROM quota_v2_accounts "
            "WHERE user_id=%s AND epoch=%s FOR UPDATE", (USER,EPOCH)
        ).fetchone()
        assert account == (ACCOUNT_LIMIT,), account
        # Execute the exact SQL used by Nexus inside the same account lock.
        # Copying its logic into the test could hide a real allocator bypass.
        db.execute(
            "PREPARE xmesh_cdn_issued(bigint) AS "
            + production_cdn_issued_sql()
        )
        committed = db.execute(
            f"EXECUTE xmesh_cdn_issued({USER})"
        ).fetchone()[0]
        free = max(0,CDN_LIMIT-BASELINE-committed)
        ceiling = min(amount, free)
        meter, reserve = uuid.uuid4(), uuid.uuid4()
        actual = db.execute(
            "SELECT ceiling_bytes FROM quota_v2_reserve("
            "%s,%s,%s,%s,%s,%s,%s,NOW()+interval '2 hours')",
            (USER,EPOCH,node,meter,reserve,ceiling,0)
        ).fetchone()[0]
        assert actual == ceiling, (node, actual, ceiling)
        db.execute(
            "INSERT INTO quota_v2_reservation_classes"
            "(reservation_id,user_id,node_id,class) VALUES(%s,%s,%s,'cdn')",
            (reserve,USER,node)
        )
        return reserve,actual


class LifetimeBudgetSQLTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with psycopg.connect(DSN) as db:
            db.execute(
                "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) VALUES(%s,%s,%s)",
                (USER,EPOCH,ACCOUNT_LIMIT)
            )
            db.execute(
                "INSERT INTO quota_v2_cdn_lifetime_baselines(user_id,baseline_bytes) VALUES(%s,%s)",
                (USER,BASELINE)
            )

    def test_concurrent_two_cdn_nodes_never_oversubscribe_global_cdn_pool(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
            a,b=list(workers.map(lambda work: locked_grant(*work),
                                 [(84001,800_000),(84002,800_000)]))
        self.assertEqual(a[1]+b[1],CDN_LIMIT-BASELINE)
        with psycopg.connect(DSN) as db:
            rows=db.execute(
                "SELECT s.node_id,s.class,r.ceiling_bytes FROM quota_v2_reservation_classes s "
                "JOIN quota_v2_reservations r USING(reservation_id) "
                "WHERE s.user_id=%s ORDER BY s.node_id",(USER,)
            ).fetchall()
        self.assertEqual(len(rows),2)
        self.assertEqual({n for n,_,_ in rows},{84001,84002})
        self.assertEqual(sum(amount for _,_,amount in rows),1_000_000)

    def test_cross_epoch_and_unknown_reservations_cannot_disappear(self):
        old_epoch=uuid.uuid4()
        reserve=uuid.uuid4()
        with psycopg.connect(DSN) as db:
            db.execute(
                "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes,closed) "
                "VALUES(%s,%s,%s,TRUE)",(USER,old_epoch,ACCOUNT_LIMIT)
            )
            db.execute(
                "INSERT INTO quota_v2_reservations("
                "user_id,epoch,node_id,meter_epoch,reservation_id,ceiling_bytes,valid_until) "
                "VALUES(%s,%s,%s,%s,%s,%s,NOW()+interval '2 hours')",
                (USER,old_epoch,84003,uuid.uuid4(),reserve,100_000)
            )
            # No classification for a historical reservation: full ceiling is
            # conservatively included in the CDN pool, not relabeled MAIN.
            db.execute(
                "PREPARE xmesh_cdn_issued(bigint) AS "
                + production_cdn_issued_sql()
            )
            total=db.execute(
                f"EXECUTE xmesh_cdn_issued({USER})"
            ).fetchone()[0]
        self.assertEqual(total,1_100_000)

    def test_historic_nonzero_reservation_cannot_be_reclassified_as_main(self):
        # Run production Rust's INSERT, including its zero-authority
        # predicate, against real PostgreSQL. A pre-migration CDN reserve
        # must remain an unknown, fully charged CDN liability.
        source = (Path(__file__).resolve().parents[1]
                  / "backend/src/quota_v2_cdn_lifetime.rs").read_text()
        code = source.split("pub async fn record_class(", 1)[1]
        match = re.search(r'sqlx::query\\(\\s*"([^"]+)"',code,re.DOTALL)
        self.assertIsNotNone(match, "production classification SQL missing")
        statement = match.group(1)
        old_epoch,old_reserve,new_reserve = uuid.uuid4(),uuid.uuid4(),uuid.uuid4()
        with psycopg.connect(DSN) as db:
            db.execute(
                "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes,closed) "
                "VALUES(%s,%s,%s,TRUE)",(USER,old_epoch,ACCOUNT_LIMIT))
            for node,reserve,ceiling in (
                (84021,old_reserve,125_000),(84022,new_reserve,0)):
                db.execute(
                    "INSERT INTO quota_v2_reservations("
                    "user_id,epoch,node_id,meter_epoch,reservation_id,"
                    "ceiling_bytes,valid_until) "
                    "VALUES(%s,%s,%s,%s,%s,%s,NOW()+interval '2 hours')",
                    (USER,old_epoch,node,uuid.uuid4(),reserve,ceiling))
            # Parameterized PostgreSQL EXECUTE faithfully follows $1..$4.
            db.execute("PREPARE xmesh_class(uuid,bigint,bigint,text) AS "+statement)
            command=lambda reserve,node,classification: (
                "EXECUTE xmesh_class("
                f"'{reserve}'::uuid,{USER},{node},'{classification}')"
            )
            db.execute(command(old_reserve,84021,"main"))
            self.assertIsNone(db.execute(
                "SELECT class FROM quota_v2_reservation_classes "
                "WHERE reservation_id=%s",(old_reserve,)).fetchone())
            db.execute(command(new_reserve,84022,"cdn"))
            self.assertEqual(db.execute(
                "SELECT class FROM quota_v2_reservation_classes "
                "WHERE reservation_id=%s",(new_reserve,)).fetchone(),("cdn",))
            db.execute(command(new_reserve,84022,"main"))
            self.assertEqual(db.execute(
                "SELECT class FROM quota_v2_reservation_classes "
                "WHERE reservation_id=%s",(new_reserve,)).fetchone(),("cdn",))
            # Verify the exact immutable class lookup used on every signed
            # first-cap, replay and renewal. Missing classification remains
            # untrusted even if a signed config now calls that Node MAIN.
            lookup_source = source.split("pub async fn verify_class(",1)[1]
            verified = re.search(
                r'sqlx::query_scalar\\(\\s*"([^"]+)"', lookup_source,re.DOTALL)
            self.assertIsNotNone(verified)
            db.execute(
                "PREPARE xmesh_class_check(uuid,bigint,bigint) AS "+verified.group(1))
            lookup=lambda ident,node: (
                f"EXECUTE xmesh_class_check('{ident}'::uuid,{USER},{node})"
            )
            self.assertIsNone(db.execute(lookup(old_reserve,84021)).fetchone())
            self.assertEqual(db.execute(
                lookup(new_reserve,84022)).fetchone(),("cdn",))
            self.assertIsNone(db.execute(
                lookup(new_reserve,84021)).fetchone())

    def test_later_v1_node_usage_blocks_signed_cap_redelivery(self):
        # Execute the EXACT SQL embedded in production Rust rather than a
        # hand-written approximation. The immutable baseline by itself is
        # insufficient if verified V1 usage rises after first Genesis.
        source = (Path(__file__).resolve().parents[1]
                  / "backend/src/quota_v2_node_lifetime.rs").read_text()
        match = re.search(
            r'let committed: bool = sqlx::query_scalar\(\s*"([^"]+)"',
            source, re.DOTALL)
        self.assertIsNotNone(match, "production Node cap guard not found")
        production_sql = match.group(1)
        node = 84001
        with psycopg.connect(DSN) as db:
            # The older migration test's historical shadow contains only
            # node_id, so add the signed lifetime telemetry columns here.
            for name in ("user_id", "uplink_bytes", "downlink_bytes"):
                db.execute(
                    "ALTER TABLE user_node_quota_lifetime ADD COLUMN IF NOT EXISTS "
                    + name + " bigint DEFAULT 0")
            held = db.execute(
                "SELECT ceiling_bytes FROM quota_v2_reservations "
                "WHERE user_id=%s AND node_id=%s", (USER,node)
            ).fetchone()[0]
            db.execute(
                "INSERT INTO quota_v2_node_lifetime_baselines "
                "(user_id,node_id,baseline_bytes) VALUES (%s,%s,%s)",
                (USER,node,100_000))
            db.execute(
                "INSERT INTO user_node_quota_lifetime "
                "(user_id,node_id,uplink_bytes,downlink_bytes) VALUES (%s,%s,%s,%s)",
                (USER,node,50_000,0))
            db.execute(
                "PREPARE xmesh_node_cap_guard(bigint,bigint,bigint) AS " + production_sql)
            limit = held + 120_000
            # EXECUTE's arguments are SQL constants, not server-side
            # parameter placeholders. All values here are fixture integers.
            check = f"EXECUTE xmesh_node_cap_guard({USER},{node},{limit})"
            self.assertTrue(db.execute(check).fetchone()[0])
            # This valid newer V1 receipt makes baseline + held look safe,
            # but effective V1 high-water + held exceeds the lifetime plan.
            db.execute(
                "UPDATE user_node_quota_lifetime SET uplink_bytes=%s "
                "WHERE user_id=%s AND node_id=%s",(250_000,USER,node))
            self.assertFalse(db.execute(check).fetchone()[0])
            # More verified cumulative V1 consumption cannot increase
            # available V2 capacity or reactivate a signed stale grant.
            db.execute(
                "UPDATE user_node_quota_lifetime SET uplink_bytes=%s "
                "WHERE user_id=%s AND node_id=%s",(300_000,USER,node))
            self.assertFalse(db.execute(check).fetchone()[0])

    def test_immutable_class_scope_and_baseline(self):
        with psycopg.connect(DSN) as db:
            reserve=db.execute(
                "SELECT reservation_id FROM quota_v2_reservation_classes "
                "WHERE user_id=%s LIMIT 1",(USER,)
            ).fetchone()[0]
        for sql,args in [
            ("UPDATE quota_v2_reservation_classes SET class='main' WHERE reservation_id=%s",
             (reserve,)),
            ("DELETE FROM quota_v2_reservation_classes WHERE reservation_id=%s",
             (reserve,)),
            ("UPDATE quota_v2_cdn_lifetime_baselines SET baseline_bytes=0 WHERE user_id=%s",
             (USER,)),
            ("DELETE FROM quota_v2_cdn_lifetime_baselines WHERE user_id=%s",(USER,)),
        ]:
            with self.subTest(sql=sql):
                with self.assertRaises(psycopg.Error):
                    with psycopg.connect(DSN) as db:
                        db.execute(sql,args)


if __name__ == "__main__":
    unittest.main()
