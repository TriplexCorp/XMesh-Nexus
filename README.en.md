# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry, and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane, not an additional encryption layer around user traffic.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [Current P0-E checkpoint](P0E_CHECKPOINT.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 30 October 2026

### P0-E: real protected `1 → 2` cutover COMPLETE; #138 has 3 stages left

The reviewed production runtime remains frozen at:

- **XMesh-Nexus:** `12b3170996bc062ee16c79659a6378e5e425fd0e` — PR #163;
- **XMesh-Node:** `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — Node PR #52.

Qualification/staging tooling is versioned separately and **does not replace** this production runtime target.

### Completed work

- **Node KVM abrupt-crash matrix: COMPLETE — 5/5**;
- **independent Nexus/PostgreSQL abrupt crash/recovery: COMPLETE**;
- topology-aware KVM VPS v2 contract/verifier — PR #171;
- protected permit signer/operator — PR #172;
- exact permit-tooling source/binary binding — PR #173;
- durable live qualification checkpoint — PR #174;
- live exact-tooling build/binding — **PASS**;
- fresh owner-authenticated `prepare` — **PASS**;
- Node proof-of-possession for the existing `.next` candidate — **PASS**;
- **real protected Node 13 cutover `epoch 1 → 2`: COMPLETE**;
- Node monotonic floor after cutover: **2**;
- real dual-signed applied ACK: **VERIFIED + DURABLE**;
- atomic Nexus/C2-C epoch commit: **Nexus epoch 2**;
- immutable dual-signed commit receipt: **VERIFIED + DURABLE**;
- signed receipt outbox rows: **1**.

### Live cutover evidence

Critical #138 Stage 1 completed end-to-end using the existing candidate without regenerating keys:

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

Evidence SHA-256:

- protected permit operator result: `ac88343dde50076ad3779d9cb1a62b029b14c4b6d3e89fa6ba894fb16d90cba7`;
- canonical permit digest verified by Node: `132906a49cfa7cdebb9fc0b346f93963802b73cc23aca1a333b2d449727fd642`;
- permit envelope: `1aba4ca1e0c7361eb0280a0d1de9254c0649cbdb8bed3e7d05774bb6b5b5625e`;
- signed applied ACK: `07ccd07a317b6797b637d6cd0b1cc5c79fb90ef0c771c3ee7cc2b6aab79016a9`;
- signed commit receipt: `daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9`;
- qualification helper built against the exact frozen Node runtime: `baa53a928fc4cc55ed48c954395435f446873dfa5aab4808afd5d87ab351c3ff`.

`ledgerState=ack_verified` is the **expected final state for the frozen runtime**: the immutable receipt is stored separately in `node_xsp_signed_commit_receipt_outbox`; the receipt writer requires an `ack_verified` committed ledger row and does not transition it to a separate `receipt_sent` state.

### Remaining #138 work — exactly 3 stages

No additional crash loops or repeated cutover are required.

1. **Off-host production recovery-floor witness** — create and independently verify the production recovery checkpoint/receipt outside the Nexus/PostgreSQL failure domain.
2. **Provider-storage risk acceptance** — separately and attributably record provider name/storage class and acceptance of provider-managed block-storage risk for Node and Nexus/PostgreSQL.
3. **Aggregate evidence + topology-aware v2 verifier** — combine Node runs, PostgreSQL evidence, live cutover, off-host witness, provider acceptance, and exact runtime/tooling bindings into one result and obtain verifier PASS.

Only the whole-result verifier may establish:

```text
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
productionDurabilityGateEligible=true
physicalPowerLossQualified=false
```

Until then the authoritative state remains:

```text
guestCrashConsistencyQualified=false
providerStorageDurabilityAssumed=false
physicalPowerLossQualified=false
strictPQEnabled=false
productionActivation=false
finalReleaseCanarySatisfied=false
legacyXMESH1Retired=false
```

### #137 — GitHub issue is closed, security gate is not evidenced as complete

GitHub metadata currently shows issue #137 as `closed/completed`, but the accessible issue thread and repository contain **no attributable external v5 result/sign-off** that satisfies the acceptance contract. The latest visible review is the AI-assisted internal audit with `independent=false`, which explicitly does not satisfy #137.

Therefore, until a real external result is present and verified, the correct security claim remains:

```text
independentSecurityReviewComplete=false
```

The issue's `closed` state does not substitute for external review evidence and does not authorize strict-PQ or production activation.

The authoritative v5 reviewer bundle remains:

- workflow run: `41054352179`;
- GitHub artifact ID: `12974974581`;
- deterministic inner tar SHA-256: `9d213e9281f0ffbbc3da21f9f3814d6e7fbef1e6b5273f6e9cb12175c63273c4`;
- payload SHA-256: `7b118084777d59e1ef1791d6375c32c1c44cf6bcdf9a03a2b0648a7ad9f263f2`.

### Current fast path

```text
#138 Stage 1 real cutover/ACK/receipt = COMPLETE
             ↓
off-host recovery-floor witness
             ↓
provider-storage risk acceptance
             ↓
aggregate topology-aware v2 verifier
             ↓
#138 COMPLETE

#137 external evidence must be genuinely accepted
             ↓
exact production release candidate
             ↓
full final canary on exact candidate
             ↓
independently reviewed rollout/rollback plan
             ↓
bounded KVM strict-PQ approval
             ↓
separate production execution
```

## Core XSP-v2 security properties

The architecture preserves:

- mandatory mTLS on the dedicated PQ ingress;
- TLS 1.3 only and negotiated `X25519MLKEM768`;
- ML-DSA-65 Node/client identity;
- Ed25519 **AND** ML-DSA-65 critical-message authorization;
- isolated signer/key custody;
- PostgreSQL transactionality for replay / ACK / epoch / receipt;
- crash-safe Agent state and monotonic epoch/replay floors;
- durable initial master-key provisioning;
- independent off-host recovery floor;
- owner-authorized previous-key retirement;
- parser fuzzing and external ML-DSA-65 vectors;
- default-off redacted observability;
- `automaticFallback=false`;
- `classicalOnlyAllowed=false`;
- production-capable paths default-disabled until an explicit release decision.

## Production status

**Production PQ activation is NOT AUTHORIZED.** `strict-pq` remains **OFF**, XMESH1 remains retained, and `physicalPowerLossQualified=false` remains the correct KVM claim.

When resuming, read [`P0E_CHECKPOINT.md`](P0E_CHECKPOINT.md) first, then [`docs/ENTERPRISE_ROADMAP.md`](docs/ENTERPRISE_ROADMAP.md).