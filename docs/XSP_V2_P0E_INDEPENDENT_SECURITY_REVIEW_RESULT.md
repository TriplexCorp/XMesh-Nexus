# XSP-v2 P0-E independent security-review result contract

Status: **external-review result acceptance tooling only**. This document and its verifier do not perform the security review, do not provide project-owner self-sign-off, do not qualify real KVM crash evidence or physical power-loss durability, do not enable `strict-pq`, and do not authorize production rollout.

## Current frozen target and review package

Issue #137 requires an independently attributable result for the current **v5 KVM VPS review package**.

The frozen production runtime is unchanged from v4:

- XMesh-Nexus `12b3170996bc062ee16c79659a6378e5e425fd0e`;
- XMesh-Node `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`.

v5 supersedes v4 for review applicability because PRs #166/#167 materially changed the release-control policy: the retained bare-metal E4a tooling is rebound to the remediated Node target, and the active production deployment class is now `kvm-vps` with a separate five-run guest crash-consistency qualification, explicit provider-managed block-storage trust acceptance, and a KVM-specific strict-PQ activation approval path.

An external result based only on the old v4 package cannot satisfy the current #137 gate even though the runtime source revisions are unchanged, because it would omit this material release-policy change.

The authoritative **post-merge v5** reviewer bundle was produced by workflow run `41054352179` after PR #168 merged. GitHub artifact ID `12974974581` is navigation/transport metadata only. The result contract binds:

- deterministic inner tar SHA-256: `9d213e9281f0ffbbc3da21f9f3814d6e7fbef1e6b5273f6e9cb12175c63273c4`;
- payload SHA-256: `7b118084777d59e1ef1791d6375c32c1c44cf6bcdf9a03a2b0648a7ad9f263f2`.

The outer GitHub artifact ZIP digest is not the acceptance identity.

## Required result shape

A completed result uses schema `xsp2-p0e-independent-security-review-result-1` and contains exactly:

- `target`: the exact frozen Nexus and Node repository/revision pairs above;
- `reviewer`: attributable reviewer name and organization with `independent=true`;
- `reviewDate`: ISO `YYYY-MM-DD`;
- `reviewDomains`: exactly one disposition for each of the 11 mandatory domains, each with a non-empty summary and evidence references;
- `findings`: zero or more uniquely identified findings with severity, status, affected domains, evidence, disposition, release-blocking classification and whether remediation changed security-relevant code;
- `signoff`: `approve`, `approve-with-findings`, or `reject`, with attributable signer identity/organization, statement and timezone-qualified timestamp;
- `claims`: `physicalPowerLossQualified=false`, `productionActivation=false`, and `strictPQEnabled=false`.

For `deploymentClass=kvm-vps`, `physicalPowerLossQualified=false` is the correct claim even after KVM durability qualification. Physical provider hardware remains outside the guest/operator trust boundary.

Unknown or missing fields fail validation.

## Mandatory review domains

The reviewer must cover all eleven domains:

1. `protocol-and-canonicalization`;
2. `hybrid-cryptography-and-key-purpose-binding`;
3. `pq-only-transport-and-node-identity`;
4. `isolated-signer-and-key-custody`;
5. `postgresql-replay-ack-epoch-and-receipt`;
6. `agent-local-durability-and-rollback`;
7. `coordinated-backup-restore-and-off-host-floor`;
8. `owner-authorized-key-retirement`;
9. `parser-fuzz-and-external-mldsa65-vectors`;
10. `default-off-redacted-observability`;
11. `production-migration-no-fallback-and-rollback`.

Domains 3 and 6 must retain explicit review of the v4 security remediations `AI-LOW-001` and `AI-LOW-002`.

For **v5**, domains 6 and 11 must additionally review:

- the five-checkpoint KVM guest crash-consistency model;
- `provider-hard-stop` versus the weaker `guest-kernel-panic` fallback;
- provider-managed block storage as an explicit external trust boundary;
- required attributable provider-storage risk acceptance;
- the separation between the KVM and bare-metal durability profiles;
- the KVM-specific strict-PQ approval gate, including its refusal to fake `physicalPowerLossQualified=true`;
- preservation of TLS 1.3, `X25519MLKEM768`, ML-DSA-65 identity, Ed25519 **AND** ML-DSA-65 critical signatures, no automatic fallback, and no classical-only mode.

## Findings and re-freeze policy

Finding severity is one of `critical`, `high`, `medium`, `low`, or `info`. Status is one of `open`, `remediated`, `accepted-risk`, or `not-applicable`.

A release-blocking finding is closure-ineligible until remediated. If remediation changes security-relevant code or materially changes reviewed release-control policy, the result becomes closure-ineligible even if the reviewer approved it: the changed scope must be frozen again and reviewed again. The verifier reports `requiresRefreeze=true` rather than transferring approval to a different revision/policy package.

## Closure eligibility

The verifier separates structural validity from closure eligibility. A well-formed attributable `reject` result is a valid review result but cannot satisfy #137.

For #137 closure eligibility:

- sign-off must be `approve` or `approve-with-findings`;
- all eleven domains must avoid `fail`;
- no release-blocking finding may remain unresolved;
- no security-relevant remediation or material release-policy change may have invalidated the exact v5 package.

A maintainer must still attach or link the real external report to #137 and inspect the evidence. The verifier does not automatically close the issue and cannot prove organizational independence beyond attributable identity and the reviewer's explicit `independent=true` attestation.

## Minimal illustrative structure

The following is intentionally incomplete and therefore does **not** validate as a completed review because ten required domains are omitted:

```json
{
  "schema": "xsp2-p0e-independent-security-review-result-1",
  "target": {
    "nexus": {
      "repository": "TriplexCorp/XMesh-Nexus",
      "sourceRevision": "12b3170996bc062ee16c79659a6378e5e425fd0e"
    },
    "node": {
      "repository": "TriplexCorp/XMesh-Node",
      "sourceRevision": "34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb"
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
    "statement": "Approved for the exact v5 reviewed package within the stated scope.",
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

## Verification

Structural validation:

```bash
python3 scripts/verify-xsp-v2-p0e-independent-security-review-result.py \
  --result /path/to/external-review-result.json
```

Require #137 closure eligibility as well:

```bash
python3 scripts/verify-xsp-v2-p0e-independent-security-review-result.py \
  --result /path/to/external-review-result.json \
  --require-closure-eligible
```

Exit status `2` means the result is structurally valid but not closure-eligible. Exit status `1` means the result is malformed, incomplete, non-independent, bound to the wrong target, or otherwise violates the contract.

## Boundary

Passing this verifier is not a production release decision. Issue #138 is now the separate **KVM VPS five-run guest crash-consistency qualification gate** for the active deployment class. Its positive result must still keep `physicalPowerLossQualified=false` and explicitly accept provider-managed block-storage durability as an external trust assumption.

After #137 and #138 are legitimately satisfied, the exact release candidate still requires the final canary, an independently reviewed rollout/rollback plan, the bounded KVM strict-PQ activation approval, and a separate execution step. XMESH1 retirement remains a later separate decision.

Until those gates are satisfied, `strict-pq` remains OFF and production rollout remains NOT AUTHORIZED.
