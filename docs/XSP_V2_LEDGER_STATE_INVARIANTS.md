# XSP-v2 ledger state invariants — staging DB gate

Migration `0104_node_xsp_cutover_ledger_immutability.sql` adds a PostgreSQL **BEFORE UPDATE** trigger to the passive ledger introduced by migration 0103.

The trigger rejects: modifying any signed permit binding (including canonical bytes and nonce), updating unverified ACK fields on an unchanged `issued` row, changing committed ACK bytes/digest/timestamp, `ack_verified → issued`, `receipt_sent → issued`, `aborted → issued`, and any other non-monotonic state transition. After `receipt_sent` or `aborted`, only the exact same state can remain.

The current transition shape is `issued → ack_verified → receipt_sent` or `issued → aborted`. This trigger is **not a security authority**: it trusts that an application has independently authenticated BOTH signatures, checked owner-approved candidate public bytes and current epoch, persisted idempotency state, applied a protected Node vault/floor and committed server state before writing `ack_verified`. Direct SQL INSERT and DELETE, privileged DDL / trigger disabling, owner-approved revocation, verification of signatures, concurrent cutover proposals and external recovery are NOT solved by this migration.

In particular, deleting a row can still bypass UPDATE-only immutability; `ON DELETE CASCADE` from the parent key table is retained to avoid preventing intentional operational node retirement. A later signed, append-only audit chain and least-privilege database roles must prevent an application account from deleting/rewriting protocol history. **Until that is reviewed, do not claim durable anti-replay security or production readiness.**

Implementation follow-up:
1. Freeze a single transactional signer/DB protocol: authenticated owner + proved pending pair + independently derived candidate digest + protected `panel_response` signer.
2. Lock node suite/pending keysets and request ledger; return stored identical signed permit on idempotent retry, reject changed requests and nonce conflicts.
3. Verify both ACK signatures under the *new pending keys* against previously saved signed permit. Commit epoch and ACK record atomically, keep old keys until separate retirement.
4. Build fault-injection and transaction-level PostgreSQL tests for duplicate retries, concurrency, ACK loss, process crash, restored snapshots and intentional DELETE by restricted DB roles.
5. Only after security review and canary should an operator authorize any production cutover. `XMESH1` remains production; `strict-pq` OFF.
