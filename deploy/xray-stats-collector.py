#!/usr/bin/env python3
"""Parse real Xray StatsService counters into per-user/per-inbound metrics.

Input: xray api statsquery JSON (without reset). Output: JSON fragment appended
to a signed agent payload. No interpolation of per-inbound aggregate counters.
Users must be assigned a unique stats email per inbound:
  xmesh-u<panel-user-id>--<percent-encoded inbound-tag>
"""
import json
import re
import sys
from collections import defaultdict
from urllib.parse import unquote

PATTERN = re.compile(r"^user>>>xmesh-u([1-9][0-9]*)--([^>]+)>>>traffic>>>(uplink|downlink)$")


def collect(payload: dict) -> dict:
    grouped: dict[tuple[int, str], dict[str, int]] = {}
    stats = payload.get("stat", [])
    if not isinstance(stats, list) or len(stats) > 12000:
        raise ValueError("Invalid or oversized Xray stats payload")
    for entry in stats:
        if not isinstance(entry, dict):
            continue
        match = PATTERN.fullmatch(entry.get("name", ""))
        if not match:
            continue
        user_id = int(match.group(1))
        inbound_tag = unquote(match.group(2), encoding="utf-8", errors="strict")
        if not inbound_tag or len(inbound_tag) > 128 or any(ord(c) < 32 for c in inbound_tag):
            continue
        value = int(entry.get("value", 0))
        if value < 0 or value > 2**63 - 1:
            continue
        counters = grouped.setdefault((user_id, inbound_tag), {"uplink": 0, "downlink": 0})
        counters[match.group(3)] = value
    if len(grouped) > 4096:
        raise ValueError("Too many per-inbound users in one packet")
    inbound_rows = []
    users = defaultdict(lambda: {"uplink": 0, "downlink": 0})
    for (user_id, tag), counters in grouped.items():
        inbound_rows.append({
            "userId": user_id, "inboundTag": tag,
            "uplinkBytes": counters["uplink"],
            "downlinkBytes": counters["downlink"],
        })
        users[user_id]["uplink"] += counters["uplink"]
        users[user_id]["downlink"] += counters["downlink"]
    user_rows = [
        {"userId": user_id, "uplinkBytes": c["uplink"], "downlinkBytes": c["downlink"]}
        for user_id, c in users.items()
    ]
    return {"userInboundTraffic": inbound_rows, "userTraffic": user_rows}


if __name__ == "__main__":
    try:
        result = collect(json.load(sys.stdin))
        # A bash-safe JSON suffix; only real recognized stats can enter it.
        print("," + json.dumps(result, ensure_ascii=True, separators=(",", ":"))[1:-1])
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeError) as err:
        print(f"Xray stats parser error: {err}", file=sys.stderr)
        sys.exit(1)
