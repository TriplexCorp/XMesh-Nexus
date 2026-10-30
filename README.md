# XMesh Nexus

**Self-hosted control plane для Xray-powered VPN infrastructure.**

XMesh Nexus управляет Nodes, пользователями, подписками, конфигурацией Xray, telemetry и security state. Пользовательский VPN data-plane остаётся **Xray-core**; XMesh — control plane, а не дополнительный слой шифрования поверх пользовательского трафика.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [Current P0-E checkpoint](P0E_CHECKPOINT.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Текущий XSP-v2 checkpoint — 30 октября 2026

### P0-E: большая часть реальной KVM durability qualification уже выполнена; production activation всё ещё запрещён

Текущий reviewed production runtime остаётся заморожен на:

- **XMesh-Nexus:** `12b3170996bc062ee16c79659a6378e5e425fd0e` — PR #163;
- **XMesh-Node:** `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — Node PR #52.

Security-relevant staging/qualification tooling версионируется отдельно и **не меняет** этот runtime target.

### Что уже завершено

Repo-side P0-E tooling, contracts и fail-closed release-control gates готовы. Дополнительно завершена значительная часть **реальной** #138 qualification:

- **Node KVM crash matrix: COMPLETE — 5/5** реальных abrupt guest-crash runs на Node 13;
- **independent Nexus/PostgreSQL crash/recovery: COMPLETE** в отдельном failure domain;
- PostgreSQL после abrupt crash подтвердил recovery/integrity и durable settings;
- topology-aware KVM VPS v2 contract/verifier смержен PR #171;
- protected permit signer/operator смержен PR #172;
- exact permit-tooling binding к reviewed Nexus runtime смержен PR #173;
- live exact-tooling build/binding: **PASS**, `permitToolingBound=true`;
- durable session handoff/checkpoint смержен PR #174.

Важно: Node crash matrix и PostgreSQL crash/recovery — **раздельные failure-domain evidence**, как требует topology-aware v2. PostgreSQL больше не притворяется частью каждого Node crash run.

### Что осталось по #138

**Новых пяти crash-тестов или повторения crash matrix больше не требуется.** Остался короткий operational tail:

1. fresh owner-approved `prepare/prove` для существующего candidate;
2. protected dual-signed cutover permit;
3. Node `1 → 2` activation только под валидным permit;
4. real applied ACK → atomic Nexus/C2-C epoch commit → immutable dual-signed commit receipt;
5. independent **off-host production recovery-floor witness**;
6. explicit attributable **provider-storage risk acceptance**;
7. собрать aggregate evidence и прогнать topology-aware v2 verifier.

Только whole-result verifier может перевести #138 в COMPLETE и установить:

```text
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
productionDurabilityGateEligible=true
physicalPowerLossQualified=false
```

До этого корректное состояние остаётся:

```text
guestCrashConsistencyQualified=false
providerStorageDurabilityAssumed=false
physicalPowerLossQualified=false
strictPQEnabled=false
productionActivation=false
```

### #137 — отдельный внешний блокер

**#137 independent external security review/sign-off текущего v5 package остаётся OPEN.** Его нельзя заменить AI review, project-owner review, CI, fixtures или внутренней проверкой.

Авторитетный v5 reviewer bundle:

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

После реального закрытия #137 и #138 всё равно остаются release gates:

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

**Production PQ activation сейчас НЕ разрешён.** `strict-pq` остаётся **OFF**, XMESH1 остаётся retained, `physicalPowerLossQualified=false` для KVM остаётся корректным claim.

Для продолжения после нового чата сначала читать [`P0E_CHECKPOINT.md`](P0E_CHECKPOINT.md), затем [`docs/ENTERPRISE_ROADMAP.md`](docs/ENTERPRISE_ROADMAP.md).