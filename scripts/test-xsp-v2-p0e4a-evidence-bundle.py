#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("xsp-v2-p0e4a-evidence-bundle.py")
spec = importlib.util.spec_from_file_location("p0e4a_evidence", SCRIPT)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)

RUN = "p0e4a-run-0001"
POINT = "after-floor"
NODE = 73
RECEIPT = "ab" * 32


def dump(path: Path, value: object) -> bytes:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    path.write_bytes(raw)
    return raw


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


class BundleFixture:
    def __init__(self, root: Path):
        self.root = root
        self.docs: dict[str, object] = {
            "agent-preflight.json": {
                "schema": mod.PREFLIGHT_SCHEMA,
                "role": "agent-state",
                "target": "/var/lib/xmesh-agent/xsp-v2",
                "kernel": "Linux 6.8",
                "mount": {"source": "/dev/nvme0n1p2", "fstype": "ext4", "options": "rw", "target": "/"},
                "device": {"device": "nvme0n1", "writeCache": "write through", "rotational": "0", "fua": "1"},
                "postgres": None,
                "baselineEligible": True,
                "physicalPowerLossQualified": False,
                "failures": [],
                "requiredNextEvidence": ["real abrupt-power qualification"],
                "scope": "read-only baseline preflight; not physical power-loss qualification",
            },
            "postgres-preflight.json": {
                "schema": mod.PREFLIGHT_SCHEMA,
                "role": "nexus-postgres",
                "target": "/var/lib/postgresql",
                "kernel": "Linux 6.8",
                "mount": {"source": "/dev/nvme0n1p3", "fstype": "xfs", "options": "rw", "target": "/var/lib/postgresql"},
                "device": {"device": "nvme0n1", "writeCache": "write through", "rotational": "0", "fua": "1"},
                "postgres": {"fsync": "on", "full_page_writes": "on", "synchronous_commit": "on", "wal_sync_method": "fdatasync"},
                "baselineEligible": True,
                "physicalPowerLossQualified": False,
                "failures": [],
                "requiredNextEvidence": ["real abrupt-power qualification"],
                "scope": "read-only baseline preflight; not physical power-loss qualification",
            },
            "checkpoint.json": {
                "schema": mod.CHECKPOINT_SCHEMA,
                "nodeId": NODE,
                "minimumEpoch": 9,
                "receiptSha256Hex": RECEIPT,
                "signedReceiptBase64": "eyJub3QiOiJhLXJlYWwtcmVjZWlwdCJ9",
            },
            "panel-pin.json": {
                "purpose": "panel_response",
                "issuerId": "lab-panel",
                "nodeId": NODE,
                "edKeyId": "ed-placeholder",
                "pqKeyId": "pq-placeholder",
            },
            "arm.json": {
                "schema": mod.ARM_SCHEMA,
                "runId": RUN,
                "checkpoint": POINT,
                "marker": f"XSP2-POWERCUT-ARMED-V1 run={RUN} point={POINT}",
            },
            "controller.json": {
                "schema": mod.CONTROLLER_SCHEMA,
                "runId": RUN,
                "checkpoint": POINT,
                "event": "abrupt-power-loss",
                "independentController": True,
                "observedArmMarker": f"XSP2-POWERCUT-ARMED-V1 run={RUN} point={POINT}",
                "eventTimeUnixMs": 1_793_311_234_567,
                "evidenceReference": "pdu-log-record-0001",
            },
            "postboot-agent.json": {
                "schema": mod.POSTBOOT_AGENT_SCHEMA,
                "runId": RUN,
                "nodeId": NODE,
                "keyEpoch": 9,
                "stateClass": "previous-complete",
                "currentReceiptSha256Hex": RECEIPT,
                "networkUsedDuringValidation": False,
            },
            "postboot-postgres.json": {
                "schema": mod.POSTBOOT_POSTGRES_SCHEMA,
                "runId": RUN,
                "nodeId": NODE,
                "keyEpoch": 9,
                "receiptSha256Hex": RECEIPT,
                "fsync": "on",
                "fullPageWrites": "on",
                "recoveryCompleted": True,
                "securityTupleMutatedByValidation": False,
            },
        }
        self.component_names = {
            "agentPreflight": "agent-preflight.json",
            "postgresPreflight": "postgres-preflight.json",
            "offhostCheckpoint": "checkpoint.json",
            "panelPin": "panel-pin.json",
            "armMarker": "arm.json",
            "controllerEvent": "controller.json",
            "postbootAgent": "postboot-agent.json",
            "postbootPostgres": "postboot-postgres.json",
        }
        self.manifest_path = root / "manifest.json"
        self.write_all()

    def write_all(self) -> None:
        components = {}
        for key, filename in self.component_names.items():
            raw = dump(self.root / filename, self.docs[filename])
            components[key] = {"file": filename, "sha256": digest(raw)}
        self.manifest = {
            "schema": mod.SCHEMA,
            "runId": RUN,
            "checkpoint": POINT,
            "nodeId": NODE,
            "nexusRevision": "1a" * 20,
            "nodeRevision": "2b" * 20,
            "qualificationBinarySha256": "3c" * 32,
            "physicalPowerLossQualified": False,
            "components": components,
        }
        dump(self.manifest_path, self.manifest)

    def mutate(self, filename: str, update) -> None:
        update(self.docs[filename])
        self.write_all()


class EvidenceBundleTests(unittest.TestCase):
    def fixture(self) -> tuple[tempfile.TemporaryDirectory[str], BundleFixture]:
        temp = tempfile.TemporaryDirectory()
        return temp, BundleFixture(Path(temp.name))

    def test_accepts_consistent_integrity_bound_bundle_without_qualifying_power_loss(self):
        temp, fixture = self.fixture()
        self.addCleanup(temp.cleanup)
        result = mod.verify(fixture.manifest_path, fixture.root)
        self.assertEqual(result["status"], "evidence-bundle-consistent")
        self.assertFalse(result["physicalPowerLossQualified"])
        self.assertEqual(result["minimumEpoch"], 9)

    def test_rejects_manifest_that_claims_physical_qualification(self):
        temp, fixture = self.fixture()
        self.addCleanup(temp.cleanup)
        fixture.manifest["physicalPowerLossQualified"] = True
        dump(fixture.manifest_path, fixture.manifest)
        with self.assertRaisesRegex(mod.EvidenceError, "physicalPowerLossQualified must be false"):
            mod.verify(fixture.manifest_path, fixture.root)

    def test_rejects_component_digest_tamper(self):
        temp, fixture = self.fixture()
        self.addCleanup(temp.cleanup)
        with (fixture.root / "controller.json").open("ab") as handle:
            handle.write(b"\n")
        with self.assertRaisesRegex(mod.EvidenceError, "controllerEvent digest mismatch"):
            mod.verify(fixture.manifest_path, fixture.root)

    def test_rejects_controller_event_not_bound_to_exact_arm_marker(self):
        temp, fixture = self.fixture()
        self.addCleanup(temp.cleanup)
        fixture.mutate("controller.json", lambda doc: doc.__setitem__("observedArmMarker", "wrong"))
        with self.assertRaisesRegex(mod.EvidenceError, "exact arm marker"):
            mod.verify(fixture.manifest_path, fixture.root)

    def test_rejects_postboot_agent_below_offhost_floor(self):
        temp, fixture = self.fixture()
        self.addCleanup(temp.cleanup)
        fixture.mutate("postboot-agent.json", lambda doc: doc.__setitem__("keyEpoch", 8))
        with self.assertRaisesRegex(mod.EvidenceError, "below off-host monotonic floor"):
            mod.verify(fixture.manifest_path, fixture.root)

    def test_rejects_same_epoch_receipt_divergence(self):
        temp, fixture = self.fixture()
        self.addCleanup(temp.cleanup)
        fixture.mutate("postboot-agent.json", lambda doc: doc.__setitem__("currentReceiptSha256Hex", "cd" * 32))
        with self.assertRaisesRegex(mod.EvidenceError, "differs from off-host witness"):
            mod.verify(fixture.manifest_path, fixture.root)

    def test_rejects_preflight_that_self_claims_physical_qualification(self):
        temp, fixture = self.fixture()
        self.addCleanup(temp.cleanup)
        fixture.mutate("agent-preflight.json", lambda doc: doc.__setitem__("physicalPowerLossQualified", True))
        with self.assertRaisesRegex(mod.EvidenceError, "physicalPowerLossQualified must be false"):
            mod.verify(fixture.manifest_path, fixture.root)

    def test_rejects_symlink_component_even_when_target_digest_matches(self):
        temp, fixture = self.fixture()
        self.addCleanup(temp.cleanup)
        original = fixture.root / "panel-pin.json"
        real = fixture.root / "real-pin.json"
        original.rename(real)
        original.symlink_to(real.name)
        fixture.manifest["components"]["panelPin"]["sha256"] = digest(real.read_bytes())
        dump(fixture.manifest_path, fixture.manifest)
        with self.assertRaisesRegex(mod.EvidenceError, "non-symlink regular file"):
            mod.verify(fixture.manifest_path, fixture.root)

    def test_rejects_duplicate_json_fields(self):
        temp, fixture = self.fixture()
        self.addCleanup(temp.cleanup)
        fixture.manifest_path.write_text('{"schema":"x","schema":"y"}')
        with self.assertRaisesRegex(mod.EvidenceError, "duplicate JSON field"):
            mod.verify(fixture.manifest_path, fixture.root)


if __name__ == "__main__":
    unittest.main()
