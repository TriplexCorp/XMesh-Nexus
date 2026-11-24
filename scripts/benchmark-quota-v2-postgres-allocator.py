#!/usr/bin/env python3
"""Bounded disposable PostgreSQL Quota V2 issuer stress test.

10/100/500 distinct subscriber accounts with two concurrent reservation
writers per user. Uses the REAL quota_v2_reserve SQL and asserts complete
conservation, no duplicate capacity on retry and lease-identity rejection.
This does NOT assert identical SQL revision bytes on raw allocator retries; the
signed-cap outbox separately owns exact HTTP response idempotency. NOT a claim
of 500 live VLESS users, full signed-Agent admission or Xray throughput.
"""
import concurrent.futures
import json
import math
import os
import statistics
import time
import uuid

import psycopg

if os.getenv("XMESH_AUDIT_DISPOSABLE") != "1":
    raise SystemExit("quota load benchmark may only run against a disposable DB")

DSN = os.environ["QUOTA_TEST_DSN"]
TOTAL = 1_572_864
WINDOW = 1_048_576
STRESS_IDS = 900_000_000
WORKERS = 16
MAX_WALL_SECONDS = 180


def identity(user, node, label):
    return uuid.uuid5(uuid.NAMESPACE_URL, f"xmesh-load-{label}-{user}-{node}")


def reserve(user, node, meter, grant):
    start = time.perf_counter()
    with psycopg.connect(DSN) as connection:
        result = connection.execute(
            "SELECT ceiling_bytes,revision FROM quota_v2_reserve("
            "%s,%s,%s,%s,%s,%s,%s,NOW()+interval '2 hours')",
            (user, identity(user, 0, "epoch"), node, meter,
             grant, WINDOW, 0),
        ).fetchone()
    return result, time.perf_counter()-start


def percentile(values, quantile):
    ordered = sorted(values)
    return round(ordered[max(0, math.ceil(quantile*len(ordered))-1)]*1000, 3)


def run_case(size, first):
    # Every case has its own accounts/leases; no pool or state from another
    # test is silently reused. SQL serializes the two competing writers.
    users = list(range(first, first+size))
    with psycopg.connect(DSN) as connection:
        with connection.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) "
                "VALUES(%s,%s,%s)",
                [(u,identity(u,0,"epoch"),TOTAL) for u in users],
            )
    jobs=[]
    for user in users:
        for node in (71,72):
            jobs.append((user,node,identity(user,node,"meter"),
                         identity(user,node,"grant")))
    begun=time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as workers:
        results=list(workers.map(lambda j: reserve(*j),jobs))
    wall=time.perf_counter()-begun
    if wall > MAX_WALL_SECONDS:
        raise AssertionError("PostgreSQL quota allocator stress wall-time exceeded")
    timings=[latency for _,latency in results]
    original_ceiling={(job[0],job[1]):value[0]
                      for job,(value,_) in zip(jobs,results)}
    if any(row is None or not 0<=row[0]<=WINDOW for row,_ in results):
        raise AssertionError("unexpected PostgreSQL quota grant outside requested window")

    with psycopg.connect(DSN) as connection:
        rows=connection.execute(
            "SELECT a.user_id,a.limit_bytes,a.settled_bytes,"
            "COALESCE(SUM(r.ceiling_bytes-r.acknowledged_bytes),0)::bigint "
            "FROM quota_v2_accounts a JOIN quota_v2_reservations r "
            "ON r.user_id=a.user_id AND r.epoch=a.epoch "
            "WHERE a.user_id >= %s AND a.user_id < %s "
            "GROUP BY a.user_id,a.limit_bytes,a.settled_bytes",
            (first,first+size),
        ).fetchall()
    if len(rows)!=size:
        raise AssertionError(f"missing user reservations {len(rows)} != {size}")
    for user,limit,settled,outstanding in rows:
        if (limit,settled,outstanding)!=(TOTAL,0,TOTAL):
            raise AssertionError(
                f"user {user} over/underallocated: {(limit,settled,outstanding)}"
            )
    # Retry every first cohort lease with exactly the original identity.
    # Then attempt an altered reservation UUID on the same meter: deny.
    for user,node,meter,grant in jobs[:min(8,len(jobs))]:
        replay,_=reserve(user,node,meter,grant)
        if replay[0]!=original_ceiling[(user,node)]:
            raise AssertionError("same lease replay changed already-issued capacity")
        with psycopg.connect(DSN) as connection:
            try:
                connection.execute(
                    "SELECT quota_v2_reserve(%s,%s,%s,%s,%s,%s,%s,"
                    "NOW()+interval '2 hours')",
                    (user,identity(user,0,"epoch"),node,meter,
                     uuid.uuid4(),WINDOW,0),
                )
            except psycopg.Error:
                connection.rollback()
            else:
                raise AssertionError("competing lease identity was accepted")
    with psycopg.connect(DSN) as connection:
        outstanding=connection.execute(
            "SELECT COALESCE(SUM(r.ceiling_bytes-r.acknowledged_bytes),0)::bigint "
            "FROM quota_v2_reservations r WHERE r.user_id >= %s AND r.user_id < %s",
            (first,first+size),
        ).fetchone()[0]
    if outstanding!=size*TOTAL:
        raise AssertionError("idempotent retry or competing lease changed aggregate capacity")

    result={
        "users":size,
        "nodes_per_user":2,
        "requests":len(jobs),
        "total_reserved_bytes":size*TOTAL,
        "wall_seconds":round(wall,3),
        "requests_per_second":round(len(jobs)/max(wall,0.001),1),
        "mean_request_ms":round(statistics.fmean(timings)*1000,3),
        "p50_request_ms":percentile(timings,0.5),
        "p95_request_ms":percentile(timings,0.95),
        "p99_request_ms":percentile(timings,0.99),
    }
    print(json.dumps(result,sort_keys=True),flush=True)


if __name__=="__main__":
    for count, offset in ((10,0),(100,10_000),(500,20_000)):
        run_case(count,STRESS_IDS+offset)
    print("PASS: real PostgreSQL allocator conserved 10/100/500-user two-Node concurrent grants")
