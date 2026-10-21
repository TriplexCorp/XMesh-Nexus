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
    check(api("GET", "/collections/hosts", cookie=viewer_cookie)[0], 200, "viewer can read")
    check(api("POST", "/collections/hosts", {"name": "smoke"}, viewer_cookie)[0], 403,
          "viewer cannot write")
    check(api("GET", "/admins", cookie=viewer_cookie)[0], 403, "viewer cannot see administrators")

    check(api("PATCH", f"/admins/{viewer_id}", {"role": "admin"}, owner_cookie)[0], 200,
          "owner changes role")
    status, old, _ = api("GET", "/auth/session", cookie=viewer_cookie)
    check(status, 200, "old session inspected")
    assert old["authenticated"] is False, "Role update did not revoke session"
    admin, admin_cookie = login("ci_viewer", VIEWER_PASSWORD)
    assert admin["user"]["role"] == "admin"
    check(api("POST", "/collections/hosts", {"name": "ci smoke"}, admin_cookie)[0], 201,
          "admin can write")
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
