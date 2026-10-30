# XSP-v2 P0-E owner-authorized durable old-key erasure boundary

This bounded gate pins and independently re-verifies merged XMesh-Node PR #48 at exact source revision `3d2fc155ead11e86a2872ad12fbe28f157bb24db`.

It is the mutation follow-up to the already-pinned owner authorization and offline issuance gates. The owner authorization remains dual-signed with Ed25519 and ML-DSA-65 and bound to the exact retained previous→active rotation plus the signed off-host recovery checkpoint. This gate does not introduce a new owner identity, network route, API, or production control path.

## Proven boundary

Before any retained key snapshot is erased, the Node keyring persists an authenticated retirement marker under the existing Agent master key. The marker binds the exact owner-authorization digest, Node identity, `fromEpoch -> toEpoch`, and prior/active Ed25519 + ML-DSA-65 key IDs. The authorization digest includes the canonical authorization and both owner signatures.

The erasure operation may remove only the retained `.previous` and `.next` snapshots. It must not delete or rewrite the active vault or monotonic epoch floor. After each snapshot deletion the parent directory is fsynced. Crash-test checkpoints cover the durable intent, previous-snapshot deletion, and next-snapshot deletion boundaries.

An exact retry may finish a previously authorized erasure after a crash once the authenticated intent is durable, including after the original short authorization expires or a newer off-host checkpoint generation exists. This is continuation of the exact persisted mutation, not creation of a new retirement decision: owner signatures and checkpoint binding are still reverified and the durable marker must match the same authorization digest and key transition exactly.

The persistent retirement floor rejects rollback below the retired epoch, same-epoch active-key substitution, reintroduction of the retired snapshot pair, reuse of old recovery paths, and vault reinitialization over retained retirement history. Retirement markers must advance monotonically across later rotations.

## Independent Nexus verification

The Nexus contract pins the exact Node PR #48 merge and the exact delta from the previously reviewed PR #47 merge `cd1f187a06ea6f320023027e06e1a57d2be81af3`. CI checks the marker/MAC and deletion boundaries, proves there is exactly one non-test Agent caller of the low-level keyring mutation, re-runs the Go 1.27 Agent and keyring tests, and re-runs both retirement crash proofs.

The production Agent source guard remains production-only: `_test.go` subprocess crash injectors are allowed for durability evidence, while shipped non-test Agent Go source remains forbidden from adding shell/command execution or downgrade/fallback paths.

## Explicit non-goals

This gate does **not** establish physical power-loss durability; P0-E4a remains open until the real five-point abrupt-power matrix is executed and independently reviewed on representative storage/controller hardware. It does not add an HTTP/API retirement route, move owner private keys into Nexus or the normal Agent, enable `strict-pq`, replace the production legacy control path, or authorize production rollout.

A coordinated rollback of the retirement marker together with the entire local Agent trust domain still relies on the independent owner/off-host recovery witness; this local marker is not a substitute for that third trust domain.
