"""Real installed first-Genesis WAL readback; no listener, issuer or mocks.

Only the hosted disposable two-Node test may execute this helper. It runs
the exact reviewed dormant Node verifier against the installed, independently
qualified Agent/Xray and actual strict-PQ Nexus transport. It never installs
that verifier into the Agent or changes the production release pin.
"""
import hashlib
import json
import os
from pathlib import Path

from quota_v2_installed_genesis_lease import STATE, parallel

INSTALLED_WAL = "/usr/local/libexec/xmesh-quota-wal/quota-v2-physical-stop"
LEDGER = "/var/lib/xmesh-first-meter/runtime/ledger"



def require_disposable():
    assert os.environ.get("GITHUB_ACTIONS") == "true"
    assert os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
    assert os.environ.get("XMESH_RELEASE_QUALIFICATION_SCENARIO") == "public-tls-wal-readback"
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
    user_ids = []
    for index in range(2):
        _, user = owner.request("POST", "/collections/users", {
            "username": f"ci_qualified_tls_wal_{index}", "squads": [squad["id"]],
            "hold": False, "used": 0, "limit": 0.016, "expireAt": 0,
            "cdnLimitGb": 0.008,
        })
        user_ids.append(user["id"])
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
    return user_ids


def qualify_pair(pair, user_ids, panel, db, identity, lab):
    require_disposable()
    from quota_v2_release_candidate import verify_running_xray

    def check(guest):
        for unit in ("xmesh-quota-v2-meter.service", "xmesh-quota-v2-egress.service",
                     "xmesh-quota-v2-ingress.service", "xmesh-quota-v2-renewal.timer",
                     "xmesh-pq-activation-recovery.service"):
            guest.exec("systemctl", "is-enabled", "--quiet", unit)
        guest.exec("test", "!", "-e", "/etc/xmesh-quota-v2-staging")
        guest.exec("test", "!", "-e", "/var/lib/xmesh-measured-lab")
        guest.exec("test", "!", "-e", "/etc/xmesh-quota-generations-staging.env")
        assert json.loads(guest.exec(lab.PRODUCT, "--identity")) == identity
        assert guest.exec("git", "-C", "/opt/xmesh-node", "rev-parse", "HEAD").strip().decode() == identity["sourceRevision"]
        # No staging overrides and no substitute Xray or WAL path. Quiesce
        # only the test timer; a real installed oneshot must finish normally.
        guest.exec("systemctl", "stop", "xmesh-quota-v2-renewal.timer")
        guest.exec("systemctl", "start", "xmesh-quota-v2-renewal.service", timeout=150)
        paths = [STATE + f"/genesis-positive-cap-u{uid}.json" for uid in user_ids]
        for path in paths:
            guest.exec("test", "-f", path)
        verify_running_xray(guest, "xmesh-managed-xray", os.environ["XMESH_WAL_XRAY_SHA256"])
        # The ordinary first-Genesis frontend is only loopback (NOT TLS).
        # Neither guest initiates client traffic or opens a public listener.
        listener = guest.exec("ss", "-Hltnp", "sport", "=", ":28401")
        assert b"127.0.0.1:28401" in listener and b"0.0.0.0:28401" not in listener, listener
        guest.exec("install", "-d", "-m", "0700", "/run/xmesh-ci-tls-wal-readback")
    parallel(check, pair)
    # The full original-roster local proof must reconcile to actual SQL.
    actual = db.execute("SELECT node_id,user_id FROM quota_v2_signed_first_cap_outbox "
                        "ORDER BY node_id,user_id").fetchall()
    assert actual == sorted((guest.node, uid) for guest in pair for uid in user_ids), actual
    assert db.execute("SELECT count(*) FROM quota_v2_external_wal_birth_anchors").fetchone() == (0,)
    verify_initial(pair, user_ids[0], panel, lab, "/run/xmesh-ci-tls-wal-readback")
    assert db.execute("SELECT count(*) FROM quota_v2_external_wal_birth_anchors").fetchone() == (0,)
    assert db.execute("SELECT count(*) FROM quota_v2_public_tls_authority_outbox").fetchone() == (0,)
    print("PASS: both true installed qualified meters verified before traffic; no public TLS authority.", flush=True)

def verify_initial(pair, user_id, panel, lab, work):
    require_disposable()
    source = Path(os.environ["XMESH_PUBLIC_TLS_WAL_WATCH_SOURCE"]).resolve(strict=True)
    assert source.name == "public_tls_wal_watch.py" and source.is_file()
    source_bytes = source.read_bytes()
    expected = hashlib.sha256(source_bytes).hexdigest()
    script = r"""
import errno
import hashlib
from pathlib import Path
import sys
import time

source, installed, panel, node, user, state, expected = sys.argv[1:]
assert hashlib.sha256(Path(source).read_bytes()).hexdigest() == expected
sys.path.insert(0, str(Path(source).parent))
sys.path.insert(1, installed)
import public_tls_wal_watch as watch
assert Path(watch.__file__).resolve() == Path(source)
for module in (watch.wal, watch.preflight, watch.qualification,
               watch.cap_install, watch.genesis_reservation, watch.preflight.quarantine):
    assert Path(module.__file__).resolve().parent == Path(installed)
assert not (Path(installed) / Path(source).name).exists()
# Don't override any qualification pin, network client, clock, filesystem,
# runtime, signature checker or Unix peer observation. Only retry actual
# transient acquisition of the installed worker's pre-existing lock.
until = time.monotonic() + 12
while True:
    try:
        result = watch.probe(panel, int(node), int(user), state)
        assert result is None
        break
    except BlockingIOError as exc:
        if exc.errno not in (errno.EAGAIN, errno.EWOULDBLOCK) or time.monotonic() >= until:
            raise
        time.sleep(0.2)
print("signed_wal_readback_verified_without_authority")
"""

    def check(guest):
        target = work + "/public_tls_wal_watch.py"
        # /run is the guest's tmpfs; docker cp addresses the outer
        # container filesystem instead. Stream into the actual guest
        # mount, with exclusive creation and private root ownership.
        assert guest.exec("stat", "-c", "%u:%g:%a", work).strip() == b"0:0:700"
        lab.docker("exec", "-i", guest.name, "bash", "-ec",
                   'umask 077; set -C; cat > "$1"', "--", target,
                   input=source_bytes, timeout=15)
        assert guest.exec("stat", "-c", "%u:%g:%a:%h", target).strip() == b"0:0:600:1"
        assert guest.exec("sha256sum", target).split()[0].decode() == expected
        # A first-ever generation must be pristine before any test sends
        # traffic. This check is separate from the signed readback.
        before = guest.exec("ls", "-1A", LEDGER)
        assert before and all(n.startswith(b"positive-cap-u") for n in before.splitlines())
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
            panel, str(guest.node), str(user_id), STATE, expected, timeout=30)
        assert output.strip() == b"signed_wal_readback_verified_without_authority", output
        assert guest.exec("stat", "-c", "%d:%i:%u:%a", STATE + "/lock") == lock_before
        assert guest.exec("ls", "-1A", LEDGER) == before
        print(f"PASS: installed Node {guest.node} independently verified signed empty remote WAL "
              "and actual pristine metered Xray, without authority.", flush=True)

    parallel(check, pair)
