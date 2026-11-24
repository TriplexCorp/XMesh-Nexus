#!/usr/bin/env python3
"""Execute the same preflight used by full install, without changing the host."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
REV = "a" * 40
PIN = REV + ":" + "b" * 64


class FreshAgentPinTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        self.script = self.root / "scripts/validate-panel-agent-pin.sh"
        shutil.copyfile(ROOT / "scripts/validate-panel-agent-pin.sh", self.script)
        self.bootstrap = self.root / "frontend/js/features/nodes/node-bootstrap-v6.js"
        self.bootstrap.parent.mkdir(parents=True)
        self.bootstrap.write_text(f"const XMESH_V6_NODE_BOOTSTRAP_SHA='{REV}';\n")
        self.env = os.environ.copy()
        self.env.pop("XSP_V2_PRODUCT_AGENT_PIN", None)

    def run_check(self, pin=None, stored=None):
        if pin is not None:
            self.env["XSP_V2_PRODUCT_AGENT_PIN"] = pin
        if stored is not None:
            (self.root / ".env").write_text(stored)
        return subprocess.run(["bash", str(self.script)], env=self.env,
                              capture_output=True, text=True, timeout=5)

    def test_missing_pin(self):
        self.assertNotEqual(self.run_check().returncode, 0)
        self.assertFalse((self.root / ".env").exists())

    def test_approved_pin(self):
        self.assertEqual(self.run_check(PIN).returncode, 0)

    def test_existing_pin(self):
        self.assertEqual(self.run_check(stored=f"XSP_V2_PRODUCT_AGENT_PIN={PIN}\n").returncode, 0)

    def test_wrong_revision(self):
        self.assertNotEqual(self.run_check("c" * 40 + ":" + "b" * 64).returncode, 0)

    def test_malformed_pin(self):
        self.assertNotEqual(self.run_check(REV + ":not-a-digest").returncode, 0)

    def test_conflicting_pin(self):
        old = f"XSP_V2_PRODUCT_AGENT_PIN={REV}:" + "c" * 64 + "\n"
        self.assertNotEqual(self.run_check(PIN, old).returncode, 0)
        self.assertEqual((self.root / ".env").read_text(), old)

    def test_duplicate_pin(self):
        line = f"XSP_V2_PRODUCT_AGENT_PIN={PIN}\n"
        self.assertNotEqual(self.run_check(stored=line * 2).returncode, 0)

    def test_missing_bootstrap_revision(self):
        self.bootstrap.write_text("// no canonical revision\n")
        self.assertNotEqual(self.run_check(PIN).returncode, 0)

    def test_full_install_invokes_preflight_before_dependencies(self):
        install = (ROOT / "install.sh").read_text()
        self.assertLess(install.index("bash scripts/validate-panel-agent-pin.sh"),
                        install.index("bash deploy/install-panel-host.sh deps"))


if __name__ == "__main__":
    unittest.main()
