"""Disposable installed product-binary transition, not production qualification.

The successor is compiled from the reviewed source with a synthetic fixture
revision; it must never be published as an approved release. This scenario
uses a clean unassigned guest, not a node with active quota reservations.
"""
import hashlib
import json
import os
import time
from urllib.parse import urlsplit

PRODUCT = "/usr/local/bin/xmesh-agent-xspv2-product"
RECOVERY = "/usr/local/libexec/xmesh-agent-release-recovery"
SUPERVISOR = "xmesh-product-release-update"
CONTROL = "xmesh-node-control"
STATE = "/var/lib/xmesh-node-control/product-upgrade"
ACTIVATION = "/var/lib/xmesh-agent/product"


def build_fixture_successor(root, revision, builder, docker):
    assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
    assert os.environ.get("GITHUB_ACTIONS") == "true"
    assert os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    assert urlsplit(os.environ["QUOTA_TEST_DSN"]).path == "/quota_wal_installed"
    fixture_revision = hashlib.sha256(
        ("XMESH-DISPOSABLE-FIRST-SUCCESSOR:" + revision).encode()
    ).hexdigest()[:40]
    assert fixture_revision != revision
    output = root / "successor-artifacts"
    output.mkdir(mode=0o700)
    docker("run", "--rm", "-v", f"{root / 'reviewed'}:/src:ro",
           "-v", f"{output}:/out", "-w", "/src/agent/xspv2",
           builder, "env", "CGO_ENABLED=0", "go", "build", "-trimpath",
           "-ldflags", f"-X main.version=control-v6.0.29 -X main.sourceRevision={fixture_revision}",
           "-o", "/out/fixture-product", "./cmd/xmesh-agent-xspv2-product", timeout=350)
    artifact = output / "fixture-product"
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    artifact.rename(output / (digest + ".bin"))
    return {"version": "control-v6.0.29", "sourceRevision": fixture_revision,
            "artifactSha256": digest}


def check_first_successor(guest, db, panel, initial, target):
    node = guest.node
    assert initial["version"] == "control-v6.0.28"
    assert target["version"] == "control-v6.0.29"
    assert target["sourceRevision"] != initial["sourceRevision"]
    assert target["artifactSha256"] != initial["artifactSha256"]

    def activation_files():
        return {name: guest.exec("sha256sum", f"{ACTIVATION}/{name}").split()[0]
                for name in ("config.json", "activation-request.json",
                             "activation-receipt.json", "active.json")}

    def activation_row():
        return db.execute(
            "SELECT state,release_version,release_source_revision,release_artifact_sha256,"
            "receipt_sha256,receipt_envelope FROM node_xsp_product_nodes WHERE node_id=%s", (node,),
        ).fetchone()

    def image():
        return json.loads(guest.exec(PRODUCT, "--identity"))

    def command_state(command):
        return db.execute("SELECT state FROM node_restart_commands WHERE id=%s", (command,)).fetchone()[0]

    def commit_count():
        return db.execute(
            "SELECT count(*) FROM node_xsp_product_release_commits WHERE node_id=%s", (node,),
        ).fetchone()[0]

    def poll_control():
        # The installed control service has a normal 5-start / 10-second
        # systemd limit. The fixture compresses multiple manual polls that
        # would ordinarily be spaced by its timer. Honor the real rate
        # window; never reset failed state or change the unit in this test.
        assert guest.exec("systemctl", "show", "-p", "StartLimitIntervalUSec",
                          "--value", CONTROL + ".service").strip() == b"10s"
        time.sleep(11)
        guest.exec("systemctl", "start", CONTROL + ".service", timeout=90)

    def queue():
        command, = db.execute(
            "SELECT command_id FROM queue_node_xsp_product_first_successor(%s,%s,%s)",
            (node, target["version"], "disposable-first-successor"),
        ).fetchone()
        poll_control()
        assert command_state(command) == "claimed"
        assert json.loads(guest.exec("cat", f"{STATE}/command.json")) == {
            "id": command, "action": "update_agent", "targetVersion": target["version"],
            "releaseIdentity": target,
        }
        return command

    def assert_no_grant():
        assert db.execute(
            "SELECT count(*) FROM quota_v2_reservations WHERE node_id=%s", (node,),
        ).fetchone()[0] == 0

    assert_no_grant()
    guest.exec("systemctl", "stop", CONTROL + ".timer", SUPERVISOR + ".timer")
    guest.exec("systemctl", "stop", CONTROL + ".service", SUPERVISOR + ".service")
    before_files, before_row = activation_files(), activation_row()
    assert image() == initial and commit_count() == 0
    db.execute(
        "INSERT INTO node_xsp_agent_release_manifests(version,source_revision,artifact_sha256,created_by) "
        "VALUES(%s,%s,%s,'disposable-first-successor')",
        (target["version"], target["sourceRevision"], target["artifactSha256"]),
    )

    # Switch the real signed candidate and request explicit ABORT before
    # COMMIT. Only the disposable local fault marker is test-injected.
    command = queue()
    args = ("--command-id", str(command))
    plan = f"{STATE}/plan-{command}.json"
    guest.exec(RECOVERY, "fetch-release-plan", *args, "--output-file", plan, timeout=90)
    guest.exec(RECOVERY, "download-release-artifact", *args, "--plan-file", plan, timeout=150)
    guest.exec(RECOVERY, "prepare-release", *args, "--plan-file", plan, timeout=90)
    guest.exec(RECOVERY, "switch-release", *args, timeout=90)
    assert image() == target and commit_count() == 0
    guest.exec("sh", "-ec", 'umask 077; printf "abort\\n" > "$1"', "sh", f"{STATE}/abort-{command}")
    guest.exec("systemctl", "start", SUPERVISOR + ".service", timeout=180)
    assert command_state(command) == "failed" and commit_count() == 0
    assert image() == initial
    assert activation_files() == before_files and activation_row() == before_row
    guest.exec("test", "!", "-e", f"{STATE}/command.json")
    guest.exec(PRODUCT, "verify-active", "--panel", panel, "--node-id", str(node))
    print("Installed first-release candidate restored after a real signed ABORT.", flush=True)

    # New normal command. The actual installed systemd service performs
    # download, switch, confirmation and durable cleanup, without a shim.
    command = queue()
    guest.exec("systemctl", "start", SUPERVISOR + ".service", timeout=600)
    assert command_state(command) == "succeeded" and commit_count() == 1
    assert image() == target
    guest.exec("test", "!", "-e", f"{STATE}/command.json")
    receipt_path = f"{ACTIVATION}/release-commit.json"
    receipt = guest.exec("sha256sum", receipt_path).split()[0]
    guest.exec(PRODUCT, "confirm-release", "--command-id", str(command), timeout=90)
    assert guest.exec("sha256sum", receipt_path).split()[0] == receipt
    assert activation_files() == before_files and activation_row() == before_row
    guest.exec("systemctl", "restart", "xmesh-pq-activation-recovery.service", timeout=90)
    guest.exec(PRODUCT, "verify-active", "--panel", panel, "--node-id", str(node))
    poll_control()
    version, = db.execute("SELECT version FROM node_runtime_heartbeats WHERE node_id=%s", (node,)).fetchone()
    assert version == target["version"]
    assert db.execute(
        "SELECT command_id FROM queue_node_xsp_product_first_successor(%s,%s,%s)",
        (node, target["version"], "disposable-first-successor"),
    ).fetchone() is None
    assert_no_grant()
    print("Installed supervisor committed the fixture successor; replay and activation recovery preserved the original identity.", flush=True)
