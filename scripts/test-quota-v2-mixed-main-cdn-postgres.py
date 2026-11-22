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


def real_mixed_signed_cdn_sql():
    source = (Path(__file__).resolve().parents[1]
              / "backend/src/quota_v2_cdn_lifetime.rs").read_text()
    scope = source.split("pub async fn signed_cdn_ceiling(",1)[1].split(
        "pub async fn renew_mixed_cdn(",1)[0]
    match = re.search(
        r'sqlx::query_scalar\(\s*"([^"]+)"',scope,re.DOTALL)
    if match is None:
        raise AssertionError("production mixed signed CDN ceiling query missing")
    return match.group(1)


def exact_signed_cdn(conn,node):
    # This is the actual query Nexus executes before first cap delivery or
    # renewal. A hardcoded Python approximation would miss regressions.
    query = "mixed_signed_"+uuid.uuid4().hex
    conn.execute("PREPARE "+query+"(uuid,bigint,bigint) AS "+real_mixed_signed_cdn_sql())
    return conn.execute(
        f"EXECUTE {query}('{identity(node,'reservation')}'::uuid,{USER},{node})"
    ).fetchone()


def real_topup_insert_sql():
    rust = (Path(__file__).resolve().parents[1]
            / "backend/src/quota_v2_cdn_lifetime.rs").read_text()
    source = rust.split("pub async fn renew_mixed_cdn(",1)[1].split(
        "pub async fn issued_within_limit(",1)[0]
    match = re.search(
        r'INSERT INTO quota_v2_mixed_cdn_topups\([^"]+"',source,re.DOTALL)
    if match is None:
        raise AssertionError("production mixed CDN top-up SQL missing")
    return match.group(0)[:-1]


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
        assert exact_signed_cdn(conn,87420)==(MIXED_REQUEST,)
        # A mismatch of Node cannot read another Node's CDN authorization.
        assert exact_signed_cdn(conn,87430) is None
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

    # Operator explicitly increases the lifetime CDN plan by 120 KiB.
    # The original mixed hold remains unchanged; a NEW immutable revision
    # charges exactly those additional bytes against the enlarged pool.
    topup_bytes = 120_000
    revised_limit = CDN_LIMIT + topup_bytes
    with psycopg.connect(DSN) as conn:
        old_liability = sql_liability(conn)
        assert revised_limit-PREEXISTING_CDN-old_liability == topup_bytes
        conn.execute(
            "PREPARE mixed_topup(uuid,bigint,bigint,bigint,bigint,bigint,text) AS "
            + real_topup_insert_sql()
        )
        topup_sql = (
            "EXECUTE mixed_topup("
            f"'{identity(87420,'reservation')}'::uuid,8,{USER},87420,"
            f"{topup_bytes},{MIXED_REQUEST+topup_bytes},'{'f'*64}')"
        )
        # The SQL fixture is deliberately NOT a cryptographic signature.
        # It proves the storage transaction; the Nexus Ed25519 signer and
        # actual Xray verification have separate integration tests.
        exact_sql_fixture = b"disposable-signed-envelope-placeholder-" + b"x"*160
        conn.execute(topup_sql)
        conn.execute(
            "INSERT INTO quota_v2_cap_renewals("
            "reservation_id,revision,nonce,grant_bytes,signed_envelope) "
            "VALUES(%s,8,%s,5000000,%s)",
            (identity(87420,"reservation"),"f"*64,exact_sql_fixture)
        )
        assert conn.execute(
            "SELECT signed_envelope FROM quota_v2_cap_renewals "
            "WHERE reservation_id=%s AND revision=8",
            (identity(87420,"reservation"),)
        ).fetchone() == (exact_sql_fixture,)
        assert sql_liability(conn) == old_liability+topup_bytes
        assert exact_signed_cdn(conn,87420)==(MIXED_REQUEST+topup_bytes,)
        assert conn.execute(
            "SELECT held_bytes FROM quota_v2_mixed_cdn_holds "
            "WHERE reservation_id=%s",(identity(87420,"reservation"),)
        ).fetchone() == (MIXED_REQUEST,)
        assert conn.execute(
            "SELECT revision,added_bytes,cumulative_cdn_ceiling_bytes "
            "FROM quota_v2_mixed_cdn_topups WHERE reservation_id=%s",
            (identity(87420,"reservation"),)
        ).fetchone() == (8,topup_bytes,MIXED_REQUEST+topup_bytes)

    # A duplicate or conflicting top-up with the same revision cannot mint
    # another 120k. PostgreSQL uniqueness and immutable triggers reject it.
    with psycopg.connect(DSN) as conn:
        try:
            conn.execute(
                "INSERT INTO quota_v2_mixed_cdn_topups("
                "reservation_id,revision,user_id,node_id,added_bytes,"
                "cumulative_cdn_ceiling_bytes,request_nonce) "
                "VALUES(%s,8,%s,87420,10,620010,%s)",
                (identity(87420,"reservation"),USER,"e"*64)
            )
        except psycopg.Error:
            conn.rollback()
        else:
            raise AssertionError("duplicate signed CDN revision created new capacity")
        assert sql_liability(conn) == old_liability+topup_bytes

    # The COMMIT-time FK binds a CDN grant to the exact signed cap revision
    # and nonce. A standalone new CDN top-up cannot become durable even if
    # application code forgot to insert a signed response entirely.
    for revision, topup_nonce, signed_nonce in (
        (10, "a" * 64, None),       # missing signed renewal
        (11, "b" * 64, "c" * 64),   # wrong signed renewal nonce
    ):
        try:
            with psycopg.connect(DSN) as conn:
                conn.execute(
                    "INSERT INTO quota_v2_mixed_cdn_topups("
                    "reservation_id,revision,user_id,node_id,added_bytes,"
                    "cumulative_cdn_ceiling_bytes,request_nonce) "
                    "VALUES(%s,%s,%s,87420,1000,%s,%s)",
                    (identity(87420,"reservation"),revision,USER,
                     MIXED_REQUEST+topup_bytes+1000,topup_nonce),
                )
                if signed_nonce is not None:
                    conn.execute(
                        "INSERT INTO quota_v2_cap_renewals("
                        "reservation_id,revision,nonce,grant_bytes,signed_envelope) "
                        "VALUES(%s,%s,%s,5000000,%s)",
                        (identity(87420,"reservation"),revision,
                         signed_nonce,b"x"*160),
                    )
        except psycopg.ForeignKeyViolation:
            pass
        else:
            raise AssertionError("orphan or wrong-nonce CDN hold committed")
        with psycopg.connect(DSN) as conn:
            assert conn.execute(
                "SELECT count(*) FROM quota_v2_mixed_cdn_topups "
                "WHERE reservation_id=%s AND revision=%s",
                (identity(87420,"reservation"),revision),
            ).fetchone() == (0,)
            assert conn.execute(
                "SELECT count(*) FROM quota_v2_cap_renewals "
                "WHERE reservation_id=%s AND revision=%s",
                (identity(87420,"reservation"),revision),
            ).fetchone() == (0,)
            assert sql_liability(conn) == old_liability+topup_bytes

    # The composite FK also prevents shifting a previously signed CDN
    # reserve onto a different Node or user under the same reservation ID.
    try:
        with psycopg.connect(DSN) as conn:
            conn.execute(
                "INSERT INTO quota_v2_mixed_cdn_topups("
                "reservation_id,revision,user_id,node_id,added_bytes,"
                "cumulative_cdn_ceiling_bytes,request_nonce) "
                "VALUES(%s,12,%s,87430,1000,%s,%s)",
                (identity(87420,"reservation"),USER,
                 MIXED_REQUEST+topup_bytes+1000,"d"*64),
            )
    except psycopg.ForeignKeyViolation:
        pass
    else:
        raise AssertionError("CDN class hold was transferred to another Node")

    # A failure to commit the exact signed cap MUST also roll back the
    # independently proposed CDN bytes. Both records share a DB transaction.
    # Zero grant_bytes violates the actual immutable signed-cap SQL schema.
    with psycopg.connect(DSN) as conn:
        try:
            conn.execute(
                "INSERT INTO quota_v2_mixed_cdn_topups("
                "reservation_id,revision,user_id,node_id,added_bytes,"
                "cumulative_cdn_ceiling_bytes,request_nonce) "
                "VALUES(%s,9,%s,87420,1000,%s,%s)",
                (identity(87420,"reservation"),USER,
                 MIXED_REQUEST+topup_bytes+1000,"e"*64)
            )
            conn.execute(
                "INSERT INTO quota_v2_cap_renewals("
                "reservation_id,revision,nonce,grant_bytes,signed_envelope) "
                "VALUES(%s,9,%s,0,%s)",
                (identity(87420,"reservation"),"e"*64,b"x"*160)
            )
        except psycopg.Error:
            conn.rollback()
        else:
            raise AssertionError("invalid signed-cap commit accepted new CDN hold")
        assert conn.execute(
            "SELECT revision FROM quota_v2_mixed_cdn_topups "
            "WHERE reservation_id=%s ORDER BY revision",
            (identity(87420,"reservation"),)
        ).fetchall() == [(8,)]
        assert conn.execute(
            "SELECT revision FROM quota_v2_cap_renewals "
            "WHERE reservation_id=%s ORDER BY revision",
            (identity(87420,"reservation"),)
        ).fetchall() == [(8,)]
        assert sql_liability(conn) == old_liability+topup_bytes

    for statement, params in [
        ("UPDATE quota_v2_mixed_cdn_holds SET held_bytes=0 "
         "WHERE reservation_id=%s",(identity(87420,"reservation"),)),
        ("DELETE FROM quota_v2_mixed_cdn_holds WHERE reservation_id=%s",
         (identity(87420,"reservation"),)),
        ("UPDATE quota_v2_mixed_cdn_topups SET added_bytes=0 "
         "WHERE reservation_id=%s AND revision=8",
         (identity(87420,"reservation"),)),
        ("DELETE FROM quota_v2_mixed_cdn_topups "
         "WHERE reservation_id=%s AND revision=8",
         (identity(87420,"reservation"),)),
    ]:
        with psycopg.connect(DSN) as conn:
            try:
                conn.execute(statement,params)
            except psycopg.Error:
                conn.rollback()
            else:
                raise AssertionError("immutable mixed CDN hold or revision top-up was modified")

    print({
        "main_bytes":10_000_000,
        "mixed_shared_after_main_refill":5_000_000,
        "mixed_cdn_signed_hold":MIXED_REQUEST,
        "cdn_only_hold":CDN_REQUEST,
        "historic_unknown_cdn_liability":HISTORIC_UNKNOWN,
        "cdn_limit_bytes_after_owner_increase":revised_limit,
        "mixed_cdn_immutable_topup":topup_bytes,
        "two_node_allocate_ms":round((time.perf_counter()-t0)*1000,2),
    },flush=True)
    print("PASS: mixed MAIN topup conserved CDN, independently signed CDN revision added exactly budgeted bytes, replay denied")


if __name__ == "__main__":
    main()
