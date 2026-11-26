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
