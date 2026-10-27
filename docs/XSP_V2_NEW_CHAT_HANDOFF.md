# XMesh Nexus + XMesh Node — передача контекста в новый диалог

> **Актуальный инженерный handoff: 27 октября 2026.** Это точка входа для следующего ChatGPT-диалога. Сначала проверьте свежие `main`/открытые PR/CI GitHub, а не полагайтесь на зафиксированные ниже SHA: разработка продолжается. Данный документ описывает **наличие кода**, а не включённый production XSP-v2 или прошедший security review.

## 1. Цель владельца и границы

**Репозитории:**
- **Nexus:** https://github.com/TriplexCorp/XMesh-Nexus — панель Rust/Axum, PostgreSQL, миграции, UI и экспериментальная проверка управляющих сообщений.
- **Node:** https://github.com/TriplexCorp/XMesh-Node — production Docker-router, Agent, Xray-синхронизация и отдельно изолированный исследовательский Go 1.27 модуль `security/xspv2/poc-go`.

**Главная цель:** полностью безопасный **гибридный постквантовый XSP-v2 control plane Nexus ↔ Node** с обязательными Ed25519 **И** ML-DSA-65 подписями, owner approval, защищённым signer, двухфазной ротацией, записью фактического applied ACK, доказуемой транзакционной фиксацией, восстановлением после сбоев и запретом downgrade/replay. Пользовательский VPN-трафик обслуживает и шифрует Xray (VLESS/XHTTP/TLS/H3); **не добавлять отдельное шифрование пользовательских данных в XMesh**. Возможность TLS 1.3 `X25519MLKEM768` — отдельный test/canary gate, не свидетельство PQ для текущего пользовательского VPN-трафика.

**Установка и production:** `XMESH1`/legacy Ed25519 остаются активны; `strict-pq` **OFF**. В обычном production Nexus Docker экспериментальные XSP-v2 API не включены; Go 1.27 PoC не импортирован работающим Go 1.23 Node. Владелец не возражает против переустановки «Польша-2», но **это не поручение сейчас стирать, переустанавливать или менять ключи сервера**. Любые разрушительные/боевые переключения — после явного решения о canary или production rollout, с резервной копией и планом восстановления.

**Приоритет владельца:** не оставлять готовые изменения в ветках. После каждого безопасного инженерного этапа: PR → CI и review → merge в `main` → перепроверка файлов/`main` и статуса post-merge CI. Не объявлять успех по одному локальному тесту или открытому PR.

## 2. Снимок репозиториев (не вечные SHA)

Проверено через GitHub 27.10.2026 **до этого документационного PR**:

| Репозиторий | `main` до handoff-правки | CI и PR |
| --- | --- | --- |
| Nexus | `d458b7b7f25d318f20ee29d3d8c90e725d5c98bd` — staging atomic ACK/epoch CAS, PR [#46](https://github.com/TriplexCorp/XMesh-Nexus/pull/46) | Crypto CI [#40493480111](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40493480111) success; User Presence [#40493480123](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40493480123) success; **Backend CI [#40493480354](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40493480354) ещё выполнялся при фиксации**. Предыдущий полный Backend CI на `8b6f0242` [#40488049025](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40488049025) success. |
| Node | `e91560c892bc0783b62924864baede24c676722d` — inventory guard, PR [#20](https://github.com/TriplexCorp/XMesh-Node/pull/20) | Node CI [#40488181345](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40488181345) success. Go Crypto CI на предыдущем `028f4ac0` [#40480677062](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40480677062) success. |

В момент снимка открытых **XSP-v2 PR не было**; отдельный открытый Nexus [PR #20](https://github.com/TriplexCorp/XMesh-Nexus/pull/20) относится к FinalMask UI, не к cutover. В следующем диалоге **повторно проверить** `GET /pulls?state=open` обоих репозиториев и результаты последних Actions перед изменениями. `docs/XSP_V2_MAIN_MERGE_CHECKPOINT.md` — **исторический** промежуточный снимок до #46, а не последний статус.

## 3. Что реально уже слито в `main` (стадия experimental)

| Слой | Nexus | Node | Что доказано / чего нет |
| --- | --- | --- | --- |
| Dual signed wire/interop | [#34](https://github.com/TriplexCorp/XMesh-Nexus/pull/34), [#35](https://github.com/TriplexCorp/XMesh-Nexus/pull/35) | [#13](https://github.com/TriplexCorp/XMesh-Node/pull/13), [#14](https://github.com/TriplexCorp/XMesh-Node/pull/14) | Канонические байты, доменное разделение permit/ACK, Ed25519 + ML-DSA-65, негативные тесты; **не** production |
| Approved prepared keyset / PoP | [#30](https://github.com/TriplexCorp/XMesh-Nexus/pull/30) / миграция 0102 | [#10](https://github.com/TriplexCorp/XMesh-Node/pull/10) | Owner-approved публичная пара, challenge и двойное доказательство владения; **сам PoP НЕ разрешает cutover** |
| Публичные ключи и digest | [#40](https://github.com/TriplexCorp/XMesh-Nexus/pull/40), [#41](https://github.com/TriplexCorp/XMesh-Nexus/pull/41), [#42](https://github.com/TriplexCorp/XMesh-Nexus/pull/42) | [#15](https://github.com/TriplexCorp/XMesh-Node/pull/15), [#16](https://github.com/TriplexCorp/XMesh-Node/pull/16) | Связность old/new key ID с публичными байтами, канонический candidate digest, locked approved PostgreSQL snapshot |
| DB permit/ACK ledger и rollback guards | [#38](https://github.com/TriplexCorp/XMesh-Nexus/pull/38), [#39](https://github.com/TriplexCorp/XMesh-Nexus/pull/39) | — | Миграции `0103`/`0104`, уникальность nonce/request, запрет UPDATE-отката; **не** immutable DB при привилегированном DELETE |
| Verified permit persist | [#43](https://github.com/TriplexCorp/XMesh-Nexus/pull/43) | [#17](https://github.com/TriplexCorp/XMesh-Node/pull/17) | Nexus feature-gated writer проверяет signed permit против locked owner-approved DB; Node сохраняет проверенный permit с `fsync`. Нет deployed signer |
| Signed applied ACK | [#44](https://github.com/TriplexCorp/XMesh-Nexus/pull/44) | [#18](https://github.com/TriplexCorp/XMesh-Node/pull/18), [#19](https://github.com/TriplexCorp/XMesh-Node/pull/19) | Nexus read-only verifier проверяет ACK новыми pending ключами против **оригинального DB-stored permit**; Node ACK journal, vault/floor attestation и lifecycle lock. Нет proof против полной реставрации диска |
| Staging atomic DB commit | [#46](https://github.com/TriplexCorp/XMesh-Nexus/pull/46) | — | `commit_fresh_applied_ack_staging`: одна транзакция для ACK nonce, новой публичной пары, CAS `key_epoch`, immutable ACK ledger; **не вызывается никаким живым API**, нет signed receipt / повторов после commit |
| Inventory CI guard | [#45](https://github.com/TriplexCorp/XMesh-Nexus/pull/45) | [#20](https://github.com/TriplexCorp/XMesh-Node/pull/20) | Проверяет присутствие критических исходников и feature gate. **Не** заменяет тест протокола, CI или проверку merge |

Рекомендуемые исходники:
- Nexus: `backend/src/xsp_v2_signed_cutover.rs`, `xsp_v2_candidate_binding.rs`, `xsp_v2_db_candidate_snapshot.rs`, `xsp_v2_permit_ledger_writer.rs`, `xsp_v2_ack_ledger_validator.rs`, `xsp_v2_ack_epoch_commit.rs`; миграции `0102_node_xsp_rotation_preparations.sql`, `0103_node_xsp_cutover_permit_ledger.sql`, `0104_node_xsp_cutover_ledger_immutability.sql`.
- Node: `security/xspv2/poc-go/cutover/{signed.go,permit_journal_linux.go,applied_ack_journal_linux.go,committed_vault_ack_linux.go,candidate.go}`, `security/xspv2/poc-go/keyring/{two_phase.go,applied_attestation.go}`.
- Спецификации: [signed cutover/ACK](XSP_V2_SIGNED_CUTOVER_ACK_CONTRACT.md), [signed staging](XSP_V2_SIGNED_CUTOVER_STAGING.md), [approved candidate](XSP_V2_CUTOVER_CANDIDATE_BINDING.md), [ledger immutability](XSP_V2_LEDGER_STATE_INVARIANTS.md), [atomic ACK commit](XSP_V2_STAGING_ATOMIC_ACK_EPOCH_COMMIT.md), [applied Node vault](https://github.com/TriplexCorp/XMesh-Node/blob/main/docs/XSP_V2_APPLIED_ACK_VAULT_GATE.md).

## 4. Что НЕ готово — реальные P0-блокеры

1. **Отдельно защищённый Nexus `panel_response` signing service / trust pinning / owner authorization** и durable signing-intent/outbox: подпись, фиксация в PostgreSQL и доставка permit не становятся атомарными сами собой. Ключи и pins **не** брать из недоверенного запроса.
2. **E2E протокол permit → Node fsynced vault+floor → dual-signed applied ACK → Nexus transactional commit → dual-signed server commit receipt → Node receipt verification**, с удержанием старых ключей до отдельно разрешённого retirement. Сейчас есть раздельные helper-функции, но **нет интегрированного, разрешённого к использованию API/агента**.
3. **Повтор ACK после успешного DB commit / потерянная квитанция**: нужен стабильный идемпотентный read-back путь по ранее подтверждённому ledger и подписанный receipt, без повторной смены эпохи и без обязательной проверки уже истёкшего fresh ACK.
4. **Независимый anti-rollback / KMS / резервное восстановление:** локальный `fsync` защищает от ряда падений, но не от отката полного дискового снимка, включая master key и epoch floor. Nexus и Node должны fail-closed согласовать историю.
5. **Настоящие PostgreSQL transaction/failure tests** для `#43/#44/#46`: уникальность nonce, parallel issue/ACK, остановка между SQL-операциями, crash сразу после commit, восстановление старого snapshot, DELETE с правами app роли, контрпримеры подписей/эпох/TTL; сейчас unit/compile CI **не** подтверждают эту совокупность.
6. **Real cross-language signed permit + signed ACK**, fuzz/FIPS 204 KAT, проверка ключевого хранителя, реальный disposable-node canary, независимый security review, затем явная авторизация владельца на production.
7. Дополнительно: полноценные двунаправленно подписанные команды/конфиги/no-command ответы и TLS 1.3 `X25519MLKEM768` на node-only endpoint (если планируется гибридный transport); не смешивать эти задачи с шифрованием клиентского VPN.

## 5. Очередность следующей разработки — действовать без нового уточнения общего контекста

**P0-A (следующий рабочий PR):** составить/реализовать тестовый PostgreSQL harness для `xsp_v2_ack_epoch_commit.rs` и обеспечить проверяемую **retry-after-commit** семантику. Начать с детерминированных тестов duplicate/concurrent ACK, nonce replay, stale epoch и failpoints; по возможности disposable PostgreSQL integration в GitHub Actions. Не подключать сетевой маршрут до этих проверок.

**P0-B:** подписанный Nexus commit receipt, отдельная каноническая спецификация, двухалгоритмная криптография, сохраняемая запись/повторная доставка; Node dual verifier receipt + связь с saved permit/ACK, key epoch и floor.

**P0-C:** доверенный защищённый `panel_response` signer (KMS/HSM или изолированный signing service), одобренная в UI точная пара ключей, атомарный outbox permit и ограниченная по правам БД app роль; полноценный staging transport и авторизованная оркестрация Node apply.

**P0-D:** fault injection power-loss, потеря ACK/receipt, rollback/recovery и disposable VPS; independent security review; только после этого canary, затем gradual production activation с разрешения владельца.

На каждом шаге: проверить `main` обоих репозиториев, создать feature branch, сделать минимальный тестируемый PR, запустить GitHub Backend CI + OpenSSL Crypto CI либо Node CI + Go Crypto CI, исправить ошибки, **слить только безопасное проверенное** изменение в `main`, убедиться в его наличии и перепроверить post-merge CI. Если нет реальной security-проверки, не объявлять production-завершение. В частности, нельзя считать успехом обычный PASS unit-теста, миграцию или запись ACK без проверки полного протокола.

## 6. Живая инфраструктура и отдельные операционные проверки

Оператор 27.10.2026 подтвердил **Node 13 «Польша-2»**: Agent `control-v5.1.3`, локальный `verified` для revision `17fe9deee53f3230ae45cac2553f9fc68b8a2604f1864c9f7af34dcf8d6bfecf`, Nexus `appliedRevision=desiredRevision` до перезапуска; VLESS + XHTTP + TLS + ALPN H3, XMesh router UDP/443 → Xray `127.0.0.1:12431`; реальный клиент и успешный restart контейнеров с `restart=unless-stopped`; сертификат `valid` до 2027-01-25. Это **операторские** данные одного VPS; cold boot, восстановление, реальное ACME renewal и /runtime после рестарта не подтверждались.

Не смешивать legacy Ed25519 HTTP 409 recovery с XSP-v2. Ранее recovery рекомендовали испытывать на disposable ноде, а не на действующей Node 13. Владелец теперь допускает переустановку Польша-2, но это не отменяет явного согласия на уничтожение конфигурации и подготовку backup.

## 7. Стартовый запрос для нового диалога

> Изучи репозитории `TriplexCorp/XMesh-Nexus` и `TriplexCorp/XMesh-Node`, начни с `docs/XSP_V2_NEW_CHAT_HANDOFF.md` и `docs/ENTERPRISE_ROADMAP.md` в Nexus и обоих README. Сверь актуальные `main`, открытые PR и CI. Продолжай XSP-v2 P0 с транзакционных/fault-injection тестов ACK и безопасного retry-after-commit; далее подписанный commit receipt и доверенный signer. Работай реальными PR, исправляй CI и доводи безопасные проверенные изменения до `main`, перепроверяя post-merge. Не объявляй strict-PQ в production до E2E, rollback/failure tests и security review. Пользовательский VPN-трафик остаётся за Xray.

