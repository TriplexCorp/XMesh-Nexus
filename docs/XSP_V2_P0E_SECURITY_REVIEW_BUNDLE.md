# XSP-v2 P0-E reproducible security-review bundle

Status: **reviewer convenience tooling only**. The bundle does not perform, replace, or declare an independent security review. It does not qualify physical power-loss durability, enable `strict-pq`, or authorize production rollout.

## Current v4 source binding

The bundle is now tied to the security-remediated v4 target:

- XMesh-Nexus `12b3170996bc062ee16c79659a6378e5e425fd0e`;
- XMesh-Node `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`.

The previous v3 pair (`0bab1a48cff570b3abe405bcda4dc242b23b8a4b` + `083dc181c5e175f89007f4b93111cd5c45a69d97`) is historical only after remediation of internal findings `AI-LOW-001` and `AI-LOW-002`.

The machine-readable source of truth is `deploy/xsp-v2-p0e-security-review-handoff.contract.json`.

## Purpose

An independent reviewer should receive one self-contained artifact whose contents are cryptographically tied to the exact v4 review target rather than reconstructing the package manually from repository links.

The builder verifies the exact checkout identities from the handoff contract and produces deterministic source archives plus indexed review evidence.

## Bundle contents

`python3 scripts/build-xsp-v2-p0e-security-review-bundle.py` creates:

- deterministic `git archive` tar files for the exact v4 Nexus and Node revisions;
- the current handoff contract and handoff guide under `control/`;
- every Nexus evidence document, machine contract and implementation evidence path indexed by the handoff contract under `evidence/nexus/`;
- the AI-assisted internal audit as explicit non-independent remediation context;
- `REVIEW_SCOPE.md` with exact revisions, all 11 review domains, remaining external blockers and explicit non-claims;
- `SHA256SUMS` covering every payload file except the checksum/manifest files themselves;
- `MANIFEST.json` with the control-contract digest, exact source revisions, per-file SHA-256/size records and the digest of `SHA256SUMS`.

The builder refuses a Nexus or Node checkout whose `HEAD` differs from the contract's frozen source revision, refuses missing or duplicate indexed evidence, and keeps current control metadata separate from the frozen source archives.

## What changed from v3

v4 is not a documentation-only refresh. It intentionally includes exactly two security-relevant remediation deltas:

1. Nexus PR #163 requires a verified client certificate in the dedicated C2-B/D2 TLS authentication policy (`ssl_verify_client on`) while retaining route-level verification as defense in depth. Negative E2E coverage proves anonymous/XMESH1-header attempts cannot reach ACK policy success or mutate durable ACK/epoch/receipt state.
2. Node PR #52 makes initial master-key provisioning durable with parent-directory `fsync` after file sync/close and adds Linux regression coverage.

The companion handoff CI compares v3 to v4 and rejects any additional critical Nexus runtime or Node security-source drift outside those remediations.

## CI reproducibility proof

`.github/workflows/xsp-p0e-security-review-bundle.yml`:

1. checks out the control tooling;
2. checks out exact Nexus `12b3170996bc062ee16c79659a6378e5e425fd0e` and Node `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`;
3. builds the bundle twice independently and requires a recursive byte-for-byte diff to be empty;
4. recalculates every manifest SHA-256 and size record;
5. verifies that the internal audit is included as evidence while all production/qualification claims remain false;
6. prints the manifest payload SHA-256, control-contract SHA-256 and file count;
7. creates a deterministic tar with sorted names, epoch timestamps and numeric owner/group `0`;
8. prints the deterministic tar SHA-256;
9. uploads the tar plus checksum as `xsp-v2-p0e-security-review-bundle-v4` with 30-day retention.

The outer GitHub artifact ZIP is only transport. Authoritative integrity values are the deterministic inner tar checksum and `MANIFEST.json` / `SHA256SUMS` digests.

## Local use

With exact v4 checkouts available locally:

```bash
python3 scripts/build-xsp-v2-p0e-security-review-bundle.py \
  --control-root . \
  --nexus-root /path/to/XMesh-Nexus-at-12b31709 \
  --node-root /path/to/XMesh-Node-at-34d3d7ef \
  --output /tmp/xsp-v2-p0e-security-review-bundle
```

The builder uses standard-library Python and local `git`; it performs no network calls and does not write into either reviewed checkout.

## Review and release boundary

A green bundle workflow proves reproducible assembly and content addressing only. It does **not** prove the system secure and cannot satisfy the independent-review requirement.

Issue #137 must receive an attributable independent result for the exact v4 revisions. Issue #138 separately requires five representative real abrupt-power experiments on the reviewed storage/controller/PLP stack plus independent evidence review.

After both external gates are legitimately complete, the exact release candidate must still run the final canary, pass the reviewed rollout-plan gate, obtain bounded strict-PQ activation approval, and execute activation separately. XMESH1 retirement remains a later independent decision.

Until then:

- `independentSecurityReviewComplete=false`;
- `physicalPowerLossQualified=false`;
- `productionActivation=false`;
- `strictPQEnabled=false`;
- `strict-pq` remains OFF.
