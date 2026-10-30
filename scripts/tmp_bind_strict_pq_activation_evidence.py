#!/usr/bin/env python3
from pathlib import Path

p = Path('scripts/verify-xsp-v2-strict-pq-activation-approval.py')
text = p.read_text()

old = '''    expect_equal(candidate["finalCanaryResultSha256"], args.expected_final_canary_sha256, "releaseCandidate.finalCanaryResultSha256")
    expect_equal(candidate["rolloutPlanSha256"], args.expected_rollout_plan_sha256, "releaseCandidate.rolloutPlanSha256")

    evidence_ready = all(
'''
new = '''    expect_equal(candidate["finalCanaryResultSha256"], args.expected_final_canary_sha256, "releaseCandidate.finalCanaryResultSha256")
    expect_equal(candidate["rolloutPlanSha256"], args.expected_rollout_plan_sha256, "releaseCandidate.rolloutPlanSha256")
    if (
        args.expected_security_review_result_sha256 is not None
        and evidence["independentSecurityReviewResultSha256"] != args.expected_security_review_result_sha256
    ):
        fail("evidence.independentSecurityReviewResultSha256 does not match expected external review evidence")
    if (
        args.expected_physical_qualification_result_sha256 is not None
        and evidence["physicalPowerQualificationResultSha256"] != args.expected_physical_qualification_result_sha256
    ):
        fail("evidence.physicalPowerQualificationResultSha256 does not match expected physical qualification evidence")
    if (
        args.expected_rollout_plan_verifier_result_sha256 is not None
        and evidence["rolloutPlanVerifierResultSha256"] != args.expected_rollout_plan_verifier_result_sha256
    ):
        fail("evidence.rolloutPlanVerifierResultSha256 does not match expected rollout-plan verifier evidence")

    evidence_ready = all(
'''
if text.count(old) != 1:
    raise SystemExit('verifier: candidate/evidence binding anchor mismatch')
text = text.replace(old, new, 1)

old = '''                ("--expected-final-canary-sha256", args.expected_final_canary_sha256),
                ("--expected-rollout-plan-sha256", args.expected_rollout_plan_sha256),
            )
'''
new = '''                ("--expected-final-canary-sha256", args.expected_final_canary_sha256),
                ("--expected-rollout-plan-sha256", args.expected_rollout_plan_sha256),
                ("--expected-security-review-result-sha256", args.expected_security_review_result_sha256),
                ("--expected-physical-qualification-result-sha256", args.expected_physical_qualification_result_sha256),
                ("--expected-rollout-plan-verifier-result-sha256", args.expected_rollout_plan_verifier_result_sha256),
            )
'''
if text.count(old) != 1:
    raise SystemExit('verifier: required exact args anchor mismatch')
text = text.replace(old, new, 1)

old = '''    p.add_argument("--expected-final-canary-sha256")
    p.add_argument("--expected-rollout-plan-sha256")
    p.add_argument("--now", help="ISO-8601 verification time; defaults to current UTC")
'''
new = '''    p.add_argument("--expected-final-canary-sha256")
    p.add_argument("--expected-rollout-plan-sha256")
    p.add_argument("--expected-security-review-result-sha256")
    p.add_argument("--expected-physical-qualification-result-sha256")
    p.add_argument("--expected-rollout-plan-verifier-result-sha256")
    p.add_argument("--now", help="ISO-8601 verification time; defaults to current UTC")
'''
if text.count(old) != 1:
    raise SystemExit('verifier: parser anchor mismatch')
text = text.replace(old, new, 1)
p.write_text(text)

p = Path('docs/XSP_V2_STRICT_PQ_ACTIVATION_APPROVAL.md')
text = p.read_text()
old = '''- final **post-P0-E** canary result SHA-256;
- independently reviewed production rollout-plan SHA-256.
'''
new = '''- final **post-P0-E** canary result SHA-256;
- independently reviewed production rollout-plan SHA-256;
- independently validated security-review result SHA-256;
- independently validated physical-qualification result SHA-256;
- rollout-plan verifier-result SHA-256.
'''
if text.count(old) != 1:
    raise SystemExit('docs: exact prerequisites anchor mismatch')
text = text.replace(old, new, 1)
old = '''  --expected-final-canary-sha256 <64-hex> \\
  --expected-rollout-plan-sha256 <64-hex>
'''
new = '''  --expected-final-canary-sha256 <64-hex> \\
  --expected-rollout-plan-sha256 <64-hex> \\
  --expected-security-review-result-sha256 <64-hex> \\
  --expected-physical-qualification-result-sha256 <64-hex> \\
  --expected-rollout-plan-verifier-result-sha256 <64-hex>
'''
if text.count(old) != 1:
    raise SystemExit('docs: command example anchor mismatch')
text = text.replace(old, new, 1)
p.write_text(text)
