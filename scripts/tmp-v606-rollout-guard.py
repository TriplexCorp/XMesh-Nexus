from pathlib import Path
import subprocess

p = Path('deploy/xsp-v2-product-gateway/main.go')
text = p.read_text()
text = text.replace('previousAgentVersion   = "control-v6.0.4"', 'previousAgentVersion   = "control-v6.0.5"')
p.write_text(text)

p = Path('scripts/check-agent-update.js')
text = p.read_text()
text = text.replace("const gateway=originalReadFileSync('deploy/xsp-v2-product-gateway/main.go','utf8');", "const gateway=originalReadFileSync('deploy/xsp-v2-product-gateway/main.go','utf8');\nconst controlAgent=originalReadFileSync('deploy/node-control-agent.sh','utf8');")
text = text.replace('/previousAgentVersion\\s*=\\s*"control-v6[.]0[.]4"/', '/previousAgentVersion\\s*=\\s*"control-v6[.]0[.]5"/')
needle = "assert.match(gateway,/repairAgentVersion\\s*=\\s*\"control-v6[.]0[.]0\"/,\n  'v6.0.0 bootstrap-hole nodes remain temporarily repairable');\n"
addition = needle + "assert.match(controlAgent,/local expected_version=\"\\$\\{1:-\\}\"/,\n  'updater repair must receive the commanded target Agent version');\nassert.match(controlAgent,/grep -Fq \"AGENT_VERSION=\\\\\"\\$expected_version\\\\\"\" \"\\$bootstrap\"/,\n  'downloaded repair updater must be validated against the commanded target version');\nassert.match(controlAgent,/run_agent_updater \"\\$release_version\"/,\n  'manifest-bound updates must pass the signed release version into updater repair');\nassert.match(controlAgent,/run_agent_updater \"\\$target_version\"/,\n  'legacy fixed updates must pass the backend target version into updater repair');\nassert.doesNotMatch(controlAgent,/grep -Fq ['\"]AGENT_VERSION=\\\\\"control-v6[.]0[.]6\\\\\"['\"] \"\\$bootstrap\"/,\n  'repair bootstrap must never pin validation to the running Agent release literal');\n"
if needle not in text:
    raise SystemExit('repair Agent assertion anchor missing')
if 'updater repair must receive the commanded target Agent version' not in text:
    text = text.replace(needle, addition, 1)
p.write_text(text)

p = Path('docs/AGENT_RELEASE_POLICY.md')
text = p.read_text()
anchor = 'A rolling upgrade may explicitly accept the immediately previous Agent version so existing nodes keep working while they upgrade. The panel must still advertise only the newest target version.\n'
extra = anchor + '\nUpdater self-repair must validate a downloaded bootstrap against the **commanded target Agent version** from the authenticated/signed update request. It must never pin repair validation to a literal version embedded in the older running Agent; otherwise a missing updater unit could deadlock the next release.\n'
if anchor not in text:
    raise SystemExit('policy rollout anchor missing')
if 'commanded target Agent version' not in text:
    text = text.replace(anchor, extra, 1)
p.write_text(text)

subprocess.run(['bash', '-n', 'deploy/node-control-agent.sh'], check=True)
subprocess.run(['node', 'scripts/check-agent-update.js'], check=True)
subprocess.run(['git', 'diff', '--check'], check=True)
