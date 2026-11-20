#!/usr/bin/env python3
"""Disposable PostgreSQL exactly-once NONFINAL rollover staging tests.

A genuinely Ed25519 signed and independently audited Node preparation still
does not modify account balances, issue a Nexus acknowledgment, or authorize
any final refund. Staging identity is immutable across concurrent SQL writers.
"""
import concurrent.futures
import hashlib
import importlib.util
import os
from pathlib import Path
import unittest
import uuid

import psycopg

ROOT=Path(__file__).resolve().parents[1]
DSN=os.environ["QUOTA_TEST_DSN"]
assert os.environ.get("XMESH_AUDIT_DISPOSABLE")=="1"
assert DSN.startswith("postgresql://quota_test:")

SPEC=importlib.util.spec_from_file_location(
    "nexus_audit_fixture",ROOT/"scripts/test-quota-v2-stop-chain-audit.py")
fixtures=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixtures)
ROLLOVER=importlib.util.spec_from_file_location(
    "nexus_rollover_audit",ROOT/"scripts/quota_v2_rollover_audit.py")
audit=importlib.util.module_from_spec(ROLLOVER)
ROLLOVER.loader.exec_module(audit)

SQL="""SELECT * FROM quota_v2_record_nonfinal_rollover_prepare(
    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"""


class NonfinalRolloverPostgresTests(unittest.TestCase):
    def setUp(self):
        self.fx=fixtures.IndependentStopAuditTests(
            "test_exact_signed_main_cdn_nonfinal_chain_authenticates")
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        node=fixtures.node_rollover
        cp=self.fx.observation["payload"]["checkpoint"]
        raw_obs=self.fx.raw(self.fx.observation)
        raw_stop=self.fx.raw(self.fx.stop)
        payload=node._build_payload(
            cp,self.fx.observation,self.fx.stop["payload"],
            raw_obs,raw_stop,fixtures.EXPECTED_OLD_WAL_SHA256)
        self.proposal=self.fx.sign(payload,node.DOMAIN)
        raw=self.fx.raw(self.proposal)
        verified=audit.verify_nonfinal_rollover_prepare(
            raw_obs,raw_stop,raw,self.fx.pub,fixtures.SCOPE,
            fixtures.EXPECTED_INBOUND_ROSTER,fixtures.EXPECTED_OLD_WAL_SHA256)
        self.assertTrue(verified["nodePreparedConservativeRollover"])
        self.assertFalse(verified["canApplyRollover"])
        self.assertFalse(verified["settlementEligible"])
        self.sha=hashlib.sha256(raw).hexdigest()
        s=fixtures.SCOPE
        self.user=s["userId"]
        self.node_id=s["nodeId"]
        self.epoch=uuid.UUID(s["epoch"])
        self.meter=uuid.UUID(s["meterEpoch"])
        self.reservation=uuid.UUID(s["reservationId"])
        self.request=uuid.UUID(s["revocationId"])
        self.args=(
            self.user,self.epoch,self.node_id,self.meter,self.reservation,
            self.request,s["revision"],payload["oldRuntimeId"],
            payload["oldContainerId"],payload["oldStartedAt"],
            self.sha,payload["stopChainSha256"],payload["xrayJournalSha256"],
            payload["nodeDurableAbsoluteFloorBytes"],
            payload["oldRuntimeObservedUplinkBytes"],
            payload["oldRuntimeObservedDownlinkBytes"],
        )
        with psycopg.connect(DSN) as c:
            # Dedicated disposable CI PostgreSQL only; reset between cases.
            # No such truncation is ever performed by production code.
            c.execute("TRUNCATE quota_v2_accounts CASCADE")
            c.execute("INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) "
                      "VALUES(%s,%s,1000)",(self.user,self.epoch))
            c.execute("SELECT quota_v2_reserve(%s,%s,%s,%s,%s,500,0,"
                      "NOW()+INTERVAL '1 hour')",
                      (self.user,self.epoch,self.node_id,self.meter,self.reservation))
            c.execute("SELECT quota_v2_ack(%s,%s,%s,%s,%s,200)",
                      (self.user,self.epoch,self.node_id,self.meter,self.reservation))
            c.execute("UPDATE quota_v2_reservations SET node_confirmed=TRUE, "
                      "revision=%s WHERE user_id=%s AND epoch=%s AND node_id=%s",
                      (s["revision"],self.user,self.epoch,self.node_id))
            c.execute(
                "INSERT INTO quota_v2_revocation_requests("
                "user_id,epoch,node_id,meter_epoch,reservation_id,request_id,"
                "applied_at,applied_revision,observed_used_bytes) "
                "VALUES(%s,%s,%s,%s,%s,%s,NOW(),%s,140)",
                (self.user,self.epoch,self.node_id,self.meter,
                 self.reservation,self.request,s["revision"]))

    def stage(self,args=None):
        with psycopg.connect(DSN) as c:
            return c.execute(SQL,self.args if args is None else args).fetchone()

    def size(self):
        with psycopg.connect(DSN) as c:
            return c.execute(
                "SELECT count(*) FROM quota_v2_nonfinal_rollover_preparations").fetchone()[0]

    def balances(self):
        with psycopg.connect(DSN) as c:
            account=c.execute(
                "SELECT settled_bytes,observed_floor_bytes,limit_bytes,closed "
                "FROM quota_v2_accounts WHERE user_id=%s AND epoch=%s",
                (self.user,self.epoch)).fetchone()
            lease=c.execute(
                "SELECT acknowledged_bytes,ceiling_bytes,revision,node_confirmed "
                "FROM quota_v2_reservations WHERE user_id=%s AND epoch=%s "
                "AND node_id=%s AND meter_epoch=%s",
                (self.user,self.epoch,self.node_id,self.meter)).fetchone()
            terminals=c.execute(
                "SELECT count(*) FROM quota_v2_terminal_settlements").fetchone()[0]
            return (account,lease,terminals)

    def test_genuine_node_proposal_stages_once_without_spending_or_refund(self):
        before=self.balances()
        row=self.stage()
        self.assertIsNotNone(row)
        self.assertEqual(self.size(),1)
        self.assertEqual(self.stage(),row)
        self.assertEqual(self.size(),1)
        self.assertEqual(self.balances(),before)
        self.assertEqual(before[2],0)
        # A fully authenticated prepare is still NOT an authorization
        # to use even one refundable terminal byte.
        for claimed in (140,200,340,500):
            with self.subTest(claimed=claimed):
                with self.assertRaises(psycopg.Error) as rejected:
                    with psycopg.connect(DSN) as c:
                        c.execute(
                            "SELECT * FROM quota_v2_settle_verified_terminal"
                            "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                            (self.user,self.epoch,self.node_id,self.meter,
                             self.reservation,self.request,
                             fixtures.SCOPE["revision"],
                             self.args[7],self.sha,claimed))
                self.assertEqual(rejected.exception.sqlstate,"42501")
                self.assertEqual(self.balances(),before)

    def test_twelve_identical_concurrent_stage_attempts_create_one_immutable_row(self):
        before=self.balances()
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            results=list(pool.map(lambda _:self.stage(),range(12)))
        self.assertTrue(all(row==results[0] for row in results))
        self.assertEqual(self.size(),1)
        self.assertEqual(self.balances(),before)

    def test_eight_conflicting_concurrent_replays_rejected_without_balance_change(self):
        before=self.balances()
        self.stage()
        old=self.size()
        bad=list(self.args)
        bad[10]="b"*64  # different proposal SHA for same reservation
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures=[pool.submit(self.stage,tuple(bad)) for _ in range(8)]
            for result in futures:
                with self.assertRaises(psycopg.Error) as rejected:
                    result.result()
                self.assertEqual(rejected.exception.sqlstate,"22023")
        self.assertEqual(self.size(),old)
        self.assertEqual(self.balances(),before)

    def test_prior_applied_revocation_required_even_for_nonfinal_staging(self):
        with psycopg.connect(DSN) as c:
            c.execute(
                "UPDATE quota_v2_revocation_requests SET applied_at=NULL "
                "WHERE user_id=%s AND epoch=%s AND node_id=%s",
                (self.user,self.epoch,self.node_id))
        with self.assertRaises(psycopg.Error):
            self.stage()
        self.assertEqual(self.size(),0)

    def test_conflicting_raw_bytes_or_different_runtime_cannot_replace_first_record(self):
        self.stage()
        before=self.balances()
        for index,value in (
            (7,"b"*64), (8,"c"*64), (9,"2026-11-19T00:00:00Z"),
            (10,"d"*64), (11,"e"*64), (12,"f"*64),
            (13,124), (14,101), (15,41),
        ):
            bad=list(self.args)
            bad[index]=value
            with self.subTest(field=index),self.assertRaises(psycopg.Error) as rejected:
                self.stage(tuple(bad))
            self.assertEqual(rejected.exception.sqlstate,"22023")
            self.assertEqual(self.size(),1)
            self.assertEqual(self.balances(),before)

    def test_migration_owner_cannot_update_or_delete_prepared_proof(self):
        self.stage()
        before=self.balances()
        for sql in (
            "UPDATE quota_v2_nonfinal_rollover_preparations SET "
            "observed_uplink_bytes=0",
            "DELETE FROM quota_v2_nonfinal_rollover_preparations",
        ):
            with self.subTest(query=sql),self.assertRaises(psycopg.Error) as rejected:
                with psycopg.connect(DSN) as c:
                    c.execute(sql)
            self.assertEqual(rejected.exception.sqlstate,"22023")
            self.assertEqual(self.size(),1)
            self.assertEqual(self.balances(),before)


if __name__=="__main__":
    unittest.main()
