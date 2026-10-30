# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry, and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane, not an additional encryption layer around user traffic.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 30 October 2026

### P0-E: repo-side preparation is complete; production activation is still prohibited

All current repo-side preparation for production PQ is implemented and fail-closed:

- disposable release-canary rehearsal is ready;
- production rollout-plan verifier is ready;
- explicit bounded `strict-pq` activation approval gate is ready;
- independent-review handoff and reproducible reviewer bundle are ready;
- independent-review result contract/verifier is bound to the current v3 review snapshot;
- physical abrupt-power lab handoff, five-run matrix tooling, and returned-review verifier are ready.

This does **not** authorize production PQ. Two external P0-E blockers remain:

- **#137 — independent external security review/sign-off**;
- **#138 — five real representative abrupt-power runs plus independent review**.

Until both are genuinely complete:

- `strict-pq` = **OFF**;
- `productionActivation=false`;
- `physicalPowerLossQualified=false`;
- `independentSecurityReviewComplete=false`;
- legacy XMESH1 remains retained/active;
- production rollout = **NOT AUTHORIZED**.

### Current security-review target

PR #156 (`700cd64c56df9c5f3ab3870cbb64ba5f31747351`) refreshed the handoff to a **v3 review snapshot** so external review covers not only the frozen runtime but also the final release-control architecture introduced by PRs #150, #152, and #155.

The current external-review binding is:

- **Nexus review snapshot:** `0bab1a48cff570b3abe405bcda4dc242b23b8a4b`;
- **Node review target:** `083dc181c5e175f89007f4b93111cd5c45a69d97`;
- **protected Nexus runtime baseline:** `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091`.

`8c64a8e…` is no longer the complete current review snapshot; it is the runtime baseline. PR #156 proved the protected runtime paths remained equivalent while adding the final non-executing release-control/evidence scope to review.

### Reviewer bundle v3

The authoritative post-merge v3 reviewer bundle was produced after PR #156:

- workflow run: `41037503656`;
- deterministic inner tar SHA-256: `bac34400ac9b646c8a0f64ca9495e380ff0afce373310787c96385b9e40486bf`;
- payload SHA-256: `33c8f07f4513cb03400c8b7af2f34f804661a79501336206482c0f426866620a`;
- GitHub artifact ID: `12967634062` — transport/navigation metadata only.

PR #159 (`6c901233da816b90021f03dc766c039ad3c7f070`) retargeted the machine-checkable independent-review result contract to this v3 snapshot and bundle. The verifier remains fail-closed and does not perform an external review itself.

### Release-control checkpoints

- **PR #150 / disposable canary rehearsal:** harness readiness is proven; `finalReleaseCanarySatisfied=false`. The exact post-P0-E release candidate must rerun the full canary.
- **PR #152 / rollout-plan acceptance:** the verifier requires one exact candidate, accepted external P0-E evidence, the final canary, explicit topology/DNS/firewall/Nginx/PostgreSQL/key/observability/rollback dispositions, and independent plan review. It never deploys anything itself.
- **PR #155 / strict-PQ activation approval:** a separate explicit approval gate, bounded to at most 50 named Nodes and at most 24 hours. It forbids automatic fallback/classical-only downgrade and separates `strictPqAction=enable` from `legacyXMESH1Action=retain`.

Even an eligible approval deliberately reports:

```text
strictPQEnabled=false
productionActivation=false
legacyXMESH1Retired=false
requiresSeparateExecution=true
```

Approval and actual production execution are therefore separate decisions.

### What is COMPLETE

P0-C2-D and P0-D are complete. Within P0-E, all repo-side software/lab-preparation gates are complete, including process-crash durability, one-sided Agent/PostgreSQL rollback resistance, coordinated backup/restore, the off-host monotonic recovery floor, owner-authorized retirement, parser fuzzing, external ML-DSA-65 vectors, default-off redacted observability, physical-run handoff/tooling, canary rehearsal, rollout-plan verification, and the strict-PQ approval gate.

The production boundary is now:

```text
repo-side P0-E preparation COMPLETE
        ↓
#137 independent external security review
        +
#138 five real abrupt-power runs + independent review
        ↓
exact-candidate final canary
        ↓
independently reviewed rollout/rollback plan
        ↓
explicit bounded strict-PQ approval
        ↓
separate production execution
```

Any security-relevant runtime change or material change to the reviewed release-control policy after the freeze can require re-freeze/re-review of the affected scope.

## Core XSP-v2 security properties

The current P0-E architecture is built around these invariants:

- TLS 1.3 only on the dedicated PQ ingress;
- negotiated `X25519MLKEM768` hybrid key exchange;
- ML-DSA-65 client identity;
- Ed25519 **AND** ML-DSA-65 critical-message signatures;
- isolated signer/key-custody boundary;
- PostgreSQL transactionality for replay/ACK/epoch/receipt state;
- crash-safe Agent security state with monotonic epoch/replay floors;
- independent off-host recovery floor;
- owner-authorized old-key retirement;
- no automatic fallback / no classical-only production downgrade;
- production-capable paths remain default-disabled until an explicit release decision.

The authoritative work order and status are in [`docs/ENTERPRISE_ROADMAP.md`](docs/ENTERPRISE_ROADMAP.md). Specialized contracts, handoff guides, and evidence documents live under `docs/`, `deploy/`, `scripts/`, and `.github/workflows/`.

## Production status

**Production PQ activation is NOT AUTHORIZED yet.**

Until #137 and #138 are closed with real external evidence, production flags must remain false, `strict-pq` must remain OFF, and green CI must not be treated as a substitute for independent review or physical qualification. XMESH1 remains retained until a later separate retirement decision.