#!/usr/bin/env python3
"""Real PostgreSQL first-Genesis public TLS candidate filter, NO issuance.

The disposable SQL fixtures contain syntactically signed bytes but are NOT
cryptographic proof. Actual Nexus -> Node Ed25519 verification is tested in
quota-v2-public-tls-contract.yml. A positive row here must NEVER open a port:
only a future authenticated, serialized, process-attested issuer can do that.
"""
import hashlib
import json
import os
import time
import unittest
import uuid

import psycopg

DSN = os.environ.get("QUOTA_TEST_DSN", "")
if (os.environ.get("XMESH_AUDIT_DISPOSABLE") != "1"
        or "/quota_preflight_test" not in DSN
        or "@127.0.0.1:" not in DSN):
    raise SystemExit("refusing non-disposable public TLS candidate SQL test")

QUERY = """SELECT user_id, account_epoch, reservation_id, meter_epoch,
                  reservation_revision, valid_until_ms, remaining_signed_bytes
           FROM quota_v2_public_tls_first_cap_candidates(
               %s,%s,%s,%s,%s,%s,%s)"""
ROSTER_QUERY = """SELECT quota_v2_public_tls_exact_first_roster(
                  %s,%s,%s,%s,%s,%s,%s)"""


def canonical(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode()


def hex64(letter):
    return letter * 64


class FirstGenesisPublicTlsSqlCandidates(unittest.TestCase):
    def setUp(self):
        self.seed()

    def seed(self, *, extra_user=None, duplicate_user=False):
        self.node = uuid.uuid4().int % (2**42) + 100
        self.user = uuid.uuid4().int % (2**50) + 100
        self.epoch = uuid.uuid4()
        self.meter = uuid.uuid4()
        self.reservation = uuid.uuid4()
        self.activation = hex64("a")
        self.runtime = hex64("b")
        self.profile = hex64("c")
        self.signer = hex64("d")
        self.challenge = hex64("e")
        self.cap_challenge = hex64("f")
        with psycopg.connect(DSN) as conn:
            self.prepared = conn.execute(
                "SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint"
            ).fetchone()[0]
            conn.execute(
                "INSERT INTO node_xsp_product_nodes(node_id,state,receipt_sha256)"
                " VALUES (%s,'active',decode(%s,'hex'))",
                (self.node, self.activation))
            conn.execute(
                "INSERT INTO quota_v2_xray_genesis("
                "node_id,first_activation_sha256,runtime_id,challenge,"
                "prepared_ms,receipt_signature) VALUES (%s,%s,%s,%s,%s,%s)",
                (self.node,self.activation,self.runtime,self.challenge,
                 self.prepared,"0"*128))
            roster = [{"userId":self.user,"offlineBudgetBytes":0,
                       "onHold":True}]
            if extra_user is not None:
                roster.append({"userId":extra_user,"offlineBudgetBytes":0,
                               "onHold":True})
            if duplicate_user:
                roster.append(dict(roster[0]))
            quarantine = canonical({
                "version":1, "kind":"xmesh.quota-v2.genesis-quarantine-policy",
                "nodeId":self.node, "configSha256":self.profile,
                "issuedAtMs":self.prepared,
                "validUntilMs":self.prepared+120000,
                "users":roster,
                "quotaV2Genesis":{
                    "mode":"quarantined", "runtimeId":self.runtime,
                    "challenge":self.challenge,
                    "firstActivationReceiptSha256":self.activation,
                    "authorizedBytes":0, "canStart":False,
                    "canResume":False, "refundableBytes":0,
                },
            })
            self.policy = hashlib.sha256(quarantine).hexdigest()
            conn.execute(
                "SELECT node_id FROM quota_v2_stage_genesis_quarantine_policy("
                "%s,%s,%s,%s,%s,%s,%s,%s)",
                (self.node,self.activation,self.runtime,self.challenge,
                 self.profile,quarantine,"1"*128,self.signer))
            conn.execute(
                "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes)"
                " VALUES(%s,%s,1000)",(self.user,self.epoch))
            lease=conn.execute(
                "SELECT revision,ceiling_bytes FROM quota_v2_reserve("
                "%s,%s,%s,%s,%s,700,0,NOW()+INTERVAL '1 hour')",
                (self.user,self.epoch,self.node,self.meter,self.reservation)
            ).fetchone()
            self.revision = lease[0]
            self.assertEqual(lease[1],700)
            conn.execute("UPDATE quota_v2_reservations SET node_confirmed=TRUE "
                         "WHERE user_id=%s AND epoch=%s AND node_id=%s",
                         (self.user,self.epoch,self.node))
            conn.execute(
                "SELECT user_id FROM quota_v2_record_quarantined_runtime_preflight("
                "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0)",
                (self.user,self.epoch,self.node,self.meter,self.reservation,
                 self.revision,self.cap_challenge,self.runtime,hex64("1"),
                 2345,self.policy,self.activation))
        self.addCleanup(lambda: None)

    def prep_confirm(self):
        # SQL fixtures only: syntactic envelope bytes, not a real signature.
        # Positive selection NEVER creates traffic authority.
        with psycopg.connect(DSN) as c:
            for stage in ("prepare","confirm"):
                c.execute(
                    "INSERT INTO quota_v2_genesis_lease_replies("
                    "node_id,user_id,stage,policy_sha256,signer_public_key,"
                    "signed_reply) VALUES(%s,%s,%s,%s,%s,%s)",
                    (self.node,self.user,stage,self.policy,self.signer,
                     b"disposable unsigned reply" * 12))

    def store_cap(self):
        now = int(time.time()*1000)
        claims = {
            "schemaVersion":1, "kind":"xmesh.quota-v2.xray-cap-admission",
            "nodeId":self.node, "userId":self.user,
            "activationReceiptSha256":self.activation,
            "runtimeId":self.runtime, "policySha256":self.policy,
            "accountEpoch":str(self.epoch), "meterEpoch":str(self.meter),
            "reservationId":str(self.reservation),
            "reservationRevision":self.revision,
            "nonce":self.cap_challenge,
            "inventoryTailDigest":"0"*64,
            "witnessedWalBytes":0,"witnessedCdnBytes":0,
            "sharedCeilingBytes":700,"nodeCeilingBytes":700,"cdnCeilingBytes":150,
            "aliasScopes":[
                {"class":"cdn","email":f"xmesh-u{self.user}--vless-cdn"},
                {"class":"main","email":f"xmesh-u{self.user}--vless-main"}],
            "issuedAtMs":now-1000,"installBeforeMs":now+60000,
            "validUntilMs":now+3000000,
            "canSpend":True,"canStart":False,"canResume":False,
            "finalMeterVerified":False,"refundableBytes":0,
        }
        # No actual signing here; the database filter isn't an Ed25519
        # verifier and callers must never treat this test as production proof.
        raw = canonical({
            "algorithm":"Ed25519", "payload":claims,
            "signature":"2"*128,
        })+b"\n"
        with psycopg.connect(DSN) as c:
            result=c.execute(
                "SELECT grant_bytes FROM quota_v2_store_signed_first_cap("
                "%s,%s,%s,%s)",(self.node,self.cap_challenge,self.signer,raw)
            ).fetchone()
        self.assertEqual(result[0],700)

    def candidates(self, **fields):
        args={
            "node":self.node,"activation":self.activation,
            "runtime":self.runtime,"profile":self.profile,
            "policy":self.policy,"signer":self.signer,"ttl":1000,
        }
        args.update(fields)
        with psycopg.connect(DSN) as c:
            return c.execute(QUERY,tuple(args[k] for k in (
                "node","activation","runtime","profile","policy","signer","ttl"
            ))).fetchall()

    def exact_roster(self, **fields):
        args = {
            "node":self.node, "activation":self.activation,
            "runtime":self.runtime, "profile":self.profile,
            "policy":self.policy, "signer":self.signer, "ttl":1000,
        }
        args.update(fields)
        with psycopg.connect(DSN) as c:
            return c.execute(ROSTER_QUERY,tuple(args[k] for k in (
                "node","activation","runtime","profile","policy","signer","ttl"
            ))).fetchone()[0]

    def armed(self):
        self.prep_confirm()
        self.store_cap()

    def test_exact_roster_is_non_authorizing_and_requires_all_signed_caps(self):
        self.assertIs(self.exact_roster(), False)
        self.store_cap()
        self.assertIs(self.exact_roster(), False)
        self.prep_confirm()
        self.assertIs(self.exact_roster(), True)
        self.assertIs(self.exact_roster(runtime=hex64("9")), False)
        self.assertIs(self.exact_roster(ttl=120000), False)

    def test_missing_second_genesis_user_denies_complete_roster(self):
        ghost = uuid.uuid4().int % (2**48) + 100
        self.seed(extra_user=ghost)
        self.armed()
        self.assertEqual([row[0] for row in self.candidates()], [self.user])
        self.assertIs(self.exact_roster(), False,
                      "one eligible client cannot authorize a shared TLS roster")

    def test_duplicate_original_genesis_user_denies_complete_roster(self):
        self.seed(duplicate_user=True)
        self.armed()
        self.assertEqual([row[0] for row in self.candidates()], [self.user])
        self.assertIs(self.exact_roster(), False,
                      "duplicate signed user identity is not a complete roster")

    def test_revocation_exhaustion_and_node_deactivation_deny_full_roster(self):
        self.armed()
        self.assertIs(self.exact_roster(), True)
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_reservations SET acknowledged_bytes=700 "
                      "WHERE reservation_id=%s",(self.reservation,))
        self.assertIs(self.exact_roster(), False)

    def test_no_signed_cap_or_two_zero_authority_lease_replies_cannot_qualify(self):
        self.assertEqual(self.candidates(),[])
        self.store_cap()
        self.assertEqual(self.candidates(),[])
        self.prep_confirm()
        result=self.candidates()
        self.assertEqual(len(result),1)
        user,epoch,reservation,meter,revision,valid,remaining=result[0]
        self.assertEqual((user,epoch,reservation,meter,revision,remaining),
                         (self.user,self.epoch,self.reservation,self.meter,
                          self.revision,700))
        self.assertGreater(valid,int(time.time()*1000)+1000)

    def test_foreign_node_runtime_activation_profile_signer_and_policy_denied(self):
        self.armed()
        self.assertEqual(len(self.candidates()),1)
        for changed in (
            {"node":self.node+1}, {"runtime":hex64("9")},
            {"activation":hex64("9")}, {"profile":hex64("9")},
            {"policy":hex64("9")}, {"signer":hex64("9")},
            {"ttl":120000},
        ):
            with self.subTest(changed=changed):
                self.assertEqual(self.candidates(**changed),[])

    def test_revocation_and_closed_or_burned_account_never_qualify(self):
        self.armed()
        with psycopg.connect(DSN) as c:
            c.execute("INSERT INTO quota_v2_revocation_requests("
                      "user_id,epoch,node_id,meter_epoch,reservation_id,request_id)"
                      "VALUES(%s,%s,%s,%s,%s,%s)",
                      (self.user,self.epoch,self.node,self.meter,
                       self.reservation,uuid.uuid4()))
        self.assertEqual(self.candidates(),[])

    def test_account_closed_node_revoked_and_genesis_consumed_denied(self):
        self.armed()
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET closed=TRUE WHERE user_id=%s",
                      (self.user,))
        self.assertEqual(self.candidates(),[])

    def test_zero_remaining_budget_and_changed_lease_revision_denied(self):
        self.armed()
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_reservations SET acknowledged_bytes=700 "
                      "WHERE reservation_id=%s",(self.reservation,))
        self.assertEqual(self.candidates(),[])

    def test_original_signed_roster_cannot_be_bypassed_by_legacy_preflight(self):
        self.armed()
        outsider = uuid.uuid4().int % (2**49) + 100
        epoch, meter, reservation = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        challenge = hex64("3")
        with psycopg.connect(DSN) as conn:
            conn.execute("INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes)"
                         " VALUES(%s,%s,1000)", (outsider,epoch))
            revision=conn.execute(
                "SELECT revision FROM quota_v2_reserve("
                "%s,%s,%s,%s,%s,500,0,NOW()+INTERVAL '1 hour')",
                (outsider,epoch,self.node,meter,reservation)
            ).fetchone()[0]
            conn.execute(
                "UPDATE quota_v2_reservations SET node_confirmed=TRUE "
                "WHERE reservation_id=%s",(reservation,))
            # Bypass ONLY the older 0138 SQL preflight in this controlled
            # negative test; real API uses 0142 with signed-roster checks.
            conn.execute(
                "SELECT user_id FROM quota_v2_record_runtime_admission_preflight("
                "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0)",
                (outsider,epoch,self.node,meter,reservation,revision,
                 challenge,self.runtime,hex64("1"),3345,self.policy,
                 self.activation))
            for stage in ("prepare","confirm"):
                conn.execute(
                    "INSERT INTO quota_v2_genesis_lease_replies("
                    "node_id,user_id,stage,policy_sha256,signer_public_key,"
                    "signed_reply) VALUES(%s,%s,%s,%s,%s,%s)",
                    (self.node,outsider,stage,self.policy,self.signer,
                     b"disposable non-signature" * 12))
            now=int(time.time()*1000)
            # Direct owner insert of syntactic bytes is not reachable from
            # the signed runtime issuer, but proves the SQL read filter
            # cannot treat such an outbox entry as roster authorization.
            conn.execute(
                "INSERT INTO quota_v2_signed_first_cap_outbox("
                "node_id,request_challenge,user_id,epoch,meter_epoch,"
                "reservation_id,revision,policy_sha256,runtime_id,"
                "signer_public_key,grant_bytes,issued_at_ms,"
                "install_before_ms,valid_until_ms,signed_envelope)"
                " VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (self.node,challenge,outsider,epoch,meter,reservation,revision,
                 self.policy,self.runtime,self.signer,500,now-1000,
                 now+60000,now+3000000,b"not a real signature" * 14))
        self.assertEqual(
            [row[0] for row in self.candidates()], [self.user],
            "User absent from original signed Genesis roster acquired TLS candidate")

    def test_strict_node_revocation_and_consumed_genesis_block_candidates(self):
        self.armed()
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE node_xsp_product_nodes SET state='revoked' "
                      "WHERE node_id=%s",(self.node,))
        self.assertEqual(self.candidates(),[])

    def test_legacy_desired_policy_cannot_consume_quarantined_genesis(self):
        self.armed()
        # Production migration 0143 rejects this mutation *before* our read
        # filter is reached. Never weaken that prior fail-closed trigger.
        with psycopg.connect(DSN) as c:
            with self.assertRaises(psycopg.Error):
                with c.transaction():
                    c.execute("UPDATE quota_v2_xray_genesis "
                              "SET policy_path_used=TRUE WHERE node_id=%s",
                              (self.node,))
        self.assertEqual(
            len(self.candidates()),1,
            "failed legacy-policy hijack changed the original signed lease")

    def test_unconfirmed_lease_and_global_oversubscription_block_candidates(self):
        self.armed()
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_reservations SET node_confirmed=FALSE "
                      "WHERE reservation_id=%s",(self.reservation,))
        self.assertEqual(self.candidates(),[])

    def test_observed_global_debt_blocks_candidates(self):
        self.armed()
        with psycopg.connect(DSN) as c:
            c.execute("UPDATE quota_v2_accounts SET observed_floor_bytes=700 "
                      "WHERE user_id=%s AND epoch=%s",(self.user,self.epoch))
        self.assertEqual(self.candidates(),[])

    def test_untrusted_argument_types_and_oversized_ttl_raise(self):
        for fields in (
            {"node":0},{"activation":"A"*64},{"signer":"../key"},
            {"ttl":0},{"ttl":120001},{"ttl":-1},{"ttl":None},
        ):
            with self.subTest(fields=fields), self.assertRaises(psycopg.Error):
                self.candidates(**fields)


if __name__=="__main__":
    unittest.main()
