# XMesh Nexus

**Self-hosted control plane для Xray-powered VPN infrastructure.**

XMesh Nexus управляет Nodes, пользователями, подписками, конфигурацией Xray, telemetry и security state. Пользовательский VPN data-plane остаётся **Xray-core**; XMesh — control plane, а не дополнительный слой шифрования поверх пользовательского трафика.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [P0-E checkpoint](P0E_CHECKPOINT.md) · [Production activation evidence](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Текущий XSP-v2 checkpoint — 31 октября 2026

### P0-E: bounded production strict-PQ activation завершена на Node 13

В production на ограниченном canary Node 13 зафиксирован финальный state:

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

Это реальный production claim после verified Node receipt и Nexus finalization, а не readiness/CI/staging claim.

### Frozen production target

- **XMesh-Nexus runtime:** `a1267ae186f74d5e21561e3b64fc7375d499132e`;
- **XMesh-Node runtime:** `64709ce8f5f0ce80e2c0bab59b4476347825e57c`;
- **Nexus runtime manifest/image binding:** `sha256:af27a110220f98880dc539141d614683741a05fbd3afd30792819b3192b9ef45`;
- **approved Node activation artifact:** `a5f8e739b381640e4ac1d632dfef47d879ebc4c6ce7c4fbd8fab5744ad9cdd63`.

Release-control/tooling commits после freeze разрешены только при byte-identical runtime build inputs.

### Production evidence

- bounded approval SHA-256: `b2e43b137d4ea5b24b1313899e57701608874e059bdf5d5d2ba9f263ba866259`;
- verified Node result SHA-256: `ac1025fdc4bf2b433d1e596a7a35dd14deca94bcc44a10866c72c31b76d2fe9f`;
- receipt binding SHA-256: `1747647618cb1a824b85ef379646da242de7846e8c3ebff0bfdad9bc078ecb39`;
- finalized activation record SHA-256: `6cfb4dc49edacff87033bbd99ca45ad7279813b4a10a5cbe958d5348e8a0ee9d`;
- activated at: `2026-10-31T10:52:13Z`.

Полная запись: [`docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md`](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md).

### Закрытые release gates

- #138 KVM VPS durability qualification: **COMPLETE**;
- provider-storage risk acceptance: **COMPLETE**;
- `physicalPowerLossQualified=false`: **сохранён как корректный KVM claim**;
- governance: **AI-assisted internal review + explicit release-owner risk acceptance**;
- #137: **CLOSED** под этой replacement governance policy, без ложного claim об external independent audit;
- final canary v3: **PASS**;
- rollout/rollback review: **COMPLETE**;
- bounded Node 13 activation approval: **COMPLETE**;
- production receipt recovery + Nexus finalization: **COMPLETE**.

### Security boundary

Strict-PQ canary использует:

- TLS 1.3 only;
- `X25519MLKEM768`;
- ML-DSA-65 client identity;
- Ed25519 + ML-DSA-65 critical signatures;
- no automatic/classical fallback.

XMESH1 **не retired** и остаётся retained во время начального rollout.

### Live rollout hardening

Живой запуск выявил release-control проблемы, не меняющие frozen crypto/runtime target: executable-bit dependency, неправильный directory `fsync`, права bind-mounted panel pin/cert material и преждевременный readiness marker. Они исправляются в production orchestration и покрываются CI, не изменяя frozen runtime build inputs.

## Production status

**Strict-PQ включён в production на bounded canary Node 13.** Это не является автоматическим разрешением на более широкий rollout: расширение scope требует отдельного bounded release decision/approval. XMESH1 retained; `physicalPowerLossQualified=false` остаётся корректным claim для KVM VPS.
