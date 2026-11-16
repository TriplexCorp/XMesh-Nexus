#!/usr/bin/env python3
"""Collect bounded, redacted audit evidence from the three pinned public checkouts."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path.cwd()
OUT = Path(os.environ["RUNNER_TEMP"]) / "xmesh-audit-evidence"
PRIVATE = Path(os.environ["RUNNER_TEMP"]) / "xmesh-audit-private"
TOOLS = Path(os.environ["AUDIT_TOOLS"])
OUT.mkdir(mode=0o700, parents=True, exist_ok=True)
PRIVATE.mkdir(mode=0o700, parents=True, exist_ok=True)
REPOS = {"XMesh-Nexus": "nexus", "XMesh-Node": "node", "XMesh-Sub": "sub"}
expected = {
    "XMesh-Nexus": "4aa18331e537d6a1eacd747d58af55041748abf0",
    "XMesh-Node": "1f4744d19177056bd9ffa6ca2009975805050936",
    "XMesh-Sub": "6fca4eb0e0388e6ec5e6817e9a8d58942935aaa2",
}
statuses = []
def run(label, argv, cwd=None, timeout=900):
    log = PRIVATE / (label + ".log")
    started = time.monotonic()
    try:
        with log.open("wb") as stream:
            result = subprocess.run(argv, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT,
                                    timeout=timeout, check=False)
        code = result.returncode
    except subprocess.TimeoutExpired:
        code = 124
    statuses.append({"tool": label, "exitCode": code,
                     "elapsedSeconds": round(time.monotonic() - started, 2)})
    print(json.dumps(statuses[-1]), flush=True)
    return code


def run_report(label, argv, report, cwd=None, timeout=900):
    started = time.monotonic()
    try:
        with report.open("wb") as output, (PRIVATE / (label + ".log")).open("wb") as errors:
            result = subprocess.run(argv, cwd=cwd, stdout=output, stderr=errors,
                                    timeout=timeout, check=False)
        code = result.returncode
    except subprocess.TimeoutExpired:
        code = 124
    statuses.append({"tool": label, "exitCode": code,
                     "elapsedSeconds": round(time.monotonic() - started, 2)})
    print(json.dumps(statuses[-1]), flush=True)
    return code

def read_json(file, default):
    try:
        return json.loads(file.read_text())
    except (OSError, ValueError):
        statuses.append({"tool": "parse-output:" + file.name, "exitCode": 125})
        return default

def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2) + "\n")

sources = {}
for repo, folder in REPOS.items():
    source = ROOT / "audit-sources" / folder
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"],
                                      text=True).strip()
    if revision != expected[repo]:
        raise SystemExit("Audit source identity mismatch")
    sources[repo] = source
save("source-identities.json", expected)
if os.environ.get("AUDIT_TOOL_MANIFEST"):
    save("tool-pins.json", json.loads(Path(os.environ["AUDIT_TOOL_MANIFEST"]).read_text()))

if sys.argv[1] == "sast":
    for repo, source in sources.items():
        slug = REPOS[repo]
        raw = PRIVATE / (slug + "-semgrep.json")
        run(slug + "-semgrep", [str(TOOLS / "python/bin/semgrep"), "scan", "--oss-only",
            "--config", "p/security-audit", "--metrics=off", "--disable-version-check",
            "--timeout", "5", "--max-target-bytes", "1048576", "--error",
            "--json", "--output", str(raw), str(source)])
        payload = read_json(raw, {})
        findings = []
        for item in payload.get("results", []):
            extra = item.get("extra", {})
            metadata = extra.get("metadata", {})
            findings.append({"rule": item.get("check_id"), "path": item.get("path"),
                "line": item.get("start", {}).get("line"), "severity": extra.get("severity"),
                "confidence": metadata.get("confidence"), "cwe": metadata.get("cwe")})
        save(slug + "-semgrep.redacted.json", {
            "findings": findings, "parseErrorCount": len(payload.get("errors", []))})
        raw = PRIVATE / (slug + "-bandit.json")
        run(slug + "-bandit", [str(TOOLS / "python/bin/bandit"), "-r", str(source),
            "-f", "json", "-o", str(raw)])
        payload = read_json(raw, {})
        save(slug + "-bandit.redacted.json", {"findings": [
            {"rule": x.get("test_id"), "path": x.get("filename"),
             "line": x.get("line_number"), "severity": x.get("issue_severity"),
             "confidence": x.get("issue_confidence"), "cwe": x.get("issue_cwe")}
            for x in payload.get("results", [])],
            "parseErrorCount": len(payload.get("errors", []))})
        raw = PRIVATE / (slug + "-gitleaks.json")
        run(slug + "-gitleaks", [str(TOOLS / "gitleaks"), "git", str(source),
            "--redact=100", "--report-format=json", "--report-path=" + str(raw)])
        payload = read_json(raw, [])
        save(slug + "-gitleaks.redacted.json", {"candidates": [
            {"rule": x.get("RuleID"), "path": x.get("File"), "line": x.get("StartLine"),
             "commit": x.get("Commit"), "fingerprint": x.get("Fingerprint")}
            for x in payload if isinstance(x, dict)]})
    run_report("scanner-versions", [str(TOOLS / "python/bin/python"), "-m", "pip",
                                   "list", "--format=json"], OUT / "scanner-python-environment.json")
    save("scanner-statuses.json", statuses)

elif sys.argv[1] == "dependencies":
    nexus, node = sources["XMesh-Nexus"], sources["XMesh-Node"]
    cache = PRIVATE / "cargo"
    cache.mkdir(exist_ok=True)
    # Only public source/cache/report directories are mounted. No host credentials,
    # Docker socket, system directory, or production state enters the container.
    run("cargo-audit", ["docker", "run", "--rm", "--cap-drop=ALL",
        "--security-opt=no-new-privileges", "--memory=4g", "--cpus=2",
        "-e", "CARGO_BUILD_JOBS=2", "-v", str(nexus) + ":/src",
        "-v", str(cache) + ":/usr/local/cargo/registry",
        "-v", str(PRIVATE) + ":/reports", "-w", "/src/backend",
        "rust:1.99.1-bookworm", "sh", "-c",
        "cargo generate-lockfile && cargo install cargo-audit --locked && cargo audit --version > /reports/cargo-audit.version.txt && cargo audit --json > /reports/cargo-audit.json"],
        timeout=1800)
    if (PRIVATE / "cargo-audit.version.txt").is_file():
        (OUT / "cargo-audit-version.txt").write_bytes((PRIVATE / "cargo-audit.version.txt").read_bytes())
    cargo = read_json(PRIVATE / "cargo-audit.json", {})
    save("nexus-cargo-audit.redacted.json", {"vulnerabilities": [
        {"id": x.get("advisory", {}).get("id"), "package": x.get("package", {}).get("name"),
         "version": x.get("package", {}).get("version"),
         "cvss": x.get("advisory", {}).get("cvss"),
         "patched": x.get("versions", {}).get("patched", [])}
        for x in cargo.get("vulnerabilities", {}).get("list", [])]})
    lock = nexus / "backend/Cargo.lock"
    if lock.is_file():
        (OUT / "nexus.resolved.Cargo.lock").write_bytes(lock.read_bytes())
        print("AUDIT_CARGO_LOCK_BEGIN", flush=True)
        print(lock.read_text(), flush=True)
        print("AUDIT_CARGO_LOCK_END", flush=True)
    raw = PRIVATE / "npm-audit.json"
    run_report("npm-audit-browser-tooling", ["npm", "audit", "--json", "--package-lock-only"],
               raw, cwd=nexus / "scripts/browser", timeout=300)
    npm = read_json(raw, {})
    save("nexus-browser-npm-audit.redacted.json", {
        "metadata": npm.get("metadata", {}),
        "packages": [{"name": name, "severity": item.get("severity"),
                      "range": item.get("range"), "fixAvailable": item.get("fixAvailable")}
                     for name, item in npm.get("vulnerabilities", {}).items()]})
    run("install-govulncheck", ["go", "install", "golang.org/x/vuln/cmd/govulncheck@latest"],
        timeout=900)
    govuln = Path(subprocess.check_output(["go", "env", "GOPATH"], text=True).strip()) / "bin/govulncheck"
    if govuln.is_file():
        run_report("govulncheck-version", ["go", "version", "-m", str(govuln)],
                   OUT / "govulncheck-build.txt")
        modules = [("node-router", node), ("node-agent", node / "agent/xspv2"),
                   ("node-crypto", node / "security/xspv2/poc-go"),
                   ("nexus-gateway", nexus / "deploy/xsp-v2-product-gateway")]
        for label, module in modules:
            raw = PRIVATE / (label + "-govuln.json")
            run_report(label + "-govulncheck", [str(govuln), "-json", "./..."], raw, cwd=module)
            objects = []
            data = raw.read_text()
            decoder = json.JSONDecoder()
            while data.strip():
                data = data.lstrip()
                try:
                    item, position = decoder.raw_decode(data)
                except ValueError:
                    statuses.append({"tool": "parse-json-stream:" + raw.name, "exitCode": 125})
                    break
                data = data[position:]
                if "finding" in item:
                    objects.append(item["finding"])
                elif "config" in item:
                    objects.append({"scannerConfig": item["config"]})
            save(label + "-govulncheck.redacted.json", objects)
    for repo, source in sources.items():
        slug = REPOS[repo]
        run(slug + "-source-sbom", [str(TOOLS / "syft"), "scan", "dir:" + str(source),
            "-o", "cyclonedx-json=" + str(OUT / (slug + ".source.cdx.json"))])
    run("node-production-image", ["docker", "build", "-t", "xmesh-audit-router:local", "."],
        cwd=node, timeout=900)
    if govuln.is_file():
        container = subprocess.check_output(["docker", "create", "xmesh-audit-router:local"],
                                            text=True).strip()
        binary = PRIVATE / "node-router"
        try:
            run("export-node-binary", ["docker", "cp",
                container + ":/usr/local/bin/xmesh-node", str(binary)])
        finally:
            subprocess.run(["docker", "rm", container], check=True,
                           stdout=subprocess.DEVNULL)
        if binary.is_file():
            raw = PRIVATE / "node-production-govuln.json"
            run_report("node-production-binary-govulncheck",
                       [str(govuln), "-json", "-mode=binary", str(binary)], raw, timeout=600)
            objects = []
            data = raw.read_text()
            decoder = json.JSONDecoder()
            while data.strip():
                data = data.lstrip()
                try:
                    item, position = decoder.raw_decode(data)
                except ValueError:
                    statuses.append({"tool": "parse-json-stream:" + raw.name, "exitCode": 125})
                    break
                data = data[position:]
                if "finding" in item:
                    objects.append(item["finding"])
                elif "config" in item:
                    objects.append({"scannerConfig": item["config"]})
            save("node-production-binary-govulncheck.redacted.json", objects)
    images = [("node-router-runtime", "xmesh-audit-router:local"),
              ("sub-caddy-runtime", "caddy:2"), ("sub-python-runtime", "python:3.12-alpine")]
    for label, image in images:
        if image != "xmesh-audit-router:local":
            run(label + "-pull", ["docker", "pull", image], timeout=600)
        run(label + "-image-sbom", [str(TOOLS / "syft"), "scan", "docker:" + image,
            "-o", "cyclonedx-json=" + str(OUT / (label + ".image.cdx.json"))])
        raw = PRIVATE / (label + "-trivy.json")
        run(label + "-trivy", [str(TOOLS / "trivy"), "image", "--scanners", "vuln",
            "--format", "json", "--exit-code", "1", "--timeout", "10m",
            "--output", str(raw), image], timeout=660)
        payload = read_json(raw, {})
        save(label + "-trivy.redacted.json", {"artifact": payload.get("ArtifactName"),
            "metadata": payload.get("Metadata", {}),
            "results": [{"target": x.get("Target"), "vulnerabilities": [
                {"id": y.get("VulnerabilityID"), "package": y.get("PkgName"),
                 "installed": y.get("InstalledVersion"), "fixed": y.get("FixedVersion"),
                 "severity": y.get("Severity")}
                for y in x.get("Vulnerabilities", [])]} for x in payload.get("Results", [])]})
    save("scanner-statuses.json", statuses)
else:
    raise SystemExit("Unknown evidence mode")

if sys.argv[1] == "dependencies":
    for slug in REPOS.values():
        bom = read_json(OUT / (slug + ".source.cdx.json"), {})
        if bom.get("bomFormat") != "CycloneDX" or not bom.get("specVersion"):
            statuses.append({"tool": "validate-sbom:" + slug, "exitCode": 125})
save("scanner-statuses.json", statuses)
# Preserve all exit codes. Findings are not silently converted into a security pass.
print("AUDIT_STATUS_SUMMARY " + json.dumps(statuses, sort_keys=True), flush=True)
if any(item["exitCode"] != 0 for item in statuses):
    raise SystemExit(1)
