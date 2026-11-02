#!/usr/bin/env python3
from pathlib import Path

p=Path('scripts/tmp_agent_v607_codemod.py')
s=p.read_text()
start=s.index('anchor = "assert.doesNotMatch(controlAgent')
end=s.index('write(path, text)\n\npath = "scripts/check-agent-update-base.js"', start)
replacement='''marker = "  \'repair bootstrap must never pin validation to the running Agent release literal\');"
pos = text.index(marker) + len(marker)
extra = "\\nassert.match(controlAgent,/update-node-control-agent[.]sh -o \\\\\"\\$bootstrap\\\\\"/,\\n  \'signed update path must fetch a fresh updater bootstrap for every target release\');\\nassert.match(controlAgent,/grep -Fq \'XMESH_TARGET_AWARE_UPDATER=1\' \\\\\"\\$bootstrap\\\\\"/,\\n  \'fresh updater bootstrap must advertise the target-aware contract\');\\nassert.doesNotMatch(controlAgent,/systemctl start --wait \\\\\"\\$static_unit\\\\\"/,\\n  \'signed updates must never blindly execute the updater frozen into the previous release\');\\nassert.match(controlAgent,/verify_agent_install \\\\\"\\$target_version\\\\\"/,\\n  \'legacy update success must require the full post-install runtime self-test\');\\nassert.match(controlAgent,/sanitize_updater_error/,\\n  \'failed updates must return a bounded sanitized updater reason instead of a generic systemd exit code\');"
text = text[:pos] + extra + text[pos:]
'''
s=s[:start]+replacement+s[end:]
p.write_text(s)
