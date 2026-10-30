# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry, and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane, not an additional encryption layer around user traffic.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 30 October 2026

### P0-E: repo-side preparation is complete; active deployment class = `kvm-vps`; production activation is still prohibited

The current production runtime after security review/remediation is frozen at:

- **XMesh-Nexus:** `12b3170996bc062ee16c79659a6378e5e425fd0e` — PR #163, mandatory TLS client authentication on the dedicated PQ ingress;
- **XMesh-Node:** `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — Node PR #52, durable parent-directory `fsync` for initial master-key provisioning.

The AI-assisted internal audit in PR #162 is not an independent external sign-off, but its two Low findings (`AI-LOW-001`, `AI-LOW-002`) were remediated and are included in the current frozen runtime.

### Independent-review package v5

PR #168 created the current **v5 KVM VPS review package**. Runtime is unchanged from v4; a new freeze was required because PRs #166/#167 materially changed release-control policy.

Authoritative post-merge v5 reviewer bundle:

- workflow run: `41054352179`;
- GitHub artifact ID: `12974974581` — transport/navigation metadata only;
- deterministic inner tar SHA-256: `9d213e9281f0ffbbc3da21f9f3814d6e7fbef1e6b5273f6e9cb12175c63273c4`;
- payload SHA-256: `7b118084777d59e1ef1791d6375c32c1c44cf6bcdf9a03a2b0648a7ad9f263f2`.

PR #169 rebound machine-checkable independent-review result acceptance to this v5 package. Older v3/v4 bundles remain historical checkpoints and are no longer the current acceptance identity.

### Why #138 is now KVM-specific rather than bare-metal-only

The active production deployment is a KVM VPS. The operator does not control the provider's physical host, BMC/PDU, storage controller, write cache, or PLP boundary. Therefore the bare-metal physical-power qualification remains available as a separate profile but is no longer mandatory for `deploymentClass=kvm-vps`.

The KVM production durability gate requires **five real guest crash-consistency runs** at the same security checkpoints:

1. `after-previous` → `previous-complete`;
2. `after-floor` → `next-complete`;
3. `after-active` → `next-complete`;
4. `after-recovery-abort` → `previous-complete`;
5. `after-recovery-active` → `next-complete`.

The preferred crash method is a provider `hard-stop/reset` when it is documented not to perform an orderly guest shutdown. If no such VPS-provider operation exists, policy allows `guest-kernel-panic` as a weaker guest-failure boundary.

KVM qualification does **not** pretend to be a physical power-loss test. For this deployment class, the correct claims after successful qualification are:

```text
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
physicalPowerLossQualified=false
```

Physical durability of provider-managed block storage remains an external trust boundary and requires explicit attributable risk acceptance.

### Remaining P0-E blockers

- **#137 — independent external security review/sign-off** of the current v5 package;
- **#138 — five real KVM VPS crash-consistency runs plus provider-storage risk acceptance**.

Until both have real accepted evidence:

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

`strict-pq` remains **OFF**, XMESH1 remains retained, and production rollout is **NOT AUTHORIZED**.

### Release-control checkpoints

Repo-side gates are implemented and fail-closed:

- disposable exact-candidate canary rehearsal;
- independent-review handoff, deterministic bundle, and returned-result verifier;
- KVM VPS durability qualification contract/verifier;
- retained bare-metal E4a physical profile, now bound to remediated Node PR #52;
- production rollout/rollback plan verification;
- separate KVM VPS strict-PQ approval gate;
- historical bare-metal strict-PQ approval profile.

The KVM strict-PQ approval preserves mandatory invariants:

- TLS 1.3 only;
- `X25519MLKEM768` hybrid key exchange;
- ML-DSA-65 client identity;
- Ed25519 **AND** ML-DSA-65 critical-message signatures;
- `automaticFallback=false`;
- `classicalOnlyAllowed=false`;
- at most 50 named Nodes;
- at most a 24-hour approval window;
- `strictPqAction=enable` separated from `legacyXMESH1Action=retain`.

Even a fully eligible KVM approval deliberately reports:

```text
strictPQEnabled=false
productionActivation=false
legacyXMESH1Retired=false
physicalPowerLossQualified=false
requiresSeparateExecution=true
```

Approval and actual production execution are separate actions.

### Current production sequence

```text
repo-side P0-E preparation COMPLETE
        ↓
#137 independent external review of v5 package
        +
#138 five real KVM guest crash-consistency runs
     + provider-storage risk acceptance
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

Any new security-relevant runtime change or material release-policy change after v5 requires re-freeze/re-review of the affected scope.

## Core XSP-v2 security properties

The current architecture preserves:

- mandatory mTLS on the dedicated PQ ingress;
- TLS 1.3 only and negotiated `X25519MLKEM768`;
- ML-DSA-65 Node/client identity;
- Ed25519 **AND** ML-DSA-65 critical-message authorization;
- isolated signer/key-custody boundary;
- PostgreSQL transactionality for replay/ACK/epoch/receipt state;
- crash-safe Agent security state with monotonic epoch/replay floors;
- durable initial master-key provisioning with parent-directory sync;
- independent off-host recovery floor;
- owner-authorized previous-key retirement;
- parser fuzzing and external ML-DSA-65 vectors;
- default-off redacted observability;
- no automatic fallback / no classical-only production downgrade;
- production-capable paths default-disabled until an explicit release decision.

The detailed authoritative status and work order are in [`docs/ENTERPRISE_ROADMAP.md`](docs/ENTERPRISE_ROADMAP.md).

## Production status

**Production PQ activation is NOT AUTHORIZED yet.** Green CI, internal review, synthetic fixtures, and completed contracts do not replace real #137/#138 evidence. After those blockers close, the exact candidate still requires the final canary, reviewed rollout/rollback plan, bounded KVM approval, and a separate execution step.
