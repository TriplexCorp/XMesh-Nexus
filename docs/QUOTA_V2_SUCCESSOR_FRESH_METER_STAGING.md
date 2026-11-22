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
