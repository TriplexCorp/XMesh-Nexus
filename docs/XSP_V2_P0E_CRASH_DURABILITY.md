# XSP-v2 P0-E1a crash durability evidence

Status: **P0-E1a COMPLETE — process-crash / fsync-order boundary only. P0-E remains CURRENT.**

This checkpoint deliberately does **not** claim complete physical power-loss safety. It pins and machine-checks the exact XMesh-Node implementation merged by [Node PR #38](https://github.com/TriplexCorp/XMesh-Node/pull/38) at [`8a86227f369aed2e6e952f1e41af52c7414aa4e3`](https://github.com/TriplexCorp/XMesh-Node/commit/8a86227f369aed2e6e952f1e41af52c7414aa4e3).

## Proven boundary

The real XSP-v2 two-phase Node key rotation is exercised through subprocess hard exits immediately after each completed durable write boundary in the production rotation/recovery functions:

- retained authenticated `.previous` identity;
- monotonic epoch-floor advance;
- active-vault replacement with the already-approved `.next` candidate;
- pre-floor recovery cleanup;
- post-floor forward-recovery active-vault repair.

The write primitive fsyncs temporary file contents, renames atomically and fsyncs the parent directory. The epoch floor uses the same durable primitive.

The crash matrix proves:

- a crash after retaining `.previous` but before the floor advance keeps the old identity active and recovery returns to the still-prepared state without automatic cutover;
- a crash after the new floor but before the active swap rejects the old active vault fail-closed until explicit recovery moves forward to the already-approved candidate;
- a crash after the active swap leaves the new identity readable and recovery idempotent;
- crashes during both recovery write paths converge without lowering the epoch floor;
- old/new authenticated snapshots remain retained after forward recovery;
- the crash injector exists only behind the dedicated `xspv2_crash_test` build tag. The normal Agent artifact is built separately and CI rejects it if the crash-test environment marker appears in the binary.

## Exact Node evidence

On exact Node PR-head `abdf074e4ba91ce1c56a2056cbc6de8e261dc56e`, all relevant workflows passed, including the first dedicated `XSP-v2 P0-E Crash Durability` run.

On exact merged Node SHA `8a86227f369aed2e6e952f1e41af52c7414aa4e3`, all four triggered workflows completed **success**:

- `XSP-v2 P0-E Crash Durability #2` — run `40839431965`;
- `XSP-v2 P0-D Agent Artifact #13` — run `40839432158`;
- `XSP-v2 Crypto PoC (Go 1.27) #86` — run `40839432042`;
- `Node CI #472` — run `40839432161`.

## Explicitly not proven here

P0-E1a does not prove physical power removal, drive/controller volatile write-cache behavior, filesystem or VM snapshot anti-rollback, PostgreSQL backup/restore, old-key retirement, canary safety or production rollout.

Those remain subsequent P0-E gates. The next crash/power-loss sub-gate is **P0-E1b: physical power-loss/filesystem durability evidence**. Snapshot/anti-rollback remains after that.

`strict-pq` remains **OFF**. Production XSP-v2 rollout remains **NOT AUTHORIZED**.
