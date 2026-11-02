# Промежуточный checkpoint рефакторинга фронтенда

Дата: 2 ноября 2026 года. Работа остановлена по просьбе пользователя из-за лимита сессии. **Рефакторинг НЕ завершён. Состояние WIP; приложение после изменений ещё не прошло приёмку.**

## Цель и ограничения
Полный аудит и архитектурный рефакторинг всей панели XMesh Nexus: единая foundation → components → layouts → feature geometry, спокойный enterprise интерфейс, работоспособные Appearance/Settings/Nodes/dialogs. Backend API, модели и бизнес-логика сохраняются. Общаться с пользователем только по-русски. Продолжать в существующей рабочей копии, без нового worktree. Не откатывать этот checkpoint.

## Что исследовано
Проверены дерево frontend, HTML entrypoints, все группы CSS/JS, системные/legacy/feature стили, ui-builder, appearance/theme runtime, routes и bindings app.js, модальные окна, source tests и CI. Детальный аудит JS: docs/FRONTEND_JS_AUDIT.md. Карта routes: home, statistics, users, squads, hosts, nodes, templates, profiles, subscription, balancers, clientrouting, tools, admins, security, set. Diagnostics переопределяет tools.

## Найденные архитектурные проблемы
- Legacy styles.css: около 6007 строк/330 КБ, 293 !important, многократные определения shell, controls, theme и feature layouts. Импорт в low-priority layer не изолирует important: layered important перебивает unlayered modern.
- ui-builder: MutationObserver, классификация случайных div/section, определение frame по table/canvas, автоматические metrics/collections/toolbars. Геометрия зависела от структуры DOM.
- Settings: старые display:contents/grid-area против независимых колонок; высокий breakpoint; lower sections отдельными full-width siblings. На 1440 исходная страница около 5586px высоты.
- wrap width cap ограничивал ultrawide; у Nodes toolbar/explorer/results были отдельными полосами, одиночная карточка не имела композиции.
- Feature mini-design systems, повторные skins/радиусы/important, разные viewport ограничения dialogs; composer portal и stats detail измеряли/переносили DOM ради layout.
- CI adapter stage-frontend-compat.sh создавал root aliases и изменял tracked Dockerfile/template; source tests часто проверяли случайные CSS строки.

## Что уже изменено
- app.js: явная карта data-workspace/route, декларативные table/collection/toolbar атрибуты; Settings две независимые stack columns плюс paired lower services; Nodes объединённая toolbar, count/pager без отдельной полосы, semantic identity/summary/metrics/actions; stats detail переведён в native dialog без sourceRect/portal размеров.
- ui-builder.js удалён. ВАЖНО: его подключение в index.html ещё необходимо убрать.
- security-ui: sessions сразу выводятся в правильный контейнер вместо переноса по тексту заголовков. Select popover улучшен для viewport/Escape/Tab; устранены race/focus проблемы detail/TLS.
- XRAY composer переведён в native dialog, удалены body portal/MutationObserver и sv-columns wrapper. Сохраняется функциональная constructor/editor интеграция.
- System foundation/components/layout переписываются на единое владение palette/reset/fonts/material/control/modal/shell/layout. Сохранённые файлы могут быть промежуточными; проверить их полноту перед интеграцией.
- Новые scoped migration CSS извлечены из legacy: overview/statistics/access/hosts/users/security/tools/balancers/notifications и node editor. Это незавершённая миграция: legacy файл пока остаётся, entry imports нужно сверить.
- Существующие feature CSS очищены через PostCSS: сняты geometry !important, surface/radius aliases связаны с nx tokens, устранены exact selector/property повторы, удалены portal/backdrop дубли и произвольные карточные min-height. Требуется rendered regression: механическая очистка сама по себе не доказывает правильность каскада.
- user-create-v3.css, user-create-policy-v6.css, user-create-extra-v7.css объединены в users/user-editor.css; старый user-create блок node-dialogs удалён. Generic confirm primitives переданы system автору; проверить их фактический перенос.
- Source checks массово переведены на canonical paths, удалён stage adapter; новые ownership assertions и frontend-source.cjs ещё в работе.
- Добавлены scripts/test-ui-browser.cjs и scripts/browser/package.json + lock, ещё не прошли итоговый запуск. Добавлен scripts/update-ui-cache.cjs для SHA256 first12 content keys (обычный запуск обновляет, --check проверяет).

## Что работает и доказано
До рефакторинга окружение подготовлено: Node24, Rust1.99.1, PostgreSQL18/TimescaleDB2.30, Redis7, API, frontend packaging. Тогда прошли 154 backend tests, signed node auth integration, RBAC/MFA integration, 7 source/behavior checks, live dashboard/49 assets, повторный install/start.
Во время текущего рефакторинга strict Clippy с all-targets/all-features и -D warnings -D clippy::pedantic -D clippy::nursery -F unsafe-code прошёл (backend не менялся; исходники в staged copy окружения). JS изменяемых модулей проверялись node --check; это не полная функциональная проверка.
**Нельзя переносить успех baseline на новый интерфейс.**

## Реальная браузерная проверка
Chromium /usr/bin/chromium и Playwright доступны. Исходные baseline снимки/метрики сохранены в docs/checkpoints/frontend-baseline. Settings/Nodes: 1440×900,1920×1080,3440×1440. Baseline остальных routes: 1440×900 (см. baseline-routes.json и PNG). На baseline JS errors не было; horizontal document overflow для Settings/Nodes не найден. Это снимки ДО полной CSS миграции. Итоговые темы/sidebar/dialogs и новая геометрия ещё не проверены.

## Известное незавершённое состояние — начать отсюда
1. index.html ещё ссылается на удалённые ui-builder и три user-create CSS. Это известные 404 до интеграции. Не считать текущий frontend рабочим.
2. Завершить перенос legacy feature rules и shared primitives; проверить импортный граф nexus-ui-v3.css. Удалить legacy/styles.css и nexus-v3-workspaces.css только после проверки полноты миграции. Не возвращать старые layers ради зелёных tests.
3. Оставить в index один presentation entry nexus-ui-v3.css; включить все feature CSS через него с явными layers. Удалить legacy inline @import и ui-builder script. Новые Settings/Nodes/user-editor imports обязательны.
4. Login ещё использует собственный stylesheet/palette: план перевести auth/login.css на foundation/components imports и auth-page class, сохранив login/MFA IDs и semantics.
5. Проверить native sv-overlay размеры/закрытие/focus и stats detail после CSS миграции. Feature очистка может потребовать уточнения каскада и viewport scroll.
6. Завершить source test migration без ослабления security/behavior assertions. Некоторые проверки всё ещё ждут старые названия и точные строки/cache keys.
7. Запустить update-ui-cache.cjs после всех импортов, затем --check; проверить production packaging flat aliases, CSS imports и реальные HTTP asset requests.
8. Запустить browser runner на отдельной БД/API: XMESH_UI_DISPOSABLE=1, XMESH_TEST_URL, ADMIN_USERNAME/PASSWORD, CHROMIUM_PATH=/usr/bin/chromium. Не печатать секреты. Runner всё ещё требует отладки/доработки.

## Страницы и режимы для обязательной последующей проверки
ВСЕ routes после миграции: Dashboard, Statistics, Users, Squads, Hosts, Nodes, Templates, XRAY STUDIO, SUBSCRIPTION STUDIO, Balancers, Client Routing, Diagnostics, Admins, Security, Settings, More/secondary; login/auth, create/edit/confirm/dialogs/drawers. Проверить пустые/одиночные/несколько записей Nodes и toolbar; Settings 2 columns natural flow, разумную ширину inputs/sliders/palette. Проверить Classic/Glass/Raised, Dark/Light/Auto, palettes/custom, density, radius/borders/sidebar/default compact, scale/content width/spacing/fonts/motion/hints/glow. Размеры: 1366×768,1440×900,1920×1080,2560×1440,3440×1440,3840×2160. Измерять overflow/clipping/overlap/bounds/empty gaps и смотреть screenshots; зелёного source CI недостаточно.

## Окружение и команды продолжения
Репозиторий /workspace/XMesh-Nexus; вспомогательные setup файлы /workspace/.xmesh-dev (не входят в ZIP, содержат локальные данные). Активация Rust: source /workspace/.xmesh-dev/activate.sh. Build/test через bash /workspace/.xmesh-dev/build.sh build либо test (копирует backend/docs во внешний staging и сохраняет generated Cargo.lock вне Git). Сервисы bash /workspace/.xmesh-dev/start.sh; остановка только своего API stop.sh; credentials local.env нельзя печатать/архивировать. После frontend changes start.sh пересобирает static copy. Docker/local network могут требовать supported require_escalated. api.github.com сейчас заблокирован CONNECT403: optional automatic Xray downloads не проверены; не обходить policy/TLS. Base runtime инструкция cloud-environment-runtime обязательна после возобновления.

## Ещё выполнить
Полный canonical source suite; backend154 tests после финального состояния; relevant signed-node/RBAC/MFA integrations на disposable DB; strict Clippy при изменении backend/новых проблемах (текущий прошёл); production Docker build (ЕЩЁ НЕ ЗАПУСКАЛСЯ в текущем рефакторинге); live application browser matrix и screenshots. Не создавать worktree и не запускать production rollout. Не заявлять завершение до чистой архитектуры+функциональности+реальной browser проверки.

## Точный список текущих изменений Git
Список снят перед созданием checkpoint; сам checkpoint и baseline evidence добавлены дополнительно.

```text
 M .github/workflows/backend-ci.yml
 M .github/workflows/geodata-check.yml
 M .github/workflows/user-create-policy-v6-ci.yml
 M .github/workflows/user-presence-integrity.yml
 M frontend/js/auth/security-ui.js
 M frontend/js/core/app.js
 M frontend/js/core/i18n.js
 D frontend/js/core/ui-builder.js
 M frontend/js/core/unified-selects.js
 M frontend/js/features/routing/client-routing.js
 M frontend/js/features/users/user-sharing-risk.js
 M frontend/js/features/xray-studio/xray-studio-tls-dialog.js
 M frontend/js/features/xray-studio/xray-studio-v4.js
 M frontend/styles/features/nodes/diagnostics.css
 M frontend/styles/features/nodes/node-dialogs.css
 M frontend/styles/features/nodes/node-geodata.css
 M frontend/styles/features/nodes/node-routing.css
 M frontend/styles/features/routing/client-routing.css
 M frontend/styles/features/settings/settings-updates.css
 M frontend/styles/features/squads/squad-editor-premium-v5.css
 M frontend/styles/features/subscriptions/subscription-studio.css
 D frontend/styles/features/users/user-create-extra-v7.css
 D frontend/styles/features/users/user-create-policy-v6.css
 D frontend/styles/features/users/user-create-v3.css
 M frontend/styles/features/users/user-sharing-risk.css
 M frontend/styles/features/xray-studio/xray-studio-hosts.css
 M frontend/styles/features/xray-studio/xray-studio-reality-dialog.css
 M frontend/styles/features/xray-studio/xray-studio-tls-dialog.css
 M frontend/styles/features/xray-studio/xray-studio-v4.css
 M frontend/styles/system/nexus-ui-v3.css
 M frontend/styles/system/nexus-v3-components.css
 M frontend/styles/system/nexus-v3-foundation.css
 M frontend/styles/system/nexus-v3-layout.css
 M scripts/check-admin-security.js
 M scripts/check-agent-update-base.js
 M scripts/check-agent-update.js
 M scripts/check-appearance-surfaces.js
 M scripts/check-balancers-workspace.js
 M scripts/check-client-routing.js
 M scripts/check-crud-dialog-lifecycle.js
 M scripts/check-english-coverage.js
 M scripts/check-host-editor-zones.js
 M scripts/check-i18n.js
 M scripts/check-json-diagnostics.js
 M scripts/check-managed-xray-update.js
 M scripts/check-mfa.js
 M scripts/check-modal-motion.js
 M scripts/check-node-create-action.js
 M scripts/check-node-editor-layout.js
 M scripts/check-node-explorer.js
 M scripts/check-node-grid-layout.js
 M scripts/check-node-hosting-notifications.js
 M scripts/check-node-ip-rotation.js
 M scripts/check-node-live-status.js
 M scripts/check-node-network-traffic.js
 M scripts/check-node-traffic-cutoff.js
 M scripts/check-node-traffic-reset.js
 M scripts/check-node-xray-releases.js
 M scripts/check-notification-center.js
 M scripts/check-repo-layout.js
 M scripts/check-security-audit.js
 M scripts/check-security-center.js
 M scripts/check-security-policy.js
 M scripts/check-settings-update-actions.js
 M scripts/check-statistics-feedback.js
 M scripts/check-studio-dialogs.js
 M scripts/check-studio-protocol-matrix.js
 M scripts/check-subscription-qr.js
 M scripts/check-subscription-security.js
 M scripts/check-subscription-studio.js
 M scripts/check-tech-debt.js
 M scripts/check-ui-system.js
 M scripts/check-unified-selects.js
 M scripts/check-user-create-policy-v6.js
 M scripts/check-user-fingerprint-ownership.js
 M scripts/check-user-presence.js
 M scripts/check-user-quota-preserves-traffic.js
 M scripts/check-viewer-security.js
 M scripts/check-white-label.js
 M scripts/check-xdrive-composer.js
 M scripts/check-xhttp-core-strict.js
 M scripts/check-xhttp-extras.js
 M scripts/check-xray-active-entrypoint.js
 M scripts/check-xray-endpoint-autofill.js
 M scripts/check-xray-host-fingerprint-default.js
 M scripts/check-xray-intelligence.js
 M scripts/check-xray-protocol-tls-policy.js
 M scripts/check-xray-studio-composer.js
 M scripts/check-xray-studio-enterprise.js
 M scripts/check-xray-studio-hosts.js
 M scripts/check-xray-studio-selectors.js
 M scripts/check-xray-studio-wrap-tabs.js
 M scripts/check-xray-tool-actions.js
 D scripts/ci/stage-frontend-compat.sh
 M scripts/test-client-config.js
 M scripts/test-traffic-chart-geometry.js
?? docs/FRONTEND_JS_AUDIT.md
?? docs/checkpoints/frontend-baseline/
?? frontend/styles/features/access/
?? frontend/styles/features/balancers/
?? frontend/styles/features/hosts/
?? frontend/styles/features/nodes/node-editor.css
?? frontend/styles/features/nodes/nodes.css
?? frontend/styles/features/notifications/
?? frontend/styles/features/overview/
?? frontend/styles/features/security/
?? frontend/styles/features/settings/settings.css
?? frontend/styles/features/statistics/
?? frontend/styles/features/tools/
?? frontend/styles/features/users/user-details.css
?? frontend/styles/features/users/user-editor.css
?? frontend/styles/features/users/users.css
?? scripts/browser/
?? scripts/ci/frontend-source.cjs
?? scripts/test-ui-browser.cjs
?? scripts/update-ui-cache.cjs
```
