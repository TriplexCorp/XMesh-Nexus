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
