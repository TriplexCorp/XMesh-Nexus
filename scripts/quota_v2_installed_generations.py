"""Hosted E2E with installed Agent, strict XSP/2 and genuine Nexus receipts."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

from quota_v2_installed_genesis_lease import (
    CAP_DOMAIN, CAP_PATH, GENESIS_DOMAIN, MEASURED, STATE, independent_signature, parallel,
)

WORK = MEASURED + "/generations-ci"
RENEW = "xmesh-quota-v2-renewal"
INGRESS = "xmesh-quota-v2-ingress"


def shorten_disposable_calendar(db, dsn):
    # All participants still use real time. Only the duration of the daily
    # calendar in this disposable database changes, before any reservation.
    assert os.environ.get("GITHUB_ACTIONS") == "true"
    assert os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
    assert dsn.endswith("@127.0.0.1:5432/quota_wal_installed")
    assert db.execute("SELECT current_database(), current_user").fetchone() == (
        "quota_wal_installed", "quota_test")
    assert db.execute("SELECT count(*) FROM quota_v2_reservations").fetchone() == (0,)
    origin = db.execute(
        "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')"
    ).fetchone()[0]
    assert re.fullmatch(r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d", origin)
    definition = db.execute(
        "SELECT pg_get_functiondef('quota_v2_calendar_window(text,timestamptz)'::regprocedure)"
    ).fetchone()[0]
    original = "FUNCTION public.quota_v2_calendar_window("
    assert definition.count(original) == 1
    db.execute(definition.replace(original, "FUNCTION public.quota_v2_original_calendar_window("))
    # Preserve the function OID referenced by calendar table constraints.

    db.execute(f"""
        CREATE OR REPLACE FUNCTION quota_v2_calendar_window(p_period TEXT, p_at TIMESTAMPTZ)
        RETURNS TSTZRANGE LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
            SELECT CASE WHEN p_period='daily' THEN
                tstzrange(bucket, bucket + interval '240 seconds')
            ELSE quota_v2_original_calendar_window(p_period,p_at) END
            FROM (SELECT date_bin(interval '240 seconds', p_at, TIMESTAMPTZ '{origin}+00') AS bucket) bounds
        $$
    """)


def exercise(pair, db, root, user, peer, lab, stack, dsn):
    service = RENEW + ".service"
    main = pair[0]
    node, uid = main.node, user["id"]
    echo = (f"import sys; sys.path.insert(0, {WORK!r}); "
            "from quota_v2_installed_live_vless import EchoHandler,EchoServer; "
            "EchoServer(('127.0.0.1',28421),EchoHandler).serve_forever()")

    def start_echo(guest, generation, pid):
        assert guest.exec("readlink", f"/proc/{pid}/ns/net") != guest.exec("readlink", "/proc/1/ns/net")
        guest.exec("systemd-run", "--collect", f"--unit=xmesh-ci-echo-{generation}",
                   "/usr/bin/nsenter", f"--net=/proc/{pid}/ns/net", "--",
                   "/usr/bin/python3", "-c", echo)
        lab.wait_for(lambda: b":28421" in guest.exec("nsenter", f"--net=/proc/{pid}/ns/net",
                                                    "--", "ss", "-ltn"),
                     timeout=12, label=f"echo target in generation {generation} namespace")

    def read_when_present(guest, path):
        raw = guest.exec("sh", "-c", 'if test -f "$1"; then cat "$1"; fi', "sh", path)
        return json.loads(raw) if raw else None

    def enable(guest):
        guest.exec("install", "-d", "-m", "0700", WORK)
        guest.exec("chown", "root:root", MEASURED + "/xray-client")
        guest.exec("install", "-m", "0600", "/dev/null", "/etc/xmesh-quota-v2-staging")
        guest.exec("sh", "-ec", "umask 077; printf '%s\\n' "
                   "GITHUB_ACTIONS=true XMESH_QUOTA_V2_INGRESS_STAGING=1 "
                   "XMESH_QUOTA_V2_MANAGED_GENERATIONS_STAGING=1 "
                   "> /etc/xmesh-quota-generations-staging.env")
        guest.exec("install", "-d", f"/etc/systemd/system/{RENEW}.timer.d")
        guest.exec("sh", "-ec", "printf '[Timer]\\nOnUnitInactiveSec=4s\\nAccuracySec=1s\\n' > "
                   f"/etc/systemd/system/{RENEW}.timer.d/ci.conf")
        for filename in ("quota_v2_installed_live_vless.py", "quota_v2_installed_generations_client.py"):
            lab.docker("cp", Path(__file__).with_name(filename), f"{guest.name}:{WORK}/{filename}")
        guest.exec("systemctl", "daemon-reload")
        ingress_service = INGRESS + ".service"
        assert guest.exec("systemctl", "show", ingress_service,
                          "--property=ProtectSystem", "--value").strip() == b"strict"
        initial_lock = guest.exec("stat", "-c", "%i:%u:%a", STATE + "/lock").strip()
        assert initial_lock.endswith(b":0:600"), initial_lock
        guest.exec("systemctl", "start", ingress_service)

        def listener_pid():
            pid = int(guest.exec("systemctl", "show", ingress_service,
                                 "--property=MainPID", "--value"))
            if not pid:
                return None
            sockets = guest.exec("ss", "-Hltnp", "sport", "=", ":28401")
            return pid if f"pid={pid},".encode() in sockets else None

        pid = lab.wait_for(listener_pid, timeout=25, label=f"clean ingress on Node {guest.node}")
        options = guest.exec("findmnt", "--task", str(pid), "--target", STATE,
                             "--noheadings", "--output", "VFS-OPTIONS").decode().strip().split(",")
        assert "ro" in options, options
        assert guest.exec("stat", "-c", "%i:%u:%a", STATE + "/lock").strip() == initial_lock
        print(f"PASS: installed ingress Node {guest.node} bound VLESS with read-only state "
              "and the original shared lock inode.", flush=True)
        guest.exec("systemctl", "start", RENEW + ".timer")
        guest.exec("systemctl", "--no-block", "start", service)


    def first(guest, user_id):
        record = lab.wait_for(
            lambda: read_when_present(guest, STATE + f"/genesis-positive-cap-u{user_id}.json"),
            timeout=100, label=f"initial signed grant for Node {guest.node} user {user_id}")
        signed = json.loads(record["signedEnvelope"])
        independent_signature(root, f"first-{guest.node}-{user_id}", signed, CAP_DOMAIN)
        grant = signed["payload"]
        assert (grant["nodeId"], grant["userId"]) == (guest.node, user_id)
        (artifact / f"initial-{guest.node}-{user_id}.json").write_bytes(
            record["signedEnvelope"].encode())
        return grant

    def ready_route(guest, user_id, grant):
        def check():
            route = guest.exec("sh", "-c", 'readlink "$1" || true', "sh",
                               STATE + f"/ingress-u{user_id}").decode().strip()
            return re.fullmatch(r"/proc/([1-9][0-9]*)/root/dev/shm/xmesh-" + grant["runtimeId"], route)
        return int(lab.wait_for(check, timeout=30, label="installed generation ingress").group(1))

    artifact = Path(os.environ["RUNNER_TEMP"]) / "quota-v2-generations-evidence"
    artifact.mkdir(mode=0o700)
    (artifact / "nexus-policy.pem").write_bytes(Path(os.environ["XMESH_TEST_POLICY_PUBLIC_KEY"]).read_bytes())
    process = None
    try:
        parallel(enable, pair)
        initial = first(main, uid)
        stable = first(main, peer["id"])
        first(pair[1], uid)
        first(pair[1], peer["id"])
        pid = ready_route(main, uid, initial)
        assert ready_route(main, peer["id"], stable) == pid
        start_echo(main, 1, pid)
        main.exec("touch", WORK + "/ready-1")
        process = subprocess.Popen([
            "docker", "exec", main.name, "python3", WORK + "/quota_v2_installed_generations_client.py",
            MEASURED + "/xray-client", user["xrayId"], peer["xrayId"], WORK,
        ])

        def completed(generation):
            def done():
                assert process.poll() in (None, 0), "real VLESS client exited early"
                return main.exec("sh", "-c", 'test ! -f "$1" || printf done', "sh",
                                 f"{WORK}/done-{generation}") == b"done"
            lab.wait_for(done, timeout=35, label=f"live bytes on generation {generation}")

        completed(1)
        chain = [initial]
        replay_requests = []
        for generation in (2, 3):
            old = chain[-1]
            predicate = (node, uid, old["reservationId"])
            row = lab.wait_for(lambda: db.execute(
                "SELECT reservation_id::text,fresh_runtime_id, signed_envelope, fresh_genesis_envelope "
                "FROM quota_v2_calendar_successor_positive_caps WHERE node_id=%s AND user_id=%s "
                "AND predecessor_id=%s", predicate).fetchone(), timeout=340,
                label=f"Nexus generation {generation} positive outbox")
            reservation, runtime, raw_cap, raw_genesis = row
            cap, genesis = json.loads(bytes(raw_cap)), json.loads(bytes(raw_genesis))
            independent_signature(root, f"gen{generation}-cap", cap, CAP_DOMAIN)
            independent_signature(root, f"gen{generation}-genesis", genesis, GENESIS_DOMAIN)
            grant = cap["payload"]
            assert (grant["nodeId"], grant["userId"]) == (node, uid)
            assert (grant["runtimeId"], grant["reservationId"]) == (runtime, reservation)
            for field in ("accountEpoch", "policySha256", "activationReceiptSha256"):
                assert grant[field] == initial[field]
            assert genesis["payload"]["candidateRuntimeId"] == runtime
            assert genesis["payload"]["challenge"] == grant["nonce"]
            receipt = lab.wait_for(lambda: read_when_present(
                main, STATE + f"/calendar-positive-u{uid}-{old['reservationId']}.json"),
                timeout=45, label=f"Xray generation {generation} IPC receipt")
            assert receipt["response"]["signedEnvelope"].encode() == bytes(raw_cap)
            assert receipt["response"]["freshGenesisEnvelope"].encode() == bytes(raw_genesis)
            assert receipt["xrayReceipt"] == {
                "runtimeId": runtime, "grantSha256": hashlib.sha256(raw_cap).hexdigest(),
            }
            proof = read_when_present(main, STATE + f"/calendar-meter-u{uid}-{old['reservationId']}.json")
            closure = read_when_present(main, STATE + f"/calendar-fence-u{uid}-{old['reservationId']}.json")
            assert proof is not None and closure is not None
            fields = ("predecessorId", "freshRuntimeId", "freshContainerId", "freshStartedAt",
                      "freshHostPid", "freshExecutableSha256", "freshConfigSha256",
                      "freshWalInventorySha256", "zeroInitialRawCounters", "isolatedNewWalRoot")
            request = {
                "nodeId": node, "userId": uid, "requestChallenge": grant["nonce"],
                "calendarSuccessorPositive": {
                    **{key: proof[key] for key in fields},
                    "oldWalChargeHeadsSha256": closure["oldWalChargeConfirmation"]["chargeHeadsSha256"],
                },
            }
            replay_requests.append((request, receipt["response"]))
            assert main.request(CAP_PATH, request) == (200, receipt["response"])
            conflict = {**request, "calendarSuccessorPositive": {
                **request["calendarSuccessorPositive"],
                "freshHostPid": request["calendarSuccessorPositive"]["freshHostPid"] + 1,
            }}
            assert main.request(CAP_PATH, conflict)[0] == 409
            pid = ready_route(main, uid, grant)
            (artifact / f"generation-{generation}.json").write_text(json.dumps({
                "predecessorReservation": old["reservationId"], "installation": receipt,
                "routePid": pid, "routeObservedAtMs": time.time_ns() // 1_000_000,
                "nexusCommit": os.environ["XMESH_INSTALLED_NEXUS_REF"],
                "nodeCommit": os.environ["XMESH_INSTALLED_NODE_REF"],
            }, indent=2))
            assert ready_route(main, peer["id"], stable) != pid
            start_echo(main, generation, pid)
            main.exec("touch", f"{WORK}/ready-{generation}")
            completed(generation)
            chain.append(grant)
            print(f"PASS: actual Nexus signed and installed generation {generation}: "
                  f"Node {node}, predecessor {old['reservationId']}, successor {reservation}, "
                  f"runtime {runtime}", flush=True)

        for field in ("meterEpoch", "runtimeId", "reservationId"):
            assert len({grant[field] for grant in chain}) == 3
        charges = {}
        for grant in chain:
            reservation = grant["reservationId"]
            charged = lab.wait_for(lambda: db.execute(
                "SELECT SUM(stream_bytes) FROM (SELECT MAX(stream_bytes) AS stream_bytes "
                "FROM quota_v2_wal_charges WHERE reservation_id=%s GROUP BY filename) streams",
                (reservation,)).fetchone()[0], timeout=75, label=f"WAL charge {reservation}")
            assert charged == 16384, (reservation, charged)
            charges[reservation] = charged
        def snapshot(connection):
            return (
                connection.execute(
                    "SELECT reservation_id, acknowledged_bytes, conservative_burn_floor_bytes "
                    "FROM quota_v2_reservations WHERE user_id=%s ORDER BY reservation_id",
                    (uid,)).fetchall(),
                connection.execute(
                    "SELECT settled_bytes, observed_floor_bytes FROM quota_v2_accounts "
                    "WHERE user_id=%s ORDER BY epoch", (uid,)).fetchall(),
                connection.execute(
                    "SELECT reservation_id, signed_envelope, fresh_genesis_envelope "
                    "FROM quota_v2_calendar_successor_positive_caps WHERE user_id=%s ORDER BY reservation_id",
                    (uid,)).fetchall(),
            )

        before = snapshot(db)
        assert len(before[2]) == 2
        db = lab.restart_postgres(stack, dsn, db)
        assert snapshot(db) == before
        for request, response in replay_requests:
            assert main.request(CAP_PATH, request) == (200, response)
        assert snapshot(db) == before
        main.exec("touch", WORK + "/database-restarted")
        assert process.wait(timeout=20) == 0
        main.exec("test", "-f", WORK + "/peer-intact")
        (artifact / "charges.json").write_text(json.dumps(charges, indent=2))
        print("PASS: installed Agent and Nexus completed VLESS 1 → 2 → 3, "
              "with three separate WAL charges and no reconnect for user B.", flush=True)
    except Exception:
        for guest in pair:
            print(guest.exec("journalctl", "-u", service, "-u", INGRESS + ".service",
                             "-n", "70", "--no-pager").decode(errors="replace"), flush=True)
        raise
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
