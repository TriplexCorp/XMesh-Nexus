# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 30 October 2026

This file defines the **current order of work**. Historical checkpoints and archived roadmap snapshots do not override it.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ independent security review ≠ real deployment-class durability evidence ≠ production deployment.

## Current frozen runtime and review package

Current security-remediated runtime target:

- **XMesh-Nexus:** `12b3170996bc062ee16c79659a6378e5e425fd0e` — PR #163, mandatory TLS client authentication on the dedicated PQ ingress;
- **XMesh-Node:** `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — Node PR #52, parent-directory durability for initial master-key creation.

The AI-assisted internal audit in PR #162 found two Low issues (`AI-LOW-001`, `AI-LOW-002`). Both were remediated; the internal audit remains `independent=false` and cannot satisfy #137.

The current external-review package is **v5 KVM VPS**, created by PR #168. Runtime is unchanged from v4; v5 exists because PRs #166/#167 materially changed the reviewed release-control policy.

Authoritative post-merge v5 reviewer bundle:

- workflow run: `41054352179`;
- GitHub artifact ID: `12974974581` — navigation/transport metadata only;
- deterministic inner tar SHA-256: `9d213e9281f0ffbbc3da21f9f3814d6e7fbef1e6b5273f6e9cb12175c63273c4`;
- payload SHA-256: `7b118084777d59e1ef1791d6375c32c1c44cf6bcdf9a03a2b0648a7ad9f263f2`.

PR #169 binds machine-checkable #137 result acceptance to this exact package. Older v3/v4 packages are historical evidence only.

## Deployment-class model

### Active class: `kvm-vps`

The current production target is a KVM VPS. The operator does not control the physical host, BMC/PDU, storage controller, write cache, or PLP boundary.

For this class:

- XMesh qualifies guest-visible Agent/PostgreSQL crash consistency;
- provider-managed block storage is an explicit external trust boundary;
- provider durability risk must be accepted explicitly by the release owner;
- `physicalPowerLossQualified=false` remains mandatory and correct;
- production eligibility uses the KVM-specific durability and strict-PQ approval gates.

### Retained class: bare metal

The original E4a physical-power profile remains available for deployments where the operator controls representative hardware and can trigger real BMC/PDU/controller power removal.

PR #166 rebound that retained physical profile to the current remediated Node PR #52 target while preserving Node PR #44/#45 only as provenance for the original power-cut hook and lab runner.

Passing KVM qualification does not claim bare-metal physical qualification, and the bare-metal profile does not block the active KVM production path.

## P0 status

### P0-C2-D — COMPLETE

Authenticated command path, exact ACK/recovery semantics, protected origin boundary, response-loss handling, transport-negative/no-legacy checks, and mandatory TLS client-authentication boundary are complete within their stated scope.

### P0-D — COMPLETE

Durable Agent release identity, staged apply/rollback, real Agent migration/update path, authenticated authority binding, durable security state, exact release-artifact binding, and parent-directory durable master-key provisioning are complete within their stated scope.

### P0-E — CURRENT

Repo-side software, evidence contracts, deterministic review packaging, and both deployment-class release-control profiles are complete. Remaining blockers require real external/operational evidence.

## P0-E completed repo-side gates

Completed bounded preparation/tooling includes:

- process-crash durability and crash matrices;
- one-sided Agent/PostgreSQL rollback resistance;
- coordinated backup/restore and off-host monotonic recovery floor;
- owner-authorized previous-key retirement and durable erasure;
- parser fuzzing and external ML-DSA-65 FIPS 204 verification vectors;
- default-off redacted observability;
- mandatory-mTLS ingress hardening (`AI-LOW-001` remediation);
- initial master-key directory durability (`AI-LOW-002` remediation);
- bare-metal E4a arm/evidence/matrix/handoff profile rebound to current Node target;
- KVM VPS five-run durability qualification contract/verifier;
- provider-storage trust/risk-acceptance boundary;
- v5 independent-review handoff and reproducible reviewer bundle;
- v5 independent-review result acceptance;
- disposable release-canary rehearsal;
- production rollout/rollback plan tooling;
- KVM VPS bounded strict-PQ approval gate;
- retained bare-metal strict-PQ approval profile.

None of these repo-side gates by itself authorizes production.

## Remaining P0-E blockers

### #137 — independent external security review of v5 — OPEN

Required external evidence:

- attributable independent reviewer identity/organization/date;
- review bound to Nexus `12b3170996bc062ee16c79659a6378e5e425fd0e` and Node `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`;
- use of the authoritative v5 reviewer bundle hashes above;
- all 11 mandatory review domains covered exactly once;
- explicit review of `AI-LOW-001` and `AI-LOW-002` remediation;
- explicit review in domains 6 and 11 of the KVM five-run model, provider-storage trust assumption, KVM/bare-metal separation, and KVM-specific activation gate;
- findings with severity, evidence, affected trust boundary, and disposition;
- no unresolved release-blocking finding;
- `approve` or `approve-with-findings` sign-off accepted by the verifier.

Project-owner review, AI internal review, green CI, synthetic fixtures, packaging, or handoff generation do not satisfy #137.

### #138 — KVM VPS five-run crash-consistency qualification — OPEN

One **real** guest crash cycle is required at every existing durability checkpoint:

1. `after-previous` → `previous-complete`;
2. `after-floor` → `next-complete`;
3. `after-active` → `next-complete`;
4. `after-recovery-abort` → `previous-complete`;
5. `after-recovery-active` → `next-complete`.

Allowed methods:

- `provider-hard-stop` — preferred when the provider operation is documented not to perform orderly guest shutdown;
- `guest-kernel-panic` — accepted fallback when no provider lifecycle primitive exists.

Ordinary orderly `shutdown`, `reboot`, service/process/container restart, snapshot restore, or synthetic CI do not satisfy this gate.

Each run must preserve unique crash evidence, changed boot identity, exact rotation identity/epoch, post-boot Agent state digest, PostgreSQL recovery/integrity evidence, durable PostgreSQL settings, and off-host monotonic floor evidence.

A completed KVM result must additionally record provider/storage class and explicit attributable acceptance of the provider-managed block-storage durability trust assumption.

Successful KVM qualification means:

```text
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
physicalPowerLossQualified=false
productionDurabilityGateEligible=true
```

It does not authorize production by itself.

## Post-P0-E release sequence

```text
#137 independent external review of v5 COMPLETE
            +
#138 KVM five-run crash qualification COMPLETE
     + provider-storage risk accepted
            ↓
exact production release candidate selected
            ↓
full disposable final canary rerun on exact candidate
            ↓
real rollout/rollback plan bound to exact candidate and evidence
            ↓
independent review of rollout/rollback plan
            ↓
bounded KVM strict-PQ activation approval
            ↓
separate production execution
```

Closing #137/#138 does **not** directly enable PQ.

## Disposable final canary

PR #150 proves the rehearsal harness, not the final production candidate. After #137/#138 close, the exact candidate must rerun the full canary.

Until then:

```text
finalReleaseCanarySatisfied=false
```

## Rollout/rollback plan

The historical PR #152 verifier remains useful for structural plan validation, but its old bare-metal `physicalPowerQualificationAccepted` eligibility condition must **not** be lied about for KVM.

For the active KVM release path, the reviewed plan must still bind:

- exact Nexus/Node candidate revisions and artifact digests;
- accepted #137 review result;
- accepted #138 KVM durability result;
- provider-storage risk acceptance;
- exact final-canary evidence;
- named topology and rollout scope;
- DNS/firewall/Nginx dispositions;
- PostgreSQL migration/recovery disposition;
- key/certificate/signer handling;
- observability and rollback criteria;
- independent plan reviewer approval.

The KVM strict-PQ approval gate binds the accepted plan/review hashes directly rather than fabricating the old physical qualification boolean.

## KVM strict-PQ activation approval

The KVM-specific non-executing authorization gate requires:

- exact runtime/candidate identity;
- accepted independent security review;
- accepted KVM five-run durability result;
- explicit provider-storage risk acceptance;
- final exact-candidate canary;
- independently reviewed rollout/rollback plan;
- `limited-canary` or `phased` scope;
- at most 50 named Nodes;
- at most a 24-hour approval window;
- release-owner authority.

Transport/security invariants cannot be weakened:

- TLS 1.3 only;
- `X25519MLKEM768`;
- ML-DSA-65 client identity;
- Ed25519 **AND** ML-DSA-65 critical-message signatures;
- `automaticFallback=false`;
- `classicalOnlyAllowed=false`;
- `strictPqAction=enable`;
- `legacyXMESH1Action=retain`.

Even an eligible approval still reports:

```text
physicalPowerLossQualified=false
strictPQEnabled=false
productionActivation=false
legacyXMESH1Retired=false
requiresSeparateExecution=true
```

Production execution remains a distinct reviewed action.

## XMESH1 retirement

Initial strict-PQ activation does not retire XMESH1. XMESH1 remains retained during first activation and requires a later explicit retirement decision with separate evidence and rollback considerations.

## Mandatory security-review domains

The external #137 reviewer must cover all eleven domains:

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
11. production migration, no-fallback, release-control, and rollback architecture.

For v5, domains 6 and 11 explicitly include the KVM deployment policy and provider-storage trust boundary.

## Core production security invariants

Production PQ must preserve:

- mandatory client authentication on the dedicated PQ ingress;
- TLS 1.3 only and negotiated `X25519MLKEM768`;
- ML-DSA-65 Node/client identity;
- Ed25519 and ML-DSA-65 dual critical-message authorization;
- isolated signer/key custody;
- durable monotonic replay/epoch state;
- crash-safe Agent state transitions and durable master-key creation;
- off-host rollback witness/floor;
- exact release-artifact identity;
- owner-authorized retirement;
- no automatic fallback;
- no classical-only production mode;
- production-capable paths default-disabled until all explicit release decisions are satisfied.

## Current production decision

**Production PQ activation is NOT AUTHORIZED.**

Current state:

```text
independentSecurityReviewComplete=false
guestCrashConsistencyQualified=false
providerStorageDurabilityAssumed=false
physicalPowerLossQualified=false
finalReleaseCanarySatisfied=false
productionActivation=false
strictPQEnabled=false
legacyXMESH1Retired=false
```

The legitimate path forward is to collect real #137/#138 evidence, then run the exact-candidate release sequence. New security-relevant runtime or material release-policy changes require another freeze/re-review rather than silently transferring old approval.
