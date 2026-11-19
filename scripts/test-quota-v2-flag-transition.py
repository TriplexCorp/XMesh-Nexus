#!/usr/bin/env python3
"""Disposable API/Node integration rehearsal of quota v1 -> v2 -> v1 -> v2.

Only runs inside the existing one-use xmesh-quota-v2 CI Docker Compose project.
The last v1 response after v2 MUST be rejected by the real Node guard. No
rollback is authorized for a production fleet, no terminal meter is implied,
and not one byte of any existing reservation is refunded by this test.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

assert os.environ.get("XMESH_AUDIT_DISPOSABLE") == "1"
assert os.environ.get("COMPOSE_PROJECT_NAME") == "xmesh-quota-v2"
assert os.environ.get("XMESH_TEST_URL") == "http://127.0.0.1:8080"

HELPERS = Path(__file__).with_name("test-quota-v2-e2e.py")
spec = importlib.util.spec_from_file_location("xmesh_existing_quota_e2e", HELPERS)
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)
api, SignedNode, guard, query = suite.api, suite.SignedNode, suite.guard, suite.query
ROOT = Path(__file__).resolve().parents[1]
OVERRIDE = ROOT / "compose.override.yaml"
ORIGINAL = OVERRIDE.read_text(encoding="utf-8")
assert 'XMESH_QUOTA_V2_ENABLED: "1"' in ORIGINAL, "CI must start with v2 enabled"
assert ORIGINAL.count('XMESH_QUOTA_V2_ENABLED: "1"') == 1

def login():
    code, _, cookie = api("POST", "/auth/login", {
        "username": os.environ["ADMIN_USERNAME"],
        "password": os.environ["ADMIN_PASSWORD"],
    })
    assert code == 200 and cookie, "Owner login unavailable in disposable panel"
    return cookie

def feature_status(enabled):
    code, report, _ = api("GET", "/quota-v2/fleet-readiness", cookie=login())
    assert code == 200, (code, report)
    assert report["featureEnabled"] is enabled, report
    assert report["canRefundFromThisPreflight"] is False, report
    assert report["physicalStopAndFinalMeterVerified"] is False, report
    return report

def set_flag(enabled):
    # A live Compose recreation deliberately retains the SAME disposable
    # database, Node Ed25519 key, and panel policy signing key.
    desired = "1" if enabled else "0"
    change = ORIGINAL.replace('XMESH_QUOTA_V2_ENABLED: "1"',
                              f'XMESH_QUOTA_V2_ENABLED: "{desired}"')
    tmp = OVERRIDE.with_name(".quota-v2-transition.override.tmp")
    tmp.write_text(change, encoding="utf-8")
    os.replace(tmp, OVERRIDE)
    subprocess.run(["docker", "compose", "up", "-d", "--no-deps",
                    "--force-recreate", "panel"], cwd=ROOT, check=True,
                   capture_output=True, text=True, timeout=180)
    for _ in range(120):
        try:
            status, _, _ = api("GET", "/health/ready")
            if status == 200:
                feature_status(enabled)
                return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise AssertionError("Disposable panel failed to resume after flag transition")

def create_test_node(directory):
    cookie = login()
    code, data, _ = api("POST", "/collections/nodes", {
        "name": "Quota-v2 CI flag transition node",
        "addr": "192.0.2.202",
    }, cookie)
    assert code == 201, (code, data)
    node = SignedNode(data["id"], directory)
    code, response, _ = api("POST", f"/nodes/{node.id}/metrics-key",
                            {"publicKey": node.public}, cookie)
    assert code == 201, (code, response)
    config = {
        "inbounds": [{
            "tag": "TRANSITION_VLESS",
            "listen": "127.0.0.1",
            "port": 28601,
            "protocol": "vless",
            "settings": {"decryption": "none", "clients": []},
            "streamSettings": {"network": "tcp", "security": "none"},
        }],
        "outbounds": [{"tag": "direct", "protocol": "freedom"}],
        "routing": {"rules": []},
    }
    code, profile, _ = api("POST", "/collections/profiles", {
        "name": "Quota-v2 CI transition-only profile",
        "config": json.dumps(config),
    }, cookie)
    assert code == 201, (code, profile)
    code, squad, _ = api("POST", "/collections/squads", {
        "name": "Quota-v2 CI transition-only squad",
        "inb": ["TRANSITION_VLESS"],
    }, cookie)
    assert code == 201, (code, squad)
    code, response, _ = api("PATCH", f"/collections/nodes/{node.id}", {
        "profileId": profile["id"], "xrayLocalPort": 28601,
    }, cookie)
    assert code == 200, (code, response)
    code, user, _ = api("POST", "/collections/users", {
        "username": "ci_v2_flag_transition",
        "squads": [squad["id"]],
        "hold": False, "limit": 0.2, "used": 0,
    }, cookie)
    assert code == 201, (code, user)
    return node, user["id"]

def desired(node, user_id):
    code, response, _ = node.post("/node/desired-config", {
        "node_id": node.id,
        "quotaProtocolVersion": 2,
        "quotaLocalCounters": [{"userId": user_id, "usedBytes": 0}],
    })
    assert code == 200, (code, response)
    return response

def reservations(user_id):
    return int(query("SELECT COUNT(*)::text FROM quota_v2_reservations WHERE user_id="
                     + str(user_id)))

def run():
    feature_status(True)
    with tempfile.TemporaryDirectory(prefix="xmesh-v2-flag-ci-") as directory:
        # Create and cache a real Ed25519-signed v1 Node envelope while the
        # issuer is OFF, as it will be in a genuine pre-cutover deployment.
        set_flag(False)
        node, user_id = create_test_node(directory)
        v1 = desired(node, user_id)
        assert v1["policy"]["version"] == 1, v1["policy"]["version"]
        guard.verify_envelope(v1, node.state, node.id, first_contact=True)
        node.state.joinpath("policy-envelope.json").write_text(json.dumps(v1))
        assert reservations(user_id) == 0, "Feature-off issued a v2 lease"
        print("PASS: with feature 0, a signed v1 profile is valid but no v2 hold exists")

        # Enable on the disposable panel against the SAME persisted ledger,
        # while retaining the existing signed v1 policy on the Node.
        time.sleep(0.05)
        set_flag(True)
        v2 = desired(node, user_id)
        assert v2["policy"]["version"] == 2
        guard.verify_envelope(v2, node.state, node.id, first_contact=True)
        node.state.joinpath("policy-envelope.json").write_text(json.dumps(v2))
        leases = [x.get("quotaReservation")
                  for x in v2["policy"]["users"] if x["userId"] == user_id]
        assert len(leases) == 1 and isinstance(leases[0], dict), leases
        assert reservations(user_id) == 1, "Missing durable v2 reservation"
        print("PASS: feature 1 issues a signed v2 reservation without replacing Node identity")

        # A naive 1->0 rollback is NOT safe: server signs v1 again, while the
        # Node MUST refuse downgrade and leave its last committed v2 durable.
        time.sleep(0.05)
        set_flag(False)
        downgraded = desired(node, user_id)
        assert downgraded["policy"]["version"] == 1
        try:
            guard.verify_envelope(downgraded, node.state, node.id,
                                  first_contact=True)
        except ValueError as error:
            assert "Quota protocol downgrade rejected" in str(error), str(error)
        else:
            raise AssertionError("CRITICAL: signed v2 -> v1 policy downgrade admitted")
        assert json.loads(node.state.joinpath("policy-envelope.json").read_text()) == v2
        assert reservations(user_id) == 1, "Feature-off silently refunded or erased v2 hold"
        print("PASS: 1->0 signed-policy rollback is rejected; old hold is NOT refunded")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(run())
    finally:
        # Restore the job's existing feature=1 condition even if an assertion
        # fails. The whole CI project/volumes are destroyed by workflow cleanup.
        set_flag(True)
