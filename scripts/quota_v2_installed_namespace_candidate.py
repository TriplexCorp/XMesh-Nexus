"""Independent installed namespace/ordinary Xray identity (hosted only).

This diagnostic intentionally has no public listener or positive TLS
authority. The namespace process executes sealed bytes with empty config in
a private network namespace; the real WAL traffic continues to use the
ordinary installed first-Genesis loopback frontend.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess

from quota_v2_installed_tls_wal_readback import INSTALLED_WAL, require_disposable, require_loopback_ingress

REVISION = "26b69f184a74a2ea6e58365dd9572f77d83be1e2"
PROOF_REVISION = "9eaf579ff32171ca815c520bb7c6beb347c32745"
BINARY_SHA = "8fec9498156b1b5a15a5a3c017ce8eba2f445437d1e23867f94d346b8ff16982"
MANIFEST_SHA = "4f3175f7fa821f5d5d6bab82cfa8e67070d2b4dd95f5b2be9a87eb24850d4192"
PROVENANCE_SHA = "b78efdf929a6512173cee139ffa5b086939af2ee590f6b6c0c98c1d268fd2fbc"
SOURCE = "/opt/xmesh-ci-namespace-source"
INPUT = "/opt/xmesh-ci-namespace-input"
PROOF = "/opt/xmesh-ci-namespace-proof"
CANDIDATE = "/var/lib/xmesh-namespace-xray-candidate/" + REVISION
ORDINARY = ("/usr/local/libexec/xmesh-metered-xray",
            "/var/lib/xmesh-metered-xray/identity")
MODULES = {
    "namespace_candidate_executable.py": "experiments/xray-dataplane-fence",
    "public_tls_executable.py": "experiments/quota-v2-physical-stop",
    "namespace_candidate_artifact.py": "experiments/xray-dataplane-fence",
    "install_namespace_candidate.py": "experiments/xray-dataplane-fence",
}

# The actual installed module dependencies are not copied or stubbed.
# Run the independent dual-artifact verifier in a new private netns.
# Native mode itself must refuse a launch with no authenticated inputs.
PROBE = r"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

source, proof, installed, revision, manifest, provenance, candidate_sha, ordinary_sha, original_ns = sys.argv[1:]
assert os.geteuid() == os.getegid() == 0
assert os.readlink("/proc/1/ns/net") == original_ns
assert os.readlink("/proc/self/ns/net") != original_ns
links = json.loads(subprocess.check_output(["ip", "-j", "link", "show"], timeout=5))
assert [link["ifname"] for link in links] == ["lo"]
sys.path.insert(0, installed)
sys.path.insert(0, proof)
import namespace_candidate_executable as namespace
import namespace_candidate_artifact as artifact
import install_namespace_candidate as installer
import public_tls_executable as executable

for module in (namespace, artifact, installer, executable):
    assert Path(module.__file__).parent == Path(proof)
for module in (executable.release, executable.wal_transport):
    assert Path(module.__file__).parent == Path(installed)
runtime_module = executable.wal_transport.runtime_identity
assert Path(runtime_module.__file__).parent == Path(installed).parent / "xray-dataplane-fence"

def original():
    raw = json.loads(subprocess.check_output(
        ["docker", "inspect", "--format", "{{json .}}", "xmesh-managed-xray"], timeout=5))
    assert raw["State"]["Running"] and raw["HostConfig"]["NetworkMode"] == "none"
    pid = raw["State"]["Pid"]
    assert type(pid) is int and pid > 1
    runtime = runtime_module.trusted_runtime_identity(pid)
    assert os.readlink(f"/proc/{pid}/ns/net") != os.readlink("/proc/self/ns/net")
    return raw["Id"], raw["State"]["StartedAt"], pid, runtime

identity = original()
pid, runtime = identity[2:]
assert candidate_sha != ordinary_sha
assert executable.release.read_identity(executable.release.QUALIFICATION)["artifactSha256"] == ordinary_sha
with namespace.PinnedNamespaceCandidateExecutable(
        runtime_pid=pid, runtime_id=runtime, source_root=source, revision=revision,
        manifest_sha256=manifest, provenance_sha256=provenance) as sealed:
    assert sealed.ensure_binding(runtime_pid=pid, runtime_id=runtime) is None
    fd = sealed.exec_fd
    path = f"/proc/self/fd/{fd}"
    with os.fdopen(os.dup(fd), "rb") as subject:
        assert hashlib.file_digest(subject, "sha256").hexdigest() == candidate_sha
    # Even the exact sealed binary cannot enter native mode without its
    # independent launcher proof. This is a deliberately invalid request.
    rejected = subprocess.run([path, "version"], pass_fds=(fd,),
        env={"XMESH_NAMESPACE_INGRESS_DIAGNOSTIC": "1"},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=10)
    assert rejected.returncode != 0
    assert b"namespace ingress candidate requires isolated capless PID1" in rejected.stdout
    # Exercise the actual executable inode without starting a network
    # listener. No user, certificate, grant, routing socket or signing key.
    with tempfile.TemporaryDirectory(prefix="namespace-inert-") as directory:
        config = Path(directory) / "xray.json"
        config.write_text('{"inbounds":[],"outbounds":[{"protocol":"blackhole"}]}', encoding="ascii")
        log_path = Path(directory) / "child.log"
        with log_path.open("wb") as log:
            child = subprocess.Popen([path, "run", "-config", str(config)],
                pass_fds=(fd,), env={"PATH": "/usr/bin:/bin"},
                stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if child.poll() is not None:
                        raise AssertionError("inert candidate failed: " + repr(log_path.read_bytes()[:4096]))
                    try:
                        startup = log_path.read_bytes()[:4096]
                        if (b" started" in startup
                                and os.stat(f"/proc/{child.pid}/exe").st_ino == os.fstat(fd).st_ino):
                            break
                    except FileNotFoundError:
                        pass
                    time.sleep(0.025)
                else:
                    raise AssertionError("inert candidate did not start")
                assert sealed.verify_child(child) is None
                with open(f"/proc/{child.pid}/exe", "rb") as actual:
                    assert hashlib.file_digest(actual, "sha256").hexdigest() == candidate_sha
                assert os.readlink(f"/proc/{child.pid}/ns/net") == os.readlink("/proc/self/ns/net")
                assert not subprocess.check_output(["ss", "-Hlntu"], timeout=5).strip()
                assert sealed.ensure_current() is None
            finally:
                if child.poll() is None:
                    child.terminate()
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=3)
            assert sealed.ensure_current() is None
assert original() == identity
print(json.dumps(identity, separators=(",", ":")))
"""


def require_native():
    require_disposable()
    assert os.environ["XMESH_RELEASE_QUALIFICATION_SCENARIO"] == "public-tls-namespace-candidate"


def file_digest(path):
    with path.open("rb") as subject:
        return hashlib.file_digest(subject, "sha256").hexdigest()


def reviewed_checkout(var, revision):
    root = Path(os.environ[var]).resolve(strict=True)
    actual = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], timeout=10)
    assert actual.strip().decode() == revision
    assert not subprocess.check_output(["git", "-C", str(root), "status", "--porcelain",
                                        "--untracked-files=all"], timeout=10)
    return root


def ordinary_state(guest):
    return (guest.exec("sha256sum", *ORDINARY),
            guest.exec("stat", "-c", "%d:%i:%u:%g:%a:%h:%s:%Y:%Z", *ORDINARY))


def install_candidate(guest, lab):
    require_native()
    source = reviewed_checkout("XMESH_NAMESPACE_SOURCE", REVISION)
    proof = reviewed_checkout("XMESH_NAMESPACE_PROOF_SOURCE", PROOF_REVISION)
    bundle = Path(os.environ["XMESH_NAMESPACE_BUNDLE"]).resolve(strict=True)
    assert {p.name for p in bundle.iterdir()} == {"xray", "candidate-manifest.json", "provenance.jsonl"}
    for name, digest in (("xray", BINARY_SHA), ("candidate-manifest.json", MANIFEST_SHA),
                         ("provenance.jsonl", PROVENANCE_SHA)):
        assert file_digest(bundle / name) == digest
    before = ordinary_state(guest)
    for path in (SOURCE, INPUT, PROOF, CANDIDATE):
        guest.exec("test", "!", "-e", path)
    # A complete, exact reviewed Git checkout is required for the installer
    # and the candidate's independently validated source tree contract.
    lab.docker("cp", str(source), f"{guest.name}:{SOURCE}", timeout=90)
    lab.docker("cp", str(bundle), f"{guest.name}:{INPUT}", timeout=90)
    guest.exec("chown", "-R", "0:0", SOURCE, INPUT)
    guest.exec("chmod", "0700", SOURCE, INPUT)
    guest.exec("install", "-d", "-m", "0700", PROOF)
    for module, directory in MODULES.items():
        path = proof / directory / module
        lab.docker("cp", str(path), f"{guest.name}:{PROOF}/{module}")
        guest.exec("chown", "0:0", f"{PROOF}/{module}")
        guest.exec("chmod", "0600", f"{PROOF}/{module}")
        assert guest.exec("sha256sum", f"{PROOF}/{module}").split()[0].decode() == file_digest(path)
    output = guest.exec("bash", SOURCE + "/experiments/xray-dataplane-fence/install-namespace-xray-candidate.sh",
                        REVISION, INPUT, timeout=500)
    assert b"Verified side-by-side namespace candidate installed (NOT authorized)" in output
    for name, digest, mode in (("xray", BINARY_SHA, "755"), ("candidate-manifest.json", MANIFEST_SHA, "600"),
                               ("provenance.jsonl", PROVENANCE_SHA, "600")):
        path = CANDIDATE + "/" + name
        assert guest.exec("stat", "-c", "%u:%g:%a:%h", path).strip().decode() == "0:0:" + mode + ":1"
        assert guest.exec("sha256sum", path).split()[0].decode() == digest
    assert ordinary_state(guest) == before
    assert guest.exec("stat", "-c", "%u:%g:%a", CANDIDATE).strip() == b"0:0:700"
    print(f"PASS: Node {guest.node} independently installed signed side-by-side candidate; "
          "ordinary qualification and executable unchanged.", flush=True)


def prove_candidate(guest):
    require_native()
    from quota_v2_release_candidate import verify_running_xray
    ordinary_sha = os.environ["XMESH_WAL_XRAY_SHA256"]
    before = ordinary_state(guest)
    verify_running_xray(guest, "xmesh-managed-xray", ordinary_sha)
    require_loopback_ingress(guest)
    original_ns = guest.exec("readlink", "/proc/1/ns/net").strip().decode()
    result = guest.exec("env", "GITHUB_ACTIONS=true", "RUNNER_ENVIRONMENT=github-hosted",
                        "XMESH_DISPOSABLE_BOUND_LISTENER_TEST=1",
                        "unshare", "--net", "--mount", "--propagation", "private", "--",
                        "python3", "-I", "-B", "-c", PROBE, SOURCE, PROOF, INSTALLED_WAL, REVISION,
                        MANIFEST_SHA, PROVENANCE_SHA, BINARY_SHA, ordinary_sha, original_ns,
                        timeout=30)
    identity = json.loads(result)
    assert len(identity) == 4 and type(identity[2]) is int and identity[2] > 1
    verify_running_xray(guest, "xmesh-managed-xray", ordinary_sha)
    require_loopback_ingress(guest)
    assert ordinary_state(guest) == before
    print(f"PASS: Node {guest.node} sealed separate live ELF, refused unauthenticated native "
          "mode, isolated inert child left no listeners, actual original meter unchanged.", flush=True)
    return identity, before
