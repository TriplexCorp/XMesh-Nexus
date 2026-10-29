# XSP-v2 P0-E3a owner/off-host recovery checkpoint

Status: **experimental recovery boundary only**. This does not activate strict-PQ, change production routing, add a remote action, or authorize production rollout.

## Goal

P0-E2a and P0-E2b proved one-sided rollback detection when either the Agent or PostgreSQL remains current. They do not detect a coordinated rollback where both local failure domains are restored to an older but mutually consistent state.

P0-E3a introduces a third trust domain: an owner-controlled/off-host checkpoint that is not included in the Agent filesystem snapshot or the Nexus/PostgreSQL backup set.

The checkpoint deliberately does **not** introduce a second security state machine or a new mutable recovery counter. Its monotonic floor is the already-committed XSP-v2 `toEpoch` from an immutable Nexus commit receipt. Its integrity and identity are inherited from the exact original receipt bytes, which must verify with both independently provisioned `panel_response` keys:

- Ed25519, and
- ML-DSA-65.

The off-host checkpoint stores:

- schema identifier;
- exact Node ID;
- minimum accepted committed epoch, derived from the receipt `toEpoch`;
- SHA-256 of the exact signed receipt bytes;
- the exact signed receipt bytes in canonical Base64.

The checkpoint file itself does not gain a new signature. Security-sensitive fields are accepted only when they exactly match the embedded dual-signed receipt. The trusted panel public-key pin is supplied independently by the owner/off-host recovery environment and must not be loaded from the restored Nexus database.

## Tool

`backend/src/bin/xsp_v2_recovery_checkpoint.rs` is registered only behind the existing `xsp-v2-experimental` feature.

It has two bounded offline commands:

```text
xsp-v2-recovery-checkpoint create --pin PANEL_PIN.json --receipt SIGNED_RECEIPT.json --out CHECKPOINT.json
xsp-v2-recovery-checkpoint verify --pin PANEL_PIN.json --checkpoint CHECKPOINT.json --local-state LOCAL_STATE.json
```

There is no HTTP listener, database client, remote URL, shell-command input, state mutation, or production activation in this tool.

`create` refuses to overwrite an existing checkpoint path, writes mode `0600`, and fsyncs the new file. The owner must then place the resulting checkpoint in an independently protected off-host/immutable location outside both rollback domains.

## Independent pin format

The recovery environment supplies a bounded JSON document containing only the trusted public identity:

```json
{
  "purpose": "panel_response",
  "issuerId": "nexus-production-identity",
  "nodeId": 13,
  "edKeyId": "ed-...",
  "pqKeyId": "pq-...",
  "ed25519PublicBase64": "...",
  "mldsa65PublicBase64": "..."
}
```

The tool derives the expected key IDs from the supplied raw public keys and rejects mismatches. The pin is a separate recovery trust input. Copying it only from the same restored Nexus/PostgreSQL snapshot would collapse the third trust domain and is outside the proven boundary.

## Local recovery-state input

The restore procedure supplies the local state it has already independently validated:

```json
{
  "nodeId": 13,
  "keyEpoch": 5,
  "currentReceiptSha256Hex": "..."
}
```

Rules:

1. A local `keyEpoch` lower than the checkpoint `minimumEpoch` is a coordinated rollback and is rejected.
2. At the exact checkpoint epoch, the local authoritative receipt SHA-256 must exactly equal the off-host receipt SHA-256. Same-epoch divergence is rejected.
3. A higher independently validated local epoch satisfies this checkpoint floor. This tool does not replace the normal XSP-v2 validation needed to prove that newer local state is itself authentic.
4. Wrong Node identity, malformed checkpoint fields, receipt digest mismatch, wrong trusted pin, invalid Ed25519 signature, or invalid ML-DSA-65 signature all fail closed.

## What this proves

The dedicated P0-E3a CI generates real Ed25519 and ML-DSA-65 keys with OpenSSL 3.5, creates a real dual-signed commit receipt, derives an off-host checkpoint, and proves:

- exact current state is accepted;
- a coordinated older local restore is rejected by the external epoch floor;
- same-epoch receipt divergence is rejected;
- a newer local epoch satisfies the floor;
- tampered checkpoint epoch/digest is rejected;
- wrong Node identity is rejected;
- a modified receipt with stale signatures is rejected;
- the tool contains no database/network/write-back control-plane path.

## Trust boundary and remaining work

This gate assumes the owner presents the **newest trusted off-host checkpoint**. If the off-host checkpoint store and its independently provisioned public-key pins are themselves rolled back together with Agent and Nexus/PostgreSQL, this bounded mechanism cannot detect that event. The third trust domain therefore must be operationally independent and protected from rollback.

P0-E3a also does not yet prove a complete production backup/restore procedure. The next recovery work must bind real Agent + Nexus/PostgreSQL backup sets and restoration steps to this checkpoint and demonstrate the coordinated restore failure path end-to-end before any production rollout.

No automatic epoch reset, replay reset, key regeneration, enrollment replacement, XMESH1 fallback, weaker transport selection, or hidden recovery state machine is introduced here.
