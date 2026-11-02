#!/usr/bin/env python3
from pathlib import Path

p=Path('deploy/node-control-agent.sh')
s=p.read_text()
old='  "$bootstrap" --remote >"$log" 2>&1;then'
new='  /bin/bash "$bootstrap" --remote >"$log" 2>&1;then'
if old not in s:
    raise SystemExit('missing direct bootstrap execution anchor')
p.write_text(s.replace(old,new,1))

p=Path('scripts/check-agent-update.js')
s=p.read_text()
marker="  'fresh updater bootstrap must advertise the target-aware contract');"
if marker not in s:
    raise SystemExit('missing updater regression marker')
pos=s.index(marker)+len(marker)
extra=r'''
assert.match(controlAgent,/\/bin\/bash "\$bootstrap" --remote/,
  'fresh updater bootstrap must be interpreted by trusted bash so noexec /run cannot block updates');
assert.doesNotMatch(controlAgent,/^[ \t]*"\$bootstrap" --remote/m,
  'fresh updater bootstrap must never be executed directly from potentially noexec /run');'''
p.write_text(s[:pos]+extra+s[pos:])
