#!/usr/bin/env python3
"""Disposable real PostgreSQL + Ed25519 Nexus PREPARED-ONLY registration tests.

Node signer used only as pinned synthetic fixture, Nexus verifier and
database lookup are independent. No deployed key, API, refund or Xray unfreeze.
"""
import concurrent.futures
import copy
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import psycopg

ROOT=Path(__file__).resolve().parents[1]
DSN=os.environ["QUOTA_TEST_DSN"]
assert os.environ.get("XMESH_AUDIT_DISPOSABLE")=="1"
assert DSN.startswith("postgresql://quota_test:")

def load_module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/"scripts"/file)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

old=load_module("nexus_prepare_pg_fixture","test-quota-v2-nonfinal-rollover-postgres.py")
ack=load_module("nexus_prepared_registration","quota_v2_prepared_registration.py")


class NexusPreparedRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.fi=old.NonfinalRolloverPostgresTests(
            "test_genuine_node_proposal_stages_once_without_spending_or_refund")
        self.fi.setUp()
        self.addCleanup(self.fi.doCleanups)
        self.fx=self.fi.fx
        self.scope=old.fixtures.SCOPE
        self.raw_obs=self.fx.raw(self.fx.observation)
        self.raw_stop=self.fx.raw(self.fx.stop)
        self.raw_prepare=self.fx.raw(self.fi.proposal)
        self.temp=tempfile.TemporaryDirectory(prefix="xmesh-nexus-ack-")
        self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        self.private=root/"nexus.key"
        self.pub=root/"nexus.pub"
        self.ledger=root/"registered"
        self.ledger.mkdir(mode=0o700)
        subprocess.run(["openssl","genpkey","-algorithm","Ed25519",
                        "-out",str(self.private)],check=True,capture_output=True)
        self.private.chmod(0o600)
        subprocess.run(["openssl","pkey","-in",str(self.private),"-pubout",
                        "-out",str(self.pub)],check=True,capture_output=True)

    def record(self,**changes):
        with psycopg.connect(DSN) as conn:
            return ack.record_prepared_receipt(
                conn,changes.get("observed",self.raw_obs),
                changes.get("stop",self.raw_stop),
                changes.get("prepared",self.raw_prepare),
                changes.get("node_pub",self.fx.pub),
                changes.get("scope",self.scope),
                changes.get("roster",old.fixtures.EXPECTED_INBOUND_ROSTER),
                changes.get("wal",old.fixtures.EXPECTED_OLD_WAL_SHA256),
                changes.get("nexus_private",self.private),
                changes.get("nexus_pub",self.pub),
                changes.get("ledger",self.ledger))

    def verify(self,raw,**changes):
        return ack.verify_recorded_receipt(
            raw,changes.get("nexus_pub",self.pub),
            changes.get("scope",self.scope),
            changes.get("prepared",self.raw_prepare),
            changes.get("stage_hash",ack._checked_row(
                self._row(),self.scope,self.fi.proposal["payload"],self.fi.sha)))

    def _row(self):
        with psycopg.connect(DSN) as conn:
            return ack._load_staged(conn,self.scope)

    def test_actual_immutable_sql_stage_then_signed_nexus_receipt_is_non_authorizing(self):
        before=self.fi.balances()
        self.fi.stage()
        raw=self.record()
        p=self.verify(raw)
        self.assertEqual(p["kind"],ack.KIND)
        self.assertEqual(p["proposalSha256"],self.fi.sha)
        self.assertEqual(p["stagedLedgerRowSha256"],ack._checked_row(
            self._row(),self.scope,self.fi.proposal["payload"],self.fi.sha))
        self.assertEqual(p["oldRuntimeObservedUplinkBytes"],100)
        self.assertEqual(p["oldRuntimeObservedDownlinkBytes"],40)
        self.assertEqual(p["nodeDurableAbsoluteFloorBytes"],123)
        self.assertIs(p["nexusRecordedPrepared"],True)
        for flag in ack.FLAGS:
            self.assertIs(p[flag],False)
        self.assertEqual(p["refundableBytes"],0)
        self.assertEqual(self.fi.balances(),before)
        self.assertEqual(self.fi.size(),1)
        name=ack.slot_name(self.scope)
        slot=self.ledger/name
        self.assertEqual(slot.read_bytes(),raw)
        self.assertEqual(slot.stat().st_mode&0o777,0o600)
        original_ino=slot.stat().st_ino
        self.assertEqual(self.record(),raw)
        self.assertEqual(slot.stat().st_ino,original_ino)
        self.assertEqual(self.fi.balances(),before)

    def test_signed_node_without_database_staging_never_mints_nexus_ack(self):
        self.assertEqual(self.fi.size(),0)
        with self.assertRaisesRegex(ValueError,"staging row missing"):
            self.record()
        self.assertEqual(list(self.ledger.iterdir()),[])

    def test_replay_wrong_reservation_and_wrong_wal_fail(self):
        self.fi.stage()
        raw=self.record()
        for field,value in (
            ("nodeId",44),("userId",102),("revision",8),
            ("epoch","55555555-5555-4555-8555-555555555555"),
            ("meterEpoch","55555555-5555-4555-8555-555555555555"),
            ("reservationId","55555555-5555-4555-8555-555555555555"),
            ("revocationId","55555555-5555-4555-8555-555555555555"),
        ):
            with self.subTest(scope=field),self.assertRaises(ValueError):
                self.verify(raw,scope=dict(self.scope,**{field:value}))
        for value in ("0"*64,"f",None):
            with self.subTest(wal=value),self.assertRaises(ValueError):
                self.record(wal=value)
        self.assertEqual(list(self.ledger.iterdir()),[self.ledger/ack.slot_name(self.scope)])

    def test_signed_claims_can_never_enable_refund_or_unblock(self):
        self.fi.stage()
        original=self.record()
        for field,value in (
            ("nexusRecordedPrepared",False),
            ("absoluteCarryforwardVerified",True),
            ("rolloverAuthorized",True),
            ("resumptionAllowed",True),
            ("finalMeterVerified",True),
            ("settlementEligible",True),
            ("refundableBytes",1),
            ("absoluteCarryforwardVerified",0),
            ("resumptionAllowed",0),
            ("schemaVersion",2),
            ("oldRuntimeObservedDownlinkBytes",41),
            ("proposalSha256","f"*64),
            ("stagedLedgerRowSha256","f"*64),
        ):
            with self.subTest(field=field,value=value):
                raw=ack.stop._decode(original)
                raw["payload"][field]=value
                raw["signature"]=ack._sign(self.private,raw["payload"])
                bad=ack.stop._canonical(raw)+b"\n"
                with self.assertRaises(ValueError):
                    self.verify(bad)
        self.assertEqual((self.ledger/ack.slot_name(self.scope)).read_bytes(),original)

    def test_signature_foreign_key_noncanonical_and_untrusted_signer_refused(self):
        self.fi.stage()
        original=self.record()
        tampered=ack.stop._decode(original)
        tampered["signature"]="0"*128
        for bad in (ack.stop._canonical(tampered)+b"\n",
                    original+b"\n",original[:-1]+b" ",
                    original.replace(b'"algorithm":',
                                     b'"algorithm":"Ed25519","algorithm":',1)):
            with self.assertRaises(ValueError):
                self.verify(bad)
        fake=Path(self.temp.name)/"foreign.key"
        fake_pub=Path(self.temp.name)/"foreign.pub"
        subprocess.run(["openssl","genpkey","-algorithm","Ed25519",
                        "-out",str(fake)],check=True,capture_output=True)
        subprocess.run(["openssl","pkey","-in",str(fake),"-pubout",
                        "-out",str(fake_pub)],check=True,capture_output=True)
        with self.assertRaises(ValueError):
            self.verify(original,nexus_pub=fake_pub)
        with self.assertRaises(ValueError):
            self.record(nexus_pub=fake_pub)
        self.private.chmod(0o644)
        with self.assertRaisesRegex(ValueError,"unsafe Nexus signing key"):
            self.record()

    def test_conflicting_immutable_receipt_and_interrupted_publish_fail_closed(self):
        self.fi.stage()
        before=self.record()
        location=self.ledger/ack.slot_name(self.scope)
        location.write_bytes(before[:-2]+b"xx")
        with self.assertRaisesRegex(ValueError,"conflicting immutable"):
            self.record()
        location.unlink()
        with patch.object(ack.os,"link",side_effect=OSError("test link crash")):
            with self.assertRaises(OSError):
                self.record()
        pending=[n for n in self.ledger.iterdir() if n.name.startswith(".prepared-pending-")]
        self.assertEqual(len(pending),1)
        with self.assertRaisesRegex(ValueError,"uncertain pending"):
            self.record()
        self.assertEqual(self.fi.balances()[2],0)

    def test_six_parallel_identical_nexus_signings_publish_one_durable_receipt(self):
        self.fi.stage()
        before=self.fi.balances()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            signed=list(pool.map(lambda _:self.record(),range(6)))
        self.assertEqual(len(set(signed)),1)
        self.assertEqual(len(list(self.ledger.iterdir())),1)
        self.assertEqual(self.verify(signed[0])["resumptionAllowed"],False)
        self.assertEqual(self.fi.balances(),before)

    def test_recorded_prepare_does_not_change_quarantined_terminal_sql(self):
        self.fi.stage()
        self.record()
        before=self.fi.balances()
        for amount in (140,200,340,500):
            with self.subTest(amount=amount),self.assertRaises(psycopg.Error) as e:
                with psycopg.connect(DSN) as conn:
                    conn.execute(
                        "SELECT * FROM quota_v2_settle_verified_terminal"
                        "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (self.fi.user,self.fi.epoch,self.fi.node_id,
                         self.fi.meter,self.fi.reservation,self.fi.request,
                         self.scope["revision"],
                         self.fi.proposal["payload"]["oldRuntimeId"],
                         self.fi.sha,amount))
            self.assertEqual(e.exception.sqlstate,"42501")
            self.assertEqual(self.fi.balances(),before)


if __name__=="__main__":
    unittest.main()
