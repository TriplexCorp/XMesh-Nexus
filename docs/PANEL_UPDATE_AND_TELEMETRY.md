# XMesh Nexus — обновление панели и учёт трафика

## Веб-обновление

В настройках под Xray-core расположен блок «Обновление XMesh Nexus».
Только owner может отправить POST /api/v1/panel/update. API записывает фиксированное
значение update в выделенный файл, но не запускает shell и не имеет Docker socket.
Отдельная root-owned systemd служба xmesh-panel-update.service вызывает
xmeshctl --web-update с flock и полным PostgreSQL backup перед pull/rebuild.
GET /api/v1/panel/update показывает `idle`, `queued`, `running`, `success`, `failed` либо `unavailable`.
`POST` с кодом 202 означает **только постановку запроса в очередь**, не завершение
обновления. Пока request-marker содержит `update`, статус остаётся `queued`
даже при старом `success` в status-marker; повторный запрос получает HTTP 409.
Кнопка «Проверить состояние» показывает настоящий статус systemd-updater; после
«Обновить панель» интерфейс проверяет очередь/выполнение каждые пять секунд
(при активной вкладке). Если `queued` не сменяется на `running`, проверьте
`sudo systemctl status xmesh-panel-update.path xmesh-panel-update.service`.
Если marker отсутствует, интерфейс показывает `unavailable`, а не фиктивный успех.
Кнопки обновления Xray-core и панели доступны только роли owner; обе проверяют
права на сервере. Кнопки проверки статуса не запускают обновление.
Установка host helper: sudo bash install.sh в каталоге проекта.
Лог: sudo journalctl -u xmesh-panel-update.service -n 80 --no-pager
Или: sudo tail -n 80 /var/log/xmesh-nexus/update.log

## Локальные флаги

На этапе сборки Docker-образа копируются SVG из фиксированного пакета
flag-icons@7.5.0 (MIT) в /app/static/flags/. В браузере они загружаются
исключительно с /flags/<iso>.svg на домене панели, без сторонних CDN.
Повторная загрузка извне нужна только при сборке нового Docker-образа.


## Персональный учёт: обязательное обновление каждой ноды (октябрь 2026)

Сетевые RX/TX ноды — **не** расход пользователя. Персональный трафик поступает
из Xray StatsService с отдельным email-счётчиком для каждого пользователя/inbound.
На управляемой ноде `xmesh-node-user-meter.timer` каждые 10 секунд запускает
root-only сборщик `xmesh-policy-guard.py sample`: он запрашивает StatsService внутри
`xmesh-managed-xray`, накапливает монотонные значения в
`/var/lib/xmesh-xray-sync/policy-usage.json` и публикует доступный только
группе `xmesh-metrics` снимок `/run/xmesh-node-user-metrics.json`.
Снимки не считаются подтверждёнными, если старше 30 секунд.
`xmesh-node-metrics` передаёт их подписанным запросом; PostgreSQL считает
положительные дельты и не списывает трафик VPS на отдельных пользователей.

После обновления панели **на каждой ноде** необходимо переустановить
управляющий агент без смены Ed25519-ключа:

```bash
curl -fsSL https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/update-node-control-agent.sh | sudo bash
sudo systemctl start xmesh-node-user-meter.service
sudo systemctl status xmesh-node-user-meter.timer xmesh-node-metrics.timer --no-pager
sudo journalctl -u xmesh-node-user-meter.service -u xmesh-node-metrics.service -n 80 --no-pager
```

Проверка сырого счётчика Xray на ноде (не публикуйте вывод без необходимости,
он содержит внутренние идентификаторы пользователей):

```bash
sudo docker exec xmesh-managed-xray xray api statsquery --server=127.0.0.1:10085 -pattern 'user>>>xmesh-u'
```

Наличие статуса `verified` или `direct` означает, что агенты смогли
собрать текущий снимок. `unavailable` означает, что метрики ноды отправляются,
но персональные Xray-счётчики недоступны. **Отсутствие персональных записей не
является нулевым расходом**: Xray обычно создаёт user-счётчики только после
фактического трафика. Первая отправка в PostgreSQL задаёт исходный baseline;
исторический расход до начала подтверждённого сбора не восстанавливается
искусственно. Далее трафик сохраняется при перезапуске контейнера, а одинаковые
повторные снимки не удваивают счётчики.

## Персональные счётчики Xray по inbound

Панель создаёт отдельный Xray UUID для каждого пользователя на сервере.
При добавлении этого пользователя к inbound Xray StatsService получает
уникальный email-счётчик xmesh-u<userId>--<encodeURIComponent(inboundTag)>.
Тем самым Xray измеряет пользователя на каждом inbound отдельно.
XRAY STUDIO включает stats:{} и policy.levels.0.statsUserUplink/Downlink
в новых серверных шаблонах. Xray API StatsService нужно дополнительно
включить и разрешить только на 127.0.0.1:10085 (или локально доступной
агенту loopback-точке). Никогда не открывайте этот API в интернет.

На узле агент использует xray api statsquery --server=127.0.0.1:10085
и доверенный локальный python3 parser. Показания отправляются в подписанных
Ed25519-пакетах userInboundTraffic и userTraffic. Сервер накапливает
монотонные дельты отдельно для user x inbound x node в PostgreSQL.
Если Xray StatsService недоступен, данные пользователя не выдумываются.
Для Dockerized Xray может потребоваться интеграция агента в ту же сеть.

## Client JSON

XRAY STUDIO формирует Client JSON с dns.queryStrategy=UseIPv4,
dns.servers=[1.1.1.1], SOCKS 127.0.0.1:10808 (noauth, UDP) и HTTP
127.0.0.1:10809 (пустые settings). На обоих — sniffing http/tls/quic.
Оба локальных прокси привязаны только к loopback.

## XRAY STUDIO — автоматический публичный адрес Client JSON

Адрес клиентского outbound подставляется из настроенных хостов/узлов, а не из домена панели.

1. Хост с совпадающим тегом inbound (hosts.tag) имеет приоритет: публичный адрес, внешний порт, SNI, Host и path.
2. Если такого хоста нет — адрес связанного узла (nodes.externalAddress / publicAddress / addr). Внутренние IP игнорируются.
3. Если подходящих хостов или узлов несколько, пользователь выбирает источник в списке: автоматическое угадывание опасно для CDN.
4. Режим ручного переопределения доступен для нестандартных схем. Он не меняет Server JSON.

UUID конкретного клиента и его криптографические ключи по-прежнему должны соответствовать реальной записи пользователя. Публичная выдача подписок через API пока не завершена.

## Автоматическая сборка персонального Client JSON

В карточке пользователя теперь доступна кнопка «Готовые Client JSON». Она формирует конфигурацию без Jinja-переменных и без замены UUID вручную:

- UUID берётся из авторитетной записи пользователя.
- Inbound подбираются по сквадам пользователя, хосты — по тегу inbound. При отсутствии хостов используются адреса назначенных узлов.
- VLESS, VMess, Trojan и поддерживаемый Shadowsocks получают адрес и публичный порт из хоста.
- Reality publicKey вычисляется через WebCrypto X25519 из приватного ключа сохранённого Server JSON **в памяти администратора**; приватный ключ не экспортируется в Client JSON. Если нет данных для сборки, выдаётся понятная ошибка вместо неработающего конфига.
- По умолчанию добавляются DNS `UseIPv4`, SOCKS `127.0.0.1:10808`, HTTP `127.0.0.1:10809`, `dns-out`, `direct`, `block` и маршрутизация, аналогичная Marzban.
- Каждый найденный хост выдаётся отдельным готовым JSON (копирование и скачивание). Нет случайного выбора из нескольких CDN.

Это **экспорт для авторизованного администратора**, а не публичный endpoint подписок. Браузер должен быть открыт по HTTPS, чтобы WebCrypto мог вычислять Reality publicKey.
