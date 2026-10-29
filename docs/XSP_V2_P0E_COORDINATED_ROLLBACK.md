# XSP-v2 P0-E3a coordinated rollback proof

Status: **bounded staging/recovery proof only. `strict-pq` remains OFF. Production rollout remains NOT AUTHORIZED.**

## Threat boundary

P0-E2a detects a rolled-back Agent while Nexus remains current. P0-E2b detects a rolled-back PostgreSQL state while the Agent receipt journal remains current. Those one-sided witnesses are insufficient if both local failure domains are restored together to an older, mutually consistent snapshot.

P0-E3a adds a third trust domain: an owner-held/off-host monotonic checkpoint that is deliberately outside the Agent state root and the Nexus/PostgreSQL snapshot domain.

The exact XMesh-Node checkpoint pinned by this proof is:

`41fdf669d9ff9c6f0b9d2518fd0404c65d2f3826`

It includes the owner/off-host checkpoint primitive, reverified receipt-journal evidence, exact active Ed25519/ML-DSA-65 key-ID binding and the read-only durable Agent preflight.

## What the disposable E2E proves

`.github/workflows/xsp-p0e3a-coordinated-rollback.yml` runs the following bounded sequence:

1. A real Go 1.27 Agent state root creates its encrypted `node_request` epoch-1 identity and prepares a fresh epoch-2 candidate. Only the public key material leaves the Agent boundary; private keys remain in the encrypted Agent vault.
2. The Nexus fixture consumes those exact Agent-generated public keys, creates the PostgreSQL epoch-1 / prepared-epoch-2 state and signs the short-lived permit with the existing dual-signature cutover primitives.
3. The Agent verifies and journals that permit. The test then snapshots the entire real Agent security-state root while PostgreSQL is still at `(epoch=1, permit=issued, outbox=0, replay=0)`.
4. PostgreSQL is captured with a real `pg_dump -Fc`; no SQL row rewriting is used as the rollback mechanism.
5. The Agent explicitly activates the prepared epoch-2 vault, signs the exact canonical ACK from the protected in-memory key material, persists the ACK only after applied-vault attestation, and sends the exact journaled ACK through the existing strict hybrid-PQ mTLS ingress -> protected origin -> C2-C -> PostgreSQL -> isolated signer path.
6. The Agent persists and re-verifies the exact dual-signed Nexus receipt. Current state must be `(epoch=2, ack_verified, outbox=1, replay=1)`.
7. A generation-2 owner/off-host checkpoint is created and verified. It binds the exact Node ID, authenticated server authority, committed epoch, active Ed25519/ML-DSA-65 key IDs, request ID, authoritative receipt digest and canonical Nexus recovery-state digest. The checkpoint and independent generation floor remain outside both rollback domains.
8. Both local domains are rolled back: PostgreSQL is dropped/recreated/restored from the real pre-ACK dump, and the Agent state volume is replaced by the real pre-ACK Agent snapshot.
9. PostgreSQL recreation is re-hardened with the existing signer/C2-C least-privilege provisioning before any security sidecar could restart. The hardening is required to leave the restored XSP-v2 security tuple unchanged.
10. With networking explicitly disabled, the restored Agent is compared with the still-current generation-2 off-host checkpoint. `VerifyDurableAgentPreflight` must reject the older restored epoch/key identity before receipt reload, recovery exchange or any network operation.
11. The negative preflight must not mutate the restored Agent state, the restored PostgreSQL security tuple or the independent off-host checkpoint files.

This proves the specific rollback blind spot that E2a/E2b intentionally left open: two local witnesses may agree on an old state, while a third non-rolled-back authority still detects that they are stale.

## Security properties preserved

The E3a path does not add a second epoch or replay state machine. The Agent identity is read through the existing durable state/keyring implementation, and the authoritative receipt evidence is available only through the existing full permit -> ACK -> dual-signed receipt reverification path.

The off-host checkpoint requires both Ed25519 and ML-DSA-65 owner-recovery signatures. Its monotonic generation floor is supplied by the independent trust domain; storing that floor inside the Agent root or PostgreSQL would defeat the anti-rollback purpose.

Recovery validation is fail closed. There is no automatic epoch/replay reset, key regeneration, enrollment replacement, receipt rewrite, legacy/XMESH1 fallback, weaker transport path or automatic recovery action.

The TCP connect address and authenticated Nexus authority remain separate. The real network commit uses the existing strict TLS 1.3 `X25519MLKEM768` mutual-PQ transport with exact SNI/certificate/HTTP authority binding, no proxy and no redirects.

## Explicit limitations

This gate proves a **coordinated prepared/pre-ACK snapshot rollback** against a newer independent checkpoint. It does not claim complete disaster recovery.

In particular, **fully committed older backup-set recovery remains P0-E3b**. That later gate must define the complete backup inventory and prove restore/recovery of an older committed Agent + PostgreSQL set against the independent checkpoint, including the operator-authorized path forward rather than only rejection.

P0-E3a also does not prove physical power removal/controller-cache/storage-firmware durability, HSM/KMS custody, owner emergency rotation or old-key retirement, fuzz/KAT completion, independent security review, production observability or a production canary.

The disposable workflow keeps the off-host witness in a separate test directory outside both restored domains. That models an independent logical recovery domain; it is not a claim about a production off-site service, HSM, immutable storage product or geographic fault domain.

`strict-pq` remains **OFF**. Production XSP-v2 topology activation remains **NOT AUTHORIZED**.
