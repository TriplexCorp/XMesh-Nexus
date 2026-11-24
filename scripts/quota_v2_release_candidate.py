#!/usr/bin/env python3
"""Compare actual CI candidate bytes to all three installed staging scenarios.

Inputs must be obtained from successful, trusted CI runs on the reviewed
commits. This tool checks consistency, not GitHub provenance or a signature.
It deliberately cannot authorize production activation or an Agent upgrade.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat

SCENARIOS = {"lease-recovery", "managed-generations", "agent-sigkill"}
PRODUCT = "xmesh-agent-xspv2-product"
ACTIVATION = "xmesh-agent-xspv2-activate"
MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_JSON_BYTES = 64 * 1024


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def hex_field(value, size):
    return isinstance(value, str) and re.fullmatch("[0-9a-f]{" + str(size) + "}", value) is not None


def exact_keys(doc, keys, label):
    require(isinstance(doc, dict) and set(doc) == set(keys), "invalid " + label + " fields")


def read_regular(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= limit,
                "invalid regular file: " + path.name)
        raw = stream.read(limit + 1)
        require(len(raw) == info.st_size and len(raw) <= limit, "file changed: " + path.name)
    return raw


def verify_measured_xray(path, expected_sha):
    """Re-hash the very Xray executable used to build the tested image.

    A workflow variable or earlier build log alone is not binary evidence:
    bytes on disk may have changed before the installed scenario finished.
    """
    require(hex_field(expected_sha, 64), "invalid expected Xray digest")
    actual_sha = hashlib.sha256(read_regular(path, MAX_ARTIFACT_BYTES)).hexdigest()
    require(actual_sha == expected_sha, "measured Xray executable changed after build")
    return actual_sha


def verify_running_xray(guest, container, expected_sha):
    """Measure the executable of the actual nested-Docker Xray process.

    The image tag, saved image digest and build-host binary hash do not prove
    the executable running inside a Node guest. Pin Docker container ID, PID
    and start time across a SHA-256 read from that process's /proc/PID/exe.
    This is runtime consistency evidence, not remote hardware attestation.
    """
    require(hex_field(expected_sha, 64), "invalid expected live Xray digest")
    require(container == "xmesh-managed-xray" or re.fullmatch(
        r"xmesh-quota-u[1-9][0-9]{0,18}-[0-9a-f]{32}", container) is not None,
        "untrusted Docker Xray container identity")

    def live():
        raw = guest.exec(
            "docker", "inspect", "--type", "container", "-f",
            "{{.Id}} {{.State.Pid}} {{.State.StartedAt}}", container)
        try:
            parts = raw.decode("ascii").split()
        except (UnicodeDecodeError, AttributeError):
            raise ValueError("invalid nested Xray Docker inspection") from None
        require(len(parts) == 3 and hex_field(parts[0], 64)
                and re.fullmatch(r"[1-9][0-9]{0,9}", parts[1]) is not None
                and "T" in parts[2] and not parts[2].startswith("0001-"),
                "untrusted live Xray Docker process")
        return tuple(parts)

    before = live()
    raw = guest.exec("sha256sum", "/proc/" + before[1] + "/exe")
    try:
        fields = raw.decode("ascii").split()
    except (UnicodeDecodeError, AttributeError):
        raise ValueError("invalid live Xray executable measurement") from None
    require(len(fields) == 2 and hex_field(fields[0], 64)
            and fields[1] == "/proc/" + before[1] + "/exe",
            "untrusted live Xray executable measurement")
    require(fields[0] == expected_sha, "running Xray executable differs from pinned binary")
    require(live() == before, "running Xray changed during executable measurement")
    return fields[0]


def read_json(path):
    def unique(pairs):
        doc = {}
        for key, value in pairs:
            require(key not in doc, "duplicate JSON field: " + key)
            doc[key] = value
        return doc
    return json.loads(read_regular(path, MAX_JSON_BYTES), object_pairs_hook=unique)


def check_identity(identity, version, revision):
    exact_keys(identity, ("version", "sourceRevision", "artifactSha256"), "identity")
    require(identity["version"] == version and identity["sourceRevision"] == revision
            and hex_field(identity["artifactSha256"], 64), "Agent release identity mismatch")


def check_evidence(doc, scenario, nexus_revision, identity):
    exact_keys(doc, ("schema", "scenario", "nexusRevision", "qualification",
                     "productionActivationAuthorized", "productIdentity",
                     "installedNodes", "xrayArtifactSha256"), "installed evidence")
    require(doc["schema"] == "xmesh-quota-v2-installed-release-evidence-v1"
            and doc["qualification"] == "disposable-staging-only"
            and doc["productionActivationAuthorized"] is False, "evidence is not staging qualification")
    require(scenario in SCENARIOS and doc["scenario"] == scenario,
            "missing or wrong installed scenario")
    require(hex_field(nexus_revision, 40) and doc["nexusRevision"] == nexus_revision,
            "Nexus source revision mismatch")
    require(doc["productIdentity"] == identity, "tested product binary differs from candidate")
    require(hex_field(doc["xrayArtifactSha256"], 64), "invalid measured Xray digest")
    nodes = doc["installedNodes"]
    require(isinstance(nodes, list) and len(nodes) == 2, "two installed Nodes required")
    ids = set()
    for node in nodes:
        exact_keys(node, ("nodeId", "identity"), "installed Node")
        require(type(node["nodeId"]) is int and node["nodeId"] > 0,
                "invalid installed Node ID")
        require(node["identity"] == identity, "installed product binary differs from candidate")
        ids.add(node["nodeId"])
    require(len(ids) == 2, "installed Node identities are not independent")


def write_installed_evidence(path, scenario, nexus_revision, identity, nodes, xray_sha):
    check_identity(identity, "control-v6.0.27", identity["sourceRevision"])
    require(hex_field(identity["sourceRevision"], 40), "invalid Node source revision")
    doc = {
        "schema": "xmesh-quota-v2-installed-release-evidence-v1",
        "scenario": scenario,
        "nexusRevision": nexus_revision,
        "qualification": "disposable-staging-only",
        "productionActivationAuthorized": False,
        "productIdentity": identity,
        "installedNodes": nodes,
        "xrayArtifactSha256": xray_sha,
    }
    check_evidence(doc, scenario, nexus_revision, identity)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Never replace a prior qualification record.
    with path.open("x", encoding="utf-8") as stream:
        json.dump(doc, stream, sort_keys=True, indent=2)
        stream.write("\n")


def verify(candidate, evidence, node_revision, nexus_revision):
    require(hex_field(node_revision, 40) and hex_field(nexus_revision, 40),
            "exact Node and Nexus commit SHAs required")
    manifest = read_json(candidate / "candidate-manifest.json")
    exact_keys(manifest, ("schema", "candidateOnly", "productionActivationAuthorized",
                          "version", "sourceRevision", "platform", "builder", "artifacts"),
               "candidate manifest")
    require(manifest["schema"] == "xmesh-agent-release-candidate-v1"
            and manifest["candidateOnly"] is True
            and manifest["productionActivationAuthorized"] is False
            and manifest["version"] == "control-v6.0.27"
            and manifest["sourceRevision"] == node_revision
            and manifest["platform"] == "linux/amd64"
            and manifest["builder"] == "golang:1.27.3-trixie",
            "candidate manifest does not identify the reviewed release")
    exact_keys(manifest["artifacts"], (ACTIVATION, PRODUCT), "candidate artifact inventory")
    for name, record in manifest["artifacts"].items():
        exact_keys(record, ("identity", "sizeBytes"), "candidate artifact")
        check_identity(record["identity"], manifest["version"], node_revision)
        raw = read_regular(candidate / name, MAX_ARTIFACT_BYTES)
        require(type(record["sizeBytes"]) is int and record["sizeBytes"] == len(raw)
                and hashlib.sha256(raw).hexdigest() == record["identity"]["artifactSha256"],
                "candidate artifact bytes mismatch: " + name)
    identity = manifest["artifacts"][PRODUCT]["identity"]
    require(len(evidence) == len(SCENARIOS), "all three successful scenarios required")
    seen = set()
    xray_digests = set()
    for path in evidence:
        doc = read_json(path)
        require(isinstance(doc, dict), "invalid installed evidence")
        scenario = doc.get("scenario")
        require(isinstance(scenario, str) and scenario in SCENARIOS and scenario not in seen,
                "unknown or duplicate installed scenario")
        check_evidence(doc, scenario, nexus_revision, identity)
        seen.add(scenario)
        xray_digests.add(doc["xrayArtifactSha256"])
    require(seen == SCENARIOS, "missing installed scenario")
    # A passing suite must exercise ONE reproducible, exactly measured Xray
    # binary. Otherwise three unrelated binaries could falsely qualify the
    # same Agent+dataplane release across the independent installed runs.
    require(len(xray_digests) == 1, "installed scenarios tested different Xray binaries")
    return {
        "candidateIdentity": identity, "nexusRevision": nexus_revision,
        "stagingScenarios": sorted(seen), "testedXrayArtifactSha256": sorted(xray_digests),
        "candidateMatchesInstalledStagingEvidence": True,
        "productionActivationAuthorized": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--node-revision", required=True)
    parser.add_argument("--nexus-revision", required=True)
    parser.add_argument("--evidence", required=True, nargs=3, type=Path)
    args = parser.parse_args()
    try:
        result = verify(args.candidate, args.evidence, args.node_revision, args.nexus_revision)
    except (ValueError, OSError) as error:
        parser.exit(1, "Candidate qualification rejected: " + str(error) + "\n")
    print(json.dumps(result, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
