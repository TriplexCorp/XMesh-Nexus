# Xray admission for Quota V2

An authenticated Node, a valid signed policy, a reserved byte balance and a
verified WAL prefix are separate facts. Traffic admission requires all
applicable proofs for the same runtime and meter. The WAL birth-index receipt
remains nonauthorizing regardless of how much of the index Nexus has stored.

## Implemented staging checkpoint

With both staging gates enabled, the transaction that creates a Node through
the authenticated panel API writes its genesis eligibility. There is no
migration backfill or eligibility assignment during re-enrollment. The first
committed strict XSP/2 activation binds that eligibility to the exact product
receipt. Subsequent activations cannot change it. An ordinary desired-policy
request that reaches issuance permanently closes the preparation path.

The request is `prepare_genesis` on the existing strict XSP/2 WAL operation.
It supplies a Node ID, a fresh 256-bit challenge and a 256-bit candidate
runtime ID. A candidate is a proposed identity and conveys no proof that an
Xray process exists. Nexus requires the authenticated gateway's activation
digest to match both the current activation and the first durable binding.
Preparation locks the Node, activation and genesis records and checks for
issued policy, WAL, reservation and user traffic history. Competing requests
can commit only one candidate and challenge. Nexus persists the signature in
that same synchronous transaction and only returns it after commit. The
exact request can recover the identical signed preparation for 120 seconds,
provided the Node remains eligible. An unknown commit outcome never creates
another preparation.

The installed WAL operator command requires an independently pinned Nexus
policy key. It verifies the receipt's domain, signature, lifetime, matching
challenge, candidate, Node and activation, and checks the local activation
again before returning. The only supported authority fields are
`authorizedBytes=0`, `canStart=false` and `canResume=false`. No Xray service
consumes this receipt as an admission decision.

## Staged per-user permits and byte accounting

After quarantine, the installed Agent processes the original signed user
list in bounded batches with a persisted cursor. Each user has their own
reservation, signed permit and WAL accounting. While the original Genesis
proof is current, the same Xray can install a first permit for a registered
peer even if a different user has already sent traffic. Xray checks its live
runtime, the peer WAL inventory and the new user's zero-spend state. Nexus
checks the user against the signed scope and the PostgreSQL outbox and WAL
head. A changed process or earlier WAL for that user blocks first admission.
The immutable profile still defines membership for this path.

An issued reservation holds quota. A WAL entry records a byte intent before
Xray delivers that write. Nexus settles verified WAL against the same
reservation, across both directions and the signed inbound classes. A crash
between fsync and delivery can leave a conservative charge above the bytes
observed by the receiver. Signed receipts and expired permits do not release
held capacity. XSP/2 authenticates the Node and Ed25519 binds what was signed.
Neither establishes truthful metering on a host with compromised root.

The WAL transport compresses a large checkpoint for the wire. The signed
digest, append-only prefix, and PostgreSQL record still cover the exact
uncompressed bytes. A malformed or untransferable checkpoint leaves the
previous committed checkpoint intact.

The Agent retains the verified first-cap envelope by user and measured
runtime before the Unix installation call. That copy can identify historical
WAL even when the installation acknowledgment was lost. The separate
installation marker still requires a response from Xray. Nexus binds the
full filename of each anchored WAL stream to its original reservation on
the first accepted charge. Later batches cannot move that stream to a new
reservation or epoch.

## Quota periods

The existing Node counters use UTC. Days start at midnight, weeks at Monday
00:00, and months at 00:00 on the first calendar day. The existing CDN panel
setting supports lifetime and UTC daily, weekly, and monthly counting. For individual Node
quotas, `XMESH_QUOTA_V2_NODE_CALENDAR_STAGING=1` enables funding within the
original daily, weekly or monthly UTC window on the signed staging path.
PostgreSQL pins the window before issuance and rejects another revision
after its deadline. Signed first permits and renewals cannot outlive it.
The allocator counts legacy usage, unbound V2 reservations and all earlier
reservations with overlapping windows. Changing the rule does not move a
bound reservation. This staging switch defaults to off.

`XMESH_QUOTA_V2_CDN_CALENDAR_STAGING=1` uses the panel's existing
`cdnResetPeriod` daily, weekly, and monthly rules for classified CDN or
mixed reservations. Each pool includes legacy CDN telemetry, unbound
reservations and overlapping CDN commitments across all nodes. Migration
0154 retains positive telemetry increments independently of the resettable
panel counter. Older monthly aggregates do not carry daily attribution,
so each intersecting window conservatively covers their entire retained
amount. Mixed reservations account for
their immutable CDN sub-cap and funded CDN top-ups. MAIN-only reservations
are outside this pool. When a mixed reservation has both a Node window and
a CDN window, its shared signed permit expires at the earlier deadline.
Xray closes idle transports for that permit's user at its monotonic deadline.
The pre-write and post-fsync checks also reject spending at the signed
deadline while retaining any intent that already reached durable storage.

A cap request or verified WAL charge can permanently record that the
earliest bound Node or CDN window ended. That reservation cannot be
confirmed, renewed, or redelivered after the recorded boundary even if
the database clock moves backwards. The closure preserves held capacity
and accepts late WAL for the original reservation. A signed renewal in
Xray retains the original monotonic expiration.

A periodic V2 reservation needs an immutable accounting epoch and an expiry
at or before the next applicable UTC boundary. A later period may open only
after the old spending authority has expired or been fenced. Outstanding
old grants and late WAL remain booked to the original epoch. Policy edits
must preserve the historical ledger and cannot free an unverified balance.
The shared limit remains cumulative. Opening a spending permit in a new
window, continuing an active session across that boundary and replacing the
runtime still require separate lifecycle support.

## Required positive admission contract

| Scenario | Additional proof before opening the data plane |
| --- | --- |
| First runtime | The committed genesis plus an independently measured process identity. An Xray candidate may be started with its user ingress closed to obtain that identity. No listener or router path may pass user traffic during preparation. |
| Same runtime | The same process and meter identity, a continuous local WAL, and a current policy and reservation. A renewal cannot replace the meter or lower its recorded spend. |
| Planned replacement | The old runtime's writers are fenced and its durable meter state is sealed before the next runtime receives authority. The verified absolute spend becomes the new baseline. |
| Crash or uncertain stop | Recover the complete history and prove that the old runtime no longer has a usable data path. Uncertain precharged bytes stay charged or held. An unproved terminal amount cannot return capacity. |
| Lost, truncated or replaced WAL | No admission. The off-node birth index lacks the complete byte history and cannot reconstruct the baseline. |

A future admission must bind the first activation or authorized successor,
Node and measured runtime, policy digest and revision, user and scope,
account epoch, meter epoch, reservation ID and revision, absolute verified
spend and authorized ceiling. It also needs a short validity window and a
commit identity. Nexus must serialize issuance and revocation against the
reservation and the previous runtime. Opt-in staging nodes must keep the
ordinary reconciler, Docker restart policy and independent control worker
from opening user ingress without this admission.

The metered write path must enforce the allocated ceiling before every
deliverable write and fsync the charge before writing. A shared user ceiling
covers both directions and all aliases, and local node and CDN ceilings
apply independently. Reservation expiry, duplicate messages, and timeouts
never restore a consumed byte. A process crash between durable charge and
delivery may conservatively overcharge a write. Reopening a stream and
renewing a policy cannot reset that charge. Neither rollover preparation
nor shadow carryforward satisfies these requirements.

## Immutable calendar successor preparation (draft, **zero authority**)

Successor spending caps retain their own authenticated WAL birth history.
Migration 0162 keys that history by Node and measured runtime. Each fresh
head signature binds both the runtime and the request challenge. The
original Genesis registry remains available for its existing reservations.
Before funding another successor, Nexus compares the charged stream names
with the predecessor's authenticated birth index. An omitted stream blocks
funding even when the submitted digest matches the other charge receipts.

When a signed first-genesis reservation crosses a proven calendar boundary,
the installed Agent may request `calendarSuccessor.predecessorId` on the
**existing enrolled XSP/2 cap delivery endpoint**. The challenge is the
SHA-256 of `XMESH_QUOTA_V2_CALENDAR_SUCCESSOR_REQUEST_V1\0` plus the
canonical predecessor UUID. The Nexus handler requires the current enrolled
Node keyset, an active product activation, unchanged PolicySigner, the
original signed first-cap identity, a recorded immutable calendar closure,
and an expired predecessor cap.

Migration `0157_quota_v2_calendar_successor_zero_authority.sql` records one
canonical Ed25519 response per predecessor in
`quota_v2_calendar_successor_preparations`. The response is durable before
delivery and exact byte-for-byte replies are idempotent while its time window
remains valid. It identifies **unfunded** successor meter/reservation UUIDs
and always carries `authorizedBytes=0`, `canSpend=false`,
`canStart=false`, `canResume=false`, `finalMeterVerified=false`,
`refundableBytes=0`.

An expired **zero-authority preparation** may still be replayed
byte-for-byte as historical identity after a lost XSP/2 response. Expiry
does not become a fresh installation permission: any future positive
spending cap needs its own unexpired signed issuance and independent
Xray/WAL/runtime proof. Migration `0159` also rejects preparation unless
the old calendar closure was observed and the candidate belongs to the
same predecessor user, Node and account epoch with a different meter
identity. The current V1 contract deliberately refuses cross-account
epoch transitions; those require an explicit new-account conservation proof.

**This is not a new quota lease.** No row is created in
`quota_v2_reservations`, no signed positive Xray cap is issued, and
Agent cannot resume ingress using this receipt. Old WAL filename ownership
remains immutable. Reusing the same Xray WAL stream for a new reservation
would reattribute late bytes; a new independently verified meter identity
and a funded PostgreSQL lease are prerequisites for any future positive
transition. The staging nonce/response must never be treated as final
Xray meter attestation. GitHub Actions hosted E2E remains required.
