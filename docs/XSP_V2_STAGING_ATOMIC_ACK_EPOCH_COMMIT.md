# XSP-v2 atomic ACK/epoch commit — isolated staging candidate

**Scope:** `backend/src/xsp_v2_ack_epoch_commit.rs`, compiled ONLY when `xsp-v2-experimental` is enabled. There is NO new HTTP handler, caller, production signer, strict suite activation or key retirement. This code is **not production-ready and needs live PostgreSQL integration/fault-injection tests**.

The helper `commit_fresh_applied_ack_staging` starts and owns one PostgreSQL transaction. It calls the locked read-only ACK verifier from Nexus PR #44, which authenticates the **database-stored original dual-signed permit** against independently pinned Nexus `panel_response` public keys, pending prepared/approved Node public keys, exact epochs, nonce, digest and TTL. Only after successful verification it:

1. Inserts the authenticated Node ACK nonce into `node_xsp_replay_nonces` with its next epoch and request ID, relying on its unique index to prevent replay.
2. Inserts only the proved, approved next **public** Node verification pair from `node_xsp_rotation_preparations` into `node_xsp_public_keysets`, retaining the old keyset.
3. Advances `node_xsp_suite_state.key_epoch` through compare-and-swap only if the exact old epoch and permitted staging phase remain unchanged. The minimum suite stays unchanged.
4. Transitions the exact ledger request from `issued` to `ack_verified`, persisting signed ACK bytes and SHA-256. Trigger 0104 prevents replacing that authenticated receipt evidence.
5. Calls `tx.commit()` only when all steps have succeeded, so a DB statement error leaves no partial logical commit.

### Critical remaining gates

- **Protected panel signer / authenticated transport**: no enabled server route, KMS/HSM signer, deployed pinned trust root or independently reviewed approval flow. Do not connect this helper to an untrusted API.
- **Database integration under fault injection**: PostgreSQL unique/replay/ACK/epoch CAS tests, duplicate request and parallel transactions, SQL error between each statement and process crash after DB commit. The current compile/unit tests do NOT establish all these invariants in a live database.
- **Split-brain and restart handling**: the helper only processes a freshly issued, still-valid ACK. After DB commit, duplicate requests must be answered from an independently validated **previously committed ledger row** without trying to apply the epoch again. It does not yet provide that replay-safe recovery protocol.
- **Signed server commit receipt**: no signed receipt binding permit SHA-256, ACK SHA-256, nodeId, target epoch and nonce has been designed and durably stored. Node must retain pending ACK until it verifies such a receipt.
- **Durable Node keys and anti-rollback**: the Node journal and applied-vault tests do not prevent rollback when an attacker restores the entire disk/floor and master key; out-of-band KMS or remote monotonic proof required.
- **Independent security review and disposable canary**: required before production rollout. No `XMESH1` or `strict-pq` changes, and Xray/user traffic is unaffected.

## Integrity statement

The helper returns `StagingACKCommit` only after DB transaction commit. That struct is **not a cryptographic receipt** and must never be used by Node as authorization to retire previous keys or delete its durable ACK journal.
