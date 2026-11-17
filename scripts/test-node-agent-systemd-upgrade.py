#!/usr/bin/env python3
"""Isolated Ubuntu systemd canary for v6.0.11 -> v6.0.12 policy-meter upgrade.

Runs on an ephemeral GitHub-hosted Ubuntu runner as root, never on a VPS.
Uses real old/current Node guard code, signed Ed25519 policy, real systemd
oneshot service and a TEST-ONLY fake Xray StatsService CLI. No panel/network
access or real Xray instances. Does not invoke the production updater, which
has fixed privileged paths and requires an enrolled strict-PQ Node/router.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid


OLD_SHA = "647adcf7af326b205fce12545fb5d75a20bb8191"
NEW_SHA = "520dc61502b80e78373c658994010feed9aa0787"
NODE = 31
UID = "550e8400-e29b-41d4-a716-446655440001"
ROOT = Path(__file__).resolve().parents[1]


def run(*args, input=None):
    return subprocess.run(args, input=input, capture_output=True,
                          text=True, check=True, timeout=40).stdout.strip()


def canonical(item):
    return json.dumps(item, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False).encode("utf-8")


def expect(condition, msg):
    if not condition:
        raise AssertionError(msg)


def guard_from(folder, name):
    spec = importlib.util.spec_from_file_location(name, folder / "xmesh-policy-guard.py")
    expect(spec and spec.loader, "Missing policy wrapper")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def snapshot():
    return json.loads(Path("/run/xmesh-node-user-metrics.json").read_text())


def inventory(*pairs):
    return {"stat": [
        {"name": f"user>>>xmesh-u{uid}--{tag}>>>traffic>>>{direction}",
         "value": value}
        for uid, tag, direction, value in pairs
    ]}


def save_stats(path, user_one_up, user_one_down, user_two_up, user_two_down,
               retired_up=10, retired_down=5):
    path.write_text(json.dumps(inventory(
        (1, "DE", "uplink", user_one_up),
        (1, "DE", "downlink", user_one_down),
        (1, "RETIRED", "uplink", retired_up),
        (1, "RETIRED", "downlink", retired_down),
        (2, "DE", "uplink", user_two_up),
        (2, "DE", "downlink", user_two_down),
    )), encoding="utf-8")


def signed_policy(work):
    state = work / "state"
    signing = work / "key.pem"
    run("openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(signing))
    der = subprocess.run(["openssl", "pkey", "-in", str(signing), "-pubout",
                          "-outform", "DER"], check=True, capture_output=True).stdout
    pub = der[-32:].hex()
    now = int(time.time() * 1000)
    config = {
        "inbounds": [{"tag": "DE", "listen": "127.0.0.1", "port": 28351,
                      "protocol": "vless", "settings": {"decryption": "none",
                          "clients": [{"id": UID, "email": "xmesh-u1--DE", "level": 0}]}}],
        "outbounds": [{"tag": "direct", "protocol": "freedom"}],
    }
    policy = {
        "version": 1, "nodeId": NODE,
        "issuedAtMs": now - 1000, "validUntilMs": now + 86400000,
        "configSha256": hashlib.sha256(canonical(config)).hexdigest(),
        "users": [{"userId": 1, "xrayId": UID, "expireAtMs": now + 86400000,
                   "panelUsedBytes": 0, "offlineBudgetBytes": 100}],
    }
    msg = work / "signed-policy.json"
    msg.write_bytes(canonical(policy))
    signature = subprocess.run(
        ["openssl", "pkeyutl", "-sign", "-rawin", "-inkey", str(signing),
         "-in", str(msg)], check=True, capture_output=True).stdout.hex()
    (state / "policy-public-key").write_text(pub + "\n", encoding="ascii")
    (state / "policy-envelope.json").write_text(json.dumps({
        "nodeId": NODE, "port": 28351,
        "config": config, "policy": policy,
        "policySignature": signature, "policyPublicKey": pub,
    }), encoding="utf-8")


def install_helper(source, target):
    for name in ("xmesh-policy-guard-base.py", "xmesh-policy-guard.py"):
        shutil.copy2(source / name, target / name)
        os.chmod(target / name, 0o700)


def start(unit):
    # A newly created transient test unit has no failed state to reset.
    subprocess.run(["systemctl", "reset-failed", unit], capture_output=True,
                   text=True, timeout=10, check=False)
    started = subprocess.run(["systemctl", "start", unit], capture_output=True,
                             text=True, timeout=40, check=False)
    if started.returncode != 0:
        journal = subprocess.run(
            ["journalctl", "-b", "-u", unit, "--no-pager", "-n", "40"],
            capture_output=True, text=True, timeout=12, check=False)
        raise RuntimeError("Ubuntu systemd meter start failed: " +
                           started.stderr + "\n" + journal.stdout[-7000:])
    result = run("systemctl", "show", "--property=Result", "--value", unit)
    expect(result == "success", "systemd oneshot did not exit successfully")


def main():
    expect(os.geteuid() == 0 and os.getenv("GITHUB_ACTIONS") == "true" and
           os.getenv("XMESH_AUDIT_SYSTEMD_CANARY") == "1",
           "Isolated root-owned CI runner approval required")
    expect(Path("/run/systemd/system").is_dir(), "Real systemd host unavailable")
    expect(not Path("/run/xmesh-node-user-metrics.json").exists(),
           "Refusing to use a host with an existing live user snapshot")

    old_dir, new_dir = (Path(x).resolve() for x in sys.argv[1:3])
    for folder, required, version in ((old_dir, OLD_SHA, "control-v6.0.11"),
                                       (new_dir, NEW_SHA, "control-v6.0.12")):
        expect(run("git", "-C", str(folder), "rev-parse", "HEAD") == required,
               "Immutable Node source revision does not match expected code")
        expect((folder / "AGENT_VERSION").read_text().strip() == version,
               "Node source identity mismatch")

    updater = (ROOT / "deploy/update-node-control-agent.sh").read_text()
    expect('xmesh-policy-guard-base.py -o "$policy_base_tmp"' in updater and
           'install -o root -g root -m 0700 "$policy_base_tmp"' in updater and
           "Verified installed v6.0.12 signed-scope policy base" in updater,
           "Production updater is still missing its policy-base install gate")

    unit = "xmesh-meter-upgrade-audit-" + uuid.uuid4().hex[:12] + ".service"
    unit_path = Path("/run/systemd/system") / unit
    snapshot_file = Path("/run/xmesh-node-user-metrics.json")
    with tempfile.TemporaryDirectory(prefix="xmesh-meter-upgrade-", dir="/run") as root:
        work = Path(root)
        libexec, state, bin_dir = [work / name for name in ("libexec", "state", "bin")]
        for directory in (libexec, state, bin_dir):
            directory.mkdir(mode=0o700)
        old_helper = old_dir / "deploy"
        new_helper = new_dir / "deploy"
        # The OLD signed-policy worker and the new one use the same journal.
        install_helper(old_helper, libexec)
        old_guard = guard_from(libexec, "xmesh_old_installed")
        expect(len(old_guard.base.store_metrics_snapshot.__code__.co_varnames) >= 3,
               "v6.0.11 source is not the historical meter")

        (state / "policy-usage.json").write_text("{}", encoding="utf-8")
        signed_policy(work)
        stats = work / "fake-xray-stats.json"
        save_stats(stats, 40, 20, 30, 30)
        # Explicit, disposable fake Docker CLI for the Node guard's real
        # get_counters(). No Docker socket, external requests, or real Xray.
        executable = bin_dir / "docker"
        executable.write_text(
            "#!/usr/bin/python3\n"
            "import json,os,sys\n"
            "if sys.argv[1] == 'inspect':\n"
            " print('fake-xray-runtime 2026-11-17T00:00:00Z')\n"
            "elif sys.argv[1] == 'exec':\n"
            " print(open(os.environ['XMESH_AUDIT_FAKE_STATS']).read())\n"
            "else:\n"
            " raise SystemExit(2)\n", encoding="utf-8")
        executable.chmod(0o700)

        unit_path.write_text(
            "[Unit]\nDescription=Disposable signed-policy meter upgrade canary\n"
            "[Service]\nType=oneshot\nUser=root\nGroup=root\nUMask=0077\n"
            f'Environment="PATH={bin_dir}:/usr/bin:/bin"\n'
            f'Environment="XMESH_AUDIT_FAKE_STATS={stats}"\n'
            f"ExecStart=/usr/bin/python3 {libexec / 'xmesh-policy-guard.py'} "
            f"sample --state {state} --node-id {NODE}\n"
            "NoNewPrivileges=true\nProtectSystem=strict\nProtectHome=true\n"
            "ReadWritePaths=/run\n", encoding="utf-8")
        try:
            run("systemctl", "daemon-reload")
            start(unit)
            prior = snapshot()
            expect({row["userId"] for row in prior["userTraffic"]} == {1, 2},
                   "Old installed guard did not expose the stale user baseline")
            expect(any(row["inboundTag"] == "RETIRED"
                       for row in prior["userInboundTraffic"]),
                   "Old installed guard did not expose the retired inbound")
            previous_journal = json.loads((state / "policy-usage.json").read_text())
            # Simulated upgrade installs the same TWO reviewed files (the
            # production updater's previously missing base module). The exact
            # shell-level updater must not be invoked on a CI host.
            install_helper(new_helper, libexec)
            new_guard = guard_from(libexec, "xmesh_new_installed")
            expect("permitted" in new_guard.base.store_metrics_snapshot.__code__.co_varnames,
                   "Old unscoped base module survived the upgrade")

            # Deliberate link outage: the service continues collecting locally
            # without sending a single network packet to Nexus.
            start(unit)
            current = snapshot()
            expect(current["userTraffic"] == [{
                "userId": 1, "uplinkBytes": 50, "downlinkBytes": 25,
            }], "New signed-scope sampler leaked retired user or lost old bytes")
            expect(current["userInboundTraffic"] == [{
                "userId": 1, "inboundTag": "DE",
                "uplinkBytes": 40, "downlinkBytes": 20,
            }], "New signed-scope sampler leaked retired inbound")
            after_upgrade = json.loads((state / "policy-usage.json").read_text())
            expect(after_upgrade == previous_journal,
                   "Replaying unchanged Xray counters mutated historical usage")

            # Repeated systemd invocation and fake Xray byte growth.
            start(unit)
            expect(snapshot()["userTraffic"] == current["userTraffic"],
                   "Repeated timer execution charged the same bytes twice")
            save_stats(stats, 56, 29, 33, 34)
            start(unit)
            grown = snapshot()
            expect(grown["userTraffic"] == [{
                "userId": 1, "uplinkBytes": 66, "downlinkBytes": 34,
            }], "Offline Xray counter increments did not survive")
            assert json.loads((state / "policy-usage.json").read_text())["users"]["2"]["total"] == 67

            # Process restart is implicit in Type=oneshot; run and check again.
            start(unit)
            expect(snapshot()["userTraffic"] == grown["userTraffic"],
                   "Another systemd start changed unchanged cumulative bytes")
            print("PASS: real Ubuntu systemd v6.0.11 -> v6.0.12 helper upgrade "
                  "with signed policy, preserved root journal, failed-link "
                  "retry and non-duplicated Xray counters")
        finally:
            run("systemctl", "stop", unit) if unit_path.exists() else None
            unit_path.unlink(missing_ok=True)
            run("systemctl", "daemon-reload")
            snapshot_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
