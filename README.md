# XMesh Nexus

**Self-hosted control plane для Xray-powered VPN infrastructure.**

XMesh Nexus управляет Nodes, пользователями, подписками, конфигурацией Xray, telemetry и security state. Пользовательский VPN data-plane остаётся **Xray-core**; XMesh — control plane, а не дополнительный слой шифрования поверх пользовательского трафика.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Текущий XSP-v2 checkpoint — 30 октября 2026

### P0-E: repo-side подготовка завершена; active deployment class = `kvm-vps`; production activation пока запрещён

Текущий production runtime после security-аудита и remediation заморожен на:

- **XMesh-Nexus:** `12b3170996bc062ee16c79659a6378e5e425fd0e` — PR #163, mandatory TLS client authentication на dedicated PQ ingress;
- **XMesh-Node:** `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — Node PR #52, durable parent-directory `fsync` при initial master-key provisioning.

AI-assisted internal audit (PR #162) не является independent external sign-off, но его два Low findings (`AI-LOW-001`, `AI-LOW-002`) исправлены и включены в текущий frozen runtime.

### Independent-review package v5

PR #168 создал текущий **v5 KVM VPS review package**. Runtime по сравнению с v4 не изменился; новая версия freeze понадобилась из-за material release-control policy change после PRs #166/#167.

Авторитетный post-merge v5 reviewer bundle:

- workflow run: `41054352179`;
- GitHub artifact ID: `12974974581` — только transport/navigation metadata;
- deterministic inner tar SHA-256: `9d213e9281f0ffbbc3da21f9f3814d6e7fbef1e6b5273f6e9cb12175c63273c4`;
- payload SHA-256: `7b118084777d59e1ef1791d6375c32c1c44cf6bcdf9a03a2b0648a7ad9f263f2`.

PR #169 перевязал machine-checkable independent-review result acceptance на этот v5 package. Старые v3/v4 bundles остаются историческими checkpoint’ами и больше не являются current acceptance identity.

### Почему #138 теперь KVM, а не bare metal

Текущий production deployment — KVM VPS: оператор не контролирует физический host, BMC/PDU, storage controller, write cache или PLP. Поэтому bare-metal physical-power qualification сохранён как отдельный профиль, но больше не является обязательным для `deploymentClass=kvm-vps`.

Для KVM production durability gate требует **пять реальных guest crash-consistency runs** на тех же security checkpoints:

1. `after-previous` → `previous-complete`;
2. `after-floor` → `next-complete`;
3. `after-active` → `next-complete`;
4. `after-recovery-abort` → `previous-complete`;
5. `after-recovery-active` → `next-complete`.

Предпочтительный crash method — provider `hard-stop/reset`, если он гарантированно не выполняет orderly guest shutdown. Если такой операции у VPS-провайдера нет, policy допускает `guest-kernel-panic` как более слабый guest-failure boundary.

KVM qualification **не** притворяется physical-power тестом. Для этого класса правильные claims после успешной квалификации:

```text
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
physicalPowerLossQualified=false
```

Физическая долговечность provider-managed block storage остаётся внешним trust boundary и требует явного attributable risk acceptance.

### Оставшиеся P0-E блокеры

- **#137 — independent external security review/sign-off** текущего v5 package;
- **#138 — пять реальных KVM VPS crash-consistency runs + provider-storage risk acceptance**.

Пока они не закрыты реальными evidence:

```text
independentSecurityReviewComplete=false
guestCrashConsistencyQualified=false
providerStorageDurabilityAssumed=false
physicalPowerLossQualified=false
finalReleaseCanarySatisfied=false
productionActivation=false
strictPQEnabled=false
legacyXMESH1Retired=false
```

`strict-pq` остаётся **OFF**, XMESH1 — retained, production rollout — **NOT AUTHORIZED**.

### Release-control checkpoints

Repo-side gates уже готовы и fail-closed:

- disposable exact-candidate canary rehearsal;
- independent-review handoff, deterministic bundle и returned-result verifier;
- KVM VPS durability qualification contract/verifier;
- retained bare-metal E4a physical profile, теперь привязанный к remediated Node PR #52;
- production rollout/rollback plan verification;
- отдельный KVM VPS strict-PQ approval gate;
- historical bare-metal strict-PQ approval profile.

KVM strict-PQ approval сохраняет обязательные invariants:

- TLS 1.3 only;
- `X25519MLKEM768` hybrid key exchange;
- ML-DSA-65 client identity;
- Ed25519 **AND** ML-DSA-65 critical-message signatures;
- `automaticFallback=false`;
- `classicalOnlyAllowed=false`;
- максимум 50 named Nodes;
- максимум 24 часа на approval window;
- `strictPqAction=enable` отдельно от `legacyXMESH1Action=retain`.

Даже полностью eligible KVM approval намеренно возвращает:

```text
strictPQEnabled=false
productionActivation=false
legacyXMESH1Retired=false
physicalPowerLossQualified=false
requiresSeparateExecution=true
```

Approval и фактическая production execution — разные действия.

### Текущая production последовательность

```text
repo-side P0-E preparation COMPLETE
        ↓
#137 independent external review of v5 package
        +
#138 five real KVM guest crash-consistency runs
     + provider-storage risk acceptance
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

Любое новое security-relevant runtime изменение или material release-policy изменение после v5 снова требует re-freeze/re-review соответствующего scope.

## Основные XSP-v2 security свойства

Текущая архитектура сохраняет:

- mandatory mTLS на dedicated PQ ingress;
- TLS 1.3 only и negotiated `X25519MLKEM768`;
- ML-DSA-65 Node/client identity;
- Ed25519 **AND** ML-DSA-65 для critical-message authorization;
- isolated signer/key-custody boundary;
- PostgreSQL transactionality для replay/ACK/epoch/receipt state;
- crash-safe Agent security state и monotonic epoch/replay floors;
- durable initial master-key provisioning с parent-directory sync;
- independent off-host recovery floor;
- owner-authorized previous-key retirement;
- parser fuzzing и external ML-DSA-65 vectors;
- default-off redacted observability;
- no automatic fallback / no classical-only production downgrade;
- production-capable paths default-disabled до explicit release decision.

Подробный authoritative status и порядок работ находятся в [`docs/ENTERPRISE_ROADMAP.md`](docs/ENTERPRISE_ROADMAP.md).

## Production status

**Production PQ activation сейчас НЕ разрешён.** Green CI, внутренний аудит, synthetic fixtures или готовые contracts не заменяют реальные #137/#138 evidence. После их закрытия всё равно нужны final canary, reviewed rollout/rollback plan, bounded KVM approval и отдельный execution step.
