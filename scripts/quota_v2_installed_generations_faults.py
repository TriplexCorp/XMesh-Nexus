"""Hosted-only sitecustomize for the installed renewal service.

Each interceptor lets the real operation finish, then either returns its
original result or kills this process before the caller can use that result.
No response, signature, file or clock used by the Agent is fabricated.
"""
import functools
import os
from pathlib import Path
import signal
import sys

STATE = Path("/run/xmesh-quota-v2-faults")
MODULES = "/usr/local/libexec/xmesh-quota-wal/quota-v2-physical-stop"


def inject():
    sys.path.insert(0, MODULES)
    import cap_install
    import quarantine_policy
    import vless_ingress
    import wal_transport

    def armed():
        try:
            user, reservation, stage = (STATE / "armed").read_text().split()
        except FileNotFoundError:
            return None
        if stage not in ("g2", "g3"):
            raise ValueError("invalid installed-generation crash stage")
        return int(user), reservation, stage

    def interrupt_once(point, reservation, stage):
        # Re-arm the same failure points against the actual generation-2
        # predecessor. A marker from 1->2 must not suppress a 2->3 crash.
        marker_name = point if stage == "g2" else point + "-g3"
        try:
            fd = os.open(STATE / marker_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return
        with os.fdopen(fd, "w") as marker:
            marker.write(reservation + "\n")
            marker.flush()
            os.fsync(marker.fileno())
        os.kill(os.getpid(), signal.SIGKILL)

    def after(module, name, observe):
        original = getattr(module, name)

        @functools.wraps(original)
        def wrapper(*args, **kwargs):
            result = original(*args, **kwargs)
            scope = armed()
            if scope is not None:
                observe(scope, result, *args, **kwargs)
            return result

        setattr(module, name, wrapper)

    def after_write(scope, result, fd, data, target="genesis-quarantine-envelope.json"):
        user, first, stage = scope
        if data.get("userId") != user:
            return
        if target.startswith("wal-charge-request-") and data.get("reservationId") == first:
            interrupt_once("wal-request-durable", first, stage)
        elif target == f"calendar-delivery-u{user}-{first}.json":
            interrupt_once("successor-delivery-durable", first, stage)
        elif target == f"calendar-positive-u{user}-{first}.json":
            interrupt_once("successor-receipt-durable", first, stage)

    def after_charge(scope, result, root, request):
        _, first, stage = scope
        if request.get("operation") == "charge" and request["reservationId"] == first:
            # The product client received the real response, but the Agent
            # cannot record or act on it before the process dies.
            assert wal_transport.observed.strict_json(result).get("receipt")
            interrupt_once("wal-response-unrecorded", first, stage)

    def after_ipc(scope, result, path, pid, runtime, genesis, grant, grant_scope):
        user, first, stage = scope
        if grant_scope["userId"] == user and grant_scope["reservationId"] != first:
            interrupt_once("successor-ipc-acknowledged", grant_scope["reservationId"], stage)

    def after_route(scope, result, fd, payload, measured, predecessor=None, **kwargs):
        user, first, stage = scope
        if payload["userId"] == user and payload["reservationId"] != first:
            interrupt_once("successor-ingress-published", payload["reservationId"], stage)

    fence = cap_install.fence_calendar_in_xray

    @functools.wraps(fence)
    def interrupt_fence(path, pid, runtime, old_scope):
        scope = armed()
        target = (scope is not None and scope[:2] ==
                  (old_scope["userId"], old_scope["reservationId"]))
        if target:
            interrupt_once("before-calendar-fence", old_scope["reservationId"], scope[2])
        result = fence(path, pid, runtime, old_scope)
        if target:
            interrupt_once("calendar-fence-unrecorded", old_scope["reservationId"], scope[2])
        return result

    cap_install.fence_calendar_in_xray = interrupt_fence
    after(quarantine_policy, "_durable_store", after_write)
    after(wal_transport, "_post", after_charge)
    after(cap_install, "install_in_xray", after_ipc)
    after(vless_ingress, "publish", after_route)
    (STATE / "loaded").touch()


if (os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("XMESH_QUOTA_TEST_CRASH") == "1"
        and Path(sys.argv[0]).name == "renewal_worker.py"):
    inject()
