#!/usr/bin/env python3
"""Offline XSP-v2 TLS-1.3 hybrid-negotiation tests using OpenSSL 3.5+.
Creates throwaway self-signed ECDSA test certificates. Does not change Nginx.
Optionally validates the independent Go 1.27 TLS probe (XSP_GO_TLS_PROBE).
"""
import os
import pathlib
import re
import socket
import subprocess
import tempfile
import time

GROUP = "X25519MLKEM768"
GO = os.environ.get("XSP_GO_TLS_PROBE")


def call(args, *, timeout=10):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for(address, server):
    for _ in range(60):
        if server.poll() is not None:
            raise AssertionError("test TLS server stopped unexpectedly")
        try:
            with socket.create_connection(address, timeout=0.25):
                return
        except OSError:
            time.sleep(0.05)
    raise AssertionError("test TLS server never started")


def openssl_client(port_number, ca, *, hostname="localhost", group=GROUP, tls13=True):
    return call([
        "openssl", "s_client",
        "-connect", f"127.0.0.1:{port_number}",
        "-servername", "localhost",
        "-verify_hostname", hostname,
        "-CAfile", str(ca),
        "-verify_return_error",
        "-brief",
        "-groups", group,
        "-tls1_3" if tls13 else "-tls1_2",
        "-no_ticket",
    ])


def require(result, successful, detail):
    if (result.returncode == 0) != successful:
        raise AssertionError(
            f"{detail}: expected {'success' if successful else 'failure'}, "
            f"got return code {result.returncode}\n"
            f"{(result.stderr + result.stdout)[-1800:]}"
        )


def probe(port_number, ca, *, hostname="localhost", success=True):
    if not GO:
        return
    result = call([
        GO, "-address", f"127.0.0.1:{port_number}",
        "-servername", hostname, "-ca-file", str(ca), "-timeout", "5s",
    ])
    require(result, success, "Go hybrid TLS probe")
    if success:
        import json
        report = json.loads(result.stdout)
        assert report == {
            "tlsVersion": "TLS1.3",
            "negotiatedGroup": GROUP,
            "certificateVerified": True,
            "fullHandshake": True,
        }, report


def tls_server(test_dir, p, curves, version="1_3"):
    command = [
        "openssl", "s_server", "-accept", f"127.0.0.1:{p}",
        "-cert", str(test_dir / "cert.pem"), "-key", str(test_dir / "key.pem"),
        "-tls1_3" if version == "1_3" else "-tls1_2",
        "-groups", curves, "-no_ticket", "-quiet",
    ]
    server = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    wait_for(("127.0.0.1", p), server)
    return server


def stop(server):
    server.terminate()
    try:
        server.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
        server.communicate(timeout=5)


def main():
    version = call(["openssl", "version"])
    assert version.returncode == 0
    assert re.search(r"OpenSSL 3\.[5-9]\.", version.stdout), version.stdout
    with tempfile.TemporaryDirectory(prefix="xsp-tls-poc-") as folder:
        dest = pathlib.Path(folder)
        cmd = [
            "openssl", "req", "-x509", "-newkey", "ec",
            "-pkeyopt", "ec_paramgen_curve:P-256", "-noenc",
            "-keyout", str(dest / "key.pem"), "-out", str(dest / "cert.pem"),
            "-days", "1", "-subj", "/CN=localhost",
            "-addext", "subjectAltName=DNS:localhost",
        ]
        require(call(cmd), True, "create ephemeral test certificate")
        # Incorrect trust root must never be accepted, regardless of matching name.
        other_cmd = [
            "openssl", "req", "-x509", "-newkey", "ec",
            "-pkeyopt", "ec_paramgen_curve:P-256", "-noenc",
            "-keyout", str(dest / "other.key"), "-out", str(dest / "other.crt"),
            "-days", "1", "-subj", "/CN=localhost",
            "-addext", "subjectAltName=DNS:localhost",
        ]
        require(call(other_cmd), True, "create unrelated test CA")

        p = port()
        server = tls_server(dest, p, GROUP)
        try:
            ok = openssl_client(p, dest / "cert.pem")
            require(ok, True, "OpenSSL TLS 1.3 hybrid handshake")
            assert re.search(r"Protocol version:\s*TLSv1\.3", ok.stderr)
            assert re.search(r"Verification:\s*OK", ok.stderr)
            assert re.search(r"Negotiated TLS1\.3 group:\s*X25519MLKEM768\b", ok.stderr), ok.stderr
            probe(p, dest / "cert.pem")
            require(openssl_client(p, dest / "cert.pem", group="X25519"),
                    False, "classical client to hybrid-only TLS server")
            require(openssl_client(p, dest / "cert.pem", tls13=False),
                    False, "TLS 1.2 to TLS1.3-only server")
            require(openssl_client(p, dest / "cert.pem", hostname="other.example.test"),
                    False, "wrong hostname")
            require(openssl_client(p, dest / "other.crt"),
                    False, "untrusted certificate")
            probe(p, dest / "cert.pem", hostname="other.example.test", success=False)
            probe(p, dest / "other.crt", success=False)
        finally:
            stop(server)

        # Demonstrate an actual TLS1.3 *classical* negotiation, which must be
        # rejected by the Go strict probe even though certificate verification works.
        q = port()
        classical = tls_server(dest, q, "X25519")
        try:
            result = openssl_client(q, dest / "cert.pem", group="X25519")
            require(result, True, "classical TLS1.3 control handshake")
            assert re.search(r"Negotiated TLS1\.3 group:\s*X25519\b", result.stderr), result.stderr
            require(openssl_client(q, dest / "cert.pem"),
                    False, "strict hybrid client against classical-only server")
            probe(q, dest / "cert.pem", success=False)
        finally:
            stop(classical)

    print("XSP-v2 offline TLS probe: authenticated hybrid negotiation confirmed; "
          "TLS1.2, classical-only, wrong hostname and untrusted certificates rejected.")


if __name__ == "__main__":
    main()
