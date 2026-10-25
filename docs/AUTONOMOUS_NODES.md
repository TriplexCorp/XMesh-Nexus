# Autonomous XMesh nodes (signed offline-policy v1)

The XMesh-Node repository contains the deployed `xmesh-xray-sync.sh` and
`xmesh-policy-guard.py`. XMesh Nexus exposes
`POST /api/v1/node/desired-config`, authenticated with the **node's**
Ed25519 key, and signs the **response policy** with a separate persistent
Control Plane Ed25519 key.

## Deployment order

1. Back up the PostgreSQL volume, Xray node state and
   `/var/lib/xmesh/core/node-policy-ed25519.key`. **Never regenerate that
   signing key on ordinary panel updates.**
2. Update and rebuild XMesh Nexus first:

   ```bash
   cd /root/XMesh-Nexus
   git pull --ff-only origin main
   docker compose up -d --build
   docker compose logs --tail=60 panel
   ```

3. On each **already enrolled** node, install the updated worker, controller,
   unprivileged telemetry agent and policy guard:

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL \
     https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/update-node-control-agent.sh \
     -o /root/xmesh-node-update.sh
   bash /root/xmesh-node-update.sh
   systemctl start xmesh-xray-sync.service
   journalctl -u xmesh-xray-sync.service -n 50 --no-pager
   ```

   New node enrollments through XMesh-Node `bootstrap.sh` also install the
   verifier automatically. Do not remove the existing node key or re-enroll.

4. Verify that `/var/lib/xmesh-xray-sync/policy-envelope.json` and
   `policy-public-key` exist (never paste their entire content into support
   chats; the config may contain Reality secrets), and that
   `xmesh-managed-xray` is running. Test expiry and a disabled node against
   a **disposable** test UUID before rolling out to production.

## Security and behavior

- Node-to-panel traffic is **outbound HTTPS**. The node's Ed25519 key signs
  the HTTP method/path/body/time/nonce. The panel rejects replays.
- Panel replies include `policy`, `policySignature` and
  `policyPublicKey`; the agent checks signature, node identity, lifetime
  and an SHA-256 hash of the exact Xray JSON. A key learned during a
  verified first HTTPS connection is **pinned**, and unexpected rotation is
  rejected. A pinned key must be rotated manually with explicit owner
  authorization; NEVER automatically delete the pin on mismatch.
- Only a validated candidate which has passed Xray validation and
  successfully started is promoted to the offline policy snapshot.
- Upon failure to reach the panel, an enrolled node loads the **last
  committed signed** policy. Expired VLESS UUIDs are removed from the
  local managed Xray configuration. Previously revoked UUIDs are not
  restored by a repeat of the same signed policy.
- For finite user traffic limits the panel issues a *conservative offline
  budget* of up to 64 MiB per node, divided by the number of active nodes.
  Local StatsService counters are checked on each reconciliation; when
  exhausted the relevant UUID is removed. When counters are unavailable
  while disconnected, **limited users are blocked**, rather than receiving
  unmetered traffic. Unlimited users can continue while offline, with
  subscription expiry still enforced.
- The policy has a seven-day signed validity window. Expired finite-budget
  policies are not renewed offline.
- A root-only local worker reads Xray container counters. Its persistent
  per-user/per-inbound cumulative journal survives Xray restarts and short
  panel outages. It publishes a `0640 root:xmesh-metrics` snapshot under
  `/run/xmesh-node-user-metrics.json` for the low-privilege metrics agent,
  which uploads **cumulative** counters over signed HTTPS. Transient
  five-second CPU/rate samples are not replayed; cumulative usage is.
- For full-node shutdown the controller persists
  `/var/lib/xmesh-node-control/forced-stop` only after checking the
  managed Xray container or configured systemd service actually stopped.
  Ordinary desired-config reconciliation respects this marker.

## Limits of the current implementation

**This is NOT a mathematically strict global quota guarantee across
multiple disconnected nodes.** The offline allowance is bounded and
conservative; exact multi-node maximums require server-side reserved,
transactional quota leases and reconciliation of each lease. A rapidly
changing user limit or a manually reset traffic counter may require a new
acknowledged panel accounting revision before an offline-exhausted user can
be safely re-enabled.

Xray user removals currently redeploy the managed container rather than
hot-unregistering clients via HandlerService, so remaining connections can
briefly reconnect. A failed Xray config validation/deployment preserves
or attempts to roll back the previous working configuration.

## Diagnosis

```bash
systemctl status xmesh-node-control.timer xmesh-xray-sync.timer xmesh-node-metrics.timer --no-pager
journalctl -u xmesh-xray-sync.service -u xmesh-node-control.service -n 80 --no-pager
docker inspect -f '{{.State.Running}}' xmesh-managed-xray
stat -c '%a %U:%G %n' /var/lib/xmesh-xray-sync/policy-public-key /var/lib/xmesh-xray-sync/policy-usage.json
```

Do not disable signature verification, grant the metrics user access to the
Docker socket, or remove the `forced-stop` file to "fix" an outage.

## Обновление Agent без SSH · control-v4.0.0

В карточке каждого узла отображается версия управляющего агента из
**подписанного heartbeat**, например `Agent v4.0.0`, и кнопка **«Обновить Agent»**.

Обновление проходит по тому же подписанному каналу команд, что и перезапуск
Xray. Администратор подтверждает действие, API ставит фиксированную команду
`update_agent` в очередь, нода самостоятельно запускает заранее установленную
`xmesh-node-agent-upgrade.service`. Панель не может передавать shell-команды,
пути файлов или URL. Отдельная служба скачивает компоненты из фиксированных
репозиториев, проверяет синтаксис, сохраняет существующий Ed25519-ключ и
применяет обновление. Подтверждение `succeeded` отправляется **только после
успешной установки**, при ошибке — `failed`.

Команды `restart_xray`, `update_xray` и `update_agent` эксклюзивны
для одной ноды и журналируются. Если узел отключён или heartbeat устарел,
обновление не запускается.

**Переход с control-v3:** старый агент не умеет выполнять новую команду.
Потребуется один раз вручную обновить его на VPS (без повторной регистрации
или смены ключа):

```bash
curl --proto '=https' --tlsv1.2 -fsSLo /tmp/xmesh-agent-upgrade.sh \
  https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/update-node-control-agent.sh
sudo bash /tmp/xmesh-agent-upgrade.sh
```

После появления `Agent v4.0.0` последующие обновления доступны в панели.
При **чистой установке новой управляемой ноды** upgrade-service и v4
устанавливаются автоматически. Сервис Xray-профиля при штатном обновлении
агента не перезапускается; доступность сети и персонального учёта нужно
контролировать отдельно.

## Local Xray port changes and TCP router reconciliation (2026-10-26)

The panel's node `xrayLocalPort` is the **loopback** port for managed Xray;
it is distinct from the public node TCP port (normally 443). The signed
`/api/v1/node/desired-config` response carries the chosen local port and a
compiled Xray inbound bound to `127.0.0.1`.

The updated XMesh-Node `deploy/xmesh-xray-sync.sh` reconciles the actively
mounted `/etc/xmesh-node/config.json` router default to the verified Xray
port, including when the Xray JSON itself has not changed. The previously
managed Xray port is eligible for automatic migration (for example
`10443 -> 5000`). Customized SNI routes or unrelated manually selected
defaults are **never** silently overwritten: reconciliation reports an error.
The router container must be **recreated** after atomic `config.json`
replacement; a simple `docker compose restart` retains the old file bind
mount inode.

IMPORTANT: A signed **offline** policy does not carry new node settings
from the panel. If desired-config returns a non-200 HTTP status, the worker
now records that status and continues conservative offline enforcement.
Do not change the router to a new port until Xray is verified to be
listening on that port. Also do not disable the policy guard, re-enroll the
node, or replace its Ed25519 identity as part of troubleshooting.

On an already enrolled node, update the agent using the documented
`deploy/update-node-control-agent.sh` procedure above, then inspect:

```bash
systemctl start xmesh-xray-sync.service
journalctl -u xmesh-xray-sync.service -n 80 --no-pager
sudo ss -lntp | grep -E ':443|:5000|:10443'
docker inspect xmesh-node \
  --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
```

A green script exit and a running container do not independently prove a
successful traffic handshake. Confirm the signed policy revision, Xray
loopback listener, actual router backend, and client connection on a
disposable test account. Port changes can briefly interrupt active TCP
connections. CI tests for the migration live in the XMesh-Node repository;
live VPS acceptance is still required.
