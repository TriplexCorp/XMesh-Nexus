"""Exercise instrumented Xray writers using local VLESS traffic in disposable CI."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import threading
import time
import uuid

from test_quota_v2_xray_user_inbound_drain import (
    EchoHandler, EchoServer, connect_socks, echo_bytes, reserve_port,
)

JOURNAL = "/run/xmesh-xray-audit"
TAGS = ("vless-share", "vless-cdn")
STREAM = {"network": "tcp", "security": "none"}
PAYLOAD_BYTES = 8192


def docker(*args):
    return subprocess.check_output(["docker", *args], timeout=30)


class MeteredXray:
    def __init__(self, root, stack, binary, image, digest):
        assert hashlib.sha256(binary.read_bytes()).hexdigest() == digest
        self.xray = root / "wal"
        self.xray.mkdir(mode=0o700)
        self.container = "xmesh-wal-test-" + secrets.token_hex(12)
        self.vless = [reserve_port() for _ in TAGS]
        self.socks = [reserve_port() for _ in TAGS]
        echo = EchoServer(("127.0.0.1", 0), EchoHandler)
        self.echo_port = echo.server_address[1]
        service = threading.Thread(target=echo.serve_forever, daemon=True)
        service.start()
        stack.callback(echo.server_close)
        stack.callback(echo.shutdown)
        identity = str(uuid.uuid4())
        server = {
            "log": {"loglevel": "warning"},
            "stats": {},
            "policy": {"levels": {"0": {"statsUserUplink": True, "statsUserDownlink": True}}},
            "inbounds": [
                {"tag": tag, "listen": "127.0.0.1", "port": port, "protocol": "vless",
                 "settings": {"decryption": "none", "clients": [
                     {"id": identity, "email": f"xmesh-u101--{tag}", "level": 0}
                 ]}, "streamSettings": STREAM}
                for tag, port in zip(TAGS, self.vless, strict=True)
            ],
            "outbounds": [{"protocol": "freedom", "settings": {
                "finalRules": [{"action": "allow", "network": "tcp", "ip": ["127.0.0.1/32"],
                                "port": str(self.echo_port)}],
            }}],
        }
        server_config = root / "server.json"
        server_config.write_text(json.dumps(server))
        docker(
            "create", "--name", self.container, "--restart=no", "--network", "host",
            "--user", f"{os.getuid()}:{os.getgid()}", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "-e", "GITHUB_ACTIONS=true", "-e", "XMESH_EXPERIMENTAL_DRAIN=1",
            "-e", "XMESH_EXPERIMENTAL_SCOPED_INBOUNDS=" + ",".join(TAGS),
            "-e", f"XMESH_EXPERIMENTAL_OBSERVED_DIR={JOURNAL}",
            "-e", f"XMESH_EXPERIMENTAL_DRAIN_SOCKET={JOURNAL}/drain.sock",
            "-v", f"{server_config}:/xray.json:ro", "-v", f"{self.xray}:{JOURNAL}:rw",
            image, "run", "-config", "/xray.json",
        )
        stack.callback(lambda: docker("rm", "-f", self.container))
        copy = root / "running-image-xray"
        docker("cp", f"{self.container}:/xray", str(copy))
        assert hashlib.sha256(copy.read_bytes()).hexdigest() == digest
        docker("start", self.container)
        deadline = time.monotonic() + 10
        while not (self.xray / "drain.sock").exists():
            if time.monotonic() >= deadline:
                raise AssertionError(docker("logs", self.container).decode(errors="replace"))
            time.sleep(0.1)
        self.before = self.inspect()
        assert self.before["State"]["Running"] and self.before["Image"] == image

        client = {
            "log": {"loglevel": "warning"},
            "inbounds": [
                {"tag": tag, "listen": "127.0.0.1", "port": port,
                 "protocol": "socks", "settings": {"auth": "noauth", "udp": False}}
                for tag, port in zip(TAGS, self.socks, strict=True)
            ],
            "outbounds": [
                {"tag": tag, "protocol": "vless", "settings": {"vnext": [
                    {"address": "127.0.0.1", "port": port,
                     "users": [{"id": identity, "encryption": "none"}]}
                ]}, "streamSettings": STREAM}
                for tag, port in zip(TAGS, self.vless, strict=True)
            ],
            "routing": {"rules": [
                {"type": "field", "inboundTag": [tag], "outboundTag": tag} for tag in TAGS
            ]},
        }
        client_config = root / "client.json"
        client_config.write_text(json.dumps(client))
        log = stack.enter_context((root / "client.log").open("wb"))
        process = subprocess.Popen([binary, "run", "-config", client_config], stdout=log, stderr=subprocess.STDOUT)

        def stop_client():
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        stack.callback(stop_client)

    def inspect(self):
        return json.loads(docker("inspect", "--type", "container", "--format", "{{json .}}", self.container))

    def send(self, index):
        with connect_socks(self.socks[index], self.echo_port, "127.0.0.1") as connection:
            echo_bytes(connection, PAYLOAD_BYTES)
        registry = self.xray / "xmesh-meter-inventory-v1.jsonl"
        births = [json.loads(line) for line in registry.read_text().splitlines()]
        active = [b for b in births if b["email"] == f"xmesh-u101--{TAGS[index]}"]
        assert {b["direction"] for b in active} == {"uplink", "downlink"}
        for birth in active:
            wal = self.xray / birth["filename"]
            tail = json.loads(wal.read_text().splitlines()[-1])
            assert tail["nextBytes"] >= PAYLOAD_BYTES, tail
        return len(births)

    def crash(self):
        docker("kill", "--signal", "KILL", self.container)
        info = self.inspect()
        assert not info["State"]["Running"]
        assert info["HostConfig"]["RestartPolicy"]["Name"] == "no"
        for port in self.vless:
            try:
                connection = socket.create_connection(("127.0.0.1", port), timeout=1)
            except ConnectionRefusedError:
                continue
            connection.close()
            raise AssertionError(f"listener {port} still accepts connections after SIGKILL")
