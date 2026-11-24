# Quota V2 — real Nexus signer / durable signed first-Xray grant

**Status: disposable CI milestone, not a production feature.** This
document describes Nexus PR #553 stacked on #552 and Node PR #170.

## The exact completed logical chain

1. PostgreSQL 17 uses the existing `quota_v2_reserve` function under the
   shared account lock. One user with 1000 budget can reserve 700 on Node A
   and only 300 of the requested 500 on Node B. Both signed ceilings are
   measured by Xray. CDN is separately limited to 150 per Node.
2. The confirmed, nonrefundable lease is tied to one first-genesis Xray
   preparation and an **immutable zero-authority** runtime preflight
   (migration 0138). Staged records include exact Node, account/meter epoch,
   revision, runtime, container, PID, policy SHA and absolute WAL floor.
3. A dedicated Rust test binary, compiled only with
   `quota-v2-disposable-cap-issuer`, reads **the existing PostgreSQL rows
   again**. It locks the account first, then the lease, checks confirmed
   and unexpired capacity, active Node activation, exact first-genesis
   runtime, and no revocation, burn, old-epoch debt, or changed account
   floor. It refuses all nonzero first-genesis WAL and ACK values.
4. The binary calls the **real Nexus** `node_policy::PolicySigner` source,
   not a Python/OpenSSL signing mock. It validates the positive spending-only
   bound in `quota_v2_cap_signing.rs` and emits domain-separated canonical
   Ed25519. The *key* is newly generated under `RUNNER_TEMP` for CI; it is
   **not** the real production Nexus private policy signing key.
5. Migration 0139 persists the exact signed bytes and signing public key
   in a PostgreSQL outbox under the account + lease lock and forces
   transaction-local `synchronous_commit=on`. It refuses duplicate
   (reservation ID, revision) under a second challenge. Rows are immutable.
   A retry after a lost reply returns **identical byte-for-byte envelope**
   without reissuing allowance or extending its TTL.
6. Two separately launched, pinned, instrumented Xray Go processes verify
   the real Rust-generated signature, independently supplied runtime/
   policy/lease test context, then fsync the signed admission file before
   exposing the spend limit. All MAIN/CDN, uplink/downlink writes are
   checked before each durable WAL byte intent and raw StatsService count.
   They cannot spend more than 700 + 300 combined, nor more than 150 CDN
   each.
7. New Xray test processes read the *same old persisted WAL* after the
   originals exit. They reject their previous process-bound grant, retain
   earlier charge floors and cannot obtain a second first-genesis record.
   PostgreSQL does not refund outstanding bytes.

## Invariants

- Signed proof is **spend-only**, never a general Xray start/stop authority.
  `canStart=false`, `canResume=false`,
  `finalMeterVerified=false`, `refundableBytes=0`.
- No signed record exists unless there is already committed and confirmed
  capacity. Signature creation cannot itself reserve more bytes.
- CDN+MAIN always share the same Node/global user allowance.
- A response lost after database COMMIT cannot lead to a different grant.
- Policy key rotation between issuance and retry cannot silently replace
  old signed proof; old pinned public-key continuity is mandatory.
- Clock expiry, unknown alias, wrong runtime, changed policy, missing
  WAL history or untrusted meter fails closed.

## Strict production boundary still missing

The CI binary is **not** a shipping endpoint and no default production
feature enables it. It uses fixed CI identities and its own test-only
signing key. The independently verified runtime and signed inbound policy
are synthetic test fixtures. A Node claim, a matching SHA string, and a
gateway token by themselves are not a remote kernel attestation.

Before production, an installed Agent must independently inspect the
kernel/Docker identity of the managed Xray process, pin that process against
replacement, verify ALL installed inbound aliases and policy bytes,
authenticate an actual Node attestation through strict XSP/2, and submit
its original precharge WAL and off-host witness. The live Nexus must verify
the enrolled node identity and exact policy revision before using the same
issuer and outbox. It must return a pinned policy key to the Node and use a
root-private, one-shot Xray cap install channel. The first confirmed cap
must be installed **before public VLESS listeners accept connections**.

A full real VLESS integration with TWO installed Agent services and TWO
actual Xray servers, reboot/upgrade/rollback, forced DB downtime, lost
ACK, quota renewal, late telemetry, and irreversible old-runtime debt is
still required. Do not interpret this CI green result as that proof.

`XMESH_QUOTA_V2_ENABLED=0` remains unchanged; no working VPS or
`main` change is authorized by this experiment.
