#!/usr/bin/env python3
"""Disposable two-class MAIN/CDN sub-cap conservation against actual PostgreSQL.

Tests immutable mixed CDN holds, concurrent independently classified pools,
stale unclassified historic grants and shared MAIN topups. It exercises the
real quota_v2_reserve SQL and the exact CDN liability SQL extracted from
the Rust code. It does NOT replace an installed mixed-Xray/VLESS E2E test.
"""
import concurrent.futures
import os
from pathlib import Path
import re
import time
import uuid

import psycopg

if os.getenv("XMESH_AUDIT_DISPOSABLE") != "1":
    raise SystemExit("mixed CDN tests run only on disposable PostgreSQL CI")

DSN = os.environ["QUOTA_TEST_DSN"]
USER = 874_000_321
EPOCH = uuid.UUID("e1112222-3333-4444-8555-666677778888")
LIMIT = (1 << 63) - 1
CDN_LIMIT = 1_000_000
PREEXISTING_CDN = 100_000
HISTORIC_UNKNOWN = 50_000
MIXED_REQUEST = 500_000
CDN_REQUEST = 350_000


def identity(node, field):
    return uuid.uuid5(uuid.NAMESPACE_URL, f"xmesh-mixed-sql-{USER}-{node}-{field}")


def real_liability_sql():
    rust = (Path(__file__).resolve().parents[1]
            / "backend/src/quota_v2_cdn_lifetime.rs").read_text()
    source = rust.split("pub async fn headroom(", 1)[1].split(
        "pub async fn bounded_target(", 1)[0]
    match = re.search(
        r'let issued: i64 = sqlx::query_scalar\(\s*"([^"]+)"',
        source, re.DOTALL)
    if match is None:
        raise AssertionError("production mixed CDN liability query absent")
    return match.group(1)


def real_backfill_guard_sql():
    source = (Path(__file__).resolve().parents[1]
              / "backend/src/quota_v2_cdn_lifetime.rs").read_text()
    region = source.split("pub async fn require_fundable_mixed(",1)[1].split(
        "pub async fn fund_mixed(",1)[0]
    match = re.search(
        r'let legacy_unfunded: bool = sqlx::query_scalar\(\s*"([^"]+)"',
        region,re.DOTALL)
    if match is None:
        raise AssertionError("missing production historical mixed hold barrier")
    return match.group(1)


def sql_liability(conn):
    # Repeated snapshots on one PostgreSQL connection must not collide
    # with an earlier PREPARE of the same name.
    name = "mixed_issued_" + uuid.uuid4().hex
    conn.execute("PREPARE "+name+"(bigint) AS "+real_liability_sql())
    return conn.execute(f"EXECUTE {name}({USER})").fetchone()[0]


def shared_reserve(conn, node, bytes_to_issue):
    return conn.execute(
        "SELECT ceiling_bytes FROM quota_v2_reserve("
        "%s,%s,%s,%s,%s,%s,0,NOW()+interval '2 hours')",
        (USER,EPOCH,node,identity(node,"meter"),
         identity(node,"reservation"),bytes_to_issue),
    ).fetchone()[0]


def classify(conn, node, classification):
    reservation = identity(node,"reservation")
    conn.execute(
        "INSERT INTO quota_v2_reservation_classes("
        "reservation_id,user_id,node_id,class) VALUES(%s,%s,%s,%s)",
        (reservation,USER,node,classification),
    )


def prepared(conn, node, classification):
    ceiling = shared_reserve(conn,node,0)
    assert ceiling == 0
    classify(conn,node,classification)


def concurrent_grant(request):
    node, classification, target, cdn_target = request
    with psycopg.connect(DSN) as conn:
        conn.execute(
            "SELECT pg_advisory_xact_lock(%s)", (USER ^ 0x51_4D_45_53_48,))
        conn.execute(
            "SELECT limit_bytes FROM quota_v2_accounts "
            "WHERE user_id=%s AND epoch=%s FOR UPDATE",(USER,EPOCH))
        prepared(conn,node,classification)
        used = sql_liability(conn)
        free = max(0,CDN_LIMIT-PREEXISTING_CDN-used)
        if classification == "mixed":
            ceiling = shared_reserve(conn,node,target)
            held = min(ceiling,cdn_target,free)
            conn.execute(
                "INSERT INTO quota_v2_mixed_cdn_holds("
                "reservation_id,user_id,node_id,held_bytes) VALUES(%s,%s,%s,%s)",
                (identity(node,"reservation"),USER,node,held))
            return node,classification,ceiling,held
        if classification == "cdn":
            issued = min(target,free)
            ceiling = shared_reserve(conn,node,issued)
            return node,classification,ceiling,ceiling
        raise AssertionError("unexpected requested classification")


def main():
    with psycopg.connect(DSN) as conn:
        conn.execute(
            "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) "
            "VALUES(%s,%s,%s)",(USER,EPOCH,LIMIT))
        conn.execute(
            "INSERT INTO quota_v2_cdn_lifetime_baselines(user_id,baseline_bytes) "
            "VALUES(%s,%s)",(USER,PREEXISTING_CDN))
        prepared(conn,87410,"main")
        assert shared_reserve(conn,87410,10_000_000)==10_000_000
        # This historic reserve predates immutable classification.
        assert shared_reserve(conn,87411,HISTORIC_UNKNOWN)==HISTORIC_UNKNOWN
        assert sql_liability(conn) == HISTORIC_UNKNOWN

    t0=time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
        grants=list(workers.map(concurrent_grant,[
            (87420,"mixed",4_000_000,MIXED_REQUEST),
            (87430,"cdn",CDN_REQUEST,CDN_REQUEST),
        ]))
    mixed=[row for row in grants if row[1]=="mixed"][0]
    cdn=[row for row in grants if row[1]=="cdn"][0]
    assert mixed[2:] == (4_000_000,MIXED_REQUEST),mixed
    assert cdn[2:] == (CDN_REQUEST,CDN_REQUEST),cdn

    with psycopg.connect(DSN) as conn:
        issued=sql_liability(conn)
        assert issued == HISTORIC_UNKNOWN+MIXED_REQUEST+CDN_REQUEST,issued
        assert issued+PREEXISTING_CDN == CDN_LIMIT
        held_before=conn.execute(
            "SELECT held_bytes FROM quota_v2_mixed_cdn_holds "
            "WHERE reservation_id=%s",(identity(87420,"reservation"),)
        ).fetchone()[0]
        assert held_before == MIXED_REQUEST
        # Recharge MAIN through the SAME issued mixed reservation. The
        # original CDN hold must not grow or be treated as the full ceiling.
        assert shared_reserve(conn,87420,5_000_000)==5_000_000
        assert sql_liability(conn)==issued
        assert conn.execute(
            "SELECT held_bytes FROM quota_v2_mixed_cdn_holds "
            "WHERE reservation_id=%s",(identity(87420,"reservation"),)
        ).fetchone() == (MIXED_REQUEST,)
        # No shared CDN capacity remains for a third node.
        prepared(conn,87440,"cdn")
        assert shared_reserve(conn,87440,0)==0
        assert sql_liability(conn)==issued
        # Execute the EXACT production Rust preflight SQL: a previously
        # issued historic lease with no CDN hold must be refused, while
        # the current mixed lease's held CDN reservation remains valid.
        conn.execute(
            "PREPARE mixed_backfill_guard(uuid,bigint,bigint) AS "
            + real_backfill_guard_sql()
        )
        def must_deny_historic(node):
            ident=identity(node,"reservation")
            return conn.execute(
                f"EXECUTE mixed_backfill_guard('{ident}'::uuid,{USER},{node})"
            ).fetchone()[0]
        assert must_deny_historic(87411) is True
        assert must_deny_historic(87420) is False
        # Historic grants lacking classification continue to count fully.
        assert conn.execute(
            "SELECT class FROM quota_v2_reservation_classes "
            "WHERE reservation_id=%s",(identity(87411,"reservation"),)
        ).fetchone() is None

    for statement, params in [
        ("UPDATE quota_v2_mixed_cdn_holds SET held_bytes=0 "
         "WHERE reservation_id=%s",(identity(87420,"reservation"),)),
        ("DELETE FROM quota_v2_mixed_cdn_holds WHERE reservation_id=%s",
         (identity(87420,"reservation"),)),
    ]:
        with psycopg.connect(DSN) as conn:
            try:
                conn.execute(statement,params)
            except psycopg.Error:
                conn.rollback()
            else:
                raise AssertionError("immutable mixed CDN hold was modified")

    print({
        "main_bytes":10_000_000,
        "mixed_shared_after_main_refill":5_000_000,
        "mixed_cdn_signed_hold":MIXED_REQUEST,
        "cdn_only_hold":CDN_REQUEST,
        "historic_unknown_cdn_liability":HISTORIC_UNKNOWN,
        "cdn_limit_bytes":CDN_LIMIT,
        "two_node_allocate_ms":round((time.perf_counter()-t0)*1000,2),
    },flush=True)
    print("PASS: mixed MAIN topup did not mint CDN bytes or refund any historic CDN hold")


if __name__ == "__main__":
    main()
