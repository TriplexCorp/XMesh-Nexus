#!/usr/bin/env python3
"""Parser regression: real Xray StatsService user IDs are scoped to inbound."""
import importlib.util
from pathlib import Path

path=Path(__file__).resolve().parent.parent/"deploy/xray-stats-collector.py"
spec=importlib.util.spec_from_file_location("xmesh_xray_stats",path)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def stat(user,tag,direction,value):
    return {"name":f"user>>>xmesh-u{user}--{tag}>>>traffic>>>{direction}","value":str(value)}

payload={"stat":[stat(11,"DE_VLESS","uplink",100),stat(11,"DE_VLESS","downlink",200),
                 stat(11,"CDN%20DE","uplink",20),stat(11,"CDN%20DE","downlink",45),
                 stat(22,"DE_VLESS","uplink",80),
                 {"name":"inbound>>>DE_VLESS>>>traffic>>>downlink","value":"999999"}]}
parsed=mod.collect(payload)
rows={(x["userId"],x["inboundTag"]):x for x in parsed["userInboundTraffic"]}
assert rows[(11,"DE_VLESS")]["uplinkBytes"]==100
assert rows[(11,"DE_VLESS")]["downlinkBytes"]==200
assert rows[(11,"CDN DE")]["downlinkBytes"]==45
assert rows[(22,"DE_VLESS")]["uplinkBytes"]==80
users={u["userId"]:u for u in parsed["userTraffic"]}
assert users[11]["uplinkBytes"]==120
assert users[11]["downlinkBytes"]==245
assert users[22]["uplinkBytes"]==80
assert sum(x["downlinkBytes"] for x in parsed["userInboundTraffic"])==245
# The parser is the trust boundary between local Xray StatsService and the
# signed agent payload: malformed/ambiguous counters must never be submitted.
def rejects(payload, reason):
    try:
        mod.collect(payload)
    except ValueError:
        return
    raise AssertionError(f"Unsafe Xray counters accepted: {reason}")

rejects({}, "missing stat array")
rejects({"stat": "wrong-type"}, "invalid stat array")
rejects({"stat": [stat(11, "DE", "uplink", 1), stat(11, "DE", "uplink", 2)]},
        "duplicate counter")
rejects({"stat": [stat(11, "DE", "uplink", -1)]}, "negative counter")
rejects({"stat": [stat(11, "DE", "uplink", 2**63)]}, "out-of-range counter")
rejects({"stat": [{"name": stat(11, "DE", "uplink", 1)["name"], "value": True}]},
        "boolean counter")
rejects({"stat": [{"name": stat(11, "DE", "uplink", 1)["name"], "value": 1.5}]},
        "fractional counter")
rejects({"stat": [stat(11, "DE", "uplink", 2**63-1),
                    stat(11, "PL", "uplink", 1)]}, "aggregate overflow")
rejects({"stat": [stat(i, "DE", "uplink", 1) for i in range(1, 2050)]},
        "too many users for the backend telemetry envelope")
# Partial directions are legal during a new counter's first observation.
partial = mod.collect({"stat": [stat(1, "DE", "downlink", 9)]})
assert partial["userTraffic"] == [{"userId": 1, "uplinkBytes": 0, "downlinkBytes": 9}]
print("Xray per-user/per-inbound stats, overflow and malformed-input isolation: OK")
