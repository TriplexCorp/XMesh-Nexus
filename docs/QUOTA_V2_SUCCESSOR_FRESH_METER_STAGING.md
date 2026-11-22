# Quota V2: isolated fresh successor meter (draft staging only)

This is **not** a release gate PASS and cannot create a spending reservation.
The candidate emitted by `quota_v2_calendar_successor_preparations` (0157)
has zero authority; migration 0160 records a *different* measured Xray
incarnation and explicitly blocks the older positive first-cap / renewal
outboxes from consuming its unfunded reservation.

## Why a new runtime is necessary

Current Xray byte WAL files are derived from
`SHA256(runtimeId || NUL || inbound-email || NUL || direction)`. The same
Xray process, user alias and direction therefore produce the **same file**
across calendar periods. A merely changed `meterEpoch` or
`reservationId` in PostgreSQL does not change that filename; late
old-period WAL could be charged against a successor lease.

A fresh running process must instead have a different kernel/pidfd
runtime identity, a distinct Docker container, a private separately
measured WAL directory with no births, and independently checked zero
per-alias counters. The previous Xray remains fenced for that user and
all its old WAL streams remain under the original SQL reservation. A
`calendar-fence-u*-*.json` is only a **nonfinal** checkpoint after
Nexus-signed conservative WAL receipts and an off-host full birth-index
head; it never authorizes a refund.

## Current implementation

- `0160_quota_v2_successor_fresh_meter_staging.sql` keeps an immutable
  predecessor-bound identity of the proposed new process, its
  executable/config digests, empty WAL birth-index SHA-256, user/Node,
  and the exact candidate IDs of the already signed zero-spend
  preparation. It rejects reuse of the old runtime, foreign owner,
  changed candidate meter, nonempty registry, future/early process
  start, positive authorization fields and duplicate submissions.
- Multiple users may share **one** new isolated Xray process. Their
  predecessor reservations, meter epochs and user-scoped WAL ownership
  remain distinct. SQL serializes concurrent staging under a per-container
  advisory lock and requires identical Node, runtime ID, container start
  time, host PID, executable/config hashes and initial WAL fingerprint for
  all users reporting that container. Reusing the same new process for
  a second calendar transition of the **same** user is refused.
  A successor may boot before a later user's independent calendar
  boundary, but an already active process with a nonempty WAL cannot
  truthfully claim an entirely pristine first-cohort registry. Per-user
  live zero-counter proofs are still mandatory for dynamic joins.
- A database trigger explicitly rejects use of candidate reservation
  IDs or meter epochs through the existing positive first-cap and
  renewal outbox paths. It also refuses reuse of any staged new runtime
  through the legacy first-cap issuer. This staging row cannot
  create `quota_v2_reservations`, reset counters, allocate bytes or
  change account settled/held balances.
- Node's strict Docker/kernel inspection recognizes ONLY the old
  `xmesh-managed-xray` and a separate
  `xmesh-successor-quarantine` name. Both have the same
  `--network none`, no extra capabilities or privileged mode,
  immutable config pin, private WAL mount and pidfd requirements.
  The disposable real-Docker fixture now runs two processes and
  demonstrates separate process identity and WAL mounts, including
  rejection of a stopped or network-attached candidate.
- A disposable PostgreSQL fixture rejects malformed/bogus candidate
  identities and new positive outbox writes and tests two users on
  one fresh container.

## What is NOT implemented or proved

These measurements are **not** cryptographic remote attestation. SQL
cannot authenticate a Docker PID, user-supplied zero-counter booleans,
local byte-WAL state, a Node signature, or the completeness of history
before the first external WAL witness. Nor can a clean WAL directory
alone prove all Xray StatsService counters are zero.

There is deliberately **no production enrollment endpoint** that
submits this preflight, **no verified all-alias zero-counter observation
from the successor Xray**, and **no funded positive successor issuer**.
The active process replacement plan must also handle remaining users'
old WAL and any old Xray live connections without dropping or
relabeling charges. A future separate protocol must:

1. Authenticate the *actual* fresh running process, complete signed
   MAIN/CDN roster and independently observed zero counters.
2. Serialize allocation under PostgreSQL account / Node / CDN locks.
   Keep all historical WAL debts and old outstanding holds conserved.
3. Save exact signed positive successor response and reservation in the
   **same** transaction, replay identical bytes after lost COMMIT reply.
4. Bind a fresh Xray socket to the new runtime, apply/ACK the grant,
   verify live VLESS admission and fail closed after SIGKILL/replacement.
5. Verify two-Node 1000/150 MiB, 100/500 simultaneous VLESS sessions,
   dynamic add/revoke, backup/rollback and calendar transition under
   live traffic. No release until real PostgreSQL, installed Agent,
   patched Xray and CI results confirm the entire chain.

Keep PRs draft, `main` and production untouched, and
`XMESH_QUOTA_V2_ENABLED=0`. No staging record is permission to enable.

## Source-pinned fresh process zero-meter probe (Node #170)

The Node draft now has a read-only `/v1/zero-meter` action on the
existing source-pinned, same-UID Unix control socket. The Agent checks
the Nexus-signed zero-spend predecessor preparation, fully acknowledged
old WAL close, a DIFFERENT Docker/kernel runtime and a separate private
WAL root. The new Xray independently checks its exact runtime ID,
empty birth inventory, absence of any prior sessions, signed caps,
meter intents or nonzero StatsService user counters; it echoes the
complete MAIN/CDN alias roster and returns only explicit zero-spend
flags. A raw counter registered at zero by Xray configuration is
permitted; any nonzero user counter is refused.

The Agent rechecks the process and WAL root after IPC and stores a
root-private `calendar-meter-*.json` proof. With
`XMESH_QUOTA_V2_FRESH_METER_STAGING=1` and explicit measured successor
socket/executable/config pins, the existing renewal worker may
automatically perform this additional **non-authorizing** stage after
the old signed WAL close. The default installed service does not
enable that staging flag or launch a second Xray. The marker cannot
create `quota_v2_reservations` or an Ed25519 positive-cap outbox.

The Node/Agent same-host proof is **not authenticated by PostgreSQL**
and cannot be trusted as a cryptographic independent runtime
attestation, particularly after root compromise. Migration 0160 remains
a closed, non-spending SQL staging table, not an active API endpoint.
Newly added regression coverage is staged; GitHub Actions runners must
actually execute all checks before claiming successful acceptance.


## Draft positive successor issuer and unresolved cross-runtime WAL birth chain

Migration \`0161_quota_v2_calendar_successor_positive_outbox.sql\` and
\`quota_v2_cap_delivery/successor_positive.rs\` now add a separate
authenticated strict-XSP/2 branch
\`calendarSuccessorPositive\`. After verified old calendar closure,
the signed zero-authority preparation, new Xray kernel/container/pinned
zero-WAL evidence and exact last signed predecessor WAL-charge heads,
Nexus holds the existing per-user account lock and allocates a fresh
reservation through the **existing** conservative SQL reserve function.
It binds immutable Node/CDN calendar windows, an independent CDN class
hold, and new meter/runtime identifiers, and conserves shared held
capacity with **all existing historical commitments**.

The same transaction saves TWO distinct Ed25519 signed envelopes:
the positive \`XMESH_QUOTA_V2_XRAY_CAP_ADMISSION_V1\0\` spending cap and
the fresh \`XMESH_XRAY_GENESIS_PREPARED_V1\0\` zero-byte Xray process
companion. The trigger validates exact owner/Node/epoch/runtime,
reservation amount/class and the JSON payload pair. A deferred constraint
prevents the new reservation from committing without its exact signed
positive outbox. A repeated deterministic request returns both exact
original signatures; it does not reserve again. A wrong runtime or
different old WAL charge-head digest fails closed.

Node #170 contains the opt-in Agent path \`successor_positive.py\`:
verify both pinned Nexus signatures, the exact original old reservation
and ALREADY acked old WAL, check a different kernel-measured fresh Xray
and private WAL, then use the existing SO_PEERCRED+pidfd checked Unix
\`/v1/quota-cap\` installer with the two envelopes. It fsyncs the
installation receipt. A real patched-Xray regression exercises the
fresh Genesis/positive pair against loopback MAIN/CDN VLESS and new
runtime-keyed WAL files.

The stage defaults OFF: \`XMESH_QUOTA_V2_FRESH_METER_STAGING=1\`
AND \`XMESH_QUOTA_V2_AUTO_SUCCESSOR_POSITIVE=1\`, separately configured
new socket and executable/config pins, are required even in staging.
It never launches Xray or alters public ingress, and NEVER enables
\`XMESH_QUOTA_V2_ENABLED\`. No production toggles have been changed.

### Current explicit release blockers

1. **Independent multi-runtime WAL birth-index extension.** Existing
   off-host signed birth anchors are a single append-only ledger per
   Node. A fresh Xray private journal starts at birth sequence one and
   cannot replace the previous process's signed remote prefix. The
   staged second-runtime charge worker refuses an unverified fork;
   new positive caps must not be enabled in production until a genuine
   conservative merge/append protocol proves the previous full prefix
   and every fresh new WAL birth. The old reservation always keeps
   its original stream owner.
2. **Real installed two-process switchover.** The fresh quarantined
   Xray starts with \`--network none\`; successful Unix installation
   alone does NOT redirect public VLESS ingress or restore an
   already terminated user connection. A separately verified
   fail-closed public ingress handoff remains to be built and tested.
3. **Repeated calendar epochs and multiuser handoff.** The current
   renewal scanner has a first calendar successor but does not promote
   its positive reservation into the next historical predecessor for
   a second rollover. Additionally the initial empty-WAL proof cannot
   be reused indiscriminately after other users on the new process
   have already transmitted bytes; an independently verified
   per-user join/zero-counter protocol remains necessary.
4. **Build/integration evidence.** No hosted Actions have completed
   on the new commits; real PostgreSQL 17, Rust, pinned-Go Xray,
   2-node live VLESS, SIGKILL, lost XSP reply and 100/500 connection
   stress must PASS before merging. Unit/static source checks are
   not a substitute.

These draft changes must not be promoted to production until the
complete above chain is proven. Existing MAIN/CDN and historical WAL
conservation take priority over short-term availability.
