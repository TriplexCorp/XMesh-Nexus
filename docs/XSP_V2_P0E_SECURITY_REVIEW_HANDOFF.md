# XSP-v2 P0-E independent security-review handoff

Status: **review-preparation / v4 evidence freeze only**. This handoff does not perform, replace, or declare an independent security review. It does not qualify physical power-loss durability, enable `strict-pq`, or authorize production rollout.

## Frozen v4 review target

The current independent-review package is frozen at the two security-remediated source revisions:

- XMesh-Nexus: `12b3170996bc062ee16c79659a6378e5e425fd0e` — merge of PR #163, mandatory TLS client authentication for the dedicated C2-B/D2 ingress plus regression updates proving anonymous/no-legacy requests cannot reach ACK policy success or mutate durable state.
- XMesh-Node: `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — merge of PR #52, durable parent-directory `fsync` before initial master-key provisioning reports success, with Linux regression coverage.

The machine-readable binding is `deploy/xsp-v2-p0e-security-review-handoff.contract.json`.

## Why v3 was superseded

The previous v3 target was:

- Nexus `0bab1a48cff570b3abe405bcda4dc242b23b8a4b`;
- Node `083dc181c5e175f89007f4b93111cd5c45a69d97`.

An AI-assisted internal review was recorded in PR #162 / merge `424d99d8a9822c2e8157e5cdbb15c423e99f10ef`. That review was explicitly internal (`independent=false`) and identified two Low-severity hardening findings:

1. `AI-LOW-001`: the dedicated ingress used `ssl_verify_client optional`, so an anonymous TLS client was rejected only after entering HTTP route policy. There was no authentication bypass, but verified client identity was not mandatory at the TLS-authentication policy itself.
2. `AI-LOW-002`: initial Node master-key creation synced the file contents but did not sync the parent directory entry before reporting provisioning success.

Both findings changed security-relevant code when remediated. Under the existing review-result policy, a security-relevant remediation invalidates the affected frozen scope. Therefore v3 is historical evidence only and must not be accepted as the current release-review target.

## Remediation evidence

### AI-LOW-001 — remediated in Nexus PR #163

The dedicated C2-B/D2 ingress now requires:

```nginx
ssl_verify_client on;
```

The exact ACK/recovery locations still retain `$ssl_client_verify == SUCCESS` as defense in depth. Runtime contracts reject any return to `optional` for this active staging boundary. E2E negatives require no-certificate/XMESH1-header attempts to fail under mandatory mTLS before ACK policy success and verify that PostgreSQL ACK/epoch/receipt/replay state remains unchanged.

TLS 1.3 key exchange occurs before client-certificate acceptance, so this remediation does **not** claim to eliminate generic pre-authentication TLS/KEM CPU cost. Production connection/rate/resource controls remain a deployment concern.

The PR head passed Backend CI plus the dedicated Hybrid TLS, C2-D2 transport-negative/no-legacy, expired-recovery, lost-response/race, and PostgreSQL snapshot-rollback workflows before merge.

### AI-LOW-002 — remediated in Node PR #52

`CreateMasterKey` now reports success only after:

1. exclusive 0600 file creation;
2. random master-key write;
3. file `fsync`;
4. successful close;
5. parent-directory `fsync`.

The existing atomic sealed-state helper reuses the same directory-sync primitive. New Linux coverage checks private-file invariants, directory syncability, and refusal to overwrite an existing master key.

The PR passed Node CI, XSP-v2 crypto PoC, crash durability, snapshot anti-rollback, owner-retirement durable erasure, Agent artifact, P0-E4a arming, and E4a5 lab-operation checks before merge.

## Review-scope provenance

The v2 runtime freeze at Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` and Node `083dc181c5e175f89007f4b93111cd5c45a69d97` remains historical provenance for the original completed runtime chain.

The v3 target added final release-control architecture through Nexus `0bab1a48cff570b3abe405bcda4dc242b23b8a4b` while retaining the same Node revision.

The v4 target intentionally advances security-relevant runtime scope only for the two remediations above. The v4 handoff CI must prove the bounded delta:

- within Nexus critical runtime paths, v3 -> v4 changes only `deploy/xsp-v2-ingress/nginx-c2b.conf`;
- within Node `security/xspv2` and `agent/xspv2`, v3 -> v4 changes only `security/xspv2/poc-go/keyring/sealed.go` and `security/xspv2/poc-go/keyring/master_key_durability_linux_test.go`.

Review/test files that encode the new expected mandatory-mTLS behavior are included as evidence, but they are not treated as additional production runtime state machines.

## Runtime implementation scope

The reviewer must retain the full prior XSP-v2 architecture in scope, including:

- strict protocol/canonicalization and purpose/direction binding;
- Ed25519 **and** ML-DSA-65 critical-message signatures;
- TLS 1.3 `X25519MLKEM768` transport, ML-DSA-65 Node identity, authenticated authority/Host binding, downgrade rejection and no XMESH1/classical fallback on XSP-v2;
- the Rust C2-A origin and C2-B/C/D ACK/recovery boundary with Linux `SO_PEERCRED`, exact client SPKI/Node identity, strict typed JSON, bounded framing and exact UDS transitions;
- isolated panel-response signer and least-privilege PostgreSQL roles;
- transactional permit/replay/ACK/epoch/receipt behavior and immutable receipt evidence;
- Agent vault/floor/journal crash durability and rollback rejection;
- coordinated backup/restore plus independently protected owner/off-host monotonic floor;
- dual-owner-authorized prior-key retirement and anti-resurrection state;
- parser fuzzing and bounded external NIST ACVP ML-DSA-65 verification-vector evidence;
- default-off redacted observability;
- exact-candidate canary, rollout-plan and strict-PQ approval controls.

## Final release-control scope retained

The v4 review still includes the non-executing release controls from v3:

- PR #150 / `497def9b950d57152f2e0ca2abb7eb0657a8d22f`: disposable release-canary rehearsal;
- PR #152 / `b71c0d0c641b5e0f6a60785586486b18dbb45db3`: production rollout-plan verifier;
- PR #155 / `0bab1a48cff570b3abe405bcda4dc242b23b8a4b`: bounded strict-PQ activation approval gate.

Those controls still require the exact post-P0-E candidate, accepted independent review, accepted physical qualification, final canary and reviewed rollout evidence before an approval can become eligible. Approval remains non-executing and initial strict-PQ activation retains XMESH1; XMESH1 retirement is a later separate decision.

Automatic fallback and classical-only activation remain forbidden.

## Required independent review domains

The independent reviewer must cover all eleven domains as one system:

1. protocol and canonicalization;
2. hybrid cryptography and key-purpose binding;
3. PQ-only transport and Node identity;
4. isolated signer and key custody;
5. PostgreSQL replay / ACK / epoch / receipt transactionality;
6. Agent local durability and rollback;
7. coordinated backup/restore and off-host recovery floor;
8. owner-authorized key retirement;
9. parser fuzzing and external ML-DSA-65 verification vectors;
10. default-off redacted observability;
11. production migration, no-fallback and rollback architecture.

For v4, domains 3 and 6 must explicitly review the remediation changes rather than relying on the previous v3 conclusions.

## Frozen evidence index

The companion contract enumerates the required evidence documents, machine contracts and implementation evidence. It includes the internal audit as historical/remediation context, but that document remains explicitly non-independent.

The reviewer package contains exact source archives for the v4 Nexus and Node revisions plus the indexed control/evidence files. Existing CI is corroborating evidence only and cannot substitute for independent review.

## Required reviewer output

A closure-eligible external result must record at least:

- exact Nexus `12b3170996bc062ee16c79659a6378e5e425fd0e` and Node `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` revisions;
- attributable reviewer identity/organization and review date;
- scope and methodology covering all eleven domains;
- findings, severity, affected trust boundary and disposition;
- explicit review of `AI-LOW-001` and `AI-LOW-002` remediation;
- explicit review of Rust ingress/origin/ACK/recovery boundaries;
- explicit review of the final canary/rollout/activation/no-fallback architecture;
- remaining limitations;
- unambiguous approval, approval-with-findings, or rejection.

A later security-relevant code or material release-policy change makes the affected v4 scope stale and requires another freeze/re-review.

## External blockers remain open

The independent security review tracked by issue #137 remains required for this **v4** target. The internal AI review and repository CI are supporting evidence only.

P0-E4a / issue #138 also remains externally bounded. Qualification still requires five representative real abrupt-power experiments on the reviewed storage/controller/PLP stack plus independent review of the raw evidence. Process kills, VM stop/snapshot, synthetic fixtures, and successful `fsync(2)` calls do not substitute for those experiments.

Until both external blockers are legitimately satisfied and the exact-candidate release sequence is completed:

- `independentSecurityReviewComplete=false`;
- `physicalPowerLossQualified=false`;
- `productionActivation=false`;
- `strictPQEnabled=false`;
- `strict-pq` remains OFF;
- production rollout remains NOT AUTHORIZED;
- XMESH1 remains retained.
