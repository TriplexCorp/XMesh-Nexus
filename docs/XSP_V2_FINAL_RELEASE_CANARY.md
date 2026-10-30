# XSP-v2 exact-candidate canary / final-canary gate

## Status

The workflow exercises the exact reviewed production candidate:

- XMesh-Nexus: `12b3170996bc062ee16c79659a6378e5e425fd0e`
- XMesh-Node: `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`

During release-gate verification on 30 October 2026, issue #137 was found to have been closed without attributable independent external review evidence. It has therefore been reopened. Issue #138 remains complete.

Accordingly, the current exact-candidate canary may prove the runtime composition and all disposable canary domains, but **must not** claim `finalReleaseCanarySatisfied=true` until #137 is genuinely accepted and the exact candidate is rerun after that acceptance.

## Exact-runtime execution

Each real canary job checks out Nexus revision `12b3170996bc062ee16c79659a6378e5e425fd0e` directly, rather than treating later control/tooling commits as the runtime candidate. XMesh-Node is separately checked out at `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`.

This preserves the reviewed runtime boundary while allowing newer control-plane workflow files to orchestrate the test.

## Required domains

`.github/workflows/xsp-v2-final-release-canary.yml` requires all of the following to pass:

1. real Agent install/upgrade/lost-response/retry/restart/rollback lifecycle;
2. coordinated backup/restore/recovery with recovery-floor protection;
3. Node-local redacted observability;
4. Nexus durable redacted observability.

The existing real proof implementations are executed from the exact Nexus runtime checkout; they are not reimplemented by the newer workflow.

## Current successful-result boundary

While #137 is open, a fully green exact-candidate run emits `exact-candidate-canary-result.json` with:

```json
{
  "exactCandidateCanaryPassed": true,
  "finalReleaseCanarySatisfied": false,
  "blockedBy": ["independent-security-review-137"],
  "productionActivation": false,
  "strictPQEnabled": false,
  "legacyXMESH1Retired": false
}
```

This is useful candidate evidence, but it is **not** the final release-canary artifact consumed by rollout-plan eligibility.

## Final release rule

After a real attributable external result closes #137 and passes `scripts/verify-xsp-v2-p0e-independent-security-review-result.py --require-closure-eligible`, the exact same reviewed candidate must rerun the complete canary. Only that post-#137 run may emit `finalReleaseCanarySatisfied=true` and supply the final canary SHA-256 to the production rollout-plan gate.

The later rollout-plan review and KVM strict-PQ activation approval remain separate gates. No canary run itself enables `strict-pq` or activates production.
