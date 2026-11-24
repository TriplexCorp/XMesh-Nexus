#!/usr/bin/env python3
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("coordinator", ROOT / "deploy/xmesh-product-upgrade-coordinator.py")
COORDINATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COORDINATOR)


@unittest.skipUnless(os.geteuid() == 0, "the production files must be root-owned")
class CoordinatorTest(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        root = Path(self.work.name)
        self.state = root / "transaction"
        self.state.mkdir(mode=0o700)
        self.product = root / "product"
        self.bridge = root / "bridge"
        self.bridge_digest = root / "bridge.sha256"
        self.write(self.product, b"old")
        self.write(self.bridge, b"trusted helper")
        self.write(self.bridge_digest, hashlib.sha256(b"trusted helper").hexdigest().encode(), 0o600)
        self.write(root / "config.json", json.dumps({
            "releaseIdentity": {"artifactSha256": hashlib.sha256(b"old").hexdigest(),
                                "version": "control-v6.0.24", "sourceRevision": "b" * 40},
            "panelUrl": "https://nexus.test", "nodeId": 12,
        }).encode(), 0o600)
        self.release = {
            "version": "control-v6.0.27", "sourceRevision": "a" * 40,
            "artifactSha256": hashlib.sha256(b"new").hexdigest(),
        }
        self.command = {"id": 5, "action": "update_agent", "targetVersion": self.release["version"],
                        "releaseIdentity": self.release}
        self.namespace = patch.multiple(COORDINATOR, STATE=self.state, PRODUCT=self.product,
                                       PRODUCT_STATE=root, BRIDGE=self.bridge, BRIDGE_DIGEST=self.bridge_digest)
        self.namespace.start()
        self.addCleanup(self.namespace.stop)
        self.calls = []

    @staticmethod
    def write(path, contents, mode=0o755):
        path.write_bytes(contents)
        path.chmod(mode)

    def invoke(self, binary, phase, *args):
        self.calls.append(phase)
        if phase == "fetch-release-plan":
            payload = json.dumps({"target": self.release, "commandId": self.command["id"]}).encode()
            self.write(Path(args[-1]), json.dumps({"payloadB64": base64.b64encode(payload).decode()}).encode(), 0o600)
        elif phase == "switch-release":
            self.write(self.product, b"new")
        elif phase == "--identity":
            self.assertEqual(binary, self.product)
            return json.dumps(self.release).encode()
        elif phase == "rollback-release":
            self.write(self.product, b"old")
        return b""

    def test_ambiguous_response_preserves_target_and_resumes_after_process_restart(self):
        COORDINATOR.store_command(self.command)

        def lost_response(binary, phase, *args):
            if phase == "confirm-release":
                raise subprocess.CalledProcessError(1, [binary, phase])
            return self.invoke(binary, phase, *args)

        with patch.object(COORDINATOR, "invoke", side_effect=lost_response):
            with self.assertRaises(subprocess.CalledProcessError):
                COORDINATOR.main("run")
        self.assertEqual(self.product.read_bytes(), b"new")
        self.assertTrue((self.state / "command.json").is_file())
        self.assertNotIn("rollback-release", self.calls)
        self.calls.clear()
        with patch.object(COORDINATOR, "invoke", side_effect=self.invoke):
            COORDINATOR.main("run")
        self.assertEqual(self.calls, ["--identity", "confirm-release", "verify-active"])
        self.assertFalse((self.state / "command.json").exists())

    def test_signed_abort_is_retried_after_failure_before_local_cleanup(self):
        COORDINATOR.store_command(self.command)
        self.write(self.product, b"new")

        def interrupted_abort(binary, phase, *args):
            if phase == "--identity":
                raise OSError("candidate process failed")
            if phase == "rollback-release":
                self.invoke(binary, phase, *args)
                raise OSError("coordinator interrupted after restore")
            self.fail(phase)

        with patch.object(COORDINATOR, "invoke", side_effect=interrupted_abort):
            with self.assertRaises(OSError):
                COORDINATOR.main("run")
        self.assertEqual(self.product.read_bytes(), b"old")
        self.assertTrue((self.state / "abort-5").is_file())
        self.calls.clear()
        with patch.object(COORDINATOR, "invoke", side_effect=self.invoke):
            COORDINATOR.main("run")
        self.assertEqual(self.calls, ["rollback-release"])
        self.assertFalse((self.state / "command.json").exists())

    def test_bad_bridge_and_conflicting_control_command_fail_closed(self):
        COORDINATOR.store_command(self.command)
        COORDINATOR.store_command(self.command)
        with self.assertRaises(ValueError):
            COORDINATOR.store_command({**self.command, "id": 4})
        self.write(self.product, b"new")
        with self.assertRaises(ValueError):
            COORDINATOR.store_command({**self.command, "id": 7})
        self.write(self.product, b"old")
        COORDINATOR.store_command({**self.command, "id": 7})
        self.assertEqual(json.loads((self.state / "command.json").read_bytes())["id"], 7)
        self.write(self.bridge, b"altered")
        with patch.object(COORDINATOR, "invoke") as invoke:
            with self.assertRaises(ValueError):
                COORDINATOR.main("run")
            invoke.assert_not_called()
        self.assertEqual(self.product.read_bytes(), b"old")



class FreshCoordinatorTest(CoordinatorTest):
    def setUp(self):
        super().setUp()
        self.release["version"] = "control-v6.0.28"
        self.command["targetVersion"] = self.release["version"]
        config = json.loads((COORDINATOR.PRODUCT_STATE / "config.json").read_bytes())
        config["releaseIdentity"]["version"] = "control-v6.0.27"
        self.write(COORDINATOR.PRODUCT_STATE / "config.json", json.dumps(config).encode(), 0o600)
        self.fresh = patch.object(COORDINATOR, "FRESH", True)
        self.fresh.start()
        self.addCleanup(self.fresh.stop)
        self.bridge.unlink()
        self.bridge_digest.unlink()
        with patch.object(COORDINATOR, "invoke", side_effect=self.invoke):
            COORDINATOR.main("initialize")
        self.calls.clear()

    def test_initialize_uses_original_enrollment_and_is_idempotent(self):
        self.assertEqual(self.bridge.read_bytes(), b"old")
        self.assertEqual(self.bridge_digest.read_text().strip(), hashlib.sha256(b"old").hexdigest())
        with patch.object(COORDINATOR, "invoke") as invoke:
            COORDINATOR.main("initialize")
            invoke.assert_not_called()
        self.bridge.unlink()
        with self.assertRaises(OSError):
            COORDINATOR.main("initialize")

    def test_interrupted_initialization_recovers_only_exact_original(self):
        self.bridge_digest.unlink()
        with patch.object(COORDINATOR, "invoke", side_effect=self.invoke):
            COORDINATOR.main("initialize")
        self.assertEqual(self.bridge_digest.read_text().strip(), hashlib.sha256(b"old").hexdigest())
        self.bridge_digest.unlink()
        self.write(self.bridge, b"tampered")
        with patch.object(COORDINATOR, "invoke", side_effect=self.invoke):
            with self.assertRaises(ValueError):
                COORDINATOR.main("initialize")
        self.assertFalse(self.bridge_digest.exists())

    def test_recovery_pin_is_bound_to_original_enrollment(self):
        self.write(self.bridge, b"tampered")
        self.write(self.bridge_digest, hashlib.sha256(b"tampered").hexdigest().encode(), 0o600)
        with self.assertRaises(ValueError):
            COORDINATOR.main("ready")

    def test_future_command_requires_strict_forward_version_and_new_identity(self):
        self.assertEqual(COORDINATOR.normalized_command(self.command), self.command)
        for version in ("control-v6.0.27", "control-v6.0.26", "control-v6.0.028",
                        "control-v7.0.0", "control-v6.0.4294967296"):
            wrong = {**self.command, "targetVersion": version,
                     "releaseIdentity": {**self.release, "version": version}}
            with self.assertRaises(ValueError):
                COORDINATOR.normalized_command(wrong)
        for key, value in (("sourceRevision", "b" * 40),
                           ("artifactSha256", hashlib.sha256(b"old").hexdigest())):
            wrong = {**self.command, "releaseIdentity": {**self.release, key: value}}
            with self.assertRaises(ValueError):
                COORDINATOR.normalized_command(wrong)

    def test_completed_transition_cannot_start_second_unqualified_upgrade(self):
        self.write(self.product, b"new")
        with self.assertRaises(ValueError):
            COORDINATOR.store_command(self.command)

    def test_signed_abort_is_retried_after_failure_before_local_cleanup(self):
        # Fresh path additionally verifies original operational activation
        # after the signed ABORT and before discarding the recovery command.
        COORDINATOR.store_command(self.command)
        self.write(self.product, b"new")
        def interrupted_abort(binary, phase, *args):
            if phase == "--identity":
                raise OSError("candidate failed")
            if phase == "rollback-release":
                self.invoke(binary, phase, *args)
                raise OSError("interrupted after restore")
            self.fail(phase)
        with patch.object(COORDINATOR, "invoke", side_effect=interrupted_abort):
            with self.assertRaises(OSError):
                COORDINATOR.main("run")
        self.assertEqual(self.product.read_bytes(), b"old")
        self.assertTrue((self.state / "abort-5").is_file())
        self.calls.clear()
        with patch.object(COORDINATOR, "invoke", side_effect=self.invoke):
            COORDINATOR.main("run")
        self.assertEqual(self.calls, ["rollback-release", "verify-active"])
        self.assertFalse((self.state / "command.json").exists())

if __name__ == "__main__":
    unittest.main()
