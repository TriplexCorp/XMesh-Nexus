# Аудит JavaScript панели

Проверены все исходные JS-модули из `frontend/js/`: подключения в HTML, публичные API модулей, взаимодействие с глобальным состоянием, записи CSS-переменных/атрибутов, наблюдатели DOM, позиционирование, окна и обработчики событий. Это карта ответственности; результаты браузерных проверок фиксируются отдельно и не подменяются анализом исходников.

## Найденные архитектурные причины

1. `core/ui-builder.js` повторно классифицировал страницы после рендера и каждой мутации DOM. Наличие `canvas`/`table` меняло тип всей рабочей области, произвольные `div`/`section` сканировались на метрики, а контейнеры `.two/.three/.four/.grid/.cards` получали правила low-count на основании состава потомков и текущего computed display. Это делало layout зависимым от содержимого и порядка выполнения наблюдателей. Внешних потребителей `XMeshUIBuilder` не было. Файл удалён; вид рабочей области и коллекций теперь задают маршруты и шаблоны.
2. Конструктор XRAY STUDIO имел `div`-overlay, переносимый в созданный `body`-portal ради фона. `MutationObserver` возвращал этот узел обратно. Появилась отдельная система позиционирования и жизненного цикла окна. Overlay заменён нативным `dialog`: top layer, focus trap, Escape, возврат фокуса и единый shared viewport-контракт; перенос DOM и наблюдатель удалены.
3. Client Routing повторно загружал CSS через JS: сравнивал canonical URL с историческим плоским URL и мог заменить уже корректно подключённый stylesheet. Рядом оставался пустой `ensureCriticalStyles`. Оба механизма удалены: entrypoint владеет подключением assets и их версиями.
4. Security сначала рендерил сессии внутри policy, затем находил заголовок по русскому тексту и переносил сессии в соседнюю карточку. Теперь policy и sessions сразу рендерятся в свои явные контейнеры. Подтверждение завершения сессий использует общий диалог панели. Отдельный feedback DOM/timer и неиспользуемый экспорт `XMeshFeedback` удалены: сообщения использует общий toast с поддержкой top layer.
5. Unified Select ограничивал высоту выпадающего списка независимо от фактически доступного места, хотя направление выбирал по другой высоте. Dropdown мог выйти из viewport; Escape мог одновременно закрыть родительское окно. Высота теперь ограничена доступной стороной, ширина — viewport, Escape закрывает только внутренний popup, Tab возвращает точку отсчёта клавиатурной навигации к trigger.
6. Anti-sharing dialog мог после асинхронной загрузки пользователя A заменить уже открытые данные пользователя B. Введён номер запроса; устаревший ответ не рендерится. Добавлена явная связь заголовка с окном и сохранение фокуса после замены содержимого. TLS-диалог возвращает фокус к инициатору.

## Карта ответственности

| Область | Владелец JS | Граница |
| --- | --- | --- |
| Appearance | `core/app.js`: настройки и применение root tokens/атрибутов | Не определяет сетки по DOM; foundation CSS интерпретирует tokens |
| Маршрут и workspace | `core/app.js`: таблица маршрутов и render | Явные `data-workspace`; feature не выбирает геометрию shell |
| Базовые формы и CRUD | `core/app.js`: field/read/modal | Бизнес-значения и семантика формы; внешний вид у shared components |
| Select | `core/unified-selects.js` | Улучшение native select, popup, клавиатура; не управляет страницами |
| Локализация | `core/i18n.js` | Перевод текста/атрибутов; не назначает layout |
| Специализированные редакторы | `features/xray-studio/*`, `features/routing/client-routing.js`, `features/subscriptions/subscription-studio.js` | Только собственное состояние, формы, документы и специализированный canvas |
| Auth/MFA/security | `auth/*` | Сессионные API, формы, локальные состояния; shared controls и modal geometry |
| Доменный контекст | `features/users/*`, `features/nodes/*` | Сохранение контрактов пользователей/узлов; без собственных тем shell |

## Проверенная инвентаризация

| Модули | Назначение и решение |
| --- | --- |
| `core/app.js` | Bootstrap, маршруты, API, CRUD, appearance, страницы. Обширный монолит остаётся отдельным долгом; геометрию маршрутов надо объявлять явно |
| `core/ui-builder.js` | Удалён: отсутствовали внешние потребители; layout inference не нужен |
| `core/unified-selects.js` | Сохранён: доступный native-value select. Исправлены viewport/клавиатура |
| `core/i18n.js` | Сохранён: наблюдатель необходим для асинхронного перевода, не заменяет layout |
| `core/qr-code.js` | Сохранён: локальная библиотека QR для MFA без внешнего запроса секрета |
| `auth/login.js` | Сохранён: password/MFA state, challenge и redirect |
| `auth/mfa-ui.js` | Сохранён: включение/отключение MFA, QR и recovery codes |
| `auth/security-ui.js` | Устранён перенос сессий по текстовому поиску; общие подтверждения |
| `features/nodes/diagnostics.js` | Рабочие API diagnostics/HWID; детальная проверка страницы — в общем аудите |
| `features/nodes/node-bootstrap-v6.js` | Функциональная спецификация/bootstrap node; сохранена |
| `features/nodes/node-dialogs.js` | Функциональные create/edit adapters; не удаляются как «мёртвые стили» |
| `features/nodes/node-geodata.js` | Формы и API GeoData; сохранены |
| `features/nodes/node-routing.js` | Формы и API node routing; сохранены |
| `features/users/client-config.js` | Построение/экспорт клиентского JSON; не менять ради дизайна |
| `features/users/user-create-policy-v6.js` | Duration/calendar semantics; сохраняет существующий payload дней |
| `features/users/user-editor-draft.js` | Единый Save для device limit/squads/settings, предотвращает старые immediate writes |
| `features/users/user-fingerprint-override.js` | Индивидуальный fingerprint и наследование user → host → chrome; сохраняет API-контракт |
| `features/users/user-sharing-context.js` | Явно экспортирует уже разрешённый клиентский snapshot для anti-sharing; не новый cache/API |
| `features/users/user-sharing-risk.js` | Анализ подтверждённого трафика/HWID, таблица/детали; исправлена гонка async dialog |
| `features/routing/client-routing.js` | Независимый draft/валидация/назначения; удалена динамическая подмена CSS и пустой fallback |
| `features/subscriptions/subscription-studio.js` | Конфигурация публичного портала, preview и issuer; preview имеет собственную тему продукта, а не новую тему панели |
| `features/subscriptions/subscription-portal.js` | Публичная subscription surface, подключается шаблоном портала, а не dashboard HTML |
| `features/xray-studio/xray-json-intelligence.js` | Семантическая диагностика конфигурации; сохранена |
| `features/xray-studio/xray-json-diagnostics.js` | Синтаксис, строки, gutter и hot-fix; сохранены |
| `features/xray-studio/xray-studio-composer.js` | Чистые функции матрицы протоколов/построения документа; сохранены |
| `features/xray-studio/xray-studio-dialogs.js` | Native dialog с формами/очередью/валидацией; shared geometry задаёт CSS |
| `features/xray-studio/xray-studio-hosts.js` | Public endpoints профиля; сохранены API и metadata |
| `features/xray-studio/xray-studio-tools.js` | Intentional JSON mutations, undo/redo, generators; не смешивается с page geometry |
| `features/xray-studio/xray-studio-v4.js` | Главный editor: документы, selection, draft и inspector. Удалён portal для modal, сохранены создание/отмена и async-generation guard |
| `features/xray-studio/xray-studio-protocol-tls.js` | Протокол/транспорт и TLS-политики; сохранены |
| `features/xray-studio/xray-studio-tls-dialog.js` | Guided TLS form и точечный commit inbound; добавлен возврат фокуса |
| `features/xray-studio/xray-studio-xhttp-expert.js` | Advanced XHTTP поля; сохранены |
| `features/xray-studio/xray-studio-xhttp-strict.js` | XHTTP schema constraints; сохранены |
| `features/xray-studio/xray-xhttp-core-validator.js` | Дополнение validator для актуального core schema; сохранено |

## Что намеренно не удалялось

- Измерения trigger в select/tooltip, viewport-позиционирование feedback и измерения полотна для SVG-графиков нужны локальным компонентам. Они не выбирают layout произвольных `div` и не являются прежним builder.
- Наблюдатели i18n и select обслуживают конкретную функциональность асинхронного DOM. Сами по себе они не являются layout inference.
- User/node decorators всё ещё опираются на глобальные lexical bindings `app.js`, capture handlers и adapters. Это работающая функциональность со значимыми API-контрактами, а не доказанно мёртвый код. Их последующее выделение в lifecycle-модули требует отдельной миграции с поведенческими тестами.
- Название версии в имени модуля само по себе не доказывает неиспользуемость. Подключённые TLS/XHTTP/user adapters нельзя удалять только по суффиксам `v4/v6`.

## Оставшийся долг

`app.js` следует постепенно разделять на маршруты/appearance/API/доменные редакторы, сохраняя текущие контракты и используя явный mount/unmount. Сейчас исправлены причины нестабильной геометрии, а не переписана бизнес-логика всех модулей. Следующая архитектурная граница — заменить доменные document-wide observers явными lifecycle hooks после render/modal; это не нужно для назначения layout.
