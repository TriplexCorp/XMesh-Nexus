#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from quota_v2_release_candidate import ACTIVATION, PRODUCT, SCENARIOS, verify, write_installed_evidence


class CandidateTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.candidate = self.root / "candidate"
        self.candidate.mkdir()
        self.node = "a" * 40
        self.nexus = "b" * 40
        self.manifest = {
            "schema": "xmesh-agent-release-candidate-v1", "candidateOnly": True,
            "productionActivationAuthorized": False, "version": "control-v6.0.27",
            "sourceRevision": self.node, "platform": "linux/amd64",
            "builder": "golang:1.27.3-trixie", "artifacts": {},
        }
        for name in (PRODUCT, ACTIVATION):
            raw = name.encode()
            (self.candidate / name).write_bytes(raw)
            self.manifest["artifacts"][name] = {
                "identity": {"version": "control-v6.0.27", "sourceRevision": self.node,
                             "artifactSha256": hashlib.sha256(raw).hexdigest()},
                "sizeBytes": len(raw),
            }
        self.write_manifest()
        self.identity = self.manifest["artifacts"][PRODUCT]["identity"]
        self.evidence = []
        for scenario in sorted(SCENARIOS):
            path = self.root / (scenario + ".json")
            write_installed_evidence(path, scenario, self.nexus, self.identity,
                                     [{"nodeId": n, "identity": self.identity} for n in (1, 2)],
                                     "c" * 64)
            self.evidence.append(path)

    def write_manifest(self):
        (self.candidate / "candidate-manifest.json").write_text(json.dumps(self.manifest))

    def verify(self):
        return verify(self.candidate, self.evidence, self.node, self.nexus)

    def test_all_exact_staging_evidence_matches_without_production_authority(self):
        result = self.verify()
        self.assertTrue(result["candidateMatchesInstalledStagingEvidence"])
        self.assertFalse(result["productionActivationAuthorized"])
        self.assertEqual(set(result["stagingScenarios"]), SCENARIOS)

    def test_changed_binary_and_changed_size_rejected(self):
        (self.candidate / PRODUCT).write_bytes(b"unreviewed product")
        with self.assertRaisesRegex(ValueError, "artifact bytes mismatch"):
            self.verify()

    def test_unsafe_candidate_cannot_grant_production_authority(self):
        self.manifest["productionActivationAuthorized"] = True
        self.write_manifest()
        with self.assertRaises(ValueError):
            self.verify()

    def test_duplicate_or_missing_scenario_rejected(self):
        self.evidence[-1] = self.evidence[0]
        with self.assertRaisesRegex(ValueError, "duplicate installed scenario"):
            self.verify()

    def test_foreign_nexus_revision_rejected(self):
        self.nexus = "e" * 40
        with self.assertRaisesRegex(ValueError, "Nexus source revision mismatch"):
            self.verify()

    def test_each_installed_binary_must_match(self):
        path = self.evidence[0]
        doc = json.loads(path.read_text())
        doc["installedNodes"][1]["identity"]["artifactSha256"] = "f" * 64
        path.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError, "installed product binary differs"):
            self.verify()

    def test_two_independent_installed_nodes_required(self):
        path = self.evidence[0]
        doc = json.loads(path.read_text())
        doc["installedNodes"][1]["nodeId"] = doc["installedNodes"][0]["nodeId"]
        path.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError, "not independent"):
            self.verify()

    def test_mixed_xray_binaries_cannot_qualify_one_release(self):
        path = self.evidence[0]
        doc = json.loads(path.read_text())
        doc["xrayArtifactSha256"] = "e" * 64
        path.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError, "different Xray binaries"):
            self.verify()

    def test_symlink_candidate_artifact_rejected(self):
        path = self.candidate / PRODUCT
        target = self.root / "foreign"
        path.rename(target)
        path.symlink_to(target)
        with self.assertRaises(OSError):
            self.verify()

    def test_duplicate_manifest_field_rejected(self):
        path = self.candidate / "candidate-manifest.json"
        path.write_text(path.read_text().replace("{", '{"candidateOnly": false,', 1))
        with self.assertRaisesRegex(ValueError, "duplicate JSON field"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
