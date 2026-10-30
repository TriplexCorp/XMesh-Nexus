# XSP-v2 disposable release-canary rehearsal

## Status

This is a **pre-release rehearsal harness**, not a production authorization and not the final release canary required by the enterprise roadmap.

The harness exists so the post-P0-E release gate is not first exercised after external review/physical qualification. It continuously proves that the already-reviewed production-capable/default-disabled components can still be composed into a disposable install/upgrade/rollback/recovery/observability exercise.

The frozen runtime scope used by this rehearsal is:

- Nexus runtime target: `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091`
- Node target: `083dc181c5e175f89007f4b93111cd5c45a69d97`

The workflow runs from newer repository checkpoints only if the product/runtime paths it exercises remain byte-for-byte/diff-equivalent to the frozen Nexus runtime scope. Review packaging, result-verifier, docs and canary-harness files may exist outside that frozen runtime target without changing it.

## Why this is a rehearsal, not the final canary

P0-E is still open on two external gates:

1. issue #137 — attributable independent security review/sign-off of the exact frozen target;
2. issue #138 — five representative real abrupt-power runs, independent hardware/storage review and explicit qualification checkpoint.

Any security-relevant remediation from either gate can change the release candidate. Therefore a green rehearsal **must not** be reused as the final release canary after such a change. The final release candidate must rerun this full canary after P0-E is complete.

The contract deliberately keeps:

- `finalReleaseCanarySatisfied=false`;
- `independentSecurityReviewComplete=false`;
- `physicalPowerLossQualified=false`;
- `productionActivation=false`;
- `strictPQEnabled=false`.

## Rehearsal domains

The dedicated workflow `.github/workflows/xsp-release-disposable-canary-rehearsal.yml` requires every domain below to succeed.

### 1. Install / upgrade / retry / restart / rollback

The workflow reuses the existing real P0-D migration proof instead of creating a second updater implementation.

It checks out exact Node `083dc181c5e175f89007f4b93111cd5c45a69d97`, runs the full Go 1.27.3 Agent suite, builds two real Agent binaries with distinct immutable release identities, places them in the existing content-addressed server-controlled artifact source, starts a disposable Nexus with `XSP_V2_P0D_AGENT_MIGRATION=staging-only`, then runs `scripts/test-xsp-agent-real-e2e.py`.

That existing proof must demonstrate:

- real signed manifest-bound install;
- lost poll-response exact redelivery;
- exact completed ACK retry idempotence;
- non-exact ACK replay rejection;
- restart/idempotent package apply;
- deterministic post-switch failure and last-known-good package rollback;
- durable security-state root not replaced/rewound by package rollback.

After the proof, the disposable Nexus is recreated with the migration gate empty and the workflow requires the gate to be default-off again.

### 2. Coordinated recovery

The workflow reuses the existing P0-E3b test implementation against the current reviewed Node target rather than implementing another recovery state machine.

It runs `scripts/test-xsp-v2-p0e3b-coordinated-backup-restore.py --node-repo xmesh-node` and therefore requires the existing real `pg_dump`/`pg_restore`, complete Agent state, signer identity, mTLS identity and independent E3a witness invariants to hold on the canary target.

A mutually consistent historical restore must still fail against the newer independent recovery floor; current restore must still succeed; missing/mixed/tampered components must still fail closed.

### 3. Redacted observability

The canary exercises both existing read-only observability surfaces:

- Node-local `xmesh-agent-xspv2-observe` against the exact Node source;
- Nexus `xsp-v2-observability` built only with its non-default feature.

`scripts/test-xsp-v2-canary-observability.sh` proves:

- both tools reject execution without exact `XSP_V2_OBSERVABILITY=staging-only`;
- Node observability regression tests pass against real Agent state primitives;
- Nexus durable observability runs against a disposable PostgreSQL fixture containing secret/replayable sentinels;
- no sentinel appears in JSON output;
- the durable database tuple is unchanged before/after observation;
- output retains `readOnly=true`, `productionActivated=false`, `strictPqEnabled=false`.

No observability HTTP route is introduced.

## Result artifact

Only after all domains pass, the final workflow job emits `xsp2-disposable-canary-rehearsal-result-1` and uploads it as `xsp-v2-disposable-canary-rehearsal-result`.

A successful rehearsal result means only:

```json
{
  "canaryHarnessVerified": true,
  "finalReleaseCanarySatisfied": false,
  "requiresP0EComplete": true,
  "requiresExactReleaseCandidateRerun": true,
  "productionActivation": false,
  "strictPQEnabled": false
}
```

It is preparation evidence that the canary mechanism is executable before the external P0-E gates close.

## Final release rule

After #137 and #138 are genuinely complete and any required remediation has been merged/re-frozen/re-reviewed, the exact release candidate must rerun the complete disposable canary. Only that post-P0-E exact-candidate run can satisfy the roadmap's release-canary requirement.

A later production rollout still separately requires a reviewed topology/DNS/firewall/Nginx/PostgreSQL/key rollout plan and explicit approval for `strict-pq` activation / XMESH1 retirement.

This rehearsal never turns `strict-pq` on and never authorizes production rollout.
