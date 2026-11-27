#!/usr/bin/env python3
"""Disposable guest: physical original meter retirement after real TLS stop."""
import json
import os
from pathlib import Path
import subprocess
import sys

PROOF = Path("/opt/xmesh-ci-namespace-proof")
INSTALLED = Path("/opt/xmesh-node/experiments/quota-v2-physical-stop")
UNITS = ("xmesh-quota-v2-renewal.timer", "xmesh-quota-v2-renewal.service",
         "xmesh-quota-v2-ingress.service", "xmesh-quota-v2-meter.service")


def command(*args, timeout=10):
    return subprocess.check_output(args, timeout=timeout)


def quiesce():
    # Native TLS's child/relay/socket stop was already asserted by the
    # runner. Stop only the disposable guest's ordinary ingress/renewal and
    # oneshot starter. No modified installed files or alternate runtime.
    command("systemctl", "stop", *UNITS, timeout=30)
    for unit in UNITS:
        assert command("systemctl", "show", unit, "-p", "ActiveState", "--value").strip() == b"inactive"
    for port in (":443", ":28401"):
        assert not command("ss", "-Hltnp", "sport", "=", port).strip()


def retire(panel, node, user):
    # Require the same hosted guest restrictions used for the native live
    # TLS scenario, before even stopping its ordinary ingress worker.
    assert Path(__file__).resolve().parent == PROOF
    assert os.environ.get("XMESH_DISPOSABLE_FIRST_METER_RETIREMENT") == "1"
    sys.path.insert(0, str(PROOF))
    import quota_v2_native_tls_guest as native
    native.require_guest()
    preflight, wal, qualification = native.modules()
    import public_tls_meter_retirement as retirement
    import public_tls_wal_watch as watch
    assert Path(retirement.__file__).parent == Path(watch.__file__).parent == PROOF
    for module in (wal, qualification, watch.cap_install, watch.genesis_reservation):
        assert Path(module.__file__).parent == INSTALLED
    assert retirement.wal is wal
    retirement._require_disposable()
    quiesce()
    with native.original(panel, node, user) as (scope, roster, _profile, _pinned, measured, _fd):
        release = qualification.read_identity(qualification.QUALIFICATION)
        pins = (release["artifactSha256"], scope["profileRevision"])
        def current():
            assert qualification.read_identity(qualification.QUALIFICATION) == release
            actual = wal._measure_quarantined_runtime(pins)
            docker, directory = wal._bound_journal()
            assert (docker["Id"], docker["State"]["StartedAt"], docker["State"]["Pid"]) == actual[:3]
            return actual, directory
        with retirement.FirstGenesisRetirement(roster, user, measured, current) as proof:
            proof.fence_all()
            # Use the independently pinned immutable full container ID,
            # never kill by a recycled host PID or a mutable Docker name.
            command("docker", "kill", "--signal", "SIGKILL", measured[0])
            assert command("docker", "wait", measured[0]).strip() == b"137"
            result = proof.verify_exited()
        for unit in UNITS:
            assert command("systemctl", "show", unit, "-p", "ActiveState", "--value").strip() == b"inactive"
        for port in (":443", ":28401"):
            assert not command("ss", "-Hltnp", "sport", "=", port).strip()
        return result


if __name__ == "__main__":
    panel, node, user = sys.argv[1:]
    print(json.dumps(retire(panel, int(node), int(user)), separators=(",", ":")))
