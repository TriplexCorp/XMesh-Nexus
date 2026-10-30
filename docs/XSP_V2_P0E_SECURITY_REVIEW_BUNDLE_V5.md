# XSP-v2 P0-E v5 KVM VPS reviewer bundle

Status: **deterministic packaging for external review only**.

The v5 bundle packages the unchanged security-remediated runtime target plus the post-runtime KVM release-control policy that must now be reviewed under issue #137.

## Frozen runtime

- Nexus `12b3170996bc062ee16c79659a6378e5e425fd0e`
- Node `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`

## Material v5 control delta

The bundle separately indexes control files merged after the runtime freeze, including:

- current bare-metal E4a source binding to Node PR #52;
- KVM VPS five-run crash-consistency contract/verifier;
- provider-managed block-storage trust-boundary policy;
- KVM-specific bounded strict-PQ activation approval contract/verifier.

The KVM profile must keep `physicalPowerLossQualified=false`; it is not a substitute claim for bare-metal power-loss qualification.

## Build

The workflow checks out the exact runtime revisions and calls:

```bash
python3 scripts/build-xsp-v2-p0e-security-review-bundle-v5.py \
  --control-root . \
  --nexus-root xmesh-nexus-reviewed \
  --node-root xmesh-node-reviewed \
  --output "$RUNNER_TEMP/xsp-v2-p0e-review-v5"
```

The builder produces exact source archives, indexed runtime evidence, indexed post-runtime control evidence, `SHA256SUMS`, `REVIEW_SCOPE.md` and `MANIFEST.json`.

The workflow then creates a deterministic inner tar. GitHub's artifact ZIP is transport/navigation metadata only; external review binding must use the deterministic inner tar SHA-256 and the manifest payload SHA-256.

## Non-claims

Packaging does not perform the review or the five real KVM crash runs. It cannot set:

```text
independentSecurityReviewComplete=true
guestCrashConsistencyQualified=true
physicalPowerLossQualified=true
productionActivation=true
strictPQEnabled=true
```

After merge, the authoritative post-merge workflow run and its deterministic hashes must be copied into the independent-review result acceptance contract before #137 can accept a v5 review result.
