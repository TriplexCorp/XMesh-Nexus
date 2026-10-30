# XSP-v2 P0-E4a5 Node lab-operation source contract

Status: **bounded lab execution preparation only**. This contract does not perform a power action, does not claim physical durability, does not enable `strict-pq`, and does not authorize production rollout.

## Current qualification target and historical origins

P0-E4a now executes the lab arm points against the exact current v4 Node qualification source:

`34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` — Node PR #52.

Two older source identities remain provenance only:

- power-cut hook origin: `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e` (Node PR #44);
- real-operation lab-runner origin: `7bf8cc92950f396e33891c8744c1f6855414154b` (Node PR #45).

The current v4 target contains both historical lab primitives plus all later reviewed keyring/recovery semantics, including the `AI-LOW-002` parent-directory durability remediation. Physical qualification must therefore use a lab binary built from the current target rather than an old PR #44/#45 checkout.

Nexus CI preserves provenance by proving that the power-cut hook and real-operation runner files are byte-identical between their historical origins and the current target. It does **not** require `two_phase.go` or `sealed.go` to remain historical: those files intentionally evolved and their current semantics are exactly what the lab must exercise.

## Required real-operation arm points

The current runner must reach the inherited-FD arm marker through the real operations for exactly all five checkpoints:

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

The dedicated Nexus workflow checks out exact current Node revision `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` with full history and proves:

1. PR #44 remains the origin of the external power-cut hook;
2. PR #45 remains the origin of the real-operation runner;
3. the hook and runner files themselves are byte-identical at the current v4 target;
4. all five real-operation tests pass against the current v4 keyring/rotation/recovery implementation;
5. the current master-key provisioning path contains the parent-directory `fsync` remediation and its regression test;
6. the existing process-crash matrix still passes independently;
7. crash and physical-power tags cannot be compiled together;
8. the normal Agent binary contains no crash/power-cut qualification controls.

CI terminating a blocked test child is only a source-contract mechanism and is **not** physical power-loss evidence.

## Relationship to E4a3/E4a4

A real physical experiment still must create the E4a3 evidence bundle and complete the E4a4 five-point matrix. Those contracts are re-bound to current Node `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` as part of the same qualification-scope update.

The exact lab binary SHA-256, controller event, changed boot ID, storage/PLP profile, post-boot Agent/PostgreSQL state and independent E3a witness remain mandatory.

P0-E4a therefore remains **OPEN** after E4a5. It can close only after the five representative real abrupt-power experiments have been performed on the current qualification source and their raw controller/storage/WAL evidence and E4a4 matrix have received independent review.

`strict-pq` remains **OFF**. Production rollout remains **NOT AUTHORIZED**.
