# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 30 October 2026

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

Repo-side software/evidence tooling is complete and the expensive real crash phase of #138 is substantially complete. Remaining work is now primarily the live cutover/receipt chain plus two external/operational witnesses.

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

All five required Node guest crash checkpoints have accepted real runs:

1. `after-previous` → `previous-complete` — PASS;
2. `after-floor` → `next-complete` — PASS;
3. `after-active` → `next-complete` — PASS;
4. `after-recovery-abort` → `previous-complete` — PASS;
5. `after-recovery-active` → `next-complete` — PASS.

Canonical aggregate evidence already preserved:

- `nodeRuns` JSON SHA-256: `019c88d1d8c40f5803da746cfb8e6f881eee0c4070992b215209b3e9ac50dac0`;
- five-run bundle SHA-256: `27ee2b275efef60052c70b2c5f771422f61eedb2e105a6e90501d01503e60e31`.

An earlier orderly shutdown attempt is non-qualifying and must remain diagnostic evidence only.

**No new five-run crash matrix is required. Do not repeat these crashes unless later evidence proves corruption or invalidates them.**

### B. Independent Nexus/PostgreSQL abrupt crash/recovery — COMPLETE

The Nexus/PostgreSQL failure domain has its own accepted abrupt crash/recovery evidence:

- crash method: `provider-hard-stop`;
- pre/post security tuple SHA-256 remained identical: `c35df84ea54b5efb7203103ed5d769770db6ffc39fd8a4f974b452ec9ed65be5`;
- recovery observed and integrity checks passed;
- `fsync=on`;
- `full_page_writes=on`;
- `synchronous_commit=on`;
- `wal_sync_method=fdatasync`;
- PostgreSQL event archive SHA-256: `21996209bbae7edf240f66e5066cfffb5912446f33167425d1c0e7196d177433`;
- PostgreSQL result JSON SHA-256: `2d5bae53da3b31f77bce79c09848e0cfba121d8b0c1602c818d364a45f1d4040`.

This evidence is independent of the five Node crashes by design.

### C. Protected permit tooling — IMPLEMENTED, BOUND, LIVE BUILD PASS

PR #172 added a staging-only protected permit signer/operator without enabling strict-PQ or production activation. PR #173 bound that tooling to the reviewed Nexus runtime without changing the production runtime target.

Exact tooling revision:

`c00c6dcf1dba0ef923dd23371bc17b9dec781602`

Observed live exact-tooling build/binding result:

```text
permitToolingBound=true
permitSignerBinarySha256=45241e5e805ac4a403dc34915ec9c14d6881bfa8dd37827625ac5328ba007dd1
permitOperatorBinarySha256=458c7ef01d00a9ccdae70aac3f9006ba0fe6fd4a9188549348b1f9e8e223710b
buildEvidenceSha256=14f62e1dec9d56096a533e2260537e896ffee33b568a0709b68376c9dc509809
archiveSha256=1d3ff2ce8b39ffd9b160bfdd78ed524a07974243b5deb2c163a2abd55495d4ac
strictPQEnabled=false
productionActivation=false
```

The earlier expired proved proposal was cleared only after confirming it was expired/proved and before any cutover ledger or receipt existed. That cleanup is not itself cutover evidence.

## #138 remaining work — accelerated path

The heavy crash-testing phase is over. Remaining work should be executed as consolidated fail-closed stages rather than microscopic manual checks.

### Stage 1 — one real protected `1 → 2` cutover chain

Use the existing prepared Node candidate identity; do not regenerate private candidate keys.

Required sequence:

1. fresh owner-approved `prepare`;
2. Node proof-of-possession (`prove`) for the same candidate;
3. protected permit operator obtains a real dual-signed permit from the isolated signer;
4. Node activates the candidate **only** under that authenticated permit;
5. Node produces a real dual-signed applied ACK;
6. C2-C atomically commits public key/epoch/ACK state;
7. isolated signer emits the immutable dual-signed commit receipt.

Evidence must bind the exact permit, candidate digest, ACK and receipt. `strict-pq` remains OFF throughout.

### Stage 2 — off-host production recovery-floor witness

Create and verify the production recovery checkpoint on an independent/off-host trust location. The witness cannot be merely another copy inside the same Nexus/PostgreSQL failure domain.

Required result includes a real verified checkpoint/receipt binding for the subject Node and a monotonic floor that cannot be rolled back by restoring only the primary database.

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

Required external evidence includes:

- attributable independent reviewer identity/organization/date;
- review bound to the frozen Nexus/Node runtime and authoritative v5 bundle;
- all 11 mandatory review domains;
- explicit review of prior Low remediations and KVM/provider-storage policy;
- findings with severity, evidence, trust boundary and disposition;
- no unresolved release-blocking finding;
- machine-accepted `approve` or `approve-with-findings` sign-off.

Project-owner review, AI review, green CI, synthetic fixtures, packaging or handoff generation do not satisfy #137.

## Current qualification state

```text
#138 Node five-run matrix = COMPLETE
#138 independent PostgreSQL crash/recovery = COMPLETE
#138 permit tooling bound/live build = PASS
#138 protected live cutover/ACK/receipt = PENDING
#138 off-host production recovery witness = PENDING
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

The immediate engineering priority is no longer more crash loops. It is to finish the single real protected cutover/ACK/receipt chain, create the independent off-host witness, record provider risk acceptance, and run the final topology-aware #138 verifier while #137 proceeds independently.