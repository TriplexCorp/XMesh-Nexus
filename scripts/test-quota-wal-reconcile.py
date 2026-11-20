#!/usr/bin/env python3
"""Two candidate WAL clients through actual Nexus HTTP and PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import copy
import json
import os
from pathlib import Path
import runpy
import secrets

import psycopg

suite = runpy.run_path(str(Path(__file__).with_name("test-quota-wal-transport.py")))
from wal_transport import sync_checkpoint
from sign_observation import sign_bytes


class Client:
    def __init__(self, fixture, node):
        self.fixture = fixture
        self.node = node
        self.sent = []
        self.drop_ack = False

    def post(self, body):
        self.sent.append(body["operation"])
        reply = suite["expect"](suite["signed_exchange"](self.node, self.fixture.key, body), 200)
        if self.drop_ack and body["operation"] == "store":
            self.drop_ack = False
            raise ConnectionError("simulated loss after a real committed HTTP write")
        return json.dumps(reply, separators=(",", ":")).encode()

    def run(self, action):
        fixture = self.fixture
        proof = sync_checkpoint(
            action, self.node, fixture.before, str(fixture.xray), fixture.pub,
            Path(os.environ["XMESH_TEST_POLICY_PUBLIC_KEY"]),
            lambda _, message: sign_bytes(fixture.key, message), self.post,
        )
        assert proof["offhostFullBirthIndexHeadMatched"]
        assert not proof["canResume"] and not proof["finalMeterVerified"]
        assert proof["refundableBytes"] == 0
        return proof

    def extend(self, offset):
        checkpoint = copy.deepcopy(self.fixture.cp)
        checkpoint["runtimeId"] = secrets.token_hex(32)
        checkpoint["userId"] = 200 + offset
        checkpoint["email"] = f"xmesh-u{200 + offset}--vless-cdn"
        checkpoint["inboundMeters"] = [
            {"email": checkpoint["email"], "uplinkBytes": 3, "downlinkBytes": 11},
        ]
        suite["fixture"].write_test_meter_intents(checkpoint, self.fixture.xray)


def main():
    with ExitStack() as stack:
        db = stack.enter_context(psycopg.connect(suite["DSN"], autocommit=True))
        clients = []
        for _ in range(2):
            fixture = suite["StopChainTests"]("test_unrelated_user_wal_does_not_block_signed_account_stop")
            stack.callback(fixture.doCleanups)
            fixture.setUp()
            node = suite["enroll"](db, "wal-reconcile-" + secrets.token_hex(8), suite["pubkey"](fixture.key))
            client = Client(fixture, node)
            assert client.run("store")["firstRemoteSnapshotWasOnlyBootstrap"]
            client.sent.clear()
            client.run("sync")
            assert client.sent == ["head"]
            clients.append(client)

        for i, client in enumerate(clients):
            client.extend(i)
            client.sent.clear()
        clients[0].drop_ack = True
        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = [pool.submit(client.run, "sync") for client in clients]
            try:
                first.result()
            except ConnectionError:
                pass
            else:
                raise AssertionError("missing expected acknowledgment loss")
            assert not second.result()["firstRemoteSnapshotWasOnlyBootstrap"]

        for i, client in enumerate(clients):
            assert client.sent == (["head", "store"] if i == 0 else ["head", "store", "head"])
            client.sent.clear()
            assert not client.run("sync")["firstRemoteSnapshotWasOnlyBootstrap"]
            assert client.sent == ["head"]
            rows = db.execute(
                "SELECT inventory_sequence FROM quota_v2_external_wal_birth_anchors "
                "WHERE node_id=%s ORDER BY inventory_sequence",
                (client.node,),
            ).fetchall()
            assert rows == [(2,), (4,)], rows
        print("Both Node identities extended their own history; lost ACK recovered without rewriting either ledger.")


if __name__ == "__main__":
    main()
