#!/usr/bin/env python3
"""Adversarial disposable PostgreSQL shadow carryforward vs signed Node data.

Full verified Node main+CDN PREPARE is created by the pinned Node signer
fixture; SQL is deliberately NOT a cryptographic verifier. This test checks
that even the DB OWNER cannot make shadow 'candidate' values into refunds,
new allowance, a changed account, or user resumption. No production DB.
"""
import concurrent.futures
import importlib.util
import os
from pathlib import Path
import unittest

import psycopg
from psycopg.rows import dict_row

ROOT=Path(__file__).resolve().parents[1]
DSN=os.environ["QUOTA_TEST_DSN"]
assert os.environ.get("XMESH_AUDIT_DISPOSABLE")=="1"
assert DSN.startswith("postgresql://quota_test:")

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/"scripts"/path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

old=load("test_old_signed_rollover_shadow","test-quota-v2-nonfinal-rollover-postgres.py")
SQL="""SELECT * FROM quota_v2_record_nonfinal_shadow_watermark(
    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"""


class ShadowCarryforwardTests(unittest.TestCase):
    def setUp(self):
        self.fi=old.NonfinalRolloverPostgresTests(
            "test_genuine_node_proposal_stages_once_without_spending_or_refund")
        self.fi.setUp()
        self.addCleanup(self.fi.doCleanups)
        self.scope=old.fixtures.SCOPE
        self.fi.stage()
        self.args=(
            self.fi.user,self.fi.epoch,self.fi.node_id,self.fi.meter,
            self.fi.reservation,self.fi.request,self.scope["revision"],
            self.fi.sha,
            self.fi.proposal["payload"]["stopChainSha256"],
            self.fi.proposal["payload"]["xrayJournalSha256"],
        )

    def stage(self,args=None):
        with psycopg.connect(DSN,row_factory=dict_row) as c:
            return c.execute(SQL,self.args if args is None else args).fetchone()

    def count(self):
        with psycopg.connect(DSN) as c:
            return c.execute(
                "SELECT count(*) FROM quota_v2_nonfinal_carryforward_watermarks"
            ).fetchone()[0]

    def test_overlap_never_adds_signed_node_floor_and_xray_bytes(self):
        before=self.fi.balances()
        row=self.stage()
        # Absolute 123, old Xray uplink+downlink 100+40, prior signed
        # acknowledgment 200. Incorrect additive math would yield 463.
        self.assertEqual(row["prior_acknowledged_bytes"],200)
        self.assertEqual(row["prior_conservative_burn_floor_bytes"],0)
        self.assertEqual(row["node_absolute_floor_bytes"],123)
        self.assertEqual(row["old_runtime_raw_observed_bytes"],140)
        self.assertEqual(row["nonadditive_candidate_bytes"],200)
        self.assertNotEqual(row["nonadditive_candidate_bytes"],463)
        self.assertEqual(row["source_proposal_sha256"],self.fi.sha)
        self.assertEqual(self.count(),1)
        self.assertEqual(self.fi.balances(),before)
        self.assertEqual(self.stage(),row)
        self.assertEqual(self.fi.balances(),before)

    def test_lower_signed_receipt_and_larger_raw_both_are_evidence_only(self):
        # This is synthetic rollback of the disposal fixture's previous
        # cumulative signed ACK to test GREATEST without false addition.
        with psycopg.connect(DSN) as c:
            c.execute(
                "UPDATE quota_v2_reservations SET acknowledged_bytes=50 "
                "WHERE user_id=%s AND epoch=%s AND node_id=%s",
                (self.fi.user,self.fi.epoch,self.fi.node_id))
            c.execute(
                "UPDATE quota_v2_accounts SET settled_bytes=50 "
                "WHERE user_id=%s AND epoch=%s",
                (self.fi.user,self.fi.epoch))
        before=self.fi.balances()
        row=self.stage()
        self.assertEqual(row["prior_acknowledged_bytes"],50)
        self.assertEqual(row["node_absolute_floor_bytes"],123)
        self.assertEqual(row["old_runtime_raw_observed_bytes"],140)
        self.assertEqual(row["nonadditive_candidate_bytes"],140)
        self.assertEqual(self.fi.balances(),before)

    def test_twelve_concurrent_identical_shadow_writes_create_one_row(self):
        before=self.fi.balances()
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            records=list(pool.map(lambda _:self.stage(),range(12)))
        self.assertEqual(len(records),12)
        self.assertTrue(all(row==records[0] for row in records))
        self.assertEqual(self.count(),1)
        self.assertEqual(self.fi.balances(),before)

    def test_eight_conflicting_parallel_replays_leave_same_row_and_balance(self):
        before=self.fi.balances()
        original=self.stage()
        different=list(self.args)
        different[7]="b"*64
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            fs=[pool.submit(self.stage,tuple(different)) for _ in range(8)]
            for f in fs:
                with self.assertRaises(psycopg.Error) as rejected:
                    f.result()
                self.assertEqual(rejected.exception.sqlstate,"22023")
        self.assertEqual(self.count(),1)
        self.assertEqual(self.stage(),original)
        self.assertEqual(self.fi.balances(),before)

    def test_burn_floor_exceeds_raw_and_is_never_counted_twice(self):
        # Existing operator recovery burns the held outstanding grant. This
        # shadow function must neither add old raw 140 again nor refund it.
        with psycopg.connect(DSN) as c:
            c.execute("SELECT quota_v2_burn_revoked(%s,%s,%s,%s,%s,%s)",
                      (self.fi.user,self.fi.epoch,self.fi.node_id,self.fi.meter,
                       self.fi.reservation,self.fi.request))
        before=self.fi.balances()
        row=self.stage()
        self.assertEqual(row["prior_conservative_burn_floor_bytes"],500)
        self.assertEqual(row["nonadditive_candidate_bytes"],500)
        self.assertEqual(self.fi.balances(),before)
        self.assertEqual(self.fi.balances()[0][0],500)

    def test_prepared_watermark_does_not_block_later_legitimate_absolute_ack(self):
        row=self.stage()
        before=self.fi.balances()
        with psycopg.connect(DSN) as c:
            c.execute("SELECT quota_v2_ack(%s,%s,%s,%s,%s,800)",
                      (self.fi.user,self.fi.epoch,self.fi.node_id,
                       self.fi.meter,self.fi.reservation))
        after=self.fi.balances()
        self.assertGreater(after[0][0],before[0][0])
        self.assertEqual(after[1][0],800)
        # Old shadow remains immutable and MUST NOT be recomputed or used
        # to issue capacity when valid later signed ACKs arrive.
        self.assertEqual(self.stage(),row)
        self.assertEqual(self.fi.balances(),after)

    def test_replay_after_account_closed_is_readonly_and_never_refunds(self):
        oldrow=self.stage()
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET closed=TRUE "
                      "WHERE user_id=%s AND epoch=%s",
                      (self.fi.user,self.fi.epoch))
        after=self.fi.balances()
        self.assertEqual(self.stage(),oldrow)
        self.assertEqual(self.fi.balances(),after)

    def test_bad_revocation_or_foreign_reservation_denied_before_writing(self):
        for slot,value in (
            (0,102),(2,44),(4,old.uuid.uuid4()),
            (5,old.uuid.uuid4()),(6,400),
            (7,"f"*64),(8,"a"*64),(9,"b"*64),
        ):
            with self.subTest(position=slot):
                bad=list(self.args)
                bad[slot]=value
                with self.assertRaises(psycopg.Error):
                    self.stage(tuple(bad))
                self.assertEqual(self.count(),0)
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_revocation_requests SET applied_at=NULL "
                      "WHERE user_id=%s AND epoch=%s AND node_id=%s",
                      (self.fi.user,self.fi.epoch,self.fi.node_id))
        with self.assertRaises(psycopg.Error):
            self.stage()
        self.assertEqual(self.count(),0)

    def test_partial_commit_is_fully_rolled_back_before_acknowledgment(self):
        with self.assertRaises(RuntimeError):
            with psycopg.connect(DSN) as c:
                c.execute(SQL,self.args)
                raise RuntimeError("power failed before PostgreSQL COMMIT")
        self.assertEqual(self.count(),0)
        row=self.stage()
        self.assertIsNotNone(row)
        self.assertEqual(self.count(),1)
        self.assertEqual(self.stage(),row)

    def test_shadow_row_owner_update_delete_and_terminal_sql_remain_forbidden(self):
        self.stage()
        before=self.fi.balances()
        for q in (
            "UPDATE quota_v2_nonfinal_carryforward_watermarks "
            "SET nonadditive_candidate_bytes=999999",
            "DELETE FROM quota_v2_nonfinal_carryforward_watermarks",
        ):
            with self.subTest(sql=q),self.assertRaises(psycopg.Error) as exc:
                with psycopg.connect(DSN) as c:
                    c.execute(q)
            self.assertEqual(exc.exception.sqlstate,"22023")
        for amount in (0,200,500):
            with self.subTest(refund=amount),self.assertRaises(psycopg.Error) as exc:
                with psycopg.connect(DSN) as c:
                    c.execute(
                        "SELECT * FROM quota_v2_settle_verified_terminal"
                        "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (self.fi.user,self.fi.epoch,self.fi.node_id,self.fi.meter,
                         self.fi.reservation,self.fi.request,
                         self.scope["revision"],
                         self.fi.proposal["payload"]["oldRuntimeId"],
                         self.fi.sha,amount))
            self.assertEqual(exc.exception.sqlstate,"42501")
        self.assertEqual(self.fi.balances(),before)
        self.assertEqual(self.count(),1)


if __name__=="__main__":
    unittest.main()
