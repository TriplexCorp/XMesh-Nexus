#!/usr/bin/env python3
from pathlib import Path

old = "These post-#135 security-relevant changes require a refreshed independent-review freeze for current `main`."
new = "These post-#135 security-relevant changes are included in the refreshed PR #142 review freeze; external independent findings/remediation/sign-off remain required."

for name in ("README.md", "README.en.md"):
    p = Path(name)
    text = p.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"{name}: expected exactly one stale #140 freeze sentence")
    p.write_text(text.replace(old, new, 1))
