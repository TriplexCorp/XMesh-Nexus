# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry, and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane, not an additional encryption layer around user traffic.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [Current P0-E checkpoint](P0E_CHECKPOINT.md) · [Stage 1/2 evidence](docs/XSP_V2_P0E_STAGE1_STAGE2_EVIDENCE_2026-10-30.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 30 October 2026

### P0-E: crash qualification, live cutover, and off-host recovery witness are complete; production activation remains prohibited

The reviewed production runtime remains frozen at:

- **XMesh-Nexus:** `12b3170996bc062ee16c79659a6378e5e425fd0e` — PR #163;
- **XMesh-Node:** `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — Node PR #52.

Qualification tooling and live evidence do not replace this frozen runtime target.

### #138 — completed real evidence boundaries

- Node KVM abrupt-crash matrix: **COMPLETE 5/5**;
- independent Nexus/PostgreSQL crash/recovery: **COMPLETE**;
- protected permit tooling binding/live build: **PASS**;
- protected Node 13 epoch `1 → 2` cutover / ACK / immutable receipt: **COMPLETE**;
- independent off-host production recovery-floor witness: **COMPLETE**.

Key SHA-256 values:

```text
applied ACK
07ccd07a317b6797b637d6cd0b1cc5c79fb90ef0c771c3ee7cc2b6aab79016a9

immutable commit receipt
daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9

recovery checkpoint
bc730df3a2078027cc4cbb4982da622dc8970dd49796fd9cbc0566a6364a3069

recovery verification result
4de873d0a5e9f85d245a9c880c0f75884117875888b5aedee4d4934cd64c5569
```

The off-host verifier confirmed:

```text
status=verified
nodeId=13
minimumEpoch=2
localEpoch=2
```

### Remaining #138 work

Do not repeat the crash matrix, cutover, or recovery witness merely to advance paperwork. Remaining work is:

1. explicit attributable provider-storage risk acceptance;
2. aggregate evidence/result assembly;
3. final topology-aware v2 verifier.

Until the whole-result verifier passes, the correct claims remain:

```text
guestCrashConsistencyQualified=false
providerStorageDurabilityAssumed=false
physicalPowerLossQualified=false
strictPQEnabled=false
productionActivation=false
```

### #137 — separate external blocker

**#137 independent external security review/sign-off of the current v5 package remains OPEN.** AI review, project-owner review, CI, or internal testing cannot satisfy it.

Authoritative v5 reviewer bundle:

- workflow run: `41054352179`;
- GitHub artifact ID: `12974974581`;
- deterministic inner tar SHA-256: `9d213e9281f0ffbbc3da21f9f3814d6e7fbef1e6b5273f6e9cb12175c63273c4`;
- payload SHA-256: `7b118084777d59e1ef1791d6375c32c1c44cf6bcdf9a03a2b0648a7ad9f263f2`.

### Current fast path

```text
#138 crash/recovery + cutover + off-host witness COMPLETE
             ↓
provider-storage risk acceptance
             ↓
aggregate evidence + final topology-aware v2 verifier
             ↓
#138 COMPLETE

#137 independent external review proceeds separately
```

After #137/#138 are complete, separate release gates still remain: exact production candidate, final canary, reviewed rollout/rollback plan, bounded KVM strict-PQ approval, and separate production execution.

## Production status

**Production PQ activation is NOT AUTHORIZED.** `strict-pq` remains **OFF**, XMESH1 remains retained, and `physicalPowerLossQualified=false` remains the correct KVM claim.

When resuming, read [`P0E_CHECKPOINT.md`](P0E_CHECKPOINT.md), then [`docs/ENTERPRISE_ROADMAP.md`](docs/ENTERPRISE_ROADMAP.md) and [`docs/XSP_V2_P0E_STAGE1_STAGE2_EVIDENCE_2026-10-30.md`](docs/XSP_V2_P0E_STAGE1_STAGE2_EVIDENCE_2026-10-30.md).
