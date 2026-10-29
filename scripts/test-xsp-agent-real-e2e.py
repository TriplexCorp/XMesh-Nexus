#!/usr/bin/env python3
"""Disposable P0-D real Nexus<->Node Agent migration/update lifecycle proof.

Uses real Nexus API/PostgreSQL, real Ed25519 node auth, production staged-apply
helper, and two real Go 1.27 XMesh-Node Agent artifacts with embedded identities.
Production activation remains disabled; the shell control Agent stays authority.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = os.getenv("XMESH_TEST_URL", "http://127.0.0.1:8080").rstrip("/")
OWNER = os.getenv("ADMIN_USERNAME", "admin")
OWNER_PASSWORD = os.environ["ADMIN_PASSWORD"]
NODE_REVISION = os.environ["P0D_NODE_SOURCE_REVISION"]
ARTIFACT_A = Path(os.environ["P0D_AGENT_ARTIFACT_A"]).resolve()
ARTIFACT_B = Path(os.environ["P0D_AGENT_ARTIFACT_B"]).resolve()
VERSION_A = os.environ["P0D_AGENT_VERSION_A"]
VERSION_B = os.environ["P0D_AGENT_VERSION_B"]
HELPER = Path("deploy/xsp-v2-agent-staged-apply.sh").resolve()


def request(method: str, path: str, payload=None, *, cookie=None, headers=None, origin=BASE):
    merged = {"Accept": "application/json"}
    merged.update(headers or {})
    if payload is not None:
        merged.setdefault("Content-Type", "application/json")
    if cookie:
        merged["Cookie"] = cookie
    if origin is not None:
        merged["Origin"] = origin
    raw = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
    req = Request(BASE + "/api/v1" + path, data=raw, headers=merged, method=method)
    try:
        response = urlopen(req, timeout=30)
    except HTTPError as exc:
        response = exc
    with response:
        body = response.read()
        content_type = response.headers.get_content_type()
        data = json.loads(body) if body and content_type == "application/json" else body
        cookies = response.headers.get_all("Set-Cookie", [])
        session = next((value.split(";", 1)[0] for value in cookies if value.startswith("xmesh_session=")), None)
        return response.status, data, session


def sql(statement: str) -> str:
    return subprocess.check_output([
        "docker", "compose", "exec", "-T", "db", "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "-U", "postgres", "-d", "xmesh", "-Atq", "-F", "|", "-c", statement,
    ], text=True).strip()


def login() -> str:
    code, data, cookie = request("POST", "/auth/login", {"username": OWNER, "password": OWNER_PASSWORD})
    assert code == 200 and data["authenticated"] is True and cookie, (code, data)
    return cookie


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def binary_identity(path: Path) -> dict:
    raw = subprocess.check_output([str(path), "--identity"], text=True)
    return json.loads(raw)


def signed_post(path: str, payload: dict, node_id: int, key: Path, message: Path):
    raw = json.dumps(payload, separators=(",", ":")).encode()
    timestamp = int(time.time())
    nonce = os.urandom(16).hex()
    canonical = (
        f"XMESH1\nPOST\n/api/v1{path}\n{node_id}\n{timestamp}\n{nonce}\n"
        f"{hashlib.sha256(raw).hexdigest()}\n"
    ).encode()
    message.write_bytes(canonical)
    signature = subprocess.check_output([
        "openssl", "pkeyutl", "-sign", "-rawin", "-inkey", str(key), "-in", str(message)
    ]).hex()
    return request("POST", path, payload, headers={
        "X-XMesh-Timestamp": str(timestamp),
        "X-XMesh-Nonce": nonce,
        "X-XMesh-Signature": signature,
    }, origin=None)


def insert_manifest(version: str, revision: str, digest: str):
    sql(
        "INSERT INTO node_xsp_agent_release_manifests(version,source_revision,artifact_sha256,created_by) "
        f"VALUES('{version}','{revision}','{digest}','ci-real-e2e');"
    )


def queue(owner_cookie: str, node_id: int, version: str) -> dict:
    code, data, _ = request(
        "POST", f"/nodes/{node_id}/agent-update", {"releaseVersion": version}, cookie=owner_cookie
    )
    assert code == 202, (code, data)
    return data


def poll(node_id: int, key: Path, message: Path) -> dict:
    code, data, _ = signed_post("/node/restart/poll", {"node_id": node_id}, node_id, key, message)
    assert code == 200 and data["command"], (code, data)
    return data["command"]


def ack(node_id: int, command_id: int, success: bool, detail: str, identity: dict, key: Path, message: Path):
    payload = {
        "node_id": node_id,
        "command_id": command_id,
        "success": success,
        "detail": detail,
        "releaseIdentity": identity,
    }
    return signed_post("/node/restart/ack", payload, node_id, key, message), payload


def write_identity(path: Path, identity: dict):
    path.write_text(json.dumps(identity, separators=(",", ":")) + "\n", encoding="utf-8")
    path.chmod(0o600)


def make_curl_rewriter(directory: Path):
    real_curl = shutil.which("curl")
    assert real_curl
    script = directory / "curl"
    script.write_text(f"""#!/usr/bin/env bash
set -Eeuo pipefail
args=()
for value in "$@"; do
  value="${{value//https:\/\/panel.example.test/http:\/\/127.0.0.1:8080}}"
  args+=("$value")
done
exec {real_curl} "${{args[@]}}"
""", encoding="utf-8")
    script.chmod(0o755)


def run_helper(base: Path, env_file: Path, identity_file: Path, fakebin: Path, *, corrupt_after_switch: str | None = None):
    watcher = None
    if corrupt_after_switch:
        target = base / "releases" / corrupt_after_switch / "xmesh-agent-xspv2"
        watcher_script = (
            "set -Eeuo pipefail; "
            f"for i in $(seq 1 1000); do "
            f"if [[ -L '{base}/current' && \"$(readlink '{base}/current')\" == 'releases/{corrupt_after_switch}' ]]; then "
            f"printf X >> '{target}'; exit 0; fi; sleep 0.01; done; exit 3"
        )
        watcher = subprocess.Popen(["sudo", "bash", "-c", watcher_script])
    result = subprocess.run([
        "sudo", "env",
        f"PATH={fakebin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        f"XMESH_NODE_ENV_FILE={env_file}",
        f"XMESH_AGENT_RELEASE_IDENTITY_FILE={identity_file}",
        f"XMESH_XSP_V2_AGENT_BASE={base}",
        "bash", str(HELPER),
    ], text=True, capture_output=True)
    if watcher is not None:
        watcher.wait(timeout=20)
    return result


def assert_active(base: Path, identity: dict):
    digest = identity["artifactSha256"]
    target = subprocess.check_output(["sudo", "readlink", str(base / "current")], text=True).strip()
    assert target == f"releases/{digest}", target
    active = json.loads(subprocess.check_output(["sudo", "cat", str(base / "active.json")], text=True))
    assert active == identity, active


def main():
    assert HELPER.is_file()
    assert len(NODE_REVISION) == 40
    digest_a, digest_b = sha256(ARTIFACT_A), sha256(ARTIFACT_B)
    assert digest_a != digest_b
    assert binary_identity(ARTIFACT_A) == {"version": VERSION_A, "sourceRevision": NODE_REVISION}
    assert binary_identity(ARTIFACT_B) == {"version": VERSION_B, "sourceRevision": NODE_REVISION}

    owner_cookie = login()
    code, node, _ = request(
        "POST", "/collections/nodes", {"name": "CI real P0-D Agent E2E", "addr": "127.0.0.1"}, cookie=owner_cookie
    )
    assert code == 201, (code, node)
    node_id = int(node["id"])

    temp = Path(tempfile.mkdtemp(prefix="xmesh-real-agent-e2e-"))
    key, message = temp / "node.key", temp / "message.bin"
    subprocess.run(["openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(key)], check=True, capture_output=True)
    der = subprocess.check_output(["openssl", "pkey", "-in", str(key), "-pubout", "-outform", "DER"])
    public_key = der[-32:].hex()
    sql(f"INSERT INTO node_metric_keys(node_id,public_key) VALUES({node_id},'{public_key}');")
    sql(
        "INSERT INTO node_runtime_heartbeats(node_id,version,router_running,xray_running,received_at) "
        f"VALUES({node_id},'control-v5.1.3',TRUE,TRUE,NOW());"
    )

    env_file = temp / "node.env"
    env_file.write_text(
        f"XMESH_API_URL=https://panel.example.test\nXMESH_NODE_ID={node_id}\nXMESH_METRICS_PRIVATE_KEY={key}\n",
        encoding="utf-8",
    )
    env_file.chmod(0o600)
    identity_file = temp / "release.json"
    fakebin = temp / "bin"
    fakebin.mkdir()
    make_curl_rewriter(fakebin)
    base = temp / "agent"

    # Release A: real positive migration. First poll response is treated as lost;
    # a fresh signed poll must redeliver the exact same claimed immutable command.
    identity_a = {"version": VERSION_A, "sourceRevision": NODE_REVISION, "artifactSha256": digest_a}
    insert_manifest(VERSION_A, NODE_REVISION, digest_a)
    queued_a = queue(owner_cookie, node_id, VERSION_A)
    first = poll(node_id, key, message)
    retry = poll(node_id, key, message)
    assert retry == first
    assert first["id"] == queued_a["id"] and first["releaseIdentity"] == identity_a
    print("PASS: lost signed poll response redelivers exact claimed manifest-bound command")

    write_identity(identity_file, identity_a)
    applied = run_helper(base, env_file, identity_file, fakebin)
    assert applied.returncode == 0, (applied.stdout, applied.stderr)
    assert_active(base, identity_a)
    print("PASS: real Go 1.27 Agent artifact downloaded from Nexus, verified and atomically activated")

    detail_a = "real staged Agent applied and verified"
    (code_data, ack_payload) = ack(node_id, first["id"], True, detail_a, identity_a, key, message)
    code, data, _ = code_data
    assert code == 200 and data["accepted"] is True
    before = sql(
        "SELECT state,result,release_ack_version,release_ack_source_revision,release_ack_artifact_sha256,"
        f"release_ack_success,release_ack_received_at::text FROM node_restart_commands WHERE id={first['id']};"
    )
    # Simulate lost HTTP ACK response: exact same semantic ACK with a fresh nonce
    # must converge on durable evidence without a second lifecycle transition.
    code, data, _ = signed_post("/node/restart/ack", ack_payload, node_id, key, message)
    assert code == 200 and data == {"accepted": True, "duplicate": True}, (code, data)
    after = sql(
        "SELECT state,result,release_ack_version,release_ack_source_revision,release_ack_artifact_sha256,"
        f"release_ack_success,release_ack_received_at::text FROM node_restart_commands WHERE id={first['id']};"
    )
    assert before == after
    print("PASS: lost ACK response exact retry is idempotent and does not rewrite durable evidence")

    wrong = dict(ack_payload)
    wrong["detail"] = "different retry"
    code, _, _ = signed_post("/node/restart/ack", wrong, node_id, key, message)
    assert code == 409
    assert sql(f"SELECT state FROM node_restart_commands WHERE id={first['id']};") == "succeeded"
    print("PASS: non-exact completed ACK retry still fails closed")

    # Process restart/idempotent package retry: rerunning the real staged helper
    # for the same immutable artifact must keep the same active package.
    write_identity(identity_file, identity_a)
    restarted = run_helper(base, env_file, identity_file, fakebin)
    assert restarted.returncode == 0, (restarted.stdout, restarted.stderr)
    assert_active(base, identity_a)
    print("PASS: staged package apply survives Agent-process restart/idempotent retry")

    # Release B: use a second real Go Agent artifact. Corrupt it only after the
    # atomic pointer switch so pre-activation checks pass and post-switch digest
    # verification forces rollback to the exact last-known-good release A.
    identity_b = {"version": VERSION_B, "sourceRevision": NODE_REVISION, "artifactSha256": digest_b}
    insert_manifest(VERSION_B, NODE_REVISION, digest_b)
    queued_b = queue(owner_cookie, node_id, VERSION_B)
    command_b = poll(node_id, key, message)
    assert command_b["id"] == queued_b["id"] and command_b["releaseIdentity"] == identity_b
    write_identity(identity_file, identity_b)
    failed = run_helper(base, env_file, identity_file, fakebin, corrupt_after_switch=digest_b)
    assert failed.returncode != 0, (failed.stdout, failed.stderr)
    assert_active(base, identity_a)
    print("PASS: post-switch corruption rolls active pointer back to exact last-known-good real Agent")

    detail_b = "post-activation verification failed; rolled back"
    code, data, _ = ack(node_id, command_b["id"], False, detail_b, identity_b, key, message)[0]
    assert code == 200 and data["accepted"] is True
    row_b = sql(
        "SELECT state,release_ack_success,release_ack_version,release_ack_source_revision,release_ack_artifact_sha256 "
        f"FROM node_restart_commands WHERE id={command_b['id']};"
    )
    assert row_b == f"failed|f|{VERSION_B}|{NODE_REVISION}|{digest_b}", row_b

    # Durable XSP-v2 state is outside release slots and remains a real directory
    # across both activation and rollback.
    mode = subprocess.check_output(["sudo", "stat", "-c", "%a:%F", str(base / "xsp-v2")], text=True).strip()
    assert mode == "700:directory", mode
    assert subprocess.run(["sudo", "test", "!", "-L", str(base / "xsp-v2")]).returncode == 0
    print("PASS: rollback does not replace or rewind durable security-state root")

    # The migration gate is staging-only; this E2E never starts a Go control
    # service and never enables strict-pq. Production shell authority remains.
    assert not (base / "strict-pq-enabled").exists()
    print("P0-D disposable real Nexus<->Node Agent migration/update E2E passed.")


if __name__ == "__main__":
    main()
