#!/usr/bin/env python3
"""Install two strict-PQ staging Nodes under real systemd on a disposable runner."""
import concurrent.futures
from contextlib import ExitStack
import errno
import hashlib
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
    subprocess.run(["git", "clone", "--no-hardlinks", "--no-checkout", NODE, source],
                   check=True, timeout=30)
    subprocess.run(["git", "-C", source, "checkout", "--detach", revision], check=True, timeout=30)
    subprocess.run(["sudo", "chown", "-R", "0:0", source], check=True, timeout=30)
    docker("run", "--rm", "-v", f"{source}:/src:ro", "-v", f"{output}:/out", "-w", "/src/agent/xspv2",
           "golang:1.27.3-trixie", "env", "CGO_ENABLED=0", "go", "build", "-trimpath",
           "-ldflags", f"-X main.version=control-v6.0.25 -X main.sourceRevision={revision}",
           "-o", "/out/product", "./cmd/xmesh-agent-xspv2-product", timeout=350)
    digest = hashlib.sha256((output / "product").read_bytes()).hexdigest()
    expected = {"version": "control-v6.0.25", "sourceRevision": revision, "artifactSha256": digest}
    assert json.loads(subprocess.check_output([output / "product", "--identity"], timeout=10)) == expected
    return expected


class Guest:
    def __init__(self, stack, image, network, node):
        self.name = "xmesh-installed-" + secrets.token_hex(8)
        self.node = node
        docker("run", "--detach", "--name", self.name, "--network", network,
               "--cgroupns", "private", "--privileged", "--tmpfs", "/run:rw,nosuid,nodev",
               "--tmpfs", "/run/lock:rw,nosuid,nodev", image)
        stack.callback(docker, "rm", "-fv", self.name)

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
                   "bash", "/root/xmesh-bootstrap.sh", panel, str(self.node), "8443"]
        process = subprocess.Popen(command, stdin=secondary, stdout=secondary, stderr=secondary)
        os.close(secondary)
        log = bytearray()
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
                log += chunk
                if not port_confirmed and b"TCP port for XMesh Node [8443]:" in log:
                    os.write(primary, b"\n")
                    port_confirmed = True
                if not delivered and b"enrollment token (input hidden):" in log:
                    os.write(primary, token_bytes + b"\n")
                    delivered = True
                complete = log.rfind(b"\n") + 1
                if complete:
                    sys.stdout.buffer.write(bytes(log[:complete]).replace(token_bytes, b"[REDACTED]"))
                    sys.stdout.buffer.flush()
                    del log[:complete]
            assert process.wait(timeout=5) == 0, f"bootstrap failed on Node {self.node}"
            assert port_confirmed and delivered
        finally:
            os.close(primary)
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)
            output = bytes(log).replace(token_bytes, b"[REDACTED]")
            sys.stdout.buffer.write(output)
            sys.stdout.buffer.flush()

        assert json.loads(self.exec(PRODUCT, "--identity")) == identity
        assert self.exec("sha256sum", PRODUCT).split()[0].decode() == identity["artifactSha256"]
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
        wait_for(lambda: b"requires a running managed Xray with restart disabled" in
                 self.exec("journalctl", "-u", SYNC, "--no-pager", "-o", "cat"),
                 label=f"cold-start refusal from the reconciler on Node {self.node}")

    def restart(self):
        before = self.exec("cat", "/proc/1/stat").split()[21]
        docker("restart", "--timeout", "25", self.name, timeout=55)
        wait_for(self.ready, label=f"systemd after restart on Node {self.node}")
        assert self.exec("cat", "/proc/1/stat").split()[21] != before


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
    with tempfile.TemporaryDirectory(prefix="xmesh-installed-") as directory, ExitStack() as stack:
        root = Path(directory)
        stack.callback(subprocess.run, ["sudo", "chown", "-R", f"{os.getuid()}:{os.getgid()}", root],
                       check=True, timeout=25)
        identity = reference_identity(root, revision)
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
        guests = []
        for number in range(2):
            node, = db.execute(
                "INSERT INTO panel_records(collection,data) VALUES ('nodes',jsonb_build_object('name',%s::text)) RETURNING id",
                (f"installed-wal-node-{number}",),
            ).fetchone()
            token = secrets.token_hex(32)
            db.execute("INSERT INTO node_enrollment_tokens(token_hash,node_id,expires_at) VALUES(%s,%s,NOW()+INTERVAL '20 minutes')",
                       (hashlib.sha256(token.encode()).hexdigest(), node))
            guests.append((Guest(stack, image, network, node), token))

        def install(item):
            guest, token = item
            guest.prepare(root)
            return guest.install(panel, identity, nexus_revision, token)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.map(install, guests)
        assert first != second
        print("Two clean systemd guests installed the pinned 6.0.25 release and activated distinct XSP/2 identities.")

        def samples(node):
            return db.execute("SELECT count(*) FROM server_metric_samples WHERE node_id=%s", (str(node),)).fetchone()[0]

        for guest, _ in guests:
            wait_for(lambda: samples(guest.node), label=f"authenticated metrics on Node {guest.node}")
            guest.exec("systemctl", "restart", f"{METRICS}.service")
            guest.check_quarantine()
        print("Installed metrics reached PostgreSQL. The staged reconciler refused to start a cold Xray on either guest.")

        for guest, _ in guests:
            before = {peer.node: samples(peer.node) for peer, _ in guests}
            guest.restart()
            for peer, _ in guests:
                wait_for(lambda: samples(peer.node) > before[peer.node], label=f"metrics after restart on Node {peer.node}")
                peer.exec(PRODUCT, "verify-active", "--panel", panel, "--node-id", str(peer.node))
                peer.check_quarantine()
        print("Both PID 1 instances restarted independently. Timers, active receipts, metrics and Xray quarantine survived.")


if __name__ == "__main__":
    main()
