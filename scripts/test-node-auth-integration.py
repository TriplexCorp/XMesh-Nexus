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

    code, issued, _ = request("POST", f"/nodes/{node}/metrics-token", {},
                               cookie=cookie, origin=BASE)
    assert_status(code, 201, "legacy bearer issued")
    token = issued["token"]
    code, _, _ = request("POST", "/metrics/ingest", body,
                         headers={"Authorization": "Bearer " + token})
    assert_status(code, 201, "legacy bearer works before enrollment")

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
                             headers={"Authorization": "Bearer " + token})
        assert_status(code, 401, "enrollment revokes old bearer")

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
        assert_status(code, 409, "signed node cannot downgrade to bearer")

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
