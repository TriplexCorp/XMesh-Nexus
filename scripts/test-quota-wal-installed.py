#!/usr/bin/env python3
"""Install two strict-PQ staging Nodes under real systemd on a disposable runner."""
import concurrent.futures
from contextlib import ExitStack
import errno
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import pty
import re
import secrets
import select
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

import psycopg

ROOT = Path(__file__).resolve().parents[1]
NODE = ROOT / ".ci-reviewed-node"
PRODUCT = "/usr/local/bin/xmesh-agent-xspv2-product"
SYNC = "xmesh-xray-sync"
METRICS = "xmesh-node-metrics"
CONTROL = "xmesh-node-control"
WAL_PATH = "/api/v1/node/quota-v2/wal"
DESIRED_PATH = "/api/v1/node/desired-config"
GENESIS_DOMAIN = b"XMESH_XRAY_GENESIS_PREPARED_V1\0"
XRAY = "xmesh-managed-xray"
XRAY_CONFIG = b'{"inbounds":[],"outbounds":[{"protocol":"blackhole"}],"stats":{}}\n'
AGENT_BUILDER = "golang:1.27.3-trixie"


def docker(*args, timeout=40, **kwargs):
    return subprocess.check_output(["docker", *args], timeout=timeout, **kwargs)


def wait_for(probe, timeout=90, *, label):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = probe()
        if result:
            return result
        time.sleep(1)
    raise AssertionError(f"timed out waiting for {label}")


def reference_identity(root, revision):
    # Match the installer build environment without taking the digest from
    # either guest. A root-owned copy keeps Go's VCS stamping consistent.
    source = root / "reviewed"
    output = root / "build"
    output.mkdir()
    version = (NODE / "AGENT_VERSION").read_text().strip()
    assert version in ("control-v6.0.25", "control-v6.0.27")
    subprocess.run(["git", "clone", "--no-hardlinks", "--no-checkout", NODE, source],
                   check=True, timeout=30)
    subprocess.run(["git", "-C", source, "checkout", "--detach", revision], check=True, timeout=30)
    subprocess.run(["sudo", "chown", "-R", "0:0", source], check=True, timeout=30)
    docker("run", "--rm", "-v", f"{source}:/src:ro", "-v", f"{output}:/out", "-w", "/src/agent/xspv2",
           AGENT_BUILDER, "env", "CGO_ENABLED=0", "go", "build", "-trimpath",
           "-ldflags", f"-X main.version={version} -X main.sourceRevision={revision}",
           "-o", "/out/product", "./cmd/xmesh-agent-xspv2-product", timeout=350)
    digest = hashlib.sha256((output / "product").read_bytes()).hexdigest()
    expected = {"version": version, "sourceRevision": revision, "artifactSha256": digest}
    assert json.loads(subprocess.check_output([output / "product", "--identity"], timeout=10)) == expected
    return expected


class Owner:
    def __init__(self, stack):
        address = urlsplit(os.environ["XMESH_TEST_URL"])
        assert address.hostname == "127.0.0.1" and address.scheme == "http"
        self.http = http.client.HTTPConnection(address.hostname, address.port, timeout=20)
        stack.callback(self.http.close)
        self.headers = {"Content-Type": "application/json", "Origin": address.geturl()}
        response, _ = self.request("POST", "/auth/login", {
            "username": os.environ["ADMIN_USERNAME"], "password": os.environ["ADMIN_PASSWORD"],
        })
        self.headers["Cookie"] = next(value.split(";", 1)[0] for name, value in response.getheaders()
                                      if name.lower() == "set-cookie" and value.startswith("xmesh_session="))

    def request(self, method, path, payload):
        self.http.request(method, "/api/v1" + path, json.dumps(payload), self.headers)
        response = self.http.getresponse()
        body = json.loads(response.read())
        assert response.status == (201 if path.startswith("/collections/") and method == "POST" else 200), (
            path, response.status, body)
        return response, body

    def assign_profile(self, node):
        _, profile = self.request("POST", "/collections/profiles", {
            "name": "Genesis closure profile",
            "config": json.dumps({
                "inbounds": [{"tag": "DE_VLESS", "listen": "127.0.0.1", "port": 28401,
                              "protocol": "vless", "settings": {"decryption": "none", "clients": []},
                              "streamSettings": {"network": "tcp", "security": "none"}}],
                "outbounds": [{"tag": "direct", "protocol": "freedom"}], "routing": {"rules": []},
            }),
        })
        self.request("PATCH", f"/collections/nodes/{node}", {
            "profileId": profile["id"], "xrayLocalPort": 28401,
        })


class Guest:
    def __init__(self, stack, image, network, node):
        self.name = "xmesh-installed-" + secrets.token_hex(8)
        self.node = node
        docker("run", "--detach", "--name", self.name, "--network", network,
               "--cgroupns", "private", "--privileged", "--tmpfs", "/run:rw,nosuid,nodev",
               "--tmpfs", "/run/lock:rw,nosuid,nodev", image)
        stack.callback(self.close)

    def close(self):
        # The guest owns its nested containerd shims and mounts. Let systemd
        # stop those services before removing the containing Docker guest.
        try:
            if self.ready():
                self.exec("bash", "-ec", """
systemctl stop xmesh-xray-sync.timer xmesh-node-metrics.timer xmesh-node-user-meter.timer 2>/dev/null || true
for name in xmesh-managed-xray xmesh-node; do
    if docker inspect --type container "$name" >/dev/null 2>&1; then
        docker rm -f "$name"
    fi
done
systemctl stop docker.socket docker.service containerd.service
""", timeout=55)
            docker("stop", "--timeout", "30", self.name, timeout=50)
        finally:
            docker("rm", "-fv", self.name, timeout=120)

    def exec(self, *command, timeout=30):
        return docker("exec", self.name, *command, timeout=timeout)

    def ready(self):
        command = ["docker", "exec", self.name, "systemctl", "is-active", "--quiet", "docker.service"]
        return subprocess.run(command, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0

    def prepare(self, root):
        wait_for(self.ready, label=f"systemd-managed Docker on Node {self.node}")
        assert self.exec("readlink", "/proc/1/exe").strip().endswith(b"/systemd")
        self.exec("test", "!", "-e", PRODUCT)
        docker("cp", root / "tls-root.pem", f"{self.name}:/usr/local/share/ca-certificates/xmesh-lab.crt")
        self.exec("update-ca-certificates")
        docker("cp", NODE / "bootstrap.sh", f"{self.name}:/root/xmesh-bootstrap.sh")

    def install(self, panel, identity, nexus_revision, token):
        primary, secondary = pty.openpty()
        command = ["docker", "exec", "-it", self.name, "env",
                   f"XMESH_NODE_RELEASE_REF={identity['sourceRevision']}",
                   f"XMESH_NEXUS_RELEASE_REF={nexus_revision}", "XMESH_QUOTA_V2_WAL_STAGE_AGENT=1",
                   f"XMESH_QUOTA_V2_AUTO_RENEW_STAGING={int(os.environ.get('XMESH_INSTALLED_GENESIS_LEASE') == '1')}",
                   "bash", "/root/xmesh-bootstrap.sh", panel, str(self.node), "8443"]
        process = subprocess.Popen(command, stdin=secondary, stdout=secondary, stderr=secondary)
        os.close(secondary)
        log = bytearray()
        # Both guest bootstrap commands run in parallel. Keep a bounded,
        # token-redacted per-guest tail to identify which installer failed.
        recent = bytearray()
        port_confirmed = False
        delivered = False
        token_bytes = token.encode("ascii")
        deadline = time.monotonic() + 650
        try:
            while time.monotonic() < deadline:
                readable, _, _ = select.select([primary], [], [], 1)
                if not readable:
                    if process.poll() is not None:
                        break
                    continue
                try:
                    chunk = os.read(primary, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    break
                # Raw PTY data is only retained until a complete line is
                # available; the diagnostic tail must never store the raw
                # enrollment token, even transiently.
                log += chunk
                if not port_confirmed and b"TCP port for XMesh Node [8443]:" in log:
                    os.write(primary, b"\n")
                    port_confirmed = True
                if not delivered and b"enrollment token (input hidden):" in log:
                    os.write(primary, token_bytes + b"\n")
                    delivered = True
                complete = log.rfind(b"\n") + 1
                if complete:
                    output = bytes(log[:complete]).replace(token_bytes, b"[REDACTED]")
                    recent += output
                    if len(recent) > 8192:
                        del recent[:-8192]
                    for line in output.splitlines(keepends=True):
                        sys.stdout.buffer.write(f"[installed Node {self.node}] ".encode() + line)
                    sys.stdout.buffer.flush()
                    del log[:complete]
            returncode = process.wait(timeout=5)
            if returncode != 0:
                excerpt = bytes(recent[-4096:])
                raise AssertionError(
                    f"bootstrap failed on Node {self.node} (exit {returncode}); "
                    f"last guest output: {excerpt.decode('utf-8', errors='replace')}"
                )
            assert port_confirmed and delivered, (
                f"bootstrap on Node {self.node} omitted required interactive steps"
            )
        finally:
            os.close(primary)
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)
            output = bytes(log).replace(token_bytes, b"[REDACTED]")
            if output:
                for line in output.splitlines(keepends=True):
                    sys.stdout.buffer.write(f"[installed Node {self.node}] ".encode() + line)
                sys.stdout.buffer.flush()

        assert json.loads(self.exec(PRODUCT, "--identity")) == identity
        assert self.exec("sha256sum", PRODUCT).split()[0].decode() == identity["artifactSha256"]
        self.exec(PRODUCT, "verify-active", "--panel", panel, "--node-id", str(self.node))
        if os.environ.get("XMESH_TEST_INSTALLED_CRASHES") == "1":
            denied = self.exec(
                "sh", "-ec",
                """candidate=$(mktemp /usr/local/bin/.ci-identity.XXXXXXXX)
trap 'rm -f "$candidate"' EXIT
cp "$1" "$candidate"
chmod 0700 "$candidate"
printf x >>"$candidate"
if output=$("$candidate" verify-active --panel "$2" --node-id "$3" 2>&1); then exit 1; fi
printf '%s\n' "$output"
""", "sh", PRODUCT, panel, str(self.node))
            assert b"running strict-PQ Agent differs from enrolled release identity" in denied, denied
            self.exec(PRODUCT, "verify-active", "--panel", panel, "--node-id", str(self.node))
        return json.loads(self.exec(PRODUCT, "wal-evidence", "--panel", panel, "--node-id", str(self.node)))["publicKey"]

    def check_quarantine(self):
        for timer in (f"{SYNC}.timer", f"{METRICS}.timer", "xmesh-node-user-meter.timer"):
            self.exec("systemctl", "is-enabled", "--quiet", timer)
            self.exec("systemctl", "is-active", "--quiet", timer)
        for path in ("/usr/local/sbin/xmesh-node-control", f"/etc/systemd/system/{CONTROL}.timer",
                     f"/etc/systemd/system/{CONTROL}.service"):
            self.exec("test", "!", "-e", path)
        environment = self.exec("systemctl", "show", SYNC, "-p", "Environment", "--value").split()
        assert b"XMESH_QUOTA_V2_WAL_RECONCILE=1" in environment
        assert self.exec("docker", "inspect", "-f", "{{.State.Running}}", "xmesh-node").strip() == b"true"
        assert b"xmesh-managed-xray" not in self.exec("docker", "ps", "--format", "{{.Names}}").splitlines()
        self.exec("python3", "-c", """
import errno
import socket
for port in (9443, 28401):
    with socket.socket() as client:
        client.settimeout(2)
        assert client.connect_ex(("127.0.0.1", port)) == errno.ECONNREFUSED, port
""")
        wait_for(lambda: b"requires a running managed Xray with restart disabled" in
                 self.exec("journalctl", "-u", SYNC, "--no-pager", "-o", "cat"),
                 label=f"cold-start refusal from the reconciler on Node {self.node}")

    def restart(self):
        before = self.exec("cat", "/proc/1/stat").split()[21]
        docker("restart", "--timeout", "25", self.name, timeout=55)
        wait_for(self.ready, label=f"systemd after restart on Node {self.node}")
        assert self.exec("cat", "/proc/1/stat").split()[21] != before

    def request(self, path, payload):
        script = (
            'tmp=$(mktemp -d /run/xmesh-lab.XXXXXXXX); trap \'rm -rf "$tmp"\' EXIT; '
            'cat > "$tmp/body"; "$1" request --path "$2" --body-file "$tmp/body" '
            '--status-file "$tmp/status" --output-file "$tmp/response"; '
            'cat "$tmp/status" "$tmp/response"'
        )
        raw = docker("exec", "-i", self.name, "bash", "-ec", script, "--", PRODUCT, path,
                     input=json.dumps(payload).encode(), timeout=30)
        code, document = raw.split(b"\n", 1)
        return int(code), json.loads(document)


def start_isolated_candidate(guest, archive, image, config_bytes=XRAY_CONFIG, *, preloaded=False, tag=None, binding=None):
    # This measurement fixture has no data-plane listeners or network.
    # Keep the normal timer from terminating it before the measurement.
    guest.exec("systemctl", "stop", f"{SYNC}.timer", f"{SYNC}.service")
    if not preloaded:
        with archive.open("rb") as bundle:
            docker("exec", "-i", guest.name, "docker", "load", stdin=bundle, timeout=90)
    guest.exec("install", "-d", "-m", "0700", "/var/lib/xmesh-measured-lab/wal")
    # A previous flat journal is evidence. Refuse it before starting a process
    # configured to use the nested ledger, including after an interrupted run.
    parent = "/var/lib/xmesh-measured-lab/wal"
    entries = set(guest.exec("ls", "-1A", parent).decode().splitlines())
    if entries - {"drain.sock", "cap-binding.json", "ledger"} or (entries and "ledger" not in entries):
        raise RuntimeError("refusing to start a new ledger over a prior Xray journal")
    guest.exec("install", "-d", "-m", "0700", parent + "/ledger")
    config = "/var/lib/xmesh-measured-lab/config.json"
    docker("exec", "-i", guest.name, "bash", "-ec", 'umask 077; cat > "$1"', "--", config,
           input=config_bytes)
    cap_env = []
    if binding is not None:
        assert tag in ("vless-main", "vless-cdn")
        location = "/var/lib/xmesh-measured-lab/wal/cap-binding.json"
        # A retry checks the pinned startup identity byte-for-byte, including
        # after a killed process. A partial write is never silently repaired.
        guest_binding = """
import os, stat, sys
path, raw = sys.argv[1], sys.stdin.buffer.read()
try:
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
except FileExistsError:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        st = os.fstat(fd)
        if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_nlink != 1
                or stat.S_IMODE(st.st_mode) != 0o600 or f.read(len(raw) + 1) != raw):
            raise ValueError('existing Xray startup binding differs')
else:
    with os.fdopen(fd, 'wb') as f:
        f.write(raw)
        f.flush()
        os.fsync(fd)
    parent_fd = os.open(os.path.dirname(path), os.O_DIRECTORY)
    try:
        os.fsync(parent_fd)
    finally:
        os.close(parent_fd)
"""
        docker("exec", "-i", guest.name, "python3", "-c", guest_binding, location,
               input=json.dumps(binding, sort_keys=True, separators=(",", ":")).encode())
        cap_env = ["-e", "XMESH_EXPERIMENTAL_SIGNED_CAP_BINDING=/run/xmesh-quota-runtime/cap-binding.json",
                   "-e", "XMESH_EXPERIMENTAL_SCOPED_INBOUNDS=" + tag]
    if binding and os.environ.get("XMESH_TEST_INSTALLED_GENERATIONS") == "1":
        cap_env += ["-e", "XMESH_QUOTA_PRIVATE_VLESS=1"]
    guest.exec("docker", "run", "-d", "--name", XRAY, "--network", "none", "--restart=no",
               "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
               "--user", "0:0", "-e", "GITHUB_ACTIONS=true", "-e", "XMESH_EXPERIMENTAL_DRAIN=1",
               "-e", "XMESH_EXPERIMENTAL_OBSERVED_DIR=/run/xmesh-quota-runtime/ledger",
               "-e", "XMESH_EXPERIMENTAL_DRAIN_SOCKET=/run/xmesh-quota-runtime/drain.sock",
               *cap_env,
               "-v", config + ":/etc/xray/config.json:ro",
               "-v", "/var/lib/xmesh-measured-lab/wal:/run/xmesh-quota-runtime:rw",
               image, "run", "-config", "/etc/xray/config.json")
    def candidate_ready():
        status = guest.exec("docker", "inspect", "-f", "{{.State.Running}}", XRAY).strip()
        if status != b"true":
            raise AssertionError(guest.exec("docker", "logs", "--tail", "30", XRAY).decode(errors="replace"))
        command = ["docker", "exec", guest.name, "test", "-S", "/var/lib/xmesh-measured-lab/wal/drain.sock"]
        return subprocess.run(command, timeout=10, capture_output=True).returncode == 0

    wait_for(candidate_ready, timeout=20, label=f"isolated Xray observation socket on Node {guest.node}")
    # Hash the executable backing this ACTUAL running kernel process,
    # not merely the build-host source artifact or Docker image tag.
    from quota_v2_release_candidate import verify_running_xray
    verify_running_xray(guest, XRAY, os.environ["XMESH_WAL_XRAY_SHA256"])


def try_genesis(guests, db, root, panel):
    fresh, prior = [guest for guest, _ in guests]
    image = os.environ["XMESH_WAL_XRAY_IMAGE"]
    assert re.fullmatch(r"sha256:[a-f0-9]{64}", image)
    archive = root / "xray-image.tar"
    docker("image", "save", "-o", archive, image)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda guest: start_isolated_candidate(guest, archive, image), (fresh, prior)))
    challenge = secrets.token_hex(32)
    digest = os.environ["XMESH_WAL_XRAY_SHA256"]
    config_digest = hashlib.sha256(XRAY_CONFIG).hexdigest()

    def measured(guest, config_pin=config_digest):
        return ["/usr/local/sbin/xmesh-quota-wal", "prepare-measured-genesis", "--panel", panel,
                "--node-id", str(guest.node), "--challenge", challenge,
                "--executable-sha256", digest, "--config-sha256", config_pin]

    def reject(guest, command, reason):
        failure = subprocess.run(["docker", "exec", guest.name, *command], capture_output=True, timeout=45)
        assert failure.returncode != 0 and reason in failure.stderr, failure.stderr.decode()

    public_der = subprocess.check_output([
        "openssl", "pkey", "-pubin", "-in", os.environ["XMESH_TEST_POLICY_PUBLIC_KEY"], "-outform", "DER",
    ], timeout=5)
    assert public_der[:12] == bytes.fromhex("302a300506032b6570032100") and len(public_der) == 44
    pin = "/var/lib/xmesh-xray-sync/policy-public-key"
    fresh.exec("test", "!", "-e", pin)
    reject(fresh, measured(fresh), b"policy-public-key")

    def install_pin(guest, key_hex):
        docker("exec", "-i", guest.name, "bash", "-ec", 'umask 077; cat > "$1"', "--", pin,
               input=key_hex.encode("ascii") + b"\n")

    for guest in (fresh, prior):
        install_pin(guest, public_der[12:].hex())
    reject(fresh, measured(fresh, "0" * 64), b"configuration pin mismatch")
    assert db.execute("SELECT runtime_id FROM quota_v2_xray_genesis WHERE node_id=%s",
                      (fresh.node,)).fetchone() == (None,)
    reject(prior, measured(prior), b"Nexus did not confirm WAL operation")
    receipt = json.loads(fresh.exec(*measured(fresh), timeout=45))
    assert receipt["algorithm"] == "Ed25519"
    payload = receipt["payload"]
    winner = {"operation": "prepare_genesis", "nodeId": fresh.node,
              "candidateRuntimeId": payload["candidateRuntimeId"], "challenge": challenge}
    assert re.fullmatch(r"[a-f0-9]{64}", winner["candidateRuntimeId"])
    assert fresh.request(WAL_PATH, dict(winner, nodeId=prior.node))[0] == 401
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        same, other = pool.map(lambda candidate: fresh.request(WAL_PATH, candidate),
                               (winner, dict(winner, candidateRuntimeId=secrets.token_hex(32))))
    assert same == (200, receipt) and other[0] == 409
    assert fresh.request(WAL_PATH, dict(winner, challenge=secrets.token_hex(32)))[0] == 409
    active = json.loads(fresh.exec("cat", "/var/lib/xmesh-agent/product/active.json"))
    assert payload == {
        "schemaVersion": 1, "kind": "xmesh.xray.genesis-prepared", "nodeId": fresh.node,
        "activationReceiptSha256": active["receiptSha256"],
        "candidateRuntimeId": winner["candidateRuntimeId"], "challenge": winner["challenge"],
        "preparedAtMs": payload["preparedAtMs"], "validUntilMs": payload["preparedAtMs"] + 120000,
        "authorizedBytes": 0, "canStart": False, "canResume": False,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    signature = root / "genesis.sig"
    message = root / "genesis.message"
    signature.write_bytes(bytes.fromhex(receipt["signature"]))
    message.write_bytes(GENESIS_DOMAIN + canonical)
    subprocess.run(["openssl", "pkeyutl", "-verify", "-pubin", "-rawin",
                    "-inkey", os.environ["XMESH_TEST_POLICY_PUBLIC_KEY"],
                    "-in", message, "-sigfile", signature], check=True, timeout=5)
    try:
        install_pin(fresh, secrets.token_hex(32))
        reject(fresh, measured(fresh), b"signed by foreign key")
    finally:
        install_pin(fresh, public_der[12:].hex())
    assert db.execute("SELECT count(*) FROM quota_v2_reservations").fetchone() == (0,)
    assert db.execute("SELECT runtime_id,challenge,receipt_signature FROM quota_v2_xray_genesis WHERE node_id=%s",
                      (fresh.node,)).fetchone() == (
        winner["candidateRuntimeId"], winner["challenge"], receipt["signature"],
    )
    fresh.exec("docker", "kill", "--signal", "KILL", XRAY)
    reject(fresh, measured(fresh), b"network-isolated nonrestarting candidate")
    assert prior.exec("docker", "inspect", "-f", "{{.State.Running}}", XRAY).strip() == b"true"
    for guest in (fresh, prior):
        guest.exec("docker", "rm", "-f", XRAY)
        guest.exec("systemctl", "start", f"{SYNC}.timer")
        guest.check_quarantine()
    print("Installed XSP/2: real isolated Xray process and pinned files checked before zero-byte genesis.")
    print("Killed candidate could not repeat local measurement; the peer Xray was still alive.")
    print("The installed verifier refused both a missing pin and a valid receipt under a foreign pin.")
    print("An existing Node without creation evidence, cross-node identity and competing runtime were rejected.")
    return fresh, winner, receipt


def restart_postgres(stack, dsn, db):
    container = os.environ["XMESH_WAL_POSTGRES_CONTAINER"]
    assert re.fullmatch("[0-9a-f]{64}", container)
    assert docker("inspect", "--format", "{{.Config.Image}}", container).strip() == b"timescale/timescaledb:2.30.0-pg18"
    db.close()
    docker("restart", "--timeout", "15", container, timeout=45)

    def connect():
        try:
            return psycopg.connect(dsn, autocommit=True, connect_timeout=3)
        except psycopg.OperationalError:
            return None

    return stack.enter_context(wait_for(connect, timeout=20, label="restarted disposable PostgreSQL"))


def main():
    assert os.environ.get("GITHUB_ACTIONS") == "true"
    assert os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
    dsn = os.environ["QUOTA_TEST_DSN"]
    assert dsn.startswith("postgresql://quota_test:") and urlsplit(dsn).hostname == "127.0.0.1"
    assert urlsplit(dsn).path == "/quota_wal_installed"
    nexus_revision = os.environ["XMESH_INSTALLED_NEXUS_REF"]
    revision = subprocess.check_output(["git", "-C", NODE, "rev-parse", "HEAD"], text=True).strip()
    assert re.fullmatch("[0-9a-f]{40}", nexus_revision) and re.fullmatch("[0-9a-f]{40}", revision)
    with tempfile.TemporaryDirectory(prefix="xmesh-installed-", dir=os.environ.get("RUNNER_TEMP")) as directory, ExitStack() as stack:
        root = Path(directory)
        stack.callback(subprocess.run, ["sudo", "chown", "-R", f"{os.getuid()}:{os.getgid()}", root],
                       check=True, timeout=25)
        identity = reference_identity(root, revision)
        # Both clean guests build the reviewed Agent themselves. Share the
        # host's already pulled compiler image to avoid three registry pulls
        # on the same anonymous runner IP.
        agent_builder = root / "agent-builder.tar"
        docker("image", "save", "-o", agent_builder, AGENT_BUILDER, timeout=90)
        builder_id = docker("image", "inspect", "--format", "{{.Id}}", AGENT_BUILDER).strip()
        image = docker("build", "-q", "-", input=(ROOT / "scripts/quota-wal-systemd.Dockerfile").read_bytes(),
                       timeout=480).decode().strip()
        network = "xmesh-systemd-lab-" + secrets.token_hex(8)
        docker("network", "create", network)
        stack.callback(docker, "network", "rm", network)
        bridge = docker("network", "inspect", "--format", "{{(index .IPAM.Config 0).Gateway}}", network).decode().strip()
        assert ipaddress.IPv4Address(bridge).is_private
        gateway = subprocess.Popen([os.environ["XMESH_WAL_TUNNEL_FIXTURE"], "-test.run=^TestServeWALTunnelFixture$", "-test.v"],
                                   env={**os.environ, "XMESH_WAL_TEST_BRIDGE": bridge,
                                        "XMESH_QUOTA_V2_WAL_TRANSPORT": "1",
                                        "XMESH_WAL_TUNNEL_FIXTURE_DIR": directory,
                                        "XSP_V2_PRODUCT_WAL_CANDIDATE_PIN": f"{revision}:{identity['artifactSha256']}"})

        def stop_gateway():
            (root / "done").touch()
            try:
                assert gateway.wait(timeout=10) == 0
            finally:
                if gateway.poll() is None:
                    gateway.kill()
                    gateway.wait(timeout=10)

        stack.callback(stop_gateway)
        ready = root / "ready.json"
        wait_for(ready.is_file, timeout=15, label="strict XSP/2 fixture")
        panel = json.loads(ready.read_text())["enrollment"]
        assert urlsplit(panel).hostname == bridge
        db = stack.enter_context(psycopg.connect(dsn, autocommit=True))
        owner = Owner(stack)
        guests = []
        for number in range(2):
            if number == 0 or os.environ.get("XMESH_INSTALLED_GENESIS_LEASE") == "1":
                _, record = owner.request("POST", "/collections/nodes", {
                    "name": f"New staging Node {number}", "addr": f"192.0.2.{1+number}",
                })
                node = record["id"]
            else:
                # Fixture for a pre-existing Node with no local WAL and no
                # durable creation attestation, enrolled using current keys.
                node, = db.execute(
                    "INSERT INTO panel_records(collection,data) VALUES ('nodes',jsonb_build_object('name',%s::text)) RETURNING id",
                    ("Existing staging Node without genesis evidence",),
                ).fetchone()
            token = secrets.token_hex(32)
            db.execute("INSERT INTO node_enrollment_tokens(token_hash,node_id,expires_at) VALUES(%s,%s,NOW()+INTERVAL '20 minutes')",
                       (hashlib.sha256(token.encode()).hexdigest(), node))
            guests.append((Guest(stack, image, network, node), token))

        def install(item):
            guest, token = item
            guest.prepare(root)
            with agent_builder.open("rb") as archive:
                docker("exec", "-i", guest.name, "docker", "image", "load", stdin=archive, timeout=120)
            assert guest.exec("docker", "image", "inspect", "--format", "{{.Id}}",
                              AGENT_BUILDER).strip() == builder_id
            return guest.install(panel, identity, nexus_revision, token)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.map(install, guests)
        agent_builder.unlink()
        assert first != second
        print(f"Two clean systemd guests installed pinned {identity['version']} and activated distinct XSP/2 identities.")

        if os.environ.get("XMESH_INSTALLED_GENESIS_LEASE") == "1":
            # Exercise the actual signed activation-recovery protocol on
            # installed Agent, before touching Xray. Node 1 loses the local
            # receipt and active marker after PostgreSQL committed. Node 2
            # loses only the active marker (fsynced receipt survives).
            # Both must recover the EXACT original XSP/2 identity without
            # re-enrollment, changing the node key or issuing new quotas.
            for index, (guest, _) in enumerate(guests):
                state = "/var/lib/xmesh-agent/product"
                original = {
                    name: guest.exec("sha256sum", f"{state}/{name}").split()[0].decode()
                    for name in ("activation-request.json", "activation-receipt.json",
                                 "active.json", "config.json")
                }
                before = db.execute(
                    "SELECT activation_request_sha256,receipt_sha256,release_source_revision "
                    "FROM node_xsp_product_nodes WHERE node_id=%s", (guest.node,)
                ).fetchone()
                assert before and before[0] and before[1]
                guest.exec("rm", f"{state}/active.json")
                if index == 0:
                    guest.exec("rm", f"{state}/activation-receipt.json")
                # Exercise the exact common preflight invoked by BOTH
                # production install entrypoints, not just its underlying
                # product CLI. It runs before any service shutdown and
                # must never request a second enrollment token.
                assert guest.exec(
                    "systemctl", "is-enabled", "xmesh-pq-activation-recovery.service"
                ).strip() == b"enabled"
                units = guest.exec("systemctl", "cat", f"{METRICS}.service")
                assert b"Requires=xmesh-pq-activation-recovery.service" in units
                assert b"After=xmesh-pq-activation-recovery.service" in units
                if index == 0:
                    # Lost response: the installer preflight first attempts
                    # the original signed request and then the strict tunnel.
                    result = guest.exec(
                        "bash", "-ec",
                        'source /opt/xmesh-node/deploy/xmesh-pq-install-guard.sh; '
                        'xmesh_verify_or_resume_enrolled_product "$@"',
                        "bash", state, PRODUCT, panel, str(guest.node),
                        timeout=60,
                    )
                    assert result.strip() == b"resumed", (
                        f"Node {guest.node} installer re-enrollment guard failed: {result!r}"
                    )
                else:
                    # Power cut after receipt fsync: systemd must reconstruct
                    # active.json from local signed evidence without Nexus
                    # access or a new enrollment token.
                    guest.exec(
                        "systemctl", "restart",
                        "xmesh-pq-activation-recovery.service", timeout=60,
                    )
                guest.exec(PRODUCT, "verify-active", "--panel", panel,
                           "--node-id", str(guest.node))
                if index == 1:
                    # Fail-closed reboot test: a present but corrupted
                    # active.json must block even an already installed
                    # metrics worker. Preserve the original signed receipt
                    # and restore the exact active marker after the test.
                    active_path = f"{state}/active.json"
                    saved_path = f"{state}/active.json.recovery-fixture"
                    guest.exec("mv", active_path, saved_path)
                    try:
                        guest.exec("cp", f"{state}/config.json", active_path)
                        rejected = subprocess.run(
                            ["docker", "exec", guest.name, "systemctl",
                             "restart", f"{METRICS}.service"],
                            capture_output=True, timeout=45,
                        )
                        assert rejected.returncode != 0, (
                            f"Node {guest.node} served metrics with a corrupted PQ activation"
                        )
                    finally:
                        guest.exec("mv", saved_path, active_path)
                        guest.exec(
                            "systemctl", "reset-failed",
                            "xmesh-pq-activation-recovery.service",
                            f"{METRICS}.service",
                        )
                    guest.exec(PRODUCT, "verify-active", "--panel", panel,
                               "--node-id", str(guest.node))
                for name, digest in original.items():
                    actual = guest.exec("sha256sum", f"{state}/{name}").split()[0].decode()
                    assert actual == digest, (
                        f"Node {guest.node} altered {name} during activation recovery"
                    )
                after = db.execute(
                    "SELECT activation_request_sha256,receipt_sha256,release_source_revision "
                    "FROM node_xsp_product_nodes WHERE node_id=%s", (guest.node,)
                ).fetchone()
                assert after == before, (
                    f"Node {guest.node} recovery mutated the signed activation ledger"
                )
            print("Two installed Agents recovered lost activation files with unchanged "
                  "original signed requests, receipts, database identity and keys.")

        if os.environ.get("XMESH_TEST_INSTALLED_REBOOT") == "1":
            # Recreate systemd PID 1 and all guest services on the SAME
            # persistent Docker guest rootfs. This is a disposable
            # systemd-container reboot qualification, not a kernel reboot.
            for guest, _ in guests:
                rootkey = "/var/lib/xmesh-agent/xsp-v2/keys/node-request.vault"
                state = "/var/lib/xmesh-agent/product"
                originals = {
                    name: guest.exec("sha256sum", f"{state}/{name}").split()[0]
                    for name in ("activation-request.json",
                                 "activation-receipt.json", "active.json")
                }
                original_key = guest.exec("sha256sum", rootkey).split()[0]
                docker("restart", "--time", "20", guest.name, timeout=140)
                wait_for(guest.ready, timeout=130,
                         label=f"rebooted systemd and nested Docker Node {guest.node}")
                assert guest.exec("readlink", "/proc/1/exe").strip().endswith(b"/systemd")
                guest.exec(PRODUCT, "verify-active", "--panel", panel,
                           "--node-id", str(guest.node))
                assert guest.exec("systemctl", "is-enabled",
                                  "xmesh-pq-activation-recovery.service").strip() == b"enabled"
                assert guest.exec("sha256sum", rootkey).split()[0] == original_key
                for name, digest in originals.items():
                    assert guest.exec("sha256sum", f"{state}/{name}").split()[0] == digest, (
                        f"systemd guest restart changed original PQ {name}"
                    )
                guest.exec("systemctl", "start", f"{METRICS}.service", timeout=60)
            print("Both systemd guest PID 1 instances rebooted with unchanged "
                  "encrypted keyring and original strict-PQ activation receipts.")

        def samples(node):
            return db.execute("SELECT count(*) FROM server_metric_samples WHERE node_id=%s", (str(node),)).fetchone()[0]

        for guest, _ in guests:
            wait_for(lambda: samples(guest.node), label=f"authenticated metrics on Node {guest.node}")
            guest.exec("systemctl", "restart", f"{METRICS}.service")
            guest.check_quarantine()
        print("Installed metrics reached PostgreSQL. The staged reconciler refused to start a cold Xray on either guest.")

        if os.environ.get("XMESH_INSTALLED_GENESIS_LEASE") == "1":
            from quota_v2_installed_genesis_lease import try_signed_lease_pair
            assert identity["version"] == "control-v6.0.27"
            try_signed_lease_pair(guests, db, root, panel, owner, stack, dsn, sys.modules[__name__])
            # Only emit qualification evidence after the full scenario
            # succeeds, never from setup or a partially completed test.
            qualification = os.environ.get("XMESH_RELEASE_QUALIFICATION_EVIDENCE")
            if qualification:
                from quota_v2_release_candidate import verify_measured_xray, write_installed_evidence
                scenario = os.environ["XMESH_RELEASE_QUALIFICATION_SCENARIO"]
                expected_scenario = (
                    "agent-sigkill" if os.environ.get("XMESH_TEST_INSTALLED_CRASHES") == "1"
                    else "managed-generations" if os.environ.get("XMESH_TEST_INSTALLED_GENERATIONS") == "1"
                    else "lease-recovery"
                )
                assert scenario == expected_scenario
                measured = []
                # The scenario may have replaced the original DB connection.
                with psycopg.connect(dsn, autocommit=True) as final_db:
                    for guest, _ in guests:
                        actual = json.loads(guest.exec(PRODUCT, "--identity"))
                        assert actual == identity
                        assert guest.exec("sha256sum", PRODUCT).split()[0].decode() == identity["artifactSha256"]
                        guest.exec(PRODUCT, "verify-active", "--panel", panel, "--node-id", str(guest.node))
                        enrolled = final_db.execute(
                            "SELECT state,release_version,release_source_revision,release_artifact_sha256 "
                            "FROM node_xsp_product_nodes WHERE node_id=%s", (guest.node,),
                        ).fetchone()
                        assert enrolled == ("active", identity["version"], identity["sourceRevision"], identity["artifactSha256"])
                        measured.append({"nodeId": guest.node, "identity": actual})
                # Compare the artifact that actually backed the tested
                # Docker Xray image to its originally recorded build hash.
                # A stale environment digest must never qualify new bytes.
                xray_sha = verify_measured_xray(
                    Path(os.environ["XMESH_WAL_XRAY_BINARY"]),
                    os.environ["XMESH_WAL_XRAY_SHA256"],
                )
                write_installed_evidence(
                    Path(qualification), scenario, nexus_revision, identity,
                    measured, xray_sha,
                )
            return

        fresh, original, receipt = try_genesis(guests, db, root, panel)
        db = restart_postgres(stack, dsn, db)
        wait_for(lambda: db.execute(
            "SELECT prepared_ms,receipt_signature FROM quota_v2_xray_genesis WHERE node_id=%s", (fresh.node,),
        ).fetchone() == (receipt["payload"]["preparedAtMs"], receipt["signature"]),
            label="committed genesis after PostgreSQL restart")
        for guest, _ in guests:
            before = {peer.node: samples(peer.node) for peer, _ in guests}
            guest.restart()
            for peer, _ in guests:
                wait_for(lambda: samples(peer.node) > before[peer.node], label=f"metrics after restart on Node {peer.node}")
                peer.exec(PRODUCT, "verify-active", "--panel", panel, "--node-id", str(peer.node))
                peer.check_quarantine()
        print("Both PID 1 instances restarted independently. Timers, active receipts, metrics and Xray quarantine survived.")
        assert fresh.request(WAL_PATH, original) == (200, receipt)
        owner.assign_profile(fresh.node)
        assert fresh.request(DESIRED_PATH, {
            "node_id": fresh.node, "quotaProtocolVersion": 2, "quotaLocalCounters": [],
        })[0] == 200
        assert fresh.request(WAL_PATH, original)[0] == 409
        fresh.check_quarantine()
        print("The exact receipt survived PostgreSQL and guest restarts. An ordinary signed policy closed genesis permanently.")

        peer = next(guest for guest, _ in guests if guest is not fresh)
        peer.exec("systemctl", "stop", f"{METRICS}.timer", f"{METRICS}.service")
        request = {"operation": "head", "nodeId": peer.node, "challenge": secrets.token_hex(32)}
        assert peer.request(WAL_PATH, request)[0] == 404
        nonce_sql = "SELECT count(*) FROM node_xsp_product_nonces WHERE node_id=%s"
        now = db.execute(
            "UPDATE node_xsp_public_keysets SET revoked_at=NOW() WHERE node_id=%s AND purpose='node_request'",
            (peer.node,),
        )
        assert now.rowcount == 1
        previous = db.execute(nonce_sql, (peer.node,)).fetchone()
        failure = subprocess.run(
            ["docker", "exec", peer.name, "bash", "-ec",
             'tmp=$(mktemp); trap \'rm -f "$tmp"\' EXIT; printf "%s" "$1" > "$tmp"; '
             '"$2" request --path "$3" --body-file "$tmp"',
             "--", json.dumps(request), PRODUCT, WAL_PATH],
            capture_output=True, timeout=30,
        )
        assert failure.returncode != 0 and b"HTTP 403" in failure.stderr
        assert db.execute(nonce_sql, (peer.node,)).fetchone() == previous
        assert fresh.request(WAL_PATH, original)[0] == 409
        print("Strict XSP/2 rejected the revoked peer key before recording a nonce. The other identity was unaffected.")


if __name__ == "__main__":
    main()
