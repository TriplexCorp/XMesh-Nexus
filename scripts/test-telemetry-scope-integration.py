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
        sampled_at_ms = int(time.time() * 1000)

        def send_signed(user_rows=None, inbound_rows=None):
            nonlocal sampled_at_ms
            sampled_at_ms = max(sampled_at_ms + 1, int(time.time() * 1000))
            payload = {
                "node_id": node_id,
                "userStatsStatus": "verified",
                "userStatsAtMs": sampled_at_ms
            }
            if user_rows is not None:
                payload["userTraffic"] = user_rows
            if inbound_rows is not None:
                payload["userInboundTraffic"] = inbound_rows
            raw = json.dumps(payload, separators=(",", ":")).encode()
            stamp = int(time.time())
            nonce = os.urandom(16).hex()
            canonical = (f"XMESH1\\nPOST\\n/api/v1/metrics/ingest\\n{node_id}\\n"
                         f"{stamp}\\n{nonce}\\n{hashlib.sha256(raw).hexdigest()}\\n")
            signed_message.write_bytes(canonical.encode())
            signature = subprocess.check_output(["openssl","pkeyutl","-sign","-rawin",
                "-inkey",str(key),"-in",str(signed_message)])
            headers = {"X-XMesh-Timestamp": str(stamp),
                       "X-XMesh-Nonce": nonce,
                       "X-XMesh-Signature": signature.hex()}
            return api("POST", "/metrics/ingest", payload, headers=headers)[0]

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
            assert user["hold"] is True and user.get("firstConnectedAt") is None, (
                "Cross-scope or mixed counters activated an account", uid)
        print("PASS: rejection left both waiting subscriptions unchanged")

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


if __name__ == "__main__":
    main()
