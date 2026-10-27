# XMesh Nexus — Enterprise Roadmap

> **Текущий инженерный статус: 27 октября 2026.** Следующему ChatGPT-диалогу: **начать с [XSP-v2 — handoff и точные следующие действия](XSP_V2_NEW_CHAT_HANDOFF.md)**, сверить `main`, открытые PR и CI двух репозиториев. Сначала свежий статус ниже, затем **исторические** этапы этого большого Roadmap. Реализация ≠ CI ≠ e2e ≠ security review ≠ production activation.

### Проверенный checkpoint — Nexus #55 / Node #26 (27 октября 2026)

**Основные ветки проверены после слияния:** Nexus `7507437102df59c3bbd4682170c1b81300fdd565` ([PR #55](https://github.com/TriplexCorp/XMesh-Nexus/pull/55)); Node `d2f916bfef36f7093de0cf0d57744f8f40c423cb` ([PR #26](https://github.com/TriplexCorp/XMesh-Node/pull/26)). Это подтверждённый снимок исходников, **не** доказательство развертывания. После merge на точном Nexus SHA прошли [Backend CI #40536860094](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40536860094), [PQ Crypto #40536860140](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40536860140), [User Presence #40536860723](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40536860723) и [GeoData/Routing #40536860386](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40536860386). После Node #26 — [Go Crypto #40531422433](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40531422433) и [Node CI #40531422490](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40531422490), оба **success**. Открытых XSP-v2 PR на момент проверки не было; Nexus #20 — отдельный FinalMask UI.

**Завершённые staging-компоненты:** подписанные Ed25519 **AND** ML-DSA-65 permit и applied ACK; атомарный DB commit и readback ([Nexus #46–50](https://github.com/TriplexCorp/XMesh-Nexus/pull/50)); каноническая dual-signed Nexus commit receipt ([#54](https://github.com/TriplexCorp/XMesh-Nexus/pull/54)); неизменяемое PostgreSQL-хранилище `0105` с криптографической повторной проверкой и идемпотентным exact-byte retry ([#55](https://github.com/TriplexCorp/XMesh-Nexus/pull/55)). На Node в отдельном Go 1.27 модуле есть обязательный TLS 1.3 `X25519MLKEM768` dialer ([#23](https://github.com/TriplexCorp/XMesh-Node/pull/23)), receipt verifier ([#24](https://github.com/TriplexCorp/XMesh-Node/pull/24)), защищённый fsynced receipt journal ([#25](https://github.com/TriplexCorp/XMesh-Node/pull/25)) и реальный HTTPS ACK→receipt обмен с **локальным тестовым TLS-сервером** ([#26](https://github.com/TriplexCorp/XMesh-Node/pull/26)).

**Следующий P0 — интеграция, а не повторная разработка receipt:** защищённый `panel_response` signer / pinned keys / одобрение владельца, аутентификация Node, Nexus `POST /api/v2/node/keys/rotation/ack` с транзакционным ACK и signed receipt outbox, действительный проверенный PQ-only ingress, затем основной Node Agent, двухсторонне подписанные команды/конфигурации и полный E2E/failure/security review. **В рабочем Nexus API ещё нет этого ACK handler; Go 1.27 PoC не подключён к основному Agent Go 1.23.** Не считать успешный CI фактом полноценной сетевой PQ-связи.

### Решение об архитектуре: XSP-v2 строго PQ-only, без выбора пользователя

**Обязательное требование к конечному продукту:** Node **не соединяется** с Nexus, если не подтверждён TLS 1.3 с `X25519MLKEM768`, действительная идентичность TLS-сервера и обе подписи Ed25519 **AND** ML-DSA-65 у управляющих сообщений. Нет чекбокса `strict-pq`, переключателя на `XMESH1`, `Ed25519-only` или `X25519-only`, опции `--insecure` либо автоматического downgrade; отсутствие ключей/библиотек/корректной эпохи = **fail closed**. На этапе замены старых агентов необходимы полноценная PQ-регистрация, trusted signer, Node verifier, signed receipt и согласованный TLS ingress; до этого действующие legacy-инстансы продолжают работать только как **ещё не мигрированная инфраструктура**, а не как предлагаемый пользователю режим. [Обязательная PQ-only политика](XSP_V2_PQ_ONLY_SECURITY_POLICY.md).

### Новый staging-компонент для серверной повторной доставки

**Immutable signed receipt outbox**: SQL миграция `0105`, связанная с оригинальным committed ACK, и Rust `xsp_v2_signed_receipt_outbox` предотвращают замену уже записанной Ed25519+ML-DSA-65 квитанции и возвращают одинаковые байты при повторной доставке. Это **не** авторизованный Nexus API, не KMS signer, не готовое соединение панели и Agent. Остаются: защищённая Node identity и PQ-only ingress, выпуск receipt из защищённого подписывающего сервиса, интеграция с Go Agent, end-to-end и rollback/failure проверки.

## Состояние на сегодня — что находится в `main`

| Направление | Проверенный рубеж | Следующий gate |
| --- | --- | --- |
| **Production VPN/data-plane** | Nexus + XMesh Node управляют Xray; оператор подтвердил реальный **VLESS/XHTTP/TLS/H3** на «Польша-2» Node 13, signed policy/attestation, `applied=desired` и работу после контролируемого restart. Пользовательский VPN-трафик шифруется Xray/TLS | Backup/restore, cold boot, ACME renewal, power-loss отдельно не проверены |
| **Production control-plane** | Продолжает работать `XMESH1`/Ed25519; Agent `control-v5.1.3` и bootstrap/metrics | НЕ активировать `strict-pq` до E2E и review |
| **Experimental PQ crypto** | Shared contract/Go↔Rust test vectors, Ed25519 **и** ML-DSA-65 signed permit/ACK primitives ([Nexus #34/#35](https://github.com/TriplexCorp/XMesh-Nexus/pull/35), [Node #13/#14](https://github.com/TriplexCorp/XMesh-Node/pull/14)); подготовленная двойная публичная пара / owner proof [Nexus #30](https://github.com/TriplexCorp/XMesh-Nexus/pull/30), [Node #10](https://github.com/TriplexCorp/XMesh-Node/pull/10) | KAT/fuzz, signer custody, реальное доверенное end-to-end управление |
| **Approved candidate binding** | old/new key IDs и публичные байты, cross-language digest, snapshot под PostgreSQL row lock ([Nexus #40/#41/#42](https://github.com/TriplexCorp/XMesh-Nexus/pull/42), [Node #15/#16](https://github.com/TriplexCorp/XMesh-Node/pull/16)) | Trust pin provisioning, verified owner-facing approval |
| **PostgreSQL cutover state** | Пассивный permit/ACK ledger `0103`, rollback guard `0104`, verified permit writer [#43](https://github.com/TriplexCorp/XMesh-Nexus/pull/43), DB-backed ACK verifier [#44](https://github.com/TriplexCorp/XMesh-Nexus/pull/44) | Transactional/fault-injection tests, immutable history/least privileges |
| **Staging atomic ACK → epoch CAS** | **Nexus [PR #46](https://github.com/TriplexCorp/XMesh-Nexus/pull/46) слит**: `xsp_v2_ack_epoch_commit.rs` в отдельной транзакции проверяет signed ACK, сохраняет one-use nonce и новый public keyset, делает CAS key epoch и сохраняет immutable ACK | **Код не вызывается ни одним работающим API**, нет защищённой квитанции после commit; SQL fault/parallel tests появились в #48 |
| **Staging signed transaction tests** | [#48](https://github.com/TriplexCorp/XMesh-Nexus/pull/48) SQL-only fault/concurrent ACK; [#49](https://github.com/TriplexCorp/XMesh-Nexus/pull/49) реальные Ed25519+ML-DSA-65 permit/ACK через Rust + disposable TimescaleDB | Нет end-to-end аварийной остановки / rolling snapshots, нет Node vault/key custodian proof |
| **Staging committed ACK readback** | [#50](https://github.com/TriplexCorp/XMesh-Nexus/pull/50): повторная проверка signed permit/ACK, исходных исторических public keysets, ledger hash/nonce и зафиксированной DB-эпохи без SQL-перезаписи | Read-only DB witness, **не** signed commit receipt; нет сетевого retry, Node verifier, multi-epoch восстановления |
| **Node applied state + journals** | Isolated Go 1.27: fsynced permit journal [#17](https://github.com/TriplexCorp/XMesh-Node/pull/17), signed ACK journal [#18](https://github.com/TriplexCorp/XMesh-Node/pull/18), проверка applied encrypted vault + floor + старой/новой пары и lifecycle lock [#19](https://github.com/TriplexCorp/XMesh-Node/pull/19) | Anti-rollback вне полного дискового snapshot, receive/verify signed receipt, интеграция в реальный агент |
| **Репозиторный контроль** | Nexus [#45](https://github.com/TriplexCorp/XMesh-Nexus/pull/45) / Node [#20](https://github.com/TriplexCorp/XMesh-Node/pull/20): main artifact CI-inventory checks | Сверять свежий `main` и CI после каждого merge; CI inventory не является security audit |
| **Hybrid TLS** | Изолированный TLS 1.3/OpenSSL/Nginx эксперимент с `X25519MLKEM768` | Отдельный node-only e2e ingress + disposable canary; не заявлять PQ клиентского Xray из этого теста |

### Архивный снимок `main` до PR #47 (не текущий статус)

- **Nexus:** `d458b7b7f25d318f20ee29d3d8c90e725d5c98bd` (merge #46). [Crypto #40493480111](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40493480111) **success**, [User Presence #40493480123](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40493480123) **success**, [Backend #40493480354](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40493480354) **выполнялся на момент фиксации**. Последний ранее завершённый Backend [#40488049025](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40488049025) **success** на `8b6f0242`.
- **Node:** `e91560c892bc0783b62924864baede24c676722d` (merge #20). [Node CI #40488181345](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40488181345) **success**; предшествующий [Go Crypto #40480677062](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40480677062) success.
- **Открытые XSP-v2 PR на момент снимка: отсутствовали.** Nexus [#20](https://github.com/TriplexCorp/XMesh-Nexus/pull/20) — независимый UI FinalMask PR. Все упомянутые PQ PR до #46 влиты в `main`. После этого handoff merge SHA изменятся: **никогда не считать таблицу вечным текущим состоянием**.

## P0 — проверяемые этапы и следующий приоритет (27.10.2026)

1. [x] **P0-A, изолированная криптография и DB commit:** dual Ed25519+ML-DSA-65 signed permit/ACK, PostgreSQL CAS, nonce, исторический readback, SQL fault/concurrency и реальный Rust→TimescaleDB test ([Nexus #48–50](https://github.com/TriplexCorp/XMesh-Nexus/pull/50)).
2. [x] **P0-B, каноническая двусторонняя квитанция:** Rust Nexus signed receipt [#54](https://github.com/TriplexCorp/XMesh-Nexus/pull/54), Go Node dual verifier [#24](https://github.com/TriplexCorp/XMesh-Node/pull/24), immutable Node receipt journal [#25](https://github.com/TriplexCorp/XMesh-Node/pull/25), immutable Nexus PostgreSQL receipt outbox [#55](https://github.com/TriplexCorp/XMesh-Nexus/pull/55). Негативные и real signed PostgreSQL тесты успешны. Все они — staging, а не внедрение.
3. [x] **PQ-only сетевой клиент staging:** Node [#23](https://github.com/TriplexCorp/XMesh-Node/pull/23) и [#26](https://github.com/TriplexCorp/XMesh-Node/pull/26) требуют TLS 1.3 `X25519MLKEM768`, валидного сервера, exact signed ACK и dual-signed receipt. Протестировано **только с локальным HTTPS-сервером**, не с Nexus handler.
4. [ ] **P0-C — СЛЕДУЮЩИЙ:** доверенный `panel_response` signer / custody / owner authorization, защищённый PQ-only node ingress с проверкой каждого TLS hop, авторизованный Nexus ACK handler; при первой доставке commit→signed receipt→immutable outbox, при повторе — точно тот же подписанный ответ, без downgrade или unsigned 200. Нужны реальные проверки клиента и сервера вместе.
5. [ ] **P0-D:** подключить протокол в основной Node Agent и рабочую конфигурацию Nexus, подписать **все** управляющие команды, конфигурации, heartbeat и ответы; гарантия проверки обеих подписей и монотонной эпохи перед применением.
6. [ ] **P0-E:** аварийные E2E сценарии: reboot/crash после commit до receipt, недоставка/повторы/гонки, полный disk/DB snapshot rollback, защита DB роли от DELETE, key recovery/retirement, TLS downgrade, FIPS 204 KAT/fuzz, независимый review и тестовая приёмка. До них никаких заявлений о завершённом production PQ-only.

**Процесс обязателен:** feature branch → PR → GitHub Backend CI + Crypto CI (или Node CI + Go Crypto CI), review → merge в `main` → повторная проверка файлов, PR и post-merge CI. Пользователь прямо просил не оставлять проверенные правки в незлитых ветках. Проверять конкретный SHA, а не только зелёный бейдж на другом commit. Если CI не зелёный или безопасность не проверена — честно оставить draft.

**Границы:** нет полной production XSP-v2 ротации, защищённого signer, server-signed receipt, anti-rollback полного snapshot и e2e canary. Отдельный Go 1.27 PoC НЕ равен работающему Node Agent Go 1.23. Работающий VPN = Xray; XMesh не должен повторно шифровать пользовательский трафик. Переустановка «Польша-2» владельцу допустима, но не считать это автоматическим разрешением на разрушительные действия без бэкапа и явной команды.

## Операционная приёмка «Польша-2» — PASS в узком смысле (27.10.2026)

- [x] Оператор подтвердил Node 13: Agent `control-v5.1.3`; локально `status=verified`, revision `17fe9deee53f3230ae45cac2553f9fc68b8a2604f1864c9f7af34dcf8d6bfecf`.
- [x] До restart Nexus `GET /api/v1/nodes/13/runtime`: `connected=true`, `profileApplicationStatus=applied`, `profileCheck=verified`, `appliedRevision=desiredRevision`.
- [x] **VLESS/XHTTP/TLS/ALPN H3**, UDP public/443 → Xray `127.0.0.1:12431`, реальный клиент через мобильную сеть. Не Hysteria2; TCP backend для H3-only этим тестом не доказан.
- [x] После контролируемого `docker restart` Xray/router возобновились `restart=unless-stopped`; местная attestation оставалась `verified`.
- [x] На момент проверки Let's Encrypt сертификат имел состояние `valid`, истекал **2027-01-25 03:36:40 UTC**, `autoRenew=true`.
- [ ] **Не проверялось:** реальное ACME-продление, cold boot, полный backup/restore, power-loss, отдельный legacy HTTP 409 recovery (только disposable), independent penetration review, production strict PQ и /runtime после restart.

## Исходники и специальные документы для возобновления

- **Обязательный handoff:** [XSP_V2_NEW_CHAT_HANDOFF.md](XSP_V2_NEW_CHAT_HANDOFF.md)
- **Схема доверия:** [XSP_V2_SIGNED_CUTOVER_ACK_CONTRACT.md](XSP_V2_SIGNED_CUTOVER_ACK_CONTRACT.md), [XSP_V2_CUTOVER_CANDIDATE_BINDING.md](XSP_V2_CUTOVER_CANDIDATE_BINDING.md)
- **Nexus staging:** [XSP_V2_STAGING_VERIFIED_PERMIT_WRITER.md](XSP_V2_STAGING_VERIFIED_PERMIT_WRITER.md), [XSP_V2_STAGING_LOCKED_ACK_ADJUDICATION.md](XSP_V2_STAGING_LOCKED_ACK_ADJUDICATION.md), [XSP_V2_STAGING_ATOMIC_ACK_EPOCH_COMMIT.md](XSP_V2_STAGING_ATOMIC_ACK_EPOCH_COMMIT.md)
- **Node staging:** [XSP_V2_APPLIED_ACK_VAULT_GATE.md](https://github.com/TriplexCorp/XMesh-Node/blob/main/docs/XSP_V2_APPLIED_ACK_VAULT_GATE.md), [XSP_V2_VERIFIED_PERMIT_JOURNAL.md](https://github.com/TriplexCorp/XMesh-Node/blob/main/docs/XSP_V2_VERIFIED_PERMIT_JOURNAL.md).
- Файл [XSP_V2_MAIN_MERGE_CHECKPOINT.md](XSP_V2_MAIN_MERGE_CHECKPOINT.md) — **исторический** до нового commit #46; не использовать вместо актуального handoff.

---

## Исторические этапы (ниже сохранены исходные подробности; старые статусы/«следующий P0» могут устареть)

## История P0 — staging owner-approved dual-key enrollment (27 October 2026)

- [x] **CI compatibility:** removed an OpenSSL-3.5-only ML-DSA private-key generation call from ordinary Nexus backend tests; dedicated OpenSSL 3.5 Rust/Go Crypto CI remains responsible for actual PQ signing and interoperability.
- [x] **Owner-gated staging registration:** `0100_node_xsp_owner_key_approval.sql` holds only PUBLIC key IDs/bytes and SHA-256 of a 32-byte challenge. Owner-authenticated `POST /api/v2/admin/nodes/{id}/key-approval` approves the **exact next epoch and exact public keys**, with a 10-minute expiry; it requires a trusted existing v1 node identity.
- [x] **Both proofs mandatory (historical initial enrollment):** staging `claim` проверяет обе подписи на одних подписываемых байтах, сохраняет первый публичный keyset и epoch 1 транзакционно. После [PR #24](https://github.com/TriplexCorp/XMesh-Nexus/pull/24) он **не** отзывает ранее действовавшие пары и **отклоняет** попытки следующих эпох: безопасный cutover требует отдельного протокола и ACK.
- [x] **Node staging tooling:** `keytool prove` signs the owner challenge from the AES-GCM encrypted vault. Rust and Go share a golden binary-input SHA-256. Isolated CI generates new encrypted Go keys and checks real cross-language Rust/OpenSSL signature verification and mutations. PostgreSQL integration checks bounded approval lifetime and length/uniqueness constraints.
- [ ] **Production blockers remain:** trusted owner-facing UI, secure isolated HTTPS endpoint and proof of every TLS hop, two-phase rotation with old-key retention until cutover, signed server responses, durable monotonic floor at both peers, audited key recovery, FIPS 204 KAT/fuzz and external review. **No live node or public panel is migrated.**

Implementation and manual staging boundaries: [XSP_V2_OWNER_KEY_ENROLLMENT.md](XSP_V2_OWNER_KEY_ENROLLMENT.md).

---

## XSP-v2 P0 continuation — dual-signature staging API, sealed keys, live Nginx laboratory (27 October 2026)

- [x] **Rust staging heartbeat:** only with non-default `xsp-v2-experimental` Cargo feature and runtime `XSP_V2_EXPERIMENTAL_HEARTBEAT=staging-only`, validates exact envelope and **both** Ed25519/ML-DSA-65 signatures against pinned unrevoked PostgreSQL keys and atomically inserts replay nonce. Accepts only `shadow` phase, returns unsigned 204, never dispatches policies/commands. Normal production Docker has **no v2 route**.
- [x] **Encrypted Node research vault:** Go 1.27.3 AES-GCM vault (0600/0700) с отдельным wrapping key и локальным prepare/prove/activate/recover, сохранением предыдущего ciphertext и fail-closed epoch floor. [PR #5](https://github.com/TriplexCorp/XMesh-Node/pull/5), [#6](https://github.com/TriplexCorp/XMesh-Node/pull/6). Это **не** HSM, proof on real VPS, integrated Nexus ACK или production-ротация.
- [x] **Real Nginx lab:** loopback TLS1.3/X25519MLKEM768 template, throwaway cert and authenticated handshake, negative TLS1.2/X25519/hostname and HTTP-only-404 checks. [Nginx CI passed](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40439086025). No live server change.
- [ ] **Before activation:** owner-approved enrollment существует только на staging; для production нужны защищённый канал/owner UI, двухфазная ротация, backup/recovery, signed responses и applied ACK, persist suite floor на Node и Nexus, KAT/fuzz/security review и реальная disposable VPS с проверенным TLS.

Details: [experimental gateway, vault, TLS and blockers](XSP_V2_EXPERIMENTAL_GATEWAY.md).

---
## XSP-v2 P0 continuation — strict parser, public-key epoch state and node-only TLS skeleton (27 October 2026)

**Implemented as pre-production foundations, not switched on.** See [XSP_V2_P0_FOUNDATION.md](XSP_V2_P0_FOUNDATION.md) (identical in Nexus/Node).

- [x] **Strict test-only decoder (Node):** Go 1.27.3 `security/xspv2/poc-go/envelope/strict.go` enforces JSON object uniqueness including nested keys, known endpoint/type/direction, canonical Base64, signature lengths, bounds, Unix millisecond expiry order, nonce/epoch and byte-for-byte shared wire vectors. Returns `Untrusted`; **does not verify signatures or authenticate an identity**. Negative tests in isolated Go CI.
- [x] **Ephemeral dual-key generation (Node):** `security/xspv2/poc-go/keyring/volatile.go` creates independently randomized Ed25519 and ML-DSA-65 keys in memory, exposes only algorithm-labeled public metadata, and tests signing/rotation/randomness. **No disk storage, enrollment, KMS, private-key backup or production integration.**
- [x] **Additive public metadata migration (Nexus):** `0099_node_xsp_v2_public_state.sql` stores PUBLIC verification keys, per-node epochs/minimum suite, and unique replay nonces. Default minimum suite is legacy; trigger prevents ordinary UPDATE from lowering minimum suite/key epoch. No strict rows, endpoints or private keys are provisioned.
- [x] **Inert node-only Nginx template:** `deploy/xsp-v2-node-ingress.nginx.conf.example` listens **loopback :8444 only**, requires TLS 1.3 and only X25519MLKEM768, and returns **404 for every HTTP path**. Neither installer nor public vhost loads it. `scripts/check-xsp-v2-foundation.js` protects these invariants in Nexus CI.
- [ ] **Security blockers:** в staging heartbeat и регистрации уже реализована проверка двух подписей; в production всё ещё нет проверяемых подписанных ответов/команд, защищённой регистрации и постоянного key store, атомарного nonce+policy side effect, role-separated DB operations, долговечного Node-side suite pinning и recovery. **DB UPDATE-триггер не останавливает DELETE или rollback привилегированного DBA.**
- [ ] **Operational blockers:** approved dedicated node-only TLS gateway, valid CA/SNI, measured negotiation at real canary endpoint and every proxy hop, complete FIPS 204 external KAT/fuzz and independent review. **No public listener, SSH/host changes or Node migration performed.**

**Evidence:** isolated [Node Go Crypto CI](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40435069749) and [Node CI](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40435069677) were green on `1224913b`, including parser and volatile-key unit tests; later documentation commits require their own checks. Full Nexus CI for the new SQL/template revisions is verified separately in [Actions](https://github.com/TriplexCorp/XMesh-Nexus/actions/workflows/backend-ci.yml).

---

## XSP-v2 — срез готовности на 27 октября 2026 (P0)

**Важное различие:** лабораторный CI подтверждает проверенный криптографический механизм, **но не** включённую PQ-защиту нод или инфраструктуры Nexus. Рабочие Node (Go 1.23), `XMESH1`/Ed25519, публичный Nginx и Xray не переключались на XSP-v2. `strict-pq` и защита от downgrade на уровне состояния нод **не активированы**.

| Этап | Состояние | Подтверждение / незавершённое |
| --- | --- | --- |
| **PR01 — wire/spec** | [x] Черновая спецификация + общие тестовые векторы | Совпадают в Rust/Go/JS; формальный security review и окончательное утверждение формата ещё нужны |
| **PR02 — Ed25519 + ML-DSA-65** | [x] Изолированный крипто-PoC | Прямые тесты **Go → Rust** и **Rust → Go** требуют обе подписи; изменение сообщения, отсутствие и порча подписи отвергаются. [Nexus Crypto CI](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40431220079), [Node Crypto CI](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40432027022) |
| **PR07 — TLS 1.3 + X25519MLKEM768** | [x] Лабораторный TLS-probe, **не развёрнут** | Реальные handshake OpenSSL 3.5 ↔ Go 1.27.3 с проверкой согласованной группы, CA/SNI и отказом TLS 1.2, X25519-only и неверным сертификатам. [Nexus TLS CI](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40432661499) |
| **Production XSP-v2** | [ ] Не внедрён | Есть **экспериментальные** v2 API, owner-approved PoP и зашифрованный тестовый vault; **нет** включённого v2 control plane, production ключевого хранилища, подписанных ответов, выделенного реального ingress и миграции Node |

**Исторический CI по версиям:** [Nexus Backend CI #40432809267](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40432809267) — success на `918d42fa`. Более поздний Rustfmt/Clippy gate исправлен через [PR #22](https://github.com/TriplexCorp/XMesh-Nexus/pull/22); [полный Backend CI `main` #40444076259](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40444076259) теперь **success** на `f5f3e06`. Это не подтверждает XSP-v2 на production VPS.

**Следующая очередь:** обеспечить server-side two-phase key rotation/ACK с проверкой old+new epoch, identity, purpose, revision, durable anti-replay и отказоустойчивостью; затем `panel_response` signer, подписанные v2 ответы/команды/applied ACK, KMS-backed backup, выделенный HTTPS ingress на canary и независимая security-приёмка. `strict-pq` и рабочий публичный Nginx не менять автоматически.

Ссылки: [wire specification](XSP_V2_WIRE_SPEC.md) · [crypto PoC](XSP_V2_CRYPTO_POC.md) · [hybrid TLS probe](XSP_V2_TLS_PROBE.md) · [полный XSP-v2 план](HYBRID_POST_QUANTUM_SECURITY_IMPLEMENTATION_PLAN.md).

---

## Обновления 26 октября 2026

### GeoData — источники Loyalsoldier по умолчанию

- [x] Серверный генератор подписанного GeoData manifest использует релизы `Loyalsoldier/v2ray-rules-dat` для `geosite.dat` и `geoip.dat`, если источник не переопределён.
- [x] В диалоге GeoData обе реальные HTTPS-ссылки отображаются сразу, в том числе для существующих нод с пустыми полями.
- [x] Пользовательские URL остаются неизменными; GeoData **не включается автоматически** на существующих нодах.
- [ ] Проверить скачивание обоих файлов, обработку GitHub redirects, реальную Xray-проверку и сохранение старой проверенной базы при ошибке загрузки.
- [ ] Добавить в интерфейс дату последней успешной загрузки, размер, SHA-256, источник и сообщение о последнем сбое с безопасным ограничением подробностей.
- [ ] Проверить сценарий отключения GeoData, повторного включения и изменения интервала 6–168 часов.

### TLS — видимость и надёжность

- [x] Добавлены read-only сведения о сертификате из агента: домен, issuer, `notBefore`, `notAfter`, оставшиеся дни и код ошибки.
- [x] TLS-сведения включены в подписанный heartbeat и выводятся в карточке ноды; секретные ключи не передаются.
- [x] Целевая версия агента `control-v5.1.0`; диагностический скрипт доставляется через **Обновить Agent**.
- [ ] Проверить наличие и активность таймера Certbot, корректность HTTP-01 на TCP/80 и успешное продление на реальном узле.
- [ ] Разделить в интерфейсе «таймер включён», «последняя попытка продления», «последнее успешное продление» и «сертификат фактически обновлён»: это разные события.
- [ ] Добавить предупреждения о сроке действия и диагностический экран ACME без раскрытия приватных ключей.
- [ ] Проверить права observer и устойчивость к повреждённой/устаревшей TLS-телеметрии.

### Обновление нод через панель

- [x] Подписанная команда обновления агента из интерфейса и автоматический запрос синхронизации Xray после установки.
- [ ] Проверить реальный переход `control-v4.x → control-v5.1.0`, сохранение управления при сбое и восстановление без повторного bootstrap.
- [ ] Добавить явный статус этапов установки, код ошибки, время последней попытки и проверку версии после перезапуска.
- [ ] Подготовить проверяемый rollback обновления и транзакционную схему для критических компонентов.
- [ ] Подтвердить TCP/UDP 443 и XHTTP ALPN `h3+h2+http/1.1` в реальном Xray и клиенте.

---

## История реализации: Node TLS health in UI (2026-10-26)

- [x] Signed heartbeat includes read-only TLS certificate health (state, domain, issuer, validity dates, remaining days, detected renewal configuration, bounded error code).
- [x] Node cards show TLS health, expiration and detailed issuer/renewal information without exposing private keys or certificate PEM.
- [x] Update Agent deploys the certificate inspector automatically; target agent release is **control-v5.1.0**.
- [x] TLS telemetry is stored in a dedicated JSONB column and returned by the existing authenticated node runtime endpoint.
- [ ] Confirm certificate renewal timer is actually enabled on deployed hosts and run an end-to-end ACME renewal test; the UI must not claim a renewal succeeded without evidence.

## Node updates from Nexus UI (2026-10-26)

- [x] Major release **control-v5.0.0**; existing control-v4 nodes remain eligible for signed UI-initiated upgrades, and both v4/v5 heartbeats are accepted during rollout.

- [x] Signed **Update Agent** action in Nodes installs the control agent, managed Xray synchronizer, policy guard, TLS/ACME helpers, GeoData and metrics helpers, and upgrades the Docker router without requiring a manual SSH deployment.
- [x] After a successful agent upgrade, queue an immediate managed Xray reconciliation (nonblocking); the periodic timer remains the retry path.
- [x] Mixed XHTTP ALPN `h3 + h2 + http/1.1` routes TCP and UDP on the same public port in XMesh Node.
- [ ] Validate HTTP/3 end-to-end with a compatible client and confirm UDP/443 is allowed by the hosting firewall. Panel-driven update success alone does not prove H3 connectivity.

# XMesh Nexus — Enterprise hardening roadmap

## Shadowsocks 2022 per-user credentials — 2026-10-26

- [x] Identify why SS2022 outbounds silently disappear: `proxy_outbound` and managed node generation require `ssPassword`, previously absent on ordinary user records.
- [x] Generate stable CSPRNG-backed AES-128/AES-256 SS2022 user keys on creation and conditionally backfill older records before node and subscription generation.
- [x] Protect keys from generic user updates; validate AES-128 selection with a regression test.
- [ ] Verify full Rustfmt, Rust tests, Clippy and production CI after these changes.
- [ ] Confirm Xray node policy deployment and that the client receives a working `ServerPSK:UserPSK` with an actual SS2022 client.


## FinalMask guided configuration and dialog layout — 2026-10-26

**Source status: implemented in `main`. Production/client/browser acceptance: open.** [PR #21](https://github.com/TriplexCorp/XMesh-Nexus/pull/21) was squash-merged; subsequent width and regression fixes were committed directly to `main`.

- [x] Replace the original narrow dual-JSON-first dialog with a selectable catalog while preserving Advanced JSON and Reset.
- [x] Expose the **complete 16-option catalog**: TCP Sudoku, Header Custom, Fragment, XMC, Filter; UDP Salamander/Gecko, Sudoku, Header Custom, mKCP Legacy, Noise, Port Hopping, XDNS, XICMP, Realm, Filter; QUIC Client Params.
- [x] Keep every mask visible and mark transport-incompatible choices disabled with a reason. Restrict XDNS to mKCP, Gecko packetSize to QUIC and client QUIC params to QUIC/H3; distinguish inbound-only filter from client-only directional layers.
- [x] Generate 256-bit Sudoku/Salamander shared secrets using browser CSPRNG, retain Advanced JSON for complex chains, and offer per-layer settings JSON for less common types.
- [x] Preserve required server symmetric layers when creating an explicit client override; maintain client UDP hop as the last layer and preserve guardrails around incompatible overrides.
- [x] **Fix the narrow-dialog regression:** root cause was the global `styles.css` `dialog:not(...)` width selector taking precedence over the original `.xm-studio-modal--cards` declaration. Add `dialog.xm-studio-modal.xm-studio-modal--cards` with `width:min(84rem,calc(100vw - 2rem))!important`, viewport-bounded scrolling and a 4/3/2/1 responsive grid. Cache-bust the stylesheet. [CSS change `c918fecb`](https://github.com/TriplexCorp/XMesh-Nexus/commit/c918fecb334679bcf6050ef66077795d9f1b4d9f).
- [x] Add `scripts/check-xray-tool-actions.js` regression assertions for catalog options, inherited layers, masks and explicit dialog width. [Regression commit `150978cc`](https://github.com/TriplexCorp/XMesh-Nexus/commit/150978cc203b0d6b463c1c0031151b6f89349a80). Add RU/EN copy and cache refresh.
- [ ] **Browser acceptance:** open the actual modal in Chromium and Firefox at 375/580/760/1100/1440/1920 px, verify 4/3/2/1 columns, readable cards, proper scrollbar and header/footer, focus and Escape, RU/EN text, 90–200% scaling, light/dark themes and no inherited app-wide width cap.
- [ ] **Behavioral acceptance:** exercise each enabled card, rejected inputs, complex pre-existing server/client chains and the final emitted subscription. Confirm validation against the installed Xray-core, not only JS source contracts.
- [ ] **Network/client acceptance:** validate compatible Xray releases and clients for TCP, UDP and QUIC; specifically confirm XDNS/mKCP, XICMP permissions, Realm infrastructure, Gecko, UDP Hop NAT/firewall and filter behavior on a disposable node.
- [x] **CI gate (code revision):** [Backend CI #40304117546](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40304117546) succeeded on `main` at `150978cc`, including the FinalMask JavaScript checks.
- [ ] **Production gate:** complete browser and real Xray/client/network testing before calling FinalMask production-verified.

**Safety note:** a `filter` mask is inbound-only and must never be exported to an outbound; `quicParams` are endpoint-specific; enabled UI options are not a promise of universal client compatibility. Detailed semantics: [FinalMask matrix](FINALMASK_COMPATIBILITY.md).

## XRAY STUDIO template completeness — 2026-10-26

- [x] Introduce transport-aware default `tlsSettings.alpn` for XHTTP/RAW, gRPC, WebSocket/HTTPUpgrade, Hysteria and MASQUE.
- [x] Expose editable ALPN and TLS certificate/private-key file paths in the interactive composer; preserve an existing inbound's TLS values when reopening it.
- [x] Add warnings for loopback binding, missing TLS credentials and empty users; validate ALPN syntax and gRPC h2 requirement.
- [x] Add composer regression assertions for automatic ALPN, manual override, TLS file pairing and UI fields.
- [ ] Verify tests and full GitHub Actions CI on `main`; run real Xray-core configuration validation for each transport.
- [ ] Add deployment-aware guided profiles (direct VPS vs reverse proxy), without changing existing loopback defaults behind operators' backs.
- [ ] Expand automated client/server compatibility, certificate discovery and deployment diagnostics; never generate fictitious keys or paths.


## CI stabilization checkpoint — 2026-10-26

**Scope:** FinalMask catalog and layout regression, English copy audit, presence checks and backend release gates. PR #21 was merged, then the dialog-specific fix and tests were committed directly to `main`; source changes and verified gates remain distinct.

- [x] Resolve Rust `E0505` borrow/move failure in `subscription_finalmask.rs` (source fix committed).
- [x] Translate new navigation, agent installation and FinalMask catalog copy; pass the English-coverage CI audit. The documented translation-debt baseline remains tracked and non-zero.
- [x] Remove brittle exact cache-version pinning from the user-presence test and correct the follow-up JavaScript regular-expression syntax error.
- [x] Apply all **61** formatting hunks reported by Rustfmt across five backend Rust files.
- [x] Confirm Rustfmt and Rust tests, strict Clippy, frontend/FinalMask and English-coverage checks, Docker build, `cli`, `subscription-build` and API authentication integration all pass in [Backend CI #40304117546](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40304117546) on `main` at `150978cc` (**conclusion: success**).
- [ ] Confirm the generated FinalMask/client JSON on real deployed Xray nodes and clients, including browser-modal interaction and permissions/network dependencies. CI success alone is insufficient.

**Acceptance gate:** do not mark enterprise readiness or full CI stabilization complete until the above checks have actual passing evidence.


**Baseline:** 2026-10-24 · **Progress reviewed:** 2026-10-27 · **Target branch:** `main` · **Status:** XSP-v2 staging only; `strict-pq` disabled. Latest verified *implementation* CI: Nexus PR #30 `fb334b5` [Backend #40456461465](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40456461465) + [Crypto #40456461449](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40456461449), Node `main` `4714307` [CI #40455937718](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40455937718) — success. Nexus docs/code baseline `main` `5e3db55` has [separate successful Backend CI #40457374564](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40457374564). Operator validation on live VPS and signed cutover/ACK remain OPEN; NOT enterprise-production certified.

This roadmap tracks verified improvements, not feature claims. A stage is complete only after the listed acceptance criteria pass in CI and, where required, on a disposable real Xray node. A green source-level assertion alone does not count as production evidence.

## PRIORITY #1 — P0: Hybrid post-quantum security for Nexus ↔ Node (IN PROGRESS)

**Status:** [~] IN PROGRESS — PR01/PR02/PR07 research and laboratory CI implemented; **production XSP-v2 NOT IMPLEMENTED / NOT VERIFIED**. **Priority:** highest. **Scope:** Nexus control plane + Node agents, across both repositories. Active `XMESH1`/Ed25519 communication is **not** post-quantum secure.

**Implementation checkpoint — 2026-10-27 (PR01 foundation, not deployed):**

- [x] Audited current Nexus Ed25519 `XMESH1` requests, node enrollment, separately signed policy, unsigned command response gap, Node Go heartbeat, and actual external TLS termination.
- [x] Added draft [XSP_V2_WIRE_SPEC.md](XSP_V2_WIRE_SPEC.md) and identical [XSP_V2_VECTORS.json](XSP_V2_VECTORS.json) to Nexus and XMesh-Node `main`.
- [x] Added *test-only* binary encoders/negative fixtures in Nexus Rust, Go Node and independent JavaScript; the CI suite runs the applicable tests. No PQ-signing code, keys, new API paths or agent activation were introduced.
- [x] Shared-vector and isolated cryptographic/TLS CI have passed in both repositories (see dated run links above).
- [ ] Owner/security review and freeze of message registry, exact bytes, key purpose, error/replay model and downgrade semantics; CI passing does **not** constitute approval.
- [x] **PR02 isolated crypto PoC (2026-10-27):** add [XSP_V2_CRYPTO_POC.md](XSP_V2_CRYPTO_POC.md), public demo-only key/signature digest vectors, standard Go 1.27.3 `crypto/mldsa` tests and Rust/OpenSSL 3.5 EVP tests. Both require Ed25519 **AND** ML-DSA-65 and reject tampering/missing signatures; independent OpenSSL deterministic signature digests match Go's known fixture. Separate CI workflows keep production Go 1.23/Node and Nexus backend unchanged.
- [x] **PR02 interoperability:** Go 1.27.3 and Rust/OpenSSL 3.5 directly exchanged signed Ed25519 **AND** ML-DSA-65 records in both directions in isolated Nexus Crypto CI (including negative tests for missing/corrupt signatures, altered payload and substituted keys). Public deterministic key/signature test vectors also match.
- [x] **PR07 lab TLS spike (2026-10-27):** [XSP_V2_TLS_PROBE.md](XSP_V2_TLS_PROBE.md) documents an isolated Go 1.27.3 strict X25519MLKEM768 full-handshake verifier and separate OpenSSL 3.5 test server. Both verify the observed group, TLS 1.3, trusted certificate/hostname and decline classical-only TLS 1.3, TLS 1.2, invalid certificates and resumption. [Dedicated TLS CI](https://github.com/TriplexCorp/XMesh-Nexus/actions/workflows/xsp-hybrid-tls.yml) covers real handshakes. **This is laboratory evidence, not a live Nexus deployment.**
- [ ] **PR02/PR07 acceptance beyond laboratory:** full main CI after the latest code changes; external FIPS 204 KATs, fuzzing, independent security review, actual proxy/CDN→origin TLS audit, real canary TLS negotiation and controlled no-downgrade rollout. **No production XSP-v2 authentication or strict mode yet.**
- [ ] Rehearse migration on disposable nodes; v1 traffic must continue unchanged until explicit per-node activation. **The XSP-v2 production control plane remains NOT IMPLEMENTED / NOT VERIFIED.**

**Full engineering blueprint:** [Hybrid Post-Quantum Security — XSP-v2 complete implementation plan](HYBRID_POST_QUANTUM_SECURITY_IMPLEMENTATION_PLAN.md) (20 sections: architecture, source-file map, wire format, identity, TLS, migration, PRs, tests, acceptance gates). Follow the detailed plan as the implementation source of truth; the checklist below is a short milestone overview.

**Goal:** protect authenticity/integrity of node policies, commands and telemetry against future quantum-capable forgery, and protect confidentiality of node↔panel control traffic against *harvest now, decrypt later* attacks. These are **separate** security properties; embedding a PQ key inside an Ed25519 key is not a valid design.

### Required architecture

- [ ] Inventory the entire existing trust boundary: node enrollment/bootstrap, Ed25519 identity, signed desired-config/policy, telemetry, restart/update commands and ACKs, local offline-policy cache, HTTPS client/server, key rotation and recovery. Write a threat model and compatibility matrix before changing the wire format.
- [ ] Design a **versioned, domain-separated hybrid signature envelope**: existing Ed25519 **AND** standardized **ML-DSA-65** (FIPS 204), each signing the same deterministic/canonical message bytes with explicit protocol version, message type, node identity, issuer/key IDs, revision/nonce, issuance/expiry and payload digest. Both signatures must verify; neither is an optional fallback after migration. Never concatenate keys and call it a hybrid signature.
- [ ] Cover **all security-sensitive signed message directions** (panel→node policies/commands and node→panel authenticated telemetry/ACKs) or document explicit exceptions. Preserve anti-replay, authorization, freshness and revision checks. Keep signing and verification semantics identical across Rust and Go implementations with shared golden test vectors.
- [ ] Design **downgrade-resistant enrollment and migration**: versioned capabilities, authenticated trust anchors, pinned minimum accepted security suite per node, dual-key enrollment, controlled rollout and explicit operator-mediated recovery. After a node is upgraded, missing/invalid PQ signatures or old-only messages must be rejected; do not silently downgrade to Ed25519-only. Keep existing nodes working during a deliberately bounded, audited migration.
- [x] **Lab-only hybrid TLS probe:** Go 1.27.3 + OpenSSL 3.5+ confirmed an actual X25519MLKEM768 handshake and fail-closed rejection of TLS 1.2 / X25519-only / invalid certificate or hostname. [Details](XSP_V2_TLS_PROBE.md).
- [ ] **Deploy hybrid TLS 1.3 key agreement** on an approved, isolated node-only HTTPS terminator, audit all CDN/LB/origin hops and record actual negotiated group with authenticated hostname and certificate, with explicit migration and recovery policy. **Do not enable strict mode on the current public Nginx TLSv1.2/TLSv1.3 site.** PQ signatures do not encrypt the channel and this does not change Xray/Reality data plane.
- [ ] Secure lifecycle for Ed25519 and ML-DSA keys: independent generation and storage, least-privilege permissions, key IDs, rotation, backup/restore, revocation, compromise response and disaster recovery. Never log/export private keys; no home-grown cryptographic primitives or unaudited bespoke TLS.
- [ ] Test malformed/missing/altered signatures, cross-protocol replay, duplicate/reordered messages, expired policies, key substitution, protocol downgrade, revision rollback, loss of connectivity, agent/Xray restart, stale offline cache, mixed-version deployments and TLS group negotiation; fuzz parsers and run Rust/Go cross-implementation vectors.
- [ ] Measure CPU, memory, message size, TLS handshake cost, node bootstrap latency and impact on policy/command application at realistic node counts; ensure secure limits on payload size and resource consumption.
- [ ] Deliver operator documentation, explicit rollout/rollback boundaries, updated README/security docs, CI checks in **both** repositories and live-node verification with recorded commit/build/observed outcomes.

**Acceptance / exit:** real Nexus↔Node traffic demonstrably negotiates hybrid TLS; every upgraded security-critical message requires **both** valid signatures and cannot be downgraded; verified rotation/recovery and mixed-version migration; automated negative/fault tests pass in both repositories; live-node deployment proves policy enforcement and telemetry still work. Do **not** mark complete based on design notes or library installation alone.

---

## 2026-10-25 — Node fleet toolbar and button polish (OPEN UI defects)

**Status:** [ ] OPEN / operator screenshots reproduced conceptually, **browser verification not complete**. This is a UI refinement backlog, **not** a replacement for the top P0 post-quantum security priority. See [README — UI: фильтры нод и согласованность кнопок](../README.md#ui-фильтры-нод-и-согласованность-кнопок--открытые-замечания-25-октября-2026).

### Implementation checkpoint (2026-10-25)

Source-level changes now present in `main`: the fleet Reset control uses a single explicit SVG and suppresses the global icon decorator; pagination buttons also suppress decoration and are hidden for `1 / 1`; Reset's SVG receives click-triggered rotation via Web Animations API; the Users refresh button has an explicit global `--ui-control-radius` override. Source assertions exist in `scripts/check-node-explorer.js`. **Do not mark the checklist done yet:** the operator reported that the Reset animation still does not behave as expected, and no actual browser/e2e acceptance has been recorded. Next: compare the real Users Refresh interaction against Reset, choose a single shared animation primitive, test hover/click/disabled/reduced-motion at multiple scales, and save real screenshots and CI evidence.

### Outstanding work

- [ ] **Node pagination icons:** eliminate duplicate arrow/SVG caused by overlapping explicit markup and shared `decorateButtonIcons()`; guarantee exactly one icon per arrow button and no extra decorator on pagination controls.
- [ ] **Single-page pagination states:** redesign disabled/empty pagination at 1/1 so it clearly communicates “only one page” rather than appearing broken or barely visible; retain accessible labels, adequate contrast, visible keyboard focus and non-clickable disabled buttons. Verify both ends and multiple pages.
- [ ] **Reset button icons:** remove duplicate refresh icon in fleet filter `data-node-search-clear`; reuse the established user-section Refresh action visual language, SVG component and behavior rather than inventing a competing animation.
- [ ] **Reset animation and alignment:** fix the current unexpected hover animation (rotate only the intended SVG when appropriate; reliable busy/confirmation behavior); match height/baseline with filter fields and dropdowns at responsive breakpoints. Respect `prefers-reduced-motion`.
- [ ] **User Refresh button radius:** eliminate fixed corner-radius overrides; use global `--ui-control-radius` from Appearance settings consistently in the user view and any relevant modal.
- [ ] **Design-system regression checks:** add behavior-focused tests for exactly one SVG, disabled pagination UX, shared radius under changed UI appearance settings and genuine reset/refresh interactions, not solely substring assertions.
- [ ] **Browser acceptance:** validate Chromium/Firefox, light/dark accents, 90–200% UI scale, compact/standard/spacious grid, mobile/desktop widths, filter clearing and a test list of 1, 2, 48, 49 and 1000+ nodes. Record screenshots, CI run, exact revision and outcome before marking done.

**Exit:** no duplicate icons; pagination is intentional and legible at 1/1; reset has one consistent SVG and matches existing Refresh animation; buttons align and inherit global corner radius; browser/e2e evidence confirms changes.

---

## 2026-10-25 — Statistics and user-workspace UX delivery

### Implemented in source (not yet production-accepted)

- [x] Correct single-element `$()` versus collection `$$()` iteration mistakes affecting Statistics rendering and user-statistics controls.
- [x] Add a regression guard for these selector patterns; cache-bust updated frontend scripts and styles.
- [x] Redesign the user analytics dialog with a horizontal layout, full-app blurred backdrop, header actions, traffic-source/node insights, chart and measurements.
- [x] Keep analytics dimensions stable across History, Inbound/Nodes and Observations tabs; when launched from the user editor, measure that editor and match its dimensions within viewport constraints.
- [x] Provide one animated refresh action, a circular close control, and scroll handling intended to prevent stacked vertical scrollbars.
- [x] Add branded period selectors, body-level dropdown menus above tables, keyboard handling and theme scrollbar styling.
- [x] Show the numeric internal user ID in the user editor; link its **Detailed statistics** action to user-specific analytics and return to the originating route on close.
- [x] Rename user traffic reset to **Reset traffic** and route it through the built-in confirmation dialog before API mutation.
- [x] Move the XRAY STUDIO configuration constructor overlay above the app shell so blur covers the entire screen.
- [x] Update source-level regression checks (`scripts/check-statistics-feedback.js`, `scripts/check-xray-studio-selectors.js`).

### Subsequent UI refinements — delivered in source

- [x] Automatically refresh raw observations when node, inbound, user or time range changes; remove the redundant manual observations button.
- [x] Filter the Inbound/Nodes breakdown tables using the selected node and inbound, without adding independent counters together.
- [x] Replace the short fixed node palette with a session-stable, maximin OKLab candidate selection of **pastel** colours; use a consistent node colour across per-node rings, aggregate node distribution and analytics bars.
- [x] Distinguish semantic traffic-direction colours from node colours: Upload (teal) and Download (violet); correct the aggregate ring legend to identify nodes.
- [x] Introduce application-wide branded scrollbar styling in the main stylesheet and XRAY STUDIO stylesheet, including 8 px rails and attempted 7 px end insets on supported engines; preserve existing overflow containers.

### Chart scaling — root-cause fix implemented, browser acceptance pending (2026-10-25)

**Root cause:** a fixed `1000 × 340` Statistics or `960 × 292` Dashboard SVG `viewBox` with CSS `width:100%; height:auto` caused uniform scaling of plot height, text, markers and hit areas as card width grew. Earlier `72rem`/ `100rem` width caps hid this at the cost of excessive unused card width; removing caps alone exposed the same underlying defect.

- [x] Remove chart-specific rem-based width caps; both charts fill their parent cards, whose outer workspace is constrained by the Appearance setting `--panel-content-max` (720–3000 px).
- [x] Decouple CSS height from width: Statistics `21.25rem`, Dashboard `18.25rem`; mobile <=700 px: `17rem` and `16rem`. The global UI font scale still affects rem-based height.
- [x] Adjust SVG **horizontal** coordinates and `viewBox` width with `ResizeObserver` against the actual rendered aspect ratio; do not uniformly enlarge axis text or plot markers when card width changes.
- [x] Preserve existing Statistics point selection across SVG replacement where the selected node remains present. Leave the modal user-history chart's independent bounded geometry intact.
- [x] Bust frontend CSS/JS cache versions in `index.html`; document behavior and verification requirements in README.
- [x] Update the stale `scripts/check-statistics-feedback.js` source contract to the new parameterized SVG width and remove the old `72rem` expectation.
- [x] Add `scripts/test-traffic-chart-geometry.js`, executing the Statistics/Dashboard renderers at 720/1920 logical widths and a stubbed `ResizeObserver` reflow, then make it a required Backend CI step.
- [x] Execute isolated JavaScript checks of both real SVG renderers and the observer callback: matching viewBoxes, stable Y coordinates, expanding X coordinates, and a single redraw for a width change. These are not full-browser tests.
- [x] Execute the **current committed** `scripts/test-traffic-chart-geometry.js` and `scripts/check-statistics-feedback.js` logic against current `main` source in an isolated JavaScript runtime (2026-10-25). Both passed after updating three stale assertions for period-leaders, tab iteration, and the user analytics return-context structure (commit `66678d0`). The geometry test also exercised a stubbed `ResizeObserver`: one reflow after width change and no extra reflow without a change. This is not a browser run, native Node.js 24 execution, or proof of green GitHub Actions.
- [ ] Run committed-source syntax, frontend regression, and strict CI checks; record exact commit and run results. A source change is **not** a tested feature.
- [ ] Browser-test content width at 720, 1280, 1920 and 3000 px and UI scale at 90%, 100%, 150% and 200% (including combinations), without reload and after page navigation.
- [ ] Verify desktop, ultrawide, laptop and mobile layout: legible axes, stable plot height, no clipping or horizontal overflow, no oversized points or hit regions.
- [ ] Verify click, keyboard selection, interval drill-down, selected-point preservation, 1h/24h and other available Statistics periods, live refresh, empty/error state and data fidelity on a disposable deployment.
- [ ] Verify switching settings while mounted produces no stale SVG coordinates or repeated ResizeObserver loops; inspect for layout/performance regressions.

**Acceptance criterion:** at the same UI scale, the graph may grow horizontally as allowed content width grows, but must **not** grow proportionally in height or uniformly magnify text/markers. Production/browser verification is still outstanding; do not mark the chart scaling task accepted based on source alone.

### Verification and follow-up (open)

- [ ] Execute browser-level smoke/e2e tests at multiple screen sizes and global UI scale settings: modal bounds, stable tabs, scrollbars, table overflow, dropdown positioning and accessibility/focus.
- [ ] Compare node colours across user editor and detailed analytics after repeated refreshes, node additions and full reloads; check pastel contrast and perceptual collisions as node counts increase.
- [ ] Verify scrollbar insets (including top/bottom corners), thumb styling and lack of duplicate scroll regions in Chromium and Firefox, as well as all major dialogs and XRAY STUDIO.
- [ ] Verify **User card → Detailed statistics → close** returns to Users reliably for close button, Escape and backdrop, without losing the original context.
- [ ] Validate confirmation cancellation, exactly one successful traffic reset, API failure reporting and current displayed counters on a disposable environment.
- [ ] Validate XRAY STUDIO constructor full-viewport backdrop, close/escape behaviors and cleanup when navigating away.
- [ ] Verify served frontend asset versions through the production reverse proxy after deployment; confirm no stale browser cache.
- [ ] Add runtime interaction tests beyond source-string assertions and record CI run, commit and deploy evidence.

**Status:** the checked items above indicate code changes saved in the repository, **not** browser-verified or production-certified behavior. They do not complete Statistics 2.0 or HA/security acceptance criteria.

## Working rules

- Prefer correctness and reproducibility over adding UI features.
- Keep `cargo test`, `cargo clippy -D warnings -D clippy::pedantic -D clippy::nursery -F unsafe-code`, and Rust formatting checks enforced, not silently disabled.
- Test committed sources; CI must never repair code via `cargo fmt` before evaluating it.
- Distinguish **saved desired state**, **signed policy delivered**, **node revision applied**, and **traffic actually enforced**.
- Record the commit, CI run, reproducible failure scenario and verification result for every milestone.
- Do not call a stage complete solely because README says it is implemented.

## Progress snapshot — 2026-10-25

**Evidence level:** PR-level CI, not production-node certification. [PR #8](https://github.com/TriplexCorp/XMesh-Nexus/pull/8) at commit `43c8693` passed [Backend CI run #2414](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40151051399) and [User Presence Integrity run #55](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40151051415). PR #8 was **open and unmerged** when this snapshot was prepared. These results do **not** establish a green `main` run or completed P0 exit criteria.

| Workstream | Implemented / verified so far | Still required for stage exit |
| --- | --- | --- |
| **P0 CI / releases** | Non-mutating rustfmt gate, all-target Rust tests, strict pedantic/nursery Clippy, Node.js checks, Docker build and disposable API integration pass in PR CI | Green baseline after merge on `main`, branch protection evidence, release / rollback drill |
| **P0 node enforcement** | Signed Ed25519 node policy/telemetry, signed command delivery, replay rejection and offline enforcement logic documented; API integration exercises signatures and command acknowledgement. **Operator reports a live manual test:** disabling a user stopped real Xray traffic after ~10 s (2026-10-25) | Independently reproducible/automated traffic-denial tests (new and existing flows), timing measurements, disconnect/reconnect and revision-conflict fault injection, independently verified applied revision |
| **P0 telemetry** | Per-user/per-inbound cumulative counters and signed ingestion implemented; CI includes replay, presence and accounting checks | Full delayed/out-of-order/reset/restart matrix and verified 45-second expiration under faults; stale-data alerts |
| **P1 compatibility** | Server/client JSON generation and endpoint selection logic with test coverage for supported paths | Real client/Xray compatibility matrix, transport/security fixtures and verified exports |
| **P1 security / operations** | Owner/admin/viewer isolation, MFA/session revocation and Ed25519 enrollment covered by API integration; active-host creation exercised with valid profile+node binding | Exhaustive endpoint × role matrix, threat model, scans, off-host restore of database and cryptographic keys |
| **P2 scale / HA** | Single-instance Compose architecture and existing operator UI | Benchmarks, failover tests, incremental UI modularization and UX measurements |

**Recent CI regression corrections (PR #8):** Clippy failures fixed without relaxing lint flags; oversized Rust functions refactored rather than suppressed; node integration fixtures updated to supply required `addr`, assert the complete restart-command schema, handle non-JSON extractor rejections, and expect the current fixed agent-update target `control-v4.3.2`. Authentication integration now checks both invalid active-host rejection and creation of a *valid, fully bound active host*, preserving positive authorization coverage (`43c8693`). These are CI test results, **not** real-node enforcement evidence.

**Verification gaps:** GitHub branch-protection settings could not be inspected via the available integration (403). Production-node outcomes, off-host restore and HA have not been demonstrated in this roadmap. Leave their acceptance checkboxes unchecked until evidence exists.

## 1 — P0: CI and release reliability

- [x] Replace mutating `cargo fmt` CI step with `cargo fmt --all -- --check`. Commit: `f2add5a`.
- [x] Establish a passing baseline on `main` for Node.js checks, Rust formatting, all-target tests, strict Clippy, Docker build and API integration: [Backend CI #40304117546](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40304117546), `150978cc`, completed successfully on 2026-10-26. Required-check branch protection and release/rollback evidence remain separate open tasks.
- [ ] Replace brittle source-regex checks where possible with observable, behavior-based tests; retain security-contract checks that express real invariants.
  - [x] IP rotation UI validation: execute the real validation helpers against valid, duplicate, invalid, insufficient and oversized pools instead of requiring an exact source layout (`a676ac7`).
  - [x] Live-node status contract: execute the actual state function for healthy, stale, disabled, stopped Xray/router and unknown states (`db52057`).
  - [x] Xray version rendering contract: assert `textContent` sink and guard against directly inserting untrusted version via `innerHTML` (`f66bdd3`).
  - [ ] Extend this approach to other UI source-contract tests and integration behaviors.
- [ ] Ensure required branch protection prevents merging when those checks fail. **Not verified:** protection API returned 403; inspect settings with authorized access.
- [ ] Document reproducible release / rollback and evidence from a clean checkout.

**Exit:** green main-branch CI now documented; still require reproducible release/rollback drill and enforced branch protection. No stage should mutate tracked source files.

## 2 — P0: Verified enforcement on nodes

- [x] **User-confirmed live-node manual test (2026-10-25):** disabling an active user in Nexus causes actual VPN traffic through Xray to stop after approximately **10 seconds**. The operator personally tested traffic cessation, not just the UI status. This is **user-reported operational evidence**, not an independently reproduced or automated test; the precise internal stage timings were not measured.
- [ ] **Automate and reproduce** active-user disablement end-to-end: panel write → desired policy → node apply → Xray denies new connections **and** terminates/blocks existing traffic; capture before/after traffic evidence, revision/ACK and timing distribution across repeated runs.
- [ ] Verify expiry and exhausted quotas on real node(s), not just UI or generated JSON.
- [ ] Simulate control-plane disconnection, node reconnect, revision conflicts, retries and replay attempts.
- [ ] Capture and report desired vs actually applied revision; do not claim success from an accepted command.

**Exit:** repeatable integration evidence of enforcement, including disconnected node cases and documented offline budget limits.

## 3 — P0: Trustworthy telemetry and accounting

- [ ] Test delayed/out-of-order/duplicate signed telemetry, counter resets and Xray restarts.
- [ ] Verify cumulative accounting never double-counts and unavailable counters are not represented as zero usage.
- [ ] Confirm 45-second presence expiry under delayed and missing heartbeats.
- [ ] Add freshness/error indicators and alerts for stale node and user metrics.

**Exit:** a test matrix with failure injection plus trustworthy usage and presence under expected faults.

## 4 — P1: Subscription/client compatibility

- [ ] Build a matrix for VLESS, VMess, Trojan, Shadowsocks/SS2022, Hysteria2 and MASQUE across supported transports and security.
- [ ] Extend the matrix to each compatible TCP/UDP/QUIC FinalMask layer, server/client symmetry, layer ordering, unsupported combinations and exact installed Xray/client versions.
- [ ] Validate outbound JSON against real Xray-core and supported client versions; reject unsafe server-only fields.
- [ ] Test host, node, direct IP, CDN and ambiguous endpoint handling plus IP rotation.
- [ ] Decide on URI/base64/Clash/Sing-box formats based on verified user need; do not advertise formats not implemented.

**Exit:** published compatibility matrix with fixtures and documented pass/fail results on actual clients.

## 5 — P1: Security and operations

- [ ] Complete a denial-by-default endpoint × role matrix for owner/admin/viewer and test all disallowed operations.
- [ ] Audit secrets, sessions, MFA, enrollment, signing-key rotation and recovery, including threat-model review.
- [ ] Add dependency and container vulnerability scanning; document actionable findings and exceptions.
- [ ] Prove off-host restore of PostgreSQL *and* TOTP/subscription encryption and node-policy signing keys.
- [ ] Document alerts and troubleshooting for failures of DB, Redis, nodes and panel.

**Exit:** security test evidence, restored disposable deployment, recovery runbook, documented residual risks.

## 6 — P2: Scale, HA and operator UX

- [ ] Load-test node count, user count, subscription refresh and metrics ingestion.
- [ ] Design and test panel/database/Redis failover and recovery before claiming HA support.
- [ ] Modularize high-risk regions of `app.js` incrementally with behavioral regression tests.
- [ ] Measure and reduce steps to accomplish core administration tasks.
- [ ] Validate the FinalMask 84rem modal and disabled-card UX at desktop/mobile sizes, zoom, keyboard focus, overflow and language variants in a real browser; keep a screenshot-based regression record.

**Exit:** reproducible capacity limits, verified failure handling and measurable UX improvements.

## 7 — P1: Statistics 2.0 — full observability and operator analytics (committed scope)

**User mandate (2026-10-25):** Deliver the **entire** statistics upgrade, not just a telemetry-freshness patch or a visual mockup. This is an end-to-end product requirement across Rust APIs, TimescaleDB/PostgreSQL, authenticated UI and real signed Xray node telemetry. **Overall status: IN PROGRESS — NOT COMPLETE.** A green CI run for one increment must never be described as completion of this section.

**Already merged into `main`:** [PR #10](https://github.com/TriplexCorp/XMesh-Nexus/pull/10), commit [`a9138eb`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a9138ebcd6eb897e4cef28a8f20f9626da875b79). Existing Statistics UI now distinguishes fresh/delayed/stale/invalid/never-received telemetry, exposes Xray user-counter status, identifies nodes needing attention, separates node interface RX/TX from cumulative per-user usage, and offers 1h/24h/7d/30d network-traffic views. This is **partial delivery**, not Statistics 2.0 completion. It does not prove end-to-end accounting correctness or provide all historical analytics.

### Implementation update — 2026-10-25 (after PR #10)

**Delivered in `main` (code present; not a Statistics 2.0 stage-exit certification):**

- Network traffic selection supports **Live, 5m, 15m, 30m, 1h, 3h, 6h, 12h, 24h, 7d, 30d** via the authenticated Rust/TimescaleDB API.
- Statistics UI refresh is decoupled from expensive reads: 1-second visual heartbeat, 5-second Live traffic polling, 15-second overview/system cache, 30-second historical polling; refresh pauses for hidden tabs and user-initiated reload bypasses the cache. **These are configured cadences, not proven production throughput or true 1-second telemetry sampling.**
- Graph RX/TX uses a combined, accessible SVG with visible colored dots, selected-point ring, axes, grid, timestamps, units in **bits per second**, hover titles and no invented intermediate samples. Readouts distinguish interface speeds from accumulated Xray usage.
- Clicking a real point opens an interval drill-down using `GET /api/v1/metrics/traffic/bucket-detail`, backed by bounded per-node TimescaleDB sample aggregation. It reports participating nodes, RX/TX, sample counts, last sample and the leading RX contributor. Detail access is interactive (mouse/keyboard); missing samples remain unavailable rather than fabricated zeros. UI selection and click-target regressions have been corrected.
- Existing UI shows freshness categories, last actual TimescaleDB bucket age, signed user-counter status and affected nodes. UI source-contract tests cover the new interaction and presentation.

**Outstanding before acceptance:** CI/production runtime evidence for the latest direct-to-`main` changes, real browser keyboard/screen-reader test, complete timeout/error and large-node behavior for bucket detail, aggregate-versus-detail parity, correct SQL/query-plan performance under load, actual per-user/per-inbound time series, alerting, incident history, export and full Statistics 2.0 navigation. The drill-down is **per-node interface network traffic**, not external destination attribution or individual-user Xray usage. Do not infer destinations from RX/TX alone.

**Repository workflow:** Following the owner's instruction, update `main` directly; do not create extra branches without explicit authorization. Preserve security gates and strict CI.

### Phase A — P0: Data integrity and trustworthy measurements

- [ ] Define and test one documented freshness/quality contract across node, user, inbound and aggregate endpoints: timestamps, provenance, availability, expected coverage, clock skew, and `fresh`/`delayed`/`stale`/`unavailable`/`never_received` states.
- [ ] Never show missing counters, absent samples, failed StatsService polling, or disconnected nodes as **zero usage**. Genuine zero values require a verified observation; missing time buckets remain gaps (`null`).
- [ ] Display network-interface RX/TX, verified Xray per-user/per-inbound traffic, and panel-container performance **as separate metric families**; do not add unrelated or overlapping counters.
- [ ] Exercise duplicate, out-of-order, delayed and replayed signed telemetry, counter resets, agent/Xray restarts, partial coverage and disconnect/reconnect. Prove cumulative totals are monotonic without double-counting or fabricated consumption.
- [ ] Enforce owner/admin/viewer data-access restrictions, avoid disclosing secrets/internal host details, and test authorization for every new endpoint and export.
- [ ] Add behavior-based Rust/API/frontend regression tests for missing/stale/partial data, time-boundary behavior, realistic observations and incorrect client-side assumptions.

### Phase B — P1: Redesigned Statistics Overview (real implementation, not mockup)

- [ ] Deliver a coherent, responsive, accessible Statistics UI (desktop/mobile) with **Overview, Traffic, Nodes and Users** views, honoring existing theme and RU/EN localization.
- [ ] Display actionable KPI cards: online/total users, healthy/total nodes, data coverage/freshness and **verified** user traffic for a clearly labelled period; never substitute network-interface traffic for user traffic.
- [ ] Implement complete, readable historical visualizations with explicit units, date/time range, sampling resolution, gaps, legends, last verified sample time, loading/error/empty states and bounded refresh.
- [ ] Support 1h, 24h, 7d, 30d and appropriate bounded custom date ranges; allow period-over-period comparisons with matching windows.
- [ ] Add sortable/filterable node health diagnostics (CPU/steal, RAM, disk, RX/TX, sessions, signed heartbeat, agent/Xray version, policy desired/delivered/applied status where verifiable) with explanations for missing or degraded data.
- [ ] Keep UI refresh and API polling efficient, cancellable and non-duplicative; preserve security boundaries and regression tests.

**Deep Analytics implementation note (2026-10-25):** `GET /api/v1/statistics/leaders` and the Statistics Top-10 tables are now present in `main`, using `user_node_traffic_totals` and independently `user_inbound_traffic_totals`. They show **verified cumulative totals since the first accepted baseline**, not traffic over the selected graph period. Viewer access is denied; owner/admin can inspect ranks. **An accepted-delta TimescaleDB journal has since been added in source (see below); historical charts and period-specific Top-10 still require UI/API implementation, strict tests, and deployment verification.** Await strict CI and live API verification before claiming the slice accepted.

### Mandatory requirement — per-user × inbound forensic drill-down (2026-10-25)

**User requirement, verbatim:** «ты сможешь контрить буквально по инбаунду статистику конкретного юзера». This is **required product scope**, not an optional chart.

For **any selected user**, an authorized operator must be able to inspect **each inbound individually**, with further breakdown by **node and time bucket**:

- Verified **uplink, downlink and total bytes** for the exact `user_id × inbound_tag × node_id` combination, including the contributing sample count, latest valid observation time, collection freshness and source.
- Historic breakdown by selectable intervals (1h, 24h, 7d, 30d and bounded custom period), with correct time buckets and explicit missing-data gaps. Provide separate time-series lines for each inbound and the ability to expand **user → inbound → node → interval → supporting observations**.
- Inbound Top-10 can be filtered to the **selected user's traffic**, not just a global inbound ranking; filtering by node and direction must not change accounting semantics.
- A click-through UI from a user or inbound entry should show a clear ledger-like explanation of what was measured, when, which node reported it, whether the Xray StatsService counter was verified, and what is unknown.
- Ingestion must persist accepted monotonic **counter deltas** in a durable, idempotent, append-only historical ledger. Deduplicate signed retries; handle out-of-order samples, counter resets and agent/Xray restarts without double-counting. Existing cumulative tables are **not** sufficient to reconstruct past intervals.
- **Never add user-global and user-inbound counters together** (two independent views can overlap); never infer destination IP, domain, application, VPN protocol or actual routing solely from the inbound tag or host network-interface RX/TX. Show unavailable dimensions as unknown.
- Tests must cover two users sharing one inbound, one user across multiple inbounds and nodes, absent Xray StatsService data, resets/replays, conservation against accepted cumulative deltas, RBAC, time boundaries and high-cardinality query performance.

**Done means:** an operator can pick user U, inbound I and node N for a real interval and see reproducible, independently supported Uplink/Downlink values with evidence and freshness, not a mockup or totals backfilled into fake history. **Status: NOT YET IMPLEMENTED.** Present `user_inbound_traffic_totals` and the per-user traffic endpoint expose cumulative snapshots only.

**Historical ledger increment (2026-10-25, code pushed to `main`; deployment and CI not yet verified):** Migration `0028_verified_traffic_deltas.sql` adds a Timescale hypertable for independently sourced `user` and `inbound` positive deltas. Accepted signed telemetry writes those deltas **before** cumulative-counter UPSERTs in the same per-node advisory-locked transaction. Baselines, replayed/stale source timestamps and reset counters contribute no new historical usage. `GET /api/v1/users/{id}/traffic/history?range=24h&inboundTag=...&nodeId=...` provides filtered rows bucketed over 1h/24h/7d/30d, bounded at 5000 rows. It returns source type, provenance, samples and truncation; viewing detailed personal traffic is denied to `viewer`. Existing totals cannot be backfilled faithfully: history begins only after deploying this migration and ingestion code. **Remaining:** live migration/integration evidence, browser drill-down, period Top-10, missing-data quality display, and load tests. Do not tick the phase complete yet.

**Historical graph increment (2026-10-25):** The Statistics Xray history inspector now renders an Upload/Download SVG using observed rows from `/api/v1/users/{id}/traffic/history`, grouped by returned time bucket and respecting user/inbound/node filters. Units are cumulative bytes **within each observed time bucket**, not interface Mbps; no absent bucket is introduced as zero. Connecting lines are visual aids and do not imply interpolation of missing telemetry. Pending: real-browser, integration and CI verification, coverage/freshness markers, and period-specific Top-10.

**Current feature inventory (2026-10-25):** The source now includes the Timescale accepted-delta ledger (`0028_verified_traffic_deltas.sql`), transactional user/inbound ingestion, an authorized per-user history endpoint, a filterable history inspector, and an observed-bucket Upload/Download SVG graph. The UI offers 1h/24h/7d/30d periods and navigates from a user in the lifetime Top-10 to that user's history. Source-level checks were added. **Do not interpret this as verification of a production migration or end-to-end accuracy.** No per-period Top-10 exists yet; lifetime Top-10 remains separate. Next acceptance requires migration and strict CI, real signed-agent integration (replay/reset/dual-inbound/node cases), browser interaction tests, missing-data coverage, retention and query-plan validation.

**Delivery checklist for the next slice (status 2026-10-25):**
- [x] Source code: Timescale hypertable migration for accepted user/inbound deltas, transactional ingestion under the signed node's serialized lock, and authenticated user/node/inbound history API.
- [ ] Confirm the migration runs correctly on PostgreSQL 18 + TimescaleDB and strict CI passes on the committed source.
- [ ] Integration-test monotonic increases, baseline-only snapshots, reset/restart, duplicate/replayed signed samples, two inbounds on one user, and absence of independent-counter double counting.
- [ ] Verify the new user → inbound → node → bucket history UI in a real browser (filters and missing-data messaging are implemented in source; partial coverage and accessibility remain to be validated).
- [ ] Add time-bounded period Top-10 (not lifetime counts), paging/retention policy, representative-volume query plans and permission tests.

**Period rankings and raw drill-down increment (2026-10-25, implementation in `main`):** `GET /api/v1/statistics/period-leaders?range=1h|24h|7d|30d` ranks users, inbounds, and nodes by accepted Xray deltas from `verified_traffic_deltas`. User/node rankings use the `user` counter family; inbound rankings use independent `inbound` counters (never summed across families). The Statistics page can switch ranking periods and open a user's filtered history. `GET /api/v1/users/{id}/traffic/observations` returns the latest **up to 500** individually accepted delta entries under user/inbound/node/range filters, with truncation status; the UI exposes the evidence table. These are signed-ingest accepted increments, not packet captures, IP destinations, or route-level attribution. **Source changes are not accepted as complete** without green strict CI, live migration and signed-node integration tests, browser verification, and pagination/coverage work. A Top-10 derived from the new journal covers only telemetry ingested after its deployment.

**Statistics user-card UX increment (2026-10-25):** Selecting a user in the period Top-10, or entering any valid user ID, now opens a dedicated *Statistics-only* full-width intelligence dialog. It contains cumulative verified counters, history chart and filters, independent inbound/node breakdown and individual accepted observations in separate tabs; responsive styling and close/Escape controls are provided. The existing user editing card and its actions are unchanged. This is source-level delivery pending live browser and accessibility verification (including focus management), backend validation and strict CI. Future work: discover users by name, improve freshness/coverage evidence and make observation-level pagination dependable.

### Phase C — P1: Deep TimescaleDB, user and inbound analytics

- [ ] Build genuine **time-bucketed Xray user-traffic** history (not merely lifetime totals), with safe filters for user, node, inbound, squad, time range and source reliability; preserve accounting direction/units.
- [ ] Provide Top-10 users/nodes/inbounds by **verified consumption**, trends and historical comparisons, plus usage against limits, impending expiry and quota-risk indicators.
- [ ] Implement drill-down from overview to node → inbound → user, including clearly identified partial/stale data and count of contributing nodes/samples.
- [ ] Replace per-node N+1 statistics queries with bounded set-based queries; add safe SQL paging, indexes and query-plan/performance evidence.
- [ ] Evaluate continuous aggregates, retention/compression policy and backfill rules for TimescaleDB with production-safe migrations, realistic-volume tests, and a documented capacity envelope.
- [ ] Add secure, permission-aware **CSV and JSON export** of selected measurements with time bounds, provenance, sample quality and controlled result sizes.

### Phase D — P1: Monitoring, anomaly detection and incident response

- [ ] Detect and signal stale/offline nodes, missing Xray StatsService, collection failures, anomalous traffic changes, CPU steal/pressure, disk/memory saturation and impending limits using explicit, configurable thresholds.
- [ ] Provide an incident/alert history: onset, last observation, duration, impacted nodes/users where authorized, status, resolution, and traceable evidence; avoid duplicate notification storms.
- [ ] Add in-panel alerts and actionable diagnosis; document supported external notification channels rather than assuming unimplemented integrations.
- [ ] Test notification deduplication, recovery, noisy telemetry, missing-data failure modes, restricted access and operational runbooks.

**Acceptance / definition of done:** Every checkbox in Phases A–D is implemented with production code and behavioral tests, verified in strict CI on committed sources and, for traffic enforcement/accounting/failure behavior, on disposable real Xray nodes. Report verified data coverage and performance under representative node/user loads; document data retention, permissions, deployment/rollback, and known limitations. **Do not mark Statistics 2.0 complete merely because PR #10 passed or 7d/30d periods became available.**

**Delivery workflow:** Per user instruction, do **not create additional branches** unless explicitly authorized. Changes should target `main` while preserving formatting, all-target Rust tests, strict Clippy, security checks and integration gates. Record each delivered slice and its CI evidence here; check off only verified acceptance criteria.

## Current architecture and limitations

XMesh Nexus is a Rust/Axum control plane with PostgreSQL/TimescaleDB and Redis, using separate XMesh-Node runtime on VPN nodes. Signed Ed25519 node telemetry and policies are implemented. Native Xray JSON generation contains code paths for VLESS, VMess, Trojan, Shadowsocks/SS2022, Hysteria2 and MASQUE, but end-to-end client compatibility is not assumed. The default Compose topology is a single panel, database and Redis; HA is **not** verified. Offline quota enforcement is conservative, not a globally exact quota across disconnected nodes.

For current functionality and operating instructions see [README](../README.md), [autonomous node design](AUTONOMOUS_NODES.md) and [update/telemetry guide](PANEL_UPDATE_AND_TELEMETRY.md).

- 2026-10-26: XMesh-Node router/Xray local-port reconciliation (`10443 → 5000`) fixed in Node main; control agent target bumped to `control-v4.3.3` in Nexus main. Node CI passed; live VPS acceptance and Nexus CI still required. Panel **Update Agent** uses signed commands; an offline node may not receive the update until control-plane connectivity is restored.
