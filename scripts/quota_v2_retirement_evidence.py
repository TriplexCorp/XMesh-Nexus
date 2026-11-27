"""Independent runner-side check of the private historical retirement record.

The Node verifier and its journal helpers are intentionally not imported here.
Only the hosted installed rehearsal calls this code. It does not produce a
Node signature, delivered-byte assertion, terminal settlement or authority.
"""
import base64
import hashlib
import json
import re
import tempfile
import uuid
from pathlib import Path

from quota_v2_installed_genesis_lease import canonical, independent_signature

RECORD_DIR = "/var/lib/xmesh-ci-first-meter-retirement"
LEDGER_DIR = "/var/lib/xmesh-first-meter/runtime/ledger"
INVENTORY = "xmesh-meter-inventory-v1.jsonl"
LOCK = "xray-instance.lock"
DOMAIN = b"XMESH_QUOTA_V2_PUBLIC_TLS_WAL_HEAD_V2\x00"
NAMESPACE = uuid.UUID("74df852d-a5a6-47d8-bac9-55f84d9b102a")
HASH = re.compile(r"[0-9a-f]{64}\Z")
MAX_BYTES = 4 << 20

# A bounded raw reader in a separate guest invocation, with no imported
# Node verifier, no caller-provided file names, and no mutation.
READ_PRIVATE = r"""
import base64
import json
import os
import stat
import sys

path = sys.argv[1]
assert os.geteuid() == 0 and os.getegid() == 0
assert os.path.realpath(path) == path
fd = os.open(path, os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    directory = os.fstat(fd)
    assert (stat.S_ISDIR(directory.st_mode) and directory.st_uid == 0
            and stat.S_IMODE(directory.st_mode) == 0o700)
    names = sorted(os.listdir(fd))
    assert 0 < len(names) <= 32
    total, seen, result = 0, {}, {}

    def identity(info):
        return (info.st_dev, info.st_ino, info.st_mode, info.st_uid,
                info.st_gid, info.st_size, info.st_nlink, info.st_mtime_ns,
                info.st_ctime_ns)

    for name in names:
        before = os.stat(name, dir_fd=fd, follow_symlinks=False)
        assert (stat.S_ISREG(before.st_mode) and before.st_uid == 0
                and before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == 0o600)
        total += before.st_size
        assert total <= 4 << 20
        seen[name] = identity(before)
        with os.fdopen(os.open(name, os.O_RDONLY | os.O_NOFOLLOW |
                               os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=fd), "rb") as f:
            assert identity(os.fstat(f.fileno())) == seen[name]
            raw = f.read(before.st_size + 1)
            assert len(raw) == before.st_size
            assert identity(os.fstat(f.fileno())) == seen[name]
        result[name] = base64.b64encode(raw).decode("ascii")
    assert sorted(os.listdir(fd)) == names
    for name, expected in seen.items():
        assert identity(os.stat(name, dir_fd=fd, follow_symlinks=False)) == expected
    assert identity(os.stat(path, follow_symlinks=False)) == identity(directory)
    print(json.dumps(result, separators=(",", ":")))
finally:
    os.close(fd)
"""


def strict(raw):
    def pairs(values):
        obj = {}
        for key, value in values:
            assert key not in obj, "duplicate JSON evidence key"
            obj[key] = value
        return obj

    def invalid(_):
        raise AssertionError("nonfinite JSON evidence")
    obj = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)
    assert isinstance(obj, dict)
    return obj


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_private(guest, directory):
    assert directory in (RECORD_DIR, LEDGER_DIR)
    encoded = strict(guest.exec("python3", "-I", "-B", "-c", READ_PRIVATE,
                                directory, timeout=15))
    raw = {name: base64.b64decode(value, validate=True)
           for name, value in encoded.items()}
    assert 0 < len(raw) <= 32 and sum(map(len, raw.values())) <= MAX_BYTES
    return raw


def verify_record(raw, result, expected, earliest, latest):
    assert 0 < len(raw) <= 8192
    record = strict(raw)
    assert set(record) == {"observation", "nexusResponse"}
    assert raw == canonical(record) + b"\n"
    assert record["observation"] == result
    assert canonical(record["observation"]) == canonical(result)
    response = record["nexusResponse"]
    assert isinstance(response, str) and 0 < len(response.encode()) <= 8192
    assert sha(response.encode()) == result["signedWalReadbackSha256"]
    outer = strict(response)
    assert set(outer) == {"signedEnvelope"} and isinstance(outer["signedEnvelope"], str)
    envelope = strict(outer["signedEnvelope"])
    assert set(envelope) == {"algorithm", "payload", "signature"}
    assert envelope["algorithm"] == "Ed25519"
    assert re.fullmatch(r"[0-9a-f]{128}", envelope["signature"])
    assert outer["signedEnvelope"].encode() == canonical(envelope) + b"\n"
    payload = envelope["payload"]
    fields = {
        **expected, "schemaVersion": 2, "kind": "xmesh.quota-v2.public-tls-wal-head",
        "historyState": "committed_birth_index",
        "preBootstrapHistoryCompletenessVerified": False, "liveMeterVerified": False,
        "finalMeterVerified": False, "canServePublic": False, "canSpend": False,
        "canStart": False, "canResume": False, "authorizedBytes": 0, "refundableBytes": 0,
    }
    assert set(payload) == set(fields) | {"challenge", "issuedAtMs", "validUntilMs"}
    assert all(type(payload[k]) is type(v) and payload[k] == v for k, v in fields.items())
    assert HASH.fullmatch(payload["challenge"])
    issued, end = payload["issuedAtMs"], payload["validUntilMs"]
    assert type(issued) is type(end) is int and earliest <= issued <= latest
    assert 0 < end - issued <= 7000
    # Historical evidence is verified after exit, so expiry now is not
    # treated as authorization; the Node verified freshness BEFORE fencing.
    with tempfile.TemporaryDirectory(prefix="xmesh-independent-retirement-") as tmp:
        independent_signature(Path(tmp), "retirement-readback", envelope, DOMAIN)
    return payload


def go_json(doc):
    # All fields used here are canonical ASCII identifiers and integers.
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False).encode() + b"\n"


def verify_ledger(ledger, caps, streams, inventory, result, node, runtime):
    """Check exact committed SQL bytes and independently rebuild every deny."""
    births = {}
    for raw in inventory.splitlines(keepends=True):
        birth = strict(raw)
        assert go_json(birth) == raw
        assert birth["filename"] not in births
        births[birth["filename"]] = raw
    assert set(births) == set(streams) and len(streams) == 2
    expected = {LOCK: b"", INVENTORY: inventory, **streams}
    tails = {}
    for name, raw in streams.items():
        assert re.fullmatch(r"meter-[0-9a-f]{64}\.jsonl", name)
        head = strict(raw.splitlines()[-1])
        scope = (head["email"], head["direction"])
        assert head["runtimeId"] == runtime and scope not in tails
        assert head["direction"] in ("uplink", "downlink")
        assert type(head["nextBytes"]) is int and head["nextBytes"] > 0
        tails[scope] = head["nextBytes"]

    covered = set()
    denials = {}
    for uid, raw in sorted(caps.items()):
        cap = strict(raw)["payload"]
        assert type(uid) is int and cap["userId"] == uid
        assert cap["nodeId"] == node and cap["runtimeId"] == runtime
        aliases = sorted(item["email"] for item in cap["aliasScopes"])
        assert aliases and len(set(aliases)) == len(aliases)
        assert all(email.startswith(f"xmesh-u{uid}--vless-") for email in aliases)
        expected[f"positive-cap-u{uid}.json"] = raw
        scope = dict(email=aliases[0], nodeId=node, userId=uid,
                     epoch=cap["accountEpoch"], meterEpoch=cap["meterEpoch"],
                     reservationId=cap["reservationId"], revision=cap["reservationRevision"],
                     revocationId=str(uuid.uuid5(NAMESPACE, runtime + ":" + cap["reservationId"])))
        rows = []
        for alias in aliases:
            row = {"email": alias}
            for direction in ("uplink", "downlink"):
                key = (alias, direction)
                row[direction + "Bytes"] = tails.get(key, 0)
                if key in tails:
                    covered.add(key)
            rows.append(row)
        fence = go_json(dict(scope, schemaVersion=1))
        checkpoint = go_json(dict(
            scope, schemaVersion=3, runtimeId=runtime,
            uplinkBytes=sum(row["uplinkBytes"] for row in rows),
            downlinkBytes=sum(row["downlinkBytes"] for row in rows), inboundMeters=rows,
            drained=True, finalMeterVerified=False, refundableBytes=0))
        stem = sha(f"xmesh-u{uid}".encode("ascii"))
        expected[f"fence-{stem}.json"] = fence
        expected[f"observed-{stem}.json"] = checkpoint
        own = [name for name, raw in sorted(births.items()) if strict(raw)["email"] in aliases]
        meter = (b"".join(name.encode("ascii") + b":" + sha(streams[name]).encode("ascii") + b"\n"
                          for name in own)
                 + b"|fsynced-meter-inventory-v1|" + b"".join(births[name] for name in own))
        denials[str(uid)] = sha(fence + checkpoint + b"|conservative-meter-WAL-v1|" + meter)

    assert covered == set(tails), "SQL committed stream outside complete signed roster"
    assert ledger == expected, "retired private ledger differs from exact committed SQL bytes or scoped denial"
    assert denials == result["durableUserDenials"]
    manifest = [{"filename": name, "sha256": sha(raw)} for name, raw in sorted(ledger.items())]
    assert sha(canonical(manifest)) == result["retiredLedgerSha256"]
