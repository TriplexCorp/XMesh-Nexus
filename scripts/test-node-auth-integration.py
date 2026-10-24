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

        # v1 agents cannot self-update. v4 can receive only a fixed signed action.
        code,_,_=request("POST",f"/nodes/{node}/agent-update",{},
                         cookie=cookie,origin=BASE)
        assert_status(code,409,"legacy control agent cannot run unknown update action")
        code,_,_=signed_post("/node/heartbeat",{
            "node_id":node,"version":"control-v4.0.0",
            "xray_running":True,"router_running":True})
        assert_status(code,200,"new control-v4 heartbeat accepted")
        code,_,_=request("POST",f"/nodes/{node}/agent-update",
            {"command":"rm -rf /"},cookie=cookie,origin=BASE)
        assert code in (400,422), f"arbitrary updater commands must be rejected: HTTP {code}"
        code,agent_command,_=request("POST",f"/nodes/{node}/agent-update",{},
                                    cookie=cookie,origin=BASE)
        assert_status(code,202,"admin queued a fixed agent self-update")
        assert agent_command["targetVersion"]=="control-v4.0.0"
        code,_,_=request("POST",f"/nodes/{node}/restart",{},
                         cookie=cookie,origin=BASE)
        assert_status(code,409,"agent update prevents overlapping restart commands")
        code,polled,_=signed_post("/node/restart/poll",{"node_id":node})
        assert_status(code,200,"signed v4 node receives agent update")
        assert polled["command"]=={
            "id":agent_command["id"],"action":"update_agent","targetVersion":"control-v4.0.0"}
        code,_,_=signed_post("/node/restart/ack",{
            "node_id":node,"command_id":agent_command["id"],
            "success":True,"detail":"Agent control-v4.0.0 installed and verified"})
        assert_status(code,200,"signed node confirms agent update")
        code,last_command,_=request("GET",f"/nodes/{node}/restart",cookie=cookie)
        assert_status(code,200,"admin reads confirmed agent-update status")
        assert last_command["state"]=="succeeded" and last_command["action"]=="update_agent"

        # Real signed database accounting for two inbounds of the same user.
        code, new_user, _ = request("POST", "/collections/users",
            {"username": "ci_inbound_signed", "xrayId": "00000000-0000-0000-0000-000000000000"},
            cookie=cookie, origin=BASE)
        assert_status(code, 201, "create signed traffic user with backend-generated identity")
        user_id = new_user["id"]
        assert new_user["xrayId"] != "00000000-0000-0000-0000-000000000000"
        import uuid
        uuid.UUID(new_user["xrayId"])

        # End-to-end authenticated desired-config: policy binds live UUIDs,
        # expiry, conservative offline quota and exact Xray JSON digest.
        profile_config={
            "inbounds":[{"tag":"DE_VLESS","listen":"127.0.0.1","port":28351,
                         "protocol":"vless","settings":{"decryption":"none","clients":[]},
                         "streamSettings":{"network":"tcp","security":"none"}}],
            "outbounds":[{"tag":"direct","protocol":"freedom"}],
            "routing":{"rules":[]}
        }
        code,profile,_=request("POST","/collections/profiles",
            {"name":"CI signed autonomous profile","config":json.dumps(profile_config)},
            cookie=cookie,origin=BASE)
        assert_status(code,201,"create XRAY STUDIO profile for node policy test")
        profile_id=profile["id"]
        code,squad,_=request("POST","/collections/squads",
            {"name":"CI autonomous squad","inb":["DE_VLESS"]},
            cookie=cookie,origin=BASE)
        assert_status(code,201,"create inbound assignment for policy test")
        squad_id=squad["id"]
        code,_,_=request("PATCH",f"/collections/users/{user_id}",
            {"squads":[squad_id],"limit":1.0,
             "expireAt":int(time.time()*1000)+86400000},
            cookie=cookie,origin=BASE)
        assert_status(code,200,"assign user and expiration")
        code,_,_=request("PATCH",f"/collections/nodes/{node}",
            {"profileId":profile_id,"xrayLocalPort":28351},
            cookie=cookie,origin=BASE)
        assert_status(code,200,"bind signed profile to node")
        code,desired,_=signed_post("/node/desired-config",{"node_id":node})
        assert_status(code,200,"node pulls signed, versioned desired policy")
        policy=desired["policy"]
        assert policy["nodeId"]==node and policy["version"]==1
        assert policy["validUntilMs"]>policy["issuedAtMs"]
        assert any(u["xrayId"]==new_user["xrayId"] and
                   u["offlineBudgetBytes"]>0 for u in policy["users"])
        serialized=json.dumps(desired["config"],sort_keys=True,
                              separators=(",",":"),ensure_ascii=False).encode()
        assert policy["configSha256"]==hashlib.sha256(serialized).hexdigest()
        assert desired["config"]["inbounds"][1]["tag"]=="xmesh_stats_in"
        der=(bytes.fromhex("302a300506032b6570032100")+
             bytes.fromhex(desired["policyPublicKey"]))
        policy_file=Path(directory)/"policy.json"
        pub_file=Path(directory)/"policy-public.der"
        sig_file=Path(directory)/"policy.sig"
        policy_file.write_bytes(json.dumps(policy,sort_keys=True,
                                ensure_ascii=False,separators=(",",":")).encode())
        pub_file.write_bytes(der)
        sig_file.write_bytes(bytes.fromhex(desired["policySignature"]))
        subprocess.run(["openssl","pkeyutl","-verify","-pubin",
            "-keyform","DER","-inkey",str(pub_file),"-rawin",
            "-in",str(policy_file),"-sigfile",str(sig_file)],
            check=True,capture_output=True)
        print("PASS: panel Ed25519 policy signature matches Xray JSON and live user assignment")

        # Distinct actual source snapshots must have strictly increasing sample times,
        # even when the test sends multiple requests within one millisecond.
        source_clock_ms = int(time.time() * 1000)
        def report_signed(inbound_a, inbound_b, sampled_at_ms=None):
            nonlocal source_clock_ms
            source_clock_ms = max(source_clock_ms + 1, int(time.time() * 1000))
            sample={
                "node_id":node,
                "userStatsStatus":"verified",
                "userStatsAtMs":source_clock_ms if sampled_at_ms is None else sampled_at_ms,
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
        assert_status(report_signed((100,120),(35,65))[0],201,"idempotent cumulative replay on new signed request")
        code,traffic,_=request("GET",f"/users/{user_id}/traffic",cookie=cookie)
        assert_status(code,200,"read real per-user inbound breakdown")
        assert any(c["nodeId"]==node and c["status"]=="verified" for c in traffic["collectors"])
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
        assert abs(used-(140/(1024**3)))<1e-9

        # Old snapshots must not replay traffic or extend the user's presence.
        code,presence,_=request("GET","/users/presence",cookie=cookie)
        assert_status(code,200,"read restricted user presence")
        assert all(set(item.keys())=={"id","onlineAt"} for item in presence["items"])
        previous_online=next(item["onlineAt"] for item in presence["items"] if item["id"]==user_id)
        old_sample_ms=source_clock_ms-2
        assert_status(report_signed((9000,9000),(9000,9000),sampled_at_ms=old_sample_ms)[0],
                      201,"out-of-order stats accepted only as system telemetry")
        code,after_stale,_=request("GET",f"/users/{user_id}/traffic",cookie=cookie)
        assert_status(code,200,"read usage after stale user stats")
        assert after_stale["totalUplinkBytes"]==140
        assert after_stale["totalDownlinkBytes"]==120
        code,presence,_=request("GET","/users/presence",cookie=cookie)
        assert next(item["onlineAt"] for item in presence["items"] if item["id"]==user_id)==previous_online

        code,_,_=request("DELETE",f"/collections/users/{user_id}",
                         cookie=cookie,origin=BASE)
        assert_status(code,200,"clean up inbound stats user")
        for collection, ident in (("squads",squad_id),("profiles",profile_id)):
            code,_,_=request("DELETE",f"/collections/{collection}/{ident}",
                             cookie=cookie,origin=BASE)
            assert_status(code,200,f"clean up autonomous {collection}")

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
