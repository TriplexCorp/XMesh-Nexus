#!/usr/bin/env python3
"""Disposable P0-C2-D2 lost-response / outage-restart / duplicate-race E2E.

This reuses the reviewed C2-A/B/C/D strict Node topology. Response-loss faults
remain confined to the staging origin boundary, while outage/restart cases stop
real disposable signer, PostgreSQL, origin and C2-C processes. Nothing here
weakens ACK freshness, cryptographic authorization, trusted transport identity
or durable state.
"""
from __future__ import annotations

import base64
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
HOSTNAME = "node-ingress.xsp.invalid"
ALIAS = "xsp-ingress-c2d"


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
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--node-repo", required=True)
    args = parser.parse_args()
    node_repo = Path(args.node_repo).resolve()
    node_module = node_repo / "security/xspv2/poc-go"
    if not (node_module / "go.mod").is_file():
        raise RuntimeError("--node-repo does not contain XMesh-Node Go 1.27 PoC module")
    if shutil.disk_usage(ROOT).free < 4 * 1024**3:
        raise RuntimeError("C2-D2 E2E requires at least 4 GiB free disk")

    token = secrets.token_hex(5)
    prefix = f"xsp-c2d2-fail-{token}"
    network = prefix + "-net"
    db = prefix + "-db"
    helper = prefix + "-helper"
    signer = prefix + "-signer"
    c2c = prefix + "-c2c"
    origin = prefix + "-origin"
    ingress = prefix + "-ingress"
    signer_image = f"xmesh-signer:c2d2-{token}"
    c2c_image = f"xmesh-c2c:c2d2-{token}"
    tests_image = f"xmesh-c2c-tests:c2d2-{token}"
    origin_image = f"xmesh-origin-c2d2:{token}"
    ingress_image = f"xmesh-ingress-c2d2:{token}"
    probe_image = f"xmesh-ingress-probe-c2d2:{token}"
    volumes = {
        name: f"{prefix}-{name}"
        for name in ["db", "keys", "public", "signer", "c2c", "origin", "certs", "journal"]
    }
    containers: list[str] = []

    with tempfile.TemporaryDirectory(prefix="xsp-c2d2-fail-") as tmp:
        temp = Path(tmp)
        cert_material = temp / "client-material"
        cert_material.mkdir()
        bundle_path = temp / "node-bundle.json"
        node_runtime = temp / "node-poc"
        shutil.copytree(node_module, node_runtime)
        shutil.copy2(ROOT / "scripts/xsp-v2-c2d-node-client_test.go", node_runtime / "cutover/c2d_e2e_test.go")
        shutil.copy2(ROOT / "scripts/xsp-v2-c2d-race_test.go", node_runtime / "cutover/c2d_race_test.go")

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

        def sql(statement: str, *, success: bool = True):
            return command(
                "docker", "exec", "-i", db,
                "psql", "-X", "-qAt", "-U", "postgres", "-d", "xmesh",
                "-v", "ON_ERROR_STOP=1",
                input_text=statement,
                check=success,
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
            raise RuntimeError(f"disposable PostgreSQL did not become ready: {(logs.stdout + logs.stderr)[-1800:]}")

        def stop_now(name: str) -> None:
            command("docker", "stop", "-t", "0", name, check=False)

        def boot_signer(public: dict[str, object]) -> None:
            command("docker", "rm", "-f", signer, check=False)
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
            command("docker", "rm", "-f", c2c, check=False)
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

        def boot_origin(expected_spki: str, node_id: int, fault: str = "") -> None:
            command("docker", "rm", "-f", origin, check=False)
            values = {
                "XSP_EXPECTED_CLIENT_SPKI_SHA256": expected_spki,
                "XSP_EXPECTED_NODE_ID": str(node_id),
                "XSP_EXPECTED_INGRESS_UID": "10003",
                "XSP_EXPECTED_INGRESS_GID": "10003",
                "XSP_V2_C2B_ACK_ROUTE": "staging-only",
                "XSP_V2_C2C_ACK_AUTH": "staging-only",
                "XSP_V2_C2D_HISTORICAL_RECOVERY": "staging-only",
                "XSP_V2_C2C_SOCKET_PATH": "/run/xmesh-c2c/c2c.sock",
            }
            if fault:
                values["XSP_V2_C2D_TEST_FAULT"] = fault
            origin_env = envfile(f"origin-{fault or 'normal'}.env", values)
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

        def run_node(test_name: str = "TestC2DFullExchange", *, expect_success: bool = True) -> str:
            result = command(
                "docker", "run", "--rm",
                "--network", network,
                "-e", "XSP_C2D_BUNDLE=/fixture/node-bundle.json",
                "-e", "XSP_C2D_JOURNAL_DIR=/journal",
                "-e", f"XSP_C2D_ADDRESS={ALIAS}:8444",
                "-e", f"XSP_C2D_SERVER_NAME={HOSTNAME}",
                "-e", "XSP_C2D_CA_FILE=/certs/fullchain.pem",
                "-e", "XSP_C2D_CLIENT_CERT=/certs/client.pem",
                "-e", "XSP_C2D_CLIENT_KEY=/certs/client-key.pem",
                "--mount", f"type=bind,src={node_runtime},dst=/src,readonly",
                "--mount", f"type=bind,src={bundle_path},dst=/fixture/node-bundle.json,readonly",
                "--mount", f"type=volume,src={volumes['certs']},dst=/certs,readonly",
                "--mount", f"type=volume,src={volumes['journal']},dst=/journal",
                "--workdir", "/src",
                "golang:1.27.3-trixie",
                "/src/c2d2.test", "-test.run", f"^{test_name}$", "-test.count=1", "-test.v",
                check=False,
                timeout=180,
            )
            combined = (result.stdout or "") + (result.stderr or "")
            if expect_success and (result.returncode != 0 or f"--- PASS: {test_name}" not in combined):
                raise RuntimeError(f"{test_name} failed: {combined[-2400:]}")
            if not expect_success and result.returncode == 0:
                raise RuntimeError(f"{test_name} unexpectedly succeeded")
            return combined

        def durable_state(node_id: int, request_id: str) -> tuple[str, str, str]:
            epoch = sql(f"SELECT key_epoch FROM node_xsp_suite_state WHERE node_id={node_id};").stdout.strip()
            state = sql(
                f"SELECT state FROM node_xsp_cutover_permit_ledger WHERE node_id={node_id} AND request_id='{request_id}';"
            ).stdout.strip()
            outbox = sql(
                f"SELECT count(*) FROM node_xsp_signed_commit_receipt_outbox WHERE node_id={node_id} AND request_id='{request_id}';"
            ).stdout.strip()
            return epoch, state, outbox

        def assert_committed_security_state(node_id: int, request_id: str, from_epoch: str, to_epoch: str) -> None:
            if durable_state(node_id, request_id) != (to_epoch, "ack_verified", "1"):
                raise RuntimeError(f"committed durable state changed: {durable_state(node_id, request_id)}")
            replay_count = sql(
                f"SELECT count(*) FROM node_xsp_replay_nonces WHERE node_id={node_id};"
            ).stdout.strip()
            if replay_count != "1":
                raise RuntimeError(f"retries/restarts changed replay nonce cardinality: {replay_count}")
            key_rows = sql(
                f"SELECT key_epoch||':'||(revoked_at IS NULL) FROM node_xsp_public_keysets "
                f"WHERE node_id={node_id} ORDER BY key_epoch;"
            ).stdout.splitlines()
            if key_rows != [f"{from_epoch}:true", f"{to_epoch}:true"]:
                raise RuntimeError(f"old/new public key retention violated: {key_rows}")

        try:
            command("docker", "network", "create", "--internal", network)
            for volume in volumes.values():
                command("docker", "volume", "create", volume)
            command("docker", "pull", "golang:1.27.3-trixie", timeout=600)
            command(
                "docker", "run", "--rm",
                "--mount", f"type=bind,src={node_runtime},dst=/src",
                "--workdir", "/src",
                "golang:1.27.3-trixie",
                "go", "test", "-c", "./cutover", "-o", "/src/c2d2.test",
                timeout=180,
            )

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

            # Generate transport material before issuing the short-lived ACK so
            # outage/restart actions, not test compilation/certificate setup,
            # consume the freshness window.
            command("go", "run", str(ROOT / "scripts/generate-xsp-v2-mldsa-test-certs.go"), "-out", str(cert_material), timeout=90)
            cert_setup = r'''
set -eu
umask 077
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -subj "/CN=node-ingress.xsp.invalid" \
  -addext "subjectAltName=DNS:node-ingress.xsp.invalid" \
  -days 1 -keyout /certs/privkey.pem -out /certs/fullchain.pem >/dev/null 2>&1
for name in client-ca.pem client.pem client-key.pem client-spki.sha256; do
  cp "/client-material/$name" "/certs/$name"
done
chown 0:10003 /certs/privkey.pem /certs/fullchain.pem /certs/client-ca.pem
chmod 0440 /certs/privkey.pem /certs/fullchain.pem /certs/client-ca.pem
chmod 0400 /certs/client-key.pem
chmod 0444 /certs/client.pem /certs/client-spki.sha256
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
            panel = json.loads(command("docker", "exec", helper, "cat", "/public/panel-pin.json").stdout)
            node_id = int(public["nodeId"])
            request_id = str(public["requestId"])
            signed_ack_raw = base64.b64decode(public["ackB64"], validate=True)
            ack_expires_ms = int(json.loads(signed_ack_raw)["message"]["expiresAtMs"])

            signer_sql = (ROOT / "deploy/postgres/20-create-xsp-v2-signer-role.sql").read_text()
            c2c_sql = (ROOT / "deploy/postgres/21-create-xsp-v2-c2c-role.sql").read_text()
            sql("\\set signer_password " + signer_password + "\n" + signer_sql)
            sql("\\set c2c_password " + c2c_password + "\n" + c2c_sql)

            permit_row = sql(
                f"SELECT from_epoch||'|'||to_epoch||'|'||encode(candidate_sha256,'hex')||'|'||encode(signed_permit,'base64') "
                f"FROM node_xsp_cutover_permit_ledger WHERE node_id={node_id} AND request_id='{request_id}';"
            ).stdout.strip()
            from_epoch, to_epoch, candidate_hex, signed_permit_b64 = permit_row.split("|", 3)
            from_ed, from_pq = sql(
                f"SELECT ed25519_key_id||'|'||mldsa65_key_id FROM node_xsp_public_keysets WHERE node_id={node_id} AND key_epoch={from_epoch};"
            ).stdout.strip().split("|", 1)
            to_ed, to_pq, next_ed_hex, next_pq_hex = sql(
                f"SELECT ed25519_key_id||'|'||mldsa65_key_id||'|'||encode(ed25519_public,'hex')||'|'||encode(mldsa65_public,'hex') "
                f"FROM node_xsp_rotation_preparations WHERE node_id={node_id} AND to_epoch={to_epoch};"
            ).stdout.strip().split("|", 3)
            bundle = {
                "signedPermitB64": "".join(signed_permit_b64.splitlines()),
                "signedAckB64": public["ackB64"],
                "panel": {
                    "issuerId": panel["issuerId"], "nodeId": node_id, "purpose": "panel_response",
                    "edKeyId": panel["ed25519KeyId"], "pqKeyId": panel["mldsa65KeyId"],
                    "edPublicB64": panel["ed25519PublicB64"], "pqPublicB64": panel["mldsa65PublicB64"],
                },
                "next": {
                    "issuerId": f"node-{node_id}", "nodeId": node_id, "purpose": "node_request",
                    "edKeyId": to_ed, "pqKeyId": to_pq,
                    "edPublicB64": base64.b64encode(bytes.fromhex(next_ed_hex)).decode(),
                    "pqPublicB64": base64.b64encode(bytes.fromhex(next_pq_hex)).decode(),
                },
                "expected": {
                    "nodeId": node_id, "fromEpoch": int(from_epoch), "toEpoch": int(to_epoch),
                    "requestId": request_id, "fromEdKeyId": from_ed, "fromPQKeyId": from_pq,
                    "toEdKeyId": to_ed, "toPQKeyId": to_pq, "candidateSha256Hex": candidate_hex,
                },
            }
            bundle_path.write_text(json.dumps(bundle, separators=(",", ":")))
            bundle_path.chmod(0o600)

            boot_signer(public)
            boot_c2c()
            boot_origin(expected_spki, node_id, "drop-before-c2c")
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

            # Existing lost-before-commit proof also establishes the exact local
            # Node permit/ACK journal used by the real outage probes below.
            run_node(expect_success=False)
            if durable_state(node_id, request_id) != (from_epoch, "issued", "0"):
                raise RuntimeError(f"lost-before-commit mutated durable state: {durable_state(node_id, request_id)}")
            print("PASS: lost response before C2-C leaves ACK/epoch uncommitted")

            boot_origin(expected_spki, node_id)
            stop_now(origin)
            run_node("TestC2DExactFreshOutageFailsClosed")
            if durable_state(node_id, request_id) != (from_epoch, "issued", "0"):
                raise RuntimeError(f"origin outage before commit mutated durable state: {durable_state(node_id, request_id)}")
            print("PASS: origin outage before commit fails closed without durable mutation")
            boot_origin(expected_spki, node_id)

            stop_now(c2c)
            run_node("TestC2DExactFreshOutageFailsClosed")
            if durable_state(node_id, request_id) != (from_epoch, "issued", "0"):
                raise RuntimeError(f"C2-C outage before commit mutated durable state: {durable_state(node_id, request_id)}")
            print("PASS: C2-C outage before commit fails closed without durable mutation")
            boot_c2c()

            stop_now(db)
            run_node("TestC2DExactFreshOutageFailsClosed")
            command("docker", "start", db)
            wait_db()
            boot_c2c()
            if durable_state(node_id, request_id) != (from_epoch, "issued", "0"):
                raise RuntimeError(f"PostgreSQL outage before commit mutated durable state: {durable_state(node_id, request_id)}")
            print("PASS: PostgreSQL outage/restart before commit fails closed and preserves issued state")

            stop_now(signer)
            boot_origin(expected_spki, node_id, "drop-on-c2c-failure")
            run_node(expect_success=False)
            if durable_state(node_id, request_id) != (to_epoch, "ack_verified", "0"):
                raise RuntimeError(f"lost-after-ACK-commit state invalid: {durable_state(node_id, request_id)}")
            print("PASS: signer outage after durable ACK commit leaves no receipt and no false Node success")

            # Restart C2-C while the signer is still unavailable, then restart the
            # signer and prove exact retry can finish the already-committed state.
            stop_now(c2c)
            boot_c2c()
            boot_signer(public)
            boot_origin(expected_spki, node_id, "drop-after-c2c-success")
            run_node(expect_success=False)
            if durable_state(node_id, request_id) != (to_epoch, "ack_verified", "1"):
                raise RuntimeError(f"lost-after-receipt state invalid: {durable_state(node_id, request_id)}")
            print("PASS: C2-C/signer restart after ACK transition converges to one durable receipt")

            stop_now(signer)
            boot_origin(expected_spki, node_id)
            run_node()
            assert_committed_security_state(node_id, request_id, from_epoch, to_epoch)
            print("PASS: exact retry after lost durable-receipt reply recovers with signer offline")

            # Restart both local trust-boundary processes after the receipt is
            # durable. A single ordinary fresh retry must still return and verify
            # exactly the authoritative receipt without a live signer.
            stop_now(origin)
            stop_now(c2c)
            boot_c2c()
            boot_origin(expected_spki, node_id)
            run_node("TestC2DExactFreshNetworkRetry")
            assert_committed_security_state(node_id, request_id, from_epoch, to_epoch)
            print("PASS: origin/C2-C restart after durable receipt preserves exact fresh recovery")

            # DB unavailability after receipt persistence must not let the Node
            # infer success. After a hard DB restart, the exact fresh retry must
            # recover the same immutable receipt and unchanged security state.
            stop_now(db)
            run_node("TestC2DExactFreshOutageFailsClosed")
            command("docker", "start", db)
            wait_db()
            boot_c2c()
            boot_origin(expected_spki, node_id)
            run_node("TestC2DExactFreshNetworkRetry")
            assert_committed_security_state(node_id, request_id, from_epoch, to_epoch)
            print("PASS: PostgreSQL outage/restart after durable receipt fails closed then recovers exact state")

            run_node("TestC2DExactDuplicateNetworkRace")
            assert_committed_security_state(node_id, request_id, from_epoch, to_epoch)
            print("PASS: eight concurrent exact fresh retries converge to the one durable receipt")

            run_node("TestC2DFreshMismatchedRetryRejected")
            assert_committed_security_state(node_id, request_id, from_epoch, to_epoch)
            print("PASS: fresh mismatched payload fails closed without state mutation after restarts")

            # Cross the original ACK expiry after all process restarts. The same
            # native Node historical-recovery test first proves the ordinary
            # state-changing route rejects the stale ACK, then recovers only the
            # exact immutable receipt over /ack/recover with the signer offline.
            delay = max(0.0, (ack_expires_ms + 350 - int(time.time() * 1000)) / 1000.0)
            if delay:
                time.sleep(delay)
            if int(time.time() * 1000) <= ack_expires_ms:
                raise RuntimeError("failed to reach historical ACK recovery window")
            run_node("TestC2DExpiredNetworkRecovery")
            assert_committed_security_state(node_id, request_id, from_epoch, to_epoch)
            print("PASS: expired exact recovery survives signer/DB/origin/C2-C restart history")

            # Integrated topology/retention assertions carried through the full
            # outage/restart matrix.
            for name in [ingress, c2c, origin]:
                inspect = json.loads(command("docker", "inspect", name).stdout)[0]
                if inspect["HostConfig"].get("PortBindings"):
                    raise RuntimeError(f"{name} unexpectedly publishes a host port")
            origin_inspect = json.loads(command("docker", "inspect", origin).stdout)[0]
            if origin_inspect["HostConfig"].get("NetworkMode") != "none":
                raise RuntimeError("protected origin must remain network-none")
            for name in [c2c, origin]:
                mounts = json.loads(command("docker", "inspect", "-f", "{{json .Mounts}}", name).stdout)
                if any(m.get("Destination") == "/run/xmesh-signer-keys" or m.get("Name") == volumes["keys"] for m in mounts):
                    raise RuntimeError(f"{name} must never mount signer private keys")
            tcp = command("docker", "exec", c2c, "cat", "/proc/net/tcp", "/proc/net/tcp6").stdout.splitlines()
            listener_inodes = {
                parts[9]
                for line in tcp
                if len(parts := line.split()) > 9 and parts[3] == "0A"
            }
            pid1_fds = command(
                "docker", "exec", c2c, "sh", "-c",
                "for f in /proc/1/fd/*; do readlink \"$f\" 2>/dev/null || true; done",
            ).stdout.splitlines()
            pid1_socket_inodes = {
                value[8:-1]
                for value in pid1_fds
                if value.startswith("socket:[") and value.endswith("]")
            }
            if listener_inodes & pid1_socket_inodes:
                raise RuntimeError("C2-C process must not listen on TCP")
            net = json.loads(command("docker", "network", "inspect", network).stdout)[0]
            if not net.get("Internal"):
                raise RuntimeError("C2-D2 process network must be internal/no-egress")
            assert_committed_security_state(node_id, request_id, from_epoch, to_epoch)
            print("C2-D2 FAILURE/OUTAGE/RESTART MATRIX: PASS (staging/test only; production Agent untouched)")
        finally:
            for name in reversed(containers):
                command("docker", "rm", "-f", name, check=False)
            for volume in volumes.values():
                command("docker", "volume", "rm", volume, check=False)
            command("docker", "network", "rm", network, check=False)


if __name__ == "__main__":
    main()
