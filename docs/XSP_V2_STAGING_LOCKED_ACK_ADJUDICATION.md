# XSP-v2 locked-ledger ACK adjudication — staging review gate

**Scope:** Rust module `xsp_v2_ack_ledger_validator.rs`, compiled only with `xsp-v2-experimental`; NO Axum route, DB writes, automatic epoch advancement, trust retirement or production activation.

An authenticated future Node caller would supply a Node identity and request ID, not a trusted permit or signer key. The Nexus server obtains a **previously persisted exact signed permit envelope** under row lock from its own ledger, and obtains the old/new public keys and owner approval from the transaction-locked suite/keyset/preparation rows. The trust root for `panel_response` is independently pinned configuration.

The validator:
- Locks suite, old keyset, prepared new keyset and issued ledger row in deterministic order.
- Recomputes approved candidate hash from raw old/new public bytes and verifies key fingerprints/provider compatibility and proved, unexpired preparation.
- Verifies BOTH Nexus Ed25519 and ML-DSA-65 permit signatures against the independently pinned `panel_response` public keys. Signed request ID, epochs, old/new key IDs, purpose, method, path, nonce, TTL and candidate digest must match independently trusted data.
- Checks the ledger's exact candidate bytes, canonical permit digest, nonce, old/new epochs, `issued_by` approval actor and state=`issued`.
- Constructs pinned `node_request` public keys from the *locked pending PostgreSQL row*, not from the ACK; validates BOTH Node signatures and the ACK's binding to the canonical original permit, applied-state digest and expiry.
- Returns a SHA-256 digest of the **exact ACK JSON bytes** plus request/epoch evidence to the caller. This is **not** evidence that the Node vault has been fsynced, nor that Nexus has committed a new epoch.

### Deliberately unimplemented; no production cutover authorized

This verifier NEVER writes ledger state or advances `node_xsp_suite_state.key_epoch`. A later single database transaction must insert the new active public keyset, advance server key epoch, save and lock authenticated ACK, and produce a signed server commit receipt while retaining old keys until separate retirement. Expired ACK/permit retry after commit needs an **idempotent recovered receipt path** based on a committed ledger row, not an attempt to re-run a no-longer-valid fresh-ACK verification flow.

An authenticated Node transport route, protected panel signing keys, durable Node floor anchored outside a restorable filesystem, restricted database roles/append-only audit, and live PostgreSQL concurrency/fault-injection tests remain hard blockers. No `strict-pq`, production `XMESH1` or Node 13 changes.
