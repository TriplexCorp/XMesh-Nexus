#!/usr/bin/env python3
"""Two real Agent product processes, strict XSP/2, Nexus and PostgreSQL.

The local WAL inputs are deterministic meter fixtures. The gateway uses
disposable TLS certificates and its production enrollment/tunnel handlers.
"""
import concurrent.futures
from contextlib import ExitStack
import copy
import hashlib
import json
import os
from pathlib import Path
import runpy
import secrets
import subprocess
import tempfile
import time

import psycopg

suite = runpy.run_path(str(Path(__file__).with_name("test-quota-wal-transport.py")))
from wal_transport import _write_public, sync_checkpoint
import witness_inventory as producer

STATE_ROOT = "/var/lib/xmesh-agent"


class Agent:
    def __init__(self, root, fixture_dir, panel, database, local):
        self.root = root
        self.local = local
        self.panel = panel
        self.ca = fixture_dir / "tls-root.pem"
        self.state = root / "state"
        self.state.mkdir(mode=0o700)
        self.node, = database.execute(
            "INSERT INTO panel_records(collection,data) VALUES('nodes',jsonb_build_object('name',%s::text)) RETURNING id",
            ("xsp-wal-" + secrets.token_hex(8),),
        ).fetchone()
        token = secrets.token_hex(32)
        database.execute(
            "INSERT INTO node_enrollment_tokens(token_hash,node_id,expires_at) VALUES(%s,%s,NOW()+INTERVAL '5 minutes')",
            (hashlib.sha256(token.encode()).hexdigest(), self.node),
        )
        token_path = self.root / "token"
        token_path.write_text(token, encoding="ascii")
        token_path.chmod(0o600)
        subprocess.run(["sudo", "chown", "root:root", token_path], check=True)
        try:
            self.run("bootstrap", "--panel", self.panel, "--node-id", str(self.node), "--token-file", token_path)
        finally:
            token_path.unlink()
        pub = json.loads(self.run("wal-evidence", "--panel", self.panel, "--node-id", str(self.node)))
        assert pub["nodeId"] == self.node
        self.public = pub["publicKey"]
        self.public_path = root / "node.pem"
        _write_public(self.public, self.public_path)
        self.sent = []
        self.drop_ack = False

    def run(self, *args):
        return subprocess.check_output([
            "sudo", "unshare", "--mount", "--propagation", "private", "bash", "-ec",
            'mount --bind "$1" /var/lib/xmesh-agent; shift; exec "$@"',
            "wal-test", self.state, "env", f"SSL_CERT_FILE={self.ca}",
            os.environ["XMESH_WAL_PRODUCT_AGENT"], *args,
        ], timeout=45)

    def post(self, body):
        self.sent.append(body["operation"])
        request = self.root / "request"
        request.write_text(json.dumps(body), encoding="utf-8")
        status = self.root / "status"
        raw = self.run("request", "--path", suite["PATH"], "--body-file", request, "--status-file", status)
        assert subprocess.check_output(["sudo", "cat", status], timeout=5).strip() == b"200", raw
        if self.drop_ack and body["operation"] == "store":
            self.drop_ack = False
            raise ConnectionError("discarded committed XSP/2 response")
        return raw

    def sign(self, _, message):
        assert message.startswith(producer.DOMAIN)
        path = self.root / "witness-payload"
        path.write_bytes(message[len(producer.DOMAIN):])
        path.chmod(0o600)
        subprocess.run(["sudo", "chown", "root:root", path], check=True)
        try:
            signed = json.loads(self.run(
                "wal-evidence", "--panel", self.panel, "--node-id", str(self.node), "--payload-file", path,
            ))
        finally:
            path.unlink()
        assert signed["nodeId"] == self.node and signed["publicKey"] == self.public
        return signed["signature"]

    def sync(self, op):
        proof = sync_checkpoint(
            op, self.node, self.local.before, str(self.local.xray), self.public_path,
            Path(os.environ["XMESH_TEST_POLICY_PUBLIC_KEY"]), self.sign, self.post,
        )
        assert proof["offhostFullBirthIndexHeadMatched"]
        assert not proof["canResume"] and proof["refundableBytes"] == 0
        return proof


def main():
    assert os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    binary = os.environ["XMESH_WAL_PRODUCT_AGENT"]
    identity = json.loads(subprocess.check_output([binary, "--identity"], timeout=10))
    assert identity["version"] == "control-v6.0.25"
    pin = identity["sourceRevision"] + ":" + identity["artifactSha256"]
    with tempfile.TemporaryDirectory(prefix="xmesh-xsp-wal-") as directory:
        root = Path(directory)
        with ExitStack() as stack:
            stack.callback(subprocess.run, ["sudo", "chown", "-R", f"{os.getuid()}:{os.getgid()}", root], check=True)
            assert not Path(STATE_ROOT).exists()
            subprocess.run(["sudo", "mkdir", "-m", "0700", STATE_ROOT], check=True)
            stack.callback(subprocess.run, ["sudo", "rmdir", STATE_ROOT], check=True)
            gateway = subprocess.Popen([
                os.environ["XMESH_WAL_TUNNEL_FIXTURE"], "-test.run=^TestServeWALTunnelFixture$", "-test.v",
            ], env={**os.environ,
                "XMESH_WAL_TUNNEL_FIXTURE_DIR": directory,
                "XMESH_QUOTA_V2_WAL_TRANSPORT": "1",
                "XSP_V2_PRODUCT_WAL_CANDIDATE_PIN": pin,
            })
            def stop_fixture():
                (root / "done").touch()
                try:
                    assert gateway.wait(timeout=10) == 0
                finally:
                    if gateway.poll() is None:
                        gateway.kill()
                        gateway.wait(timeout=5)
            stack.callback(stop_fixture)
            ready = root / "ready.json"
            if not wait_for_ready(ready):
                raise RuntimeError("gateway fixture did not become ready")
            panel = json.loads(ready.read_text())["enrollment"]
            assert panel.startswith("https://127.0.0.1:")
            database = stack.enter_context(psycopg.connect(suite["DSN"], autocommit=True))
            agents = []
            for offset in range(2):
                local = suite["StopChainTests"]("test_unrelated_user_wal_does_not_block_signed_account_stop")
                stack.callback(local.doCleanups)
                local.setUp()
                work = root / f"agent-{offset}"
                work.mkdir(mode=0o700)
                agent = Agent(work, root, panel, database, local)
                assert agent.sync("store")["firstRemoteSnapshotWasOnlyBootstrap"]
                checkpoint = copy.deepcopy(local.cp)
                checkpoint["runtimeId"] = secrets.token_hex(32)
                checkpoint["userId"] = 200 + offset
                checkpoint["email"] = f"xmesh-u{200 + offset}--vless-cdn"
                checkpoint["inboundMeters"] = [{"email": checkpoint["email"], "uplinkBytes": 3, "downlinkBytes": 11}]
                suite["fixture"].write_test_meter_intents(checkpoint, local.xray)
                agents.append(agent)

            assert agents[0].public != agents[1].public
            agents[0].drop_ack = True
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                first, second = [pool.submit(a.sync, "sync") for a in agents]
                try:
                    first.result()
                except ConnectionError:
                    pass
                else:
                    raise AssertionError("the first committed response was not discarded")
                assert not second.result()["firstRemoteSnapshotWasOnlyBootstrap"]
            for agent in agents:
                agent.sent.clear()
                agent.run("verify-active", "--panel", panel, "--node-id", str(agent.node))
                agent.sync("sync")
                assert agent.sent == ["head"]
                rows = database.execute(
                    "SELECT inventory_sequence FROM quota_v2_external_wal_birth_anchors "
                    "WHERE node_id=%s ORDER BY inventory_sequence", (agent.node,),
                ).fetchall()
                assert rows == [(2,), (4,)], rows
            print("Two activated 6.0.25 agents stored and recovered independent WAL through strict XSP/2.")


def wait_for_ready(path):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if path.is_file():
            return True
        time.sleep(0.1)
    return False


if __name__ == "__main__":
    main()
