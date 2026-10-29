#!/usr/bin/env python3
"""P0-E3b coordinated Agent/PostgreSQL/security-identity backup+restore proof.

This is a disposable, staging-only recovery harness. It restores the XSP-v2
PostgreSQL database, the complete real-Agent private state root, the protected
panel_response signer identity and the Node mTLS identity as one coordinated
set. An independently retained P0-E3a owner/off-host checkpoint and panel pin
are deliberately excluded from every backup archive.

The current complete set must recover. A complete, mutually consistent older
set must still fail closed against the newer off-host checkpoint. Mixed,
missing or tampered components are rejected before recovery is accepted.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
NODE_ID = 812_345_678_901
REQUEST_ID = "p0e3b-coordinated-recovery-1"
BACKUP_SCHEMA = "xsp2-coordinated-backup-manifest-1"
MIGRATIONS = [
    "0012_signed_node_metrics.sql",
    "0099_node_xsp_v2_public_state.sql",
    "0102_node_xsp_rotation_preparations.sql",
    "0103_node_xsp_cutover_permit_ledger.sql",
    "0104_node_xsp_cutover_ledger_immutability.sql",
    "0105_node_xsp_signed_commit_receipt_outbox.sql",
    "0106_node_xsp_signed_receipt_truncate_guard.sql",
]


def command(*args: str, input_text: str | None = None, check: bool = True,
            timeout: int = 300) -> subprocess.CompletedProcess[str]:
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
        combined = (result.stderr or result.stdout)[-5000:]
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {combined}")
    return result


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256(b"XSP2-P0E3B-TREE-V1\0")
    for path in sorted(root.rglob("*"), key=lambda value: value.relative_to(root).as_posix()):
        rel = path.relative_to(root).as_posix().encode()
        mode = path.lstat().st_mode & 0o7777
        digest.update(len(rel).to_bytes(4, "big"))
        digest.update(rel)
        digest.update(mode.to_bytes(4, "big"))
        if path.is_symlink():
            raise RuntimeError(f"security-state tree unexpectedly contains symlink: {path}")
        if path.is_file():
            raw = path.read_bytes()
            digest.update(len(raw).to_bytes(8, "big"))
            digest.update(raw)
        elif path.is_dir():
            digest.update((0).to_bytes(8, "big"))
        else:
            raise RuntimeError(f"security-state tree contains non-file object: {path}")
    return digest.hexdigest()


def json_output(result: subprocess.CompletedProcess[str]) -> dict[str, object]:
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"expected JSON output, got: {result.stdout[-2000:]}") from exc
    if not isinstance(value, dict):
        raise RuntimeError("expected JSON object output")
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--node-repo", required=True)
    args = parser.parse_args()
    node_repo = Path(args.node_repo).resolve()
    agent_module = node_repo / "agent/xspv2"
    if not (agent_module / "go.mod").is_file():
        raise RuntimeError("--node-repo does not contain the pinned XMesh-Node Agent module")
    if shutil.disk_usage(ROOT).free < 5 * 1024**3:
        raise RuntimeError("P0-E3b recovery E2E requires at least 5 GiB free disk")

    token = secrets.token_hex(5)
    db = f"xsp-p0e3b-{token}-db"
    toolbox = f"xsp-p0e3b-{token}-toolbox"
    admin_password = secrets.token_hex(24)
    signer_password = secrets.token_hex(24)
    c2c_password = secrets.token_hex(24)
    host_uid = os.geteuid()
    host_gid = os.getegid()

    with tempfile.TemporaryDirectory(prefix="xsp-p0e3b-", ignore_cleanup_errors=True) as tmp_raw:
        tmp = Path(tmp_raw).resolve()
        live = tmp / "live"
        agent_root = live / "agent"
        signer_root = live / "signer"
        mtls_root = live / "mtls"
        offhost = tmp / "offhost"
        old_backup = tmp / "backup-old"
        current_backup = tmp / "backup-current"
        scratch = tmp / "scratch"
        for path in [live, signer_root, mtls_root, offhost, old_backup, current_backup, scratch]:
            path.mkdir(parents=True, exist_ok=True)
        offhost.chmod(0o700)

        def work_path(path: Path) -> str:
            path = path.resolve()
            rel = path.relative_to(tmp)
            return "/work/" + rel.as_posix()

        def toolbox_run(*tool_args: str, check: bool = True, timeout: int = 300):
            return command("docker", "exec", toolbox, *tool_args, check=check, timeout=timeout)

        def agent(*agent_args: str, check: bool = True):
            return command(str(tmp / "p0e3b-agent-helper"), *agent_args, check=check, timeout=90)

        def sql(statement: str, *, database: str = "xmesh", check: bool = True):
            return command(
                "docker", "exec", "-i", db,
                "psql", "-X", "-qAt", "-U", "postgres", "-d", database,
                "-v", "ON_ERROR_STOP=1",
                input_text=statement,
                check=check,
                timeout=180,
            )

        def wait_db() -> None:
            for _ in range(240):
                logs = command("docker", "logs", "--tail", "220", db, check=False)
                combined = (logs.stdout or "") + (logs.stderr or "")
                probe = command(
                    "docker", "exec", db, "pg_isready", "-U", "postgres", "-d", "xmesh",
                    check=False, timeout=10,
                )
                # TimescaleDB init starts a temporary server, runs/tunes extensions,
                # shuts it down, then starts the final server. Do not accept the
                # temporary readiness window: require the second ready transition.
                if combined.count("database system is ready to accept connections") >= 2 and probe.returncode == 0:
                    time.sleep(0.25)
                    stable = command(
                        "docker", "exec", db, "pg_isready", "-U", "postgres", "-d", "xmesh",
                        check=False, timeout=10,
                    )
                    if stable.returncode == 0:
                        return
                time.sleep(0.25)
            logs = command("docker", "logs", "--tail", "220", db, check=False)
            raise RuntimeError(f"final PostgreSQL server did not become ready: {(logs.stdout + logs.stderr)[-5000:]}")

        def provision_roles() -> None:
            signer_sql = (ROOT / "deploy/postgres/20-create-xsp-v2-signer-role.sql").read_text()
            c2c_sql = (ROOT / "deploy/postgres/21-create-xsp-v2-c2c-role.sql").read_text()
            sql("\\set signer_password " + signer_password + "\n" + signer_sql)
            sql("\\set c2c_password " + c2c_password + "\n" + c2c_sql)
            for role in ["xmesh_signer_reader", "xmesh_c2c_writer"]:
                excessive = sql(
                    "SELECT ("
                    f"has_database_privilege('{role}','xmesh','CREATE') OR "
                    f"has_database_privilege('{role}','xmesh','TEMP') OR "
                    f"has_schema_privilege('{role}','public','CREATE')"
                    ")::text;"
                ).stdout.strip()
                if excessive not in {"f", "false"}:
                    raise RuntimeError(f"restore least-privilege hardening failed for {role}: {excessive}")

        def db_summary() -> dict[str, object]:
            row = sql(
                f"SELECT s.key_epoch||'|'||k.ed25519_key_id||'|'||k.mldsa65_key_id||'|'||"
                "COALESCE((SELECT encode(candidate_sha256,'hex') FROM node_xsp_cutover_permit_ledger "
                f"WHERE node_id={NODE_ID} ORDER BY created_at DESC LIMIT 1),'')||'|'||"
                "COALESCE((SELECT encode(permit_input_sha256,'hex') FROM node_xsp_cutover_permit_ledger "
                f"WHERE node_id={NODE_ID} ORDER BY created_at DESC LIMIT 1),'')||'|'||"
                "COALESCE((SELECT encode(applied_ack_sha256,'hex') FROM node_xsp_cutover_permit_ledger "
                f"WHERE node_id={NODE_ID} ORDER BY created_at DESC LIMIT 1),'')||'|'||"
                "COALESCE((SELECT request_id FROM node_xsp_cutover_permit_ledger "
                f"WHERE node_id={NODE_ID} ORDER BY created_at DESC LIMIT 1),'')||'|'||"
                "COALESCE((SELECT encode(signed_receipt_sha256,'hex') FROM node_xsp_signed_commit_receipt_outbox "
                f"WHERE node_id={NODE_ID} ORDER BY created_at DESC LIMIT 1),'')||'|'||"
                f"(SELECT count(*) FROM node_xsp_replay_nonces WHERE node_id={NODE_ID})::text "
                "FROM node_xsp_suite_state s JOIN node_xsp_public_keysets k "
                "ON k.node_id=s.node_id AND k.purpose='node_request' AND k.key_epoch=s.key_epoch "
                f"WHERE s.node_id={NODE_ID};"
            ).stdout.strip()
            parts = row.split("|")
            if len(parts) != 9:
                raise RuntimeError(f"unexpected DB recovery summary: {row!r}")
            return {
                "keyEpoch": int(parts[0]),
                "edKeyId": parts[1],
                "pqKeyId": parts[2],
                "candidateSha256Hex": parts[3] or None,
                "permitDigestHex": parts[4] or None,
                "ackSha256Hex": parts[5] or None,
                "requestId": parts[6] or None,
                "receiptSha256Hex": parts[7] or None,
                "replayCount": int(parts[8]),
            }

        def agent_journal_summary(root: Path) -> dict[str, object]:
            journal = root / "cutover"
            permit_path = journal / "xsp2-verified-permit.json"
            ack_path = journal / "xsp2-applied-ack.json"
            receipt_path = journal / "xsp2-verified-commit-receipt.json"
            if not permit_path.exists() and not ack_path.exists() and not receipt_path.exists():
                return {
                    "candidateSha256Hex": None,
                    "permitDigestHex": None,
                    "ackSha256Hex": None,
                    "requestId": None,
                    "receiptSha256Hex": None,
                }
            permit = json.loads(permit_path.read_text())
            ack = json.loads(ack_path.read_text())
            receipt = json.loads(receipt_path.read_text())
            signed_permit = json.loads(base64.b64decode(permit["signedPermit"], validate=True))
            return {
                "candidateSha256Hex": signed_permit["message"]["candidateSha256Hex"],
                "permitDigestHex": permit["permitDigest"],
                "ackSha256Hex": ack["envelopeSha256"],
                "requestId": ack["requestId"],
                "receiptSha256Hex": receipt["receiptEnvelopeSha256"],
            }

        def signer_identity(root: Path) -> tuple[str, str]:
            ed_der = scratch / "restored-ed.der"
            pq_der = scratch / "restored-pq.der"
            toolbox_run(
                "openssl", "pkey", "-in", work_path(root / "panel-ed25519.pem"),
                "-pubout", "-outform", "DER", "-out", work_path(ed_der),
            )
            toolbox_run(
                "openssl", "pkey", "-in", work_path(root / "panel-mldsa65.pem"),
                "-pubout", "-outform", "DER", "-out", work_path(pq_der),
            )
            toolbox_run("chown", f"{host_uid}:{host_gid}", work_path(ed_der), work_path(pq_der))
            ed_raw = ed_der.read_bytes()[-32:]
            pq_raw = pq_der.read_bytes()[-1952:]
            if len(ed_raw) != 32 or len(pq_raw) != 1952:
                raise RuntimeError("restored signer public-key DER has unexpected size")
            return (
                "ed-" + hashlib.sha256(ed_raw).digest()[:12].hex(),
                "pq-" + hashlib.sha256(pq_raw).digest()[:12].hex(),
            )

        def mtls_spki(root: Path) -> str:
            cert_digest = toolbox_run(
                "bash", "-ceu",
                f"openssl x509 -in {work_path(root / 'client.pem')} -pubkey -noout | "
                "openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1",
            ).stdout.strip()
            key_digest = toolbox_run(
                "bash", "-ceu",
                f"openssl pkey -in {work_path(root / 'client-key.pem')} -pubout -outform DER | "
                "sha256sum | cut -d' ' -f1",
            ).stdout.strip()
            if cert_digest != key_digest or len(cert_digest) != 64:
                raise RuntimeError("restored mTLS certificate/private-key identity mismatch")
            return cert_digest

        def archive_dir(source: Path, destination: Path) -> None:
            command(
                "tar", "-C", str(source.parent), "-czf", str(destination), source.name,
                timeout=120,
            )
            if destination.stat().st_size < 128:
                raise RuntimeError(f"backup archive unexpectedly small: {destination}")

        def dump_database(destination: Path) -> None:
            inside = f"/tmp/{destination.name}"
            command(
                "docker", "exec", db,
                "pg_dump", "-U", "postgres", "-d", "xmesh", "-Fc", "-f", inside,
                timeout=180,
            )
            command("docker", "cp", f"{db}:{inside}", str(destination), timeout=60)
            command("docker", "exec", db, "pg_restore", "--list", inside, timeout=60)
            if destination.stat().st_size < 1024:
                raise RuntimeError("real PostgreSQL dump is unexpectedly small")

        def make_manifest(label: str, backup: Path, agent_state: dict[str, object],
                          expected_receipt: str | None) -> Path:
            components: dict[str, dict[str, object]] = {}
            for name in ["postgres.dump", "agent.tar.gz", "signer.tar.gz", "mtls.tar.gz"]:
                path = backup / name
                components[name] = {"sha256": sha256_file(path), "size": path.stat().st_size}
            pin = json.loads((offhost / "panel-pin.json").read_text())
            manifest = {
                "schema": BACKUP_SCHEMA,
                "label": label,
                "nodeId": NODE_ID,
                "keyEpoch": int(agent_state["keyEpoch"]),
                "receiptSha256Hex": expected_receipt,
                "signerEdKeyId": pin["edKeyId"],
                "signerPQKeyId": pin["pqKeyId"],
                "mtlsSpkiSha256Hex": mtls_spki(mtls_root),
                "components": components,
            }
            path = offhost / f"{label}-backup-manifest.json"
            path.write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")))
            path.chmod(0o600)
            return path

        def snapshot(label: str, backup: Path, expected_receipt: str | None) -> Path:
            dump_database(backup / "postgres.dump")
            archive_dir(agent_root, backup / "agent.tar.gz")
            archive_dir(signer_root, backup / "signer.tar.gz")
            archive_dir(mtls_root, backup / "mtls.tar.gz")
            described = json_output(agent("describe", "--root", str(agent_root)))
            manifest = make_manifest(label, backup, described, expected_receipt)
            if any("checkpoint" in item.name for item in backup.rglob("*")):
                raise RuntimeError("off-host recovery checkpoint leaked into coordinated backup set")
            return manifest

        def verify_component_manifest(backup: Path, manifest_path: Path) -> dict[str, object]:
            manifest = json.loads(manifest_path.read_text())
            if manifest.get("schema") != BACKUP_SCHEMA or manifest.get("nodeId") != NODE_ID:
                raise RuntimeError("untrusted backup manifest identity/schema")
            components = manifest.get("components")
            if not isinstance(components, dict) or set(components) != {
                "postgres.dump", "agent.tar.gz", "signer.tar.gz", "mtls.tar.gz"
            }:
                raise RuntimeError("backup manifest must bind exactly four recovery components")
            for name, expected in components.items():
                path = backup / name
                if not path.is_file():
                    raise RuntimeError(f"missing coordinated recovery component: {name}")
                if path.stat().st_size != expected["size"] or sha256_file(path) != expected["sha256"]:
                    raise RuntimeError(f"coordinated recovery component digest mismatch: {name}")
            return manifest

        def restore_database(dump: Path) -> None:
            before_restore_roles = None
            command("docker", "cp", str(dump), f"{db}:/tmp/p0e3b-restore.dump", timeout=60)
            sql("DROP DATABASE IF EXISTS xmesh WITH (FORCE); CREATE DATABASE xmesh;", database="postgres")
            command(
                "docker", "exec", db,
                "pg_restore", "-U", "postgres", "-d", "xmesh", "--exit-on-error",
                "/tmp/p0e3b-restore.dump",
                timeout=180,
            )
            before_restore_roles = db_summary()
            provision_roles()
            after_restore_roles = db_summary()
            if before_restore_roles != after_restore_roles:
                raise RuntimeError("least-privilege DB re-hardening changed restored XSP-v2 security state")

        def restore_files(backup: Path) -> None:
            for target in [agent_root, signer_root, mtls_root]:
                shutil.rmtree(target, ignore_errors=True)
            for archive in ["agent.tar.gz", "signer.tar.gz", "mtls.tar.gz"]:
                command("tar", "-C", str(live), "-xzf", str(backup / archive), timeout=120)
            if not agent_root.is_dir() or not signer_root.is_dir() or not mtls_root.is_dir():
                raise RuntimeError("coordinated recovery archive omitted a required directory")

        def restore_set(backup: Path, manifest_path: Path, *, require_current_agent: bool) -> tuple[dict[str, object], dict[str, object]]:
            manifest = verify_component_manifest(backup, manifest_path)
            restore_files(backup)
            restore_database(backup / "postgres.dump")

            pin = json.loads((offhost / "panel-pin.json").read_text())
            ed_id, pq_id = signer_identity(signer_root)
            if ed_id != pin["edKeyId"] or pq_id != pin["pqKeyId"]:
                raise RuntimeError("restored panel signer private identity differs from independent off-host pin")
            if manifest["signerEdKeyId"] != ed_id or manifest["signerPQKeyId"] != pq_id:
                raise RuntimeError("restored signer identity differs from off-host backup manifest")
            if mtls_spki(mtls_root) != manifest["mtlsSpkiSha256Hex"]:
                raise RuntimeError("restored mTLS identity differs from off-host backup manifest")

            if require_current_agent:
                agent_state = json_output(agent(
                    "validate", "--root", str(agent_root), "--pin", str(offhost / "panel-pin.json")
                ))
            else:
                agent_state = json_output(agent("describe", "--root", str(agent_root)))
            db_state = db_summary()
            journal_state = agent_journal_summary(agent_root)
            if int(agent_state["nodeId"]) != NODE_ID or int(manifest["nodeId"]) != NODE_ID:
                raise RuntimeError("recovered Node identity mismatch")
            if int(agent_state["keyEpoch"]) != int(db_state["keyEpoch"]) or int(manifest["keyEpoch"]) != int(agent_state["keyEpoch"]):
                raise RuntimeError("Agent/PostgreSQL/manifest epoch mismatch after coordinated restore")
            if agent_state["edKeyId"] != db_state["edKeyId"] or agent_state["pqKeyId"] != db_state["pqKeyId"]:
                raise RuntimeError("Agent encrypted identity does not match restored PostgreSQL public identity")
            for key in ["candidateSha256Hex", "permitDigestHex", "ackSha256Hex", "requestId", "receiptSha256Hex"]:
                if journal_state[key] != db_state[key]:
                    raise RuntimeError(f"Agent/PostgreSQL durable evidence mismatch after restore: {key}")
            if manifest["receiptSha256Hex"] != agent_state.get("currentReceiptSha256Hex"):
                raise RuntimeError("off-host backup manifest receipt witness differs from restored Agent")
            return agent_state, db_state

        def recovery_verify(agent_state: dict[str, object], *, expect_success: bool) -> subprocess.CompletedProcess[str]:
            local_state = scratch / "local-recovery-state.json"
            local_state.write_text(json.dumps({
                "nodeId": int(agent_state["nodeId"]),
                "keyEpoch": int(agent_state["keyEpoch"]),
                "currentReceiptSha256Hex": agent_state.get("currentReceiptSha256Hex"),
            }, separators=(",", ":")))
            result = toolbox_run(
                "/work/recovery-tool", "verify",
                "--pin", work_path(offhost / "panel-pin.json"),
                "--checkpoint", work_path(offhost / "current-checkpoint.json"),
                "--local-state", work_path(local_state),
                check=False,
            )
            if expect_success:
                if result.returncode != 0 or '"status":"verified"' not in result.stdout.replace(" ", ""):
                    raise RuntimeError(f"current coordinated restore rejected: {(result.stderr + result.stdout)[-2500:]}")
            elif result.returncode == 0:
                raise RuntimeError("older coordinated restore unexpectedly satisfied current off-host recovery floor")
            return result

        def sign_template(template_path: Path, output_path: Path) -> None:
            template = json.loads(template_path.read_text())
            canonical = base64.b64decode(template["canonicalBase64"], validate=True)
            input_path = scratch / "signing-input.bin"
            ed_sig = scratch / "ed.sig"
            pq_sig = scratch / "pq.sig"
            input_path.write_bytes(canonical)
            toolbox_run(
                "openssl", "pkeyutl", "-sign", "-rawin",
                "-inkey", work_path(signer_root / "panel-ed25519.pem"),
                "-in", work_path(input_path), "-out", work_path(ed_sig),
            )
            toolbox_run(
                "openssl", "pkeyutl", "-sign", "-rawin",
                "-inkey", work_path(signer_root / "panel-mldsa65.pem"),
                "-in", work_path(input_path), "-out", work_path(pq_sig),
            )
            toolbox_run("chown", f"{host_uid}:{host_gid}", work_path(ed_sig), work_path(pq_sig))
            ed = ed_sig.read_bytes()
            pq = pq_sig.read_bytes()
            if len(ed) != 64 or len(pq) != 3309:
                raise RuntimeError(f"unexpected real dual-signature lengths: Ed={len(ed)} PQ={len(pq)}")
            output_path.write_text(json.dumps({
                "message": template["message"],
                "signatures": {
                    "ed25519": base64.b64encode(ed).decode(),
                    "mldsa65": base64.b64encode(pq).decode(),
                },
            }, separators=(",", ":")))

        try:
            # Build the exact current Node helper from the pinned Agent module.
            helper_dir = agent_module / "cmd/p0e3b-helper"
            helper_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / "scripts/xsp-v2-p0e3b-agent-helper.go", helper_dir / "main.go")
            command("go", "-C", str(agent_module), "build", "-trimpath", "-o", str(tmp / "p0e3b-agent-helper"), "./cmd/p0e3b-helper",
                    timeout=180, input_text=None, check=True)

            # OpenSSL 3.5 / Rust toolbox is isolated from the network. It holds
            # only local temporary keys and builds/runs the already-reviewed E3a verifier.
            command(
                "docker", "run", "-d", "--name", toolbox,
                "--mount", f"type=bind,src={ROOT},dst=/src,readonly",
                "--mount", f"type=bind,src={tmp},dst=/work",
                "rust:1.99-trixie", "sleep", "infinity", timeout=120,
            )
            toolbox_run("bash", "-ceu", "apt-get update >/dev/null && apt-get install -y --no-install-recommends pkg-config libssl-dev openssl ca-certificates >/dev/null", timeout=300)
            toolbox_run(
                "bash", "-ceu",
                "rm -rf /work/backend-build && cp -a /src/backend /work/backend-build && CARGO_TARGET_DIR=/work/cargo-target cargo build --manifest-path /work/backend-build/Cargo.toml "
                "--features xsp-v2-experimental --bin xsp-v2-recovery-checkpoint >/dev/null && "
                "cp /work/cargo-target/debug/xsp-v2-recovery-checkpoint /work/recovery-tool",
                timeout=900,
            )
            # Bootstrap may use the runner network only to install/build dependencies.
            # Every recovery identity/signature/checkpoint operation below runs offline.
            command("docker", "network", "disconnect", "bridge", toolbox, timeout=30)
            networks = json.loads(command("docker", "inspect", toolbox, "--format", "{{json .NetworkSettings.Networks}}").stdout)
            if networks:
                raise RuntimeError(f"P0-E3b crypto toolbox retained a network after bootstrap: {networks}")

            # Real protected panel_response Ed25519 + ML-DSA-65 identity.
            toolbox_run("openssl", "genpkey", "-algorithm", "ED25519", "-out", work_path(signer_root / "panel-ed25519.pem"))
            toolbox_run("openssl", "genpkey", "-algorithm", "ML-DSA-65", "-out", work_path(signer_root / "panel-mldsa65.pem"))
            ed_der = scratch / "panel-ed.der"
            pq_der = scratch / "panel-pq.der"
            toolbox_run("openssl", "pkey", "-in", work_path(signer_root / "panel-ed25519.pem"), "-pubout", "-outform", "DER", "-out", work_path(ed_der))
            toolbox_run("openssl", "pkey", "-in", work_path(signer_root / "panel-mldsa65.pem"), "-pubout", "-outform", "DER", "-out", work_path(pq_der))
            toolbox_run("chown", "-R", f"{host_uid}:{host_gid}", work_path(signer_root), work_path(scratch))
            ed_raw = ed_der.read_bytes()[-32:]
            pq_raw = pq_der.read_bytes()[-1952:]
            panel_pin = {
                "purpose": "panel_response",
                "issuerId": "xmesh-nexus-panel",
                "nodeId": NODE_ID,
                "edKeyId": "ed-" + hashlib.sha256(ed_raw).digest()[:12].hex(),
                "pqKeyId": "pq-" + hashlib.sha256(pq_raw).digest()[:12].hex(),
                "ed25519PublicBase64": base64.b64encode(ed_raw).decode(),
                "mldsa65PublicBase64": base64.b64encode(pq_raw).decode(),
            }
            (offhost / "panel-pin.json").write_text(json.dumps(panel_pin, separators=(",", ":")))
            (offhost / "panel-pin.json").chmod(0o600)

            # Persistent mTLS identity is a separate mandatory backup component.
            toolbox_run("bash", "-ceu", f"openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj /CN=p0e3b-ca -days 1 -keyout {work_path(mtls_root / 'ca-key.pem')} -out {work_path(mtls_root / 'ca.pem')} >/dev/null 2>&1")
            toolbox_run("bash", "-ceu", f"openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj /CN=node-{NODE_ID} -keyout {work_path(mtls_root / 'client-key.pem')} -out {work_path(mtls_root / 'client.csr')} >/dev/null 2>&1")
            toolbox_run("bash", "-ceu", f"openssl x509 -req -in {work_path(mtls_root / 'client.csr')} -CA {work_path(mtls_root / 'ca.pem')} -CAkey {work_path(mtls_root / 'ca-key.pem')} -CAcreateserial -days 1 -out {work_path(mtls_root / 'client.pem')} >/dev/null 2>&1")
            toolbox_run("rm", "-f", work_path(mtls_root / "client.csr"), work_path(mtls_root / "ca.srl"))
            toolbox_run("chown", "-R", f"{host_uid}:{host_gid}", work_path(mtls_root))
            for private_file in [signer_root / "panel-ed25519.pem", signer_root / "panel-mldsa65.pem", mtls_root / "client-key.pem", mtls_root / "ca-key.pem"]:
                private_file.chmod(0o600)

            # Real Agent epoch-1 encrypted identity and private state root.
            initial = json_output(agent("init", "--root", str(agent_root)))
            if initial["nodeId"] != NODE_ID or initial["keyEpoch"] != 1:
                raise RuntimeError(f"unexpected initial Agent identity: {initial}")

            # Real disposable PostgreSQL with production XSP-v2 schema guards.
            command(
                "docker", "run", "-d", "--name", db,
                "-e", "POSTGRES_DB=xmesh",
                "-e", f"POSTGRES_PASSWORD={admin_password}",
                "-e", "TIMESCALEDB_TELEMETRY=off",
                "-e", "TS_TUNE_MEMORY=512MB",
                "-e", "TS_TUNE_NUM_CPUS=2",
                "timescale/timescaledb:2.30.0-pg18",
                timeout=180,
            )
            wait_db()
            for migration in MIGRATIONS:
                sql((ROOT / "backend/migrations" / migration).read_text())
            try:
                provision_roles()
            except Exception as exc:
                inspect = command("docker", "inspect", db, "--format", "{{json .State}}", check=False).stdout.strip()
                logs = command("docker", "logs", "--tail", "160", db, check=False).stdout
                raise RuntimeError(f"initial PostgreSQL role provisioning failed: {exc}; state={inspect}; logs={logs[-7000:]}") from exc
            metric_key = hashlib.sha256(str(NODE_ID).encode()).hexdigest()
            sql(
                "BEGIN;"
                f"INSERT INTO node_metric_keys(node_id,public_key) VALUES({NODE_ID},'{metric_key}');"
                f"INSERT INTO node_xsp_suite_state(node_id,minimum_suite,activation_phase,key_epoch) VALUES({NODE_ID},1,'dual_enrolled',1);"
                "INSERT INTO node_xsp_public_keysets(node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public) VALUES("
                f"{NODE_ID},'node_request',1,'{initial['edKeyId']}','{initial['pqKeyId']}',"
                f"decode('{base64.b64decode(initial['edPublicBase64']).hex()}','hex'),"
                f"decode('{base64.b64decode(initial['pqPublicBase64']).hex()}','hex'));"
                "COMMIT;"
            )

            old_manifest = snapshot("old", old_backup, None)
            old_db = db_summary()
            if old_db["keyEpoch"] != 1 or old_db["receiptSha256Hex"] is not None:
                raise RuntimeError(f"old backup was not captured at epoch 1: {old_db}")

            # Prepare and cryptographically authorize the real Agent epoch-2 identity.
            prepared = json_output(agent("prepare", "--root", str(agent_root)))
            issued_ms = int(time.time() * 1000)
            permit_template = scratch / "permit-template.json"
            permit_template.write_text(agent(
                "permit-template", "--root", str(agent_root), "--pin", str(offhost / "panel-pin.json"),
                "--request-id", REQUEST_ID, "--issued-ms", str(issued_ms),
            ).stdout)
            signed_permit = scratch / "signed-permit.json"
            sign_template(permit_template, signed_permit)
            applied = json_output(agent(
                "apply", "--root", str(agent_root), "--pin", str(offhost / "panel-pin.json"),
                "--permit", str(signed_permit),
            ))
            signed_ack = scratch / "signed-ack.json"
            signed_ack.write_bytes(base64.b64decode(applied["signedAckBase64"], validate=True))
            receipt_template = scratch / "receipt-template.json"
            receipt_template.write_text(agent(
                "receipt-template", "--root", str(agent_root), "--pin", str(offhost / "panel-pin.json"),
                "--permit", str(signed_permit), "--ack", str(signed_ack),
            ).stdout)
            signed_receipt = scratch / "signed-receipt.json"
            sign_template(receipt_template, signed_receipt)
            receipt_saved = json_output(agent(
                "persist-receipt", "--root", str(agent_root), "--pin", str(offhost / "panel-pin.json"),
                "--permit", str(signed_permit), "--ack", str(signed_ack), "--receipt", str(signed_receipt),
            ))

            permit_message = json.loads(signed_permit.read_text())["message"]
            ack_message = json.loads(signed_ack.read_text())["message"]
            next_key = prepared["next"]
            candidate_digest = prepared["candidateSha256Hex"]
            permit_digest = applied["permitDigest"]
            ack_digest = applied["signedAckSha256Hex"]
            receipt_digest = receipt_saved["signedReceiptSha256Hex"]
            current_sql = (
                "BEGIN;"
                "INSERT INTO node_xsp_rotation_preparations(node_id,purpose,from_epoch,to_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public,challenge_sha256,approved_by,created_at,expires_at,proved_at) VALUES("
                f"{NODE_ID},'node_request',1,2,'{next_key['edKeyId']}','{next_key['pqKeyId']}',"
                f"decode('{base64.b64decode(next_key['edPublicBase64']).hex()}','hex'),"
                f"decode('{base64.b64decode(next_key['pqPublicBase64']).hex()}','hex'),"
                "decode(repeat('66',32),'hex'),'p0e3b-owner',NOW(),NOW()+INTERVAL '9 minutes',NOW());"
                "INSERT INTO node_xsp_cutover_permit_ledger(node_id,request_id,from_epoch,to_epoch,candidate_sha256,permit_nonce,permit_input_sha256,signed_permit,issued_at,expires_at,issued_by,state,applied_ack_sha256,signed_applied_ack,ack_verified_at) VALUES("
                f"{NODE_ID},'{REQUEST_ID}',1,2,decode('{candidate_digest}','hex'),decode('{permit_message['permitNonceHex']}','hex'),"
                f"decode('{permit_digest}','hex'),decode('{signed_permit.read_bytes().hex()}','hex'),"
                f"to_timestamp({permit_message['issuedAtMs']}/1000.0),to_timestamp({permit_message['expiresAtMs']}/1000.0),'p0e3b-owner','ack_verified',"
                f"decode('{ack_digest}','hex'),decode('{signed_ack.read_bytes().hex()}','hex'),to_timestamp({ack_message['issuedAtMs'] + 500}/1000.0));"
                "INSERT INTO node_xsp_public_keysets(node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public) VALUES("
                f"{NODE_ID},'node_request',2,'{next_key['edKeyId']}','{next_key['pqKeyId']}',"
                f"decode('{base64.b64decode(next_key['edPublicBase64']).hex()}','hex'),"
                f"decode('{base64.b64decode(next_key['pqPublicBase64']).hex()}','hex'));"
                f"UPDATE node_xsp_suite_state SET key_epoch=2 WHERE node_id={NODE_ID} AND key_epoch=1;"
                "INSERT INTO node_xsp_replay_nonces(node_id,key_epoch,direction,nonce,request_id) VALUES("
                f"{NODE_ID},2,1,decode('{ack_message['nonceHex']}','hex'),'{REQUEST_ID}');"
                "INSERT INTO node_xsp_signed_commit_receipt_outbox(node_id,request_id,from_epoch,to_epoch,permit_input_sha256,applied_ack_sha256,signed_receipt_sha256,signed_receipt) VALUES("
                f"{NODE_ID},'{REQUEST_ID}',1,2,decode('{permit_digest}','hex'),decode('{ack_digest}','hex'),"
                f"decode('{receipt_digest}','hex'),decode('{signed_receipt.read_bytes().hex()}','hex'));"
                "COMMIT;"
            )
            sql(current_sql)
            current_agent = json_output(agent(
                "validate", "--root", str(agent_root), "--pin", str(offhost / "panel-pin.json")
            ))
            current_db = db_summary()
            if current_db["keyEpoch"] != 2 or current_db["receiptSha256Hex"] != receipt_digest:
                raise RuntimeError(f"current DB not committed at epoch 2: {current_db}")

            # E3a witness is exported to a third trust domain outside every backup.
            create_checkpoint = toolbox_run(
                "/work/recovery-tool", "create",
                "--pin", work_path(offhost / "panel-pin.json"),
                "--receipt", work_path(signed_receipt),
                "--out", work_path(offhost / "current-checkpoint.json"),
            )
            if create_checkpoint.returncode != 0:
                raise RuntimeError("failed to create current owner/off-host recovery checkpoint")
            toolbox_run("chown", f"{host_uid}:{host_gid}", work_path(offhost / "current-checkpoint.json"))
            checkpoint = json.loads((offhost / "current-checkpoint.json").read_text())
            if checkpoint["minimumEpoch"] != 2 or checkpoint["receiptSha256Hex"] != receipt_digest:
                raise RuntimeError("E3a checkpoint does not bind the current committed receipt")

            current_manifest = snapshot("current", current_backup, receipt_digest)
            if offhost.is_relative_to(old_backup) or offhost.is_relative_to(current_backup):
                raise RuntimeError("off-host witness accidentally resides inside backup domain")

            # Positive: complete current set survives real dump/restore and all identity checks.
            restored_current_agent, restored_current_db = restore_set(
                current_backup, current_manifest, require_current_agent=True
            )
            recovery_verify(restored_current_agent, expect_success=True)
            if restored_current_db != current_db:
                raise RuntimeError("current restore changed authoritative PostgreSQL XSP-v2 evidence")

            # Negative: complete, mutually consistent old Agent+DB+signer+mTLS restore.
            # Local checks and the historical off-host manifest pass; only the newer
            # E3a floor proves that both local trust domains moved backward together.
            restored_old_agent, restored_old_db = restore_set(
                old_backup, old_manifest, require_current_agent=False
            )
            if restored_old_db != old_db:
                raise RuntimeError("old coordinated restore did not reproduce exact historical DB evidence")
            agent_before = tree_digest(agent_root)
            db_before = db_summary()
            rejected = recovery_verify(restored_old_agent, expect_success=False)
            combined = (rejected.stderr or "") + (rejected.stdout or "")
            if "coordinated rollback detected" not in combined:
                raise RuntimeError(f"old coordinated restore failed for the wrong reason: {combined[-2500:]}")
            if tree_digest(agent_root) != agent_before or db_summary() != db_before:
                raise RuntimeError("failed off-host recovery verification mutated restored security state")

            # Mixed-generation and tamper cases fail before any recovery acceptance.
            current_manifest_value = json.loads(current_manifest.read_text())
            old_agent_hash = sha256_file(old_backup / "agent.tar.gz")
            if old_agent_hash == current_manifest_value["components"]["agent.tar.gz"]["sha256"]:
                raise RuntimeError("old/current Agent archives unexpectedly identical")
            mixed_agent = current_backup / "mixed-old-agent.tar.gz"
            shutil.copy2(old_backup / "agent.tar.gz", mixed_agent)
            if sha256_file(mixed_agent) == current_manifest_value["components"]["agent.tar.gz"]["sha256"]:
                raise RuntimeError("mixed Agent component was not distinguishable by manifest")

            tampered_signer = current_backup / "tampered-signer.tar.gz"
            shutil.copy2(current_backup / "signer.tar.gz", tampered_signer)
            with tampered_signer.open("ab") as handle:
                handle.write(b"tamper")
            if sha256_file(tampered_signer) == current_manifest_value["components"]["signer.tar.gz"]["sha256"]:
                raise RuntimeError("tampered signer archive retained trusted manifest digest")
            missing_mtls = current_backup / "mtls.tar.gz"
            saved_mtls = current_backup / "mtls.saved"
            missing_mtls.rename(saved_mtls)
            try:
                try:
                    verify_component_manifest(current_backup, current_manifest)
                except RuntimeError as exc:
                    if "missing coordinated recovery component: mtls.tar.gz" not in str(exc):
                        raise
                else:
                    raise RuntimeError("missing mTLS recovery identity was accepted")
            finally:
                saved_mtls.rename(missing_mtls)

            # Final positive restore proves rejection did not poison recoverability.
            final_agent, final_db = restore_set(current_backup, current_manifest, require_current_agent=True)
            recovery_verify(final_agent, expect_success=True)
            if final_db != current_db:
                raise RuntimeError("final current recovery no longer reproduces committed DB state")

            print("P0-E3b COORDINATED BACKUP/RESTORE: PASS")
            print("current complete restore: PASS")
            print("old coordinated restore rejected by independent E3a floor: PASS")
            print("mixed/missing/tampered recovery components rejected: PASS")
            print("strict-pq remains OFF; production rollout remains NOT AUTHORIZED")
        finally:
            command("docker", "exec", toolbox, "chown", "-R", f"{host_uid}:{host_gid}", "/work", check=False, timeout=60)
            command("docker", "rm", "-f", toolbox, check=False, timeout=60)
            command("docker", "rm", "-f", db, check=False, timeout=60)


if __name__ == "__main__":
    main()
