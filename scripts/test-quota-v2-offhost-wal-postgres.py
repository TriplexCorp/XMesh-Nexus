#!/usr/bin/env python3
"""Disposable-only signed off-host Xray birth-prefix PostgreSQL regression."""
import concurrent.futures
import hashlib
import itertools
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import psycopg

import quota_v2_offhost_wal_registration as registrar

DSN = os.environ["QUOTA_TEST_DSN"]
assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
assert DSN.startswith("postgresql://quota_test:")
IDS = itertools.count(200000)


class IndependentOffhostBirthTests(unittest.TestCase):
    def setUp(self):
        self.node = next(IDS)
        self.root = tempfile.TemporaryDirectory(prefix="quota-v2-offhost-pg-")
        self.addCleanup(self.root.cleanup)
        self.dir = Path(self.root.name)
        self.key = self.dir / "node.pem"
        self.pub = self.dir / "node.pub"
        self.make_key(self.key, self.pub)
        self.base, self.tail = self.build_births(
            [(self.node, "uplink", "a" * 64)])
        self.first = self.sign(self.base, self.tail)
        self.extended, self.extended_tail = self.build_births(
            [(self.node, "uplink", "a" * 64),
             (self.node + 1, "downlink", "b" * 64)])

    @staticmethod
    def make_key(key, pub):
        subprocess.run(["openssl", "genpkey", "-algorithm", "Ed25519",
                        "-out", str(key)], check=True, capture_output=True)
        subprocess.run(["openssl", "pkey", "-in", str(key),
                        "-pubout", "-out", str(pub)],
                       check=True, capture_output=True)

    @staticmethod
    def build_births(items):
        prev = "0" * 64
        records = []
        for seq, (user, direction, runtime) in enumerate(items, 1):
            email = "xmesh-u" + str(user) + "--vless-main"
            filename = "meter-" + hashlib.sha256(
                (runtime + "\x00" + email + "\x00" + direction).encode()
            ).hexdigest() + ".jsonl"
            entry = {
                "schemaVersion": 1, "sequence": seq,
                "filename": filename, "runtimeId": runtime,
                "email": email, "direction": direction,
                "firstWalDigest": "c" * 64,
                "previousDigest": prev, "digest": "",
            }
            prev = hashlib.sha256(
                registrar._canonical(entry, sort=False) + b"\n"
            ).hexdigest()
            entry["digest"] = prev
            records.append(registrar._canonical(entry, sort=False) + b"\n")
        return b"".join(records), prev

    def sign(self, raw_index, tail, *, key=None, node=None):
        node = self.node if node is None else node
        key = self.key if key is None else key
        payload = {
            "schemaVersion": 1, "kind": registrar.KIND,
            "nodeId": node, "oldContainerId": "e" * 64,
            "oldStartedAt": "2026-11-20T12:00:00Z",
            "inventorySequence": raw_index.count(b"\n"),
            "inventorySha256": hashlib.sha256(raw_index).hexdigest(),
            "inventoryTailDigest": tail,
            "indexedWalCount": raw_index.count(b"\n"),
            "localBirthsIndependentlyChecked": True,
            "nexusPersisted": False,
            "carryforwardApplied": False,
            "canResume": False,
            "finalMeterVerified": False,
            "refundableBytes": 0,
        }
        self.message = self.dir / "message"
        self.message.write_bytes(registrar.DOMAIN + registrar._canonical(payload))
        sig = subprocess.run(
            ["openssl", "pkeyutl", "-sign", "-rawin",
             "-in", str(self.message), "-inkey", str(key)],
            check=True, capture_output=True).stdout
        self.assertEqual(len(sig), 64)
        envelope = {"algorithm": "Ed25519", "payload": payload,
                    "signature": sig.hex()}
        return registrar._canonical(envelope) + b"\n"

    def store(self, witness=None, index=None, *, public=None, node=None):
        signed = self.first if witness is None else witness
        raw = self.base if index is None else index
        with psycopg.connect(DSN) as conn:
            return registrar.register_verified(
                conn, signed, raw,
                self.node if node is None else node,
                self.pub if public is None else public)

    def rows(self):
        with psycopg.connect(DSN) as conn:
            return conn.execute(
                "SELECT count(*) FROM quota_v2_offhost_birth_witnesses "
                "WHERE node_id=%s", (self.node,)).fetchone()[0]

    def recovery(self, local):
        with psycopg.connect(DSN) as conn:
            return registrar.verify_remote_recovery_blocker(
                conn, self.node, local, self.pub)

    def test_signed_go_birth_index_is_stored_offhost_and_never_authorizes(self):
        self.assertEqual(registrar.validate_index(self.base), (1, self.tail))
        row = self.store()
        self.assertEqual(row[0], self.node)
        self.assertEqual(row[1], 1)
        self.assertEqual(row[2], hashlib.sha256(self.base).hexdigest())
        self.assertEqual(self.rows(), 1)
        result = self.recovery(self.base)
        self.assertTrue(result["externalBirthPrefixVerified"])
        self.assertFalse(result["canResume"])
        self.assertFalse(result["xrayBytesFinal"])
        self.assertEqual(result["refundableBytes"], 0)
        self.assertEqual(self.store(), row)

    def test_new_runtime_may_append_but_old_prefix_cannot_disappear(self):
        self.store()
        next_signed = self.sign(self.extended, self.extended_tail)
        second = self.store(next_signed, self.extended)
        self.assertEqual(second[1], 2)
        self.assertEqual(self.rows(), 2)
        self.assertEqual(self.recovery(self.extended)["canResume"], False)
        with self.assertRaisesRegex(ValueError, "rolled back"):
            self.recovery(self.base)
        for deleted in (b"", b"{}\n", self.base[:-1]):
            with self.subTest(deleted=deleted[:12]), self.assertRaises(ValueError):
                self.recovery(deleted)

    def test_local_wal_and_birth_index_both_deleted_cannot_reset_history(self):
        self.store()
        for locally_remaining in (b"", None):
            with self.subTest(remaining=locally_remaining), self.assertRaises(ValueError):
                self.recovery(locally_remaining)
        self.assertEqual(self.rows(), 1)

    def test_parallel_first_registration_is_idempotent(self):
        def one(_):
            return self.store()
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(one, range(10)))
        self.assertTrue(all(x == results[0] for x in results))
        self.assertEqual(self.rows(), 1)

    def test_parallel_conflicts_cannot_replace_previous_commit(self):
        original = self.store()
        other_index, other_tail = self.build_births(
            [(self.node + 2, "downlink", "d" * 64)])
        alternative = self.sign(other_index, other_tail)
        def one(_):
            return self.store(alternative, other_index)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = [pool.submit(one, i) for i in range(8)]
            for future in results:
                with self.assertRaises(psycopg.Error) as caught:
                    future.result()
                self.assertEqual(caught.exception.sqlstate, "22023")
        self.assertEqual(self.rows(), 1)
        self.assertEqual(self.store(), original)

    def test_public_key_rotation_and_foreign_node_cannot_extend_existing_history(self):
        self.store()
        other = self.dir / "foreign.pem"
        other_pub = self.dir / "foreign.pub"
        self.make_key(other, other_pub)
        later = self.sign(self.extended, self.extended_tail, key=other)
        with self.assertRaises(psycopg.Error) as caught:
            self.store(later, self.extended, public=other_pub)
        self.assertEqual(caught.exception.sqlstate, "22023")
        with self.assertRaises(ValueError):
            self.store(public=other_pub)
        with self.assertRaises(ValueError):
            self.store(node=self.node + 1)
        self.assertEqual(self.rows(), 1)

    def test_wrong_signature_flags_json_torn_chain_and_filename_are_rejected(self):
        self.store()
        document = registrar._json(self.first)
        for field, invalid in (
            ("canResume", True), ("finalMeterVerified", True),
            ("nexusPersisted", True), ("carryforwardApplied", True),
            ("refundableBytes", 99), ("inventoryTailDigest", "0" * 64),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                altered = registrar._json(self.first)
                altered["payload"][field] = invalid
                self.store(registrar._canonical(altered) + b"\n")
        altered = registrar._json(self.first)
        altered["signature"] = ("0" if document["signature"][0] != "0" else "1") + document["signature"][1:]
        with self.assertRaises(ValueError):
            self.store(registrar._canonical(altered) + b"\n")
        for bad in (
            self.first + b"\n",
            self.first.replace(b'"algorithm":', b'"algorithm":"Ed25519","algorithm":', 1),
        ):
            with self.assertRaises(ValueError):
                self.store(bad)
        changed = registrar._json(self.base)
        changed["filename"] = "meter-" + "0" * 64 + ".jsonl"
        with self.assertRaises(ValueError):
            self.store(index=registrar._canonical(changed, sort=False) + b"\n")
        self.assertEqual(self.rows(), 1)

    def test_database_witness_is_immutable_even_for_owner(self):
        self.store()
        for sql in (
            "UPDATE quota_v2_offhost_birth_witnesses SET inventory_sequence=5",
            "DELETE FROM quota_v2_offhost_birth_witnesses",
            "TRUNCATE quota_v2_offhost_birth_witnesses",
        ):
            with self.subTest(sql=sql), self.assertRaises(psycopg.Error) as error:
                with psycopg.connect(DSN) as conn:
                    conn.execute(sql)
            self.assertEqual(error.exception.sqlstate, "22023")
        self.assertEqual(self.rows(), 1)

    def test_transaction_failure_before_commit_does_not_ack_external_witness(self):
        with self.assertRaises(RuntimeError):
            with psycopg.connect(DSN) as conn:
                registrar.register_verified(
                    conn, self.first, self.base, self.node, self.pub)
                raise RuntimeError("power lost before COMMIT")
        self.assertEqual(self.rows(), 0)
        with self.assertRaisesRegex(ValueError, "no independently committed"):
            self.recovery(self.base)
        self.store()
        self.assertEqual(self.rows(), 1)


if __name__ == "__main__":
    unittest.main()
