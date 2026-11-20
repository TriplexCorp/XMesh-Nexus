#!/usr/bin/env python3
"""End-to-end refusal: genuine Node-signed NONFINAL evidence cannot refund.

Use the independently reviewed Node fixture and Nexus's independent verifier.
After PostgreSQL migration 0132, even a migration-owner SQL caller submitting
the SHA-256 of an authentic Ed25519-signed physical-stop record is denied.
No production Xray or VPS is touched.
"""
import hashlib
import importlib.util
import os
from pathlib import Path
import unittest
import uuid

import psycopg

ROOT = Path(__file__).resolve().parents[1]
DSN = os.environ["QUOTA_TEST_DSN"]
assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
assert DSN.startswith("postgresql://quota_test:")

spec = importlib.util.spec_from_file_location(
    "independent_nonfinal_fixture",
    ROOT / "scripts/test-quota-v2-stop-chain-audit.py")
fixture_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_module)

rollover_spec = importlib.util.spec_from_file_location(
    "independent_nexus_rollover_audit",
    ROOT / "scripts/quota_v2_rollover_audit.py")
rollover_audit = importlib.util.module_from_spec(rollover_spec)
rollover_spec.loader.exec_module(rollover_audit)


class SignedStopIsNotSettlementTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture_module.IndependentStopAuditTests(
            "test_exact_signed_main_cdn_nonfinal_chain_authenticates")
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.scope = dict(fixture_module.SCOPE)
        # Match the Node's signed scope exactly. This is disposable DB only.
        self.meter = uuid.UUID(self.scope["meterEpoch"])
        self.epoch = uuid.UUID(self.scope["epoch"])
        self.reservation = uuid.UUID(self.scope["reservationId"])
        self.request = uuid.UUID(self.scope["revocationId"])
        self.user = self.scope["userId"]
        self.node = self.scope["nodeId"]
        with psycopg.connect(DSN) as c:
            c.execute(
                "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) "
                "VALUES(%s,%s,1000)",
                (self.user,self.epoch))
            c.execute(
                "SELECT quota_v2_reserve(%s,%s,%s,%s,%s,500,0,"
                "NOW()+INTERVAL '1 hour')",
                (self.user,self.epoch,self.node,self.meter,self.reservation))
            c.execute(
                "SELECT quota_v2_ack(%s,%s,%s,%s,%s,200)",
                (self.user,self.epoch,self.node,self.meter,self.reservation))
            c.execute(
                "INSERT INTO quota_v2_revocation_requests"
                "(user_id,epoch,node_id,meter_epoch,reservation_id,request_id,"
                "applied_at,applied_revision,observed_used_bytes)"
                "VALUES(%s,%s,%s,%s,%s,%s,NOW(),%s,140)",
                (self.user,self.epoch,self.node,self.meter,self.reservation,
                 self.request,self.scope["revision"]))
            c.execute(
                "UPDATE quota_v2_reservations SET node_confirmed=TRUE "
                "WHERE user_id=%s AND epoch=%s AND node_id=%s",
                (self.user,self.epoch,self.node))

    def state(self):
        with psycopg.connect(DSN) as c:
            return (
                c.execute(
                    "SELECT settled_bytes FROM quota_v2_accounts "
                    "WHERE user_id=%s AND epoch=%s",
                    (self.user,self.epoch)).fetchone()[0],
                c.execute(
                    "SELECT acknowledged_bytes,ceiling_bytes FROM "
                    "quota_v2_reservations WHERE user_id=%s AND epoch=%s "
                    "AND node_id=%s",
                    (self.user,self.epoch,self.node)).fetchone(),
                c.execute(
                    "SELECT COUNT(*) FROM quota_v2_terminal_settlements "
                    "WHERE user_id=%s AND epoch=%s",
                    (self.user,self.epoch)).fetchone()[0],
            )

    def test_real_ed25519_nonfinal_chain_never_authorizes_sql_refund(self):
        verified = self.fixture.check()
        self.assertTrue(verified["authenticatedSignedReservation"])
        self.assertTrue(verified["nodeAttestedOldPidfdExit"])
        self.assertFalse(verified["finalMeterVerified"])
        self.assertFalse(verified["settlementEligible"])
        self.assertEqual(verified["refundableBytes"], 0)

        raw = self.fixture.raw(self.fixture.stop)
        envelope = self.fixture.stop["payload"]
        cp = self.fixture.observation["payload"]["checkpoint"]
        self.assertEqual(envelope["oldRuntimeId"],cp["runtimeId"])
        digest = hashlib.sha256(raw).hexdigest()
        original = self.state()
        self.assertEqual(original[2],0)
        # A signed stop claim and a plausible meter are NOT permission for
        # the migration owner to execute any settlement.
        for total in (200,240,500,600):
            with self.subTest(total=total):
                with self.assertRaises(psycopg.Error) as rejected:
                    with psycopg.connect(DSN) as c:
                        c.execute(
                            "SELECT * FROM quota_v2_settle_verified_terminal"
                            "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                            (self.user,self.epoch,self.node,self.meter,
                             self.reservation,self.request,
                             self.scope["revision"],cp["runtimeId"],
                             digest,total))
                self.assertEqual(rejected.exception.sqlstate,"42501")
                self.assertEqual(self.state(),original)
        self.assertEqual(self.state(),original)


    def test_real_signed_rollover_proposal_still_cannot_settle_a_byte(self):
        """An authenticated prepare is never an acknowledgment/refund."""
        node_rollover=fixture_module.node_rollover
        node_observed=fixture_module.node_observed
        cp=self.fixture.observation["payload"]["checkpoint"]
        original=self.fixture.raw(self.fixture.observation)
        stop=self.fixture.raw(self.fixture.stop)
        old_wal=fixture_module.EXPECTED_OLD_WAL_SHA256
        payload=node_rollover._build_payload(
            cp,self.fixture.observation,self.fixture.stop["payload"],
            original,stop,old_wal)
        proposal=self.fixture.sign(payload,node_rollover.DOMAIN)
        raw=self.fixture.raw(proposal)
        verified=rollover_audit.verify_nonfinal_rollover_prepare(
            original,stop,raw,self.fixture.pub,
            self.scope,fixture_module.EXPECTED_INBOUND_ROSTER,old_wal)
        self.assertTrue(verified["nodePreparedConservativeRollover"])
        self.assertFalse(verified["canApplyRollover"])
        self.assertFalse(verified["settlementEligible"])
        self.assertEqual(verified["refundableBytes"],0)
        before=self.state()
        # Hash of a fully authenticated Node-signed rollover is STILL no
        # authorization for this terminal SQL entry point.
        digest=hashlib.sha256(raw).hexdigest()
        for total in (140,200,340,500):
            with self.subTest(total=total):
                with self.assertRaises(psycopg.Error) as rejected:
                    with psycopg.connect(DSN) as c:
                        c.execute(
                            "SELECT * FROM quota_v2_settle_verified_terminal"
                            "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                            (self.user,self.epoch,self.node,self.meter,
                             self.reservation,self.request,
                             self.scope["revision"],cp["runtimeId"],
                             digest,total))
                self.assertEqual(rejected.exception.sqlstate,"42501")
                self.assertEqual(self.state(),before)



if __name__ == "__main__":
    unittest.main()
