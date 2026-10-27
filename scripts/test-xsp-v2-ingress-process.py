#!/usr/bin/env python3
"""Disposable XSP-v2 ingress + protected origin-boundary process E2E.

P0-C1 properties remain mandatory: TLS 1.3, negotiated X25519MLKEM768,
trusted server certificate/SNI, no resumption substitute, no classical fallback.

P0-C2-A adds one test-only identity endpoint. The endpoint requires a verified
client certificate, strips caller headers/body, proxies only over a Unix socket,
and the disposable origin verifies SO_PEERCRED plus a pinned ML-DSA-65 SPKI.
The ACK and legacy application routes remain unmounted/inert 404.

Never connects to an existing Nexus API, production DB, production key store,
public listener, DNS, or VPS.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
HOSTNAME = "node-ingress.xsp.invalid"
ALIAS = "xsp-ingress"
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
    for line in response.splitlines():
        candidate = line.strip()
        if candidate.startswith("{") and candidate.endswith("}"):
            try:
                value = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                return value
    raise RuntimeError(f"missing JSON response body: {response[-1200:]}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--go-probe", required=True, help="Freshly built XMesh-Node Go 1.27 tlsprobe binary")
    parser.add_argument("--skip-build", action="store_true", help="Reuse existing disposable images")
    args = parser.parse_args()

    probe_binary = Path(args.go_probe).resolve(strict=True)
    if not os.access(probe_binary, os.X_OK):
        raise RuntimeError("Go TLS probe must be executable")

    token = secrets.token_hex(5)
    prefix = f"xsp-ingress-e2e-{token}"
    runtime_image = f"xmesh-xsp-ingress:{token}"
    origin_image = f"xmesh-xsp-origin-probe:{token}"
    probe_image = f"xmesh-xsp-ingress-probe:{token}"
    network = f"{prefix}-net"
    ingress = f"{prefix}-ingress"
    origin = f"{prefix}-origin"
    certs = f"{prefix}-certs"
    sessions = f"{prefix}-sessions"
    origin_socket = f"{prefix}-origin-socket"
    containers: list[str] = []

    def go_probe(check: bool = True, mutual: bool = False):
        probe_args = [
            "-address", f"{ALIAS}:8444",
            "-servername", HOSTNAME,
            "-ca-file", "/certs/fullchain.pem",
        ]
        if mutual:
            probe_args.extend([
                "-client-cert", "/certs/client.pem",
                "-client-key", "/certs/client-key.pem",
            ])
        return command(
            "docker", "run", "--rm",
            "--network", network,
            "--mount", f"type=volume,src={certs},dst=/certs,readonly",
            "--mount", f"type=bind,src={probe_binary},dst=/usr/local/bin/xsp-tlsprobe,readonly",
            "--entrypoint", "/usr/local/bin/xsp-tlsprobe",
            probe_image,
            *probe_args,
            check=check,
            timeout=20,
        )

    def assert_single_ingress_network_member() -> None:
        data = json.loads(command("docker", "network", "inspect", network).stdout)[0]
        names = sorted(container["Name"] for container in data.get("Containers", {}).values())
        if names != [ingress]:
            raise RuntimeError(f"unexpected persistent containers on isolated ingress network: {names}")

    def https_request(
        path: str,
        cert: str | None = None,
        key: str | None = None,
        extra_headers: tuple[str, ...] = (),
        check: bool = True,
    ):
        cert_args = ""
        if cert and key:
            cert_args = f"-cert /certs/{cert} -key /certs/{key}"
        headers = "\n".join(extra_headers)
        if headers:
            headers += "\n"
        script = f"""
set -eu
set +e
timeout 4s openssl s_client -quiet -ign_eof \
  -connect {ALIAS}:8444 \
  -servername {HOSTNAME} \
  -verify_hostname {HOSTNAME} -verify_return_error \
  -CAfile /certs/fullchain.pem -tls1_3 -groups X25519MLKEM768 \
  {cert_args} <<'EOF'
GET {path} HTTP/1.1\r
Host: {HOSTNAME}\r
{headers}Connection: close\r
\r
EOF
rc=$?
set -e
[ "$rc" -eq 0 ] || [ "$rc" -eq 124 ]
"""
        return command(
            "docker", "run", "--rm",
            "--network", network,
            "--mount", f"type=volume,src={certs},dst=/certs,readonly",
            "--entrypoint", "/bin/sh", probe_image, "-ceu", script,
            check=check,
            timeout=12,
        )

    try:
        command("docker", "network", "create", "--internal", network)
        command("docker", "volume", "create", certs)
        command("docker", "volume", "create", sessions)
        command("docker", "volume", "create", origin_socket)

        if not args.skip_build:
            dockerfile = ROOT / "deploy/xsp-v2-ingress/Dockerfile"
            for target, tag in [
                ("runtime", runtime_image),
                ("origin-probe", origin_image),
                ("probe", probe_image),
            ]:
                command(
                    "docker", "build",
                    "-f", str(dockerfile),
                    "--target", target,
                    "-t", tag,
                    str(ROOT),
                    timeout=600,
                )

        version = command(
            "docker", "run", "--rm", "--entrypoint", "openssl", probe_image, "version"
        ).stdout.strip()
        if not version.startswith("OpenSSL 3."):
            raise RuntimeError(f"unexpected OpenSSL runtime: {version}")

        cert_setup = r"""
set -eu
umask 077
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -subj "/CN=node-ingress.xsp.invalid" \
  -addext "subjectAltName=DNS:node-ingress.xsp.invalid" \
  -days 1 -keyout /certs/privkey.pem -out /certs/fullchain.pem >/dev/null 2>&1
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -subj "/CN=unrelated.xsp.invalid" \
  -addext "subjectAltName=DNS:unrelated.xsp.invalid" \
  -days 1 -keyout /certs/unrelated-key.pem -out /certs/unrelated.pem >/dev/null 2>&1

# Throwaway ML-DSA-65 client CA and the one pinned Node identity.
openssl genpkey -algorithm ML-DSA-65 -out /certs/client-ca-key.pem
openssl req -new -x509 -key /certs/client-ca-key.pem \
  -subj "/CN=XSP-v2 disposable ML-DSA client CA" -days 1 \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -out /certs/client-ca.pem
cat >/tmp/client.ext <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=clientAuth
EOF
openssl genpkey -algorithm ML-DSA-65 -out /certs/client-key.pem
openssl req -new -key /certs/client-key.pem -subj "/CN=untrusted-text-node-id" -out /tmp/client.csr
openssl x509 -req -in /tmp/client.csr -CA /certs/client-ca.pem -CAkey /certs/client-ca-key.pem \
  -CAcreateserial -days 1 -extfile /tmp/client.ext -out /certs/client.pem

# A second valid ML-DSA-65 cert under the same CA must NOT map to the pinned Node.
openssl genpkey -algorithm ML-DSA-65 -out /certs/other-client-key.pem
openssl req -new -key /certs/other-client-key.pem -subj "/CN=another-node" -out /tmp/other.csr
openssl x509 -req -in /tmp/other.csr -CA /certs/client-ca.pem -CAkey /certs/client-ca-key.pem \
  -days 1 -extfile /tmp/client.ext -out /certs/other-client.pem

# A classical client cert signed by the same trusted ML-DSA CA must also fail
# the pinned-origin identity mapping even if the TLS library accepts the chain.
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out /certs/classical-client-key.pem
openssl req -new -key /certs/classical-client-key.pem -subj "/CN=classical-client" -out /tmp/classical.csr
openssl x509 -req -in /tmp/classical.csr -CA /certs/client-ca.pem -CAkey /certs/client-ca-key.pem \
  -days 1 -extfile /tmp/client.ext -out /certs/classical-client.pem

openssl x509 -in /certs/client.pem -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 \
  | sed 's/^.*= //' >/certs/client-spki.sha256

test "$(wc -c </certs/client-spki.sha256)" -eq 65
chown 0:10003 /certs/privkey.pem /certs/fullchain.pem /certs/client-ca.pem
chmod 0440 /certs/privkey.pem /certs/fullchain.pem /certs/client-ca.pem
chmod 0400 /certs/unrelated-key.pem /certs/client-ca-key.pem /certs/client-key.pem \
  /certs/other-client-key.pem /certs/classical-client-key.pem
chmod 0444 /certs/unrelated.pem /certs/client.pem /certs/other-client.pem \
  /certs/classical-client.pem /certs/client-spki.sha256
"""
        command(
            "docker", "run", "--rm", "--user", "0:0",
            "--mount", f"type=volume,src={certs},dst=/certs",
            "--entrypoint", "/bin/sh", probe_image, "-ceu", cert_setup,
            timeout=60,
        )
        expected_spki = command(
            "docker", "run", "--rm",
            "--mount", f"type=volume,src={certs},dst=/certs,readonly",
            "--entrypoint", "/bin/sh", probe_image, "-ceu", "cat /certs/client-spki.sha256",
        ).stdout.strip()
        if len(expected_spki) != 64:
            raise RuntimeError("invalid disposable client SPKI fingerprint")

        # Initialize the shared UDS directory. The origin owns the directory;
        # ingress GID can traverse/connect but cannot replace the socket entry.
        command(
            "docker", "run", "--rm", "--user", "0:0", "--network", "none",
            "--mount", f"type=volume,src={origin_socket},dst=/run/xmesh-origin",
            "--entrypoint", "/bin/sh", origin_image, "-ceu",
            "chown 10004:10003 /run/xmesh-origin && chmod 0750 /run/xmesh-origin",
        )

        command(
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
            origin_image,
        )
        containers.append(origin)

        for _ in range(40):
            ready = command(
                "docker", "run", "--rm", "--network", "none",
                "--mount", f"type=volume,src={origin_socket},dst=/run/xmesh-origin,readonly",
                "--entrypoint", "/bin/sh", probe_image, "-ceu",
                "test -S /run/xmesh-origin/xsp-v2-origin.sock",
                check=False,
            )
            if ready.returncode == 0:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("origin Unix socket never became ready")

        command(
            "docker", "run", "-d",
            "--name", ingress,
            "--network", network,
            "--network-alias", ALIAS,
            "--read-only",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m,mode=1777",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--mount", f"type=volume,src={certs},dst=/run/xmesh-ingress-certs,readonly",
            "--mount", f"type=volume,src={origin_socket},dst=/run/xmesh-origin",
            runtime_image,
        )
        containers.append(ingress)

        inspect = json.loads(command("docker", "inspect", ingress).stdout)[0]
        if inspect["Config"].get("User") != "10003:10003":
            raise RuntimeError("ingress must run as dedicated non-root UID/GID")
        host_config = inspect["HostConfig"]
        if not host_config.get("ReadonlyRootfs"):
            raise RuntimeError("ingress root filesystem must be read-only")
        if "ALL" not in (host_config.get("CapDrop") or []):
            raise RuntimeError("ingress must drop all Linux capabilities")
        if not any("no-new-privileges" in item for item in host_config.get("SecurityOpt") or []):
            raise RuntimeError("ingress must enforce no-new-privileges")
        if host_config.get("PortBindings"):
            raise RuntimeError("disposable ingress must not publish any host port")

        origin_inspect = json.loads(command("docker", "inspect", origin).stdout)[0]
        if origin_inspect["Config"].get("User") != "10004:10003":
            raise RuntimeError("origin probe must use separate UID and shared ingress GID")
        origin_host = origin_inspect["HostConfig"]
        if origin_host.get("NetworkMode") != "none" or origin_host.get("PortBindings"):
            raise RuntimeError("origin probe must have no network or published ports")
        if not origin_host.get("ReadonlyRootfs") or "ALL" not in (origin_host.get("CapDrop") or []):
            raise RuntimeError("origin probe must be read-only and capability-free")
        if not any("no-new-privileges" in item for item in origin_host.get("SecurityOpt") or []):
            raise RuntimeError("origin probe must enforce no-new-privileges")

        net = json.loads(command("docker", "network", "inspect", network).stdout)[0]
        if not net.get("Internal"):
            raise RuntimeError("E2E network must be internal/no-egress")
        assert_single_ingress_network_member()

        report = None
        last_error = ""
        for _ in range(60):
            result = go_probe(check=False)
            if result.returncode == 0:
                report = json.loads(result.stdout)
                break
            last_error = result.stderr[-800:]
            time.sleep(0.25)
        if report is None:
            logs = command("docker", "logs", "--tail", "40", ingress, check=False).stderr
            raise RuntimeError(f"strict ingress never became ready: {last_error}\n{logs}")

        expected = {
            "tlsVersion": "TLS1.3",
            "negotiatedGroup": "X25519MLKEM768",
            "certificateVerified": True,
            "fullHandshake": True,
        }
        if report != expected:
            raise RuntimeError(f"unexpected Go strict probe report: {report}")
        print("PASS: C1 strict Go probe still verifies TLS1.3 + X25519MLKEM768 + server identity")

        mutual = go_probe(mutual=True)
        mutual_report = json.loads(mutual.stdout)
        expected_mutual = {
            **expected,
            "clientCertificateAlgorithm": "ML-DSA-65",
            "clientCertificatePresented": True,
        }
        if mutual_report != expected_mutual:
            raise RuntimeError(f"unexpected Go mutual probe report: {mutual_report}")
        print("PASS: Go 1.27 probe presented mandatory ML-DSA-65 client identity on the hybrid TLS hop")

        openssl = command(
            "docker", "run", "--rm",
            "--network", network,
            "--mount", f"type=volume,src={certs},dst=/certs,readonly",
            "--entrypoint", "openssl", probe_image,
            "s_client",
            "-connect", f"{ALIAS}:8444",
            "-servername", HOSTNAME,
            "-verify_hostname", HOSTNAME,
            "-verify_return_error",
            "-CAfile", "/certs/fullchain.pem",
            "-tls1_3",
            "-groups", "X25519MLKEM768",
            "-brief",
            input_text="",
            timeout=20,
        )
        combined = openssl.stdout + openssl.stderr
        if (
            "Protocol version: TLSv1.3" not in combined
            or "X25519MLKEM768" not in combined
            or "Verification: OK" not in combined
        ):
            raise RuntimeError("OpenSSL did not independently observe trusted TLS1.3/X25519MLKEM768")
        print("PASS: independent OpenSSL observation agrees with Go transport probe")

        def expect_tls_failure(label: str, *openssl_args: str) -> None:
            result = command(
                "docker", "run", "--rm",
                "--network", network,
                "--mount", f"type=volume,src={certs},dst=/certs,readonly",
                "--entrypoint", "openssl", probe_image,
                "s_client",
                "-connect", f"{ALIAS}:8444",
                "-servername", HOSTNAME,
                *openssl_args,
                input_text="",
                check=False,
                timeout=20,
            )
            if result.returncode == 0:
                raise RuntimeError(f"{label} unexpectedly succeeded")

        expect_tls_failure(
            "TLS1.2 downgrade",
            "-CAfile", "/certs/fullchain.pem", "-verify_hostname", HOSTNAME,
            "-verify_return_error", "-tls1_2",
        )
        expect_tls_failure(
            "X25519-only TLS1.3 downgrade",
            "-CAfile", "/certs/fullchain.pem", "-verify_hostname", HOSTNAME,
            "-verify_return_error", "-tls1_3", "-groups", "X25519",
        )
        expect_tls_failure(
            "wrong hostname",
            "-CAfile", "/certs/fullchain.pem", "-verify_hostname", "wrong.xsp.invalid",
            "-verify_return_error", "-tls1_3", "-groups", "X25519MLKEM768",
        )
        expect_tls_failure(
            "untrusted certificate",
            "-CAfile", "/certs/unrelated.pem", "-verify_hostname", HOSTNAME,
            "-verify_return_error", "-tls1_3", "-groups", "X25519MLKEM768",
        )
        print("PASS: TLS1.2, X25519-only, wrong hostname and untrusted server certificate fail closed")

        # Existing application paths remain inert even when a valid client cert exists.
        for path in ["/", "/api/v2/node/keys/rotation/ack", "/api/v1/node/heartbeat"]:
            result = https_request(path, "client.pem", "client-key.pem")
            response = result.stdout + result.stderr
            if "404 Not Found" not in response or "\nLocation:" in response or "\r\nLocation:" in response:
                raise RuntimeError(f"inert application-path contract failed for {path}")
        print("PASS: ACK and legacy routes remain inert 404; C2-A mounts no application API")

        # The one test-only identity path must fail without a verified client cert.
        anonymous = https_request(IDENTITY_PATH)
        anonymous_response = anonymous.stdout + anonymous.stderr
        if "403 Forbidden" not in anonymous_response or "200 OK" in anonymous_response:
            raise RuntimeError("identity probe accepted an anonymous TLS client")

        # A caller-provided Node ID/header is stripped. Identity comes only from
        # the verified certificate SPKI and the protected local UDS boundary.
        valid = https_request(
            IDENTITY_PATH,
            "client.pem",
            "client-key.pem",
            (
                "X-XSP-V2-Trusted-Node-ID: 999999",
                "X-XSP-V2-Client-Verify: SUCCESS",
                "X-XSP-V2-Client-Cert: forged",
            ),
        )
        valid_response = valid.stdout + valid.stderr
        if "200 OK" not in valid_response:
            raise RuntimeError(f"valid mTLS identity probe failed: {valid_response[-1200:]}")
        identity = parse_json_body(valid_response)
        expected_identity = {
            "clientSpkiSha256": expected_spki,
            "originTransport": "unix-peercred",
            "trustedNodeId": TRUSTED_NODE_ID,
        }
        if identity != expected_identity or "999999" in valid_response:
            raise RuntimeError(f"origin trusted caller-controlled identity material: {identity}")
        print("PASS: verified ML-DSA-65 SPKI maps to trusted Node ID; spoofed headers are stripped")

        # Other valid certificates under the same CA cannot impersonate the
        # pinned Node identity. Classical certs are included as a fail-closed control.
        for label, cert, key in [
            ("different ML-DSA-65 client", "other-client.pem", "other-client-key.pem"),
            ("classical ECDSA client", "classical-client.pem", "classical-client-key.pem"),
        ]:
            rejected = https_request(IDENTITY_PATH, cert, key, check=False)
            rejected_response = rejected.stdout + rejected.stderr
            if "200 OK" in rejected_response:
                raise RuntimeError(f"{label} impersonated the pinned Node identity")
        print("PASS: same-CA different/PQ and classical client identities cannot impersonate the pinned Node")

        # Even with filesystem access and shared GID, a process under a different
        # UID cannot forge Nginx client-cert evidence directly into the origin UDS.
        forged_direct = r'''
import socket
path = "/run/xmesh-origin/xsp-v2-origin.sock"
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3)
s.connect(path)
s.sendall(b"GET /identity-probe HTTP/1.1\r\nHost: forged\r\nX-XSP-V2-Client-Verify: SUCCESS\r\nX-XSP-V2-Client-Cert: forged\r\nConnection: close\r\n\r\n")
data = b""
while True:
    try:
        part = s.recv(4096)
    except socket.timeout:
        break
    if not part:
        break
    data += part
print(data.decode("utf-8", "replace"))
if b"403" not in data or b"200 OK" in data:
    raise SystemExit(1)
'''
        command(
            "docker", "run", "--rm", "--network", "none", "--user", "10005:10003",
            "--mount", f"type=volume,src={origin_socket},dst=/run/xmesh-origin,readonly",
            "--entrypoint", "python3", origin_image, "-c", forged_direct,
            timeout=10,
        )
        print("PASS: Unix SO_PEERCRED rejects forged origin calls from a different UID")

        session_script = f"""
set -eu
rm -f /sessions/session.pem /sessions/first.txt /sessions/second.txt
openssl s_client -connect {ALIAS}:8444 -servername {HOSTNAME} \
  -verify_hostname {HOSTNAME} -verify_return_error -CAfile /certs/fullchain.pem \
  -tls1_3 -groups X25519MLKEM768 -sess_out /sessions/session.pem \
  </dev/null >/sessions/first.txt 2>&1
if [ -s /sessions/session.pem ]; then
  openssl s_client -connect {ALIAS}:8444 -servername {HOSTNAME} \
    -verify_hostname {HOSTNAME} -verify_return_error -CAfile /certs/fullchain.pem \
    -tls1_3 -groups X25519MLKEM768 -sess_in /sessions/session.pem \
    </dev/null >/sessions/second.txt 2>&1
  ! grep -q '^Reused,' /sessions/second.txt
  grep -q 'X25519MLKEM768' /sessions/second.txt
fi
"""
        command(
            "docker", "run", "--rm",
            "--network", network,
            "--mount", f"type=volume,src={certs},dst=/certs,readonly",
            "--mount", f"type=volume,src={sessions},dst=/sessions",
            "--entrypoint", "/bin/sh", probe_image, "-ceu", session_script,
            timeout=30,
        )
        print("PASS: session resumption cannot substitute for a fresh hybrid proof")

        bad_group = r"""
set -eu
sed 's/X25519MLKEM768/NO_SUCH_REQUIRED_GROUP/g' /etc/nginx/nginx.conf >/tmp/bad.conf
if nginx -t -c /tmp/bad.conf >/tmp/out 2>&1; then
  cat /tmp/out >&2
  exit 1
fi
grep -Eiq 'curve|group|SSL|unknown|invalid' /tmp/out
"""
        command(
            "docker", "run", "--rm",
            "--user", "10003:10003",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=8m,mode=1777",
            "--mount", f"type=volume,src={certs},dst=/run/xmesh-ingress-certs,readonly",
            "--mount", f"type=volume,src={origin_socket},dst=/run/xmesh-origin",
            "--entrypoint", "/bin/sh", runtime_image, "-ceu", bad_group,
            timeout=20,
        )
        print("PASS: unavailable/invalid mandatory group cannot become classical fallback")

        assert_single_ingress_network_member()
        print("INGRESS/ORIGIN C2-A PROCESS E2E: PASS (mTLS identity + Unix peercred/SPKI pin, ACK still unmounted)")
    finally:
        for name in reversed(containers):
            command("docker", "rm", "-f", name, check=False)
        command("docker", "volume", "rm", certs, check=False)
        command("docker", "volume", "rm", sessions, check=False)
        command("docker", "volume", "rm", origin_socket, check=False)
        command("docker", "network", "rm", network, check=False)
        if not args.skip_build:
            command("docker", "image", "rm", "-f", runtime_image, origin_image, probe_image, check=False)


if __name__ == "__main__":
    main()
