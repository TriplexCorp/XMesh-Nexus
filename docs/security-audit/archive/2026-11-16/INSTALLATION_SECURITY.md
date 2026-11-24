# Installation security — source review, qualification pending

No clean disposable VPS was available through the failed local executor. Hosted CI containers have exercised selected API, VLESS and managed-update paths; they do not prove fresh systemd/firewall/ACME installation, IPv6 networking or rollback on a real clean machine.

Reviewed Sub source provisions a Caddy proxy, private Unix-socket limiter and outbound manager, verifies update provenance and protects the manager key. The reviewed limiter container is non-root with dropped capabilities, read-only root and no-new-privileges. Caddy owns public 80/443 and persistent certificate data. Sub runtime Compose does not mount the Docker socket into the public proxy. Exact runtime effective privileges/ports and IPv6 peer identity must still be measured.

Nexus Compose defaults reviewed include loopback API binding and non-published database/cache; operators changing bindings alter the trust boundary. Node installation, activation, Xray binary/image checks, service file ownership and recovery must be reviewed and tested end to end. Existing documentation is not execution proof.

## Required clean-machine matrix

For each permitted repository: install using documented bootstrap with generated disposable credentials; inspect listeners, IPv4/IPv6 firewall, service UID/caps/mounts, file permissions, TLS validation and secret/log leakage. Repeat install, interrupt downloads/activation, update and rollback with corrupted/truncated/wrong-identity/stale artifacts; reboot and verify configuration/reconciliation. Only local test infrastructure may receive load. Preserve snapshots and results; do not reuse customer servers.

The login patch itself changes Nexus only. No Node Agent upgrade, manually created cryptographic key or API contract migration is required for that patch. It remains in draft and must not be treated as already deployed.
