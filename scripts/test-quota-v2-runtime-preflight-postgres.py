#!/usr/bin/env python3
"""Disposable PostgreSQL 17 only: NONAUTHORITATIVE quota V2 runtime preflights.

Uses the real existing quota_v2_reserve SQL function to create shared Node
leases. No mocked allocator, no production Nexus/XSP/2, and no Xray traffic.
"""
import concurrent.futures
import os
import uuid
import unittest

import psycopg

DSN = os.environ["QUOTA_TEST_DSN"]
if os.environ.get("XMESH_AUDIT_DISPOSABLE") != "1":
    raise SystemExit("refusing to run outside disposable PostgreSQL CI")

FUNC = """
 SELECT user_id,node_id,revision,account_limit_bytes,account_floor_bytes,
        all_node_held_bytes,lease_acknowledged_bytes,lease_ceiling_bytes,
        authorized_bytes,can_start,can_resume,final_meter_verified,
        refundable_bytes,request_challenge
 FROM quota_v2_record_runtime_admission_preflight(
    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
"""

def h(character):
    return character * 64


class StagingAdmissionPreflight(unittest.TestCase):
    def setUp(self):
        self.user = uuid.uuid4().int % (2 ** 51) + 100
        self.epoch = uuid.uuid4()
        self.node_a = (uuid.uuid4().int % (2 ** 42)) + 100
        self.node_b = self.node_a + 1
        self.meters = {self.node_a: uuid.uuid4(), self.node_b: uuid.uuid4()}
        self.ids = {self.node_a: uuid.uuid4(), self.node_b: uuid.uuid4()}
        self.runtime = {self.node_a:h("a"), self.node_b:h("b")}
        self.activation = {self.node_a:h("c"), self.node_b:h("d")}
        self.rev = {}
        with psycopg.connect(DSN) as conn:
            conn.execute(
                "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) VALUES (%s,%s,1000)",
                (self.user,self.epoch))
            for node,target in ((self.node_a,700),(self.node_b,500)):
                lease=conn.execute(
                    "SELECT revision,ceiling_bytes FROM quota_v2_reserve("
                    "%s,%s,%s,%s,%s,%s,0,NOW()+INTERVAL '1 hour')",
                    (self.user,self.epoch,node,self.meters[node],self.ids[node],target)
                ).fetchone()
                self.rev[node]=lease[0]
                conn.execute(
                    "UPDATE quota_v2_reservations SET node_confirmed=TRUE "
                    "WHERE user_id=%s AND node_id=%s",
                    (self.user,node))
                conn.execute(
                    "INSERT INTO quota_v2_xray_genesis("
                    "node_id,first_activation_sha256,runtime_id,challenge,"
                    "prepared_ms,receipt_signature) VALUES("
                    "%s,%s,%s,%s,(EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT,%s)",
                    (node,self.activation[node],self.runtime[node],h("f"),"0"*128))
        self.addCleanup(self.cleanup)

    def cleanup(self):
        with psycopg.connect(DSN) as conn:
            conn.execute("DELETE FROM quota_v2_runtime_admission_preflights WHERE user_id=%s",
                         (self.user,)) if False else None
            # Tables have intentionally immutable evidence triggers. Keep
            # random test rows until the disposable DB container is destroyed.
            # No persistent/production database is ever used.

    def args(self,node=None,challenge=None,**changes):
        node=node or self.node_a
        params=dict(
            user=self.user,epoch=self.epoch,node=node,meter=self.meters[node],
            reservation=self.ids[node],revision=self.rev[node],
            challenge=challenge or h("e"),runtime=self.runtime[node],
            container=h("1"),pid=2345,policy=h("2"),
            activation=self.activation[node],wal_floor=0)
        params.update(changes)
        return tuple(params[name] for name in (
            "user","epoch","node","meter","reservation","revision",
            "challenge","runtime","container","pid","policy","activation","wal_floor"))

    def snapshot(self,node=None,challenge=None,**changes):
        with psycopg.connect(DSN) as conn:
            return conn.execute(FUNC,self.args(node=node,challenge=challenge,**changes)).fetchone()

    def deny(self,**changes):
        with self.assertRaises(psycopg.Error):
            self.snapshot(**changes)

    def test_real_two_node_allocator_is_not_reissued_by_runtime_preflight(self):
        a=self.snapshot(node=self.node_a,challenge=h("e"))
        b=self.snapshot(node=self.node_b,challenge=h("e"))
        self.assertEqual((a[2],a[3],a[4],a[5]), (self.rev[self.node_a],1000,0,1000))
        self.assertEqual(a[7],700)
        self.assertEqual(b[7],300)
        for receipt in (a,b):
            self.assertEqual(receipt[8],0)
            self.assertEqual(receipt[9:12],(False,False,False))
            self.assertEqual(receipt[12],0)
        with psycopg.connect(DSN) as c:
            spent,held,count=c.execute(
                "SELECT a.settled_bytes,SUM(r.ceiling_bytes-r.acknowledged_bytes),COUNT(*) "
                "FROM quota_v2_accounts a JOIN quota_v2_reservations r USING(user_id,epoch) "
                "WHERE a.user_id=%s GROUP BY a.settled_bytes",
                (self.user,)).fetchone()
        self.assertEqual((spent,held,count),(0,1000,2))

    def test_replay_is_idempotent_and_conflicting_challenge_cannot_rebind(self):
        first=self.snapshot()
        self.assertEqual(self.snapshot(),first)
        self.deny(pid=2346)
        self.deny(runtime=h("9"))
        self.deny(policy=h("9"))
        self.deny(wal_floor=1)
        with psycopg.connect(DSN) as c:
            count=c.execute(
                "SELECT COUNT(*) FROM quota_v2_runtime_admission_preflights WHERE user_id=%s",
                (self.user,)).fetchone()[0]
        self.assertEqual(count,1)

    def test_unconfirmed_and_revoked_signed_lease_never_enter_preflight(self):
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_reservations SET node_confirmed=FALSE "
                      "WHERE user_id=%s AND node_id=%s",(self.user,self.node_a))
        self.deny()
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_reservations SET node_confirmed=TRUE "
                      "WHERE user_id=%s AND node_id=%s",(self.user,self.node_a))
            c.execute("INSERT INTO quota_v2_revocation_requests "
                      "(user_id,epoch,node_id,meter_epoch,reservation_id,request_id) "
                      "VALUES (%s,%s,%s,%s,%s,%s)",
                      (self.user,self.epoch,self.node_a,self.meters[self.node_a],
                       self.ids[self.node_a],uuid.uuid4()))
        self.deny()

    def test_expired_or_burned_lease_and_closed_account_rejected(self):
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_reservations SET valid_until=NOW()-INTERVAL '1 sec' "
                      "WHERE user_id=%s AND node_id=%s",(self.user,self.node_a))
        self.deny()
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_reservations SET "
                      "valid_until=NOW()+INTERVAL '1 hour', "
                      "conservative_burn_floor_bytes=1,conservative_burned_at=NOW() "
                      "WHERE user_id=%s AND node_id=%s",(self.user,self.node_a))
        self.deny()
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET closed=TRUE WHERE user_id=%s",(self.user,))
        self.deny(node=self.node_b)

    def test_stale_revision_foreign_lease_runtime_and_activation_rejected(self):
        for change in [
            {"reservation":uuid.uuid4()}, {"meter":uuid.uuid4()},
            {"revision":self.rev[self.node_a]+1},
            {"runtime":h("8")},{"activation":h("8")},
            {"wal_floor":-1},{"wal_floor":701},
            {"pid":0},{"challenge":"abc"},{"container":"A"*64},
        ]:
            with self.subTest(change=change):
                self.deny(**change)

    def test_global_observed_floor_and_legacy_old_epoch_debt_rejected(self):
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET observed_floor_bytes=200 "
                      "WHERE user_id=%s",(self.user,))
        self.deny()
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET observed_floor_bytes=0 "
                      "WHERE user_id=%s",(self.user,))
        self.assertEqual(self.snapshot()[8],0)
        old_epoch=uuid.uuid4()
        with psycopg.connect(DSN) as c:
            c.execute("INSERT INTO quota_v2_accounts("
                      "user_id,epoch,limit_bytes,closed) VALUES (%s,%s,1000,TRUE)",
                      (self.user,old_epoch))
            c.execute("INSERT INTO quota_v2_reservations("
                      "user_id,epoch,node_id,meter_epoch,reservation_id,"
                      "acknowledged_bytes,ceiling_bytes,valid_until) "
                      "VALUES(%s,%s,%s,%s,%s,0,1,NOW()+INTERVAL '1 hour')",
                      (self.user,old_epoch,self.node_a+100,
                       uuid.uuid4(),uuid.uuid4()))
        self.deny(challenge=h("6"))

    def test_many_parallel_exact_retries_never_mutate_account(self):
        args=self.args()
        def request(_):
            with psycopg.connect(DSN) as c:
                return c.execute(FUNC,args).fetchone()
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            answers=list(pool.map(request,range(24)))
        self.assertTrue(all(answer==answers[0] for answer in answers))
        with psycopg.connect(DSN) as c:
            preflights=c.execute(
                "SELECT COUNT(*) FROM quota_v2_runtime_admission_preflights WHERE user_id=%s",
                (self.user,)).fetchone()[0]
            account=c.execute(
                "SELECT settled_bytes,observed_floor_bytes FROM quota_v2_accounts "
                "WHERE user_id=%s AND epoch=%s",(self.user,self.epoch)).fetchone()
        self.assertEqual(preflights,1)
        self.assertEqual(account,(0,0))

    def test_immutable_evidence_and_public_execute_denied(self):
        self.snapshot()
        with psycopg.connect(DSN) as c:
            with self.assertRaises(psycopg.Error):
                with c.transaction():
                    c.execute("UPDATE quota_v2_runtime_admission_preflights "
                              "SET authorized_bytes=1 WHERE user_id=%s",(self.user,))
            with self.assertRaises(psycopg.Error):
                with c.transaction():
                    c.execute("DELETE FROM quota_v2_runtime_admission_preflights "
                              "WHERE user_id=%s",(self.user,))
            with self.assertRaises(psycopg.Error):
                with c.transaction():
                    c.execute("TRUNCATE quota_v2_runtime_admission_preflights")
            c.execute("CREATE ROLE quota_v2_untrusted NOLOGIN") if not c.execute(
                "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='quota_v2_untrusted')"
            ).fetchone()[0] else None
            allowed=c.execute(
                "SELECT has_function_privilege('quota_v2_untrusted',"
                "'quota_v2_record_runtime_admission_preflight("
                "bigint,uuid,bigint,uuid,uuid,bigint,text,text,text,bigint,text,text,bigint)',"
                "'EXECUTE')").fetchone()[0]
        self.assertFalse(allowed)


if __name__=="__main__":
    unittest.main()
