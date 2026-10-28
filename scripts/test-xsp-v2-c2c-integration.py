#!/usr/bin/env python3
"""Disposable P0-C2-C ACK auth/commit/signer/receipt process E2E.

Starts at the already-proven C2-A/C2-B trusted origin boundary: a disposable
UID 10003 process supplies the same verified-client-certificate evidence over
the protected origin UDS. No public port, production key, live DB, or strict-pq
activation is used. Full Node->TLS->origin->C2-C retry E2E remains C2-D.
"""
from __future__ import annotations

import base64
import concurrent.futures
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def command(*args: str, input_text: str | None = None, check: bool = True, timeout: int = 180):
    result = subprocess.run(
        args, input=input_text, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        check=False, timeout=timeout,
    )
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {(result.stderr or result.stdout)[-1800:]}")
    return result


def main() -> None:
    if shutil.disk_usage(ROOT).free < 3 * 1024**3:
        raise RuntimeError("C2-C E2E requires at least 3 GiB free disk")
    token = secrets.token_hex(5)
    prefix = f"xsp-c2c-e2e-{token}"
    network = prefix + "-net"
    db, helper, signer, c2c, origin = (prefix + suffix for suffix in ["-db", "-helper", "-signer", "-c2c", "-origin"])
    signer_image = f"xmesh-signer:c2c-{token}"
    c2c_image = f"xmesh-c2c:{token}"
    tests_image = f"xmesh-c2c-tests:{token}"
    origin_image = f"xmesh-origin-c2c:{token}"
    volumes = {name: f"{prefix}-{name}" for name in ["db", "keys", "public", "signer", "c2c", "origin"]}
    containers: list[str] = []

    with tempfile.TemporaryDirectory(prefix="xsp-c2c-material-") as tmp:
        temp = Path(tmp)
        cert_dir = temp / "certs"
        cert_dir.mkdir()
        command("go", "run", str(ROOT / "scripts/generate-xsp-v2-mldsa-test-certs.go"), "-out", str(cert_dir), timeout=90)
        expected_spki = (cert_dir / "client-spki.sha256").read_text().strip()
        if len(expected_spki) != 64:
            raise RuntimeError("invalid generated ML-DSA client SPKI")

        def envfile(name: str, values: dict[str, str]) -> str:
            path = temp / name
            path.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
            path.chmod(0o600)
            return str(path)

        admin_password = secrets.token_hex(24)
        signer_password = secrets.token_hex(24)
        c2c_password = secrets.token_hex(24)
        db_env = envfile("db.env", {
            "POSTGRES_DB": "xmesh", "POSTGRES_PASSWORD": admin_password,
            "TIMESCALEDB_TELEMETRY": "off", "TS_TUNE_MEMORY": "512MB", "TS_TUNE_NUM_CPUS": "2",
        })
        admin_url = f"postgresql://postgres:{admin_password}@{db}:5432/xmesh"

        def sql(statement: str, success: bool = True):
            return command(
                "docker", "exec", "-i", db, "psql", "-X", "-qAt", "-U", "postgres", "-d", "xmesh",
                "-v", "ON_ERROR_STOP=1", input_text=statement, check=success,
            )

        def launch(name: str, image: str, args: list[str], entrypoint: str | None = None) -> None:
            cmd = ["docker", "run", "-d", "--name", name]
            if entrypoint:
                cmd += ["--entrypoint", entrypoint]
            command(*(cmd + args + [image] + (["infinity"] if entrypoint == "sleep" else [])))
            if name not in containers:
                containers.append(name)

        def root_python(code: str) -> None:
            command("docker", "exec", "-i", helper, "python3", "-", input_text=code)

        def wait_socket(container: str, path: str, user: str = "0:0", tries: int = 80) -> None:
            for _ in range(tries):
                if command("docker", "exec", "--user", user, container, "test", "-S", path, check=False).returncode == 0:
                    return
                time.sleep(0.15)
            logs = command("docker", "logs", "--tail", "50", container, check=False)
            raise RuntimeError(f"socket {path} not ready: {(logs.stdout + logs.stderr)[-1600:]}")

        def origin_request(raw_ack: bytes, *, uid: int = 10003) -> tuple[int, bytes]:
            script = r'''import os,socket,urllib.parse,sys
sock=os.environ['ORIGIN_SOCKET'];ack=open('/public/request.ack','rb').read();cert=open('/client/client.pem','rb').read()
headers=[b'POST /api/v2/node/keys/rotation/ack HTTP/1.1',b'Host: c2c.invalid',b'Connection: close',b'Content-Type: application/json',f'Content-Length: {len(ack)}'.encode(),b'X-XSP-V2-Client-Verify: SUCCESS',b'X-XSP-V2-Client-Cert: '+urllib.parse.quote_from_bytes(cert,safe='').encode()]
s=socket.socket(socket.AF_UNIX);s.settimeout(15);s.connect(sock);s.sendall(b'\r\n'.join(headers)+b'\r\n\r\n'+ack);s.shutdown(socket.SHUT_WR);out=b''
while True:
 p=s.recv(65536)
 if not p:break
 out+=p
s.close();sys.stdout.buffer.write(out)
'''
            request_file = temp / f"request-{secrets.token_hex(4)}.ack"
            request_file.write_bytes(raw_ack)
            result = command(
                "docker", "run", "--rm", "--network", "none", "--user", f"{uid}:10003",
                "-e", "ORIGIN_SOCKET=/run/xmesh-origin/xsp-v2-origin.sock",
                "--mount", f"type=volume,src={volumes['origin']},dst=/run/xmesh-origin",
                "--mount", f"type=bind,src={request_file},dst=/public/request.ack,readonly",
                "--mount", f"type=bind,src={cert_dir},dst=/client,readonly",
                "--entrypoint", "python3", tests_image, "-c", script,
                check=False, timeout=30,
            )
            request_file.unlink(missing_ok=True)
            wire = (result.stdout or "").encode("latin1")
            if b"\r\n\r\n" not in wire:
                return 0, wire
            head, body = wire.split(b"\r\n\r\n", 1)
            first = head.split(b"\r\n", 1)[0].split()
            return (int(first[1]) if len(first) >= 2 and first[1].isdigit() else 0), body

        def direct_c2c_wrong_peer(node_id: int, ack: bytes) -> None:
            script = r'''import os,socket,struct
ack=open('/public/request.ack','rb').read();node=int(os.environ['NODE']);frame=b'XSP2C2C1'+struct.pack('>Q',node)+struct.pack('>I',len(ack))+ack
s=socket.socket(socket.AF_UNIX);s.settimeout(3);s.connect('/run/xmesh-c2c/c2c.sock');s.sendall(frame);s.shutdown(socket.SHUT_WR)
try: out=s.recv(64)
except (ConnectionResetError,BrokenPipeError): out=b''
assert out==b'',out
'''
            request_file = temp / "direct-request.ack"
            request_file.write_bytes(ack)
            command(
                "docker", "run", "--rm", "--network", "none", "--user", "10003:10003",
                "-e", f"NODE={node_id}",
                "--mount", f"type=volume,src={volumes['c2c']},dst=/run/xmesh-c2c",
                "--mount", f"type=bind,src={request_file},dst=/public/request.ack,readonly",
                "--entrypoint", "python3", tests_image, "-c", script,
            )

        def boot_signer(public: dict[str, object]) -> None:
            command("docker", "rm", "-f", signer, check=False)
            signer_env = envfile("signer.env", {
                "XSP_V2_SIGNER_DATABASE_URL": f"postgresql://xmesh_signer_reader:{signer_password}@{db}:5432/xmesh",
                "XSP_V2_SIGNER_EXPECTED_ED_KEY_ID": str(public["edId"]),
                "XSP_V2_SIGNER_EXPECTED_PQ_KEY_ID": str(public["pqId"]),
                "XSP_V2_SIGNER_ISSUER_ID": str(public["issuer"]),
                "RUST_LOG": "warn",
            })
            command(
                "docker", "run", "-d", "--name", signer, "--network", network, "--env-file", signer_env,
                "--mount", f"type=volume,src={volumes['keys']},dst=/run/xmesh-signer-keys,readonly",
                "--mount", f"type=volume,src={volumes['signer']},dst=/run/xmesh-signer,volume-nocopy",
                "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
                signer_image, "--xsp-v2-signer",
            )
            if signer not in containers:
                containers.append(signer)
            wait_socket(signer, "/run/xmesh-signer/signer.sock", "10002:10001")

        def boot_c2c() -> None:
            command("docker", "rm", "-f", c2c, check=False)
            c2c_env = envfile("c2c.env", {
                "XSP_V2_C2C_ACK_AUTH": "staging-only",
                "XSP_V2_C2C_DATABASE_URL": f"postgresql://xmesh_c2c_writer:{c2c_password}@{db}:5432/xmesh",
                "XSP_V2_C2C_PANEL_PIN_FILE": "/run/xmesh-c2c-public/panel-pin.json",
                "XSP_V2_C2C_SOCKET_PATH": "/run/xmesh-c2c/c2c.sock",
                "XSP_V2_SIGNER_SOCKET_PATH": "/run/xmesh-signer/signer.sock",
                "RUST_LOG": "warn",
            })
            launch(c2c, c2c_image, [
                "--network", network, "--env-file", c2c_env,
                "--mount", f"type=volume,src={volumes['public']},dst=/run/xmesh-c2c-public,readonly",
                "--mount", f"type=volume,src={volumes['c2c']},dst=/run/xmesh-c2c,volume-nocopy",
                "--mount", f"type=volume,src={volumes['signer']},dst=/run/xmesh-signer,readonly",
                "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
            ])
            wait_socket(c2c, "/run/xmesh-c2c/c2c.sock", "10001:10001")

        try:
            command("docker", "network", "create", "--internal", network)
            for volume in volumes.values():
                command("docker", "volume", "create", volume)
            command("docker", "build", "-f", str(ROOT / "backend/Dockerfile.xsp-signer"), "--target", "runtime", "-t", signer_image, str(ROOT), timeout=900)
            for target, tag in [("runtime", c2c_image), ("c2c-tests", tests_image)]:
                command(
                    "docker", "build", "-f", str(ROOT / "backend/Dockerfile.xsp-c2c"),
                    "--build-arg", "C2C_BUILD_TESTS=1", "--target", target, "-t", tag, str(ROOT), timeout=900,
                )
            command(
                "docker", "build", "-f", str(ROOT / "deploy/xsp-v2-ingress/Dockerfile"),
                "--target", "origin-ack-gate", "-t", origin_image, str(ROOT), timeout=600,
            )

            launch(db, "timescale/timescaledb:2.30.0-pg18", [
                "--network", network, "--env-file", db_env,
                "--mount", f"type=volume,src={volumes['db']},dst=/var/lib/postgresql",
            ])
            for _ in range(80):
                if command("docker", "exec", db, "pg_isready", "-U", "postgres", "-d", "xmesh", check=False).returncode == 0:
                    break
                time.sleep(0.5)
            else:
                raise RuntimeError("disposable PostgreSQL did not become ready")

            launch(helper, tests_image, [
                "--network", network,
                "--mount", f"type=volume,src={volumes['keys']},dst=/keys",
                "--mount", f"type=volume,src={volumes['public']},dst=/public",
                "--mount", f"type=volume,src={volumes['signer']},dst=/run/xmesh-signer",
                "--mount", f"type=volume,src={volumes['c2c']},dst=/run/xmesh-c2c",
                "--mount", f"type=volume,src={volumes['origin']},dst=/run/xmesh-origin",
            ], "sleep")
            root_python("import os\nos.chown('/run/xmesh-signer',10002,10001);os.chmod('/run/xmesh-signer',0o750)\nos.chown('/run/xmesh-c2c',10001,10003);os.chmod('/run/xmesh-c2c',0o2750)\nos.chown('/run/xmesh-origin',10004,10003);os.chmod('/run/xmesh-origin',0o750)\nos.chmod('/public',0o755)\n")

            fixture = command(
                "docker", "exec", "-e", "XSP_V2_C2C_FIXTURE=1",
                "-e", f"XSP_V2_C2C_ADMIN_DATABASE_URL={admin_url}",
                "-e", "XSP_V2_C2C_KEYS_DIR=/keys", "-e", "XSP_V2_C2C_PUBLIC_DIR=/public",
                helper, "/build/output/xsp-v2-c2c-fixture", "--exact",
                "prepare_uncommitted_c2c_fixture", "--ignored", "--nocapture",
            )
            if "1 passed; 0 failed" not in fixture.stdout:
                raise RuntimeError("C2-C fixture test did not execute")
            public = json.loads(command("docker", "exec", helper, "cat", "/public/fixture.json").stdout)
            node_id = int(public["nodeId"])
            ack = base64.b64decode(public["ackB64"], validate=True)

            signer_sql = (ROOT / "deploy/postgres/20-create-xsp-v2-signer-role.sql").read_text()
            c2c_sql = (ROOT / "deploy/postgres/21-create-xsp-v2-c2c-role.sql").read_text()
            sql("\\set signer_password " + signer_password + "\n" + signer_sql)
            sql("\\set c2c_password " + c2c_password + "\n" + c2c_sql)
            for statement in [
                "CREATE TABLE public.forbidden(i int)", "CREATE TEMP TABLE forbidden(i int)",
                "SELECT * FROM node_metric_keys", "DELETE FROM node_xsp_replay_nonces",
                "TRUNCATE node_xsp_signed_commit_receipt_outbox",
                "UPDATE node_xsp_public_keysets SET revoked_at=NOW()",
            ]:
                denied = sql("SET ROLE xmesh_c2c_writer; " + statement + ";", success=False)
                if denied.returncode == 0:
                    raise RuntimeError("C2-C writer gained excessive DB privilege")
            print("PASS: C2-C DB role rejects DDL/TEMP/unrelated read/delete/truncate/key retirement")

            boot_c2c()
            origin_env = envfile("origin.env", {
                "XSP_EXPECTED_CLIENT_SPKI_SHA256": expected_spki,
                "XSP_EXPECTED_NODE_ID": str(node_id),
                "XSP_EXPECTED_INGRESS_UID": "10003", "XSP_EXPECTED_INGRESS_GID": "10003",
                "XSP_V2_C2B_ACK_ROUTE": "staging-only", "XSP_V2_C2C_ACK_AUTH": "staging-only",
                "XSP_V2_C2C_SOCKET_PATH": "/run/xmesh-c2c/c2c.sock",
            })
            launch(origin, origin_image, [
                "--network", "none", "--env-file", origin_env,
                "--mount", f"type=volume,src={volumes['origin']},dst=/run/xmesh-origin",
                "--mount", f"type=volume,src={volumes['c2c']},dst=/run/xmesh-c2c,readonly",
                "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=8m,mode=1777",
                "--cap-drop=ALL", "--security-opt=no-new-privileges",
            ])
            wait_socket(origin, "/run/xmesh-origin/xsp-v2-origin.sock", "10004:10003")

            status, _ = origin_request(ack)
            if status != 503:
                raise RuntimeError(f"missing signer must fail HTTP success, got {status}")
            epoch = sql(f"SELECT key_epoch FROM node_xsp_suite_state WHERE node_id={node_id};").stdout.strip()
            state = sql(f"SELECT state FROM node_xsp_cutover_permit_ledger WHERE node_id={node_id} AND request_id='{public['requestId']}';").stdout.strip()
            outbox = sql(f"SELECT count(*) FROM node_xsp_signed_commit_receipt_outbox WHERE node_id={node_id};").stdout.strip()
            if (epoch, state, outbox) != ("2", "ack_verified", "0"):
                raise RuntimeError(f"post-commit/signer-down state invalid: {epoch}/{state}/{outbox}")
            print("PASS: ACK commits atomically, but signer-down returns no policy success and no receipt")

            boot_signer(public)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _x: origin_request(ack), range(2)))
            successes = [(status, body) for status, body in results if status == 200]
            if not successes:
                raise RuntimeError(f"concurrent exact retries produced no durable receipt: {[s for s,_ in results]}")
            receipt = successes[0][1]
            if not receipt or not receipt.startswith(b"{"):
                raise RuntimeError("C2-C success did not return signed JSON receipt bytes")
            stored_hex = sql(f"SELECT encode(signed_receipt,'hex') FROM node_xsp_signed_commit_receipt_outbox WHERE node_id={node_id} AND request_id='{public['requestId']}';").stdout.strip()
            if bytes.fromhex(stored_hex) != receipt:
                raise RuntimeError("network receipt differs from immutable outbox bytes")
            if sql(f"SELECT count(*) FROM node_xsp_signed_commit_receipt_outbox WHERE node_id={node_id};").stdout.strip() != "1":
                raise RuntimeError("C2-C did not converge to one durable receipt")
            print("PASS: concurrent exact retry converges to first durable dual-signed receipt")

            command("docker", "stop", signer)
            status, recovered = origin_request(ack)
            if status != 200 or recovered != receipt:
                raise RuntimeError("durable retry must return exact receipt without live signer")
            if sql(f"SELECT key_epoch FROM node_xsp_suite_state WHERE node_id={node_id};").stdout.strip() != "2":
                raise RuntimeError("receipt retry repeated epoch transition")
            print("PASS: signer-off retry returns exact durable receipt and no second epoch transition")

            tampered = json.loads(ack)
            sig = tampered["signatures"]["ed25519"]
            tampered["signatures"]["ed25519"] = ("A" if sig[0] != "A" else "B") + sig[1:]
            bad_ack = json.dumps(tampered, separators=(",", ":")).encode()
            status, _ = origin_request(bad_ack)
            if status == 200:
                raise RuntimeError("tampered ACK signature reached policy success")
            status, _ = origin_request(ack, uid=10005)
            if status not in (0, 403):
                raise RuntimeError("wrong origin peer credential was not rejected")
            direct_c2c_wrong_peer(node_id, ack)
            print("PASS: tampered ACK, wrong ingress peer, and direct C2-C impersonation fail closed")

            command("docker", "pause", db)
            try:
                status, _ = origin_request(ack)
                if status == 200:
                    raise RuntimeError("DB stall must not fall back to cached/unsigned success")
            finally:
                command("docker", "unpause", db)
            print("PASS: DB stall fails closed")

            key_rows = sql(f"SELECT key_epoch||':'||(revoked_at IS NULL) FROM node_xsp_public_keysets WHERE node_id={node_id} ORDER BY key_epoch;").stdout.splitlines()
            if key_rows != ["1:true", "2:true"]:
                raise RuntimeError(f"old/new public key retention violated: {key_rows}")
            print("PASS: old public keys remain unretired; new epoch installed exactly once")

            for name in [c2c, origin]:
                inspect = json.loads(command("docker", "inspect", name).stdout)[0]
                if inspect["HostConfig"].get("PortBindings"):
                    raise RuntimeError(f"{name} unexpectedly publishes a port")
            c2c_mounts = json.loads(command("docker", "inspect", "-f", "{{json .Mounts}}", c2c).stdout)
            if any(m.get("Destination") == "/run/xmesh-signer-keys" or m.get("Name") == volumes["keys"] for m in c2c_mounts):
                raise RuntimeError("C2-C service must never mount signer private keys")
            tcp = command("docker", "exec", c2c, "cat", "/proc/net/tcp", "/proc/net/tcp6").stdout.splitlines()
            if any(len(line.split()) > 3 and line.split()[3] == "0A" for line in tcp):
                raise RuntimeError("C2-C service must not listen on TCP")
            print("PASS: C2-C and origin remain local-only; C2-C has no signer key mount or TCP listener")

            sensitive = [admin_password, signer_password, c2c_password, base64.b64encode(ack).decode(), "BEGIN PRIVATE KEY"]
            for name in [c2c, origin, signer]:
                logs = command("docker", "logs", name, check=False)
                combined = logs.stdout + logs.stderr
                if any(value and value in combined for value in sensitive):
                    raise RuntimeError(f"{name} leaked sensitive material in logs")
            print("C2-C PROCESS E2E: PASS (staging only; full Node TLS E2E remains C2-D)")
        finally:
            for name in reversed(containers):
                command("docker", "rm", "-f", name, check=False)
            for volume in volumes.values():
                command("docker", "volume", "rm", volume, check=False)
            command("docker", "network", "rm", network, check=False)


if __name__ == "__main__":
    main()
