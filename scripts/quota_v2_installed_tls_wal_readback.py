"""Real installed first-Genesis WAL readback; no listener, issuer or mocks.

Only the hosted disposable two-Node test may execute this helper. It runs
the exact reviewed dormant Node verifier against the installed, independently
qualified Agent/Xray and actual strict-PQ Nexus transport. It never installs
that verifier into the Agent or changes the production release pin.
"""
import hashlib
import os
from pathlib import Path

from quota_v2_installed_genesis_lease import STATE, parallel

INSTALLED_WAL = "/usr/local/libexec/xmesh-quota-wal/quota-v2-physical-stop"
LEDGER = "/var/lib/xmesh-first-meter/runtime/ledger"


def verify_initial(pair, user_id, panel, lab, work):
    assert os.environ.get("GITHUB_ACTIONS") == "true"
    assert os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
    source = Path(os.environ["XMESH_PUBLIC_TLS_WAL_WATCH_SOURCE"]).resolve(strict=True)
    assert source.name == "public_tls_wal_watch.py" and source.is_file()
    expected = hashlib.sha256(source.read_bytes()).hexdigest()
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
        lab.docker("cp", str(source), f"{guest.name}:{target}")
        guest.exec("chown", "root:root", target)
        guest.exec("chmod", "0600", target)
        # A first-ever generation must be pristine before any test sends
        # traffic. This check is separate from the signed readback.
        before = guest.exec("ls", "-1A", LEDGER)
        assert before and all(n.startswith(b"positive-cap-u") for n in before.splitlines())
        lock_before = guest.exec("stat", "-c", "%d:%i:%u:%a", STATE + "/lock")
        output = guest.exec(
            "env", "XMESH_QUOTA_V2_AGENT_MODE=installed",
            "python3", "-E", "-B", "-c", script, target, INSTALLED_WAL,
            panel, str(guest.node), str(user_id), STATE, expected, timeout=30)
        assert output.strip() == b"signed_wal_readback_verified_without_authority", output
        assert guest.exec("stat", "-c", "%d:%i:%u:%a", STATE + "/lock") == lock_before
        assert guest.exec("ls", "-1A", LEDGER) == before
        print(f"PASS: installed Node {guest.node} independently verified signed empty remote WAL "
              "and actual pristine metered Xray, without authority.", flush=True)

    parallel(check, pair)
