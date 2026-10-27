# XMesh Hybrid Post-Quantum Security — полный план внедрения XSP-v2

> **Статус:** PLANNED / NOT IMPLEMENTED / NOT VERIFIED  
> **Приоритет:** P0 / задача №1 перед новыми функциями.  
> **Дата планирования:** 2026-10-25.  
> **Репозитории:** [XMesh-Nexus](https://github.com/TriplexCorp/XMesh-Nexus) и [XMesh-Node](https://github.com/TriplexCorp/XMesh-Node).  
> **Основной roadmap:** [ENTERPRISE_ROADMAP.md](ENTERPRISE_ROADMAP.md).  
> **Владелец решения:** owner проекта; реализация, публикация и включение строгого режима требуют отдельных проверок.  
> **Назначение документа:** полная архитектура, разбивка по файлам, контрактам, миграциям, PR, тестам, эксплуатации, рискам и объективным критериям приёмки.

## 0. Executive summary

Внедрить **XMesh Security Protocol v2 (XSP-v2)**, который одновременно обеспечивает:

1. **Гибридную аутентификацию и целостность** security-critical сообщений: две независимые подписи **Ed25519 И ML-DSA-65** (FIPS 204) над **одними и теми же строго определёнными байтами**. Обе подписи обязательны после активации v2.
2. **Гибридную конфиденциальность управляющего HTTPS-канала**: TLS 1.3 с согласованной группой **X25519MLKEM768** (RFC 10024), проверяемой при соединении. Это снижает риск *harvest now, decrypt later* для новых соединений.
3. **Управляемое доверие и миграцию**: отдельные ключи, proof-of-possession, привязка к идентичности ноды, pinning, key epochs, защищённая активация, ротация, отзыв, восстановление; после активации недопустим тихий откат на Ed25519-only.
4. **Совместимость без простоя**: v1 живёт для не переведённых нод в ограниченный переходный период; v2 включается на **конкретной ноде** после успешных проверок и подтверждения состояния.
5. **Сохранение текущих гарантий XMesh**: signed desired-config, консервативный offline guard, квоты, запреты пользователей, TimescaleDB-телеметрия, фиксированные команды управления, работа Xray и Go edge router.
6. **Доказанную корректность**: тестовые векторы Rust↔Go, CI в обоих репозиториях, negative/fault tests, канареечные ноды, реальное подтверждение групп TLS и отказоустойчивых сценариев.

**Не делать:** не вставлять PQ-ключ «внутрь» Ed25519; не писать свою реализацию ML-DSA/ML-KEM; не считать поддержку алгоритма доказательством его применения; не отключать проверку TLS-сертификата; не менять пользовательские протоколы Xray в рамках этого проекта.

### 0.1. Определение границ

- **Control plane:** Nexus API ↔ агенты Node; подписанные политики, конфигурации, команды, heartbeat, метрики, ACK, enrollment и их резервные копии.
- **Data plane:** клиент ↔ Go SNI/ALPN router ↔ Xray ↔ сеть. **Не входит** в криптографическое изменение. Постквантовая защита клиентских VLESS/Reality/других протоколов — отдельный проект.
- **Свойства разные:** ML-DSA — подписи и аутентичность; ML-KEM — согласование общего секрета для TLS. Двойная подпись **не шифрует** сеть. Гибридный TLS key agreement **не заменяет** доверенную идентичность TLS-сервера и подписи сообщений.
- **Ограничение:** компрометация root на ноде или приватных ключей панели выходит за рамки криптографической защиты подписи; нужны изоляция секретов и recovery.
- **Без ретроактивных гарантий:** миграция, основанная на ранее доверенном Ed25519, не делает прошлую регистрацию постквантово устойчивой задним числом. Для особо строгих установок — независимая проверка отпечатков PQ-ключей при enrollment.

## 1. Проверенная точка отсчёта (main, 2026-10-25)

Исследован исходный код обоих репозиториев; наличие исходника не равнозначно подтверждённой работе в production.

| Текущий компонент | Факт и расположение | Последствие для плана |
| --- | --- | --- |
| Подпись исходящих сообщений Node | Nexus `backend/src/node_auth.rs`: `XMESH1`, HTTP method/path, node ID, timestamp, nonce и SHA-256 *сырых* байтов тела; Ed25519, replay nonce в БД | Встроить v2, сохранив v1 для legacy-нод; не ослабить replay/time checks |
| Trust / enrollment | `backend/src/node_enrollment.rs`, `bootstrap.sh`: одноразовый токен + Ed25519 proof-of-possession | Добавить второй публичный ключ и подтверждение владения ML-DSA |
| Подпись policy | `backend/src/node_policy.rs`: сериализация Rust `serde_json::to_vec` и Ed25519 | Перейти на единый подписываемый формат v2 с общими Rust/Go vectors |
| Ответ desired-config | `backend/src/node_runtime.rs`: `policy`, `policySignature`, `policyPublicKey`; подписана policy, а не весь HTTP-ответ | Подписывать v2-policy и необходимые security-critical response fields; явно привязать config digest |
| Guard Node | `deploy/xmesh-policy-guard.py`: OpenSSL Ed25519, pinned panel key, anti-rollback, offline cache | Добавить двухподписную проверку и persisted minimum suite перед применением; не ломать offline enforcement |
| Управление, метрики | Nexus `deploy/node-control-agent.sh`, `deploy/node-metrics-agent.sh`: Bash + OpenSSL + curl; Node `heartbeat.go`: Go Ed25519 | Перевести на общий Secure Agent / SDK; помнить, что часть agent scripts лежит в Nexus, но работает на Node |
| HTTPS Nexus | `compose.yaml`, `backend/src/main.rs`: приложение слушает HTTP :8080 за внешним TLS reverse proxy | Настраивать гибридный TLS **на фактическом TLS terminator**, не в Axum :8080 |
| Go-модуль Node | `go.mod`: Go 1.23 | Для стандартного `crypto/mldsa` нужен Go **1.27+**; выбрать актуальный поддерживаемый security patch |
| Rust runtime | `backend/Dockerfile`: build Rust 1.99.1, Debian Bookworm runtime | Выделить отдельный исследовательский PR по PQ-библиотеке, version/pinning, её runtime и supply chain |
| Перезапуск / команды | `backend/src/node_runtime.rs`: poll / ack, подписаны *запросы* Node; reply сам по себе не имеет эквивалентной независимой подписи | Добавить подпись **команд/ответов**, включая enforceStop |
| Метрики | `node_auth.rs` и `metrics/ingest` | Гибридно аутентифицировать входящие данные, сохранить ограничения размера и anti-replay |

**Важный контекст:** владелец вручную проверил, что отключение пользователя в Nexus прекращает реальный VPN-трафик Xray примерно за 10 секунд (сообщение 2026-10-25). Приёмка XSP-v2 обязана доказать отсутствие регрессии этого сценария; автоматизация испытания пока отдельная задача.

## 2. Угрозы и security objectives

### 2.1. Противник

- Может записывать зашифрованный TLS-трафик сегодня и пытаться расшифровать его в будущем.
- Может перехватывать, заменять, повторно отправлять, блокировать и переставлять HTTP-сообщения.
- Может подменять или задерживать policy/command/ACK в сети, выдавать старую версию ответа, менять metadata.
- Может контролировать legacy-клиент, попытаться принудить v2-узел к v1.
- Может использовать ошибки сериализации, размера сообщений, одновременного enrollment/rotation, нарушения атомарности обновления.
- Может вызвать недоступность панели, потерю пакетов, перезагрузку, рассинхронизацию часов.
- **Не предполагается**, что может читать защищённые приватные ключи с неповреждённых Node/Nexus без отдельного incident scenario.

### 2.2. Контроли

| Угроза | Защита | Необходимый тест |
| --- | --- | --- |
| Квантовая подделка Ed25519 | Обязательная ML-DSA-65 подпись той же транзакции и доверенный PQ public key | Ed-only или неверная ML-DSA => reject |
| Квантовая расшифровка записанного TLS | Гибридный X25519MLKEM768 в TLS 1.3 | Отчёт о negotiated group; классический-only TLS => reject |
| Replay | Node ID, nonce, timestamp, request ID, command ID, server-side nonce store и revision monotonicity | Повтор command/nonce/response => reject |
| Cross-endpoint substitution | Domain separation + direction + method + path + messageType | Подпись heartbeat не работает для poll |
| Key substitution | Зарегистрированные/pinned ключи, key IDs, отдельное подтверждение ротации | Чужой ключ или неверный epoch => reject |
| Downgrade | Минимальная допустимая suite, сохранённая на Node и Nexus | v2→v1 после активации => reject |
| Подмена Xray JSON | SHA-256 exact bytes выбранной конфигурации, policy binding и runtime attest | Изменение JSON без новой подписи => reject |
| Захват/инъекция команды | Подписанный ответ, фиксированная allowlist операций, отсутствие shell-injection | Unknown command => reject |
| DoS на больших подписях | Предельные размеры, ограничение параллелизма, дешёвая предварительная валидация | Огромный/malformed envelope => bounded reject |
| Offline / crash | Последняя валидная policy, durable state и атомарные записи | После рестарта не применяется старый запрещённый snapshot |
| Compromised key | Revocation, audited recovery, separate-purpose keys, least privilege | Revoked key cannot authenticate |

### 2.3. Security invariants — непереговорные

**INV-01:** действующая v2 security-critical операция принимается только с корректными Ed25519 **и** ML-DSA-65 подписями.

**INV-02:** обе подписи криптографически привязаны к **одним exact signed bytes**, включая назначение, направление, идентичность отправителя, получателя, тип, key IDs/epoch, срок и digest payload.

**INV-03:** v2-nodes не принимают v1 после зафиксированного cutover, даже при возврате старого состояния панели или старой версии агента.

**INV-04:** private keys не передаются по API, не попадают в JSON-config/Xray, Git, логи, argv или диагностические дампы.

**INV-05:** новый/недоверенный signed policy **не меняет** Xray; предыдущая действующая offline policy сохраняет заданные ограничения. Нельзя считать network error разрешением включить ранее отключённого пользователя.

**INV-06:** TLS 1.3, действительный сертификат и **фактически** X25519MLKEM768 — обязательны для `strict-pq` Node; не допускать silent TLS fallback.

**INV-07:** ключи и криптографические полномочия агентов разделены; unprivileged metrics agent не получает root/control полномочия.

**INV-08:** повышение уровня безопасности выполняется атомарно и идемпотентно; downgrade/recovery требует отдельной явной, аудируемой процедуры владельца и доверенного канала.

## 3. Целевой протокол XSP-v2

### 3.1. Концепция

Перейти от двух независимых исторических форматов — `XMESH1` запросов и `policySignature` v1 — к единому **versioned envelope** для запросов **и** ответов. Не использовать «Ed25519+ключ-внутри-Ed25519» и не называть обычную конкатенацию двух signatures стандартизованным алгоритмом: это собственный **протокол композиции двух стандартных подписей**, который требует threat model и review.

**Рекомендованный транспорт:** JSON envelope с полями metadata, base64-кодированными **точными payload bytes** и двумя base64-подписями; парсер подписей работает с однозначным бинарным `signing_input`. Компрессия и base64 увеличивают стоимость; измерить ограничения (см. `12). Не сериализовать один и тот же JS/Rust/Go JSON независимо на двух сторонах «как получилось».

### 3.2. Пример логической структуры (не действующий API)

~~~json
{
  "protocol": "XSP/2",
  "suite": "Ed25519+ML-DSA-65",
  "messageType": "node.desired-config",
  "direction": "nexus-to-node",
  "issuerId": "nexus-primary",
  "recipientNodeId": 42,
  "httpMethod": "POST",
  "httpPath": "/api/v2/node/desired-config",
  "keyEpoch": 2,
  "ed25519KeyId": "panel-ed-2",
  "mldsa65KeyId": "panel-pq-2",
  "issuedAtMs": 1792947600000,
  "expiresAtMs": 1792947900000,
  "nonce": "<hex 128-bit random>",
  "requestId": "<bound request correlation>",
  "revision": "<monotonic revision / config digest>",
  "payloadB64": "<base64 exact payload bytes>",
  "signatures": {
    "ed25519": "<base64 signature>",
    "mldsa65": "<base64 signature>"
  }
}
~~~

Это дизайн-кандидат. Перед кодированием **заморозить exact schema, бинарный layout и max lengths в `docs/XSP_V2_WIRE_SPEC.md`**. Нельзя менять порядок полей или смысл revision без версии протокола.

### 3.3. Подписываемые байты

**Предлагаемая строгая спецификация:**

- Domain separator: ASCII `XSP2-SIGNED-MESSAGE` + NUL.
- Все данные читаются в документированном **фиксированном порядке**, каждое переменное поле — `u32 big-endian length || bytes` с жёсткими bounds; идентификаторы и timestamp — фиксированные `u64/i64 big-endian`, прошедшие range check.
- Привязка включает: protocol version, suite, messageType, direction, issuerId, recipientNodeId, HTTP method/path (где применимо), key IDs и epoch, issuance/expiry, nonce, requestId/commandId, revision и `SHA-256(payload_bytes)`.
- `payload_bytes` — результат однократного кодирования полезной нагрузки на стороне отправителя; получатель сначала декодирует base64 **без пере-сериализации**, проверяет её digest, затем парсит payload как строго типизированный объект.
- Ed25519 и ML-DSA-65 подписывают один и тот же `signing_input`. Reject при дубликатах JSON-ключей, неизвестной версии suite, лишних критических полях, некорректной base64-форме и несоответствии declared/canonical fields.
- Подпись политики покрывает digest **реально применяемой** Xray конфигурации и остальные критические поля ответа. `policy` и metadata нельзя смешивать из разных envelopes.
- Для HTTP response requestId, endpoint, node, revision, commandId, срок действия и контекст запроса должны быть криптографически связаны с ответом.

**Decision gate:** выбрать окончательные кодировки (включая Unicode, case sensitivity, duration units, max ints, empty values), зафиксировать test vectors, пройти cross-language review. Не писать криптографический парсер до завершения спецификации.

### 3.4. Типы сообщений

| Тип | Sender → receiver | Требование |
| --- | --- | --- |
| `node.enroll` | Node → Nexus | Hybrid proof-of-possession + одноразовый токен и server-side транзакция |
| `node.desired-config.request` | Node → Nexus | Две подписи, nonce/time/replay |
| `node.desired-config.response` | Nexus → Node | Две подписи, policy/config digest, validity, revision |
| `node.heartbeat` | Node → Nexus | Две подписи, подтверждение agent/xray/runtime |
| `metrics.ingest` | Node → Nexus | Две подписи, bounded body, idempotency |
| `node.command.poll` | Node → Nexus | Две подписи, replay |
| `node.command.response` | Nexus → Node | **Две подписи команды**, включая stop, restart/update, пустой ответ и enforceStop |
| `node.command.ack` | Node → Nexus | Две подписи, command ID + applied state |
| `node.security.activate` | Node ↔ Nexus | Idempotent, защищённое подтверждение min-suite |
| `node.keys.rotate` | Node ↔ Nexus | Подписание смены identity, epoch и подтверждение владения новыми ключами |
| `node.security.recover` | Owner/console-mediated | Только отдельный явно авторизованный recovery workflow |

Для /api/v1 legacy сохраняется **на отдельном логическом маршруте** до явной миграции; v2-узел по ошибке не должен авторизоваться через v1.

### 3.5. Приёмка сообщения (общий алгоритм)

1. Ограничить HTTP body/header sizes, глубину JSON, число полей, размеры base64 payload/signatures; подтвердить версию и тип по allowlist.
2. Найти **ранее доверенные** ключи отправителя по identity + key IDs/epoch и проверить допустимость suite для данного nodeId.
3. Проверить exact bytes, digest и обязательную подпись Ed25519.
4. Проверить обязательную подпись ML-DSA-65.
5. Проверить срок, nonce, requestId, recipientNodeId, авторизацию операции, revision и отсутствие replay.
6. Атомарно занести nonce/commandId/applied revision в durable state с необходимой семантикой повторных запросов.
7. Лишь затем десериализовать и передать payload на обработку; для Xray — провести текущую validation/prepare/apply процедуру.

Любая ошибка подписи или привязки — **deny**. Ошибка доставки ответа и offline-работа — отдельное состояние, не «успех».

## 4. Алгоритмы, библиотеки, toolchain, supply chain

| Область | Решение | Условия |
| --- | --- | --- |
| Classical signature | Ed25519 (существующая схема) | Ключи не заменять без необходимости |
| Post-quantum signature | ML-DSA-65 / FIPS 204 | Не использовать неаудированную домашнюю реализацию |
| Hybrid key agreement | TLS 1.3 X25519MLKEM768 / RFC 10024 | Подтвердить **negotiated group**; требовать certificate/hostname verification |
| Hash | SHA-256 | Digest точных bytes; не путать с подписью |
| Node Go | **Go 1.27+** с `crypto/mldsa`, актуальный патч security | Текущий `go.mod` = 1.23; обновление CI, базовых образов, сборки, source compatibility |
| Nexus Rust | Исследовать OpenSSL 3.5+ через поддерживаемый, поддерживаемый в будущем EVP binding; отдельный PoC | Зафиксировать версии, поставку, FFI, memory safety, licensing, security patches |
| TLS terminator | Reverse proxy с работающим TLS 1.3 и X25519MLKEM768 | Проверить точный server binary + linked crypto library и поддержку нужной директивы |
| Encoding | Фиксированный binary signing_input + base64 payload transport | Rust/Go shared golden vectors |
| Key material | OS CSPRNG | Самостоятельные Ed25519 и ML-DSA ключевые пары; обязательная независимая ротация |
| Tests | Go/Rust unit + integration + interoperability + fault injection | CI в двух репозиториях + disposable VPS |

**Подтверждённые стандарты и версии на 2026-10-25:**
- NIST FIPS 204: https://csrc.nist.gov/pubs/fips/204/final
- RFC 10024 X25519MLKEM768: https://www.rfc-editor.org/info/rfc10024/
- Go 1.27: впервые добавлен стандартный `crypto/mldsa` — https://go.dev/doc/go1.27
- Go `crypto/tls`: X25519MLKEM768 присутствует в default c Go 1.24, группа доступна через `ConnectionState.CurveID` — https://pkg.go.dev/crypto/tls
- OpenSSL 3.5: нативная поддержка ML-KEM / ML-DSA — https://openssl-library.org/post/2025-04-08-openssl-35-final-release/

**Правило:** выбирать *реально поддерживаемые security patches*, а не «Go 1.27.0» или «OpenSSL 3.5.0» без проверки актуальных исправлений. Для Rust crypto crate нельзя объявлять независимый аудит выполненным без доказательств. PoC должен включать FIPS 204 vectors, fuzzing и проверку межъязыковой подписи.

## 5. Новая структура исходников

### 5.1. XMesh-Nexus

| Точка | Изменение |
| --- | --- |
| `backend/src/xsp_v2.rs` (новый) | Типы envelope, exact signing bytes, Ed25519+ML-DSA verify, strict parsing и domain separation |
| `backend/src/node_crypto.rs` (новый) | Загрузка/генерация ключей Nexus, keyring, signer abstraction, ротация, тесты |
| `backend/src/node_auth.rs` | V1 отдельным путём; v2 authentication, replay, DB minSuite и per-node key lookup |
| `backend/src/node_policy.rs` | V1 signer сохраняется; v2 signed envelope policy, ключи, policy/cfg binding |
| `backend/src/node_enrollment.rs` | Dual proof-of-possession; привязка обеих ключевых пар, транзакционная регистрация |
| `backend/src/node_runtime.rs` | V2 desired-config, heartbeat, poll, restart/ack и ответные подписи |
| `backend/src/main.rs` | `AppState` crypto context, `/api/v2` routes, version selection, redacted diagnostics |
| `backend/Cargo.toml` | Версионированная и проверенная криптографическая зависимость; cargo audit/pinning |
| `backend/Dockerfile` | Актуальная версия OpenSSL/нужных библиотек с security updates; контроль linkage |
| `backend/migrations/0029_node_crypto_suites.sql` | Новые сущности, индексы, ограничения, monotonic epochs |
| `compose.yaml` | Защищённый volume/paths, конфигурация без прямого раскрытия private keys |
| `deploy/node-control-agent.sh` | Переход на безопасный клиент XSP-v2 и **проверку ответов** |
| `deploy/node-metrics-agent.sh` | Переход на общую v2-подпись; без control полномочий |
| `docs/SECURITY_NODE_IDENTITY.md` | Dual identity, TLS, migration, recovery, threat model |
| `.github/workflows/backend-ci.yml` | Interop fixtures, crypto negative tests, rustfmt/clippy, API integration |

### 5.2. XMesh-Node

| Точка | Изменение |
| --- | --- |
| `go.mod` | Go 1.27+, `crypto/mldsa` |
| `security/xspv2/` (новый Go пакет) | Wire encoding, binary signing_input, verify, keyring, strict decode, TLS policy |
| `cmd/xmesh-security/` (новый бинарник) | `keygen`, `enroll`, `request`, `verify`, `rotate`, `status`, `self-test` |
| `heartbeat.go` | Вызывать общую библиотеку вместо собственной `XMESH1` подписи |
| `bootstrap.sh` | Две пары ключей, proof-of-possession, безопасный enroll, crypto-state backup |
| `deploy/xmesh-xray-sync.sh` | V2 HTTP client и verifier, сохранение pending/committed pipeline |
| `deploy/xmesh-policy-guard.py` | Offline suite floor, signed policy digest и anti-rollback; криптографию делегировать Go verifier |
| `deploy/test-xmesh-policy-guard.py` | Legacy/v2, corruption, downgrade, expiry, offline, atomic commit |
| `deploy/xmesh-node.service` и установщики | Версия и root-owned deployment проверенного security binary, ограничения прав |
| `.github/workflows/ci.yml` | Go tests, interop, fuzz smoke, TLS, сборка, проверки подписей |

### 5.3. Не менять в данном проекте

- `tcp.go`, `udp.go`, SNI/ALPN/TCP passthrough, UDP session routing.
- Клиентские протоколы VLESS/Reality/VMess/Trojan, Xray JSON semantics.
- Модель UI users/squads/subscriptions, кроме отображения crypto status.
- Реальные квоты и StatsService calculation — только regression verification.

## 6. Node Secure Agent, процессы и права

Разрозненные shell-реализации `openssl pkeyutl + curl` следует постепенно заменить **единым XMesh Secure Agent**, написанным на Go:

- `keygen`: защищённая генерация двух независимых keypairs; private keys никогда не печатаются.
- `enroll`: proof-of-possession, pin panel key через проверенное trust establishment.
- `request`: подписанный HTTPS-запрос; обязательная проверка TLS и ответа.
- `verify`: offline и онлайн проверка двух подписей + anti-rollback policy.
- `rotate`: детерминированное согласование ключевой эпохи с безопасным commit.
- `status`: suite, fingerprint, epoch, TLS group, verification result — без private keys.
- `self-test`: KAT, signing/verifying, публичные тестовые векторы и probes.

### 6.1. Least privilege

**Не создавать** свободный endpoint «подпиши произвольные байты приватным ключом» для непривилегированных агентов. Вместо этого:

- Разделить **identity keys по назначению** либо внедрить минимальный локальный signer с fixed operation allowlist и проверкой Unix peer credentials/SELinux/systemd permissions.
- Metrics service может запрашивать подпись только `metrics.ingest` и разрешённого heartbeat.
- Control agent может подписывать только ограниченный список и проверять все inbound commands.
- Private keys и minimum-suite state — в root-owned directories (0700 и 0600, конкретные права определяются service topology).
- Избегать передачи приватного материала через argv, env, stdout, временные файлы в /tmp и world-readable mounts.
- Зафиксировать карту потребителей существующего `/etc/xmesh-node-metrics/node.key`, который может быть доступен группе metrics, и мигрировать права только с регрессионными тестами.

### 6.2. Сохранение совместимости

Не удалять существующий Ed25519 файл до явного cutover. Новый Secure Agent должен иметь v1-режим **только** для нод в `legacy`; серверное решение о допустимости v1 зависит **от БД**, а не от заголовка «я legacy», выбранного клиентом.

## 7. Key management, enrollment, rotation, recovery

### 7.1. Nexus

Текущий ключ `/var/lib/xmesh/core/node-policy-ed25519.key` сохранить. Новый ключ (`node-policy-mldsa65.key`) хранить **отдельно**, в защищённом постоянном volume/secret provider. Каждая пара имеет algorithm, key ID, epoch, creation/activation/retirement timestamps и публичный fingerprint.

- Не добавлять private keys в PostgreSQL, API, .env, read-only volume браузера, логи или frontend.
- Подписывающий сервис не должен принимать attacker-controlled algorithms/paths.
- Резервировать **оба** private keys вместе с PostgreSQL-данными и TOTP secrets; восстанавливать на отдельной среде без утечки.
- Планировать `active` / `next` / `retired` keyset и ограниченное окно ротации с проверкой доверия к новым ключам старой активной эпохой.

### 7.2. Node

Предлагаемые каталоги (фактическое размещение согласовать с systemd permissions):

~~~text
/etc/xmesh-node-security/
  identities/
    ed25519.key
    mldsa65.key
  trust/
    nexus-ed25519.pub
    nexus-mldsa65.pub
  state/
    minimum-suite.json
    key-epoch.json
    activation.json
/var/lib/xmesh-xray-sync/
  policy-envelope.json
  policy-envelope.json.pending
  policy-usage.json
~~~

KeyEpoch и minSuite дублируются/сверяются с server-side persisted state; отдельные временные файлы записываются `fsync + atomic rename + directory fsync` с защищёнными правами. Установить ограничения против восстановлений старого snapshot из offline cache; физический downgrade всей файловой системы при root-компрометации полностью software-only средствами не исключить.

### 7.3. Новая регистрация

1. Владелец создаёт short-lived одноразовый enrollment token на конкретную ноду.
2. Node генерирует два независимых ключа локально и получает оба public keys.
3. Node подписывает **одну** challenge, содержащую token, nodeId, оба public keys, key IDs/epoch, expiry и context, **обоими** private keys.
4. Nexus проверяет обе подписи, TTL, session/role authorization, uniqueness, связывает оба ключа в одной транзакции и погашает токен.
5. Node сверяет/pins identity Nexus **по доверенному bootstrap process**, не доверяя ключам только по данным того же ответа.
6. Стороны фиксируют version/capability, но строгий cutover завершается отдельным mutual ACK.

### 7.4. Существующие ноды

- Из Ed25519 legacy identity начать **authenticated binding** нового ML-DSA ключа при условии подлинного TLS и обязательного owner approval.
- Для повышенного security — показать fingerprints в UI/консоли и подтвердить их по независимому каналу.
- Миграция **не делает** исторический v1-auth автоматически устойчивым к будущему квантовому adversary; записанные legacy credentials/исторические данные остаются классическими по защите.
- После фиксации XSP/2 подключить проверку minimum-suite и закрыть v1 на этой ноде.

### 7.5. Отзыв, ротация, катастрофическое восстановление

- Rotate: подготовить next keys, доказать владение ими, подписать transition старой и новой key epochs, опубликовать trust record, переключить, подтвердить, завершить old keys. Снять old keys только после приёмки нового trust.
- Revocation: запретить новые сообщения от отозванных keys и вывести ноду в требуемое state; уже сохранённую подписанную offline policy обрабатывать согласно явной fail-safe политике.
- Compromise panel key: срочное блокирование/изоляция API, out-of-band recovery, ревизия доверенных snapshots, аудит команд, staged re-enrollment.
- Lost key without compromise: owner-console recovery с доказательством доверенной физической/административной идентичности; **никакого** автоматического legacy downgrade.
- Full backup/restore drill обязателен до production strict rollout.

## 8. PostgreSQL: план миграции схемы

Новая миграция `backend/migrations/0029_node_crypto_suites.sql` (имя — предложение; проверить свободный номер перед merge).

| Таблица/изменение | Поля и ограничения | Для чего |
| --- | --- | --- |
| `node_crypto_identities` | node_id, algorithm, public_key, key_id, epoch, purpose, state, created_at, revoked_at; unique(node_id, key_id) | Доверенные ключи, несколько epochs и purposes |
| `node_crypto_state` | node_id PK, minimum_suite, activation_state, active_epoch, activated_at, last_successful_hybrid_at, last_tls_group | Серверный монотонный floor и rollout |
| `node_crypto_migrations` | id, node_id, from_suite, to_suite, stage, correlation_id, issued_at, acked_at, updated_at | Idempotent migration state machine |
| `node_crypto_events` | node_id, event_type, actor, epoch, algorithm, code, created_at; без secrets | Audit, timeline и incident investigation |
| Existing `node_metric_keys` | оставлять legacy semantics до выхода всех legacy nodes | Не удалить / не перезаписать старые данные |
| Existing nonce/revision | новый `namespace`/version либо совместимый составной ключ и TTL | Replay protection без коллизий протоколов |

**Invariant:** server-side minimumSuite обновляется только авторизованным переходом и **никогда** не уменьшается обычным endpoint. Все изменения активации и epoch — транзакционные. В DB не хранятся PQ private keys. Нужны reversible schema migrations, но криптографический downgrade после cutover не считается допустимым rollback.

## 9. API v2 — предлагаемое семейство

Все имена — проектное предложение, фиксируются в wire spec.

| Endpoint | Sender | Payload/response | Особое требование |
| --- | --- | --- | --- |
| `POST /api/v2/node/enroll` | Node | Keys, dual possession proofs | One-time token, owner, atomic transaction |
| `POST /api/v2/node/desired-config` | Node | Config request → signed policy/response | Xray config digest, apply ack, rollback safety |
| `POST /api/v2/node/heartbeat` | Node | Runtime and crypto capabilities → signed ack | Freshness, state, no false "applied" |
| `POST /api/v2/metrics/ingest` | Node | Traffic metrics | Bounded signed payload, dedup |
| `POST /api/v2/node/restart/poll` | Node | Request → signed command or signed no-command | No command injection, enforceStop signed |
| `POST /api/v2/node/restart/ack` | Node | Ack for commandId | Idempotent, phase/status |
| `POST /api/v2/node/security/prepare` | Node | Attest ready for v2 | Installed verifier, pinned keys, secure TLS |
| `POST /api/v2/node/security/activate` | Node↔Nexus | Two-phase activation, durable ACK | Monotonic suite floor |
| `POST /api/v2/node/security/rotate` | Node↔Nexus | Key-epoch transition | Dual proof-of-possession, audit |

**Special case control:** `node.control.poll` ответ может потребовать остановить Xray при отключении ноды; **нельзя** превращать невалидный ответ/HTTP 500/отсутствующую подпись в «разрешено работать» или «успешно остановлено». Security actions требуют верифицированной команды и фиксированного локального исполнителя; поведение при недоступности панели определяется отдельной policy.

**Special case metrics:** бизнес-проверки квот/присутствия и защищённой телеметрии сохраняются. Отсутствие данных — не нулевой расход.

**Idempotency:** Retry с тем же идентификатором и payload может возвращать сохранённый результат в строгой транзакционной модели, но повторно исполнять команду нельзя; strict replay rejects при подменённом payload.

## 10. TLS 1.3 + X25519MLKEM768

### 10.1. Точка внедрения

Nexus Rust backend слушает HTTP на 8080 за внешним HTTPS reverse proxy. Поэтому:

- Домен для **node control API** выделить отдельно (пример: `node-api.example.invalid`), если эксплуатационная топология позволяет.
- Проверить **фактический** TLS terminator: Nginx, Caddy, HAProxy, CDN либо LB, его версию, linked OpenSSL, поддержку named group X25519MLKEM768.
- На strict node endpoint потребовать TLS 1.3, поддержку гибридной группы и валидный сертификат/hostname.
- Node Secure Agent задаёт TLS policy и проверяет `ConnectionState.Version` и `CurveID == tls.X25519MLKEM768` после handshake; отсутствие negotiated group → **fail closed**.
- Не использовать `InsecureSkipVerify`, `curl -k` или доверие к client-provided proxy headers.
- TLS session resumption протестировать отдельно: что может/не может быть подтверждено через telemetry текущего handshake; для криптографической диагностики выполнять full-handshake probe без повторного использования tickets.
- Если между нодой и Nexus есть CDN/LB, документировать **все** сегменты TLS и доверенные boundaries. PQ на Node→CDN **не доказывает** PQ на CDN→origin.
- Обычная X.509 цепочка сертификата может быть классической; полноценную PQ аутентификацию сообщений обеспечивает двухподписный XSP-v2. **Не писать** «полностью PQ TLS authentication» без подходящих сертификатов.
- Прокси не должен переписывать подписываемые endpoint-paths без строго определённой логики; проверить SNI, Host, ALPN и upstream mapping.

### 10.2. Технический spike

1. Развернуть временный TLS terminator в тестовом окружении с поддержкой X25519MLKEM768.
2. Проверить handshake клиентом Go и независимым инструментом, получить фактическую negotiated group.
3. Проверить отказ при классическом X25519-only, TLS 1.2 и неверном сертификате.
4. Проверить reconnect, HTTP/1.1/HTTP2, resumption, timeouts, version pinning.
5. Зафиксировать tested binary, OpenSSL version, config и CI probe.

**Не раскатывать** экспериментальные TLS-настройки на публичный dashboard/subscription endpoint без compatibility test.

## 11. Локальный offline guard и сохранение enforcement

- `deploy/xmesh-policy-guard.py` остаётся источником логики conservative allowances и счётчиков; проверку подписи переносим в ограниченный, проверенный Go verifier.
- `verify_envelope` v2 требует две корректные подписи; проверяет связку policy→config digest, nodeId, expiry, epoch и persisted minimumSuite.
- Legacy v1 verifier вызывается **только**, если узел ещё не перешёл на v2 и локальная/server policy разрешает v1.
- `policy-envelope.json.pending` пишется только после успешной криптопроверки и Xray syntax validation. `commit` сохраняет атомарность и anti-rollback.
- После рестарта Node и при offline не принимать v1 из сохранённого кеша для v2 node; старый bootstrap или переустановка не должны очищать suite floor автоматически.
- При недоступности Nexus продолжать действующую offline policy согласно expiry, revocations, quotas. Не «разблокировать всё», если signature verification fails.
- Следить за disabled-node forced-stop semantics: любые новые разрешающие команды требуют подлинного signed source; любые локальные fail-safe правила должны оставаться безопасными при сбоях.
- Регрессия: реальное отключение пользователя, достигавшееся владельцем примерно за 10 с, должно сохраняться после перехода. Test measurements показывать как latency distribution, а не один «идеальный» случай.

## 12. Производительность и ограничения размеров

ML-DSA-65 signatures/public keys существенно больше Ed25519; новые blobs не переносить бездумно в HTTP headers.

- Зафиксировать максимальный `envelope`, `payloadB64`, nonce, key ID, signature field, nesting и key-count; учитывать Nexus `RequestBodyLimitLayer` около 2 MiB для входящих HTTP-запросов.
- Подписи и ключи — в типизированных полях тела; сохранять краткие capability headers только там, где они не меняют security semantics.
- Проверить перекодирование больших desired-config и метрик, общее увеличение JSON/base64, выделение памяти и GC на Go и Rust.
- Бенчмарки: ML-DSA sign/verify, TLS full handshake, Node→panel round trip, 1/10/100/1000 nodes, latency policy apply, CPU/RAM, DB writes, proxy limits.
- Для CPU-intensive проверки ограничить параллелизм без возможности starvation status/revocation.
- Сравнивать с baseline, документировать p50/p95/p99 и worst-case. Не объявлять «нулевую деградацию» без измерения.
- На first rollout не ухудшать интервалы sync (~10s), metrics, heartbeat и реальные безопасные обновления конфигурации.

## 13. План интерфейса XMesh Nexus

В карточке Node добавить вкладку **Security / Cryptography**:

- `Protocol`: Legacy XSP/1 · PQ-capable · Hybrid Pending · Hybrid Active · Fault · Recovery required.
- `Authentication`: Ed25519 + ML-DSA-65; **verified active** vs **keys merely provisioned**.
- `TLS`: last observed group / version и дата подтверждения; unknown/expired observation ≠ «protected».
- `Identity`: короткие публичные fingerprints, key IDs, epoch, статус ротации; никаких private keys.
- `Policy`: desired/delivered/applied revision и результат hybrid verify; control operation result.
- `Downgrade protection`: server-side minSuite + node attestation, consistency and desync warnings.
- `Actions`: Start migration, Verify, Activate, Rotate, Revoke, Recovery request — только строго авторизованные owner/admin actions по RBAC и при необходимости re-authentication.
- `Audit`: подписи invalid, replay, downgrade attempt, old keys, TLS fallback, rotation, activation, errors.

Не выводить просто красивый зелёный badge по флагу в БД. UI обязан отличать `configured`, `negotiated`, `signed`, `applied` и `observed`.

## 14. Развёртывание без простоя — state machine

**Состояния:** LEGACY → PQ_CAPABLE → DUAL_ENROLLED → V2_SHADOW_VERIFIED → V2_ACTIVATING → V2_STRICT. Ошибки: MIGRATION_BLOCKED / RECOVERY_REQUIRED. Возврат из V2_STRICT в LEGACY по обычному API запрещён.

1. **Nexus first:** schema, signers, /api/v2, key backup, metrics и status; legacy остаётся доступным для unmigrated nodes.
2. **Node binaries:** установить Secure Agent и новые проверки, но не заменять активный `xray-sync` до успешного self-test.
3. **Enroll:** создать ML-DSA pair локально, proof-of-possession; проверить keys и pinned identity.
4. **Shadow:** запросить и проверить v2 signed desired-config без изменения работающего Xray, проверить TLS и policy/config digest, сравнить expected revision и permissions.
5. **Prepare:** сохранить проверенный v2 policy cache и durable state; проверить возможность offline продолжения работы по новой policy.
6. **Activate (two-phase):** Node сохраняет локальный monotonic suite floor, Nexus фиксирует серверный floor; повтор/сбой/timeout выполняет **reconcile**, не легаси-fallback. State machine должна быть идемпотентной и переживать crash между записями.
7. **Strict:** всё security-critical общение Node↔Nexus v2+hybrid-TLS. Подписанный v1 ответ всегда reject.
8. **Canary:** сначала одна тестовая нода; затем небольшая группа; затем остальные после просмотра telemetry и fault tests.
9. **Legacy sunset:** после confirmed coverage отключить legacy endpoint для нод в строгом режиме; общий sunset — отдельное управляемое событие, без обрыва неизменённых нод.

### 14.1. Rollback boundaries

- **До activate:** можно вернуть старый клиент v1 и сохранить прежнюю policy.
- **После activate:** code rollback возможен только на версию, **умеющую проверять v2**, и без снятия minimumSuite. Rollback на Ed25519-only требует **отдельного авторизованного recovery**, иначе downgrade attack.
- **Потеря связи в середине активации:** стороны продолжают сверять persisted migrationId/epoch; неизвестное состояние означает **не применять новый config**, а не принимать legacy.
- **При компрометации ключей:** incident runbook; не выдавать автоматическое безусловное «разрешить Xray».

## PR02 isolated crypto interoperability checkpoint — 2026-10-27

- [x] Independent `crypto/mldsa` ML-DSA-65 implementation via nested Go 1.27.3 research module in XMesh-Node, without changing the production Go 1.23 router/toolchain.
- [x] Separate Rust `openssl = 0.10.81`/OpenSSL 3.5+ test crate in Nexus (not linked to the main API).
- [x] Common publicly disclosed test-only `XSP_V2_CRYPTO_POC.json` seeds and SHA-256 key/signature digests; both Go and OpenSSL independently reproduce ML-DSA-65 outputs and compare the two shared wire directions.
- [x] Negative Ed25519 **AND** ML-DSA-65 tests: missing, altered, substituted-key and mismatched-message signatures cannot pass an isolated PoC verifier.
- [x] Direct **Rust → Go** and **Go → Rust** signed-artifact exchange (both Ed25519 and ML-DSA-65 mandatory, tampering/downgrade rejected) in test-only isolated workflow.
- [ ] Record green isolated and production CI evidence for latest revisions of both repositories; complete external FIPS 204 known-answer tests, fuzzing and independent security review before declaring PR02 accepted.
- [ ] Next: strict JSON decoding, durable replay/epoch policy, a hybrid TLS 1.3 X25519MLKEM768 handshake probe with actual terminator. None are enabled in production.

**Provider decision (research only):** Go 1.27.3 `crypto/mldsa`; Rust `openssl` 0.10.81 with OpenSSL 3.5+ EVP ML-DSA-65. Do not equate verified local algorithm interoperability with an audited cryptosystem or a production migration. Details: [XSP_V2_CRYPTO_POC.md](XSP_V2_CRYPTO_POC.md).

## PR01 foundation checkpoint — 2026-10-27

- [x] Draft [XSP_V2_WIRE_SPEC.md](XSP_V2_WIRE_SPEC.md): candidate `xsp2-wire-candidate-1`, exact byte order, bounds, endpoint/direction binding and downgrade/replay threat model. Same document in both repos.
- [x] Shared public [XSP_V2_VECTORS.json](XSP_V2_VECTORS.json) (request + response, no signing secrets) is identical in both repos. Rust, Go and independent JS test-only encoders compare exact bytes and negative mutations.
- [ ] Record passing *latest* CI runs in **both** repositories after code-format fixes, then complete design and security review. Mark the wire as frozen only after explicit approval; compatibility-breaking changes need schema/version increment.
- [ ] PR02: real library-backed Ed25519 **AND** ML-DSA-65 cross-language signing, negative KATs and TLS X25519MLKEM768 negotiation spike.

**No production v2 endpoint, key generation, suite floor or agent switch has been added.** This checkpoint does **not** close XSP-v2 or any cryptographic acceptance gate.

## 15. Последовательность Pull Requests и acceptance gates

**PR 01 — XSP-v2 specification & threat model (оба репозитория, docs/tests)**  
- [ ] Закрепить `docs/XSP_V2_WIRE_SPEC.md`: версия, algorithm IDs, exact signed bytes, encoding, endpoint binding, responses, key purposes, epoch, max sizes.
- [ ] Threat model, trust bootstrap, error model, downgrade semantics, timing, replay и incident assumptions.
- [ ] Shared golden test vectors для Rust, Go и offline verifier: valid/invalid cases.
- **Gate:** архитектурный review подписан; реализация ещё не меняет production.

**PR 02 — Crypto interoperability PoC (Rust + Go)**  
- [ ] Go 1.27+ upgrade, `crypto/mldsa` sign/verify.
- [ ] Rust ML-DSA-65 через проверенный provider/EVP binding с pinning; выбрать runtime OpenSSL.
- [ ] Совпадение `signing_input` и положительных/отрицательных проверок по vectors.
- [ ] Constant-time primitives библиотек, bounded decoding, no key leaks; review зависимостей.
- **Gate:** Rust signs→Go verifies и Go signs→Rust verifies; обе подписи обязательны; CI зелёный.

**PR 03 — DB/key lifecycle (Nexus)**  
- [ ] `0029_node_crypto_suites.sql` и index/constraints, per-node minSuite, key IDs, epochs, audit.
- [ ] Новая панельная keypair отдельно от Ed25519; backup/restore smoke.
- [ ] Race-safe enrollment/rotation semantics.
- **Gate:** транзакционная консистентность, authorization tests, key loss recovery drill.

**PR 04 — XMesh Secure Agent (Node)**  
- [ ] Реализовать Go `security/xspv2` и `cmd/xmesh-security`; командный интерфейс и unit tests.
- [ ] Privilege separation для metrics/control и защищённые files/socket.
- [ ] Signed HTTP requests и verify all sensitive responses; TLS strict negotiation.
- **Gate:** тестовый CLI полностью независим от работающего Xray, не ломает legacy install.

**PR 05 — Signed desired-config v2 & offline guard (оба)**  
- [ ] Nexus hybrid policy signer + v2 endpoint.
- [ ] Node verifier интегрировать перед prepare/commit Xray; v1 fallback только для legacy node.
- [ ] Offline cache, config digest, policy revision, idempotency, expiry.
- **Gate:** malicious policy fails, valid policy applies, offline behavior не регрессирует.

**PR 06 — Signed commands/telemetry/heartbeat/ACK (оба)**  
- [ ] Перевести shell agents на общий client; Go heartbeat SDK.
- [ ] Sign Nexus restart poll response, enforceStop, update, no-command.
- [ ] Проверить authz by operation, replay, tampering, systemd allowlist.
- **Gate:** строгая аутентификация всех security-sensitive потоков, все existing API tests проходят.

**PR 07 — Hybrid TLS deployment (proxy + Node)**  
- [ ] Совместимый TLS terminator; node-only endpoint; сертификаты и hostname validation.
- [ ] Для strict node требовать TLS 1.3 + X25519MLKEM768, проверять negotiated result.
- [ ] CI/integration probe, TLS 1.2/old curve/invalid cert отрицательные тесты; CDN hops и resumption.
- **Gate:** доказан фактический PQ hybrid handshake, при подмене группы — fail closed.

**PR 08 — Enrollment, migration, downgrade lock (оба)**  
- [ ] Dual public key enrollment + owner approval, key epochs и nonce state.
- [ ] Shadow verification, two-phase activation, durable floors.
- [ ] Mixed-version, crash/reconnect/retry tests и explicit recovery process.
- **Gate:** upgrade canary → v2 strict без потери доступа; downgrade невозможен.

**PR 09 — UI, operations, backup & rotation (Nexus + Node)**  
- [ ] Security UI, detailed auth status, event timelines, alerts.
- [ ] Полная ротация и revoke; off-host restore с обоими наборами ключей.
- [ ] Runbooks upgrade/recovery/compromise, RBAC, secrets leak checks, audit logs.
- **Gate:** оператор может безопасно диагностировать и восстановить систему.

**PR 10 — E2E security certification & rollout**  
- [ ] Кросс-платформенная матрица CI + реальная test VPS + fault injection.
- [ ] User traffic disable (~10s owner-observed baseline), quota/expiry, Xray restart, stats, subscriptions, multitenancy.
- [ ] Load/perf, p95/p99, memory, no regressions, threat review.
- [ ] Canary observation, staged prod rollout, signed evidence logs и disaster restore.
- **Gate:** все `16` acceptance tests с доказательствами, только потом [x] в roadmap.

**Порядок может меняться по зависимостям:** PR 07 TLS spike допустим параллельно PR 02, но strict активация возможна **только после** успешных PR 01–08. Не считать отдельный green PR признаком завершённого P0.

## 16. Матрица тестирования и доказательства

### 16.1. Cryptography / protocol

- [ ] Ed25519 и ML-DSA-65 валидны → accept только в соответствии с suite.
- [ ] Отсутствие/повреждение **любой** подписи → reject.
- [ ] Подпись другой ноды/другого key epoch/issuer/recipient → reject.
- [ ] Modified payload, method/path, messageType, requestId, issuedAt, expiry, revision, commandId → reject.
- [ ] Unknown protocol version, unexpected algorithm, duplicate JSON keys, malformed base64, short/oversized signature → reject.
- [ ] Replay nonce, duplicate command, old policy revision, tampered cached policy → reject.
- [ ] Cross-language Rust ↔ Go vectors, CSPRNG KATs, malformed inputs, fuzz parser.
- [ ] Key rotation overlaps, withdrawn keys rejected after cutoff.

### 16.2. TLS transport

- [ ] Full handshake TLS 1.3+X25519MLKEM768 реально зафиксирован.
- [ ] Negotiated classic-only, TLS 1.2, insecure cert, wrong hostname → reject для strict Node.
- [ ] CDN, proxy, ingress и resumption coverage документированы.
- [ ] Проверить timeout, repeated reconnects, DNS failures, proxy restarts; no insecure fallback.

### 16.3. Recovery / resilience

- [ ] Crash при каждой фазе activation/enrollment/rotation не создаёт неразрешённый fallback.
- [ ] DB restart/disconnect, Redis loss, delayed/out-of-order/duplicate telemetry.
- [ ] Offline guard действует по последнему валидному snapshot; истёкшие/revoked users не возрождаются.
- [ ] Node и Xray restart сохраняют minSuite, keyEpoch, правильный source of truth и допустимые счётчики.
- [ ] Потеря одного ключа, утечка одного ключа, compromised identity, revocation и independent console recovery.
- [ ] Off-host restore двух private keys + PostgreSQL + других необходимых секретов на test env.

### 16.4. Product / functionality

- [ ] Пользователь отключён в Nexus → действующие/новые соединения фактически заблокированы; измерение p50/p95/p99 (сравнение с ~10s личной проверкой владельца).
- [ ] Expiry, quota, offline allowances, multi-node users, ambiguous revisions не нарушены.
- [ ] Signed desired-config применяет только валидный Xray JSON и соблюдает loopback listener.
- [ ] Metrics, user/inbound history, live status, control restart/ACK, profile attestation.
- [ ] UI status честно отражает verified suite/TLS; permissions owner/admin/viewer сохраняются.
- [ ] Legacy-клиенты/ноды работают только пока разрешено, v2-нода не делает downgrade.

### 16.5. Acceptance evidence (хранить для каждого milestone)

- Commit SHA и CI run URL для **обоих** репозиториев.
- Repro command, тестовая VPS/версии Go/OpenSSL/proxy, binary hash.
- Контрольный набор interop vectors и результаты cryptographic KAT.
- Packet/TLS negotiation report (без private keys), подтверждение фактической группы.
- Logs действий, подписи команды и applied revision (с редактированием секретов).
- Стресс-тесты и latency regression, детальный rollback/recovery report.

Нельзя ставить [x] только по наличию исходника, user story, документа или одной ручной проверки.

## 17. Риски и принятые меры

| Риск | Контрмеры |
| --- | --- |
| Панель не поддерживает PQ TLS на proxy | Не включать strict; заменить/обновить proxy в отдельном PR |
| Новая библиотека оказалась неаудированной | Независимые vectors, supply-chain review, migration PoC, выбор поддерживаемой версии |
| Go 1.23 несовместим со стандартным `crypto/mldsa` | Обновить до Go 1.27+ и весь CI/билд заранее |
| Rust/OpenSSL ABI/linkage failure | PoC, pin lib dependencies, проверка `openssl version` в runtime |
| Сломанная canonicalization | Exact binary layout, sign bytes before parsing, golden Rust↔Go vectors |
| Несанкционированный control через metrics key | Least privilege, purpose separation или owner-enforced signing service |
| Потеря PQ private key | Backup/restore, staged rotation, operator-mediated recovery |
| Неатомарный downgrade lock | Durable minSuite Node+DB, двухфазный protocol, fault injection |
| Большие подписанные payload и DoS | Limits, bounded allocations, streaming where possible, perf tests |
| CDN скрывает отсутствие PQ на origin | Определить границы TLS и enforce на всех обязательных сегментах |
| Сломан offline enforcement | Не изменять admission algorithm, проверить guard в изоляции |
| Непроверенная «зелёная» телеметрия | Отдельно показывать configured/negotiated/verified/applied с timestamps |
| Rollback старого Node после cutover | Запретить v1 fallback; recovery только через owner/console |

## 18. Принципиальные решения, которые фиксируются ДО implementation PR

- [ ] Подтвердить формат точных signed bytes (`3.3`) и лимиты/JSON parsing rules.
- [ ] Утвердить single pair vs purpose-separated per-agent keys и permissions.
- [ ] Выбрать audited/supported Rust ML-DSA-65 implementation + сборочный image.
- [ ] Выбрать и протестировать реальный TLS terminator и URL node-only API.
- [ ] Зафиксировать методы pinning панели при первичной установке и legacy migration.
- [ ] Утвердить minSuite и two-phase activation protocol + out-of-band recovery.
- [ ] Утвердить apply/ACK/anti-replay semantics и исчерпывающий перечень команд.
- [ ] Согласовать performance budgets, SLO на policy apply, наблюдаемость и критерии остановки rollout.
- [ ] Включить ключи, сертификаты и криптографические metadata в инвентаризацию секретов и backup policy.

## 19. Definition of Done — единственный смысл «готово»

P0 **Hybrid Post-Quantum Security** можно закрыть только после одновременного выполнения **всех** пунктов:

1. Две независимые библиотечные подписи над одними exact bytes для всех определённых security-critical сообщений **в обоих направлениях**.
2. В production-canary v2 messages с одной подписью, иной ключевой эпохой или старой suite **не принимаются**.
3. HTTPS от Node к доверенному proxy/API реально использует TLS 1.3 + X25519MLKEM768, в строгом режиме downgrade не работает; проверен trust path.
4. Все новые и обновлённые ноды умеют безопасную dual identity enrollment/rotation и не теряют minSuite на рестарте.
5. Offline guard и отказоустойчивость не регрессируют, особенно применяемые Xray конфиги и прекращение VPN-трафика отключённого пользователя.
6. Успешные real-node fault tests, ключевой backup/restore, автоматизированные negative tests, interop vectors и CI main обоих репозиториев.
7. Есть документация, runbooks и честный UI криптографического состояния; нет private-key leakage и неподтверждённых заявлений «quantum safe».
8. Подписаны design/security review, canary deployment и staged rollout evidence с привязкой к точным коммитам.

**До полного Done статус — IN PROGRESS, NOT PRODUCTION-ACCEPTED.**

## 20. Первый практический шаг

**Начать с PR 01 и PR 02, не с массового изменения production Node.**

1. Согласовать `XSP_V2_WIRE_SPEC.md` с бинарной кодировкой, domain separation, key purposes, strict errors и signing test vectors.
2. Выбрать поддерживаемую ML-DSA реализацию для Rust; закрепить Go ≥1.27 и OpenSSL/proxy PoC.
3. Добиться bidirectional cross-language signing verification (Rust→Go, Go→Rust) с обеими обязательными подписями.
4. Заложить unit/negative tests в CI; ограничить изменения криптографическим foundation.
5. Только после успешного gate переходить к DB, secure agent, API и управляемой миграции.

---

## Appendix A. References / original sources

- FIPS 204 (ML-DSA): https://csrc.nist.gov/pubs/fips/204/final
- FIPS 203 (ML-KEM): https://csrc.nist.gov/pubs/fips/203/final
- RFC 10024 (X25519MLKEM768): https://www.rfc-editor.org/info/rfc10024/
- Go 1.27 (crypto/mldsa): https://go.dev/doc/go1.27
- Go crypto/tls: https://pkg.go.dev/crypto/tls
- OpenSSL 3.5 release: https://openssl-library.org/post/2025-04-08-openssl-35-final-release/
- Nexus [Node identity security](SECURITY_NODE_IDENTITY.md)
- Nexus [Autonomous nodes](AUTONOMOUS_NODES.md)
- Nexus [Enterprise roadmap](ENTERPRISE_ROADMAP.md)

## Appendix B. Change log

- **2026-10-25:** создан полный план XSP-v2 для Nexus и Node. **Документация, реализация не начата.**
