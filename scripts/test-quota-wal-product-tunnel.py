#!/usr/bin/env python3
"""Two real Agent product processes, strict XSP/2, Nexus and PostgreSQL.

The gateway uses disposable TLS certificates and its production handlers.
The instrumented-Xray mode uses WAL produced by real loopback VLESS traffic.
"""
import concurrent.futures
from contextlib import ExitStack
import copy
import hashlib
import http.client
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
from quota_wal_real_xray import MeteredXray

STATE_ROOT = "/var/lib/xmesh-agent"
DESIRED_PATH = "/api/v1/node/desired-config"


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
        raw = self.request(suite["PATH"], body)
        if self.drop_ack and body["operation"] == "store":
            self.drop_ack = False
            raise ConnectionError("discarded committed XSP/2 response")
        return raw

    def request(self, path, body):
        request = self.root / "request"
        request.write_text(json.dumps(body), encoding="utf-8")
        status = self.root / "status"
        raw = self.run("request", "--path", path, "--body-file", request, "--status-file", status)
        assert subprocess.check_output(["sudo", "cat", status], timeout=5).strip() == b"200", raw
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


def provision_signed_policies(agents):
    origin = suite["URL"]
    owner = http.client.HTTPConnection(origin.hostname, origin.port, timeout=20)
    headers = {"Content-Type": "application/json", "Origin": origin.geturl()}

    def request(method, path, body, expected):
        owner.request(method, "/api/v1" + path, json.dumps(body), headers)
        response = owner.getresponse()
        data = json.loads(response.read())
        assert response.status == expected, (path, response.status, data)
        return response, data

    try:
        response, _ = request("POST", "/auth/login", {
            "username": os.environ["ADMIN_USERNAME"], "password": os.environ["ADMIN_PASSWORD"],
        }, 200)
        headers["Cookie"] = next(value.split(";", 1)[0] for name, value in response.getheaders()
                                 if name.lower() == "set-cookie" and value.startswith("xmesh_session="))
        tag = "DE_VLESS"
        _, profile = request("POST", "/collections/profiles", {
            "name": "Strict XSP WAL test profile",
            "config": json.dumps({
                "inbounds": [{"tag": tag, "listen": "127.0.0.1", "port": 28401,
                              "protocol": "vless", "settings": {"decryption": "none", "clients": []},
                              "streamSettings": {"network": "tcp", "security": "none"}}],
                "outbounds": [{"tag": "direct", "protocol": "freedom"}], "routing": {"rules": []},
            }),
        }, 201)
        _, squad = request("POST", "/collections/squads", {"name": "Strict XSP WAL test squad", "inb": [tag]}, 201)
        _, user = request("POST", "/collections/users", {
            "username": "ci_strict_xsp_wal", "squads": [squad["id"]], "hold": False, "limit": 1, "used": 0,
        }, 201)
        for index, agent in enumerate(agents, start=1):
            request("PATCH", f"/collections/nodes/{agent.node}", {
                "addr": f"192.0.2.{index}", "profileId": profile["id"], "xrayLocalPort": 28401,
            }, 200)
    finally:
        owner.close()

    guard = runpy.run_path(str(suite["NODE"] / "deploy/xmesh-policy-guard-base.py"))
    public = subprocess.check_output([
        "openssl", "pkey", "-pubin", "-in", os.environ["XMESH_TEST_POLICY_PUBLIC_KEY"], "-outform", "DER",
    ], timeout=5)
    for agent in agents:
        state = agent.root / "policy"
        state.mkdir(mode=0o700)
        document = json.loads(agent.request(DESIRED_PATH, {
            "node_id": agent.node, "quotaProtocolVersion": 2, "quotaLocalCounters": [],
        }))
        assert document["policyPublicKey"] == public[-32:].hex()
        policy = guard["verify_envelope"](document, state, agent.node, first_contact=True)
        assert policy["version"] == 1
        assert any(row["userId"] == user["id"] for row in policy["users"])
    print("Both activated Agent identities received and verified their own Nexus-signed policy over strict XSP/2.")


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
            binary = os.environ.get("XMESH_WAL_XRAY_BINARY")
            for offset in range(2):
                work = root / f"agent-{offset}"
                work.mkdir(mode=0o700)
                if binary:
                    local = MeteredXray(
                        work, stack, Path(binary), os.environ["XMESH_WAL_XRAY_IMAGE"],
                        os.environ["XMESH_WAL_XRAY_SHA256"],
                    )
                    assert local.send(0) == 2
                else:
                    local = suite["StopChainTests"]("test_unrelated_user_wal_does_not_block_signed_account_stop")
                    stack.callback(local.doCleanups)
                    local.setUp()
                agent = Agent(work, root, panel, database, local)
                assert agent.sync("store")["firstRemoteSnapshotWasOnlyBootstrap"]
                if not binary:
                    checkpoint = copy.deepcopy(local.cp)
                    checkpoint["runtimeId"] = secrets.token_hex(32)
                    checkpoint["userId"] = 200 + offset
                    checkpoint["email"] = f"xmesh-u{200 + offset}--vless-cdn"
                    checkpoint["inboundMeters"] = [{"email": checkpoint["email"], "uplinkBytes": 3, "downlinkBytes": 11}]
                    suite["fixture"].write_test_meter_intents(checkpoint, local.xray)
                agents.append(agent)

            def extend(agent):
                if binary:
                    assert agent.local.send(1) == 4
                return agent.sync("sync")

            assert agents[0].public != agents[1].public
            agents[0].drop_ack = True
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                first, second = [pool.submit(extend, a) for a in agents]
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
            provision_signed_policies(agents)
            if binary:
                victim = agents[0]
                victim.local.crash()
                victim.sync("sync")
                next(victim.local.xray.glob("meter-*.jsonl")).unlink()
                victim.sent.clear()
                try:
                    victim.sync("sync")
                except (ValueError, OSError):
                    pass
                else:
                    raise AssertionError("missing real metered WAL was accepted")
                assert victim.sent == ["head"]
                assert not victim.local.inspect()["State"]["Running"]
                assert agents[1].local.inspect()["State"]["Running"]
                agents[1].sync("sync")
                print("Real main and CDN VLESS traffic produced both WAL directions. "
                      "After SIGKILL, one node rejected missing WAL while its peer still verified.")


def wait_for_ready(path):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if path.is_file():
            return True
        time.sleep(0.1)
    return False


if __name__ == "__main__":
    main()
