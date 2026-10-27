#!/usr/bin/env python3
"""Disposable C2-A origin identity verifier.

Listens only on a Unix-domain socket. A request is trusted only when:
1. SO_PEERCRED identifies the dedicated ingress UID/GID;
2. Nginx reports successful client-certificate verification; and
3. the forwarded client certificate's SPKI SHA-256 matches the pinned fixture.

This process never accepts a caller-supplied Node ID and is not an ACK handler.
"""
from __future__ import annotations

import hashlib
import http.server
import json
import os
from pathlib import Path
import socket
import socketserver
import struct
import subprocess
import urllib.parse

SOCKET_PATH = Path(os.environ.get("XSP_ORIGIN_SOCKET", "/run/xmesh-origin/xsp-v2-origin.sock"))
EXPECTED_UID = int(os.environ.get("XSP_EXPECTED_INGRESS_UID", "10003"))
EXPECTED_GID = int(os.environ.get("XSP_EXPECTED_INGRESS_GID", "10003"))
EXPECTED_SPKI = os.environ.get("XSP_EXPECTED_CLIENT_SPKI_SHA256", "").strip().lower()
EXPECTED_NODE_ID = os.environ.get("XSP_EXPECTED_NODE_ID", "").strip()
MAX_CERT_HEADER = 24 * 1024


def spki_sha256(cert_pem: bytes) -> str:
    pub = subprocess.run(
        ["openssl", "x509", "-pubkey", "-noout"],
        input=cert_pem,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=5,
    )
    if pub.returncode != 0 or not pub.stdout:
        raise ValueError("invalid client certificate")
    der = subprocess.run(
        ["openssl", "pkey", "-pubin", "-outform", "DER"],
        input=pub.stdout,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=5,
    )
    if der.returncode != 0 or not der.stdout:
        raise ValueError("invalid client public key")
    return hashlib.sha256(der.stdout).hexdigest()


class UnixHTTPServer(socketserver.UnixStreamServer):
    allow_reuse_address = False


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "xsp-origin-probe"
    sys_version = ""

    def log_message(self, _format: str, *args: object) -> None:
        # Never log client certificates or forwarded identity material.
        return

    def send_json(self, status: int, value: dict[str, object]) -> None:
        raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def reject(self) -> None:
        self.send_json(403, {"error": "untrusted origin identity"})

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path != "/identity-probe":
            self.send_json(404, {"error": "not found"})
            return
        try:
            peer = self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
            _pid, uid, gid = struct.unpack("3i", peer)
        except (AttributeError, OSError, struct.error):
            self.reject()
            return
        if uid != EXPECTED_UID or gid != EXPECTED_GID:
            self.reject()
            return
        if self.headers.get("X-XSP-V2-Client-Verify") != "SUCCESS":
            self.reject()
            return
        escaped = self.headers.get("X-XSP-V2-Client-Cert", "")
        if not escaped or len(escaped) > MAX_CERT_HEADER:
            self.reject()
            return
        try:
            cert_pem = urllib.parse.unquote_to_bytes(escaped)
            fingerprint = spki_sha256(cert_pem)
        except (ValueError, subprocess.SubprocessError):
            self.reject()
            return
        if not EXPECTED_SPKI or fingerprint != EXPECTED_SPKI or not EXPECTED_NODE_ID.isdigit():
            self.reject()
            return
        self.send_json(
            200,
            {
                "clientSpkiSha256": fingerprint,
                "originTransport": "unix-peercred",
                "trustedNodeId": int(EXPECTED_NODE_ID),
            },
        )


def main() -> None:
    if len(EXPECTED_SPKI) != 64 or any(ch not in "0123456789abcdef" for ch in EXPECTED_SPKI):
        raise SystemExit("XSP_EXPECTED_CLIENT_SPKI_SHA256 must be lowercase SHA-256 hex")
    if not EXPECTED_NODE_ID.isdigit() or int(EXPECTED_NODE_ID) <= 0:
        raise SystemExit("XSP_EXPECTED_NODE_ID must be a positive integer")
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        SOCKET_PATH.unlink()
    except FileNotFoundError:
        pass
    old_umask = os.umask(0o117)
    try:
        with UnixHTTPServer(str(SOCKET_PATH), Handler) as server:
            os.chmod(SOCKET_PATH, 0o660)
            server.serve_forever(poll_interval=0.1)
    finally:
        os.umask(old_umask)
        try:
            SOCKET_PATH.unlink()
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    main()
