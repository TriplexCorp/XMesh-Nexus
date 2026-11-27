#!/usr/bin/env python3
"""Independent detached-signature contract tests with real OpenSSL keys."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from quota_v2_retirement_possession import DOMAIN, ED25519_SPKI, expected_claim, verify_possession
from quota_v2_retirement_evidence import canonical, sha
from quota_v2_meter_patch_projection import NAMESPACE_ONLY, decode_tree, verify_projection


class PossessionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.key = self.root / "node.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519", "-out", self.key],
                       check=True, timeout=5)
        der = subprocess.check_output(["openssl", "pkey", "-in", self.key, "-pubout",
                                       "-outform", "DER"], timeout=5)
        self.assertEqual(der[:12], ED25519_SPKI)
        self.public, self.policy = der[12:], bytes.fromhex("42"*32)
        self.activation = "1"*64
        self.observation = dict(nodeId=17, runtimeId="2"*64,
                                signedWalReadbackSha256=sha(b"signed historical response"))
        self.witness = dict(nodeId=17, runtimeId="2"*64, activationReceiptSha256=self.activation,
                            issuedAtMs=1000, validUntilMs=5000)
        self.archive = canonical(dict(observation=self.observation,
                                      nexusResponse="signed historical response")) + b"\n"
        self.args = (self.archive, self.witness, self.observation, 17, self.activation,
                     self.public, self.policy)
        self.payload = expected_claim(*self.args)

    def signed(self, payload=None, domain=DOMAIN):
        if payload is None:
            payload = self.payload
        message = self.root / "message"
        message.write_bytes(domain + canonical(payload))
        signature = subprocess.check_output(["openssl", "pkeyutl", "-sign", "-rawin",
                                             "-inkey", self.key, "-in", message], timeout=5)
        return canonical(dict(algorithm="Ed25519", payload=payload, signature=signature.hex())) + b"\n"

    def test_reviewed_cross_language_vector(self):
        # The native-live workflow supplies the vector from the exact pinned
        # Node checkout; no Node implementation or private key is imported.
        vector_path = os.environ.get("XMESH_RETIREMENT_POSSESSION_VECTOR")
        if vector_path is None:
            self.skipTest("requires separately reviewed Node vector")
        vector = json.loads(Path(vector_path).read_bytes())
        archive = vector["archive"].encode()
        record = json.loads(archive)
        witness = json.loads(json.loads(record["nexusResponse"])["signedEnvelope"])["payload"]
        args = (archive, witness, record["observation"], vector["nodeId"],
                vector["activationReceiptSha256"], bytes.fromhex(vector["nodePublicKey"]),
                bytes.fromhex(vector["nexusPublicKey"]))
        payload = expected_claim(*args)
        self.assertEqual((DOMAIN + canonical(payload)).hex(), vector["messageHex"])
        raw = canonical(dict(algorithm="Ed25519", payload=payload, signature=vector["signature"])) + b"\n"
        self.assertEqual(verify_possession(raw, *args), payload)

    def test_exact_signature_is_possession_only(self):
        result = verify_possession(self.signed(), *self.args)
        self.assertIs(result["archivePossessionOnly"], True)
        self.assertIs(result["localObservationsVerified"], False)
        self.assertIs(result["deliveredBytesVerified"], False)
        self.assertIs(result["settlementEligible"], False)
        self.assertEqual(result["authorizedBytes"], 0)

    def test_even_correctly_signed_authority_or_mismatched_scope_rejected(self):
        cases = dict(nodeId=18, runtimeId="3"*64, archiveSha256="3"*64,
                     signedWalReadbackSha256="3"*64, nodePublicKey="3"*64, nexusPublicKey="3"*64,
                     activationReceiptSha256="3"*64, nexusIssuedAtMs=1001, nexusValidUntilMs=5001,
                     schemaVersion=True, refundableBytes=False, authorizedBytes=1,
                     archivePossessionOnly=False, localObservationsVerified=True,
                     deliveredBytesVerified=True, liveMeterVerified=True, finalMeterVerified=True,
                     settlementEligible=True, canStart=True, canResume=True, canSpend=True,
                     canServePublic=True)
        for key, value in cases.items():
            with self.subTest(key=key), self.assertRaises(AssertionError):
                verify_possession(self.signed(dict(self.payload, **{key: value})), *self.args)

    def test_wrong_key_domain_or_noncanonical_wire_rejected(self):
        raw = self.signed()
        malformed = [
            self.signed(domain=b"other\0"),
            raw.replace(b'"algorithm":', b'"algorithm":"Ed25519","algorithm":', 1),
            b" " + raw, raw[:-1], raw+b"\n",
            canonical(dict(json.loads(raw), signature="00"*64)) + b"\n",
        ]
        for item in malformed:
            with self.subTest(raw=item[:50]), self.assertRaises(AssertionError):
                verify_possession(item, *self.args)
        with self.assertRaises(AssertionError):
            # Re-sign an otherwise perfectly reconstructed claim with the wrong key.
            other_args = (*self.args[:5], bytes.fromhex("11"*32), self.policy)
            verify_possession(self.signed(expected_claim(*other_args)), *other_args)
        with self.assertRaises(AssertionError):
            verify_possession(raw, self.archive+b"\n", *self.args[1:])


class MeterPatchProjectionTests(unittest.TestCase):
    def test_exact_namespace_extension_only(self):
        base = {b"apply-experiment.py": b"100644 blob " + b"a"*40,
                b"meter.go.txt": b"100644 blob " + b"b"*40}
        extension = {**base, **{name: b"100644 blob " + b"c"*40 for name in NAMESPACE_ONLY}}
        verify_projection(extension, base)
        for bad in (
            {**extension, b"meter.go.txt": b"100644 blob " + b"d"*40},
            {**extension, b"meter.go.txt": b"100755 blob " + b"b"*40},
            {**extension, b"unexpected.py": b"100644 blob " + b"a"*40},
            {key: value for key, value in extension.items() if key != b"meter.go.txt"},
            {key: value for key, value in extension.items() if key != next(iter(NAMESPACE_ONLY))},
        ):
            with self.subTest(bad=bad), self.assertRaises(AssertionError):
                verify_projection(bad, base)

    def test_mode_duplicate_and_path_rejected(self):
        good = b"100644 blob " + b"a"*40 + b"\tbase.go.txt\0"
        self.assertEqual(set(decode_tree(good)), {b"base.go.txt"})
        for bad in (good+good, good[:-1], good.replace(b"100644", b"120000"),
                    good.replace(b"base.go.txt", b"dir/base.go.txt")):
            with self.assertRaises(AssertionError):
                decode_tree(bad)


if __name__ == "__main__":
    unittest.main()
