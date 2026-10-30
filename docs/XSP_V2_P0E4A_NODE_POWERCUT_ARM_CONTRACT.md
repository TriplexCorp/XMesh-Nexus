# XSP-v2 P0-E4a Node external power-cut arm source contract

Status: **bounded lab-primitive pin only**. P0-E4a remains OPEN. This document does not claim physical power-loss durability, enable strict-PQ, alter production routing, or authorize production rollout.

## Current qualification source

The current P0-E4a qualification source is the remediated XMesh-Node v4 revision:

`34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`

This is the merge of Node PR #52 and includes the `AI-LOW-002` durability remediation: initial master-key provisioning reports success only after the key file and its parent directory entry have been synchronously persisted.

The external power-cut hook itself originated in Node PR #44 at:

`50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e`

That historical revision remains provenance for the lab primitive, not the source revision that may be used for a current physical qualification run. A run intended for #138 must identify the current v4 Node source and an exact lab binary built from that source.

## Power-cut boundary

The current Node source exposes an external-lab arming point only under the dedicated `xspv2_powercut_qualification` build tag. Normal Agent builds compile the durability hook as a no-op. The process-crash injector uses the separate `xspv2_crash_test` tag, and the two evidence modes remain mutually exclusive.

At one of the existing durability checkpoints, the lab build may emit the exact bounded marker `XSP2-POWERCUT-ARMED-V1` to an inherited file descriptor and then stop making security-state progress. The Node code itself does not execute a shell command, open a network control path, reboot/power off the host, modify device cache policy, or claim that an abrupt power cut occurred. A physically independent lab controller must perform that action.

The Nexus source contract checks the exact current Node revision, normal/lab/crash build-tag separation, all five rotation durability boundaries, inherited-FD signaling, exact marker, blocked-after-arm behavior, absence of autonomous control APIs, and the v4 master-key parent-directory durability primitive.

A dedicated Nexus workflow checks out exact Node `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`, runs the lab-only qualification tests against the current keyring semantics, rejects the ambiguous dual-tag build, builds the normal Agent artifact, and verifies the normal artifact does not contain the crash/power-cut arming strings.

The workflow also retains historical provenance for PR #44 but does not treat old PR #44 binaries or evidence as current qualification evidence.

## Still required to close P0-E4a

The following remain outside this bounded contract:

- an actual abrupt host/device power removal after an observed arm marker;
- reviewed representative storage/controller/cache/PLP semantics;
- post-boot Agent recovery evidence at every required rotation boundary;
- PostgreSQL abrupt-power/WAL recovery evidence on the representative storage stack;
- proof that only a valid monotonic state survives and that no torn/substituted key material or security tuple is accepted;
- reviewed evidence binding the exact v4 binary/source revision, run ID, checkpoint, external controller event and post-boot state.

Therefore this contract records lab arming readiness for the current v4 Node source, not E4a completion. The next required evidence is the representative physical power-cut matrix.

`strict-pq` remains **OFF**. Production rollout remains **NOT AUTHORIZED**.
