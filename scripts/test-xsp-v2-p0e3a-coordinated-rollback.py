#!/usr/bin/env python3
"""P0-E3a disposable coordinated Agent + PostgreSQL rollback proof.

The owner/off-host checkpoint is kept in a host directory outside both restored
failure domains. The test snapshots the real prepared Agent state and real
PostgreSQL database before ACK, advances both through the strict hybrid-mTLS
ACK/receipt path, issues a newer dual-signed owner checkpoint, then restores
both old snapshots. The restored Agent must fail the current checkpoint's local
preflight with networking disabled and without mutating either restored domain.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
HOSTNAME = "node-ingress.xsp.invalid"
ALIAS = "xsp-ingress-p0e3a"


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
            f"{args[0]} failed ({result.returncode}): {(result.stderr or result.stdout)[-3200:]}"
        )
    return result


def digest_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--node-repo", required=True)
    args = parser.parse_args()
    node_repo = Path(args.node_repo).resolve()
    if not (node_repo / "agent/xspv2/go.mod").is_file() or not (node_repo / "security/xspv2/poc-go/go.mod").is_file():
        raise RuntimeError("--node-repo does not contain the required XMesh-Node Go 1.27 modules")
    if shutil.disk_usage(ROOT).free < 5 * 1024**3:
        raise RuntimeError("P0-E3a coordinated rollback E2E requires at least 5 GiB free disk")

    token = secrets.token_hex(5)
    prefix = f"xsp-p0e3a-{token}"
    network = prefix + "-net"
    db = prefix + "-db"
    helper = prefix + "-helper"
    signer = prefix + "-signer"
    c2c = prefix + "-c2c"
    origin = prefix + "-origin"
    ingress = prefix + "-ingress"
    signer_image = f"xmesh-signer:p0e3a-{token}"
    c2c_image = f"xmesh-c2c:p0e3a-{token}"
    tests_image = f"xmesh-c2c-tests:p0e3a-{token}"
    origin_image = f"xmesh-origin-p0e3a:{token}"
    ingress_image = f"xmesh-ingress-p0e3a:{token}"
    probe_image = f"xmesh-ingress-probe-p0e3a:{token}"
    volumes = {
        name: f"{prefix}-{name}"
        for name in ["db", "keys", "public", "signer", "c2c", "origin", "certs", "agent"]
    }
    containers: list[str] = []

    with tempfile.TemporaryDirectory(prefix="xsp-p0e3a-") as tmp:
        temp = Path(tmp)
        shared = temp / "shared"
        shared.mkdir(mode=0o700)
        snapshots = temp / "snapshots"
        snapshots.mkdir(mode=0o700)
        offhost = temp / "offhost"
        offhost.mkdir(mode=0o700)
        cert_material = temp / "client-material"
        cert_material.mkdir()
        bundle_path = shared / "node-bundle.json"
        agent_public_path = shared / "agent-public.json"
        node_runtime = temp / "node"
        (node_runtime / "agent").mkdir(parents=True)
        (node_runtime / "security/xspv2").mkdir(parents=True)
        shutil.copytree(node_repo / "agent/xspv2", node_runtime / "agent/xspv2")
        shutil.copytree(node_repo / "security/xspv2/poc-go", node_runtime / "security/xspv2/poc-go")
        shutil.copy2(
            ROOT / "scripts/xsp-v2-p0e3a-coordinated-rollback_test.go",
            node_runtime / "agent/xspv2/recovery/p0e3a_coordinated_rollback_test.go",
        )

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

        def sql(statement: str, *, database: str = "xmesh", success: bool = True):
            return command(
                "docker", "exec", "-i", db,
                "psql", "-X", "-qAt", "-U", "postgres", "-d", database,
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

        def wait_db() -> None:
            for _ in range(120):
                if command("docker", "exec", db, "pg_isready", "-U", "postgres", "-d", "xmesh", check=False).returncode == 0:
                    return
                time.sleep(0.25)
            raise RuntimeError("PostgreSQL not ready")

        def wait_socket(container: str, socket_path: str, user: str) -> None:
            for _ in range(120):
                if command(
                    "docker", "exec", "--user", user, container, "test", "-S", socket_path, check=False
                ).returncode == 0:
                    return
                time.sleep(0.15)
            logs = command("docker", "logs", "--tail", "100", container, check=False)
            raise RuntimeError(f"socket {socket_path} not ready: {(logs.stdout + logs.stderr)[-2200:]}")

        def stop_now(name: str) -> None:
            command("docker", "stop", "-t", "0", name, check=False)

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

        def excessive_security_role_privileges(role: str) -> bool:
            value = sql(
                "SELECT ("
                f"has_database_privilege('{role}', 'xmesh', 'CREATE') OR "
                f"has_database_privilege('{role}', 'xmesh', 'TEMP') OR "
                f"has_schema_privilege('{role}', 'public', 'CREATE')"
                ")::text;"
            ).stdout.strip()
            if value not in {"true", "false", "t", "f"}:
                raise RuntimeError(f"unexpected privilege probe result for {role}: {value!r}")
            return value in {"true", "t"}

        def run_agent_phase(phase: str, *, network_mode: str) -> str:
            args = [
                "docker", "run", "--rm", "--network", network_mode,
                "-e", f"XSP_P0E3A_PHASE={phase}",
                "-e", "XSP_P0E3A_AGENT_ROOT=/agent-state",
                "-e", "XSP_P0E3A_AGENT_PUBLIC=/shared/agent-public.json",
                "-e", "XSP_P0E3A_AGENT_SNAPSHOT=/snapshots/state-old",
                "-e", "XSP_P0E3A_BUNDLE=/shared/node-bundle.json",
                "-e", "XSP_P0E3A_OFFHOST_DIR=/offhost",
                "-e", f"XSP_P0E3A_ADDRESS={ALIAS}:8444",
                "-e", f"XSP_P0E3A_SERVER_NAME={HOSTNAME}",
                "-e", "XSP_P0E3A_CA_FILE=/certs/fullchain.pem",
                "-e", "XSP_P0E3A_CLIENT_CERT=/certs/client.pem",
                "-e", "XSP_P0E3A_CLIENT_KEY=/certs/client-key.pem",
                "--mount", f"type=bind,src={node_runtime},dst=/src,readonly",
                "--mount", f"type=bind,src={shared},dst=/shared",
                "--mount", f"type=bind,src={snapshots},dst=/snapshots",
                "--mount", f"type=bind,src={offhost},dst=/offhost",
                "--mount", f"type=volume,src={volumes['agent']},dst=/agent-state",
                "--mount", f"type=volume,src={volumes['certs']},dst=/certs,readonly",
                "--workdir", "/src/agent/xspv2",
                "golang:1.27.3-trixie",
                "/src/agent/xspv2/p0e3a.test", "-test.run", "^TestP0E3ACoordinatedRollbackPhases$",
                "-test.count=1", "-test.v",
            ]
            result = command(*args, check=False, timeout=180)
            combined = (result.stdout or "") + (result.stderr or "")
            if result.returncode != 0 or "--- PASS: TestP0E3ACoordinatedRollbackPhases" not in combined:
                raise RuntimeError(f"Agent phase {phase} failed: {combined[-4200:]}")
            return combined

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
                signer, signer_image,
                [
                    "--network", network, "--env-file", signer_env,
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
                    "XSP_V2_C2C_DATABASE_URL": f"postgresql://xmesh_c2c_writer:{c2c_password}@{db}:5432/xmesh",
                    "XSP_V2_C2C_PANEL_PIN_FILE": "/run/xmesh-c2c-public/panel-pin.json",
                    "XSP_V2_C2C_SOCKET_PATH": "/run/xmesh-c2c/c2c.sock",
                    "XSP_V2_SIGNER_SOCKET_PATH": "/run/xmesh-signer/signer.sock",
                    "RUST_LOG": "warn",
                },
            )
            launch(
                c2c, c2c_image,
                [
                    "--network", network, "--env-file", c2c_env,
                    "--mount", f"type=volume,src={volumes['public']},dst=/run/xmesh-c2c-public,readonly",
                    "--mount", f"type=volume,src={volumes['c2c']},dst=/run/xmesh-c2c,volume-nocopy",
                    "--mount", f"type=volume,src={volumes['signer']},dst=/run/xmesh-signer,readonly",
                    "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
                ],
            )
            wait_socket(c2c, "/run/xmesh-c2c/c2c.sock", "10001:10001")

        def boot_origin(expected_spki: str, node_id: int) -> None:
            command("docker", "rm", "-f", origin, check=False)
            origin_env = envfile(
                "origin.env",
                {
                    "XSP_EXPECTED_CLIENT_SPKI_SHA256": expected_spki,
                    "XSP_EXPECTED_NODE_ID": str(node_id),
                    "XSP_EXPECTED_INGRESS_UID": "10003",
                    "XSP_EXPECTED_INGRESS_GID": "10003",
                    "XSP_V2_C2B_ACK_ROUTE": "staging-only",
                    "XSP_V2_C2C_ACK_AUTH": "staging-only",
                    "XSP_V2_C2C_SOCKET_PATH": "/run/xmesh-c2c/c2c.sock",
                },
            )
            launch(
                origin, origin_image,
                [
                    "--network", "none", "--env-file", origin_env,
                    "--mount", f"type=volume,src={volumes['origin']},dst=/run/xmesh-origin",
                    "--mount", f"type=volume,src={volumes['c2c']},dst=/run/xmesh-c2c,readonly",
                    "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=8m,mode=1777",
                    "--cap-drop=ALL", "--security-opt=no-new-privileges",
                ],
            )
            wait_socket(origin, "/run/xmesh-origin/xsp-v2-origin.sock", "10004:10003")

        try:
            command("docker", "network", "create", "--internal", network)
            for volume in volumes.values():
                command("docker", "volume", "create", volume)
            command("docker", "pull", "golang:1.27.3-trixie", timeout=600)

            command(
                "docker", "run", "--rm",
                "--mount", f"type=bind,src={node_runtime},dst=/src",
                "--workdir", "/src/agent/xspv2",
                "golang:1.27.3-trixie",
                "go", "test", "-c", "./recovery", "-o", "/src/agent/xspv2/p0e3a.test",
                timeout=180,
            )
            command(
                "docker", "build", "-f", str(ROOT / "backend/Dockerfile.xsp-signer"),
                "--target", "runtime", "-t", signer_image, str(ROOT), timeout=900,
            )
            for target, tag in [("runtime", c2c_image), ("c2c-tests", tests_image)]:
                command(
                    "docker", "build", "-f", str(ROOT / "backend/Dockerfile.xsp-c2c"),
                    "--build-arg", "C2C_BUILD_TESTS=1", "--target", target,
                    "-t", tag, str(ROOT), timeout=900,
                )
            ingress_dockerfile = ROOT / "deploy/xsp-v2-ingress/Dockerfile"
            for target, tag in [("runtime-c2b", ingress_image), ("origin-ack-gate", origin_image), ("probe", probe_image)]:
                command(
                    "docker", "build", "-f", str(ingress_dockerfile),
                    "--target", target, "-t", tag, str(ROOT), timeout=600,
                )

            launch(
                db, "timescale/timescaledb:2.30.0-pg18",
                ["--network", network, "--env-file", db_env, "--mount", f"type=volume,src={volumes['db']},dst=/var/lib/postgresql"],
            )
            wait_db()

            run_agent_phase("prepare-agent", network_mode="none")
            if not agent_public_path.is_file():
                raise RuntimeError("real Agent did not export public candidate identity")

            command(
                "docker", "run", "-d", "--name", helper, "--entrypoint", "sleep",
                "--network", network,
                "--mount", f"type=volume,src={volumes['keys']},dst=/keys",
                "--mount", f"type=volume,src={volumes['public']},dst=/public",
                "--mount", f"type=volume,src={volumes['signer']},dst=/run/xmesh-signer",
                "--mount", f"type=volume,src={volumes['c2c']},dst=/run/xmesh-c2c",
                "--mount", f"type=volume,src={volumes['origin']},dst=/run/xmesh-origin",
                "--mount", f"type=bind,src={agent_public_path},dst=/fixture/agent-public.json,readonly",
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

            command(
                "go", "run", str(ROOT / "scripts/generate-xsp-v2-mldsa-test-certs.go"),
                "-out", str(cert_material), timeout=90,
            )
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
                "docker", "run", "--rm",
                "--mount", f"type=volume,src={volumes['certs']},dst=/certs,readonly",
                "--entrypoint", "/bin/sh", probe_image, "-ceu", "cat /certs/client-spki.sha256",
            ).stdout.strip()

            fixture = command(
                "docker", "exec",
                "-e", "XSP_V2_P0E3A_FIXTURE=1",
                "-e", f"XSP_V2_C2C_ADMIN_DATABASE_URL={admin_url}",
                "-e", "XSP_V2_C2C_KEYS_DIR=/keys",
                "-e", "XSP_V2_C2C_PUBLIC_DIR=/public",
                "-e", "XSP_V2_P0E3A_AGENT_PUBLIC_FILE=/fixture/agent-public.json",
                helper, "/build/output/xsp-v2-p0e3a-fixture",
            )
            if "P0-E3A FIXTURE: PASS" not in fixture.stdout:
                raise RuntimeError(f"P0-E3a fixture did not execute: {fixture.stdout[-2000:]}")
            public = json.loads(command("docker", "exec", helper, "cat", "/public/fixture-p0e3a.json").stdout)
            panel = json.loads(command("docker", "exec", helper, "cat", "/public/panel-pin.json").stdout)
            node_id = int(public["nodeId"])
            request_id = str(public["requestId"])

            signer_sql = (ROOT / "deploy/postgres/20-create-xsp-v2-signer-role.sql").read_text()
            c2c_sql = (ROOT / "deploy/postgres/21-create-xsp-v2-c2c-role.sql").read_text()

            def provision_security_roles() -> None:
                sql("\\set signer_password " + signer_password + "\n" + signer_sql)
                sql("\\set c2c_password " + c2c_password + "\n" + c2c_sql)

            provision_security_roles()
            if excessive_security_role_privileges("xmesh_signer_reader") or excessive_security_role_privileges("xmesh_c2c_writer"):
                raise RuntimeError("initial security role provisioning left excessive privileges")

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
            agent_public = json.loads(agent_public_path.read_text())
            if agent_public["old"]["edKeyId"] != from_ed or agent_public["old"]["pqKeyId"] != from_pq:
                raise RuntimeError("Nexus old public identity differs from real Agent vault")
            if agent_public["next"]["edKeyId"] != to_ed or agent_public["next"]["pqKeyId"] != to_pq:
                raise RuntimeError("Nexus candidate public identity differs from real Agent prepared vault")

            bundle = {
                "signedPermitB64": "".join(signed_permit_b64.splitlines()),
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

            run_agent_phase("journal-and-snapshot", network_mode="none")
            pre = durable_state(node_id, request_id)
            if pre != (from_epoch, "issued", "0", "0"):
                raise RuntimeError(f"unexpected coordinated pre-ACK state: {pre}")
            command(
                "docker", "exec", db, "pg_dump", "-U", "postgres", "-d", "xmesh", "-Fc",
                "-f", "/tmp/p0e3a-pre-ack.dump", timeout=180,
            )
            dump_size = command("docker", "exec", db, "stat", "-c", "%s", "/tmp/p0e3a-pre-ack.dump").stdout.strip()
            if not dump_size.isdigit() or int(dump_size) < 1024:
                raise RuntimeError("real PostgreSQL P0-E3a snapshot is unexpectedly small")

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

            run_agent_phase("commit-and-checkpoint", network_mode=network)
            committed = durable_state(node_id, request_id)
            if committed != (to_epoch, "ack_verified", "1", "1"):
                raise RuntimeError(f"current Agent/Nexus commit invalid: {committed}")
            receipt_sha = sql(
                f"SELECT encode(signed_receipt_sha256,'hex') FROM node_xsp_signed_commit_receipt_outbox "
                f"WHERE node_id={node_id} AND request_id='{request_id}';"
            ).stdout.strip()
            current_checkpoint = json.loads((offhost / "checkpoint-current.json").read_text())
            if current_checkpoint["checkpoint"]["commitReceiptSha256Hex"] != receipt_sha:
                raise RuntimeError("off-host checkpoint does not bind the exact PostgreSQL receipt witness")
            if current_checkpoint["checkpoint"]["keyEpoch"] != int(to_epoch):
                raise RuntimeError("off-host checkpoint does not bind current committed epoch")
            offhost_before = {
                path.name: digest_file(path)
                for path in sorted(offhost.iterdir())
                if path.is_file()
            }
            print("PASS: current real Agent + PostgreSQL state validated against generation-2 off-host checkpoint")

            stop_now(ingress)
            stop_now(origin)
            stop_now(c2c)
            stop_now(signer)
            sql(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='xmesh' AND pid<>pg_backend_pid();",
                database="postgres",
            )
            sql("DROP DATABASE xmesh WITH (FORCE); CREATE DATABASE xmesh;", database="postgres")
            command(
                "docker", "exec", db, "pg_restore", "-U", "postgres", "-d", "xmesh", "--exit-on-error",
                "/tmp/p0e3a-pre-ack.dump", timeout=180,
            )
            wait_db()
            restored_db = durable_state(node_id, request_id)
            if restored_db != pre:
                raise RuntimeError(f"PostgreSQL did not restore to coordinated pre-ACK state: {restored_db}")
            if not excessive_security_role_privileges("xmesh_signer_reader") or not excessive_security_role_privileges("xmesh_c2c_writer"):
                raise RuntimeError("coordinated restore did not reproduce expected database ACL drift")
            provision_security_roles()
            if excessive_security_role_privileges("xmesh_signer_reader") or excessive_security_role_privileges("xmesh_c2c_writer"):
                raise RuntimeError("restore re-hardening left excessive security-role privileges")
            if durable_state(node_id, request_id) != restored_db:
                raise RuntimeError("restore re-hardening mutated restored XSP-v2 security tuple")

            restore_script = r'''
import os, pathlib, shutil
root=pathlib.Path('/agent-state')
src=pathlib.Path('/snapshots/state-old')
for child in list(root.iterdir()):
    if child.is_symlink():
        raise SystemExit('symlink in Agent restore root')
    if child.is_dir(): shutil.rmtree(child)
    else: child.unlink()
for child in src.iterdir():
    target=root/child.name
    if child.is_dir(): shutil.copytree(child,target,copy_function=shutil.copy2)
    else: shutil.copy2(child,target)
'''
            command(
                "docker", "run", "--rm", "--network", "none",
                "--mount", f"type=volume,src={volumes['agent']},dst=/agent-state",
                "--mount", f"type=bind,src={snapshots},dst=/snapshots,readonly",
                "--entrypoint", "python3", tests_image, "-c", restore_script,
            )
            db_before_reject = durable_state(node_id, request_id)
            run_agent_phase("verify-rollback", network_mode="none")
            db_after_reject = durable_state(node_id, request_id)
            if db_after_reject != db_before_reject:
                raise RuntimeError("failed owner/off-host preflight mutated restored PostgreSQL security state")
            offhost_after = {
                path.name: digest_file(path)
                for path in sorted(offhost.iterdir())
                if path.is_file()
            }
            if offhost_after != offhost_before:
                raise RuntimeError("coordinated rollback verification mutated the independent off-host checkpoint domain")

            print(
                "P0-E3A COORDINATED ROLLBACK: PASS "
                f"(restored Agent+PostgreSQL epoch={from_epoch}; independent checkpoint epoch={to_epoch}, generation=2)"
            )
            print("Scope: coordinated prepared/pre-ACK snapshot rollback; fully committed older backup-set recovery remains P0-E3b")
            print("strict-pq remains OFF; production rollout remains NOT AUTHORIZED")
        finally:
            for name in reversed(containers):
                command("docker", "rm", "-f", name, check=False)
            for volume in volumes.values():
                command("docker", "volume", "rm", volume, check=False)
            command("docker", "network", "rm", network, check=False)


if __name__ == "__main__":
    main()
