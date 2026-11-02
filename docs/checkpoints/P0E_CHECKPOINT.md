# Current P0-E checkpoint

Authoritative production activation record:

[`docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md`](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md)

Historical qualification records remain available in:

- [`docs/XSP_V2_P0E_LIVE_QUALIFICATION_CHECKPOINT_2026-10-30.md`](docs/XSP_V2_P0E_LIVE_QUALIFICATION_CHECKPOINT_2026-10-30.md)
- [`docs/XSP_V2_P0E_STAGE1_STAGE2_EVIDENCE_2026-10-30.md`](docs/XSP_V2_P0E_STAGE1_STAGE2_EVIDENCE_2026-10-30.md)
- [`docs/XSP_V2_P0E_138_CLOSURE_2026-10-30.md`](docs/XSP_V2_P0E_138_CLOSURE_2026-10-30.md)

## Current authoritative boundary — 31 October 2026

```text
#138 KVM VPS durability qualification: COMPLETE
provider-storage risk acceptance: COMPLETE
#137 replacement governance review: CLOSED
final canary v3: PASS
rollout/rollback review: COMPLETE
bounded Node 13 approval: COMPLETE
production receipt recovery: COMPLETE
Nexus production finalization: COMPLETE

productionActivation=true
strictPQEnabled=true
nodeId=13
minimumEpoch=2
legacyXMESH1Retired=false
physicalPowerLossQualified=false
automaticFallback=false
classicalOnlyAllowed=false
```

## Frozen production target

```text
Nexus a1267ae186f74d5e21561e3b64fc7375d499132e
Node  64709ce8f5f0ce80e2c0bab59b4476347825e57c
Agent a5f8e739b381640e4ac1d632dfef47d879ebc4c6ce7c4fbd8fab5744ad9cdd63
```

Release-control/tooling commits after the freeze may not alter the frozen runtime build inputs.

## Production evidence identities

```text
approval SHA-256          b2e43b137d4ea5b24b1313899e57701608874e059bdf5d5d2ba9f263ba866259
Node result SHA-256       ac1025fdc4bf2b433d1e596a7a35dd14deca94bcc44a10866c72c31b76d2fe9f
receipt binding SHA-256   1747647618cb1a824b85ef379646da242de7846e8c3ebff0bfdad9bc078ecb39
activation SHA-256        6cfb4dc49edacff87033bbd99ca45ad7279813b4a10a5cbe958d5348e8a0ee9d
activatedAt               2026-10-31T10:52:13Z
```

The canonical JSON copies are stored under [`docs/evidence/`](docs/evidence/).

## Governance / claims

The accepted governance model is **AI-assisted internal review + explicit release-owner risk acceptance**. It must not be described as an independent external security audit.

`physicalPowerLossQualified=false` remains mandatory for the current KVM VPS deployment class. XMESH1 remains retained during the initial strict-PQ rollout. No automatic/classical fallback is authorized.

## Scope

The production claim is bounded to **Node 13**. A broader rollout requires a separate bounded decision/approval and must not be inferred from this checkpoint.
