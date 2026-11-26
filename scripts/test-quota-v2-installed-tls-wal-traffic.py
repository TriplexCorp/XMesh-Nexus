#!/usr/bin/env python3
"""Test the disposable harness only; never substitute for the live E2E run."""
import json
import os
import socket
import unittest
from unittest.mock import patch

import quota_v2_installed_tls_wal_traffic as traffic


class HarnessTests(unittest.TestCase):
    def test_vless_header_and_fragmented_exact_reads(self):
        ns = {"__name__": "client_unit_test"}
        exec(compile(traffic.CLIENT, "<inner client>", "exec"), ns)
        identity = "00112233-4455-6677-8899-aabbccddeeff"
        self.assertEqual(ns["vless_header"](identity, traffic.TARGET, 28421).hex(),
                         "0000112233445566778899aabbccddeeff00016f0501c0000009")
        first, second = socket.socketpair()
        with first, second:
            first.sendall(b"abc")
            first.shutdown(socket.SHUT_WR)
            self.assertEqual(ns["exact"](second, 2), b"ab")
            self.assertEqual(ns["exact"](second, 1), b"c")
            with self.assertRaises(EOFError):
                ns["exact"](second, 1)

    def test_scope_and_guard_order_and_fail_closed(self):
        class Guest:
            def __init__(self, *, local=True, wrong_namespace=False, fail_guard=False, wildcard=False):
                self.calls = []
                self.local = local
                self.wrong_namespace = wrong_namespace
                self.fail_guard = fail_guard
                self.wildcard = wildcard

            def exec(self, *command, **kwargs):
                self.calls.append(command)
                if command[:2] == ("docker", "inspect"):
                    return b"none\n"
                if command[:2] == ("docker", "port"):
                    return b""
                if command[0] == "systemctl":
                    return b"42\n"
                if command[0] == "readlink":
                    if self.wrong_namespace and command[1].startswith("/proc/42/"):
                        return b"net:[24]"
                    return b"net:[42]"
                if command[:4] == ("ip", "-j", "addr", "show"):
                    return b"[{\"addr_info\":[]}]"
                if command[0] == "iptables" and self.fail_guard and "-C" in command:
                    raise RuntimeError("guard refused")
                if command[:4] == ("ip", "-j", "route", "get"):
                    return json.dumps([{"type": "local" if self.local else "unicast",
                                        "dev": "lo" if self.local else "eth0"}]).encode()
                if command[0] == "ss":
                    local = b"[::]:28401" if self.wildcard else b"127.0.0.1:28401"
                    return b"LISTEN 0 128 " + local + b" 0.0.0.0:*"
                if command[0] == "python3":
                    return b"actual_vless_echo_verified"
                return b""

        identity = "00112233-4455-6677-8899-aabbccddeeff"
        env = {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
               "XMESH_AUDIT_DISPOSABLE": "1",
               "XMESH_RELEASE_QUALIFICATION_SCENARIO": "public-tls-wal-nonempty",
               "QUOTA_TEST_DSN": "postgresql://test@127.0.0.1:5432/quota_wal_installed"}
        with patch.dict(os.environ, env, clear=True):
            guest = Guest()
            traffic.isolated_vless(guest, identity)
            calls = guest.calls
            guard_checks = [i for i, c in enumerate(calls) if c[0] == "iptables" and "-C" in c]
            self.assertEqual(len(guard_checks), 2)
            alias_index = next(i for i, c in enumerate(calls) if c[:3] == ("ip", "addr", "add"))
            client_index = next(i for i, c in enumerate(calls) if c[0] == "python3")
            self.assertTrue(max(guard_checks) < alias_index < client_index)
            self.assertEqual(calls[client_index][-3:], (traffic.TARGET, identity, "16384"))
            for item in (Guest(local=False), Guest(wrong_namespace=True), Guest(fail_guard=True), Guest(wildcard=True)):
                with self.assertRaises((AssertionError, RuntimeError)):
                    traffic.isolated_vless(item, identity)
                self.assertFalse(any(c[0] == "python3" for c in item.calls))
        # No traffic may be sent from another scenario or normal environment.
        with patch.dict(os.environ, {**env, "XMESH_RELEASE_QUALIFICATION_SCENARIO":
                                      "public-tls-wal-readback"}, clear=True):
            guest = Guest()
            with self.assertRaises(AssertionError):
                traffic.isolated_vless(guest, identity)
            self.assertEqual(guest.calls, [])


if __name__ == "__main__":
    unittest.main()
