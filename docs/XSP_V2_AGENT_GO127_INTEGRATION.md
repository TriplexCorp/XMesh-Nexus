# XSP-v2 real Agent integration / Go 1.27 boundary

Status: **P0-D staging implementation contract; no production activation**.

This document defines the verified production-capable Agent boundary after staged package lifecycle, disposable real-Agent E2E, and durable-state hardening. It does not enable `strict-pq`, replace the production XMesh-Node router, retire the deployed shell control Agent, or authorize production rollout.

The machine-readable authority is [`deploy/xsp-v2-agent-go127.contract.json`](../deploy/xsp-v2-agent-go127.contract.json). CI validates that contract against exact XMesh-Node merge `5e8ee562915a570eb49ed46d59d723f233f3cc68` (Node PR #37), not against a moving branch.

## Verified component split

1. **Production XMesh-Node edge router** remains the root Go 1.23 module and root Docker image. It is not the signed control Agent and this gate does not change it.
2. **Existing signed control/update Agent** remains Nexus `deploy/node-control-agent.sh` plus `xmesh-node-agent-upgrade.service`. Remote action authority remains exactly `update_agent`; no second command queue exists.
3. **Go 1.27.3 Agent artifact boundary is `agent/xspv2`** in XMesh-Node. It is side-by-side and not installed or activated by default.
4. **Security primitives are reused, not copied** from `security/xspv2/poc-go`: `envelope`, `keyring`, `tlsprobe`, and `cutover`.

The production-capable wrapper delegates signed ACK exchange/recovery to `cutover` and durable key-state attestation to `keyring`. There is no shell or router copy of the XSP-v2 state machine.

## Completed staged package lifecycle

The **staged download / verify / apply / rollback** gate is complete in Nexus PR #101, and disposable real Nexus↔Node migration/update retry/restart/rollback proof is complete in PR #103.

The staged updater accepts only the immutable server-approved `{version, sourceRevision, artifactSha256}` identity, stages into a non-active content-addressed location, verifies exact SHA-256 and embedded source identity before activation, retains a last-known-good package/service boundary, switches atomically, and rolls package/service state back on failure. Caller-selected URL/script/command/executable location remains forbidden.

Package identity and package rollback are deliberately separate from durable security state. Rolling back an Agent package does not authorize lowering an XSP-v2 key epoch, deleting signed journals, regenerating enrolled identities, or changing the protocol of an operation already in the migrated path.

## Durable real-Agent security state

XMesh-Node PR #37 establishes the real-Agent layout under `/var/lib/xmesh-agent/xsp-v2`:

```text
/var/lib/xmesh-agent/xsp-v2/
├── cutover/                  # exact permit / signed ACK / commit-receipt journals
└── keys/                     # encrypted Node identity + monotonic key epoch floor
    ├── node-request.master
    ├── node-request.vault
    ├── node-request.vault.min-epoch
    ├── node-request.vault.next
    └── node-request.vault.previous
```

`state.Prepare` creates only the private `cutover/` and `keys/` directory boundaries. It does not initialize, replace, reset, retire, or regenerate enrollment identities.

Before `runtime.Exchange` or `runtime.Recover` can perform network I/O, the wrapper calls **`keyring.AttestAppliedRotation`** through the real-Agent state package. The reused keyring primitive proves all of the following together under the wrapping-key lock:

- the persisted epoch floor equals the exact expected `toEpoch`;
- the active encrypted vault is the prepared candidate;
- the authenticated `.next` snapshot is the exact new identity;
- the authenticated `.previous` snapshot retains the exact prior identity;
- active Node ID, purpose, epoch and public key fingerprints match the signed permit.

The runtime then compares that durable active public identity byte-for-byte with the authenticated pending signer used by the signed ACK lifecycle. A wrong minimum epoch, substituted public key, restored old active vault, lowered/corrupt floor, missing old-key snapshot, malformed/symlinked state, or mismatched layout fails closed **before transport**.

Restart tests prove re-running `state.Prepare` preserves master/vault/floor/previous/next bytes unchanged. The durable permit/ACK/receipt material continues to use the already-proven cutover journals with exact binding, immutable retry, atomic rename, file `fsync`, parent-directory `fsync`, and corruption/conflict rejection. This is the durable real-Agent security state boundary; no parallel replay/epoch state machine is introduced.

Old keys remain retained until a separately authorized retirement workflow exists.

## Authenticated transport authority

Direct routing and authenticated authority remain intentionally separate:

- `Address` is only the direct TCP connect target and may be an internal alias or IP;
- `ServerName` is the authenticated TLS authority;
- TLS SNI and certificate hostname verification use `ServerName`;
- **HTTP authority (`Host`) is set to the same authenticated `ServerName`**;
- proxy use is disabled;
- redirects are rejected;
- an alternate host, legacy route, TLS downgrade, or XMESH1 retry cannot replace that authority after an operation enters the migrated XSP-v2 path.

The wrapper reuses the existing strict `cutover` transport and never recreates it with a generic `http.Client` or secondary TLS configuration.

## Mixed-version and rollback rules

- Legacy unbound `update_agent` remains compatible and distinct.
- Manifest-bound staged migration without the required Go 1.27 runtime/state fails closed.
- Missing/invalid permit, ACK, receipt, durable key state, minimum epoch, strict transport, or authenticated authority fails closed.
- No automatic fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2, insecure certificate validation, proxy-selected authority, or redirect-selected authority.
- Package rollback may restore a previously verified executable/service tuple but may not lower the security floor, delete cutover evidence, retire old keys, or regenerate enrollment identities.

## Machine-checked acceptance for this boundary

Nexus CI fetches exact XMesh-Node `5e8ee562915a570eb49ed46d59d723f233f3cc68` and proves:

- root router remains Go 1.23;
- `agent/xspv2` remains Go 1.27.3 and depends on `security/xspv2/poc-go`;
- real-Agent state has separate `cutover/` and `keys/` boundaries;
- applied-state attestation reuses `keyring.AttestAppliedRotation` and requires floor + active candidate + retained old/new snapshots;
- restart/corruption/rollback negative tests exist at the real-Agent boundary;
- `Exchange` and `Recover` attest durable state before strict transport;
- HTTP authority remains bound to `ServerName`, with proxy and redirect disabled;
- fixed `update_agent` authority and immutable release identity remain unchanged;
- staged package lifecycle is complete while production activation remains false.

`strict-pq` remains **OFF**. Production rollout remains **NOT AUTHORIZED**. P0-D overall is evaluated only after this Nexus contract PR itself passes exact-head CI, fixed-head merge, and exact post-merge CI.
