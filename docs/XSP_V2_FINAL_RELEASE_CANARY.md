# XSP-v2 final release canary

## Status

This is the **post-P0-E exact-candidate final canary** required before production rollout-plan approval and the bounded KVM `strict-pq` activation approval.

It is intentionally separate from the historical pre-P0-E disposable-canary rehearsal. The old rehearsal remains historical evidence and is not reused as the final release canary.

## Exact candidate

The final canary is bound to the reviewed production runtime target:

- XMesh-Nexus: `12b3170996bc062ee16c79659a6378e5e425fd0e`
- XMesh-Node: `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`

The workflow may run from a newer control/tooling revision only if the protected runtime paths are unchanged relative to the Nexus runtime target.

## Prerequisites

This gate is post-P0-E. It assumes the repository has already recorded completion of:

- issue #137 independent security review;
- issue #138 KVM VPS durability qualification.

Those gates retain their own evidence/verifiers. The canary does not replace or synthesize them.

## Required domains

`.github/workflows/xsp-v2-final-release-canary.yml` requires all of the following to pass on the exact candidate:

1. real Agent install/upgrade/lost-response/retry/restart/rollback lifecycle;
2. coordinated backup/restore/recovery with recovery-floor protection;
3. Node-local redacted observability;
4. Nexus durable redacted observability.

The Agent is built from exact Node revision `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb` with the existing signed/content-addressed migration path. The Nexus runtime paths are checked against exact revision `12b3170996bc062ee16c79659a6378e5e425fd0e` before the real disposable jobs are allowed to run.

## Success result

Only after every domain succeeds, the workflow emits and uploads `final-release-canary-result.json` using schema `xsp2-final-release-canary-result-1`.

A successful result records:

```json
{
  "finalReleaseCanarySatisfied": true,
  "productionActivation": false,
  "strictPQEnabled": false,
  "legacyXMESH1Retired": false
}
```

The SHA-256 of that exact result is the canary binding used by the later production rollout-plan gate and strict-PQ activation approval.

## Run checkpoint

The first authoritative post-P0-E run is intentionally triggered after the final-canary workflow is present on `main`, so GitHub evaluates it as a normal pull-request check against the exact candidate above.

## Non-claims

This workflow does not deploy production, change DNS/firewall/Nginx production state, enable `strict-pq`, or retire XMESH1. A successful final canary advances the release sequence to the separately reviewed rollout/rollback plan.
