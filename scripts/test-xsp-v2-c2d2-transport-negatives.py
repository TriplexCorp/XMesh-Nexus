#!/usr/bin/env python3
"""Disposable final P0-C2-D2 transport-negative / no-legacy E2E.

Builds the reviewed strict C2-D topology with an exact, cryptographically valid
uncommitted ACK, then proves that downgraded/untrusted transport identities and
legacy XMESH1-style authentication cannot reach policy success or mutate durable
ACK/epoch/receipt state. Staging/test only; production Agent remains untouched.
"""
from __future__ import annotations

import base64
import json
from pathlib import Path
import secrets
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
HOSTNAME = "node-ingress.xsp.invalid"
ALIAS = "xsp-ingress-c2d-neg"
ACK_PATH = "/api/v2/node/keys/rotation/ack"
LEGACY_PATH = "/api/v1/node/heartbeat"


def command(*args: str, input_text: str | None = None, check: bool = True, timeout: int = 240):
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
            f"{(result.stderr or result.stdout)[-2400:]}"
        )
    return result


def main() -> None:
    token = secrets.token_hex(5)
    prefix = f"xsp-c2d2-neg-{token}"
    network = prefix + "-net"
    db = prefix + "-db"
    helper = prefix + "-helper"
    signer = prefix + "-signer"
    c2c = prefix + "-c2c"
    origin = prefix + "-origin"
    ingress = prefix + "-ingress"
    signer_image = f"xmesh-signer:c2d2-neg-{token}"
    c2c_image = f"xmesh-c2c:c2d2-neg-{token}"
    tests_image = f"xmesh-c2c-tests:c2d2-neg-{token}"
    origin_image = f"xmesh-origin-c2d2-neg:{token}"
    ingress_image = f"xmesh-ingress-c2d2-neg:{token}"
    probe_image = f"xmesh-ingress-probe-c2d2-neg:{token}"
    volumes = {
        name: f"{prefix}-{name}"
        for name in ["db", "keys", "public", "signer", "c2c", "origin", "certs"]
    }
    containers: list[str] = []

    with tempfile.TemporaryDirectory(prefix="xsp-c2d2-neg-") as tmp:
        temp = Path(tmp)
        cert_material = temp / "client-material"
        cert_material.mkdir()

        def envfile(name: str, values: dict[str, str]) -> str:
            path = temp / name
            path.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
            path.chmod(0o600)
            return str(path)

        admin_password = secrets.token_hex(24)
        signer_password = secrets.token_hex(24)
        c2c_password = secrets.token_hex(24)
        db_env = envfile(
            "db.env",
            {
                "POSTGRES_DB": "xmesh",
                "POSTGRES_PASSWORD": admin_password,
                "TIMESCALEDB_TELEMETRY": "off",
                "TS_TUNE_MEMORY": "512MB",
                "TS_TUNE_NUM_CPUS": "2",
            },
        )
        admin_url = f"postgresql://postgres:{admin_password}@{db}:5432/xmesh"

        def sql(statement: str):
            return command(
                "docker", "exec", "-i", db,
                "psql", "-X", "-qAt", "-U", "postgres", "-d", "xmesh",
                "-v", "ON_ERROR_STOP=1",
                input_text=statement,
            )

        def launch(name: str, image: str, run_args: list[str], command_args: list[str] | None = None) -> None:
            cmd = ["docker", "run", "-d", "--name", name] + run_args + [image]
            if command_args:
                cmd += command_args
            command(*cmd)
            if name not in containers:
                containers.append(name)

        def wait_socket(container: str, path: str, user: str = "0:0") -> None:
            for _ in range(100):
                if command("docker", "exec", "--user", user, container, "test", "-S", path, check=False).returncode == 0:
                    return
                time.sleep(0.15)
            logs = command("docker", "logs", "--tail", "60", container, check=False)
            raise RuntimeError(f"socket {path} not ready: {(logs.stdout + logs.stderr)[-1800:]}")

        def wait_db() -> None:
            for _ in range(100):
                if command("docker", "exec", db, "pg_isready", "-U", "postgres", "-d", "xmesh", check=False).returncode == 0:
                    return
                time.sleep(0.25)
            logs = command("docker", "logs", "--tail", "80", db, check=False)
            raise RuntimeError(f"PostgreSQL did not become ready: {(logs.stdout + logs.stderr)[-1800:]}")

        def boot_signer(public: dict[str, object]) -> None:
            signer_env = envfile(
                "signer.env",
                {
                    "XSP_V2_SIGNER_DATABASE_URL": f"postgresql://xmesh_signer_reader:{signer_password}@{db}:5432/xmesh",
                    "XSP_V2_SIGNER_EXPECTED_ED_KEY_ID": str(public["edId"]),
                    "XSP_V2_SIGNER_EXPECTED_PQ_KEY_ID": str(public["pqId"]),
                    "XSP_V2_SIGNER_ISSUER_ID": str(public["issuer"]),
                    "RUST_LOG": "warn",
                },
            )
            launch(
                signer,
                signer_image,
                [
                    "--network", network,
                    "--env-file", signer_env,
                    "--mount", f"type=volume,src={volumes['keys']},dst=/run/xmesh-signer-keys,readonly",
                    "--mount", f"type=volume,src={volumes['signer']},dst=/run/xmesh-signer,volume-nocopy",
                    "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
                ],
                ["--xsp-v2-signer"],
            )
            wait_socket(signer, "/run/xmesh-signer/signer.sock", "10002:10001")

        def boot_c2c() -> None:
            c2c_env = envfile(
                "c2c.env",
                {
                    "XSP_V2_C2C_ACK_AUTH": "staging-only",
                    "XSP_V2_C2D_HISTORICAL_RECOVERY": "staging-only",
                    "XSP_V2_C2C_DATABASE_URL": f"postgresql://xmesh_c2c_writer:{c2c_password}@{db}:5432/xmesh",
                    "XSP_V2_C2C_PANEL_PIN_FILE": "/run/xmesh-c2c-public/panel-pin.json",
                    "XSP_V2_C2C_SOCKET_PATH": "/run/xmesh-c2c/c2c.sock",
                    "XSP_V2_SIGNER_SOCKET_PATH": "/run/xmesh-signer/signer.sock",
                    "RUST_LOG": "warn",
                },
            )
            launch(
                c2c,
                c2c_image,
                [
                    "--network", network,
                    "--env-file", c2c_env,
                    "--mount", f"type=volume,src={volumes['public']},dst=/run/xmesh-c2c-public,readonly",
                    "--mount", f"type=volume,src={volumes['c2c']},dst=/run/xmesh-c2c,volume-nocopy",
                    "--mount", f"type=volume,src={volumes['signer']},dst=/run/xmesh-signer,readonly",
                    "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
                ],
            )
            wait_socket(c2c, "/run/xmesh-c2c/c2c.sock", "10001:10001")

        def boot_origin(expected_spki: str, node_id: int) -> None:
            origin_env = envfile(
                "origin.env",
                {
                    "XSP_EXPECTED_CLIENT_SPKI_SHA256": expected_spki,
                    "XSP_EXPECTED_NODE_ID": str(node_id),
                    "XSP_EXPECTED_INGRESS_UID": "10003",
                    "XSP_EXPECTED_INGRESS_GID": "10003",
                    "XSP_V2_C2B_ACK_ROUTE": "staging-only",
                    "XSP_V2_C2C_ACK_AUTH": "staging-only",
                    "XSP_V2_C2D_HISTORICAL_RECOVERY": "staging-only",
                    "XSP_V2_C2C_SOCKET_PATH": "/run/xmesh-c2c/c2c.sock",
                },
            )
            launch(
                origin,
                origin_image,
                [
                    "--network", "none", "--env-file", origin_env,
                    "--mount", f"type=volume,src={volumes['origin']},dst=/run/xmesh-origin",
                    "--mount", f"type=volume,src={volumes['c2c']},dst=/run/xmesh-c2c,readonly",
                    "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=8m,mode=1777",
                    "--cap-drop=ALL", "--security-opt=no-new-privileges",
                ],
            )
            wait_socket(origin, "/run/xmesh-origin/xsp-v2-origin.sock", "10004:10003")

        def durable_state(node_id: int, request_id: str) -> tuple[str, str, str, str]:
            epoch = sql(f"SELECT key_epoch FROM node_xsp_suite_state WHERE node_id={node_id};").stdout.strip()
            state = sql(
                f"SELECT state FROM node_xsp_cutover_permit_ledger WHERE node_id={node_id} AND request_id='{request_id}';"
            ).stdout.strip()
            outbox = sql(
                f"SELECT count(*) FROM node_xsp_signed_commit_receipt_outbox WHERE node_id={node_id} AND request_id='{request_id}';"
            ).stdout.strip()
            replay = sql(f"SELECT count(*) FROM node_xsp_replay_nonces WHERE node_id={node_id};").stdout.strip()
            return epoch, state, outbox, replay

        signed_ack_text = ""

        def tls_request(
            *,
            path: str = ACK_PATH,
            body: str | None = None,
            cert: str | None = "client.pem",
            key: str | None = "client-key.pem",
            tls13: bool = True,
            group: str | None = "X25519MLKEM768",
            servername: str = HOSTNAME,
            verify_hostname: str = HOSTNAME,
            cafile: str = "/certs/fullchain.pem",
            extra_headers: tuple[str, ...] = (),
        ):
            payload = signed_ack_text if body is None else body
            headers = [
                f"Host: {HOSTNAME}",
                "Connection: close",
                "Content-Type: application/json",
                f"Content-Length: {len(payload.encode())}",
                *extra_headers,
            ]
            raw = f"POST {path} HTTP/1.1\r\n" + "\r\n".join(headers) + f"\r\n\r\n{payload}"
            openssl = [
                "s_client", "-quiet", "-ign_eof",
                "-connect", f"{ALIAS}:8444",
                "-servername", servername,
                "-verify_hostname", verify_hostname,
                "-verify_return_error",
                "-CAfile", cafile,
                "-tls1_3" if tls13 else "-tls1_2",
                "-no_ticket",
            ]
            if group:
                openssl += ["-groups", group]
            if cert and key:
                openssl += ["-cert", f"/certs/{cert}", "-key", f"/certs/{key}"]
            return command(
                "docker", "run", "--rm", "-i",
                "--network", network,
                "--mount", f"type=volume,src={volumes['certs']},dst=/certs,readonly",
                "--entrypoint", "openssl", probe_image, *openssl,
                input_text=raw, check=False, timeout=10,
            )

        def text(result: subprocess.CompletedProcess[str]) -> str:
            return (result.stdout or "") + (result.stderr or "")

        baseline_state: tuple[str, str, str, str] | None = None

        def assert_uncommitted(label: str, node_id: int, request_id: str, from_epoch: str) -> None:
            actual = durable_state(node_id, request_id)
            if baseline_state is None:
                raise RuntimeError("transport-negative baseline was not captured")
            if baseline_state[:3] != (from_epoch, "issued", "0"):
                raise RuntimeError(f"invalid initial uncommitted fixture state: {baseline_state}")
            if actual != baseline_state:
                raise RuntimeError(f"{label} mutated durable ACK state: expected={baseline_state} actual={actual}")

        def expect_transport_failure(label: str, result: subprocess.CompletedProcess[str], node_id: int, request_id: str, from_epoch: str) -> None:
            response = text(result)
            if result.returncode == 0:
                raise RuntimeError(f"{label} unexpectedly completed a TLS session: {response[-1800:]}")
            if "HTTP/1.1 200" in response or "HTTP/1.1 202" in response:
                raise RuntimeError(f"{label} reached policy success: {response[-1800:]}")
            assert_uncommitted(label, node_id, request_id, from_epoch)
            print(f"PASS: {label} fails before ACK policy success and leaves durable state unchanged")

        def expect_http_rejection(label: str, result: subprocess.CompletedProcess[str], status: str, node_id: int, request_id: str, from_epoch: str) -> None:
            response = text(result)
            if status not in response:
                raise RuntimeError(f"{label}: expected {status}: {response[-1800:]}")
            if "200 OK" in response or "202 Accepted" in response:
                raise RuntimeError(f"{label} also contained policy success: {response[-1800:]}")
            assert_uncommitted(label, node_id, request_id, from_epoch)
            print(f"PASS: {label} is rejected with {status} and cannot mutate durable state")

        def expect_required_client_cert_rejection(label: str, result: subprocess.CompletedProcess[str], node_id: int, request_id: str, from_epoch: str) -> None:
            response = text(result)
            if "400 Bad Request" not in response or "No required SSL certificate was sent" not in response:
                raise RuntimeError(f"{label}: mandatory client-certificate rejection missing: {response[-1800:]}")
            if "200 OK" in response or "202 Accepted" in response:
                raise RuntimeError(f"{label} also contained policy success: {response[-1800:]}")
            assert_uncommitted(label, node_id, request_id, from_epoch)
            print(f"PASS: {label} is rejected by mandatory mTLS before ACK routing and cannot mutate durable state")

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
            ingress_dockerfile = ROOT / "deploy/xsp-v2-ingress/Dockerfile"
            for target, tag in [("runtime-c2b", ingress_image), ("origin-ack-gate", origin_image), ("probe", probe_image)]:
                command("docker", "build", "-f", str(ingress_dockerfile), "--target", target, "-t", tag, str(ROOT), timeout=600)

            launch(
                db, "timescale/timescaledb:2.30.0-pg18",
                ["--network", network, "--env-file", db_env, "--mount", f"type=volume,src={volumes['db']},dst=/var/lib/postgresql"],
            )
            wait_db()

            command(
                "docker", "run", "-d", "--name", helper, "--entrypoint", "sleep", "--network", network,
                "--mount", f"type=volume,src={volumes['keys']},dst=/keys",
                "--mount", f"type=volume,src={volumes['public']},dst=/public",
                "--mount", f"type=volume,src={volumes['signer']},dst=/run/xmesh-signer",
                "--mount", f"type=volume,src={volumes['c2c']},dst=/run/xmesh-c2c",
                "--mount", f"type=volume,src={volumes['origin']},dst=/run/xmesh-origin",
                tests_image, "infinity",
            )
            containers.append(helper)
            command(
                "docker", "exec", "-i", helper, "python3", "-c",
                "import os;"
                "os.chown('/run/xmesh-signer',10002,10001);os.chmod('/run/xmesh-signer',0o750);"
                "os.chown('/run/xmesh-c2c',10001,10003);os.chmod('/run/xmesh-c2c',0o2750);"
                "os.chown('/run/xmesh-origin',10004,10003);os.chmod('/run/xmesh-origin',0o750);"
                "os.chmod('/public',0o755)",
            )

            command("go", "run", str(ROOT / "scripts/generate-xsp-v2-mldsa-test-certs.go"), "-out", str(cert_material), timeout=90)
            cert_setup = r'''
set -eu
umask 077
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -subj "/CN=node-ingress.xsp.invalid" \
  -addext "subjectAltName=DNS:node-ingress.xsp.invalid" \
  -days 1 -keyout /certs/privkey.pem -out /certs/fullchain.pem >/dev/null 2>&1
for name in client-ca.pem client.pem client-key.pem other-client.pem other-client-key.pem \
  classical-client.pem classical-client-key.pem client-spki.sha256; do
  cp "/client-material/$name" "/certs/$name"
done
chown 0:10003 /certs/privkey.pem /certs/fullchain.pem /certs/client-ca.pem
chmod 0440 /certs/privkey.pem /certs/fullchain.pem /certs/client-ca.pem
chmod 0400 /certs/client-key.pem /certs/other-client-key.pem /certs/classical-client-key.pem
chmod 0444 /certs/client.pem /certs/other-client.pem /certs/classical-client.pem /certs/client-spki.sha256
'''
            command(
                "docker", "run", "--rm", "--user", "0:0",
                "--mount", f"type=volume,src={volumes['certs']},dst=/certs",
                "--mount", f"type=bind,src={cert_material},dst=/client-material,readonly",
                "--entrypoint", "/bin/sh", probe_image, "-ceu", cert_setup,
            )
            expected_spki = command(
                "docker", "run", "--rm", "--mount", f"type=volume,src={volumes['certs']},dst=/certs,readonly",
                "--entrypoint", "/bin/sh", probe_image, "-ceu", "cat /certs/client-spki.sha256",
            ).stdout.strip()

            fixture = command(
                "docker", "exec", "-e", "XSP_V2_C2C_FIXTURE=1",
                "-e", f"XSP_V2_C2C_ADMIN_DATABASE_URL={admin_url}",
                "-e", "XSP_V2_C2C_KEYS_DIR=/keys", "-e", "XSP_V2_C2C_PUBLIC_DIR=/public",
                helper, "/build/output/xsp-v2-c2c-fixture", "--exact", "prepare_uncommitted_c2c_fixture", "--ignored", "--nocapture",
            )
            if "1 passed; 0 failed" not in fixture.stdout:
                raise RuntimeError("C2-C fixture did not execute")
            public = json.loads(command("docker", "exec", helper, "cat", "/public/fixture.json").stdout)
            node_id = int(public["nodeId"])
            request_id = str(public["requestId"])
            signed_ack_text = base64.b64decode(public["ackB64"], validate=True).decode()

            signer_sql = (ROOT / "deploy/postgres/20-create-xsp-v2-signer-role.sql").read_text()
            c2c_sql = (ROOT / "deploy/postgres/21-create-xsp-v2-c2c-role.sql").read_text()
            sql("\\set signer_password " + signer_password + "\n" + signer_sql)
            sql("\\set c2c_password " + c2c_password + "\n" + c2c_sql)
            from_epoch, to_epoch = sql(
                f"SELECT from_epoch||'|'||to_epoch FROM node_xsp_cutover_permit_ledger "
                f"WHERE node_id={node_id} AND request_id='{request_id}';"
            ).stdout.strip().split("|", 1)

            boot_signer(public)
            boot_c2c()
            boot_origin(expected_spki, node_id)
            launch(
                ingress, ingress_image,
                [
                    "--network", network, "--network-alias", ALIAS,
                    "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m,mode=1777",
                    "--cap-drop=ALL", "--security-opt=no-new-privileges",
                    "--mount", f"type=volume,src={volumes['certs']},dst=/run/xmesh-ingress-certs,readonly",
                    "--mount", f"type=volume,src={volumes['origin']},dst=/run/xmesh-origin",
                ],
            )
            time.sleep(1)
            baseline_state = durable_state(node_id, request_id)
            assert_uncommitted("initial fixture", node_id, request_id, from_epoch)

            expect_transport_failure(
                "TLS 1.2 downgrade",
                tls_request(tls13=False, group=None),
                node_id, request_id, from_epoch,
            )
            expect_transport_failure(
                "TLS 1.3 classical X25519-only negotiation",
                tls_request(group="X25519"),
                node_id, request_id, from_epoch,
            )
            expect_transport_failure(
                "wrong hostname/SNI",
                tls_request(servername="wrong.node.invalid", verify_hostname="wrong.node.invalid"),
                node_id, request_id, from_epoch,
            )
            expect_transport_failure(
                "untrusted server certificate root",
                tls_request(cafile="/certs/client-ca.pem"),
                node_id, request_id, from_epoch,
            )
            expect_http_rejection(
                "alternate valid ML-DSA client certificate",
                tls_request(cert="other-client.pem", key="other-client-key.pem"),
                "403 Forbidden", node_id, request_id, from_epoch,
            )
            expect_required_client_cert_rejection(
                "XMESH1 headers without authenticated PQ client identity on exact ACK route",
                tls_request(
                    cert=None, key=None,
                    extra_headers=(
                        "X-XMesh-Timestamp: 1",
                        "X-XMesh-Nonce: 00112233445566778899aabbccddeeff",
                        "X-XMesh-Signature: " + "00" * 64,
                    ),
                ),
                node_id, request_id, from_epoch,
            )
            expect_http_rejection(
                "legacy XMESH1 heartbeat path on dedicated XSP-v2 ingress",
                tls_request(
                    path=LEGACY_PATH,
                    body="{}",
                    extra_headers=(
                        "X-XMesh-Timestamp: 1",
                        "X-XMesh-Nonce: 00112233445566778899aabbccddeeff",
                        "X-XMesh-Signature: " + "00" * 64,
                    ),
                ),
                "404 Not Found", node_id, request_id, from_epoch,
            )

            # Positive control: after every negative left the DB untouched, the
            # exact signed ACK over the required hybrid mTLS path still reaches
            # C2-C, commits one epoch transition and receives one durable receipt.
            positive = tls_request()
            positive_text = text(positive)
            if "200 OK" not in positive_text or '"signatures"' not in positive_text:
                raise RuntimeError(f"strict hybrid positive control failed: {positive_text[-2000:]}")
            final = durable_state(node_id, request_id)
            expected_final = (to_epoch, "ack_verified", "1", str(int(baseline_state[3]) + 1))
            if final != expected_final:
                raise RuntimeError(f"strict hybrid positive control durable state mismatch: {final}")
            print("PASS: required hybrid mTLS exact ACK still commits one authoritative transition/receipt")

            ingress_inspect = json.loads(command("docker", "inspect", ingress).stdout)[0]
            if ingress_inspect["HostConfig"].get("PortBindings"):
                raise RuntimeError("dedicated XSP-v2 ingress unexpectedly publishes a host port")
            origin_inspect = json.loads(command("docker", "inspect", origin).stdout)[0]
            if origin_inspect["HostConfig"].get("NetworkMode") != "none":
                raise RuntimeError("protected origin must remain network-none")
            net = json.loads(command("docker", "network", "inspect", network).stdout)[0]
            if not net.get("Internal"):
                raise RuntimeError("transport-negative process network must remain internal/no-egress")

            print("C2-D2 TRANSPORT-NEGATIVE/NO-LEGACY MATRIX: PASS (staging/test only; production Agent untouched)")
        finally:
            for name in reversed(containers):
                command("docker", "rm", "-f", name, check=False)
            for volume in volumes.values():
                command("docker", "volume", "rm", volume, check=False)
            command("docker", "network", "rm", network, check=False)


if __name__ == "__main__":
    main()
