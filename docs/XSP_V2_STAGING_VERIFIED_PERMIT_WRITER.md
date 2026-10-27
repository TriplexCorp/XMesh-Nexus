# XSP-v2 verified permit persistence — experimental gate

**This is not a live Nexus cutover issuer or a production-ready PQ control channel.** The module `backend/src/xsp_v2_permit_ledger_writer.rs` is compiled only with `xsp-v2-experimental` and has NO Axum route. It never generates new private keys, approves a keyset, advances an epoch, accepts an ACK, retires old keys or enables strict PQ.

## Transactional properties

A future separately authenticated owner flow supplies `authenticated_owner`, independently approved `expected_request_id`, and a trusted pinned `panel_response` **public** pair. The dual-signed permit envelope must already have been produced by an independently provisioned trusted signer; neither signer credentials nor public-key pins may be taken from that envelope.

Inside the *caller's open PostgreSQL transaction*, `persist_verified_permit`:

1. Locks the node suite state, current `node_request` public keys and proved, unexpired owner-approved pending keyset via `load_locked_candidate`.
2. Independently recomputes canonical `candidateSha256` from the locked old and pending public keys and checks the authenticated owner against the approval row.
3. Requires an exact independent request ID, verifies BOTH Ed25519 and ML-DSA-65 signatures under the pinned panel keypair, and checks epoch, old/new key IDs, nonce, candidate digest, role, path and TTL.
4. Rejects a permit whose expiry exceeds the expiration of the locked approved pending keyset. The one-use `node_xsp_cutover_permit_ledger` uniqueness constraints reject nonce/hash/request collisions and simultaneous outstanding permits.
5. Persists **exact signed envelope bytes** and canonical signing input digest. Identical requests using *the same byte-for-byte signed envelope* are idempotent. Conflicting/aborted requests fail closed. Retries must reuse stored signed bytes rather than create new randomized signatures.

**Caller MUST commit the same transaction before sending the permit**; a return value is not proof of commit. There is no public route that can invoke this code.

## Remaining safety and architecture gates

- A protected, audited `panel_response` signer (KMS/process isolation), independent pin distribution, and authenticated owner approval are **not implemented**. Public pins passed to this helper must not be sourced from untrusted client JSON.
- The helper does not establish a single process-level idempotency API, sign new permits, commit the transaction itself, or cover privileged DELETE of ledger history.
- The Node side must prove durable applied vault/floor before signing ACK; Nexus must verify a new-key dual-signed ACK against the stored permit and atomically commit the new epoch plus an authenticated signed server receipt. Old keys must not be retired early.
- PostgreSQL transaction-level fault tests (concurrent permits, failpoints, replay, crash, lost ACK), least-privilege role restrictions, external anti-rollback/KMS and security review are required before any canary.
- Do not use this staging helper for live Poland-2 or change production `XMESH1` and `strict-pq`.

CI: `cargo test --manifest-path backend/Cargo.toml --features xsp-v2-experimental --bin xmesh-api -- xsp_v2_permit_ledger_writer::tests` in the OpenSSL 3.5 workflow.
