#!/usr/bin/env python3
from pathlib import Path

p=Path('scripts/tmp_agent_v607_codemod.py')
s=p.read_text()

# Replace the fragile dynamic-check insertion with a semantic marker search.
start=s.index('anchor = "assert.doesNotMatch(controlAgent')
end=s.index('write(path, text)\n\npath = "scripts/check-agent-update-base.js"', start)
replacement="""marker = \"  'repair bootstrap must never pin validation to the running Agent release literal');\"
pos = text.index(marker) + len(marker)
extra = r'''
assert.match(controlAgent,/update-node-control-agent[.]sh -o \"\\$bootstrap\"/,
  'signed update path must fetch a fresh updater bootstrap for every target release');
assert.match(controlAgent,/grep -Fq 'XMESH_TARGET_AWARE_UPDATER=1' \"\\$bootstrap\"/,
  'fresh updater bootstrap must advertise the target-aware contract');
assert.doesNotMatch(controlAgent,/systemctl start --wait \"\\$static_unit\"/,
  'signed updates must never blindly execute the updater frozen into the previous release');
assert.match(controlAgent,/verify_agent_install \"\\$target_version\"/,
  'legacy update success must require the full post-install runtime self-test');
assert.match(controlAgent,/sanitize_updater_error/,
  'failed updates must return a bounded sanitized updater reason instead of a generic systemd exit code');'''
text = text[:pos] + extra + text[pos:]
"""
s=s[:start]+replacement+s[end:]

# Replace the baseline-check insertion the same way: find the existing MODE
# assertion line instead of depending on its regex escaping.
start=s.index("anchor = 'assert.match(updater,/MODE=")
end=s.index('write(path, text)\n\nassert read("AGENT_VERSION")', start)
replacement="""marker = next(line for line in text.splitlines() if line.startswith('assert.match(updater,/MODE='))
pos = text.index(marker) + len(marker)
extra = r'''
assert.match(updater,/XMESH_TARGET_AWARE_UPDATER=1/,'Updater must expose stable target-aware marker');
assert.match(agent,/sanitize_updater_error/,'Control Agent must preserve safe updater failure context');
assert.doesNotMatch(agent,/systemctl start --wait \"\\$static_unit\"/,'Signed path must not execute stale static updater');'''
text = text[:pos] + extra + text[pos:]
"""
s=s[:start]+replacement+s[end:]
p.write_text(s)
