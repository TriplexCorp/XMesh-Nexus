#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from quota_v2_release_candidate import (
    ACTIVATION, PRODUCT, SCENARIOS, read_xray_qualification, verify,
    verify_installed_matrix, verify_matrix_xray, verify_measured_xray,
    verify_qualified_xray, verify_qualified_xray_manifest, verify_running_xray,
    write_installed_evidence,
)


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
            "productionActivationAuthorized": False, "version": "control-v6.0.32",
            "sourceRevision": self.node, "platform": "linux/amd64",
            "builder": "golang:1.27.3-trixie", "artifacts": {},
        }
        for name in (PRODUCT, ACTIVATION):
            raw = name.encode()
            (self.candidate / name).write_bytes(raw)
            self.manifest["artifacts"][name] = {
                "identity": {"version": "control-v6.0.32", "sourceRevision": self.node,
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

    def test_installed_matrix_is_consistent_but_never_grants_production(self):
        result = verify_installed_matrix(self.evidence, self.node, self.nexus)
        self.assertTrue(result["installedMatrixConsistent"])
        self.assertFalse(result["productionActivationAuthorized"])
        self.assertEqual(result["nodeRevision"], self.node)
        self.assertEqual(result["nexusRevision"], self.nexus)
        self.assertEqual(result["candidateIdentity"], self.identity)
        self.assertEqual(result["testedXrayArtifactSha256"], ["c" * 64])
        self.assertEqual(set(result["stagingScenarios"]), SCENARIOS)

    def test_installed_matrix_denies_mixed_commits_binaries_and_scenarios(self):
        # Preserve the first scenario as the identity anchor, then attempt
        # to smuggle foreign evidence through one of the remaining scenarios.
        path = self.evidence[1]
        original = json.loads(path.read_text())
        for field, replacement, error in (
            ("nexusRevision", "e" * 40, "Nexus source revision mismatch"),
            ("xrayArtifactSha256", "f" * 64, "different Xray binaries"),
            ("productIdentity", {**self.identity, "sourceRevision": "f" * 40},
             "tested product binary differs"),
            ("installedNodes", [{"nodeId": 1, "identity": self.identity}] * 2,
             "not independent"),
            ("productionActivationAuthorized", True, "not staging qualification"),
        ):
            with self.subTest(field=field):
                altered = dict(original, **{field: replacement})
                path.write_text(json.dumps(altered))
                try:
                    with self.assertRaisesRegex(ValueError, error):
                        verify_installed_matrix(self.evidence, self.node, self.nexus)
                finally:
                    path.write_text(json.dumps(original))
        with self.assertRaisesRegex(ValueError, "duplicate installed scenario"):
            verify_installed_matrix([self.evidence[0]] * 3, self.node, self.nexus)
        with self.assertRaisesRegex(ValueError, "all three successful scenarios"):
            verify_installed_matrix(self.evidence[:2], self.node, self.nexus)
        with self.assertRaisesRegex(ValueError, "exact Node and Nexus commit"):
            verify_installed_matrix(self.evidence, "branch-name", self.nexus)

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

    def test_independently_qualified_xray_is_required_for_the_whole_matrix(self):
        source = Path(__file__).resolve().parents[1]
        qualification = read_xray_qualification(source / "scripts/metered-xray-qualification.json")
        binary = self.root / "xray"
        raw = b"reviewed candidate"
        binary.write_bytes(raw)
        digest = hashlib.sha256(raw).hexdigest()
        qualification["artifactSha256"] = digest
        upstream = qualification["upstreamSourceRevision"]
        patch_tree = qualification["patchSourceTree"]
        go = qualification["goVersion"]
        self.assertEqual(verify_qualified_xray(binary, qualification, upstream, patch_tree, go), digest)
        verify_matrix_xray({"testedXrayArtifactSha256": [digest]}, qualification)
        with self.assertRaisesRegex(ValueError, "build inputs differ"):
            verify_qualified_xray(binary, qualification, "0" * 40, patch_tree, go)
        with self.assertRaisesRegex(ValueError, "build inputs differ"):
            verify_qualified_xray(binary, qualification, upstream, "0" * 40, go)
        with self.assertRaisesRegex(ValueError, "different Xray"):
            verify_matrix_xray({"testedXrayArtifactSha256": ["f" * 64]}, qualification)
        binary.write_bytes(b"unmetered substitution")
        with self.assertRaisesRegex(ValueError, "executable changed"):
            verify_qualified_xray(binary, qualification, upstream, patch_tree, go)

    def test_signed_xray_manifest_must_match_reviewed_fields(self):
        source = Path(__file__).resolve().parents[1] / "scripts"
        qualification = read_xray_qualification(source / "metered-xray-qualification.json")
        manifest = source / "metered-xray-candidate-manifest.json"
        verify_qualified_xray_manifest(manifest, qualification)
        altered = self.root / "manifest.json"
        values = json.loads(manifest.read_bytes())
        for key, value in (("artifactSha256", "0" * 64),
                           ("productionActivationAuthorized", True),
                           ("buildFlags", ["CGO_ENABLED=1"])):
            altered.write_text(json.dumps({**values, key: value}))
            with self.subTest(key=key), self.assertRaises(ValueError):
                verify_qualified_xray_manifest(altered, qualification)

    def test_xray_binary_rechecked_at_installed_evidence_export(self):
        binary = self.root / "xray"
        binary.write_bytes(b"exact tested instrumented xray")
        digest = hashlib.sha256(binary.read_bytes()).hexdigest()
        self.assertEqual(verify_measured_xray(binary, digest), digest)
        binary.write_bytes(b"changed after docker image build")
        with self.assertRaisesRegex(ValueError, "executable changed"):
            verify_measured_xray(binary, digest)

    def test_live_nested_xray_elf_hash_is_bound_to_stable_kernel_process(self):
        expected = "a" * 64
        container = "xmesh-managed-xray"

        class FakeGuest:
            def __init__(self):
                self.inspections = 0
                self.digest = expected
                self.pid = "23456"
                self.change_pid_after_measure = False

            def exec(self, *args):
                if args[:2] == ("docker", "inspect"):
                    self.inspections += 1
                    pid = ("23457" if self.change_pid_after_measure
                           and self.inspections > 1 else self.pid)
                    return ("b" * 64 + " " + pid + " 2026-11-24T08:00:00Z").encode()
                if args[0] == "sha256sum":
                    return (self.digest + "  /proc/" + self.pid + "/exe").encode()
                raise AssertionError("unexpected external subprocess")

        guest = FakeGuest()
        self.assertEqual(verify_running_xray(guest, container, expected), expected)
        self.assertEqual(guest.inspections, 2)
        guest.inspections = 0
        guest.digest = "c" * 64
        with self.assertRaisesRegex(ValueError, "differs from pinned binary"):
            verify_running_xray(guest, container, expected)
        guest.digest = expected
        guest.inspections = 0
        guest.change_pid_after_measure = True
        with self.assertRaisesRegex(ValueError, "changed during executable measurement"):
            verify_running_xray(guest, container, expected)
        with self.assertRaisesRegex(ValueError, "untrusted Docker Xray container"):
            verify_running_xray(guest, "foreign-xray", expected)
        guest.change_pid_after_measure = False
        guest.pid = "0"
        with self.assertRaisesRegex(ValueError, "untrusted live Xray Docker"):
            verify_running_xray(guest, container, expected)

    def test_xray_binary_symlink_is_not_release_evidence(self):
        actual = self.root / "real-xray"
        actual.write_bytes(b"test instrumented runtime")
        link = self.root / "xray-symlink"
        link.symlink_to(actual)
        digest = hashlib.sha256(actual.read_bytes()).hexdigest()
        with self.assertRaises(OSError):
            verify_measured_xray(link, digest)

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
