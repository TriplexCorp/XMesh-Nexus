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

## UX: серверная и клиентская конфигурации

1. Откройте XRAY STUDIO, выберите inbound и FinalMask.
2. Серверный JSON находится в streamSettings.finalmask — попадает в Xray ноды.
3. Отдельный JSON клиента находится в inbound.xmesh.clientFinalmask — предназначен только для подписок.
4. У отдельного Host поле host.clientFinalmask имеет приоритет над общим профилем.
5. Если клиентская маска не задана, общий wire-format для симметричных слоёв переносится автоматически.
6. Если clientFinalmask задан, он заменяет автоматическую проекцию **целиком**. Вручную повторите общие слои, если они нужны, соблюдая порядок.
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
