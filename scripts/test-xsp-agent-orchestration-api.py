#!/usr/bin/env python3
"""P0-D1c disposable HTTP/DB integration for owner-only Agent release selection."""
import json
import os
import subprocess
import time
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


def request(method, path, payload=None, *, cookie=None, origin=BASE):
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = cookie
    if origin is not None:
        headers["Origin"] = origin
    body = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
    req = Request(BASE + "/api/v1" + path, data=body, headers=headers, method=method)
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


def main():
    # The surrounding integration job starts the normal default-disabled panel.
    # Recreate only that API container with the exact opt-in value, then restore
    # it before returning so later CI continues under normal production defaults.
    recreate_panel("staging-only")

    owner_cookie = login(OWNER, OWNER_PASSWORD)
    code, node, _ = request(
        "POST", "/collections/nodes",
        {"name": "CI P0-D1c orchestration", "addr": "127.0.0.1"},
        cookie=owner_cookie)
    expect(code, 201, "owner creates disposable D1c node")
    node_id = int(node["id"])

    # Runtime heartbeats are intentionally anchored to an enrolled node metric
    # identity by FK. Derive the disposable public identity from the node id so
    # this fixture cannot collide with identities created by earlier CI tests.
    metric_public_key = f"{node_id:064x}"
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
    expect(code, 201, "owner creates D1c admin negative-control account")
    assert admin["role"] == "admin"
    admin_cookie = login(ADMIN_USER, ADMIN_PASSWORD)

    # Legacy behavior is deliberately unchanged: ordinary admin mutation rights
    # can still queue the historical fixed-version `{}` update.
    code, legacy, _ = request(
        "POST", f"/nodes/{node_id}/agent-update", {}, cookie=admin_cookie)
    expect(code, 202, "admin legacy empty Agent update remains unchanged")
    assert legacy["action"] == "update_agent" and legacy["targetVersion"].startswith("control-v")
    legacy_row = sql(
        "SELECT action,target_version,COALESCE(release_manifest_id::text,'NULL'),requested_by,state "
        f"FROM node_restart_commands WHERE id={int(legacy['id'])};"
    )
    assert legacy_row == f"update_agent|{legacy['targetVersion']}|NULL|{ADMIN_USER}|pending", legacy_row
    sql(f"DELETE FROM node_restart_commands WHERE id={int(legacy['id'])};")

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

    # Restore the default process environment and prove the same migration
    # request becomes unavailable without the exact staging-only opt-in.
    recreate_panel(None)
    owner_cookie = login(OWNER, OWNER_PASSWORD)
    code, _, _ = request(
        "POST", f"/nodes/{node_id}/agent-update",
        {"releaseVersion": RELEASE}, cookie=owner_cookie)
    expect(code, 404, "migration API disappears again when staging gate is disabled")

    print("P0-D1c owner-only staging Agent orchestration API integration passed.")


if __name__ == "__main__":
    main()
