#!/usr/bin/env python3
"""Isolated, signed Node telemetry object-authorization regression.

Only execute against a disposable localhost API; never call production services.
No Xray GitHub releases or external network dependencies are needed.
"""
import hashlib
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = os.getenv("XMESH_TEST_URL", "").rstrip("/")
assert os.getenv("XMESH_AUDIT_DISPOSABLE") == "1"
assert BASE == "http://127.0.0.1:8080"


def api(method, path, payload=None, *, cookie=None, headers=None):
    hdr = {"Accept": "application/json"}
    hdr.update(headers or {})
    if cookie:
        hdr["Cookie"] = cookie
    if payload is not None:
        hdr["Content-Type"] = "application/json"
    if method in ("POST", "PATCH", "DELETE"):
        hdr["Origin"] = BASE
    raw = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
    request = Request(BASE + "/api/v1" + path, data=raw, headers=hdr, method=method)
    try:
        response = urlopen(request, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        body = response.read()
        ctype = response.headers.get_content_type()
        parsed = json.loads(body) if body and ctype == "application/json" else body.decode()
        cookie = next((item.split(";", 1)[0] for item in
                       response.headers.get_all("Set-Cookie", [])
                       if item.startswith("xmesh_session=")), None)
        return response.status, parsed, cookie


def require(actual, expected, label):
    assert actual == expected, f"{label}: HTTP {actual}, expected {expected}"
    print("PASS:", label)


def verified_ledger(node_id, user_id):
    """Inspect only disposable PostgreSQL ledgers; no production DB connection.

    The test's pinned compose project and local-only API are mandatory. Use
    psql inside the throwaway db container; no secrets or SQL in stdout.
    """
    assert os.getenv("XMESH_AUDIT_DISPOSABLE") == "1"
    assert BASE == "http://127.0.0.1:8080"
    assert type(node_id) is int and node_id > 0
    assert type(user_id) is int and user_id > 0
    assert os.getenv("COMPOSE_PROJECT_NAME") == "xmesh-telemetry-scope"
    query = f"""
    SELECT json_build_object(
      'user', (SELECT json_build_object(
         'lastUp', last_uplink_bytes, 'lastDown', last_downlink_bytes,
         'up', uplink_bytes, 'down', downlink_bytes)
         FROM user_node_traffic_totals WHERE node_id={node_id} AND user_id={user_id}),
      'quota', (SELECT json_build_object('up', uplink_bytes, 'down', downlink_bytes)
         FROM user_node_quota_lifetime WHERE node_id={node_id} AND user_id={user_id}),
      'inbound', (SELECT json_build_object(
         'lastUp', last_uplink_bytes, 'lastDown', last_downlink_bytes,
         'up', uplink_bytes, 'down', downlink_bytes)
         FROM user_inbound_traffic_totals
         WHERE node_id={node_id} AND user_id={user_id} AND inbound_tag='DE_VLESS'),
      'deltas', (SELECT json_build_object(
         'up', COALESCE(SUM(uplink_bytes),0)::BIGINT,
         'down', COALESCE(SUM(downlink_bytes),0)::BIGINT)
         FROM verified_traffic_deltas
         WHERE node_id={node_id} AND user_id={user_id} AND source_type='user')
    )::text;
    """
    response = subprocess.run(
        ["docker", "compose", "exec", "-T", "db", "sh", "-c",
         'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d xmesh'],
        input=query, text=True, capture_output=True, check=True, timeout=25)
    return json.loads(response.stdout.strip())


def main():
    code, auth, cookie = api("POST", "/auth/login",
        {"username": os.getenv("ADMIN_USERNAME", "admin"),
         "password": os.environ["ADMIN_PASSWORD"]})
    require(code, 200, "disposable owner login")
    assert auth["authenticated"] and cookie

    code, node, _ = api("POST", "/collections/nodes",
        {"name": "Disposable telemetry scope test", "addr": "192.0.2.252"}, cookie=cookie)
    require(code, 201, "create disposable signed node")
    node_id = node["id"]

    with tempfile.TemporaryDirectory() as tmp:
        key = Path(tmp) / "node.pem"
        signed_message = Path(tmp) / "canonical.txt"
        subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(key)],
                       check=True,capture_output=True)
        der = subprocess.check_output(["openssl","pkey","-in",str(key),
                                       "-pubout","-outform","DER"])
        code, _, _ = api("POST", f"/nodes/{node_id}/metrics-key",
                         {"publicKey": der[-32:].hex()}, cookie=cookie)
        require(code, 201, "enroll disposable node signing key")

        code, profile, _ = api("POST", "/collections/profiles", {
            "name": "Telemetry scope profile",
            "config": json.dumps({
                "inbounds": [{
                    "tag": "DE_VLESS", "listen": "127.0.0.1", "port": 28401,
                    "protocol": "vless", "settings": {"decryption": "none", "clients": []},
                    "streamSettings": {"network": "tcp", "security": "none"}
                }],
                "outbounds": [{"tag": "direct", "protocol": "freedom"}],
                "routing": {"rules": []}
            })
        }, cookie=cookie)
        require(code, 201, "create assigned profile")
        code, valid_squad, _ = api("POST", "/collections/squads",
            {"name": "Scope allowed", "inb": ["DE_VLESS"]}, cookie=cookie)
        require(code, 201, "create assigned Squad")
        code, other_squad, _ = api("POST", "/collections/squads",
            {"name": "Scope other", "inb": ["FR_ONLY"]}, cookie=cookie)
        require(code, 201, "create unrelated Squad")
        code, _, _ = api("PATCH", f"/collections/nodes/{node_id}",
            {"profileId": profile["id"], "xrayLocalPort": 28401}, cookie=cookie)
        require(code, 200, "bind node to profile")

        def create_user(username, squad_id):
            code, user, _ = api("POST", "/collections/users",
                {"username": username, "squads": [squad_id],
                 "hold": True, "holdDays": 1, "limit": 0, "used": 0},
                cookie=cookie)
            require(code, 201, "create " + username)
            return user["id"]

        assigned = create_user("ci_scope_assigned", valid_squad["id"])
        unrelated = create_user("ci_scope_unrelated", other_squad["id"])
        code, before_rows, _ = api("GET", "/collections/users", cookie=cookie)
        require(code, 200, "snapshot users before rejected telemetry")
        baseline = {
            uid: {
                key: next(item for item in before_rows["items"] if item["id"] == uid).get(key)
                for key in ("hold", "firstConnectedAt", "onlineAt", "expireAt", "used")
            }
            for uid in (assigned, unrelated)
        }
        sampled_at_ms = int(time.time() * 1000)

        def send_signed(user_rows=None, inbound_rows=None, *,
                        source_override=None, status="verified", return_body=False):
            nonlocal sampled_at_ms
            sampled_at_ms = max(sampled_at_ms + 1, int(time.time() * 1000))
            payload = {
                "node_id": node_id,
                "userStatsStatus": status,
                "userStatsAtMs": sampled_at_ms if source_override is None else source_override
            }
            if user_rows is not None:
                payload["userTraffic"] = user_rows
            if inbound_rows is not None:
                payload["userInboundTraffic"] = inbound_rows
            raw = json.dumps(payload, separators=(",", ":")).encode()
            stamp = int(time.time())
            nonce = os.urandom(16).hex()
            canonical = (f"XMESH1\nPOST\n/api/v1/metrics/ingest\n{node_id}\n"
                         f"{stamp}\n{nonce}\n{hashlib.sha256(raw).hexdigest()}\n")
            signed_message.write_bytes(canonical.encode())
            signature = subprocess.check_output(["openssl","pkeyutl","-sign","-rawin",
                "-inkey",str(key),"-in",str(signed_message)])
            headers = {"X-XMesh-Timestamp": str(stamp),
                       "X-XMesh-Nonce": nonce,
                       "X-XMesh-Signature": signature.hex()}
            code, response, _ = api("POST", "/metrics/ingest", payload, headers=headers)
            return (code, response) if return_body else code

        require(send_signed([{"userId": unrelated, "uplinkBytes": 1024,
                              "downlinkBytes": 1024}]), 403,
                "reject unrelated user's signed traffic")
        require(send_signed([{"userId": assigned, "uplinkBytes": 16,
                              "downlinkBytes": 16},
                             {"userId": unrelated, "uplinkBytes": 2048,
                              "downlinkBytes": 2048}]), 403,
                "reject mixed batch atomically")
        require(send_signed(inbound_rows=[{
            "userId": assigned, "inboundTag": "FR_ONLY",
            "uplinkBytes": 64, "downlinkBytes": 64
        }]), 403, "reject unassigned inbound on valid user")

        code, listing, _ = api("GET", "/collections/users", cookie=cookie)
        require(code, 200, "inspect users after rejected telemetry")
        for uid in (assigned, unrelated):
            user = next(item for item in listing["items"] if item["id"] == uid)
            for field, original in baseline[uid].items():
                assert user.get(field) == original, (
                    "Unauthorized signed sample mutated user state", uid, field, original, user.get(field))
        print("PASS: rejected telemetry preserved hold, expiry, presence and usage on both accounts")

        require(send_signed([{"userId": assigned, "uplinkBytes": 64,
                              "downlinkBytes": 128}]), 201,
                "accept genuine assigned traffic")
        code, listing, _ = api("GET", "/collections/users", cookie=cookie)
        require(code, 200, "inspect authorized first connection")
        assigned_user = next(u for u in listing["items"] if u["id"] == assigned)
        unrelated_user = next(u for u in listing["items"] if u["id"] == unrelated)
        assert assigned_user["hold"] is False and assigned_user.get("firstConnectedAt"), (
            "Legitimate assigned user's first connection did not activate")
        assert unrelated_user["hold"] is True and unrelated_user.get("firstConnectedAt") is None
        print("PASS: only assigned user's subscription activated")
        require(send_signed(inbound_rows=[{
            "userId": assigned, "inboundTag": "DE_VLESS",
            "uplinkBytes": 4, "downlinkBytes": 8
        }]), 201, "accept genuine assigned inbound counters")


        # Assignment revocation applies even to a node with accepted old counters.
        second = create_user("ci_scope_still_assigned", valid_squad["id"])
        code, _, _ = api("PATCH", f"/collections/users/{assigned}",
                        {"squads":[other_squad["id"]]}, cookie=cookie)
        require(code, 200, "move previously metered user out of node scope")
        code, snapshot, _ = api("GET", "/collections/users", cookie=cookie)
        require(code, 200, "snapshot reassignment state")
        watched = ("hold", "firstConnectedAt", "onlineAt", "expireAt", "used")
        before_rejected = {
            uid: {field: next(u for u in snapshot["items"] if u["id"]==uid).get(field)
                  for field in watched}
            for uid in (assigned, second)
        }
        require(send_signed([
            {"userId":assigned,"uplinkBytes":4096,"downlinkBytes":8192},
            {"userId":second,"uplinkBytes":32,"downlinkBytes":64}
        ]), 403, "reject delayed mixed batch after assignment revocation")
        require(send_signed(inbound_rows=[{
            "userId":assigned,"inboundTag":"DE_VLESS",
            "uplinkBytes":128,"downlinkBytes":256
        }]), 403, "reject old inbound identity after assignment revocation")
        code, snapshot, _ = api("GET", "/collections/users", cookie=cookie)
        require(code, 200, "inspect state after delayed rejected samples")
        for uid, expected in before_rejected.items():
            user = next(u for u in snapshot["items"] if u["id"]==uid)
            assert {field:user.get(field) for field in watched} == expected, (
                "Delayed rejected packet modified user state", uid)
        code, _, _ = api("PATCH", f"/collections/users/{assigned}",
                        {"squads":[valid_squad["id"]]}, cookie=cookie)
        require(code, 200, "restore authorized assignment")
        require(send_signed([
            {"userId":assigned,"uplinkBytes":128,"downlinkBytes":256},
            {"userId":second,"uplinkBytes":32,"downlinkBytes":64}
        ]), 201, "accept restored scope with counters below rejected sample")
        code, snapshot, _ = api("GET", "/collections/users", cookie=cookie)
        require(code, 200, "inspect valid subscriber after restored scope")
        user = next(u for u in snapshot["items"] if u["id"]==second)
        assert user["hold"] is False and user.get("firstConnectedAt")
        print("PASS: assignment revocation rejects delayed batches atomically; restored scope works")

        # Previous valid user-traffic baseline: (64,128); after restoration the
        # accepted (128,256) packet must charge ONLY (64,128), not historical
        # counters which were rejected while this user was assigned elsewhere.
        expected = {"lastUp": 128, "lastDown": 256, "up": 64, "down": 128}
        ledger = verified_ledger(node_id, assigned)
        assert ledger["user"] == expected, ("Wrong physical meter delta", ledger)
        assert ledger["quota"] == {"up": 64, "down": 128}, ledger
        assert ledger["deltas"] == {"up": 64, "down": 128}, ledger
        assert ledger["inbound"] == {
            "lastUp": 4, "lastDown": 8, "up": 0, "down": 0,
        }, ledger
        print("PASS: exact signed user/quota/delta ledgers charge (64,128) once")

        # A lost ACK can cause the same cumulative counters to be resent.
        # Freshly signed, repeated numbers must not consume another byte.
        require(send_signed([{"userId": assigned, "uplinkBytes": 128,
                              "downlinkBytes": 256}]), 201,
                "accept retransmitted cumulative counters after lost response")
        assert verified_ledger(node_id, assigned) == ledger
        print("PASS: duplicate accepted cumulative snapshot charges zero bytes")

        # An old producer timestamp remains signed correctly but is rejected
        # for user accounting, even if its numeric counters are much larger.
        seen_source = sampled_at_ms
        code, response = send_signed([{
            "userId": assigned, "uplinkBytes": 99999, "downlinkBytes": 99999,
        }], source_override=seen_source, return_body=True)
        require(code, 201, "ignore stale signed sample while retaining node health")
        assert response["userTrafficSamples"] == 0, response
        assert verified_ledger(node_id, assigned) == ledger
        print("PASS: out-of-order signed sample did not move any meter baseline")

        # During a disconnected/signed-snapshot-unavailable interval the new
        # worker must submit node-wide health only, not fabricated zero usage.
        require(send_signed(status="unavailable"), 201,
                "allow node-wide health without scoped user counters")
        assert verified_ledger(node_id, assigned) == ledger
        print("PASS: missing scoped snapshot did not reset or charge usage")

        # Xray restart: a smaller cumulative counter becomes a new baseline;
        # the following fresh positive sample is the only newly charged usage.
        require(send_signed([{"userId": assigned, "uplinkBytes": 9,
                              "downlinkBytes": 7}]), 201,
                "start fresh monotonic baseline after Xray restart")
        reset = verified_ledger(node_id, assigned)
        assert reset["user"] == {
            "lastUp": 9, "lastDown": 7, "up": 64, "down": 128,
        }, reset
        assert reset["quota"] == ledger["quota"], reset
        assert reset["deltas"] == ledger["deltas"], reset

        require(send_signed([{"userId": assigned, "uplinkBytes": 15,
                              "downlinkBytes": 12}]), 201,
                "charge only new bytes after the Xray restart")
        charged = verified_ledger(node_id, assigned)
        assert charged["user"] == {
            "lastUp": 15, "lastDown": 12, "up": 70, "down": 133,
        }, charged
        assert charged["quota"] == {"up": 70, "down": 133}, charged
        assert charged["deltas"] == {"up": 70, "down": 133}, charged
        assert charged["inbound"] == ledger["inbound"], charged
        print("PASS: Xray restart/positive delta and quota accounting are exact")

        # Inbound is a separate meter, never added again to user totals or
        # per-node quota. Baseline (4,8) + (10,10) in two directions.
        require(send_signed(inbound_rows=[{
            "userId": assigned, "inboundTag": "DE_VLESS",
            "uplinkBytes": 14, "downlinkBytes": 18,
        }]), 201, "charge only signed inbound-specific traffic once")
        final = verified_ledger(node_id, assigned)
        assert final["inbound"] == {
            "lastUp": 14, "lastDown": 18, "up": 10, "down": 10,
        }, final
        assert final["user"] == charged["user"], final
        assert final["quota"] == charged["quota"], final
        require(send_signed(inbound_rows=[{
            "userId": assigned, "inboundTag": "DE_VLESS",
            "uplinkBytes": 14, "downlinkBytes": 18,
        }]), 201, "duplicate inbound report is idempotent")
        assert verified_ledger(node_id, assigned) == final
        print("PASS: inbound/accounting separation prevents double charge")



if __name__ == "__main__":
    main()
