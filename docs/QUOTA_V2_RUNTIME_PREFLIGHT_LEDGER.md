# Quota V2 runtime preflight: database consistency is not traffic authority

PR #552 is a follow-up to Nexus #551 and Node #168/#169. The existing
PostgreSQL `quota_v2_reserve()` and `quota_v2_ack()` are the only
authorities for allocating and charging shared user bytes. **This change
does not add a second quota allocator.**

A new database-only function records one immutable, **zero-authority**
candidate against a *confirmed* and *unexpired* existing Node reservation.
The function takes the exact same account-first/lease-second row locks as
the allocator so a concurrent ACK, revoke, grant revision or plan change
cannot produce a candidate against a partly committed account state.

The function additionally checks:

- the account is open and limited, the existing lease is confirmed and has
  a positive held ceiling, and no revocation or conservative burn exists;
- all previously closed epochs for the user have no outstanding signed
  reservations;
- the row created for this Node's **first** staging Xray activation has the
  expected activation receipt and prepared runtime ID, and the one-shot
  preparation is still within the original 120-second window;
- aggregate `max(settled_bytes, observed_floor_bytes) + SUM(all outstanding
  Node ceilings, net of signed acknowledgements and conservative burn
  floors)` never exceeds the current user limit; and
- the caller's reported WAL floor is within the exact acknowledged /
  reserved byte range. This is only an input consistency condition, NOT an
  independent verification of the local WAL.

A challenge retry returns the same immutable record if and only if *all*
contents match the current lease, account and candidate claims. Same
challenge with a changed PID, runtime, policy hash, rev, WAL floor or
capacity snapshot is refused rather than silently returning an outdated
snapshot. Rows cannot be UPDATEd, DELETEd or TRUNCATEd. The function and
table are not granted to PUBLIC.

## Real PostgreSQL integration tests

The dedicated GitHub Actions job boots PostgreSQL 17, applies existing
migrations **0125, 0126, 0127, 0128, 0137**, then the new **0138**, and
executes the real quota V2 SQL allocator.

Scenarios include:

- 1000 shared bytes, Node A requests 700, Node B requests 500: 700+300
  is held, not 1200; snapshots authorize 0 bytes.
- many concurrent same-challenge requests: exactly one immutable record,
  all replies identical, no change to account settled or held bytes.
- conflicting challenge reuse, foreign or stale reservation revisions,
  unconfirmed/expired/revoked/burned leases, old-epoch outstanding debt,
  incompatible account limit/observed floor and genesis identity mismatch.
- racing the existing allocator's signed-byte ACK/revision increment
  against the preflight. The old revision can be recorded only *before*
  the concurrent ACK transaction and can never be used to install a
  positive new grant.
- expiry of a one-shot genesis preparation without changing or deleting
  the prior protected genesis row, and SQL privilege/immutability checks.

## Explicit boundaries before production release

**This table is not a positive authorization.** The recorded container,
PID, signed-policy hash and reported WAL absolute floor have NOT been
independently authenticated in PostgreSQL. The schema itself fixes:

- `authorized_bytes = 0`;
- `can_start = false`, `can_resume = false`;
- `final_meter_verified = false`, `refundable_bytes = 0`.

No user-facing route or live Nexus API invokes the function yet. The
candidate lacks signed inbound MAIN/CDN membership, real cryptographic
XSP/2 attestation of the Xray process, a persistent complete old-byte
WAL receipt, and demonstrated old-writer finality. The matching Node
#169 contract is likewise an offline **nonauthorizing** verifier.

Before turning on real V2 traffic:

1. Independently attest a live installed Node, Xray PID/image, signed
   policy and complete WAL head with real XSP/2 + Ed25519.
2. Bind the existing PostgreSQL reservation and signed policy scope to
   a short-lived, single-use positive admission transaction **after** all
   old process writes are proven finished (or conservatively burned).
3. Install the admitted byte cap into the actual measured Xray **before**
   enabling listeners; demonstrate stop/renewal after crash and retries.
4. Prove two installed Nodes and two Xray share global 1000, per-Node
   700/500 and CDN 150 test budgets under mixed live traffic.
5. Coordinate Agent release pins and CI before considering main/rollout.

No working VPS is changed and `XMESH_QUOTA_V2_ENABLED=0` remains in place.
