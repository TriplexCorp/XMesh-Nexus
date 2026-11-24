#!/usr/bin/env python3
"""Only disposable PostgreSQL: signed quarantine policy -> real existing
allocator -> strict zero-authority runtime preflight with exact policy digest.
"""
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import unittest
import uuid

import psycopg

if os.environ.get("XMESH_AUDIT_DISPOSABLE")!="1" or "quota_preflight_test" not in os.getenv("QUOTA_TEST_DSN",""):
    raise SystemExit("only disposable PostgreSQL 17 integration")
DSN=os.environ["QUOTA_TEST_DSN"]
source=Path(__file__).with_name("test-quota-v2-genesis-quarantine-postgres.py")
spec=importlib.util.spec_from_file_location("staged_policy_tests",source)
fixtures=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
FUNC="""
 SELECT user_id,node_id,revision,reported_policy_sha256,authorized_bytes,
        can_start,can_resume,final_meter_verified,refundable_bytes
 FROM quota_v2_record_quarantined_runtime_preflight(
    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
"""

class QuarantinedRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.genesis=fixtures.QuarantineFirstGenesisSQL("test_exact_signed_policy_replay_zero_authority_and_no_regular_history")
        self.genesis.setUp()
        # Every test must receive its own *open* account: PostgreSQL
        # enforces one active epoch per user, and evidence is immutable.
        self.user=uuid.uuid4().int % (2 ** 51) + 100
        self.epoch=uuid.uuid4()
        self.meter=uuid.uuid4()
        self.reservation=uuid.uuid4()
        candidate=self.genesis.policy(users=[{
            "userId":self.user,"offlineBudgetBytes":0,"onHold":True
        }])
        original=self.genesis.stage(payload=candidate)
        self.policy_digest=original[1]
        with psycopg.connect(DSN) as c:
            c.execute("INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes)"
                      "VALUES(%s,%s,1000)",(self.user,self.epoch))
            self.revision,self.grant=c.execute(
                "SELECT revision,ceiling_bytes FROM quota_v2_reserve("
                "%s,%s,%s,%s,%s,700,0,NOW()+INTERVAL '1 hour')",
                (self.user,self.epoch,self.genesis.node,self.meter,self.reservation)
            ).fetchone()
            c.execute("UPDATE quota_v2_reservations SET node_confirmed=TRUE "
                      "WHERE user_id=%s AND node_id=%s",
                      (self.user,self.genesis.node))

    def params(self,**change):
        attrs=dict(user=self.user,epoch=self.epoch,node=self.genesis.node,
                   meter=self.meter,reservation=self.reservation,
                   revision=self.revision,challenge="3"*64,
                   runtime=self.genesis.runtime,container="4"*64,
                   pid=987,policy=self.policy_digest,
                   activation=self.genesis.activation,wal_floor=0)
        attrs.update(change)
        return tuple(attrs[k] for k in (
            "user","epoch","node","meter","reservation","revision",
            "challenge","runtime","container","pid",
            "policy","activation","wal_floor"))

    def record(self,**change):
        with psycopg.connect(DSN) as c:
            return c.execute(FUNC,self.params(**change)).fetchone()

    def deny(self,**change):
        with self.assertRaises(psycopg.Error):
            self.record(**change)

    def test_real_allocator_is_bound_to_signed_quarantine_policy(self):
        a=self.record()
        self.assertEqual(a[:4],(self.user,self.genesis.node,self.revision,self.policy_digest))
        self.assertEqual(a[4:],(0,False,False,False,0))
        self.assertEqual(self.record(),a)
        with psycopg.connect(DSN) as c:
            settled,held=c.execute("SELECT a.settled_bytes,"
                "SUM(r.ceiling_bytes-r.acknowledged_bytes)::bigint "
                "FROM quota_v2_accounts a JOIN quota_v2_reservations r "
                "USING(user_id,epoch) WHERE a.user_id=%s "
                "GROUP BY a.settled_bytes",(self.user,)).fetchone()
        self.assertEqual((settled,held),(0,700))

    def test_wrong_policy_runtime_activation_user_are_denied(self):
        for bad in [
            dict(policy="f"*64),
            dict(runtime="f"*64),
            dict(activation="f"*64),
            dict(user=12),
            dict(revision=self.revision+1),
            dict(wal_floor=701),
        ]:
            with self.subTest(bad=bad):
                self.deny(**bad)
        with psycopg.connect(DSN) as c:
            recorded=c.execute("SELECT COUNT(*) FROM quota_v2_runtime_admission_preflights "
                               "WHERE user_id=%s",(self.user,)).fetchone()[0]
        self.assertEqual(recorded,0)

    def test_quarantined_stage_prevents_ordinary_legacy_issuance(self):
        with psycopg.connect(DSN) as c:
            with self.assertRaises(psycopg.Error):
                with c.transaction():
                    c.execute("UPDATE quota_v2_xray_genesis SET policy_path_used=TRUE "
                              "WHERE node_id=%s",(self.genesis.node,))
            self.assertFalse(c.execute(
                "SELECT policy_path_used FROM quota_v2_xray_genesis "
                "WHERE node_id=%s",(self.genesis.node,)).fetchone()[0])
        # Still NO positive spending authority: strict preflight is a
        # nonauthorizing record even though the signed quarantine is valid.
        self.assertEqual(self.record()[4:],(0,False,False,False,0))

    def test_node_revocation_and_reservation_invalidation_denied(self):
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_reservations SET node_confirmed=FALSE "
                      "WHERE user_id=%s AND node_id=%s",
                      (self.user,self.genesis.node))
        self.deny()

    def test_lease_reply_rollback_and_immutable_exact_bytes(self):
        raw = json.dumps({
            "algorithm": "Ed25519", "signature": self.genesis.signature,
            "payload": {"nodeId": self.genesis.node, "userId": self.user,
                        "authorizedBytes": 0, "canSpend": False},
        }, sort_keys=True, separators=(",", ":")).encode()
        key = (self.genesis.node, self.user)
        insert = """INSERT INTO quota_v2_genesis_lease_replies
                    (node_id,user_id,stage,policy_sha256,signer_public_key,signed_reply)
                    VALUES(%s,%s,'confirm',%s,%s,%s)"""
        saved = """SELECT signed_reply FROM quota_v2_genesis_lease_replies
                   WHERE node_id=%s AND user_id=%s AND stage='confirm'"""
        args = (*key, self.policy_digest, self.genesis.signer, raw)
        with psycopg.connect(DSN) as writer, psycopg.connect(DSN, autocommit=True) as reader:
            writer.execute(insert, args)
            self.assertIsNone(reader.execute(saved, key).fetchone())
            writer.rollback()
            self.assertIsNone(reader.execute(saved, key).fetchone())

            writer.execute(insert, args)
            writer.commit()
            self.assertEqual(reader.execute(saved, key).fetchone(), (raw,))
            for statement, params in (
                (insert, args),
                ("UPDATE quota_v2_genesis_lease_replies SET signed_reply=%s "
                 "WHERE node_id=%s AND user_id=%s", (raw+b" ", *key)),
                ("DELETE FROM quota_v2_genesis_lease_replies WHERE node_id=%s AND user_id=%s", key),
                ("TRUNCATE quota_v2_genesis_lease_replies", ()),
            ):
                with self.subTest(statement=statement), self.assertRaises(psycopg.Error):
                    with writer.transaction():
                        writer.execute(statement, params)
            self.assertEqual(reader.execute(saved, key).fetchone(), (raw,))

    def test_12_parallel_same_preflight_remain_zero_authority(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            receipts=list(pool.map(lambda _:self.record(),range(12)))
        self.assertEqual(len(receipts),12)
        self.assertTrue(all(r==receipts[0] for r in receipts))
        with psycopg.connect(DSN) as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM quota_v2_runtime_admission_preflights "
                "WHERE user_id=%s",(self.user,)).fetchone()[0],1)


if __name__=="__main__":
    unittest.main()
