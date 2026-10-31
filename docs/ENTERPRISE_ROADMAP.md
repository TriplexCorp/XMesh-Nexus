# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 31 October 2026

XSP-v2 P0-E has reached a real bounded production activation on canary Node 13, and the next productization milestone is **XMesh v6.0.0 POSTQUANTUM**.

```text
P0-C2-D = COMPLETE
P0-D = COMPLETE
P0-E bounded Node 13 production activation = COMPLETE
v6 POSTQUANTUM install/update productization = CURRENT

Node 13:
productionActivation=true
strictPQEnabled=true
minimumEpoch=2
legacyXMESH1Retired=false
physicalPowerLossQualified=false
automaticFallback=false
classicalOnlyAllowed=false
```

The production claim remains deliberately narrow: `strictPQEnabled=true` is proven for Node 13. v6 generalizes **packaging, provisioning and update delivery**, not the evidence claim for unactivated nodes.

## v6.0.0 POSTQUANTUM major

### Nexus v6

Target product behavior:

- `VERSION=6.0.0` is the authoritative panel release version;
- clean install provisions persistent Ed25519 + ML-DSA-65 signer identity and public panel pin;
- clean install provisions TLS 1.3 hybrid ingress server identity plus ML-DSA-65 client CA for future per-node identities;
- least-privilege signer/C2-C database roles are provisioned with generated persistent credentials on fresh installs;
- reinstall/update is **non-rotating**: existing signer keys, CA identity and legacy DB credentials are never silently replaced;
- `install.sh --prepare-only`, used by the web updater, migrates the v6 PQ foundation while the existing database is healthy;
- foundation state explicitly distinguishes `strictPQFoundationReady=true` from per-node `strictPQEnabled=true`.

### Agent / Node v6

Target product behavior:

- XMesh Node `VERSION=6.0.0`;
- moving production Agent version `control-v6.0.0`;
- normal Node install and fresh enrollment install the production `xmesh-agent-xspv2-activate` binary;
- the binary is built from the exact checked-out Node revision with the reviewed Go 1.27.3 toolchain and self-verifies `{version, sourceRevision, artifactSha256}`;
- normal **Update Agent** accepts an authenticated transition from existing v4/v5 control agents, fast-forwards only the official XMesh-Node repository, updates the router, installs the PQ runtime and fails the entire major update if PQ identity verification fails;
- staged immutable release migration and last-known-good rollback remain available; durable XSP-v2 security state is not rolled back with package slots.

### v6 security boundary

v6 does **not** turn readiness into activation. A node reaches `strictPQEnabled=true` only after its own authenticated PQ identity and the existing bounded, fail-closed receipt/finalization flow.

Required policy remains:

- TLS 1.3 only;
- `X25519MLKEM768`;
- ML-DSA-65 client identity;
- Ed25519 + ML-DSA-65 critical signatures;
- no automatic/classical fallback;
- XMESH1 retained until a separate retirement decision.

## Proven Node 13 production evidence

The earlier frozen canary target remains the historical evidence base:

- Nexus runtime `a1267ae186f74d5e21561e3b64fc7375d499132e`;
- Node runtime `64709ce8f5f0ce80e2c0bab59b4476347825e57c`;
- Nexus runtime manifest/image `sha256:af27a110220f98880dc539141d614683741a05fbd3afd30792819b3192b9ef45`;
- approved activation artifact `a5f8e739b381640e4ac1d632dfef47d879ebc4c6ce7c4fbd8fab5744ad9cdd63`.

Production evidence:

- bounded approval SHA-256 `b2e43b137d4ea5b24b1313899e57701608874e059bdf5d5d2ba9f263ba866259`;
- Node result SHA-256 `ac1025fdc4bf2b433d1e596a7a35dd14deca94bcc44a10866c72c31b76d2fe9f`;
- receipt binding SHA-256 `1747647618cb1a824b85ef379646da242de7846e8c3ebff0bfdad9bc078ecb39`;
- activation record SHA-256 `6cfb4dc49edacff87033bbd99ca45ad7279813b4a10a5cbe958d5348e8a0ee9d`;
- activation timestamp `2026-10-31T10:52:13Z`.

Full evidence: [`XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md`](XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md).

## Completed release gates

- KVM VPS durability qualification #138: **COMPLETE**;
- provider-storage risk acceptance: **COMPLETE**;
- `physicalPowerLossQualified=false`: correct deployment-class claim;
- AI-assisted security review v6: **COMPLETE**;
- governance: **AI-assisted internal review + explicit release-owner risk acceptance**;
- #137: **CLOSED** under that replacement governance policy, with no external-independent-audit claim;
- final canary v3: **PASS**;
- bounded Node 13 activation / receipt recovery / Nexus finalization: **COMPLETE**;
- live rollout orchestration hardening: **COMPLETE**.

Do not rerun the completed durability matrix, historical cutover, final canary or recovery witness merely for v6 packaging changes unless the reviewed crypto/runtime security assumptions materially change.

## Current release sequence

```text
Node v6.0.0 POSTQUANTUM PR + CI
            ↓
merge XMesh-Node v6 to main
            ↓
Nexus v6.0.0 POSTQUANTUM PR + CI
            ↓
merge XMesh-Nexus v6 to main
            ↓
standard install/update paths are PQ-ready
            ↓
per-node strict-PQ activation remains receipt-verified and separately bounded
```

A broader fleet activation is a separate release decision. v6 removes the manual packaging/install gap; it does not weaken or bypass the per-node production activation gate.
