# XSP-v2 P0-E independent security-review result contract

Status: **external-review result acceptance tooling only**. This document and its verifier do not perform the security review, do not provide project-owner self-sign-off, do not qualify physical power-loss durability, do not enable `strict-pq`, and do not authorize production rollout.

## Current frozen target

Issue #137 requires an independently attributable result for the current **v4** review target:

- XMesh-Nexus `12b3170996bc062ee16c79659a6378e5e425fd0e`;
- XMesh-Node `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`.

The previous v3 pair (`0bab1a48cff570b3abe405bcda4dc242b23b8a4b` + `083dc181c5e175f89007f4b93111cd5c45a69d97`) is superseded after remediation of internal findings `AI-LOW-001` and `AI-LOW-002`. An external report bound to v3 cannot satisfy the current #137 gate.

The authoritative post-merge v4 reviewer bundle was produced by workflow run `41050277455` after PR #164 merged. Its GitHub artifact ID `12974880470` is navigation metadata only. The result contract binds the deterministic inner tar SHA-256:

`143ef26ff84281689e2ec2e2046cc06ec9ef5344a96b5f39edd4f877e014dbf3`

and payload SHA-256:

`f473c70f70a23fe91a057ee7b6db4747528a965019397563cfc91590205261f2`.

The bundle's control-contract SHA-256 is `eabe06e31e88f6d45e4118b76724c345d785c3e6d69fc4fd5688600c7f2d922e`; the outer GitHub artifact ZIP digest is transport metadata and is not the acceptance identity.

## Required result shape

A completed result uses schema `xsp2-p0e-independent-security-review-result-1` and contains exactly:

- `target`: the exact v4 Nexus and Node repository/revision pairs;
- `reviewer`: attributable reviewer name and organization with `independent=true`;
- `reviewDate`: ISO `YYYY-MM-DD`;
- `reviewDomains`: exactly one disposition for each of the 11 mandatory domains, each with a non-empty summary and evidence references;
- `findings`: zero or more uniquely identified findings with severity, status, affected domains, evidence, disposition, release-blocking classification and whether remediation changed security-relevant code;
- `signoff`: `approve`, `approve-with-findings`, or `reject`, with attributable signer identity/organization, statement and timezone-qualified timestamp;
- `claims`: `physicalPowerLossQualified=false`, `productionActivation=false`, and `strictPQEnabled=false`.

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

For v4, domains 3 and 6 must explicitly cover the two remediations: mandatory TLS client authentication on the dedicated C2-B/D2 ingress and parent-directory durability of initial Node master-key provisioning.

## Findings and re-freeze policy

Finding severity is one of `critical`, `high`, `medium`, `low`, or `info`. Status is one of `open`, `remediated`, `accepted-risk`, or `not-applicable`.

A release-blocking finding is closure-ineligible until remediated. If remediation changes security-relevant code or materially changes reviewed release-control policy, the result becomes closure-ineligible even if the reviewer approved it: the changed source must be frozen again and reviewed again. The verifier reports `requiresRefreeze=true` rather than transferring approval to a different revision.

## Closure eligibility

The verifier deliberately separates structural validity from closure eligibility. A well-formed attributable `reject` result is a valid review result but cannot satisfy #137.

For #137 closure eligibility:

- sign-off must be `approve` or `approve-with-findings`;
- all eleven domains must avoid `fail`;
- no release-blocking finding may remain unresolved;
- no security-relevant remediation may have invalidated the exact v4 target.

A maintainer must still attach or link the real external report to #137 and inspect the evidence. The verifier does not automatically close the issue and cannot independently prove organizational independence beyond attributable identity and the reviewer's explicit `independent=true` attestation.

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

Passing this verifier is not a production release decision. Issue #138 remains the separate five-run physical abrupt-power qualification gate. After #137 and #138 are legitimately satisfied, the exact final release candidate still requires the final canary, reviewed rollout-plan gate, bounded strict-PQ activation approval, and separate execution step. XMESH1 retirement remains a later separate decision.

Until those gates are satisfied, `strict-pq` remains OFF and production rollout remains NOT AUTHORIZED.
