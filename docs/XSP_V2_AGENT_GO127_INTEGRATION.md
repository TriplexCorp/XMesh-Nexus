# XSP-v2 real Agent integration / Go 1.27 boundary

Status: **P0-D staging design contract; no production activation**.

This document defines the integration boundary for the next production-capable Agent work. It does not enable `strict-pq`, replace the production XMesh-Node router, download or apply a new executable, or authorize production rollout.

The machine-readable authority for this gate is [`deploy/xsp-v2-agent-go127.contract.json`](../deploy/xsp-v2-agent-go127.contract.json). CI validates that contract against the exact pinned XMesh-Node source checkpoint rather than trusting documentation alone.

## Verified component split

The managed node is not one monolithic "Go Agent".

1. **Production XMesh-Node edge router**
   - source: `TriplexCorp/XMesh-Node` root module;
   - verified source checkpoint: `0ae78244ef0ef763bea6ce198dde6e83eb11ff1f`;
   - Go language line: `go 1.23`;
   - production image is built from the root `Dockerfile`;
   - in managed bootstrap, router configuration intentionally does not retain `panel_url`, `node_id` or `private_key_file`, so the router is not the signed control heartbeat authority.

2. **Existing signed control/update Agent**
   - implementation: Nexus `deploy/node-control-agent.sh` installed as a fixed systemd-controlled worker;
   - updater: Nexus `deploy/update-node-control-agent.sh` through `xmesh-node-agent-upgrade.service`;
   - remote action remains exactly `update_agent`;
   - PR #90/#91/#93/#95 already bind immutable release identity and carry exact identity through signed poll/apply/ACK;
   - this worker remains the lifecycle/command authority during migration. The Go 1.27 security runtime must not introduce another remote command queue.

3. **Verified Go 1.27 XSP-v2 staging module**
   - source module: `security/xspv2/poc-go` in the pinned Node checkpoint;
   - module path: `github.com/TriplexCorp/XMesh-Node/security/xspv2/poc-go`;
   - Go language line: `go 1.27.3`;
   - reusable package boundaries already proven in staging include `envelope`, `keyring`, `tlsprobe` and `cutover`;
   - `cutover` contains the durable permit/applied-ACK/commit-receipt journal and recovery primitives used by the completed C2-D proof.

## Integration decision

The Go 1.27 code becomes a **local fixed security helper/runtime of the existing signed control Agent**, not a replacement for the edge router and not an independent network control plane.

The control Agent remains responsible for accepting only the fixed `update_agent` lifecycle selected by Nexus. A migrated operation may invoke the local Go 1.27 security runtime to perform the strict XSP-v2 transport, envelope/key custody, cutover journal and recovery behavior that has already been proven in isolated staging.

The helper/runtime must not expose a new inbound TCP listener, accept an arbitrary executable path, accept a caller-selected download URL, or create a second command queue. Its remote-action authority remains the existing signed control Agent and immutable release manifest.

## Packaging and release boundary

A future Go 1.27 runtime package must be built from an **exact approved Node source revision** and must have an **exact SHA-256 artifact digest**. Those values must equal the immutable Nexus release manifest before any apply operation.

The next implementation gate will define staged download, verify, apply and rollback. This gate deliberately does not implement those phases. Before an apply can exist, the updater must have a last-known-good package boundary that survives failed verification, failed start and restart recovery.

The production Go 1.23 router image is outside this migration package. A Go 1.27 Agent-security package must not silently cause the router Dockerfile/module to move to another Go version.

## Mixed-version rules

Compatibility is asymmetric by design:

- **Legacy unbound `update_agent`:** existing behavior remains compatible and identity-free.
- **Bound staged migration + no Go 1.27 runtime:** fail closed; do not report success and do not fall back to a legacy migrated operation.
- **Go 1.27 runtime + peer without required strict XSP-v2 support:** fail closed.
- **Missing/invalid permit, ACK, receipt, epoch/replay state or strict transport:** fail closed.
- **Transport failure or unavailable security component:** fail closed.
- **No automatic fallback** to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate verification for a migrated operation.

Legacy production traffic/control behavior remains deployed until a later explicit migration/release gate. This rule does not retroactively convert ordinary legacy operations into strict-XSP-v2 operations.

## Reuse instead of a parallel state machine

The implementation must reuse the verified Go 1.27 module boundaries:

- `envelope` for the XSP-v2 message/envelope primitives;
- `keyring` for verified key material handling;
- `tlsprobe` for the strict transport authority/negotiation behavior;
- `cutover` for permit, ACK, receipt, journal, replay/epoch and recovery behavior.

New production integration code may adapt those packages to the real filesystem/service layout, but must not duplicate their security state machine in shell, the router, or a second Go module.

## Runtime authority and rollback

The existing updater already has a fixed systemd entrypoint and preserves/rolls back managed router source on failed router upgrade. The Go 1.27 package will require its own exact last-known-good package slot before apply is implemented.

Rollback must restore an exact previously verified package identity, not a moving branch/tag. A rollback must not lower the security mode of an operation that has already entered the migrated strict-XSP-v2 lifecycle.

## Acceptance boundary for this gate

This integration-design gate is complete only when CI proves against the pinned XMesh-Node checkpoint that:

- root production router module remains Go 1.23 and its Dockerfile remains Go 1.23 based;
- the nested verified XSP-v2 module remains Go 1.27.3;
- the `envelope`, `keyring`, `tlsprobe` and `cutover` package boundaries are present;
- managed bootstrap keeps signed control reporting separate from the router;
- Nexus still uses the fixed `update_agent` action and fixed updater service;
- the machine-readable contract forbids production activation, parallel command queues and downgrade fallback.

After that, the CURRENT P0-D work moves to **staged download / verify / apply / rollback**.

`strict-pq` remains **OFF**. Production rollout remains **NOT AUTHORIZED**.
