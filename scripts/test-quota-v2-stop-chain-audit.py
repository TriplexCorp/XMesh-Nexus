#!/usr/bin/env python3
"""Cross-repository, independently implemented NONFINAL stop-chain verifier.

Uses the exactly pinned Node sources ONLY as the disposable test SIGNER. The
Nexus audit module does not import Node code, and deliberately cannot grant
terminal meter settlement or refunds.
"""
import copy
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = ROOT / ".ci-reviewed-node"
if not (NODE / "experiments/quota-v2-physical-stop/stop_chain.py").is_file():
    raise SystemExit("Checkout the immutable reviewed Node test fixture first")
sys.path.insert(0, str(NODE / "experiments/quota-v2-physical-stop"))
import stop_chain as node_stop
import sign_observation as node_observed

SPEC = importlib.util.spec_from_file_location(
    "nexus_independent_stop_chain_audit",
    ROOT / "scripts/quota_v2_stop_chain_audit.py")
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)

SCOPE = {
    "nodeId": 27, "userId": 101,
    "epoch": "11111111-1111-4111-8111-111111111111",
    "meterEpoch": "22222222-2222-4222-8222-222222222222",
    "reservationId": "33333333-3333-4333-8333-333333333333",
    "revision": 7,
    "revocationId": "44444444-4444-4444-8444-444444444444",
}


class IndependentStopAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="xmesh-audit-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.key = self.root / "signed-node.key"
        self.pub = self.root / "enrolled-node.pub"
        subprocess.run(
            ["openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(self.key)],
            check=True, capture_output=True)
        os.chmod(self.key, 0o600)
        subprocess.run(
            ["openssl", "pkey", "-in", str(self.key),
             "-pubout", "-out", str(self.pub)],
            check=True, capture_output=True)
        self.observation, self.stop = self.issue()

    def sign(self, payload, domain):
        return {
            "algorithm": "Ed25519",
            "payload": payload,
            "signature": node_observed.sign_bytes(
                self.key, domain + node_observed.canonical(payload)),
        }

    def raw(self, envelope):
        return node_observed.canonical(envelope) + b"\n"

    def issue(self):
        cp = {
            "schemaVersion": 3,
            **SCOPE,
            "email": "xmesh-u101--vless-main",
            "runtimeId": "d"*64,
            "uplinkBytes": 100, "downlinkBytes": 40,
            "inboundMeters": [
                {"email": "xmesh-u101--vless-cdn",
                 "uplinkBytes": 70, "downlinkBytes": 10},
                {"email": "xmesh-u101--vless-main",
                 "uplinkBytes": 30, "downlinkBytes": 30},
            ],
            "drained": True, "finalMeterVerified": False,
            "refundableBytes": 0,
        }
        op = {
            "schemaVersion": 2, "kind": node_observed.KIND,
            "nodeId": SCOPE["nodeId"],
            "checkpoint": cp,
            "checkpointSha256": hashlib.sha256(
                node_observed.canonical(cp)).hexdigest(),
            "boundToCommittedPolicy": True,
            "completeSignedInboundScopeObserved": True,
            "liveRuntimeIndependentlyVerified": True,
            "monotonicLedgerFloorVerified": True,
            "durableAbsoluteFloorBytes": 123,
            "finalMeterVerified": False,
            "settlementEligible": False,
            "refundableBytes": 0,
        }
        observation = self.sign(op, node_observed.DOMAIN)
        original_raw = self.raw(observation)
        sp = {
            "schemaVersion": 1, "kind": node_stop.KIND,
            **SCOPE,
            "observationSha256": hashlib.sha256(original_raw).hexdigest(),
            "checkpointSha256": op["checkpointSha256"],
            "oldRuntimeId": cp["runtimeId"],
            "oldContainerId": "a"*64,
            "oldStartedAt": "2026-11-18T14:10:00Z",
            "oldPidfdExited": True,
            "managedContainerStopped": True,
            "restartDisabled": True,
            "durableDenyArmed": True,
            "finalMeterVerified": False,
            "settlementEligible": False,
            "refundableBytes": 0,
        }
        stop = self.sign(sp, node_stop.DOMAIN)
        # The real pinned Node's cryptographic parser must also accept the
        # synthetic issuer fixture; Nexus's verifier below is INDEPENDENT.
        node_stop.verify_stop_chain(
            stop, original_raw, SCOPE["nodeId"], self.pub)
        return observation, stop

    def check(self, observation=None, stop=None, expected=None):
        return audit.verify_nonfinal_stop_chain(
            self.raw(self.observation if observation is None else observation),
            self.raw(self.stop if stop is None else stop),
            self.pub, SCOPE if expected is None else expected)

    def test_exact_signed_main_cdn_nonfinal_chain_authenticates(self):
        verified = self.check()
        self.assertTrue(verified["authenticatedSignedReservation"])
        self.assertTrue(verified["nodeAttestedOldPidfdExit"])
        self.assertEqual(verified["observedRawBytesForAudit"], 140)
        self.assertEqual(verified["durableAbsoluteFloorBytesForAudit"], 123)
        self.assertFalse(verified["finalMeterVerified"])
        self.assertFalse(verified["settlementEligible"])
        self.assertEqual(verified["refundableBytes"], 0)

    def test_even_genuine_signed_node_cannot_claim_final_or_refund(self):
        for key, value in (
            ("finalMeterVerified", True),
            ("settlementEligible", True),
            ("refundableBytes", 1),
            ("oldPidfdExited", False),
            ("durableDenyArmed", False),
            ("restartDisabled", False),
            ("managedContainerStopped", False),
        ):
            stop = copy.deepcopy(self.stop)
            stop["payload"][key] = value
            stop = self.sign(stop["payload"], node_stop.DOMAIN)
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.check(stop=stop)
        for key, value in (
            ("finalMeterVerified", True),
            ("settlementEligible", True),
            ("refundableBytes", 1),
            ("monotonicLedgerFloorVerified", False),
        ):
            obs = copy.deepcopy(self.observation)
            obs["payload"][key] = value
            obs = self.sign(obs["payload"], node_observed.DOMAIN)
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.check(observation=obs)

    def test_independent_trusted_database_scope_is_mandatory(self):
        for key, value in (
            ("nodeId", 2), ("userId", 102),
            ("epoch", "55555555-5555-4555-8555-555555555555"),
            ("meterEpoch", "55555555-5555-4555-8555-555555555555"),
            ("reservationId", "55555555-5555-4555-8555-555555555555"),
            ("revocationId", "55555555-5555-4555-8555-555555555555"),
            ("revision", 8),
        ):
            expected = dict(SCOPE, **{key: value})
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.check(expected=expected)

    def test_forged_signature_wrong_key_and_swapped_receipt_denied(self):
        obs = copy.deepcopy(self.observation)
        obs["signature"] = "f"*128
        with self.assertRaises(ValueError):
            self.check(observation=obs)
        stop = copy.deepcopy(self.stop)
        stop["signature"] = "f"*128
        with self.assertRaises(ValueError):
            self.check(stop=stop)
        alt = self.root / "foreign.key"
        alt_pub = self.root / "foreign.pub"
        subprocess.run(["openssl", "genpkey", "-algorithm", "Ed25519",
                        "-out", str(alt)], check=True, capture_output=True)
        subprocess.run(["openssl", "pkey", "-in", str(alt),
                        "-pubout", "-out", str(alt_pub)],
                       check=True, capture_output=True)
        with self.assertRaises(ValueError):
            audit.verify_nonfinal_stop_chain(
                self.raw(self.observation), self.raw(self.stop),
                alt_pub, SCOPE)
        original = self.raw(self.observation)
        tampered = original[:-1] + b" "
        with self.assertRaises(ValueError):
            audit.verify_nonfinal_stop_chain(
                tampered, self.raw(self.stop), self.pub, SCOPE)
        with self.assertRaises(ValueError):
            audit.verify_nonfinal_stop_chain(
                original + b"\n", self.raw(self.stop), self.pub, SCOPE)

    def test_signed_runtime_or_receipt_binding_forgery_rejected(self):
        for field, value in (
            ("observationSha256", "f"*64),
            ("checkpointSha256", "f"*64),
            ("oldRuntimeId", "f"*64),
            ("nodeId", 9999),
            ("reservationId", "55555555-5555-4555-8555-555555555555"),
        ):
            stop = copy.deepcopy(self.stop)
            stop["payload"][field] = value
            stop = self.sign(stop["payload"], node_stop.DOMAIN)
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.check(stop=stop)

    def test_signed_omitted_cdn_counter_and_overflow_rejected(self):
        for transformation in (
            lambda cp: cp["inboundMeters"].pop(0),
            lambda cp: cp["inboundMeters"].append(copy.deepcopy(
                cp["inboundMeters"][0])),
            lambda cp: cp["inboundMeters"][0].update(uplinkBytes=2**63),
            lambda cp: cp["inboundMeters"].reverse(),
        ):
            observation = copy.deepcopy(self.observation)
            transformation(observation["payload"]["checkpoint"])
            observation["payload"]["checkpointSha256"] = hashlib.sha256(
                node_observed.canonical(
                    observation["payload"]["checkpoint"])).hexdigest()
            observation = self.sign(observation["payload"],
                                    node_observed.DOMAIN)
            with self.assertRaises(ValueError):
                self.check(observation=observation)

    def test_critical_json_parsing_rejects_duplicate_and_noncanonical(self):
        raw_observation = self.raw(self.observation)
        raw_stop = self.raw(self.stop)
        invalid = (
            raw_stop.replace(b'"algorithm":', b'"algorithm":"Ed25519","algorithm":', 1),
            raw_stop.replace(b'"nodeId":27', b'"nodeId":27.0', 1),
            raw_stop + b" ",
        )
        for raw in invalid:
            with self.subTest(invalid=raw[:30]), self.assertRaises(ValueError):
                audit.verify_nonfinal_stop_chain(
                    raw_observation, raw, self.pub, SCOPE)


if __name__ == "__main__":
    unittest.main()
