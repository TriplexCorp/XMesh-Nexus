"""Hosted-only recovery rehearsal of a genuinely retired first meter.

Do not restart the old Docker container. Re-run the unchanged installed
starter and then restart the disposable containing systemd guest rootfs.
The normal enabled starter must refuse the stopped original runtime.
The old durable denial, private unsigned evidence and SQL reserve survive.
"""
import json
import subprocess

from quota_v2_installed_genesis_lease import parallel
from quota_v2_installed_native_live import require_live
from quota_v2_retirement_evidence import LEDGER_DIR, RECORD_DIR, read_private

STARTER = "/opt/xmesh-node/experiments/quota-v2-physical-stop/qualified_first_meter.py"
PRODUCT = "/usr/local/bin/xmesh-agent-xspv2-product"
PRODUCT_STATE = "/var/lib/xmesh-agent/product"
KEY = "/var/lib/xmesh-agent/xsp-v2/keys/node-request.vault"
FILES = (PRODUCT, KEY, *(PRODUCT_STATE + "/" + name for name in (
    "activation-request.json", "activation-receipt.json", "active.json")))
UNITS = ("xmesh-quota-v2-renewal.timer", "xmesh-quota-v2-renewal.service",
         "xmesh-quota-v2-ingress.service", "xmesh-quota-v2-meter.service")
METER_UNIT = UNITS[-1]
REFUSAL = b"ValueError: measured Xray genesis requires a network-isolated nonrestarting candidate"


def stopped_original(guest, original):
    container, started, _pid, _runtime = original
    row = json.loads(guest.exec("docker", "inspect", "--type", "container",
                               "--format", "{{json .}}", container))
    state = row["State"]
    assert row["Id"] == container and row["Name"] == "/xmesh-managed-xray"
    assert state["StartedAt"] == started and state["Running"] is False
    assert state["Restarting"] is False and type(state["Pid"]) is int and state["Pid"] == 0
    assert state["ExitCode"] == 137
    assert row["HostConfig"]["NetworkMode"] == "none"
    assert row["HostConfig"]["RestartPolicy"]["Name"] == "no"
    managed = guest.exec("docker", "ps", "-a", "--no-trunc", "--format",
                         "{{.ID}} {{.Names}}").splitlines()
    actual = [line for line in managed if line.split(maxsplit=1)[1].startswith(b"xmesh-managed-xray")]
    assert actual == [(container + " xmesh-managed-xray").encode()]
    for port in (":443", ":28401"):
        assert not guest.exec("ss", "-Hltnp", "sport", "=", port).strip()


def historical_snapshot(guest, original):
    stopped_original(guest, original)
    record = read_private(guest, RECORD_DIR)
    ledger = read_private(guest, LEDGER_DIR)
    assert set(record) == {"retired-" + original[3] + ".json"}
    paths = [RECORD_DIR + "/" + name for name in sorted(record)]
    paths += [LEDGER_DIR + "/" + name for name in sorted(ledger)]
    stats = guest.exec("stat", "-c", "%d:%i:%u:%g:%a:%h:%s:%Y:%Z",
                       *paths)
    assert len(stats.splitlines()) == len(paths)
    return (record, ledger, stats, guest.exec("sha256sum", *FILES),
            json.loads(guest.exec(PRODUCT, "--identity")))


def exact_starter_refusal(guest, panel, original):
    # No systemd Restart=on-failure loop here. Execute the original,
    # qualified installed module directly with its real production-shaped
    # environment, and distinguish the exact stopped-runtime check from
    # generic network/PQ/expiry/configuration failures.
    require_live()
    stopped_original(guest, original)
    answer = subprocess.run(
        ["docker", "exec", guest.name, "env", "XMESH_QUOTA_V2_AGENT_MODE=installed",
         "python3", "-B", STARTER, "--panel", panel, "--node", str(guest.node)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
    assert answer.returncode == 1
    assert answer.stderr.splitlines()[-1] == REFUSAL
    stopped_original(guest, original)


def systemd_refused(guest, since):
    status = guest.exec("systemctl", "show", METER_UNIT, "-p",
                        "LoadState,Result,ExecMainStatus")
    fields = dict(line.split(b"=",1) for line in status.splitlines())
    assert fields[b"LoadState"] == b"loaded"
    # A successful oneshot would contradict retirement; only a specific
    # real start failure is accepted, not a disabled/missing service.
    if fields.get(b"Result") != b"exit-code" or fields.get(b"ExecMainStatus") != b"1":
        return False
    logs = guest.exec("journalctl", "--no-pager", "-o", "cat", "-u", METER_UNIT,
                      "--since", "@" + since, "-n", "80")
    return REFUSAL in logs.splitlines()


def stop_retrying(guest):
    # This is test cleanup after the expected observed failure, NOT a mask
    # or reset of the installed starter before the recovery test.
    guest.exec("systemctl", "stop", *UNITS, timeout=40)
    for unit in UNITS:
        status = guest.exec("systemctl", "show", unit, "-p", "LoadState,ActiveState,SubState")
        fields = dict(line.split(b"=",1) for line in status.splitlines())
        assert fields[b"LoadState"] == b"loaded"
        assert (fields[b"ActiveState"], fields[b"SubState"]) in (
            (b"inactive", b"dead"), (b"failed", b"failed"))
    for unit in UNITS[1:]:
        assert guest.exec("systemctl", "show", unit, "-p", "MainPID", "--value").strip() == b"0"


def reboot_refusal(guest, panel, original, lab):
    require_live()
    before = historical_snapshot(guest, original)
    for unit in (METER_UNIT, "xmesh-quota-v2-ingress.service",
                 "xmesh-quota-v2-renewal.timer"):
        guest.exec("systemctl", "is-enabled", "--quiet", unit)
    exact_starter_refusal(guest, panel, original)
    assert historical_snapshot(guest, original) == before
    since = guest.exec("date", "+%s").strip().decode("ascii")
    assert since.isascii() and since.isdecimal()
    guest.restart()
    assert guest.exec("readlink", "/proc/1/exe").strip().endswith(b"/systemd")
    guest.exec(PRODUCT, "verify-active", "--panel", panel, "--node-id", str(guest.node), timeout=45)
    # The actual enabled systemd starter must refuse on the persistent
    # retired ledger. Do not accept merely finding the old container down.
    lab.wait_for(lambda: systemd_refused(guest, since),
                 timeout=60, label=f"retired meter startup refusal on Node {guest.node}")
    stopped_original(guest, original)
    stop_retrying(guest)
    assert historical_snapshot(guest, original) == before
    print(f"PASS: Node {guest.node} actual starter and enabled reboot recovery refused the "
          "retired original; activation, private retirement record and all ledger inodes/bytes "
          "survived without an Xray replacement or listener.", flush=True)


def verify_recovery_pair(pair, panel, initial, lab):
    require_live()
    parallel(lambda item: reboot_refusal(item[0], panel, item[1], lab),
             zip(pair, initial))
