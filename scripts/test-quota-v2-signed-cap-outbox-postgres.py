#!/usr/bin/env python3
"""Disposable PostgreSQL 17 exactly-once signed-cap outbox tests.

The SQL layer checks committed reservation/scope and immutable storage, NOT
Ed25519 verification. Real Ed25519 signature checks run in the Nexus Rust
test and the two-process instrumented Xray acceptance workflow.
"""
import concurrent.futures
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import time
import unittest

import psycopg

if os.getenv("XMESH_AUDIT_DISPOSABLE")!="1":
    raise SystemExit("only disposable DB may execute signed cap SQL tests")
source=Path(__file__).with_name("test-quota-v2-runtime-preflight-postgres.py")
spec=importlib.util.spec_from_file_location("quota_preflight_test_fixture",source)
old=importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)
DSN=os.environ["QUOTA_TEST_DSN"]


class SignedFirstCapOutboxTests(unittest.TestCase):
    def setUp(self):
        self.state=old.StagingAdmissionPreflight(
            "test_real_two_node_allocator_is_not_reissued_by_runtime_preflight")
        self.state.setUp()
        self.node=self.state.node_a
        self.nonce="e"*64
        self.state.snapshot(node=self.node,challenge=self.nonce)

    def tearDown(self):
        self.state.doCleanups()

    def signed(self,**fields):
        now=int(time.time()*1000)
        p={
            "schemaVersion":1,"kind":"xmesh.quota-v2.xray-cap-admission",
            "nodeId":self.node,"userId":self.state.user,
            "activationReceiptSha256":self.state.activation[self.node],
            "runtimeId":self.state.runtime[self.node],
            "policySha256":"2"*64,"accountEpoch":str(self.state.epoch),
            "meterEpoch":str(self.state.meters[self.node]),
            "reservationId":str(self.state.ids[self.node]),
            "reservationRevision":self.state.rev[self.node],
            "nonce":self.nonce,"inventoryTailDigest":"0"*64,
            "witnessedWalBytes":0,"witnessedCdnBytes":0,
            "sharedCeilingBytes":700,"nodeCeilingBytes":700,
            "cdnCeilingBytes":150,
            "aliasScopes":[
                {"email":f"xmesh-u{self.state.user}--vless-cdn","class":"cdn"},
                {"email":f"xmesh-u{self.state.user}--vless-main","class":"main"},
            ],
            "issuedAtMs":now-1000,"installBeforeMs":now+60000,
            "validUntilMs":now+3000000,
            "canSpend":True,"canStart":False,"canResume":False,
            "finalMeterVerified":False,"refundableBytes":0,
        }
        p.update(fields)
        return (json.dumps({"algorithm":"Ed25519","payload":p,
                            "signature":"f"*128},sort_keys=True,
                           separators=(",",":"))+"\n").encode()

    def store(self,raw,challenge=None):
        with psycopg.connect(DSN) as c:
            return c.execute(
                "SELECT signed_envelope,signer_public_key,grant_bytes "
                "FROM quota_v2_store_signed_first_cap(%s,%s,%s,%s)",
                (self.node,challenge or self.nonce,"a"*64,raw)
            ).fetchone()

    def deny(self,raw=None,challenge=None):
        with self.assertRaises(psycopg.Error):
            self.store(raw if raw is not None else self.signed(),challenge)

    def test_exact_byte_idempotency_and_zero_refund(self):
        raw=self.signed()
        first=self.store(raw)
        self.assertEqual(first,(raw,"a"*64,700))
        self.assertEqual(self.store(raw),first)
        with psycopg.connect(DSN) as c:
            rows=c.execute(
                "SELECT signed_envelope,grant_bytes,can_start,can_resume,"
                "refundable_bytes FROM quota_v2_signed_first_cap_outbox "
                "WHERE node_id=%s",(self.node,)).fetchall()
            account=c.execute(
                "SELECT settled_bytes,observed_floor_bytes FROM quota_v2_accounts "
                "WHERE user_id=%s",(self.state.user,)).fetchone()
        self.assertEqual(rows,[(raw,700,False,False,0)])
        self.assertEqual(account,(0,0))
        # An altered signed message is not silently treated as a valid retry.
        forged=json.loads(raw)
        forged["payload"]["issuedAtMs"]+=1
        self.deny((json.dumps(forged,sort_keys=True,separators=(",",":"))+"\n").encode())

    def test_other_node_ack_changes_shared_snapshot_but_original_reply_survives(self):
        raw=self.signed()
        original=self.store(raw)
        # Node B independently sends a legitimate signed/verified absolute
        # metering ACK. It changes global settled + outstanding bytes but
        # cannot invalidate Node A's already fsynced exact original reply.
        other=self.state.node_b
        with psycopg.connect(DSN) as c:
            c.execute(
                "SELECT quota_v2_ack(%s,%s,%s,%s,%s,100)",
                (self.state.user,self.state.epoch,other,
                 self.state.meters[other],self.state.ids[other]))
        self.assertEqual(self.store(raw),original)
        with psycopg.connect(DSN) as c:
            settled,held=c.execute(
                "SELECT a.settled_bytes,"
                "COALESCE(SUM(r.ceiling_bytes-r.acknowledged_bytes),0)::bigint "
                "FROM quota_v2_accounts a JOIN quota_v2_reservations r "
                "USING(user_id,epoch) WHERE a.user_id=%s "
                "GROUP BY a.settled_bytes",(self.state.user,)).fetchone()
        self.assertEqual((settled,held),(100,900))
        newer=json.loads(raw)
        newer["payload"]["issuedAtMs"]+=1
        different=(json.dumps(newer,sort_keys=True,separators=(",",":"))+"\n").encode()
        self.deny(different)

    def test_parallel_identical_packets_use_one_outbox_record(self):
        raw=self.signed()
        def call(_):return self.store(raw)
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            results=list(pool.map(call,range(20)))
        self.assertTrue(all(value==(raw,"a"*64,700) for value in results))
        with psycopg.connect(DSN) as c:
            count=c.execute(
                "SELECT COUNT(*) FROM quota_v2_signed_first_cap_outbox "
                "WHERE user_id=%s",(self.state.user,)).fetchone()[0]
        self.assertEqual(count,1)

    def test_lost_nonce_cannot_mint_second_cap_for_same_lease_revision(self):
        self.store(self.signed())
        alternative="d"*64
        self.state.snapshot(node=self.node,challenge=alternative)
        other=self.signed(nonce=alternative)
        self.deny(other,challenge=alternative)

    def test_all_stale_or_changed_signed_fields_are_denied(self):
        baseline=json.loads(self.signed())["payload"]
        cases={
            "nodeId":self.node+1,"userId":self.state.user+1,
            "reservationRevision":self.state.rev[self.node]+1,
            "runtimeId":"d"*64,"policySha256":"f"*64,
            "activationReceiptSha256":"f"*64,
            "accountEpoch":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "meterEpoch":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "reservationId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "nonce":"d"*64,"inventoryTailDigest":"e"*64,
            "witnessedWalBytes":1,"witnessedCdnBytes":1,
            "sharedCeilingBytes":701,"nodeCeilingBytes":701,
            "canSpend":False,"canStart":True,"canResume":True,
            "finalMeterVerified":True,"refundableBytes":1,
            "installBeforeMs":int(time.time()*1000)-100,
            "validUntilMs":int(time.time()*1000)+4000000,
        }
        for field,value in cases.items():
            with self.subTest(field=field):
                changed=dict(baseline)
                changed[field]=value
                raw=(json.dumps({"algorithm":"Ed25519","payload":changed,
                        "signature":"f"*128},sort_keys=True,
                        separators=(",",":"))+"\n").encode()
                self.deny(raw)

    def test_ack_or_revocation_after_preflight_forbids_signed_grant(self):
        with psycopg.connect(DSN) as c:
            c.execute(
                "SELECT quota_v2_ack(%s,%s,%s,%s,%s,1)",
                (self.state.user,self.state.epoch,self.node,
                 self.state.meters[self.node],self.state.ids[self.node]))
        self.deny()

    def test_evidence_immutable_and_public_role_cannot_execute(self):
        self.store(self.signed())
        with psycopg.connect(DSN) as c:
            for sql in [
                "UPDATE quota_v2_signed_first_cap_outbox SET can_start=TRUE",
                "DELETE FROM quota_v2_signed_first_cap_outbox",
                "TRUNCATE quota_v2_signed_first_cap_outbox",
            ]:
                with self.assertRaises(psycopg.Error):
                    with c.transaction():
                        c.execute(sql)
            role="quota_v2_cap_untrusted"
            if not c.execute(
                "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s)",(role,)
            ).fetchone()[0]:
                c.execute("CREATE ROLE quota_v2_cap_untrusted NOLOGIN")
            self.assertFalse(c.execute(
                "SELECT has_function_privilege('quota_v2_cap_untrusted',"
                "'quota_v2_store_signed_first_cap(bigint,text,text,bytea)','EXECUTE')"
            ).fetchone()[0])


class Xsp2CapStagingJournalTests(unittest.TestCase):
    def setUp(self):
        self.state=old.StagingAdmissionPreflight(
            "test_real_two_node_allocator_is_not_reissued_by_runtime_preflight")
        self.state.setUp()
        self.node=self.state.node_a
        self.challenge="a"*64
        self.state.snapshot(node=self.node,challenge=self.challenge)

    def tearDown(self):
        self.state.doCleanups()

    def store(self,nonce=b"x"*16,challenge=None,revision=None):
        raw=b'{"XSP/2":"quarantined original encrypted dual-key assertion"}'
        raw=raw*8
        with psycopg.connect(DSN) as c:
            return c.execute(
                "INSERT INTO quota_v2_xsp2_cap_attestations("
                "node_id,request_challenge,user_id,epoch,meter_epoch,"
                "reservation_id,reservation_revision,key_epoch,"
                "ed25519_key_id,mldsa65_key_id,xsp_nonce,"
                "assertion_sha256,signed_envelope) VALUES("
                "%s,%s,%s,%s,%s,%s,%s,1,'ed-test','pq-test',%s,%s,%s)"
                " RETURNING authorized_bytes,can_start,can_resume,"
                "final_meter_verified,refundable_bytes",
                (self.node,challenge or self.challenge,self.state.user,
                 self.state.epoch,self.state.meters[self.node],
                 self.state.ids[self.node],revision or self.state.rev[self.node],
                 nonce,hashlib.sha256(raw).hexdigest(),raw)
            ).fetchone()

    def test_quarantined_assertion_cannot_grant_start_or_refund(self):
        self.assertEqual(self.store(),(0,False,False,False,0))
        with psycopg.connect(DSN) as c:
            row=c.execute("SELECT signed_envelope,xsp_nonce FROM "
                "quota_v2_xsp2_cap_attestations WHERE node_id=%s",
                (self.node,)).fetchone()
            self.assertEqual(row[1],b"x"*16)
            self.assertGreater(len(row[0]),300)
            for attempt in (
                "UPDATE quota_v2_xsp2_cap_attestations SET authorized_bytes=1",
                "UPDATE quota_v2_xsp2_cap_attestations SET can_resume=TRUE",
                "DELETE FROM quota_v2_xsp2_cap_attestations",
                "TRUNCATE quota_v2_xsp2_cap_attestations",
            ):
                with self.assertRaises(psycopg.Error):
                    with c.transaction():
                        c.execute(attempt)

    def test_nonce_and_preflight_challenge_cannot_be_reassigned(self):
        self.store()
        other="b"*64
        self.state.snapshot(node=self.node,challenge=other)
        with self.assertRaises(psycopg.Error):
            self.store(challenge=other)  # Reused authenticated XSP/2 nonce.
        with self.assertRaises(psycopg.Error):
            self.store(nonce=b"y"*16,challenge=self.challenge)
        with self.assertRaises(psycopg.Error):
            self.store(nonce=b"z"*16,challenge="c"*64)

    def test_ordinary_sql_role_cannot_write_staged_attestation(self):
        with psycopg.connect(DSN) as c:
            role="quota_v2_xsp2_untrusted"
            if not c.execute("SELECT EXISTS(SELECT 1 FROM pg_roles "
                             "WHERE rolname=%s)",(role,)).fetchone()[0]:
                c.execute("CREATE ROLE quota_v2_xsp2_untrusted NOLOGIN")
            self.assertFalse(c.execute(
                "SELECT has_table_privilege(%s,"
                "'quota_v2_xsp2_cap_attestations','INSERT')",
                (role,)).fetchone()[0])
            self.assertFalse(c.execute(
                "SELECT has_table_privilege(%s,"
                "'quota_v2_xsp2_cap_attestations','UPDATE')",
                (role,)).fetchone()[0])


if __name__=="__main__":
    unittest.main()
