#!/usr/bin/env python3
"""Disposable cross-repo Node Ed25519 WAL witness -> Nexus PostgreSQL anchor.

Genuine published Node CI-only producer signs synthetic Go-format Xray WAL
birth-index evidence. Nexus independently validates the Node signature and
every index byte (no Node verifier imported into Nexus trust path), commits
full prefix to disposable PostgreSQL, then signs ACK after COMMIT.
No production API/gate or refund.
"""
import concurrent.futures
import copy
import importlib.util
import itertools
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import psycopg

ROOT=Path(__file__).resolve().parents[1]
NODE=ROOT/".ci-reviewed-node"
DSN=os.environ["QUOTA_TEST_DSN"]
assert os.environ.get("XMESH_AUDIT_DISPOSABLE")=="1"
assert DSN.startswith("postgresql://quota_test:")
if not (NODE/"experiments/quota-v2-physical-stop/witness_inventory.py").is_file():
    raise SystemExit("Pinned, reviewed Node off-host WAL witness producer is required")
sys.path.insert(0,str(NODE/"tests"))
sys.path.insert(0,str(NODE/"experiments/quota-v2-physical-stop"))
sys.path.insert(0,str(NODE/"experiments/xray-dataplane-fence"))
import witness_inventory as producer
import verify_nexus_wal_anchor as node_verifier
import quota_v2_meter_wal_fixture as wal_fixture
from test_quota_v2_stop_chain import StopChainTests

SPEC=importlib.util.spec_from_file_location(
    "independent_nexus_wal_verifier",
    ROOT/"scripts/quota_v2_external_wal_witness.py")
nexus=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(nexus)

# Each disposable test uses a distinct signed Node identity: never erase
# previous off-host evidence just to obtain a clean test database.
NODE_IDS=itertools.count(500000)


class RemoteWalWitnessTests(unittest.TestCase):
    def setUp(self):
        self.fx=StopChainTests("test_unrelated_user_wal_does_not_block_signed_account_stop")
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.node=next(NODE_IDS)
        self.node_pub=self.fx.pub
        self.raw_signed,self.raw_index=self.snapshot()
        self.temp=tempfile.TemporaryDirectory(prefix="xmesh-nexus-external-wal-")
        self.addCleanup(self.temp.cleanup)
        tmp=Path(self.temp.name)
        self.nexus_key=tmp/"nexus.key"
        self.nexus_pub=tmp/"nexus.pub"
        subprocess.run(["openssl","genpkey","-algorithm","Ed25519",
                        "-out",str(self.nexus_key)],check=True,capture_output=True)
        self.nexus_key.chmod(0o600)
        subprocess.run(["openssl","pkey","-in",str(self.nexus_key),"-pubout",
                        "-out",str(self.nexus_pub)],check=True,capture_output=True)

    def snapshot(self):
        return producer.produce_witness(
            self.node,self.fx.before,str(self.fx.xray),self.fx.key,self.node_pub)

    def verified(self,document=None,raw=None,**changes):
        return nexus.verify_signed_node_birth_witness(
            self.raw_signed if document is None else document,
            self.raw_index if raw is None else raw,
            changes.get("node",self.node),
            changes.get("key",self.node_pub))

    def record(self,document=None,raw=None,**changes):
        with psycopg.connect(DSN,autocommit=True) as db:
            return nexus.commit_external_index(
                db,self.raw_signed if document is None else document,
                self.raw_index if raw is None else raw,
                changes.get("node_pub",self.node_pub),
                changes.get("node",self.node),
                changes.get("nexus_key",self.nexus_key),
                changes.get("nexus_pub",self.nexus_pub))

    def rows(self):
        with psycopg.connect(DSN) as db:
            return db.execute(
                "SELECT inventory_sequence,inventory_sha256,"
                "inventory_tail_digest,original_node_witness_sha256,"
                "inventory_bytes,first_external_witness "
                "FROM quota_v2_external_wal_birth_anchors "
                "WHERE node_id=%s ORDER BY inventory_sequence",
                (self.node,)).fetchall()

    def next_snapshot(self):
        cp=copy.deepcopy(self.fx.cp)
        cp["runtimeId"]="f"*64
        cp["userId"]=102
        cp["email"]="xmesh-u102--vless-cdn"
        cp["inboundMeters"]=[
            {"email":cp["email"],"uplinkBytes":3,"downlinkBytes":11}]
        wal_fixture.write_test_meter_intents(cp,self.fx.xray)
        return self.snapshot()

    def read_current_head(self):
        with psycopg.connect(DSN) as db:
            sequence, registry_sha256, registry = db.execute(
                "SELECT inventory_sequence,inventory_sha256,inventory_bytes "
                "FROM quota_v2_external_wal_birth_anchors "
                "WHERE node_id=%s ORDER BY inventory_sequence DESC LIMIT 1",
                (self.node,)).fetchone()
        return {"sequence":sequence,"registrySha256":registry_sha256}, bytes(registry)

    def test_node_verifies_real_nexus_receipt_against_independent_postgres_head(self):
        first_receipt=self.record()
        first_head,first_registry=self.read_current_head()
        doc2,raw2=self.next_snapshot()
        second_receipt=self.record(doc2,raw2)
        current_head,current_registry=self.read_current_head()
        self.assertGreater(current_head["sequence"],first_head["sequence"])

        def verify(receipt, witness, registry, head):
            return node_verifier.verify_nexus_offhost_anchor(
                receipt,witness,registry,self.node,self.node_pub,self.nexus_pub,
                head,str(self.fx.xray))

        # The older receipt still has a valid signature and complete bytes.
        # It cannot serve as the current checkpoint after the registry grows.
        self.assertTrue(verify(
            first_receipt,self.raw_signed,first_registry,first_head
        )["offhostFullBirthIndexHeadMatched"])
        with self.assertRaisesRegex(ValueError,"stale Nexus anchor"):
            verify(first_receipt,self.raw_signed,first_registry,current_head)
        proof=verify(second_receipt,doc2,current_registry,current_head)
        self.assertTrue(proof["offhostFullBirthIndexHeadMatched"])
        self.assertTrue(proof["nodeLocalIndexExtendsNexusHead"])
        self.assertFalse(proof["canResume"])
        self.assertFalse(proof["carryforwardApplied"])
        self.assertFalse(proof["finalMeterVerified"])
        self.assertEqual(proof["refundableBytes"],0)

        (self.fx.xray/"xmesh-meter-inventory-v1.jsonl").unlink()
        for file in self.fx.xray.glob("meter-*.jsonl"):
            file.unlink()
        with self.assertRaisesRegex(ValueError,"rolled back"):
            verify(second_receipt,doc2,current_registry,current_head)

    def test_genuine_node_births_are_canonical_and_committed_before_nexus_signature(self):
        checked=self.verified()
        self.assertTrue(checked["fullIndexSignatureVerified"])
        self.assertFalse(checked["remoteWALBytesIndependentlyRead"])
        self.assertFalse(checked["canResume"])
        self.assertEqual(checked["inventorySequence"],2)
        signed_receipt=self.record()
        ack=nexus.verify_nexus_committed_birth_ack(
            signed_receipt,self.raw_signed,self.raw_index,self.node,
            self.node_pub,self.nexus_pub)
        self.assertTrue(ack["nexusSignedExternalBirthIndex"])
        self.assertTrue(ack["externalFirstWitnessBootstrapOnly"])
        self.assertFalse(ack["canResume"])
        self.assertFalse(ack["finalMeterVerified"])
        self.assertEqual(ack["refundableBytes"],0)
        saved=self.rows()
        self.assertEqual(len(saved),1)
        self.assertEqual(bytes(saved[0][4]),self.raw_index)
        self.assertEqual(saved[0][0],2)
        self.assertTrue(saved[0][5])
        # Retry is identical, including signed bytes and database record.
        self.assertEqual(self.record(),signed_receipt)
        self.assertEqual(self.rows(),saved)

    def test_deleting_all_local_wal_and_birth_index_is_detected_by_remote_snapshot(self):
        receipt=self.record()
        saved_registry=bytes(self.rows()[0][4])
        self.assertEqual(saved_registry,self.raw_index)
        self.assertTrue(nexus.verify_nexus_committed_birth_ack(
            receipt,self.raw_signed,saved_registry,self.node,
            self.node_pub,self.nexus_pub)["nexusSignedExternalBirthIndex"])
        (self.fx.xray/"xmesh-meter-inventory-v1.jsonl").unlink()
        for file in self.fx.xray.glob("meter-*.jsonl"):
            file.unlink()
        with self.assertRaisesRegex(ValueError,"rolled back"):
            producer.verify_local_against_remote_prefix(
                str(self.fx.xray),saved_registry,self.node,
                self.raw_signed,self.node_pub)
        # The off-host PostgreSQL row remains immutable and intact.
        self.assertEqual(bytes(self.rows()[0][4]),saved_registry)

    def test_next_snapshot_extends_exact_prior_bytes_not_only_count(self):
        first=self.record()
        doc2,raw2=self.next_snapshot()
        self.assertEqual(self.verified(doc2,raw2)["inventorySequence"],4)
        self.assertTrue(raw2.startswith(self.raw_index))
        second=self.record(doc2,raw2)
        second_ack=nexus.verify_nexus_committed_birth_ack(
            second,doc2,raw2,self.node,self.node_pub,self.nexus_pub)
        self.assertFalse(second_ack["externalFirstWitnessBootstrapOnly"])
        saved=self.rows()
        self.assertEqual(len(saved),2)
        self.assertEqual([a[0] for a in saved],[2,4])
        self.assertEqual(bytes(saved[1][4]),raw2)
        # Old signed witness still authenticates the original prefix:
        self.assertTrue(nexus.verify_nexus_committed_birth_ack(
            first,self.raw_signed,self.raw_index,self.node,
            self.node_pub,self.nexus_pub)["nexusSignedExternalBirthIndex"])

    def test_eight_concurrent_identical_node_witnesses_create_one_db_row(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda _:self.record(),range(8)))
        self.assertEqual(len(set(results)),1)
        self.assertEqual(len(self.rows()),1)

    def test_eight_competing_conflicting_second_snapshots_cannot_fork_history(self):
        self.record()
        doc2,raw2=self.next_snapshot()
        # Direct SQL owner cannot bypass the FULL previous content prefix
        # (although direct owner has no signature-verification privilege).
        bad=bytearray(raw2)
        bad[0]=ord("Z") if bad[0]!=ord("Z") else ord("Y")
        forged=bytes(bad)
        sha=nexus.hashlib.sha256(forged).hexdigest()
        wrong=(
            self.node,4,sha,"f"*64,"a"*64,"c"*64,
            "2026-11-18T14:10:00Z",forged)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            def attempt(_):
                with psycopg.connect(DSN,autocommit=True) as db:
                    return db.execute(
                        "SELECT * FROM quota_v2_store_external_wal_birth_anchor("
                        "%s,%s,%s,%s,%s,%s,%s,%s)",wrong).fetchone()
            for future in [pool.submit(attempt,i) for i in range(8)]:
                with self.assertRaises(psycopg.Error) as exc:
                    future.result()
                self.assertEqual(exc.exception.sqlstate,"22023")
        self.assertEqual(len(self.rows()),1)
        second=self.record(doc2,raw2)
        self.assertTrue(second)
        self.assertEqual(len(self.rows()),2)

    def test_drop_both_last_entries_cannot_claim_rolled_back_prefix(self):
        first=self.record()
        doc2,raw2=self.next_snapshot()
        self.record(doc2,raw2)
        # Signed earlier source is still valid crypto, but persistence has
        # advanced to 4: inserting the stale 2-entry payload as latest
        # must NEVER let it replace the newer remote stored head.
        with psycopg.connect(DSN,autocommit=True) as db:
            raw_doc=self.verified()
            with self.assertRaises(psycopg.Error) as exc:
                db.execute("SELECT * FROM quota_v2_store_external_wal_birth_anchor("
                           "%s,%s,%s,%s,%s,%s,%s,%s)",
                           (self.node,2,raw_doc["inventorySha256"],
                            raw_doc["inventoryTailDigest"],
                            raw_doc["originalNodeWitnessSha256"],
                            raw_doc["oldContainerId"],raw_doc["oldStartedAt"],
                            self.raw_index))
            self.assertEqual(exc.exception.sqlstate,"22023")
        self.assertEqual([r[0] for r in self.rows()],[2,4])

    def test_noncanonical_index_duplicate_birthing_and_invalid_claims_rejected(self):
        for invalid in (
            self.raw_index[:-1],
            self.raw_index+b"\n",
            self.raw_index.replace(b'"sequence":1',b'"sequence":2',1),
            self.raw_index.replace(b'"schemaVersion":1',
                                   b'"schemaVersion":1,"schemaVersion":1',1),
            self.raw_index.replace(b'"firstWalDigest":',
                                   b'"firstWalDigest":"f"*32,"firstWalDigest":',1),
        ):
            with self.subTest(prefix=invalid[:32]),self.assertRaises(ValueError):
                self.verified(raw=invalid)
        for field,value in (
            ("canResume",True),("finalMeterVerified",True),
            ("refundableBytes",10),("refundableBytes",False),
            ("nexusPersisted",True),("inventorySequence",3),
            ("inventoryTailDigest","a"*64),("oldContainerId","b"*64),
            ("inventorySha256","f"*64),
        ):
            with self.subTest(field=field,value=value):
                import sign_observation as node_sign
                original=node_sign.strict_json(self.raw_signed)
                original["payload"][field]=value
                forged=node_sign.canonical(original)+b"\n"
                with self.assertRaises(ValueError):
                    self.verified(document=forged)

    def test_foreign_signer_node_id_and_nexus_signing_key_denied(self):
        with self.assertRaises(ValueError):
            self.verified(node=100)
        wrong=Path(self.temp.name)/"wrong.key"
        wrong_pub=Path(self.temp.name)/"wrong.pub"
        subprocess.run(["openssl","genpkey","-algorithm","Ed25519",
                        "-out",str(wrong)],check=True,capture_output=True)
        subprocess.run(["openssl","pkey","-in",str(wrong),"-pubout",
                        "-out",str(wrong_pub)],check=True,capture_output=True)
        with self.assertRaises(ValueError):
            self.verified(key=wrong_pub)
        with self.assertRaises(ValueError):
            self.record(nexus_pub=wrong_pub)
        self.nexus_key.chmod(0o644)
        with self.assertRaisesRegex(ValueError,"unsafe Nexus"):
            self.record()

    def test_cannot_sign_uncommitted_or_rolled_back_postgres_witness(self):
        with psycopg.connect(DSN,autocommit=False) as db:
            with self.assertRaisesRegex(ValueError,"autocommit"):
                nexus.commit_external_index(
                    db,self.raw_signed,self.raw_index,self.node_pub,self.node,
                    self.nexus_key,self.nexus_pub)
        self.assertEqual(self.rows(),[])
        with psycopg.connect(DSN,autocommit=True) as db:
            with db.transaction(force_rollback=True):
                with self.assertRaisesRegex(ValueError,"idle autocommit"):
                    nexus.commit_external_index(
                        db,self.raw_signed,self.raw_index,self.node_pub,self.node,
                        self.nexus_key,self.nexus_pub)
        self.assertEqual(self.rows(),[])
        with self.assertRaises(RuntimeError):
            with psycopg.connect(DSN) as db:
                v=self.verified()
                db.execute("SELECT * FROM quota_v2_store_external_wal_birth_anchor("
                           "%s,%s,%s,%s,%s,%s,%s,%s)",
                           (self.node,v["inventorySequence"],v["inventorySha256"],
                            v["inventoryTailDigest"],
                            v["originalNodeWitnessSha256"],
                            v["oldContainerId"],v["oldStartedAt"],self.raw_index))
                raise RuntimeError("power failure before database commit")
        self.assertEqual(self.rows(),[])
        receipt=self.record()
        self.assertEqual(len(self.rows()),1)
        self.assertEqual(self.record(),receipt)

    def test_database_owner_cannot_delete_or_rewrite_remote_index(self):
        self.record()
        old=self.rows()
        for sql in (
            "DELETE FROM quota_v2_external_wal_birth_anchors",
            "TRUNCATE quota_v2_external_wal_birth_anchors",
            "UPDATE quota_v2_external_wal_birth_anchors "
            "SET inventory_sequence=1",
        ):
            with self.subTest(sql=sql),self.assertRaises(psycopg.Error) as exc:
                with psycopg.connect(DSN) as db:
                    db.execute(sql)
            self.assertEqual(exc.exception.sqlstate,"22023")
        self.assertEqual(self.rows(),old)


if __name__=="__main__":
    unittest.main()
