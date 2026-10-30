#!/usr/bin/env python3
"""Disposable protected XSP-v2 permit signer/operator process E2E.

Uses a disposable PostgreSQL instance and generated test-only keys. It never
connects to a live Nexus database, activates a Node, enables strict-pq, or
reuses production signer material.
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
OWNER = "c2c-ci-owner"
OWNER_PASSWORD = "permit-ci-password"
# Test-only Argon2id hash of OWNER_PASSWORD. No production credential is used.
OWNER_PASSWORD_HASH = (
    "$argon2id$v=19$m=19456,t=2,p=1$5KFgypuu4QLqO9iMFxvOag$"
    "CLJvhZvFmNT7X+OI5o9ZSFGTcFvI4zP8Q00uQxIdsBQ"
)


def command(*args: str, input_text: str | None = None, check: bool = True, timeout: int = 300):
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
    if shutil.disk_usage(ROOT).free < 3 * 1024**3:
        raise RuntimeError("protected permit E2E requires at least 3 GiB free disk")

    token = secrets.token_hex(5)
    prefix = f"xsp-permit-e2e-{token}"
    network = prefix + "-net"
    db = prefix + "-db"
    helper = prefix + "-helper"
    signer = prefix + "-signer"
    signer_image = f"xmesh-permit-signer:e2e-{token}"
    operator_image = f"xmesh-permit-operator:e2e-{token}"
    fixture_image = f"xmesh-permit-fixture:e2e-{token}"
    volumes = {
        name: f"{prefix}-{name}"
        for name in ["db", "keys", "public", "permit-socket"]
    }
    containers: list[str] = []

    with tempfile.TemporaryDirectory(prefix="xsp-permit-e2e-") as tmp:
        temp = Path(tmp)
        admin_password = secrets.token_hex(24)
        app_password = secrets.token_hex(24)
        signer_password = secrets.token_hex(24)

        def envfile(name: str, values: dict[str, str]) -> str:
            path = temp / name
            path.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
            path.chmod(0o600)
            return str(path)

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
                "docker",
                "exec",
                "-i",
                db,
                "psql",
                "-X",
                "-qAt",
                "-U",
                "postgres",
                "-d",
                "xmesh",
                "-v",
                "ON_ERROR_STOP=1",
                input_text=statement,
                check=success,
            )

        try:
            command("docker", "network", "create", "--internal", network)
            for volume in volumes.values():
                command("docker", "volume", "create", volume)

            command(
                "docker",
                "build",
                "-f",
                str(ROOT / "backend/Dockerfile.xsp-permit"),
                "--target",
                "permit-signer",
                "-t",
                signer_image,
                str(ROOT),
                timeout=900,
            )
            command(
                "docker",
                "build",
                "-f",
                str(ROOT / "backend/Dockerfile.xsp-permit"),
                "--target",
                "permit-operator",
                "-t",
                operator_image,
                str(ROOT),
                timeout=900,
            )
            command(
                "docker",
                "build",
                "-f",
                str(ROOT / "backend/Dockerfile.xsp-c2c"),
                "--build-arg",
                "C2C_BUILD_TESTS=1",
                "--target",
                "c2c-tests",
                "-t",
                fixture_image,
                str(ROOT),
                timeout=900,
            )

            command(
                "docker",
                "run",
                "-d",
                "--name",
                db,
                "--network",
                network,
                "--env-file",
                db_env,
                "--mount",
                f"type=volume,src={volumes['db']},dst=/var/lib/postgresql",
                "timescale/timescaledb:2.30.0-pg18",
            )
            containers.append(db)
            for _ in range(100):
                if command(
                    "docker", "exec", db, "pg_isready", "-U", "postgres", "-d", "xmesh",
                    check=False,
                ).returncode == 0:
                    break
                time.sleep(0.3)
            else:
                raise RuntimeError("disposable PostgreSQL did not become ready")

            command(
                "docker",
                "run",
                "-d",
                "--name",
                helper,
                "--entrypoint",
                "sleep",
                "--network",
                network,
                "--mount",
                f"type=volume,src={volumes['keys']},dst=/keys",
                "--mount",
                f"type=volume,src={volumes['public']},dst=/public",
                "--mount",
                f"type=volume,src={volumes['permit-socket']},dst=/permit-socket",
                fixture_image,
                "infinity",
            )
            containers.append(helper)

            fixture = command(
                "docker",
                "exec",
                "-e",
                "XSP_V2_C2C_FIXTURE=1",
                "-e",
                f"XSP_V2_C2C_ADMIN_DATABASE_URL={admin_url}",
                "-e",
                "XSP_V2_C2C_KEYS_DIR=/keys",
                "-e",
                "XSP_V2_C2C_PUBLIC_DIR=/public",
                helper,
                "/build/output/xsp-v2-c2c-fixture",
                timeout=120,
            )
            if fixture.returncode != 0:
                raise RuntimeError("C2-C fixture setup failed")
            public = json.loads(command("docker", "exec", helper, "cat", "/public/fixture.json").stdout)
            pin = json.loads(command("docker", "exec", helper, "cat", "/public/panel-pin.json").stdout)
            node_id = int(public["nodeId"])

            # The existing C2-C fixture deliberately creates one signed permit.
            # Remove only that disposable row so this E2E exercises the new issuer.
            sql(f"DELETE FROM node_xsp_cutover_permit_ledger WHERE node_id={node_id};")
            if sql(f"SELECT count(*) FROM node_xsp_cutover_permit_ledger WHERE node_id={node_id};").stdout.strip() != "0":
                raise RuntimeError("fixture permit cleanup failed")

            provision_app = f"""
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='xmesh_app') THEN
    CREATE ROLE xmesh_app LOGIN PASSWORD '{app_password}';
  ELSE
    ALTER ROLE xmesh_app PASSWORD '{app_password}';
  END IF;
END $$;
GRANT CONNECT ON DATABASE xmesh TO xmesh_app;
GRANT USAGE ON SCHEMA public TO xmesh_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO xmesh_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO xmesh_app;
INSERT INTO panel_auth_users(username,password_hash,role,is_active)
VALUES('{OWNER}','{OWNER_PASSWORD_HASH}','owner',TRUE);
"""
            sql(provision_app)

            signer_sql = (ROOT / "deploy/postgres/22-create-xsp-v2-permit-signer-role.sql").read_text()
            sql("\\set permit_signer_password " + signer_password + "\n" + signer_sql)

            denied_write = command(
                "docker",
                "exec",
                "-e",
                f"PGPASSWORD={signer_password}",
                db,
                "psql",
                "-X",
                "-qAt",
                "-h",
                "127.0.0.1",
                "-U",
                "xmesh_permit_signer_reader",
                "-d",
                "xmesh",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                "INSERT INTO node_xsp_cutover_permit_ledger(node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,permit_input_sha256,signed_permit,issued_at,expires_at,issued_by) VALUES(1,'x',1,2,decode(repeat('11',32),'hex'),decode(repeat('12',16),'hex'),decode(repeat('13',32),'hex'),decode('00','hex'),NOW(),NOW()+INTERVAL '1 second','x');",
                check=False,
            )
            if denied_write.returncode == 0:
                raise RuntimeError("permit signer reader unexpectedly gained ledger write access")
            denied_unrelated = command(
                "docker",
                "exec",
                "-e",
                f"PGPASSWORD={signer_password}",
                db,
                "psql",
                "-X",
                "-qAt",
                "-h",
                "127.0.0.1",
                "-U",
                "xmesh_permit_signer_reader",
                "-d",
                "xmesh",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                "SELECT count(*) FROM panel_auth_users;",
                check=False,
            )
            if denied_unrelated.returncode == 0:
                raise RuntimeError("permit signer reader unexpectedly gained owner credential read access")
            print("PASS: permit signer DB role is SELECT-only and cannot read owner credentials")

            command(
                "docker",
                "exec",
                "--user",
                "0:0",
                helper,
                "python3",
                "-c",
                "import os;"
                "os.chown('/permit-socket',10006,10005);os.chmod('/permit-socket',0o2750);"
                "os.chown('/public',0,10005);os.chmod('/public',0o750);"
                "os.chown('/public/panel-pin.json',0,10005);os.chmod('/public/panel-pin.json',0o640)",
            )

            signer_env = envfile(
                "signer.env",
                {
                    "XSP_V2_PROTECTED_PERMIT_ISSUER": "staging-only",
                    "XSP_V2_PERMIT_SIGNER_DATABASE_URL": (
                        f"postgresql://xmesh_permit_signer_reader:{signer_password}@{db}:5432/xmesh"
                    ),
                    "XSP_V2_PERMIT_SIGNER_SOCKET_PATH": "/run/xmesh-permit-signer/permit.sock",
                    "XSP_V2_PERMIT_SIGNER_EXPECTED_ED_KEY_ID": str(pin["ed25519KeyId"]),
                    "XSP_V2_PERMIT_SIGNER_EXPECTED_PQ_KEY_ID": str(pin["mldsa65KeyId"]),
                    "XSP_V2_PERMIT_SIGNER_ISSUER_ID": str(pin["issuerId"]),
                    "RUST_LOG": "warn,sqlx=error",
                },
            )
            command(
                "docker",
                "run",
                "-d",
                "--name",
                signer,
                "--network",
                network,
                "--env-file",
                signer_env,
                "--mount",
                f"type=volume,src={volumes['keys']},dst=/run/xmesh-signer-keys,readonly",
                "--mount",
                f"type=volume,src={volumes['permit-socket']},dst=/run/xmesh-permit-signer,volume-nocopy",
                "--read-only",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,size=16m,mode=1777",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges",
                signer_image,
            )
            containers.append(signer)
            for _ in range(80):
                if command(
                    "docker", "exec", signer, "test", "-S", "/run/xmesh-permit-signer/permit.sock",
                    check=False,
                ).returncode == 0:
                    break
                time.sleep(0.15)
            else:
                logs = command("docker", "logs", signer, check=False)
                raise RuntimeError("permit signer socket unavailable: " + (logs.stdout + logs.stderr)[-1800:])

            def run_operator(password: str, request_id: str, *, success: bool):
                result = command(
                    "docker",
                    "run",
                    "--rm",
                    "-i",
                    "--network",
                    network,
                    "-e",
                    "XSP_V2_PROTECTED_PERMIT_OPERATOR=staging-only",
                    "-e",
                    f"DATABASE_URL=postgresql://xmesh_app:{app_password}@{db}:5432/xmesh",
                    "-e",
                    "XSP_V2_PERMIT_PANEL_PIN_FILE=/run/xmesh-permit-public/panel-pin.json",
                    "-e",
                    "XSP_V2_PERMIT_SIGNER_SOCKET_PATH=/run/xmesh-permit-signer/permit.sock",
                    "--mount",
                    f"type=volume,src={volumes['public']},dst=/run/xmesh-permit-public,readonly",
                    "--mount",
                    f"type=volume,src={volumes['permit-socket']},dst=/run/xmesh-permit-signer,readonly",
                    "--read-only",
                    "--tmpfs",
                    "/tmp:rw,noexec,nosuid,size=8m,mode=1777",
                    "--cap-drop=ALL",
                    "--security-opt=no-new-privileges",
                    operator_image,
                    "--node",
                    str(node_id),
                    "--owner",
                    OWNER,
                    "--request-id",
                    request_id,
                    input_text=password + "\n",
                    check=False,
                    timeout=30,
                )
                if success and result.returncode != 0:
                    raise RuntimeError("permit operator failed: " + (result.stderr or result.stdout)[-1800:])
                if not success and result.returncode == 0:
                    raise RuntimeError("permit operator unexpectedly accepted invalid authentication")
                return result

            request_id = "protected-permit-e2e-1"
            first = run_operator(OWNER_PASSWORD, request_id, success=True)
            first_result = json.loads(first.stdout.strip().splitlines()[-1])
            if not (
                first_result["nodeId"] == node_id
                and first_result["fromEpoch"] == 1
                and first_result["toEpoch"] == 2
                and first_result["cutoverAuthorized"] is True
                and first_result["strictActivated"] is False
                and first_result["productionActivation"] is False
                and first_result["reused"] is False
            ):
                raise RuntimeError(f"unexpected first operator result: {first_result}")
            permit_bytes = base64.b64decode(first_result["signedPermitB64"], validate=True)
            stored_hex = sql(
                f"SELECT encode(signed_permit,'hex') FROM node_xsp_cutover_permit_ledger WHERE node_id={node_id} AND request_id='{request_id}';"
            ).stdout.strip()
            if bytes.fromhex(stored_hex) != permit_bytes:
                raise RuntimeError("operator output differs from committed ledger permit bytes")
            state = sql(
                f"SELECT state||'|'||issued_by FROM node_xsp_cutover_permit_ledger WHERE node_id={node_id} AND request_id='{request_id}';"
            ).stdout.strip()
            if state != f"issued|{OWNER}":
                raise RuntimeError(f"unexpected ledger state {state}")
            if sql(f"SELECT key_epoch FROM node_xsp_suite_state WHERE node_id={node_id};").stdout.strip() != "1":
                raise RuntimeError("permit issuance changed suite epoch")
            print("PASS: authenticated owner issued one committed dual-signed permit without epoch activation")

            retry = run_operator(OWNER_PASSWORD, request_id, success=True)
            retry_result = json.loads(retry.stdout.strip().splitlines()[-1])
            if retry_result["reused"] is not True or retry_result["signedPermitB64"] != first_result["signedPermitB64"]:
                raise RuntimeError("exact retry did not reuse the committed permit bytes")
            if sql(f"SELECT count(*) FROM node_xsp_cutover_permit_ledger WHERE node_id={node_id};").stdout.strip() != "1":
                raise RuntimeError("exact retry created another ledger row")
            print("PASS: exact request retry returns byte-identical durable permit")

            run_operator("definitely-wrong-password", "protected-permit-e2e-wrong", success=False)
            if sql(f"SELECT count(*) FROM node_xsp_cutover_permit_ledger WHERE node_id={node_id};").stdout.strip() != "1":
                raise RuntimeError("failed owner authentication changed permit ledger")
            print("PASS: wrong owner password fails closed with no ledger mutation")

            signer_inspect = json.loads(command("docker", "inspect", signer).stdout)[0]
            if signer_inspect["HostConfig"].get("PortBindings"):
                raise RuntimeError("permit signer unexpectedly publishes a host port")
            print("PROTECTED PERMIT PROCESS E2E: PASS (staging only; strict-pq remains OFF)")
        finally:
            for name in reversed(containers):
                command("docker", "rm", "-f", name, check=False)
            for volume in volumes.values():
                command("docker", "volume", "rm", volume, check=False)
            command("docker", "network", "rm", network, check=False)


if __name__ == "__main__":
    main()
