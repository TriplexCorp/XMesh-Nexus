# XMesh Nexus v6.0.0 — POSTQUANTUM

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry, and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane, while XSP-v2 protects the Nexus↔Agent control-plane channel.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [P0-E checkpoint](P0E_CHECKPOINT.md) · [Production activation evidence](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## v6.0.0 POSTQUANTUM major

XMesh Nexus **6.0.0** and XMesh Agent **control-v6.0.0** are the first numbered major release where the production XSP-v2 strict-PQ runtime is part of the normal install/update lifecycle.

### What v6 changes

- a clean Nexus install provisions and persists the PQ signer identity, panel pin, TLS 1.3 hybrid-ingress CA/certificate material, and least-privilege DB roles;
- reinstall/update preserves existing signer/CA identities and refuses silent key rotation;
- fresh Node enrollment installs `control-v6.0.0` plus the production `xmesh-agent-xspv2-activate` binary, verifying the exact source revision and artifact SHA-256;
- the normal **Update Agent** action upgrades existing v4/v5 nodes to v6 only when the router and PQ production binary are installed and identity-verified;
- transport policy remains fail-closed: TLS 1.3 + `X25519MLKEM768`, ML-DSA-65 client identity, Ed25519 + ML-DSA-65 critical signatures, and no automatic/classical fallback.

**Important:** PQ-ready is not the same as production activation. A specific node may claim `strictPQEnabled=true` only after its authenticated PQ identity, bounded activation decision, verified dual-signed receipt, and Nexus finalization. Installing v6 alone never creates a false activation claim.

## Current production checkpoint — 31 October 2026

Strict-PQ has already been genuinely activated and finalized on bounded canary Node 13:

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

### Production evidence

- bounded approval SHA-256: `b2e43b137d4ea5b24b1313899e57701608874e059bdf5d5d2ba9f263ba866259`;
- verified Node result SHA-256: `ac1025fdc4bf2b433d1e596a7a35dd14deca94bcc44a10866c72c31b76d2fe9f`;
- receipt binding SHA-256: `1747647618cb1a824b85ef379646da242de7846e8c3ebff0bfdad9bc078ecb39`;
- finalized activation record SHA-256: `6cfb4dc49edacff87033bbd99ca45ad7279813b4a10a5cbe958d5348e8a0ee9d`;
- activated at: `2026-10-31T10:52:13Z`.

Full record: [`docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md`](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md).

### Historical frozen canary target

The Node 13 activation evidence was established against the earlier frozen target:

- Nexus runtime `a1267ae186f74d5e21561e3b64fc7375d499132e`;
- Node runtime `64709ce8f5f0ce80e2c0bab59b4476347825e57c`;
- Nexus runtime manifest/image `sha256:af27a110220f98880dc539141d614683741a05fbd3afd30792819b3192b9ef45`;
- approved activation artifact `a5f8e739b381640e4ac1d632dfef47d879ebc4c6ce7c4fbd8fab5744ad9cdd63`.

v6 is the packaging/install/update major built around the already proven strict-PQ mechanism; it does not rewrite historical evidence.

Governance remains **AI-assisted internal review + explicit release-owner risk acceptance**; no external-independent-audit claim is made. `physicalPowerLossQualified=false` remains the correct KVM VPS claim. XMESH1 remains retained. Wider strict-PQ rollout still requires per-node bounded release decisions and verified receipts; v6 removes the manual packaging gap without weakening the activation gate.
