# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 30 October 2026

This file defines the **current order of work**. Historical checkpoints and archived roadmap snapshots do not override this document.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ independent security review ≠ physical qualification ≠ production deployment.

## Current source state

- **Current Nexus `main`:** `6c901233da816b90021f03dc766c039ad3c7f070` — merge of PR #159.
- **Current independent-review snapshot:** Nexus `0bab1a48cff570b3abe405bcda4dc242b23b8a4b` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`.
- **Protected Nexus runtime baseline:** `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091`.
- **Production state:** `strict-pq=OFF`, `productionActivation=false`, XMESH1 retained.

PR #156 (`700cd64c56df9c5f3ab3870cbb64ba5f31747351`) refreshed the independent-review handoff to v3. The review snapshot deliberately includes the final non-executing release-control architecture from PRs #150, #152, and #155 while preserving the older `8c64a8e…` revision as the protected runtime baseline. The handoff CI proves the protected runtime paths remain equivalent across that boundary.

PR #159 (`6c901233da816b90021f03dc766c039ad3c7f070`) retargets the machine-checkable independent-review result acceptance contract to the v3 snapshot and authoritative post-merge reviewer bundle.

## Current reviewer bundle

Authoritative v3 reviewer bundle:

- workflow run: `41037503656`;
- deterministic inner tar SHA-256: `bac34400ac9b646c8a0f64ca9495e380ff0afce373310787c96385b9e40486bf`;
- payload SHA-256: `33c8f07f4513cb03400c8b7af2f34f804661a79501336206482c0f426866620a`;
- GitHub artifact ID: `12967634062` — transport/navigation metadata only.

The bundle and its result contract are evidence transport/acceptance mechanisms. They do **not** perform or replace the external review.

## P0 status

### P0-C2-D — COMPLETE

The authenticated command path, exact ACK/recovery semantics, protected origin boundary, response-loss handling, and transport-negative/no-legacy checks are complete within their stated staging/security scope.

### P0-D — COMPLETE

The durable Agent release identity, staged apply/rollback, real Agent migration/update path, authenticated authority binding, durable security state, and exact release-artifact binding are complete within their stated scope.

### P0-E — CURRENT

All repo-side software and release-control preparation currently required before production PQ is complete. Remaining blockers are external evidence, not missing CI scaffolding.

## P0-E completed repo-side gates

The following are COMPLETE as bounded repo-side preparation/evidence tooling:

- process-crash durability;
- one-sided Agent snapshot anti-rollback;
- one-sided PostgreSQL snapshot rollback resistance;
- off-host monotonic recovery checkpoint;
- coordinated backup/restore and old-set rejection;
- storage durability preflight;
- external power-cut arming readiness;
- single-run physical evidence contract;
- five-checkpoint abrupt-power matrix tooling;
- real-operation lab reachability;
- physical-run handoff and post-boot evidence binding;
- returned independent qualification-review result contract/verifier;
- owner-authorized previous-key retirement authorization;
- offline owner issuance;
- crash-safe durable old-key erasure;
- bounded parser fuzzing;
- external ML-DSA-65 FIPS 204 verification vectors;
- default-off redacted observability;
- v3 independent security-review handoff;
- reproducible reviewer bundle;
- v3 independent-review result acceptance;
- disposable release-canary rehearsal;
- production rollout-plan acceptance verifier;
- explicit strict-PQ activation approval gate.

None of these repo-side gates by itself authorizes production.

## Remaining P0-E blockers

### #137 — independent external security review — OPEN

Required external evidence:

- attributable independent reviewer identity/organization/date;
- review bound to Nexus `0bab1a48cff570b3abe405bcda4dc242b23b8a4b` and Node `083dc181c5e175f89007f4b93111cd5c45a69d97`;
- all 11 mandatory review domains covered exactly once;
- findings with severity, evidence, affected trust boundary, and disposition;
- no unresolved release-blocking finding;
- explicit `approve` or `approve-with-findings` sign-off eligible under the verifier;
- any security-relevant remediation or material release-control change triggers re-freeze/re-review of the affected scope.

Project-owner self-review, green CI, synthetic fixtures, packaging, or the handoff itself do not satisfy this blocker.

### #138 — five representative real abrupt-power runs — OPEN

Exactly one real externally triggered abrupt-power experiment is required at each checkpoint on the same reviewed representative storage/controller/PLP scope:

1. `after-previous`
2. `after-floor`
3. `after-active`
4. `after-recovery-abort`
5. `after-recovery-active`

Each run must preserve the real controller/BMC/PDU event, pre/post boot IDs, exact binaries/source revisions, Agent state, PostgreSQL/WAL recovery state, storage/preflight evidence, off-host witness binding, and E4a6 verification output.

Process kills, VM stops/snapshots, synthetic CI, or successful `fsync(2)` returns are not physical qualification evidence.

After all five runs, the exact five-run matrix and raw evidence require independent review and a qualification recommendation accepted by the existing verifier. Scope-changing findings require a new five-run matrix.

## Post-P0-E release sequence

Closing #137 and #138 does **not** directly switch production on. The release sequence remains fail-closed:

```text
#137 independent external security review COMPLETE
            +
#138 real physical abrupt-power qualification COMPLETE
            ↓
exact production release candidate selected
            ↓
full disposable final canary rerun on exact candidate
            ↓
real rollout/rollback plan bound to exact candidate and evidence
            ↓
independent review of that rollout/rollback plan
            ↓
explicit bounded strict-PQ activation approval
            ↓
separate production execution
```

## Disposable final canary

PR #150 proves the rehearsal harness is ready, but the recorded rehearsal is not the final production canary. The exact candidate chosen after P0-E completion must rerun the full canary.

Until that happens:

- `finalReleaseCanarySatisfied=false`;
- no rollout plan can become release-eligible;
- no strict-PQ approval can become execution-eligible.

## Production rollout-plan gate

PR #152 defines the non-executing rollout-plan acceptance policy. A real candidate plan must bind:

- exact Nexus/Node candidate revisions and production artifact digests;
- accepted #137 security-review evidence;
- accepted #138 physical-qualification evidence;
- final exact-candidate canary result;
- topology and named rollout scope;
- DNS/firewall/Nginx dispositions;
- PostgreSQL migration/recovery disposition;
- key/certificate/signer handling;
- observability and rollback criteria;
- independent plan reviewer approval.

The verifier never performs deployment changes and cannot set production activation flags.

## Explicit strict-PQ activation approval

PR #155 defines the final non-executing authorization gate before production execution.

Policy invariants include:

- one exact release candidate;
- accepted external security-review evidence;
- accepted physical-qualification evidence;
- accepted rollout-plan evidence;
- exact final-canary evidence;
- explicit named-Node scope only;
- maximum 50 Nodes per approval;
- maximum 24-hour approval window;
- TLS 1.3 + `X25519MLKEM768` + ML-DSA-65 identity;
- Ed25519 **AND** ML-DSA-65 critical-message signatures;
- `automaticFallback=false`;
- no classical-only downgrade;
- `strictPqAction=enable` separated from `legacyXMESH1Action=retain`.

Even an eligible approval still reports:

```text
strictPQEnabled=false
productionActivation=false
legacyXMESH1Retired=false
requiresSeparateExecution=true
```

Production execution must therefore remain a distinct reviewed action.

## XMESH1 retirement

Initial PQ activation does not retire XMESH1. XMESH1 remains retained during first strict-PQ activation and requires a later explicit retirement decision with its own evidence and rollback considerations.

## Security-review domains

The external #137 review must cover all 11 domains as one migration/production architecture:

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

Domain 11 explicitly includes the final release-control architecture from PRs #150, #152, and #155.

## Core production security invariants

Production PQ must not weaken the following invariants:

- TLS 1.3 only on the dedicated PQ ingress;
- actually negotiated `X25519MLKEM768` hybrid key exchange;
- ML-DSA-65 client identity;
- Ed25519 and ML-DSA-65 dual critical-message authorization;
- isolated signer/key custody;
- durable monotonic replay/epoch state;
- crash-safe Agent state transitions;
- off-host rollback witness/floor;
- exact release-artifact identity;
- owner-authorized retirement;
- no automatic fallback;
- no classical-only production mode;
- production-capable paths remain default-disabled until all explicit release decisions are satisfied.

## Current production decision

**Production PQ activation is NOT AUTHORIZED.**

Current required state:

```text
independentSecurityReviewComplete=false
physicalPowerLossQualified=false
finalReleaseCanarySatisfied=false
productionActivation=false
strictPQEnabled=false
legacyXMESH1Retired=false
```

The only legitimate way to change that state is to complete the external blockers and then pass the existing exact-candidate release sequence. New runtime code should not be added merely to manufacture progress while the v3 review target is frozen, because security-relevant changes can invalidate the current review scope.
