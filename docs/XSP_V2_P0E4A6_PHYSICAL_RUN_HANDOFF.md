# XSP-v2 P0-E4a6 physical-run handoff

Status: **bare-metal physical-lab execution preparation only; this profile remains unqualified**.

P0-E4a1 through P0-E4a5 define the storage preflight, inherited-FD arm boundary, one-run evidence contract, five-run matrix and real-operation reachability. E4a6 binds one actual physical run to preserved off-host evidence. It does **not** simulate power loss, control a BMC/PDU, authenticate a vendor API or claim physical qualification.

## Current qualification source

The active v4 bare-metal handoff uses:

- current Node qualification source and lab runner: `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` (Node PR #52);
- power-cut hook provenance: `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e` (Node PR #44);
- real-operation runner provenance: `7bf8cc92950f396e33891c8744c1f6855414154b` (Node PR #45);
- Nexus E4a5 lab/source contract: `a34d0999ca519e2a81e68d92ec7136cd606518d4`.

The old PR #44/#45 Node revisions are provenance only. New physical evidence must bind the remediated PR #52 target so the master-key parent-directory durability fix is inside the tested keyring scope.

The active entrypoint is:

```text
scripts/xsp-v2-p0e4a6-physical-run-handoff-v4.py
```

It reuses the existing non-executing E4a6 implementation while rebinding both Node source identities to the current v4 target. The exact lab executable is additionally bound by SHA-256.

## E3a witness prerequisite

Before `prepare`, the newest off-host E3a checkpoint must already have been checked with the existing `xsp-v2-recovery-checkpoint verify` tool against the exact pre-cut local epoch. Preserve both the original checkpoint and JSON verification output outside the tested host failure domain.

E4a6 requires a matching Node ID, minimum epoch, receipt digest and `localEpoch == rotation.fromEpoch`. The SHA-256 of the verification result is frozen into the run plan and must be supplied again after reboot.

## `prepare`

The command freezes:

- one of the five durability checkpoints;
- unique run ID and exact Node ID;
- from/to epoch and Ed25519/ML-DSA-65 identities;
- exact current lab binary bytes;
- Agent/PostgreSQL preflight reports;
- verified off-host E3a checkpoint;
- storage-profile and PLP/controller evidence IDs;
- external controller identity;
- pre-cut boot ID.

It creates a new fsynced plan and records the exact marker:

```text
XSP2-POWERCUT-ARMED-V1 run=<run-id> point=<checkpoint>
```

Every plan keeps:

```text
externalPowerControllerRequired=true
physicalPowerLossQualified=false
productionActivation=false
strictPQEnabled=false
```

## Physical action boundary

After the Node operation emits the inherited-FD arm marker, a **physically independent** BMC/PDU/controller must remove power. The handoff tool cannot perform that action.

Preserve off-host:

- E3a verification result;
- arm observation;
- controller metadata and raw event record;
- post-boot Agent record;
- PostgreSQL recovery record;
- review notes.

## `verify`

The verifier reuses the current E4a3 evidence verifier and checks that the final evidence matches the prepared run/source/binary/Node/rotation/boot/storage/off-host identities, exact arm marker, raw controller-event digest, post-boot Agent record, PostgreSQL recovery record and review-note digest.

A positive result is only:

```text
physical-run-handoff-verified-for-independent-review
```

and still returns `physicalPowerLossQualified=false`.

## Five-run bare-metal sequence

Run one independent physical cut at each checkpoint:

1. `after-previous` → `previous-complete`;
2. `after-floor` → `next-complete`;
3. `after-active` → `next-complete`;
4. `after-recovery-abort` → `previous-complete`;
5. `after-recovery-active` → `next-complete`.

After all five current-source runs pass E4a6, the existing E4a4 matrix verifier aggregates exactly those five E4a3 bundles.

## Deployment-profile boundary

This document now explicitly describes only the **bare-metal physical profile**. It remains available for deployments where the operator controls representative storage/controller/PLP and can trigger real host/device power loss.

A KVM VPS does not expose that hardware boundary. Production on `deploymentClass=kvm-vps` therefore uses a separate guest crash-consistency qualification policy and must never claim that physical hardware power-loss durability was tested. The KVM profile keeps `physicalPowerLossQualified=false` and makes provider-managed block-storage durability an explicit trust assumption.

`strict-pq` remains **OFF** until the applicable deployment-profile gates and remaining release gates are genuinely satisfied. Production rollout remains **NOT AUTHORIZED**.
