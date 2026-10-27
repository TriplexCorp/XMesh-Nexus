#!/usr/bin/env python3
"""CI-only nginx hybrid TLS probe. Uses ephemeral certs; NO production vhost."""
import pathlib
import re
import socket
import subprocess
import tempfile
import time

ROOT=pathlib.Path(__file__).resolve().parents[1]
template=(ROOT/"deploy/xsp-v2-node-ingress.nginx.conf.example").read_text()
assert "listen 127.0.0.1:8444 ssl;" in template
assert "ssl_ecdh_curve X25519MLKEM768;" in template
assert "location / { return 404; }" in template
assert "proxy_pass" not in "\n".join(x for x in template.splitlines() if not x.lstrip().startswith("#"))

def run(command,*,input=None):
    return subprocess.run(command,input=input,capture_output=True,text=True,timeout=10)

def ready(process):
    for _ in range(70):
        if process.poll() is not None:
            raise AssertionError("Nginx exited; check test-only config and logs")
        try:
            with socket.create_connection(("127.0.0.1",8444),timeout=0.2):
                return
        except OSError:
            time.sleep(0.08)
    raise AssertionError("Nginx did not listen on test-only loopback")

with tempfile.TemporaryDirectory(prefix="xsp-nginx-") as work:
    path=pathlib.Path(work)
    cert=path/"fullchain.pem"
    key=path/"privkey.pem"
    proc=run(["openssl","req","-x509","-newkey","ec",
      "-pkeyopt","ec_paramgen_curve:P-256","-noenc","-days","1",
      "-subj","/CN=node-only.example.invalid",
      "-addext","subjectAltName=DNS:node-only.example.invalid",
      "-keyout",str(key),"-out",str(cert)])
    assert proc.returncode==0,proc.stderr
    stage=template.replace("/path/to/staging/fullchain.pem",str(cert)).replace(
      "/path/to/staging/privkey.pem",str(key)).replace(
      "/var/log/nginx/xmesh-xsp2-lab-error.log",str(path/"error.log"))
    assert "/path/to/staging/" not in stage
    snippet=path/"staging-site.conf"
    snippet.write_text(stage)
    config=path/"nginx.conf"
    config.write_text("pid "+str(path/"nginx.pid")+";\n"
      "error_log "+str(path/"top-error.log")+" warn;\n"
      "events { worker_connections 64; }\n"
      "http { include "+str(snippet)+"; }\n")
    args=["nginx","-p",str(path)+"/","-c",str(config)]
    check=run(args+["-t"])
    assert check.returncode==0,check.stderr
    process=subprocess.Popen(args+["-g","daemon off;"],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        ready(process)
        def sclient(group,hostname="node-only.example.invalid",tls13=True):
            cmd=["openssl","s_client","-connect","127.0.0.1:8444",
                "-servername","node-only.example.invalid",
                "-verify_hostname",hostname,"-verify_return_error",
                "-CAfile",str(cert),"-groups",group,"-brief",
                "-tls1_3" if tls13 else "-tls1_2"]
            return run(cmd,input="GET / HTTP/1.1\r\nHost: node-only.example.invalid\r\nConnection: close\r\n\r\n")
        valid=sclient("X25519MLKEM768")
        assert valid.returncode==0,valid.stderr[-1300:]
        assert re.search(r"Protocol version:\s*TLSv1\.3",valid.stderr),valid.stderr
        assert re.search(r"Negotiated TLS1\.3 group:\s*X25519MLKEM768\b",valid.stderr),valid.stderr
        assert "Verification: OK" in valid.stderr,valid.stderr
        # -brief is a handshake diagnostic and can exit at stdin EOF before
        # receiving HTTP output; read the 404 response in a separate TLS call.
        http=run(["openssl","s_client","-connect","127.0.0.1:8444",
          "-servername","node-only.example.invalid",
          "-verify_hostname","node-only.example.invalid",
          "-verify_return_error","-CAfile",str(cert),
          "-tls1_3","-groups","X25519MLKEM768","-quiet","-ign_eof"],
          input="GET / HTTP/1.1\r\nHost: node-only.example.invalid\r\nConnection: close\r\n\r\n")
        assert http.returncode==0,http.stderr[-1600:]
        assert "404 Not Found" in http.stdout,http.stdout[-1800:]
        assert sclient("X25519").returncode!=0,"accepted classical TLS downgrade"
        assert sclient("X25519MLKEM768",tls13=False).returncode!=0,"accepted TLS1.2"
        assert sclient("X25519MLKEM768",hostname="wrong.example.invalid").returncode!=0,"wrong SNI accepted"
    finally:
        process.terminate()
        try:process.communicate(timeout=4)
        except subprocess.TimeoutExpired:
            process.kill();process.communicate(timeout=4)
print("Isolated Nginx: TLS1.3/X25519MLKEM768 negotiated; certificate/host verified; no legacy HTTP proxy; downgrade rejected.")
