# XSP-v2 durable permit/ACK ledger — staging-only design

**Not automatically migrated, enabled or deployed.** This reference SQL deliberately lives outside `backend/migrations`, because the regular Nexus deploy runs migrations against production. No server handler in this PR reads or writes the new ledger. It cannot authorize rotation.

## Mandatory implementation contract

The table holds an immutable `signed_permit` and `permit_input_sha256` for exactly one `(node_id,purpose,request_id)`. Duplicate delivery for the **same** request must replay the stored response, not mint new signatures or nonce. A different request during any active permit must fail closed. A one-time nonce cannot be reassigned, even after expiry. Old active verification keys must remain accepted until a separate authorized retirement.

**Before issuing (single DB transaction with per-node lock):**
1. Lock existing `node_metric_keys` row and owner-approved `node_xsp_rotation_preparations` row `FOR UPDATE`. Reject if the latter's dual PoP is missing/expired, wrong purpose, or if saved active epochs/public keys differ. Recompute canonical candidate digest from frozen, approved public bytes using a separately reviewed serializer.
2. Check there is no other nonterminal permit. Use a unique request ID and a random 16-byte nonce. The partial unique index blocks concurrent issuance.
3. Obtain dual-signature from a separately pinned and protected `panel_response` signer **without** exposing private keys to the API. Bound expiry to 60 seconds and persist exact signed envelope plus raw canonical input SHA-256 and owner approval. **Signer invocation + DB commit is not atomic:** persist an immutable authorization intent before signing, or use a transactional outbox with deterministic idempotent protected signer; never deliver a permit before durable commit. That handshake is not implemented here.

**On ACK (transaction):**
1. Select the permit row by trusted `node_id,purpose,request_id` under `FOR UPDATE`; validate its stored permit, current epoch/floor, pending pair and nonce before accepting any bytes from the request. A request-supplied permit is never a trust anchor.
2. Verify both Ed25519+ML-DSA-65 signatures from the pending **new** public keys over the exact ACK input; compare permit digest, epoch, keyset and applied-state digest to the persisted authorization, and enforce nonce uniqueness and expiration. ACK alone claims fsync — Node vault journaling/crash tests are required to establish durability.
3. Atomically insert immutable ACK data and advance the *separately held* active verification epoch via compare-and-swap. No old-key retirement here. Same signed ACK may be retried idempotently after commit; a different ACK/nonce for a committed request must be rejected.
4. Signed commit receipt must bind the same request, permit and ACK digests and be durable before Node drops pending ACK retry state. Loss of receipt must not roll back the Node floor.

**Important:** the SQL is an intentionally incomplete storage blueprint. The current `status` column alone must NOT be treated as a secure state machine: protect transitions with SQL compare-and-swap and controlled database roles, and add a transition-enforcing trigger or append-only event table. Expiration is a terminal report status, not proof of cutover rollback. Review the partial index lifecycle and whether receipt_pending and receipt_seen statuses need a separate transaction log before production use.

## Failure tests required before moving SQL to automatic migrations

- Concurrent permits for two requests/epochs on the same node: at most one wins; failed signatures or DB rollback never authorize cutover
- Duplicate same request, changed nonce/digest and out-of-order ACK: idempotent replay vs. rejection
- Crash after storing authorization but before signer reply, after Node fsync but before ACK, and after Nexus CAS epoch advance but before receipt
- Power loss/recovered old vault must not decrease suite floor or delete pending ACK record
- Restoration of old PostgreSQL backup must not resurrect nonce or trust epoch
- Caller who can edit the DB must not be able to bypass signature verification or add a live permit
- Cross-language Rust↔Go signed artifact vectors and adversarial fuzz cases
- No migration or live API activation until reviewed by owner and independent security reviewer

**Implementation dependency:** this schema is a starting point for PostgreSQL integration tests on an isolated disposable database, not permission to execute it on a live VPS.
