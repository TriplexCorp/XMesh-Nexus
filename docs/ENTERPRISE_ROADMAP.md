# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 30 October 2026

### Latest #138 live qualification override

The live qualification state has advanced beyond the older Stage 1/Stage 2 PENDING wording preserved later in this document.

Current authoritative state:

```text
#138 Node five-run matrix = COMPLETE
#138 independent PostgreSQL crash/recovery = COMPLETE
#138 permit tooling bound/live build = PASS
#138 protected live cutover/ACK/receipt = COMPLETE
#138 off-host production recovery witness = COMPLETE
#138 provider-storage risk acceptance = PENDING
#138 aggregate v2 verifier = PENDING
#137 independent external review = OPEN

strictPQEnabled=false
productionActivation=false
```

Node 13 is committed at epoch/floor `2`. The immutable receipt SHA-256 is `daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9`. The independent off-host witness verified `minimumEpoch=2` with `localEpoch=2`; its checkpoint SHA-256 is `bc730df3a2078027cc4cbb4982da622dc8970dd49796fd9cbc0566a6364a3069` and verification-result SHA-256 is `4de873d0a5e9f85d245a9c880c0f75884117875888b5aedee4d4934cd64c5569`.

The remaining #138 path is now only provider-storage risk acceptance, aggregate evidence assembly, and the final topology-aware v2 verifier. Do **not** repeat the completed crash matrix, cutover, or off-host witness merely to advance paperwork.

Full Stage 1/Stage 2 evidence is recorded in [`XSP_V2_P0E_STAGE1_STAGE2_EVIDENCE_2026-10-30.md`](XSP_V2_P0E_STAGE1_STAGE2_EVIDENCE_2026-10-30.md).

This file defines the **current order of work**. Historical checkpoints do not override it.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ independent security review ≠ real deployment-class durability evidence ≠ production deployment.

For exact per-run evidence SHA-256 values and session-resume state, also read [`../P0E_CHECKPOINT.md`](../P0E_CHECKPOINT.md) and the dated live qualification handoff linked from it.

## Current frozen runtime and review package

Reviewed production runtime target remains:

- **XMesh-Nexus:** `12b3170996bc062ee16c79659a6378e5e425fd0e` — PR #163, mandatory TLS client authentication on the dedicated PQ ingress;
- **XMesh-Node:** `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — Node PR #52, parent-directory durability for initial master-key creation.

Qualification/staging tooling introduced later is bound separately and does **not** silently replace the production runtime target.

Current external-review package is **v5 KVM VPS**:

- workflow run `41054352179`;
- GitHub artifact ID `12974974581`;
- deterministic inner tar SHA-256 `9d213e9281f0ffbbc3da21f9f3814d6e7fbef1e6b5273f6e9cb12175c63273c4`;
- payload SHA-256 `7b118084777d59e1ef1791d6375c32c1c44cf6bcdf9a03a2b0648a7ad9f263f2`.

PR #169 binds machine-checkable #137 result acceptance to this exact package. The AI-assisted internal audit remains `independent=false` and cannot satisfy #137.

## Deployment-class model

### Active class: `kvm-vps`

The operator controls the guest, not the provider physical host, BMC/PDU, storage controller, write cache, or PLP boundary.

Therefore:

- Node guest crash consistency is qualified on the Node failure domain;
- PostgreSQL crash/recovery is qualified independently on the Nexus/PostgreSQL failure domain;
- off-host production recovery floor is an independent witness;
- provider-managed storage durability remains an explicit external trust boundary;
- `physicalPowerLossQualified=false` remains mandatory and correct for this deployment class.

PR #171 merged the topology-aware KVM VPS durability v2 contract/verifier. It intentionally stopped pretending that a Node VPS crash also crashes PostgreSQL.

## P0 status

### P0-C2-D — COMPLETE

Authenticated command path, exact ACK/recovery semantics, protected origin boundary, response-loss handling, transport-negative/no-legacy checks, and mandatory TLS client-authentication boundary are complete within their stated scope.

### P0-D — COMPLETE

Durable Agent release identity, staged apply/rollback, real Agent migration/update path, authenticated authority binding, durable security state, exact release-artifact binding, and parent-directory durable master-key provisioning are complete within their stated scope.

### P0-E — CURRENT

Repo-side software/evidence tooling is complete. The real Node crash matrix, independent PostgreSQL crash/recovery, protected Node 13 epoch `1 → 2` cutover/ACK/receipt chain, and independent off-host recovery-floor witness are complete. Remaining #138 work is provider-storage risk acceptance plus aggregate verification; #137 remains an independent external blocker.

## P0-E completed repo-side gates

Completed bounded preparation/tooling includes:

- process-crash durability and crash matrices;
- one-sided Agent/PostgreSQL rollback resistance;
- coordinated backup/restore and off-host monotonic recovery floor tooling;
- owner-authorized previous-key retirement and durable erasure;
- parser fuzzing and external ML-DSA-65 FIPS 204 verification vectors;
- default-off redacted observability;
- mandatory-mTLS ingress hardening;
- initial master-key directory durability;
- KVM VPS topology-aware v2 durability contract/verifier — PR #171;
- protected permit signer/operator — PR #172;
- protected permit tooling source/binary binding — PR #173;
- durable live qualification handoff — PR #174;
- provider-storage trust/risk-acceptance boundary;
- v5 independent-review handoff, bundle and result acceptance;
- disposable release-canary rehearsal;
- production rollout/rollback plan tooling;
- KVM VPS bounded strict-PQ approval gate;
- retained bare-metal physical/strict-PQ profiles.

None of these repo-side gates by itself authorizes production.

## #138 real KVM qualification progress

### A. Node abrupt-crash matrix — COMPLETE 5/5

All five required Node guest crash checkpoints have accepted real runs.

Canonical aggregate evidence:

- `nodeRuns` JSON SHA-256: `019c88d1d8c40f5803da746cfb8e6f881eee0c4070992b215209b3e9ac50dac0`;
- five-run bundle SHA-256: `27ee2b275efef60052c70b2c5f771422f61eedb2e105a6e90501d01503e60e31`.

**No new five-run crash matrix is required.**

### B. Independent Nexus/PostgreSQL abrupt crash/recovery — COMPLETE

Accepted evidence includes:

- security tuple SHA-256 before/after: `c35df84ea54b5efb7203103ed5d769770db6ffc39fd8a4f974b452ec9ed65be5`;
- PostgreSQL event archive SHA-256: `21996209bbae7edf240f66e5066cfffb5912446f33167425d1c0e7196d177433`;
- PostgreSQL result JSON SHA-256: `2d5bae53da3b31f77bce79c09848e0cfba121d8b0c1602c818d364a45f1d4040`.

### C. Protected permit tooling — IMPLEMENTED, BOUND, LIVE BUILD PASS

Exact tooling revision: `c00c6dcf1dba0ef923dd23371bc17b9dec781602`.

Observed live binding includes `permitToolingBound=true`; this remains qualification tooling and does not replace the frozen reviewed runtime.

### D. Protected live Node 13 cutover / ACK / receipt — COMPLETE

Preserved evidence:

```text
protected permit result SHA-256  ac88343dde50076ad3779d9cb1a62b029b14c4b6d3e89fa6ba894fb16d90cba7
permit digest                     132906a49cfa7cdebb9fc0b346f93963802b73cc23aca1a333b2d449727fd642
applied ACK SHA-256               07ccd07a317b6797b637d6cd0b1cc5c79fb90ef0c771c3ee7cc2b6aab79016a9
commit receipt SHA-256            daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9
```

Node and Nexus/C2-C reached committed epoch `2`; the ledger recorded `ack_verified`.

### E. Off-host production recovery-floor witness — COMPLETE

The independent witness verified the exact immutable receipt above at `minimumEpoch=2`, `localEpoch=2`.

```text
recovery pin SHA-256           810ab308323cc881f957b0d65b856d44420e6fa632034f94e51ccd5af1c05a07
recovery checkpoint SHA-256    bc730df3a2078027cc4cbb4982da622dc8970dd49796fd9cbc0566a6364a3069
recovery local-state SHA-256   d6dde3b05fc2fe234348b8e8219aab90ec9e772247924432ec59c535230a9b01
recovery verification SHA-256  4de873d0a5e9f85d245a9c880c0f75884117875888b5aedee4d4934cd64c5569
```

## #138 remaining work — final tail

### Stage 3 — provider-storage risk acceptance

Record explicit attributable acceptance for both relevant KVM provider-storage trust boundaries. This is a governance/evidence step, not another crash test.

Do not infer provider identity or acceptance from hostnames, CI, or operator behavior.

### Stage 4 — aggregate result + v2 verifier

Assemble the real Node runs, PostgreSQL record, off-host witness, provider acceptance and exact tooling/runtime bindings into the v2 result/evidence bundle.

Only the whole topology-aware verifier may establish:

```text
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
physicalPowerLossQualified=false
productionDurabilityGateEligible=true
```

Until that verifier passes, the authoritative claims remain false.

## #137 — independent external security review of v5 — OPEN

This remains a separate external blocker and can proceed in parallel with the final #138 operational tail.

Project-owner review, AI review, green CI, synthetic fixtures, packaging or handoff generation do not satisfy #137.

## Current qualification state

```text
#138 Node five-run matrix = COMPLETE
#138 independent PostgreSQL crash/recovery = COMPLETE
#138 permit tooling bound/live build = PASS
#138 protected live cutover/ACK/receipt = COMPLETE
#138 off-host production recovery witness = COMPLETE
#138 provider-storage risk acceptance = PENDING
#138 aggregate v2 verifier = PENDING
#137 independent external review = OPEN

independentSecurityReviewComplete=false
guestCrashConsistencyQualified=false
providerStorageDurabilityAssumed=false
physicalPowerLossQualified=false
finalReleaseCanarySatisfied=false
strictPQEnabled=false
productionActivation=false
legacyXMESH1Retired=false
```

## Post-P0-E release sequence

After #137 and #138 are genuinely complete:

```text
exact production release candidate selected
            ↓
full disposable final canary rerun on exact candidate
            ↓
real rollout/rollback plan bound to exact candidate/evidence
            ↓
independent review of rollout/rollback plan
            ↓
bounded KVM strict-PQ activation approval
            ↓
separate production execution
```

Closing #137/#138 does **not** directly enable PQ.

## Current production decision

**Production PQ activation is NOT AUTHORIZED.**

The immediate engineering priority is provider-storage risk acceptance, then final aggregate evidence assembly and the topology-aware #138 verifier. Do not repeat already accepted crash, cutover, or off-host recovery evidence unless later evidence proves it invalid.
