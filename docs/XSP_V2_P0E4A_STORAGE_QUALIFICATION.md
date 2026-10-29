# XSP-v2 P0-E4a physical power-loss / storage durability qualification

Status: **CURRENT / partial — baseline preflight only**.

This gate exists because P0-E1a proved process/filesystem ordering around `fsync`, rename and parent-directory `fsync`, but did not prove what a physical host, hypervisor, storage controller or device cache actually makes durable after abrupt power removal.

A successful P0-E4a preflight is **not** a physical power-loss qualification and does not authorize production XSP-v2 activation.

## E4a1 — read-only baseline preflight

`scripts/xsp-v2-p0e4a-storage-preflight.py` inspects one explicit persistent-state path in one of two roles:

- `agent-state` — the host filesystem backing the real XMesh-Node `/var/lib/xmesh-agent/xsp-v2` state root;
- `nexus-postgres` — the host filesystem backing the Nexus PostgreSQL data volume, plus the live PostgreSQL durability settings from an explicitly named local container.

The probe is read-only except for creating one new mode-`0600` JSON evidence file with exclusive create + file `fsync`. It does not mount devices, change filesystem flags, change block-cache policy, change PostgreSQL settings, stop/restart services, write Agent security state, reset epochs/replay state, regenerate keys or enable `strict-pq`.

### Baseline checks

The first reviewed filesystem set is intentionally narrow: local `ext4` and `xfs`. Overlay/network/tmpfs and other unreviewed filesystems fail baseline eligibility rather than being silently accepted.

For a directly inspectable block-backed filesystem the report records:

- mount source, filesystem type, target and mount options;
- resolved backing block device;
- Linux block queue `write_cache`, rotational and FUA attributes when exposed;
- kernel identity.

For `nexus-postgres`, the probe also requires and records:

- `fsync=on`;
- `full_page_writes=on`;
- durable `synchronous_commit` (`on`, `remote_write` or `remote_apply`);
- a visible `wal_sync_method`.

A missing/uninspectable direct block device, unsupported filesystem, read-only target or unsafe PostgreSQL setting fails closed.

### Write-back cache is not automatically trusted

If Linux reports a write-back cache, the report explicitly requires independent controller/device power-loss-protection evidence. The tool does **not** accept an operator boolean such as `--trust-write-cache` and does not turn a write-back device into `physicalPowerLossQualified=true`.

Even a reported write-through cache remains subject to real abrupt-power qualification because a hypervisor/controller/device may not implement the persistence semantics implied by the guest-visible queue state.

Every report therefore contains:

```json
"physicalPowerLossQualified": false
```

E4a cannot be closed by this preflight or by CI alone.

## Required physical qualification after preflight

A separately controlled qualification run must exercise abrupt host/power loss at the critical state transitions already identified by P0-E1a and the PostgreSQL commit/receipt boundary. The supported storage stack must be recorded precisely enough to reproduce the result, including filesystem, virtual/block-device topology, controller/cache mode and any power-loss-protection guarantees being relied upon.

After every abrupt restart, recovery must be either the previous complete security state or the next complete security state. The following are never acceptable:

- lowered epoch/replay floors;
- torn active Agent identity or a candidate interpreted as committed without the required durable evidence;
- fabricated ACK/receipt success;
- PostgreSQL acknowledging a security transition that disappears after recovery;
- silently reconstructed enrollment/signing identity;
- weaker transport/legacy fallback as a recovery mechanism.

The newest P0-E3a owner/off-host checkpoint remains outside the tested local storage domain and is still the independent rollback floor. The P0-E3b coordinated backup/restore invariants remain mandatory.

## CI boundary

The dedicated P0-E4a workflow may prove only the preflight policy implementation:

- source syntax and tests;
- ext4/xfs policy and unsupported-filesystem rejection;
- PostgreSQL durability-setting rejection;
- write-back cache requiring external PLP evidence;
- private exclusive evidence-file creation;
- read-only/no-mutation source boundary;
- retrieval of durability settings from a disposable PostgreSQL instance.

GitHub-hosted CI is **not** recorded as physical power-loss evidence and must never flip `physicalPowerLossQualified` to true.

`strict-pq` remains **OFF**. Production topology and rollout authorization remain unchanged.
