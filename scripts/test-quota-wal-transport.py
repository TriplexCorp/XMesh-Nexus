#!/usr/bin/env python3
"""Real Nexus HTTP and PostgreSQL with two separately enrolled Node identities."""
import base64
import concurrent.futures
import copy
import gzip
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


def gateway_exchange(node, body, path=PATH):
    # Test the Rust API boundary after the authenticated XSP/2 gateway.
    # The outer hybrid TLS and dual-signature exchange is a separate test.
    return exchange(json.dumps(body, separators=(",", ":")).encode(), {
        "Content-Type": "application/json",
        "Origin": f"http://{URL.netloc}",
        "X-XSP-Product-Internal": os.environ["XSP_V2_PRODUCT_INTERNAL_TOKEN"],
        "X-XSP-Product-Node-Id": str(node),
        "X-XSP-Product-Path": path,
    })


def activate_gateway_fixture(conn, node, public):
    with conn.transaction():
        conn.execute(
            """INSERT INTO node_xsp_public_keysets
                 (node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public)
               VALUES (%s,'node_request',1,'fixture-ed','fixture-pq',%s,%s)""",
            (node, bytes.fromhex(public), secrets.token_bytes(1952)),
        )
        conn.execute(
            """INSERT INTO node_xsp_product_nodes
                 (node_id,state,key_epoch,ed25519_key_id,mldsa65_key_id,tls_spki_sha256,
                  release_version,release_source_revision,release_artifact_sha256,
                  activated_at,receipt_sha256,receipt_envelope)
               VALUES (%s,'active',1,'fixture-ed','fixture-pq',%s,'fixture',%s,%s,NOW(),%s,%s)""",
            (node, secrets.token_bytes(32), "a" * 40, "b" * 64, secrets.token_bytes(32), b"fixture"),
        )


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
    if "inventoryEncoding" in data:
        assert data["inventoryEncoding"] == "gzip"
        blob["inventory"] = gzip.decompress(blob["inventory"])
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


def check_index_capacity(db, panel_pub):
    fx = StopChainTests("test_unrelated_user_wal_does_not_block_signed_account_stop")
    fx.setUp()
    try:
        node = enroll(db, "wal-index-limit-" + secrets.token_hex(8), pubkey(fx.key))
        cap = 384 * 1024
        index = fx.xray / fixture.meter_inventory_audit.NAME
        cp = copy.deepcopy(fx.cp)

        def row(user_id, tag_length):
            return {"email": f"xmesh-u{user_id}--" + "x" * tag_length,
                    "uplinkBytes": 1, "downlinkBytes": 0}

        # All variable-width fields in these rows are the email tag and the
        # sequence. Measure one canonical row, then distribute the padding
        # over real tag fields to land exactly on the transfer boundary.
        before = index.stat().st_size
        cp["inboundMeters"] = [row(200000, 1)]
        fixture.write_test_meter_intents(cp, fx.xray)
        index_bytes = index.read_bytes()
        sequence = index_bytes.count(b"\n")
        fixed = len(index_bytes) - before - len(str(sequence))
        remaining = cap - len(index_bytes)
        count = 0
        while fixed + len(str(sequence + count + 1)) <= remaining:
            count += 1
            remaining -= fixed + len(str(sequence + count))
        rows = []
        for number in range(count):
            extra = min(127, remaining)
            rows.append(row(200001 + number, 1 + extra))
            remaining -= extra
        assert remaining == 0 and rows
        cp["inboundMeters"] = rows
        fixture.write_test_meter_intents(cp, fx.xray)
        witness, exact = checkpoint(fx, node)
        assert len(exact) == cap
        expect(signed_exchange(node, fx.key, store(node, witness, exact)), 200)

        cp["inboundMeters"] = [row(299999, 1)]
        fixture.write_test_meter_intents(cp, fx.xray)
        witness, oversized = checkpoint(fx, node)
        assert len(oversized) > cap and oversized.startswith(exact)
        expect(signed_exchange(node, fx.key, store(node, witness, oversized)), 400)
        challenge = secrets.token_hex(32)
        _, bundle = read_head(signed_exchange(node, fx.key, latest(node, challenge)), node, challenge, panel_pub)
        assert bundle["inventory"] == exact
        assert db.execute(
            "SELECT count(*) FROM quota_v2_external_wal_birth_anchors WHERE node_id=%s", (node,),
        ).fetchone() == (1,)
        print("PASS: valid 384 KiB inventory commits in full; signed extension over cap leaves the full prior head intact")
        cp["inboundMeters"] = [
            {"email": f"xmesh-u{400000+user}--vless-main", "uplinkBytes": 1, "downlinkBytes": 1}
            for user in range(500)
        ]
        fixture.write_test_meter_intents(cp, fx.xray)
        witness, large = checkpoint(fx, node)
        assert large.startswith(oversized)
        wire = gzip.compress(large, compresslevel=6, mtime=0)
        assert len(wire) < cap < len(large)
        request = dict(store(node, witness, wire), inventoryEncoding="gzip")
        altered = dict(request, inventory=b64(wire[:-1]))
        expect(signed_exchange(node, fx.key, altered), 400)
        exact_hash = hashlib.sha256(large).hexdigest()
        answer = expect(signed_exchange(node, fx.key, request), 200)
        assert expect(signed_exchange(node, fx.key, request), 200) == answer
        challenge = secrets.token_hex(32)
        head, bundle = read_head(signed_exchange(node, fx.key, latest(node, challenge)),
                                 node, challenge, panel_pub)
        assert bundle["inventory"] == large and bundle["receipt"] == base64.b64decode(answer["receipt"])
        assert db.execute(
            "SELECT inventory_sha256,inventory_bytes FROM quota_v2_external_wal_birth_anchors "
            "WHERE node_id=%s AND inventory_sequence=%s", (node, head["sequence"]),
        ).fetchone() == (exact_hash, large)
        print(f"PASS: 500 additional users' two-direction WAL births commit and replay intact "
              f"({len(large)} raw bytes, {len(wire)} compressed)")
    finally:
        fx.doCleanups()


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
            expect(exchange(b"", {
                "Content-Length": str(545 * 1024), "X-XMesh-Signature": "placeholder",
            }), 413)
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
            activate_gateway_fixture(db, node, pubkey(fx.key))
            expect(signed_exchange(node, fx.key, newer), 401)
            expect(gateway_exchange(other_node, newer), 401)
            expect(gateway_exchange(node, newer, "/api/v1/node/desired-config"), 401)
            expect(gateway_exchange(node, newer), 200)
            expect(gateway_exchange(node, first), 409)
            challenge = secrets.token_hex(32)
            response = gateway_exchange(node, latest(node, challenge))
            print("PASS: active XSP/2 registration requires the gateway's bound identity and operation")
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
            check_index_capacity(db, panel_pub)
    finally:
        fx.doCleanups()


if __name__ == "__main__":
    main()
