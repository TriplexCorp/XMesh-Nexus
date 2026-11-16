#!/usr/bin/env python3
"""Bounded authentication-resource check. Disposable loopback CI only."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--observe", action="store_true")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
base = os.environ.get("XMESH_TEST_URL", "http://127.0.0.1:8080").rstrip("/")
parsed = urlsplit(base)
if (os.environ.get("XMESH_AUDIT_DISPOSABLE") != "1"
        or parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "::1", "localhost"}
        or parsed.username or parsed.password or parsed.path or parsed.query):
    raise SystemExit("This test requires an explicitly disposable loopback API")
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

http = build_opener(ProxyHandler({}), NoRedirect())
N = 64
created = []

def api(method, path, payload=None, cookie=None, timeout=30):
    headers = {"Accept": "application/json", "Origin": base}
    if cookie:
        headers["Cookie"] = cookie
    wire = None if payload is None else json.dumps(payload).encode()
    if wire is not None:
        headers["Content-Type"] = "application/json"
    request = Request(base + path, data=wire, headers=headers, method=method)
    try:
        response = http.open(request, timeout=timeout)
    except HTTPError as error:
        response = error
    with response:
        body = response.read(65537)
        if len(body) > 65536:
            raise RuntimeError("Unexpectedly large test response")
        try:
            value = json.loads(body) if body else {}
        except ValueError:
            value = {}
        cookies = response.headers.get_all("Set-Cookie", [])
        token = next((x.split(";", 1)[0] for x in cookies
                      if x.startswith("xmesh_session=")), None)
        return response.status, value, token

status, _, owner = api("POST", "/api/v1/auth/login", {
    "username": os.environ["ADMIN_USERNAME"],
    "password": os.environ["ADMIN_PASSWORD"],
})
if status != 200 or not owner:
    raise SystemExit("Disposable owner login failed")
prefix = "audit-" + uuid.uuid4().hex[:14]
password = uuid.uuid4().hex + uuid.uuid4().hex
report = {"schema": 1, "sourceRevision": os.environ.get("AUDIT_SOURCE_SHA", ""),
          "target": "disposable-loopback", "requests": N,
          "mode": "observe" if args.observe else "regression"}
try:
    accounts = []
    for i in range(N):
        username = prefix + "-" + str(i)
        status, account, _ = api("POST", "/api/v1/admins", {
            "username": username, "password": password, "role": "viewer",
        }, owner)
        if status != 201:
            raise RuntimeError("Disposable account creation failed")
        created.append(account["id"])
        accounts.append(username)
    barrier = threading.Barrier(N + 1, timeout=60)
    def invalid_login(username):
        barrier.wait()
        try:
            code, value, _ = api("POST", "/api/v1/auth/login", {
                "username": username, "password": "invalid-disposable-password",
            })
            return code, str(value.get("error", ""))
        except (OSError, URLError, TimeoutError):
            return 0, ""
    health_latencies = []
    health_failures = 0
    with ThreadPoolExecutor(max_workers=N) as pool:
        futures = [pool.submit(invalid_login, name) for name in accounts]
        barrier.wait()
        while not all(future.done() for future in futures):
            started = time.monotonic()
            try:
                code, _, _ = api("GET", "/api/v1/health/live", timeout=2)
                health_failures += int(code != 200)
            except (OSError, URLError, TimeoutError):
                health_failures += 1
            health_latencies.append(time.monotonic() - started)
            time.sleep(0.025)
        results = [future.result() for future in futures]
    busy = sum(code == 429 and "входа в панель" in message for code, message in results)
    report.update({
        "statusCounts": dict(Counter(str(code) for code, _ in results)),
        "workAdmissionRejections": busy,
        "healthFailures": health_failures,
        "maximumHealthLatencySeconds": round(max(health_latencies, default=0), 4),
    })
    code, _, _ = api("POST", "/api/v1/auth/login", {
        "username": accounts[0], "password": "invalid-disposable-password",
        "unusedPadding": "x" * 9000,
    })
    report["oversizedLoginStatus"] = code
    escaped_name = prefix + "-escaped"
    escaped_password = "\x01" * 1024
    code, record, _ = api("POST", "/api/v1/admins", {
        "username": escaped_name, "password": escaped_password, "role": "viewer",
    }, owner)
    if code != 201:
        raise RuntimeError("Escaped-password fixture creation failed")
    created.append(record["id"])
    code, value, _ = api("POST", "/api/v1/auth/login", {
        "username": escaped_name, "password": escaped_password,
    })
    report["escapedMaximumPasswordAccepted"] = code == 200 and value.get("authenticated") is True
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, sort_keys=True))
    if not args.observe:
        assert report["workAdmissionRejections"] > 0, "Concurrent password work has no admission bound"
        assert report["healthFailures"] == 0, "Password checks stalled the async health endpoint"
        assert report["maximumHealthLatencySeconds"] < 2, "Health responsiveness regressed"
        assert report["oversizedLoginStatus"] == 413, "Login body exceeds its bounded JSON budget"
        assert report["escapedMaximumPasswordAccepted"], "Valid escaped password lost compatibility"
        print("PASS: bounded login admission, async responsiveness, body budget and compatibility")
finally:
    for identifier in created:
        try:
            api("DELETE", "/api/v1/admins/" + str(identifier), cookie=owner)
        except Exception:
            pass
