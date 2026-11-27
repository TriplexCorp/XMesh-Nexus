"""Hosted-only real native TLS -> installed ordinary meter -> PostgreSQL.

Positive authority is deliberately a disposable fixture, NOT an issuer.
The live revocation endpoint and strict-PQ enrolled RPC are unmodified.
"""
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import secrets
import select
import subprocess
import sys
import time

from quota_v2_installed_genesis_lease import canonical, independent_signature, parallel
from quota_v2_installed_namespace_candidate import PROOF, file_digest, reviewed_checkout
from quota_v2_installed_tls_wal_readback import require_disposable, require_loopback_ingress
from quota_v2_installed_tls_wal_traffic import isolate_target, verify_isolated_target

REV = "4eb388a9d7977138ad635204e6358ff6d51976fe"
GUEST_SCRIPT = Path(__file__).with_name("quota_v2_native_tls_guest.py")
TARGET_SCRIPT = PROOF + "/quota_v2_native_tls_guest.py"
ENV = ("env", "GITHUB_ACTIONS=true", "RUNNER_ENVIRONMENT=github-hosted",
       "XMESH_AUDIT_DISPOSABLE=1", "XMESH_RELEASE_QUALIFICATION_SCENARIO=public-tls-native-live",
       "XMESH_DISPOSABLE_BOUND_LISTENER_TEST=1", "XMESH_QUOTA_V2_AGENT_MODE=installed")
COMMAND = (*ENV, "python3", "-I", "-B", TARGET_SCRIPT)


def require_live():
    require_disposable()
    assert os.environ["XMESH_RELEASE_QUALIFICATION_SCENARIO"] == "public-tls-native-live"


def prepare_live(guest, lab, tag):
    require_live()
    # This is a separately pinned reviewed diagnostic, never a replacement
    # of the product Agent's checked-out files or operational installer.
    source = reviewed_checkout("XMESH_NATIVE_LIVE_SOURCE", REV)
    for item in sorted((source / "experiments/quota-v2-physical-stop").glob("public_tls*.py")):
        if item.name == "public_tls_wal_watch.py":
            continue  # preserve the independent earlier reviewed WAL diagnostic
        target = PROOF + "/" + item.name
        if item.name == "public_tls_executable.py":
            # Already copied from #236 for the independent dual-artifact test.
            assert guest.exec("sha256sum", target).split()[0].decode() == file_digest(item)
            continue
        guest.exec("test", "!", "-e", target)
        lab.docker("cp", str(item), f"{guest.name}:{target}")
        guest.exec("chown", "0:0", target)
        guest.exec("chmod", "0600", target)
        assert guest.exec("sha256sum", target).split()[0].decode() == file_digest(item)
    lab.docker("cp", str(GUEST_SCRIPT), f"{guest.name}:{TARGET_SCRIPT}")
    guest.exec("chown", "0:0", TARGET_SCRIPT)
    guest.exec("chmod", "0600", TARGET_SCRIPT)
    assert guest.exec("sha256sum", TARGET_SCRIPT).split()[0].decode() == file_digest(GUEST_SCRIPT)
    # Certbot-shaped disposable lineage before the short-lived caps refresh.
    # The actual installed signed profile is independently rechecked later.
    # configure_pair defines the two disposable tags; the supervisor
    # independently authenticates the actual signed roster before bind.
    from quota_v2_native_tls_guest import domain
    assert tag in ("vless-main", "vless-cdn")
    assert domain(tag).endswith(".example.com")
    assert guest.exec(*COMMAND, "prepare", tag, timeout=60).strip() == b"native_fixture_lineage_ready"


def fixture_authority(db, scope, tag):
    require_live()
    from quota_v2_native_tls_guest import domain
    core = Path(os.environ["CORE_DATA_DIR"]).resolve(strict=True)
    root = core.parent
    assert root.name.startswith("xmesh-wal.")
    assert Path(os.environ["XMESH_TEST_POLICY_PUBLIC_KEY"]).resolve().parent == root
    assert os.environ["QUOTA_TEST_DSN"].endswith("@127.0.0.1:5432/quota_wal_installed")
    # The real SQL trigger takes the same exact original-roster locks.
    # Never change it/extend a signed cap for this fixture.
    assert scope["requiredLifetimeMs"] == 7000
    now, = db.execute("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT").fetchone()
    cap_end, = db.execute("SELECT min(valid_until_ms) FROM quota_v2_signed_first_cap_outbox WHERE node_id=%s",
                         (scope["nodeId"],)).fetchone()
    end = min(now + 60_000, cap_end - 2000)
    assert end >= now + 25_000, "insufficient live cap horizon for actual TLS rehearsal"
    payload = dict(schemaVersion=1, kind="xmesh.quota-v2.public-tls-ingress",
        nodeId=scope["nodeId"], activationReceiptSha256=scope["activationReceiptSha256"],
        genesisPolicySha256=scope["genesisPolicySha256"], runtimeId=scope["runtimeId"],
        profileRevision=scope["profileRevision"], issuedAtMs=now, validUntilMs=end, canServePublic=True,
        bindings=[{"tag":tag,"port":443,"domain":domain(tag)}])
    message = root / f"native-fixture-authority-{scope['nodeId']}.msg"
    message.write_bytes(canonical(payload))
    key_fd = os.memfd_create("xmesh-native-disposable-policy-key", os.MFD_CLOEXEC)
    try:
        secret = (core / "node-policy-ed25519.key").read_bytes()
        assert len(secret) == 32
        key = bytes.fromhex("302e020100300506032b657004220420") + secret
        assert os.write(key_fd, key) == len(key)
        os.lseek(key_fd, 0, os.SEEK_SET)
        signature = subprocess.check_output(["openssl", "pkeyutl", "-sign", "-rawin", "-keyform", "DER",
            "-inkey", f"/proc/self/fd/{key_fd}", "-in", str(message)],
            pass_fds=(key_fd,), timeout=5).hex()
    finally:
        os.close(key_fd)
    doc = {"algorithm":"Ed25519", "payload":payload, "signature":signature}
    independent_signature(root, f"native-fixture-authority-{scope['nodeId']}", doc)
    wire = canonical(doc)
    signer, = db.execute("SELECT DISTINCT signer_public_key FROM quota_v2_signed_first_cap_outbox WHERE node_id=%s",
                         (scope["nodeId"],)).fetchone()
    db.execute("INSERT INTO quota_v2_public_tls_authority_outbox("
               "node_id,request_challenge,activation_sha256,runtime_id,profile_revision,"
               "genesis_policy_sha256,signer_public_key,cap_roster_sha256,authority_sha256,"
               "issued_at_ms,valid_until_ms,signed_envelope)"
               " VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
               (scope["nodeId"], secrets.token_hex(32), scope["activationReceiptSha256"],
                scope["runtimeId"], scope["profileRevision"], scope["genesisPolicySha256"],
                signer, scope["capRosterSha256"], hashlib.sha256(wire).hexdigest(), now, end, wire))
    return wire


def wait_marker(child, marker, timeout=30):
    deadline = time.monotonic() + timeout
    buf = getattr(child, "_native_buffer", b"")
    while time.monotonic() < deadline:
        if b"\n" not in buf:
            if not select.select([child.stdout], [], [], max(0, deadline-time.monotonic()))[0]:
                break
            chunk = os.read(child.stdout.fileno(), 65536)
            if not chunk:
                break
            buf += chunk
            assert len(buf) <= 1 << 20
            continue
        line, buf = buf.split(b"\n", 1)
        child._native_buffer = buf
        if line.strip() == marker:
            return
        # no raw authority, key, or enrollment data in markers
        print("native diagnostic:", line[:1000].decode(errors="replace"), flush=True)
    raise AssertionError("missing exact installed native TLS guest marker " + repr(marker))


def native_traffic(pair, users, panel, db, lab, tags):
    require_live()
    import psycopg
    user = next(iter(users))
    scopes = parallel(lambda guest: json.loads(guest.exec(*COMMAND, "scope", panel,
                      str(guest.node), str(user), timeout=30)), pair)
    # Existing zero-authority WAL proof preceded this explicitly disposable
    # fixture. No actual production issuance path is enabled.
    assert db.execute("SELECT count(*) FROM quota_v2_public_tls_authority_outbox").fetchone() == (0,)
    for guest in pair:
        assert not guest.exec("ss", "-Hltnp", "sport", "=", ":443").strip()
    rules = parallel(isolate_target, pair)
    rows = []
    for guest, scope in zip(pair, scopes):
        assert scope["nodeId"] == guest.node and scope["userId"] == user
        wire = fixture_authority(db, scope, tags[guest.node])
        lab.docker("exec", "-i", guest.name, "bash", "-ec",
                   'umask 077; set -C; cat > "$1"', "--", PROOF + "/fixture-authority.json",
                   input=wire, timeout=10)
        assert guest.exec("sha256sum", PROOF + "/fixture-authority.json").split()[0].decode() == hashlib.sha256(wire).hexdigest()
        rows.append((guest.node, wire))
    with ExitStack() as stack:
        children = []
        for guest in pair:
            child = subprocess.Popen(["docker", "exec", guest.name, *COMMAND, "serve",
                                      panel, str(guest.node), str(user), tags[guest.node], users[user]],
                                     stdout=subprocess.PIPE, stderr=None)
            def cleanup(p=child):
                if p.poll() is None:
                    p.kill()
                p.wait(timeout=5)
                p.stdout.close()
            stack.callback(cleanup)
            children.append(child)
        parallel(lambda child: wait_marker(child, b"native_tls_spent"), children)
        # Real competing PostgreSQL transaction. No modified clock or fake
        # signed witness, and no account/lease mutation survives rollback.
        with psycopg.connect(os.environ["QUOTA_TEST_DSN"]) as blocker:
            assert blocker.execute("SELECT user_id FROM quota_v2_accounts WHERE user_id=%s AND NOT closed FOR UPDATE",
                                   (user,)).fetchall() == [(user,)]
            parallel(lambda child: wait_marker(child, b"native_tls_signed_revocation_stopped", 18), children)
            parallel(lambda child: wait_marker(child, b"native_tls_guest_verified", 10), children)
            for child in children:
                assert child.wait(timeout=5) == 0
            # Rule out expiry of either authority or ANY signed cap as
            # the reason for the signed revoked witness. The exact lock
            # is still held and SQL time has not been modified.
            now, = db.execute("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT").fetchone()
            cap_end, = db.execute("SELECT min(valid_until_ms) FROM quota_v2_signed_first_cap_outbox").fetchone()
            authority_end = min(json.loads(raw)["payload"]["validUntilMs"] for _, raw in rows)
            assert now < min(authority_end, cap_end - 7000), "revocation must precede expiry"
            blocker.rollback()
    for guest, (output, forward) in zip(pair, rules):
        verify_isolated_target(guest, output, forward)
        require_loopback_ingress(guest)
        assert not guest.exec("ss", "-Hltnp", "sport", "=", ":443").strip()
    actual = db.execute("SELECT node_id,signed_envelope FROM quota_v2_public_tls_authority_outbox ORDER BY node_id").fetchall()
    assert actual == sorted(rows)
    print("PASS: native TLS 1.3 MAIN/CDN reached both actual installed original meters; "
          "authentic Nexus signed SQL-contention revocation physically stopped both isolated listeners and live connections.", flush=True)
    return actual
