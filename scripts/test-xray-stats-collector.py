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
print("Xray per-user/per-inbound stats and aggregate isolation: OK")
