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
