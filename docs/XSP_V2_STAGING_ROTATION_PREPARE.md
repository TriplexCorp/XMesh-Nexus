# XSP-v2 staging rotation: prepare and dual-proof only

**27 October 2026 — experimental feature-gated research, NOT production activation.**

The normal production Nexus backend does **not** compile these endpoints. They
require an isolated build with `--features xsp-v2-experimental` and runtime
`XSP_V2_EXPERIMENTAL_HEARTBEAT=staging-only`. The public production Nginx
does not forward them. The existing initial enrollment `/api/v2/node/keys/claim`
remains **initial epoch-1 only** and is **not** a rotation endpoint.

## Phase 1: owner-approved prepare

`POST /api/v2/admin/nodes/{id}/rotation/prepare` uses the same JSON public
key fields as initial owner approval: `keyEpoch`, `ed25519KeyId`,
`mldsa65KeyId`, `ed25519PublicB64`, `mldsa65PublicB64`.

Authenticated **owner** identity, existing trusted legacy Node, XSP-v2
`minimum_suite=1`, phase `dual_enrolled` or `shadow`, current
`key_epoch >= 1`, unrevoked current `node_request` public keys, exact
`newEpoch = currentEpoch + 1` and *fresh* key IDs are required.
The endpoint creates a random 32-byte challenge with 10-minute expiry;
PostgreSQL stores **only its SHA-256 and the proposed public keys**, never
private keys, challenge plaintext or wrapping keys.

Only one proposal can exist per Node. An expired **unproved** proposal may be
replaced by the owner; a proposal already successfully proved remains frozen
until the missing independently reviewed signed-cutover protocol is built.
This conservative behavior avoids quietly discarding valuable recovery state.

## Phase 2: prepared Node possession proof

`keytool prepare-rotation` creates an encrypted `.next` bundle but preserves
the active key pair and active floor. Once the owner approves **the exact two
new public key IDs** and issues the challenge, the offline Go 1.27.3 research
`keytool prove-prepared` signs the following binary input **with BOTH
Ed25519 and ML-DSA-65 prepared private keys**:

1. ASCII `XSP2-KEY-ROTATE-PREPARE-V1` followed by `0x00`
2. `i64_be(nodeId) || i64_be(fromEpoch) || i64_be(keyEpoch)`
3. `len32_be("node_request") || ASCII("node_request")`
4. Exactly 32 raw challenge bytes
5. Exact 32-byte Ed25519 **new** public key and 1952-byte ML-DSA-65 **new** public key
6. `len32_be(edKeyId) || edKeyId || len32_be(pqKeyId) || pqKeyId`

Submit only this canonical JSON proof to
`POST /api/v2/node/keys/rotation/prove` **on disposable staging**. It must
match the owner-approved keys, node ID, epochs, purpose and unexpired
single-use challenge. The Rust verifier checks both actual signatures
against the stored public keys before recording `proved_at` in the same
transaction. Replays and simultaneous claims cannot prove twice.

**Important: a 200 proof result is NOT a signed approval or ACK.**
Its `cutoverAuthorized` is **false**. It does NOT update
`node_xsp_suite_state.key_epoch`, add an active public keyset, revoke a
previous key, authorize local `activate-rotation` or enable strict-PQ.

## Outstanding security gates

- Design a signed, authenticated Nexus→Node prepare acceptance and Node→Nexus
  cutover/applied ACK. Bind actual applied epoch and state, request ID, signed
  server trust anchor and both key IDs, with durable anti-replay.
- Only after verified signed acceptance may a separate atomic server
  cutover/revocation be implemented. Design for crash, lost response, retry,
  reconciliation and backup/restore; never downgrade the suite floor.
- Revisit privilege separation, safe owner UI, independent KMS/backups and
  external FIPS 204 KAT/fuzz/security review.
- Test the full protocol on an isolated canary and real node-only hybrid TLS
  endpoint **before** any production XSP-v2 or strict-PQ activation.

No live node/agent, public listener, production Docker feature flag or working
Xray/Hysteria2 configuration changes in this PR.
