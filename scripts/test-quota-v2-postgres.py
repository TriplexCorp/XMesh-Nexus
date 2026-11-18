import concurrent.futures
import os
from pathlib import Path
import unittest
import uuid
import psycopg

DSN = os.environ["QUOTA_TEST_DSN"]

class ReservationTests(unittest.TestCase):
    def setUp(self):
        self.uid = uuid.uuid4().int % (2**60) + 1
        self.epoch = uuid.uuid4()
        self.meters = {n:uuid.uuid4() for n in range(1,65)}
        self.ids = {n:uuid.uuid4() for n in range(1,65)}
        with psycopg.connect(DSN) as c:
            c.execute("INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) VALUES(%s,%s,100)",
                      (self.uid,self.epoch))

    def reserve(self, node, target=50, ack=0):
        with psycopg.connect(DSN) as c:
            return c.execute(
                "SELECT ceiling_bytes,acknowledged_bytes FROM quota_v2_reserve(%s,%s,%s,%s,%s,%s,%s,NOW()+INTERVAL '1 hour')",
                (self.uid,self.epoch,node,self.meters[node],self.ids[node],target,ack)).fetchone()

    def state(self):
        with psycopg.connect(DSN) as c:
            return c.execute(
                "SELECT a.settled_bytes,COALESCE(SUM(r.ceiling_bytes-r.acknowledged_bytes),0) "
                "FROM quota_v2_accounts a LEFT JOIN quota_v2_reservations r "
                "USING(user_id,epoch) WHERE a.user_id=%s GROUP BY a.settled_bytes",
                (self.uid,)).fetchone()

    def test_partial_other_node_receipt_does_not_refill(self):
        self.assertEqual(self.reserve(1), (50,0))
        self.assertEqual(self.reserve(2), (50,0))
        self.assertEqual(self.reserve(2, ack=10), (50,10))
        self.assertEqual(self.reserve(1), (50,0))
        self.assertEqual(self.state(), (10,90))
        self.assertEqual(self.reserve(1, ack=40), (50,40))
        self.assertEqual(self.state(), (50,50))
        self.assertEqual(self.reserve(1, ack=40), (50,40))
        self.assertEqual(self.reserve(1, ack=0), (50,40))
        self.assertEqual(self.state(), (50,50))

    def test_concurrent_reservations_conserve_global_limit(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as p:
            list(p.map(self.reserve, range(1,65)))
        settled, held = self.state()
        self.assertEqual(settled+held, 100)

    def test_increased_limit_is_available_only_once(self):
        self.reserve(1)
        self.reserve(2)
        self.reserve(1, ack=40)
        self.reserve(2, ack=10)
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET limit_bytes=150 WHERE user_id=%s", (self.uid,))
        first = self.reserve(1)
        self.assertEqual(first, (90,40))
        self.assertEqual(self.reserve(1), first)
        self.assertEqual(self.state(), (50,90))

    def test_observed_traffic_floor_is_not_added_twice_to_signed_receipts(self):
        self.assertEqual(self.reserve(1),(50,0))
        with psycopg.connect(DSN) as c:
            c.execute(
                "UPDATE quota_v2_accounts SET observed_floor_bytes=20 WHERE user_id=%s",
                (self.uid,))
        # A's 20 verified bytes arrived before its signed receipt; they
        # constrain B's first lease, without increasing settled_bytes.
        self.assertEqual(self.reserve(2),(30,0))
        self.assertEqual(self.state(),(0,80))
        # Once the actual Node receipt arrives, the 20-byte floor does not
        # create a SECOND charge for the same 20 bytes.
        self.assertEqual(self.reserve(1,ack=20),(70,20))
        self.assertEqual(self.state(),(20,80))
        self.assertEqual(self.reserve(2),(30,0))
        self.assertEqual(self.state(),(20,80))

    def test_authenticated_overshoot_is_charged_not_refunded(self):
        self.reserve(1)
        self.reserve(2)
        self.assertEqual(self.state(), (0,100))
        self.assertEqual(self.reserve(1,ack=51),(51,51))
        self.assertEqual(self.state(),(51,50))
        self.assertEqual(self.reserve(1,ack=51),(51,51))
        self.assertEqual(self.reserve(2),(50,0))
        self.assertEqual(self.state(),(51,50))

    def test_lease_substitution_and_closed_epoch_are_rejected(self):
        self.reserve(1)
        before=self.state()
        original=self.ids[1]
        self.ids[1]=uuid.uuid4()
        with self.assertRaises(psycopg.Error):
            self.reserve(1)
        self.ids[1]=original
        self.assertEqual(self.state(),before)
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET closed=TRUE WHERE user_id=%s",(self.uid,))
        with self.assertRaises(psycopg.Error):
            self.reserve(2)
        self.assertEqual(self.state(),before)

    def ack(self,node,total, reservation_id=None):
        with psycopg.connect(DSN) as c:
            return c.execute(
                "SELECT ceiling_bytes,acknowledged_bytes FROM quota_v2_ack(%s,%s,%s,%s,%s,%s)",
                (self.uid,self.epoch,node,self.meters[node],reservation_id or self.ids[node],total)).fetchone()

    def revoke(self,node):
        with psycopg.connect(DSN) as c:
            c.execute(
                "INSERT INTO quota_v2_revocation_requests "
                "(user_id,epoch,node_id,meter_epoch,reservation_id,request_id) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (self.uid,self.epoch,node,self.meters[node],self.ids[node],uuid.uuid4()))

    def lease_until(self,node):
        with psycopg.connect(DSN) as c:
            return c.execute(
                "SELECT valid_until FROM quota_v2_reservations "
                "WHERE user_id=%s AND epoch=%s AND node_id=%s",
                (self.uid,self.epoch,node)).fetchone()[0]

    def test_revoked_lease_never_renews_or_refills_on_signed_poll(self):
        self.assertEqual(self.reserve(1),(50,0))
        self.assertEqual(self.reserve(2),(50,0))
        before_until=self.lease_until(1)
        self.revoke(1)
        # Every valid Node poll has a NEW 1-hour expiry proposal; revoked
        # leases must retain the previously signed expiry for all retries.
        self.assertEqual(self.reserve(1,target=50,ack=10),(50,10))
        self.assertEqual(self.lease_until(1),before_until)
        self.assertEqual(self.state(),(10,90))
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET limit_bytes=200 WHERE user_id=%s",
                      (self.uid,))
        self.assertEqual(self.reserve(1,target=50,ack=10),(50,10))
        self.assertEqual(self.lease_until(1),before_until)
        # The *other* non-revoked node may use newly paid capacity.
        self.assertEqual(self.reserve(2,target=90),(90,0))
        self.assertEqual(self.state(),(10,130))
        # Overshoot is charged, not refunded or used to extend revocation.
        self.assertEqual(self.reserve(1,target=50,ack=60),(60,60))
        self.assertEqual(self.lease_until(1),before_until)
        self.assertEqual(self.state(),(60,90))

    def test_revoked_expired_lease_cannot_be_resurrected(self):
        self.assertEqual(self.reserve(1,target=50),(50,0))
        with psycopg.connect(DSN) as c:
            c.execute(
                "UPDATE quota_v2_reservations "
                "SET valid_until=NOW()-INTERVAL '1 hour' "
                "WHERE user_id=%s AND node_id=1",(self.uid,))
        self.revoke(1)
        expired=self.lease_until(1)
        self.assertEqual(self.reserve(1,target=50,ack=0),(50,0))
        self.assertEqual(self.lease_until(1),expired)
        # A previously unfunded identity cannot acquire a grant after revoke.
        self.assertEqual(self.reserve(2,target=0),(0,0))
        self.revoke(2)
        self.assertEqual(self.reserve(2,target=50),(0,0))
        self.assertEqual(self.state(),(0,50))

    def burn(self,node,request_id=None):
        with psycopg.connect(DSN) as c:
            rid=request_id or c.execute(
                "SELECT request_id FROM quota_v2_revocation_requests "
                "WHERE user_id=%s AND epoch=%s AND node_id=%s",
                (self.uid,self.epoch,node)).fetchone()[0]
            return c.execute(
                "SELECT acknowledged_bytes,conservative_burned_bytes,"
                "conservative_burn_floor_bytes,conservative_burned_at IS NOT NULL "
                "FROM quota_v2_burn_revoked(%s,%s,%s,%s,%s,%s)",
                (self.uid,self.epoch,node,self.meters[node],self.ids[node],rid)).fetchone()

    def economic_state(self):
        with psycopg.connect(DSN) as c:
            return c.execute(
                "SELECT a.settled_bytes,COALESCE(SUM(r.ceiling_bytes-"
                "GREATEST(r.acknowledged_bytes,r.conservative_burn_floor_bytes)),0) "
                "FROM quota_v2_accounts a LEFT JOIN quota_v2_reservations r "
                "USING(user_id,epoch) WHERE a.user_id=%s GROUP BY a.settled_bytes",
                (self.uid,)).fetchone()

    def test_burn_is_permanently_charged_never_refunded_or_double_charged(self):
        self.assertEqual(self.reserve(1),(50,0))
        self.assertEqual(self.reserve(2),(50,0))
        self.assertEqual(self.ack(1,20),(50,20))
        self.revoke(1)
        first=self.burn(1)
        self.assertEqual(first[:3],(20,30,50))
        self.assertTrue(first[3])
        self.assertEqual(self.burn(1),first)
        self.assertEqual(self.economic_state(),(50,50))
        self.assertEqual(self.reserve(2,target=90),(50,0))
        self.assertEqual(self.reserve(1,target=50,ack=22),(50,22))
        self.assertEqual(self.economic_state(),(50,50))
        self.assertEqual(self.ack(1,50),(50,50))
        self.assertEqual(self.economic_state(),(50,50))
        self.assertEqual(self.ack(1,53),(53,53))
        self.assertEqual(self.economic_state(),(53,50))
        self.assertEqual(self.reserve(2,target=90),(50,0))
        # Late genuine Node receipts advance actual meters, but historical
        # burned liability cannot be enlarged by replaying the operator action.
        after_late=self.burn(1)
        self.assertEqual(after_late[0],53)
        self.assertEqual(after_late[1:],first[1:])
        self.assertEqual(self.economic_state(),(53,50))

    def test_burn_requires_exact_durable_revocation_and_preserves_state(self):
        self.reserve(1)
        self.reserve(2)
        before=self.economic_state()
        with self.assertRaises(psycopg.Error):
            self.burn(1,uuid.uuid4())
        self.assertEqual(self.economic_state(),before)
        self.revoke(1)
        with self.assertRaises(psycopg.Error):
            self.burn(1,uuid.uuid4())
        self.assertEqual(self.economic_state(),before)
        old_id=self.ids[1]
        self.ids[1]=uuid.uuid4()
        with self.assertRaises(psycopg.Error):
            self.burn(1)
        self.ids[1]=old_id
        self.assertEqual(self.economic_state(),before)
        self.assertEqual(self.burn(1)[1],50)
        self.assertEqual(self.economic_state(),(50,50))

    def test_burn_and_signed_receipt_are_serialized_no_refund(self):
        self.reserve(1)
        self.reserve(2)
        self.revoke(1)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda action: self.burn(1) if action=="burn"
                                  else self.ack(1,27),("burn","ack")))
        self.assertEqual(self.economic_state(),(50,50),results)
        with psycopg.connect(DSN) as c:
            amount=c.execute("SELECT conservative_burned_bytes "
                "FROM quota_v2_reservations WHERE user_id=%s AND node_id=1",
                (self.uid,)).fetchone()[0]
        self.assertIn(amount,(23,50))
        self.assertEqual(self.ack(1,49),(50,49))
        self.assertEqual(self.economic_state(),(50,50))

    def test_fully_burned_expired_hold_can_close_but_late_overshoot_charges(self):
        self.reserve(1)
        self.reserve(2)
        self.revoke(1)
        self.revoke(2)
        self.burn(1)
        self.burn(2)
        self.assertEqual(self.economic_state(),(100,0))
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET closed=TRUE WHERE user_id=%s",
                      (self.uid,))
        self.assertEqual(self.ack(1,20),(50,20))
        self.assertEqual(self.economic_state(),(100,0))
        self.assertEqual(self.ack(1,54),(54,54))
        self.assertEqual(self.economic_state(),(104,0))
        with self.assertRaises(psycopg.Error):
            self.reserve(1)

    def test_signed_receipt_is_scoped_idempotent_and_cannot_reissue_budget(self):
        self.reserve(1)
        self.reserve(2)
        self.assertEqual(self.ack(2,10),(50,10))
        self.assertEqual(self.state(),(10,90))
        self.assertEqual(self.ack(2,10),(50,10))
        self.assertEqual(self.ack(2,0),(50,10))
        self.assertEqual(self.reserve(1),(50,0))
        self.assertEqual(self.state(),(10,90))
        with self.assertRaises(psycopg.Error):
            self.ack(2,20,uuid.uuid4())
        self.assertEqual(self.state(),(10,90))

    def test_receipt_after_lease_expiry_and_overshoot_is_still_charged(self):
        self.reserve(1)
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_reservations SET valid_until=NOW()-INTERVAL '1 hour' WHERE user_id=%s",(self.uid,))
        self.assertEqual(self.ack(1,55),(55,55))
        self.assertEqual(self.state(),(55,0))
        self.assertEqual(self.ack(1,55),(55,55))

    def test_initial_migration_baseline_is_not_charged_twice(self):
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET limit_bytes=1000,settled_bytes=300 WHERE user_id=%s",(self.uid,))
        self.assertEqual(self.reserve(1,target=50,ack=300),(350,300))
        self.assertEqual(self.state(),(300,50))
        # The next receipt is charged once; a larger signed ceiling requires a new grant.
        self.assertEqual(self.reserve(1,target=50,ack=320),(370,320))
        self.assertEqual(self.state(),(320,50))

    # The following tests exercise the dormant SQL primitive directly as
    # migration OWNER in disposable PostgreSQL. This does NOT simulate a
    # valid Ed25519 terminal proof and does NOT enable any application API.
    def terminal_prepare(self, node=1, acknowledged=20, observed=20):
        self.reserve(node)
        self.ack(node, acknowledged)
        self.revoke(node)
        with psycopg.connect(DSN) as c:
            rid=c.execute(
                "SELECT request_id FROM quota_v2_revocation_requests "
                "WHERE user_id=%s AND epoch=%s AND node_id=%s",
                (self.uid,self.epoch,node)).fetchone()[0]
            c.execute(
                "UPDATE quota_v2_reservations SET node_confirmed=TRUE "
                "WHERE user_id=%s AND epoch=%s AND node_id=%s",
                (self.uid,self.epoch,node))
            c.execute(
                "UPDATE quota_v2_revocation_requests "
                "SET applied_at=NOW(),applied_revision=1,observed_used_bytes=%s "
                "WHERE user_id=%s AND epoch=%s AND node_id=%s",
                (observed,self.uid,self.epoch,node))
            return rid

    def terminal(self,base_node,base_total,base_request,**override):
        args={
            "user":self.uid,"epoch":self.epoch,"node":base_node,
            "meter":self.meters[base_node],"id":self.ids[base_node],
            "request":base_request,"revision":1,
            "runtime":"a"*64,"digest":"b"*64,"total":base_total,
        }
        args.update(override)
        with psycopg.connect(DSN) as c:
            return c.execute(
                "SELECT final_used_bytes,refunded_bytes,applied_revision,"
                "xray_runtime_id,proof_digest FROM "
                "quota_v2_settle_verified_terminal("
                "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (args["user"],args["epoch"],args["node"],args["meter"],
                 args["id"],args["request"],args["revision"],
                 args["runtime"],args["digest"],args["total"])).fetchone()

    def test_terminal_settlement_refunds_only_verified_unused_one_node(self):
        req=self.terminal_prepare(1,acknowledged=20)
        self.reserve(2)
        self.assertEqual(self.economic_state(),(20,80))
        settled=self.terminal(1,30,req)
        self.assertEqual(settled[:3],(30,20,1))
        self.assertEqual(self.economic_state(),(30,50))
        self.assertEqual(self.terminal(1,30,req),settled)
        self.assertEqual(self.economic_state(),(30,50))
        self.assertEqual(self.reserve(2,target=70),(70,0))
        self.assertEqual(self.economic_state(),(30,70))
        # A's previously expired/revoked reservation cannot mint a second
        # grant or change the terminal absolute meter.
        self.assertEqual(self.reserve(1,target=50),(30,30))
        self.assertEqual(self.economic_state(),(30,70))
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET closed=TRUE WHERE user_id=%s",
                      (self.uid,))
        self.assertEqual(self.terminal(1,30,req),settled)
        self.assertEqual(self.economic_state(),(30,70))

    def test_terminal_without_applied_stop_or_wrong_scope_never_releases(self):
        self.reserve(1)
        self.reserve(2)
        self.revoke(1)
        with psycopg.connect(DSN) as c:
            req=c.execute(
                "SELECT request_id FROM quota_v2_revocation_requests "
                "WHERE user_id=%s AND node_id=1",(self.uid,)).fetchone()[0]
        baseline=self.economic_state()
        with self.assertRaises(psycopg.Error):
            self.terminal(1,20,req)
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_reservations SET node_confirmed=TRUE "
                      "WHERE user_id=%s AND node_id=1",(self.uid,))
        with self.assertRaises(psycopg.Error):
            self.terminal(1,20,req)
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_revocation_requests "
                      "SET applied_at=NOW(),applied_revision=1,observed_used_bytes=10 "
                      "WHERE user_id=%s AND node_id=1",(self.uid,))
        for variant in (
            {"request":uuid.uuid4()}, {"id":uuid.uuid4()},
            {"meter":uuid.uuid4()}, {"epoch":uuid.uuid4()},
            {"node":2}, {"revision":2},
            {"runtime":"z"*64}, {"digest":"0"*64},
            {"total":9}, {"total":-1},
        ):
            with self.subTest(variant=variant):
                with self.assertRaises(psycopg.Error):
                    self.terminal(1,20,req,**variant)
                self.assertEqual(self.economic_state(),baseline)
        self.assertEqual(self.economic_state(),(0,100))

    def test_terminal_prevents_late_usage_burn_and_changed_replay(self):
        req=self.terminal_prepare(1,acknowledged=20)
        final=self.terminal(1,30,req)
        self.assertEqual(self.economic_state(),(30,0))
        for variant in (
            {"total":31}, {"total":29},
            {"runtime":"c"*64}, {"digest":"d"*64},
            {"request":uuid.uuid4()}, {"revision":2},
        ):
            with self.subTest(variant=variant):
                with self.assertRaises(psycopg.Error):
                    self.terminal(1,30,req,**variant)
                self.assertEqual(self.economic_state(),(30,0))
        with self.assertRaises(psycopg.Error):
            self.ack(1,31)
        with self.assertRaises(psycopg.Error):
            self.burn(1)
        self.assertEqual(self.terminal(1,30,req),final)
        self.assertEqual(self.economic_state(),(30,0))

    def test_terminal_and_other_node_reserve_are_account_locked(self):
        req=self.terminal_prepare(1,acknowledged=20)
        self.reserve(2)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            fut_a=pool.submit(self.terminal,1,30,req)
            fut_b=pool.submit(self.reserve,2,70)
            fut_a.result()
            fut_b.result()
        spent,held=self.economic_state()
        self.assertEqual(spent,30)
        self.assertLessEqual(spent+held,100)
        self.assertGreaterEqual(held,50)
        self.assertEqual(self.terminal(1,30,req)[1],20)

    def test_final_overrun_is_charged_and_never_refunded(self):
        request=self.terminal_prepare(1,acknowledged=20)
        spent=self.terminal(1,60,request)
        self.assertEqual(spent[0],60)
        self.assertEqual(spent[1],0)
        self.assertEqual(self.economic_state(),(60,0))
        self.assertEqual(self.terminal(1,60,request),spent)

    def test_final_receipt_is_physically_immutable_in_postgres(self):
        request=self.terminal_prepare(1,acknowledged=20)
        self.terminal(1,30,request)
        state=self.economic_state()
        for sql in (
            "UPDATE quota_v2_terminal_settlements SET refunded_bytes=50 WHERE user_id=%s",
            "DELETE FROM quota_v2_terminal_settlements WHERE user_id=%s",
        ):
            with self.subTest(operation=sql.split()[0]):
                with self.assertRaises(psycopg.Error):
                    with psycopg.connect(DSN) as c:
                        c.execute(sql,(self.uid,))
            self.assertEqual(self.economic_state(),state)
        self.assertEqual(self.terminal(1,30,request)[1],20)

    def test_conservative_burn_never_entitles_a_late_refund(self):
        self.reserve(1)
        self.revoke(1)
        self.burn(1)
        with psycopg.connect(DSN) as c:
            rid=c.execute(
                "SELECT request_id FROM quota_v2_revocation_requests "
                "WHERE user_id=%s AND node_id=1",(self.uid,)).fetchone()[0]
            c.execute("UPDATE quota_v2_reservations SET node_confirmed=TRUE "
                      "WHERE user_id=%s AND node_id=1",(self.uid,))
            c.execute("UPDATE quota_v2_revocation_requests SET applied_at=NOW(),"
                      "applied_revision=1,observed_used_bytes=0 "
                      "WHERE user_id=%s AND node_id=1",(self.uid,))
        before=self.economic_state()
        with self.assertRaises(psycopg.Error):
            self.terminal(1,30,rid)
        self.assertEqual(self.economic_state(),before)


if __name__ == "__main__":
    assert os.getenv("XMESH_AUDIT_DISPOSABLE") == "1"
    assert DSN.startswith("postgresql://quota_test:")
    unittest.main()
