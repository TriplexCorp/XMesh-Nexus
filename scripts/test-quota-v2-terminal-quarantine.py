#!/usr/bin/env python3
"""Disposable PostgreSQL proof that terminal refunds remain impossible.

Migration 0129 is tested separately as a hypothetical accountant. After
applying 0132 to the SAME DB, even a caller running as the migration owner
with a seemingly valid finality tuple must be unable to refund a single byte.
No mocked signature/heartbeat, GUC, env flag, or SQL role assertion unlocks
the missing physical Xray finality proof.
"""
import concurrent.futures
import os
import unittest
import uuid

import psycopg

DSN = os.environ["QUOTA_TEST_DSN"]
assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
assert DSN.startswith("postgresql://quota_test:")


class TerminalQuarantineTests(unittest.TestCase):
    def setUp(self):
        self.user = uuid.uuid4().int % (2**60) + 1
        self.epoch = uuid.uuid4()
        self.meter1, self.meter2 = uuid.uuid4(), uuid.uuid4()
        self.reservation1, self.reservation2 = uuid.uuid4(), uuid.uuid4()
        self.request = uuid.uuid4()
        with psycopg.connect(DSN) as c:
            c.execute(
                "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes) "
                "VALUES (%s,%s,100)", (self.user, self.epoch))
            for node, meter, reservation in (
                (1,self.meter1,self.reservation1),
                (2,self.meter2,self.reservation2),
            ):
                c.execute(
                    "SELECT quota_v2_reserve(%s,%s,%s,%s,%s,50,0,"
                    "NOW()+INTERVAL '1 hour')",
                    (self.user,self.epoch,node,meter,reservation))
            c.execute(
                "SELECT quota_v2_ack(%s,%s,1,%s,%s,20)",
                (self.user,self.epoch,self.meter1,self.reservation1))
            c.execute(
                "INSERT INTO quota_v2_revocation_requests"
                "(user_id,epoch,node_id,meter_epoch,reservation_id,request_id,"
                "applied_at,applied_revision,observed_used_bytes)"
                "VALUES(%s,%s,1,%s,%s,%s,NOW(),1,20)",
                (self.user,self.epoch,self.meter1,self.reservation1,self.request))
            c.execute(
                "UPDATE quota_v2_reservations SET node_confirmed=TRUE "
                "WHERE user_id=%s AND epoch=%s AND node_id=1",
                (self.user,self.epoch))

    def state(self):
        with psycopg.connect(DSN) as c:
            account = c.execute(
                "SELECT limit_bytes,settled_bytes,observed_floor_bytes,closed "
                "FROM quota_v2_accounts WHERE user_id=%s AND epoch=%s",
                (self.user,self.epoch)).fetchone()
            leases = c.execute(
                "SELECT node_id,acknowledged_bytes,ceiling_bytes,"
                "conservative_burned_bytes,conservative_burn_floor_bytes "
                "FROM quota_v2_reservations WHERE user_id=%s AND epoch=%s "
                "ORDER BY node_id",
                (self.user,self.epoch)).fetchall()
            receipts = c.execute(
                "SELECT COUNT(*) FROM quota_v2_terminal_settlements "
                "WHERE user_id=%s AND epoch=%s",
                (self.user,self.epoch)).fetchone()[0]
            return account,leases,receipts

    def invoke(self, **override):
        args = {
            "user":self.user,"epoch":self.epoch,"node":1,"meter":self.meter1,
            "reservation":self.reservation1,"request":self.request,
            "revision":1,"runtime":"a"*64,"digest":"b"*64,"total":30,
        }
        args.update(override)
        with psycopg.connect(DSN) as c:
            c.execute("SET LOCAL xmesh.quota_v2_enabled = '1'")
            c.execute("SET LOCAL xmesh.quota_v2_verified_terminal = 'true'")
            c.execute("SET LOCAL xmesh.quota_v2_proof_attested = '1'")
            # This call executes with the migration OWNER's privileges.
            return c.execute(
                "SELECT refunded_bytes FROM quota_v2_settle_verified_terminal("
                "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (args["user"],args["epoch"],args["node"],args["meter"],
                 args["reservation"],args["request"],args["revision"],
                 args["runtime"],args["digest"],args["total"])).fetchone()

    def rejected(self, **override):
        with self.assertRaises(psycopg.Error) as raised:
            self.invoke(**override)
        self.assertEqual(raised.exception.sqlstate, "42501")
        self.assertIn("quarantined", str(raised.exception))

    def test_owner_cannot_settle_even_valid_looking_applied_stop(self):
        prior = self.state()
        self.assertEqual(prior[0][1], 20)
        self.assertEqual(prior[2], 0)
        self.rejected()
        self.assertEqual(self.state(), prior)

    def test_scope_substitution_and_arbitrary_digest_cannot_unlock_refund(self):
        prior = self.state()
        for variant in (
            {"node":2}, {"user":self.user+1}, {"epoch":uuid.uuid4()},
            {"reservation":uuid.uuid4()}, {"meter":uuid.uuid4()},
            {"request":uuid.uuid4()}, {"revision":2},
            {"total":0}, {"total":20}, {"total":30}, {"total":50},
            {"total":-1}, {"total":2**63-1},
            {"runtime":"f"*64}, {"digest":"f"*64},
            {"digest":"0"*64}, {"digest":"not-a-digest"},
        ):
            with self.subTest(variant=str(variant)):
                self.rejected(**variant)
                self.assertEqual(self.state(), prior)

    def test_parallel_spoofed_finality_and_nonce_replay_do_not_release_capacity(self):
        prior = self.state()
        def attempt(_):
            try:
                self.invoke()
            except psycopg.Error as exc:
                if exc.sqlstate == "42501" and "quarantined" in str(exc):
                    return "denied"
                return "wrong-exception"
            return "unauthorized-refund"
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            attempted = list(pool.map(attempt, range(24)))
        self.assertEqual(attempted, ["denied"]*24)
        self.assertEqual(self.state(), prior)

    def test_feature_toggle_does_not_enable_sql_terminal_refunds(self):
        prior = self.state()
        original = os.environ.get("XMESH_QUOTA_V2_ENABLED")
        try:
            for val in ("0", "1"):
                os.environ["XMESH_QUOTA_V2_ENABLED"] = val
                self.rejected()
                self.assertEqual(self.state(), prior)
        finally:
            if original is None:
                os.environ.pop("XMESH_QUOTA_V2_ENABLED", None)
            else:
                os.environ["XMESH_QUOTA_V2_ENABLED"] = original

    def test_quarantine_preserves_valid_other_node_accounting(self):
        prior = self.state()
        self.rejected()
        with psycopg.connect(DSN) as c:
            row = c.execute(
                "SELECT ceiling_bytes,acknowledged_bytes FROM "
                "quota_v2_reserve(%s,%s,2,%s,%s,50,0,"
                "NOW()+INTERVAL '1 hour')",
                (self.user,self.epoch,self.meter2,self.reservation2)).fetchone()
            self.assertEqual(row, (50,0))
        self.assertEqual(self.state(),prior)


if __name__ == "__main__":
    unittest.main()
