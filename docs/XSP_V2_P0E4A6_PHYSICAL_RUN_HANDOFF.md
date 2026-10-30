# XSP-v2 P0-E4a6 physical-run handoff

Status: **physical-lab execution preparation only; P0-E4a remains OPEN**.

P0-E4a1 through P0-E4a5 already define the qualified-storage preflight, inherited-FD arm boundary, one-run evidence contract, five-run matrix and real-operation reachability. P0-E4a6 removes the remaining operator ambiguity between those pieces. It does **not** simulate power loss, control a BMC/PDU, authenticate a vendor API or claim physical qualification.

## Purpose

A real abrupt-power run has two distinct phases:

1. **before power removal**, freeze the exact run identity and every security/storage input that must not change;
2. **after reboot**, prove that the final E4a3 evidence bundle is byte-for-byte bound to separately preserved physical-lab records rather than being assembled from a different run, binary, controller event or storage generation.

`scripts/xsp-v2-p0e4a6-physical-run-handoff.py` provides exactly these two offline commands:

```text
xsp-v2-p0e4a6-physical-run-handoff.py prepare ... --out RUN.plan.json
xsp-v2-p0e4a6-physical-run-handoff.py verify ...
```

Neither command has a network client or power-control path.

## Pinned reviewed sources

The handoff pins the already-reviewed E4a source identities:

- Node power-cut/keyring source: `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e`;
- Node real-operation lab runner: `7bf8cc92950f396e33891c8744c1f6855414154b`;
- Nexus E4a5 lab/source contract: `a34d0999ca519e2a81e68d92ec7136cd606518d4`.

The exact lab executable is additionally bound by SHA-256. A source revision alone is not accepted as executable identity.

## `prepare` — pre-cut immutable handoff

Run `prepare` only after the representative storage stack has passed the existing E4a1 preflight and the newest independently held E3a checkpoint is available.

The command requires:

- one of the five required checkpoints;
- unique run ID;
- exact Node ID;
- exact from/to epoch and Ed25519/ML-DSA-65 key identities;
- exact lab binary bytes;
- `agent-state` and `nexus-postgres` preflight reports;
- newest off-host E3a checkpoint;
- reviewed storage-profile ID and PLP/controller evidence ID;
- external controller identity;
- pre-cut boot ID.

It validates that both preflights are `baselineEligible=true` and still have `physicalPowerLossQualified=false`, checks the off-host Node/floor binding, computes every required digest and creates a new `0600` fsynced plan without overwriting an existing path.

The plan includes the exact required arm marker:

```text
XSP2-POWERCUT-ARMED-V1 run=<run-id> point=<checkpoint>
```

The plan always records:

```text
externalPowerControllerRequired=true
physicalPowerLossQualified=false
productionActivation=false
strictPQEnabled=false
```

## Physical action boundary

After the real Node operation emits the inherited-FD arm marker, a **physically independent** BMC/PDU/controller must remove power. The handoff tool deliberately cannot perform that action.

Preserve the following raw records outside the tested host failure domain:

- arm observation JSON `{marker, observedAtMs}`;
- external controller metadata `{controllerId, eventId, action, observedAtMs}`;
- the raw controller event record itself;
- post-boot Agent evidence JSON;
- PostgreSQL recovery evidence JSON;
- independent review notes.

The external action must remain exactly `power-off`; the existing E4a3 verifier enforces the bounded arm→cut timing and changed boot ID.

## `verify` — post-boot binding

`verify` first calls the existing `scripts/xsp-v2-p0e4a3-powercut-evidence.py` verifier. It does not copy or weaken E4a3 rules.

It then adds the operator-handoff checks that E4a3 intentionally cannot infer from one assembled JSON document:

1. final evidence must match the prepared run ID/checkpoint/source/binary/Node/rotation/boot/storage/off-host fields exactly;
2. controller identity must be the one fixed before the run;
3. separately preserved arm observation must exactly equal the E4a3 arm object;
4. SHA-256 of the **raw external controller record** must equal `controllerEvent.rawEventSha256Hex`;
5. separately preserved post-boot Agent record must exactly equal the E4a3 `postBoot` object;
6. separately preserved PostgreSQL recovery record must exactly equal `postgresRecovery`;
7. SHA-256 of the independent review notes must equal the digest recorded in the evidence bundle.

A successful result is only:

```text
physical-run-handoff-verified-for-independent-review
```

and still returns `physicalPowerLossQualified=false`.

## Five-run execution sequence

Repeat the following with a unique run/controller event/boot pair for every checkpoint:

1. `after-previous` → expected `previous-complete`;
2. `after-floor` → expected `next-complete`;
3. `after-active` → expected `next-complete`;
4. `after-recovery-abort` → expected `previous-complete`;
5. `after-recovery-active` → expected `next-complete`.

For each point:

1. collect/retain the common E4a1 preflight reports and E3a witness outside the tested failure domain;
2. build the exact E4a5 lab binary and retain its SHA-256;
3. run E4a6 `prepare` before the real operation;
4. start the real E4a5 operation with the exact plan run ID/checkpoint and inherited arm FD;
5. when the exact marker is observed, let the independent controller perform the abrupt power-off;
6. after reboot, collect the changed boot ID, Agent recovery evidence and PostgreSQL recovery/integrity evidence **before any XSP-v2 network operation**;
7. preserve raw controller records and review notes off-host;
8. assemble the existing strict E4a3 evidence JSON and run E4a6 `verify`;
9. preserve the plan, raw records, final evidence and verifier output together for independent review.

After all five real runs pass E4a6, run the existing E4a4 matrix verifier over exactly those five E4a3 bundles.

## Qualification boundary

E4a6 is the final repo-side execution handoff. CI may test parsing, binding and negative cases with synthetic records, but those runs are **never** physical evidence.

P0-E4a can close only when:

- all five experiments were actually executed on the reviewed representative storage/controller/cache/PLP stack;
- real controller records and post-boot Agent/PostgreSQL/WAL evidence are preserved;
- the real five-run E4a4 matrix validates;
- an independent reviewer evaluates the raw physical/storage/WAL evidence and matrix digest;
- a later explicit reviewed checkpoint records the qualification result.

`strict-pq` remains **OFF**. Production rollout remains **NOT AUTHORIZED**.
