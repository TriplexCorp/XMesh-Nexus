#!/usr/bin/env python3
"""Real signature and replay tests against disposable CI PostgreSQL / XMesh API."""
import hashlib
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = os.getenv("XMESH_TEST_URL", "http://127.0.0.1:8080").rstrip("/")
USER = os.getenv("ADMIN_USERNAME", "admin")
PASSWORD = os.environ["ADMIN_PASSWORD"]


def request(method, path, payload=None, *, headers=None, cookie=None, origin=None):
    h = {"Accept": "application/json"}
    h.update(headers or {})
    if cookie:
        h["Cookie"] = cookie
    if origin is not None:
        h["Origin"] = origin
    if payload is not None:
        h.setdefault("Content-Type", "application/json")
    data = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
    url = BASE + "/api/v1" + path
    req = Request(url, data=data, headers=h, method=method)
    try:
        response = urlopen(req, timeout=30)
    except HTTPError as exc:
        response = exc
    with response:
        raw = response.read()
        result = json.loads(raw) if raw else None
        cookies = response.headers.get_all("Set-Cookie", [])
        auth = next((x.split(";", 1)[0] for x in cookies if x.startswith("xmesh_session=")), None)
        return response.status, result, auth


def assert_status(actual, expected, label):
    assert actual == expected, f"{label}: HTTP {actual}, expected {expected}"
    print("PASS:", label)


def main():
    code, login, cookie = request(
        "POST", "/auth/login", {"username": USER, "password": PASSWORD}, origin=BASE)
    assert_status(code, 200, "bootstrap login")
    assert cookie and login["authenticated"]

    code, created, _ = request("POST", "/collections/nodes", {"name": "CI signed telemetry"},
                               cookie=cookie, origin=BASE)
    assert_status(code, 201, "create CI node")
    node = created["id"]
    body = {"node_id": node, "cpu_percent": 25.5, "metrics": {"unit": "signed-test"}}

    # No credentials may be issued through the removed bearer endpoint.
    code, _, _ = request("POST", f"/nodes/{node}/metrics-token", {}, cookie=cookie, origin=BASE)
    assert code in (404, 405), f"removed bearer endpoint must not issue tokens: HTTP {code}"
    print("PASS: removed bearer issuance route cannot be used")
    code, _, _ = request("POST", "/metrics/ingest", body,
                         headers={"Authorization": "Bearer xm_" + "a" * 64})
    assert code in (401, 403), f"unsigned bearer must be rejected: HTTP {code}"
    print("PASS: unsigned bearer rejected before enrollment (auth or CSRF)")

    with tempfile.TemporaryDirectory() as directory:
        keyfile = Path(directory) / "key.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(keyfile)],
                       check=True, capture_output=True)
        der = subprocess.check_output(["openssl", "pkey", "-in", str(keyfile),
                                       "-pubout", "-outform", "DER"])
        public = der[-32:].hex()
        assert len(public) == 64
        code, _, _ = request("POST", f"/nodes/{node}/metrics-key", {"publicKey": public},
                             cookie=cookie, origin=BASE)
        assert_status(code, 201, "owner enrolls signing key")

        code, _, _ = request("POST", "/metrics/ingest", body,
                             headers={"Authorization": "Bearer xm_" + "a" * 64})
        assert code in (401, 403), f"enrolled node must reject bearer: HTTP {code}"
        print("PASS: bearer rejected after enrollment (auth or CSRF)")

        raw = json.dumps(body, separators=(",", ":")).encode()
        ts = int(time.time())
        nonce = os.urandom(16).hex()
        canonical = (f"XMESH1\nPOST\n/api/v1/metrics/ingest\n{node}\n{ts}\n{nonce}\n"
                     f"{hashlib.sha256(raw).hexdigest()}\n").encode()
        message = Path(directory) / "request.txt"
        message.write_bytes(canonical)
        signature = subprocess.check_output(
            ["openssl", "pkeyutl", "-sign", "-rawin", "-inkey", str(keyfile), "-in", str(message)])
        headers = {"X-XMesh-Timestamp": str(ts), "X-XMesh-Nonce": nonce,
                   "X-XMesh-Signature": signature.hex()}
        code, _, _ = request("POST", "/metrics/ingest", body, headers=headers)
        assert_status(code, 201, "valid Ed25519 telemetry accepted")

        code, _, _ = request("POST", "/metrics/ingest", body, headers=headers)
        assert_status(code, 401, "identical signed request rejected as replay")

        code, _, _ = request("POST", "/metrics/ingest",
                             {"node_id": node, "cpu_percent": 75.5, "metrics": {"unit": "signed-test"}},
                             headers=headers)
        assert_status(code, 401, "altered payload rejected")

        late_headers = {**headers, "X-XMesh-Timestamp": str(ts-600),
                        "X-XMesh-Nonce": os.urandom(16).hex()}
        code, _, _ = request("POST", "/metrics/ingest", body, headers=late_headers)
        assert_status(code, 401, "expired timestamp rejected")

        code, _, _ = request("POST", f"/nodes/{node}/metrics-token", {},
                             cookie=cookie, origin=BASE)
        assert code in (404, 405), f"removed bearer endpoint must remain disabled: HTTP {code}"
        print("PASS: removed bearer route remains disabled")

        # Restart requests use a separate signed control channel; a metrics
        # identity cannot execute unapproved commands or access another node.
        def signed_post(path, data):
            raw=json.dumps(data,separators=(",",":")).encode()
            stamp=int(time.time())
            unique=os.urandom(16).hex()
            canonical=(f"XMESH1\nPOST\n/api/v1{path}\n{node}\n{stamp}\n{unique}\n"
                       f"{hashlib.sha256(raw).hexdigest()}\n").encode()
            message.write_bytes(canonical)
            sig=subprocess.check_output([
                "openssl","pkeyutl","-sign","-rawin","-inkey",str(keyfile),"-in",str(message)
            ])
            headers={"X-XMesh-Timestamp":str(stamp),"X-XMesh-Nonce":unique,
                     "X-XMesh-Signature":sig.hex()}
            return request("POST",path,data,headers=headers)

        code,_,_=request("POST",f"/nodes/{node}/restart",{},cookie=cookie,origin=BASE)
        assert_status(code,409,"restart refused without live control agent")
        code,_,_=signed_post("/node/heartbeat",{
            "node_id":node,"version":"control-v1.0",
            "xray_running":True,"router_running":True})
        assert_status(code,200,"signed control heartbeat accepted")
        code,restart,_=request("POST",f"/nodes/{node}/restart",{},cookie=cookie,origin=BASE)
        assert_status(code,202,"admin queued an authenticated restart")
        restart_id=restart["id"]
        code,dup,_=request("POST",f"/nodes/{node}/restart",{},cookie=cookie,origin=BASE)
        assert_status(code,409,"duplicate in-flight restart refused")
        code,pending,_=signed_post("/node/restart/poll",{"node_id":node})
        assert_status(code,200,"signed node claims restart")
        assert pending["command"]=={"id":restart_id,"action":"restart_xray"}
        code,again,_=signed_post("/node/restart/poll",{"node_id":node})
        assert_status(code,200,"claimed command cannot execute twice")
        assert again["command"] is None
        code,_,_=signed_post("/node/restart/ack",{"node_id":node,"command_id":restart_id,
            "success":True,"detail":"systemd confirmed Xray active"})
        assert_status(code,200,"signed node acknowledges restart")
        code,restart_status,_=request("GET",f"/nodes/{node}/restart",cookie=cookie)
        assert_status(code,200,"admin sees confirmed restart")
        assert restart_status["state"]=="succeeded" and restart_status["id"]==restart_id

        # Real signed database accounting for two inbounds of the same user.
        code, new_user, _ = request("POST", "/collections/users",
            {"username": "ci_inbound_signed", "xrayId": "00000000-0000-0000-0000-000000000000"},
            cookie=cookie, origin=BASE)
        assert_status(code, 201, "create signed traffic user with backend-generated identity")
        user_id = new_user["id"]
        assert new_user["xrayId"] != "00000000-0000-0000-0000-000000000000"
        import uuid
        uuid.UUID(new_user["xrayId"])

        def report_signed(inbound_a, inbound_b):
            sample={
                "node_id":node,
                "userInboundTraffic":[
                    {"userId":user_id,"inboundTag":"DE_VLESS",
                     "uplinkBytes":inbound_a[0],"downlinkBytes":inbound_a[1]},
                    {"userId":user_id,"inboundTag":"CDN_DE",
                     "uplinkBytes":inbound_b[0],"downlinkBytes":inbound_b[1]}
                ],
                "userTraffic":[{"userId":user_id,
                    "uplinkBytes":inbound_a[0]+inbound_b[0],
                    "downlinkBytes":inbound_a[1]+inbound_b[1]}]
            }
            raw=json.dumps(sample,separators=(",",":")).encode()
            stamp=int(time.time())
            unique=os.urandom(16).hex()
            msg=(f"XMESH1\nPOST\n/api/v1/metrics/ingest\n{node}\n{stamp}\n{unique}\n"
                 f"{hashlib.sha256(raw).hexdigest()}\n").encode()
            message.write_bytes(msg)
            sig=subprocess.check_output(
                ["openssl","pkeyutl","-sign","-rawin","-inkey",str(keyfile),"-in",str(message)])
            hdr={"X-XMesh-Timestamp":str(stamp),"X-XMesh-Nonce":unique,
                 "X-XMesh-Signature":sig.hex()}
            return request("POST","/metrics/ingest",sample,headers=hdr)

        assert_status(report_signed((50,90),(25,35))[0],201,"first per-inbound baseline")
        assert_status(report_signed((100,120),(35,65))[0],201,"second per-inbound delta")
        code,traffic,_=request("GET",f"/users/{user_id}/traffic",cookie=cookie)
        assert_status(code,200,"read real per-user inbound breakdown")
        by_tag={x["inboundTag"]:x for x in traffic["inbounds"]}
        assert by_tag["DE_VLESS"]["uplinkBytes"]==50
        assert by_tag["DE_VLESS"]["downlinkBytes"]==30
        assert by_tag["CDN_DE"]["uplinkBytes"]==10
        assert by_tag["CDN_DE"]["downlinkBytes"]==30
        assert traffic["totalUplinkBytes"]==60
        assert traffic["totalDownlinkBytes"]==60
        code,users,_=request("GET","/collections/users",cookie=cookie)
        assert_status(code,200,"panel exposes metered user GiB")
        metered=next(u for u in users["items"] if u["id"]==user_id)
        assert abs(metered["used"]-(120/(1024**3)))<1e-9
        code,_,_=request("PATCH",f"/collections/users/{user_id}",{"used":0},
                         cookie=cookie,origin=BASE)
        assert_status(code,200,"traffic reset clears meter totals but keeps Xray baselines")
        code,after_reset,_=request("GET",f"/users/{user_id}/traffic",cookie=cookie)
        assert_status(code,200,"read reset metered traffic")
        assert after_reset["totalUplinkBytes"]==0
        assert after_reset["totalDownlinkBytes"]==0
        assert_status(report_signed((150,170),(45,95))[0],201,"next Xray delta after reset")
        code,users,_=request("GET","/collections/users",cookie=cookie)
        used=next(u["used"] for u in users["items"] if u["id"]==user_id)
        assert abs(used-(120/(1024**3)))<1e-9

        code,_,_=request("DELETE",f"/collections/users/{user_id}",
                         cookie=cookie,origin=BASE)
        assert_status(code,200,"clean up inbound stats user")

        code, _, _ = request("DELETE", f"/nodes/{node}/metrics-key",
                             cookie=cookie, origin=BASE)
        assert_status(code, 200, "owner revokes signed identity")
        code, _, _ = request("POST", "/metrics/ingest", body, headers=headers)
        assert_status(code, 401, "revoked node cannot send signatures")

        code, _, _ = request("DELETE", f"/collections/nodes/{node}",
                             cookie=cookie, origin=BASE)
        assert_status(code, 200, "clean up test node")

    print("Signed node identity, replay defense and downgrade prevention: PASS")


if __name__ == "__main__":
    main()
