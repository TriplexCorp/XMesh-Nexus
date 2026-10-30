#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1))


readmes = ["README.md", "README.en.md"]
old_top = """**Latest verified Nexus P0-E review-preparation checkpoint:** [`7b84a9e45f9e9cf815b95a06d1560f84d8d3f0a2`](https://github.com/TriplexCorp/XMesh-Nexus/commit/7b84a9e45f9e9cf815b95a06d1560f84d8d3f0a2), merge of [PR #135](https://github.com/TriplexCorp/XMesh-Nexus/pull/135). Node PR #51 plus Nexus PRs #133–#134 close bounded default-off redacted observability, and PR #135 freezes the exact Node/Nexus evidence package for independent security review. **The independent security review itself is still OPEN, and P0-E4a remains CURRENT/OPEN until five representative physical abrupt-power runs are actually executed and independently reviewed.**"""
new_top = """**Latest verified Nexus P0-E review-preparation checkpoint:** [`553bbfa70d993a5c53b054ea1105fc8feb0c1827`](https://github.com/TriplexCorp/XMesh-Nexus/commit/553bbfa70d993a5c53b054ea1105fc8feb0c1827), merge of [PR #142](https://github.com/TriplexCorp/XMesh-Nexus/pull/142). PR #142 refreshes the bounded independent-review package and freezes exact targets Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`, explicitly including the post-#135 Rust staging-ingress hardening from PRs #139/#140. Its exact-head and post-merge handoff workflow completed **success**. **Freeze preparation is COMPLETE; the independent security review/findings/sign-off itself is still OPEN, and P0-E4a remains CURRENT/OPEN until five representative physical abrupt-power runs are actually executed and independently reviewed.**"""

old_stale = """PRs #139 and #140 are security-relevant staging-runtime changes made after PR #135 froze Nexus target `5cdb7825fcc51f8a7d296b992a7da4492ed2ce8e`. The PR #135 package therefore remains a historical review-preparation baseline but no longer covers current `main`; the repo-side P0-E review gate requires a refreshed exact target including merge `03679120726ff06005eff903909b262fb1271960` (or later reviewed remediation) before independent findings/sign-off can close P0-E."""
new_stale = """PR #142 supersedes the stale PR #135 Nexus review target for current-review applicability. The active frozen review target is Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`; it includes the PR #139/#140 Rust origin/ACK/recovery hardening. The remaining repo-side P0-E review blocker is now externally attributable independent findings, remediation disposition and sign-off for that frozen target. Any later security-relevant code change invalidates the freeze and requires re-freeze/re-review."""

old_pr135 = """- **Nexus PR #135 / independent security-review handoff freeze:** Nexus merge `7b84a9e45f9e9cf815b95a06d1560f84d8d3f0a2` freezes exact review targets Nexus `5cdb7825fcc51f8a7d296b992a7da4492ed2ce8e` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`, 11 mandatory review domains and the evidence index while explicitly keeping independent review, physical qualification, production activation and `strict-pq` OPEN/OFF. This is preparation, not external sign-off."""
new_pr142 = """- **Nexus PR #142 / refreshed independent security-review freeze:** Nexus merge `553bbfa70d993a5c53b054ea1105fc8feb0c1827` supersedes the PR #135 Nexus target for current-review applicability and freezes Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + unchanged Node `083dc181c5e175f89007f4b93111cd5c45a69d97`. Contract v2 explicitly indexes PRs #139/#140 Rust implementation evidence, re-runs the frozen C2-A/C2-B/C2-C source contracts, proves the handoff delta contains no runtime source, and keeps `independentSecurityReviewComplete=false`, `physicalPowerLossQualified=false`, `productionActivation=false` and `strictPQEnabled=false`."""

old_review = """Nexus PR #135 freezes the independent-review target at Nexus `5cdb7825fcc51f8a7d296b992a7da4492ed2ce8e` and Node `083dc181c5e175f89007f4b93111cd5c45a69d97`, indexes 11 required review domains/evidence, and deliberately keeps `independentSecurityReviewComplete=false`, `physicalPowerLossQualified=false`, `productionActivation=false` and `strictPQEnabled=false`. This is review preparation only.

Because PRs #139/#140 are security-relevant runtime hardening after that freeze, current `main` is no longer covered by the PR #135 target. Closing the repo-side P0-E review gate now requires a refreshed exact freeze that includes those merged Rust changes (or later reviewed remediation), followed by independently attributable findings, remediation disposition and sign-off. The five real E4a physical-power experiments and their independent evidence review remain the parallel external/hardware blocker. Neither the handoff, Rust migration nor green CI counts as independent review or authorizes production rollout."""
new_review = """Nexus PR #135 remains the historical first handoff baseline, but its Nexus target predates the security-relevant Rust runtime hardening in PRs #139/#140. Nexus PR #142 merge `553bbfa70d993a5c53b054ea1105fc8feb0c1827` refreshes the bounded package and now freezes exact targets Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`. Contract v2 includes the Rust origin/ACK/recovery implementation evidence and still deliberately keeps `independentSecurityReviewComplete=false`, `physicalPowerLossQualified=false`, `productionActivation=false` and `strictPQEnabled=false`.

The repo-side freeze/preparation work is therefore COMPLETE. Closing the P0-E review gate now requires independently attributable findings, remediation disposition and final sign-off for that exact frozen target. Any later security-relevant remediation invalidates the freeze and requires the affected scope to be re-frozen/re-reviewed. The five real E4a physical-power experiments and their independent evidence review remain the parallel external/hardware blocker. Neither the handoff, Rust migration nor green CI counts as independent review or authorizes production rollout."""

for path in readmes:
    replace_once(path, old_top, new_top)
    replace_once(path, old_stale, new_stale)
    replace_once(path, old_pr135, old_pr135 + "\n" + new_pr142)
    replace_once(path, old_review, new_review)
    replace_once(
        path,
        "The independent security-review handoff/evidence freeze is also COMPLETE as preparation only; independent review findings/sign-off and representative P0-E4a physical power-loss qualification remain OPEN.",
        "The refreshed independent security-review handoff/evidence freeze is COMPLETE as preparation only; independent review findings/sign-off and representative P0-E4a physical power-loss qualification remain OPEN.",
    )

roadmap = "docs/ENTERPRISE_ROADMAP.md"
old_rm_top = """- **Latest verified Nexus P0-E review-preparation checkpoint:** [`7b84a9e45f9e9cf815b95a06d1560f84d8d3f0a2`](https://github.com/TriplexCorp/XMesh-Nexus/commit/7b84a9e45f9e9cf815b95a06d1560f84d8d3f0a2), merge of [PR #135](https://github.com/TriplexCorp/XMesh-Nexus/pull/135). Node PR #51 plus Nexus PRs #133–#134 close bounded default-off redacted observability; PR #135 freezes the exact Node/Nexus evidence package for external independent security review. The current repo-side P0-E release gate is independent security-review findings/sign-off. P0-E4a remains OPEN until five representative physical abrupt-power experiments are executed and independently reviewed."""
new_rm_top = """- **Latest verified Nexus P0-E review-preparation checkpoint:** [`553bbfa70d993a5c53b054ea1105fc8feb0c1827`](https://github.com/TriplexCorp/XMesh-Nexus/commit/553bbfa70d993a5c53b054ea1105fc8feb0c1827), merge of [PR #142](https://github.com/TriplexCorp/XMesh-Nexus/pull/142). PR #142 refreshes the bounded independent-review package and freezes exact targets Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`, including PRs #139/#140 Rust origin/ACK/recovery hardening. Its exact-head and post-merge handoff workflow completed **success**. Freeze preparation is COMPLETE; independent findings/remediation/sign-off remain OPEN. P0-E4a remains OPEN until five representative physical abrupt-power experiments are executed and independently reviewed."""
replace_once(roadmap, old_rm_top, new_rm_top)

replace_once(
    roadmap,
    "These are security-relevant post-#135 changes, so the PR #135 frozen Nexus target does **not** cover current `main`; a refreshed review freeze is required before independent sign-off can close P0-E.",
    "These security-relevant post-#135 changes are now explicitly included in the refreshed PR #142 frozen review package; independent findings/remediation/sign-off are still required before P0-E can close.",
)

old_rm_pr135 = """- **Independent security-review handoff / Nexus PR #135:** Nexus merge [`7b84a9e45f9e9cf815b95a06d1560f84d8d3f0a2`](https://github.com/TriplexCorp/XMesh-Nexus/commit/7b84a9e45f9e9cf815b95a06d1560f84d8d3f0a2) freezes exact review targets Nexus `5cdb7825fcc51f8a7d296b992a7da4492ed2ce8e` and Node `083dc181c5e175f89007f4b93111cd5c45a69d97`, 11 required review domains, evidence documents/contracts and the two remaining external blockers. The contract explicitly leaves `independentSecurityReviewComplete=false`, `physicalPowerLossQualified=false`, `productionActivation=false` and `strictPQEnabled=false`; it is preparation, not independent review."""
new_rm_pr142 = """- **Refreshed independent security-review handoff / Nexus PR #142:** Nexus merge [`553bbfa70d993a5c53b054ea1105fc8feb0c1827`](https://github.com/TriplexCorp/XMesh-Nexus/commit/553bbfa70d993a5c53b054ea1105fc8feb0c1827) supersedes the stale PR #135 Nexus target for current-review applicability and freezes Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`. Contract v2 adds explicit PR #139/#140 Rust implementation evidence, re-runs frozen source contracts and proves the handoff PR itself has no runtime-source delta. All release/qualification flags remain false; this is preparation, not external review sign-off."""
replace_once(roadmap, old_rm_pr135, old_rm_pr135 + "\n" + new_rm_pr142)

replace_once(
    roadmap,
    "| Independent security review | **CURRENT repo-side release sub-gate — refreshed freeze + external sign-off required** | PR #135 freeze predates security-relevant PRs #139/#140; freeze current exact Node/Nexus targets, then obtain independent findings, remediation disposition and sign-off |",
    "| Independent security review | **CURRENT repo-side release sub-gate — external sign-off required** | PR #142 freezes Nexus `8c64a8e5...` + Node `083dc181...`, including PRs #139/#140; obtain independent findings, remediation disposition and sign-off |",
)
replace_once(
    roadmap,
    "| **P0-E recovery/security release gates** | **CURRENT P0** | Remaining blockers: real E4a physical-power matrix + independent evidence review, plus refreshed post-#140 review freeze and independent architecture/security findings/sign-off; observability and the earlier review handoff are complete |",
    "| **P0-E recovery/security release gates** | **CURRENT P0** | Remaining blockers: real E4a physical-power matrix + independent evidence review, plus independent architecture/security findings/remediation/sign-off for the refreshed PR #142 frozen target; observability and review-freeze preparation are complete |",
)

replace_once(
    roadmap,
    "Because they landed after the PR #135 independent-review freeze, current `main` must be re-frozen for external review before the repo-side P0-E review gate can close.",
    "PR #142 now re-freezes the exact review package including this Rust hardening. The remaining repo-side P0-E review blocker is external independent findings/remediation/sign-off for the frozen target.",
)

old_rm_review = """Nexus PR #135 at `7b84a9e45f9e9cf815b95a06d1560f84d8d3f0a2` freezes the independent-review handoff around exact Nexus target `5cdb7825fcc51f8a7d296b992a7da4492ed2ce8e` and Node target `083dc181c5e175f89007f4b93111cd5c45a69d97`, 11 required review domains, evidence documents/contracts and two still-open external blockers. Its contract deliberately keeps `independentSecurityReviewComplete=false`, `physicalPowerLossQualified=false`, `productionActivation=false` and `strictPQEnabled=false`.

PRs #139 and #140 landed after that freeze and change the security-sensitive staging origin/ACK/recovery runtime implementation. The PR #135 package remains useful historical review-preparation evidence, but its frozen Nexus target no longer represents current `main`.

The current repo-side release blocker is therefore a **refreshed exact review freeze that includes the merged Rust ingress/runtime hardening, followed by independent security-review findings, remediation disposition and sign-off**. The real five-run E4a physical-power matrix and independent evidence review remain the parallel external/hardware blocker. Neither the earlier handoff, the Rust migration nor green CI counts as independent review or authorizes rollout."""
new_rm_review = """Nexus PR #135 at `7b84a9e45f9e9cf815b95a06d1560f84d8d3f0a2` remains the historical first handoff baseline around Nexus `5cdb7825fcc51f8a7d296b992a7da4492ed2ce8e` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`; its Nexus target predates the security-relevant Rust origin/ACK/recovery changes in PRs #139/#140.

Nexus PR #142 merge `553bbfa70d993a5c53b054ea1105fc8feb0c1827` refreshes the bounded review package and freezes exact targets Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + unchanged Node `083dc181c5e175f89007f4b93111cd5c45a69d97`. Contract v2 explicitly indexes the post-#135 Rust implementation evidence and keeps `independentSecurityReviewComplete=false`, `physicalPowerLossQualified=false`, `productionActivation=false` and `strictPQEnabled=false`. Exact-head and post-merge freeze workflows are green.

The repo-side freeze/preparation step is therefore **COMPLETE**. The current repo-side release blocker is independently attributable **security-review findings, remediation disposition and final sign-off** for that exact frozen target. Any later security-relevant code change invalidates the freeze and requires the affected scope to be re-frozen/re-reviewed. The real five-run E4a physical-power matrix and independent evidence review remain the parallel external/hardware blocker. Neither the handoff, the Rust migration nor green CI counts as independent review or authorizes rollout."""
replace_once(roadmap, old_rm_review, new_rm_review)

replace_once(
    roadmap,
    "- The PR #135 frozen Nexus review target predates PRs #139/#140; current `main` requires a refreshed exact freeze before independent sign-off can apply to the release candidate.",
    "- PR #142 refreshes the exact review package to Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`; any later security-relevant code change invalidates that freeze and requires re-freeze/re-review.",
)
