# XSP-v2 strict-PQ activation approval

Status: **release-authorization tooling only**. This gate does not deploy software, change Compose/Nginx/firewall/DNS, enable `strict-pq`, replace the production Agent, or retire XMESH1.

The strict XSP-v2 transport is already implemented and proven in staging: TLS 1.3, negotiated `X25519MLKEM768`, ML-DSA-65 client identity, and Ed25519 **AND** ML-DSA-65 verification for security-critical XSP/2 messages. The remaining release problem is to ensure that production activation can happen only for one exact, externally reviewed and qualified candidate.

## Why this gate exists

Production activation must not be inferred from a green CI run, a merged implementation, a completed security review, or a reviewed rollout plan in isolation. A separate explicit approval must bind all of those prerequisites to the exact candidate and bounded rollout scope.

The contract is `deploy/xsp-v2-strict-pq-activation-approval.contract.json`. The offline verifier is `scripts/verify-xsp-v2-strict-pq-activation-approval.py`.

The verifier never performs an activation. Its strongest positive result is:

- `activationApprovalEligible=true`
- `strictPQEnabled=false`
- `productionActivation=false`
- `legacyXMESH1Retired=false`
- `requiresSeparateExecution=true`

That distinction is deliberate: authorization evidence and execution are separate trust boundaries.

## Exact prerequisites

An eligibility-checking invocation requires exact expected values for:

- Nexus revision;
- Node revision;
- Nexus production image SHA-256;
- Agent artifact SHA-256;
- final **post-P0-E** canary result SHA-256;
- independently reviewed production rollout-plan SHA-256;
- independently validated security-review result SHA-256;
- independently validated physical-qualification result SHA-256;
- rollout-plan verifier-result SHA-256.

The approval itself must additionally record accepted evidence for:

1. P0-E completion;
2. independently attributable security-review result;
3. accepted physical power-loss qualification result and explicit reviewed qualification checkpoint;
4. final exact-candidate disposable canary;
5. gate-eligible production rollout plan produced under the PR #152 contract.

The evidence booleans are ordered fail-closed: P0-E cannot be complete unless both external evidence domains are accepted; the final canary cannot pass before P0-E; and the rollout plan cannot be eligible before the final canary.

## Bounded activation scope

One approval may cover only `limited-canary` or `phased` scope and at most 50 explicitly named Node IDs. Wildcards and empty scopes are rejected. The artifact binds the panel FQDN, dedicated XSP-v2 ingress FQDN and ingress port as additional authority context.

Approval lifetime is bounded to at most 24 hours. `--require-eligible` rejects an approval before its creation time or after expiry.

A new candidate, a changed rollout-plan digest, a changed final-canary digest, an expired approval, or a different Node scope requires a new approval artifact.

## Mandatory strict-PQ policy

The approval cannot weaken the reviewed transport policy:

- TLS protocols: exactly `TLSv1.3`;
- key exchange: exactly `X25519MLKEM768`;
- client identity: exactly `ML-DSA-65`;
- critical message signatures: exactly `Ed25519` + `ML-DSA-65`;
- `automaticFallback=false`;
- `classicalOnlyAllowed=false`.

The approval decision must be `strictPqAction=enable` and `legacyXMESH1Action=retain`.

XMESH1 retirement is intentionally **not** combined with the first strict-PQ activation. It requires a later, separate explicit decision after the approved PQ path has production evidence. The target XSP-v2 path itself still has no automatic fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2, or insecure certificate verification.

## Approval authority and non-claims

The artifact requires an explicit `release-owner` approval, approval timestamp, rationale, and SHA-256 of the attributable approval record. Pending/unapproved artifacts may be structurally validated but cannot become activation-eligible.

Before the separate execution step the artifact must state all of these as false:

- `productionActivation`
- `strictPQEnabled`
- `legacyXMESH1Retired`

Private keys, credentials, passwords, tokens, URLs, shell commands and scripts are forbidden from the approval artifact. It is a decision/evidence document, not an execution vehicle.

## Example eligibility check

```bash
python3 scripts/verify-xsp-v2-strict-pq-activation-approval.py \
  --approval /secure/release/xsp2-activation-approval.json \
  --require-eligible \
  --expected-nexus-revision <40-hex> \
  --expected-node-revision <40-hex> \
  --expected-nexus-image-sha256 sha256:<64-hex> \
  --expected-agent-artifact-sha256 <64-hex> \
  --expected-final-canary-sha256 <64-hex> \
  --expected-rollout-plan-sha256 <64-hex> \
  --expected-security-review-result-sha256 <64-hex> \
  --expected-physical-qualification-result-sha256 <64-hex> \
  --expected-rollout-plan-verifier-result-sha256 <64-hex>
```

The real execution step must consume the same exact identities and approval digest. This PR deliberately does not define or run that execution step because the real external P0-E evidence does not yet exist.

## Current release boundary

Until issues #137 and #138 are genuinely complete, the exact post-P0-E candidate has passed the final canary, the PR #152 rollout plan is independently reviewed and eligible, and a real approval artifact passes this verifier, `strict-pq` remains **OFF** and production rollout remains **NOT AUTHORIZED**.
