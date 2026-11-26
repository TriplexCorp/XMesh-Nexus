"""Exercise the actual installed first-Genesis meter, NOT public TLS.

The egress bridge deliberately refuses private destinations. Use an exact
synthetic local /32 in each throwaway guest, guarded by OUTPUT and FORWARD
reject rules installed before the alias. Never weaken the real bridge, use
a public destination, or send a packet outside the guest.
"""
import hashlib
import json
import os
import re

from quota_v2_installed_tls_wal_readback import (
    INSTALLED_ROOT, INSTALLED_WAL, INVENTORY, LEDGER, STATE, WORK,
    parallel, require_disposable, require_loopback_ingress, verify_readback,
)

# IANA special-purpose PCP anycast address, considered global by Python's
# ipaddress. This is an isolated synthetic echo endpoint, NOT the real
# service at that address. Both guards remain until guest destruction.
TARGET = "192.0.0.9"
PAYLOAD_BYTES = 16 * 1024

# Executed inside the outer guest alongside the installed egress bridge.
# The real Xray child remains in its own network=none namespace; this small
# client speaks the actual VLESS TCP wire protocol over the loopback frontend.
# It creates no WAL files, counters, signed documents, or substitute meter.
CLIENT = r"""
import concurrent.futures
import ipaddress
import socket
import struct
import sys
import uuid

def exact(sock, count):
    data = bytearray()
    while len(data) < count:
        block = sock.recv(count - len(data))
        if not block:
            raise EOFError("premature end of actual VLESS TCP stream")
        data += block
    return bytes(data)

def vless_header(identity, target, port):
    # version, UUID, zero addons, TCP command, port, IPv4 type, IP.
    return (b"\x00" + uuid.UUID(identity).bytes + b"\x00\x01" +
            struct.pack("!H", port) + b"\x01" + socket.inet_aton(target))


def main():
    target, identity, size = sys.argv[1:]
    assert ipaddress.ip_address(target).is_global
    size = int(size)
    assert size == 16384
    payload = bytes(range(256)) * (size // 256)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.settimeout(25)
        listener.bind((target, 0))
        listener.listen(1)
        port = listener.getsockname()[1]

        def echo():
            conn, peer = listener.accept()
            with conn:
                conn.settimeout(20)
                # The bridge must have dialed this synthetic guest-local alias.
                assert conn.getsockname()[0] == target
                assert peer[0] == target or ipaddress.ip_address(peer[0]).is_loopback
                data = exact(conn, size)
                assert data == payload
                conn.sendall(data)

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(echo)
            with socket.create_connection(("127.0.0.1", 28401), timeout=25) as client:
                client.settimeout(25)
                client.sendall(vless_header(identity, target, port) + payload)
                assert exact(client, 2) == b"\x00\x00", "not a VLESS response"
                assert exact(client, size) == payload, "wrong actual echo payload"
            future.result(timeout=25)
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
    assert os.environ["XMESH_RELEASE_QUALIFICATION_SCENARIO"] == "public-tls-wal-nonempty"


def isolated_vless(guest, identity):
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
    assert route.get("type") == "local" and route.get("dev") == "lo", route
    # Check the exact private ingress remains the only intended listen bind.
    require_loopback_ingress(guest)
    result = guest.exec("python3", "-I", "-B", "-c", CLIENT,
                        TARGET, identity, str(PAYLOAD_BYTES), timeout=80)
    assert result.strip() == b"actual_vless_echo_verified", result


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


def verify_spent_pair(pair, users, panel, db, lab):
    require_traffic_scenario()
    user_ids = list(users)
    user_id, peer_id = user_ids
    tags = dict(zip((g.node for g in pair), ("vless-main", "vless-cdn")))

    def no_remote():
        for table in ("quota_v2_external_wal_birth_anchors", "quota_v2_wal_charges",
                      "quota_v2_public_tls_authority_outbox"):
            assert db.execute("SELECT count(*) FROM " + table).fetchone() == (0,)

    no_remote()
    parallel(lambda guest: isolated_vless(guest, users[user_id]), pair)
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
    assert db.execute("SELECT count(*) FROM quota_v2_public_tls_authority_outbox").fetchone() == (0,)
    print("PASS: both installed Nodes independently reconciled actual VLESS main/CDN bytes, "
          "refused stale remote history, and verified the committed nonempty signed WAL "
          "with no public TLS authority.", flush=True)
