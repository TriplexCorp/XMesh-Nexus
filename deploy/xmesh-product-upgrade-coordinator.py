#!/usr/bin/env python3
"""Coordinate a manifest-bound installed product update under systemd.

The bridge and its digest must arrive in the same trusted deployment package.
A panel response can refer to a release but cannot choose a local executable.
"""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


PRODUCT = Path("/usr/local/bin/xmesh-agent-xspv2-product")
BRIDGE = Path("/usr/local/libexec/xmesh-agent-release-bridge")
BRIDGE_DIGEST = Path("/etc/xmesh-agent-release-bridge.sha256")
PRODUCT_STATE = Path("/var/lib/xmesh-agent/product")
STATE = Path("/var/lib/xmesh-node-control/product-upgrade")
TARGET = "control-v6.0.27"
HEX = re.compile(r"[0-9a-f]{64}")
REVISION = re.compile(r"[0-9a-f]{40}")


def private_file(path, mode, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(fd, "rb") as file:
        st = os.fstat(file.fileno())
        if (not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_nlink != 1
                or stat.S_IMODE(st.st_mode) != mode or not 0 < st.st_size <= limit):
            raise ValueError("unsafe Agent update file")
        raw = file.read(limit + 1)
        if len(raw) != st.st_size:
            raise ValueError("Agent update file changed while reading")
        return raw


def digest_image(path):
    return hashlib.sha256(private_file(path, 0o755, 64 << 20)).hexdigest()


def require_bridge():
    expected = private_file(BRIDGE_DIGEST, 0o600, 128).decode().strip()
    if not HEX.fullmatch(expected) or digest_image(BRIDGE) != expected:
        raise ValueError("trusted Agent update bridge is missing or altered")


def normalized_command(command):
    if (not isinstance(command, dict) or type(command.get("id")) is not int
            or not 0 < command["id"] <= 2**63 - 1 or command.get("action") != "update_agent"
            or command.get("targetVersion") != TARGET):
        raise ValueError("invalid product update command")
    release = command.get("releaseIdentity")
    if (not isinstance(release, dict) or set(release) != {"version", "sourceRevision", "artifactSha256"}
            or release["version"] != TARGET
            or not isinstance(release["sourceRevision"], str) or not REVISION.fullmatch(release["sourceRevision"])
            or not isinstance(release["artifactSha256"], str) or not HEX.fullmatch(release["artifactSha256"])):
        raise ValueError("product update command lacks exact release identity")
    return {"id": command["id"], "action": "update_agent", "targetVersion": TARGET, "releaseIdentity": release}


def sync_directory():
    fd = os.open(STATE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def enrollment():
    config = json.loads(private_file(PRODUCT_STATE / "config.json", 0o600, 65536))
    previous = config["releaseIdentity"]["artifactSha256"]
    if not isinstance(previous, str) or not HEX.fullmatch(previous):
        raise ValueError("invalid original Agent identity")
    return config, previous


def store_command(command):
    path = STATE / "command.json"
    if path.exists() or path.is_symlink():
        existing = normalized_command(json.loads(private_file(path, 0o600, 4096)))
        if existing == command:
            sync_directory()
            return
        # A fresh authenticated poll can return a newer command after
        # Nexus expires the old one. Reuse the slot only while the exact
        # original executable is still installed, under the same lock.
        if command["id"] <= existing["id"] or digest_image(PRODUCT) != enrollment()[1]:
            raise ValueError("another product update requires recovery")
    store_bytes(path, json.dumps(command, sort_keys=True).encode())


def store_bytes(path, contents):
    with tempfile.NamedTemporaryFile(dir=STATE, prefix=".command-", delete=False) as file:
        pending = Path(file.name)
        try:
            file.write(contents)
            file.flush()
            os.fsync(file.fileno())
            os.replace(pending, path)
            sync_directory()
        finally:
            pending.unlink(missing_ok=True)


def invoke(executable, phase, *arguments):
    print("Agent update:", phase, flush=True)
    return subprocess.run([executable, phase, *arguments], check=True, capture_output=True, timeout=120).stdout


def run_update(command):
    release = command["releaseIdentity"]
    args = ("--command-id", str(command["id"]))
    phase_file = STATE / f"plan-{command['id']}.json"
    config, previous = enrollment()
    abort = STATE / f"abort-{command['id']}"
    if abort.exists():
        private_file(abort, 0o600, 32)
        invoke(BRIDGE, "rollback-release", *args)
        return
    measured = digest_image(PRODUCT)
    if measured == previous:
        invoke(BRIDGE, "fetch-release-plan", *args, "--output-file", str(phase_file))
        envelope = json.loads(private_file(phase_file, 0o600, 16384))
        # This comparison only narrows the selection. The Go phases each
        # independently check the real signature and live authorization.
        payload = json.loads(base64.b64decode(envelope["payloadB64"], validate=True))
        if payload.get("target") != release or payload.get("commandId") != command["id"]:
            raise ValueError("fetched release does not match the claimed command")
        plan = (*args, "--plan-file", str(phase_file))
        invoke(BRIDGE, "download-release-artifact", *plan)
        invoke(BRIDGE, "prepare-release", *plan)
        invoke(BRIDGE, "switch-release", *args)
        measured = digest_image(PRODUCT)
    if measured != release["artifactSha256"]:
        raise ValueError("installed bytes differ from the claimed release")
    try:
        if json.loads(invoke(PRODUCT, "--identity")) != release:
            raise ValueError("running image differs from the claimed release")
    except (ValueError, OSError, subprocess.SubprocessError):
        # A local startup failure may request ABORT. Only Nexus's signed
        # terminal decision can permit the original image to be restored.
        store_bytes(abort, b"abort\n")
        invoke(BRIDGE, "rollback-release", *args)
        return
    # Transport failure here is ambiguous. Leave the target in place and
    # retry through the timer; Nexus replays its original signed COMMIT.
    invoke(PRODUCT, "confirm-release", *args)
    invoke(PRODUCT, "verify-active", "--panel", config["panelUrl"], "--node-id", str(config["nodeId"]))


def main(action):
    if os.geteuid() != 0:
        raise ValueError("product update requires root")
    require_bridge()
    if action == "ready":
        return
    STATE.mkdir(mode=0o700, exist_ok=True)
    info = STATE.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError("unsafe product update state directory")
    fd = os.open(STATE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = STATE / "command.json"
        if action == "receive":
            store_command(normalized_command(json.loads(sys.stdin.buffer.read(4097))))
        elif action == "run":
            try:
                command = normalized_command(json.loads(private_file(path, 0o600, 4096)))
            except FileNotFoundError:
                return
            run_update(command)
            path.unlink()
            sync_directory()
            (STATE / f"plan-{command['id']}.json").unlink(missing_ok=True)
            (STATE / f"abort-{command['id']}").unlink(missing_ok=True)
            sync_directory()
        else:
            raise ValueError("unknown product update coordinator action")
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("provide one product update coordinator action")
        main(sys.argv[1])
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        # Never include credentials, commands or remote response bytes in logs.
        print(f"Agent update deferred or refused ({type(error).__name__})", file=sys.stderr)
        sys.exit(1)
