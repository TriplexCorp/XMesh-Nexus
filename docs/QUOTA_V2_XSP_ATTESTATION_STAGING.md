# Quota V2 / XSP/2 — signed Node preflight staging

Status: **dormant, nonauthorizing, experimental**. Stacked Nexus #553 on
#552 and Node #170. The shipping API has **no**
`/api/v2/node/quota-v2/cap/attest` handler and does not compile the
experimental verifier without `xsp-v2-experimental`.

## Purpose

The previous end-to-end disposable test proved a real Nexus
`PolicySigner` can commit a first-genesis signed spend-only cap in the
PostgreSQL 0139 outbox, and two separate instrumented Xray Go processes
cannot spend more than a 1000-byte shared reservation allocated 700+300.
Restarting PostgreSQL and both Xray test processes preserved exactly
the original signed outbox and metered WAL. That run did **not** prove
independently authenticated XSP/2 Node assertions.

This follow-up isolates the next missing dependency: a Node's
owner-enrolled Ed25519 **AND** ML-DSA-65 signatures must cover the
**exact** original first-genesis preflight claims, not just a
self-reported runtime hash.

## Wire contract

Message type: `node.quota-v2.cap.attest`.

Method/path: `POST /api/v2/node/quota-v2/cap/attest`.

Uses the **existing** canonical XSP/2 signing encoder,
`XSP2-SIGNED-MESSAGE\0` domain, Ed25519 + ML-DSA-65, sequence of
signed key IDs/epochs, nonce, request ID, payload digest and expiry.
No new independent JSON signature algorithm is introduced.

The strict, duplicate-key-rejecting payload includes Node/user identity,
account/meter epoch, exact reservation ID/revision, nonce challenge, first
activation receipt, process/runtime/container/PID, policy digest, first
WAL-head digest, zero observed WAL floor, and the explicit prohibitions
`canStart=false`, `canResume=false`,
`finalMeterVerified=false`, `refundableBytes=0`.

## DB acceptance

The optional `record_staging` function requires a
`trusted_pq_tls_node_id` obtained **independently** from an
authenticated, verified X25519MLKEM768 TLS ingress. Never populate this
argument from client JSON, a user-provided header, an HTTP cookie or
the signed request itself. No such trusted live ingress currently calls
the function.

Inside one SQL transaction it:

1. Locks the XSP suite state to serialize enrollment/key rotation and
   requires a matching active `node_request` owner-enrolled epoch.
2. Fetches **both unrevoked public keys** from
   `node_xsp_public_keysets`, checks exact Ed25519 and ML-DSA-65 wire
   signatures with AND semantics, and verifies active product activation.
3. Re-reads original immutable 0138 preflight (user/Node/lease,
   runtime/container/PID, policy SHA, first activation, zero WAL) with a
   database expiry check. A Node-signed lie that differs from this
   snapshot is refused. **The snapshot values themselves are not
   independent kernel evidence.**
4. Consumes a nonce in the existing `node_xsp_replay_nonces` table, then
   commits the original signed bytes to the immutable 0140 journal with
   transaction-local synchronous commit. Failed claims cannot consume a
   nonce because they roll back with the transaction.

A 0140 row always has `authorized_bytes=0`,
`can_start=false`, `can_resume=false`,
`final_meter_verified=false`, `refundable_bytes=0`.
No public database role can create or mutate it. It cannot issue new
capacity, settle/return bytes, or re-enable Xray traffic.

## Test matrix

- Exact canonical XSP/2 domain and strict typed JSON; wrong
  Node, clock, PID, lease revision, WAL floor, policy hash and unknown
  field rejected.
- Real OpenSSL 3.5 ML-DSA-65 together with Ed25519 positive signing;
  corrupt either signature, substitute either key, change payload or
  endpoint: reject.
- PostgreSQL real migrations, registered Node key pair, active product
  activation and genuine `quota_v2_reserve()`; signed assertion matching
  the original 0138 preflight is committed once.
- Signed assertion for another transport Node, mismatched PID/policy,
  reused nonce, second nonce for same challenge, revoked key pair:
  reject. The 0140 row never grants capacity.
- PostgreSQL 17 immutable table, duplicate nonce/key-epoch, foreign
  challenge, denied UPDATE/DELETE/TRUNCATE and denied PUBLIC writes.

## Critical remaining production blockers

This stage **does not verify** the actual TLS hop, independently
measure the Linux Xray process through an installed root-private Agent,
derive signed MAIN/CDN policy membership from the real current
deployment, witness the complete fsynced WAL off-host, prove old
writers have stopped or conservatively burned old capacity, or
install an admitted cap before the first VLESS listener opens.

The existing positive issuer is still an **opt-in, CI-only CLI** with
synthetic policy/runtime test context and an ephemeral signing key.
Do **not** connect this dormant journal directly to positive issuance;
only after the preceding independent proofs can the final issuer
atomically authorize a real cap and bind the installed Xray.

No work touches installed VPS, `main` or
`XMESH_QUOTA_V2_ENABLED=0`.
