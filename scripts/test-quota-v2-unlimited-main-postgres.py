#!/usr/bin/env python3
"""Disposable SQL proof: unlimited MAIN does not spend a bounded shared CDN pool.

A global unlimited account uses i64::MAX only in the PostgreSQL accounting
limit; the actual Xray reservations remain bounded to at most 64 MiB and
are always linked to an immutable signed MAIN/CDN class.

This exercises REAL quota_v2_reserve SQL. It is NOT yet an installed,
mixed MAIN/CDN Xray or 500-user production traffic test.
"""
import concurrent.futures
import os
from pathlib import Path
import re
import statistics
import time
import uuid

import psycopg

if os.getenv("XMESH_AUDIT_DISPOSABLE") != "1":
    raise SystemExit("refusing unlimited MAIN test outside disposable PostgreSQL CI")

DSN = os.environ["QUOTA_TEST_DSN"]
USER = 870_901_117
EPOCH = uuid.UUID("a5c1c8d9-bccc-40bb-9ead-000000000001")
MAX_SQL = (1 << 63) - 1
MAIN_TARGET = 32 * 1024 * 1024
CDN_LIMIT = 1_572_864
CDN_TARGET = 1_048_576
NODES = (87201, 87202, 87203)


def production_cdn_total_sql():
    code = (Path(__file__).resolve().parents[1]
            / "backend/src/quota_v2_cdn_lifetime.rs").read_text()
    span = code.split("pub async fn headroom(", 1)[1].split(
        "pub async fn bounded_target(", 1)[0]
    match = re.search(
        r'let issued: i64 = sqlx::query_scalar\(\s*"([^"]+)"', span,
        re.DOTALL,
    )
    if match is None:
        raise AssertionError("could not locate real Rust CDN liability query")
    return match.group(1)


def grant(node, target, kind, cdn_query):
    t0 = time.perf_counter()
    meter = uuid.uuid5(uuid.NAMESPACE_URL, f"unlimited-main-meter-{node}")
    lease = uuid.uuid5(uuid.NAMESPACE_URL, f"unlimited-main-grant-{node}")
    with psycopg.connect(DSN) as db:
        db.execute("SELECT pg_advisory_xact_lock(%s)", (USER ^ 0x51_4D_45_53_48,))
        db.execute(
            "SELECT limit_bytes FROM quota_v2_accounts "
            "WHERE user_id=%s AND epoch=%s FOR UPDATE", (USER, EPOCH),
        )
        # The first operation is a ZERO-spend prepared lease. It freezes
        # class identity before any positive authority is reserved.
        prepared = db.execute(
            "SELECT ceiling_bytes FROM quota_v2_reserve("
            "%s,%s,%s,%s,%s,0,0,NOW()+interval '2 hours')",
            (USER,EPOCH,node,meter,lease),
        ).fetchone()[0]
        if prepared != 0:
            raise AssertionError("prepared lease had positive spending authority")
        db.execute(
            "INSERT INTO quota_v2_reservation_classes "
            "(reservation_id,user_id,node_id,class) VALUES (%s,%s,%s,%s)",
            (lease,USER,node,kind),
        )
        if kind == "cdn":
            db.execute("PREPARE issued(bigint) AS "+cdn_query)
            committed = db.execute(
                f"EXECUTE issued({USER})"
            ).fetchone()[0]
            target = min(target, max(0, CDN_LIMIT-committed))
        result = db.execute(
            "SELECT ceiling_bytes,revision FROM quota_v2_reserve("
            "%s,%s,%s,%s,%s,%s,0,NOW()+interval '2 hours')",
            (USER,EPOCH,node,meter,lease,target),
        ).fetchone()
        if result[0] != target:
            raise AssertionError("unexpected independently bounded lease")
        return (node,kind,result[0],round((time.perf_counter()-t0)*1000,3))


def run():
    with psycopg.connect(DSN) as db:
        db.execute(
            "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) VALUES (%s,%s,%s)",
            (USER,EPOCH,MAX_SQL),
        )
        db.execute(
            "INSERT INTO quota_v2_cdn_lifetime_baselines(user_id,baseline_bytes) "
            "VALUES (%s,0)",(USER,),
        )

    sql = production_cdn_total_sql()
    # MAIN consumes 32MiB of an UNLIMITED global account, but not one CDN
    # byte. Two independent CDN Nodes must compete for only 1.5MiB total.
    main = grant(NODES[0],MAIN_TARGET,"main",sql)
    assert main[2] == MAIN_TARGET, main
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        cdn = list(executor.map(
            lambda node: grant(node,CDN_TARGET,"cdn",sql), NODES[1:],
        ))
    assert sum(row[2] for row in cdn) == CDN_LIMIT, cdn
    assert all(0 <= row[2] <= CDN_TARGET for row in cdn), cdn
    with psycopg.connect(DSN) as db:
        debt = db.execute(
            "SELECT COALESCE(SUM(r.ceiling_bytes),0)::bigint "
            "FROM quota_v2_reservations r "
            "JOIN quota_v2_reservation_classes s USING (reservation_id) "
            "WHERE s.user_id=%s AND s.class='cdn'",(USER,),
        ).fetchone()[0]
        all_debt = db.execute(
            "SELECT COALESCE(SUM(ceiling_bytes),0)::bigint "
            "FROM quota_v2_reservations WHERE user_id=%s",(USER,),
        ).fetchone()[0]
        effective = db.execute(
            "SELECT limit_bytes FROM quota_v2_accounts WHERE user_id=%s "
            "AND epoch=%s",(USER,EPOCH),
        ).fetchone()[0]
        db.execute("PREPARE issued(bigint) AS "+sql)
        audited = db.execute(f"EXECUTE issued({USER})").fetchone()[0]
    assert debt == CDN_LIMIT, debt
    assert audited == debt, (audited,debt)
    assert all_debt == MAIN_TARGET+CDN_LIMIT, all_debt
    assert effective == MAX_SQL, effective
    print({
        "main_bytes":main[2], "cdn_total_bytes":debt,
        "global_sql_account":effective,
        "cdn_grant_p50_ms":round(statistics.median(x[3] for x in cdn),3),
        "main_grant_ms":main[3],
    },flush=True)
    print("PASS: unlimited finite-window MAIN remains independent of concurrent CDN reservation pool")


if __name__ == "__main__":
    run()
