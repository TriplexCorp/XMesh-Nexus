# XSP-v2 P0-E reproducible security-review bundle

Status: **reviewer convenience tooling only**. This bundle does not perform, replace, or declare an independent security review. It does not qualify physical power-loss durability, enable `strict-pq`, or authorize production rollout.

## Purpose

The independent reviewer should be able to receive one self-contained artifact whose contents are cryptographically tied to the current P0-E review snapshot instead of reconstructing the package manually from repository links.

The builder consumes the current machine-readable handoff contract as control metadata and then verifies/checks out exactly:

- XMesh-Nexus review snapshot `0bab1a48cff570b3abe405bcda4dc242b23b8a4b`
- XMesh-Node `083dc181c5e175f89007f4b93111cd5c45a69d97`

The previous PR #142 Nexus review target `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` remains the frozen **runtime baseline**. The v3 review snapshot adds the release-control architecture from PRs #150, #152 and #155. The handoff workflow must separately prove that critical runtime paths are unchanged between the old runtime baseline and the v3 snapshot.

This bundle tooling itself is outside the reviewed source snapshot and cannot silently change either reviewed revision.

## Bundle contents

`python3 scripts/build-xsp-v2-p0e-security-review-bundle.py` creates a directory containing:

- deterministic `git archive` tar files for the exact v3 Nexus and Node review revisions;
- the current handoff contract and handoff guide under `control/`;
- copies of every Nexus evidence document, machine contract, implementation file, source-contract script, process harness, release-control verifier and workflow indexed by the handoff contract under `evidence/nexus/`;
- `REVIEW_SCOPE.md` with the exact source revisions, 11 mandatory review domains, remaining external blockers, and explicit non-claims;
- `SHA256SUMS` covering every payload file other than the checksum/manifest files themselves;
- `MANIFEST.json` with the contract hash, exact source revisions, per-file SHA-256/size records, and a digest of `SHA256SUMS`.

The builder refuses a Nexus or Node checkout whose `HEAD` differs from the contract's frozen `sourceRevision`, refuses missing/duplicate indexed evidence, and keeps the current control metadata separate from the frozen source archives.

## Why the v3 snapshot moved while runtime did not

The old runtime baseline already contains the reviewed Rust ingress/ACK/recovery implementation. After that freeze, three non-executing release-control layers were added:

1. PR #150 disposable canary rehearsal;
2. PR #152 exact-candidate production rollout-plan acceptance;
3. PR #155 explicit bounded strict-PQ activation approval.

Those controls are part of the mandatory `production-migration-no-fallback-and-rollback` review domain. An external review that omitted them would not cover the final release architecture. The v3 handoff therefore advances the review snapshot while separately requiring byte-level Git equivalence for critical runtime paths.

## CI reproducibility proof

`.github/workflows/xsp-p0e-security-review-bundle.yml`:

1. checks out the control tooling;
2. separately checks out exact Nexus `0bab1a48cff570b3abe405bcda4dc242b23b8a4b` and Node `083dc181c5e175f89007f4b93111cd5c45a69d97`;
3. builds the bundle twice into independent directories and requires a recursive byte-for-byte diff to be empty;
4. independently recalculates every manifest SHA-256/size record;
5. creates a deterministic transport tar with sorted names, zeroed timestamps, numeric owner/group `0`, and writes its SHA-256;
6. uploads the tar plus checksum as a 30-day GitHub Actions artifact.

The companion handoff workflow independently proves the protected runtime paths did not change between Nexus runtime baseline `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` and v3 review snapshot `0bab1a48cff570b3abe405bcda4dc242b23b8a4b`.

The outer GitHub artifact ZIP is merely transport. The authoritative reviewer integrity values are the deterministic inner tar checksum plus the bundle's `MANIFEST.json` / `SHA256SUMS`.

## Local use

With exact checkouts available locally:

```bash
python3 scripts/build-xsp-v2-p0e-security-review-bundle.py \
  --control-root . \
  --nexus-root /path/to/XMesh-Nexus-at-0bab1a48 \
  --node-root /path/to/XMesh-Node-at-083dc181 \
  --output /tmp/xsp-v2-p0e-security-review-bundle
```

The script is standard-library Python plus the local `git` executable. It performs no network calls and never writes into either reviewed checkout.

## Review and release boundary

A successful bundle workflow proves only that the evidence package is reproducibly assembled from the frozen revisions and that its bytes are content-addressed. It does **not** prove that the architecture is secure or satisfy any independent-review finding.

The independent reviewer must still produce attributable findings, remediation disposition, and final sign-off for the v3 review snapshot tracked by issue #137. Separately, P0-E4a issue #138 still requires five representative real abrupt-power experiments and independent evidence review.

After both external P0-E gates are genuinely complete, the exact release candidate still must rerun the complete disposable canary, supply a separately reviewed real rollout/rollback plan, obtain an explicit bounded strict-PQ approval, and execute activation as a separate step. XMESH1 retirement remains a later separate decision.

Until those gates close:

- `independentSecurityReviewComplete=false`
- `physicalPowerLossQualified=false`
- `productionActivation=false`
- `strictPQEnabled=false`
