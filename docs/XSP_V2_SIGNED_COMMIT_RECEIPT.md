# XSP-v2 signed Nexus commit receipt — staging protocol V1

## Current staging recovery checkpoint (27 October 2026)

Nexus [#55](https://github.com/TriplexCorp/XMesh-Nexus/pull/55) already provides
an immutable PostgreSQL exact-byte signed receipt outbox. The newer
`load_committed_signed_receipt_staging` helper in
`backend/src/xsp_v2_signed_receipt_outbox.rs` implements a **read-only
retry/recovery path**: it revalidates the original committed dual-signed Node
ACK and Nexus permit, acquires suite → ledger → outbox locks, checks the
recorded key epoch, request ID and all stored digests, and re-verifies BOTH
independently pinned Ed25519 and ML-DSA-65 Nexus receipt signatures before
returning the original receipt bytes. Missing or corrupt receipts fail closed,
even when an ACK was committed; no re-signing or second epoch CAS occurs.
OpenSSL 3.5 + PostgreSQL signed integration tests cover successful recovery
and mismatched ACK, request, or panel pin.

**Still missing:** authenticating a real Node HTTP caller independently of the
signed ACK, a separately protected `panel_response` signer/custodian, a
production-approved PQ-only TLS 1.3 `X25519MLKEM768` ingress, a deployed
Nexus `POST /api/v2/node/keys/rotation/ack` handler, real Nexus ↔ Node
end-to-end delivery and rollback/recovery security gates. The helper MUST NOT
be exposed as a public route or used to infer transport authentication.
`strict-pq` remains OFF in the current legacy deployment.

_The original protocol-design checklist below is retained as historical
context; its statement that durable outbox is not implemented is superseded
by this checkpoint._


**Status:** internal Rust producer and Go 1.27 Node verifier. **NOT** an
authenticated live network endpoint, durable receipt outbox, trusted panel
signing service, integrated production Agent or permission to retire keys.

## Security purpose

Following a **committed** and verified Node-applied ACK, Nexus must give
Node immutable, independently authenticated evidence that the server really
switched its recorded key epoch. A missing HTTP response after PostgreSQL
COMMIT must NOT cause a second epoch CAS, an Ed25519-only acceptance, removal
of old sealed keys, or rollback to XMESH1.

In staging, Nexus can only sign a receipt from the opaque
\`StagingStoredACKEvidence\` returned by
\`readback_committed_applied_ack_staging\`. That readback locks the suite and
ledger, rechecks the exact saved Ed25519+ML-DSA-65 ACK and dual-signed Nexus
permit against independently pinned historical public keys, the exact
SHA-256 hashes, replay nonce and committed database epoch. It does **not**
accept claims supplied by an untrusted Node as verified evidence.

A future protected \`panel_response\` signer must independently verify the
receiving identity, its authorization and the committed DB state before
using this producer. Signing keys must not be exposed to HTTP handlers,
Node, UI, PostgreSQL rows or logs.

## Receipt V1 canonical bytes

Strict JSON outer signed object:

- \`message\` (camel-case except the uppercase \`PQ\`, \`SHA256\`, \`ACK\`
  field spellings listed below).
- \`signatures.ed25519\` and \`signatures.mldsa65\`, strict padded canonical
  Base64 of **exactly** 64 and 3309 signature bytes.

Message must have exactly the following fields (unknown/duplicate fields
are errors):

| Field | Constraint |
|---|---|
| \`protocol\` | Exact \`XSP/2\` |
| \`kind\` | Exact \`commit_receipt\` |
| \`issuerId\` | Pinned non-Node \`panel_response\` identity |
| \`signerEdKeyId\`, \`signerPQKeyId\` | Independently pinned SHA-256-based fingerprints |
| \`nodeId\` | Positive u64, at most signed PostgreSQL BIGINT max |
| \`fromEpoch\`, \`toEpoch\` | Positive; \`to=from+1\`, checked overflow |
| \`requestId\` | Exact 1–64 ASCII printable no-spaces, from saved permit+ACK |
| \`committedAtMs\` | Positive original DB \`ack_verified_at\` in Unix milliseconds |
| \`ackNonceHex\` | Exact signed ACK nonce, 16 bytes, lowercase hex, nonzero |
| \`candidateSHA256Hex\` | Exact approved old/new public-key candidate digest, nonzero 32 bytes |
| \`permitSHA256Hex\` | SHA-256 of the canonical, independently verified signed **permit input** (not JSON), nonzero 32 bytes |
| \`signedACKSHA256Hex\` | SHA-256 of the exact serialized, doubly signed ACK envelope, nonzero 32 bytes |

Signing bytes are concatenated in this **exact order**:

1. ASCII \`XSP2-CUTOVER-COMMIT-RECEIPT-V1\` and a single \`0x00\`.
2. Bytes \`0x01, 0x02\` = version 1, Nexus→Node direction 2.
3. \`u64_be(nodeId)\`, \`u64_be(fromEpoch)\`, \`u64_be(toEpoch)\`.
4. Each of \`requestId\`, \`issuerId\`, \`signerEdKeyId\`,
   \`signerPQKeyId\` as \`u32_be(length) || ASCII(value)\`,
   each nonempty printable \`0x21..0x7e\`, maximum 64.
5. \`i64_be(committedAtMs)\` (Unix milliseconds).
6. Raw decoded 16-byte \`ackNonce\`.
7. Raw decoded 32-byte \`candidateSHA256\`, raw 32-byte
   \`permitSHA256\`, raw 32-byte \`signedACKSHA256\`.

**Both Ed25519 and ML-DSA-65 sign these same canonical bytes**, not a
re-serialized JSON object and not one another's signature. The format is
separated from permit, ACK, initial owner PoP and generic message domains;
reflection fails. Shared independent Rust and Go test vector:
\`docs/XSP_V2_COMMIT_RECEIPT_VECTORS.json\`.

Unlike a fresh remote **command**, this immutable historical receipt has no
expiring message TTL: a lost response can be inspected after the original
ACK's TTL expired. But it is valid **only** against the exact locally saved
permit and signed ACK, original Node ID/request ID/epoch/nonce, independently
pinned panel public pair and Node's durable monotonic key epoch floor.
Original \`committedAtMs\` must be between the verified ACK issuance and
expiry. Node compares against the **signed ACK saved on disk**, not against
a second copy supplied by Nexus in the receipt. A valid receipt itself is
not proof of local fsync, protected floor or absence of full-disk rollback.

## Security gates remaining before connecting HTTP

1. A protected \`panel_response\` signer and independently distributed
   trust pins. Two private signing keys must be accessible only to the
   authorized signing service; panel owner authorization required.
2. PostgreSQL durable immutable **signed receipt bytes** and outbox, atomic
   request dedupe and safe retry with exact same signed artifact. No
   unsynchronized signing and \`receipt_sent\` marking.
3. Agent integration: Go 1.27-compatible verified runtime, separate
   node-only TLS 1.3 **X25519MLKEM768** endpoint, strict signature
   verification and persisted local permit/ACK/receipt journal.
4. Complete signed desired-config and commands, including no-command,
   deny/stop and ACK, with revision binding and replay protection.
5. End-to-end crash/SIGKILL, restore, repeated ACK, old/new public keys,
   privilege-bound DB tamper and genuine TLS handshake failures, owner
   enrollment, KAT/fuzz, disposable canary and independent security review.

**Required eventual deployment:** XSP-v2 is **PQ-only**. There is NO
user-selected downgrade to XMESH1, Ed25519-only or classical TLS. An
unavailable/misconfigured PQ provider fails closed. Existing legacy Agent
and Xray VPN traffic are unchanged by this disconnected staging primitive;
the real Agent update must first replace the whole secure control path and
not merely update a heartbeat binary.

See [PQ-only security policy](XSP_V2_PQ_ONLY_SECURITY_POLICY.md).
