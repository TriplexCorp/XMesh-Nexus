# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 30 October 2026

This file defines the **current order of work**. Historical checkpoints do not override it.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ independent security review ≠ real deployment-class durability evidence ≠ production deployment.

For detailed historical evidence, also read [`../P0E_CHECKPOINT.md`](../P0E_CHECKPOINT.md) and the dated live qualification handoff linked from it.

## Current frozen runtime and review package

Reviewed production runtime target remains:

- **XMesh-Nexus:** `12b3170996bc062ee16c79659a6378e5e425fd0e` — PR #163;
- **XMesh-Node:** `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — Node PR #52.

Qualification/staging tooling introduced later is bound separately and does **not** silently replace the production runtime target.

Current independent-review package remains **v5 KVM VPS**:

- workflow run `41054352179`;
- GitHub artifact ID `12974974581`;
- deterministic inner tar SHA-256 `9d213e9281f0ffbbc3da21f9f3814d6e7fbef1e6b5273f6e9cb12175c63273c4`;
- payload SHA-256 `7b118084777d59e1ef1791d6375c32c1c44cf6bcdf9a03a2b0648a7ad9f263f2`.

## Deployment-class model

### Active class: `kvm-vps`

The operator controls the guest, not the provider physical host, BMC/PDU, storage controller, write cache, or PLP boundary.

Therefore:

- Node guest crash consistency is qualified on the Node failure domain;
- PostgreSQL crash/recovery is qualified independently on the Nexus/PostgreSQL failure domain;
- off-host production recovery floor is an independent witness;
- provider-managed storage durability remains an explicit external trust boundary;
- `physicalPowerLossQualified=false` remains mandatory and correct for this deployment class.

## P0 status

### P0-C2-D — COMPLETE

Authenticated command path, exact ACK/recovery semantics, protected origin boundary, response-loss handling, transport-negative/no-legacy checks, and mandatory TLS client-authentication boundary are complete within their stated scope.

### P0-D — COMPLETE

Durable Agent release identity, staged apply/rollback, real Agent migration/update path, authenticated authority binding, durable security state, exact release-artifact binding, and parent-directory durable master-key provisioning are complete within their stated scope.

### P0-E — CURRENT

The expensive crash phase and the real protected cutover phase are complete. The remaining #138 tail is now **three stages only**: off-host recovery-floor witness, provider-storage risk acceptance, and aggregate topology-aware v2 verification.

Production activation remains unauthorized.

## Completed P0-E repo-side gates

Completed preparation/tooling includes:

- process-crash durability and crash matrices;
- one-sided Agent/PostgreSQL rollback resistance;
- coordinated backup/restore and off-host monotonic recovery-floor tooling;
- owner-authorized previous-key retirement and durable erasure;
- parser fuzzing and external ML-DSA-65 FIPS 204 verification vectors;
- default-off redacted observability;
- mandatory-mTLS ingress hardening;
- initial master-key directory durability;
- KVM VPS topology-aware v2 durability contract/verifier — PR #171;
- protected permit signer/operator — PR #172;
- protected permit tooling source/binary binding — PR #173;
- durable live qualification handoff — PR #174;
- provider-storage trust/risk-acceptance contract boundary;
- v5 independent-review handoff/bundle/result-acceptance tooling;
- disposable release-canary rehearsal;
- production rollout/rollback plan tooling;
- KVM VPS bounded strict-PQ approval gate;
- retained bare-metal physical/strict-PQ profiles.

None of these repo-side gates by itself authorizes production.

## #138 real KVM qualification progress

### A. Node abrupt-crash matrix — COMPLETE 5/5

All five required Node guest crash checkpoints have accepted real runs:

1. `after-previous` → `previous-complete` — PASS;
2. `after-floor` → `next-complete` — PASS;
3. `after-active` → `next-complete` — PASS;
4. `after-recovery-abort` → `previous-complete` — PASS;
5. `after-recovery-active` → `next-complete` — PASS.

Canonical aggregate evidence:

- `nodeRuns` JSON SHA-256: `019c88d1d8c40f5803da746cfb8e6f881eee0c4070992b215209b3e9ac50dac0`;
- five-run bundle SHA-256: `27ee2b275efef60052c70b2c5f771422f61eedb2e105a6e90501d01503e60e31`.

An earlier orderly shutdown attempt remains diagnostic only and must not be counted.

**No new five-run crash matrix is required.**

### B. Independent Nexus/PostgreSQL abrupt crash/recovery — COMPLETE

Accepted separate failure-domain evidence:

- crash method: `provider-hard-stop`;
- pre/post security tuple SHA-256 unchanged: `c35df84ea54b5efb7203103ed5d769770db6ffc39fd8a4f974b452ec9ed65be5`;
- recovery/integrity checks passed;
- `fsync=on`;
- `full_page_writes=on`;
- `synchronous_commit=on`;
- `wal_sync_method=fdatasync`;
- PostgreSQL event archive SHA-256: `21996209bbae7edf240f66e5066cfffb5912446f33167425d1c0e7196d177433`;
- PostgreSQL result JSON SHA-256: `2d5bae53da3b31f77bce79c09848e0cfba121d8b0c1602c818d364a45f1d4040`.

### C. Protected permit tooling — IMPLEMENTED, BOUND, LIVE BUILD PASS

Exact tooling revision:

`c00c6dcf1dba0ef923dd23371bc17b9dec781602`

Observed live build/binding:

```text
permitToolingBound=true
permitSignerBinarySha256=45241e5e805ac4a403dc34915ec9c14d6881bfa8dd37827625ac5328ba007dd1
permitOperatorBinarySha256=458c7ef01d00a9ccdae70aac3f9006ba0fe6fd4a9188549348b1f9e8e223710b
buildEvidenceSha256=14f62e1dec9d56096a533e2260537e896ffee33b568a0709b68376c9dc509809
archiveSha256=1d3ff2ce8b39ffd9b160bfdd78ed524a07974243b5deb2c163a2abd55495d4ac
strictPQEnabled=false
productionActivation=false
```

### D. Real protected `epoch 1 → 2` cutover/ACK/receipt — COMPLETE

The existing Node 13 prepared candidate was used; candidate keys were **not regenerated**.

Observed sequence:

1. fresh owner-authenticated `prepare` — PASS;
2. Node PoP `prove-prepared` for the same `.next` candidate — PASS;
3. protected permit operator obtained a real dual-signed permit — PASS;
4. Node independently verified and durably journaled the permit — PASS;
5. Node activated the exact approved candidate to epoch 2 — PASS;
6. Node monotonic floor advanced to 2 — PASS;
7. Node created and durably journaled a real dual-signed applied ACK — PASS;
8. C2-C atomically committed Nexus public-key/epoch/ACK state — PASS;
9. Nexus reached epoch 2 — PASS;
10. isolated signer produced the immutable dual-signed commit receipt — PASS;
11. Node independently verified and durably journaled the exact receipt — PASS.

Final observed state:

```text
requestId=node13-q138-cutover-20261030-01
nodeEpoch=2
nodeFloor=2
nexusEpoch=2
ledgerState=ack_verified
receiptOutbox=1
strictPQEnabled=false
productionActivation=false
```

Exact evidence SHA-256:

- protected permit operator result: `ac88343dde50076ad3779d9cb1a62b029b14c4b6d3e89fa6ba894fb16d90cba7`;
- Node-verified canonical permit digest: `132906a49cfa7cdebb9fc0b346f93963802b73cc23aca1a333b2d449727fd642`;
- signed permit envelope: `1aba4ca1e0c7361eb0280a0d1de9254c0649cbdb8bed3e7d05774bb6b5b5625e`;
- signed applied ACK: `07ccd07a317b6797b637d6cd0b1cc5c79fb90ef0c771c3ee7cc2b6aab79016a9`;
- signed commit receipt: `daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9`;
- qualification helper: `baa53a928fc4cc55ed48c954395435f446873dfa5aab4808afd5d87ab351c3ff`.

`ledgerState=ack_verified` is **correct for the frozen runtime**. The signed receipt is stored separately in immutable `node_xsp_signed_commit_receipt_outbox`; the receipt writer requires `ack_verified` and does not mutate the ledger into `receipt_sent`.

The cutover evidence proves only this boundary. It does **not** by itself satisfy the off-host witness, provider-storage acceptance, aggregate verifier, external review, final canary, activation approval, or production execution.

## #138 remaining work — exactly 3 stages

### Stage 2 — off-host production recovery-floor witness — PENDING

Create and verify the production recovery checkpoint on an independent/off-host trust location. The witness cannot be merely another copy inside the same Nexus/PostgreSQL failure domain.

Required result must bind the real subject Node and prove a monotonic recovery floor that cannot be rolled back by restoring only the primary database.

### Stage 3 — provider-storage risk acceptance — PENDING

Record explicit attributable acceptance for **both** relevant KVM provider-storage trust boundaries:

- Node provider/storage class;
- Nexus/PostgreSQL provider/storage class.

Required claim remains:

```text
storageTrustBoundary=provider-managed-block-storage
providerStorageDurabilityAssumed=true
physicalPowerLossQualified=false
```

Provider identity/storage class must not be inferred from hostnames.

### Stage 4 — aggregate result + topology-aware v2 verifier — PENDING

Assemble:

- five Node real crash runs;
- independent PostgreSQL crash/recovery evidence;
- exact runtime/tooling bindings;
- completed real protected cutover/ACK/receipt evidence;
- off-host production recovery-floor witness;
- attributable provider-storage acceptance.

Only the whole topology-aware verifier may establish:

```text
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
physicalPowerLossQualified=false
productionDurabilityGateEligible=true
```

Until verifier PASS, these release-gate claims remain false.

## #137 — independent external security review: ISSUE CLOSED, ACCEPTANCE EVIDENCE NOT PRESENT

GitHub issue metadata currently reports #137 as `closed/completed`.

However, the accessible issue thread and repository do **not** contain an attributable external v5 result/sign-off that satisfies the independent-review result contract. The latest visible review evidence is the AI-assisted internal audit with `independent=false`, explicitly documented as insufficient for #137.

Therefore the authoritative security claim remains:

```text
independentSecurityReviewComplete=false
```

The issue state alone is not sufficient evidence for the release gate. A real external result must still provide:

- attributable independent reviewer identity/organization/date;
- exact binding to Nexus `12b3170996bc062ee16c79659a6378e5e425fd0e` and Node `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`;
- binding to the authoritative v5 bundle;
- all 11 mandatory review domains;
- explicit KVM/provider-storage policy review;
- findings with severity/evidence/trust-boundary/disposition;
- no unresolved release-blocking finding;
- machine-accepted `approve` or `approve-with-findings` result.

If such evidence exists outside the currently accessible repository/issue thread, it must be attached or linked and verified before changing `independentSecurityReviewComplete`.

## Current qualification state

```text
P0-C2-D = COMPLETE
P0-D = COMPLETE
P0-E = CURRENT

#138 Node five-run matrix = COMPLETE
#138 independent PostgreSQL crash/recovery = COMPLETE
#138 permit tooling bound/live build = PASS
#138 protected live cutover/ACK/receipt = COMPLETE
#138 off-host production recovery witness = PENDING
#138 provider-storage risk acceptance = PENDING
#138 aggregate topology-aware v2 verifier = PENDING

#137 GitHub issue metadata = CLOSED/COMPLETED
#137 attributable external v5 acceptance evidence = NOT PRESENT/NOT VERIFIED

independentSecurityReviewComplete=false
guestCrashConsistencyQualified=false
providerStorageDurabilityAssumed=false
physicalPowerLossQualified=false
productionDurabilityGateEligible=false
finalReleaseCanarySatisfied=false
strictPQEnabled=false
productionActivation=false
legacyXMESH1Retired=false
```

## Fastest safe path from here

```text
off-host production recovery-floor witness
            ↓
provider-storage risk acceptance
            ↓
aggregate topology-aware #138 verifier
            ↓
#138 COMPLETE

in parallel:
real attributable #137 external result accepted
            ↓
exact production release candidate selected
            ↓
full disposable final canary on exact candidate
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

## KVM strict-PQ activation boundary

Any future approval must preserve:

- TLS 1.3 only;
- `X25519MLKEM768`;
- ML-DSA-65 client identity;
- Ed25519 **AND** ML-DSA-65 critical-message signatures;
- `automaticFallback=false`;
- `classicalOnlyAllowed=false`;
- limited/phased scope only;
- at most 50 named Nodes;
- at most a 24-hour approval window;
- `legacyXMESH1Action=retain` for first activation.

Even an eligible approval remains non-executing and must report:

```text
physicalPowerLossQualified=false
strictPQEnabled=false
productionActivation=false
legacyXMESH1Retired=false
requiresSeparateExecution=true
```

## Current production decision

**Production PQ activation is NOT AUTHORIZED.**

Immediate priority: finish the three remaining #138 stages and obtain/verify genuine external #137 evidence. Do not repeat the completed crash matrix or completed epoch-1→2 cutover unless later evidence proves corruption.