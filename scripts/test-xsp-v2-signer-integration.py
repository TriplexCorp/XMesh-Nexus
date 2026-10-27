#!/usr/bin/env python3
"""Disposable real signer image/socket/ACL E2E. Never connects to an existing DB.

Requires Docker and builds the actual signer Dockerfile. All names are random,
all keys/credentials are throwaway, and cleanup touches only this run's objects.
No public HTTP endpoint or production activation is involved.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
TEST_PREFIX = "xsp_v2_signed_cutover::signed_tests::signer_e2e::"


def command(*args, input_text=None, check=True):
    result = subprocess.run(args, input=input_text, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False)
    if check and result.returncode:
        # Do not print arguments, env files, SQL input, raw requests or keys.
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {result.stderr[-1800:]}")
    return result


def main():
    if not __debug__:
        raise RuntimeError("E2E assertions must not be disabled with Python optimization")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-build", action="store_true", help="Use previously built E2E images")
    parser.add_argument("--builder-image", help="Optional trusted local Rust/OpenSSL builder for constrained vfs workers")
    parser.add_argument("--proxy-ca", help="Combined CA bundle mounted as BuildKit secret; TLS verification stays enabled")
    parser.add_argument("--test-binary", help="Optional freshly compiled test executable for local iteration; real signer image is unchanged")
    args = parser.parse_args()
    runner_mount = []
    if args.test_binary:
        executable = Path(args.test_binary).resolve(strict=True)
        if not os.access(executable, os.X_OK):
            raise RuntimeError("test binary must be executable")
        runner_mount = ["--mount", f"type=bind,src={executable},dst=/build/output/signer-e2e-tests,readonly"]
    image, tests = "xmesh-signer:e2e", "xmesh-signer-tests:e2e"
    if not args.skip_build:
        build = ["docker", "build", "-f", str(ROOT / "backend/Dockerfile.xsp-signer"),
                 "--build-arg", "SIGNER_BUILD_PROFILE=dev", "--build-arg", "SIGNER_BUILD_TESTS=1"]
        if args.builder_image:
            build += ["--build-arg", "SIGNER_BUILDER_IMAGE=" + args.builder_image]
        if args.proxy_ca:
            build += ["--secret", "id=proxy_ca,src=" + str(Path(args.proxy_ca).resolve())]
        for target, tag in [("runtime", image), ("signer-tests", tests)]:
            result = subprocess.run(build + ["--target", target, "-t", tag, str(ROOT)], check=False)
            if result.returncode:
                raise RuntimeError("signer image build failed")
    if shutil.disk_usage(ROOT).free < 3 * 1024**3:
        raise RuntimeError("Signer images built, but less than 3 GiB free for disposable containers; free build cache and rerun --skip-build")
    def interrupted(signum, _frame):
        raise InterruptedError(f"Integration interrupted by signal {signum}")
    signal.signal(signal.SIGTERM, interrupted)
    prefix = "xsp-signer-e2e-" + secrets.token_hex(5)
    print("Disposable run:", prefix)
    network = prefix + "-net"
    db, signer, helper, api = (prefix + suffix for suffix in ["-db", "-signer", "-fixture", "-api"])
    volumes = {key: prefix + "-" + key for key in ["keys", "public", "socket", "database"]}
    containers = []
    with tempfile.TemporaryDirectory(prefix="xsp-signer-e2e-") as temporary:
        temp = Path(temporary)

        def envfile(name, values):
            path = temp / name
            path.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
            path.chmod(0o600)
            return str(path)

        password, app_password, signer_password = (secrets.token_hex(24) for _ in range(3))
        common = {"XSP_V2_SIGNER_E2E": "1", "XSP_V2_E2E_PUBLIC": "/public",
                  "XSP_V2_SIGNER_SOCKET_PATH": "/run/xmesh-signer/signer.sock"}
        admin_env = envfile("admin", {**common, "XSP_V2_E2E_KEYS": "/keys",
            "XSP_V2_TEST_DATABASE_URL": f"postgresql://postgres:{password}@{db}:5432/xmesh"})
        app_env = envfile("api", {**common,
            "XSP_V2_TEST_DATABASE_URL": f"postgresql://xmesh_app:{app_password}@{db}:5432/xmesh"})
        db_env = envfile("db", {"POSTGRES_DB": "xmesh", "POSTGRES_PASSWORD": password,
            "TIMESCALEDB_TELEMETRY": "off", "TS_TUNE_MEMORY": "512MB", "TS_TUNE_NUM_CPUS": "2"})

        def sql(statement, success=True):
            return command("docker", "exec", "-i", db, "psql", "-X", "-qAt", "-U", "postgres",
                           "-d", "xmesh", "-v", "ON_ERROR_STOP=1", input_text=statement, check=success)

        def launch(name, image_name, extra, entrypoint=None):
            cmd = ["docker", "run", "-d", "--name", name, "--network", network]
            if entrypoint:
                cmd += ["--entrypoint", entrypoint]
            if entrypoint == "sleep":
                cmd += ["--no-healthcheck"]
            command(*(cmd + extra + [image_name] + (["infinity"] if entrypoint == "sleep" else [])))
            containers.append(name)

        def probe(code, user="10001:10001", success=True):
            return command("docker", "exec", "-i", "--user", user, api, "python3", "-",
                           input_text=code, check=success)

        def root_python(code):
            return command("docker", "exec", "-i", helper, "python3", "-", input_text=code)

        def api_test(name):
            result = command("docker", "exec", api, "/build/output/signer-e2e-tests",
                             "--exact", TEST_PREFIX + name, "--ignored", "--nocapture")
            if "1 passed; 0 failed" not in result.stdout:
                raise RuntimeError("required signer API test did not execute")
            print(result.stdout)

        try:
            command("docker", "network", "create", network)
            for volume in volumes.values():
                command("docker", "volume", "create", volume)
            launch(db, "timescale/timescaledb:2.30.0-pg18", ["--env-file", db_env,
                "--mount", f"type=volume,src={volumes['database']},dst=/var/lib/postgresql"])
            for _ in range(60):
                if command("docker", "exec", db, "pg_isready", "-U", "postgres", "-d", "xmesh", check=False).returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError("disposable PostgreSQL readiness deadline exceeded")
            launch(helper, tests, runner_mount + ["--env-file", admin_env,
                "--mount", f"type=volume,src={volumes['keys']},dst=/keys",
                "--mount", f"type=volume,src={volumes['public']},dst=/public",
                "--mount", f"type=volume,src={volumes['socket']},dst=/socket"], "sleep")
            root_python("import os\nos.chown('/keys',0,10001);os.chmod('/keys',0o750)\nos.chown('/socket',10002,10001);os.chmod('/socket',0o750)\nos.chmod('/public',0o755)\n")
            result = command("docker", "exec", helper, "/build/output/signer-e2e-tests", "--exact",
                TEST_PREFIX + "prepare_signer_e2e_fixture", "--ignored", "--nocapture")
            assert "1 passed; 0 failed" in result.stdout, "fixture test did not run"
            print("PASS: actual migrations and dual-signed committed ACK fixture")
            sql("\\set app_password " + app_password + "\nCREATE ROLE xmesh_app LOGIN PASSWORD :'app_password';\n"
                "GRANT USAGE ON SCHEMA public TO xmesh_app; GRANT ALL ON ALL TABLES IN SCHEMA public TO xmesh_app;\n")
            provisioning = (ROOT / "deploy/postgres/20-create-xsp-v2-signer-role.sql").read_text()
            sql("\\set signer_password " + signer_password + "\n" + provisioning)
            sql("GRANT SELECT(public_key) ON node_metric_keys TO xmesh_signer_reader; GRANT xmesh_app TO xmesh_signer_reader;")
            sql("\\set signer_password " + signer_password + "\n" + provisioning)
            print("PASS: real signer SQL provisioning is repeatable")
            public = json.loads(command("docker", "exec", helper, "cat", "/public/fixture.json").stdout)
            signer_values = {"XSP_V2_SIGNER_DATABASE_URL": f"postgresql://xmesh_signer_reader:{signer_password}@{db}:5432/xmesh",
                "XSP_V2_SIGNER_EXPECTED_ED_KEY_ID": public["edId"], "XSP_V2_SIGNER_EXPECTED_PQ_KEY_ID": public["pqId"],
                "XSP_V2_SIGNER_ISSUER_ID": public["issuer"], "RUST_LOG": "warn"}
            signer_env = envfile("signer", signer_values)
            launch(api, tests, runner_mount + ["--user", "10001:10001", "--env-file", app_env,
                "--mount", f"type=volume,src={volumes['public']},dst=/public,readonly",
                "--mount", f"type=volume,src={volumes['socket']},dst=/run/xmesh-signer,volume-nocopy",
                "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges"], "sleep")
            api_mounts = json.loads(command("docker", "inspect", "-f", "{{json .Mounts}}", api).stdout)
            assert all(mount.get("Name") != volumes["keys"] and mount["Destination"] != "/run/xmesh-signer-keys" for mount in api_mounts), "API must never mount signer keys"
            # SQL ACL checks explicitly turn off the convenience read-only GUC.
            for statement in ["CREATE TABLE public.forbidden(i int)", "CREATE TEMP TABLE forbidden(i int)",
                "UPDATE node_xsp_suite_state SET key_epoch=key_epoch", "DELETE FROM node_xsp_replay_nonces",
                "SELECT * FROM node_metric_keys", "TRUNCATE node_xsp_signed_commit_receipt_outbox"]:
                result = sql("SET ROLE xmesh_signer_reader; SET default_transaction_read_only=off; " + statement + ";", success=False)
                assert result.returncode != 0 and "permission denied" in result.stderr, "effective signer ACL failed"
            print("PASS: effective ACL rejects writes, DDL, TEMP, unrelated reads and TRUNCATE even with read-only GUC off")
            # Start the real runtime image, with exactly the production UID and key mounts.
            def boot(environment=signer_env, failure=False):
                command("docker", "rm", "-f", signer, check=False)
                cmd = ["docker", "run", "-d", "--name", signer, "--network", network, "--env-file", environment,
                    "--mount", f"type=volume,src={volumes['keys']},dst=/run/xmesh-signer-keys,readonly",
                    "--mount", f"type=volume,src={volumes['socket']},dst=/run/xmesh-signer,volume-nocopy",
                    "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", image, "--xsp-v2-signer"]
                command(*cmd)
                if signer not in containers:
                    containers.append(signer)
                for _ in range(50):
                    running = command("docker", "inspect", "-f", "{{.State.Running}}", signer).stdout.strip() == "true"
                    if not running:
                        if not failure:
                            logs = command("docker", "logs", "--tail", "25", signer).stderr
                            for secret in [password, app_password, signer_password]:
                                logs = logs.replace(secret, "[REDACTED]")
                            raise RuntimeError("signer unexpectedly exited during startup: " + logs)

                        logs = command("docker", "logs", "--tail", "25", signer).stderr
                        expected = ("owner-approved", "excessive effective object privileges", "must not inherit", "signer key", "socket directory", "privileged attributes", "default to read-only", "must be xmesh_signer_reader")
                        assert any(message in logs for message in expected), "startup failed for an unexpected reason"
                        return
                    if not failure and probe("import socket\ns=socket.socket(socket.AF_UNIX);s.settimeout(1);s.connect('/run/xmesh-signer/signer.sock');s.close()\n", success=False).returncode == 0:
                        return
                    time.sleep(.2)
                logs = command("docker", "logs", "--tail", "25", signer).stderr
                probe_error = probe("import socket\ns=socket.socket(socket.AF_UNIX);s.settimeout(1);s.connect('/run/xmesh-signer/signer.sock');s.close()\n", success=False).stderr
                for secret in [password, app_password, signer_password]:
                    logs = logs.replace(secret, "[REDACTED]")
                raise RuntimeError("signer startup deadline: " + logs + probe_error)
            for changes in [{"XSP_V2_SIGNER_EXPECTED_ED_KEY_ID": "unapproved"},
                            {"XSP_V2_SIGNER_EXPECTED_PQ_KEY_ID": "unapproved"}]:
                boot(envfile("bad-pins", {**signer_values, **changes}), failure=True)
            for grant, revoke in [("GRANT UPDATE ON node_xsp_suite_state TO xmesh_signer_reader", "REVOKE UPDATE ON node_xsp_suite_state FROM xmesh_signer_reader"),
                                  ("GRANT TEMP ON DATABASE xmesh TO PUBLIC", "REVOKE TEMP ON DATABASE xmesh FROM PUBLIC"),
                                  ("GRANT SELECT ON node_metric_keys TO PUBLIC", "REVOKE SELECT ON node_metric_keys FROM PUBLIC"),
                                  ("GRANT SELECT(public_key) ON node_metric_keys TO xmesh_signer_reader", "REVOKE SELECT(public_key) ON node_metric_keys FROM xmesh_signer_reader"),
                                  ("GRANT UPDATE(key_epoch) ON node_xsp_suite_state TO xmesh_signer_reader", "REVOKE UPDATE(key_epoch) ON node_xsp_suite_state FROM xmesh_signer_reader"),
                                  ("ALTER ROLE xmesh_signer_reader SUPERUSER", "ALTER ROLE xmesh_signer_reader NOSUPERUSER"),
                                  ("ALTER ROLE xmesh_signer_reader SET default_transaction_read_only=off", "ALTER ROLE xmesh_signer_reader SET default_transaction_read_only=on"),
                                  ("GRANT xmesh_app TO xmesh_signer_reader", "REVOKE xmesh_app FROM xmesh_signer_reader")]:
                sql(grant + ";");boot(failure=True);sql(revoke + ";")
            print("PASS: bad pins, excessive grants, PUBLIC TEMP and role membership reject signer startup")
            root_python("import os\nos.chmod('/keys/panel-ed25519.pem',0o444)\n")
            boot(failure=True)
            root_python("import os\nos.chmod('/keys/panel-ed25519.pem',0o440)\n")
            for setup, restore in [
                ("os.rename('/keys/panel-ed25519.pem','/keys/saved.pem')", "os.rename('/keys/saved.pem','/keys/panel-ed25519.pem')"),
                ("os.rename('/keys/panel-ed25519.pem','/keys/saved.pem');os.symlink('/keys/saved.pem','/keys/panel-ed25519.pem')", "os.unlink('/keys/panel-ed25519.pem');os.rename('/keys/saved.pem','/keys/panel-ed25519.pem')"),
                ("os.link('/keys/panel-ed25519.pem','/keys/hardlink.pem')", "os.unlink('/keys/hardlink.pem')"),
                ("os.chown('/keys/panel-ed25519.pem',10001,10001)", "os.chown('/keys/panel-ed25519.pem',0,10001)"),
                ("os.chmod('/socket',0o770)", "os.chmod('/socket',0o750)"),
            ]:
                print("Checking filesystem negative case:", setup.split("(")[0])
                root_python("import os\n" + setup + "\n")
                boot(failure=True)
                root_python("import os\n" + restore + "\n")
            boot()
            links = command("docker", "exec", signer, "sh", "-c", 'for fd in /proc/1/fd/*; do readlink "$fd" || true; done').stdout.splitlines()
            owned_sockets = {link[8:-1] for link in links if link.startswith("socket:[")}
            tcp = command("docker", "exec", signer, "cat", "/proc/net/tcp", "/proc/net/tcp6").stdout.splitlines()
            listeners = {line.split()[9] for line in tcp if len(line.split()) > 9 and line.split()[3] == "0A"}
            assert not owned_sockets.intersection(listeners), "signer must never listen on TCP"
            print("PASS: key permissions fail closed; real signer has no TCP listener")
            wire = """import socket,json,base64
p=json.load(open('/public/fixture.json'))
r={'protocol':'XSP/2','action':'sign-committed-receipt','nodeId':p['nodeId'],'requestId':p['requestId'],'signedAckB64':p['ack']}
def exchange(raw):
 s=socket.socket(socket.AF_UNIX);s.settimeout(7);s.connect('/run/xmesh-signer/signer.sock');s.sendall(raw);s.shutdown(socket.SHUT_WR);out=b''
 try:
  while True:
   part=s.recv(4096)
   if not part:break
   out+=part
 except (ConnectionResetError,BrokenPipeError):pass
 finally:s.close()
 return out
"""
            probe(wire + """
for bad in [b'{',json.dumps(dict(r,unknown=True)).encode(),b'x'*32769]:
 out=exchange(bad);assert not out or not json.loads(out).get('ok')
for bad in [dict(r,nodeId=0),dict(r,requestId='wrong'),dict(r,signedAckB64='Zh=='),dict(r,signedAckB64=base64.b64encode(base64.b64decode(p['ack'])+b' ').decode())]:
 assert not json.loads(exchange(json.dumps(bad).encode()))['ok']
for algorithm in ['ed25519','mldsa65']:
 bad=json.loads(base64.b64decode(p['ack']));bad['signatures'][algorithm]=''
 forged=dict(r,signedAckB64=base64.b64encode(json.dumps(bad,separators=(',',':')).encode()).decode())
 assert not json.loads(exchange(json.dumps(forged).encode()))['ok']
# Slow/incomplete request must not occupy the sequential signer indefinitely.
s=socket.socket(socket.AF_UNIX);s.settimeout(5);s.connect('/run/xmesh-signer/signer.sock');s.sendall(b'{');assert s.recv(1)==b'';s.close()
# Lost response before persistence: a raw signature is NOT a durable receipt.
one=json.loads(exchange(json.dumps(r).encode()));assert one['ok']
""")
            command("docker", "pause", db)
            try:
                probe(wire + "assert not json.loads(exchange(json.dumps(r).encode()))['ok']\n")
            finally:
                command("docker", "unpause", db)
            print("PASS: bounded DB deadline rejects stalled PostgreSQL")
            assert sql("SELECT count(*) FROM node_xsp_signed_commit_receipt_outbox;").stdout.strip() == "0", "raw signer response must not persist a receipt"
            # Wrong kernel peer must never receive a signature, regardless of JSON.
            probe(wire + "out=exchange(json.dumps(r).encode());assert not out\n", user="10003:10001")
            command("docker", "kill", signer)
            boot()  # stale socket after SIGKILL is safely recovered
            print("PASS: malformed/oversized/noncanonical/wrong ACK and peer rejection; lost pre-insert response and SIGKILL restart")
            # A forged local signer must be rejected before ACK bytes leave API.
            root_python("import os\nos.mkdir('/socket/fake');os.chown('/socket/fake',10003,10001);os.chmod('/socket/fake',0o750)\n")
            fake = "import socket,os;s=socket.socket(socket.AF_UNIX);s.bind('/socket/fake/signer.sock');os.chmod('/socket/fake/signer.sock',0o660);s.listen();c,_=s.accept();data=c.recv(32768);open('/socket/fake/received','wb').write(data);c.close();s.close()"
            command("docker", "exec", "-d", "--user", "10003:10001", helper, "python3", "-c", fake)
            for _ in range(30):
                if command("docker", "exec", helper, "test", "-S", "/socket/fake/signer.sock", check=False).returncode == 0:
                    break
                time.sleep(.1)
            result = command("docker", "exec", "-e", "XSP_V2_SIGNER_SOCKET_PATH=/run/xmesh-signer/fake/signer.sock", api,
                "/build/output/signer-e2e-tests", "--exact", TEST_PREFIX + "api_recovery_must_fail_closed", "--ignored", "--nocapture")
            assert "1 passed; 0 failed" in result.stdout
            for _ in range(30):
                if command("docker", "exec", helper, "test", "-f", "/socket/fake/received", check=False).returncode == 0:
                    break
                time.sleep(.1)
            root_python("assert open('/socket/fake/received','rb').read()==b''\n")
            print("PASS: API rejects fake signer credentials before sending ACK bytes")
            api_test("api_socket_round_trip_and_concurrent_retry")
            probe(wire + "assert not json.loads(exchange(json.dumps(r).encode()))['ok']\n")
            command("docker", "stop", signer)
            api_test("api_socket_round_trip_and_concurrent_retry")
            print("PASS: stored receipt recovery works while real signer is stopped")
            original = sql("SELECT encode(signed_receipt,'hex') FROM node_xsp_signed_commit_receipt_outbox;").stdout.strip()
            sql("ALTER TABLE node_xsp_signed_commit_receipt_outbox DISABLE TRIGGER USER; UPDATE node_xsp_signed_commit_receipt_outbox SET signed_receipt=convert_to('corrupt','UTF8'); ALTER TABLE node_xsp_signed_commit_receipt_outbox ENABLE TRIGGER USER;")
            api_test("api_recovery_must_fail_closed")
            sql("ALTER TABLE node_xsp_signed_commit_receipt_outbox DISABLE TRIGGER USER; UPDATE node_xsp_signed_commit_receipt_outbox SET signed_receipt=decode('" + original + "','hex'); ALTER TABLE node_xsp_signed_commit_receipt_outbox ENABLE TRIGGER USER;")
            sql("UPDATE node_xsp_suite_state SET key_epoch=3;")
            api_test("api_recovery_must_fail_closed")
            print("PASS: corrupt durable receipt and changed epoch cannot fall back to signing")
            logs = command("docker", "logs", signer)
            combined = logs.stdout + logs.stderr
            for value in [password, app_password, signer_password, public["ack"], "BEGIN PRIVATE KEY"]:
                assert value not in combined, "signer leaked sensitive material in logs"
            print("PASS: signer logs contain no test credentials, ACK bodies or PEM material")
            # A second independently committed ACK exercises the precise
            # signer-readback -> concurrent epoch commit -> receipt-insert race.
            prepared = command("docker", "exec", "-e", "XSP_V2_E2E_NODE=912345678980", helper,
                "/build/output/signer-e2e-tests", "--exact", TEST_PREFIX + "prepare_signer_e2e_fixture", "--ignored", "--nocapture")
            assert "1 passed; 0 failed" in prepared.stdout
            race_public = json.loads(command("docker", "exec", helper, "cat", "/public/fixture.json").stdout)
            boot(envfile("race-signer", {**signer_values,
                "XSP_V2_SIGNER_EXPECTED_ED_KEY_ID": race_public["edId"],
                "XSP_V2_SIGNER_EXPECTED_PQ_KEY_ID": race_public["pqId"]}))
            api_test("api_epoch_race_must_not_persist")
            print("PASS: epoch change after actual signing prevents receipt INSERT")
            # Existing legacy fixtures use a fixed unique public key: isolate
            # their DB as well instead of weakening either fixture's constraints.
            command("docker", "exec", db, "createdb", "-U", "postgres", "xmesh_regression")
            regression_env = envfile("regression", {
                "XSP_V2_TEST_DATABASE_URL": f"postgresql://postgres:{password}@{db}:5432/xmesh_regression",
                "XSP_V2_REQUIRE_PQ_DB_TESTS": "1"})
            regression = command("docker", "run", "--rm", "--network", network, "--env-file", regression_env,
                *runner_mount, tests, "--exact",
                "xsp_v2_signed_cutover::signed_tests::real_postgres_signed_ack_commit_and_fail_closed", "--nocapture")
            assert "1 passed; 0 failed" in regression.stdout, "required signed DB regression did not execute"
            print("PASS: existing real dual-signed Rust/PostgreSQL regression in a separate disposable DB")
            print("SIGNER PROCESS E2E: PASS (no production keys, HTTP route or suite activation)")
        finally:
            for name in reversed(containers):
                command("docker", "rm", "-f", name, check=False)
            for name in volumes.values():
                command("docker", "volume", "rm", name, check=False)
            command("docker", "network", "rm", network, check=False)


if __name__ == "__main__":
    main()
