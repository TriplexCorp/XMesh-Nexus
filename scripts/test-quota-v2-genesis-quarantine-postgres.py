#!/usr/bin/env python3
"""PostgreSQL 17 first-ever quarantine policy staging (NO spending authority).

This disposable fixture uses the real Nexus 0137/0138/0141 SQL, not a
mocked policy database function. Signature verification and endpoint
authentication are handled by Nexus Rust, not duplicated in SQL.
"""
import concurrent.futures
import json
import os
import time
import unittest
import uuid

import psycopg

if os.getenv("XMESH_AUDIT_DISPOSABLE") != "1" or "quota_preflight_test" not in os.getenv("QUOTA_TEST_DSN",""):
    raise SystemExit("refuse first-genesis quarantine test outside disposable database")
DSN = os.environ["QUOTA_TEST_DSN"]
FUNC = """
 SELECT node_id,policy_sha256,profile_revision,signed_policy_bytes,
        policy_signature,signer_public_key,authorized_bytes,
        can_start,can_resume,refundable_bytes
 FROM quota_v2_stage_genesis_quarantine_policy(%s,%s,%s,%s,%s,%s,%s,%s)
"""
def h(c):
    return c*64


class QuarantineFirstGenesisSQL(unittest.TestCase):
    def setUp(self):
        self.node=uuid.uuid4().int % (2**48)+100
        self.activation=h("c")
        self.runtime=h("a")
        self.challenge=h("e")
        self.revision=h("d")
        self.signature="1"*128
        self.signer=h("2")
        with psycopg.connect(DSN) as c:
            c.execute("INSERT INTO node_xsp_product_nodes(node_id,state,receipt_sha256) "
                      "VALUES(%s,'active',decode(%s,'hex'))",(self.node,self.activation))
            self.prepared=c.execute(
                "SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint"
            ).fetchone()[0]
            c.execute(
                "INSERT INTO quota_v2_xray_genesis("
                "node_id,first_activation_sha256,runtime_id,challenge,"
                "prepared_ms,receipt_signature) VALUES(%s,%s,%s,%s,%s,%s)",
                (self.node,self.activation,self.runtime,self.challenge,
                 self.prepared,"0"*128))

    def policy(self,**overrides):
        p={
            "version":1,"kind":"xmesh.quota-v2.genesis-quarantine-policy",
            "nodeId":self.node,"configSha256":self.revision,
            "issuedAtMs":self.prepared,"validUntilMs":self.prepared+120000,
            "users":[
                {"userId":10,"offlineBudgetBytes":0,"onHold":True},
                {"userId":11,"offlineBudgetBytes":0,"onHold":True},
            ],
            "quotaV2Genesis":{
                "mode":"quarantined","runtimeId":self.runtime,
                "challenge":self.challenge,
                "firstActivationReceiptSha256":self.activation,
                "authorizedBytes":0,"canStart":False,
                "canResume":False,"refundableBytes":0,
            },
        }
        p.update(overrides)
        return (json.dumps(p,sort_keys=True,separators=(",",":"))).encode("utf-8")

    def stage(self,payload=None,**changes):
        a=dict(node=self.node,activation=self.activation,runtime=self.runtime,
               challenge=self.challenge,revision=self.revision,
               payload=self.policy() if payload is None else payload,
               signature=self.signature,signer=self.signer)
        a.update(changes)
        with psycopg.connect(DSN) as c:
            return c.execute(FUNC,tuple(a[k] for k in (
                "node","activation","runtime","challenge","revision",
                "payload","signature","signer"))).fetchone()

    def deny(self,**changes):
        with self.assertRaises(psycopg.Error):
            self.stage(**changes)

    def test_exact_signed_policy_replay_zero_authority_and_no_regular_history(self):
        data=self.policy()
        a=self.stage(data)
        self.assertEqual(a[0],self.node)
        self.assertEqual(a[2],self.revision)
        self.assertEqual(a[3],data)
        self.assertEqual(a[6:],(0,False,False,0))
        self.assertEqual(self.stage(data),a)
        with psycopg.connect(DSN) as c:
            marker=c.execute("SELECT policy_path_used FROM quota_v2_xray_genesis "
                             "WHERE node_id=%s",(self.node,)).fetchone()[0]
            desired=c.execute("SELECT COUNT(*) FROM node_desired_revisions "
                              "WHERE node_id=%s",(self.node,)).fetchone()[0]
        self.assertFalse(marker)
        self.assertEqual(desired,0)

    def test_24_concurrent_exact_retries_create_one_immutable_row(self):
        payload=self.policy()
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            outcomes=list(pool.map(lambda _:self.stage(payload),range(24)))
        self.assertEqual(len(outcomes),24)
        self.assertTrue(all(outcome==outcomes[0] for outcome in outcomes))
        with psycopg.connect(DSN) as c:
            count=c.execute("SELECT COUNT(*) FROM quota_v2_genesis_quarantine_policies "
                "WHERE node_id=%s",(self.node,)).fetchone()[0]
        self.assertEqual(count,1)

    def test_old_desired_path_permanently_closes_quarantine(self):
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_xray_genesis SET policy_path_used=TRUE "
                      "WHERE node_id=%s",(self.node,))
        self.deny()
        with psycopg.connect(DSN) as c:
            with self.assertRaises(psycopg.Error):
                with c.transaction():
                    c.execute("UPDATE quota_v2_xray_genesis SET policy_path_used=FALSE "
                              "WHERE node_id=%s",(self.node,))

    def test_normal_desired_revision_even_without_marker_denies(self):
        with psycopg.connect(DSN) as c:
            c.execute("INSERT INTO node_desired_revisions(node_id) VALUES(%s)",(self.node,))
        self.deny()

    def test_old_wal_birth_and_old_traffic_denied(self):
        with psycopg.connect(DSN) as c:
            c.execute("INSERT INTO quota_v2_external_wal_birth_anchors(node_id) "
                      "VALUES(%s)",(self.node,))
        self.deny()

    def test_altered_runtime_activation_policy_and_signer_denied(self):
        for field,val in [
            ("runtime",h("f")),("activation",h("f")),
            ("challenge",h("f")),("revision",h("f")),
            ("payload",self.policy(users=[
                {"userId":10,"offlineBudgetBytes":1,"onHold":False}]))
        ]:
            with self.subTest(field=field):
                self.deny(**{field:val})

    def test_null_unlimited_and_positive_offline_allowance_denied(self):
        for budget in (None,1,67108864,-1):
            p=self.policy(users=[{
                "userId":101,"offlineBudgetBytes":budget,"onHold":True}])
            with self.subTest(budget=budget):
                self.deny(payload=p)

    def test_missing_quarantine_flag_and_modified_scope_denied(self):
        for override in [
            {"kind":"xmesh.quota-v2.active"},
            {"validUntilMs":self.prepared+120001},
            {"issuedAtMs":self.prepared+1},
            {"quotaV2Genesis":dict(mode="active",runtimeId=self.runtime,
                challenge=self.challenge,firstActivationReceiptSha256=self.activation,
                authorizedBytes=0,canStart=False,canResume=False,refundableBytes=0)},
            {"quotaV2Genesis":dict(mode="quarantined",runtimeId=self.runtime,
                challenge=self.challenge,firstActivationReceiptSha256=self.activation,
                authorizedBytes=1,canStart=True,canResume=False,refundableBytes=0)},
        ]:
            with self.subTest(change=override):
                self.deny(payload=self.policy(**override))

    def test_conflict_replay_and_immutable_record(self):
        baseline=self.policy()
        self.stage(baseline)
        # The DB cannot independently prove Ed25519, but it refuses ANY
        # different original signature/key once the trusted Rust signer
        # committed the first immutable quarantine document.
        self.deny(signature="f"*128)
        self.deny(signer=h("f"))
        self.deny(payload=self.policy(users=[]))
        with psycopg.connect(DSN) as c:
            for sql in (
                "UPDATE quota_v2_genesis_quarantine_policies SET can_start=TRUE",
                "DELETE FROM quota_v2_genesis_quarantine_policies",
                "TRUNCATE quota_v2_genesis_quarantine_policies"
            ):
                with self.assertRaises(psycopg.Error):
                    with c.transaction():
                        c.execute(sql)
            c.execute("SET synchronous_commit=off")
            self.assertEqual(c.execute("SELECT current_setting('synchronous_commit')").fetchone()[0],"off")
            self.assertEqual(self.stage(baseline)[6:],(0,False,False,0))

    def test_public_sql_role_cannot_use_stage_function(self):
        with psycopg.connect(DSN) as c:
            if not c.execute("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s)",
                         ("quarantine_untrusted",)).fetchone()[0]:
                c.execute("CREATE ROLE quarantine_untrusted NOLOGIN")
            self.assertFalse(c.execute("SELECT has_function_privilege("
                "'quarantine_untrusted',"
                "'quota_v2_stage_genesis_quarantine_policy(bigint,text,text,text,text,bytea,text,text)',"
                "'EXECUTE')").fetchone()[0])


if __name__ == "__main__":
    unittest.main()
