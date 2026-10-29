# XSP-v2 P0-E3b coordinated backup/restore recovery

Status: **CURRENT / implementation in progress**. This document defines the first E3b layer only. It does not activate strict-PQ, change production routing, authorize disaster-recovery mutation, or authorize production rollout.

## Goal

P0-E3a introduced an independent owner/off-host monotonic witness derived from the authoritative dual-signed commit receipt. P0-E3b must prove that a real disaster-recovery backup set cannot silently omit, mix or roll back security-critical components while still appearing internally consistent.

The complete E3b target remains:

1. capture PostgreSQL, Agent durable state and persistent cryptographic identities as one reviewed backup generation;
2. keep the newest E3a checkpoint and independently provisioned panel public pin outside that backup generation;
3. reject an old coordinated Agent + PostgreSQL + identity restore against the newer off-host witness before network or security-state mutation;
4. accept an exact current restore without epoch/replay reset, key regeneration, enrollment replacement or receipt rewriting;
5. reject missing and mixed-generation components fail closed;
6. restore reviewed least-privilege signer/C2-C ACLs without altering the XSP-v2 security tuple.

## First implementation layer: immutable backup-set inventory

`scripts/xsp-v2-p0e3b-backup-set.py` is an offline verifier. It has no network client, database client, shell execution, remote action, key generation, enrollment or state mutation path.

A backup set must contain exactly these security components:

- `postgres.dump` — PostgreSQL custom-format dump;
- `agent-state.tar` — complete Agent durable XSP-v2 state root needed to interpret the epoch/journal/key state;
- `signer-keys.tar` — panel signer private identity material required to preserve the existing signer identity;
- `panel-pin.json` — public identity metadata that belongs to the backup generation;
- `mtls-identity.tar` — persistent mTLS identity material needed by the protected control path.

The E3a owner/off-host checkpoint is intentionally **not** a member of the backup set. Including it in the same rollback domain would collapse the independent witness boundary.

The manifest schema is `xsp2-coordinated-backup-set-1` and binds:

- exact Node ID;
- exact XSP-v2 key epoch;
- exact authoritative receipt SHA-256;
- exact path, size and SHA-256 for every required component.

Unknown, missing or extra security components are rejected. Component paths are fixed single-file names; symlinks, alternate paths, digest mismatches and size mismatches fail closed.

## Binding to the E3a witness

The inventory verifier may additionally consume the already owner-held E3a checkpoint envelope. The checkpoint itself must still be cryptographically validated by the P0-E3a recovery tool against independently provisioned `panel_response` public keys before operational recovery.

The backup-set comparison enforces:

- backup Node ID must equal checkpoint Node ID;
- backup epoch below the checkpoint floor is rejected as coordinated rollback;
- at the exact checkpoint epoch, the backup authoritative receipt digest must equal the witnessed receipt digest;
- a same-epoch different history is rejected rather than treated as a replacement.

This layer deliberately does not duplicate Ed25519/ML-DSA verification. The original E3a verifier remains the only checkpoint cryptographic verifier, avoiding a second security state machine.

## Dedicated CI boundary

`XSP-v2 P0-E3b Coordinated Backup Set` creates a disposable real PostgreSQL database and custom-format `pg_dump`, packages representative Agent state, signer identity inventory and mTLS identity artifacts, then proves:

- exact current backup inventory validates against the E3a floor;
- an old coordinated generation is rejected;
- a modified/mixed-generation component is rejected by exact digest binding;
- a missing signer identity is rejected;
- a same-epoch divergent authoritative receipt is rejected.

This is **not yet the complete P0-E3b gate**. The next layer must replace the representative filesystem packaging with the real Agent state root and real signer/mTLS identity volumes used by the Nexus↔Node E2E, perform actual restore/extraction plus `pg_restore`, re-harden PostgreSQL ACLs, and prove rejection/acceptance before any network/security mutation.

## Non-goals and guardrails

- no automatic epoch or replay reset;
- no key regeneration or enrollment replacement;
- no receipt rewrite or "latest wins" recovery;
- no caller-selected URL, script or command;
- no XMESH1, Ed25519-only, classical-only or TLS downgrade fallback;
- no production topology change;
- `strict-pq` remains OFF;
- production rollout remains NOT AUTHORIZED.
