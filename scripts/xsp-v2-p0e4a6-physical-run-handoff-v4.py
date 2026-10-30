#!/usr/bin/env python3
"""Run the legacy E4a6 physical-lab handoff against the current v4 Node target.

The underlying handoff implementation remains non-executing. This wrapper only
rebinds its source/runner identity from the historical PR #44/#45 provenance to
the remediated Node PR #52 qualification target.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

CURRENT_NODE = "34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb"


def load_legacy():
    path = Path(__file__).with_name("xsp-v2-p0e4a6-physical-run-handoff.py")
    spec = importlib.util.spec_from_file_location("xsp_v2_p0e4a6_legacy", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load legacy E4a6 handoff")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    module = load_legacy()
    module.PINNED_NODE_SOURCE = CURRENT_NODE
    module.PINNED_NODE_RUNNER = CURRENT_NODE
    return int(module.main())


if __name__ == "__main__":
    raise SystemExit(main())
