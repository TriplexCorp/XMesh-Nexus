#!/usr/bin/env python3
"""Recovery harness contracts, not a substitute for real systemd reboot."""
import json
import os
import subprocess
import unittest
from types import SimpleNamespace
from unittest import mock

import quota_v2_retired_meter_recovery as recovery


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.original = ("a"*64, "2026-11-27T05:00:00Z", 123, "b"*64)
        self.docker = {
            "Id": self.original[0], "Name": "/xmesh-managed-xray",
            "State": {"StartedAt": self.original[1], "Running": False,
                      "Restarting": False, "Pid": 0, "ExitCode": 137},
            "HostConfig": {"NetworkMode": "none", "RestartPolicy": {"Name": "no"}},
        }
        self.managed = (self.original[0] + " xmesh-managed-xray\n").encode()
        self.listener = b""
        self.status = b"LoadState=loaded\nResult=exit-code\nExecMainStatus=1\n"
        self.logs = recovery.REFUSAL + b"\n"
        self.guest = SimpleNamespace(name="test-disposable", node=9, exec=self.command)

    def command(self,*args,**kwargs):
        if args[:2] == ("docker", "inspect"):
            return json.dumps(self.docker).encode()
        if args[:2] == ("docker", "ps"):
            return self.managed
        if args[0] == "ss":
            return self.listener
        if args[:2] == ("systemctl","show"):
            return self.status
        if args[0] == "journalctl":
            return self.logs
        raise AssertionError(args)

    def test_exact_stopped_incarnation_not_generic_down_state(self):
        recovery.stopped_original(self.guest,self.original)
        for key,value in (("Running",True),("Restarting",True),("Pid",False),
                          ("StartedAt","later"),("ExitCode",0)):
            old = self.docker["State"][key]
            self.docker["State"][key] = value
            with self.subTest(key=key),self.assertRaises(AssertionError):
                recovery.stopped_original(self.guest,self.original)
            self.docker["State"][key] = old
        self.managed += b"c"*64 + b" xmesh-managed-xray-successor\n"
        with self.assertRaises(AssertionError):
            recovery.stopped_original(self.guest,self.original)
        self.managed = (self.original[0] + " xmesh-managed-xray\n").encode()
        self.listener = b"LISTEN\n"
        with self.assertRaises(AssertionError):
            recovery.stopped_original(self.guest,self.original)

    def test_systemd_requires_specific_exit_and_matching_installed_error(self):
        self.assertTrue(recovery.systemd_refused(self.guest,"123"))
        self.logs = b"network failure\n"
        self.assertFalse(recovery.systemd_refused(self.guest,"123"))
        self.logs = recovery.REFUSAL+b"\n"
        self.status = b"LoadState=loaded\nResult=success\nExecMainStatus=0\n"
        self.assertFalse(recovery.systemd_refused(self.guest,"123"))
        self.status = b"LoadState=not-found\nResult=exit-code\nExecMainStatus=1\n"
        with self.assertRaises(AssertionError):
            recovery.systemd_refused(self.guest,"123")

    def test_starter_requires_actual_specific_error_not_any_failure(self):
        with mock.patch.object(recovery,"require_live"), mock.patch.object(
                subprocess, "run", return_value=SimpleNamespace(
                    returncode=1,stderr=b"traceback\n"+recovery.REFUSAL+b"\n")) as run:
            recovery.exact_starter_refusal(self.guest,"https://installed.test",self.original)
            command = run.call_args.args[0]
            self.assertIn(recovery.STARTER,command)
            self.assertIn("XMESH_QUOTA_V2_AGENT_MODE=installed",command)
            self.assertNotIn("-I",command)
            run.return_value = SimpleNamespace(returncode=1,stderr=b"generic network error")
            with self.assertRaises(AssertionError):
                recovery.exact_starter_refusal(self.guest,"https://installed.test",self.original)
            run.return_value = SimpleNamespace(returncode=0,stderr=recovery.REFUSAL)
            with self.assertRaises(AssertionError):
                recovery.exact_starter_refusal(self.guest,"https://installed.test",self.original)

    def test_no_reboot_or_process_action_outside_hosted_gate(self):
        with mock.patch.dict(os.environ,{},clear=True),mock.patch.object(subprocess,"run") as run:
            with self.assertRaises(AssertionError):
                recovery.exact_starter_refusal(self.guest,"",self.original)
            with self.assertRaises(AssertionError):
                recovery.verify_recovery_pair([], "", [], None)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
