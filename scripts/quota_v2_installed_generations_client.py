"""Keep one peer VLESS connection open while the measured user reconnects."""
from contextlib import ExitStack
import json
from pathlib import Path
import subprocess
import sys
import time

from quota_v2_installed_live_vless import exact, socks_stream


def run(binary, user, peer, state):
    directory = Path(state)
    config = directory / "client.json"
    client_ids = {"a": user, "b": peer}
    config.write_text(json.dumps({
        "inbounds": [
            {"tag": tag, "listen": "127.0.0.1", "port": 28411 + i,
             "protocol": "socks", "settings": {"auth": "noauth"}}
            for i, tag in enumerate(client_ids)
        ],
        "outbounds": [
            {"tag": tag, "protocol": "vless", "settings": {"vnext": [{
                "address": "127.0.0.1", "port": 28401,
                "users": [{"id": user_id, "encryption": "none"}],
            }]}} for tag, user_id in client_ids.items()
        ],
        "routing": {"rules": [{"type": "field", "inboundTag": [tag], "outboundTag": tag}
                              for tag in client_ids]},
    }))

    def exchange(sock, data):
        sock.sendall(data)
        assert exact(sock, len(data)) == data

    with subprocess.Popen([binary, "run", "-config", config]) as process, ExitStack() as streams:
        try:
            deadline = time.monotonic() + 20
            while True:
                try:
                    peer_stream = streams.enter_context(socks_stream(28412))
                    exchange(peer_stream, b"peer")
                    break
                except (OSError, EOFError):
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(.3)
            for generation in (1, 2, 3):
                deadline = time.monotonic() + 380
                while not (directory / f"ready-{generation}").exists():
                    assert time.monotonic() < deadline, f"generation {generation} never opened"
                    exchange(peer_stream, b"peer")
                    time.sleep(2)
                data = bytes([generation]) * 8192
                with socks_stream() as active:
                    exchange(active, data)
                    (directory / f"done-{generation}").touch()
                    while generation < 3 and not (directory / f"ready-{generation + 1}").exists():
                        assert time.monotonic() < deadline, "successor never opened"
                        exchange(peer_stream, b"peer")
                        time.sleep(2)
                    if generation < 3:
                        try:
                            active.sendall(b"stale")
                            assert active.recv(1) == b"", "old generation delivered bytes"
                        except (ConnectionResetError, BrokenPipeError):
                            pass
            deadline = time.monotonic() + 180
            while not (directory / "database-restarted").exists():
                assert time.monotonic() < deadline, "PostgreSQL recovery check did not finish"
                exchange(peer_stream, b"peer")
                time.sleep(2)
            exchange(peer_stream, b"peer")
            (directory / "peer-intact").touch()
        finally:
            process.terminate()


if __name__ == "__main__":
    run(*sys.argv[1:])
