# XSP-v2 P0-E2a snapshot / anti-rollback evidence

Status: **P0-E2a COMPLETE — one-sided Agent filesystem/VM snapshot rollback boundary only. P0-E remains CURRENT.**

This checkpoint pins and machine-checks the exact XMesh-Node implementation merged by [Node PR #39](https://github.com/TriplexCorp/XMesh-Node/pull/39) at [`3fffa9fd74195114a7c4e573a8a11e075c84f403`](https://github.com/TriplexCorp/XMesh-Node/commit/3fffa9fd74195114a7c4e573a8a11e075c84f403).

## Proven boundary

The real Go 1.27 Agent test captures the **complete** local security-state root before an authorized rotation, including the enrolled key vault, monotonic floor and local cutover journal. After the real rotation succeeds, the entire old state root is restored.

The proof intentionally confirms that this restored snapshot is locally self-consistent at the prior epoch. A marker stored in the same filesystem is therefore not treated as an independent anti-rollback authority.

The non-rolled-back trust domain is Nexus. The unchanged current dual-signed Nexus permit is re-delivered to the restored Agent. The real durable applied-state attestation then rejects the rolled-back state.

Both production-capable network entry points are tested:

- `runtime.Exchange` rejects before a listening TCP endpoint accepts any connection;
- `runtime.Recover` rejects before a listening TCP endpoint accepts any connection.

The source contract also verifies that `attestDurableAppliedState` remains before both underlying network calls.

## Security boundary

This proves **one-sided Agent snapshot rollback fails closed when Nexus remains current**. It does not claim that an Agent can detect a whole-host rollback using only files that were restored by that same snapshot.

A coordinated rollback of Node state and Nexus/PostgreSQL to mutually consistent old snapshots is outside this gate. Detecting that class requires an independent non-rolled-back authority, such as an owner-held/off-host monotonic recovery checkpoint, and must be bound to the later backup/restore and owner-authorized recovery design.

## Explicitly not proven here

P0-E2a does not prove:

- coordinated Node + Nexus/PostgreSQL rollback detection;
- PostgreSQL snapshot/restore safety;
- off-host owner checkpoint implementation;
- physical power removal or storage-controller write-cache durability;
- backup/restore authorization;
- old-key retirement;
- production rollout.

The next snapshot sub-gate is **P0-E2b: PostgreSQL snapshot rollback and cross-domain detection**.

`strict-pq` remains **OFF**. Production XSP-v2 rollout remains **NOT AUTHORIZED**.
