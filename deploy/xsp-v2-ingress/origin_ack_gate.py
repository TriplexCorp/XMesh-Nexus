#!/usr/bin/env python3
"""Disposable P0-C2-B/C/D staging ACK origin gate.

The normal ACK operation retains the strict C2-B freshness checks. C2-D2 adds a
distinct historical recovery operation that is reachable only through the same
verified PQ mTLS -> protected UDS identity boundary and may request only exact
immutable receipt readback for an already-expired, already-committed ACK.
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
import time
import urllib.parse

SOCKET_PATH = Path(os.environ.get("XSP_ORIGIN_SOCKET", "/run/xmesh-origin/xsp-v2-origin.sock"))
EXPECTED_UID = int(os.environ.get("XSP_EXPECTED_INGRESS_UID", "10003"))
EXPECTED_GID = int(os.environ.get("XSP_EXPECTED_INGRESS_GID", "10003"))
EXPECTED_SPKI = os.environ.get("XSP_EXPECTED_CLIENT_SPKI_SHA256", "").strip().lower()
EXPECTED_NODE_ID = os.environ.get("XSP_EXPECTED_NODE_ID", "").strip()
ACK_GATE = os.environ.get("XSP_V2_C2B_ACK_ROUTE", "")
C2C_GATE = os.environ.get("XSP_V2_C2C_ACK_AUTH", "")
C2C_SOCKET_PATH = Path(os.environ.get("XSP_V2_C2C_SOCKET_PATH", "/run/xmesh-c2c/c2c.sock"))
ACK_PATH = "/api/v2/node/keys/rotation/ack"
RECOVERY_PATH = ACK_PATH + "/recovery"
MAX_CERT_HEADER = 24 * 1024
MAX_ACK_BODY = 16 * 1024
MAX_SIGNATURE_TEXT = 8 * 1024
MAX_U64 = (1 << 64) - 1
MAX_I64 = (1 << 63) - 1
C2C_REQUEST_MAGIC = b"XSP2C2C1"
C2C_RECOVERY_REQUEST_MAGIC = b"XSP2C2H1"
C2C_RESPONSE_MAGIC = b"XSP2C2R1"
C2C_UID = 10001
C2C_GID = 10001
MESSAGE_KEYS = {
    "kind", "issuerId", "signerEdKeyId", "signerPQKeyId", "nodeId",
    "fromEpoch", "toEpoch", "requestId", "fromEdKeyId", "fromPQKeyId",
    "toEdKeyId", "toPQKeyId", "method", "path", "issuedAtMs",
    "expiresAtMs", "permitNonceHex", "nonceHex", "candidateSha256Hex",
    "permitSha256Hex", "appliedStateSha256Hex",
}


class DuplicateKeyError(ValueError):
    pass


def strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise DuplicateKeyError("duplicate JSON key")
        value[key] = item
    return value


def spki_sha256(cert_pem: bytes) -> str:
    pub = subprocess.run(
        ["openssl", "x509", "-pubkey", "-noout"], input=cert_pem,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=5,
    )
    if pub.returncode != 0 or not pub.stdout:
        raise ValueError("invalid client certificate")
    der = subprocess.run(
        ["openssl", "pkey", "-pubin", "-outform", "DER"], input=pub.stdout,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=5,
    )
    if der.returncode != 0 or not der.stdout:
        raise ValueError("invalid client public key")
    return hashlib.sha256(der.stdout).hexdigest()


def canonical_hex(value: object, size: int, *, nonzero: bool = True) -> bool:
    if type(value) is not str or len(value) != size * 2:
        return False
    if any(ch not in "0123456789abcdef" for ch in value):
        return False
    return (not nonzero) or any(ch != "0" for ch in value)


def bounded_ascii(value: object, maximum: int) -> bool:
    return (
        type(value) is str
        and 0 < len(value) <= maximum
        and all(0x21 <= ord(ch) <= 0x7E for ch in value)
    )


def read_exact(stream: socket.socket, size: int) -> bytes:
    out = bytearray()
    while len(out) < size:
        chunk = stream.recv(size - len(out))
        if not chunk:
            raise ValueError("truncated C2-C response")
        out.extend(chunk)
    return bytes(out)


def authorize_c2c(node_id: int, raw_ack: bytes, *, recovery: bool = False) -> bytes:
    if node_id <= 0 or len(raw_ack) <= 0 or len(raw_ack) > MAX_ACK_BODY:
        raise ValueError("invalid C2-C local request")
    magic = C2C_RECOVERY_REQUEST_MAGIC if recovery else C2C_REQUEST_MAGIC
    frame = magic + struct.pack(">Q", node_id) + struct.pack(">I", len(raw_ack)) + raw_ack
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(12)
    try:
        client.connect(str(C2C_SOCKET_PATH))
        peer = client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        _pid, uid, gid = struct.unpack("3i", peer)
        if uid != C2C_UID or gid != C2C_GID:
            raise ValueError("unexpected C2-C service peer")
        client.sendall(frame)
        client.shutdown(socket.SHUT_WR)
        header = read_exact(client, 13)
        if header[:8] != C2C_RESPONSE_MAGIC or header[8] not in (0, 1):
            raise ValueError("invalid C2-C response domain")
        length = struct.unpack(">I", header[9:13])[0]
        if length > MAX_ACK_BODY:
            raise ValueError("C2-C response too large")
        payload = read_exact(client, length)
        if client.recv(1) != b"":
            raise ValueError("trailing C2-C response bytes")
        if header[8] != 1 or not payload:
            raise ValueError("C2-C authorization rejected")
        return payload
    finally:
        client.close()


class UnixHTTPServer(socketserver.UnixStreamServer):
    allow_reuse_address = False


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "xsp-c2b-ack-gate"
    sys_version = ""

    def log_message(self, _format: str, *args: object) -> None:
        return

    def send_json(self, status: int, value: dict[str, object]) -> None:
        raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def trusted_node_id(self) -> int | None:
        try:
            peer = self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
            _pid, uid, gid = struct.unpack("3i", peer)
        except (AttributeError, OSError, struct.error):
            return None
        if uid != EXPECTED_UID or gid != EXPECTED_GID:
            return None
        if self.headers.get("X-XSP-V2-Client-Verify") != "SUCCESS":
            return None
        escaped = self.headers.get("X-XSP-V2-Client-Cert", "")
        if not escaped or len(escaped) > MAX_CERT_HEADER:
            return None
        try:
            cert_pem = urllib.parse.unquote_to_bytes(escaped)
            fingerprint = spki_sha256(cert_pem)
        except (ValueError, subprocess.SubprocessError):
            return None
        if not EXPECTED_SPKI or fingerprint != EXPECTED_SPKI or not EXPECTED_NODE_ID.isdigit():
            return None
        node_id = int(EXPECTED_NODE_ID)
        return node_id if node_id > 0 else None

    def do_GET(self) -> None:
        if self.path != "/identity-probe":
            self.send_json(404, {"error": "not found"})
            return
        node_id = self.trusted_node_id()
        if node_id is None:
            self.send_json(403, {"error": "untrusted origin identity"})
            return
        self.send_json(200, {"originTransport": "unix-peercred", "trustedNodeId": node_id})

    def do_POST(self) -> None:
        recovery = self.path == RECOVERY_PATH
        if self.path not in (ACK_PATH, RECOVERY_PATH) or ACK_GATE != "staging-only":
            self.send_json(404, {"error": "not found"})
            return
        node_id = self.trusted_node_id()
        if node_id is None:
            self.send_json(403, {"error": "untrusted origin identity"})
            return
        if self.headers.get("Content-Type") != "application/json":
            self.send_json(415, {"error": "unsupported media type"})
            return
        raw_length = self.headers.get("Content-Length", "")
        if not raw_length.isdigit():
            self.send_json(411, {"error": "content length required"})
            return
        length = int(raw_length)
        if length <= 0 or length > MAX_ACK_BODY:
            self.send_json(413, {"error": "invalid body size"})
            return
        try:
            self.connection.settimeout(3)
            raw = self.rfile.read(length)
        except (OSError, TimeoutError):
            self.send_json(408, {"error": "request timeout"})
            return
        if len(raw) != length:
            self.send_json(400, {"error": "invalid staging ACK"})
            return
        try:
            envelope = json.loads(raw, object_pairs_hook=strict_object)
        except (UnicodeDecodeError, json.JSONDecodeError, DuplicateKeyError):
            self.send_json(400, {"error": "invalid staging ACK"})
            return
        if type(envelope) is not dict or set(envelope) != {"message", "signatures"}:
            self.send_json(400, {"error": "invalid staging ACK"})
            return
        message = envelope.get("message")
        signatures = envelope.get("signatures")
        if type(message) is not dict or set(message) != MESSAGE_KEYS:
            self.send_json(400, {"error": "invalid staging ACK"})
            return
        if type(signatures) is not dict or set(signatures) != {"ed25519", "mldsa65"}:
            self.send_json(400, {"error": "invalid staging ACK"})
            return
        if not all(
            type(signatures[name]) is str and 0 < len(signatures[name]) <= MAX_SIGNATURE_TEXT
            for name in ("ed25519", "mldsa65")
        ):
            self.send_json(400, {"error": "invalid staging ACK"})
            return
        integer_fields = ("nodeId", "fromEpoch", "toEpoch", "issuedAtMs", "expiresAtMs")
        if any(type(message[name]) is not int for name in integer_fields):
            self.send_json(400, {"error": "invalid staging ACK"})
            return
        now_ms = int(time.time() * 1000)
        invalid_common = (
            message["kind"] != "ack"
            or message["nodeId"] != node_id
            or message["issuerId"] != f"node-{node_id}"
            or message["method"] != "POST"
            or message["path"] != ACK_PATH
            or message["fromEpoch"] <= 0
            or message["fromEpoch"] > MAX_U64
            or message["toEpoch"] > MAX_U64
            or message["toEpoch"] != message["fromEpoch"] + 1
            or message["issuedAtMs"] <= 0
            or message["issuedAtMs"] > MAX_I64
            or message["expiresAtMs"] > MAX_I64
            or message["expiresAtMs"] <= message["issuedAtMs"]
            or message["expiresAtMs"] - message["issuedAtMs"] > 60_000
        )
        if invalid_common:
            self.send_json(400, {"error": "invalid staging ACK"})
            return
        if recovery:
            # Historical recovery is deliberately a different operation. It is
            # valid only after the signed ACK's original freshness window has
            # closed. Exact committed DB evidence is checked inside C2-C.
            if now_ms <= message["expiresAtMs"]:
                self.send_json(409, {"error": "historical recovery requires expired ACK"})
                return
        elif abs(now_ms - message["issuedAtMs"]) > 120_000 or now_ms > message["expiresAtMs"]:
            self.send_json(400, {"error": "invalid staging ACK"})
            return
        for name in (
            "requestId", "issuerId", "signerEdKeyId", "signerPQKeyId",
            "fromEdKeyId", "fromPQKeyId", "toEdKeyId", "toPQKeyId",
        ):
            if not bounded_ascii(message[name], 64):
                self.send_json(400, {"error": "invalid staging ACK"})
                return
        if message["signerEdKeyId"] != message["toEdKeyId"] or message["signerPQKeyId"] != message["toPQKeyId"]:
            self.send_json(400, {"error": "invalid staging ACK"})
            return
        if not (
            canonical_hex(message["permitNonceHex"], 16)
            and canonical_hex(message["nonceHex"], 16)
            and message["nonceHex"] != message["permitNonceHex"]
            and canonical_hex(message["candidateSha256Hex"], 32)
            and canonical_hex(message["permitSha256Hex"], 32)
            and canonical_hex(message["appliedStateSha256Hex"], 32)
        ):
            self.send_json(400, {"error": "invalid staging ACK"})
            return
        if C2C_GATE == "staging-only":
            try:
                receipt = authorize_c2c(node_id, raw, recovery=recovery)
            except (OSError, ValueError, struct.error):
                self.send_json(503, {"error": "C2-C authorization unavailable or rejected"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(receipt)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(receipt)
            return
        if recovery:
            self.send_json(404, {"error": "historical recovery unavailable"})
            return
        self.send_json(
            202,
            {
                "acceptedStage": "c2b-structural-gate",
                "authorizationStatus": "not-verified",
                "trustedNodeId": node_id,
            },
        )


def main() -> None:
    if len(EXPECTED_SPKI) != 64 or any(ch not in "0123456789abcdef" for ch in EXPECTED_SPKI):
        raise SystemExit("XSP_EXPECTED_CLIENT_SPKI_SHA256 must be lowercase SHA-256 hex")
    if not EXPECTED_NODE_ID.isdigit() or int(EXPECTED_NODE_ID) <= 0:
        raise SystemExit("XSP_EXPECTED_NODE_ID must be a positive integer")
    if C2C_GATE not in ("", "staging-only"):
        raise SystemExit("XSP_V2_C2C_ACK_AUTH must be unset or staging-only")
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
