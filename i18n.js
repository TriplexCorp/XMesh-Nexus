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
  // Additional collection, dashboard, and builder translations.
  const extraEntries=[["Набор инбаундов: что именно получает пользователь в подписке.","Inbound group: connection options included in a user's subscription."],["Инбаунды (из профилей Xray)","Inbounds (from Xray profiles)"],["Точки входа, которые попадают в подписку. Порядок определяет приоритет.","Entry points included in the subscription. Order determines priority."],["Хост","Host"],["Название (remark)","Display name (remark)"],["Инбаунд","Inbound"],["Безопасность","Security"],["Только на узлах","Only on selected nodes"],["Ничего не выбрано — на всех узлах","None selected — all nodes"],["Страна и флаг","Country and flag"],["Порт ноды","Node port"],["Коэффициент трафика","Traffic multiplier"],["1 — без изменений, 2 — считать вдвое","1 — unchanged, 2 — count double"],["Лимит трафика, ГБ","Traffic limit, GB"],["0 — без лимита","0 — unlimited"],["День сброса счётчика","Counter reset day"],["Ротация IP-адресов","IP address rotation"],["Пул IP для будущей выдачи подписок: на каждом обновлении выбирается следующий адрес. Пока публичный генератор подписок в XMesh Nexus не реализован.","IP pool for future subscription delivery: each refresh selects the next address. The public subscription generator is not implemented in XMesh Nexus yet."],["Пул внешних IP-адресов","Public IP address pool"],["Один IPv4 или IPv6 на строку. Добавляйте только IP, реально назначенные VPS и доступные клиентам. До 64 адресов. Основной адрес узла остаётся прежним.","One IPv4 or IPv6 per line. Use only IPs assigned to the VPS and accessible to clients. Up to 64 addresses. The primary node address stays unchanged."],["Шаблоны пользователей","User templates"],["Готовые тарифы: выбираются при создании и подставляют лимиты, срок и доступ.","Ready-made plans used when creating users to prefill limits, duration, and access."],["Лимит, ГБ","Limit, GB"],["Срок, дней","Duration, days"],["0 — бессрочно","0 — never expires"],["Сброс трафика","Traffic reset"],["Отсчёт срока с первого подключения","Start duration on first connection"],["Шаблоны подписки","Subscription templates"],["Что получает клиентское приложение: формат и содержимое конфигурации.","What the client app receives: configuration format and contents."],["Содержимое","Contents"],["Конфигурации ядра. Инбаунды из профиля становятся доступны в сквадах и хостах.","Core configurations. Inbounds from profiles become available to squads and hosts."],["Конфигурация (JSON)","Configuration (JSON)"],["Вставьте полный конфиг Xray. В нём должен быть хотя бы один inbound.","Paste a complete Xray config containing at least one inbound."],["Роли ограничивают действия. Лимиты считаются по пользователям, созданным администратором.","Roles restrict permissions. Limits apply to users created by the administrator."],["Админ","Admin"],["Роль","Role"],["Максимум пользователей","Maximum users"],["0 — без ограничений","0 — no limit"],["Максимум трафика, ГБ","Maximum traffic, GB"],["Права","Permissions"],["3–32 символа: латиница, цифры, _ . -","3–32 characters: Latin letters, digits, _ . -"],["Xray-профиль","Xray profile"],["При выборе панель добавит учётные данные в inbound профиля.","The panel will add credentials to the selected profile inbound."],["uTLS fingerprint пользователя","User uTLS fingerprint"],["Индивидуальный fingerprint клиентского профиля для этого пользователя.","Personal client-profile fingerprint for this user."],["Тег","Tag"],["например, vip","e.g. vip"],["Отсчёт срока с первого подключения (on hold)","Start duration on first connection (on hold)"],["Заметка","Note"],["Персональный fingerprint пользователя.","Per-user fingerprint."],["Действует до","Expires on"],["Пусто — бессрочно","Leave blank for no expiry"],["Перейти: ","Go to: "],["Настроить внешний вид","Customize appearance"],["Трафик сброшен","Traffic reset"],["Токен создан","Token created"],["Состояние системы","System health"],["Метрики станут доступны после подключения к backend.","Metrics will appear when the backend is connected."],["Средняя нагрузка","Average load"],["PostgreSQL · проверка SELECT 1","PostgreSQL · SELECT 1 check"],["RX · принято узлами","RX · received by nodes"],["TX · отправлено узлами","TX · sent by nodes"],["Сначала добавьте узлы в раздел «Узлы».","Add nodes in the Nodes section first."],["Добавьте первый сервер, чтобы начать настройку.","Add your first server to start configuration."],["Создайте сквад перед добавлением первого пользователя.","Create a squad before adding your first user."],["Трафик RX / TX","RX / TX traffic"],["Создайте свои объекты — примеры не подставляются автоматически.","Create your own records — no sample data is inserted automatically."],["Трафик VPS не подменяет статистику пользователя.","Total VPS traffic is not used as per-user traffic."],["Всего","Total"],["Счётчики подключены, но трафик пока не зарегистрирован.","Counters are connected, but no traffic has been recorded yet."],["Повторить","Retry"],["Серверы","Servers"],["Сквад","Squad"],["Сначала создайте сквад","Create a squad first"],["Без шаблона","No template"],["Основные параметры","Basic parameters"],["Тип сети задаётся в разделе «Основное»; здесь находятся её параметры. Неподходящие поля скрываются автоматически.","Select the network in Basic; its parameters appear here. Incompatible fields are hidden."],["Пустые поля используют значения по умолчанию Xray-core. Серверные параметры попадут только в Server JSON, клиентские — только в Client JSON.","Empty fields use Xray-core defaults. Server settings appear only in Server JSON, client settings only in Client JSON."],["Клиент · HTTP uplink","Client · HTTP uplink"],["Клиент · xmux","Client · xmux"],["Сервер · ограничения приёма","Server · inbound limits"],["Дополнительный механизм защиты для VLESS. Не является заменой транспорта.","Additional protection for VLESS. Does not replace transport."],["Используется штатная команда","Using official command"],["Xray создаст парные server/client значения в своём официальном формате.","Xray generates a matching server/client pair in its official format."],["Протокол и параметры","Protocol and options"],["Учётные данные клиента и дополнительные параметры выбранного inbound-протокола.","Client credentials and advanced options for the selected inbound protocol."],["Форматировать","Format"],["Токен выдан. Скопируйте токен и команду сейчас: позже показать токен повторно нельзя. Новый токен немедленно отзывает старый.","Token issued. Copy the token and command now; it cannot be shown again. The new token immediately revokes the old one."],["Узел должен иметь исходящий HTTPS-доступ к панели и GitHub. Агент использует systemd timer с интервалом в минуту.","The node needs outbound HTTPS access to the panel and GitHub. The agent uses a systemd timer every minute."],["Разделы","Sections"],["Не выбрана","Not selected"],["Сохранённое значение","Saved value"],["Страна не найдена. Попробуйте другое название или ISO-код.","Country not found. Try another name or ISO code."],["Новых уведомлений нет.","No new notifications."],["1 час","1 hour"],["24 часа","24 hours"],["Мбит/с","Mbps"],["Активно","Enabled"]];
  for(const [ru,en] of extraEntries)dict.set(ru,en);
  const xrayTranslations=[["Шаги настройки inbound","Inbound setup steps"],["JSON-объект строковых HTTP-заголовков","JSON object of string HTTP headers"],["Не задавайте вместе с maxConnections","Do not use together with maxConnections"],["Не задавайте вместе с maxConcurrency","Do not use together with maxConcurrency"],["Без SSE header","No SSE header"],["Буферизованных POST","Buffered POSTs"],["Только сервер · packet-up","Server only · packet-up"],["Время stream-up · с","stream-up duration · s"],["Только сервер · stream-up","Server only · stream-up"],["Максимум header bytes","Maximum header bytes"],["Только сервер","Server only"],["Учётные данные, тайм-аут и masquerade","Credentials, timeout, and masquerade"],["Аутентификация Hysteria","Hysteria authentication"],["Обычно UUID пользователя","Usually user UUID"],["Секунды","Seconds"],["Тип masquerade","Masquerade type"],["Текст","Text"],["Каталог файлов","Files directory"],["Обратный proxy","Reverse proxy"],["Каталог masquerade","Masquerade directory"],["Путь к каталогу","Directory path"],["Содержимое masquerade","Masquerade content"],["HTML / текст","HTML / text"],["Назначение и необязательная Basic Auth","Destination and optional Basic Auth"],["Пользователь Basic Auth","Basic Auth user"],["Пароль Basic Auth","Basic Auth password"],["XDrive · storage и mux","XDrive · storage and mux"],["Хранилище и параметры потока","Storage and stream parameters"],["Backend хранилища","Storage backend"],["Папка / remote ID","Folder / remote ID"],["Секреты интеграции","Integration secrets"],["Размер сегмента · bytes","Chunk size · bytes"],["Интервал flush · ms","Flush interval · ms"],["Интервал poll · ms","Poll interval · ms"],["Максимальный poll · ms","Maximum poll · ms"],["Параллельные операции","Parallel operations"],["Режим VLESS Encryption","VLESS Encryption mode"],["ML-KEM-768 · постквантовый","ML-KEM-768 · post-quantum"],["X25519 · классический","X25519 · classic"],["Для обычного VLESS без VLESS Encryption выберите «Отключено». XDrive требует включённую функцию.","For ordinary VLESS without VLESS Encryption, select Disabled. XDrive requires encryption to be enabled."],["Сервер · settings.decryption","Server · settings.decryption"],["Значение decryption из xray vlessenc","Decryption value from xray vlessenc"],["Клиент · users[0].encryption","Client · users[0].encryption"],["Парное значение encryption","Matching encryption value"],["Учётные данные и дополнительные параметры выбранного протокола","Credentials and advanced parameters of the chosen protocol"],["Идентификация","Identification"],["UUID, fingerprint и режим протокола","UUID, fingerprint, and protocol mode"],["UUID / credential клиента","Client UUID / credential"],["UUID клиента","Client UUID"],["uTLS fingerprint · клиент","uTLS fingerprint · client"],["Без flow","No flow"],["Метод шифрования и отдельные ключи сервера / пользователя","Encryption method and separate server/user keys"],["Ключ / пароль сервера","Server key / password"],["Сгенерируйте или введите ключ","Generate or enter a key"],["Ключ пользователя","User key"],["SS2022: Base64-ключ","SS2022: Base64 key"],["SOCKS и Dokodemo-door","SOCKS and Dokodemo-door"],["Авторизация и адрес локального назначения","Authentication and local destination address"],["Без авторизации","No authentication"],["Адрес назначения","Destination address"],["Сеть назначения","Destination network"],["Ключи peer, адреса, keepalive и MTU","Peer keys, addresses, keepalive, and MTU"],["Private key сервера","Server private key"],["Сгенерируйте через xray wg","Generate with xray wg"],["CIDR, через запятую","Comma-separated CIDRs"],["Public key клиента","Client public key"],["PublicKey из xray wg","PublicKey from xray wg"],["CIDR через запятую","Comma-separated CIDRs"],["0 = выключено","0 = disabled"],["Имя интерфейса, IP-адреса, DNS и системные маршруты","Interface name, IP addresses, DNS, and system routes"],["Имя интерфейса","Interface name"],["Пусто — имя выберет ядро","Leave blank to let the core choose the name"],["Описание интерфейса","Interface description"],["Для Windows","For Windows"],["IP через запятую","Comma-separated IPs"],["Системные маршруты","System routes"],["Например, 0.0.0.0/0,::/0","For example 0.0.0.0/0,::/0"],["Уровень детализации журнала","Log verbosity"],["Уровень логирования","Logging level"],["Нужен полный Xray JSON с непустым массивом inbounds.","A full Xray JSON with a non-empty inbounds array is required."],["Reality в визуальном конструкторе доступен для VLESS/VMess/Trojan с RAW, XHTTP или gRPC.","Reality is supported in the visual builder for VLESS/VMess/Trojan with RAW, XHTTP, or gRPC."],["Транспорт Hysteria требует TLS.","Hysteria transport requires TLS."],["Транспорт MASQUE требует TLS.","MASQUE transport requires TLS."],["Выберите соответствующий транспорт для выбранного протокола.","Choose a compatible transport for the selected protocol."],["Транспорт MASQUE доступен только для inbound MASQUE.","MASQUE transport is only available for MASQUE inbounds."],["XDrive в текущем ядре требует VLESS. Выберите VLESS или используйте полный JSON-режим.","XDrive currently requires VLESS. Select VLESS or use full JSON mode."],["XDrive несовместим с VLESS flow. Оставьте flow пустым.","XDrive is incompatible with VLESS flow. Leave flow blank."],["Reality: задайте Short ID длиной 2–16 hex-символов чётной длины.","Reality: use an even-length hexadecimal Short ID with 2–16 characters."],["Reality: укажите Server name / SNI.","Reality: specify Server name / SNI."],["Внимание: у VLESS нет TLS/Reality и VLESS Encryption. Для публичного узла включите один из этих способов защиты.","Warning: VLESS has neither TLS/Reality nor VLESS Encryption. Enable one of these protections for a public node."],["Shadowsocks 2022 ChaCha поддерживает только одного пользователя: очистите UUID или выберите AES-128/AES-256 для нескольких пользователей.","Shadowsocks 2022 ChaCha supports one user only: clear the UUID or choose AES-128/AES-256 for multiple users."],["Укажите server key и user key Shadowsocks 2022 (сгенерируйте оба или введите Base64-ключи).","Specify Shadowsocks 2022 server and user keys (generate both or enter Base64 keys)."],["Укажите серверный Base64-ключ Shadowsocks 2022.","Specify the Shadowsocks 2022 Base64 server key."],["Для Shadowsocks без отдельного UUID укажите серверный пароль или нажмите «Сгенерировать пароли Shadowsocks».","For Shadowsocks without a separate UUID, specify the server password or choose Generate Shadowsocks passwords."],["Укажите серверный WireGuard private key (команда xray wg).","Enter the WireGuard server private key (xray wg command)."],["XDrive требует VLESS Encryption: выберите ML-KEM-768, X25519 или ручную настройку.","XDrive requires VLESS Encryption: select ML-KEM-768, X25519, or manual setup."],["VLESS Encryption включён, но пара не заполнена. Нажмите «Сгенерировать пару на сервере» или вставьте оба значения вручную.","VLESS Encryption is enabled, but the pair is empty. Generate a pair on the server or enter both values manually."],["Client JSON: укажите внешний IP-адрес или домен сервера в поле «Адрес узла».","Client JSON: specify the server’s public IP or domain in Node address."],["Не задан ID/credential клиента. Сгенерируйте UUID внизу конструктора.","Client ID/credential is missing. Generate a UUID at the bottom of the builder."],["Проверьте предупреждение","Review warning"],["Ошибка генерации","Generation error"],["Несовместимые параметры скорректированы:","Incompatible settings were adjusted:"],["Без транспорта","No transport"],["Добавьте хотя бы один inbound.","Add at least one inbound."],["✓ Синтаксис корректен. Подсказки выше проверяют известные настройки; совместимость подтвердите через xray run -test.","✓ Syntax valid. The hints above check known settings; verify compatibility using xray run -test."],["✕ Ошибка JSON:","✕ JSON error:"],["JSON обновлён из конструктора","JSON updated from builder"],["Short ID создан","Short ID created"],["Пароли Shadowsocks сгенерированы","Shadowsocks passwords generated"],["UUID создан","UUID created"],["Пара X25519 сгенерирована","X25519 pair generated"],["Запрос к Xray-core…","Requesting Xray-core…"],["Xray-core вернул неизвестный формат ответа. Обновите ядро и повторите.","Xray-core returned an unknown response format. Update the core and try again."],["Пара ML-KEM-768 сгенерирована","ML-KEM-768 pair generated"],["Не удалось сгенерировать VLESS Encryption","Could not generate VLESS Encryption"],["Укажите название профиля.","Enter a profile name."],["В конфигурации нужен хотя бы один inbound.","Configuration must contain at least one inbound."],["У каждого inbound должен быть непустой tag.","Every inbound must have a non-empty tag."],["Теги inbound должны быть уникальными.","Inbound tags must be unique."],["Тег уже используется в другом профиле.","The tag is already used by another profile."],["(без tag)","(no tag)"],["Не удалось сохранить профиль.","Could not save profile."],["Шаблонов подписки пока нет","No subscription templates yet"],["Сохраните тарифные параметры для повторного использования.","Save plan settings for reuse."],["Настройте формат выдачи подписки после подключения API.","Configure the subscription output format after connecting the API."],["занято","busy"],["Ошибка","Error"],["Перейти:","Go to:"],["Скопировано","Copied"],["ошибка backend","backend error"],["Пользователи восстановлены","Users restored"],["Удалить пользователя?","Delete user?"],["Статус изменён","Status updated"],["Ссылка перевыпущена","Link reissued"],["Устройство удалено","Device removed"],["Запись уже удалена или не найдена.","Record already deleted or not found."],["Узел не найден.","Node not found."],["Открой панель через HTTPS перед созданием токена агента.","Open the panel over HTTPS before creating an agent token."],["Токен агента","Agent token"],["Скопировать токен","Copy token"]];
  for(const [ru,en] of xrayTranslations)dict.set(ru,en);
  const diagnosticTranslations=[["Укажите количество дней от 1 до 36500.","Enter a number of days between 1 and 36500."],["Не удалось импортировать JSON:","Could not import JSON:"],["транспорт","transport"],["защита","security"],["· строка","· line"],[", столбец",", column"],["Вы переключаетесь обратно в визуальный редактор. Ручные правки останутся в JSON-режиме, но не будут перенесены в поля. Продолжить?","You are switching back to the visual editor. Manual JSON changes will not be transferred to fields. Continue?"],["Режим Server JSON вручную: Client JSON по-прежнему строится из полей визуального конструктора и не синхронизируется автоматически с произвольными ручными правками. Перед использованием сверьте обе конфигурации.","Manual Server JSON mode: Client JSON is still generated from the visual builder and is not automatically synchronized with arbitrary manual edits. Check both configurations before use."],["Этот Client JSON — отдельный outbound-конфиг. Адрес узла, UUID, Reality public key / Short ID и другие placeholders нужно заполнить реальными значениями.","This Client JSON is a separate outbound config. Replace the node address, UUID, Reality public key / Short ID, and other placeholders with real values."],["Заменить ручной JSON текущим конфигом визуального конструктора?","Replace manual JSON with the current visual builder configuration?"],["Не удалось сгенерировать Reality:","Could not generate Reality:"],[": задайте настоящий Reality privateKey.",": enter a real Reality privateKey."],[": Short ID должен быть массивом из hex-значений до 16 символов чётной длины.",": Short IDs must be an array of even-length hex values up to 16 characters."],[": явно задайте settings.decryption: \"none\" или корректное VLESS Encryption значение.",": explicitly set settings.decryption to \"none\" or a valid VLESS Encryption value."],[": задайте корректный VLESS Encryption decryption из xray vlessenc.",": enter a valid VLESS Encryption decryption value from xray vlessenc."],["Shadowsocks: задайте серверный пароль.","Shadowsocks: provide a server password."],["Shadowsocks 2022 ChaCha поддерживает одного пользователя: уберите settings.users и используйте серверный ключ.","Shadowsocks 2022 ChaCha supports a single user: remove settings.users and use the server key."],["Shadowsocks 2022 multi-user поддерживается только методами AES-128-GCM и AES-256-GCM.","Shadowsocks 2022 multi-user is supported only by AES-128-GCM and AES-256-GCM."],["Shadowsocks: задайте пароль и поддерживаемый method для каждого пользователя.","Shadowsocks: enter a password and supported method for each user."],["Shadowsocks: задайте пароль сервера.","Shadowsocks: enter the server password."],["WireGuard: задайте server private key (xray wg).","WireGuard: enter the server private key (xray wg)."],["XDrive inbound: задайте настоящий VLESS Encryption decryption из xray vlessenc.","XDrive inbound: enter a real VLESS Encryption decryption value from xray vlessenc."],["XDrive transport в этой версии Xray требует VLESS.","XDrive transport requires VLESS in this Xray version."],["XDrive Google Drive требует ровно 3 непустых секрета: Client ID, Client Secret и Refresh Token.","XDrive Google Drive requires exactly three non-empty secrets: Client ID, Client Secret, and Refresh Token."],["Не удалось удалить пользователя:","Could not delete user:"],["Не удалось восстановить:","Could not restore:"],["Не удалось удалить:","Could not delete:"],["Глубокий анализ ограничен 900 КБ: для этого файла доступна только проверка синтаксиса.","Deep analysis is limited to 900 KB; only syntax checking is available for this file."],["Для входящего подключения обычно требуется порт.","An inbound connection usually requires a port."],["Порт должен быть числом 1–65535 или допустимым диапазоном портов.","Port must be between 1 and 65535 or a valid port range."],["У диапазона портов границы должны быть 1–65535 по возрастанию.","A port range must have ascending bounds between 1 and 65535."],["Порт должен быть от 1 до 65535.","Port must be between 1 and 65535."],["streamSettings должен быть объектом.","streamSettings must be an object."],["method/network должен быть строкой.","method/network must be a string."],["Поддерживаются значения security: none, tls и reality.","Supported security values: none, tls, and reality."],["Для security: reality требуется объект realitySettings.","security: reality requires a realitySettings object."],["Для TLS проверьте tlsSettings и наличие сертификата или другого поддерживаемого источника ключей.","For TLS, check tlsSettings and the certificate or another supported key source."],["shortIds должен быть массивом шестнадцатеричных строк.","shortIds must be an array of hexadecimal strings."],["Short ID должен состоять из чётного количества HEX-символов (не более 16); пустая строка допускается.","Short ID must have an even number of hex characters (up to 16); an empty string is allowed."],["Для серверного REALITY обычно нужен privateKey; пустой ключ не будет создан автоматически.","Server-side REALITY usually requires a privateKey; an empty key will not be generated automatically."],["Похоже, здесь пример ключа, а не реальный ключ REALITY.","This appears to be an example key, not a real REALITY key."],["Для XHTTP рекомендуется явно задать xhttpSettings (например, path и mode).","For XHTTP, explicitly set xhttpSettings (for example path and mode)."],["xhttpSettings указаны, но network не равен xhttp. Эти настройки могут игнорироваться.","xhttpSettings are set but network is not xhttp. These settings may be ignored."],["xhttpSettings должен быть объектом.","xhttpSettings must be an object."],["Неизвестный режим XHTTP: допустимы auto, packet-up, stream-up, stream-one.","Unknown XHTTP mode: valid options are auto, packet-up, stream-up, and stream-one."],["Добавить / перед path","Add / before path"],["Путь XHTTP обычно начинается с символа «/».","XHTTP paths usually start with /."],["extra внутри xhttpSettings должен быть объектом.","extra inside xhttpSettings must be an object."],["xmux должен быть объектом.","xmux must be an object."],["maxConcurrency и maxConnections одновременно заданы положительными. Проверьте выбор стратегии xmux.","maxConcurrency and maxConnections are both positive. Check the xmux strategy."],["Не задан protocol: укажите тип подключения.","Missing protocol: specify the connection type."],["protocol должен быть строкой.","protocol must be a string."],["tag должен быть строкой.","tag must be a string."],["Для VLESS inbound укажите settings.decryption: \"none\" или актуальную конфигурацию шифрования.","For VLESS inbound, set settings.decryption to \"none\" or a current encryption configuration."],["Пустой decryption недопустим: используйте \"none\" либо ключ VLESS Encryption.","Empty decryption is invalid: use \"none\" or a VLESS Encryption key."],["Заменить пустое decryption на none","Replace empty decryption with none"],["VLESS без TLS/REALITY требует доверенной сети или VLESS Encryption; убедитесь, что соединение защищено.","VLESS without TLS/REALITY needs a trusted network or VLESS Encryption; ensure the connection is secured."],["Похоже, здесь демонстрационный ID, а не реальный идентификатор клиента.","This looks like a demo ID rather than a real client identifier."],["Корень конфигурации Xray должен быть объектом.","The Xray configuration root must be an object."],["Добавьте хотя бы один inbounds или outbounds, иначе Xray не будет обрабатывать подключения.","Add at least one inbound or outbound; otherwise Xray cannot process connections."],["Заменить пустое decryption на none","Replace empty decryption with none"],["Убрать лишнюю запятую","Remove extra comma"],["Добавить двоеточие","Insert colon"],["Добавить запятую","Insert comma"],["Корень конфигурации Xray должен быть JSON-объектом.","Xray config root must be a JSON object."],["Добавьте массив inbounds.","Add an inbounds array."],["В inbounds требуется хотя бы одно подключение.","inbounds must contain at least one connection."],["Reality, TLS, сертификаты и ключи","Reality, TLS, certificates, and keys"],["Параметры выбранного сетевого транспорта","Selected network transport settings"],["Дополнительные настройки подключения","Advanced connection settings"],["Ключи, Short ID, SNI и целевой адрес","Keys, Short ID, SNI, and destination address"],["HTTP uplink, padding, xmux и серверные параметры","HTTP uplink, padding, xmux, and server options"],["Шифрование и генерация ключей VLESS","VLESS encryption and key generation"],["Учетные данные,","Credentials,"],[", совместимость и дополнительные поля",", compatibility, and advanced fields"],["раздел","section"],["раздела","section"],["разделов","sections"],["защиты","security"],["транспорта","transport"],["выбранной сети","selected network"],["протокол","protocol"],["Параметры","Parameters"]];
  for(const [ru,en] of diagnosticTranslations)dict.set(ru,en);
  const compositeParts=[["Повторяющееся поле «","Duplicate field «"],["»: Xray/JSON использует последнее значение, предыдущее будет потеряно.","»: Xray/JSON uses the last value; earlier values are lost."],["Возможно, «","Possible typo: «"],["» — опечатка. Для этого раздела известно поле «","» might be a typo. This section recognizes «"],["Исправить название на","Change name to"],["удалён из актуальных версий Xray-core. Обычно вместо него используют XHTTP.","has been removed from current Xray-core versions. Use XHTTP instead."],["Транспорт «","Transport «"],["» не удалось сопоставить с известными вариантами Xray-core.","» does not match known Xray-core options."],["REALITY совместим с RAW/TCP, XHTTP и gRPC; выбран","REALITY is compatible with RAW/TCP, XHTTP, and gRPC; selected"],["ожидается неотрицательное число или диапазон, например «10-50».","expects a non-negative number or range such as 10-50."],["Элемент ","Element "],["должен быть объектом.","must be an object."],["Неизвестный ","Unknown "],[". Проверьте поддержку текущей версией Xray.",". Check support in your Xray version."],["У протокола ","Protocol "],["отсутствует settings; проверьте, кто управляет пользователями и учётными данными.","has no settings; check what manages users and credentials."],["должен быть массивом.","must be an array."],["Тег «","Tag «"],["» используется несколько раз. Маршрутизация по нему может стать неоднозначной.","» is used multiple times. Routing by this tag may be ambiguous."],["Маршрут ссылается на отсутствующий outboundTag «","Route references a missing outboundTag «"],["Показаны первые ","Showing the first "],[" замечаний."," findings."],["Shadowsocks 2022: серверный ключ должен быть Base64-кодированным ключом на ","Shadowsocks 2022: the server key must be a Base64-encoded key of "],["Shadowsocks 2022: каждый пользователь должен иметь Base64-ключ на ","Shadowsocks 2022: each user must have a Base64 key of "],[" байт."," bytes."],["XDrive: неизвестный service ","XDrive: unknown service "],["Выдать новый токен метрик для «","Issue a new metrics token for «"],["»? Если агент уже установлен, прежний токен будет немедленно отозван и его нужно будет заменить на узле.","»? If the agent is already installed, its previous token will be revoked immediately and must be replaced on the node."],["Скачано ","Downloaded "],[", загружено ",", uploaded "]].sort((a,b)=>b[0].length-a[0].length);
  const compositeTriggers=[
    'Повторяющееся поле «','Возможно, «','Транспорт «','REALITY совместим','Элемент ',
    'Неизвестный ','У протокола ','Тег «','Маршрут ссылается','Показаны первые ',
    'Shadowsocks 2022:','XDrive: неизвестный','Выдать новый токен метрик','Скачано ',
    'Для ','удалён из актуальных версий Xray-core.'
  ];
  const finalUiTranslations=[["Добавить","Add"],["1 · 5 · 15 минут","1 · 5 · 15 minutes"],["Для этого протокола отдельные параметры сети недоступны. Настройки транспорта отображаются для поддерживаемых протоколов; при необходимости используйте «Ручной JSON».","Separate network settings are unavailable for this protocol. Transport settings are shown for supported protocols; use Manual JSON if needed."],["Это клиентский outbound-конфиг, а не серверный inbound. Если адрес узла, UUID или ключи оставлены как placeholders, замените их перед импортом в приложение.","This is a client outbound config, not a server inbound. Replace placeholder node addresses, UUIDs, and keys before importing it into an app."],["; панель разбирает её текстовый вывод. Значения показываются только в авторизованной панели и попадут в профиль после сохранения.","; the panel parses its output. Values are shown only in the authenticated panel and are applied to the profile when saved."],["· Публичный сервис подписок и серверные ноды будут разработаны отдельно. Сохранение здесь не запускает сервер и не публикует ссылки.","· The public subscription service and server nodes will be developed separately. Saving here does not start servers or publish links."]];
  for(const [ru,en] of finalUiTranslations)dict.set(ru,en);
  const apiErrorTranslations=[["Запись с такими данными уже существует.","A record with these values already exists."],["Внутренняя ошибка API.","Internal API error."],["Запрос отклонён проверкой источника.","Request rejected by origin validation."],["Запись должна быть JSON-объектом.","Record must be a JSON object."],["Обновление должно быть JSON-объектом.","Update must be a JSON object."],["Запись не найдена.","Record not found."],["Повреждён формат записи.","Record format is corrupted."],["Настройки должны быть JSON-объектом.","Settings must be a JSON object."],["Название панели должно быть строкой.","Panel name must be a string."],["Название панели должно содержать от 1 до 80 символов.","Panel name must be 1–80 characters."],["Домен должен быть строкой.","Domain must be a string."],["Указан некорректный домен.","Invalid domain."],["Домен подписки должен быть строкой.","Subscription domain must be a string."],["Некорректный домен подписки. Укажите только hostname без схемы, пути и порта.","Invalid subscription domain. Enter only the hostname, without scheme, path, or port."],["Путь подписки должен быть строкой.","Subscription path must be a string."],["Путь должен начинаться с / и состоять из латиницы, цифр, - и _.","Path must begin with / and contain only Latin letters, digits, - and _."],["Путь конфликтует со служебными маршрутами панели.","Path conflicts with internal panel routes."],["Цвет подписки должен быть строкой.","Subscription color must be a string."],["Цвет подписки должен быть в формате #RRGGBB.","Subscription color must use #RRGGBB format."],["Вебхуки должны быть объектом.","Webhooks must be an object."],["Недопустимый параметр вебхука.","Invalid webhook setting."],["Ресурсы, видимые контейнеру панели; диск — корневая файловая система контейнера","Resources visible to the panel container; disk is the container root filesystem"],["ID узла должен быть положительным числом.","Node ID must be a positive number."],["Токен показывается только один раз. Сохраните его на узле.","The token is shown only once. Store it on the node."],["node_id должен быть положительным числом.","node_id must be positive."],["Требуется Bearer-токен агента метрик.","A metrics agent bearer token is required."],["metrics должен быть JSON-объектом не больше 32 КиБ.","metrics must be a JSON object no larger than 32 KiB."],["Одно или несколько значений метрик выходят за допустимые пределы.","One or more metric values are outside the allowed range."],["Токен агента недействителен или отозван.","Agent token is invalid or revoked."],["Не более 2048 пользователей за один пакет метрик.","A metric batch may contain at most 2,048 users."],["Некорректная или дублирующаяся запись userTraffic.","Invalid or duplicate userTraffic entry."],["Некорректный userTraffic.","Invalid userTraffic."],["Некорректный ID пользователя.","Invalid user ID."],["Пользователь не найден.","User not found."],["Период должен быть 1h или 24h.","Time range must be 1h or 24h."],["ID узла и сквада должны быть положительными числами.","Node and squad IDs must be positive."],["Обновление Xray-core запущено.","Xray-core update started."],["Неизвестная коллекция.","Unknown collection."],["Имя пользователя обязательно.","Username is required."],["Некорректное имя пользователя.","Invalid username."],["Конфигурация Xray обязательна.","Xray configuration is required."],["Конфигурация Xray содержит некорректный JSON.","Xray configuration contains invalid JSON."],["В конфигурации Xray должен быть массив inbounds.","Xray configuration must include an inbounds array."],["В конфигурации Xray должен быть хотя бы один inbound.","Xray configuration must have at least one inbound."],["У каждого inbound должен быть tag.","Every inbound must have a tag."],["Теги inbounds должны быть уникальными.","Inbound tags must be unique."],["Неверный логин или пароль.","Incorrect username or password."],["Слишком много попыток. Повторите вход через 15 минут.","Too many attempts. Try again in 15 minutes."],["Не удалось проверить пароль.","Could not verify password."],["Не удалось создать сессию.","Could not create session."],["Не удалось завершить сессию.","Could not end session."],["Сессия истекла. Войдите снова.","Session expired. Please sign in again."],["Пул ротации должен быть текстом: один IP в каждой строке.","Rotation pool must be text with one IP per line."],["Слишком большой список IP-адресов (максимум 64).","Too many IP addresses (maximum 64)."],["Пул ротации принимает только IP-адреса, по одному на строку, без портов.","Rotation pool accepts IP addresses only, one per line, without ports."],["В пуле запрещены локальные, групповые и неопределённые IP-адреса.","Loopback, multicast, and unspecified IP addresses are not allowed in the pool."],["В пуле ротации есть повторяющиеся IP-адреса.","The rotation pool contains duplicate IP addresses."],["В пуле ротации допускается не более 64 IP-адресов.","A rotation pool may contain up to 64 IP addresses."],["Ротация IP должна быть включена или выключена.","IP rotation must be enabled or disabled."],["Для включения ротации укажите хотя бы два различных IP-адреса.","Enter at least two distinct IP addresses to enable rotation."],["Узел отключён.","Node is disabled."],["Подписка пользователя неактивна.","User subscription is inactive."],["У узла отсутствует основной адрес.","The node has no primary address."],["Цвет должен быть текстом в формате #RRGGBB.","Color must be a #RRGGBB string."],["Некорректный цвет. Используйте формат #RRGGBB.","Invalid color. Use #RRGGBB format."],["Недопустимый вариант оформления.","Invalid appearance option."],["Неизвестный вариант оформления портала.","Unknown portal appearance option."],["Скругление должно быть целым числом.","Corner radius must be an integer."],["Скругление должно быть от 0 до 32 пикселей.","Corner radius must be between 0 and 32 pixels."],["Название блока должно быть текстом.","Section title must be text."],["Превышена максимальная длина текста портала.","Portal text exceeds the maximum length."],["Ссылка должна быть строкой.","Link must be a string."],["Допустима только корректная HTTPS-ссылка без логина и нестандартного порта.","Only valid HTTPS links without login or nonstandard ports are allowed."],["Параметры видимости должны быть переключателями.","Visibility options must be booleans."],["Каталог приложений должен быть объектом.","Application catalog must be an object."],["Слишком много приложений в каталоге.","Too many applications in the catalog."],["Неизвестное приложение или неверное состояние переключателя.","Unknown application or invalid toggle value."],["Ссылки приложений должны быть объектом.","Application links must be an object."],["Слишком много ссылок приложений.","Too many application links."],["Некорректная HTTPS-ссылка приложения или неизвестный клиент.","Invalid application HTTPS link or unknown client."],["Обновление поставлено в очередь","Update queued"],["Xray-core ещё не установлен. Установите ядро в разделе «Настройки → Xray-core» и повторите.","Xray-core is not installed. Install it in Settings → Xray-core and retry."],["Команда xray vlessenc превысила лимит 20 секунд.","The xray vlessenc command exceeded the 20-second timeout."],["Xray-core вернул невалидный UTF-8 из vlessenc.","Xray-core returned invalid UTF-8 from vlessenc."]];
  for(const [ru,en] of apiErrorTranslations)dict.set(ru,en);
  const customClientTranslations=[["Заголовок раздела приложений","Application section title"],["Оставьте пустым, чтобы использовать стандартный заголовок на языке клиента.","Leave blank to use the default title in the client's language."],["Свои приложения","Custom applications"],["Собственные названия, платформы и адреса установки","Custom names, platforms and download URLs"],["+ Добавить приложение","+ Add application"],["Добавить приложение","Add application"],["Название приложения","Application name"],["Мой клиент","My client"],["Платформы и ссылка","Platforms and URL"],["Платформы","Platforms"],["Показывать приложение","Show application"],["Удалить приложение","Remove application"],["Необязательно. Ссылка сохраняется для будущего сервиса подписок.","Optional. The link is saved for the future subscription service."],["Можно добавить не более 32 своих приложений.","You can add up to 32 custom applications."],["Не более 32 своих приложений.","Up to 32 custom applications are allowed."],["Заголовок приложений должен быть короче 80 символов.","Application section title must be 80 characters or fewer."],["Заполните название приложения (до 80 символов) и проверьте платформы.","Enter an application name (up to 80 characters) and check platforms."],["Свои приложения должны быть массивом.","Custom applications must be an array."],["Приложение должно быть объектом.","Application must be an object."],["Неизвестное или отсутствующее поле приложения.","Unknown or missing application field."],["Некорректный ID приложения.","Invalid application ID."],["Некорректный или повторяющийся ID приложения.","Invalid or duplicate application ID."],["Некорректное название приложения.","Invalid application name."],["Некорректное описание платформ.","Invalid platform description."],["Название или платформы приложения содержат недопустимые символы.","Application name or platforms contain invalid characters."],["Ссылка приложения должна быть строкой.","Application link must be a string."],["Укажите корректную HTTPS-ссылку своего приложения.","Enter a valid HTTPS link for the custom application."],["Состояние приложения должно быть переключателем.","Application enabled status must be a boolean."],["Заголовок приложений должен быть строкой.","Application section title must be a string."]];
  for(const [ru,en] of customClientTranslations)dict.set(ru,en);
  const mfaTranslations=[["Двухфакторная аутентификация","Two-factor authentication"],["Дополнительная защита входа · TOTP","Extra sign-in security · TOTP"],["Загрузка…","Loading…"],["Включена","Enabled"],["Выключена","Disabled"],["Для входа потребуется код приложения-аутентификатора. Сохраните резервные коды на случай потери телефона.","You will need an authenticator code to sign in. Save backup codes in case you lose your phone."],["Добавьте постоянный TOTP_ENCRYPTION_KEY в .env и перезапустите панель.","Add a persistent TOTP_ENCRYPTION_KEY to .env and restart the panel."],["Отключить 2FA","Disable 2FA"],["Настроить 2FA","Set up 2FA"],["Текущий пароль","Current password"],["Код приложения или резервный код","Authenticator or recovery code"],["Подтвердить отключение","Confirm disabling"],["Подтвердите текущий пароль","Confirm your current password"],["Начать подключение","Start setup"],["Код приложения","Authenticator code"],["Включить 2FA","Enable 2FA"],["Копировать секрет","Copy secret"],["Копировать ссылку импорта","Copy import link"],["Секрет TOTP","TOTP secret"],["Скопировано","Copied"],["Добавьте запись в Google Authenticator, 2FAS или Aegis. Секрет показывается только сейчас.","Add a record to Google Authenticator, 2FAS or Aegis. The secret is only shown now."],["Подтвердите код в течение 10 минут. До этого 2FA не включена.","Confirm within 10 minutes. 2FA stays disabled until confirmation."],["Сохраните резервные коды","Save your recovery codes"],["Каждый код работает только один раз. После закрытия этого блока восстановить их нельзя. Храните отдельно от телефона.","Each code works once. You cannot retrieve them after closing this view. Store them separately from your phone."],["Копировать коды","Copy codes"],["Я сохранил коды","I saved the codes"],["Другой аккаунт","Another account"],["Код подтверждения","Verification code"],["Откройте приложение-аутентификатор. Если телефон недоступен, используйте один из сохранённых резервных кодов.","Open your authenticator app. If you cannot access your phone, use one of the saved recovery codes."],["Подтвердить вход","Verify sign-in"],["Ошибка двухфакторной защиты.","Two-factor authentication error."],["Неверный или уже использованный код подтверждения.","Invalid or already used verification code."],["Неверный пароль администратора.","Incorrect administrator password."],["Начните подключение 2FA заново.","Start 2FA setup again."],["2FA уже включена.","2FA is already enabled."],["2FA не подключена.","2FA is not enabled."],["Подтверждение истекло. Войдите снова.","Verification expired. Sign in again."],["Слишком много попыток. Начните вход заново.","Too many attempts. Start sign-in again."],["TOTP_ENCRYPTION_KEY отсутствует. Настройте секретный ключ сервера.","TOTP_ENCRYPTION_KEY is not configured. Set up the server's secret key."],["Не удалось расшифровать ключ TOTP. Проверьте TOTP_ENCRYPTION_KEY.","Could not decrypt TOTP secret. Check TOTP_ENCRYPTION_KEY."]];
  for(const [ru,en] of mfaTranslations)dict.set(ru,en);
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
    if(compositeTriggers.some(prefix=>raw.startsWith(prefix))){
      let output=raw;
      for(const [ru,en] of compositeParts)output=output.split(ru).join(en);
      if(output!==raw)return (m?.[1]||'')+output+(m?.[3]||'');
    }
    return str;
  };
  const isProtected=node=>{
    const el=node.nodeType===3?node.parentElement:node;
    return !!el?.closest?.('script,style,pre,code,textarea,[contenteditable],[translate="no"],[data-no-translate],[data-subscription-preview],#bn,#lg,.who,.nc .h b,.user-username,.user-name,.country-name');
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