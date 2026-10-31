# XMesh Nexus — CLI update

The supported operator-facing terminal updater is the interactive `xmeshctl` menu.

From the XMesh Nexus repository directory run:

```bash
sudo bash xmeshctl
```

Then choose:

```text
4) Обновить из GitHub и пересобрать
```

The updater:

- verifies the repository/upstream state;
- asks for explicit confirmation;
- creates a PostgreSQL backup before update;
- fetches and fast-forwards from the configured upstream branch;
- runs installer preparation without resetting persistent credentials;
- validates Docker Compose;
- rebuilds/restarts the panel stack;
- when run as root on a managed host, reapplies the host-side HTTPS/single-public-443 topology.

`xmeshctl --web-update` is an internal non-interactive entrypoint used by the owner-authorized web/systemd updater. Operators should normally use `sudo bash xmeshctl` for manual terminal updates instead of invoking `--web-update` directly.

A completed CLI command is not by itself proof that every dependent Node/Agent was updated. Verify panel health and runtime state after the operation.
