# XSP-v2 P0-E4a5 Node lab-operation source contract

Status: **bounded lab execution preparation only**. This contract does not perform a power action, does not claim physical durability, does not enable `strict-pq`, and does not authorize production rollout.

## Two pinned Node revisions

P0-E4a keeps two distinct source identities intentionally:

- power-cut hook / real keyring semantics: `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e` (Node PR #44);
- real-operation lab runner: `7bf8cc92950f396e33891c8744c1f6855414154b` (Node PR #45).

Node PR #45 adds only the test-only real-operation runner, its documentation and dedicated CI. It does not modify `two_phase.go`, the power-cut hook, encrypted keyring implementation, production Agent artifact or network/control-plane behavior. Nexus CI verifies this relationship directly from Git history before accepting the pin.

This separation preserves the existing P0-E4a3 evidence contract: `nodeSourceRevision` continues to identify the reviewed power-cut/keyring source from PR #44, while the exact physical-lab executable remains independently bound by its required SHA-256. The reviewed E4a5 runner revision documents how that executable reaches the real operation boundary.

## Required real-operation arm points

The pinned runner must reach the existing inherited-FD arm marker through the real operations for exactly all five checkpoints:

- `after-previous` — `ActivatePreparedRotation`;
- `after-floor` — `ActivatePreparedRotation`;
- `after-active` — `ActivatePreparedRotation`;
- `after-recovery-abort` — `RecoverRotation`;
- `after-recovery-active` — `RecoverRotation`.

The marker format remains:

```text
XSP2-POWERCUT-ARMED-V1 run=<run-id> point=<checkpoint>
```

The Node process then stops security-state progress. A physically independent BMC/PDU/controller must perform the abrupt power removal. The product and lab runner contain no autonomous power-control API.

## Nexus verification

The dedicated Nexus workflow checks out exact Node revision `7bf8cc92950f396e33891c8744c1f6855414154b` with full history and proves:

1. the reviewed PR #44 core files are byte-identical between the two pinned revisions;
2. the PR #45 delta is limited to the test-only runner, Node E4a5 documentation and its workflow;
3. all five real-operation E4a5 tests pass under `xspv2_powercut_qualification`;
4. the existing process-crash matrix still passes independently;
5. crash and physical-power tags cannot be compiled together;
6. the normal Agent binary contains no crash/power-cut qualification controls.

CI terminating a blocked test child is only a source-contract mechanism and is **not** physical power-loss evidence.

## Relationship to E4a3/E4a4

A real physical experiment still must create the already-defined E4a3 evidence bundle and complete E4a4 five-point matrix. The exact lab binary SHA-256, controller event, changed boot ID, storage/PLP profile, post-boot Agent/PostgreSQL state and independent E3a witness remain mandatory.

P0-E4a therefore remains **OPEN** after E4a5. It can close only after the five representative real abrupt-power experiments have been performed and their raw controller/storage/WAL evidence and E4a4 matrix have received independent review.

`strict-pq` remains **OFF**. Production rollout remains **NOT AUTHORIZED**.
