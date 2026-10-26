# FinalMask: матрица совместимости XMesh Nexus

Актуализировано 2026-10-26. Реализация: backend/src/subscription_finalmask.rs, backend/src/subscription_transport.rs и XRAY STUDIO.

## Источники

- Официальная документация: https://xtls.github.io/ru/config/transports/finalmask.html
- Исходники Xray-core: https://github.com/XTLS/Xray-core/blob/main/transport/internet/finalmask/finalmask.go
- Header-custom schema: https://github.com/XTLS/Xray-core/blob/main/transport/internet/finalmask/header/custom/config.proto

**Поддержка в подписке не равна поддержке в любом клиенте.** Версия Xray-core в Happ/другом приложении и реальная сетевая проверка обязательны.

## Матрица

| Тип | Направление | Автоматически из inbound | Явный clientFinalmask | Особые условия |
|---|---|---|---|---|
| sudoku | TCP и UDP | Да | Да | Общие password, ascii, customTable(s), paddingMin/Max |
| header-custom | TCP и UDP | Да | Да | Общие client/server sequences; серверные errors остаются серверу |
| salamander | UDP | Да | Да | Общий password; Gecko packetSize только на QUIC (верхняя граница 2048) |
| mkcp-legacy | UDP | Да | Да | Общие header/value |
| fragment | TCP | Нет | Да | Клиентская отправка, не копируется из inbound |
| xmc | TCP | Нет | Да | Версия Xray-core, Minecraft transport masking |
| noise | UDP | Нет | Да | Клиентская отправка шума |
| udphop | UDP | Нет | Да | Потребуются дополнительные firewall/NAT и согласованные порты |
| xdns | UDP | Нет | Да | Только mKCP; NS, DNS, MTU и собственный домен |
| xicmp | UDP | Нет | Да | ICMP и права ОС |
| realm | UDP | Нет | Да | Нужна Realm/STUN инфраструктура |
| filter | TCP и UDP | Нет | Нет | Inbound-only, не отправляется клиенту |
| quicParams | QUIC | Нет | Да | Hysteria, MASQUE H3 и XHTTP H3; клиентские параметры независимы |

## Практическое руководство: как пользоваться `xmesh.clientFinalmask`

### Что это за поле

`xmesh.clientFinalmask` — **метаданные inbound в XMesh Nexus**, а не штатный параметр серверного Xray-core. В нём администратор задаёт **клиентскую** цепочку масок, которую генератор JSON-подписки помещает в `outbounds[].streamSettings.finalmask`. Серверная цепочка по-прежнему хранится в `inbounds[].streamSettings.finalmask`.

В интерфейсе название поля может отображаться как **«Клиентская FinalMask · подписки»** или **«Клиент · xmesh.clientFinalmask»**. Это не ссылка, не отдельный профиль и не параметр, который требуется вручную прописывать в Happ.

### Способ №1 — через интерфейс XRAY STUDIO (рекомендуется)

1. Откройте **XRAY STUDIO** и выберите нужный профиль Xray.
2. Выберите **inbound**, к которому относится VPN-подключение (например, `hysteria-main`). Не путайте inbound с Host или outbound.
3. Откройте раздел **FinalMask** либо одноимённый инструмент для выбранного inbound.
4. В редакторе **«Сервер · streamSettings.finalmask»** задайте маски, которые должен использовать Xray на ноде.
5. В редакторе **«Клиент · xmesh.clientFinalmask»** вставьте JSON-объект с ключами `tcp`, `udp` и/или `quicParams`. Вставляется **только содержимое clientFinalmask**, без внешних обёрток `xmesh`, `inbounds` или `streamSettings`.
6. Нажмите **«Применить»** в диалоге и **сохраните профиль**. Применение в редакторе само по себе ещё не означает публикацию на ноде.
7. Убедитесь, что профиль назначен ноде и изменения конфигурации применились. Затем обновите JSON-подписку в клиенте и проверьте фактическое подключение.

Если не нужны клиентские переопределения, оставьте `{}` — тогда Nexus попробует автоматически перенести совместимые симметричные слои сервера. Для удаления ранее заданного переопределения также используйте `{}`.

### Способ №2 — вручную в полном JSON профиля

Это пример **структуры одного inbound в профиле XMesh**, а не готовый полноценный Xray-конфиг. Другие обязательные поля вашего inbound сохраняются без изменений:

```json
{
  "tag": "hysteria-main",
  "protocol": "hysteria",
  "streamSettings": {
    "network": "hysteria",
    "finalmask": {
      "udp": [
        {
          "type": "salamander",
          "settings": {"password": "REPLACE_WITH_SAME_SECRET"}
        }
      ]
    }
  },
  "xmesh": {
    "clientFinalmask": {
      "udp": [
        {
          "type": "salamander",
          "settings": {"password": "REPLACE_WITH_SAME_SECRET"}
        },
        {
          "type": "noise",
          "settings": {
            "noise": [{"rand": "8-24", "delay": "10-20"}]
          }
        }
      ]
    }
  }
}
```

Здесь сервер требует Salamander, а клиент сохраняет тот же Salamander и дополнительно использует направленный слой noise. Пароль и настройки общего слоя **должны совпадать**. Для рабочего подключения дополнительно требуются реальные настройки Hysteria, TLS, пользователей и маршрутизации UDP.

**Важно:** если вы передаёте конфигурацию напрямую в `xray run -config` или используете другой инструмент без обработки метаданных Nexus, поле `xmesh` не является стандартным полем Xray. Оно предназначено для редактора и генератора Nexus; не вставляйте его в чистый клиентский outbound или серверный Xray JSON.

### Три типовых сценария

**A. Hysteria 2 + Salamander без дополнительной маски.** Укажите на сервере:

```json
{
  "udp": [
    {"type": "salamander", "settings": {"password": "ONE_SHARED_SECRET"}}
  ]
}
```

В **клиентском** поле оставьте `{}`. Nexus автоматически сформирует соответствующий UDP FinalMask. Это самый простой вариант для первичной проверки Hysteria 2.

**Б. Hysteria 2 + Salamander + клиентский noise.** Серверную маску оставьте как в примере A, а в клиентское поле вставьте:

```json
{
  "udp": [
    {"type": "salamander", "settings": {"password": "ONE_SHARED_SECRET"}},
    {"type": "noise", "settings": {"noise": [{"rand": "8-24", "delay": "10-20"}]}}
  ]
}
```

Если вместо этого указать только `noise` или ошибиться в Salamander password, backend отклонит несовместимый outbound: клиентская конфигурация **не дополняет автоматически** серверную, а заменяет результат автопроекции. Дополнительный noise также требует поддержки со стороны конкретной версии Xray клиента.

**В. TCP RAW + клиентский fragment без серверной FinalMask.** На сервере `streamSettings.finalmask` отсутствует либо равен `{}`. В клиентское поле:

```json
{
  "tcp": [
    {
      "type": "fragment",
      "settings": {
        "packets": "tlshello",
        "lengths": ["3-5", "6-8"],
        "delays": ["10-20"],
        "maxSplit": "3-6"
      }
    }
  ]
}
```

Это пример клиентской настройки для тестирования, а не универсальная рекомендация. Для UDP/Hysteria `tcp.fragment` не подходит.

### Где искать результат в подписке

В полученном **Xray JSON** откройте соответствующий исходящий сервер и найдите:

```json
{
  "outbounds": [
    {
      "streamSettings": {
        "finalmask": {
          "udp": [
            {"type": "salamander", "settings": {"password": "ONE_SHARED_SECRET"}}
          ]
        }
      }
    }
  ]
}
```

Показан только фрагмент структуры, остальные поля outbound опущены. В **готовой подписке** должно быть `streamSettings.finalmask`, а не `xmesh.clientFinalmask`: Nexus преобразует метаданные профиля в настройки клиента.

### Приоритеты, ошибки и проверка

| Ситуация | Поведение Nexus |
|---|---|
| `clientFinalmask` отсутствует | Попытка безопасного автопереноса общих слоёв |
| `clientFinalmask: {}` в редакторе | Удаление переопределения, возврат к автопереносу |
| Есть клиентская маска | Заменяет автоматическую проекцию целиком |
| Сервер использует Salamander, клиент только noise | Подписка с таким outbound не выдаётся |
| Разные пароли/настройки общих слоёв | Несовместимый outbound не выдаётся |
| TCP-маска для чистого UDP/Hysteria | Ошибка совместимости |
| `filter` в клиентской маске | Запрещён |
| `quicParams` на RAW/TCP | Ошибка совместимости |
| Host содержит собственный `clientFinalmask` | Настройка Host приоритетнее значения inbound |

Если сервер пропал из подписки после включения маски, **сначала проверьте несовместимость**, а не отключайте проверки безопасности. Проверьте журнал backend на предупреждение `Unsupported FinalMask client projection`, тип транспорта, порядок и пароли общих слоёв, ALPN H3 для соответствующих QUIC-транспортов, поддержку Xray-core в приложении и доступность UDP-портов.

Для диагностики начинайте с **одной маски**, затем добавляйте слои по одному. Поддержка формата на стороне Nexus не гарантирует поддержку или одинаковое поведение стороннего клиента.

---

## UX: серверная и клиентская конфигурации

1. Откройте XRAY STUDIO, выберите inbound и FinalMask.
2. Серверный JSON находится в streamSettings.finalmask — попадает в Xray ноды.
3. Отдельный JSON клиента находится в inbound.xmesh.clientFinalmask — предназначен только для подписок.
4. У отдельного Host поле host.clientFinalmask имеет приоритет над общим профилем.
5. Если клиентская маска не задана, общий wire-format для симметричных слоёв переносится автоматически.
6. Если clientFinalmask задан, он заменяет автоматическую проекцию **целиком**, но обязан сохранять все симметричные слои сервера (Salamander/Sudoku/header-custom/mkcp-legacy) с теми же настройками и порядком. Backend отвергнет подписку с отсутствующим слоем или чужим паролем. Клиентские дополнительные слои можно размещать рядом с обязательными.
7. После сохранения обновите профиль и подписку, проверьте Xray-core обеих сторон и реальное подключение.

Ключи масок будут включены в пользовательский JSON и должны защищаться как другие VPN-учётные данные. Не используйте пароль от панели в качестве Salamander/Sudoku password.

### Hysteria 2 + Salamander / Gecko

В серверном streamSettings.finalmask:

    {
      "udp": [{
        "type": "salamander",
        "settings": {"password": "REPLACE_WITH_RANDOM_SECRET", "packetSize": "512-1200"}
      }]
    }

Клиент автоматически получит общий пароль. packetSize включает Gecko **только на QUIC**. На XMesh Node UDP/443 должен маршрутизироваться на Xray.

### RAW / WS TCP Sudoku

В серверном streamSettings.finalmask:

    {
      "tcp": [{
        "type": "sudoku",
        "settings": {"password": "REPLACE_WITH_RANDOM_SECRET"}
      }]
    }

Клиент автоматически получит совместимую маску.

### TCP header-custom

    {
      "tcp": [{
        "type": "header-custom",
        "settings": {
          "clients": [[{"type":"str","packet":"HELLO"}]],
          "servers": [[{"type":"str","packet":"WELCOME"}]]
        }
      }]
    }

Это пример формата, а не готовая маскировка. У сложных сценариев проверяйте последовательности Xray.

### Только клиент: TCP fragment

В inbound.xmesh.clientFinalmask (НЕ в серверном streamSettings.finalmask):

    {
      "tcp": [{
        "type": "fragment",
        "settings": {
          "packets": "tlshello",
          "lengths": ["3-5", "6-8", "10-20"],
          "delays": ["10-20"], "maxSplit": "3-6"
        }
      }]
    }

### Только клиент: UDP noise

    {
      "udp": [{
        "type": "noise",
        "settings": {
          "reset": "30-60",
          "noise": [{"rand": "8-24", "delay": "10-20"}]
        }
      }]
    }

### Только клиент: QUIC congestion / таймеры

    {
      "quicParams": {
        "congestion": "bbr",
        "maxIdleTimeout": 30,
        "keepAlivePeriod": 10
      }
    }

Здесь нельзя наследовать server.brutalUp/brutalDown: upload/download относятся к разным направлениям сервера и клиента. maxIncomingStreams — серверное поле.

## Контракт безопасности и ограничения

- Backend проверяет совместимость TCP/UDP/QUIC и типы слоёв, не передаёт inbound filter, не обрезает цепочку масок ради «частично рабочей» конфигурации.
- Некорректная или неразрешимая цепочка не экспортируется как исправная: несовместимый outbound пропускается и пишется предупреждение без паролей.
- Протокол определяет авторизацию, а **транспорт** — применимость маски. TLS/Reality не превращают UDP в TCP.
- UDP hopping не открывает порты и не создаёт автоматически маршруты NAT в XMesh Node.
- XDNS не подходит для QUIC; XHTTP H3 и MASQUE H3 требуют соответствующего ALPN.
- XMC зависит от конкретной версии ядра и клиента; не активировать вслепую.
- Только Xray JSON подписки поддерживают этот формат. Конвертация в иные URI/форматы не гарантирует передачи масок.
- «Все маски одновременно» не является разумным профилем: цепочки увеличивают overhead и риск отказа подключения.
