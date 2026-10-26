#!/usr/bin/env python3
"""Real PostgreSQL/Redis API smoke tests. Only run on a disposable CI database."""
import base64
import hashlib
import hmac
import json
import os
import struct
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = os.getenv("XMESH_TEST_URL", "http://127.0.0.1:8080").rstrip("/")
USER = os.getenv("ADMIN_USERNAME", "admin")
PASSWORD = os.environ["ADMIN_PASSWORD"]
VIEWER_PASSWORD = "integration-viewer-secret-password-0123"
NEW_PASSWORD = "integration-new-owner-password-012345"


def api(method, path, payload=None, cookie=None, origin=BASE):
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if origin is not None:
        headers["Origin"] = origin
    if cookie:
        headers["Cookie"] = cookie
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(BASE + "/api/v1" + path, data=data, headers=headers, method=method)
    try:
        response = urlopen(req, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        body = response.read()
        obj = json.loads(body) if body else None
        cookies = response.headers.get_all("Set-Cookie", [])
        token = next((x.split(";", 1)[0] for x in cookies if x.startswith("xmesh_session=")), None)
        return response.status, obj, token


def check(status, expected, label):
    assert status == expected, f"{label}: expected HTTP {expected}, got {status}"
    print("PASS:", label)


def login(user, password, mfa=False):
    status, data, cookie = api("POST", "/auth/login", {"username": user, "password": password})
    check(status, 200, "login " + user)
    if mfa:
        assert data["mfaRequired"] is True and not cookie, "Password login bypassed MFA"
    else:
        assert data["authenticated"] is True and cookie, "Missing session cookie"
    return data, cookie


def totp(secret):
    key = base64.b32decode(secret)
    digest = hmac.new(key, struct.pack(">Q", int(time.time() // 30)), hashlib.sha1).digest()
    offset = digest[-1] & 15
    value = struct.unpack(">I", digest[offset:offset+4])[0] & 0x7fffffff
    return f"{value % 1000000:06d}"


def main():
    owner, owner_cookie = login(USER, PASSWORD)
    owner_id = owner["user"]["id"]
    create = {"username": "ci_viewer", "password": VIEWER_PASSWORD, "role": "viewer"}

    check(api("POST", "/admins", create, owner_cookie, origin=None)[0], 403, "missing Origin rejected")
    check(api("POST", "/admins", create, owner_cookie, origin="https://attacker.invalid")[0], 403,
          "foreign Origin rejected")
    status, viewer, _ = api("POST", "/admins", create, owner_cookie)
    check(status, 201, "owner creates viewer")
    viewer_id = viewer["id"]
    _, viewer_cookie = login("ci_viewer", VIEWER_PASSWORD)
    check(api("GET", "/collections/hosts", cookie=viewer_cookie)[0], 403, "viewer denied host configuration")
    check(api("GET", "/collections/users", cookie=viewer_cookie)[0], 200, "viewer can read user overview")
    check(api("GET", "/security/policy", cookie=viewer_cookie)[0], 403, "viewer denied security policy")
    check(api("POST", "/collections/hosts", {"name": "smoke"}, viewer_cookie)[0], 403,
          "viewer cannot write")
    check(api("GET", "/admins", cookie=viewer_cookie)[0], 403, "viewer cannot see administrators")
    status, user, _ = api("POST", "/collections/users",
                          {"username": "ci_viewer_audit", "limit": 10}, owner_cookie)
    check(status, 201, "owner creates viewer protection test user")
    user_id = user["id"]
    assert user.get("xrayId"), "owner must receive original Xray UUID"
    credential_fields = ("vmessId", "trojanPassword", "hysteriaPassword",
                         "masquePassword", "ssLegacyPassword", "httpPassword", "socksPassword")
    assert len(user["vmessId"]) == 36 and user["vmessId"] != user["xrayId"]
    isolated_passwords = [user[key] for key in credential_fields[1:]]
    assert all(len(password) == 64 for password in isolated_passwords)
    assert len(set(isolated_passwords + [user["xrayId"], user["vmessId"]])) == 8
    status, listing, _ = api("GET", "/collections/users", cookie=viewer_cookie)
    check(status, 200, "viewer reads redacted users")
    exposed = next(entry for entry in listing["items"] if entry["id"] == user_id)
    assert exposed["username"] == "ci_viewer_audit"
    assert "xrayId" not in exposed
    for key in credential_fields:
        assert key not in exposed
    assert user["xrayId"] not in json.dumps(listing)
    status, data, _ = api("GET", "/bootstrap", cookie=viewer_cookie)
    check(status, 200, "viewer bootstrap is redacted")
    assert data["collections"]["hosts"] == []
    assert data["collections"]["profiles"] == []
    assert data["settings"].keys() == {"brand"}
    assert user["xrayId"] not in json.dumps(data)
    status, settings, _ = api("GET", "/settings", cookie=viewer_cookie)
    check(status, 200, "viewer settings are restricted")
    assert settings.keys() == {"brand"}
    check(api("GET", f"/users/{user_id}/subscription", cookie=viewer_cookie)[0], 403,
          "viewer denied subscription retrieval")
    check(api("GET", f"/users/{user_id}/client-json", cookie=viewer_cookie)[0], 403,
          "viewer denied client configuration retrieval")
    check(api("GET", "/collections/profiles", cookie=viewer_cookie)[0], 403,
          "viewer denied XRAY STUDIO profiles")
    check(api("GET", "/nodes/1/restart", cookie=viewer_cookie)[0], 403,
          "viewer denied node command history")
    check(api("POST", f"/users/{user_id}/credentials/rotate", cookie=viewer_cookie)[0], 403,
          "viewer forbidden from rotating VPN credentials")
    old_status, old_sub, _ = api("GET", f"/users/{user_id}/subscription", cookie=owner_cookie)
    check(old_status, 200, "read existing subscription token")
    old_token = old_sub["token"]
    status, changed, _ = api("POST", f"/users/{user_id}/credentials/rotate", cookie=owner_cookie)
    check(status, 200, "owner rotates VPN and subscription credentials")
    assert changed["xrayId"] != user["xrayId"] and changed["requiresNodeSync"]
    status, new_sub, _ = api("GET", f"/users/{user_id}/subscription", cookie=owner_cookie)
    check(status, 200, "read regenerated subscription token")
    assert new_sub["token"] != old_token
    status, listing, _ = api("GET", "/collections/users", cookie=owner_cookie)
    check(status, 200, "read rotated independent protocol credentials")
    new_user = next(entry for entry in listing["items"] if entry["id"] == user_id)
    for key in credential_fields:
        assert new_user[key] != user[key], f"{key} not rotated"
    assert len({new_user[key] for key in credential_fields}) == 7




    check(api("PATCH", f"/admins/{viewer_id}", {"role": "admin"}, owner_cookie)[0], 200,
          "owner changes role")
    status, old, _ = api("GET", "/auth/session", cookie=viewer_cookie)
    check(status, 200, "old session inspected")
    assert old["authenticated"] is False, "Role update did not revoke session"
    admin, admin_cookie = login("ci_viewer", VIEWER_PASSWORD)
    assert admin["user"]["role"] == "admin"
    # Active hosts require a valid XRAY profile, inbound and node bindings.
    check(api("POST", "/collections/hosts", {"name": "ci smoke"}, admin_cookie)[0], 400,
          "admin cannot create unbound active host")
    check(api("POST", "/collections/hosts", {"name": "ci smoke", "disabled": True}, admin_cookie)[0], 201,
          "admin can create disabled host draft")
    # Positive authorization path: create a real active VLESS host using a
    # valid profile and a node explicitly bound to that same profile.
    profile_config = {
        "inbounds": [{
            "tag": "CI_AUTH_VLESS", "listen": "127.0.0.1", "port": 28352,
            "protocol": "vless", "settings": {"decryption": "none", "clients": []},
            "streamSettings": {"network": "tcp", "security": "none"}
        }],
        "outbounds": [{"tag": "direct", "protocol": "freedom"}],
        "routing": {"rules": []}
    }
    status, profile, _ = api("POST", "/collections/profiles",
                             {"name": "CI auth host profile", "config": json.dumps(profile_config)},
                             admin_cookie)
    check(status, 201, "admin creates valid XRAY profile")
    profile_id = profile["id"]
    status, node, _ = api("POST", "/collections/nodes",
                          {"name": "CI auth host node", "addr": "127.0.0.1",
                           "profileId": profile_id}, admin_cookie)
    check(status, 201, "admin creates profile-bound node")
    node_id = node["id"]
    status, host, _ = api("POST", "/collections/hosts",
                          {"name": "ci active host", "profileId": profile_id,
                           "tag": "CI_AUTH_VLESS", "address": "ci-host.example.com",
                           "port": 443, "nodes": [node_id]}, admin_cookie)
    check(status, 201, "admin creates fully bound active host")
    assert host["id"] > 0 and host["profileId"] == profile_id
    assert host["nodes"] == [node_id] and host["tag"] == "CI_AUTH_VLESS"
    check(api("DELETE", f"/collections/hosts/{host['id']}", cookie=admin_cookie)[0], 200,
          "clean up active host")
    check(api("DELETE", f"/collections/nodes/{node_id}", cookie=admin_cookie)[0], 200,
          "clean up active host node")
    check(api("DELETE", f"/collections/profiles/{profile_id}", cookie=admin_cookie)[0], 200,
          "clean up active host profile")
    check(api("GET", "/admins", cookie=admin_cookie)[0], 403, "admin cannot manage administrators")
    check(api("PATCH", f"/admins/{viewer_id}", {"isActive": False}, owner_cookie)[0], 200,
          "owner disables admin")
    check(api("GET", "/bootstrap", cookie=admin_cookie)[0], 401,
          "disabled administrator session revoked")

    status, availability, _ = api("GET", "/auth/mfa/status", cookie=owner_cookie)
    check(status, 200, "MFA status")
    assert availability["available"] and not availability["enabled"], "MFA key not configured in CI"
    status, setup, _ = api("POST", "/auth/mfa/setup", {"password": PASSWORD}, owner_cookie)
    check(status, 200, "MFA setup")
    status, enabled, _ = api("POST", "/auth/mfa/confirm", {"code": totp(setup["secret"])}, owner_cookie)
    check(status, 200, "MFA confirm")
    codes = enabled["recoveryCodes"]
    assert enabled["enabled"] and len(codes) == 10

    pending, _ = login(USER, PASSWORD, mfa=True)
    status, signed_in, mfa_cookie = api(
        "POST", "/auth/mfa/verify", {"challenge": pending["challenge"], "code": codes[0]})
    check(status, 200, "recovery code login")
    assert signed_in["authenticated"] and mfa_cookie
    # maxSessions=1 is the strict default: the new MFA session revokes the
    # previous owner cookie. Critical mutations must use the current session.
    owner_cookie = mfa_cookie
    check(api("POST", "/auth/mfa/verify",
              {"challenge": pending["challenge"], "code": codes[0]})[0], 401,
          "MFA challenge cannot replay")
    another, _ = login(USER, PASSWORD, mfa=True)
    check(api("POST", "/auth/mfa/verify",
              {"challenge": another["challenge"], "code": codes[0]})[0], 401,
          "recovery code cannot replay")

    stale, _ = login(USER, PASSWORD, mfa=True)
    check(api("PATCH", f"/admins/{owner_id}", {"password": NEW_PASSWORD}, owner_cookie)[0], 200,
          "password rotation")
    check(api("POST", "/auth/mfa/verify",
              {"challenge": stale["challenge"], "code": codes[1]})[0], 401,
          "pending challenge revoked after password change")
    check(api("POST", "/auth/login", {"username": USER, "password": PASSWORD})[0], 401,
          "old password invalid")
    fresh, _ = login(USER, NEW_PASSWORD, mfa=True)
    status, _, fresh_cookie = api(
        "POST", "/auth/mfa/verify", {"challenge": fresh["challenge"], "code": codes[1]})
    check(status, 200, "new password plus MFA works")
    check(api("PATCH", f"/admins/{owner_id}", {"isActive": False}, fresh_cookie)[0], 400,
          "owner cannot disable own account")
    check(api("DELETE", f"/admins/{owner_id}", cookie=fresh_cookie)[0], 400,
          "owner cannot delete own account")
    print("Real PostgreSQL/Redis RBAC and MFA integration tests passed.")


if __name__ == "__main__":
    main()
