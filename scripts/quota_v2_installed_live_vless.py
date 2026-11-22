#!/usr/bin/env python3
"""Run a real SOCKS->VLESS->loopback echo path inside isolated Xray's netns.

Only the disposable runner invokes this probe; no public ingress, no external
target, no fixture-generated traffic counters.
"""
import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time

ECHO = 28421
SOCKS = 28411


class EchoHandler(socketserver.BaseRequestHandler):
    def handle(self):
        while True:
            data = self.request.recv(65536)
            if not data:
                return
            self.request.sendall(data)


class EchoServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def exact(sock, length):
    data = bytearray()
    while len(data) < length:
        part = sock.recv(length-len(data))
        if not part:
            raise EOFError("stream stopped")
        data += part
    return bytes(data)


def socks_stream(socks_port=SOCKS):
    s = socket.create_connection(("127.0.0.1",socks_port),timeout=4)
    try:
        s.sendall(b"\x05\x01\x00")
        assert exact(s,2)==b"\x05\x00"
        s.sendall(b"\x05\x01\x00\x01"+socket.inet_aton("127.0.0.1")+struct.pack("!H",ECHO))
        header=exact(s,4)
        if header[:2]!=b"\x05\x00":
            raise ConnectionError("SOCKS proxy refused VLESS stream")
        lengths={1:4,4:16}
        size=exact(s,1)[0] if header[3]==3 else lengths[header[3]]
        exact(s,size+2)
        return s
    except BaseException:
        s.close()
        raise


def denied(socks_port=SOCKS):
    try:
        with socks_stream(socks_port) as s:
            s.sendall(b"x")
            assert not s.recv(1), "unexpected VLESS byte outside authority"
    except (OSError,EOFError):
        pass


def stats(xray,email):
    raw=subprocess.check_output(
        [xray,"api","statsquery","--server=127.0.0.1:10085","-pattern",f"user>>>{email}"],
        timeout=8)
    return parse_stats(raw, email)


def parse_stats(raw, email):
    document = json.loads(raw)
    if not isinstance(document, dict) or not isinstance(document.get("stat"), list):
        raise ValueError("missing StatsService counter list")
    names = {f"user>>>{email}>>>traffic>>>{direction}": direction
             for direction in ("uplink", "downlink")}
    result = {}
    for item in document["stat"]:
        direction = names.get(item["name"])
        if direction is None:
            continue
        if direction in result:
            raise ValueError(f"duplicate StatsService counter: {direction}")
        # The pinned Xray CLI reflects protobuf's omitempty fields and
        # encodes an int64 as a JSON number when it is nonzero.
        value = item.get("value", 0)
        if type(value) is not int or not 0 <= value <= 2**63 - 1:
            raise ValueError(f"invalid StatsService counter: {direction}")
        result[direction] = value
    if len(result) != len(names):
        raise ValueError(f"missing StatsService counters: {sorted(set(names.values()) - result.keys())}")
    return result


def run(xray, uuid, email, ceiling, previous=0, barrier=None, pause_after=0,
        *, socks_port=SOCKS, reuse_echo=False):
    with tempfile.TemporaryDirectory(prefix="xmesh-vless-ns-") as work, ExitStack() as services:
        if not reuse_echo:
            echo = services.enter_context(EchoServer(("127.0.0.1", ECHO), EchoHandler))
            thread = threading.Thread(target=echo.serve_forever, daemon=True)
            thread.start()
            services.callback(echo.shutdown)
        config={
            "log":{"loglevel":"warning"},
            "inbounds":[{"tag":"local-socks","listen":"127.0.0.1","port":socks_port,
                         "protocol":"socks","settings":{"auth":"noauth"}}],
            "outbounds":[{"tag":"server","protocol":"vless","settings":{"vnext":[
                {"address":"127.0.0.1","port":28401,
                 "users":[{"id":uuid,"encryption":"none"}]}]}}],
        }
        root=Path(work)
        path=root/"client.json"
        path.write_text(json.dumps(config),encoding="utf-8")
        with (root/"xray.log").open("w+") as log:
            process=subprocess.Popen([xray,"run","-config",str(path)],
                                     stdout=log,stderr=subprocess.STDOUT)
            try:
                until=time.monotonic()+12
                while time.monotonic()<until:
                    assert process.poll() is None
                    try:
                        with socket.create_connection(("127.0.0.1",socks_port),timeout=1):
                            break
                    except OSError:
                        time.sleep(.1)
                else:
                    raise AssertionError("VLESS client did not start")
                if ceiling==0:
                    # A refusal is meaningful only when the measured server
                    # has started its actual VLESS and private StatsService.
                    with socket.create_connection(("127.0.0.1",28401),timeout=4):
                        pass
                    # Xray creates user counters on authenticated dispatch.
                    # The denied VLESS attempt must register both directions
                    # before the cap gate rejects it.
                    denied(socks_port)
                    assert process.poll() is None, "client exited during the admission probe"
                    actual = stats(xray, email)
                    assert actual == {"uplink":0,"downlink":0}, actual
                    return actual
                assert ceiling>0 and ceiling%(2*16384)==0
                if previous:
                    assert stats(xray,email)=={"uplink":previous//2,"downlink":previous//2}
                data=b"x"*16384
                with socks_stream(socks_port) as stream:
                    for sent in range(0, ceiling, 2*len(data)):
                        if barrier and sent == pause_after:
                            assert stats(xray,email)=={
                                "uplink":(previous+sent)//2,"downlink":(previous+sent)//2,
                            }
                            Path(barrier+".ready").touch(exist_ok=False)
                            deadline=time.monotonic()+90
                            while not Path(barrier+".continue").exists():
                                if time.monotonic() >= deadline:
                                    raise TimeoutError("quota renewal barrier expired")
                                time.sleep(.05)
                        stream.sendall(data)
                        assert exact(stream,len(data))==data
                    try:
                        stream.sendall(b"x")
                        assert not stream.recv(1),"existing stream exceeded signed cap"
                    except (OSError,EOFError):
                        pass
                denied(socks_port)
                assert process.poll() is None, "client exited during the exhaustion probe"
                actual=stats(xray,email)
                assert actual=={"uplink":(ceiling+previous)//2,"downlink":(ceiling+previous)//2},actual
                return actual
            except BaseException:
                log.flush()
                log.seek(0)
                print(log.read()[-2500:],file=sys.stderr)
                raise
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xray")
    parser.add_argument("uuid")
    parser.add_argument("email")
    parser.add_argument("ceiling", type=int)
    parser.add_argument("previous", type=int)
    parser.add_argument("barrier", nargs="?")
    parser.add_argument("pause_after", type=int, nargs="?", default=0)
    parser.add_argument("--socks-port", type=int, default=SOCKS)
    parser.add_argument("--reuse-echo", action="store_true")
    print(json.dumps(run(**vars(parser.parse_args())), sort_keys=True, separators=(",", ":")))
