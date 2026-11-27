#!/usr/bin/env python3
"""Harness-scope/refusal tests; never substitute for real hosted qualification."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import quota_v2_installed_namespace_candidate as native

ENV = {
    "GITHUB_ACTIONS": "true",
    "RUNNER_ENVIRONMENT": "github-hosted",
    "XMESH_AUDIT_DISPOSABLE": "1",
    "XMESH_RELEASE_QUALIFICATION_SCENARIO": "public-tls-namespace-candidate",
    "QUOTA_TEST_DSN": "postgresql://quota_test:disposable@127.0.0.1:5432/quota_wal_installed",
}


class Tests(unittest.TestCase):
    def test_pinned_signed_subject_input(self):
        root = Path(__file__).resolve().parent
        manifest = root / "namespace-xray-candidate-manifest.json"
        provenance = root / "namespace-xray-provenance.jsonl"
        self.assertEqual(native.file_digest(manifest), native.MANIFEST_SHA)
        self.assertEqual(native.file_digest(provenance), native.PROVENANCE_SHA)
        data = json.loads(manifest.read_bytes())
        self.assertEqual(data["nodeSourceRevision"], native.REVISION)
        self.assertEqual(data["artifactSha256"], native.BINARY_SHA)
        self.assertIs(data["candidateOnly"], True)
        self.assertIs(data["productionActivationAuthorized"], False)
        compile(native.PROBE, "<installed-namespace-candidate-probe>", "exec")

    def test_guest_actions_refused_outside_exact_scenario(self):
        for key, value in (("GITHUB_ACTIONS", "false"), ("RUNNER_ENVIRONMENT", "self-hosted"),
                           ("XMESH_AUDIT_DISPOSABLE", "0"),
                           ("XMESH_RELEASE_QUALIFICATION_SCENARIO", "public-tls-wal-nonempty"),
                           ("QUOTA_TEST_DSN", "postgresql://prod@other:5432/quota_wal_installed")):
            with self.subTest(key=key), patch.dict(os.environ, {**ENV, key: value}, clear=True):
                with self.assertRaises(AssertionError):
                    native.install_candidate(None, None)
                with self.assertRaises(AssertionError):
                    native.prove_candidate(None)
        with patch.dict(os.environ, ENV, clear=True):
            native.require_native()

    def test_wrong_candidate_rejected_before_any_guest_action(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("xray", "candidate-manifest.json", "provenance.jsonl"):
                (root / name).write_bytes(b"foreign")
            with patch.dict(os.environ, {**ENV, "XMESH_NAMESPACE_BUNDLE": directory}, clear=True), \
                    patch.object(native, "reviewed_checkout", return_value=root):
                # None cannot be used as guest or Docker harness. The hash
                # must fail before any access to the guest.
                with self.assertRaises(AssertionError):
                    native.install_candidate(None, None)


if __name__ == "__main__":
    unittest.main()
