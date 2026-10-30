# XSP-v2 P0-E independent security-review result contract

Status: **external-review result acceptance tooling only**. This document and its verifier do not perform the security review, do not provide project-owner self-sign-off, do not qualify physical power-loss durability, do not enable `strict-pq`, and do not authorize production rollout.

## Purpose

Issue #137 requires an independently attributable security-review result for the current frozen review snapshot. The v3 handoff and reproducible bundle define what is reviewed; this contract defines the minimum machine-checkable shape of the reviewer's returned findings/sign-off so closure cannot depend on ambiguous prose or an accidentally different source revision.

The exact v3 review target is:

- XMesh-Nexus `0bab1a48cff570b3abe405bcda4dc242b23b8a4b`
- XMesh-Node `083dc181c5e175f89007f4b93111cd5c45a69d97`

The earlier Nexus revision `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` remains the frozen **runtime baseline**. PR #156 proved the protected runtime paths were unchanged between that baseline and the v3 Nexus snapshot while adding the final non-executing release-control architecture from PRs #150, #152 and #155 to the review scope. An external result for issue #137 must therefore bind the v3 review snapshot `0bab1a48...`, not the older runtime baseline by itself.

The authoritative post-merge v3 reviewer bundle was produced by workflow run `41037503656` after PR #156 merged. Its GitHub artifact ID is `12967634062` for navigation only; the cryptographic result contract binds the deterministic inner tar SHA-256 `bac34400ac9b646c8a0f64ca9495e380ff0afce373310787c96385b9e40486bf` and payload digest `33c8f07f4513cb03400c8b7af2f34f804661a79501336206482c0f426866620a`.

## Required result shape

A completed external result uses schema `xsp2-p0e-independent-security-review-result-1` and contains exactly:

- `target`: exact frozen Nexus and Node repository/revision pairs;
- `reviewer`: non-empty reviewer name and organization plus `independent=true`;
- `reviewDate`: ISO `YYYY-MM-DD`;
- `reviewDomains`: exactly one disposition for each of the 11 mandatory domains, with a non-empty summary and evidence references;
- `findings`: zero or more uniquely identified findings with severity, status, affected domain(s), evidence, explicit disposition, release-blocking classification and whether remediation changed security-relevant code;
- `signoff`: explicit `approve`, `approve-with-findings`, or `reject`, attributable signer identity/organization, statement and timezone-qualified timestamp;
- `claims`: `physicalPowerLossQualified=false`, `productionActivation=false`, and `strictPQEnabled=false`.

Unknown or missing fields fail validation so alternate spellings or silently omitted acceptance data cannot weaken the result contract.

## Domain dispositions

Every required domain appears exactly once and uses one of:

- `pass`
- `pass-with-findings`
- `fail`

The 11 domain identifiers are inherited exactly from the v3 PR #156 handoff contract:

1. `protocol-and-canonicalization`
2. `hybrid-cryptography-and-key-purpose-binding`
3. `pq-only-transport-and-node-identity`
4. `isolated-signer-and-key-custody`
5. `postgresql-replay-ack-epoch-and-receipt`
6. `agent-local-durability-and-rollback`
7. `coordinated-backup-restore-and-off-host-floor`
8. `owner-authorized-key-retirement`
9. `parser-fuzz-and-external-mldsa65-vectors`
10. `default-off-redacted-observability`
11. `production-migration-no-fallback-and-rollback`

Domain 11 now explicitly includes the final release-control architecture: the disposable exact-candidate canary rehearsal (#150), separately reviewed production rollout-plan acceptance (#152), explicit bounded strict-PQ activation approval (#155), no automatic fallback, and separate later XMESH1 retirement.

## Findings

Each finding requires:

- unique stable `id`;
- severity: `critical`, `high`, `medium`, `low`, or `info`;
- status: `open`, `remediated`, `accepted-risk`, or `not-applicable`;
- `releaseBlocking` boolean;
- `securityRelevantCodeChange` boolean;
- non-empty title;
- one or more affected mandatory domains;
- one or more evidence references;
- non-empty disposition/remediation rationale.

A release-blocking finding is closure-ineligible until its status is `remediated`.

If remediation changes security-relevant code or materially changes the reviewed release-control policy, the current review result is **closure-ineligible regardless of reviewer approval**: the changed scope must first become a new exact frozen target and be re-reviewed. The verifier reports `requiresRefreeze=true` for a security-relevant code remediation rather than pretending approval transfers to a different revision.

## Sign-off and closure eligibility

The verifier deliberately separates two questions:

1. **Is this a structurally valid attributable review result?** A valid external `reject` result answers yes.
2. **Can this result satisfy the repo-side #137 sign-off gate?** Only `approve` or `approve-with-findings` can be closure-eligible, every domain must avoid `fail`, no release-blocking finding may remain unresolved, and no security-relevant code remediation may have invalidated the frozen target.

A project maintainer must still attach/link the external report to #137 and review its actual evidence. The verifier does **not** automatically close the issue and cannot judge whether a reviewer is genuinely organizationally independent beyond the reviewer's explicit `independent=true` attestation and attributable identity.

## Example completed result

The following is illustrative only; evidence strings must point to the external reviewer's actual report/evidence and the reviewer must supply their own identity and conclusions.

```json
{
  "schema": "xsp2-p0e-independent-security-review-result-1",
  "target": {
    "nexus": {
      "repository": "TriplexCorp/XMesh-Nexus",
      "sourceRevision": "0bab1a48cff570b3abe405bcda4dc242b23b8a4b"
    },
    "node": {
      "repository": "TriplexCorp/XMesh-Node",
      "sourceRevision": "083dc181c5e175f89007f4b93111cd5c45a69d97"
    }
  },
  "reviewer": {
    "name": "External Reviewer Name",
    "organization": "Independent Review Organization",
    "independent": true
  },
  "reviewDate": "2026-10-30",
  "reviewDomains": [
    {
      "domain": "protocol-and-canonicalization",
      "disposition": "pass",
      "summary": "Reviewed canonical encodings and domain separation.",
      "evidence": ["external-report:section-1"]
    }
  ],
  "findings": [],
  "signoff": {
    "decision": "approve",
    "statement": "Approved for the exact reviewed revisions within the stated scope.",
    "signerName": "External Reviewer Name",
    "signerOrganization": "Independent Review Organization",
    "signedAt": "2026-10-30T12:00:00Z"
  },
  "claims": {
    "physicalPowerLossQualified": false,
    "productionActivation": false,
    "strictPQEnabled": false
  }
}
```

The abbreviated example intentionally omits the other ten mandatory domains and therefore does **not** validate as a completed result.

## Verification

```bash
python3 scripts/verify-xsp-v2-p0e-independent-security-review-result.py \
  --result /path/to/external-review-result.json
```

That command exits zero for a structurally valid attributable result, including a valid rejection, and prints machine-readable verification metadata.

To require that the result is also eligible to satisfy the #137 repo-side sign-off gate:

```bash
python3 scripts/verify-xsp-v2-p0e-independent-security-review-result.py \
  --result /path/to/external-review-result.json \
  --require-closure-eligible
```

Exit status `2` means the review result is structurally valid but cannot close the gate; the JSON output lists the reasons. Exit status `1` means the result itself is malformed, incomplete, bound to the wrong target, non-independent, or otherwise violates the result contract.

## Boundary

Passing this verifier is not a production release decision. Issue #138 remains the separate five-run physical abrupt-power qualification gate. After #137 and #138 genuinely close, the exact final release candidate still requires the full disposable canary, a separately reviewed real rollout/rollback plan, an explicit bounded strict-PQ approval, and a separate execution step. XMESH1 retirement remains a later separate decision.

Until those gates close, `strict-pq` remains OFF and production rollout remains NOT AUTHORIZED.
