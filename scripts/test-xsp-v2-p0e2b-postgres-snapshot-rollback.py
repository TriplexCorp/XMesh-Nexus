#!/usr/bin/env python3
"""P0-E2b disposable PostgreSQL snapshot rollback / current-Agent witness E2E.

This test performs a real pg_dump/pg_restore rollback of the XSP-v2 PostgreSQL
state to the exact pre-ACK point while preserving the current Node journal.
The current Agent receipt is the independent, non-rolled-back witness.

Scope is deliberately narrow: this is one-sided PostgreSQL rollback behavior,
not coordinated Node+Nexus rollback detection and not production activation.
"""
from __future__ import annotations

import argparse
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
ALIAS = "xsp-ingress-p0e2b"


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
            f"{args[0]} failed ({result.returncode}): {(result.stderr or result.stdout)[-2600:]}"
        )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--node-repo", required=True)
    args = parser.parse_args()
    node_repo = Path(args.node_repo).resolve()
    node_module = node_repo / "security/xspv2/poc-go"
    if not (node_module / "go.mod").is_file():
        raise RuntimeError("--node-repo does not contain XMesh-Node Go 1.27 PoC module")
    if shutil.disk_usage(ROOT).free < 4 * 1024**3:
        raise RuntimeError("P0-E2b E2E requires at least 4 GiB free disk")

    token = secrets.token_hex(5)
    prefix = f"xsp-p0e2b-{token}"
    network = prefix + "-net"
    db = prefix + "-db"
    helper = prefix + "-helper"
    signer = prefix + "-signer"
    c2c = prefix + "-c2c"
    origin = prefix + "-origin"
    ingress = prefix + "-ingress"
    signer_image = f"xmesh-signer:p0e2b-{token}"
    c2c_image = f"xmesh-c2c:p0e2b-{token}"
    tests_image = f"xmesh-c2c-tests:p0e2b-{token}"
    origin_image = f"xmesh-origin-p0e2b:{token}"
    ingress_image = f"xmesh-ingress-p0e2b:{token}"
    probe_image = f"xmesh-ingress-probe-p0e2b:{token}"
    volumes = {
        name: f"{prefix}-{name}"
        for name in ["db", "keys", "public", "signer", "c2c", "origin", "certs", "journal"]
    }
    containers: list[str] = []

    with tempfile.TemporaryDirectory(prefix="xsp-p0e2b-") as tmp:
        temp = Path(tmp)
        cert_material = temp / "client-material"
        cert_material.mkdir()
        bundle_path = temp / "node-bundle.json"
        node_runtime = temp / "node-poc"
        shutil.copytree(node_module, node_runtime)
        for source, destination in [
            ("xsp-v2-c2d-node-client_test.go", "cutover/c2d_e2e_test.go"),
            ("xsp-v2-c2d-race_test.go", "cutover/c2d_race_test.go"),
            ("xsp-v2-p0e2b-db-rollback_test.go", "cutover/p0e2b_db_rollback_test.go"),
        ]:
            shutil.copy2(ROOT / "scripts" / source, node_runtime / destination)

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
                if command(
                    "docker", "exec", db, "pg_isready", "-U", "postgres", "-d", "xmesh", check=False
                ).returncode == 0:
                    return
                time.sleep(0.25)
            logs = command("docker", "logs", "--tail", "100", db, check=False)
            raise RuntimeError(f"PostgreSQL not ready: {(logs.stdout + logs.stderr)[-2200:]}")

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

        def run_node(test_name: str) -> str:
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
                "/src/p0e2b.test", "-test.run", f"^{test_name}$", "-test.count=1", "-test.v",
                check=False,
                timeout=180,
            )
            combined = (result.stdout or "") + (result.stderr or "")
            if result.returncode != 0 or f"--- PASS: {test_name}" not in combined:
                raise RuntimeError(f"{test_name} failed: {combined[-3200:]}")
            return combined

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

        try:
            command("docker", "network", "create", "--internal", network)
            for volume in volumes.values():
                command("docker", "volume", "create", volume)
            command("docker", "pull", "golang:1.27.3-trixie", timeout=600)

            # All expensive compilation/image work happens BEFORE the short-lived
            # ACK fixture is created so snapshot/restore, not setup time, consumes
            # the freshness window.
            command(
                "docker", "run", "--rm",
                "--mount", f"type=bind,src={node_runtime},dst=/src",
                "--workdir", "/src",
                "golang:1.27.3-trixie",
                "go", "test", "-c", "./cutover", "-o", "/src/p0e2b.test",
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
                [
                    "--network", network, "--env-file", db_env,
                    "--mount", f"type=volume,src={volumes['db']},dst=/var/lib/postgresql",
                ],
            )
            wait_db()
            command(
                "docker", "run", "-d", "--name", helper, "--entrypoint", "sleep",
                "--network", network,
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

            # Create the real short-lived permit/ACK only after all expensive setup.
            fixture = command(
                "docker", "exec", "-e", "XSP_V2_C2C_FIXTURE=1",
                "-e", f"XSP_V2_C2C_ADMIN_DATABASE_URL={admin_url}",
                "-e", "XSP_V2_C2C_KEYS_DIR=/keys",
                "-e", "XSP_V2_C2C_PUBLIC_DIR=/public",
                helper, "/build/output/xsp-v2-c2c-fixture", "--exact",
                "prepare_uncommitted_c2c_fixture", "--ignored", "--nocapture",
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

            def provision_security_roles() -> None:
                sql("\\set signer_password " + signer_password + "\n" + signer_sql)
                sql("\\set c2c_password " + c2c_password + "\n" + c2c_sql)

            provision_security_roles()
            if excessive_security_role_privileges("xmesh_signer_reader"):
                raise RuntimeError("initial signer role provisioning left excessive effective privileges")
            if excessive_security_role_privileges("xmesh_c2c_writer"):
                raise RuntimeError("initial C2-C role provisioning left excessive database/schema privileges")

            permit_row = sql(
                f"SELECT from_epoch||'|'||to_epoch||'|'||encode(candidate_sha256,'hex')||'|'||encode(signed_permit,'base64') "
                f"FROM node_xsp_cutover_permit_ledger WHERE node_id={node_id} AND request_id='{request_id}';"
            ).stdout.strip()
            from_epoch, to_epoch, candidate_hex, signed_permit_b64 = permit_row.split("|", 3)
            from_ed, from_pq = sql(
                f"SELECT ed25519_key_id||'|'||mldsa65_key_id FROM node_xsp_public_keysets "
                f"WHERE node_id={node_id} AND key_epoch={from_epoch};"
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

            pre = durable_state(node_id, request_id)
            if pre != (from_epoch, "issued", "0", "0"):
                raise RuntimeError(f"unexpected pre-snapshot state: {pre}")

            # REAL database snapshot: not SQL row rewriting. This dump captures
            # the exact issued/pre-ACK PostgreSQL rows and object ACLs. Database-
            # level privileges belong to the database object itself and therefore
            # must be explicitly re-hardened after DROP/CREATE + pg_restore.
            command(
                "docker", "exec", db,
                "pg_dump", "-U", "postgres", "-d", "xmesh", "-Fc",
                "-f", "/tmp/p0e2b-pre-ack.dump",
                timeout=180,
            )
            dump_size = command(
                "docker", "exec", db, "stat", "-c", "%s", "/tmp/p0e2b-pre-ack.dump"
            ).stdout.strip()
            if not dump_size.isdigit() or int(dump_size) < 1024:
                raise RuntimeError(f"real PostgreSQL snapshot is unexpectedly small: {dump_size}")

            boot_signer(public)
            boot_c2c()
            boot_origin(expected_spki, node_id)
            launch(
                ingress,
                ingress_image,
                [
                    "--network", network, "--network-alias", ALIAS,
                    "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m,mode=1777",
                    "--cap-drop=ALL", "--security-opt=no-new-privileges",
                    "--mount", f"type=volume,src={volumes['certs']},dst=/run/xmesh-ingress-certs,readonly",
                    "--mount", f"type=volume,src={volumes['origin']},dst=/run/xmesh-origin",
                ],
            )
            time.sleep(1)

            run_node("TestC2DFullExchange")
            committed = durable_state(node_id, request_id)
            if committed != (to_epoch, "ack_verified", "1", "1"):
                raise RuntimeError(f"initial authoritative commit invalid: {committed}")
            first_receipt_sha = sql(
                f"SELECT encode(signed_receipt_sha256,'hex') FROM node_xsp_signed_commit_receipt_outbox "
                f"WHERE node_id={node_id} AND request_id='{request_id}';"
            ).stdout.strip()
            if len(first_receipt_sha) != 64:
                raise RuntimeError("initial authoritative receipt digest missing")
            print("PASS: current Agent persisted first authoritative receipt before DB rollback")

            # Roll back ONLY PostgreSQL. The Node journal volume is intentionally
            # untouched and therefore becomes the independent current witness.
            stop_now(origin)
            stop_now(c2c)
            stop_now(signer)
            sql(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname='xmesh' AND pid<>pg_backend_pid();",
                database="postgres",
            )
            sql("DROP DATABASE xmesh WITH (FORCE); CREATE DATABASE xmesh;", database="postgres")
            command(
                "docker", "exec", db,
                "pg_restore", "-U", "postgres", "-d", "xmesh", "--exit-on-error",
                "/tmp/p0e2b-pre-ack.dump",
                timeout=180,
            )
            wait_db()
            restored = durable_state(node_id, request_id)
            if restored != (from_epoch, "issued", "0", "0"):
                raise RuntimeError(f"pg_restore did not return to exact pre-ACK state: {restored}")
            print("PASS: real pg_dump/pg_restore returned PostgreSQL to exact pre-ACK security state")

            # A recreated PostgreSQL database receives default database-level
            # privileges; a per-database pg_dump cannot encode those CREATE/TEMP
            # ACLs. The signer previously exposed this by refusing to start with
            # "excessive effective object privileges". The restore procedure must
            # re-apply the reviewed idempotent least-privilege provisioning before
            # any security sidecar is restarted. Never weaken the signer self-check.
            drifted_signer = excessive_security_role_privileges("xmesh_signer_reader")
            drifted_c2c = excessive_security_role_privileges("xmesh_c2c_writer")
            if not drifted_signer or not drifted_c2c:
                raise RuntimeError(
                    "expected recreated database-level privilege drift was not observed for both security roles"
                )
            print("PASS: restore reproduced database-level ACL drift that security sidecars must not accept")

            provision_security_roles()
            if excessive_security_role_privileges("xmesh_signer_reader"):
                raise RuntimeError("restore re-hardening left excessive signer privileges")
            if excessive_security_role_privileges("xmesh_c2c_writer"):
                raise RuntimeError("restore re-hardening left excessive C2-C database/schema privileges")
            rehardened = durable_state(node_id, request_id)
            if rehardened != restored:
                raise RuntimeError(
                    f"least-privilege restore hardening mutated security state: before={restored} after={rehardened}"
                )
            print("PASS: restore re-hardening removed ACL drift without mutating XSP-v2 security state")

            if int(time.time() * 1000) + 5000 >= ack_expires_ms:
                raise RuntimeError(
                    "ACK freshness window exhausted before rollback retry; test refuses to substitute historical recovery"
                )

            boot_signer(public)
            boot_c2c()
            boot_origin(expected_spki, node_id)
            output = run_node("TestP0E2BPostgresSnapshotRollbackCurrentAgentWitness")
            if "current Agent" not in output and "restored control plane" not in output:
                raise RuntimeError("current-Agent rollback witness test did not emit its convergence result")

            recommitted = durable_state(node_id, request_id)
            if recommitted != (to_epoch, "ack_verified", "1", "1"):
                raise RuntimeError(f"restored DB did not reach one bounded re-commit: {recommitted}")
            second_receipt_sha = sql(
                f"SELECT encode(signed_receipt_sha256,'hex') FROM node_xsp_signed_commit_receipt_outbox "
                f"WHERE node_id={node_id} AND request_id='{request_id}';"
            ).stdout.strip()
            if len(second_receipt_sha) != 64:
                raise RuntimeError("restored DB receipt digest missing")

            print(
                "P0-E2B POSTGRES SNAPSHOT ROLLBACK: PASS "
                f"(firstReceipt={first_receipt_sha[:16]}..., restoredReceipt={second_receipt_sha[:16]}...; "
                "Agent authoritative receipt journal remained immutable)"
            )
            print("Scope: one-sided PostgreSQL rollback only; coordinated Node+Nexus rollback remains unproven")
        finally:
            for name in reversed(containers):
                command("docker", "rm", "-f", name, check=False)
            for volume in volumes.values():
                command("docker", "volume", "rm", volume, check=False)
            command("docker", "network", "rm", network, check=False)


if __name__ == "__main__":
    main()
