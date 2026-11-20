#!/usr/bin/env python3
"""Cross-repository signed conservative rollover: Node signer, Nexus verifier.

Nexus uses ONLY its own implementation for trust checks. The exactly pinned
Node code is used exclusively as a disposable signature fixture. A valid
prepare never moves SQL bytes, unblocks Xray or grants a refund.
"""
import copy
import hashlib
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
NODE=ROOT/".ci-reviewed-node"
if not (NODE/"experiments/quota-v2-physical-stop/rollover_prepare.py").is_file():
    raise SystemExit("Checked-out exact reviewed XMesh-Node rollover signer required")
sys.path.insert(0,str(NODE/"experiments/quota-v2-physical-stop"))
import rollover_prepare as node_rollover
import sign_observation as node_observed
import stop_chain as node_stop

SPEC=importlib.util.spec_from_file_location(
    "nexus_rollover_auditor", ROOT/"scripts/quota_v2_rollover_audit.py")
audit=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)

FIX=importlib.util.spec_from_file_location(
    "nexus_signed_stop_fixture", ROOT/"scripts/test-quota-v2-stop-chain-audit.py")
fixtures=importlib.util.module_from_spec(FIX)
FIX.loader.exec_module(fixtures)


class IndependentRolloverAuditTests(unittest.TestCase):
    def setUp(self):
        self.fx=fixtures.IndependentStopAuditTests(
            "test_exact_signed_main_cdn_nonfinal_chain_authenticates")
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.old_hash=fixtures.EXPECTED_OLD_WAL_SHA256
        self.raw_obs=self.fx.raw(self.fx.observation)
        self.raw_stop=self.fx.raw(self.fx.stop)
        self.cp=self.fx.observation["payload"]["checkpoint"]
        self.proposal=self.issue()

    def issue(self,payload=None):
        if payload is None:
            payload=node_rollover._build_payload(
                self.cp,self.fx.observation,self.fx.stop["payload"],
                self.raw_obs,self.raw_stop,self.old_hash)
        envelope=self.fx.sign(payload,node_rollover.DOMAIN)
        # Node itself agrees the offline *prepare* shape, but gives NO
        # operational authorization. Nexus verifier below is independent.
        node_rollover.verify_rollover_proposal(
            envelope,self.raw_obs,self.raw_stop,fixtures.SCOPE["nodeId"],
            self.fx.pub,self.old_hash)
        return envelope

    def check(self,proposal=None,**kwargs):
        return audit.verify_nonfinal_rollover_prepare(
            kwargs.get("observation",self.raw_obs),
            kwargs.get("stop",self.raw_stop),
            self.fx.raw(self.proposal if proposal is None else proposal),
            kwargs.get("pub",self.fx.pub),
            kwargs.get("scope",fixtures.SCOPE),
            kwargs.get("roster",fixtures.EXPECTED_INBOUND_ROSTER),
            kwargs.get("hash",self.old_hash))

    def test_real_node_signed_proposal_matches_independent_nexus_audit(self):
        result=self.check()
        self.assertTrue(result["authenticatedSignedReservation"])
        self.assertTrue(result["nodePreparedConservativeRollover"])
        self.assertTrue(result["sourceStopAndObservationSignaturesVerified"])
        self.assertTrue(result["sourceJournalHashMatchedIndependentInput"])
        self.assertEqual(result["nodeDurableAbsoluteFloorBytesForAudit"],123)
        self.assertEqual(result["oldRuntimeObservedBytesForAudit"],140)
        self.assertEqual(result["proposalSha256"],
                         hashlib.sha256(self.fx.raw(self.proposal)).hexdigest())
        # 123+140 is a DOUBLE COUNT: Node absolute can already contain
        # some/all of Xray's old raw bytes.
        self.assertNotIn("appliedAbsoluteBytes",result)
        for marker in ("canApplyRollover","nexusAcknowledged",
                       "finalMeterVerified","settlementEligible"):
            self.assertIs(result[marker],False)
        self.assertEqual(result["refundableBytes"],0)

    def test_even_valid_node_key_may_not_authorize_or_repay_via_prepare(self):
        for key,value in (
            ("absoluteCarryforwardVerified",True),
            ("nexusAcknowledged",True),
            ("rolloverAuthorized",True),
            ("finalMeterVerified",True),
            ("settlementEligible",True),
            ("refundableBytes",1),
            ("absoluteCarryforwardVerified",0),
            ("rolloverAuthorized",0),
            ("schemaVersion",2),
        ):
            with self.subTest(key=key,value=value):
                forged=copy.deepcopy(self.proposal)
                forged["payload"][key]=value
                forged=self.fx.sign(forged["payload"],node_rollover.DOMAIN)
                with self.assertRaises(ValueError):
                    self.check(proposal=forged)

    def test_signed_missing_cdn_and_modified_raw_bytes_denied(self):
        for change in (
            lambda p: p["inboundMeters"].pop(0),
            lambda p: p["inboundMeters"].reverse(),
            lambda p: p["inboundMeters"][0].update(uplinkBytes=71),
            lambda p: p.update(oldRuntimeObservedDownlinkBytes=500),
            lambda p: p.update(nodeDurableAbsoluteFloorBytes=140),
            lambda p: p.update(oldContainerId="a"*64),
            lambda p: p.update(oldRuntimeId="a"*64),
            lambda p: p.update(oldStartedAt="2026-11-19T10:00:00Z"),
            lambda p: p.update(stopChainSha256="0"*64),
            lambda p: p.update(observationSha256="f"*64),
            lambda p: p.update(xrayJournalSha256="0"*64),
            lambda p: p.update(unrecognizedApproval=True),
        ):
            with self.subTest(mutation=str(change)):
                p=copy.deepcopy(self.proposal["payload"])
                change(p)
                forged=self.fx.sign(p,node_rollover.DOMAIN)
                with self.assertRaises(ValueError):
                    self.check(proposal=forged)

    def test_independently_selected_db_reservation_and_roster_required(self):
        for key,value in (
            ("nodeId",45),("userId",102),("revision",8),
            ("epoch","55555555-5555-4555-8555-555555555555"),
            ("meterEpoch","55555555-5555-4555-8555-555555555555"),
            ("reservationId","55555555-5555-4555-8555-555555555555"),
            ("revocationId","55555555-5555-4555-8555-555555555555"),
        ):
            with self.subTest(field=key),self.assertRaises(ValueError):
                self.check(scope=dict(fixtures.SCOPE,**{key:value}))
        for roster in ([],fixtures.EXPECTED_INBOUND_ROSTER[:1],
                       tuple(reversed(fixtures.EXPECTED_INBOUND_ROSTER)),
                       ("xmesh-u102--vless-main",),):
            with self.subTest(roster=roster),self.assertRaises(ValueError):
                self.check(roster=roster)
        with self.assertRaises(TypeError):
            audit.verify_nonfinal_rollover_prepare(
                self.raw_obs,self.raw_stop,self.fx.raw(self.proposal),
                self.fx.pub,fixtures.SCOPE,fixtures.EXPECTED_INBOUND_ROSTER)

    def test_wrong_independent_wal_source_or_missing_fingerprint_denied(self):
        for sha in ("0"*64,None,"f",123):
            with self.subTest(value=sha),self.assertRaises(ValueError):
                self.check(hash=sha)

    def test_source_observation_or_signed_stop_replacement_denied(self):
        wrong=copy.deepcopy(self.fx.stop)
        wrong["payload"]["xrayJournalSha256"]="e"*64
        wrong=self.fx.sign(wrong["payload"],node_stop.DOMAIN)
        with self.assertRaises(ValueError):
            self.check(stop=self.fx.raw(wrong))
        for key in ("observation","stop"):
            data=self.raw_obs if key=="observation" else self.raw_stop
            with self.assertRaises(ValueError):
                self.check(**{key:data[:-1]+b" "})
        wrong=copy.deepcopy(self.fx.observation)
        wrong["signature"]="0"*128
        with self.assertRaises(ValueError):
            self.check(observation=self.fx.raw(wrong))

    def test_foreign_node_pub_or_domain_confusion_denied(self):
        corrupt=copy.deepcopy(self.proposal)
        corrupt["signature"]="f"*128
        with self.assertRaises(ValueError):
            self.check(proposal=corrupt)
        # Real Node signed bytes under STOP domain cannot be promoted to
        # Nexus rollover even if all the fields are otherwise valid.
        cross=self.fx.sign(self.proposal["payload"],node_stop.DOMAIN)
        with self.assertRaises(ValueError):
            self.check(proposal=cross)

    def test_noncanonical_or_duplicate_fields_cannot_pass_nexus_parser(self):
        raw=self.fx.raw(self.proposal)
        for invalid in (raw+b"\n",raw[:-1]+b" ",
                        raw.replace(b'"algorithm":',b'"algorithm":"Ed25519","algorithm":',1),
                        raw.replace(b'"schemaVersion":1',b'"schemaVersion":1.0',1)):
            with self.subTest(data=invalid[:25]),self.assertRaises(ValueError):
                audit.verify_nonfinal_rollover_prepare(
                    self.raw_obs,self.raw_stop,invalid,self.fx.pub,
                    fixtures.SCOPE,fixtures.EXPECTED_INBOUND_ROSTER,self.old_hash)

    def test_v1_unbound_stop_chain_does_not_allow_preparing_rollover(self):
        legacy=copy.deepcopy(self.fx.stop)
        legacy["payload"]["schemaVersion"]=1
        legacy["payload"].pop("xrayJournalSha256")
        legacy=self.fx.sign(legacy["payload"],node_stop.DOMAIN)
        with self.assertRaises(ValueError):
            self.check(stop=self.fx.raw(legacy))


if __name__=="__main__":
    unittest.main()
