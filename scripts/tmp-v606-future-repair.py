from pathlib import Path
import subprocess

FILES = [
    'AGENT_VERSION',
    'backend/src/node_runtime.rs',
    'deploy/install-node-metrics-agent.sh',
    'deploy/node-control-agent.sh',
    'deploy/update-node-control-agent.sh',
    'deploy/xsp-v2-product-gateway/main.go',
    'docs/AGENT_RELEASE_POLICY.md',
    'scripts/check-agent-update-base.js',
    'scripts/check-agent-update.js',
]

for name in FILES:
    p = Path(name)
    p.write_text(p.read_text().replace('control-v6.0.5', 'control-v6.0.6'))

p = Path('deploy/node-control-agent.sh')
text = p.read_text()
if 'local expected_version="${1:-}" static_unit=' not in text:
    old = """run_agent_updater(){
 local static_unit=xmesh-node-agent-upgrade.service transient_unit=xmesh-node-agent-upgrade-repair
 local updater=/usr/local/sbin/xmesh-update-agent bootstrap='' rc=0
 UPDATER_ERROR=''
"""
    new = """run_agent_updater(){
 local expected_version="${1:-}" static_unit=xmesh-node-agent-upgrade.service transient_unit=xmesh-node-agent-upgrade-repair
 local updater=/usr/local/sbin/xmesh-update-agent bootstrap='' rc=0
 UPDATER_ERROR=''
 [[ "$expected_version" =~ ^control-v6\\.[0-9]+\\.[0-9]+$ ]] || { UPDATER_ERROR='Invalid expected Agent target version'; return 1; }
"""
    if old not in text:
        raise SystemExit('run_agent_updater header not found')
    text = text.replace(old, new, 1)
literal = """  if ! bash -n "$bootstrap" || ! grep -Fq 'AGENT_VERSION="control-v6.0.6"' "$bootstrap" || ! grep -Fq 'xmesh-node-agent-upgrade.service' "$bootstrap";then
"""
dynamic = """  if ! bash -n "$bootstrap" || ! grep -Fq "AGENT_VERSION=\\\"$expected_version\\\"" "$bootstrap" || ! grep -Fq 'xmesh-node-agent-upgrade.service' "$bootstrap";then
"""
if literal in text:
    text = text.replace(literal, dynamic, 1)
text = text.replace('elif run_agent_updater && verify_staged_agent_package "$release_version"', 'elif run_agent_updater "$release_version" && verify_staged_agent_package "$release_version"', 1)
text = text.replace('if run_agent_updater && grep -Fxq "AGENT_VERSION=\\\"$target_version\\\""', 'if run_agent_updater "$target_version" && grep -Fxq "AGENT_VERSION=\\\"$target_version\\\""', 1)
if text.count('run_agent_updater "$release_version"') != 1:
    raise SystemExit('release-version updater call missing')
if text.count('run_agent_updater "$target_version"') != 1:
    raise SystemExit('target-version updater call missing')
p.write_text(text)

subprocess.run(['bash', '-n', 'deploy/node-control-agent.sh'], check=True)
subprocess.run(['bash', '-n', 'deploy/update-node-control-agent.sh'], check=True)
subprocess.run(['node', 'scripts/check-agent-update.js'], check=True)
subprocess.run(['git', 'diff', '--check'], check=True)
