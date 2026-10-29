# XSP-v2 P0-E3b coordinated backup/restore recovery

## Status and scope

P0-E3b is a **staging-only, disposable recovery proof**. It does not enable `strict-pq`, install a production recovery daemon, add a public recovery API, reset any epoch/replay state, regenerate enrolled keys, retire old keys, or authorize production rollout.

The purpose of this gate is narrower and concrete: prove that the security-relevant local recovery domains can be backed up and restored as a coordinated set, while the already-proven P0-E3a owner/off-host checkpoint remains outside that rollback domain and can reject a mutually consistent older restore.

The proof covers exactly these local recovery components:

1. a real custom-format PostgreSQL `pg_dump` of the XSP-v2 database state;
2. the **complete real-Agent private state root**, including encrypted `node_request` keyring material, monotonic epoch floor, retained `.previous`/`.next` identities and cutover permit/ACK/commit-receipt journals;
3. the protected `panel_response` Ed25519 + ML-DSA-65 private signer identity;
4. the persistent Node mTLS certificate/private-key identity.

The owner/off-host P0-E3a checkpoint and the independently retained `panel_response` public pin are **not backup components**. They stay in the third trust domain. An owner/off-host backup manifest also stays outside the archive set and binds the exact SHA-256 and size of each recovery component plus the expected Node epoch, signer identity, mTLS SPKI and, for a committed current set, authoritative receipt digest.

## What the disposable proof does

The dedicated CI job checks out the exact current XMesh-Node security checkpoint and builds a small helper against the real `agent/xspv2/state`, `keyring` and `cutover` packages. The helper does not create a second security state machine: it reuses the production-style encrypted Agent keyring and the existing permit, applied-ACK and commit-receipt journal primitives.

The test then:

1. generates a real protected Ed25519 + ML-DSA-65 `panel_response` signer with OpenSSL 3.5 and stores only its public pin in the independent off-host domain;
2. generates a persistent mTLS private key/certificate identity;
3. creates a real Agent epoch-1 encrypted identity and seeds a disposable PostgreSQL 18 database with the matching public identity using the real XSP-v2 schema/immutability migrations;
4. provisions the reviewed signer/C2-C least-privilege roles and verifies effective database/schema `CREATE`/`TEMP` privileges remain removed;
5. takes an **old coordinated backup set** using real `pg_dump -Fc` plus archives of the complete Agent root, signer private identity and mTLS identity, with its manifest stored off-host;
6. prepares a real Agent epoch-2 candidate, creates a dual-signed Nexus permit, activates the encrypted Agent candidate, signs the ACK with the real new Agent Ed25519 + ML-DSA-65 private keys and persists the existing permit/ACK journals;
7. creates and dual-signs the exact commit receipt with the protected panel signer, persists and re-verifies the existing Agent commit-receipt journal, and commits the matching PostgreSQL epoch/replay/ledger/outbox evidence;
8. creates the current P0-E3a off-host checkpoint from that exact authoritative signed receipt;
9. takes a **current coordinated backup set** with a separate off-host manifest;
10. destroys/restores the current database with real `DROP DATABASE` + `CREATE DATABASE` + `pg_restore --exit-on-error`, restores all three filesystem identity domains, re-applies least privilege, re-verifies the complete Agent permit/ACK/receipt chain and requires Agent/PostgreSQL/manifest/off-host evidence to agree before the E3a verifier accepts the restore;
11. restores the complete older Agent + PostgreSQL + signer + mTLS set. Its old local state is internally consistent and its historical off-host backup manifest is valid, but the unchanged newer E3a checkpoint must reject it because the restored Agent/PostgreSQL epoch is below the independent recovery floor;
12. hashes the restored Agent tree and reads the PostgreSQL security tuple before and after that rejection to prove the failed verifier does not mutate either local security domain;
13. rejects mixed-generation, missing and tampered recovery components through the independent off-host manifest and identity checks;
14. restores the current set again and requires recovery to succeed, proving a failed historical restore attempt does not poison the valid recovery path.

No test publishes a container port, talks to a production endpoint, enables a proxy/redirect path, or weakens any signature/TLS requirement.

## Recovery invariants

A restore is not considered valid merely because all local files came from the same timestamp. Before a recovered state can satisfy this gate it must pass all of the following:

- every required backup component matches the independent owner/off-host manifest exactly;
- the restored panel private keys rederive the exact independently retained Ed25519 and ML-DSA-65 public key IDs;
- the restored mTLS private key matches its certificate and the off-host manifest SPKI digest;
- the real Agent encrypted identity opens without repair/regeneration and matches the restored PostgreSQL active public key IDs and epoch;
- the restored Agent permit, ACK and commit receipt reverify with both algorithms through the existing Node primitives;
- Agent journal candidate/permit/ACK/receipt digests and request ID match PostgreSQL ledger/replay/outbox evidence;
- restore-time signer/C2-C least-privilege re-hardening does not change the restored XSP-v2 security tuple;
- the reduced, validated local recovery state satisfies the independent current P0-E3a checkpoint.

If any component is missing, has a different digest, belongs to another Node/epoch/identity, has a bad signature, or disagrees with another recovery domain, recovery fails closed. There is no automatic epoch rewind, replay-table reset, key regeneration, signer replacement, mTLS replacement, XMESH1 fallback or weaker suite fallback.

## What this gate does **not** prove

P0-E3b is not a claim about physical storage behavior during sudden power removal, controller write caches, storage firmware, hypervisor snapshot semantics or operator backup media durability. Those remain outside the earlier bounded process/fsync crash proof.

It also does not yet provide:

- a production scheduler, remote backup service, HSM/KMS escrow or cloud-object-storage implementation;
- encryption-at-rest/key-escrow policy for exported backup media;
- an owner-approved signer or Node key **rotation/recovery** workflow, or old-key retirement policy;
- a proof that a compromised/rolled-back **third trust domain** can detect its own rollback. P0-E3a/P0-E3b deliberately assume the owner presents the newest independent checkpoint and matching off-host manifest/pin;
- production activation of XSP-v2 strict PQ mode.

Those are separate gates. In particular, P0-E3b must not be used as justification to enable `strict-pq` or change production topology.

## CI boundary

`.github/workflows/xsp-p0e3b-coordinated-backup-restore.yml` pins XMesh-Node to:

`3fffa9fd74195114a7c4e573a8a11e075c84f403`

and runs:

- source-contract checks for the exact recovery components and no production activation;
- baseline tests for the pinned real Agent module;
- the disposable coordinated backup/restore proof in `scripts/test-xsp-v2-p0e3b-coordinated-backup-restore.py`.

A green workflow proves only the bounded recovery behavior described above. It is not a production deployment authorization.
