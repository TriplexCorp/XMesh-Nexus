"""Exercise the actual installed first-Genesis meter, NOT public TLS.

The egress bridge deliberately refuses private destinations. Use an exact
synthetic local /32 in each throwaway guest, guarded by OUTPUT and FORWARD
reject rules installed before the alias. Never weaken the real bridge,
contact a public service, or send a packet outside the guest.
"""
import hashlib
import json
import os
import re
import subprocess

from quota_v2_installed_tls_wal_readback import (
    INSTALLED_ROOT, INSTALLED_WAL, INVENTORY, LEDGER, STATE, WORK,
    parallel, require_disposable, require_loopback_ingress, verify_readback,
)

# Xray a4a3dff5b20c2faae567b742c172c7b95e75c083 explicitly blocks
# PCP anycast 192.0.0.9/32 in its default freedom private-IP matcher,
# even though Python ipaddress marks it global. Use an ordinary global
# address exclusively as a synthetic guest loopback alias, NEVER contact
# its public service. Both egress guards remain until guest destruction.
TARGET = "1.1.1.1"
PAYLOAD_BYTES = 16 * 1024

# Executed inside the outer guest alongside the installed egress bridge.
# The real Xray child remains in its own network=none namespace; this small
# client uses a real attested Xray SOCKS->VLESS connection to the loopback
# frontend. It creates no WAL files, counters, signatures, or substitute meter.
CLIENT = r"""
import concurrent.futures
import ipaddress
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import time
import uuid

def exact(sock, count):
    data = bytearray()
    while len(data) < count:
        block = sock.recv(count - len(data))
        if not block:
            raise EOFError("premature end of actual VLESS TCP stream")
        data += block
    return bytes(data)

def socks_request(target, port):
    return b"\x05\x01\x00\x01" + socket.inet_aton(target) + struct.pack("!H", port)

def stream(target, port, socks_port):
    client = socket.create_connection(("127.0.0.1", socks_port), timeout=15)
    try:
        client.sendall(b"\x05\x01\x00")
        assert exact(client, 2) == b"\x05\x00", "SOCKS no-auth handshake refused"
        client.sendall(socks_request(target, port))
        header = exact(client, 4)
        assert header[:3] == b"\x05\x00\x00", ("SOCKS connect refused", header)
        if header[3] == 3:
            size = exact(client, 1)[0]
        else:
            size = {1: 4, 4: 16}[header[3]]
        exact(client, size + 2)
        return client
    except BaseException:
        client.close()
        raise

def main():
    target, identity, size, binary = sys.argv[1:]
    assert ipaddress.ip_address(target).is_global and str(uuid.UUID(identity)) == identity
    size = int(size)
    assert size == 16384
    payload = bytes(range(256)) * (size // 256)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.settimeout(20)
        listener.bind((target, 0))
        listener.listen(1)
        port = listener.getsockname()[1]

        def echo():
            conn, peer = listener.accept()
            with conn:
                conn.settimeout(15)
                assert conn.getsockname()[0] == target
                assert peer[0] == target or ipaddress.ip_address(peer[0]).is_loopback
                print("synthetic echo accepted real bridge", file=sys.stderr, flush=True)
                received = bytearray()
                while len(received) < size:
                    block = conn.recv(size - len(received))
                    if not block:
                        raise EOFError("actual echo closed before full payload")
                    received += block
                    conn.sendall(block)
                assert received == payload
                print("synthetic echo verified full payload", file=sys.stderr, flush=True)

        # Use the real independently qualified Xray in ordinary client
        # mode (no meter or production ingress role), as in the existing
        # generation rehearsals. The SOCKS control remains guest loopback.
        socks_port = 28411
        config = {
            "log": {"loglevel": "debug"},
            "inbounds": [{"tag": "local-socks", "listen": "127.0.0.1", "port": socks_port,
                          "protocol": "socks", "settings": {"auth": "noauth"}}],
            "outbounds": [{"tag": "vless", "protocol": "vless", "settings": {"vnext": [
                {"address": "127.0.0.1", "port": 28401,
                 "users": [{"id": identity, "encryption": "none"}]}
            ]}}],
        }
        with tempfile.TemporaryDirectory(prefix="xmesh-local-vless-client-") as directory:
            root = Path(directory)
            path = root / "client.json"
            path.write_text(json.dumps(config), encoding="utf-8")
            with (root / "client.log").open("w+") as log:
                process = subprocess.Popen([binary, "run", "-config", str(path)], stdout=log,
                                           stderr=subprocess.STDOUT, env={"PATH": "/usr/bin:/bin"})
                try:
                    until = time.monotonic() + 8
                    while time.monotonic() < until:
                        assert process.poll() is None, "actual Xray client exited"
                        try:
                            with socket.create_connection(("127.0.0.1", socks_port), timeout=1):
                                break
                        except OSError:
                            time.sleep(0.1)
                    else:
                        raise AssertionError("actual Xray SOCKS client never bound loopback")
                    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                        future = pool.submit(echo)
                        try:
                            with stream(target, port, socks_port) as client:
                                client.settimeout(15)
                                print("SOCKS client connected to actual VLESS", file=sys.stderr, flush=True)
                                for offset in range(0, size, 4096):
                                    chunk = payload[offset:offset + 4096]
                                    client.sendall(chunk)
                                    assert exact(client, len(chunk)) == chunk, "incorrect echo"
                            future.result(timeout=20)
                        except BaseException:
                            if future.done():
                                print("echo result:", repr(future.exception()),
                                      file=sys.stderr, flush=True)
                            raise
                except BaseException:
                    log.seek(0)
                    print(log.read()[-12000:].replace(identity, "[disposable-uuid]"),
                          file=sys.stderr, flush=True)
                    raise
                finally:
                    if process.poll() is None:
                        process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=3)
    print("actual_vless_echo_verified")

if __name__ == "__main__":
    main()
"""

CHARGE = r"""
from pathlib import Path
import sys
import stat

installed, panel, node, state = sys.argv[1:]
sys.path.insert(0, installed)
import charge_worker
for module in (charge_worker, charge_worker.wal_transport,
               charge_worker.registry, charge_worker.journal):
    path = Path(module.__file__)
    assert path.resolve(strict=True) == path and path.parent == Path(installed)
    info = path.stat()
    assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
failed = set()
assert charge_worker.run(panel, int(node), state, failed_users=failed) >= 2
assert not failed, failed
# An exact repeat through the real installed worker must not charge again.
assert charge_worker.run(panel, int(node), state, failed_users=failed) == 0
assert not failed, failed
print("actual_installed_wal_charges_committed_once")
"""


def require_traffic_scenario():
    require_disposable()
    from quota_v2_installed_tls_wal_readback import TRAFFIC_SCENARIOS
    assert os.environ["XMESH_RELEASE_QUALIFICATION_SCENARIO"] in TRAFFIC_SCENARIOS


def isolate_target(guest):
    require_traffic_scenario()
    assert guest.exec("docker", "inspect", "-f", "{{.HostConfig.NetworkMode}}",
                      "xmesh-managed-xray").strip() == b"none"
    assert not guest.exec("docker", "port", "xmesh-managed-xray").strip()
    bridge_pid = int(guest.exec("systemctl", "show", "xmesh-quota-v2-egress.service",
                                "-p", "MainPID", "--value"))
    assert bridge_pid > 1
    assert guest.exec("readlink", f"/proc/{bridge_pid}/ns/net") == guest.exec(
        "readlink", "/proc/1/ns/net")
    # Refuse any existing alias; never send traffic until both guards and
    # the route are installed and verified. Keeping them for the remaining
    # short guest lifetime also blocks any delayed egress retransmission.
    assert not any(
        a.get("local") == TARGET
        for link in json.loads(guest.exec("ip", "-j", "addr", "show"))
        for a in link.get("addr_info", [])
    )
    output_rule = ("-d", TARGET + "/32", "!", "-o", "lo", "-j", "REJECT")
    forward_rule = ("-d", TARGET + "/32", "-j", "REJECT")
    for chain, rule in (("OUTPUT", output_rule), ("FORWARD", forward_rule)):
        guest.exec("iptables", "--wait", "5", "-I", chain, "1", *rule)
        guest.exec("iptables", "--wait", "5", "-C", chain, *rule)
    guest.exec("ip", "addr", "add", TARGET + "/32", "dev", "lo")
    route, = json.loads(guest.exec("ip", "-j", "route", "get", TARGET))
    assert (route.get("type"), route.get("dev"), route.get("prefsrc")) == (
        "local", "lo", TARGET), route
    return output_rule, forward_rule


def isolated_vless(guest, identity, user_id):
    output_rule, forward_rule = isolate_target(guest)
    # Check the exact private ingress remains the only intended listen bind.
    require_loopback_ingress(guest)
    # Verify the actual route published by the installed cap worker rather
    # than relying only on the positive cap's existence.
    pid = int(guest.exec("docker", "inspect", "-f", "{{.State.Pid}}", "xmesh-managed-xray"))
    route_target = guest.exec("readlink", STATE + f"/ingress-u{user_id}").strip().decode()
    assert re.fullmatch(rf"/proc/{pid}/root/dev/shm/xmesh-[0-9a-f]{{64}}", route_target), route_target
    binary = "/usr/local/libexec/xmesh-metered-xray"
    assert guest.exec("sha256sum", binary).split()[0].decode() == os.environ["XMESH_WAL_XRAY_SHA256"]
    try:
        result = guest.exec("python3", "-I", "-B", "-c", CLIENT,
                            TARGET, identity, str(PAYLOAD_BYTES), binary, timeout=65)
        assert result.strip() == b"actual_vless_echo_verified", result
        verify_isolated_target(guest, output_rule, forward_rule)
    except (AssertionError, OSError, subprocess.SubprocessError):
        # Capture the installed data path before the guest is destroyed.
        # No private keys, token files, full profile or grant are dumped.
        for command in (
            ("journalctl", "--no-pager", "-n", "100",
             "-u", "xmesh-quota-v2-ingress.service", "-u", "xmesh-quota-v2-egress.service",
             "-u", "xmesh-quota-v2-meter.service", "-u", "xmesh-quota-v2-renewal.service"),
            ("docker", "logs", "--tail", "100", "xmesh-managed-xray"),
            ("ls", "-lA", LEDGER),
            ("ls", "-lA", route_target),
            ("iptables", "--wait", "5", "-nvL", "OUTPUT"),
            ("ss", "-Hxlpn"),
        ):
            try:
                raw = guest.exec(*command, timeout=10).decode(errors="replace")
                print(f"Node {guest.node} diagnostic {command[0]}: " +
                      raw[-18000:].replace(identity, "[disposable-uuid]"), flush=True)
            except (OSError, subprocess.SubprocessError):
                print(f"Node {guest.node} no diagnostic: {command[0]}", flush=True)
        raise


def verify_isolated_target(guest, output_rule, forward_rule):
    # Verify unchanged local-only route and first-position reject
    # guards with zero rejected packets after actual data transfer.
    after, = json.loads(guest.exec("ip", "-j", "route", "get", TARGET))
    assert (after.get("type"), after.get("dev"), after.get("prefsrc")) == (
        "local", "lo", TARGET), after
    rules = guest.exec("iptables-save", "-c", "-t", "filter").decode().splitlines()
    for chain, rule in (("OUTPUT", output_rule), ("FORWARD", forward_rule)):
        guest.exec("iptables", "--wait", "5", "-C", chain, *rule)
        first = next(line for line in rules if re.match(r"^\[\d+:\d+\] -A " + chain + r" ", line))
        expected = "[0:0] -A " + chain + " " + " ".join(rule)
        assert first == expected + " --reject-with icmp-port-unreachable" or first == expected, first


def measure_local(guest, user_id, tag):
    # Independently require exactly the two actual directions, original
    # subscriber and measured payload, rather than treating nonempty files
    # as successful metering. The dormant verifier subsequently verifies
    # complete canonical WAL hash chains and all live-meter counters.
    inventory = guest.exec("cat", LEDGER + "/" + INVENTORY.decode("ascii"))
    entries = [json.loads(line) for line in inventory.splitlines()]
    assert len(entries) == 2
    assert {item["direction"] for item in entries} == {"uplink", "downlink"}
    assert {item["email"] for item in entries} == {f"xmesh-u{user_id}--{tag}"}
    filenames = [item["filename"] for item in entries]
    assert len(set(filenames)) == 2
    for item in entries:
        name = item["filename"]
        assert re.fullmatch(r"meter-[0-9a-f]{64}\.jsonl", name)
        journal = guest.exec("cat", LEDGER + "/" + name)
        last = json.loads(journal.splitlines()[-1])
        assert last["nextBytes"] == PAYLOAD_BYTES, (guest.node, item["direction"], last["nextBytes"])
        assert last["email"] == item["email"] and last["direction"] == item["direction"]
    return inventory, filenames


def charge(guest, panel):
    require_traffic_scenario()
    guest.exec("git", "-C", INSTALLED_ROOT, "diff", "--quiet", "HEAD", "--",
               "experiments/quota-v2-physical-stop")
    result = guest.exec("env", "XMESH_QUOTA_V2_AGENT_MODE=installed",
                        "python3", "-I", "-B", "-c", CHARGE, INSTALLED_WAL,
                        panel, str(guest.node), STATE, timeout=100)
    assert result.splitlines()[-1] == b"actual_installed_wal_charges_committed_once", result


def verify_spent_pair(pair, users, panel, db, lab, *, native_traffic=None):
    require_traffic_scenario()
    user_ids = list(users)
    user_id, peer_id = user_ids
    tags = dict(zip((g.node for g in pair), ("vless-main", "vless-cdn")))

    expected_authorities = []

    def authority_state():
        return db.execute("SELECT node_id,signed_envelope FROM quota_v2_public_tls_authority_outbox ORDER BY node_id").fetchall()

    def no_remote():
        assert authority_state() == expected_authorities
        for table in ("quota_v2_external_wal_birth_anchors", "quota_v2_wal_charges"):
            assert db.execute("SELECT count(*) FROM " + table).fetchone() == (0,)

    no_remote()
    if native_traffic is None:
        parallel(lambda guest: isolated_vless(guest, users[user_id], user_id), pair)
    else:
        expected_authorities = native_traffic(pair, users, panel, db, lab, tags)
    measurements = parallel(lambda guest: measure_local(guest, user_id, tags[guest.node]), pair)
    no_remote()
    verify_readback(pair, user_ids, panel, lab, WORK, phase="unsynced")
    no_remote()
    parallel(lambda guest: charge(guest, panel), pair)
    # The actual immutable Nexus receipt table must agree with every
    # real local stream (including CDN categorization), the exact inventory,
    # and the unspent second subscriber; duplicate submission adds nothing.
    expected_charges = sorted(
        (guest.node, user_id, name, tags[guest.node] == "vless-cdn", PAYLOAD_BYTES)
        for guest, (_, names) in zip(pair, measurements) for name in names
    )
    # stream_bytes is a cumulative stream head, not a per-batch delta.
    charge_sql = (
        "SELECT DISTINCT ON (r.node_id,r.user_id,c.filename) "
        "r.node_id,r.user_id,c.filename,c.is_cdn,c.stream_bytes "
        "FROM quota_v2_wal_charges c JOIN quota_v2_reservations r USING(reservation_id) "
        "ORDER BY r.node_id,r.user_id,c.filename,c.first_sequence DESC"
    )
    assert db.execute(charge_sql).fetchall() == expected_charges
    for guest, (inventory, _) in zip(pair, measurements):
        seq, digest, raw = db.execute(
            "SELECT inventory_sequence,inventory_sha256,inventory_bytes "
            "FROM quota_v2_external_wal_birth_anchors WHERE node_id=%s "
            "ORDER BY inventory_sequence DESC LIMIT 1", (guest.node,)
        ).fetchone()
        assert seq == 2 and digest == hashlib.sha256(inventory).hexdigest() and bytes(raw) == inventory
    # Intent accounting advances the conservative floor, not confirmed
    # delivered-byte acknowledgements or terminal settlement authority.
    balances = db.execute(
        "SELECT node_id,user_id,SUM(acknowledged_bytes),"
        "SUM(conservative_burn_floor_bytes) FROM quota_v2_reservations "
        "GROUP BY node_id,user_id ORDER BY node_id,user_id"
    ).fetchall()
    assert balances == sorted(
        (guest.node, uid, 0, 2 * PAYLOAD_BYTES if uid == user_id else 0)
        for guest in pair for uid in (user_id, peer_id)
    ), balances
    assert db.execute(
        "SELECT user_id,SUM(settled_bytes),SUM(observed_floor_bytes) "
        "FROM quota_v2_accounts GROUP BY user_id ORDER BY user_id"
    ).fetchall() == sorted(((user_id, 4 * PAYLOAD_BYTES, 0), (peer_id, 0, 0)))
    verify_readback(pair, user_ids, panel, lab, WORK, phase="committed")
    assert parallel(lambda guest: measure_local(guest, user_id, tags[guest.node]), pair) == measurements
    assert db.execute(charge_sql).fetchall() == expected_charges
    assert authority_state() == expected_authorities
    print("PASS: both installed Nodes independently reconciled actual VLESS main/CDN bytes, "
          "refused stale remote history, and verified the committed nonempty signed WAL; "
          "no production public TLS authority.", flush=True)
