#!/usr/bin/env python3
from pathlib import Path

p = Path('scripts/verify-xsp-v2-strict-pq-activation-approval.py')
text = p.read_text()
old = '''    max_nodes = contract["maxNodesPerApproval"]
    max_window = contract["maxApprovalWindowSeconds"]
    if not isinstance(max_nodes, int) or isinstance(max_nodes, bool) or not 1 <= max_nodes <= 100:
        fail("contract.maxNodesPerApproval must be integer 1..100")
    if not isinstance(max_window, int) or isinstance(max_window, bool) or not 60 <= max_window <= 86400:
        fail("contract.maxApprovalWindowSeconds must be integer 60..86400")
'''
new = '''    max_nodes = contract["maxNodesPerApproval"]
    max_window = contract["maxApprovalWindowSeconds"]
    if max_nodes != 50:
        fail("contract.maxNodesPerApproval must remain exactly 50")
    if max_window != 86400:
        fail("contract.maxApprovalWindowSeconds must remain exactly 86400")
'''
if text.count(old) != 1:
    raise SystemExit('verifier: maxNodes/window block mismatch')
text = text.replace(old, new, 1)

old = '''    if contract["requiredEvidence"] != [
        "p0EComplete",
        "independentSecurityReviewAccepted",
        "physicalPowerQualificationAccepted",
        "finalCanaryPassed",
        "rolloutPlanEligible",
    ]:
        fail("contract.requiredEvidence changed")
'''
new = '''    if contract["requiredEvidence"] != [
        "p0EComplete",
        "independentSecurityReviewAccepted",
        "physicalPowerQualificationAccepted",
        "finalCanaryPassed",
        "rolloutPlanEligible",
    ]:
        fail("contract.requiredEvidence changed")
    if contract["forbiddenFieldNames"] != [
        "command",
        "commands",
        "script",
        "scripts",
        "shell",
        "privateKey",
        "privateKeyPem",
        "secret",
        "secrets",
        "password",
        "token",
        "credential",
        "credentials",
        "url",
        "urls",
    ]:
        fail("contract.forbiddenFieldNames changed")
'''
if text.count(old) != 1:
    raise SystemExit('verifier: requiredEvidence block mismatch')
text = text.replace(old, new, 1)
p.write_text(text)

p = Path('.github/workflows/xsp-strict-pq-activation-approval.yml')
text = p.read_text()
old = """          x = copy.deepcopy(base); x['scope']['privateKey'] = 'forbidden'; dump('bad-private-field.json', x)\n          PY\n"""
new = """          x = copy.deepcopy(base); x['scope']['privateKey'] = 'forbidden'; dump('bad-private-field.json', x)\n\n          contract = json.load(open('deploy/xsp-v2-strict-pq-activation-approval.contract.json', encoding='utf-8'))\n          x = copy.deepcopy(contract); x['maxNodesPerApproval'] = 51; dump('bad-contract-nodes.json', x)\n          x = copy.deepcopy(contract); x['maxApprovalWindowSeconds'] = 172800; dump('bad-contract-window.json', x)\n          x = copy.deepcopy(contract); x['forbiddenFieldNames'].remove('privateKey'); dump('bad-contract-forbidden.json', x)\n          PY\n"""
if text.count(old) != 1:
    raise SystemExit('workflow: fixture anchor mismatch')
text = text.replace(old, new, 1)
old = """          ! python3 scripts/verify-xsp-v2-strict-pq-activation-approval.py \\\n            --approval /tmp/eligible.json --require-eligible --now 2026-10-30T11:00:00Z\n"""
new = """          ! python3 scripts/verify-xsp-v2-strict-pq-activation-approval.py \\\n            --approval /tmp/eligible.json --require-eligible --now 2026-10-30T11:00:00Z\n          for contract in /tmp/bad-contract-nodes.json /tmp/bad-contract-window.json /tmp/bad-contract-forbidden.json; do\n            ! python3 scripts/verify-xsp-v2-strict-pq-activation-approval.py \\\n              --approval /tmp/eligible.json --contract "$contract" "${common[@]}"\n          done\n"""
if text.count(old) != 1:
    raise SystemExit('workflow: negative-test anchor mismatch')
text = text.replace(old, new, 1)
p.write_text(text)
