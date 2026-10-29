#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts/xsp-v2-p0e4a-storage-preflight.py"
spec = importlib.util.spec_from_file_location("p0e4a_storage", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class StoragePreflightPolicyTest(unittest.TestCase):
    def test_ext4_write_through_agent_is_only_baseline_eligible(self):
        failures, required = module.evaluate(
            module.ROLE_AGENT,
            {"source": "/dev/vda1", "fstype": "ext4", "options": "rw,relatime", "target": "/var/lib/xmesh-agent"},
            {"device": "vda", "writeCache": "write through", "rotational": "0", "fua": "1"},
            None,
        )
        self.assertEqual(failures, [])
        self.assertTrue(any("abrupt host/power" in item for item in required))

    def test_overlay_network_and_unknown_filesystems_fail_closed(self):
        for fstype in ("overlay", "nfs4", "btrfs", "zfs", "tmpfs"):
            failures, _ = module.evaluate(
                module.ROLE_AGENT,
                {"source": "overlay", "fstype": fstype, "options": "rw", "target": "/state"},
                {"device": "vda", "writeCache": "write through", "rotational": "0", "fua": "1"},
                None,
            )
            self.assertTrue(failures, fstype)

    def test_write_back_requires_external_plp_evidence_but_does_not_fake_qualification(self):
        failures, required = module.evaluate(
            module.ROLE_AGENT,
            {"source": "/dev/nvme0n1p1", "fstype": "xfs", "options": "rw", "target": "/state"},
            {"device": "nvme0n1", "writeCache": "write back", "rotational": "0", "fua": "1"},
            None,
        )
        self.assertEqual(failures, [])
        self.assertTrue(any("power-loss-protection evidence" in item for item in required))

    def test_postgres_durability_settings_are_fail_closed(self):
        good = {"fsync": "on", "full_page_writes": "on", "synchronous_commit": "on", "wal_sync_method": "fdatasync"}
        failures, _ = module.evaluate(
            module.ROLE_POSTGRES,
            {"source": "/dev/vda1", "fstype": "ext4", "options": "rw", "target": "/var/lib/docker/volumes/pg"},
            {"device": "vda", "writeCache": "write through", "rotational": "0", "fua": "1"},
            good,
        )
        self.assertEqual(failures, [])
        for key, bad in (("fsync", "off"), ("full_page_writes", "off"), ("synchronous_commit", "off")):
            settings = dict(good)
            settings[key] = bad
            failures, _ = module.evaluate(
                module.ROLE_POSTGRES,
                {"source": "/dev/vda1", "fstype": "ext4", "options": "rw", "target": "/pg"},
                {"device": "vda", "writeCache": "write through", "rotational": "0", "fua": "1"},
                settings,
            )
            self.assertTrue(failures, key)

    def test_findmnt_parser_requires_one_complete_filesystem(self):
        parsed = module.parse_findmnt('{"filesystems":[{"source":"/dev/vda1","fstype":"ext4","options":"rw","target":"/"}]}')
        self.assertEqual(parsed["fstype"], "ext4")
        with self.assertRaises(module.PreflightError):
            module.parse_findmnt('{"filesystems":[]}')

    def test_report_creation_is_exclusive_and_private(self):
        with tempfile.TemporaryDirectory() as raw:
            target = Path(raw) / "report.json"
            module.write_report(str(target), {"schema": module.SCHEMA, "physicalPowerLossQualified": False})
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                module.write_report(str(target), {"schema": module.SCHEMA})


if __name__ == "__main__":
    unittest.main()
