# XSP-v2 P0-E2b PostgreSQL snapshot rollback / cross-domain witness

Status: **P0-E2b implementation/proof candidate — one-sided PostgreSQL rollback only. P0-E remains CURRENT.**

This gate complements P0-E2a. P0-E2a restored the complete Agent filesystem while Nexus remained current. P0-E2b reverses the failure domain: the Agent journal remains current while PostgreSQL is restored to its exact pre-ACK state.

## Real rollback boundary

The disposable E2E uses the real C2-D strict-PQ process topology and performs an actual PostgreSQL snapshot/restore:

1. build the real Nexus signer, C2-C, protected origin and hybrid-mTLS ingress plus the pinned Go 1.27 Node client before creating the short-lived ACK fixture;
2. prepare an issued, uncommitted rotation and create the least-privilege signer/C2-C database roles;
3. take a real custom-format `pg_dump` of the `xmesh` database while the durable tuple is exactly `(from_epoch, issued, outbox=0, replay=0)`;
4. execute the normal strict-PQ ACK path and require `(to_epoch, ack_verified, outbox=1, replay=1)` while the Agent persists the first verified dual-signed commit receipt;
5. stop database clients, drop/recreate `xmesh`, and restore the saved dump with `pg_restore`;
6. require PostgreSQL to be back at the exact pre-ACK tuple while the Agent journal volume is deliberately untouched;
7. prove the recreated database has reintroduced database-level effective privilege drift for the security roles, then re-apply the reviewed idempotent signer/C2-C least-privilege provisioning and require that hardening not mutate the XSP-v2 durable tuple;
8. only after role hardening, restart the security sidecars and replay the exact still-fresh signed ACK through the real hybrid-mTLS ingress/C2-C/signer path;
9. require one bounded server-side re-commit, then prove the current Agent never replaces its first authoritative receipt bytes.

No SQL `UPDATE` or trigger bypass is used to simulate the rollback. The rollback is a real database dump/restore boundary.

## Restore-time database privilege invariant

The first real restore attempt exposed an important operational invariant rather than a cryptographic failure: after `DROP DATABASE` / `CREATE DATABASE` / `pg_restore`, the isolated signer correctly refused to start with `signer database role has excessive effective object privileges`.

A per-database `pg_dump` restores database contents, object ACLs and security rows, but recreating the database object itself reintroduces PostgreSQL's default database-level privileges. In particular, effective `TEMP`/database privilege can again flow through `PUBLIC`. Those database-object ACLs are not made safe merely because table ACLs in the dump were restored.

Therefore P0-E2b treats restore-time privilege re-hardening as part of the recovery contract, not as an optional deployment detail:

- re-run `20-create-xsp-v2-signer-role.sql` and `21-create-xsp-v2-c2c-role.sql` after the database is recreated/restored;
- require the signer role to have no effective database `CREATE`/`TEMP` or public-schema `CREATE` privilege;
- require the C2-C role to have no effective database `CREATE`/`TEMP` or public-schema `CREATE` privilege beyond its reviewed table/column grants;
- require the XSP-v2 `(epoch, permit state, outbox count, replay count)` tuple to remain unchanged by re-hardening;
- retain the signer's runtime least-privilege self-check unchanged. A restore that omits re-hardening must fail closed rather than starting the signer with excessive authority.

This is why a green data restore alone is insufficient evidence for a secure backup/restore procedure.

## Current-Agent independent witness

The Agent's persisted commit-receipt journal is outside the restored PostgreSQL failure domain. `PersistVerifiedCommitReceiptForJournal` first cryptographically verifies the returned Ed25519 **AND** ML-DSA-65 receipt against the exact permit/ACK/candidate binding, then enforces immutable receipt bytes.

After PostgreSQL rollback there are only two acceptable Agent outcomes:

- the restored control plane reproduces the exact same signed receipt bytes and the retry is idempotently accepted; or
- it returns a different but otherwise valid receipt, in which case the current Agent rejects replacement and retains the first authoritative receipt unchanged.

The E2E additionally reloads the original journal after the retry and requires the original receipt/request/epoch/ACK-digest correlation to remain intact.

## Security meaning and limits

P0-E2b proves that **one-sided PostgreSQL rollback cannot silently rewrite the authoritative state already witnessed by a current Agent**, provided the restore procedure re-establishes the reviewed least-privilege database boundary before security sidecars are restarted. It does not claim the rolled-back server can independently know that its database moved backward before the current Agent presents contradictory evidence.

A coordinated rollback of both PostgreSQL and the Agent journal to mutually consistent old snapshots remains outside this gate. That class requires an independent third trust domain, such as an owner-held/off-host monotonic recovery checkpoint, and belongs to the backup/restore and owner-authorized recovery gates.

This gate also does not prove physical power removal/controller-cache behavior, backup completeness, key retirement, canary safety or production rollout.

`strict-pq` remains **OFF**. Production XSP-v2 rollout remains **NOT AUTHORIZED**.
