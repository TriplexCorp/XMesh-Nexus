# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry, and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane, not an additional encryption layer around user traffic.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [P0-E checkpoint](P0E_CHECKPOINT.md) · [Production activation evidence](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 31 October 2026

### P0-E: bounded production strict-PQ activation is complete on Node 13

The bounded production canary Node 13 now has the finalized state:

```text
productionActivation=true
strictPQEnabled=true
nodeId=13
minimumEpoch=2
legacyXMESH1Retired=false
physicalPowerLossQualified=false
automaticFallback=false
classicalOnlyAllowed=false
```

This is a real production claim established only after the verified Node receipt and Nexus finalization, not a readiness, CI, or staging claim.

### Frozen production target

- **XMesh-Nexus runtime:** `a1267ae186f74d5e21561e3b64fc7375d499132e`;
- **XMesh-Node runtime:** `64709ce8f5f0ce80e2c0bab59b4476347825e57c`;
- **Nexus runtime manifest/image binding:** `sha256:af27a110220f98880dc539141d614683741a05fbd3afd30792819b3192b9ef45`;
- **approved Node activation artifact:** `a5f8e739b381640e4ac1d632dfef47d879ebc4c6ce7c4fbd8fab5744ad9cdd63`.

Later release-control/tooling commits are permitted only while the frozen runtime build inputs remain byte-identical.

### Production evidence

- bounded approval SHA-256: `b2e43b137d4ea5b24b1313899e57701608874e059bdf5d5d2ba9f263ba866259`;
- verified Node result SHA-256: `ac1025fdc4bf2b433d1e596a7a35dd14deca94bcc44a10866c72c31b76d2fe9f`;
- receipt binding SHA-256: `1747647618cb1a824b85ef379646da242de7846e8c3ebff0bfdad9bc078ecb39`;
- finalized activation record SHA-256: `6cfb4dc49edacff87033bbd99ca45ad7279813b4a10a5cbe958d5348e8a0ee9d`;
- activated at: `2026-10-31T10:52:13Z`.

Full record: [`docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md`](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md).

### Closed release gates

- #138 KVM VPS durability qualification: **COMPLETE**;
- provider-storage risk acceptance: **COMPLETE**;
- `physicalPowerLossQualified=false`: **retained as the correct KVM claim**;
- governance: **AI-assisted internal review + explicit release-owner risk acceptance**;
- #137: **CLOSED** under that replacement governance policy, without claiming an external independent audit;
- final canary v3: **PASS**;
- rollout/rollback review: **COMPLETE**;
- bounded Node 13 activation approval: **COMPLETE**;
- production receipt recovery + Nexus finalization: **COMPLETE**.

### Security boundary

The strict-PQ canary uses:

- TLS 1.3 only;
- `X25519MLKEM768`;
- ML-DSA-65 client identity;
- Ed25519 + ML-DSA-65 critical signatures;
- no automatic/classical fallback.

XMESH1 is **not retired** and remains retained during the initial rollout.

### Live rollout hardening

The live execution exposed release-control defects outside the frozen crypto/runtime target: executable-bit dependency, incorrect directory `fsync`, bind-mounted panel-pin/certificate permissions, and a readiness marker that could be emitted while services were already restart-looping. Production orchestration is hardened for those cases and CI now covers the regressions without changing the frozen runtime build inputs.

## Production status

**Strict-PQ is active in production on bounded canary Node 13.** This does not automatically authorize a wider rollout: expanding scope requires a separate bounded release decision/approval. XMESH1 remains retained, and `physicalPowerLossQualified=false` remains the correct KVM VPS claim.
