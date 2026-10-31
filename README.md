# XMesh Nexus v6.0.0 — POSTQUANTUM

**Self-hosted control plane для Xray-powered VPN infrastructure.**

XMesh Nexus управляет Nodes, пользователями, подписками, конфигурацией Xray, telemetry и security state. Пользовательский VPN data-plane остаётся **Xray-core**; XMesh — control plane, а XSP-v2 защищает control-plane канал между Nexus и Agent.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [P0-E checkpoint](P0E_CHECKPOINT.md) · [Production activation evidence](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## v6.0.0 POSTQUANTUM major

XMesh Nexus **6.0.0** и XMesh Agent **control-v6.0.0** — первый штатный major, в котором production XSP-v2 strict-PQ runtime входит в обычные install/update paths.

### Что меняется в v6

- clean install Nexus автоматически создаёт и сохраняет PQ signer identity, panel pin, TLS 1.3 hybrid ingress CA/cert material и least-privilege DB roles;
- reinstall/update сохраняет существующие signer/CA identities и не выполняет скрытую ротацию ключей;
- fresh Node enrollment устанавливает `control-v6.0.0` **и** production `xmesh-agent-xspv2-activate` с проверкой exact source revision + artifact SHA-256;
- штатная кнопка **«Обновить Agent»** переводит существующие v4/v5 ноды на v6 только если router и PQ production binary установлены и identity проверена;
- transport policy остаётся fail-closed: TLS 1.3 + `X25519MLKEM768`, ML-DSA-65 client identity, Ed25519 + ML-DSA-65 critical signatures, без automatic/classical fallback.

**Важно:** `PQ-ready` не подменяет production activation. Для конкретной ноды `strictPQEnabled=true` фиксируется только после её authenticated PQ identity, bounded activation decision, verified dual-signed receipt и Nexus finalization. Установка v6 сама по себе не создаёт ложный activation claim.

## Текущий production checkpoint — 31 октября 2026

### P0-E: strict-PQ реально активирован на bounded canary Node 13

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

Это реальный production claim после verified Node receipt и Nexus finalization.

### Production evidence

- bounded approval SHA-256: `b2e43b137d4ea5b24b1313899e57701608874e059bdf5d5d2ba9f263ba866259`;
- verified Node result SHA-256: `ac1025fdc4bf2b433d1e596a7a35dd14deca94bcc44a10866c72c31b76d2fe9f`;
- receipt binding SHA-256: `1747647618cb1a824b85ef379646da242de7846e8c3ebff0bfdad9bc078ecb39`;
- finalized activation record SHA-256: `6cfb4dc49edacff87033bbd99ca45ad7279813b4a10a5cbe958d5348e8a0ee9d`;
- activated at: `2026-10-31T10:52:13Z`.

Полная запись: [`docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md`](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md).

### Historical frozen canary target

Реальная Node 13 activation была доказана на ранее замороженном target:

- Nexus runtime `a1267ae186f74d5e21561e3b64fc7375d499132e`;
- Node runtime `64709ce8f5f0ce80e2c0bab59b4476347825e57c`;
- Nexus runtime manifest/image `sha256:af27a110220f98880dc539141d614683741a05fbd3afd30792819b3192b9ef45`;
- approved activation artifact `a5f8e739b381640e4ac1d632dfef47d879ebc4c6ce7c4fbd8fab5744ad9cdd63`.

v6 — это packaging/install/update major поверх уже доказанного strict-PQ механизма; он не переписывает историческое evidence задним числом.

### Release gates и governance

- #138 KVM VPS durability qualification: **COMPLETE**;
- provider-storage risk acceptance: **COMPLETE**;
- `physicalPowerLossQualified=false`: сохранён как корректный KVM claim;
- governance: **AI-assisted internal review + explicit release-owner risk acceptance**;
- #137: **CLOSED** под replacement governance policy, без ложного claim об external independent audit;
- final canary v3: **PASS**;
- bounded Node 13 activation + receipt recovery + Nexus finalization: **COMPLETE**.

XMESH1 **не retired** и остаётся retained. Более широкий rollout strict-PQ по-прежнему требует per-node bounded release decision/verified receipt; v6 убирает ручной packaging/install разрыв, но не ослабляет activation gate.
