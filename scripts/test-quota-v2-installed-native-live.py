#!/usr/bin/env python3
"""Harness-only guards, exact phases and signed revocation wire proof."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import quota_v2_installed_native_live as live
import quota_v2_native_tls_guest as guest

ENV = {
    "GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
    "XMESH_AUDIT_DISPOSABLE": "1",
    "XMESH_RELEASE_QUALIFICATION_SCENARIO": "public-tls-native-live",
    "QUOTA_TEST_DSN": "postgresql://quota_test:disposable@127.0.0.1:5432/quota_wal_installed",
}

def canonical(doc):
    return json.dumps(doc, separators=(",", ":"), sort_keys=True).encode()

class Tests(unittest.TestCase):
    def test_harness_guard_refuses_other_scenarios_before_guest_changes(self):
        for key, value in (("GITHUB_ACTIONS", "false"), ("RUNNER_ENVIRONMENT", "self-hosted"),
                           ("XMESH_AUDIT_DISPOSABLE", "0"),
                           ("XMESH_RELEASE_QUALIFICATION_SCENARIO", "public-tls-namespace-candidate"),
                           ("QUOTA_TEST_DSN", "postgresql://quota_test:disposable@other:5432/quota_wal_installed")):
            with patch.dict(os.environ, {**ENV, key: value}, clear=True), self.assertRaises(AssertionError):
                live.prepare_live(None, None, "vless-main")
            with patch.dict(os.environ, {**ENV, key: value}, clear=True), self.assertRaises(AssertionError):
                live.fixture_authority(None, None, "vless-main")
        with patch.dict(os.environ, ENV, clear=True):
            live.require_live()

    def test_exact_marker_not_substring(self):
        child = subprocess.Popen([sys.executable,"-c",
            "print('native_tls_spent_fake'); print('native_tls_spent'); print('native_tls_guest_verified')"],
            stdout=subprocess.PIPE)
        try:
            live.wait_marker(child, b"native_tls_spent", 2)
            live.wait_marker(child, b"native_tls_guest_verified", 2)
        finally:
            child.wait(timeout=3)
            child.stdout.close()
        self.assertEqual(child.returncode, 0)

    def test_post_transfer_startup_wait_requires_core_ready_and_stable_threads(self):
        def launch(line):
            return subprocess.Popen([sys.executable,"-c",
                "import sys,time; print(sys.argv[1],flush=True); time.sleep(2)",line],
                stdout=subprocess.PIPE,text=True)
        marker = "2026/11/27 04:14:05.074571 [Warning] core: Xray 26.10.31 started"
        with launch(marker) as child:
            try:
                start = time.monotonic()
                guest.wait_native_started(child)
                self.assertGreaterEqual(time.monotonic()-start,0.15)
            finally:
                child.kill()
        with launch(marker+" fake") as child:
            try:
                with self.assertRaisesRegex(AssertionError,"missing native phase"):
                    guest.wait_native_started(child,startup_timeout=0.2)
            finally:
                child.kill()

    def test_revoked_wire_must_have_exact_nonce_and_actual_signature(self):
        args = dict(node=7, activation="a"*64, genesis_sha="b"*64,
                    runtime_id="c"*64, profile_sha256="d"*64,
                    authority_sha256="e"*64, roster_sha256="f"*64)
        nonce = "0"*64
        now = time.time_ns()//1_000_000
        claims = dict(schemaVersion=1, kind="xmesh.quota-v2.public-tls-revocation-witness",
            nodeId=7, activationReceiptSha256="a"*64, genesisPolicySha256="b"*64,
            runtimeId="c"*64, profileRevision="d"*64, authoritySha256="e"*64,
            capRosterSha256="f"*64, challenge=nonce, revoked=True, canServePublic=False,
            canStart=False, canResume=False, issuedAtMs=now, validUntilMs=now+7000)
        wal = SimpleNamespace(observed=SimpleNamespace(strict_json=json.loads, canonical=canonical))
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            key, pub, msg, sig = [root/x for x in ("key", "pub", "msg", "sig")]
            subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(key)],check=True)
            subprocess.run(["openssl","pkey","-in",str(key),"-pubout","-out",str(pub)],check=True)
            def make(payload):
                msg.write_bytes(canonical(payload))
                subprocess.run(["openssl","pkeyutl","-sign","-rawin","-inkey",str(key),
                                "-in",str(msg),"-out",str(sig)],check=True)
                return canonical(dict(algorithm="Ed25519",payload=payload,signature=sig.read_bytes().hex()))+b"\n"
            def verify(payload, signature, pinned):
                self.assertEqual(pinned, "reviewed-public-key")
                msg.write_bytes(canonical(payload))
                sig.write_bytes(bytes.fromhex(signature))
                result = subprocess.run(["openssl","pkeyutl","-verify","-rawin","-pubin","-inkey",str(pub),
                    "-in",str(msg),"-sigfile",str(sig)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                if result.returncode != 0:
                    raise ValueError("bad signature")
            guard = SimpleNamespace(check_signature=verify)
            raw = make(claims)
            self.assertTrue(guest.verify_revoked_wire(raw, nonce, args, "reviewed-public-key", wal, guard))
            for changed in (dict(challenge="1"*64), dict(canStart=True), dict(runtimeId="0"*64)):
                with self.assertRaises(AssertionError):
                    guest.verify_revoked_wire(make(dict(claims,**changed)), nonce, args,
                                              "reviewed-public-key", wal, guard)
            tampered = json.loads(raw)
            tampered["signature"] = "0"*128
            with self.assertRaises(ValueError):
                guest.verify_revoked_wire(canonical(tampered)+b"\n", nonce, args,
                                          "reviewed-public-key", wal, guard)
            self.assertFalse(guest.verify_revoked_wire(make(dict(claims,revoked=False)), nonce,
                                                       args, "reviewed-public-key", wal, guard))

if __name__ == "__main__":
    unittest.main()
