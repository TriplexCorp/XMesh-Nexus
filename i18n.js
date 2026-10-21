'use strict';
/*
 * XMesh Nexus interface locale (admin UI only).
 * Sources retain Russian text; known UI copy is translated in one centralized
 * catalog instead of scattering language checks through business logic.
 * Translates text/attributes, never form values, JSON, code, or arbitrary user
 * content. A MutationObserver handles asynchronously rendered drawers/dialogs.
 */
window.XMeshI18n=(()=>{
  const key='xmeshNexusLanguage';
  let language='ru';
  try{language=localStorage.getItem(key)==='en'?'en':'ru'}catch(_){}
  const dict=new Map(Object.entries({
    // Navigation and global shell
    'ОБЗОР':'OVERVIEW','Обзор':'Overview','УПРАВЛЕНИЕ':'MANAGEMENT',
    'Управление':'Management','ИНСТРУМЕНТЫ':'TOOLS','Инструменты':'Tools',
    'СИСТЕМА':'SYSTEM','Система':'System',
    'Дашборд':'Dashboard','Главная':'Home','Пользователи':'Users',
    'Клиенты':'Clients','Сквады':'Squads','Хосты':'Hosts','Узлы':'Nodes',
    'Шаблоны':'Templates','Диагностика':'Diagnostics','Администраторы':'Administrators',
    'Настройки':'Settings','Подписка':'Subscription','Ещё':'More',
    'Ещё разделы':'More sections','Поиск и команды':'Search and commands',
    'Сменить тему':'Switch theme','Уведомления':'Notifications',
    'Выйти':'Sign out','Добавить пользователя':'Add user',
    'Новый пользователь':'New user','Новый узел':'New node','Добавить узел':'Add node',
    'Новый сквад':'New squad','Новый хост':'New host','Новая запись':'New record',
    'Сохранить':'Save','Сохранить настройки':'Save settings','Настроить':'Configure',
    'Настроить метрики':'Configure metrics','Изменить':'Edit','Удалить':'Delete',
    'Отключить':'Disable','Включить':'Enable','Отмена':'Cancel','Отменить':'Cancel',
    'Закрыть':'Close','Открыть':'Open','Копировать':'Copy','Скопировать':'Copy',
    'Продолжить':'Continue','Назад':'Back','Далее':'Next','Выбрать':'Select',
    'Обновить':'Refresh','Перезапуск':'Restart','Перезапустить':'Restart',
    'Проверить':'Check','Проверить статус':'Check status','Сбросить':'Reset',
    'Очистить':'Clear','Очистить всё':'Clear all','Поиск':'Search','Фильтр':'Filter',
    'Готово':'Done','Применить':'Apply','Да':'Yes','Нет':'No',
    'Активен':'Active','Онлайн':'Online','Оффлайн':'Offline','Не отвечает':'Not responding',
    'Не проверен':'Not checked','Не установлен':'Not installed',
    'Не установлено':'Not installed','Установлено':'Installed','Обновляется':'Updating',
    'Отключено':'Disabled','Включено':'Enabled','Неактивен':'Inactive',
    'Истёк':'Expired','Лимит':'Limit','Ожидает':'Pending',
    'Безлимит':'Unlimited','Бессрочно':'Unlimited','Без лимита':'No limit',
    'Нет данных':'No data','нет данных':'no data','Пока пусто':'Nothing yet',
    'Ничего не найдено':'Nothing found','Загрузка…':'Loading…',
    'загрузка':'loading','Нет':'No','Все':'All','Выше':'Move up','Ниже':'Move down',
    'Порядок':'Order','Имя':'Name','Описание':'Description','Название':'Name',
    'Адрес':'Address','Статус':'Status','Страна':'Country','Порт':'Port',
    'Версия':'Version','Дата':'Date','Тип':'Type','Платформа':'Platform',
    'Приложение':'Application','Время':'Time','Код':'Code','Трафик':'Traffic',
    'Использовано':'Used','Активные пользователи':'Active users',
    'Текущая скорость':'Current speed','неограниченно':'unlimited',
    'Настройки Xray-core':'Xray-core settings','Не удалось выполнить запрос':'Request failed',
    'Пользователь':'User','Пользователей':'Users','Узел':'Node','Узлов':'Nodes',
    'Нет активных пользователей':'No active users',
    'Введите значение':'Enter a value','Необязательно':'Optional',
    // General Settings (all major subsections)
    'Цвет и тема':'Colors and theme',
    'Основная палитра интерфейса и брендовые акценты':'Primary interface palette and brand accents',
    'Тема':'Theme','Автоматически — по настройкам ОС':'Automatically follow operating system',
    'Тёмная':'Dark','Светлая':'Light','Авто':'Auto',
    'Акцентный цвет':'Accent color','Влияет на кнопки, графики и активные элементы':'Affects buttons, charts, and active elements',
    'Своя палитра':'Custom palette','Своя тема':'Custom theme',
    'Цветовые «бублики» открывают выбор цвета; ползунки позволяют точно настроить оттенок, насыщенность и яркость.':
      'Color swatches open the color picker; sliders fine-tune hue, saturation, and brightness.',
    'Основной':'Primary','Вторичный':'Secondary',
    'Оттенок':'Hue','Насыщенность':'Saturation','Яркость':'Brightness',
    'Размер текста':'Text size',
    'Можно увеличить интерфейс для большого монитора или уменьшить плотность текста':
      'Increase readability on large monitors or make text more compact',
    'Шрифт':'Font','Выберите нейтральный системный или моноширинный стиль':
      'Choose a neutral system font or a monospaced style',
    'Системный':'System','Моно':'Mono','Моноширинный':'Monospace',
    'Композиция':'Layout','Плотность, радиусы и вид карточек':'Density, corner radius, and card appearance',
    'Плотность':'Density','От компактной таблицы до просторных карточек':'From compact tables to spacious cards',
    'Компактно':'Compact','Стандарт':'Standard','Свободно':'Spacious',
    'Стиль карточек':'Card style','Классический, стеклянный или объёмный вид':
      'Classic, glass, or raised appearance',
    'Классика':'Classic','Объём':'Raised',
    'Скругление':'Corner radius','От почти прямых углов до мягких округлых форм':
      'From almost square corners to soft rounded edges',
    'Границы карточек':'Card borders','Можно убрать линии или сделать их заметнее':
      'Hide borders or make them more prominent',
    'Без линий':'No borders','Мягкие':'Soft','Яркие':'Strong',
    'Боковая панель':'Sidebar','Компактный режим оставляет в основном только иконки':
      'Compact mode shows mostly icons',
    'Обычная':'Standard','Компактная':'Compact',
    'Подсказки при наведении':'Hover tooltips',
    'Показывать названия разделов и кнопок боковой панели. Работает в обычном и компактном режимах.':
      'Show labels for navigation sections and sidebar buttons in either sidebar mode.',
    'Эффекты и движение':'Effects and motion',
    'Настройка фона и анимаций без изменения данных':
      'Customize backgrounds and animation without changing data',
    'Подсветка фона':'Background glow',
    'Мягкое цветное свечение за панелью':'Soft colored glow behind the panel',
    'Выкл.':'Off','Средняя':'Medium','Анимации':'Animations',
    'Отключите движение и переходы, если они отвлекают':
      'Disable motion and transitions if they are distracting',
    'Сохранение':'Persistence',
    'Параметры оформления сохраняются в localStorage этого браузера':
      'Appearance settings are saved in this browser',
    'Сбросить оформление':'Reset appearance',
    'Бренд и домены':'Brand and domains',
    'Отдельные названия и домены панели управления и подписки':
      'Separate names and domains for the control panel and subscriptions',
    'Название панели':'Panel name','Домен панели':'Panel domain',
    'Название подписки':'Subscription name','Домен подписки':'Subscription domain',
    'Название вашего сервиса':'Your service name',
    'Название клиентского портала. Если пусто — используется название панели. Изменяется также в SUBSCRIPTION STUDIO.':
      'Client portal name. When empty, the panel name is used. Also editable in SUBSCRIPTION STUDIO.',
    'Независим от домена панели. Оформление и размещение — в SUBSCRIPTION STUDIO.':
      'Independent of the panel domain. Customize design and deployment in SUBSCRIPTION STUDIO.',
    'Вебхуки':'Webhooks',
    'События, о которых панель сообщает во внешние сервисы':
      'Events sent by the panel to external services',
    'API-токены':'API tokens','Токен':'Token','Создать токен':'Create token',
    'Для интеграций: бот оплаты, мониторинг, скрипты.':
      'For integrations: payment bots, monitoring, and scripts.',
    'API-токенов пока нет':'No API tokens yet',
    'Создайте токен для внешней интеграции.':'Create a token for an external integration.',
    'Установка и обновление бинарника ядра на сервере панели':
      'Install and update the core executable on the panel server',
    'Установленная версия':'Installed version','Архитектура':'Architecture',
    'Ещё не установлена':'Not yet installed',
    'Автопроверка статуса':'Automatic status checks',
    'Проверять Xray-core в фоне, только когда панель открыта и вкладка активна.':
      'Check Xray-core in the background only while the panel tab is active.',
    'Автоматически проверять статус Xray-core':'Automatically check Xray-core status',
    'Интервал проверки':'Check interval',
    'Как часто опрашивать backend, если автопроверка включена.':
      'How often to poll the backend while automatic checks are enabled.',
    'Каждые 15 секунд':'Every 15 seconds','Каждые 30 секунд':'Every 30 seconds',
    'Каждую минуту':'Every minute','Каждые 2 минуты':'Every 2 minutes',
    'Версия для установки':'Version to install',
    'Значение latest выбирает самый свежий опубликованный релиз GitHub. По умолчанию используется latest.':
      'Use latest to install the newest release published on GitHub (the default).',
    'Установить / обновить':'Install / update',
    'Обновление ядра выполняется отдельно от запуска VPN-трафика.':
      'Updating the core is separate from starting VPN traffic.',
    'Данные панели':'Panel data',
    'Настройки и записи хранятся в PostgreSQL. Экспортируйте JSON перед переносом или резервным копированием.':
      'Settings and records are stored in PostgreSQL. Export JSON before migration or backup.',
    'Скачать резервную копию':'Download backup',
    'На этом этапе панель и backend управляют данными и бинарником Xray-core. Запуск VPN-трафика и управление удалёнными узлами пока не подключены.':
      'At this stage, the panel and backend manage data and the Xray-core executable. VPN traffic and remote-node control are not yet connected.',
    'Язык панели':'Panel language','Язык интерфейса':'Interface language',
    'Язык панели управления. Применяется только в этом браузере.':
      'Control panel language. Applies only in this browser.',
    'Выберите Русский или English. Язык клиентского портала настраивается отдельно.':
      'Choose Russian or English. The client portal language is configured separately.',
    'Русский':'Русский','Английский':'English',
    // Nodes, hosts, squads, templates, users
    'Сетка':'Grid','Плотно':'Dense','Крупно':'Large',
    'Узлов пока нет':'No nodes yet',
    'Список начнёт заполняться после добавления ваших серверов.':
      'Your nodes will appear here when you add your servers.',
    'Пул IP-ротации':'IP rotation pool','IP-ротация':'IP rotation',
    'Не используется · дополнительные адреса одной VM':
      'Not used · additional addresses on one VM',
    'Получить следующий IP':'Get next IP',
    'Проверка на пользователе':'Test with user',
    'Тест изменяет счётчик ротации этого пользователя. Выдача подписок будет подключена отдельно.':
      'This test advances the user’s rotation cursor. Subscription delivery will be connected separately.',
    'Создать':'Create','Создано':'Created','Сохранено':'Saved',
    'Изменить параметры':'Edit settings','Все поля доступны сразу':'All fields available',
    'Имя пользователя':'Username','Устройство':'Device',
    'Активные':'Active','Неактивные':'Inactive','Заблокированные':'Disabled',
    'Подписка активна':'Subscription active','Подписка истекла':'Subscription expired',
    'Дата окончания':'Expiration date','Срок действия':'Validity period',
    'Выберите дату':'Choose a date','Срок доступа':'Access duration',
    'Пользователь создан':'User created','Запись удалена':'Record deleted',
    'Режим':'Mode','Автоматически':'Automatically','По умолчанию':'Default',
    'Шаблон':'Template','Профиль':'Profile','Протокол':'Protocol',
    'Адрес узла':'Node address','Адрес сервера':'Server address',
    'Фингерпринт':'Fingerprint','Без защиты':'No security',
    'Защита':'Security','Транспорт':'Transport',
    'Основное':'Basic','Протокол и клиент':'Protocol and client',
    'Ручная настройка':'Manual setup',
    'Дополнительные настройки':'Advanced settings','Скрыть дополнительные':'Hide advanced options',
    'Показаны только совместимые настройки':'Only compatible options are shown',
    'Новый':'New','Редактировать':'Edit',
    'Включены':'Enabled','Отключены':'Disabled',
    'Предпросмотр':'Preview','Развернуть JSON':'Expand JSON','Свернуть JSON':'Collapse JSON',
    'Развернуть предпросмотр JSON':'Expand JSON preview',
    'JSON предпросмотр':'JSON preview',
    'Сгенерировать':'Generate','Скопировать JSON':'Copy JSON',
    'Режим настройки':'Setup mode','Тип сетевого транспорта':'Network transport type',
    'На каком адресе будут приниматься подключения':'Address on which connections are accepted',
    'Порт для входящих подключений':'Port for incoming connections',
    'Протокол входящего соединения':'Inbound protocol',
    'Сетевой транспорт':'Network transport','Метод защиты соединения':'Connection security method',
    'Конфигурация обновляется автоматически при изменении параметров.':
      'Configuration updates automatically when you change parameters.',
    'Этот адрес будет указан в клиентской конфигурации':
      'This address appears in the client configuration',
    'Дополнительные параметры':'Additional parameters',
    'Настройки транспорта':'Transport settings','Настройки XHTTP':'XHTTP settings',
    'Настройки подключения':'Connection settings',
    'Клиентские параметры и дополнительные опции':'Client parameters and advanced options',
    'Сертификаты, ALPN и версии TLS':'Certificates, ALPN, and TLS versions',
    'Шифрование и генерация ключей':'Encryption and key generation',
    'Тег inbound':'Inbound tag','Тип':'Type',
    'IP-адрес':'IP address','Новый профиль':'New profile',
    'Нет профилей':'No profiles','Создать профиль':'Create profile',
    'Профиль сохранён в XRAY STUDIO':'Profile saved in XRAY STUDIO',
    'Профилей в XRAY STUDIO пока нет':'No profiles in XRAY STUDIO yet',
    'Список заполнится после добавления администраторов.':
      'The list will populate after you add administrators.',
    'Ничего не найдено':'Nothing found',
    'Добавьте первую запись.':'Add your first record.',
    'Сквадов пока нет':'No squads yet','Хостов пока нет':'No hosts yet',
    'Шаблонов пока нет':'No templates yet','Администраторов пока нет':'No administrators yet',
    'Создайте группу доступа на основе inbound.':'Create an access group based on inbounds.',
    'Добавьте адреса подключения, которые должны видеть клиенты.':
      'Add connection addresses visible to clients.',
    'Добавьте первый сервер и назначьте ему профиль.':
      'Add your first server and assign it a profile.',
    'Добавьте собственную конфигурацию Xray с inbound.':
      'Add a custom Xray configuration containing an inbound.',
    // Diagnostics
    'Устройства (HWID)':'Devices (HWID)','Запросы подписки':'Subscription requests',
    'Логи':'Logs','Логов пока нет':'No logs yet',
    'Записи появятся после подключения источника логов Xray.':
      'Entries will appear once an Xray log source is connected.',
    'Все платформы':'All platforms','Все коды':'All codes',
    'Фильтр по тексту':'Filter by text','Продолжить':'Resume',
    'Пауза':'Pause','Последний вход':'Last seen',
    'Время':'Time','Формат':'Format','Код':'Code',
    'Устройств':'Devices','Модель':'Model',
    // Subscription Studio - portal customizer
    'Управление дизайном, доменом и схемой размещения будущего сервиса подписок.':
      'Manage the design, domain, and deployment of your future subscription service.',
    'Конструктор управления':'Control-plane builder',
    'Публичный сервис подписок и серверные ноды будут разработаны отдельно. Сохранение здесь не запускает сервер и не публикует ссылки.':
      'The public subscription service and server nodes will be developed separately. Saving here does not start a server or publish links.',
    'Адрес выдачи':'Delivery address',
    'Отдельно от домена панели и адресов VPN-узлов.':
      'Independent of the panel domain and VPN node addresses.',
    'HTTPS и DNS настраиваются на сервере выдачи.':
      'HTTPS and DNS are configured on the delivery server.',
    'Публичный путь':'Public path',
    'Например /s или /subscription.':'For example /s or /subscription.',
    'Будущий формат ссылки':'Future link format',
    'Укажите домен подписки':'Enter a subscription domain',
    'Архитектура LEGO':'LEGO architecture',
    'Три роли, три условных сервера. Можно разместить всё вместе или разнести.':
      'Three roles and three logical servers. Host everything together or separately.',
    'Панель управления':'Control panel',
    'Сервер A':'Server A','Сервер B':'Server B','Сервер C':'Server C',
    'Сервис подписок':'Subscription service',
    'Отдельный будущий репозиторий':'Future standalone repository',
    'VPN-ноды':'VPN nodes',
    'Пример топологии; реальные ноды задаются в «Узлах»':
      'Example topology; real nodes are configured in Nodes.',
    'Сервер B · адрес / заметка':'Server B · address / note',
    'Сервер C · адрес / заметка':'Server C · address / note',
    'Необязательно, для планирования.':'Optional, for planning.',
    'Экспорт схемы JSON':'Export blueprint JSON',
    'Схема — описание архитектуры, не автоустановка серверов.':
      'This blueprint describes the architecture; it does not deploy servers.',
    'Клиентский портал':'Client portal',
    'Собственная тема, независимая от внешнего вида панели.':
      'An independent theme, separate from the panel appearance.',
    'Название сервиса':'Service name',
    'Пустое значение — использовать бренд панели.':'Leave blank to use the panel brand.',
    'Описание':'Description','Короткий текст на главной странице.':
      'A short message on the home page.',
    'Язык портала по умолчанию':'Default portal language',
    'Цвет кнопок и индикаторов.':'Button and indicator color.',
    'Тема клиентского портала':'Client portal theme',
    'Нижняя подпись':'Footer text',
    'Например, адрес поддержки.':'For example, a support address.',
    'Поддержка: @yourbot':'Support: @yourbot',
    'Показывать трафик':'Show traffic',
    'Показывать срок доступа':'Show expiration date',
    'Дизайн и композиция':'Design and layout',
    'Настройка каждой детали клиентской страницы без кода.':
      'Customize every detail of the client page without code.',
    'Компоновка':'Layout','Классическая':'Classic','По центру':'Centered',
    'Компактная':'Compact','Карточки':'Cards','С контуром':'Outlined','Без фона':'No background',
    'Скругление:':'Corner radius:',
    'Фон портала':'Portal background',
    'Основной цвет страницы.':'Main page color.',
    'Цвет карточек':'Card color','Фон информационных блоков.':'Information card background.',
    'Цвет текста':'Text color','Основной цвет надписей.':'Main text color.',
    'Персонализация':'Personalization',
    'Свой логотип, заголовки и контакты.':'Custom logo, headings, and contact details.',
    'URL логотипа':'Logo URL',
    'Только HTTPS. Оставьте пустым для стандартной пиктограммы.':
      'HTTPS only. Leave blank to use the default icon.',
    'Свой заголовок статуса':'Custom status heading',
    'Пустое поле — стандартный текст выбранного языка.':
      'Leave blank for the standard text in the selected language.',
    'Ваша подписка активна':'Your subscription is active',
    'Текст кнопки подключения':'Connect button text',
    'Пустое поле — стандартный перевод.':
      'Leave blank to use the default translation.',
    'Подключить устройство':'Connect device',
    'Название поддержки':'Support label',
    'Например, Связаться с нами.':'For example, Contact us.',
    'Ссылка поддержки':'Support link','HTTPS-ссылка на сайт или чат.':
      'HTTPS link to a website or chat.',
    'Блоки страницы':'Page sections',
    'Каждый элемент включается независимо.':
      'Each element can be toggled independently.',
    'Статус подписки':'Subscription status','Каталог приложений':'Application catalog',
    'QR-код':'QR code','Копирование ссылки':'Copy link','Устройства':'Devices',
    'Кнопка поддержки':'Support button',
    'Клиентские приложения':'Client applications',
    'Выбирайте, какие программы показать пользователю, и задавайте собственные ссылки на установку.':
      'Choose which apps to show users and set custom installation links.',
    'Включить все':'Enable all','Отключить все':'Disable all',
    'По умолчанию':'Default',
    'Вид списка приложений':'App list style','Плитки':'Grid','Список':'List',
    'Ссылка':'Link','HTTPS-адрес установки':'HTTPS installation URL',
    'Необязательно. Адрес не подставляется автоматически.':
      'Optional. No download URL is filled automatically.',
    'Это настройки каталога для будущего отдельного Subscription Service. Включение приложения не гарантирует совместимость конкретного формата конфигурации — она будет определяться генератором подписок.':
      'These catalog settings are for a future standalone Subscription Service. Enabling an app does not guarantee support for every configuration format.',
    'Предпросмотр':'Preview','Демо-контент':'Demo content',
    'Информация о подписке':'Subscription information',
    'Настройки подключения и информация о подписке.':
      'Connection settings and subscription information.',
    'Активно:':'Enabled:',
    'из':'of','Приложения для подключения':'Connection apps',
    'Копировать ссылку':'Copy link','Устройства':'Devices',
    'Пользователей':'Users','Узлов':'Nodes',
    'Макет без пользовательских данных. Реальные конфигурации, персональные токены и публичный портал появятся в отдельном сервисе.':
      'Preview uses demo data only. Real configurations, personal tokens, and the public portal will be handled by a separate service.',
    'Поддержка':'Support','Мобильные':'Mobile','Универсальные':'Universal',
    'Компьютер':'Desktop',
    // Additional dashboard, metrics, onboarding and user controls
    'ИНФРАСТРУКТУРА / ОБЗОР':'INFRASTRUCTURE / OVERVIEW',
    'Ресурсы и доступность сервисов панели в реальном времени.':
      'Infrastructure resources and service availability in real time.',
    'МОНИТОРИНГ':'MONITORING','МОНИТОРИНГ · LIVE':'MONITORING · LIVE',
    'Обновляем телеметрию…':'Refreshing telemetry…',
    'Загрузка графика…':'Loading chart…','Загрузка показаний…':'Loading readings…',
    'Последнее обновление':'Last updated',
    'Пока нет данных RX/TX':'No RX/TX data yet',
    'Нет данных по серверам':'No server metrics available',
    'Персональный трафик Xray':'Per-user Xray traffic',
    'Скорость сетевого интерфейса узлов. При работе других сервисов их трафик тоже попадёт в измерения.':
      'Node network interface speed. Traffic from other services on these hosts is included.',
    'Данные только из персональных счётчиков Xray. Общий трафик VPS не используется.':
      'Data comes from per-user Xray counters, not total VPS traffic.',
    'Данные панели':'Panel data',
    'Подходящие серверы не назначены':'No matching servers assigned',
    'Не удалось получить статистику':'Could not retrieve statistics',
    'Не удалось загрузить график':'Could not load chart',
    'График появится после получения персональных счётчиков Xray от нод.':
      'The chart will appear when nodes report per-user Xray counters.',
    'Автообновление каждые 15 секунд':'Refresh every 15 seconds',
    'Автообновление · 60 сек':'Auto refresh · 60 s',
    'По серверам':'By server','Все сквады':'All squads','Все узлы':'All nodes',
    'База данных':'Database','Процесс панели работает':'Panel process is running',
    'Выбрать все':'Select all','Сбросить выбор':'Clear selection',
    'Экспорт CSV':'Export CSV','Создать сквад':'Create squad',
    'В сквад':'To squad','Добавить в сквад':'Add to squad',
    'Скачать':'Download','Скачано':'Downloaded','Отправлено':'Sent',
    'Скопировать команду':'Copy command','Команда для Linux-узла (root)':
      'Command for Linux node (root)',
    'Скопируйте его сейчас: позже показать его снова будет нельзя.':
      'Copy it now: it will not be shown again.',
    'При необходимости подставит параметры из сохранённого шаблона':
      'Use values from a saved template when available',
    'Измените поиск или фильтр, либо создайте пользователя.':
      'Change your search or filters, or create a user.',
    'Поиск по имени · тегу · email · ссылке · Telegram ID':
      'Search by name · tag · email · link · Telegram ID',
    'Введите название страницы, действие или пользователя':
      'Search for a page, action, or user',
    'Поиск по названию страны или ISO-коду.':
      'Search by country name or ISO code.',
    'Очистить выбор страны':'Clear country selection',
    'Все поля доступны сразу':'All settings are directly editable',
    'Продлить':'Extend','Продлить…':'Extend…','Продление доступа':'Extend access',
    'Количество дней':'Number of days',
    'От текущей даты окончания, либо от сегодня, если доступ истёк.':
      'From the current expiry date, or today if access has already expired.',
    'Сбросить трафик':'Reset traffic','Лимит устройств':'Device limit',
    'Устройства (HWID)':'Devices (HWID)','Подключённых устройств пока нет':
      'No connected devices yet',
    'Количество устройств превышает лимит':'Device count exceeds limit',
    'Доступ':'Access','Бессрочно':'Never expires',
    'Сквады и подключение':'Squads and connection',
    'Пользователи':'Users','Пользователей пока нет':'No users yet',
    'Никого не найдено':'No matching users',
    'Пользователю нужно назначить группу доступа. Создайте сквад, а затем вернитесь к созданию пользователя.':
      'Users need an access group. Create a squad, then return to user creation.',
    'Сквады ещё не созданы':'No squads created yet',
    'Подписка':'Subscription','Сервис подписок будет отдельным компонентом. Оформление и размещение настраиваются в SUBSCRIPTION STUDIO.':
      'The subscription service will be a separate component. Its design and deployment are configured in SUBSCRIPTION STUDIO.',
    'Выберите протокол inbound, сетевой транспорт, порт и режим TLS/Reality.':
      'Choose the inbound protocol, network transport, port, and TLS/Reality mode.',
    'Показываются только настройки, совместимые с выбранным режимом.':
      'Only settings compatible with the chosen mode are shown.',
    'XRAY-CORE / ПРОФИЛЬ INBOUND':'XRAY-CORE / INBOUND PROFILE',
    'Конструктор подключения':'Connection builder','Конструктор':'Builder',
    'Настройте inbound — конфигурации сервера и клиента обновятся автоматически.':
      'Configure the inbound — server and client configurations update automatically.',
    'Результат конфигурации':'Configuration output',
    'Настройки обновляются автоматически':'Settings update automatically',
    'Server JSON и Client JSON обновляются по мере настройки. Экспорт не применяет конфиг к работающему ядру.':
      'Server JSON and Client JSON update as you configure settings. Exporting does not apply changes to the running core.',
    'Полный Server JSON · ручной режим':'Full Server JSON · manual mode',
    'Ручной JSON':'Manual JSON',
    'Предпросмотр готов':'Preview ready',
    'Синтаксис JSON и обязательные поля проверяются перед сохранением.':
      'JSON syntax and required fields are checked before saving.',
    'Расширенные поля Xray: DNS, policy, API, routing и любые параметры актуального ядра.':
      'Advanced Xray fields: DNS, policy, API, routing, and all options supported by the current core.',
    'Затем сохраните профиль в коллекцию':'Then save the profile to the collection',
    'Как это работает?':'How does it work?',
    'Проверьте настройки':'Review settings',
    'XRAY STUDIO / НАСТРОЙКИ ПОДКЛЮЧЕНИЯ':'XRAY STUDIO / CONNECTION SETTINGS',
    'Изменения сразу отражаются в Server JSON и Client JSON.':
      'Changes are reflected immediately in Server JSON and Client JSON.',
    'Настройки применяются к предпросмотру автоматически.':
      'The preview updates automatically.',
    'Откройте только нужный раздел. Конфигурация обновляется автоматически.':
      'Open only the sections you need. The configuration updates automatically.',
    'Параметры подключения':'Connection parameters',
    'Настройки TLS':'TLS settings',
    'Сертификат, ALPN и версия TLS':'Certificate, ALPN, and TLS version',
    'Настройки Reality':'Reality settings',
    'Ключи, Short ID и параметры назначения':'Keys, Short IDs, and destination options',
    'Защита соединения':'Connection security',
    'Параметры протокола и клиента':'Protocol and client parameters',
    'Пара ключей':'Key pair',
    'Серверный decryption и клиентский encryption':'Server decryption and client encryption',
    'Проверка':'Validation','Копировать':'Copy',
    'Сгенерировать UUID':'Generate UUID','Сгенерировать пароли':'Generate passwords',
    'Сгенерировать пару ключей':'Generate key pair',
    'Сгенерировать пару на сервере':'Generate pair on server',
    'Новый Short ID':'New Short ID',
    'Импорт JSON':'Import JSON','Заново из конструктора':'Regenerate from builder',
    'Настройки подключения':'Connection settings',
    'Обновить':'Refresh','Заменить':'Replace',
    'Нет активных inbound':'No active inbounds',
    'Нет вариантов':'No options',
    'ОБЯЗАТЕЛЬНОЕ':'REQUIRED',
    'От текущей даты':'From the current date',
    'Первый запуск':'First run',
    'Изумруд':'Emerald','Океан':'Ocean','Янтарь':'Amber','Роза':'Rose',
    'Фиолетовый':'Violet','Циан':'Cyan','Рубин':'Ruby',
    'Сегодня':'Today','Ожидание':'Waiting',
    'Пн':'Mon','Вт':'Tue','Ср':'Wed','Чт':'Thu','Пт':'Fri','Сб':'Sat','Вс':'Sun',
    'Загрузка данных…':'Loading data…','Загружаем данные…':'Loading data…',
    'Показать':'Show','Скрыть':'Hide','Выбрать файл':'Choose file',
    'Пользователю нужно назначить группу доступа.':
      'The user needs an access group.',
    'Путь':'Path','Сеть':'Network','Аутентификация':'Authentication',
    'Адрес интерфейса':'Interface address','Порт назначения':'Destination port',
    'Логин / пароль':'Username / password',
    'Метод шифрования':'Encryption method',
    'Учетные данные':'Credentials',
    'HTTP-заголовки':'HTTP headers',
    'Предупреждения':'Warnings',
    'Ручная настройка':'Manual setup','Ручной режим':'Manual mode',
    'Сохранить изменения':'Save changes',
    'Удаление':'Deletion',
    'Сгенерировать согласованную пару через Xray-core':
      'Generate a matching pair using Xray-core',
    'Новая конфигурация':'New configuration',
    // Login
    'Вход — XMesh Nexus':'Sign in — XMesh Nexus',
    'Вход в панель':'Sign in to the panel',
    'Авторизуйтесь, чтобы получить доступ к инфраструктуре.':
      'Sign in to access your infrastructure.',
    'Логин':'Username','Пароль':'Password','Войти':'Sign in',
    'Защищённая сессия · XMesh Nexus':'Secure session · XMesh Nexus',
    'Проверка…':'Signing in…','Не удалось войти.':'Sign-in failed.',
    'Не удалось связаться с сервером.':'Could not connect to the server.',
    'Сервис авторизации временно недоступен. Попробуйте ещё раз позже.':
      'Authentication is temporarily unavailable. Try again later.',
    // Generic short labels in dialogs
    'Шаг':'Step','Раздел':'Section','Генерация…':'Generating…',
    'Не задано':'Not set','Очистить':'Clear','Отправить':'Submit',
    'Сохранить профиль':'Save profile','Удалить пользователя':'Delete user',
    'Создать пользователя':'Create user','Завершить':'Finish',
    'Сгенерировать UUID':'Generate UUID','Сгенерировать ключи':'Generate keys',
    'Пользователь не найден в локальном кеше. Обновите список и повторите.':
      'User not found in local cache. Refresh the list and try again.',
    'Профиль с таким названием уже существует.':
      'A profile with that name already exists.',
    'Корень JSON должен быть объектом Xray.':'The root JSON value must be an Xray object.',
    'Корень конфига должен быть JSON-объектом.':'The config root must be a JSON object.',
    'Выбрать файл JSON':'Choose a JSON file','JSON отформатирован':'JSON formatted',
    'JSON скопирован':'JSON copied','JSON импортирован в ручной редактор':
      'JSON imported into manual editor',
    'Синтаксис корректен.':'Syntax valid.',
    'Проверка синтаксиса':'Syntax check',
    'Ошибка JSON':'JSON error','неизвестная ошибка':'unknown error'
  }));
  const dynamic=[
    [/^(\d+)\s+узлов настроено\. CPU, RAM и скорость требуют подключённого мониторинга\.$/i,
      (_,n)=>n+' nodes configured. CPU, RAM, and speed require connected monitoring.'],
    [/^Активно:\s*(\d+)\s+из\s+(\d+)$/i,(_,a,b)=>'Enabled: '+a+' of '+b],
    [/^(\d+)\s+адресов в пуле$/i,(_,n)=>n+' addresses in pool'],
    [/^(\d+)\s+узлов$/i,(_,n)=>n+' nodes'],
    [/^(\d+)\s+пользователей$/i,(_,n)=>n+' users'],
    [/^(\d+)\s+дн$/i,(_,n)=>n+' days'],
    [/^(\d+)\s+мин назад$/i,(_,n)=>n+' min ago'],
    [/^(\d+)\s+ч назад$/i,(_,n)=>n+' h ago'],
    [/^(\d+)\s+дн назад$/i,(_,n)=>n+' days ago'],
    [/^([0-9.,]+)\s+Мбит\/с$/i,(_,n)=>n+' Mbps'],
    [/^([0-9.,]+)\s+МБ$/i,(_,n)=>n+' MB'],
    [/^([0-9.,]+)\s+ГБ$/i,(_,n)=>n+' GB'],
    [/^([0-9.,]+)\s+ТБ$/i,(_,n)=>n+' TB']
  ];
  const originalText=new WeakMap();
  const translatedText=new WeakMap();
  const originalAttrs=new WeakMap();
  const translatedAttrs=new WeakMap();
  const translate=value=>{
    const str=String(value);
    const m=str.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const raw=m?.[2]||'';
    if(!raw)return str;
    const exact=dict.get(raw)||dict.get(raw.replace(/\s+/g,' '));
    if(exact!==undefined)return (m?.[1]||'')+exact+(m?.[3]||'');
    for(const [re,fn] of dynamic){const found=raw.match(re);if(found)return (m?.[1]||'')+fn(...found)+(m?.[3]||'')}
    return str;
  };
  const isProtected=node=>{
    const el=node.nodeType===3?node.parentElement:node;
    return !!el?.closest?.('script,style,pre,code,textarea,[contenteditable],[translate="no"],[data-no-translate],[data-subscription-preview],.user-username,.country-name');
  };
  const renderText=node=>{
    if(isProtected(node)||!node.nodeValue||!/[а-яё]/i.test(node.nodeValue)&&!originalText.has(node))return;
    const previous=translatedText.get(node);
    if(!originalText.has(node)|| (previous!==undefined && node.nodeValue!==previous && node.nodeValue!==originalText.get(node))){
      originalText.set(node,node.nodeValue);
    }
    const original=originalText.get(node);
    const output=language==='en'?translate(original):original;
    if(node.nodeValue!==output)node.nodeValue=output;
    translatedText.set(node,output);
  };
  const attributes=['placeholder','title','aria-label','data-rail-tip','alt'];
  const renderAttributes=el=>{
    if(isProtected(el))return;
    for(const attribute of attributes){
      if(!el.hasAttribute(attribute))continue;
      const key=attribute;
      let base=originalAttrs.get(el),prev=translatedAttrs.get(el);
      const current=el.getAttribute(key);
      if(!base){base={};originalAttrs.set(el,base)}
      if(!prev){prev={};translatedAttrs.set(el,prev)}
      if(!(key in base) || (key in prev && current!==prev[key] && current!==base[key]))base[key]=current;
      const output=language==='en'?translate(base[key]):base[key];
      if(current!==output)el.setAttribute(key,output);
      prev[key]=output;
    }
  };
  const apply=(root=document)=>{
    if(!root||!root.createTreeWalker && root.nodeType===9)return;
    if(root.nodeType===3){renderText(root);return}
    if(root.nodeType===1)renderAttributes(root);
    const target=root.nodeType===9?root.documentElement:root;
    if(!target)return;
    const walk=document.createTreeWalker(target,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
    while(walk.nextNode()){
      const node=walk.currentNode;
      if(node.nodeType===3)renderText(node);
      else if(node.nodeType===1)renderAttributes(node);
    }
    document.documentElement.lang=language;
    if(document.title){
      const plain=document.title;
      const translated=language==='en'?translate(plain):plain;
      // The page title is controlled by app.js. Main headings receive translation.
      if(translated!==plain)document.title=translated;
    }
  };
  const setLanguage=lang=>{
    if(!['ru','en'].includes(lang))return false;
    language=lang;
    try{localStorage.setItem(key,lang)}catch(_){}
    apply(document);
    document.dispatchEvent(new CustomEvent('xmesh:locale-changed',{detail:{language:lang}}));
    return true;
  };
  const getLanguage=()=>language;
  let observer;
  function install(){
    if(!document.documentElement)return;
    apply(document);
    if(observer)return;
    let queued=new Set(),scheduled=false;
    observer=new MutationObserver(records=>{
      for(const r of records){
        if(r.type==='characterData')queued.add(r.target);
        else if(r.type==='attributes')queued.add(r.target);
        else for(const n of r.addedNodes)queued.add(n);
      }
      if(scheduled)return;
      scheduled=true;
      queueMicrotask(()=>{
        scheduled=false;
        for(const n of queued)if(n.isConnected)apply(n);
        queued.clear();
      });
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,
      attributeFilter:attributes});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
  return {getLanguage,setLanguage,apply,translate,dict,install};
})();