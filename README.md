# XMesh Nexus

<p align="center">
  <strong>Профессиональный self-hosted control plane для Xray-инфраструктуры.</strong><br>
  Ноды, пользователи, подписки, XRAY STUDIO, XHTTP, FinalMask, маршрутизация, аналитика, обновления и защищённый control plane — в одной панели.
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-6.0.0-6f42c1?style=for-the-badge">
  <img alt="Backend" src="https://img.shields.io/badge/backend-Rust%20%2F%20Axum-111827?style=for-the-badge">
  <img alt="Data plane" src="https://img.shields.io/badge/data%20plane-Xray--core-2563eb?style=for-the-badge">
  <img alt="Deploy" src="https://img.shields.io/badge/deploy-Docker%20Compose-2496ed?style=for-the-badge">
  <img alt="Languages" src="https://img.shields.io/badge/UI-RU%20%2F%20EN-16a34a?style=for-the-badge">
</p>

<p align="center">
  <a href="#быстрый-старт"><strong>Быстрый старт</strong></a> ·
  <a href="#возможности"><strong>Возможности</strong></a> ·
  <a href="docs/README.md"><strong>Документация</strong></a> ·
  <a href="docs/ENTERPRISE_ROADMAP.md"><strong>Roadmap</strong></a> ·
  <a href="README.en.md"><strong>English</strong></a>
</p>

---

## Управляйте инфраструктурой, а не десятками VPS вручную

**XMesh Nexus** превращает набор отдельных Xray-серверов в управляемую инфраструктуру с единым control plane.

Вместо постоянных SSH-сессий, ручного редактирования JSON, отдельных скриптов для пользователей, сертификатов, статистики и обновлений оператор получает одну панель, в которой можно:

- подключать и обслуживать Xray-ноды;
- создавать пользователей, группы и ограничения доступа;
- собирать сложные Xray-профили через **XRAY STUDIO**;
- настраивать XHTTP, TLS, REALITY, FinalMask и маршрутизацию;
- выдавать публичные подписки и нативный Xray JSON;
- видеть реальный runtime, версии, трафик и телеметрию;
- управлять обновлениями панели, Agent и Xray;
- защищать административный и node-control контур с RBAC, MFA, signed identity и v6 strict-PQ transport.

> **Важно:** XMesh Nexus — это **control plane**, а не VPN data plane. Пользовательский VPN-трафик обрабатывает **Xray-core на ваших VPS-нодах**. Это self-hosted инфраструктурный продукт: серверы, DNS и сеть остаются под вашим контролем.

---

## Почему XMesh Nexus

| Ручная эксплуатация | XMesh Nexus |
| --- | --- |
| Конфигурация Xray отдельно на каждой VPS | **XRAY STUDIO**, профили и управляемая доставка конфигурации |
| SSH для каждого обновления | Управляемые **Agent / Xray / panel updates** с состоянием операции |
| Пользователи и лимиты в самописных скриптах | Пользователи, squads, сроки, квоты, трафик и подписки в одной модели |
| Один и тот же `/xhttp` и шаблонные параметры у всех | Криптографически случайные XHTTP Path и randomized configuration helpers |
| Advanced XHTTP приходится писать вручную | Полный карточный **XHTTP constructor** с Session ID, padding, uplink и XMUX |
| TLS/REALITY легко сломать «умной» автоматикой | **Security selector — источник истины:** TLS / REALITY / NONE выбирает оператор |
| Клиентские конфиги собираются руками | **SUBSCRIPTION STUDIO** + нативный Xray JSON + публичный портал |
| Серверные и клиентские маски смешиваются | Раздельные `finalmask` / `xmesh.clientFinalmask` и compatibility-aware UI |
| Разрозненные логи и счётчики | Node/system telemetry, Xray counters, user/inbound traffic и история |
| Панель торчит напрямую наружу | Loopback backend + Nginx HTTPS + случайный dashboard path |
| Простая bearer-модель нод | Signed Node identity/commands + v6 strict-PQ operational control path |

---

## Возможности

### Полная функциональная матрица

| Подсистема | Что умеет XMesh Nexus |
| --- | --- |
| **Dashboard** | Сводное состояние инфраструктуры, пользователей, нод и operational signals |
| **Nodes** | Bootstrap/enrollment, online state, Agent/Xray versions, desired/applied state, обновление Agent/Xray, restart/operations, traffic/quota, diagnostics, telemetry |
| **Users** | Создание и редактирование, enabled/disabled, expiry, traffic limits, subscription access, подробная карточка, индивидуальный uTLS fingerprint |
| **Squads** | Группировка пользователей и централизованное управление назначениями |
| **Hosts** | Публичные endpoint-параметры, адрес/домен/порт, TLS/REALITY client metadata, fingerprint, связь с инфраструктурой |
| **XRAY STUDIO** | Composer, формы, ручной JSON, диагностика, профили, transport/security settings, advanced tools |
| **XHTTP** | `auto/packet-up/stream-up/stream-one`, random Path, headers, padding, Session ID, sequence, uplink, tuning, XMUX, H2/download settings, randomized profile |
| **FinalMask** | TCP/UDP/QUIC каталог, server/client separation, compatibility filtering, random secrets/ranges/payloads |
| **Routing** | Отдельные node-routing и client-routing поверхности, GeoIP/GeoSite integration |
| **Subscriptions** | Independent tokens, revoke, публичный HTML-портал, native Xray JSON, QR/copy, RU/EN, client apps, support links, User-Agent negotiation |
| **Analytics** | Node RX/TX, system metrics, Xray runtime, per-user/per-inbound traffic, исторические измерения |
| **Security** | RBAC, observer least privilege, TOTP MFA/recovery, sessions, Redis login throttling, audit/security boundaries, signed node identity |
| **Updates** | Owner-authorized panel update, managed Agent update, managed Xray update, runtime version confirmation |
| **v6 POSTQUANTUM** | Dedicated XSP-v2 strict-PQ Nexus↔Agent operational path с fail-closed policy и evidence-bound activation |

---

## XRAY STUDIO — не «форма поверх JSON», а полноценная рабочая среда

XRAY STUDIO создан для двух типов работы одновременно: быстро собирать типовые профили и не мешать эксперту работать с реальным Xray JSON.

В Studio доступны:

- Composer и структурированный редактор;
- ручной JSON;
- syntax/semantic diagnostics и targeted fixes;
- несколько inbound в конфигурации;
- transport-aware параметры;
- TLS и REALITY;
- XHTTP constructor;
- FinalMask;
- расширенные клиентские параметры;
- проверка известных несовместимых комбинаций.

### Security выбирает оператор

Панель **не угадывает TLS по протоколу или транспорту**.

| `streamSettings.security` | Что происходит |
| --- | --- |
| `tls` | TLS certificate mode активен, `tlsSettings` доступны |
| `reality` | используется REALITY, certificate TLS не включается автоматически |
| `none` | stream TLS выключен |

Поэтому advanced-сценарии вроде **VLESS + XHTTP + NONE** не ломаются «умной» автоматикой — например, когда оператор намеренно использует VLESS Encryption.

Подробно: [XRAY STUDIO Operator Guide](docs/XRAY_STUDIO_GUIDE.md).

---

## XHTTP — полноценный конструктор

XHTTP больше не ограничен полями `path` и `mode`.

Карточное меню в стиле FinalMask покрывает реальный SplitHTTP/XHTTP surface:

- `auto`, `packet-up`, `stream-up`, `stream-one`;
- Path / Host / Mode;
- **криптографически случайный Path** вместо одинакового `/xhttp`;
- browser headers и собственный headers JSON;
- `xPaddingBytes`, placement/method/key/header, obfuscation;
- `noGRPCHeader` / `noSSEHeader`;
- Session ID placement/key/table/length;
- sequence placement/key;
- uplink method/data placement/key/chunk size;
- packet-up и stream-up tuning;
- полный XMUX;
- `serverMaxHeaderBytes`;
- `downloadSettings` и `h2Params`;
- **Full randomized profile** с preview перед применением;
- полный Advanced JSON для редких сценариев.

При этом существующий custom Path не меняется сам по себе при обычном редактировании.

---

## FinalMask — TCP, UDP и QUIC

В XRAY STUDIO доступен широкий FinalMask-каталог с разделением серверной и клиентской стороны.

| Направление | Доступные семейства |
| --- | --- |
| **TCP** | Sudoku, Header Custom, Fragment, XMC, Filter |
| **UDP** | Salamander/Gecko, Sudoku, Header Custom, mKCP Legacy, Noise, `udphop`, XDNS, XICMP, Realm, Filter |
| **QUIC** | client `quicParams` |

Неподходящие комбинации могут оставаться видимыми, но блокируются с объяснением причины. Для новых базовых пресетов генератор больше не оставляет всем одинаковые примеры: Fragment, Noise и Header Custom получают randomized values, а Sudoku/Salamander используют криптографические секреты.

Матрица совместимости: [FINALMASK_COMPATIBILITY.md](docs/FINALMASK_COMPATIBILITY.md).

---

## Пользователи, Hosts и индивидуальный fingerprint

Fingerprint работает на двух уровнях:

```text
individual user fingerprint
          ↓
     host fingerprint
          ↓
        chrome
```

- Host по умолчанию реально сохраняет `chrome`, а не пустое значение с визуальной подсказкой.
- В карточке пользователя есть индивидуальный override.
- Первый вариант — **«По умолчанию»**: он наследует fingerprint хоста.
- Если host fingerprint изменится позже, пользователь на «По умолчанию» автоматически наследует новое значение.
- Custom user fingerprint влияет только на клиентский конфиг этого пользователя и не меняет Host.

---

## SUBSCRIPTION STUDIO

Nexus умеет быть не только редактором Xray, но и полноценной системой выдачи клиентских конфигураций.

### Публичный портал

SUBSCRIPTION STUDIO управляет реальным публичным порталом:

- название/branding;
- цвета;
- optional logo;
- RU/EN контент;
- статус подписки;
- трафик и срок действия;
- QR;
- copy-link;
- support links;
- встроенные и custom client apps.

### Native Xray JSON

Генератор формирует клиентские конфигурации для реализованных protocol families, включая VLESS, VMess, Trojan, Shadowsocks/SS2022, Hysteria2 и MASQUE — при условии корректных transport/security settings и поддержки конкретным клиентом.

Система не заявляет магическую совместимость со всеми существующими Xray-функциями и всеми third-party clients: неподдерживаемые или неполные комбинации должны fail closed.

Документы: [SUBSCRIPTION_SECURITY.md](docs/SUBSCRIPTION_SECURITY.md) · [XRAY_CLIENT_EXPORT_MATRIX.md](docs/XRAY_CLIENT_EXPORT_MATRIX.md).

---

## Nodes: от bootstrap до runtime evidence

Нода в XMesh — это не просто IP-адрес в таблице.

Панель умеет работать с:

- отдельной identity каждой VPS;
- bootstrap/enrollment;
- Agent heartbeat;
- Agent version;
- Xray version и process state;
- desired/applied configuration revisions;
- profile/application attestation where available;
- system/network telemetry;
- traffic accounting и quota state;
- managed Agent/Xray updates;
- operational errors и diagnostics.

**Queued ≠ completed.** Успешная постановка restart/update/config request в очередь не считается доказательством результата. Финальный статус проверяется по свежему runtime/heartbeat evidence.

---

## Routing, GeoData и аналитика

XMesh разделяет маршрутизацию ноды и клиента.

- **Node Routing** — Xray routing на managed VPS.
- **Client Routing** — правила, которые могут проектироваться в client JSON.
- **GeoData** — GeoIP/GeoSite sources и operational state.
- **Statistics** — node RX/TX, system metrics, Xray/user/inbound counters и исторические значения.

Документы: [NODE_ROUTING.md](docs/NODE_ROUTING.md) · [CLIENT_ROUTING.md](docs/CLIENT_ROUTING.md) · [GEODATA_ROUTING.md](docs/GEODATA_ROUTING.md).

---

## Безопасность панели и control plane

Безопасность здесь — часть архитектуры, а не отдельная страница настроек.

### Административный контур

- RBAC;
- read-only/observer boundary;
- TOTP MFA;
- recovery controls;
- session management/revocation;
- Redis-backed login throttling;
- secure cookies;
- encrypted persistent MFA/subscription secrets;
- случайный dashboard path для каждой установки;
- панельное приложение на loopback за Nginx HTTPS.

### Node trust

- signed Node identity;
- подписанные/авторизованные policy/operations;
- runtime verification вместо доверия одной кнопке в UI;
- fail-closed подход к отсутствующим/некорректным security evidence.

### v6 strict-PQ control plane

В v6 production XSP-v2 runtime входит в штатный install/update lifecycle. Operational node control отделён от обычного HTTPS панели и использует dedicated strict-PQ ingress.

Политика включает TLS 1.3 `X25519MLKEM768`, ML-DSA-65 material и отсутствие automatic classical fallback на strict-PQ operational path.

Проект имеет **реальный bounded production activation/finalization evidence для Node 13**, но это намеренно не превращается в маркетинговое утверждение «все ноды уже post-quantum».

Evidence: [XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) · [PQ-only security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [P0-E checkpoint](P0E_CHECKPOINT.md).

---

# Быстрый старт

## Требования

Для автоматической установки панели нужны:

- **Ubuntu 22.04 или 24.04 LTS**;
- публичный домен панели;
- DNS A/AAAA на VPS;
- открытый **TCP/80**;
- открытый **TCP/443**;
- открытый **TCP/8444** для v6 operational node control plane;
- root/sudo;
- outbound Internet access.

Docker, Docker Compose, Nginx и Certbot заранее устанавливать не нужно.

## 1. Установите Git и запустите installer

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
bash install.sh
```

Установщик попросит домен панели и email Let's Encrypt.

Для non-interactive install:

```bash
PANEL_DOMAIN=panel.example.org \
PANEL_ACME_EMAIL=admin@example.org \
bash install.sh
```

## 2. Что установится автоматически

`install.sh`:

- установит Docker Engine + Compose/Buildx;
- установит Nginx mainline и Certbot;
- сгенерирует `.env` и независимые секреты;
- создаст случайный `DASHBOARD_PATH`;
- поднимет PostgreSQL/TimescaleDB и Redis;
- соберёт и запустит Rust API/panel;
- provision v6 strict-PQ foundation;
- запустит обязательный product gateway/ingress;
- выпустит Let's Encrypt certificate;
- настроит HTTP→HTTPS;
- оставит Rust backend на `127.0.0.1`;
- установит host-side update helpers.

## 3. Получите URL и initial credentials

На сервере:

```bash
sudo grep -E '^(ADMIN_USERNAME|ADMIN_PASSWORD|DASHBOARD_PATH)=' .env
```

Откройте:

```text
https://<ваш-домен><DASHBOARD_PATH>
```

Не публикуйте содержимое `.env` в issue, чатах или логах.

## 4. Проверьте сервисы

```bash
docker compose --profile xsp-v2-product ps
sudo nginx -t
```

## 5. Подключите первую Node

В панели:

1. откройте **Узлы / Nodes**;
2. создайте отдельную запись Node;
3. выберите **Подключить ноду и метрики**;
4. выполните выданную bootstrap-команду на VPS-ноды;
5. дождитесь heartbeat;
6. проверьте Agent/Xray version и runtime state.

## 6. Создайте первый профиль

1. откройте **XRAY STUDIO**;
2. выберите protocol/transport;
3. явно выберите Security: TLS / REALITY / NONE;
4. настройте XHTTP/FinalMask при необходимости;
5. сохраните и назначьте профиль Node;
6. дождитесь подтверждённого applied state;
7. создайте Host и User;
8. проверьте subscription/client JSON реальным клиентом.

Полная установка и troubleshooting: [docs/INSTALLATION.md](docs/INSTALLATION.md).

---

## Архитектура

```text
                       ┌─────────────────────────────┐
                       │         Administrator       │
                       └──────────────┬──────────────┘
                                      │ HTTPS :443
                                      ▼
                       ┌─────────────────────────────┐
                       │      Nginx + Let's Encrypt  │
                       └──────────────┬──────────────┘
                                      │ loopback
                                      ▼
┌────────────────┐      ┌─────────────────────────────┐      ┌────────────────┐
│ PostgreSQL /   │◄────►│  XMesh Nexus · Rust/Axum    │◄────►│     Redis      │
│ TimescaleDB    │      │  users · nodes · configs    │      │ auth/throttle  │
└────────────────┘      └──────────────┬──────────────┘      └────────────────┘
                                      │
                         control plane│
                                      │ strict-PQ v6 :8444
                                      ▼
                       ┌─────────────────────────────┐
                       │       XMesh Node / Agent    │
                       └──────────────┬──────────────┘
                                      │ manages
                                      ▼
                       ┌─────────────────────────────┐
                       │          Xray-core          │
                       │  TLS/REALITY · routing      │
                       │  XHTTP · FinalMask · stats  │
                       └──────────────┬──────────────┘
                                      │ VPN traffic
                                      ▼
                               Client devices
```

---

## Обновления

Для установленной панели предусмотрен **owner-authorized web update**. API не получает Docker socket и не выполняет arbitrary shell: он ставит фиксированный update request, а root-owned systemd worker запускает `xmeshctl --web-update` с lock и PostgreSQL backup перед pull/rebuild.

`queued` / HTTP `202` означает **только постановку запроса в очередь**. После update обязательно проверяется финальный status и фактически запущенная версия.

Подробнее: [PANEL_UPDATE_AND_TELEMETRY.md](docs/PANEL_UPDATE_AND_TELEMETRY.md).

---

# Документация

Теперь README — это входная страница продукта, а не место хранения всех инженерных деталей. Полная документация вынесена в `docs/`.

| Документ | Что внутри |
| --- | --- |
| **[Documentation Index](docs/README.md)** | Навигация по всей актуальной документации |
| **[Product Guide](docs/PRODUCT_GUIDE.md)** | Полный функционал панели и границы подсистем |
| **[Installation & Operations](docs/INSTALLATION.md)** | Установка, порты, HTTPS, update, backup, troubleshooting |
| **[XRAY STUDIO Guide](docs/XRAY_STUDIO_GUIDE.md)** | Security semantics, XHTTP, FinalMask, fingerprint, client projection |
| **[Development Checkpoint](docs/DEVELOPMENT_CHECKPOINT_2026-10-31.md)** | Критичные решения и контракты для будущей разработки |
| [FinalMask Compatibility](docs/FINALMASK_COMPATIBILITY.md) | Server/client/transport compatibility |
| [Client Export Matrix](docs/XRAY_CLIENT_EXPORT_MATRIX.md) | Поддержка client JSON projection |
| [Autonomous Nodes](docs/AUTONOMOUS_NODES.md) | Agent/node operation model |
| [Panel Update & Telemetry](docs/PANEL_UPDATE_AND_TELEMETRY.md) | Update workflow и telemetry/accounting |
| [Node Identity Security](docs/SECURITY_NODE_IDENTITY.md) | Signed node identity/trust |
| [Subscription Security](docs/SUBSCRIPTION_SECURITY.md) | Public subscription security |
| [Node Routing](docs/NODE_ROUTING.md) | Node-side routing |
| [Client Routing](docs/CLIENT_ROUTING.md) | Client routing |
| [GeoData Routing](docs/GEODATA_ROUTING.md) | GeoIP/GeoSite behavior |
| [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) | Engineering/release readiness |
| [Strict-PQ Production Evidence](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) | Bounded production activation evidence |

---

## Технологии

| Слой | Стек |
| --- | --- |
| Backend | Rust · Tokio · Axum |
| Persistent data | PostgreSQL 18 · TimescaleDB |
| Temporary/auth state | Redis 7 |
| VPN data plane | Xray-core |
| Node control | XMesh Node / Agent |
| Deployment | Docker Engine · Docker Compose |
| Public web | Nginx · Let's Encrypt / Certbot |
| Control-plane PQ | XSP-v2 · TLS 1.3 hybrid ingress · ML-DSA-65 |
| Frontend | Browser-native HTML/CSS/JavaScript · RU/EN |

---

## Честные ограничения

Профессиональная панель должна не только показывать кнопки, но и честно обозначать границы.

- XMesh не предоставляет VPS автоматически — инфраструктура остаётся вашей.
- DNS, firewall, NAT и открытые порты всё равно должны быть настроены корректно.
- Editor support не означает совместимость любой комбинации с любым third-party клиентом.
- Saved JSON не является доказательством, что Node применил конфигурацию.
- Green CI не доказывает, что конкретный production VPS обновился.
- Preview SUBSCRIPTION STUDIO не доказывает Internet reachability публичного URL.
- Strict-PQ activation evidence относится к конкретному bounded rollout/evidence, а не автоматически ко всем Node.
- Root на Nexus host остаётся высокодоверенной ролью; это не HSM boundary.

XMesh строится вокруг **явного состояния, проверяемых операций и fail-closed поведения**, а не вокруг скрытия таких ограничений.

---

## Статус разработки

XMesh Nexus активно развивается. Основные feature-пути покрываются большим Backend CI: frontend regression checks, Rust formatting/tests, strict Clippy, Docker build и disposable PostgreSQL/Redis API integration.

Актуальная инженерная готовность, release gates и незавершённые задачи фиксируются в [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md), а текущие UX/implementation invariants — в [Development Checkpoint](docs/DEVELOPMENT_CHECKPOINT_2026-10-31.md).

---

<p align="center">
  <strong>XMesh Nexus — один control plane для инфраструктуры, которую раньше приходилось собирать из SSH, JSON, скриптов и отдельных панелей.</strong>
</p>
