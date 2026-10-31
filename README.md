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
| TLS/REALITY легко сломать неявной автоматикой | Явный Security selector: TLS / REALITY / NONE |
| Клиентские конфиги собираются руками | **SUBSCRIPTION STUDIO** + нативный Xray JSON + публичный портал |
| Серверные и клиентские маски смешиваются | Раздельные `finalmask` / `xmesh.clientFinalmask` и compatibility-aware UI |
| Разрозненные логи и счётчики | Node/system telemetry, Xray counters, user/inbound traffic и история |
| Панель и служебные API требуют разных публичных портов | **Один публичный TCP/443:** SNI multiplexer разделяет web и strict-PQ control plane |
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
| **v6 POSTQUANTUM** | XSP-v2 strict-PQ Nexus↔Agent operational path с fail-closed policy и evidence-bound activation |

---

## XRAY STUDIO — полноценная рабочая среда

XRAY STUDIO сочетает быстрый конструктор и работу с реальным Xray JSON.

В Studio доступны:

- Composer и структурированный редактор;
- ручной JSON;
- syntax/semantic diagnostics и targeted fixes;
- несколько inbound в одной конфигурации;
- transport-aware параметры;
- TLS и REALITY;
- XHTTP constructor;
- FinalMask;
- расширенные клиентские параметры;
- проверка известных несовместимых комбинаций.

### Security выбирает оператор

| `streamSettings.security` | Что происходит |
| --- | --- |
| `tls` | TLS certificate mode активен, `tlsSettings` доступны |
| `reality` | используется REALITY |
| `none` | stream TLS выключен |

Подробно: [XRAY STUDIO Operator Guide](docs/XRAY_STUDIO_GUIDE.md).

---

## XHTTP — полноценный конструктор

Карточное меню XHTTP покрывает SplitHTTP/XHTTP surface:

- `auto`, `packet-up`, `stream-up`, `stream-one`;
- Path / Host / Mode;
- криптографически случайный Path;
- browser/custom headers;
- `xPaddingBytes`, placement/method/key/header, obfuscation;
- `noGRPCHeader` / `noSSEHeader`;
- Session ID placement/key/table/length;
- sequence placement/key;
- uplink method/data placement/key/chunk size;
- packet-up и stream-up tuning;
- полный XMUX;
- `serverMaxHeaderBytes`;
- `downloadSettings` и `h2Params`;
- Full randomized profile с preview;
- Advanced JSON для редких сценариев.

Существующий custom Path не меняется сам по себе при обычном редактировании.

---

## FinalMask — TCP, UDP и QUIC

| Направление | Доступные семейства |
| --- | --- |
| **TCP** | Sudoku, Header Custom, Fragment, XMC, Filter |
| **UDP** | Salamander/Gecko, Sudoku, Header Custom, mKCP Legacy, Noise, `udphop`, XDNS, XICMP, Realm, Filter |
| **QUIC** | client `quicParams` |

Неподходящие комбинации блокируются с объяснением причины. Для новых базовых пресетов Fragment, Noise и Header Custom получают randomized values, а Sudoku/Salamander используют криптографические секреты.

Матрица: [FINALMASK_COMPATIBILITY.md](docs/FINALMASK_COMPATIBILITY.md).

---

## Пользователи, Hosts и fingerprint

Fingerprint работает по цепочке:

```text
individual user fingerprint
          ↓
     host fingerprint
          ↓
        chrome
```

- Host по умолчанию сохраняет `chrome`.
- У пользователя есть индивидуальный override.
- **«По умолчанию»** наследует fingerprint хоста.
- Изменение host fingerprint автоматически применяется к пользователям без override.
- User override влияет только на клиентский конфиг этого пользователя.

---

## SUBSCRIPTION STUDIO

Публичный портал поддерживает branding, RU/EN, цвета, logo, статус подписки, трафик/expiry, QR, copy-link, support links и встроенные/custom client apps.

Генератор формирует native Xray JSON для реализованных protocol families, включая VLESS, VMess, Trojan, Shadowsocks/SS2022, Hysteria2 и MASQUE — при корректных transport/security settings и поддержке клиента.

Документы: [SUBSCRIPTION_SECURITY.md](docs/SUBSCRIPTION_SECURITY.md) · [XRAY_CLIENT_EXPORT_MATRIX.md](docs/XRAY_CLIENT_EXPORT_MATRIX.md).

---

## Nodes: от bootstrap до runtime evidence

Панель работает с:

- отдельной identity каждой VPS;
- bootstrap/enrollment;
- Agent heartbeat/version;
- Xray version/process state;
- desired/applied revisions;
- profile/application attestation where available;
- system/network telemetry;
- traffic accounting и quota state;
- managed Agent/Xray updates;
- operational errors и diagnostics.

**Queued ≠ completed.** Постановка операции в очередь не считается доказательством результата; финальное состояние проверяется по свежему runtime/heartbeat evidence.

---

## Routing, GeoData и аналитика

- **Node Routing** — Xray routing на managed VPS.
- **Client Routing** — правила для client JSON.
- **GeoData** — GeoIP/GeoSite sources и operational state.
- **Statistics** — node RX/TX, system metrics, Xray/user/inbound counters и история.

Документы: [NODE_ROUTING.md](docs/NODE_ROUTING.md) · [CLIENT_ROUTING.md](docs/CLIENT_ROUTING.md) · [GEODATA_ROUTING.md](docs/GEODATA_ROUTING.md).

---

## Безопасность панели и control plane

### Административный контур

- RBAC и observer boundary;
- TOTP MFA и recovery controls;
- session management/revocation;
- Redis-backed login throttling;
- secure cookies;
- persistent encrypted MFA/subscription secrets;
- случайный dashboard path;
- Rust backend на loopback.

### Node trust

- signed Node identity;
- авторизованные policy/operations;
- runtime verification вместо доверия одной кнопке в UI;
- fail-closed поведение при отсутствующих/некорректных security evidence.

### v6 strict-PQ control plane — тоже через публичный 443

В v6 operational Node control **не требует отдельного публичного порта**.

Один внешний `TCP/443` принимает оба типа соединений. Host-side SNI multiplexer **не завершает TLS**, а только направляет ClientHello:

- обычный SNI домена панели → loopback Nginx TLS для web/admin/subscriptions;
- `node-ingress.xsp.invalid` → отдельный loopback strict-PQ ingress.

Поэтому web-панель и operational control используют один публичный порт, но **не один TLS security boundary**. Strict-PQ ingress по-прежнему самостоятельно требует TLS 1.3 `X25519MLKEM768`, ML-DSA-65 client identity и fail-closed policy.

`8444` остаётся только локальным loopback backend между TCP/443 multiplexer и strict-PQ ingress. **Открывать TCP/8444 в firewall не нужно и нельзя.**

Проект имеет bounded production activation/finalization evidence для Node 13; это не утверждение, что все ноды автоматически активированы в strict-PQ.

Evidence: [XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) · [PQ-only security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [P0-E checkpoint](P0E_CHECKPOINT.md).

---

# Быстрый старт

## Требования

Для автоматической установки панели нужны:

- **Ubuntu 22.04 или 24.04 LTS**;
- публичный домен панели;
- DNS A/AAAA на VPS;
- открытый **TCP/80** для ACME/redirect;
- открытый **TCP/443** для панели, подписок и v6 operational node control plane;
- root/sudo;
- outbound Internet access.

**Отдельный TCP/8444 наружу не открывается.**

Docker, Docker Compose, Nginx, HAProxy и Certbot заранее устанавливать не нужно.

## 1. Установите Git и запустите installer

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
bash install.sh
```

Для non-interactive install:

```bash
PANEL_DOMAIN=panel.example.org \
PANEL_ACME_EMAIL=admin@example.org \
bash install.sh
```

## 2. Что установится автоматически

`install.sh`:

- установит Docker Engine + Compose/Buildx;
- установит Nginx mainline, HAProxy и Certbot;
- сгенерирует `.env` и независимые секреты;
- создаст случайный `DASHBOARD_PATH`;
- поднимет PostgreSQL/TimescaleDB и Redis;
- соберёт и запустит Rust API/panel;
- provision v6 strict-PQ foundation;
- запустит обязательный product gateway/ingress;
- выпустит Let's Encrypt certificate;
- настроит HTTP→HTTPS;
- перенесёт panel TLS termination на loopback `127.0.0.1:8443`;
- оставит strict-PQ ingress только на loopback `127.0.0.1:8444`;
- поднимет единый public TCP/443 SNI multiplexer;
- оставит Rust backend на `127.0.0.1`;
- установит host-side update helpers.

## 3. Получите URL и initial credentials

```bash
sudo grep -E '^(ADMIN_USERNAME|ADMIN_PASSWORD|DASHBOARD_PATH)=' .env
```

Откройте:

```text
https://<ваш-домен><DASHBOARD_PATH>
```

## 4. Проверьте сервисы

```bash
docker compose --profile xsp-v2-product ps
sudo nginx -t
sudo systemctl status xmesh-https-mux --no-pager
sudo ss -ltnp '( sport = :443 or sport = :8444 )'
```

Ожидается: `443` публичный; `8444` — только `127.0.0.1`.

## 5. Подключите первую Node

1. откройте **Узлы / Nodes**;
2. создайте отдельную запись Node;
3. выберите **Подключить ноду и метрики**;
4. выполните bootstrap-команду на VPS-ноды;
5. дождитесь heartbeat;
6. проверьте Agent/Xray version и runtime state.

## 6. Создайте первый профиль

1. откройте **XRAY STUDIO**;
2. выберите protocol/transport;
3. выберите Security: TLS / REALITY / NONE;
4. настройте XHTTP/FinalMask;
5. сохраните и назначьте профиль Node;
6. дождитесь applied state;
7. создайте Host и User;
8. проверьте subscription/client JSON реальным клиентом.

Полная установка: [docs/INSTALLATION.md](docs/INSTALLATION.md).

---

## Архитектура

```text
 Internet
    │
    │ TCP/443 — единственный public HTTPS/control порт
    ▼
┌──────────────────────────────────────────────┐
│ HAProxy SNI multiplexer (TLS passthrough)    │
│                                              │
│ panel.example.org ───────┐                   │
│ node-ingress.xsp.invalid ├──────────────┐    │
└──────────────────────────┼──────────────┼────┘
                           │              │
                 loopback  │              │ loopback
                           ▼              ▼
                  Nginx TLS :8443   strict-PQ ingress :8444
                           │              │
                           ▼              │ XSP-v2
                    XMesh Nexus           │
                    Rust / Axum           │
                           │              │
                PostgreSQL / Redis        ▼
                                      XMesh Agent
                                           │
                                           ▼
                                       Xray-core
                                           │
                                           ▼
                                      VPN clients
```

`8443` и `8444` — **внутренние loopback-порты**, не firewall requirements.

---

## Обновления

Owner-authorized web update не даёт API Docker socket и arbitrary shell. API ставит фиксированный request, а root-owned worker запускает `xmeshctl --web-update` с lock и PostgreSQL backup.

При обновлении host installer также переприменяет single-443 topology и пересоздаёт current v6 product gateway/ingress, чтобы старая public `:8444` mapping не сохранилась после upgrade.

`queued` / HTTP `202` означает только постановку запроса в очередь.

Подробнее: [PANEL_UPDATE_AND_TELEMETRY.md](docs/PANEL_UPDATE_AND_TELEMETRY.md).

---

# Документация

| Документ | Что внутри |
| --- | --- |
| **[Documentation Index](docs/README.md)** | Навигация по актуальной документации |
| **[Product Guide](docs/PRODUCT_GUIDE.md)** | Полный функционал панели и границы подсистем |
| **[Installation & Operations](docs/INSTALLATION.md)** | Установка, public 80/443 topology, update, backup, troubleshooting |
| **[XRAY STUDIO Guide](docs/XRAY_STUDIO_GUIDE.md)** | Security semantics, XHTTP, FinalMask, fingerprint, client projection |
| **[Development Checkpoint](docs/DEVELOPMENT_CHECKPOINT_2026-10-31.md)** | Критичные решения для будущей разработки |
| [FinalMask Compatibility](docs/FINALMASK_COMPATIBILITY.md) | Server/client/transport compatibility |
| [Client Export Matrix](docs/XRAY_CLIENT_EXPORT_MATRIX.md) | Client JSON projection |
| [Autonomous Nodes](docs/AUTONOMOUS_NODES.md) | Agent/node model |
| [Panel Update & Telemetry](docs/PANEL_UPDATE_AND_TELEMETRY.md) | Update workflow и telemetry |
| [Node Identity Security](docs/SECURITY_NODE_IDENTITY.md) | Signed node identity/trust |
| [Subscription Security](docs/SUBSCRIPTION_SECURITY.md) | Subscription security |
| [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) | Engineering/release readiness |
| [Strict-PQ Production Evidence](docs/XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) | Bounded activation evidence |

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
| Public TCP/443 | HAProxy SNI passthrough |
| Panel TLS | Nginx · Let's Encrypt / Certbot |
| Control-plane PQ | XSP-v2 · TLS 1.3 hybrid ingress · ML-DSA-65 |
| Frontend | Browser-native HTML/CSS/JavaScript · RU/EN |

---

## Честные ограничения

- XMesh не предоставляет VPS автоматически.
- DNS, firewall и NAT должны быть настроены корректно.
- Для штатной v6 установки наружу нужны **80/tcp и 443/tcp; 8444/tcp должен оставаться закрытым**.
- Editor support не означает совместимость любой комбинации с любым third-party клиентом.
- Saved JSON не доказывает, что Node применила конфигурацию.
- Green CI не доказывает, что конкретный VPS обновился.
- Strict-PQ evidence относится к конкретному bounded rollout, а не автоматически ко всем Node.
- Root на Nexus host остаётся высокодоверенной ролью; это не HSM boundary.

XMesh строится вокруг **явного состояния, проверяемых операций и fail-closed поведения**.

---

## Статус разработки

Основные feature-пути покрываются Backend CI: frontend regression checks, Rust formatting/tests, strict Clippy, Docker build и disposable PostgreSQL/Redis API integration.

Актуальная готовность и release gates: [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md). Текущие implementation invariants: [Development Checkpoint](docs/DEVELOPMENT_CHECKPOINT_2026-10-31.md).

---

<p align="center">
  <strong>XMesh Nexus — один control plane для инфраструктуры, которую раньше приходилось собирать из SSH, JSON, скриптов и отдельных панелей.</strong>
</p>
