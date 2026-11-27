"""Real installed first-Genesis WAL readback; no listener, issuer or mocks.

Only the hosted disposable two-Node test may execute this helper. It runs
the exact reviewed dormant Node verifier against the installed, independently
qualified Agent/Xray and actual strict-PQ Nexus transport. It never installs
that verifier into the Agent or changes the production release pin.
"""
import hashlib
import json
import os
import re
from pathlib import Path

from quota_v2_installed_genesis_lease import STATE, parallel

INSTALLED_ROOT = "/opt/xmesh-node"
INSTALLED_WAL = INSTALLED_ROOT + "/experiments/quota-v2-physical-stop"
LEDGER = "/var/lib/xmesh-first-meter/runtime/ledger"
SCENARIOS = ("public-tls-wal-readback", "public-tls-wal-nonempty",
             "public-tls-namespace-candidate", "public-tls-native-live")
TRAFFIC_SCENARIOS = SCENARIOS[1:]
STREAM = re.compile(rb"meter-[0-9a-f]{64}\.jsonl\Z")
INVENTORY = b"xmesh-meter-inventory-v1.jsonl"
WORK = "/run/xmesh-ci-tls-wal-readback"



def require_disposable():
    assert os.environ.get("GITHUB_ACTIONS") == "true"
    assert os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
    assert os.environ.get("XMESH_RELEASE_QUALIFICATION_SCENARIO") in SCENARIOS
    assert os.environ["QUOTA_TEST_DSN"].endswith("@127.0.0.1:5432/quota_wal_installed")


def seed_attested_binary(guest, lab):
    """Avoid a redundant rebuild; the real installer MUST verify attestation.

    The independent hosted workflow already rebuilt and verified these
    bytes. Preposition only the executable, NOT the qualification fence.
    The unmodified pinned bootstrap still verifies the exact manifest,
    provenance, executable, mode and creates the real durable record.
    """
    require_disposable()
    source = Path(os.environ["XMESH_WAL_XRAY_BINARY"]).resolve(strict=True)
    digest = os.environ["XMESH_WAL_XRAY_SHA256"]
    assert hashlib.sha256(source.read_bytes()).hexdigest() == digest
    guest.exec("test", "!", "-e", "/var/lib/xmesh-metered-xray")
    guest.exec("test", "!", "-e", "/usr/local/libexec/xmesh-metered-xray")
    lab.docker("cp", str(source), f"{guest.name}:/tmp/qualified-xray")
    guest.exec("install", "-d", "-m", "0755", "/usr/local/libexec")
    guest.exec("install", "-o", "root", "-g", "root", "-m", "0755",
               "/tmp/qualified-xray", "/usr/local/libexec/xmesh-metered-xray")
    guest.exec("rm", "/tmp/qualified-xray")
    assert guest.exec("sha256sum", "/usr/local/libexec/xmesh-metered-xray").split()[0].decode() == digest


def configure_pair(pair, owner):
    require_disposable()
    tags = ("vless-main", "vless-cdn")
    _, squad = owner.request("POST", "/collections/squads",
                             {"name": "Pristine qualified TLS WAL", "inb": list(tags)})
    users = {}
    for index in range(2):
        _, user = owner.request("POST", "/collections/users", {
            "username": f"ci_qualified_tls_wal_{index}", "squads": [squad["id"]],
            "hold": False, "used": 0, "limit": 0.016, "expireAt": 0,
            "cdnLimitGb": 0.008,
        })
        users[user["id"]] = user["xrayId"]
    for guest, tag in zip(pair, tags):
        _, profile = owner.request("POST", "/collections/profiles", {
            "name": "Qualified TLS WAL " + tag,
            "config": json.dumps({
                "inbounds": [{"tag": tag, "listen": "127.0.0.1", "port": 28401,
                              "protocol": "vless", "settings": {"decryption": "none", "clients": []},
                              "streamSettings": {"network": "tcp", "security": "none"}}],
                "outbounds": [{"tag": "direct", "protocol": "freedom"}],
                "routing": {"rules": []},
            }),
        })
        owner.request("PATCH", f"/collections/nodes/{guest.node}", {
            "profileId": profile["id"], "xrayLocalPort": 28401,
            "cdnMode": "all" if tag == "vless-cdn" else "standard",
        })
    return users


def require_loopback_ingress(guest):
    listener = guest.exec("ss", "-Hltnp", "sport", "=", ":28401")
    assert {line.split()[3] for line in listener.splitlines()} == {b"127.0.0.1:28401"}, listener


def qualify_pair(pair, users, panel, db, identity, lab):
    require_disposable()
    from quota_v2_release_candidate import verify_running_xray
    user_ids = list(users)

    def check(guest):
        for unit in ("xmesh-quota-v2-meter.service", "xmesh-quota-v2-egress.service",
                     "xmesh-quota-v2-ingress.service", "xmesh-quota-v2-renewal.timer",
                     "xmesh-pq-activation-recovery.service"):
            guest.exec("systemctl", "is-enabled", "--quiet", unit)
        guest.exec("test", "!", "-e", "/etc/xmesh-quota-v2-staging")
        guest.exec("test", "!", "-e", "/var/lib/xmesh-measured-lab")
        guest.exec("test", "!", "-e", "/etc/xmesh-quota-generations-staging.env")
        assert json.loads(guest.exec(lab.PRODUCT, "--identity")) == identity
        assert guest.exec("git", "-C", INSTALLED_ROOT, "rev-parse", "HEAD").strip().decode() == identity["sourceRevision"]
        # Metered bootstrap has its own operational installation path. Do
        # not mistake the normal strict-PQ libexec helpers (not installed
        # here) for the *actual* production-shaped metered systemd workers.
        for unit, helper in (
            ("xmesh-quota-v2-meter.service", "qualified_first_meter.py"),
            ("xmesh-quota-v2-renewal.service", "renewal_worker.py"),
            ("xmesh-quota-v2-ingress.service", "vless_ingress.py"),
        ):
            actual = guest.exec("systemctl", "show", unit, "-p", "ExecStart", "--value")
            prefix = ("argv[]=/usr/bin/python3 " + INSTALLED_WAL + "/" + helper + " ").encode()
            assert prefix in actual, (unit, actual)
        guest.exec("git", "-C", INSTALLED_ROOT, "diff", "--quiet", "HEAD", "--",
                   "experiments/quota-v2-physical-stop", "experiments/xray-dataplane-fence",
                   "deploy/xmesh-policy-guard-base.py")
        # No staging overrides and no substitute Xray or WAL path. Quiesce
        # only the test timer; a real installed oneshot must finish normally.
        guest.exec("systemctl", "stop", "xmesh-quota-v2-renewal.timer")
        guest.exec("systemctl", "start", "xmesh-quota-v2-renewal.service", timeout=150)
        paths = [STATE + f"/genesis-positive-cap-u{uid}.json" for uid in user_ids]
        for path in paths:
            guest.exec("test", "-f", path)
        verify_running_xray(guest, "xmesh-managed-xray", os.environ["XMESH_WAL_XRAY_SHA256"])
        # The ordinary first-Genesis frontend is only loopback (NOT TLS).
        # Do not send client traffic until the original readback succeeds.
        # Neither diagnostic ever opens a public listener.
        require_loopback_ingress(guest)
        guest.exec("install", "-d", "-m", "0700", WORK)
    # Installation may take time; do it before refreshing the short-lived
    # caps. The unrelated original metered release must remain unchanged.
    scenario = os.environ["XMESH_RELEASE_QUALIFICATION_SCENARIO"]
    native = scenario in ("public-tls-namespace-candidate", "public-tls-native-live")
    live = scenario == "public-tls-native-live"
    if native:
        from quota_v2_installed_namespace_candidate import install_candidate, prove_candidate
        parallel(lambda guest: install_candidate(guest, lab), pair)
        if live:
            from quota_v2_installed_native_live import prepare_live
            parallel(lambda item: prepare_live(item[0], lab, item[1]),
                     zip(pair, ("vless-main", "vless-cdn")))
    parallel(check, pair)
    # The full original-roster local proof must reconcile to actual SQL.
    actual = db.execute("SELECT node_id,user_id FROM quota_v2_signed_first_cap_outbox "
                        "ORDER BY node_id,user_id").fetchall()
    assert actual == sorted((guest.node, uid) for guest in pair for uid in user_ids), actual
    assert db.execute("SELECT count(*) FROM quota_v2_external_wal_birth_anchors").fetchone() == (0,)
    verify_readback(pair, user_ids, panel, lab, WORK, phase="pristine")
    assert db.execute("SELECT count(*) FROM quota_v2_external_wal_birth_anchors").fetchone() == (0,)
    assert db.execute("SELECT count(*) FROM quota_v2_public_tls_authority_outbox").fetchone() == (0,)
    print("PASS: both true installed qualified meters verified before traffic; no public TLS authority.", flush=True)

    if native:
        initial = parallel(prove_candidate, pair)

    if os.environ["XMESH_RELEASE_QUALIFICATION_SCENARIO"] in TRAFFIC_SCENARIOS:
        from quota_v2_installed_tls_wal_traffic import verify_spent_pair
        if live:
            from quota_v2_installed_native_live import native_traffic
            verify_spent_pair(pair, users, panel, db, lab, native_traffic=native_traffic)
        else:
            verify_spent_pair(pair, users, panel, db, lab)

    if native:
        assert parallel(prove_candidate, pair) == initial
        if not live:
            assert db.execute("SELECT count(*) FROM quota_v2_public_tls_authority_outbox").fetchone() == (0,)
        print("PASS: independently attested namespace child and original ordinary meter "
              "remained distinct and unchanged across real signed nonempty WAL readback; "
              "no production authority or listener.", flush=True)


def verify_readback(pair, user_ids, panel, lab, work, *, phase):
    assert phase in ("pristine", "unsynced", "committed")
    if phase != "pristine":
        assert os.environ["XMESH_RELEASE_QUALIFICATION_SCENARIO"] in TRAFFIC_SCENARIOS
    require_disposable()
    source = Path(os.environ["XMESH_PUBLIC_TLS_WAL_WATCH_SOURCE"]).resolve(strict=True)
    assert source.name == "public_tls_wal_watch.py" and source.is_file()
    source_bytes = source.read_bytes()
    expected = hashlib.sha256(source_bytes).hexdigest()
    user_id = user_ids[0]
    # Exact initial ledger shape from durable_fence.go and the signed cap
    # admission implementation. The probe verifies the actual held lock;
    # its presence alone cannot pass the readback.
    expected_ledger = {b"xray-instance.lock", *(
        f"positive-cap-u{uid}.json".encode("ascii") for uid in user_ids)}
    script = r"""
import errno
import hashlib
from pathlib import Path
import sys
import time
import stat

source, installed, panel, node, user, state, expected, phase = sys.argv[1:]
assert hashlib.sha256(Path(source).read_bytes()).hexdigest() == expected
sys.path.insert(0, str(Path(source).parent))
sys.path.insert(1, installed)
import public_tls_wal_watch as watch
assert Path(watch.__file__).resolve() == Path(source)
assert Path(installed).resolve(strict=True) == Path(installed)
for module in (watch.wal, watch.preflight, watch.qualification,
               watch.cap_install, watch.genesis_reservation, watch.preflight.quarantine):
    path = Path(module.__file__)
    assert path.resolve(strict=True) == path and path.parent == Path(installed)
    info = path.stat()
    assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
# The dormant module may be present as checked-out source, but it must
# only execute the separately pinned reviewed diagnostic copy above.
# Don't override any qualification pin, network client, clock, filesystem,
# runtime, signature checker or Unix peer observation. Only retry actual
# transient acquisition of the installed worker's pre-existing lock.
until = time.monotonic() + 12
while True:
    try:
        result = watch.probe(panel, int(node), int(user), state)
        assert result is None
        assert phase != "unsynced", "unexpected acceptance of stale empty remote history"
        break
    except ValueError as exc:
        # Actual Nexus still has no history; the precise independent
        # local-versus-remote mismatch must fail, not unrelated errors.
        if (phase != "unsynced" or str(exc) !=
                "foreign, expired, authorizing or mismatched Nexus WAL history"):
            raise
        break
    except BlockingIOError as exc:
        if exc.errno not in (errno.EAGAIN, errno.EWOULDBLOCK) or time.monotonic() >= until:
            raise
        time.sleep(0.2)
print("stale_remote_wal_refused" if phase == "unsynced"
      else "signed_wal_readback_verified_without_authority")
"""

    def check(guest):
        target = work + "/public_tls_wal_watch.py"
        # /run is the guest's tmpfs; docker cp addresses the outer
        # container filesystem instead. Stream into the actual guest
        # mount, with exclusive creation and private root ownership.
        assert guest.exec("stat", "-c", "%u:%g:%a", work).strip() == b"0:0:700"
        if phase == "pristine":
            lab.docker("exec", "-i", guest.name, "bash", "-ec",
                       'umask 077; set -C; cat > "$1"', "--", target,
                       input=source_bytes, timeout=15)
        assert guest.exec("stat", "-c", "%u:%g:%a:%h", target).strip() == b"0:0:600:1"
        assert guest.exec("sha256sum", target).split()[0].decode() == expected
        # Verify exact ledger shape and unchanged content at every phase,
        # independently of the signed readback.
        before = guest.exec("ls", "-1A", LEDGER)
        names = set(before.splitlines())
        if phase == "pristine":
            assert names == expected_ledger, (guest.node, before)
        else:
            streams = {name for name in names if STREAM.fullmatch(name)}
            assert len(streams) == 2 and names == expected_ledger | streams | {INVENTORY}, (
                guest.node, before)
        hashes = [LEDGER + "/" + name.decode("ascii") for name in sorted(names)]
        hash_before = guest.exec("sha256sum", *hashes)
        # The production-path ledger must be the actual nested Docker bind,
        # not an empty directory manufactured for the test.
        raw = json.loads(guest.exec("docker", "inspect", "--format", "{{json .}}",
                                   "xmesh-managed-xray"))
        mount = [m for m in raw["Mounts"] if m["Destination"] == "/run/xmesh-quota-runtime"]
        assert len(mount) == 1 and mount[0]["Source"] == str(Path(LEDGER).parent)
        assert mount[0]["Type"] == "bind" and mount[0]["RW"] is True
        lock_before = guest.exec("stat", "-c", "%d:%i:%u:%a", STATE + "/lock")
        output = guest.exec(
            "env", "XMESH_QUOTA_V2_AGENT_MODE=installed",
            "python3", "-I", "-B", "-c", script, target, INSTALLED_WAL,
            panel, str(guest.node), str(user_id), STATE, expected, phase, timeout=30)
        marker = (b"stale_remote_wal_refused" if phase == "unsynced" else
                  b"signed_wal_readback_verified_without_authority")
        assert output.strip() == marker, output
        assert guest.exec("stat", "-c", "%d:%i:%u:%a", STATE + "/lock") == lock_before
        assert guest.exec("ls", "-1A", LEDGER) == before
        assert guest.exec("sha256sum", *hashes) == hash_before
        if phase == "pristine":
            message = "independently verified signed empty remote WAL and actual pristine metered Xray"
        elif phase == "unsynced":
            message = "refused stale empty remote WAL after actual VLESS traffic"
        else:
            message = "independently verified committed signed nonempty remote WAL and actual metered bytes"
        print(f"PASS: installed Node {guest.node} {message}, readback grants no authority.", flush=True)

    parallel(check, pair)
