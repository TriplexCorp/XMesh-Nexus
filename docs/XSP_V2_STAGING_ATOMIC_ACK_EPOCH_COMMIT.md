# XSP-v2 atomic ACK/epoch commit — isolated staging candidate

**Scope:** `backend/src/xsp_v2_ack_epoch_commit.rs`, compiled ONLY when `xsp-v2-experimental` is enabled. There is NO new HTTP handler, caller, production signer, strict suite activation or key retirement. This code is **not production-ready and needs live PostgreSQL integration/fault-injection tests**.

The helper `commit_fresh_applied_ack_staging` starts and owns one PostgreSQL transaction. It calls the locked read-only ACK verifier from Nexus PR #44, which authenticates the **database-stored original dual-signed permit** against independently pinned Nexus `panel_response` public keys, pending prepared/approved Node public keys, exact epochs, nonce, digest and TTL. Only after successful verification it:

1. Inserts the authenticated Node ACK nonce into `node_xsp_replay_nonces` with its next epoch and request ID, relying on its unique index to prevent replay.
2. Inserts only the proved, approved next **public** Node verification pair from `node_xsp_rotation_preparations` into `node_xsp_public_keysets`, retaining the old keyset.
3. Advances `node_xsp_suite_state.key_epoch` through compare-and-swap only if the exact old epoch and permitted staging phase remain unchanged. The minimum suite stays unchanged.
4. Transitions the exact ledger request from `issued` to `ack_verified`, persisting signed ACK bytes and SHA-256. Trigger 0104 prevents replacing that authenticated receipt evidence.
5. Calls `tx.commit()` only when all steps have succeeded, so a DB statement error leaves no partial logical commit.

### Disposable PostgreSQL SQL harness (P0-A, partial)

`scripts/test-xsp-v2-ack-epoch-atomicity.sh` runs in Backend CI against a
**disposable PostgreSQL container**. It exercises forced SQL aborts after each
of the four DB statements and competing transactions for the *same* nonce,
then checks that only one ACK/epoch commit survives, replay is rejected, and
the old public key remains. A ready advisory lock synchronizes the concurrent
test sessions; it is **test-only** and not part of the cutover protocol.

**Security limit:** the test inserts placeholder signed envelopes and directly
issues SQL; it does **not** invoke `commit_fresh_applied_ack_staging`, verify
Ed25519/ML-DSA-65, simulate an OS crash/power loss, or provide safe
retry-after-commit/read-back. Full Rust→PostgreSQL signed integration and
failure/recovery tests remain P0 blockers.

### Real dual-signature → Rust → PostgreSQL integration (isolated CI)

The dedicated OpenSSL 3.5 crypto workflow now runs
`real_postgres_signed_ack_commit_and_fail_closed` against a disposable PostgreSQL
TimescaleDB/PostgreSQL 18 service with the actual application migrations `0099–0104`. CI generates
throwaway Ed25519/ML-DSA-65 keypairs **in memory**, stores independently
approved public keysets, persists an authentic signed Nexus permit using
`persist_verified_permit`, then passes a genuinely dual-signed Node ACK through
`commit_fresh_applied_ack_staging`. The test checks DB epoch CAS, nonce,
immutable ledger bytes/digest, old public-key retention, unchanged suite floor,
and rejection of altered request IDs, missing PQ signature and duplicate ACK.

This is **not** proof of production readiness: PoP approval is represented by a
test-only database fixture, not a real owner flow or Node vault; no kill -9,
full disk restore, cross-process concurrency, retry-after-commit receipt,
protected signer, transport API or active Node is exercised. The ephemeral
PostgreSQL credential must never be reused outside GitHub CI.

### Committed ACK readback (isolated staging, read-only)

`readback_committed_applied_ack_staging` offers an internal, **read-only**
verification path for an ACK whose original `commit_fresh_applied_ack_staging`
transaction succeeded but the response was lost. It locks the suite first,
requires the exact `ack_verified` ledger row and current matching staging
epoch, and compares the caller's authenticated Node/request identity and
**byte-for-byte** signed ACK with the stored envelope and SHA-256.

Unlike fresh cutover verification, the helper never trusts a possibly
replaced pending preparation row. It recomputes the original candidate digest
from the preserved previous and new **public** verification keysets, verifies
the *stored* permit against an independently pinned panel public pair, verifies
the *stored* ACK under the new Node Ed25519 and ML-DSA-65 keys, checks the
ledger's permit digest/nonce/original time fields, and requires the original
replay nonce to be present for the same request and epoch. It validates signed
TTL against PostgreSQL's recorded `ack_verified_at` **commit-time evidence**,
rather than incorrectly rejecting an otherwise valid historical record because
a retry happened after message expiry. It never inserts or updates data.

This returns a `StagingStoredACKEvidence` struct **inside the process**.
It is **not** cryptographically signed Nexus confirmation, a replayable
network response, an API handler, evidence of Node vault durability, or
authorization to delete a Node ACK journal or retire previous keys.
Readback currently fails closed after subsequent epoch transitions or key
revocation and for the future `receipt_sent` state until those cases receive
a separately reviewed protocol. PostgreSQL roles, row deletion protection and
auditable append-only history remain further security work.

### Immutable signed receipt outbox (staging-only)

After the verified PostgreSQL commit and historical ACK readback, a separate
Rust operation `store_or_load_signed_receipt_staging` accepts **only** an
existing, cryptographically verified Nexus Ed25519 **AND** ML-DSA-65 receipt
matching the exact original permit and signed ACK. Migration
`0105_node_xsp_signed_commit_receipt_outbox.sql` creates a single immutable
receipt-envelope row per (authenticated Node, request), with a composite
foreign key to the original cutover ledger, exact hashes, epochs, and an
insert trigger that requires the original ledger to be `ack_verified`.

The Rust writer first revalidates the signed historical ACK, then locks
the same suite/ledger rows and confirms their state is unchanged; only then
does it insert the exact signed receipt. Subsequent identical retries
return the **original signed bytes**. Different signed JSON bytes, corrupt
records or a mismatched request/pin fail closed. Both UPDATE and DELETE on
the outbox are rejected by a database trigger. The OpenSSL 3.5 +
throwaway PostgreSQL CI test verifies signed receipts, exact duplicate,
incompatible retry and SQL immutability.

**Not a production endpoint:** No signer credentials or private keys are
stored in SQL; the receipt must be independently signed by a protected
`panel_response` signer before calling the writer. No authenticated
Node-only HTTP route, trusted TLS terminator, deployment, Node vault
attestation or guaranteed crash-proof disk/KMS monotonicity is supplied
by this staging component. Signed receipt storage also does not authorize
key retirement.

### Critical remaining gates

- **Protected panel signer / authenticated transport**: no enabled server route, KMS/HSM signer, deployed pinned trust root or independently reviewed approval flow. Do not connect this helper to an untrusted API.
- **Database integration under fault injection**: PostgreSQL unique/replay/ACK/epoch CAS tests, duplicate request and parallel transactions, SQL error between each statement and process crash after DB commit. The current compile/unit tests do NOT establish all these invariants in a live database.
- **Split-brain and restart handling**: internal readback now validates a committed ledger ACK without a second epoch CAS, but there is still NO authenticated network retry response, durable signed receipt, post-epoch-transition recovery, or crash/power-loss end-to-end test. A database witness must not be treated as a Node-visible commit receipt.
- **Signed server commit receipt**: no signed receipt binding permit SHA-256, ACK SHA-256, nodeId, target epoch and nonce has been designed and durably stored. Node must retain pending ACK until it verifies such a receipt.
- **Durable Node keys and anti-rollback**: the Node journal and applied-vault tests do not prevent rollback when an attacker restores the entire disk/floor and master key; out-of-band KMS or remote monotonic proof required.
- **Independent security review and disposable canary**: required before production rollout. No `XMESH1` or `strict-pq` changes, and Xray/user traffic is unaffected.

## Integrity statement

The fresh helper returns `StagingACKCommit` after DB transaction commit; the readback helper returns `StagingStoredACKEvidence` after validating committed history. **Neither struct is a cryptographic receipt**, and neither may authorize Node key retirement or deletion of its durable ACK journal.
