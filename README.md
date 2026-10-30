# XMesh Nexus

**Self-hosted control plane для Xray-powered VPN infrastructure.**

XMesh Nexus управляет Nodes, пользователями, подписками, конфигурацией Xray, telemetry и security state. Пользовательский VPN data-plane остаётся **Xray-core**; XMesh — control plane, а не дополнительный слой шифрования поверх пользовательского трафика.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Текущий XSP-v2 checkpoint — 30 октября 2026

**Текущий `main`:** `6c901233da816b90021f03dc766c039ad3c7f070`, merge PR #159.

### P0-E: repo-side подготовка завершена, production activation пока запрещён

Вся текущая repo-side подготовка к production PQ собрана и fail-closed:

- disposable release-canary rehearsal — готов;
- production rollout-plan verifier — готов;
- explicit bounded `strict-pq` activation approval gate — готов;
- independent-review handoff и reproducible reviewer bundle — готовы;
- independent-review result contract/verifier — привязан к актуальному v3 review snapshot;
- physical abrupt-power lab handoff, five-run matrix tooling и returned-review verifier — готовы.

Это **не** означает, что production PQ уже разрешён. До закрытия внешних P0-E блокеров остаются:

- **#137 — independent external security review/sign-off**;
- **#138 — пять реальных representative abrupt-power runs + independent review**.

Пока они не закрыты:

- `strict-pq` = **OFF**;
- `productionActivation=false`;
- `physicalPowerLossQualified=false`;
- `independentSecurityReviewComplete=false`;
- legacy XMESH1 остаётся активным/retained;
- production rollout = **NOT AUTHORIZED**.

### Актуальный security-review target

PR #156 (`700cd64c56df9c5f3ab3870cbb64ba5f31747351`) обновил handoff до **v3 review snapshot**, чтобы внешний review покрывал не только runtime, но и финальную release-control архитектуру из PR #150, #152 и #155.

Актуальная связка для внешнего review:

- **Nexus review snapshot:** `0bab1a48cff570b3abe405bcda4dc242b23b8a4b`;
- **Node review target:** `083dc181c5e175f89007f4b93111cd5c45a69d97`;
- **protected Nexus runtime baseline:** `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091`.

`8c64a8e…` больше не является полным current review snapshot: это runtime baseline. PR #156 доказал, что защищённые runtime paths между runtime baseline и v3 snapshot остаются эквивалентными, а в scope review добавлены release-control/evidence изменения.

### Reviewer bundle v3

Авторитетный post-merge v3 reviewer bundle произведён после PR #156:

- workflow run: `41037503656`;
- deterministic inner tar SHA-256: `bac34400ac9b646c8a0f64ca9495e380ff0afce373310787c96385b9e40486bf`;
- payload SHA-256: `33c8f07f4513cb03400c8b7af2f34f804661a79501336206482c0f426866620a`;
- GitHub artifact ID: `12967634062` — только transport/navigation metadata.

PR #159 (`6c901233da816b90021f03dc766c039ad3c7f070`) перевязал machine-checkable independent-review result contract на этот v3 snapshot и bundle. Сам verifier остался fail-closed и не выполняет review за внешнего аудитора.

### Release-control checkpoints

- **PR #150 / disposable canary rehearsal:** harness readiness доказана; `finalReleaseCanarySatisfied=false`. После реального закрытия P0-E exact release candidate должен пройти полный canary ещё раз.
- **PR #152 / rollout-plan acceptance:** verifier требует exact candidate, закрытые external P0-E evidence, final canary, explicit topology/DNS/firewall/Nginx/PostgreSQL/key/observability/rollback dispositions и independent plan review. Сам gate ничего не деплоит.
- **PR #155 / strict-PQ activation approval:** отдельный explicit approval gate, bounded до максимум 50 named Nodes и максимум 24 часов. Он запрещает automatic fallback/classical-only downgrade и отделяет `strictPqAction=enable` от `legacyXMESH1Action=retain`.

Даже eligible approval намеренно возвращает:

```text
strictPQEnabled=false
productionActivation=false
legacyXMESH1Retired=false
requiresSeparateExecution=true
```

То есть approval и фактическая production execution — отдельные действия.

### Что уже COMPLETE

P0-C2-D и P0-D завершены. В P0-E завершены все repo-side software/lab-preparation gates, включая process-crash durability, one-sided Agent/PostgreSQL rollback resistance, coordinated backup/restore, off-host monotonic recovery floor, owner-authorized retirement, parser fuzzing, external ML-DSA-65 vectors, default-off redacted observability, physical-run handoff/tooling, canary rehearsal, rollout-plan verification и strict-PQ approval gate.

Текущая production граница проста:

```text
repo-side P0-E preparation COMPLETE
        ↓
#137 independent external security review
        +
#138 five real abrupt-power runs + independent review
        ↓
exact-candidate final canary
        ↓
independently reviewed rollout/rollback plan
        ↓
explicit bounded strict-PQ approval
        ↓
separate production execution
```

Любое security-relevant изменение runtime или существенное изменение reviewed release-control policy после freeze может потребовать re-freeze/re-review соответствующего scope.

## Основные XSP-v2 security свойства

Текущая архитектура P0-E основана на следующих invariants:

- TLS 1.3 only для dedicated PQ ingress;
- `X25519MLKEM768` negotiated hybrid key exchange;
- ML-DSA-65 client identity;
- Ed25519 **AND** ML-DSA-65 critical-message signatures;
- isolated signer/key-custody boundary;
- PostgreSQL transactionality для replay/ACK/epoch/receipt state;
- crash-safe Agent security state и monotonic epoch/replay floors;
- independent off-host recovery floor;
- owner-authorized old-key retirement;
- no automatic fallback / no classical-only production downgrade;
- production-capable paths default-disabled до явного release decision.

Подробная последовательность работ и authoritative status находятся в [`docs/ENTERPRISE_ROADMAP.md`](docs/ENTERPRISE_ROADMAP.md). Специализированные contracts, handoff guides и evidence documents находятся в `docs/`, `deploy/`, `scripts/` и `.github/workflows/`.

## Production status

**Production PQ activation сейчас НЕ разрешён.**

До закрытия #137 и #138 не следует менять production flags, выдавать `strict-pq` за enabled или считать green CI заменой независимого review/physical qualification. XMESH1 остаётся retained до отдельного более позднего решения о retirement.
