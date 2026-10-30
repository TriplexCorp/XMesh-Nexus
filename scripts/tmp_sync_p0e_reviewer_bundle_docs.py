#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1))


review_checkpoint = """**Latest verified Nexus P0-E review-preparation checkpoint:** [`553bbfa70d993a5c53b054ea1105fc8feb0c1827`](https://github.com/TriplexCorp/XMesh-Nexus/commit/553bbfa70d993a5c53b054ea1105fc8feb0c1827), merge of [PR #142](https://github.com/TriplexCorp/XMesh-Nexus/pull/142). PR #142 refreshes the bounded independent-review package and freezes exact targets Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`, explicitly including the post-#135 Rust staging-ingress hardening from PRs #139/#140. Its exact-head and post-merge handoff workflow completed **success**. **Freeze preparation is COMPLETE; the independent security review/findings/sign-off itself is still OPEN, and P0-E4a remains CURRENT/OPEN until five representative physical abrupt-power runs are actually executed and independently reviewed.**"""

bundle_checkpoint = """**Latest verified reviewer-packaging checkpoint:** [`f72250f93f89a5b2717a379370b8029150dadb97`](https://github.com/TriplexCorp/XMesh-Nexus/commit/f72250f93f89a5b2717a379370b8029150dadb97), merge of [PR #144](https://github.com/TriplexCorp/XMesh-Nexus/pull/144). PR #144 adds reproducible content-addressed reviewer convenience packaging for the already-frozen target without changing it. Post-merge bundle run `41013465969` completed **success**, built the package twice byte-for-byte, independently revalidated the manifest, and produced deterministic tar SHA-256 `f095f19217a072ef7919663744fcdfbc847783eb23be5a64b0f8df37b8952ced` with bundle payload digest `fb3a9bb9c3de2a462a8b338357b0a068dfdbe70a05f0dca81735006786b25b38`. **This is packaging only: it completes no independent-review domain and does not alter the frozen Nexus/Node revisions.**"""

pr142_bullet = """- **Nexus PR #142 / refreshed independent security-review freeze:** Nexus merge `553bbfa70d993a5c53b054ea1105fc8feb0c1827` supersedes the PR #135 Nexus target for current-review applicability and freezes Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + unchanged Node `083dc181c5e175f89007f4b93111cd5c45a69d97`. Contract v2 explicitly indexes PRs #139/#140 Rust implementation evidence, re-runs the frozen C2-A/C2-B/C2-C source contracts, proves the handoff delta contains no runtime source, and keeps `independentSecurityReviewComplete=false`, `physicalPowerLossQualified=false`, `productionActivation=false` and `strictPQEnabled=false`."""

pr144_bullet = """- **Nexus PR #144 / reproducible reviewer convenience bundle:** Nexus merge `f72250f93f89a5b2717a379370b8029150dadb97` adds a standard-library Python builder and dedicated CI that package the exact PR #142 frozen Nexus/Node sources plus indexed evidence without modifying those sources. The workflow builds twice and requires byte-for-byte equality, independently verifies per-file SHA-256/size records, emits `MANIFEST.json` + `SHA256SUMS`, and creates a deterministic transport tar. Post-merge run `41013465969` is success; deterministic tar SHA-256 is `f095f19217a072ef7919663744fcdfbc847783eb23be5a64b0f8df37b8952ced`. This packaging is not security-review sign-off."""

for path in ("README.md", "README.en.md"):
    replace_once(path, review_checkpoint, review_checkpoint + "\n\n" + bundle_checkpoint)
    replace_once(path, pr142_bullet, pr142_bullet + "\n" + pr144_bullet)

roadmap = "docs/ENTERPRISE_ROADMAP.md"
rm_review = """- **Latest verified Nexus P0-E review-preparation checkpoint:** [`553bbfa70d993a5c53b054ea1105fc8feb0c1827`](https://github.com/TriplexCorp/XMesh-Nexus/commit/553bbfa70d993a5c53b054ea1105fc8feb0c1827), merge of [PR #142](https://github.com/TriplexCorp/XMesh-Nexus/pull/142). PR #142 refreshes the bounded independent-review package and freezes exact targets Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`, including PRs #139/#140 Rust origin/ACK/recovery hardening. Its exact-head and post-merge handoff workflow completed **success**. Freeze preparation is COMPLETE; independent findings/remediation/sign-off remain OPEN. P0-E4a remains OPEN until five representative physical abrupt-power experiments are executed and independently reviewed."""
rm_bundle = """- **Latest reviewer convenience packaging / Nexus PR #144:** merge [`f72250f93f89a5b2717a379370b8029150dadb97`](https://github.com/TriplexCorp/XMesh-Nexus/commit/f72250f93f89a5b2717a379370b8029150dadb97) adds deterministic packaging for the already-frozen PR #142 target. Post-merge run `41013465969` checks out exact Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`, builds the bundle twice byte-for-byte, independently verifies `MANIFEST.json`/`SHA256SUMS`, and emits deterministic tar SHA-256 `f095f19217a072ef7919663744fcdfbc847783eb23be5a64b0f8df37b8952ced`. This is reviewer convenience packaging only and closes no independent-review finding/domain."""
replace_once(roadmap, rm_review, rm_review + "\n" + rm_bundle)

rm_pr142 = """- **Refreshed independent security-review handoff / Nexus PR #142:** Nexus merge [`553bbfa70d993a5c53b054ea1105fc8feb0c1827`](https://github.com/TriplexCorp/XMesh-Nexus/commit/553bbfa70d993a5c53b054ea1105fc8feb0c1827) supersedes the stale PR #135 Nexus target for current-review applicability and freezes Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`. Contract v2 adds explicit PR #139/#140 Rust implementation evidence, re-runs frozen source contracts and proves the handoff PR itself has no runtime-source delta. All release/qualification flags remain false; this is preparation, not external review sign-off."""
rm_pr144 = """- **Reproducible reviewer convenience bundle / Nexus PR #144:** Nexus merge [`f72250f93f89a5b2717a379370b8029150dadb97`](https://github.com/TriplexCorp/XMesh-Nexus/commit/f72250f93f89a5b2717a379370b8029150dadb97) adds reproducible packaging outside the frozen runtime target. It archives the exact frozen Nexus/Node SHAs, copies every contract-indexed evidence path, emits per-file SHA-256/size metadata and deterministic transport tar, and proves double-build byte equality in CI. Post-merge bundle run `41013465969` is **success**. Packaging does not satisfy independent review or physical qualification."""
replace_once(roadmap, rm_pr142, rm_pr142 + "\n" + rm_pr144)

old_gate = """| Independent security review | **CURRENT repo-side release sub-gate — external sign-off required** | PR #142 freezes Nexus `8c64a8e5...` + Node `083dc181...`, including PRs #139/#140; obtain independent findings, remediation disposition and sign-off |"""
new_gate = """| Independent security review | **CURRENT repo-side release sub-gate — external sign-off required** | PR #142 freezes Nexus `8c64a8e5...` + Node `083dc181...`, including PRs #139/#140; PR #144 supplies reproducible reviewer packaging; obtain independent findings, remediation disposition and sign-off |"""
replace_once(roadmap, old_gate, new_gate)

old_review_para = """The repo-side freeze/preparation step is therefore **COMPLETE**. The current repo-side release blocker is independently attributable **security-review findings, remediation disposition and final sign-off** for that exact frozen target. Any later security-relevant code change invalidates the freeze and requires the affected scope to be re-frozen/re-reviewed. The real five-run E4a physical-power matrix and independent evidence review remain the parallel external/hardware blocker. Neither the handoff, the Rust migration nor green CI counts as independent review or authorizes rollout."""
new_review_para = """The repo-side freeze/preparation step is therefore **COMPLETE**. PR #144 additionally provides reproducible reviewer convenience packaging for the exact frozen target: post-merge run `41013465969` builds the package twice byte-for-byte, verifies the content-addressed manifest, and emits deterministic tar SHA-256 `f095f19217a072ef7919663744fcdfbc847783eb23be5a64b0f8df37b8952ced`. This packaging remains outside the frozen runtime target and completes no review domain. The current repo-side release blocker is independently attributable **security-review findings, remediation disposition and final sign-off** for that exact frozen target. Any later security-relevant code change invalidates the freeze and requires the affected scope to be re-frozen/re-reviewed. The real five-run E4a physical-power matrix and independent evidence review remain the parallel external/hardware blocker. Neither the handoff, reviewer bundle, Rust migration nor green CI counts as independent review or authorizes rollout."""
replace_once(roadmap, old_review_para, new_review_para)

replace_once(
    roadmap,
    "- Bounded fuzz, NIST-vector, observability and review-handoff gates do not replace independent security review.",
    "- Bounded fuzz, NIST-vector, observability, review-handoff and reviewer-bundle gates do not replace independent security review.",
)
