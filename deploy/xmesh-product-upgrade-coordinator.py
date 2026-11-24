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
import time


PRODUCT = Path("/usr/local/bin/xmesh-agent-xspv2-product")
BRIDGE = Path("/usr/local/libexec/xmesh-agent-release-bridge")
BRIDGE_DIGEST = Path("/etc/xmesh-agent-release-bridge.sha256")
PRODUCT_STATE = Path("/var/lib/xmesh-agent/product")
STATE = Path("/var/lib/xmesh-node-control/product-upgrade")
TARGET = "control-v6.0.27"  # legacy transition package only
FRESH = False
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
        raise ValueError("trusted Agent update recovery image is missing or altered")
    if FRESH and expected != enrollment()[1]:
        raise ValueError("recovery image does not match original enrollment")


def version_order(value):
    if not isinstance(value, str):
        raise ValueError("invalid Agent version")
    match = re.fullmatch(r"control-v6\.(0|[1-9][0-9]{0,9})\.(0|[1-9][0-9]{0,9})", value)
    if not match:
        raise ValueError("invalid canonical Agent version")
    result = tuple(int(part) for part in match.groups())
    if any(part > 2**32 - 1 for part in result):
        raise ValueError("invalid Agent version component")
    return result


def atomic_install(path, contents, mode):
    # The caller holds the root-owned supervisor lock. Publish only complete,
    # fsynced bytes. Never replace an existing trusted recovery image/pin.
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".xmesh-release-", delete=False) as file:
        pending = Path(file.name)
        try:
            os.fchmod(file.fileno(), mode)
            file.write(contents)
            file.flush()
            os.fsync(file.fileno())
            if path.exists() or path.is_symlink():
                raise ValueError("existing recovery file cannot be replaced")
            os.replace(pending, path)
            fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        finally:
            pending.unlink(missing_ok=True)


def initialize_recovery():
    config, expected = enrollment()
    identity = config["releaseIdentity"]
    if version_order(identity["version"]) < (0, 27):
        raise ValueError("fresh recovery requires a forward-compatible first Agent")
    if (not isinstance(identity["sourceRevision"], str)
            or not REVISION.fullmatch(identity["sourceRevision"])):
        raise ValueError("invalid original release revision")
    if BRIDGE_DIGEST.exists() or BRIDGE_DIGEST.is_symlink():
        require_bridge()
        return
    if (PRODUCT_STATE / "release-commit.json").exists() or (PRODUCT_STATE / "release-commit.json").is_symlink():
        raise ValueError("cannot initialize recovery after a committed upgrade")
    image = private_file(PRODUCT, 0o755, 64 << 20)
    if hashlib.sha256(image).hexdigest() != expected:
        raise ValueError("installed image does not match original enrollment")
    invoke(PRODUCT, "verify-active", "--panel", config["panelUrl"], "--node-id", str(config["nodeId"]))
    if BRIDGE.exists() or BRIDGE.is_symlink():
        # Interrupted initialization may have published only the executable.
        if digest_image(BRIDGE) != expected:
            raise ValueError("existing recovery image differs from enrollment")
    else:
        atomic_install(BRIDGE, image, 0o755)
    atomic_install(BRIDGE_DIGEST, (expected + "\n").encode(), 0o600)
    require_bridge()


def normalized_command(command):
    if (not isinstance(command, dict) or type(command.get("id")) is not int
            or not 0 < command["id"] <= 2**63 - 1 or command.get("action") != "update_agent"
            or not isinstance(command.get("targetVersion"), str)):
        raise ValueError("invalid product update command")
    target = command["targetVersion"]
    if not FRESH and target != TARGET:
        raise ValueError("invalid product update command")
    release = command.get("releaseIdentity")
    if (not isinstance(release, dict) or set(release) != {"version", "sourceRevision", "artifactSha256"}
            or release["version"] != target
            or not isinstance(release["sourceRevision"], str) or not REVISION.fullmatch(release["sourceRevision"])
            or not isinstance(release["artifactSha256"], str) or not HEX.fullmatch(release["artifactSha256"])):
        raise ValueError("product update command lacks exact release identity")
    if FRESH:
        original = enrollment()[0]["releaseIdentity"]
        if (version_order(target) <= version_order(original["version"])
                or release["sourceRevision"] == original["sourceRevision"]
                or release["artifactSha256"] == original["artifactSha256"]):
            raise ValueError("only a new forward release is eligible")
    return {"id": command["id"], "action": "update_agent", "targetVersion": target, "releaseIdentity": release}


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
    if FRESH and digest_image(PRODUCT) != enrollment()[1]:
        # This first-release protocol has exactly one successful successor
        # per activation. Do not claim support for a second transition.
        raise ValueError("a successor is already installed; no fresh transition")
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


def expired_plan_hint(path, command):
    # The deadline only decides when to ASK Nexus for its signed outcome.
    # It never authorizes replacement or rollback. The Go recovery image
    # independently verifies the exact immutable plan and signed ABORT.
    try:
        envelope = json.loads(private_file(path, 0o600, 16384))
        payload = json.loads(base64.b64decode(envelope["payloadB64"], validate=True))
        expires = payload["expiresAtMs"]
        return (payload.get("commandId") == command["id"]
                and payload.get("target") == command["releaseIdentity"]
                and type(expires) is int and 0 < expires <= time.time_ns() // 1000000)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


def run_update(command):
    release = command["releaseIdentity"]
    args = ("--command-id", str(command["id"]))
    phase_file = STATE / f"plan-{command['id']}.json"
    config, previous = enrollment()
    abort = STATE / f"abort-{command['id']}"
    expired_recovery = STATE / f"expired-recovery-{command['id']}"
    recovering_expiry = FRESH and (expired_recovery.exists() or expired_recovery.is_symlink())
    if recovering_expiry:
        if private_file(expired_recovery, 0o600, 32) != b"resolve\n":
            raise ValueError("invalid expired update recovery checkpoint")
        if digest_image(PRODUCT) == previous:
            # A previous signed ABORT may already have restored the original
            # bytes before the supervisor was killed. Reverify that outcome
            # before removing the durable command. Never fetch a new plan.
            invoke(BRIDGE, "rollback-release", *args)
            invoke(PRODUCT, "verify-active", "--panel", config["panelUrl"], "--node-id", str(config["nodeId"]))
            return
    if abort.exists() or abort.is_symlink():
        private_file(abort, 0o600, 32)
        invoke(BRIDGE, "rollback-release", *args)
        if FRESH:
            invoke(PRODUCT, "verify-active", "--panel", config["panelUrl"], "--node-id", str(config["nodeId"]))
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
        if FRESH:
            invoke(PRODUCT, "verify-active", "--panel", config["panelUrl"], "--node-id", str(config["nodeId"]))
        return
    # Always try COMMIT first, including after a lost reply and deadline.
    # If it was durably committed, Nexus replays that exact signed result.
    # An expired uncommitted candidate would otherwise remain installed
    # forever with neither operational authority nor a route back.
    try:
        invoke(PRODUCT, "confirm-release", *args)
    except (OSError, subprocess.SubprocessError):
        if not FRESH or not (recovering_expiry or expired_plan_hint(phase_file, command)):
            raise
        # Persist recovery intent before asking for ABORT. This is NOT a
        # decision to roll back: Nexus rejects ABORT after a durable COMMIT.
        # If that request fails, the next timer still retries COMMIT first
        # while the candidate remains installed.
        if not recovering_expiry:
            store_bytes(expired_recovery, b"resolve\n")
        invoke(BRIDGE, "rollback-release", *args)
        if digest_image(PRODUCT) != previous:
            raise ValueError("signed ABORT did not restore original Agent")
        invoke(PRODUCT, "verify-active", "--panel", config["panelUrl"], "--node-id", str(config["nodeId"]))
        return
    invoke(PRODUCT, "verify-active", "--panel", config["panelUrl"], "--node-id", str(config["nodeId"]))


def main(action):
    if os.geteuid() != 0:
        raise ValueError("product update requires root")
    if action != "initialize":
        require_bridge()
    elif not FRESH:
        raise ValueError("legacy transition helper cannot initialize fresh recovery")
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
        if action == "initialize":
            initialize_recovery()
        elif action == "receive":
            raw = sys.stdin.buffer.read(4097)
            if len(raw) > 4096:
                raise ValueError("product update command too large")
            store_command(normalized_command(json.loads(raw)))
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
            (STATE / f"expired-recovery-{command['id']}").unlink(missing_ok=True)
            sync_directory()
        else:
            raise ValueError("unknown product update coordinator action")
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        args = sys.argv[1:]
        if args and args[0] == "--fresh":
            FRESH = True
            BRIDGE = Path("/usr/local/libexec/xmesh-agent-release-recovery")
            BRIDGE_DIGEST = Path("/etc/xmesh-agent-release-recovery.sha256")
            args = args[1:]
        if len(args) != 1:
            raise ValueError("provide one product update coordinator action")
        main(args[0])
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        # Never include credentials, commands or remote response bytes in logs.
        print(f"Agent update deferred or refused ({type(error).__name__})", file=sys.stderr)
        sys.exit(1)
