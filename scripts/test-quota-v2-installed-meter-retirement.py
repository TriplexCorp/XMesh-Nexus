#!/usr/bin/env python3
"""Harness contract tests. Real Docker, Xray and PostgreSQL are hosted only."""
import os
import unittest
from unittest import mock

import quota_v2_installed_meter_retirement as retirement
import quota_v2_meter_retirement_guest as guest


class RetirementHarnessTests(unittest.TestCase):
    def setUp(self):
        self.expected = dict(
            kind="xmesh.quota-v2.nonfinal-first-meter-retirement",
            runtimeId="a"*64, containerId="b"*64, startedAt="2026-11-27T04:00:00Z",
            signedWalReadbackSha256="c"*64, inventorySha256="d"*64,
            committedChargeHeadsSha256="e"*64, durableUserDenials={"100":"f"*64,"101":"0"*64},
            originalMeterPidfdExited=True, lifetimeLockReleased=True,
            finalMeterVerified=False, settlementEligible=False, canResume=False, refundableBytes=0)

    def verify(self, value):
        retirement.verify_result(value, "a"*64, "b"*64, "2026-11-27T04:00:00Z",
                                 {100,101}, "d"*64, "e"*64)

    def test_exact_original_scope_and_both_durable_fences_no_refund(self):
        self.verify(self.expected)
        for key, value in (
            ("runtimeId", "f"*64), ("containerId", "0"*64), ("startedAt", "later"),
            ("inventorySha256", "0"*64), ("committedChargeHeadsSha256", "1"*64),
            ("signedWalReadbackSha256", ""), ("originalMeterPidfdExited", 1),
            ("lifetimeLockReleased", False), ("durableUserDenials", {"100":"f"*64}),
            ("finalMeterVerified", True), ("settlementEligible", True),
            ("canResume", True), ("refundableBytes", False), ("refundableBytes", 1)):
            with self.subTest(field=key), self.assertRaises(AssertionError):
                self.verify(dict(self.expected, **{key: value}))
        with self.assertRaises(AssertionError):
            self.verify(dict(self.expected, positiveAuthority=True))

    def test_hosted_gate_before_any_file_or_systemd_change(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(AssertionError):
                retirement.copy_retirement(None, None)
            with self.assertRaises(AssertionError):
                retirement.retire_pair([], {}, "", None, None, [])
            with mock.patch.object(guest, "command") as command:
                with self.assertRaises(AssertionError):
                    guest.retire("", 1, 1)
                command.assert_not_called()

    def test_quiesce_requires_every_unit_and_both_ports_inactive(self):
        def fixture(*args, **kwargs):
            if args[:2] == ("systemctl", "show"):
                return b"inactive\n"
            return b""
        with mock.patch.object(guest, "command", side_effect=fixture) as command:
            guest.quiesce()
            self.assertEqual(command.call_args_list[0].args, ("systemctl", "stop", *guest.UNITS))
        def running(*args, **kwargs):
            return b"active\n" if args[:2] == ("systemctl", "show") else b""
        with mock.patch.object(guest, "command", side_effect=running), self.assertRaises(AssertionError):
            guest.quiesce()
        def port(*args, **kwargs):
            return b"LISTEN ...\n" if args[0] == "ss" else fixture(*args, **kwargs)
        with mock.patch.object(guest, "command", side_effect=port), self.assertRaises(AssertionError):
            guest.quiesce()

if __name__ == "__main__":
    unittest.main()
