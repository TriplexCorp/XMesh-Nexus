#!/usr/bin/env python3
"""Disposable P0-D owner orchestration plus signed poll/ACK release-identity proof."""
import hashlib
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = os.getenv("XMESH_TEST_URL", "http://127.0.0.1:8080").rstrip("/")
OWNER = os.getenv("ADMIN_USERNAME", "admin")
OWNER_PASSWORD = os.environ["ADMIN_PASSWORD"]
ADMIN_USER = "ci_p0d_admin"
ADMIN_PASSWORD = "ci-p0d-admin-password-0123456789"
RELEASE = "control-v99.1.0-p0d-api"
REVISION = "89abcdef0123456789abcdef0123456789abcdef"
DIGEST = "89abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567"
GATE = "XSP_V2_P0D_AGENT_MIGRATION"


def request(method, path, payload=None, *, headers=None, cookie=None, origin=BASE):
    merged_headers = {"Accept": "application/json"}
    merged_headers.update(headers or {})
    if payload is not None:
        merged_headers.setdefault("Content-Type", "application/json")
    if cookie:
        merged_headers["Cookie"] = cookie
    if origin is not None:
        merged_headers["Origin"] = origin
    body = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
    req = Request(BASE + "/api/v1" + path, data=body, headers=merged_headers, method=method)
    try:
        response = urlopen(req, timeout=30)
    except HTTPError as exc:
        response = exc
    with response:
        raw = response.read()
        content_type = response.headers.get_content_type()
        data = json.loads(raw) if raw and (content_type == "application/json" or content_type.endswith("+json")) else (raw.decode("utf-8", errors="replace") if raw else None)
        cookies = response.headers.get_all("Set-Cookie", [])
        session = next((item.split(";", 1)[0] for item in cookies if item.startswith("xmesh_session=")), None)
        return response.status, data, session


def expect(actual, expected, label):
    assert actual == expected, f"{label}: HTTP {actual}, expected {expected}"
    print("PASS:", label)


def login(username, password):
    code, data, cookie = request(
        "POST", "/auth/login", {"username": username, "password": password})
    expect(code, 200, f"login {username}")
    assert data["authenticated"] is True and cookie
    return cookie


def sql(statement):
    command = [
        "docker", "compose", "exec", "-T", "db", "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "-U", "postgres", "-d", "xmesh", "-Atq", "-F", "|", "-c", statement,
    ]
    return subprocess.check_output(command, text=True).strip()


def wait_ready():
    for _ in range(120):
        try:
            with urlopen(BASE + "/api/v1/health/ready", timeout=3) as response:
                if response.status == 200:
                    return
        except (HTTPError, URLError, TimeoutError, OSError):
            pass
        time.sleep(1)
    subprocess.run(["docker", "compose", "logs", "--tail=120", "panel"], check=False)
    raise AssertionError("XMesh API did not become ready after panel recreation")


def recreate_panel(gate_value):
    env = os.environ.copy()
    if gate_value is None:
        env.pop(GATE, None)
    else:
        env[GATE] = gate_value
    subprocess.run(
        ["docker", "compose", "up", "-d", "--no-deps", "--force-recreate", "panel"],
        check=True,
        env=env,
    )
    wait_ready()


def signed_post(path, payload, node_id, keyfile, message_file):
    raw = json.dumps(payload, separators=(",", ":")).encode()
    stamp = int(time.time())
    nonce = os.urandom(16).hex()
    canonical = (
        f"XMESH1\nPOST\n/api/v1{path}\n{node_id}\n{stamp}\n{nonce}\n"
        f"{hashlib.sha256(raw).hexdigest()}\n"
    ).encode()
    message_file.write_bytes(canonical)
    signature = subprocess.check_output([
        "openssl", "pkeyutl", "-sign", "-rawin", "-inkey", str(keyfile), "-in", str(message_file)
    ])
    headers = {
        "X-XMesh-Timestamp": str(stamp),
        "X-XMesh-Nonce": nonce,
        "X-XMesh-Signature": signature.hex(),
    }
    return request("POST", path, payload, headers=headers, origin=None)


def main():
    # The surrounding integration job starts the normal default-disabled panel.
    # Recreate only that API container with the exact opt-in value, then restore
    # it before returning so later CI continues under normal production defaults.
    recreate_panel("staging-only")

    owner_cookie = login(OWNER, OWNER_PASSWORD)
    code, node, _ = request(
        "POST", "/collections/nodes",
        {"name": "CI P0-D Agent release identity", "addr": "127.0.0.1"},
        cookie=owner_cookie)
    expect(code, 201, "owner creates disposable P0-D node")
    node_id = int(node["id"])

    # Use a real Ed25519 identity so poll, heartbeat and ACK exercise the same
    # signed node-auth boundary as the deployed control Agent.
    key_dir = Path(tempfile.mkdtemp(prefix="xmesh-p0d-agent-"))
    keyfile = key_dir / "node.key"
    message_file = key_dir / "request.bin"
    subprocess.run(
        ["openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(keyfile)],
        check=True, capture_output=True)
    der = subprocess.check_output([
        "openssl", "pkey", "-in", str(keyfile), "-pubout", "-outform", "DER"
    ])
    metric_public_key = der[-32:].hex()
    assert len(metric_public_key) == 64
    sql(
        "INSERT INTO node_metric_keys(node_id,public_key) "
        f"VALUES({node_id},'{metric_public_key}');"
    )
    sql(
        "INSERT INTO node_runtime_heartbeats(node_id,version,router_running,xray_running,received_at) "
        f"VALUES({node_id},'control-v4.0.0',TRUE,TRUE,NOW()) "
        "ON CONFLICT(node_id) DO UPDATE SET version=EXCLUDED.version,router_running=TRUE,"
        "xray_running=TRUE,received_at=NOW();"
    )
    sql(
        "INSERT INTO node_xsp_agent_release_manifests(version,source_revision,artifact_sha256,created_by) "
        f"VALUES('{RELEASE}','{REVISION}','{DIGEST}','ci-owner');"
    )

    code, admin, _ = request(
        "POST", "/admins",
        {"username": ADMIN_USER, "password": ADMIN_PASSWORD, "role": "admin"},
        cookie=owner_cookie)
    expect(code, 201, "owner creates P0-D admin negative-control account")
    assert admin["role"] == "admin"
    admin_cookie = login(ADMIN_USER, ADMIN_PASSWORD)

    # Legacy behavior is deliberately unchanged: ordinary admin mutation rights
    # can still queue, poll and ACK the historical unbound fixed-version update.
    code, legacy, _ = request(
        "POST", f"/nodes/{node_id}/agent-update", {}, cookie=admin_cookie)
    expect(code, 202, "admin legacy empty Agent update remains unchanged")
    assert legacy["action"] == "update_agent" and legacy["targetVersion"].startswith("control-v")
    code, legacy_poll, _ = signed_post(
        "/node/restart/poll", {"node_id": node_id}, node_id, keyfile, message_file)
    expect(code, 200, "signed legacy Agent update poll remains compatible")
    assert legacy_poll["command"] == {
        "id": int(legacy["id"]),
        "action": "update_agent",
        "targetVersion": legacy["targetVersion"],
    }, legacy_poll
    code, _, _ = signed_post(
        "/node/restart/ack",
        {"node_id": node_id, "command_id": int(legacy["id"]), "success": True, "detail": "legacy update confirmed"},
        node_id, keyfile, message_file)
    expect(code, 200, "legacy Agent ACK remains identity-free")
    legacy_row = sql(
        "SELECT action,target_version,COALESCE(release_manifest_id::text,'NULL'),requested_by,state,"
        "COALESCE(release_ack_version,'NULL') "
        f"FROM node_restart_commands WHERE id={int(legacy['id'])};"
    )
    assert legacy_row == f"update_agent|{legacy['targetVersion']}|NULL|{ADMIN_USER}|succeeded|NULL", legacy_row

    code, _, _ = request(
        "POST", f"/nodes/{node_id}/agent-update",
        {"releaseVersion": RELEASE}, cookie=admin_cookie)
    expect(code, 403, "admin cannot select immutable migration release")

    code, _, _ = request(
        "POST", f"/nodes/{node_id}/agent-update",
        {"releaseVersion": "control-v404.0.0-p0d-api"}, cookie=owner_cookie)
    expect(code, 404, "unknown migration release fails closed")

    code, _, _ = request(
        "POST", f"/nodes/{node_id}/agent-update",
        {"releaseVersion": RELEASE, "artifactSha256": "f" * 64}, cookie=owner_cookie)
    assert code in (400, 422), f"caller digest override must be rejected, got HTTP {code}"
    print("PASS: caller cannot override immutable artifact digest")

    code, staged, _ = request(
        "POST", f"/nodes/{node_id}/agent-update",
        {"releaseVersion": RELEASE}, cookie=owner_cookie)
    expect(code, 202, "owner queues approved staging migration release")
    assert staged["action"] == "update_agent"
    assert staged["targetVersion"] == RELEASE
    assert staged["migration"]["sourceRevision"] == REVISION
    assert staged["migration"]["artifactSha256"] == DIGEST
    manifest_id = int(staged["migration"]["manifestId"])
    command_id = int(staged["id"])

    row = sql(
        "SELECT c.action,c.target_version,c.release_manifest_id,c.requested_by,c.state,"
        "m.source_revision,m.artifact_sha256 "
        "FROM node_restart_commands c JOIN node_xsp_agent_release_manifests m "
        "ON m.id=c.release_manifest_id "
        f"WHERE c.id={command_id};"
    )
    expected = f"update_agent|{RELEASE}|{manifest_id}|{OWNER}|pending|{REVISION}|{DIGEST}"
    assert row == expected, (row, expected)
    print("PASS: API command is atomically bound to server-resolved immutable manifest")

    code, _, _ = request(
        "POST", f"/nodes/{node_id}/agent-update",
        {"releaseVersion": RELEASE}, cookie=owner_cookie)
    expect(code, 409, "single-flight conflict remains authoritative")

    code, polled, _ = signed_post(
        "/node/restart/poll", {"node_id": node_id}, node_id, keyfile, message_file)
    expect(code, 200, "signed bound Agent command carries immutable release identity")
    assert polled["command"] == {
        "id": command_id,
        "action": "update_agent",
        "targetVersion": RELEASE,
        "releaseIdentity": {
            "version": RELEASE,
            "sourceRevision": REVISION,
            "artifactSha256": DIGEST,
        },
    }, polled

    # A matching version heartbeat used to be sufficient for legacy self-update
    # recovery. Bound migration must not allow that fallback to bypass exact ACK.
    code, heartbeat, _ = signed_post(
        "/node/heartbeat",
        {"node_id": node_id, "version": RELEASE, "xray_running": True, "router_running": True},
        node_id, keyfile, message_file)
    expect(code, 200, "matching-version heartbeat remains healthy for bound migration")
    assert heartbeat["accepted"] is True
    assert sql(f"SELECT state FROM node_restart_commands WHERE id={command_id};") == "claimed"
    print("PASS: bound migration cannot become success from version-only heartbeat")

    code, _, _ = signed_post(
        "/node/restart/ack",
        {"node_id": node_id, "command_id": command_id, "success": True, "detail": "missing identity"},
        node_id, keyfile, message_file)
    expect(code, 409, "bound ACK without release identity fails closed")

    wrong_identity = {
        "version": RELEASE,
        "sourceRevision": REVISION,
        "artifactSha256": "f" * 64,
    }
    code, _, _ = signed_post(
        "/node/restart/ack",
        {"node_id": node_id, "command_id": command_id, "success": True,
         "detail": "wrong digest", "releaseIdentity": wrong_identity},
        node_id, keyfile, message_file)
    expect(code, 409, "bound ACK with mismatched digest fails closed")
    unchanged = sql(
        "SELECT state,COALESCE(release_ack_version,'NULL'),COALESCE(release_ack_received_at::text,'NULL') "
        f"FROM node_restart_commands WHERE id={command_id};"
    )
    assert unchanged == "claimed|NULL|NULL", unchanged

    exact_identity = {
        "version": RELEASE,
        "sourceRevision": REVISION,
        "artifactSha256": DIGEST,
    }
    code, _, _ = signed_post(
        "/node/restart/ack",
        {"node_id": node_id, "command_id": command_id, "success": True,
         "detail": "staged identity applied and verified", "releaseIdentity": exact_identity},
        node_id, keyfile, message_file)
    expect(code, 200, "exact identity-bound Agent ACK succeeds")
    ack_row = sql(
        "SELECT state,release_ack_version,release_ack_source_revision,release_ack_artifact_sha256,"
        "release_ack_success,release_ack_received_at IS NOT NULL "
        f"FROM node_restart_commands WHERE id={command_id};"
    )
    expected_ack = f"succeeded|{RELEASE}|{REVISION}|{DIGEST}|t|t"
    assert ack_row == expected_ack, (ack_row, expected_ack)
    print("PASS: exact immutable release identity is durable ACK evidence")

    code, _, _ = signed_post(
        "/node/restart/ack",
        {"node_id": node_id, "command_id": command_id, "success": True,
         "detail": "duplicate", "releaseIdentity": exact_identity},
        node_id, keyfile, message_file)
    expect(code, 409, "duplicate identity ACK cannot complete command twice")

    # Restore the default process environment and prove the same migration
    # request becomes unavailable without the exact staging-only opt-in.
    recreate_panel(None)
    owner_cookie = login(OWNER, OWNER_PASSWORD)
    code, _, _ = request(
        "POST", f"/nodes/{node_id}/agent-update",
        {"releaseVersion": RELEASE}, cookie=owner_cookie)
    expect(code, 404, "migration API disappears again when staging gate is disabled")

    print("P0-D signed Agent poll/ACK release-identity integration passed.")


if __name__ == "__main__":
    main()
