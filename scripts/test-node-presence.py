#!/usr/bin/env python3
"""Behavioral regression tests for the actual embedded node presence collector.

Runs the Python snippets shipped inside the Bash agent, not a duplicate model.
Uses a temporary state directory and never contacts a real panel or Xray.
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

agent = pathlib.Path("deploy/node-metrics-agent.sh").read_text(encoding="utf-8")
assert agent.count("# Distinct users with verified Xray byte increases") == 1
assert agent.count("curl --fail --silent --show-error --max-time 12") == 1

snapshot_start = 'snapshot_fragment="$(python3 - "$SNAPSHOT" "$XMESH_NODE_ID" <<\'PY\'\n'
snapshot_end = '\nPY\n)";then'
assert snapshot_start in agent
snapshot_code = agent.split(snapshot_start, 1)[1].split(snapshot_end, 1)[0]

counter_start = 'online_count="$(printf \'%s\' "$payload" | python3 -c \'\n'
counter_end = '\n\' "$state_dir/online-users.json")" || online_count=""'
assert counter_start in agent and counter_end in agent
counter_code = agent.split(counter_start, 1)[1].split(counter_end, 1)[0]


def run_python(code, args, payload=None):
    return subprocess.run(
        [sys.executable, "-c", code, *map(str, args)],
        input=None if payload is None else json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
        timeout=5,
    )


def counters(user_id, up, down):
    return {"userTraffic": [{"userId": user_id, "uplinkBytes": up, "downlinkBytes": down}]}


with tempfile.TemporaryDirectory() as temporary:
    state = pathlib.Path(temporary) / "online-users.json"
    first = run_python(counter_code, [state], counters(7, 100, 500))
    assert first.returncode == 0 and first.stdout.strip() == "null", first.stderr

    active = run_python(counter_code, [state], counters(7, 120, 500))
    assert active.returncode == 0 and active.stdout.strip() == "1", active.stderr

    unchanged = run_python(counter_code, [state], counters(7, 120, 500))
    assert unchanged.returncode == 0 and unchanged.stdout.strip() == "1", unchanged.stderr

    snapshot = json.loads(state.read_text(encoding="utf-8"))
    snapshot["users"]["7"]["last"] = int(time.time()) - 46
    state.write_text(json.dumps(snapshot), encoding="utf-8")
    idle = run_python(counter_code, [state], counters(7, 120, 500))
    assert idle.returncode == 0 and idle.stdout.strip() == "0", idle.stderr

    mixed_reset = run_python(counter_code, [state], counters(7, 130, 5))
    assert mixed_reset.returncode == 0 and mixed_reset.stdout.strip() == "0", mixed_reset.stderr

    next_delta = run_python(counter_code, [state], counters(7, 131, 5))
    assert next_delta.returncode == 0 and next_delta.stdout.strip() == "1", next_delta.stderr

    repeated = {"userTraffic": [
        {"userId": 7, "uplinkBytes": 1, "downlinkBytes": 2},
        {"userId": 7, "uplinkBytes": 1, "downlinkBytes": 2},
    ]}
    assert run_python(counter_code, [state], repeated).returncode != 0

    root_snapshot = pathlib.Path(temporary) / "root-snapshot.json"
    now = int(time.time() * 1000)
    payload = {
        "nodeId": 7, "sampledAtMs": now,
        "userTraffic": [{"userId": 7, "uplinkBytes": 140, "downlinkBytes": 500}],
        "userInboundTraffic": [{"userId": 7, "inboundTag": "vless-main", "uplinkBytes": 140, "downlinkBytes": 500}],
    }
    root_snapshot.write_text(json.dumps(payload), encoding="utf-8")
    verified = run_python(snapshot_code, [root_snapshot, 7])
    assert verified.returncode == 0, verified.stderr
    lines = verified.stdout.splitlines()
    assert len(lines) == 2 and int(lines[0]) == now
    fragment = json.loads("{" + lines[1].lstrip(",") + "}")
    assert fragment["userTraffic"][0]["userId"] == 7

    payload["sampledAtMs"] = now - 31_000
    root_snapshot.write_text(json.dumps(payload), encoding="utf-8")
    assert run_python(snapshot_code, [root_snapshot, 7]).returncode != 0

    payload["sampledAtMs"] = now
    payload["userTraffic"] *= 2
    root_snapshot.write_text(json.dumps(payload), encoding="utf-8")
    assert run_python(snapshot_code, [root_snapshot, 7]).returncode != 0

print("Node presence: real producer-time verification, 45s TTL, idle and reset: PASS")
