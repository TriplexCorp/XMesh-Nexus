# XSP-v2 P0-E owner-authorized old-key retirement contract

This gate pins the first merged XMesh-Node owner-authorization primitive for eventual retirement of retained old Node signing material. It is a **bounded read-only authorization/source-contract gate**. It does not erase keys, expose a public HTTP route, activate strict PQ in production, or close the still-open P0-E4a physical power-loss qualification.

## Pinned implementation

- Repository: `TriplexCorp/XMesh-Node`
- Merged source revision: `e0f6bc01de98aad488fce73e1e605ba24f566bb1` (Node PR #46)
- Previous reviewed Node revision: `7bf8cc92950f396e33891c8744c1f6855414154b`
- Authorization domain: `XSP2-OWNER-RETIRE-PREVIOUS-V1`

The Node primitive uses the already-existing owner/off-host recovery identity instead of creating another owner key hierarchy. An authorization is canonical and must verify both Ed25519 and ML-DSA-65 owner signatures. It is bound to the exact Node identity, authenticated server authority, `fromEpoch -> toEpoch`, prior/active Ed25519 and ML-DSA key IDs, current signed off-host recovery checkpoint generation and exact canonical checkpoint SHA-256. The authorization lifetime is capped at five minutes.

## Local-state requirement

Authorization alone is insufficient. The real Agent state must still contain an exact authenticated applied rotation under the existing wrapping-key lock:

1. `.previous` is the authorized prior identity at `fromEpoch`;
2. active state is exactly `toEpoch = fromEpoch + 1` and equals the persisted epoch floor;
3. `.next` is the exact authenticated candidate retained from that applied cutover;
4. active and `.next` have the same public identities and byte-identical encrypted snapshot bytes;
5. Node ID and purpose are identical across the retained rotation.

Missing, substituted, mixed-generation, stale or checkpoint-mismatched evidence fails closed.

## Deliberate non-goals

This gate does **not**:

- remove or overwrite `.previous`, `.next`, active vault or epoch floor;
- turn a successful rotation into implicit permission to delete old signing material;
- add a caller-controlled recovery/reset/rekey path;
- add a production HTTP/API route or network transport;
- add XMESH1 or weaker-crypto fallback;
- claim that physical abrupt-power behavior is qualified;
- enable `strict-pq` or authorize production rollout.

A later reviewed gate may consume this exact proof to perform durable crash-safe old-key retirement. That later mutation must preserve monotonic epoch/replay state, survive interruption without reopening retired identities, and remain bound to explicit owner authorization and the independent off-host recovery floor.

## Acceptance boundary

The Nexus workflow for this contract checks out exactly the merged Node revision, verifies the contract fields, verifies the Node PR #46 delta against the previously reviewed revision, re-runs the real Agent recovery tests and keyring tests, and machine-checks that the retirement authorization path itself contains no erase/rename/network/fallback/production-activation operation.

Passing this gate is only repository/software evidence. **P0-E4a remains OPEN** until the five representative real external BMC/PDU abrupt-power runs and independent review are complete. `strict-pq` remains OFF; production rollout remains NOT AUTHORIZED.
