# XSP-v2 P0-E4a3 physical power-cut evidence contract

Status: **lab evidence tooling only; P0-E4a remains OPEN**.

This gate does not simulate physical power loss and does not allow GitHub CI to claim physical durability. It defines the evidence that must be collected after a physically independent BMC/PDU/controller removes power from a representative host/device after observing the lab-only Node arm marker.

## Pinned Node source

The evidence verifier accepts only the current remediated Node qualification target:

`34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`

This is Node PR #52, which includes the master-key parent-directory durability remediation from internal finding AI-LOW-002. The physical power-cut hook itself originated at Node PR #44 / `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e`; that older revision is provenance only and is no longer accepted as the current qualification source.

The lab binary SHA-256 is recorded separately so a run is bound to exact executable bytes, not only a source label.

## Required durability checkpoints

The physical matrix must eventually contain reviewed evidence for all five arm points present in the pinned Node source:

- `after-previous` → expected post-boot state: `previous-complete`;
- `after-floor` → expected post-boot state: `next-complete`;
- `after-active` → expected post-boot state: `next-complete`;
- `after-recovery-abort` → expected post-boot state: `previous-complete`;
- `after-recovery-active` → expected post-boot state: `next-complete`.

The verifier rejects any post-boot identity/epoch that does not match the exact old/new identity implied by that checkpoint.

## External controller boundary

The Node process never powers the host off. The evidence bundle must contain the exact arm marker:

`XSP2-POWERCUT-ARMED-V1 run=<run-id> point=<checkpoint>`

and a distinct external controller event with:

- controller identity;
- controller event identity;
- action exactly `power-off`;
- observation timestamp after the marker and within the bounded arm→cut window;
- SHA-256 of the raw controller event record.

The pre-cut and post-boot IDs must differ. This prevents a process restart from being mislabeled as a power cycle.

## Storage qualification binding

Each lab run is bound to the exact SHA-256 of both previously generated P0-E4a storage-preflight reports:

- `agent-state`;
- `nexus-postgres`.

Both must have been `baselineEligible=true` and must still state `physicalPowerLossQualified=false`. A preflight is only eligibility evidence; the physical run is separate. The evidence bundle also records the reviewed storage-profile ID and independent PLP/controller evidence ID.

## Post-boot Agent evidence

The bundle records:

- exact rotation from/to epochs and Ed25519/ML-DSA-65 key IDs;
- post-boot key epoch and active key IDs;
- state classification (`previous-complete` or `next-complete`);
- digest of the complete security-state evidence;
- an explicit assertion that no network operation occurred before local recovery evidence validation.

The independent P0-E3a off-host checkpoint remains outside the tested power-loss domain. Its Node identity and minimum epoch are checked as the monotonic floor.

## PostgreSQL abrupt-power evidence

The same run bundle records that PostgreSQL recovery was observed after reboot, that integrity checks passed, and that the reviewed durability settings remain effective (`fsync=on`, `full_page_writes=on`, accepted `synchronous_commit`, non-empty `wal_sync_method`). The post-recovery XSP-v2 security tuple is represented by an exact SHA-256 evidence digest for review.

This structural contract does not by itself prove WAL correctness. The actual representative lab run, PostgreSQL logs/checks and reviewer evidence remain mandatory.

## Review boundary

`scripts/xsp-v2-p0e4a3-powercut-evidence.py` is offline and read-only. It validates structure, bindings and temporal ordering only. It does not authenticate a BMC/PDU vendor API, perform a power action, modify Agent/PostgreSQL state, or set `physicalPowerLossQualified=true`.

A structurally valid bundle therefore prints:

`"physicalPowerLossQualified": false`

until the complete real matrix for the representative storage profile is independently reviewed and a later checkpoint explicitly records qualification.

## Still required to close the bare-metal physical profile

1. Execute a real abrupt-power run for each required Agent checkpoint on the reviewed representative storage stack.
2. Capture the actual external controller records, boot IDs, exact lab binary hash and post-boot Agent state for every run.
3. Execute/review PostgreSQL abrupt-power/WAL recovery on the same representative storage/controller/cache/PLP profile.
4. Demonstrate no torn/substituted key material or invalid XSP-v2 security tuple is accepted.
5. Independently review the complete matrix and only then record a qualification checkpoint.

This physical profile remains available for bare-metal deployments. A separate KVM-VPS durability profile may satisfy the production durability gate for `deploymentClass=kvm-vps` without claiming physical hardware qualification.

`strict-pq` remains **OFF**. Production rollout remains **NOT AUTHORIZED**.
