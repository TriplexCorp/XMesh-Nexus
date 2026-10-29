# XSP-v2 P0-E4a4 five-point physical power-cut matrix

Status: **review-preparation tooling only; P0-E4a remains OPEN**.

P0-E4a3 defines one strict evidence bundle for one independently executed physical power-cut run. P0-E4a4 groups exactly five already-valid E4a3 bundles into the required durability matrix without weakening or reimplementing the E4a3 checks.

## Required matrix

Exactly one evidence bundle is required for each pinned Node checkpoint:

- `after-previous`;
- `after-floor`;
- `after-active`;
- `after-recovery-abort`;
- `after-recovery-active`.

`scripts/xsp-v2-p0e4a4-powercut-matrix.py` dynamically loads and calls the existing E4a3 verifier for every bundle. It therefore inherits the exact source revision, arm marker, external controller, changed boot ID, Agent state, E3a off-host floor, storage-preflight and PostgreSQL recovery checks from E4a3 rather than creating a parallel verifier.

## Cross-run consistency

All five runs must use one reviewed qualification profile:

- same pinned Node source revision;
- same Nexus source revision;
- same lab binary SHA-256;
- same Node identity and exact rotation identity;
- same external controller identity;
- same reviewed storage profile and PLP/controller evidence identity;
- same Agent/PostgreSQL preflight report digests;
- same independently held E3a checkpoint/floor/receipt witness.

Each run must have a unique run ID, unique external controller event ID, unique raw controller-event digest and unique pre/post boot identity pair. This prevents one physical event or reboot record from being copied across multiple durability points.

## Matrix digest

The aggregator computes a deterministic SHA-256 over the ordered checkpoint name and exact SHA-256 of each strict E4a3 JSON evidence file. This creates one review handle for the complete five-run set without changing any underlying evidence.

## Qualification boundary

A complete matrix returns:

- `status=matrix-complete-for-independent-review`;
- `physicalPowerLossQualified=false`.

That distinction is intentional. Five structurally consistent bundles are necessary evidence but are not, by themselves, an independent conclusion that the storage/controller/PLP stack is physically qualified.

The matrix tool has no power-control API, network client, database mutation, Agent mutation, reset/rekey path or production activation path. CI can exercise matrix structure and negative cases with synthetic fixtures, but those tests are never physical power-loss evidence.

## Still required before P0-E4a can close

1. Run the five physical experiments on the reviewed representative storage/controller/cache/PLP stack.
2. Preserve raw external controller records and post-boot Agent/PostgreSQL evidence for every run.
3. Produce a valid E4a4 matrix over those real E4a3 bundles.
4. Independently review the raw controller/storage/WAL evidence and the matrix digest.
5. Only a later explicit reviewed checkpoint may set physical power-loss qualification complete.

`strict-pq` remains **OFF**. Production rollout remains **NOT AUTHORIZED**.
