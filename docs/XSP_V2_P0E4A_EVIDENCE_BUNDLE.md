# XSP-v2 P0-E4a physical-power evidence bundle

Status: **evidence integrity/cross-binding helper only**. This is not a physical power-loss attestation, does not change `physicalPowerLossQualified` to true, does not activate strict-PQ, and does not authorize production rollout.

## Why this exists

P0-E4a1 establishes the read-only storage/PostgreSQL qualification preflight. P0-E4a2 establishes an externally observable Agent durability checkpoint that a physically independent controller can use to remove power. The remaining real-world matrix produces evidence in multiple trust/failure domains: preflight reports, E3a off-host witness/pins, exact arm marker, controller/PDU/BMC record, and post-boot Agent/PostgreSQL state.

A physical test is not useful if those artifacts can be accidentally mixed across runs, silently replaced, pointed at through symlinks, or accepted while the recovered state is below the already trusted E3a monotonic floor. `scripts/xsp-v2-p0e4a-evidence-bundle.py` therefore provides a bounded offline consistency check before independent human/security review.

## Important non-claim

The verifier **cannot know that electricity was physically removed**. A JSON controller record can describe an event, but software running in the repository cannot independently establish the physical truth of that claim. The tool therefore:

- requires the manifest field `physicalPowerLossQualified` to be exactly `false`;
- returns `physicalPowerLossQualified=false` even for a completely consistent bundle;
- treats the controller record as an integrity-bound evidence component, not as a trusted attestation;
- requires independent review of BMC/PDU/controller logs, storage/controller identity and PLP/cache behavior before P0-E4a can be closed.

No CI result from this verifier may be cited as physical power-loss qualification.

## Bundle boundary

The manifest uses schema `xsp2-p0e4a-evidence-bundle-1` and binds one exact run:

- bounded `runId`;
- one of the five existing Agent durability checkpoints;
- exact Node ID;
- exact Nexus and Node source revisions;
- qualification binary SHA-256;
- `physicalPowerLossQualified=false`;
- a SHA-256 + basename for each required component.

Required components are:

1. Agent-state P0-E4a1 preflight report;
2. Nexus/PostgreSQL P0-E4a1 preflight report;
3. newest owner/off-host P0-E3a checkpoint;
4. independently retained panel public pin input used by the E3a verifier;
5. exact E4a2 arm-marker record;
6. external controller/PDU/BMC event record;
7. post-boot Agent state record;
8. post-boot PostgreSQL state record.

Every component must be a bounded non-symlink regular file with the exact manifest SHA-256. Component filenames are basenames only; directory traversal and duplicate file reuse are rejected.

## Semantic checks

The verifier additionally requires:

- both preflight reports are `baselineEligible=true`, contain no failures and still say `physicalPowerLossQualified=false`;
- the off-host checkpoint uses the existing P0-E3a schema and exact Node identity;
- the arm record exactly binds `runId`, checkpoint and `XSP2-POWERCUT-ARMED-V1` marker text;
- the controller record binds the same run/checkpoint, says `abrupt-power-loss`, records the exact observed arm marker and declares an independent controller;
- the post-boot Agent and PostgreSQL Node identities match the off-host witness;
- neither post-boot epoch may be below the E3a `minimumEpoch`;
- at the exact E3a floor, the authoritative receipt SHA-256 must equal the off-host receipt digest;
- post-boot Agent classification is `previous-complete` or `next-complete`, never a torn/ambiguous state;
- Agent validation claims no network use;
- PostgreSQL recovery completed with `fsync=on`, `full_page_writes=on`, and the evidence collector did not mutate the XSP-v2 security tuple while validating it.

The existing `xsp-v2-recovery-checkpoint` tool remains the cryptographic authority for the E3a checkpoint/receipt/panel-pin relationship. This evidence-bundle verifier intentionally does **not** implement a second Ed25519/ML-DSA verifier or a new recovery state machine; it only integrity-binds those independently verified inputs into the physical-test evidence set.

## Controller evidence format

The external lab system records a bounded JSON object such as:

```json
{
  "schema": "xsp2-p0e4a-external-controller-event-1",
  "runId": "p0e4a-run-0001",
  "checkpoint": "after-floor",
  "event": "abrupt-power-loss",
  "independentController": true,
  "observedArmMarker": "XSP2-POWERCUT-ARMED-V1 run=p0e4a-run-0001 point=after-floor",
  "eventTimeUnixMs": 1793311234567,
  "evidenceReference": "immutable-pdu-or-bmc-log-reference"
}
```

This record is necessary but not sufficient. Reviewers must inspect the referenced evidence and confirm that the controller was outside the tested host/rollback domain and that the observed action was genuinely abrupt power removal rather than graceful shutdown, process termination, VM snapshot or ordinary guest reset.

## CI scope

Dedicated CI creates synthetic evidence files and proves the verifier rejects:

- any manifest/preflight that claims physical qualification;
- component digest tampering;
- symlink substitution;
- duplicate JSON fields;
- controller/arm marker mismatch;
- post-boot state below the independent E3a floor;
- same-epoch authoritative receipt divergence.

CI can only prove the parser and cross-binding policy. **P0-E4a remains open until real representative hardware/storage abrupt-power runs are executed and independently reviewed.**

`strict-pq` remains **OFF**. Production rollout remains **NOT AUTHORIZED**.
