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

if __name__ == "__main__":
    assert os.getenv("XMESH_AUDIT_DISPOSABLE") == "1"
    assert DSN.startswith("postgresql://quota_test:")
    unittest.main()
