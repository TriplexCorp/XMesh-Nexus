#!/usr/bin/env python3
from pathlib import Path

p=Path('scripts/check-agent-update.js')
s=p.read_text()
old='targetAgentVersion\\s*=\\s*"control-v6[.]0[.]6"'
new='targetAgentVersion\\s*=\\s*"control-v6[.]0[.]7"'
if old not in s:
    raise SystemExit('missing dynamic target-version regex')
s=s.replace(old,new,1)
p.write_text(s)

p=Path('scripts/check-agent-update-base.js')
s=p.read_text()
old='control-v6[.]0[.]6'
if old not in s:
    raise SystemExit('missing baseline target-version regex')
s=s.replace(old,'control-v6[.]0[.]7')
lines=[]
replaced=False
for line in s.splitlines():
    if line.startswith('assert.match(agent,/grep -Fxq "AGENT_VERSION=') and '$target_version' in line:
        lines.append('assert.match(agent,/verify_agent_install "\\$target_version"/);')
        replaced=True
    else:
        lines.append(line)
if not replaced:
    raise SystemExit('missing legacy target-version success assertion')
p.write_text('\n'.join(lines)+'\n')
