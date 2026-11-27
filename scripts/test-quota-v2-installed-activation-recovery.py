#!/usr/bin/env python3
"""Unit-test the qualification harness; actual recovery must still run in CI."""
import subprocess
import unittest

from quota_v2_installed_activation_recovery import run_installer_guard

ORIGINAL = {name: "a" * 64 for name in (
    "activation-request.json", "activation-receipt.json", "active.json", "config.json",
)}
BEFORE = ("request", "receipt", "revision")


class Harness:
    node = 1

    def __init__(self, first=b"active", *, changed=False, changed_sql=False,
                 invalid=False, second=b"active"):
        self.first, self.second = first, second
        self.changed, self.changed_sql, self.invalid = changed, changed_sql, invalid
        self.guard_calls = 0
        self.events = []

    def exec(self, *args, **kwargs):
        self.events.append(args)
        if args[0] == "bash":
            self.guard_calls += 1
            value = self.first if self.guard_calls == 1 else self.second
            if isinstance(value, int):
                raise subprocess.CalledProcessError(value, args)
            return value
        if "verify-active" in args:
            if self.invalid:
                raise subprocess.CalledProcessError(2, args)
            return b""
        if args[0] == "sha256sum":
            return (("b" if self.changed else "a") * 64 + " path").encode()
        raise AssertionError(args)

    def execute(self, sql, params):
        self.events.append(("sql", params))
        return self

    def fetchone(self):
        return ("foreign", "receipt", "revision") if self.changed_sql else BEFORE

    def run(self):
        return run_installer_guard(self, state="/state", product="/product", panel="panel",
                                   original=ORIGINAL, db=self, before=BEFORE)


class Tests(unittest.TestCase):
    def test_normal_success_never_retries(self):
        for result in (b"active", b"resumed"):
            h = Harness(result)
            self.assertIsNone(h.run())
            self.assertEqual(h.guard_calls, 1)

    def test_race_requires_proven_original_before_single_retry(self):
        h = Harness(2)
        self.assertIsNone(h.run())
        self.assertEqual(h.guard_calls, 2)
        self.assertEqual(h.events[1][1], "verify-active")
        self.assertEqual(h.events[-2], ("sql", (1,)))
        self.assertEqual(h.events[0], h.events[-1])

    def test_changed_or_unverified_original_and_unexpected_exit_fail_closed(self):
        for h in (Harness(2, changed=True), Harness(2, changed_sql=True),
                  Harness(2, invalid=True), Harness(1)):
            with self.assertRaises((AssertionError, subprocess.CalledProcessError)):
                h.run()
            self.assertEqual(h.guard_calls, 1)

    def test_failed_or_nonactive_retry_not_accepted(self):
        for result in (2, b"resumed", b"fresh"):
            h = Harness(2, second=result)
            with self.assertRaises((AssertionError, subprocess.CalledProcessError)):
                h.run()
            self.assertEqual(h.guard_calls, 2)


if __name__ == "__main__":
    unittest.main()
