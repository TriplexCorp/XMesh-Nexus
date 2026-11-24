#!/usr/bin/env python3
"""Run the actual legacy updater guards in disposable directories."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = (Path(__file__).resolve().parents[1] / "deploy/update-node-control-agent.sh").read_text()
START = SOURCE.index("refuse_legacy_quota_update() {")
END = SOURCE.index("\nrefuse_legacy_quota_update /var/lib/xmesh-xray-sync\n", START)
GUARDS = SOURCE[START:END]


class LegacyUpgradePreflightTests(unittest.TestCase):
    def call(self, command, *args):
        return subprocess.run(["bash", "-c", "set -Eeuo pipefail\n" + GUARDS + "\n" + command,
                               "test", *map(str, args)], text=True, capture_output=True,
                              timeout=5)

    def test_existing_signed_quota_evidence_denies_update(self):
        with tempfile.TemporaryDirectory() as td:
            state = Path(td)
            self.assertEqual(self.call('refuse_legacy_quota_update "$1"', state).returncode, 0)
            for name in ("genesis-quarantine-envelope.json", "genesis-reservation-prepared-u1.json",
                         "genesis-renewal-u1-r2.json", "genesis-renewal-request-u1-r2.json",
                         "calendar-positive-u1-a.json", "wal-cap-u1-a.json",
                         "wal-charge-request-a-s1.json", "ingress-u1", "xmesh-quota-u1-a"):
                with self.subTest(name=name):
                    item = state / name
                    item.symlink_to("missing")
                    result = self.call('refuse_legacy_quota_update "$1"', state)
                    self.assertEqual(result.returncode, 2, result.stderr)
                    item.unlink()
                    item.touch()
                    self.assertEqual(self.call('refuse_legacy_quota_update "$1"', state).returncode, 2)
                    item.unlink()
            foreign = state / "foreign"
            foreign.symlink_to("missing-state")
            self.assertEqual(self.call('refuse_legacy_quota_update "$1"', foreign).returncode, 2)

    def test_unbound_legacy_and_partial_enrollment(self):
        with tempfile.TemporaryDirectory() as td:
            state = Path(td)
            executable = state / "missing-product"
            call = 'preflight_enrolled_product_revision "$1" "$2" "$3"'
            revision = "a" * 40
            self.assertEqual(self.call(call, state, revision, executable).returncode, 0)
            for name in ("config.json", "active.json", "activation-request.json", "activation-receipt.json"):
                with self.subTest(name=name):
                    item = state / name
                    item.symlink_to("missing")
                    self.assertEqual(self.call(call, state, revision, executable).returncode, 2)
                    item.unlink()
            self.assertEqual(self.call(call, state, "invalid", executable).returncode, 2)

    @unittest.skipUnless(os.geteuid() == 0, "private root-owned installed product config")
    def test_changed_release_never_executes_product(self):
        import json
        with tempfile.TemporaryDirectory() as td:
            state = Path(td)
            config = state / "config.json"
            config.write_text(json.dumps({"panelUrl":"https://panel.invalid","nodeId":7,
                                          "releaseIdentity":{"sourceRevision":"a"*40}}))
            config.chmod(0o600)
            executable = state / "product"
            log = state / "invoked"
            executable.write_text('#!/bin/bash\nprintf "%s\\n" "$@" > "$(dirname "$0")/invoked"\nexit 0\n')
            executable.chmod(0o700)
            call = 'preflight_enrolled_product_revision "$1" "$2" "$3"'
            self.assertEqual(self.call(call,state,"b"*40,executable).returncode,2)
            self.assertFalse(log.exists())
            result = self.call(call,state,"a"*40,executable)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(result.stdout.strip(),"bound")
            self.assertEqual(log.read_text().splitlines(),
                             ["verify-active","--panel","https://panel.invalid","--node-id","7"])
            log.unlink()
            config.chmod(0o644)
            self.assertEqual(self.call(call,state,"a"*40,executable).returncode,2)
            self.assertFalse(log.exists())

    def test_checks_precede_all_mutations(self):
        self.assertLess(SOURCE.index("\nrefuse_legacy_quota_update /var/lib/xmesh-xray-sync\n"),
                        SOURCE.index('tmp="$(mktemp)"'))
        self.assertLess(SOURCE.index('binding="$(preflight_enrolled_product_revision /var/lib/xmesh-agent/product'),
                        SOURCE.index(' git -C "$dir" merge --ff-only FETCH_HEAD'))
        self.assertIn("declare -f refuse_legacy_quota_update preflight_enrolled_product_revision update_router",SOURCE)
        self.assertIn('[[ "$binding" == bound ]] || bash deploy/install-xsp-v2-production-agent.sh',SOURCE)


if __name__ == "__main__":
    unittest.main()
