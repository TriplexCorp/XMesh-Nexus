#!/usr/bin/env python3
"""Real Nexus HTTP and PostgreSQL with two separately enrolled Node identities."""
import base64
import concurrent.futures
import copy
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

import psycopg

ROOT = Path(__file__).resolve().parents[1]
NODE = ROOT / ".ci-reviewed-node"
PATH = "/api/v1/node/quota-v2/wal"
URL = urlsplit(os.environ["XMESH_TEST_URL"])
DSN = os.environ["QUOTA_TEST_DSN"]
assert URL.scheme == "http" and URL.hostname == "127.0.0.1" and URL.port
assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
assert DSN.startswith("postgresql://quota_test:") and urlsplit(DSN).hostname == "127.0.0.1"

sys.path[:0] = [
    str(NODE / "tests"),
    str(NODE / "experiments/quota-v2-physical-stop"),
    str(NODE / "experiments/xray-dataplane-fence"),
]
from test_quota_v2_stop_chain import StopChainTests
import quota_v2_meter_wal_fixture as fixture
import verify_nexus_wal_anchor as verifier
import witness_inventory as producer
import quota_v2_external_wal_witness as nexus_verifier
import quota_v2_stop_chain_audit as signed


def b64(value):
    return base64.b64encode(value).decode("ascii")


def exchange(raw, headers):
    connection = http.client.HTTPConnection(URL.hostname, URL.port, timeout=20)
    try:
        connection.request("POST", PATH, raw, headers)
        response = connection.getresponse()
        payload = response.read()
        if response.getheader("Content-Type", "").startswith("application/json"):
            payload = json.loads(payload)
        return response.status, payload
    finally:
        connection.close()


def signed_exchange(node, key, body):
    raw = json.dumps(body, separators=(",", ":")).encode()
    stamp = int(time.time())
    nonce = secrets.token_hex(16)
    digest = hashlib.sha256(raw).hexdigest()
    with tempfile.NamedTemporaryFile() as message:
        message.write(f"XMESH1\nPOST\n{PATH}\n{node}\n{stamp}\n{nonce}\n{digest}\n".encode())
        message.flush()
        signature = subprocess.check_output([
            "openssl", "pkeyutl", "-sign", "-rawin", "-inkey", str(key), "-in", message.name
        ]).hex()
    return exchange(raw, {
        "Content-Type": "application/json",
        "X-XMesh-Timestamp": str(stamp),
        "X-XMesh-Nonce": nonce,
        "X-XMesh-Signature": signature,
    })


def expect(response, code):
    assert response[0] == code, response
    return response[1]


def pubkey(key):
    return subprocess.check_output([
        "openssl", "pkey", "-in", str(key), "-pubout", "-outform", "DER",
    ])[-32:].hex()


def enroll(conn, name, public):
    node, = conn.execute(
        "INSERT INTO panel_records(collection,data) VALUES('nodes',jsonb_build_object('name',%s::text)) RETURNING id",
        (name,),
    ).fetchone()
    conn.execute("INSERT INTO node_metric_keys(node_id,public_key) VALUES(%s,%s)", (node, public))
    return node


def checkpoint(fx, node):
    return producer.produce_witness(node, fx.before, str(fx.xray), fx.key, fx.pub)


def store(node, witness, index):
    return {"operation": "store", "nodeId": node, "witness": b64(witness), "inventory": b64(index)}


def latest(node, challenge):
    return {"operation": "head", "nodeId": node, "challenge": challenge}


def read_head(response, node, challenge, panel_pub):
    data = expect(response, 200)
    blob = {name: base64.b64decode(data[name], validate=True)
            for name in ("head", "receipt", "witness", "inventory")}
    envelope = signed._decode(blob["head"])
    signed._envelope(envelope, "Nexus WAL head")
    head = envelope["payload"]
    assert head == {
        "schemaVersion": 1, "kind": "xmesh.quota-v2.external-wal-head",
        "nodeId": node, "challenge": challenge, "sequence": head["sequence"],
        "registrySha256": hashlib.sha256(blob["inventory"]).hexdigest(),
        "receiptSha256": hashlib.sha256(blob["receipt"]).hexdigest(),
    }, head
    signed._verify_ed25519(head, envelope["signature"], b"XMESH_QUOTA_V2_REMOTE_WAL_HEAD_V1\x00", panel_pub)
    return {name: head[name] for name in ("sequence", "registrySha256")}, blob


def main():
    fx = StopChainTests("test_unrelated_user_wal_does_not_block_signed_account_stop")
    fx.setUp()
    try:
        with tempfile.TemporaryDirectory() as temp, psycopg.connect(DSN, autocommit=True) as db:
            run = secrets.token_hex(8)
            other = Path(temp) / "other.pem"
            subprocess.run(["openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(other)], check=True)
            node = enroll(db, "wal-" + run, pubkey(fx.key))
            other_node = enroll(db, "wal-other-" + run, pubkey(other))
            panel_pub = Path(os.environ["XMESH_TEST_POLICY_PUBLIC_KEY"])
            first_witness, first_index = checkpoint(fx, node)
            first = store(node, first_witness, first_index)
            expect(signed_exchange(other_node, other, first), 401)
            expect(signed_exchange(other_node, other, store(other_node, first_witness, first_index)), 400)
            expect(signed_exchange(node, fx.key, latest(node, secrets.token_hex(32))), 404)
            expect(exchange(b"X" * (545 * 1024), {"X-XMesh-Signature": "placeholder"}), 413)
            expect(signed_exchange(node, fx.key, store(node, first_witness, first_index + b"\n")), 400)
            print("PASS: scoped node identities, empty history, size limit and signed inventory binding")

            # Check both sides of a clean retry after a lost response, using
            # fresh authenticated request nonces and the exact same witness.
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
                responses = list(pool.map(lambda _: signed_exchange(node, fx.key, first), range(6)))
            acks = [expect(response, 200)["receipt"] for response in responses]
            assert len(set(acks)) == 1
            challenge = secrets.token_hex(32)
            old_response = signed_exchange(node, fx.key, latest(node, challenge))
            first_head, first_bundle = read_head(old_response, node, challenge, panel_pub)
            assert first_bundle["receipt"] == base64.b64decode(acks[0])
            expect(signed_exchange(other_node, other, latest(node, challenge)), 401)
            expect(signed_exchange(other_node, other, latest(other_node, challenge)), 404)
            print("PASS: concurrent exact retries converge and reads stay node-scoped")

            cp = copy.deepcopy(fx.cp)
            cp["runtimeId"] = "f" * 64
            cp["userId"] = 102
            cp["email"] = "xmesh-u102--vless-cdn"
            cp["inboundMeters"] = [{"email": cp["email"], "uplinkBytes": 3, "downlinkBytes": 11}]
            fixture.write_test_meter_intents(cp, fx.xray)
            newer_witness, newer_index = checkpoint(fx, node)
            newer = store(node, newer_witness, newer_index)

            # Force PostgreSQL to report a failure at COMMIT, after both INSERTs.
            db.execute("""CREATE FUNCTION wal_transport_test_failed_commit() RETURNS trigger
                          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'disposable commit fault'; END; $$""")
            db.execute("""CREATE CONSTRAINT TRIGGER wal_transport_test_commit_fault
                          AFTER INSERT ON quota_v2_external_wal_birth_sources
                          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
                          EXECUTE FUNCTION wal_transport_test_failed_commit()""")
            try:
                status, error = signed_exchange(node, fx.key, newer)
                assert status == 500 and "receipt" not in error, (status, error)
                count, = db.execute(
                    "SELECT COUNT(*) FROM quota_v2_external_wal_birth_anchors WHERE node_id=%s",
                    (node,),
                ).fetchone()
                assert count == 1
            finally:
                db.execute("DROP TRIGGER wal_transport_test_commit_fault ON quota_v2_external_wal_birth_sources")
                db.execute("DROP FUNCTION wal_transport_test_failed_commit()")
            expect(signed_exchange(node, fx.key, newer), 200)
            expect(signed_exchange(node, fx.key, first), 409)
            challenge = secrets.token_hex(32)
            response = signed_exchange(node, fx.key, latest(node, challenge))
            current_head, bundle = read_head(response, node, challenge, panel_pub)
            assert current_head["sequence"] > first_head["sequence"]
            try:
                read_head(old_response, node, challenge, panel_pub)
            except AssertionError:
                pass
            else:
                raise AssertionError("old head accepted under a fresh challenge")
            assert nexus_verifier.verify_nexus_committed_birth_ack(
                bundle["receipt"], bundle["witness"], bundle["inventory"], node, fx.pub, panel_pub
            )["canResume"] is False
            proof = verifier.verify_nexus_offhost_anchor(
                bundle["receipt"], bundle["witness"], bundle["inventory"],
                node, fx.pub, panel_pub, current_head, str(fx.xray),
            )
            assert proof["canResume"] is False and proof["refundableBytes"] == 0
            for file in fx.xray.glob("*.jsonl"):
                file.unlink()
            try:
                verifier.verify_nexus_offhost_anchor(
                    bundle["receipt"], bundle["witness"], bundle["inventory"],
                    node, fx.pub, panel_pub, current_head, str(fx.xray),
                )
            except ValueError as error:
                assert "rolled back" in str(error), error
            else:
                raise AssertionError("missing local WAL history accepted")
            print("PASS: commit failure emits no receipt, current head rejects stale proofs and lost history")
    finally:
        fx.doCleanups()


if __name__ == "__main__":
    main()
