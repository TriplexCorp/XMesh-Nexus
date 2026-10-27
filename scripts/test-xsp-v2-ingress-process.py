#!/usr/bin/env python3
"""Disposable XSP-v2 dedicated ingress process/container E2E.

Builds an isolated Nginx/OpenSSL 3.5+ runtime, creates throwaway TLS material,
proves the exact TLS 1.3 X25519MLKEM768 handshake with both the Node Go probe
and OpenSSL, and verifies the ingress stays HTTP-inert with no backend hop.

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
    probe_image = f"xmesh-xsp-ingress-probe:{token}"
    network = f"{prefix}-net"
    ingress = f"{prefix}-ingress"
    certs = f"{prefix}-certs"
    sessions = f"{prefix}-sessions"
    containers: list[str] = []

    def go_probe(check: bool = True):
        return command(
            "docker", "run", "--rm",
            "--network", network,
            "--mount", f"type=volume,src={certs},dst=/certs,readonly",
            "--mount", f"type=bind,src={probe_binary},dst=/usr/local/bin/xsp-tlsprobe,readonly",
            "--entrypoint", "/usr/local/bin/xsp-tlsprobe",
            probe_image,
            "-address", f"{ALIAS}:8444",
            "-servername", HOSTNAME,
            "-ca-file", "/certs/fullchain.pem",
            check=check,
            timeout=20,
        )

    def assert_single_ingress() -> None:
        data = json.loads(command("docker", "network", "inspect", network).stdout)[0]
        names = sorted(container["Name"] for container in data.get("Containers", {}).values())
        if names != [ingress]:
            raise RuntimeError(f"unexpected persistent containers on isolated ingress network: {names}")

    try:
        command("docker", "network", "create", "--internal", network)
        command("docker", "volume", "create", certs)
        command("docker", "volume", "create", sessions)

        if not args.skip_build:
            dockerfile = ROOT / "deploy/xsp-v2-ingress/Dockerfile"
            for target, tag in [("runtime", runtime_image), ("probe", probe_image)]:
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
chown 0:10003 /certs/privkey.pem /certs/fullchain.pem
chmod 0440 /certs/privkey.pem /certs/fullchain.pem
chmod 0400 /certs/unrelated-key.pem
chmod 0444 /certs/unrelated.pem
"""
        command(
            "docker", "run", "--rm", "--user", "0:0",
            "--mount", f"type=volume,src={certs},dst=/certs",
            "--entrypoint", "/bin/sh", probe_image, "-ceu", cert_setup,
        )

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

        net = json.loads(command("docker", "network", "inspect", network).stdout)[0]
        if not net.get("Internal"):
            raise RuntimeError("E2E network must be internal/no-egress")
        assert_single_ingress()

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
        assert_single_ingress()
        print("PASS: Go strict probe verified TLS1.3 + actual X25519MLKEM768 + certificate/SNI")

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
        print("PASS: independent OpenSSL observation agrees with Go probe")

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
        print("PASS: TLS1.2, X25519-only, wrong hostname and untrusted certificate fail closed")

        for path in ["/", "/api/v2/node/keys/rotation/ack", "/api/v1/node/heartbeat"]:
            request = (
                f"GET {path} HTTP/1.1\r\nHost: {HOSTNAME}\r\nConnection: close\r\n\r\n"
            )
            result = command(
                "docker", "run", "--rm",
                "--network", network,
                "--mount", f"type=volume,src={certs},dst=/certs,readonly",
                "--entrypoint", "openssl", probe_image,
                "s_client",
                "-quiet",
                "-no_ign_eof",
                "-connect", f"{ALIAS}:8444",
                "-servername", HOSTNAME,
                "-verify_hostname", HOSTNAME,
                "-verify_return_error",
                "-CAfile", "/certs/fullchain.pem",
                "-tls1_3",
                "-groups", "X25519MLKEM768",
                input_text=request,
                timeout=20,
            )
            response = result.stdout + result.stderr
            if "404 Not Found" not in response or "\nLocation:" in response or "\r\nLocation:" in response:
                raise RuntimeError(f"inert ingress contract failed for {path}")
        print("PASS: HTTPS is inert 404; ACK and legacy routes are not reachable")

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
            "--entrypoint", "/bin/sh", runtime_image, "-ceu", bad_group,
            timeout=20,
        )
        print("PASS: unavailable/invalid mandatory group cannot become classical fallback")

        assert_single_ingress()
        print("INGRESS PROCESS E2E: PASS (one internal TLS hop, no backend/API hop, no production activation)")
    finally:
        for name in reversed(containers):
            command("docker", "rm", "-f", name, check=False)
        command("docker", "volume", "rm", certs, check=False)
        command("docker", "volume", "rm", sessions, check=False)
        command("docker", "network", "rm", network, check=False)
        if not args.skip_build:
            command("docker", "image", "rm", "-f", runtime_image, probe_image, check=False)


if __name__ == "__main__":
    main()
