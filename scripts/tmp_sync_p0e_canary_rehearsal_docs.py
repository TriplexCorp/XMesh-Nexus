#!/usr/bin/env python3
from pathlib import Path

REPO = "TriplexCorp/XMesh-Nexus"
CANARY_SHA = "497def9b950d57152f2e0ca2abb7eb0657a8d22f"
CANARY_RUN = "41018421184"
BACKEND_RUN = "41018421315"
ARTIFACT_DIGEST = "cea8da4de7eb579d6bd190b7a646c0ed22e7bed3d17a99608553e7ca94a7d1c5"

readme_canary = (
    f"**Latest verified disposable release-canary rehearsal checkpoint:** [`{CANARY_SHA}`](https://github.com/{REPO}/commit/{CANARY_SHA}), merge of [PR #150](https://github.com/{REPO}/pull/150). "
    f"Post-merge canary run `{CANARY_RUN}` completed **success** on the exact merge SHA and re-proved the unchanged frozen runtime contract, real signed Agent install/upgrade/lost-response/restart/LKG rollback lifecycle, coordinated E3b recovery, and both default-off redacted observability surfaces. "
    f"The bounded result artifact digest is `sha256:{ARTIFACT_DIGEST}`. Post-merge Backend CI run `{BACKEND_RUN}` also completed **success**. "
    "**This is a rehearsal harness, not the final release canary: `finalReleaseCanarySatisfied=false` remains mandatory until P0-E external blockers are closed and the same harness is rerun against the exact post-review/post-qualification release candidate.**\n\n"
)

release_path = (
    "**Path to production PQ activation is now explicit:** (1) close the independent security review with attributable sign-off for the frozen target; "
    "(2) complete and explicitly record the five-run P0-E4a physical-power qualification; "
    "(3) if either step changes security-relevant code, re-freeze/re-review the changed exact candidate; "
    "(4) rerun the PR #150 disposable canary on that exact release candidate and require final release-canary acceptance; "
    "(5) approve the separate production topology/key/rollback plan; and only then "
    "(6) explicitly enable `strict-pq` for the approved rollout scope. Legacy XMESH1 retirement remains a separate explicit decision and is never an automatic fallback side effect.\n\n"
)

for name in ("README.md", "README.en.md"):
    p = Path(name)
    text = p.read_text()

    if "Latest verified disposable release-canary rehearsal checkpoint" in text:
        raise SystemExit(f"{name}: canary checkpoint already present")

    anchor = "**Latest verified P0-E4a returned-review acceptance checkpoint:**"
    start = text.find(anchor)
    if start < 0:
        raise SystemExit(f"{name}: missing E4a returned-review anchor")
    end = text.find("\n\n", start)
    if end < 0:
        raise SystemExit(f"{name}: malformed E4a returned-review paragraph")
    end += 2
    text = text[:end] + readme_canary + text[end:]

    old = (
        "The refreshed independent security-review handoff/evidence freeze, reproducible reviewer packaging, and fail-closed review-result acceptance tooling are COMPLETE as preparation only; "
        "independent review findings/sign-off and representative P0-E4a physical power-loss qualification remain OPEN. "
        "Neither a handoff, an individual gate nor green CI authorizes production rollout.**"
    )
    new = (
        "The refreshed independent security-review handoff/evidence freeze, reproducible reviewer packaging, fail-closed review-result acceptance tooling, and PR #150 disposable release-canary rehearsal harness are COMPLETE as preparation only; "
        "independent review findings/sign-off and representative P0-E4a physical power-loss qualification remain OPEN, and the final exact-candidate canary must be rerun after those blockers close. "
        "Neither a handoff, an individual gate nor green CI authorizes production rollout.**"
    )
    if text.count(old) != 1:
        raise SystemExit(f"{name}: expected exactly one status paragraph fragment")
    text = text.replace(old, new, 1)

    marker = "Any later security-relevant code change invalidates the freeze and requires re-freeze/re-review.\n\n"
    if text.count(marker) != 1:
        raise SystemExit(f"{name}: expected exactly one freeze-invalidates marker")
    text = text.replace(marker, marker + release_path, 1)
    p.write_text(text)

roadmap = Path("docs/ENTERPRISE_ROADMAP.md")
text = roadmap.read_text()
if "Latest disposable release-canary rehearsal / Nexus PR #150" in text:
    raise SystemExit("roadmap: canary checkpoint already present")

bullet_anchor = "- **Latest P0-E4a returned-review acceptance / Nexus PR #148:**"
start = text.find(bullet_anchor)
if start < 0:
    raise SystemExit("roadmap: missing PR #148 bullet")
end = text.find("\n", start)
if end < 0:
    raise SystemExit("roadmap: malformed PR #148 bullet")
end += 1
canary_bullet = (
    f"- **Latest disposable release-canary rehearsal / Nexus PR #150:** merge [`{CANARY_SHA}`](https://github.com/{REPO}/commit/{CANARY_SHA}) adds a reusable default-off release-rehearsal harness over the already-proven lifecycle/recovery/observability mechanisms. "
    f"Post-merge run `{CANARY_RUN}` is **success** on the exact merge SHA: source/freeze contract, real signed Agent install/upgrade/retry/restart/LKG rollback, current-Node E3b coordinated recovery and both redacted observability surfaces all pass; artifact digest is `sha256:{ARTIFACT_DIGEST}`. Backend CI run `{BACKEND_RUN}` is also **success**. "
    "The result intentionally keeps `finalReleaseCanarySatisfied=false`; after P0-E external review/physical qualification close, the harness must run again on the exact release candidate before production approval.\n"
)
text = text[:end] + canary_bullet + text[end:]

old_row = "| Production XSP-v2 rollout | **NOT AUTHORIZED** | P0-E + disposable canary + explicit production approval required |"
new_rows = (
    "| Disposable release-canary rehearsal harness | **COMPLETE — preparation only** | PR #150; exact-head + post-merge lifecycle/recovery/observability rehearsal green, but `finalReleaseCanarySatisfied=false` until post-P0-E exact-candidate rerun |\n"
    "| Production XSP-v2 rollout | **NOT AUTHORIZED** | Close P0-E external blockers → re-freeze if remediation changes security code → rerun final exact-candidate canary → reviewed rollout plan → explicit `strict-pq` approval |"
)
if text.count(old_row) != 1:
    raise SystemExit("roadmap: expected exactly one production rollout row")
text = text.replace(old_row, new_rows, 1)

old_list = """Before production rollout:\n\n1. P0-D must remain complete with its fail-closed invariants intact;\n2. P0-E must be complete, including the external physical-power evidence and independent security review;\n3. a disposable canary must prove install/upgrade/rollback/recovery/observability;\n4. production topology/DNS/firewall/Nginx/DB/key changes require a separately reviewed rollout plan;\n5. `strict-pq` activation and legacy XMESH1 retirement require explicit approval and must never occur as an automatic fallback/migration side effect."""
new_list = """Before production rollout:\n\n1. P0-D must remain complete with its fail-closed invariants intact;\n2. P0-E must be complete, including the external physical-power evidence and independent security review;\n3. PR #150 establishes the reusable disposable canary harness, but after P0-E closes it must be rerun on the exact final release candidate and only that post-P0-E run may satisfy the final canary gate;\n4. any security-relevant remediation after the current freeze requires an exact re-freeze/re-review before that final canary;\n5. production topology/DNS/firewall/Nginx/DB/key changes require a separately reviewed rollout/rollback plan;\n6. `strict-pq` activation requires explicit approval for the approved rollout scope; legacy XMESH1 retirement is a separate explicit decision and neither action may occur as an automatic fallback/migration side effect."""
if text.count(old_list) != 1:
    raise SystemExit("roadmap: expected exactly one pre-production numbered list")
text = text.replace(old_list, new_list, 1)

section_marker = "`strict-pq` remains **OFF** throughout P0-E unless a later explicit production/release gate separately authorizes activation. Production rollout remains separately gated and unauthorized.\n\n## Security guardrails"
section_new = """`strict-pq` remains **OFF** throughout P0-E unless a later explicit production/release gate separately authorizes activation. Production rollout remains separately gated and unauthorized.\n\n### Exact remaining sequence to production PQ\n\n1. **Independent review (#137):** obtain attributable review findings/dispositions/sign-off for the exact frozen target; remediation that changes security-relevant code requires re-freeze/re-review.\n2. **Physical qualification (#138):** execute the five representative abrupt-power runs, verify each E4a6 result, build the real E4a4 matrix, obtain independent qualification review, pass the PR #148 verifier, and record the later explicit reviewed qualification checkpoint.\n3. **Exact release candidate:** bind the post-review/post-qualification Nexus + Node revisions. If no security-relevant source changed, the existing review scope remains applicable; otherwise freeze/re-review the changed scope first.\n4. **Final disposable canary:** rerun the PR #150 harness on that exact candidate. Only this later run may set the release process's final canary condition; the rehearsal result on `497def9b950d57152f2e0ca2abb7eb0657a8d22f` remains preparation evidence.\n5. **Reviewed rollout/rollback plan:** approve production topology, DNS/firewall/Nginx, DB, signer/key custody, Agent cutover, observability and rollback sequencing for the exact candidate.\n6. **Explicit PQ activation:** enable `strict-pq` only for the approved scope. No automatic downgrade/fallback is permitted. Legacy XMESH1 retirement is a separate explicit follow-on decision after the approved PQ path is proven in production.\n\nThis sequence is intentionally finite: the strict PQ transport itself is already implemented and E2E-proven in staging; the remaining work is external assurance plus exact-candidate release authorization, not another protocol rewrite.\n\n## Security guardrails"""
if text.count(section_marker) != 1:
    raise SystemExit("roadmap: expected exactly one security-guardrails transition")
text = text.replace(section_marker, section_new, 1)
roadmap.write_text(text)
