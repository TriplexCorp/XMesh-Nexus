#!/usr/bin/env python3
"""Run a real SOCKS->VLESS->loopback echo path inside isolated Xray's netns.

Only the disposable runner invokes this probe; no public ingress, no external
target, no fixture-generated traffic counters.
"""
import json
from pathlib import Path
import re
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


def socks_stream():
    s = socket.create_connection(("127.0.0.1",SOCKS),timeout=4)
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


def denied():
    try:
        with socks_stream() as s:
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
        # ProtoJSON omits a default scalar and encodes an int64 as a string.
        value = item.get("value", "0")
        if not isinstance(value, str) or not re.fullmatch(r"0|[1-9][0-9]{0,18}", value):
            raise ValueError(f"invalid StatsService counter: {direction}")
        count = int(value)
        if count > 2**63 - 1:
            raise ValueError(f"StatsService counter overflow: {direction}")
        result[direction] = count
    if len(result) != len(names):
        raise ValueError(f"missing StatsService counters: {sorted(set(names.values()) - result.keys())}")
    return result


def run(xray,uuid,email,ceiling):
    with tempfile.TemporaryDirectory(prefix="xmesh-vless-ns-") as work, \
         EchoServer(("127.0.0.1",ECHO),EchoHandler) as echo:
        thread=threading.Thread(target=echo.serve_forever,daemon=True)
        thread.start()
        config={
            "log":{"loglevel":"warning"},
            "inbounds":[{"tag":"local-socks","listen":"127.0.0.1","port":SOCKS,
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
                        with socket.create_connection(("127.0.0.1",SOCKS),timeout=1):
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
                    assert sum(stats(xray,email).values())==0
                    denied()
                    assert sum(stats(xray,email).values())==0
                    return {"uplink":0,"downlink":0}
                assert ceiling>0 and ceiling%(2*16384)==0
                data=b"x"*16384
                with socks_stream() as stream:
                    for _ in range(ceiling//(2*len(data))):
                        stream.sendall(data)
                        assert exact(stream,len(data))==data
                    try:
                        stream.sendall(b"x")
                        assert not stream.recv(1),"existing stream exceeded signed cap"
                    except (OSError,EOFError):
                        pass
                denied()
                actual=stats(xray,email)
                assert actual=={"uplink":ceiling//2,"downlink":ceiling//2},actual
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
                echo.shutdown()


if __name__=="__main__":
    assert len(sys.argv)==5
    print(json.dumps(run(sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4])),
                     sort_keys=True,separators=(",",":")))
