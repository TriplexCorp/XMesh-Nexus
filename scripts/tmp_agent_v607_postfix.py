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
p.write_text(s)
