# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry, and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane, not an additional encryption layer around user traffic.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [Current P0-E checkpoint](P0E_CHECKPOINT.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 30 October 2026

### P0-E: most real KVM durability qualification work is complete; production activation remains prohibited

The reviewed production runtime remains frozen at:

- **XMesh-Nexus:** `12b3170996bc062ee16c79659a6378e5e425fd0e` — PR #163;
- **XMesh-Node:** `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — Node PR #52.

Security-relevant staging/qualification tooling is versioned separately and does **not** replace this runtime target.

### Completed work

Repo-side P0-E tooling, contracts, and fail-closed release-control gates are complete. A substantial part of the **real** #138 qualification is also complete:

- **Node KVM crash matrix: COMPLETE — 5/5** real abrupt guest-crash runs on Node 13;
- **independent Nexus/PostgreSQL crash/recovery: COMPLETE** in its own failure domain;
- PostgreSQL abrupt-crash recovery/integrity and durable settings were verified;
- topology-aware KVM VPS v2 contract/verifier merged in PR #171;
- protected permit signer/operator merged in PR #172;
- exact permit-tooling binding to the reviewed Nexus runtime merged in PR #173;
- live exact-tooling build/binding: **PASS**, `permitToolingBound=true`;
- durable session handoff/checkpoint merged in PR #174.

The Node crash matrix and PostgreSQL crash/recovery are **separate failure-domain evidence**, as required by topology-aware v2. PostgreSQL is no longer modeled as if it crashed inside every Node crash run.

### Remaining #138 work

**No additional five-run crash matrix or repeat crash loop is required.** The remaining work is the short operational tail:

1. fresh owner-approved `prepare/prove` for the existing candidate;
2. protected dual-signed cutover permit;
3. Node `1 → 2` activation only under that valid permit;
4. real applied ACK → atomic Nexus/C2-C epoch commit → immutable dual-signed commit receipt;
5. independent **off-host production recovery-floor witness**;
6. explicit attributable **provider-storage risk acceptance**;
7. aggregate the evidence and run the topology-aware v2 verifier.

Only the whole-result verifier may mark #138 complete and report:

```text
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
productionDurabilityGateEligible=true
physicalPowerLossQualified=false
```

Until then the correct state remains:

```text
guestCrashConsistencyQualified=false
providerStorageDurabilityAssumed=false
physicalPowerLossQualified=false
strictPQEnabled=false
productionActivation=false
```

### #137 — separate external blocker

**#137 independent external security review/sign-off of the current v5 package remains OPEN.** AI review, project-owner review, CI, fixtures, or internal testing cannot satisfy it.

Authoritative v5 reviewer bundle:

- workflow run: `41054352179`;
- GitHub artifact ID: `12974974581`;
- deterministic inner tar SHA-256: `9d213e9281f0ffbbc3da21f9f3814d6e7fbef1e6b5273f6e9cb12175c63273c4`;
- payload SHA-256: `7b118084777d59e1ef1791d6375c32c1c44cf6bcdf9a03a2b0648a7ad9f263f2`.

### Current fast path

```text
#138: crash matrix 5/5 COMPLETE
     + PostgreSQL crash/recovery COMPLETE
     + permit tooling bound PASS
             ↓
real cutover 1→2 + ACK + immutable receipt
             ↓
off-host recovery witness
             ↓
provider-storage risk acceptance
             ↓
final topology-aware v2 verifier
             ↓
#138 COMPLETE

#137 independent external review proceeds separately
```

After #137 and #138 are genuinely complete, release control still requires:

```text
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

When resuming in a new session, read [`P0E_CHECKPOINT.md`](P0E_CHECKPOINT.md) first, then [`docs/ENTERPRISE_ROADMAP.md`](docs/ENTERPRISE_ROADMAP.md).