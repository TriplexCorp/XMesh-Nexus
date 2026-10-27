# XSP-v2 main-branch checkpoint and remaining cutover gates

**Checkpoint: 27 October 2026.** This file records repository state at this date, not proof that XSP-v2 is enabled on production.

## Already merged into `main`

| Track | Nexus | Node | Result |
| --- | --- | --- | --- |
| Live XHTTP/H3 Poland-2 operational documentation | #33 | #12 | Documentation merged; live Xray not altered |
| Dual-sign cutover/ACK canonical contract and vectors | #34 | #13 | Test-only shared Rust/Go hashes |
| Real dual-sign crypto primitives, staging only | #35 | #14 | Ed25519 **AND** ML-DSA-65, no live API |
| Candidate public-key fingerprint binding | #40 | #16 | Exact old/new public key IDs |
| Approved pending public keys from locked PostgreSQL snapshot | #42 | — | Staging transaction guard |
| Permit/ACK persistent schema + monotonic state triggers | #38, #39 | — | Additive migrations, no automatic cutover |
| Validated signed permit persistence | #43 | — | Staging-only writer, no signer provisioning |
| Node ACK journal and fsync | — | #18 | Offline Go experimental module |
| New-key active vault attestation before ACK | — | #19 | Offline Go experimental module |

The original reference-ledger design from Nexus #37 preceded migrations 0103/0104 and is **not** a replacement migration. Its important unsolved requirements are retained in the failure checklist below. Avoid merging its old duplicate SQL as if it were an upgrade to the actual 0103/0104 schema.

**Open at checkpoint:** Nexus #44 (read-only ACK verification against the original locked permit, awaiting final CI/security review), Nexus #37 (obsolete design proposal, superseded by the actual staging migrations), and Nexus #20 (separate FinalMask UI work, unrelated to this security work). XMesh-Node has no open PRs at this checkpoint.

## No forgotten safety prerequisites

- [ ] Read-only ACK checker #44 merged only after green **all** relevant CI.
- [ ] Owner/approved-request control, protected `panel_response` signing service with pinned distribution/rotation and auditable key custody. A signed message or `PoP` alone is not authorization.
- [ ] Transactional signing intent/outbox: signer invocation and PostgreSQL commit cannot be made atomic merely by holding a SQL row lock. No permit may be delivered before durable issuance; duplicate retries must return the identical signed bytes.
- [ ] Node can durably and exclusively activate the exact pending pair, with anti-rollback floor outside a wholly restorable filesystem. Software-only `fsync` is not hardware anti-rollback.
- [ ] ACK authentication based on original DB-stored Nexus permit and prepared Node public keys; one-use ACK replay nonce; a **single** compare-and-swap transaction must save immutable ACK and advance server epoch while retaining the old keyset.
- [ ] Nexus persistently signs a commit receipt bound to permit, ACK and final epoch. Loss of receipt must be idempotently recoverable without reactivating or rolling back Node.
- [ ] PostgreSQL least-privilege application roles, protected append-only/replay history, disaster recovery, restored database/vault snapshots, network partitions and repeated/out-of-order requests.
- [ ] Genuine Rust ↔ Go **signed permit and signed ACK** interoperability, not just canonical-input digests; fuzz and negative crypto tests.
- [ ] Disposable-node e2e canary and independent security review, owner-authorized activation; only then consider production rollout.

## CI inventory

`node scripts/check-xsp-v2-main-checkpoint.js` is run by Backend CI and verifies the presence of critical tracked staging code, schemas and vector fixtures, and the feature gate on the experimental modules. It is a **missing-file regression guard**, not a security proof or a way to track GitHub PR merge status. GitHub PR and branch status must still be reviewed before claiming `main` is complete.

Production `XMESH1` and `strict-pq` are unchanged. This checkpoint does not authorize production key switching, Xray edits or deployment to Poland-2.
