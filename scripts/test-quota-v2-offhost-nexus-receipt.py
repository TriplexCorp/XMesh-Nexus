#!/usr/bin/env python3
"""Disposable signed Nexus off-host WAL birth ACK, never production admission."""
import concurrent.futures
import importlib.util
import itertools
import os
from pathlib import Path
import unittest
from unittest import mock

import psycopg

import quota_v2_offhost_nexus_receipt as receipt
import quota_v2_offhost_wal_registration as births

ROOT = Path(__file__).resolve().parents[1]
DSN = os.environ["QUOTA_TEST_DSN"]
assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
assert DSN.startswith("postgresql://quota_test:")
spec = importlib.util.spec_from_file_location(
    "offhost_birth_fixture", ROOT / "scripts/test-quota-v2-offhost-wal-postgres.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.IDS = itertools.count(300000)


class CommittedNexusBirthReceiptTests(unittest.TestCase):
    def setUp(self):
        self.fx = fixture.IndependentOffhostBirthTests(
            "test_signed_go_birth_index_is_stored_offhost_and_never_authorizes")
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.nexus_private = self.fx.dir / "nexus.pem"
        self.nexus_public = self.fx.dir / "nexus.pub"
        self.fx.make_key(self.nexus_private, self.nexus_public)
        self.nexus_private.chmod(0o600)

    def register(self, signed=None, index=None):
        return receipt.register_commit_then_sign(
            DSN, self.fx.first if signed is None else signed,
            self.fx.base if index is None else index,
            self.fx.node, self.fx.pub, self.nexus_private)

    def verify(self, raw, *, signed=None, index=None, key=None):
        return receipt.verify_receipt(
            raw, self.fx.first if signed is None else signed,
            self.fx.base if index is None else index,
            self.fx.node, self.fx.pub,
            self.nexus_public if key is None else key)

    def db_verify(self, raw, *, signed=None, index=None):
        with psycopg.connect(DSN) as conn:
            return receipt.verify_receipt_against_committed_db(
                conn, raw, self.fx.first if signed is None else signed,
                self.fx.base if index is None else index,
                self.fx.node, self.fx.pub, self.nexus_public)

    def test_signed_ack_requires_durable_commit_and_exact_reread(self):
        self.assertEqual(self.fx.rows(), 0)
        raw = self.register()
        self.assertEqual(self.fx.rows(), 1)
        payload = self.verify(raw)
        self.assertTrue(payload["nexusRegistrationCommitted"])
        self.assertTrue(payload["nodeBirthIndexIndependentlyValidated"])
        self.assertFalse(payload["allOutboundWritersFinal"])
        self.assertFalse(payload["canResume"])
        self.assertFalse(payload["finalMeterVerified"])
        self.assertFalse(payload["carryforwardApplied"])
        self.assertEqual(payload["refundableBytes"], 0)
        self.assertEqual(payload["nodeId"], self.fx.node)
        self.assertEqual(payload["inventorySequence"], 1)
        self.assertEqual(self.register(), raw)
        checked = self.db_verify(raw)
        self.assertTrue(checked["originalIndexStillOffhost"])
        self.assertFalse(checked["canResume"])

    def test_append_followup_signed_ack_binds_exact_prior_committed_hash(self):
        first = self.register()
        follow = self.fx.sign(self.fx.extended, self.fx.extended_tail)
        second = self.register(follow, self.fx.extended)
        head = self.verify(second, signed=follow, index=self.fx.extended)
        self.assertEqual(head["previousInventorySha256"],
                         self.verify(first)["inventorySha256"])
        self.assertEqual(head["inventorySequence"], 2)
        self.assertEqual(self.fx.rows(), 2)
        self.assertFalse(self.db_verify(second, signed=follow,
                                        index=self.fx.extended)["canResume"])
        with self.assertRaises(ValueError):
            self.verify(second)
        with self.assertRaises(ValueError):
            self.db_verify(second)

    def test_six_simultaneous_commits_yield_one_identical_signed_ack(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            signed = list(pool.map(lambda _: self.register(), range(6)))
        self.assertEqual(len(set(signed)), 1)
        self.assertEqual(self.fx.rows(), 1)
        self.assertTrue(self.db_verify(signed[0])["nexusSignatureVerified"])

    def test_pre_commit_exception_creates_neither_record_nor_ack(self):
        original = births.register_verified
        def fail_after_sql(conn, *args):
            original(conn, *args)
            raise RuntimeError("lost power before PostgreSQL COMMIT")
        with mock.patch.object(receipt.births, "register_verified",
                               side_effect=fail_after_sql):
            with self.assertRaisesRegex(RuntimeError, "before PostgreSQL"):
                self.register()
        self.assertEqual(self.fx.rows(), 0)
        self.assertEqual(self.verify(self.register())["refundableBytes"], 0)

    def test_failed_nexus_signer_never_mints_an_ack(self):
        self.nexus_private.chmod(0o644)
        with self.assertRaisesRegex(ValueError, "unsafe private"):
            self.register()
        # Its DB registration may have committed already. The important
        # invariant is that no signature or false success was issued.
        self.assertEqual(self.fx.rows(), 1)
        self.nexus_private.chmod(0o600)
        signed = self.register()
        self.assertTrue(self.db_verify(signed)["nexusSignatureVerified"])

    def test_foreign_nexus_key_node_identity_or_changed_registry_rejected(self):
        recorded = self.register()
        foreign_priv = self.fx.dir / "foreign-nexus.pem"
        foreign_pub = self.fx.dir / "foreign-nexus.pub"
        self.fx.make_key(foreign_priv, foreign_pub)
        with self.assertRaises(ValueError):
            self.verify(recorded, key=foreign_pub)
        with self.assertRaises(ValueError):
            self.verify(recorded, index=self.fx.extended)
        with self.assertRaises(ValueError):
            receipt.verify_receipt(
                recorded, self.fx.first, self.fx.base, self.fx.node+1,
                self.fx.pub, self.nexus_public)
        self.assertEqual(self.fx.rows(), 1)

    def test_even_nexus_signed_refund_or_resume_flags_are_explicitly_forbidden(self):
        recorded = self.register()
        for field, invalid in (
            ("canResume", True),
            ("allOutboundWritersFinal", True),
            ("carryforwardApplied", True),
            ("finalMeterVerified", True),
            ("refundableBytes", 5),
            ("nexusRegistrationCommitted", False),
        ):
            with self.subTest(field=field):
                modified = births._json(recorded)
                modified["payload"][field] = invalid
                # Re-sign tampered payload with test's genuine Nexus key.
                # A VALID signature must never bypass NONFINAL schema rules.
                modified["signature"] = receipt._sign(
                    self.nexus_private, modified["payload"])
                raw = births._canonical(modified) + b"\n"
                with self.assertRaises(ValueError):
                    self.verify(raw)
        altered = births._json(recorded)
        altered["signature"] = "0" * 128
        with self.assertRaises(ValueError):
            self.verify(births._canonical(altered) + b"\n")
        for bad in (recorded + b"\n",
                    recorded.replace(b'"payload":',
                                     b'"payload":{},"payload":', 1)):
            with self.assertRaises(ValueError):
                self.verify(bad)
        self.assertTrue(self.db_verify(recorded)["nexusSignatureVerified"])

    def test_receipt_does_not_justify_local_history_rollback_or_live_unfreeze(self):
        recorded = self.register()
        self.assertTrue(self.db_verify(recorded)["originalIndexStillOffhost"])
        for deleted in (b"", None):
            with self.subTest(deleted=deleted), self.assertRaises(ValueError):
                self.fx.recovery(deleted)
        self.assertFalse(self.verify(recorded)["canResume"])
        self.assertEqual(self.verify(recorded)["refundableBytes"], 0)


if __name__ == "__main__":
    unittest.main()
