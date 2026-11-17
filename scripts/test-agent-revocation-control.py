#!/usr/bin/env python3
"""Executable XMesh Agent rollback/restart fencing regression (no live Docker)."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

SOURCE = (Path(__file__).resolve().parents[1] / "deploy/node-control-agent.sh").read_text()

def function(name):
    match = re.search(r"(?ms)^" + re.escape(name) + r"\(\)\{\n.*?^\}\n", SOURCE)
    if not match:
        raise AssertionError(f"missing reviewed Agent shell function: {name}")
    return match.group()

class RevocationControlTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.marker = self.dir / "quota-revocation-deny-pending"
        self.manual = self.dir / "forced-stop"
        self.manual.write_text("docker\n")
        self.calls = self.dir / "calls"

    def run_action(self, action, *, deny=True):
        if deny:
            self.marker.write_text("signed-v2-deny\n")
        script = "\n".join([
            "set -Eeuo pipefail",
            "QUOTA_REVOCATION_MARKER=" + repr(str(self.marker)),
            "MARKER=" + repr(str(self.manual)),
            "CALLS=" + repr(str(self.calls)),
            "docker() { printf 'docker:%s\\n' \"$1\" >> \"$CALLS\"; if [[ $1 == inspect ]]; then echo true; fi; }",
            "systemctl() { printf 'systemctl:%s\\n' \"$1\" >> \"$CALLS\"; }",
            "timeout() { shift; \"$@\"; }",
            "signed_post() { printf 'signed-post\\n' >> \"$CALLS\"; }",
            "UNIT=xmesh-xray-sync.service",
            function(action),
            f"if {action}" + (' "26.10.31"' if action == 'update_managed_xray' else '') + "; then exit 23; else exit 17; fi"
        ])
        return subprocess.run(["bash","-c",script],capture_output=True,text=True,timeout=5)

    def test_restart_is_forbidden_by_signed_revocation_marker(self):
        result = self.run_action("restart_xray")
        self.assertEqual(result.returncode,17,result.stderr)
        self.assertIn("revocation pending",result.stderr)
        self.assertFalse(self.calls.exists(),"Docker restart cannot run during revocation")

    def test_resume_cannot_override_durable_denial(self):
        result = self.run_action("resume_xray")
        self.assertEqual(result.returncode,17,result.stderr)
        self.assertIn("revocation pending",result.stderr)
        self.assertTrue(self.manual.exists(),"Manual stop marker remains intact")
        self.assertFalse(self.calls.exists(),"Docker start cannot run during revocation")

    def test_xray_update_worker_cannot_be_invoked(self):
        result = self.run_action("update_managed_xray")
        self.assertEqual(result.returncode,17,result.stderr)
        self.assertFalse(self.calls.exists(),"Worker cannot run during revocation")

    def test_dangling_symlink_marker_is_not_treated_as_absent(self):
        self.marker.symlink_to(self.dir / "lost-marker-target")
        for action in ("restart_xray","resume_xray","update_managed_xray"):
            with self.subTest(action=action):
                result = self.run_action(action,deny=False)
                self.assertEqual(result.returncode,17,result.stderr)
        self.assertFalse(self.calls.exists())

    def test_normal_restart_remains_possible_without_revocation_marker(self):
        result = self.run_action("restart_xray",deny=False)
        self.assertEqual(result.returncode,23,result.stderr)
        self.assertIn("docker:restart",self.calls.read_text())

if __name__ == "__main__":
    unittest.main()
