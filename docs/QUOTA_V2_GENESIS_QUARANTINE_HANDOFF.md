# Quota V2: immutable, first-ever signed policy in quarantine

**Draft-only experiment, not production activation.** This work continues
Nexus #553 over #552 and Node #170. `XMESH_QUOTA_V2_ENABLED=0` in
production remains unchanged.

## Fixed architectural deadlock

Before this change, ordinary `POST /api/v1/node/desired-config`
called `quota_xray_genesis::close_for_policy()` and saved
`node_desired_revisions`. Both permanently disqualified a fresh Node
from the first-Genesis reservation path. Deleting the marker or allowing
the already-used Node to masquerade as new would refill previously spent
traffic after a restart.

**The legacy path remains unchanged in its intended semantics.**
A separate, opt-in, zero-authority request now stages a signed policy
without executing either destructive transition.

## Exact staging order

Only in a disposable, strict-XSP/2-backed test environment:

1. Enroll and activate a newly created Node. The original creation
   transaction must already have inserted `quota_v2_xray_genesis`.
   No existing `node_desired_revisions`, Node quota reservation, local
   lifetime quota, prior telemetry, or external WAL birth inventory may exist.
   **Before calling the ordinary desired-config**, a newly enrolled Node
   without a pinned Ed25519 policy signer can fetch ONLY its public key
   from `POST /api/v1/node/quota-v2/policy-pin` with
   `{"node_id":N,"operation":"discover_policy_signer"}`. This is a
   read-only, feature-gated, zero-authority reply transported inside the
   existing owner-enrolled XSP/2 product tunnel. It returns the original
   activation binding and public key, NOT traffic authority. The gateway
   now forwards its original signed activation digest on BOTH
   `desired-config` quarantine and the policy-pin request, not only WAL.
   The Node accepts the key only if its original strict-PQ product identity
   and activation agree, writes exactly one root-private pin, and refuses
   later mismatched key replacements.
2. Under verified strict product-gateway identity, call the existing
   `POST /api/v1/node/quota-v2/wal` with
   `{"operation":"prepare_genesis","nodeId":N,"candidateRuntimeId":"<64 lowercase hex>","challenge":"<64 lowercase hex>"}`.
   The signed, zero-authority receipt is tied to the original product
   activation and valid for 120 seconds. Do NOT use a new activation,
   reset the WAL or forge a fresh runtime on an existing Node.
3. A Node aware of the future quarantine protocol can opt into
   `POST /api/v1/node/desired-config` with
   `{"node_id":N,"quotaProtocolVersion":2,"quotaGenesisQuarantine":true,"quotaGenesisRuntimeId":"<same runtime>","quotaGenesisChallenge":"<same challenge>"}`.
   This accepts ONLY the strict-PQ product gateway, not an old Ed25519
   Node request or a user-selected Node ID. The server compiles the normal
   authoritative XRAY STUDIO profile and user mappings, but signs a
   special `xmesh.quota-v2.genesis-quarantine-policy` with every
   `offlineBudgetBytes=0`, every user `onHold=true`, a 120-second
   Genesis lifetime, `authorizedBytes=0`, `canStart=false` and
   `canResume=false`.
4. Migration **0141** checks the original activation and Genesis, absence
   of policy, WAL and traffic history, and every zero-budget field.
   PostgreSQL saves the exact signed policy bytes, SHA256, signer key and
   profile revision in an immutable record using synchronous commit.
   Exact retries are byte-identical. Conflicting retry, new runtime,
   stale policy or expired Genesis fails closed.
   **This does not set `policy_path_used` or
   `node_desired_revisions`.**
5. A verified, independent runtime/policy/WAL process can now use
   migration **0142** to create a **zero-authority** preflight against the
   existing confirmed reservation, but ONLY for a user present in the
   original signed staged policy and with its exact policy SHA.
   Migration 0138 still supplies all original account/lease locks,
   epoch, expiration, overcommit and replay checks.
6. Migration **0143**, alongside the Rust transaction guard, forbids
   ordinary desired-config from subsequently setting
   `policy_path_used=true` on a staged Node. No legacy reconciliation
   may turn the staged configuration into an active offline allowance.
   A future positive protocol must use a separate signed admission
   state; **never reset the historical flag**.

## Immediate Node safety

The existing `xmesh-xray-sync.sh` is NOT a positive-admission client.
In the stacked Node #170 draft it rejects and physically stops managed
Xray on any HTTP 200 desired-config response with
`status=quarantined`, `publicIngressAllowed=false`, or a
`policy.quotaV2Genesis` object. The experimental signed local Unix
socket is a **different component** and remains the only prospective
route for positive, process-bound cap installation. The Node version
policy requires an Agent release bump for this changed deployed guard;
the draft proposes `control-v6.0.26` but nothing has been shipped.

## Intentionally unimplemented boundary

The above is **NOT** an end-to-end positive grant. The live installed
Agent does not request the new quarantine mode, no actual public
XSP/2 positive cap issuer delivers signed reservations to installed
Agent, and no installed systemd Agent invokes the verified Xray local
installer with independent kernel PID/config/WAL proof. The current
positive Rust signer is still a feature-gated disposable CI binary.

Before any release, the installed strict-PQ Agent must:

- independently inspect and pin the actual Xray process, cgroup/container,
  config SHA and all MAIN/CDN aliases, including old writer shutdown;
- authenticate an exact signed XSP/2 attestation bound to the original
  staged signed policy and the immutable off-host WAL witness;
- atomically obtain the **one-time**, account-conserved 0139 positive
  cap through the actual Nexus private PolicySigner and deliver it;
- validate the pinned Nexus key, reserve/revision/epoch, real process
  and local WAL before root-private Unix socket installation;
- keep VLESS public ingress physically closed until verified installation,
  and never refund or replenish bytes on restart, crash or lost response.

**No working VPS, main branch or production feature flag is changed by
this staging work.** GitHub CI validation is required before treating
even the zero-authority flow as qualified.


## New strict-PQ Genesis reservation stage (draft, never a positive grant)

After immutable 0141 signed quarantine policy, a **disposable, freshly
enrolled Node** can opt into a separate exact product-gateway tunnel path:
`POST /api/v1/node/quota-v2/genesis-reservation`. There is NO legacy
authentication fallback. This endpoint is disabled without ALL of
`XMESH_QUOTA_V2_ENABLED=1`, the existing Genesis/quarantine staging
gates, and `XMESH_QUOTA_V2_GENESIS_RESERVATION_STAGING=1`.

- `prepare`: authenticate the originally activated Node, signed 0141
  policy SHA and candidate runtime/challenge; recompile the current XRAY
  STUDIO user roster and MAIN/CDN aliases; request the existing account-
  serialized `quota_v2::issue` zero-ceiling initial lease for ONE signed
  user. Return the resulting lease identity under the original Ed25519
  PolicySigner with `authorizedBytes=0`, `canSpend=false`,
  `canStart=false`, `canResume=false`, and no refunds.
- `confirm`: require the precise `epoch`, `meterEpoch` and
  `reservationId` from the previously issued prepare reply. The
  owner-enrolled product tunnel supplies fresh replay-protected XSP/2
  authentication. The SQL allocator confirms the same reservation; any
  available new held capacity is **NOT** a signed Xray cap. The reply is
  another zero-authority signed identity.
- Both stages reject a replaced/revoked activation, expired original
  120-second Genesis, profile changes, unknown user, duplicate/foreign
  alias, or mismatched immutable original policy. The local Node helper
  preserves separate signed prepare and confirm bytes using root-private
  fsync under the normal reconciler lock.

**Release hold:** This is a tested contract candidate but not yet a
qualified two-installed-Node integration. No production release or normal
Agent flow invokes a positive cap. Still missing: independently measured
live-process attestation on the Nexus side, a complete off-host WAL
witness, real signed positive XSP/2 issuer connected to the immutable
0139 outbox, delivery to the measured Unix-socket Xray, public ingress
qualification and restart/rollback tests. Keep production V2 OFF.


### First-Genesis TLS remote WAL snapshot (zero authority)

The existing strict product WAL tunnel supports the distinct
`public_tls_head` operation. It requires the exact original signed
first-cap roster, Genesis/activation/profile/runtime and the concrete
container/PID from every durable cap-delivery preflight. Under the
serialized roster locks AND the Node-wide WAL-writer advisory lock, it
revalidates the current exact committed birth index and its original Node
Ed25519 witness, matches each entry to the runtime and signed MAIN/CDN
aliases, and refuses charge streams not covered by that index. A new
domain-separated Nexus signature binds a fresh challenge, measurement,
roster, exact sequence/hash/tail, and at most seven seconds of validity.

`empty_remote_history` means only that the SQL snapshot has no committed
first-Genesis index, no later runtime anchor, no durable charge and no
already acknowledged or burned reservation bytes. It is NOT a proof that
the host WAL is empty, that pre-bootstrap history was complete, or that
a cap was installed. An unsigned HTTP 404 cannot substitute for it.
`committed_birth_index` means the remote birth registry exists and was
validated; it does not attest complete transmitted-byte accounting. Both
responses explicitly deny public service, start/resume, spending and
refund authority. The eventual installed supervisor must independently
compare the actual mounted WAL, live signed cap counters, qualification
pins and current remote snapshot; no public listener or production
positive TLS issuer is introduced here.

### Installed first-Genesis WAL readback qualification

The installed lease workflow keeps its original lease-recovery,
managed-generations and Agent SIGKILL scenarios. A separate fourth hosted
scenario runs the unmodified pinned Node metered bootstrap on two fresh
disposable systemd guests **without** their staging meter or staging
environment. It prepositions the independently rebuilt and attested Xray
executable only; the real installer still verifies the exact manifest and
artifact attestation and creates its own qualification identity. Profiles and
the two-user roster are assigned before enrollment; the installed first meter,
egress and renewal services must produce real confirmed first-cap records and
the loopback-only ingress. No TLS listener is opened and no client sends bytes.

The separately pinned dormant readback module is copied into a root-private
test directory, not wired into an Agent service. The metered installer exits
through `install-metered-services.sh`, whose installed systemd units directly
execute their workers under the exact root-owned `/opt/xmesh-node` release
checkout, unlike the normal strict-PQ libexec installer. The scenario
verifies those actual unit ExecStart paths, exact checkout revision, clean
tracked worker bytes and root-owned imported module paths. No substitute
checkout, imported test stub or normal libexec fallback is permitted.
Its actual enrolled product, signed profile/roster,
isolated meter PID, private production-path WAL bind and strict-PQ request are
all used unchanged. The test asserts an empty
remote birth index, exact cap files and the measured Xray PID's actual
exclusive lifetime instance lock with no local traffic before and after,
and no public TLS authority outbox row. All four scenarios must pass;
the fourth is a diagnostic, not a fourth signed release artifact or a
production permission.

The first genuinely metered bootstrap hit a confirmed image-configuration
rejection on both Ubuntu classic-Docker guests before any WAL proof. The
fourth scenario now pins the separate Agent 6.0.38 candidate which explicitly
sets numeric image identity and names the rejected metadata field without
dumping environment values. The existing three 6.0.37 scenarios and their
immutable evidence gate remain independent and unchanged. The fourth
scenario only admits the exact candidate digest through the already
opt-in isolated rehearsal pin; it does not change the production target,
production release pin, Node staging settings, or issue public permission.
The Node candidate's real classic Docker check and all four Nexus scenarios
must pass before this branch can be considered for integration.

### Nonempty installed WAL diagnostic (fifth scenario)

The independent `public-tls-wal-nonempty` disposable scenario preserves
the fourth scenario's initial empty-WAL proof and exact Agent 6.0.38 /
attested Xray candidate, then exercises the actual installed loopback
VLESS frontend, its isolated metered Xray and the installed TCP egress
bridge on both nodes. It does not expose TLS or a public listener.
Before any test payload, it verifies the egress bridge network namespace,
installs exact OUTPUT/FORWARD reject rules and assigns a synthetic /32
only to the disposable guest's loopback, verifying the local route.
The guard rules remain until guest destruction. The bridge's real
global-address policy is unchanged; no packets are sent to an internet
endpoint.

The test sends 16 KiB in each direction for one subscriber on the main
and CDN nodes, requires exactly two real meter WAL streams per node and
an unspent second subscriber, then expects the dormant verifier to
reject the mismatched empty remote history. The actual installed
`charge_worker` must commit the real inventory and authenticate signed
charge receipts; rerunning must submit zero further batches. The
runner compares immutable SQL charge bytes, CDN class, conservative
reservation floors (not delivery acknowledgements) and exact off-host inventory bytes with the actual
guest WAL. The unmodified pinned dormant verifier must then accept the
committed nonempty signed history and reconcile actual local counters,
without changing any ledger bytes or issuing public TLS authority.
This checks first observed birth-index consistency, **not** completeness
before the first off-host witness or final transport delivery.

### Independent namespace executable diagnostic (sixth scenario)

`public-tls-namespace-candidate` preserves the nonempty WAL test and adds
an independently rebuilt, main-only signed namespace Xray from Node
`26b69f184a74a2ea6e58365dd9572f77d83be1e2`. The workflow verifies both
the executable and manifest against the committed Sigstore bundle; each
disposable clean guest repeats verification with the pinned installer.
The ordinary installed Agent 6.0.38, original metered Xray and release
qualification are not replaced. The separately reviewed dormant proof
from Node `9eaf579ff32171ca815c520bb7c6beb347c32745` binds the original
live PID and ordinary qualification to a different immutable sealed
namespace executable. Independent input hashes pin the namespace manifest
and provenance. The probe runs the sealed candidate with an inert empty
config in a new private loopback-only network namespace, verifies the
actual owned child executable, and checks that native mode without its
authenticated containment/bootstrap inputs fails closed. It measures
the original meter and ordinary qualification again after the real
MAIN/CDN loopback WAL traffic and strict-PQ committed readback.

This is a prerequisite for the actual installed native TLS data path,
**not** proof of native TLS traffic to the installed meter or a live
Nexus stop witness inside a private supervisor. No listener or positive
authority is created. The candidate is not a release artifact.

### Native TLS with original installed meter and actual Nexus stop witness (seventh scenario)

The additional `public-tls-native-live` rehearsal reuses the two separate
signed artifact pins, actual installed Agent 6.0.38 and original ordinary
meter. Before traffic it independently verifies the pristine signed WAL,
actual enrolled Genesis policy, immutable complete original cap roster,
original PID, qualified executable and configuration. Only the hosted
harness generates a short-lived, ephemeral fixture authority with the
disposable panel key in an anonymous descriptor and inserts that exact
envelope into the real SQL outbox; existing insertion guards remain intact.
There is still no production positive issuer.

The separately reviewed Node live diagnostic source from #238
`4eb388a9d7977138ad635204e6358ff6d51976fe` (exact tree
`a423c743bf874cf5de12d9e90d25481718888b1a`) retains the relay from #237
and carries only the original
fixed-scope strict-PQ revocation challenges/replies between the outer guest
and private loopback-only supervisor. The supervisor independently verifies
the actual signed profile, cert lineage (disposable local CA), immutable
route and original meter peer, signed authority and fresh online witness.
The first hosted attempt verified both genuine installed binaries but
failed closed on foreign Docker mount `open_tree` EINVAL. The reviewed
Node helper clones the exact original meter directory in its pinned
pidfd's mount namespace and returns one detached read-only FD after
closing unrelated descriptors; the supervisor never joins that namespace.
No writable or pathname fallback is allowed.
It executes the actual attested native frontend in a capless private PID,
mount and network namespace, checks exclusive bound listener transfer,
and requires that no witness relay socket or broker pidfd is inherited.
The second hosted attempt reached actual native listener adoption, but
the strict post-transfer credential proof detected a changing Go thread
set and failed closed. The harness now first requires actual core-ready
output and a bounded stable thread-set observation, with the independent
deadman already armed, then runs the original unchanged complete
post-transfer proof once; any failure stops the child before client bytes.
The actual TLS 1.3 VLESS client sends 16 KiB both directions through each
MAIN/CDN installed ordinary meter and the unchanged guarded local echo.
No TLS listener appears in the original network namespace.

After both active TLS connections have echoed, the host runner holds an
actual PostgreSQL account row lock. The private supervisor must obtain a
fresh nonce-bound, independently signature-verified **revoked** witness
from Nexus over strict-PQ (a generic network failure is insufficient for
this test), kill the exact native child and verify existing connections
and its isolated port physically stop. The fixture SQL lock rolls back;
the timing proof requires both authorities and every original cap to
remain live beyond the stop, excluding ordinary expiry as the cause. A
contended SQL roster gate runs inside a savepoint: rolling back negative
evidence recovers the SQL clock transaction from PostgreSQL's aborted
state, whereas releasing a successful gate's savepoint retains all
acquired locks until the existing signed clear-witness operation completes.
The original installed strict-PQ endpoint diagnostic also requires an
actual signed revoked response during contention and a fresh clear after
rollback, rather than accepting a generic error.
The ordinary meter and qualification are measured unchanged. The original
nonempty WAL flow must reject stale remote history, submit each actual
charge once, and reconcile the committed signed remote WAL to the
original live meter. The fixture authority outbox is checked unchanged.

This is a disposable first-Genesis rehearsal, not authorization to publish
an internet-facing port. Remote WAL readback precedes traffic and follows
commit; it is not an atomic live WAL+authority issuer or successor
generation/terminal settlement proof.

All seven installed scenarios must pass together. The extra four
candidate-only diagnostics do not add or replace the existing three
immutable 6.0.37 release evidence artifacts. No production release pin,
feature flag, positive issuer, TLS listener or production permission
changes as a result of this test.

### Exact conservative WAL charge heads (V2 domain)

The first-Genesis strict-PQ readback now uses schema 2 and the distinct
`XMESH_QUOTA_V2_PUBLIC_TLS_WAL_HEAD_V2\0` signature domain. No V1
downgrade is accepted by the reviewed dormant Node verifier
`70129491ff521bf3e56d4e8f0e318e79b40cdbe1` (tree `c238418ed5b461cb691f6394101a692d98223f91`).
Production still has no positive TLS issuer. A committed birth index is
immutable but subsequent byte intents can append to a previously registered
stream without changing the index or even the count of charged streams.

Under the original serialized plan, account, lease and WAL anchor locks,
Nexus selects the latest immutable row for every original stream, validates
its exact signed charge receipt against the SQL journal digest and matches
its filename, user, reservation and CDN class to the authenticated original
cap roster and birth. A canonical byte-sorted-by-filename JSON array of
`{filename,reservationId,userId,lastSequence,lastDigest,streamBytes,isCdn}`
records is hashed into `committedChargeHeadsSha256`. Empty arrays hash as
`[]`. The Node derives that digest independently from the actual complete
fsynced WAL, measured original cap roster and live counters; *every* local
stream must have an exact committed head. A signed but lagging snapshot
with the same birth index, missing charge or changed tail is refused. An
unauthenticated/expired/foreign response is a different failure, never
proof of authentic SQL lag.

The additional second real MAIN/CDN loopback transfer in the
`public-tls-wal-nonempty` scenario leaves the first birth inventory byte
for byte unchanged. It must reject the authentic signed stale tails,
submit each newly appended batch exactly once, and accept only then the
fresh matching signed head; all existing native TLS and installed recovery
scenarios retain their requirements. This is conservative **intent** equality,
not proof of delivery, physical writer retirement, terminal settlement or
authorization to refund. Neither release pin nor any production service,
installer, flag or public listener changes.
