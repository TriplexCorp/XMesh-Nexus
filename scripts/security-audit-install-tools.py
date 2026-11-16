#!/usr/bin/env python3
"""Install exact hash-verified audit tools into this CI job's private temp dir."""
import hashlib
import json
import os
from pathlib import Path
import re
import tarfile
import tempfile
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener

ROOTS = {"syft": "anchore/syft", "trivy": "aquasecurity/trivy",
         "gitleaks": "gitleaks/gitleaks"}
class HTTPSRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urlsplit(newurl)
        if (url.scheme != "https" or url.username or url.password
                or url.hostname not in {"github.com", "release-assets.githubusercontent.com",
                                        "objects.githubusercontent.com"}):
            raise ValueError("Untrusted audit-tool redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

manifest = json.loads(Path(os.environ["AUDIT_TOOL_MANIFEST"]).read_text())
destination = Path(os.environ["AUDIT_TOOLS"])
destination.mkdir(mode=0o700, parents=True, exist_ok=True)
if destination.is_symlink():
    raise SystemExit("Invalid audit tool directory")
opener = build_opener(ProxyHandler({}), HTTPSRedirect())
for name, repository in ROOTS.items():
    asset, = manifest["tools"][name]["assets"]
    prefix = "https://github.com/" + repository + "/releases/download/"
    if not asset["url"].startswith(prefix):
        raise SystemExit("Unexpected audit tool source")
    digest = asset["sha256"].removeprefix("sha256:")
    if not re.fullmatch("[0-9a-f]{64}", digest):
        raise SystemExit("Missing immutable audit tool digest")
    with opener.open(asset["url"], timeout=60) as response:
        data = response.read(100 * 1024 * 1024 + 1)
    if len(data) > 100 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != digest:
        raise SystemExit("Audit tool checksum or size mismatch")
    with tempfile.TemporaryFile() as archive:
        archive.write(data)
        archive.seek(0)
        with tarfile.open(fileobj=archive, mode="r:gz") as bundle:
            member = bundle.getmember(name)
            if not member.isfile() or member.size > 256 * 1024 * 1024:
                raise SystemExit("Unexpected audit tool archive entry")
            content = bundle.extractfile(member)
            if content is None:
                raise SystemExit("Missing audit tool executable")
            executable = destination / name
            if executable.exists() or executable.is_symlink():
                raise SystemExit("Audit tool destination already exists")
            executable.write_bytes(content.read(256 * 1024 * 1024 + 1))
            executable.chmod(0o700)
    print("Verified audit tool: " + name + " " + manifest["tools"][name]["version"])
