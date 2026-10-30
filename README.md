# XMesh Nexus

**Self-hosted control plane для Xray-powered VPN infrastructure.**

XMesh Nexus управляет Nodes, пользователями, подписками, конфигурацией Xray, telemetry и security state. Пользовательский VPN data-plane остаётся **Xray-core**; XMesh — control plane, а не дополнительный слой шифрования поверх пользовательского трафика.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [Current P0-E checkpoint](P0E_CHECKPOINT.md) · [Stage 1/2 evidence](docs/XSP_V2_P0E_STAGE1_STAGE2_EVIDENCE_2026-10-30.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Текущий XSP-v2 checkpoint — 30 октября 2026

### P0-E: crash qualification, live cutover и off-host recovery witness завершены; production activation всё ещё запрещён

Reviewed production runtime остаётся заморожен на:

- **XMesh-Nexus:** `12b3170996bc062ee16c79659a6378e5e425fd0e` — PR #163;
- **XMesh-Node:** `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — Node PR #52.

Qualification tooling и live evidence не меняют этот frozen runtime target.

### #138 — завершённые реальные evidence boundaries

- Node KVM abrupt-crash matrix: **COMPLETE 5/5**;
- independent Nexus/PostgreSQL crash/recovery: **COMPLETE**;
- protected permit tooling binding/live build: **PASS**;
- protected Node 13 epoch `1 → 2` cutover / ACK / immutable receipt: **COMPLETE**;
- independent off-host production recovery-floor witness: **COMPLETE**.

Ключевые SHA-256:

```text
applied ACK
07ccd07a317b6797b637d6cd0b1cc5c79fb90ef0c771c3ee7cc2b6aab79016a9

immutable commit receipt
daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9

recovery checkpoint
bc730df3a2078027cc4cbb4982da622dc8970dd49796fd9cbc0566a6364a3069

recovery verification result
4de873d0a5e9f85d245a9c880c0f75884117875888b5aedee4d4934cd64c5569
```

Off-host verifier подтвердил:

```text
status=verified
nodeId=13
minimumEpoch=2
localEpoch=2
```

### Что осталось по #138

Повторять crash matrix, cutover или recovery witness не требуется. Осталось:

1. explicit attributable provider-storage risk acceptance;
2. aggregate evidence/result assembly;
3. финальный topology-aware v2 verifier.

До whole-result verifier PASS корректные claims остаются:

```text
guestCrashConsistencyQualified=false
providerStorageDurabilityAssumed=false
physicalPowerLossQualified=false
strictPQEnabled=false
productionActivation=false
```

### #137 — отдельный внешний блокер

**#137 independent external security review/sign-off текущего v5 package остаётся OPEN.** Его нельзя заменить AI review, project-owner review, CI или внутренней проверкой.

Авторитетный v5 reviewer bundle:

- workflow run: `41054352179`;
- GitHub artifact ID: `12974974581`;
- deterministic inner tar SHA-256: `9d213e9281f0ffbbc3da21f9f3814d6e7fbef1e6b5273f6e9cb12175c63273c4`;
- payload SHA-256: `7b118084777d59e1ef1791d6375c32c1c44cf6bcdf9a03a2b0648a7ad9f263f2`.

### Current fast path

```text
#138 crash/recovery + cutover + off-host witness COMPLETE
             ↓
provider-storage risk acceptance
             ↓
aggregate evidence + final topology-aware v2 verifier
             ↓
#138 COMPLETE

#137 independent external review proceeds separately
```

После закрытия #137/#138 остаются отдельные release gates: exact production candidate, final canary, reviewed rollout/rollback plan, bounded KVM strict-PQ approval и отдельное production execution.

## Production status

**Production PQ activation сейчас НЕ разрешён.** `strict-pq` остаётся **OFF**, XMESH1 остаётся retained, `physicalPowerLossQualified=false` для KVM остаётся корректным claim.

Для продолжения сначала читать [`P0E_CHECKPOINT.md`](P0E_CHECKPOINT.md), затем [`docs/ENTERPRISE_ROADMAP.md`](docs/ENTERPRISE_ROADMAP.md) и [`docs/XSP_V2_P0E_STAGE1_STAGE2_EVIDENCE_2026-10-30.md`](docs/XSP_V2_P0E_STAGE1_STAGE2_EVIDENCE_2026-10-30.md).
