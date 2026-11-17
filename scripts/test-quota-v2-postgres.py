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

    def test_invalid_receipt_rolls_back_and_closed_epoch_fails(self):
        self.reserve(1)
        before=self.state()
        with self.assertRaises(psycopg.Error):
            self.reserve(1, ack=51)
        self.assertEqual(self.state(), before)
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET closed=TRUE WHERE user_id=%s",(self.uid,))
        with self.assertRaises(psycopg.Error):
            self.reserve(2)
        self.assertEqual(self.state(), before)

if __name__ == "__main__":
    assert os.getenv("XMESH_AUDIT_DISPOSABLE") == "1"
    assert DSN.startswith("postgresql://quota_test:")
    unittest.main()
