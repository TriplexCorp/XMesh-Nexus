# XSP-v2 P0-E offline owner retirement issuance

This gate pins the merged XMesh-Node offline issuance flow for explicit owner-authorized retirement of retained old Node signing material. It remains a bounded software/source-contract gate: no key is erased, no production HTTP/API route is added, and P0-E4a physical power-loss qualification remains open.

## Pinned implementation

- Repository: `TriplexCorp/XMesh-Node`
- Merged source revision: `cd1f187a06ea6f320023027e06e1a57d2be81af3` (Node PR #47)
- Previous reviewed Node revision: `e0f6bc01de98aad488fce73e1e605ba24f566bb1`
- Request schema: `xsp2-owner-retirement-request-1`
- Authorization domain: `XSP2-OWNER-RETIRE-PREVIOUS-V1`

## Trust separation

The real Agent side may export only a public retirement request. The request is derived from the authenticated retained previous→active rotation and the current signed owner/off-host recovery checkpoint. The exporter opens the existing Agent state through a read-only validation path; it does not create, chmod, repair, reset, erase or replace security state.

The owner signer is a separate offline tool. It receives the public request, the signed recovery checkpoint and owner-held Ed25519 + ML-DSA-65 private keys. Before issuing anything it derives the matching public owner identity from those private keys, re-verifies the dual-signed checkpoint, and requires exact request/checkpoint binding for Node identity, authenticated server authority, current epoch, active key IDs, owner identity, checkpoint generation, checkpoint timestamp and canonical checkpoint SHA-256.

The signed authorization is short-lived: its lifetime must be greater than zero and no more than five minutes. The existing Node PR #46 final verifier remains authoritative for checking that the live retained Agent state still exactly matches the owner authorization before any future retirement mutation can be considered.

## Owner private-key custody

The offline signer accepts owner private keys only from canonical absolute paths whose every path component is non-symlink. The final files must be regular files owned by the invoking UID with mode `0600`, containing exactly one unencrypted PKCS#8 `PRIVATE KEY` PEM block. Ed25519 and specifically ML-DSA-65 are required.

Owner private keys are never copied into Nexus and are never stored in the normal Agent security-state layout by this gate.

## Deliberate non-goals

This gate does **not**:

- delete `.previous` or `.next`;
- rewrite the active vault or monotonic epoch floor;
- expose owner private keys to Nexus or normal Agent runtime;
- add an HTTP/API/network issuance route;
- allow caller-selected URL/script/command input;
- add XMESH1 or weaker-crypto fallback;
- claim physical abrupt-power qualification;
- enable `strict-pq` or authorize production rollout.

The next mutation gate must separately prove durable crash-safe old-key erasure. It must consume the already verified owner authorization, remain monotonic under interruption/restart, never resurrect retired signing material, and preserve the independent off-host recovery floor.

## Acceptance boundary

The Nexus workflow checks out exactly the merged Node PR #47 revision, verifies the exact eight-file delta from Node PR #46, re-runs the Go 1.27 Agent tests, builds both offline tools and machine-checks that request export / offline issuance code contains no network, fallback, production activation or Agent-state mutation path.

Passing this gate does not change the official physical qualification status: **P0-E4a remains OPEN** until five representative real external BMC/PDU abrupt-power runs and independent review are complete. `strict-pq` remains OFF; production rollout remains NOT AUTHORIZED.
