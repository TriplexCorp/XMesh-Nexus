# XSP-v2 P0-E4a Node external power-cut arm source contract

Status: **bounded lab-primitive pin only**. P0-E4a remains OPEN. This document does not claim physical power-loss durability, enable strict-PQ, alter production routing, or authorize production rollout.

Nexus pins the exact XMesh-Node implementation merged by Node PR #44 at:

`50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e`

The pinned Node source exposes an external-lab arming point only under the dedicated `xspv2_powercut_qualification` build tag. Normal Agent builds compile the durability hook as a no-op. The older process-crash injector uses the separate `xspv2_crash_test` tag, and the two evidence modes are intentionally mutually exclusive.

At one of the existing P0-E1a durability checkpoints, the lab build may emit the exact bounded marker `XSP2-POWERCUT-ARMED-V1` to an inherited file descriptor and then stop making security-state progress. The Node code itself does not execute a shell command, open a network control path, reboot/power off the host, modify device cache policy, or claim that an abrupt power cut occurred. A physically independent lab controller must perform that action.

The Nexus source contract machine-checks the exact Node merge SHA, normal/lab/crash build-tag separation, all five existing rotation durability boundaries, inherited-FD signaling, exact marker, blocked-after-arm behavior, absence of autonomous control APIs, Node CI boundary language, and the explicit statement that GitHub CI is not physical power-loss evidence.

A dedicated Nexus workflow also checks out the pinned Node revision, runs the lab-only qualification tests, proves the ambiguous dual-tag build is rejected, builds the normal Agent artifact, and verifies the normal artifact does not contain the crash/power-cut arming strings.

## Still required to close P0-E4a

The following remain outside this bounded contract:

- an actual abrupt host/device power removal after an observed arm marker;
- reviewed representative storage/controller/cache/PLP semantics;
- post-boot Agent recovery evidence at every required rotation boundary;
- PostgreSQL abrupt-power/WAL recovery evidence on the representative storage stack;
- proof that only a valid monotonic state survives and that no torn/substituted key material or security tuple is accepted;
- reviewed evidence binding the exact binary/source revision, run ID, checkpoint, external controller event and post-boot state.

Therefore this contract records **E4a2 lab arming readiness**, not E4a completion. The next required evidence is the representative physical power-cut matrix.

`strict-pq` remains **OFF**. Production rollout remains **NOT AUTHORIZED**.
