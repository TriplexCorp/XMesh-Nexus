#!/usr/bin/env python3
"""Disposable P0-C2-B exact ACK-route process E2E.

Requires the already-reviewed C2-A transport/origin design. This test proves only
that one staging ACK operation is mounted behind the strict hybrid mTLS -> UDS
boundary, that caller identity metadata is stripped, and that the origin binds
request structure to the trusted transport Node. It performs no ACK signature
verification, database mutation, signer call, or production activation.
"""
from __future__ import annotations

import json
from pathlib import Path
import secrets
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
HOSTNAME = "node-ingress.xsp.invalid"
ALIAS = "xsp-ingress-c2b"
ACK_PATH = "/api/v2/node/keys/rotation/ack"
IDENTITY_PATH = "/__xsp_v2_identity_probe"
TRUSTED_NODE_ID = 4242


def command(*args: str, input_text: str | None = None, check: bool = True, timeout: int = 120):
    result = subprocess.run(
        args,
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=timeout,
    )
    if check and result.returncode:
        raise RuntimeError(
            f"{args[0]} failed ({result.returncode}): "
            f"{(result.stderr or result.stdout)[-1800:]}"
        )
    return result


def parse_json_body(response: str) -> dict[str, object]:
    decoder = json.JSONDecoder()
    start = response.find("{")
    while start >= 0:
        try:
            value, _end = decoder.raw_decode(response[start:])
        except json.JSONDecodeError:
            start = response.find("{", start + 1)
            continue
        if isinstance(value, dict):
            return value
        start = response.find("{", start + 1)
    raise RuntimeError(f"missing JSON response body: {response[-1200:]}")


def main() -> None:
    token = secrets.token_hex(5)
    prefix = f"xsp-c2b-e2e-{token}"
    runtime_image = f"xmesh-xsp-ingress-c2b:{token}"
    origin_image = f"xmesh-xsp-origin-c2b:{token}"
    probe_image = f"xmesh-xsp-ingress-probe:{token}"
    network = f"{prefix}-net"
    ingress = f"{prefix}-ingress"
    origin = f"{prefix}-origin"
    certs = f"{prefix}-certs"
    origin_socket = f"{prefix}-origin-socket"
    containers: list[str] = []
    client_material = tempfile.TemporaryDirectory(prefix=f"{prefix}-client-material-")
    client_material_path = Path(client_material.name)
    expected_spki = ""

    def start_origin(*, enabled: bool) -> None:
        args = [
            "docker", "run", "-d",
            "--name", origin,
            "--network", "none",
            "--read-only",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=8m,mode=1777",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--mount", f"type=volume,src={origin_socket},dst=/run/xmesh-origin",
            "-e", f"XSP_EXPECTED_CLIENT_SPKI_SHA256={expected_spki}",
            "-e", f"XSP_EXPECTED_NODE_ID={TRUSTED_NODE_ID}",
            "-e", "XSP_EXPECTED_INGRESS_UID=10003",
            "-e", "XSP_EXPECTED_INGRESS_GID=10003",
        ]
        if enabled:
            args.extend(["-e", "XSP_V2_C2B_ACK_ROUTE=staging-only"])
        args.append(origin_image)
        command(*args)
        containers.append(origin)
        for _ in range(50):
            ready = command(
                "docker", "run", "--rm", "--network", "none",
                "--mount", f"type=volume,src={origin_socket},dst=/run/xmesh-origin,readonly",
                "--entrypoint", "/bin/sh", probe_image, "-ceu",
                "test -S /run/xmesh-origin/xsp-v2-origin.sock",
                check=False,
            )
            if ready.returncode == 0:
                return
            time.sleep(0.1)
        raise RuntimeError("C2-B origin Unix socket never became ready")

    def stop_origin() -> None:
        command("docker", "rm", "-f", origin, check=False)
        if origin in containers:
            containers.remove(origin)
        command(
            "docker", "run", "--rm", "--network", "none",
            "--mount", f"type=volume,src={origin_socket},dst=/run/xmesh-origin",
            "--entrypoint", "/bin/sh", probe_image, "-ceu",
            "rm -f /run/xmesh-origin/xsp-v2-origin.sock",
            check=False,
        )

    def https_request(
        method: str,
        path: str,
        body: str = "",
        cert: str | None = "client.pem",
        key: str | None = "client-key.pem",
        content_type: str | None = "application/json",
        extra_headers: tuple[str, ...] = (),
        include_length: bool = True,
    ):
        request_headers = [f"Host: {HOSTNAME}", "Connection: close"]
        if content_type is not None:
            request_headers.append(f"Content-Type: {content_type}")
        if include_length:
            request_headers.append(f"Content-Length: {len(body.encode())}")
        request_headers.extend(extra_headers)
        raw = f"{method} {path} HTTP/1.1\r\n" + "\r\n".join(request_headers) + f"\r\n\r\n{body}"
        openssl_args = [
            "s_client", "-quiet", "-ign_eof",
            "-connect", f"{ALIAS}:8444",
            "-servername", HOSTNAME,
            "-verify_hostname", HOSTNAME,
            "-verify_return_error",
            "-CAfile", "/certs/fullchain.pem",
            "-tls1_3", "-groups", "X25519MLKEM768",
        ]
        if cert and key:
            openssl_args.extend(["-cert", f"/certs/{cert}", "-key", f"/certs/{key}"])
        # s_client -ign_eof is intentionally used so stdin EOF cannot truncate a
        # server response. Bound the client externally and preserve its output;
        # status assertions below, not process longevity, decide test success.
        shell = r'''
set +e
timeout 5s openssl "$@"
rc=$?
if [ "$rc" -ne 0 ] && [ "$rc" -ne 124 ]; then
  exit "$rc"
fi
exit 0
'''
        return command(
            "docker", "run", "--rm", "-i",
            "--network", network,
            "--mount", f"type=volume,src={certs},dst=/certs,readonly",
            "--entrypoint", "/bin/sh", probe_image,
            "-ceu", shell, "xsp-c2b-probe", *openssl_args,
            input_text=raw, check=False, timeout=12,
        )

    def response_text(result: subprocess.CompletedProcess[str]) -> str:
        return (result.stdout or "") + (result.stderr or "")

    def expect_status(label: str, result: subprocess.CompletedProcess[str], status: str) -> str:
        response = response_text(result)
        if status not in response:
            raise RuntimeError(f"{label}: expected {status}: {response[-1400:]}")
        if status != "202 Accepted" and "202 Accepted" in response:
            raise RuntimeError(f"{label}: rejected request also contained 202: {response[-1400:]}")
        return response

    def make_ack(**changes: object) -> str:
        now = int(time.time() * 1000)
        message: dict[str, object] = {
            "kind": "ack",
            "issuerId": f"node-{TRUSTED_NODE_ID}",
            "signerEdKeyId": "ed-next",
            "signerPQKeyId": "pq-next",
            "nodeId": TRUSTED_NODE_ID,
            "fromEpoch": 7,
            "toEpoch": 8,
            "requestId": "c2b-process-e2e",
            "fromEdKeyId": "ed-old",
            "fromPQKeyId": "pq-old",
            "toEdKeyId": "ed-next",
            "toPQKeyId": "pq-next",
            "method": "POST",
            "path": ACK_PATH,
            "issuedAtMs": now,
            "expiresAtMs": now + 60_000,
            "permitNonceHex": "11" * 16,
            "nonceHex": "22" * 16,
            "candidateSha256Hex": "33" * 32,
            "permitSha256Hex": "44" * 32,
            "appliedStateSha256Hex": "55" * 32,
        }
        message.update(changes)
        return json.dumps(
            {
                "message": message,
                # Deliberately non-cryptographic placeholders: C2-B must never
                # claim to verify these. C2-C owns dual-signature authorization.
                "signatures": {"ed25519": "c2b-not-verified", "mldsa65": "c2b-not-verified"},
            },
            separators=(",", ":"),
        )

    def wait_ingress_ready() -> None:
        last = ""
        for _ in range(30):
            response = response_text(
                https_request("GET", IDENTITY_PATH, "", content_type=None, include_length=False)
            )
            if "200 OK" in response:
                return
            last = response[-800:]
            time.sleep(0.2)
        logs = command("docker", "logs", "--tail", "40", ingress, check=False)
        raise RuntimeError(f"C2-B ingress never became ready: {last}\n{logs.stderr[-1200:]}")

    try:
        command("docker", "network", "create", "--internal", network)
        command("docker", "volume", "create", certs)
        command("docker", "volume", "create", origin_socket)

        dockerfile = ROOT / "deploy/xsp-v2-ingress/Dockerfile"
        for target, tag in [
            ("runtime-c2b", runtime_image),
            ("origin-ack-gate", origin_image),
            ("probe", probe_image),
        ]:
            command(
                "docker", "build", "-f", str(dockerfile), "--target", target,
                "-t", tag, str(ROOT), timeout=600,
            )

        command(
            "go", "run", str(ROOT / "scripts/generate-xsp-v2-mldsa-test-certs.go"),
            "-out", str(client_material_path), timeout=60,
        )
        required = [
            "client-ca.pem", "client.pem", "client-key.pem", "other-client.pem",
            "other-client-key.pem", "classical-client.pem", "classical-client-key.pem",
            "client-spki.sha256",
        ]
        for name in required:
            if not (client_material_path / name).is_file():
                raise RuntimeError(f"ML-DSA fixture generator omitted {name}")

        cert_setup = r'''
set -eu
umask 077
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -subj "/CN=node-ingress.xsp.invalid" \
  -addext "subjectAltName=DNS:node-ingress.xsp.invalid" \
  -days 1 -keyout /certs/privkey.pem -out /certs/fullchain.pem >/dev/null 2>&1
for name in client-ca.pem client.pem client-key.pem other-client.pem other-client-key.pem \
  classical-client.pem classical-client-key.pem client-spki.sha256; do
  cp "/client-material/$name" "/certs/$name"
done
chown 0:10003 /certs/privkey.pem /certs/fullchain.pem /certs/client-ca.pem
chmod 0440 /certs/privkey.pem /certs/fullchain.pem /certs/client-ca.pem
chmod 0400 /certs/client-key.pem /certs/other-client-key.pem /certs/classical-client-key.pem
chmod 0444 /certs/client.pem /certs/other-client.pem /certs/classical-client.pem /certs/client-spki.sha256
'''
        command(
            "docker", "run", "--rm", "--user", "0:0",
            "--mount", f"type=volume,src={certs},dst=/certs",
            "--mount", f"type=bind,src={client_material_path},dst=/client-material,readonly",
            "--entrypoint", "/bin/sh", probe_image, "-ceu", cert_setup,
            timeout=60,
        )
        expected_spki = command(
            "docker", "run", "--rm", "--mount", f"type=volume,src={certs},dst=/certs,readonly",
            "--entrypoint", "/bin/sh", probe_image, "-ceu", "cat /certs/client-spki.sha256",
        ).stdout.strip()
        if len(expected_spki) != 64:
            raise RuntimeError("invalid disposable client SPKI fingerprint")

        command(
            "docker", "run", "--rm", "--user", "0:0", "--network", "none",
            "--mount", f"type=volume,src={origin_socket},dst=/run/xmesh-origin",
            "--entrypoint", "/bin/sh", origin_image, "-ceu",
            "chown 10004:10003 /run/xmesh-origin && chmod 0750 /run/xmesh-origin",
        )

        start_origin(enabled=False)
        command(
            "docker", "run", "-d", "--name", ingress,
            "--network", network, "--network-alias", ALIAS,
            "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m,mode=1777",
            "--cap-drop=ALL", "--security-opt=no-new-privileges",
            "--mount", f"type=volume,src={certs},dst=/run/xmesh-ingress-certs,readonly",
            "--mount", f"type=volume,src={origin_socket},dst=/run/xmesh-origin",
            runtime_image,
        )
        containers.append(ingress)

        inspect = json.loads(command("docker", "inspect", ingress).stdout)[0]
        if inspect["Config"].get("User") != "10003:10003":
            raise RuntimeError("C2-B ingress must run as dedicated non-root UID/GID")
        host = inspect["HostConfig"]
        if not host.get("ReadonlyRootfs") or "ALL" not in (host.get("CapDrop") or []):
            raise RuntimeError("C2-B ingress must be read-only and capability-free")
        if host.get("PortBindings"):
            raise RuntimeError("C2-B ingress must not publish a host port")
        if not any("no-new-privileges" in item for item in host.get("SecurityOpt") or []):
            raise RuntimeError("C2-B ingress must enforce no-new-privileges")

        net = json.loads(command("docker", "network", "inspect", network).stdout)[0]
        if not net.get("Internal"):
            raise RuntimeError("C2-B network must be internal/no-egress")
        members = sorted(item["Name"] for item in net.get("Containers", {}).values())
        if members != [ingress]:
            raise RuntimeError(f"unexpected persistent C2-B network members: {members}")

        wait_ingress_ready()
        ack = make_ack()
        expect_status("runtime gate off", https_request("POST", ACK_PATH, ack), "404 Not Found")
        print("PASS: C2-B ACK route stays 404 until staging-only runtime gate is enabled")

        stop_origin()
        start_origin(enabled=True)
        wait_ingress_ready()

        valid = https_request(
            "POST", ACK_PATH, ack,
            extra_headers=(
                "X-XSP-V2-Trusted-Node-ID: 999999",
                "X-XSP-V2-Client-Verify: SUCCESS",
                "X-XSP-V2-Client-Cert: forged",
            ),
        )
        valid_response = expect_status("valid C2-B structural ACK", valid, "202 Accepted")
        result = parse_json_body(valid_response)
        expected_result = {
            "acceptedStage": "c2b-structural-gate",
            "authorizationStatus": "not-verified",
            "trustedNodeId": TRUSTED_NODE_ID,
        }
        if result != expected_result or "999999" in valid_response:
            raise RuntimeError(f"C2-B trusted caller-controlled identity material: {result}")
        print("PASS: exact ACK reaches structural gate via trusted mTLS -> UDS Node identity only")

        expect_status(
            "anonymous ACK",
            https_request("POST", ACK_PATH, ack, cert=None, key=None),
            "403 Forbidden",
        )
        expect_status("wrong ACK method", https_request("GET", ACK_PATH, ""), "405 Not Allowed")
        expect_status(
            "wrong content type",
            https_request("POST", ACK_PATH, ack, content_type="text/plain"),
            "415 Unsupported Media Type",
        )
        expect_status(
            "missing content length",
            https_request("POST", ACK_PATH, ack, include_length=False),
            "411 Length Required",
        )
        print("PASS: method, media type, length, and client-auth ingress gates fail closed")

        for path in ["/", "/api/v1/node/heartbeat", "/api/v2/node/heartbeat", ACK_PATH + "/extra"]:
            expect_status(f"inert path {path}", https_request("POST", path, ack), "404 Not Found")
        print("PASS: C2-B exposes no broad proxy or unrelated application route")

        expect_status(
            "body Node impersonation",
            https_request("POST", ACK_PATH, make_ack(nodeId=999999, issuerId="node-999999")),
            "400 Bad Request",
        )
        expect_status(
            "signed path mismatch",
            https_request("POST", ACK_PATH, make_ack(path="/api/v2/node/heartbeat")),
            "400 Bad Request",
        )
        expect_status(
            "wrong message class",
            https_request("POST", ACK_PATH, make_ack(kind="permit")),
            "400 Bad Request",
        )
        duplicate_kind = ack.replace('"kind":"ack"', '"kind":"ack","kind":"ack"', 1)
        expect_status(
            "duplicate JSON key",
            https_request("POST", ACK_PATH, duplicate_kind),
            "400 Bad Request",
        )
        print("PASS: ACK envelope binds trusted Node/class/path and rejects duplicate JSON keys")

        for label, cert, key in [
            ("different ML-DSA-65 client", "other-client.pem", "other-client-key.pem"),
            ("classical ECDSA client", "classical-client.pem", "classical-client-key.pem"),
        ]:
            response = response_text(https_request("POST", ACK_PATH, ack, cert=cert, key=key))
            if "202 Accepted" in response:
                raise RuntimeError(f"{label} impersonated pinned C2-B Node identity")
        print("PASS: alternate/PQ and classical client identities cannot impersonate the pinned Node")

        forged_request = (
            f"POST {ACK_PATH} HTTP/1.1\r\n"
            "Host: forged\r\n"
            "X-XSP-V2-Client-Verify: SUCCESS\r\n"
            "X-XSP-V2-Client-Cert: forged\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(ack.encode())}\r\n"
            "Connection: close\r\n\r\n"
            f"{ack}"
        )
        forged_direct = command(
            "docker", "run", "--rm", "-i", "--network", "none", "--user", "10005:10003",
            "--mount", f"type=volume,src={origin_socket},dst=/run/xmesh-origin,readonly",
            "--entrypoint", "/usr/local/bin/nc", probe_image,
            "-w", "3", "-U", "/run/xmesh-origin/xsp-v2-origin.sock",
            input_text=forged_request, check=False, timeout=10,
        )
        forged_response = response_text(forged_direct)
        if "403 Forbidden" not in forged_response or "202 Accepted" in forged_response:
            raise RuntimeError(f"direct UDS forgery was not rejected: {forged_response[-1200:]}")
        print("PASS: direct UDS forgery fails SO_PEERCRED even with forged verification headers")

        oversized = "x" * (17 * 1024)
        response = response_text(https_request("POST", ACK_PATH, oversized))
        if "413 Request Entity Too Large" not in response and "413 Content Too Large" not in response:
            raise RuntimeError(f"oversized ACK body was not rejected: {response[-1200:]}")
        print("PASS: ACK body is bounded at the TLS ingress")

        print("PASS: P0-C2-B narrow staging ACK route E2E completed without crypto/DB authorization")
    finally:
        for name in reversed(containers):
            command("docker", "rm", "-f", name, check=False)
        command("docker", "network", "rm", network, check=False)
        command("docker", "volume", "rm", "-f", origin_socket, check=False)
        command("docker", "volume", "rm", "-f", certs, check=False)
        command("docker", "image", "rm", "-f", runtime_image, origin_image, probe_image, check=False)
        client_material.cleanup()


if __name__ == "__main__":
    main()
