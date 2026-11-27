#!/usr/bin/env python3
"""Disposable guest-only native TLS rehearsal against the actual installed meter.

This file is copied to a private diagnostic directory, NOT installed as a
service or product helper. The runner provides only an ephemeral fixture
authority recorded in its own fresh PostgreSQL. All input/witness signatures
are verified by the pinned dormant Node modules.
"""
from contextlib import ExitStack, contextmanager
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import select
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import time
import uuid

PROOF = Path("/opt/xmesh-ci-namespace-proof")
INSTALLED = Path("/opt/xmesh-node/experiments/quota-v2-physical-stop")
STATE = "/var/lib/xmesh-xray-sync"
SOURCE = "/opt/xmesh-ci-namespace-source"
TARGET = "1.1.1.1"
PAYLOAD = bytes(range(256)) * 64
PORT = 443
ROUTE_ROOT = Path("/run/xmesh-quota-v2-public-tls")
CA = Path("/usr/local/share/ca-certificates/xmesh-native-ci.crt")
AUTHORITY = PROOF / "fixture-authority.json"
CANDIDATE_REV = "26b69f184a74a2ea6e58365dd9572f77d83be1e2"
MANIFEST_SHA = "4f3175f7fa821f5d5d6bab82cfa8e67070d2b4dd95f5b2be9a87eb24850d4192"
PROVENANCE_SHA = "b78efdf929a6512173cee139ffa5b086939af2ee590f6b6c0c98c1d268fd2fbc"


def require_guest():
    assert os.geteuid() == os.getegid() == 0
    assert os.environ.get("GITHUB_ACTIONS") == "true"
    assert os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
    assert os.environ.get("XMESH_RELEASE_QUALIFICATION_SCENARIO") == "public-tls-native-live"
    assert os.environ.get("XMESH_DISPOSABLE_BOUND_LISTENER_TEST") == "1"
    assert Path(__file__).resolve().parent == PROOF
    assert PROOF.stat().st_uid == 0 and PROOF.stat().st_mode & 0o777 == 0o700


def domain(tag):
    assert tag in ("vless-main", "vless-cdn")
    return "native-" + tag[6:] + ".example.com"


def openssl(*args):
    subprocess.run(["openssl", *map(str, args)], check=True, timeout=10,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def prepare(tag):
    require_guest()
    assert not CA.exists() and not ROUTE_ROOT.exists()
    assert os.readlink("/proc/self/ns/net") == os.readlink("/proc/1/ns/net")
    name = domain(tag)
    live = Path("/etc/letsencrypt/live") / name
    archive = Path("/etc/letsencrypt/archive") / name
    for directory in (live, archive):
        directory.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory.mkdir(mode=0o700, exist_ok=False)
    ROUTE_ROOT.mkdir(mode=0o700)
    with tempfile.TemporaryDirectory(prefix="xmesh-native-ci-ca-") as raw:
        root = Path(raw)
        cakey, cert, csr, key, leaf, ext = [root / x for x in
            ("ca.key", "ca.pem", "request.csr", "leaf.key", "leaf.pem", "tls.ext")]
        openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                "-nodes", "-days", "7", "-keyout", cakey, "-out", cert,
                "-subj", "/CN=XMesh native disposable TLS CA",
                "-addext", "basicConstraints=critical,CA:TRUE",
                "-addext", "keyUsage=critical,keyCertSign,cRLSign")
        ext.write_text("[server_cert]\nbasicConstraints=critical,CA:FALSE\n"
                       "keyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n"
                       "subjectAltName=DNS:" + name + "\n")
        openssl("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                "-nodes", "-out", csr, "-keyout", key, "-subj", "/CN=" + name)
        openssl("x509", "-req", "-in", csr, "-CA", cert, "-CAkey", cakey,
                "-CAcreateserial", "-days", "3", "-out", leaf,
                "-extensions", "server_cert", "-extfile", ext)
        # Actual canonical Certbot-shaped root-private guest lineages.
        (archive / "fullchain1.pem").write_bytes(leaf.read_bytes() + cert.read_bytes())
        (archive / "fullchain1.pem").chmod(0o644)
        (archive / "privkey1.pem").write_bytes(key.read_bytes())
        (archive / "privkey1.pem").chmod(0o600)
        (live / "fullchain.pem").symlink_to(archive / "fullchain1.pem")
        (live / "privkey.pem").symlink_to(archive / "privkey1.pem")
        CA.write_bytes(cert.read_bytes())
        CA.chmod(0o644)
    # Only the disposable guest trusts this disposable certificate root.
    subprocess.run(["update-ca-certificates"], check=True, timeout=25,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    print("native_fixture_lineage_ready", flush=True)


def modules():
    require_guest()
    sys.path.insert(0, str(INSTALLED))
    sys.path.insert(0, str(PROOF))
    import public_tls_preflight as preflight
    import wal_transport as wal
    import qualified_runtime_image as qualification
    for module in (wal, qualification, preflight.quarantine, preflight.genesis_reservation):
        assert Path(module.__file__).parent == INSTALLED
    assert Path(preflight.__file__).parent == PROOF
    return preflight, wal, qualification


@contextmanager
def original(panel, node, user):
    preflight, wal, qualification = modules()
    until = time.monotonic() + 10
    while True:
        try:
            fd, lock = preflight.quarantine._locked_private_state(STATE, read_only=True)
            break
        except BlockingIOError:
            if time.monotonic() >= until:
                raise
            time.sleep(0.1)
    try:
        pinned = wal._panel_pin()
        enrollment = preflight.quarantine._enrolled_activation(panel, node)
        activation = enrollment["activationReceiptSha256"]
        original = preflight.genesis_reservation._staged_original(fd, node, user, pinned, activation)
        pins = preflight.genesis_reservation._original_measurement_pins(fd, original, node, activation)
        assert pins == (qualification.read_identity(qualification.QUALIFICATION)["artifactSha256"],
                        original["reply"]["revision"])
        measured = wal._measure_quarantined_runtime(pins)
        roster = preflight._full_signed_roster(fd, original, node, activation, pinned, measured)
        assert roster.check() is None and user in roster._grants
        assert measured[3] == original["prepared"]["payload"]["candidateRuntimeId"]
        assert roster.profile_sha256 == original["reply"]["revision"]
        assert roster.genesis_sha == original["reply"]["policySha256"]
        scope = dict(nodeId=node, userId=user, activationReceiptSha256=activation,
                     genesisPolicySha256=original["reply"]["policySha256"], runtimeId=measured[3],
                     profileRevision=roster.profile_sha256, capRosterSha256=roster.roster_sha256,
                     requiredLifetimeMs=7000)
        yield scope, roster, original["reply"]["config"], pinned, measured, fd
    finally:
        os.close(lock)
        os.close(fd)


def binding(scope):
    return dict(node=scope["nodeId"], activation=scope["activationReceiptSha256"],
                genesis_sha=scope["genesisPolicySha256"], runtime_id=scope["runtimeId"])


def revocation_binding(scope, authority):
    return dict(**binding(scope), profile_sha256=scope["profileRevision"],
                roster_sha256=scope["capRosterSha256"],
                authority_sha256=hashlib.sha256(authority).hexdigest())


def exact(client, count):
    raw = bytearray()
    while len(raw) < count:
        block = client.recv(count - len(raw))
        if not block:
            raise EOFError("native VLESS stream truncated")
        raw += block
    return bytes(raw)


def stop(child):
    if child.poll() is None:
        child.kill()
    child.wait(timeout=5)


def child_line(child, prefix, *, match=None, timeout=8):
    deadline = time.monotonic() + timeout
    buf = getattr(child, "_ci_buf", b"")
    while time.monotonic() < deadline:
        if b"\n" not in buf:
            if not select.select([child.stdout], [], [], max(0, deadline-time.monotonic()))[0]:
                break
            data = os.read(child.stdout.fileno(), 65536)
            if not data:
                break
            buf += data
            assert len(buf) <= 1 << 20
            continue
        line, buf = buf.split(b"\n", 1)
        child._ci_buf = buf
        line = line.decode(errors="replace").strip()
        if (match(line) if match is not None else line.startswith(prefix)):
            return line
    raise AssertionError("missing native phase " + prefix)


def wait_native_started(child, *, startup_timeout=2, stability_timeout=1):
    # The adopted-listener marker precedes Xray core startup, when Go may
    # still create worker threads. Readiness is not authority: no probe
    # may transmit bytes until the original full post-transfer proof and
    # stop monitor check pass. Do not retry a failed security proof.
    child_line(child, "native core started", timeout=startup_timeout,
               match=lambda line: re.fullmatch(
                   r"\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}\.\d+ \[Warning\] core: Xray \d+\.\d+\.\d+ started", line) is not None)
    deadline = time.monotonic() + stability_timeout
    previous, stable_since = None, None
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise ValueError("native child exited during startup")
        threads = tuple(sorted(os.listdir(f"/proc/{child.pid}/task")))
        assert threads and all(t.isascii() and t.isdecimal() for t in threads)
        now = time.monotonic()
        if threads != previous:
            previous, stable_since = threads, now
        elif now - stable_since >= 0.15:
            return
        time.sleep(0.025)
    raise ValueError("native startup thread set did not settle before post-transfer proof")


def verify_revoked_wire(raw, challenge, args, pinned, wal, guard):
    """Independent evidence of actual signed *revoked*, not just failed RPC."""
    doc = wal.observed.strict_json(raw)
    assert raw == wal.observed.canonical(doc) + b"\n"
    if doc["payload"].get("revoked") is not True:
        return False
    claims = doc["payload"]
    expected = dict(schemaVersion=1, kind="xmesh.quota-v2.public-tls-revocation-witness",
        nodeId=args["node"], activationReceiptSha256=args["activation"],
        genesisPolicySha256=args["genesis_sha"], runtimeId=args["runtime_id"],
        profileRevision=args["profile_sha256"], authoritySha256=args["authority_sha256"],
        capRosterSha256=args["roster_sha256"], challenge=challenge, revoked=True,
        canServePublic=False, canStart=False, canResume=False)
    assert set(doc) == {"algorithm", "payload", "signature"} and doc["algorithm"] == "Ed25519"
    assert set(claims) == set(expected) | {"issuedAtMs", "validUntilMs"}
    assert all(type(claims[k]) is type(v) and claims[k] == v for k, v in expected.items())
    now = time.time_ns() // 1_000_000
    assert 0 < claims["issuedAtMs"] <= now < claims["validUntilMs"]
    assert now-claims["issuedAtMs"] <= 2000 and 0 < claims["validUntilMs"]-claims["issuedAtMs"] <= 7000
    guard.check_signature(claims, doc["signature"], pinned)
    return True


def supervisor(panel, node, user, tag, identity, echo_port, relay_fd, broker_pid, original_ns):
    require_guest()
    preflight, wal, qualification = modules()
    import public_tls_frontend as tls
    import public_tls_bound_listener as bound
    import public_tls_listener_manifest as manifests
    import public_tls_listener_readback as readback
    import public_tls_namespace as namespace
    import public_tls_namespace_route as native_routes
    import public_tls_namespace_inputs as native_inputs
    import public_tls_pinned_inputs as pinned_inputs
    import public_tls_namespace_launcher as launcher
    import public_tls_stop_monitor as monitor_lib
    import public_tls_revocation_relay as relay
    import public_tls_revocation_watch as revoke
    from namespace_candidate_executable import PinnedNamespaceCandidateExecutable

    assert os.readlink("/proc/1/ns/net") == original_ns != os.readlink("/proc/self/ns/net")
    assert [x["ifname"] for x in json.loads(subprocess.check_output(["ip", "-j", "link", "show"]))] == ["lo"]
    subprocess.run(["ip", "link", "set", "lo", "up"], check=True, timeout=5)
    sysctl = Path("/proc/sys/net/ipv4/ip_unprivileged_port_start")
    sysctl.write_text("1024\n")
    assert sysctl.read_text().strip() == "1024"
    authority = AUTHORITY.read_bytes()
    with ExitStack() as stack:
        fetch = stack.enter_context(relay.PrivateRevocationFetch(
            fd=relay_fd, broker_pid=broker_pid, original_ns=original_ns))
        # Independently authenticate the exact installed original inside the
        # isolated supervisor. Do not use the parent's claimed PID or roster.
        scope, roster, profile, pinned, measured, fd = stack.enter_context(original(panel, node, user))
        args = binding(scope)
        revocation_args = revocation_binding(scope, authority)
        assert {x["tag"] for x in profile["inbounds"]} == {tag}
        assert any(c["id"] == identity and c["email"] == f"xmesh-u{user}--{tag}"
                   for c in profile["inbounds"][0]["settings"]["clients"])
        seen_revoked = False

        def observe(challenge):
            nonlocal seen_revoked
            raw = fetch(challenge)
            seen_revoked |= verify_revoked_wire(raw, challenge, revocation_args, pinned,
                                                wal, preflight.quarantine._guard())
            return raw

        watch = revoke.SignedTlsRevocationWatch(fetch=observe, pinned=pinned, **revocation_args)
        config = tls.compile_signed_public_tls(profile, authority, pinned=pinned, **args)
        assert len(config["inbounds"]) == 1
        row = config["inbounds"][0]
        assert (row["tag"], row["port"]) == (tag, PORT)
        assert row["streamSettings"]["tlsSettings"]["serverName"] == domain(tag)
        inputs = stack.enter_context(pinned_inputs.PinnedTlsInputs(
            profile=profile, authority=authority, cap_watch=roster, enrolled_fd=fd,
            runtime_pid=measured[2], pinned=pinned, **args))
        routes = stack.enter_context(native_routes.NamespaceMeterInputs(inputs._routes))
        owner = stack.enter_context(socket.socket(socket.AF_INET, socket.SOCK_STREAM))
        owner.bind((row["listen"], PORT))
        manifest = stack.enter_context(manifests.ListenerManifest(
            inputs=inputs, config=config, authority=authority, cap_watch=roster,
            runtime_pid=measured[2], sockets={tag: owner},
            netns_cookie=bound.network_namespace_cookie(owner)))
        token = manifest._tokens[tag]
        root = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="xmesh-native-root-")))
        subprocess.run(["mount", "-t", "tmpfs", "-o", "mode=0700,size=1m,nosuid,nodev,noexec",
                        "tmpfs", str(root)], check=True, timeout=5)
        stack.callback(subprocess.run, ["umount", str(root)], check=True, timeout=5)
        (root / "proc").mkdir(mode=0o700)
        (root / "oldroot").mkdir(mode=0o700)
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        stack.callback(os.close, root_fd)
        native = native_inputs.NamespaceTlsInputs(original=inputs, native=routes,
            manifest=manifest, root_fd=root_fd, root_token=namespace.capture_root(root_fd))
        sealed = stack.enter_context(PinnedNamespaceCandidateExecutable(
            runtime_pid=measured[2], runtime_id=scope["runtimeId"],
            source_root=SOURCE, revision=CANDIDATE_REV,
            manifest_sha256=MANIFEST_SHA, provenance_sha256=PROVENANCE_SHA))
        proof = dict(profile=profile, authority=authority, runtime_pid=measured[2],
            cap_watch=roster, revocation_watch=watch, pinned_inputs=native,
            pinned_executable=sealed, pinned=pinned, **args)
        child = launcher.spawn_disposable(original_ns=original_ns, proof_args=proof)
        try:
            child_line(child, "xmesh_namespace_candidate_prebound")
            assert sealed.verify_child(child) is None
            assert native.verify_pretransfer(child) is None
            # Independently verify that the real native child inherited no
            # copy of the connected witness relay or broker pidfd.
            forbidden = {(os.fstat(fd).st_dev, os.fstat(fd).st_ino)
                         for fd in (relay_fd, fetch._pidfd)}
            for path in Path(f"/proc/{child.pid}/fd").iterdir():
                try:
                    info = path.stat()
                except FileNotFoundError:
                    continue
                assert (info.st_dev, info.st_ino) not in forbidden
            owner.close()
            monitor = monitor_lib.StopOnlyTlsMonitor(child=child, **proof)
            stack.callback(monitor._deadman.close)
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.settimeout(2)
                assert probe.connect_ex(("127.0.0.1", PORT)) == errno.ECONNREFUSED
            child.stdin.write("fixture_namespace_xray_transfer\n")
            child.stdin.flush()
            line = child_line(child, "xmesh_namespace_candidate_listener:")
            _, port, listener_fd = line.split(":")
            assert int(port) == PORT
            wait_native_started(child)
            assert native.observe_adopted(child, {tag:int(listener_fd)}) is None
            assert monitor.check_stop_only() is None
            # Actual TLS 1.3 VLESS client in the private supervisor netns;
            # only the original ordinary meter may dial the guarded echo.
            context = ssl.create_default_context(cafile=str(CA))
            context.minimum_version = ssl.TLSVersion.TLSv1_3
            with socket.create_connection(("127.0.0.1", PORT), timeout=3) as raw:
                with context.wrap_socket(raw, server_hostname=domain(tag)) as client:
                    assert client.version() == "TLSv1.3"
                    client.settimeout(4)
                    header = (b"\x00" + uuid.UUID(identity).bytes + b"\x00\x01" +
                              struct.pack(">H", echo_port) + b"\x01" + socket.inet_aton(TARGET))
                    client.sendall(header + PAYLOAD)
                    response = exact(client, 2)
                    assert response[0] == 0
                    if response[1]:
                        exact(client, response[1])
                    assert exact(client, len(PAYLOAD)) == PAYLOAD
                    assert monitor.check_stop_only() is None
                    print("native_tls_spent", flush=True)
                    # Runner holds the real SQL account row after both
                    # nodes report spend. Only an authentic signed revoked
                    # witness is a successful outcome of this test.
                    until = time.monotonic() + 18
                    while time.monotonic() < until:
                        try:
                            monitor.check_stop_only()
                        except ValueError as exc:
                            assert seen_revoked and "signed Nexus revocation witness lost or revoked" in str(exc), exc
                            break
                        time.sleep(0.1)
                    else:
                        raise AssertionError("actual signed revocation never reached isolated monitor")
                    assert monitor.stopped and child.wait(timeout=2) == -9
                    try:
                        assert client.recv(1) == b""
                    except (ssl.SSLEOFError, ConnectionResetError):
                        pass
            readback.verify_listen_state(token, listening=False)
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.settimeout(2)
                assert probe.connect_ex(("127.0.0.1", PORT)) == errno.ECONNREFUSED
            print("native_tls_signed_revocation_stopped", flush=True)
        finally:
            stop(child)
            # Bounded diagnostic output, no keys or authority envelopes.
            remaining = getattr(child, "_ci_buf", b"") + child.stdout.buffer.read(8192)
            if remaining:
                print(remaining.decode(errors="replace").replace(identity, "[disposable-uuid]"), file=sys.stderr)


ECHO = r"""
import socket,sys
target=sys.argv[1]
payload=bytes(range(256))*64
with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as listener:
    listener.settimeout(30)
    listener.bind((target,0))
    listener.listen(1)
    print(listener.getsockname()[1],flush=True)
    conn,peer=listener.accept()
    with conn:
        conn.settimeout(30)
        received=bytearray()
        while len(received)<len(payload):
            block=conn.recv(len(payload)-len(received))
            assert block
            received+=block
            conn.sendall(block)
        assert received==payload
        try:
            assert conn.recv(1)==b""
        except ConnectionResetError:
            pass
print("actual_guarded_echo_stopped",flush=True)
"""


def serve(panel, node, user, tag, identity):
    require_guest()
    preflight, wal, qualification = modules()
    import public_tls_revocation_relay as relay
    authority = AUTHORITY.read_bytes()
    with original(panel, node, user) as (scope, roster, profile, pinned, measured, _fd):
        args = revocation_binding(scope, authority)
        assert {x["tag"] for x in profile["inbounds"]} == {tag}
    floor = Path("/proc/sys/net/ipv4/ip_unprivileged_port_start").read_text()
    with ExitStack() as stack:
        echo = subprocess.Popen([sys.executable, "-I", "-B", "-c", ECHO, TARGET],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        stack.callback(stop, echo)
        assert select.select([echo.stdout], [], [], 5)[0]
        port = int(echo.stdout.readline())
        link = stack.enter_context(relay.HostedEnrolledRevocationRelay(
            state=STATE, user=user, **args))
        child = subprocess.Popen(["unshare", "--net", "--mount", "--propagation", "private",
            "--", sys.executable, "-I", "-B", str(Path(__file__)), "supervisor",
            panel, str(node), str(user), tag, identity, str(port), str(link.supervisor_fd),
            str(link.pid), link.original_ns], pass_fds=(link.supervisor_fd,))
        stack.callback(stop, child)
        link.bind_supervisor(child)
        until = time.monotonic() + 35
        while child.poll() is None and time.monotonic() < until:
            try:
                link.poll()
            except (ValueError, OSError, subprocess.SubprocessError):
                # Valid final disconnect is a process that already proved
                # the authenticated stop; every earlier error fails child.
                child.wait(timeout=5)
                break
        assert child.wait(timeout=3) == 0
        assert echo.wait(timeout=5) == 0, echo.stderr.read()
        assert echo.stdout.readline().strip() == "actual_guarded_echo_stopped"
        assert Path("/proc/sys/net/ipv4/ip_unprivileged_port_start").read_text() == floor
        print("native_tls_guest_verified", flush=True)


def main():
    require_guest()
    mode, *args = sys.argv[1:]
    if mode == "prepare":
        prepare(*args)
    elif mode == "scope":
        panel, node, user = args
        with original(panel, int(node), int(user)) as (scope, *_):
            print(json.dumps(scope, separators=(",", ":")))
    elif mode == "serve":
        panel, node, user, tag, identity = args
        serve(panel, int(node), int(user), tag, identity)
    elif mode == "supervisor":
        panel, node, user, tag, identity, port, fd, broker, ns = args
        supervisor(panel, int(node), int(user), tag, identity, int(port), int(fd), int(broker), ns)
    else:
        raise ValueError("unknown disposable native guest diagnostic")


if __name__ == "__main__":
    main()
