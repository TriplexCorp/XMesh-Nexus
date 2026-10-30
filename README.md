# XMesh Nexus

**Self-hosted control plane для Xray-powered VPN infrastructure.**

XMesh Nexus управляет Nodes, пользователями, подписками, конфигурацией Xray, telemetry и security state. Пользовательский VPN data-plane остаётся **Xray-core**; XMesh — control plane, а не дополнительный слой шифрования поверх пользовательского трафика.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [Current P0-E checkpoint](P0E_CHECKPOINT.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Текущий XSP-v2 checkpoint — 30 октября 2026

### P0-E: real protected cutover `1 → 2` COMPLETE; #138 осталось 3 стадии

Reviewed production runtime остаётся заморожен на:

- **XMesh-Nexus:** `12b3170996bc062ee16c79659a6378e5e425fd0e` — PR #163;
- **XMesh-Node:** `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — Node PR #52.

Qualification/staging tooling версионируется отдельно и **не меняет** production runtime target.

### Уже завершено

- **Node KVM abrupt-crash matrix: COMPLETE — 5/5**;
- **independent Nexus/PostgreSQL abrupt crash/recovery: COMPLETE**;
- topology-aware KVM VPS v2 contract/verifier — PR #171;
- protected permit signer/operator — PR #172;
- exact permit-tooling source/binary binding — PR #173;
- durable live qualification checkpoint — PR #174;
- live exact-tooling build/binding — **PASS**;
- fresh owner-authenticated `prepare` — **PASS**;
- Node proof-of-possession для существующего `.next` candidate — **PASS**;
- **real protected Node 13 cutover `epoch 1 → 2`: COMPLETE**;
- Node monotonic floor после cutover: **2**;
- real dual-signed applied ACK: **VERIFIED + DURABLE**;
- atomic Nexus/C2-C epoch commit: **Nexus epoch 2**;
- immutable dual-signed commit receipt: **VERIFIED + DURABLE**;
- signed receipt outbox rows: **1**.

### Live cutover evidence

Критический Stage 1 #138 прошёл целиком на существующем candidate без регенерации ключей:

```text
requestId=node13-q138-cutover-20261030-01
nodeEpoch=2
nodeFloor=2
nexusEpoch=2
ledgerState=ack_verified
receiptOutbox=1
strictPQEnabled=false
productionActivation=false
```

Evidence SHA-256:

- protected permit operator result: `ac88343dde50076ad3779d9cb1a62b029b14c4b6d3e89fa6ba894fb16d90cba7`;
- canonical permit digest verified by Node: `132906a49cfa7cdebb9fc0b346f93963802b73cc23aca1a333b2d449727fd642`;
- permit envelope: `1aba4ca1e0c7361eb0280a0d1de9254c0649cbdb8bed3e7d05774bb6b5b5625e`;
- signed applied ACK: `07ccd07a317b6797b637d6cd0b1cc5c79fb90ef0c771c3ee7cc2b6aab79016a9`;
- signed commit receipt: `daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9`;
- qualification helper built against exact frozen Node runtime: `baa53a928fc4cc55ed48c954395435f446873dfa5aab4808afd5d87ab351c3ff`.

`ledgerState=ack_verified` здесь **ожидаемое финальное состояние frozen runtime**: immutable receipt хранится отдельно в `node_xsp_signed_commit_receipt_outbox`; receipt writer требует committed `ack_verified` ledger и не переводит его в отдельное `receipt_sent` состояние.

### Что осталось по #138 — ровно 3 стадии

Новых crash loops и повторения cutover больше не требуется.

1. **Off-host production recovery-floor witness** — создать и независимо проверить production recovery checkpoint/receipt вне Nexus/PostgreSQL failure domain.
2. **Provider-storage risk acceptance** — отдельно и атрибутивно зафиксировать provider name/storage class и принятие provider-managed block-storage risk для Node и Nexus/PostgreSQL.
3. **Aggregate evidence + topology-aware v2 verifier** — собрать Node runs, PostgreSQL evidence, live cutover, off-host witness, provider acceptance и exact runtime/tooling bindings в один result и получить verifier PASS.

Только whole-result verifier может установить:

```text
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
productionDurabilityGateEligible=true
physicalPowerLossQualified=false
```

До этого авторитетное состояние остаётся:

```text
guestCrashConsistencyQualified=false
providerStorageDurabilityAssumed=false
physicalPowerLossQualified=false
strictPQEnabled=false
productionActivation=false
finalReleaseCanarySatisfied=false
legacyXMESH1Retired=false
```

### #137 — GitHub issue закрыт, security gate не считается доказанным

GitHub metadata для issue #137 сейчас показывает `closed/completed`, но в доступном issue thread и репозитории **нет attributable external v5 result/sign-off**, проходящего acceptance contract. Последний видимый review — AI-assisted internal audit с `independent=false`, который прямо не удовлетворяет #137.

Поэтому до появления и проверки реального external result корректный security claim остаётся:

```text
independentSecurityReviewComplete=false
```

Само состояние issue `closed` не заменяет external review evidence и не разрешает strict-PQ/production activation.

Authoritative v5 reviewer bundle остаётся:

- workflow run: `41054352179`;
- GitHub artifact ID: `12974974581`;
- deterministic inner tar SHA-256: `9d213e9281f0ffbbc3da21f9f3814d6e7fbef1e6b5273f6e9cb12175c63273c4`;
- payload SHA-256: `7b118084777d59e1ef1791d6375c32c1c44cf6bcdf9a03a2b0648a7ad9f263f2`.

### Current fast path

```text
#138 Stage 1 real cutover/ACK/receipt = COMPLETE
             ↓
off-host recovery-floor witness
             ↓
provider-storage risk acceptance
             ↓
aggregate topology-aware v2 verifier
             ↓
#138 COMPLETE

#137 external evidence must be genuinely accepted
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

## Основные XSP-v2 security свойства

Архитектура сохраняет:

- mandatory mTLS на dedicated PQ ingress;
- TLS 1.3 only и negotiated `X25519MLKEM768`;
- ML-DSA-65 Node/client identity;
- Ed25519 **AND** ML-DSA-65 для critical-message authorization;
- isolated signer/key custody;
- PostgreSQL transactionality для replay / ACK / epoch / receipt;
- crash-safe Agent state и monotonic epoch/replay floors;
- durable initial master-key provisioning;
- independent off-host recovery floor;
- owner-authorized previous-key retirement;
- parser fuzzing и external ML-DSA-65 vectors;
- default-off redacted observability;
- `automaticFallback=false`;
- `classicalOnlyAllowed=false`;
- production-capable paths default-disabled до explicit release decision.

## Production status

**Production PQ activation сейчас НЕ разрешён.** `strict-pq` остаётся **OFF**, XMESH1 retained, `physicalPowerLossQualified=false` для KVM остаётся корректным claim.

Для продолжения сначала читать [`P0E_CHECKPOINT.md`](P0E_CHECKPOINT.md), затем [`docs/ENTERPRISE_ROADMAP.md`](docs/ENTERPRISE_ROADMAP.md).