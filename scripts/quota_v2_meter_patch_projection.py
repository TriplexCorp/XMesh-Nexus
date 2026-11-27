"""Independent runner verification of the expanded 6.0.39 source checkout.

No Node verifier or build script is imported. Only this exact base/extension
pair is allowed, and every signed ordinary-meter entry must retain its
Git object identity and mode. Build from the separately attested checkout.
"""
import re
import subprocess
import sys

DIRECTORY = "experiments/xray-dataplane-fence"
BASE = "838bf0d56374f437df02275812953719a3937efe"
EXTENSION = "2d4716bc6445d6143ea9b10d6c231f5246062f69"
NAMESPACE_ONLY = {
    b"apply-namespace-ingress-candidate.py",
    b"install-namespace-xray-candidate.sh",
    b"install_namespace_candidate.py",
    b"namespace_candidate_artifact.py",
    b"namespace_candidate_executable.py",
    b"namespace_ingress_candidate.go.txt",
    b"test_xray_namespace_ingress_candidate.py",
    b"test_xray_namespace_systemd.py",
}


def decode_tree(raw):
    assert raw and raw.endswith(b"\0")
    result = {}
    for entry in raw[:-1].split(b"\0"):
        ident, path = entry.split(b"\t", 1)
        assert re.fullmatch(rb"100(?:644|755) blob [0-9a-f]{40}", ident)
        assert re.fullmatch(rb"[a-zA-Z0-9_.-]+", path) and path not in (b".", b"..")
        assert path not in result
        result[path] = ident
    return result


def verify_projection(candidate, base):
    assert base and candidate
    assert not set(base) & NAMESPACE_ONLY
    assert set(candidate) - set(base) == NAMESPACE_ONLY
    assert all(candidate.get(path) == identity for path, identity in base.items())


def git(root, *args):
    return subprocess.check_output(["git", "--no-optional-locks", "-C", root, *args], timeout=20)


def verify(candidate, signed):
    for root, tree in ((candidate, EXTENSION), (signed, BASE)):
        assert git(root, "rev-parse", "HEAD:" + DIRECTORY).strip().decode() == tree
        assert not git(root, "status", "--porcelain=v1", "--untracked-files=all", "--", DIRECTORY)
    # Git's exact tree digest pins the extension as well as all leaves.
    # Compare leaves independently, and do not use the extension to build.
    verify_projection(
        decode_tree(git(candidate, "ls-tree", "-r", "-z", "HEAD:" + DIRECTORY)),
        decode_tree(git(signed, "ls-tree", "-r", "-z", "HEAD:" + DIRECTORY)))


if __name__ == "__main__":
    assert len(sys.argv) == 3
    verify(*sys.argv[1:])
    print("Verified exact expanded Node tree preserves every signed ordinary-meter source entry.")
